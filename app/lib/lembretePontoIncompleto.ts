// Lembretes de ponto do dia anterior (públicos dinâmicos das automações em
// /admin/parametros/agendamentos). Depois do envio fica gravada uma conversa
// (folha_ponto_whatsapp_pendencias) já no meio do fluxo certo do bot
// (pontoWhatsapp.ts), com a data de ontem — o funcionário só responde:
//   - 'PONTO_INCOMPLETO_ONTEM': bateu só a entrada ou só a saída de um par →
//     "deseja justificar?" → fluxo JUSTIFICAR, etapa INFORMAR_HORARIO.
//   - 'SEM_PONTO_ONTEM': não registrou nada num dia em que deveria trabalhar →
//     "deseja abonar?" → fluxo ABONAR, etapa INFORMAR_MOTIVO (+ atestado).
// Nos dois casos sai uma solicitação PENDENTE pro RH aprovar, igual ao manual.
//
// Fica fora de pontoWhatsapp.ts de propósito: automacoes.ts importa daqui, e
// pontoWhatsapp.ts já importa automacoes.ts (evita import circular).
import { supabaseAdmin } from './supabase';
import { indexarFeriados, feriadosDaEmpresa } from './feriados';

type Db = ReturnType<typeof supabaseAdmin>;
type TipoBatida = 'ENTRADA_1' | 'SAIDA_1' | 'ENTRADA_2' | 'SAIDA_2';

// Pares entrada/saída do dia — "ponto incompleto" é um par com só uma das pontas
const PARES: [TipoBatida, TipoBatida][] = [['ENTRADA_1', 'SAIDA_1'], ['ENTRADA_2', 'SAIDA_2']];

export interface DestinatarioLembretePonto {
  nome_completo: string;
  celular: string;
  empresa_id: number | null;
  // Variáveis da mensagem/template: {{data}} (dd/mm/aaaa) e, no incompleto,
  // {{batida}} ("entrada"/"saída")
  vars: Record<string, string>;
  dataReferencia: string; // AAAA-MM-DD (ontem)
  tipoBatida?: TipoBatida; // a batida que falta — só no lembrete de ponto incompleto
}

const dataBRT = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
function ontemBRT(): string {
  const [a, m, d] = dataBRT(new Date()).split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export async function listarPontoIncompletoOntem(db: Db, empresaId: number | null): Promise<DestinatarioLembretePonto[]> {
  const ontem = ontemBRT();

  let qFuncs = db.from('folha_funcionarios')
    .select('nome_completo, celular, empresa_id')
    .eq('ativo', true).eq('ponto_whatsapp_ativo', true).not('celular', 'is', null);
  if (empresaId) qFuncs = qFuncs.or(`empresa_id.is.null,empresa_id.eq.${empresaId}`);
  const { data: funcs } = await qFuncs;
  if (!funcs?.length) return [];
  const nomes = funcs.map(f => f.nome_completo);

  // Batidas de ontem: ledger + ajustes já aprovados. Justificativa ainda
  // pendente e dia abonado também tiram a pessoa do lembrete.
  const [{ data: registros }, { data: ajustes }, { data: pendentes }, { data: abonos }] = await Promise.all([
    db.from('folha_ponto_whatsapp_registros').select('funcionario_nome, tipo_batida').eq('data_referencia', ontem).in('funcionario_nome', nomes),
    db.from('folha_ponto_whatsapp_ajustes').select('funcionario_nome, tipo_batida').eq('data_referencia', ontem).in('funcionario_nome', nomes),
    db.from('folha_ponto_whatsapp_solicitacoes').select('funcionario_nome, tipo_batida, tipo')
      .eq('data_referencia', ontem).eq('status', 'PENDENTE').in('funcionario_nome', nomes),
    db.from('folha_ponto_abono').select('funcionario_nome').eq('data_abono', ontem).in('funcionario_nome', nomes),
  ]);

  const feitas: Record<string, Set<string>> = {};
  [...(registros || []), ...(ajustes || [])].forEach(b => { (feitas[b.funcionario_nome] ||= new Set()).add(b.tipo_batida); });
  const abonados = new Set((abonos || []).map(a => a.funcionario_nome));
  const jaPedido = new Set((pendentes || []).map(p => `${p.funcionario_nome}|${p.tipo === 'ABONO_DIA' ? '*' : p.tipo_batida}`));

  const lista: DestinatarioLembretePonto[] = [];
  for (const f of funcs) {
    const fez = feitas[f.nome_completo];
    if (!fez || fez.size === 0 || abonados.has(f.nome_completo) || jaPedido.has(`${f.nome_completo}|*`)) continue;
    const par = PARES.find(([e, s]) => fez.has(e) !== fez.has(s));
    if (!par) continue; // dia sem par incompleto (2 ou 4 batidas certinhas)
    const faltante = fez.has(par[0]) ? par[1] : par[0];
    if (jaPedido.has(`${f.nome_completo}|${faltante}`)) continue;
    lista.push({
      nome_completo: f.nome_completo, celular: f.celular, empresa_id: f.empresa_id ?? null,
      vars: { batida: faltante.startsWith('ENTRADA') ? 'entrada' : 'saída', data: ontem.split('-').reverse().join('/') },
      dataReferencia: ontem, tipoBatida: faltante,
    });
  }
  return lista;
}

const somarDias = (iso: string, dias: number) => {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
};

// Quem não registrou NENHUMA batida ontem num dia em que deveria trabalhar.
// Filtros pra não virar spam (sem eles, ~20 dos ~40 do ponto WhatsApp caíam
// todo dia útil — medido em 2026-11-05):
//   - só contrato que desconta falta (folha_parametros.desconta_faltas, e não
//     só documental): é onde a falta pesa no holerite;
//   - "funcionário de escala" (alocado na Escala de Trabalho nos últimos 30
//     dias) só é cobrado se estava escalado ontem, inclusive fim de semana;
//     os demais, só em dia útil (seg–sex, fora feriado da empresa dele);
//   - fora quem estava de férias, afastado, com abono no dia, ou com qualquer
//     pedido pendente cobrindo ontem (justificativa, abono, folga);
//   - fora quem foi admitido depois de ontem.
export async function listarSemPontoOntem(db: Db, empresaId: number | null): Promise<DestinatarioLembretePonto[]> {
  const ontem = ontemBRT();
  const diaSemana = new Date(`${ontem}T12:00:00Z`).getUTCDay();

  let qFuncs = db.from('folha_funcionarios')
    .select('nome_completo, celular, empresa_id, tipo_contrato, data_admissao')
    .eq('ativo', true).eq('ponto_whatsapp_ativo', true).not('celular', 'is', null);
  if (empresaId) qFuncs = qFuncs.or(`empresa_id.is.null,empresa_id.eq.${empresaId}`);
  const [{ data: funcsTodos }, { data: regras }, { data: feriados }] = await Promise.all([
    qFuncs,
    db.from('folha_parametros').select('nome_regra, desconta_faltas, so_documental'),
    db.from('folha_feriados').select('*'),
  ]);
  const descontaFalta = new Set((regras || []).filter(r => r.desconta_faltas && !r.so_documental).map(r => r.nome_regra));
  const funcs = (funcsTodos || []).filter(f => descontaFalta.has(f.tipo_contrato) && !(f.data_admissao && f.data_admissao > ontem));
  if (funcs.length === 0) return [];
  const nomes = funcs.map(f => f.nome_completo);

  const [{ data: registros }, { data: ajustes }, { data: abonos }, { data: pendentes }, { data: ferias }, { data: afastamentos }, { data: escala }] = await Promise.all([
    db.from('folha_ponto_whatsapp_registros').select('funcionario_nome').eq('data_referencia', ontem).in('funcionario_nome', nomes),
    db.from('folha_ponto_whatsapp_ajustes').select('funcionario_nome').eq('data_referencia', ontem).in('funcionario_nome', nomes),
    db.from('folha_ponto_abono').select('funcionario_nome').eq('data_abono', ontem).in('funcionario_nome', nomes),
    db.from('folha_ponto_whatsapp_solicitacoes').select('funcionario_nome, data_referencia, data_referencia_fim')
      .eq('status', 'PENDENTE').lte('data_referencia', ontem).gte('data_referencia', somarDias(ontem, -31)).in('funcionario_nome', nomes),
    db.from('folha_ferias').select('funcionario_nome').eq('status', 'AGENDADA')
      .lte('data_inicio_gozo', ontem).gte('data_fim_gozo', ontem).in('funcionario_nome', nomes),
    db.from('folha_afastamentos').select('funcionario_nome, data_fim').eq('status', 'ATIVO')
      .lte('data_inicio', ontem).in('funcionario_nome', nomes),
    db.from('escala_alocacoes').select('funcionario_nome, data')
      .gte('data', somarDias(ontem, -30)).lte('data', ontem).in('funcionario_nome', nomes),
  ]);

  const fora = new Set<string>([
    ...(registros || []).map(r => r.funcionario_nome),   // bateu algo: é caso do lembrete de ponto incompleto
    ...(ajustes || []).map(r => r.funcionario_nome),
    ...(abonos || []).map(r => r.funcionario_nome),
    ...(ferias || []).map(r => r.funcionario_nome),
    ...(afastamentos || []).filter(a => !a.data_fim || a.data_fim >= ontem).map(r => r.funcionario_nome),
    ...(pendentes || []).filter(p => (p.data_referencia_fim || p.data_referencia) >= ontem).map(p => p.funcionario_nome),
  ]);
  const deEscala = new Set((escala || []).map(e => e.funcionario_nome));
  const escaladoOntem = new Set((escala || []).filter(e => e.data === ontem).map(e => e.funcionario_nome));
  const indiceFeriados = indexarFeriados(feriados);

  return funcs
    .filter(f => {
      if (fora.has(f.nome_completo)) return false;
      if (deEscala.has(f.nome_completo)) return escaladoOntem.has(f.nome_completo);
      const diaUtil = diaSemana >= 1 && diaSemana <= 5 && !feriadosDaEmpresa(indiceFeriados, f.empresa_id ?? null).has(ontem);
      return diaUtil;
    })
    .map(f => ({
      nome_completo: f.nome_completo, celular: f.celular, empresa_id: f.empresa_id ?? null,
      vars: { data: ontem.split('-').reverse().join('/') },
      dataReferencia: ontem,
    }));
}

// Funcionário no meio de outra conversa com o bot (pendência ainda válida):
// não manda o lembrete agora, pra não atropelar o que ele está fazendo.
export async function conversaAtivaComBot(db: Db, celular: string, funcionarioNome: string): Promise<boolean> {
  const { data } = await db.from('folha_ponto_whatsapp_pendencias')
    .select('expira_em').or(`celular.eq.${celular},funcionario_nome.eq."${funcionarioNome.replace(/"/g, '')}"`);
  return (data || []).some(p => new Date(p.expira_em).getTime() > Date.now());
}

// Depois do envio: deixa a conversa pronta pra resposta, válida até o fim do
// dia (o funcionário pode responder horas depois do lembrete).
export async function gravarConversaLembrete(db: Db, d: DestinatarioLembretePonto): Promise<void> {
  const fimDoDia = new Date(`${dataBRT(new Date())}T23:59:59-03:00`).toISOString();
  const { error } = await db.from('folha_ponto_whatsapp_pendencias').upsert({
    celular: d.celular,
    funcionario_nome: d.nome_completo,
    empresa_id: d.empresa_id,
    // Com batida faltando → justificar (só o horário); dia inteiro → abonar
    ...(d.tipoBatida
      ? { fluxo: 'JUSTIFICAR', etapa: 'INFORMAR_HORARIO', contexto: { data_referencia: d.dataReferencia, tipo_batida: d.tipoBatida, origem: 'LEMBRETE' } }
      : { fluxo: 'ABONAR', etapa: 'INFORMAR_MOTIVO', contexto: { data_referencia: d.dataReferencia, origem: 'LEMBRETE' } }),
    expira_em: fimDoDia,
  });
  if (error) throw new Error(`Falha ao gravar a conversa do lembrete de ${d.nome_completo}: ${error.message}`);
}
