'use server';

// app/admin/operacional/actions/actions-multas.ts
// Gerenciamento de Multas e Débitos (/admin/operacional/multas).
//
// - Consulta automática por veículo (placa + Renavam) via
//   app/lib/consultaDebitosVeiculares.ts (hoje: Infosimples DETRAN/SP).
// - Cada débito vira uma linha em frota_multas_debitos, deduplicada por
//   (veiculo_id, chave_externa). O que estava ABERTO e sumiu de uma consulta
//   completa leva baixa automática (o Detran só lista débito em aberto).
// - Multa: condutor sugerido pelo Checklist de Veículos (frota_checklists)
//   da data/hora da infração; confirmado, permite lançar desconto parcelado
//   em folha_descontos (aparece no Holerite) e/ou gerar a OP de pagamento.
//
// Tudo com supabaseAdmin (service role, ignora RLS) — o isolamento por
// empresa é o obterEmpresasPermitidas/empresaPermitida explícito em cada
// action, como no resto do sistema.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { provedorConfigurado, validadeCertificadoA1, prefeituraSpConfigurada, consultarBoletosPrefeituraSP, consultarPenalidadesDerSP } from '../../../lib/consultaDebitosVeiculares';
import { normalizarBoleto, formatarLinhaDigitavel } from '../../../lib/boletoMulta';
import { executarConsultaVeiculo, vincularNics, enviarAvisoCondutor, atualizarPrazosSenatran, sincronizarPagamentoOps } from '../../../lib/multasCore';
import { lerNotificacaoMulta, leituraConfigurada, custoLeituraUsd } from '../../../lib/leituraNotificacaoMulta';
import { extrairTextoNativoPdf } from '../../../lib/textract';

const ROTA = '/admin/operacional/multas';
// "Criar OP" abre /admin/op/nova?multaIds=... — quem está na tela da OP
// precisa conseguir carregar os dados do débito (regra: acesso à página
// libera os botões dela).
const ROTAS_DADOS_PAGAMENTO = [ROTA, '/admin/op/nova'];

type Resultado = { ok: boolean; erro?: string; info?: any };

export type StatusDebito = 'ABERTO' | 'PAGO' | 'CANCELADO';
export type TipoDebitoMulta = 'MULTA' | 'IPVA' | 'LICENCIAMENTO' | 'OUTRO';

export interface VeiculoMultas {
  id: string; apelido: string; placa: string; renavam: string | null; tipo: string | null;
  empresa_id: number | null; propriedade: string | null; status: string | null; exibir_na_frota: boolean | null;
  ultima_consulta: { consultado_em: string; status: 'OK' | 'ERRO'; mensagem: string | null; consultado_por: string | null } | null;
  // Da última consulta OK (dados que o Detran já devolve junto dos débitos).
  situacao: {
    consultado_em: string; restricao_administrativa: string | null; restricao_financeira: string | null;
    restricao_judiciaria: string | null; restricao_tributaria: string | null; bloqueio_furto: string | null;
    ultimo_licenciamento: string | null; status_licenciamento: string | null;
  } | null;
}

export interface DebitoMulta {
  id: string; empresa_id: number | null; veiculo_id: string;
  tipo: TipoDebitoMulta; origem: 'CONSULTA_API' | 'MANUAL'; fonte: string | null;
  descricao: string | null; auto_infracao: string | null; orgao_autuador: string | null;
  data_infracao: string | null; hora_infracao: string | null; local_infracao: string | null; municipio: string | null;
  exercicio: string | null; cota: string | null;
  valor: number; data_vencimento: string | null;
  status: StatusDebito; baixa_automatica: boolean; pago_em: string | null; status_alterado_por: string | null;
  condutor_nome: string | null; condutor_checklist_id: string | null; condutor_confirmado_em: string | null; condutor_confirmado_por: string | null;
  desconto_descricao: string | null; desconto_parcelas: number | null; desconto_mes_inicio: string | null;
  desconto_valor_parcela: number | null; desconto_lancado_em: string | null; desconto_lancado_por: string | null;
  observacao: string | null; primeira_consulta_em: string | null; ultima_consulta_em: string | null;
  criado_por: string | null; created_at: string; updated_at: string;
  eh_nic: boolean; multa_origem_id: string | null; condutor_avisado_em: string | null; condutor_avisado_por: string | null;
  prazo_indicacao_condutor: string | null; condutor_indicado_em: string | null; condutor_indicado_por: string | null;
  notificacao_url: string | null; codigo_infracao: string | null;
  codigo_barras: string | null; linha_digitavel: string | null; boleto_url: string | null;
  boleto_fonte: string | null; boleto_atualizado_em: string | null;
  prazo_defesa: string | null; recurso_status: 'PROTOCOLADO' | 'DEFERIDO' | 'INDEFERIDO' | null; recurso_protocolo: string | null;
  recurso_atualizado_em: string | null; recurso_atualizado_por: string | null;
  op: { id: string; numero_op: number | null; status: string | null; pago_em: string | null } | null;
}

export interface ConsultaMulta {
  id: string; veiculo_id: string | null; status: 'OK' | 'ERRO'; codigo: number | null; mensagem: string | null;
  encontrados: number; novos: number; baixados: number; valor_total: number | null; preco: number | null;
  site_receipt: string | null; consultado_por: string | null; consultado_em: string;
  provedor: string | null; servico: string | null;
}

const COLUNAS_DEBITO = 'id, empresa_id, veiculo_id, tipo, origem, fonte, descricao, auto_infracao, orgao_autuador, data_infracao, hora_infracao, local_infracao, municipio, exercicio, cota, valor, data_vencimento, status, baixa_automatica, pago_em, status_alterado_por, condutor_nome, condutor_checklist_id, condutor_confirmado_em, condutor_confirmado_por, desconto_descricao, desconto_parcelas, desconto_mes_inicio, desconto_valor_parcela, desconto_lancado_em, desconto_lancado_por, observacao, primeira_consulta_em, ultima_consulta_em, criado_por, created_at, updated_at, eh_nic, multa_origem_id, condutor_avisado_em, condutor_avisado_por, prazo_indicacao_condutor, condutor_indicado_em, condutor_indicado_por, notificacao_url, codigo_infracao, codigo_barras, linha_digitavel, boleto_url, boleto_fonte, boleto_atualizado_em, prazo_defesa, recurso_status, recurso_protocolo, recurso_atualizado_em, recurso_atualizado_por';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function autorizar(accessToken: string, rotas: string[] = [ROTA]) {
  const acesso = await validarAcessoAlgumaRota(accessToken, rotas);
  if (!acesso.ok) return { ok: false as const, erro: acesso.message };
  const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { ok: true as const, perfil: acesso.perfil, empresasPermitidas };
}

// Carrega o débito e confere a empresa — barra IDOR (id de outra empresa).
async function carregarDebitoAutorizado(db: ReturnType<typeof supabaseAdmin>, id: string, empresasPermitidas: number[] | null) {
  const { data, error } = await db.from('frota_multas_debitos').select(COLUNAS_DEBITO).eq('id', id).maybeSingle();
  if (error) return { ok: false as const, erro: error.message };
  if (!data) return { ok: false as const, erro: 'Débito não encontrado.' };
  if (!empresaPermitida(empresasPermitidas, data.empresa_id)) return { ok: false as const, erro: 'Você não tem acesso a este débito.' };
  return { ok: true as const, debito: data as unknown as Omit<DebitoMulta, 'op'> };
}

const filtrarEmpresa = <T,>(q: T, empresasPermitidas: number[] | null): T => {
  if (!empresasPermitidas) return q;
  return (q as any).or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
};

const mesAtual = () => {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
};

// Mesmas contas de folha_descontos usadas em rh/holerite/page.tsx.
const calcularMesFim = (mesInicio: string, parcelas: number): string => {
  if (!mesInicio || parcelas < 1) return mesInicio;
  const [ano, mes] = mesInicio.split('-').map(Number);
  const dataFim = new Date(ano, (mes - 1) + (parcelas - 1), 1);
  return `${dataFim.getFullYear()}-${String(dataFim.getMonth() + 1).padStart(2, '0')}`;
};

const fmtBRL = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// Painel (veículos + débitos + últimas consultas)
// ---------------------------------------------------------------------------
export async function carregarPainelMultasAction(accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();

  try {
    // Liga NICs antigas/manuais à infração de origem antes de listar (barato:
    // só lê as multas e grava o que faltar).
    await vincularNics(db, null);
    // OP paga pelo Financeiro → multa paga na hora (sem esperar o Detran).
    await sincronizarPagamentoOps(db);

    const [veiculosRes, debitosRes, consultasRes, empresasRes, situacaoRes, certificado] = await Promise.all([
      filtrarEmpresa(db.from('frota_veiculos')
        .select('id, apelido, placa, renavam, tipo, empresa_id, propriedade, status, exibir_na_frota')
        .order('apelido'), auth.empresasPermitidas),
      filtrarEmpresa(db.from('frota_multas_debitos').select(COLUNAS_DEBITO)
        .order('data_vencimento', { ascending: true, nullsFirst: false }), auth.empresasPermitidas),
      filtrarEmpresa(db.from('frota_multas_consultas')
        .select('id, veiculo_id, status, codigo, mensagem, encontrados, novos, baixados, valor_total, preco, site_receipt, consultado_por, consultado_em, provedor, servico')
        .order('consultado_em', { ascending: false }).limit(200), auth.empresasPermitidas),
      db.from('empresas').select('id, nome').eq('ativo', true).order('nome'),
      filtrarEmpresa(db.from('frota_multas_consultas')
        .select('veiculo_id, consultado_em, restricao_administrativa:resposta->data->0->>restricao_administrativa, restricao_financeira:resposta->data->0->>restricao_financeira, restricao_judiciaria:resposta->data->0->>restricao_judiciaria, restricao_tributaria:resposta->data->0->>restricao_tributaria, bloqueio_furto:resposta->data->0->>bloqueio_furto, ultimo_licenciamento:resposta->data->0->>ultimo_licenciamento, status_licenciamento:resposta->data->0->>status_licenciamento')
        .eq('status', 'OK').eq('servico', 'detran/sp/debitos').order('consultado_em', { ascending: false }).limit(100), auth.empresasPermitidas),
      validadeCertificadoA1(),
    ]);
    if (veiculosRes.error) throw new Error(veiculosRes.error.message);
    if (debitosRes.error) throw new Error(debitosRes.error.message);
    if (consultasRes.error) throw new Error(consultasRes.error.message);

    const consultas = (consultasRes.data || []) as ConsultaMulta[];
    const ultimaPorVeiculo = new Map<string, ConsultaMulta>();
    // "Última consulta" do card = a do Detran (o log tem também Senatran, boleto e leituras por IA).
    consultas.filter(c => c.servico === 'detran/sp/debitos')
      .forEach(c => { if (c.veiculo_id && !ultimaPorVeiculo.has(c.veiculo_id)) ultimaPorVeiculo.set(c.veiculo_id, c); });

    const situacaoPorVeiculo = new Map<string, NonNullable<VeiculoMultas['situacao']>>();
    ((situacaoRes.data || []) as unknown as (NonNullable<VeiculoMultas['situacao']> & { veiculo_id: string })[])
      .forEach(s => { if (!situacaoPorVeiculo.has(s.veiculo_id)) situacaoPorVeiculo.set(s.veiculo_id, s); });

    const veiculos: VeiculoMultas[] = (veiculosRes.data || [])
      .filter((v: any) => v.status !== 'INATIVO')
      .map((v: any) => {
        const u = ultimaPorVeiculo.get(v.id);
        return {
          ...v,
          ultima_consulta: u ? { consultado_em: u.consultado_em, status: u.status, mensagem: u.mensagem, consultado_por: u.consultado_por } : null,
          situacao: situacaoPorVeiculo.get(v.id) || null,
        };
      });

    // OP vinculada (a mais recente não reprovada; se só houver reprovada, mostra ela)
    const debitosBase = (debitosRes.data || []) as unknown as Omit<DebitoMulta, 'op'>[];
    const ids = debitosBase.map(d => d.id);
    const opPorDebito = new Map<string, DebitoMulta['op']>();
    if (ids.length) {
      const { data: ops } = await db.from('op_ordens_pagamento')
        .select('id, numero_op, status, pago_em, multa_debito_ids, data_criacao')
        .overlaps('multa_debito_ids', ids)
        .order('data_criacao', { ascending: false });
      ((ops || []) as { id: string; numero_op: number | null; status: string | null; pago_em: string | null; multa_debito_ids: string[] | null }[]).forEach(o => {
        (o.multa_debito_ids || []).forEach(debitoId => {
          const atual = opPorDebito.get(debitoId);
          if (!atual || (atual.status === 'REPROVADA' && o.status !== 'REPROVADA')) {
            opPorDebito.set(debitoId, { id: o.id, numero_op: o.numero_op, status: o.status, pago_em: o.pago_em });
          }
        });
      });
    }
    const debitos: DebitoMulta[] = debitosBase.map(d => ({ ...d, valor: Number(d.valor) || 0, op: opPorDebito.get(d.id) || null }));

    const empresas = ((empresasRes.data || []) as { id: number; nome: string }[])
      .filter(e => !auth.empresasPermitidas || auth.empresasPermitidas.includes(e.id));

    return { ok: true, info: { veiculos, debitos, consultas, empresas, provedorConfigurado: provedorConfigurado(), certificado, leituraConfigurada: leituraConfigurada(), prefeituraSpConfigurada: prefeituraSpConfigurada() } };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Consulta automática de um veículo
// ---------------------------------------------------------------------------
export async function consultarDebitosVeiculoAction(params: { veiculoId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const usuario = auth.perfil.nome.toUpperCase();

  const { data: veiculo } = await db.from('frota_veiculos')
    .select('id, apelido, placa, renavam, empresa_id, propriedade').eq('id', params.veiculoId).maybeSingle();
  if (!veiculo) return { ok: false, erro: 'Veículo não encontrado.' };
  if (!empresaPermitida(auth.empresasPermitidas, veiculo.empresa_id)) return { ok: false, erro: 'Você não tem acesso a este veículo.' };

  const r = await executarConsultaVeiculo(db, veiculo, usuario);
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, info: { encontrados: r.encontrados, novos: r.novos, baixados: r.baixados, valorTotal: r.valorTotal, avisos: r.avisos, preco: r.preco } };
}

// ---------------------------------------------------------------------------
// Condutor: sugestão pelo Checklist de Veículos
// ---------------------------------------------------------------------------
export async function sugerirCondutorAction(params: { debitoId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();

  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const d = r.debito;

  try {
    // Motoristas possíveis (lista para escolha manual): ativos da empresa do
    // veículo, quem tem "pode dirigir" primeiro.
    let qFunc = db.from('folha_funcionarios').select('nome_completo, pode_dirigir, empresa_id').eq('ativo', true).order('nome_completo');
    if (d.empresa_id) qFunc = qFunc.eq('empresa_id', d.empresa_id);
    else if (auth.empresasPermitidas) qFunc = qFunc.in('empresa_id', auth.empresasPermitidas);
    const { data: funcs } = await qFunc;
    const motoristas = ((funcs || []) as { nome_completo: string; pode_dirigir: boolean | null }[])
      .sort((a, b) => Number(!!b.pode_dirigir) - Number(!!a.pode_dirigir) || a.nome_completo.localeCompare(b.nome_completo))
      .map(f => ({ nome: f.nome_completo, pode_dirigir: !!f.pode_dirigir }));

    const candidatos: { checklist_id: string | null; numero: number | null; motorista_nome: string; saida_em: string | null; retorno_em: string | null; destino: string | null; precisao: 'ORIGEM' | 'HORARIO' | 'DIA' }[] = [];

    // NIC: quem dirigia é o da infração ORIGINAL — a data da NIC é só o fim
    // do prazo de indicação. Usa o condutor já confirmado na original e, se
    // não houver, procura no checklist pela data/hora da original.
    let referencia: { data_infracao: string | null; hora_infracao: string | null } = d;
    let origem: { id: string; auto_infracao: string | null; data_infracao: string | null; hora_infracao: string | null; condutor_nome: string | null; checklist_id: string | null } | null = null;
    if (d.eh_nic && d.multa_origem_id) {
      const { data: o } = await db.from('frota_multas_debitos')
        .select('id, auto_infracao, data_infracao, hora_infracao, condutor_nome, condutor_checklist_id').eq('id', d.multa_origem_id).maybeSingle();
      if (o) {
        origem = { id: o.id, auto_infracao: o.auto_infracao, data_infracao: o.data_infracao, hora_infracao: o.hora_infracao, condutor_nome: o.condutor_nome, checklist_id: o.condutor_checklist_id };
        referencia = o;
        if (o.condutor_nome) candidatos.push({ checklist_id: o.condutor_checklist_id, numero: null, motorista_nome: o.condutor_nome, saida_em: null, retorno_em: null, destino: null, precisao: 'ORIGEM' });
      }
    }

    if (referencia.data_infracao && !(origem?.condutor_nome)) {
      const dataRef = referencia.data_infracao;
      // "00:00:00" é como o Detran devolve multa sem hora (ex.: NIC — não
      // identificação do condutor, visto em 2026-11-10) → busca pelo dia todo.
      const hora = /^00:00(:00)?$/.test(referencia.hora_infracao || '') ? null : (referencia.hora_infracao || '').match(/^(\d{2}):(\d{2})/);
      const instante = hora ? new Date(`${dataRef}T${hora[1]}:${hora[2]}:00-03:00`) : null;
      const inicioDia = new Date(`${dataRef}T00:00:00-03:00`);
      const fimDia = new Date(`${dataRef}T23:59:59-03:00`);

      // Saídas de até 7 dias antes (viagens longas) até o fim do dia da infração.
      const janelaIni = new Date(inicioDia.getTime() - 7 * 86400000).toISOString();
      const { data: cks } = await db.from('frota_checklists')
        .select('id, numero, motorista_nome, saida_em, retorno_em, destino, status')
        .eq('veiculo_id', d.veiculo_id)
        .gte('saida_em', janelaIni).lte('saida_em', fimDia.toISOString())
        .order('saida_em', { ascending: false });

      (cks || []).forEach((c: any) => {
        const saida = new Date(c.saida_em);
        // Sem retorno: considera aberto por no máximo 3 dias (checklist esquecido não "cobre" a semana toda).
        const retorno = c.retorno_em ? new Date(c.retorno_em) : new Date(saida.getTime() + 3 * 86400000);
        if (instante && saida <= instante && instante <= retorno) {
          candidatos.push({ checklist_id: c.id, numero: c.numero, motorista_nome: c.motorista_nome, saida_em: c.saida_em, retorno_em: c.retorno_em, destino: c.destino, precisao: 'HORARIO' });
        } else if (saida <= fimDia && retorno >= inicioDia) {
          candidatos.push({ checklist_id: c.id, numero: c.numero, motorista_nome: c.motorista_nome, saida_em: c.saida_em, retorno_em: c.retorno_em, destino: c.destino, precisao: 'DIA' });
        }
      });
      candidatos.sort((a, b) => (a.precisao === b.precisao ? 0 : a.precisao === 'HORARIO' ? -1 : 1));
    }

    return { ok: true, info: { candidatos, motoristas, origem } };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export async function definirCondutorAction(params: { debitoId: string; condutorNome: string | null; checklistId: string | null }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const usuario = auth.perfil.nome.toUpperCase();

  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  if (r.debito.tipo !== 'MULTA') return { ok: false, erro: 'Condutor só se aplica a multa.' };
  if (r.debito.desconto_lancado_em) return { ok: false, erro: 'O desconto em folha já foi lançado para este condutor — ajuste/exclua o desconto no Holerite antes de trocar o condutor.' };

  const nome = params.condutorNome?.trim() || null;
  if (nome) {
    const { data: func } = await db.from('folha_funcionarios').select('nome_completo, empresa_id').eq('nome_completo', nome).maybeSingle();
    if (!func) return { ok: false, erro: 'Colaborador não encontrado no cadastro de funcionários.' };
    if (!empresaPermitida(auth.empresasPermitidas, func.empresa_id)) return { ok: false, erro: 'Você não tem acesso a este colaborador.' };
  }

  const { error } = await db.from('frota_multas_debitos').update({
    condutor_nome: nome,
    condutor_checklist_id: nome ? params.checklistId : null,
    condutor_confirmado_em: nome ? new Date().toISOString() : null,
    condutor_confirmado_por: nome ? usuario : null,
    updated_at: new Date().toISOString(),
  }).eq('id', params.debitoId);
  if (error) return { ok: false, erro: error.message };

  registrarLogAuditoria({
    usuario_nome: usuario, acao: nome ? 'DEFINIU CONDUTOR DA MULTA' : 'REMOVEU CONDUTOR DA MULTA', setor: 'OPERACIONAL',
    equipamento_id: params.debitoId, equipamento_nome: `AIT ${r.debito.auto_infracao || 'S/N'}${nome ? ` — ${nome}` : ''}`,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Desconto em folha (folha_descontos → aparece no Holerite)
// ---------------------------------------------------------------------------
export async function lancarDescontoFolhaAction(params: { debitoId: string; parcelas: number; mesInicio: string; valorTotal: number }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const usuario = auth.perfil.nome.toUpperCase();

  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const d = r.debito;

  if (d.tipo !== 'MULTA') return { ok: false, erro: 'Desconto em folha só se aplica a multa.' };
  if (!d.condutor_nome) return { ok: false, erro: 'Confirme o condutor antes de lançar o desconto.' };
  if (d.desconto_lancado_em) return { ok: false, erro: `Desconto já lançado em ${new Date(d.desconto_lancado_em).toLocaleDateString('pt-BR')} por ${d.desconto_lancado_por}.` };
  if (d.status === 'CANCELADO') return { ok: false, erro: 'Débito cancelado — reabra antes de lançar desconto.' };

  const parcelas = Math.floor(Number(params.parcelas));
  const valorTotal = Math.round(Number(params.valorTotal) * 100) / 100;
  if (!(parcelas >= 1 && parcelas <= 24)) return { ok: false, erro: 'Número de parcelas deve ser entre 1 e 24.' };
  if (!/^\d{4}-\d{2}$/.test(params.mesInicio)) return { ok: false, erro: 'Informe o mês de início (AAAA-MM).' };
  if (params.mesInicio < mesAtual()) return { ok: false, erro: 'O mês de início não pode ser anterior ao mês atual.' };
  if (!(valorTotal > 0)) return { ok: false, erro: 'Informe o valor a descontar.' };

  const { data: func } = await db.from('folha_funcionarios').select('nome_completo, empresa_id, ativo').eq('nome_completo', d.condutor_nome).maybeSingle();
  if (!func) return { ok: false, erro: 'Condutor não encontrado no cadastro de funcionários.' };
  if (!empresaPermitida(auth.empresasPermitidas, func.empresa_id)) return { ok: false, erro: 'Você não tem acesso a este colaborador.' };
  if (!func.ativo) return { ok: false, erro: 'O condutor está inativo — o desconto teria que entrar na rescisão.' };

  const { data: veic } = await db.from('frota_veiculos').select('placa').eq('id', d.veiculo_id).maybeSingle();
  const valorParcela = Math.round((valorTotal / parcelas) * 100) / 100;
  const descricao = `MULTA AIT ${d.auto_infracao || 'S/N'}${veic?.placa ? ` - ${veic.placa}` : ''}`.toUpperCase().slice(0, 120);

  const { error: insErr } = await db.from('folha_descontos').insert([{
    funcionario_nome: d.condutor_nome, descricao, tipo: 'PARCELADO', parcelas,
    mes_inicio: params.mesInicio, mes_fim: calcularMesFim(params.mesInicio, parcelas), valor_parcela: valorParcela,
  }]);
  if (insErr) return { ok: false, erro: `Falha ao gravar o desconto: ${insErr.message}` };

  const { error } = await db.from('frota_multas_debitos').update({
    desconto_descricao: descricao, desconto_parcelas: parcelas, desconto_mes_inicio: params.mesInicio,
    desconto_valor_parcela: valorParcela, desconto_lancado_em: new Date().toISOString(), desconto_lancado_por: usuario,
    updated_at: new Date().toISOString(),
  }).eq('id', d.id);
  if (error) return { ok: false, erro: `Desconto gravado no Holerite, mas falhou ao marcar na multa: ${error.message}` };

  registrarLogAuditoria({
    usuario_nome: usuario, acao: 'LANÇOU DESCONTO DE MULTA EM FOLHA', setor: 'OPERACIONAL',
    equipamento_id: d.id, equipamento_nome: `${d.condutor_nome} — ${descricao} — ${parcelas}x ${fmtBRL(valorParcela)} a partir de ${params.mesInicio}`,
  });

  // Aviso automático ao condutor (WhatsApp). Falha aqui não desfaz o
  // desconto — só volta como aviso pra tela.
  const aviso = await enviarAvisoCondutor(db, d.id, usuario);
  return { ok: true, info: { valorParcela, descricao, avisoEnviado: aviso.ok, avisoErro: aviso.erro || null } };
}

export async function avisarCondutorAction(params: { debitoId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const res = await enviarAvisoCondutor(db, params.debitoId, auth.perfil.nome.toUpperCase());
  return res.ok ? { ok: true } : { ok: false, erro: res.erro };
}

// ---------------------------------------------------------------------------
// Status (pago / cancelado / reabrir) e observação
// ---------------------------------------------------------------------------
export async function atualizarStatusDebitoAction(params: { debitoId: string; status: StatusDebito; observacao?: string | null }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const usuario = auth.perfil.nome.toUpperCase();

  if (!['ABERTO', 'PAGO', 'CANCELADO'].includes(params.status)) return { ok: false, erro: 'Status inválido.' };
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };

  const agora = new Date().toISOString();
  const { error } = await db.from('frota_multas_debitos').update({
    status: params.status,
    baixa_automatica: false,
    pago_em: params.status === 'PAGO' ? agora : null,
    status_alterado_por: usuario,
    ...(params.observacao !== undefined ? { observacao: params.observacao?.trim() || null } : {}),
    updated_at: agora,
  }).eq('id', params.debitoId);
  if (error) return { ok: false, erro: error.message };

  registrarLogAuditoria({
    usuario_nome: usuario, acao: `MARCOU DÉBITO COMO ${params.status}`, setor: 'OPERACIONAL',
    equipamento_id: params.debitoId, equipamento_nome: `${r.debito.tipo} ${r.debito.auto_infracao || r.debito.descricao || ''} — ${fmtBRL(Number(r.debito.valor))}`.trim(),
  });
  return { ok: true };
}

export async function salvarObservacaoDebitoAction(params: { debitoId: string; observacao: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const { error } = await db.from('frota_multas_debitos')
    .update({ observacao: params.observacao.trim() || null, updated_at: new Date().toISOString() }).eq('id', params.debitoId);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

// ---------------------------------------------------------------------------
// Lançamento manual (multa de outro estado, notificação ainda não no Detran…)
// ---------------------------------------------------------------------------
export async function salvarDebitoManualAction(params: {
  id?: string | null; veiculoId: string; tipo: TipoDebitoMulta; descricao: string; autoInfracao?: string | null;
  orgaoAutuador?: string | null; dataInfracao?: string | null; horaInfracao?: string | null; localInfracao?: string | null;
  valor: number; dataVencimento?: string | null; observacao?: string | null;
  prazoIndicacaoCondutor?: string | null; notificacaoUrl?: string | null; codigoInfracao?: string | null;
  linhaDigitavel?: string | null; boletoFonte?: 'ESCANEADO' | 'MANUAL' | null;
}, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const usuario = auth.perfil.nome.toUpperCase();

  if (!['MULTA', 'IPVA', 'LICENCIAMENTO', 'OUTRO'].includes(params.tipo)) return { ok: false, erro: 'Tipo inválido.' };
  const valor = Math.round(Number(params.valor) * 100) / 100;
  if (!(valor > 0)) return { ok: false, erro: 'Informe o valor.' };
  if (!params.descricao?.trim() && !params.autoInfracao?.trim()) return { ok: false, erro: 'Informe a descrição ou o nº do auto de infração.' };

  const { data: veiculo } = await db.from('frota_veiculos').select('id, empresa_id, apelido, placa').eq('id', params.veiculoId).maybeSingle();
  if (!veiculo) return { ok: false, erro: 'Veículo não encontrado.' };
  if (!empresaPermitida(auth.empresasPermitidas, veiculo.empresa_id)) return { ok: false, erro: 'Você não tem acesso a este veículo.' };

  const auto = params.autoInfracao?.trim().toUpperCase() || null;
  const campos = {
    empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id, tipo: params.tipo,
    descricao: params.descricao?.trim() || null, auto_infracao: auto,
    orgao_autuador: params.orgaoAutuador?.trim() || null,
    data_infracao: params.dataInfracao || null, hora_infracao: params.horaInfracao || null,
    local_infracao: params.localInfracao?.trim() || null,
    valor, data_vencimento: params.dataVencimento || null,
    observacao: params.observacao?.trim() || null,
    prazo_indicacao_condutor: params.prazoIndicacaoCondutor || null,
    codigo_infracao: params.codigoInfracao?.trim() || null,
    ...(params.notificacaoUrl ? { notificacao_url: params.notificacaoUrl } : {}),
    ...camposBoleto(params.linhaDigitavel, params.boletoFonte || 'MANUAL'),
    updated_at: new Date().toISOString(),
  };

  if (params.id) {
    const r = await carregarDebitoAutorizado(db, params.id, auth.empresasPermitidas);
    if (!r.ok) return { ok: false, erro: r.erro };
    if (r.debito.origem !== 'MANUAL') return { ok: false, erro: 'Só lançamentos manuais podem ser editados (os da consulta são atualizados pelo Detran).' };
    const { error } = await db.from('frota_multas_debitos').update(campos).eq('id', params.id);
    if (error) return { ok: false, erro: error.message };
  } else {
    // Mesmo AIT já veio pela consulta? Evita duplicar a multa.
    if (auto) {
      const { data: dup } = await db.from('frota_multas_debitos').select('id').eq('veiculo_id', veiculo.id).eq('auto_infracao', auto).limit(1).maybeSingle();
      if (dup) return { ok: false, erro: `O auto de infração ${auto} já está cadastrado para este veículo.` };
    }
    const { error } = await db.from('frota_multas_debitos').insert([{
      ...campos, origem: 'MANUAL', fonte: 'MANUAL', chave_externa: `MANUAL:${crypto.randomUUID()}`,
      status: 'ABERTO', criado_por: usuario,
    }]);
    if (error) return { ok: false, erro: error.message };
  }

  registrarLogAuditoria({
    usuario_nome: usuario, acao: params.id ? 'EDITOU DÉBITO MANUAL' : 'LANÇOU DÉBITO MANUAL', setor: 'OPERACIONAL',
    equipamento_id: veiculo.id, equipamento_nome: `${veiculo.apelido} (${veiculo.placa}) — ${params.tipo} ${auto || ''} ${fmtBRL(valor)}`,
  });
  return { ok: true };
}

export async function excluirDebitoManualAction(params: { debitoId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  if (r.debito.origem !== 'MANUAL') return { ok: false, erro: 'Débito da consulta não pode ser excluído — use "Cancelar".' };
  if (r.debito.desconto_lancado_em) return { ok: false, erro: 'Já tem desconto lançado em folha — use "Cancelar" e ajuste o desconto no Holerite.' };

  const { count } = await db.from('op_ordens_pagamento').select('id', { count: 'exact', head: true }).contains('multa_debito_ids', [params.debitoId]);
  if (count) return { ok: false, erro: 'Já existe OP ligada a este débito — use "Cancelar".' };

  const { error } = await db.from('frota_multas_debitos').delete().eq('id', params.debitoId);
  if (error) return { ok: false, erro: error.message };
  registrarLogAuditoria({
    usuario_nome: auth.perfil.nome.toUpperCase(), acao: 'EXCLUIU DÉBITO MANUAL', setor: 'OPERACIONAL',
    equipamento_id: params.debitoId, equipamento_nome: `${r.debito.tipo} ${r.debito.auto_infracao || r.debito.descricao || ''}`.trim(),
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pré-preenchimento da OP (/admin/op/nova?multaIds=id1,id2,...)
// Uma OP pode pagar várias multas/débitos da MESMA empresa — um item por
// débito; a linha digitável de cada boleto o usuário cola em "dados de
// pagamento". Vínculo gravado em op_ordens_pagamento.multa_debito_ids.
// ---------------------------------------------------------------------------
export async function obterDadosPagamentoMultaAction(params: { ids: string[] }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken, ROTAS_DADOS_PAGAMENTO);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();

  const ids = Array.from(new Set((params.ids || []).filter(Boolean)));
  if (ids.length === 0) return { ok: false, erro: 'Nenhuma multa/débito selecionado.' };
  if (ids.length > 50) return { ok: false, erro: 'Selecione no máximo 50 débitos por OP.' };

  const debitos: Omit<DebitoMulta, 'op'>[] = [];
  for (const id of ids) {
    const r = await carregarDebitoAutorizado(db, id, auth.empresasPermitidas);
    if (!r.ok) return { ok: false, erro: r.erro };
    if (r.debito.status !== 'ABERTO') {
      return { ok: false, erro: `Este débito está ${r.debito.status === 'PAGO' ? 'pago' : 'cancelado'} (${r.debito.auto_infracao || r.debito.descricao || r.debito.tipo}) — não dá pra gerar OP.` };
    }
    debitos.push(r.debito);
  }

  const empresasDistintas = new Set(debitos.map(d => d.empresa_id ?? 'null'));
  if (empresasDistintas.size > 1) return { ok: false, erro: 'Os débitos selecionados são de empresas diferentes — gere uma OP por empresa.' };

  const { data: opExistente } = await db.from('op_ordens_pagamento')
    .select('numero_op, status').overlaps('multa_debito_ids', ids).neq('status', 'REPROVADA').limit(1).maybeSingle();
  if (opExistente) return { ok: false, erro: `Já existe a OP #${opExistente.numero_op} (${opExistente.status}) para ${ids.length > 1 ? 'algum dos débitos selecionados' : 'este débito'}. Reprove-a antes de criar uma nova.` };

  const veiculoIds = Array.from(new Set(debitos.map(d => d.veiculo_id)));
  const { data: veics } = await db.from('frota_veiculos').select('id, apelido, placa, renavam').in('id', veiculoIds);
  const veicPorId = new Map(((veics || []) as { id: string; apelido: string; placa: string; renavam: string | null }[]).map(v => [v.id, v]));

  const orgaoDe = (d: Omit<DebitoMulta, 'op'>) => (d.orgao_autuador || (d.tipo === 'IPVA' ? 'SEFAZ-SP' : 'DETRAN-SP')).toUpperCase();
  const orgaos = Array.from(new Set(debitos.map(orgaoDe)));
  const favorecido = orgaos.length === 1 ? orgaos[0] : 'DIVERSOS ÓRGÃOS DE TRÂNSITO';

  const itens = debitos.map(d => {
    const v = veicPorId.get(d.veiculo_id);
    const rotulo = d.tipo === 'MULTA' ? `MULTA AIT ${d.auto_infracao || 'S/N'}${d.eh_nic ? ' (NÃO IDENT. CONDUTOR)' : ''}` : (d.descricao || d.tipo);
    return { descricao: `${rotulo}${v?.placa ? ` - ${v.placa}` : ''}${orgaos.length > 1 ? ` - ${orgaoDe(d)}` : ''}`.toUpperCase(), valor: Number(d.valor) || 0 };
  });

  const vencimentos = debitos.map(d => d.data_vencimento).filter((x): x is string => !!x).sort();

  // Dados de pagamento (tipo BOLETO): linha digitável de cada débito que já tem boleto.
  const comBoleto = debitos.filter(d => d.linha_digitavel);
  const dadosPagamento = debitos.length === 1
    ? formatarLinhaDigitavel(debitos[0].linha_digitavel)
    : comBoleto.map(d => `AIT ${d.auto_infracao || d.descricao || d.tipo}: ${formatarLinhaDigitavel(d.linha_digitavel)}`).join(' | ');
  const boletosUrls = debitos.map(d => d.boleto_url).filter((u): u is string => !!u);
  const semBoleto = debitos.length - comBoleto.length;

  let observacao: string;
  if (debitos.length === 1) {
    const d = debitos[0];
    const v = veicPorId.get(d.veiculo_id);
    observacao = [
      `REFERENTE A ${d.tipo === 'MULTA' ? 'MULTA DE TRÂNSITO' : d.tipo}`,
      v ? `VEÍCULO ${v.apelido} — PLACA ${v.placa}${v.renavam ? ` — RENAVAM ${v.renavam}` : ''}` : null,
      d.auto_infracao ? `AIT ${d.auto_infracao}` : null,
      d.data_infracao ? `INFRAÇÃO EM ${d.data_infracao.split('-').reverse().join('/')}${d.hora_infracao && !/^00:00/.test(d.hora_infracao) ? ` ${d.hora_infracao.slice(0, 5)}` : ''}` : null,
      d.condutor_nome ? `CONDUTOR: ${d.condutor_nome}` : null,
      d.desconto_lancado_em ? `DESCONTO EM FOLHA: ${d.desconto_parcelas}x a partir de ${d.desconto_mes_inicio}` : null,
    ].filter(Boolean).join(' · ');
  } else {
    const placas = Array.from(new Set(debitos.map(d => veicPorId.get(d.veiculo_id)?.placa).filter(Boolean)));
    observacao = `PAGAMENTO DE ${debitos.length} MULTAS/DÉBITOS VEICULARES — PLACA(S) ${placas.join(', ')} — VENCIMENTOS DE ${(vencimentos[0] || '').split('-').reverse().join('/')} A ${(vencimentos[vencimentos.length - 1] || '').split('-').reverse().join('/')}. COLE A LINHA DIGITÁVEL DE CADA BOLETO NOS DADOS DE PAGAMENTO.`;
  }

  return {
    ok: true,
    info: {
      ids,
      empresaId: debitos[0].empresa_id,
      favorecido,
      itens,
      dataVencimento: vencimentos[0] || null,
      observacao: observacao.toUpperCase() + (boletosUrls.length ? ` · BOLETO(S): ${boletosUrls.join(' ')}` : ''),
      dadosPagamento,
      semBoleto,
    },
  };
}

// ---------------------------------------------------------------------------
// Escanear notificação (foto/PDF → IA → campos do lançamento manual)
// O arquivo sobe direto do navegador pro Storage (bucket "frota", pasta
// multas/notificacoes/) — nunca em base64 numa Server Action, por causa do
// limite de ~4,5MB da Vercel. Aqui só chega o caminho.
// ---------------------------------------------------------------------------
const PASTA_NOTIFICACOES = 'multas/notificacoes/';
const MIME_POR_EXTENSAO: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const normPlaca = (p: string | null | undefined) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function lerNotificacaoMultaAction(params: { caminho: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();

  const caminho = params.caminho || '';
  if (!caminho.startsWith(PASTA_NOTIFICACOES) || caminho.includes('..')) return { ok: false, erro: 'Arquivo inválido.' };
  const extensao = (caminho.split('.').pop() || '').toLowerCase();
  const mime = MIME_POR_EXTENSAO[extensao];
  if (!mime) return { ok: false, erro: 'Envie uma foto (JPG/PNG) ou um PDF da notificação.' };

  const { data: blob, error: erroDownload } = await db.storage.from('frota').download(caminho);
  if (erroDownload || !blob) return { ok: false, erro: `Não foi possível abrir o arquivo enviado: ${erroDownload?.message || 'vazio'}` };
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (buffer.length > 25 * 1024 * 1024) return { ok: false, erro: 'Arquivo grande demais (máx. 25MB).' };

  const leitura = await lerNotificacaoMulta(buffer, mime);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };
  const d = leitura.dados;

  // Veículo pela placa lida (só entre os que o usuário enxerga).
  let veiculoId: string | null = null;
  let veiculoDescricao: string | null = null;
  let empresaVeiculo: number | null = null;
  const placaLida = normPlaca(d.placa);
  if (placaLida) {
    const { data: veics } = await db.from('frota_veiculos').select('id, apelido, placa, empresa_id');
    const v = ((veics || []) as { id: string; apelido: string; placa: string; empresa_id: number | null }[])
      .find(x => normPlaca(x.placa) === placaLida && empresaPermitida(auth.empresasPermitidas, x.empresa_id));
    if (v) { veiculoId = v.id; veiculoDescricao = `${v.apelido} (${v.placa})`; empresaVeiculo = v.empresa_id; }
  }
  await registrarLeituraIa(db, { veiculoId, empresaId: empresaVeiculo, modelo: leitura.modelo, entrada: leitura.tokensEntrada, saida: leitura.tokensSaida, usuario: auth.perfil.nome.toUpperCase(), referencia: `escaneamento AIT ${d.auto_infracao || '?'}` });

  // AIT já cadastrado (veio pela consulta ou já foi escaneado)?
  let duplicado: { id: string; tipo: string; valor: number; prazo_indicacao_condutor: string | null } | null = null;
  const auto = (d.auto_infracao || '').toUpperCase().replace(/\s/g, '');
  if (auto) {
    const { data: dup } = await db.from('frota_multas_debitos')
      .select('id, tipo, valor, prazo_indicacao_condutor, empresa_id').eq('auto_infracao', auto).limit(1).maybeSingle();
    if (dup && empresaPermitida(auth.empresasPermitidas, dup.empresa_id)) {
      duplicado = { id: dup.id, tipo: dup.tipo, valor: Number(dup.valor), prazo_indicacao_condutor: dup.prazo_indicacao_condutor };
    }
  }

  const { data: publico } = db.storage.from('frota').getPublicUrl(caminho);

  registrarLogAuditoria({
    usuario_nome: auth.perfil.nome.toUpperCase(), acao: 'LEU NOTIFICAÇÃO DE MULTA (IA)', setor: 'OPERACIONAL',
    equipamento_nome: `AIT ${auto || '?'} — placa ${placaLida || '?'} — ${leitura.modelo}, ${leitura.tokensEntrada}+${leitura.tokensSaida} tokens`,
  });

  return {
    ok: true,
    info: {
      dados: { ...d, auto_infracao: auto || null, placa: placaLida || null },
      veiculoId, veiculoDescricao, duplicado, arquivoUrl: publico.publicUrl,
      boleto: normalizarBoleto(d.linha_digitavel) || normalizarBoleto(d.codigo_barras),
    },
  };
}

// Anexa a notificação escaneada (e o prazo de indicação lido) a um débito
// que já existe — típico: a multa veio pela consulta do Detran e depois
// chegou o papel da notificação.
export async function anexarNotificacaoAction(params: { debitoId: string; notificacaoUrl: string | null; prazoIndicacaoCondutor: string | null; codigoInfracao?: string | null; linhaDigitavel?: string | null }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const { error } = await db.from('frota_multas_debitos').update({
    ...(params.notificacaoUrl ? { notificacao_url: params.notificacaoUrl } : {}),
    ...(params.prazoIndicacaoCondutor ? { prazo_indicacao_condutor: params.prazoIndicacaoCondutor } : {}),
    ...(params.codigoInfracao && !r.debito.codigo_infracao ? { codigo_infracao: params.codigoInfracao } : {}),
    ...(params.linhaDigitavel && !r.debito.linha_digitavel ? camposBoleto(params.linhaDigitavel, 'ESCANEADO') : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', params.debitoId);
  if (error) return { ok: false, erro: error.message };
  registrarLogAuditoria({
    usuario_nome: auth.perfil.nome.toUpperCase(), acao: 'ANEXOU NOTIFICAÇÃO À MULTA', setor: 'OPERACIONAL',
    equipamento_id: params.debitoId,
    equipamento_nome: `AIT ${r.debito.auto_infracao || 'S/N'}${params.prazoIndicacaoCondutor ? ` — prazo indicação ${params.prazoIndicacaoCondutor}` : ''}`,
  });
  return { ok: true };
}

// Indicação do condutor feita no órgão (FICI / site do órgão) — encerra o alerta de prazo.
export async function marcarIndicacaoCondutorAction(params: { debitoId: string; desfazer?: boolean }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  if (!params.desfazer && !r.debito.condutor_nome) return { ok: false, erro: 'Defina o condutor antes de marcar a indicação como feita.' };
  const usuario = auth.perfil.nome.toUpperCase();
  const { error } = await db.from('frota_multas_debitos').update({
    condutor_indicado_em: params.desfazer ? null : new Date().toISOString(),
    condutor_indicado_por: params.desfazer ? null : usuario,
    updated_at: new Date().toISOString(),
  }).eq('id', params.debitoId);
  if (error) return { ok: false, erro: error.message };
  registrarLogAuditoria({
    usuario_nome: usuario, acao: params.desfazer ? 'DESFEZ INDICAÇÃO DE CONDUTOR' : 'INDICOU CONDUTOR AO ÓRGÃO', setor: 'OPERACIONAL',
    equipamento_id: params.debitoId, equipamento_nome: `AIT ${r.debito.auto_infracao || 'S/N'} — ${r.debito.condutor_nome || ''}`,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Boleto da multa (linha digitável / código de barras / PDF)
// ---------------------------------------------------------------------------
function camposBoleto(valor: string | null | undefined, fonte: string): Record<string, string | null> {
  const b = normalizarBoleto(valor);
  if (!b) return {};
  return { linha_digitavel: b.linha, codigo_barras: b.codigo, boleto_fonte: fonte, boleto_atualizado_em: new Date().toISOString() };
}

// Copia um PDF remoto (boleto da Prefeitura, notificação do DER) pro bucket
// "frota" — o link de origem pode expirar. Devolve a URL pública e os bytes.
async function guardarPdfRemoto(db: ReturnType<typeof supabaseAdmin>, url: string, caminho: string): Promise<{ url: string; buffer: Buffer } | null> {
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) return null;
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 25 * 1024 * 1024) return null;
    const { error } = await db.storage.from('frota').upload(caminho, buffer, { contentType: 'application/pdf', upsert: true });
    if (error) return null;
    return { url: db.storage.from('frota').getPublicUrl(caminho).data.publicUrl, buffer };
  } catch {
    return null;
  }
}

const ehMultaPrefeituraSP = (d: { orgao_autuador: string | null; municipio: string | null }) =>
  /MUNICIPAL|PREFEITURA|\bCET\b|\bDSV\b/i.test(d.orgao_autuador || '') && /S[AÃ]O PAULO/i.test(d.municipio || '');
const ehMultaDerSP = (d: { orgao_autuador: string | null }) => /\bD\.?\s?E\.?\s?R\b\.?/i.test(d.orgao_autuador || '');
const normAitLocal = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Linha digitável digitada/colada à mão no detalhe da multa.
export async function salvarBoletoAction(params: { debitoId: string; linhaOuCodigo: string | null }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };

  if (!params.linhaOuCodigo?.trim()) {
    const { error } = await db.from('frota_multas_debitos').update({
      linha_digitavel: null, codigo_barras: null, boleto_fonte: null, boleto_atualizado_em: null, updated_at: new Date().toISOString(),
    }).eq('id', params.debitoId);
    return error ? { ok: false, erro: error.message } : { ok: true };
  }
  const b = normalizarBoleto(params.linhaOuCodigo);
  if (!b) return { ok: false, erro: 'Informe a linha digitável (47 ou 48 dígitos) ou o código de barras (44 dígitos).' };
  const { error } = await db.from('frota_multas_debitos').update({ ...camposBoleto(params.linhaOuCodigo, 'MANUAL'), updated_at: new Date().toISOString() }).eq('id', params.debitoId);
  if (error) return { ok: false, erro: error.message };
  registrarLogAuditoria({
    usuario_nome: auth.perfil.nome.toUpperCase(), acao: 'INFORMOU BOLETO DA MULTA', setor: 'OPERACIONAL',
    equipamento_id: params.debitoId, equipamento_nome: `AIT ${r.debito.auto_infracao || 'S/N'}${b.valido ? '' : ' (DV não confere)'}`,
  });
  return { ok: true, info: { valido: b.valido } };
}

// "🔎 Buscar boleto": escolhe a consulta pelo órgão autuador.
//   - Prefeitura de SP: uma consulta traz o boleto de todas as multas
//     municipais em aberto do veículo (código de barras + PDF).
//   - DER-SP: baixa o PDF da Notificação de Penalidade e a IA lê a linha
//     digitável (só das multas DER em aberto e ainda sem boleto do veículo).
export async function buscarBoletoAction(params: { debitoId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const usuario = auth.perfil.nome.toUpperCase();

  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const alvo = r.debito;
  if (alvo.tipo !== 'MULTA') return { ok: false, erro: 'Busca de boleto só para multa.' };

  const { data: veiculo } = await db.from('frota_veiculos').select('id, apelido, placa, renavam, empresa_id').eq('id', alvo.veiculo_id).maybeSingle();
  if (!veiculo?.placa || !veiculo?.renavam) return { ok: false, erro: 'Veículo sem placa/Renavam cadastrados.' };

  const { data: abertasData } = await db.from('frota_multas_debitos')
    .select('id, auto_infracao, orgao_autuador, municipio, linha_digitavel, notificacao_url')
    .eq('veiculo_id', veiculo.id).eq('tipo', 'MULTA').eq('status', 'ABERTO');
  type Aberta = { id: string; auto_infracao: string | null; orgao_autuador: string | null; municipio: string | null; linha_digitavel: string | null; notificacao_url: string | null };
  const abertas = (abertasData || []) as Aberta[];
  const agora = new Date().toISOString();

  const registrar = async (servico: string, ok: boolean, codigo: number | null, mensagem: string, preco: number | null, encontrados: number, atualizados: number, resposta: unknown) => {
    await db.from('frota_multas_consultas').insert([{
      empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id, provedor: 'INFOSIMPLES', servico,
      status: ok ? 'OK' : 'ERRO', codigo, mensagem: mensagem.slice(0, 2000), encontrados, novos: atualizados, baixados: 0,
      preco, resposta, consultado_por: usuario,
    }]);
  };

  // ---------------- Prefeitura de SP ----------------
  if (ehMultaPrefeituraSP(alvo)) {
    const municipais = abertas.filter(ehMultaPrefeituraSP);
    const res = await consultarBoletosPrefeituraSP({ placa: veiculo.placa, renavam: veiculo.renavam, aits: municipais.map(m => normAitLocal(m.auto_infracao)).filter(Boolean) });
    if (!res.ok) {
      await registrar(res.servico, false, res.codigo, res.mensagem, res.preco, 0, 0, res.resposta);
      return { ok: false, erro: res.mensagem };
    }
    let atualizados = 0;
    const semBoleto: string[] = [];
    for (const m of municipais) {
      const b = res.boletos.find(x => x.ait === normAitLocal(m.auto_infracao));
      if (!b?.codigo_barras) { semBoleto.push(m.auto_infracao || m.id); continue; }
      const pdf = b.boleto_url ? await guardarPdfRemoto(db, b.boleto_url, `multas/boletos/${normAitLocal(m.auto_infracao) || m.id}.pdf`) : null;
      const { error } = await db.from('frota_multas_debitos').update({
        ...camposBoleto(b.codigo_barras, 'PREFEITURA_SP'),
        boleto_url: pdf?.url || b.boleto_url,
        updated_at: agora,
      }).eq('id', m.id);
      if (!error) atualizados++;
    }
    await registrar(res.servico, true, res.codigo, `${res.boletos.length} boleto(s) na Prefeitura; ${atualizados} multa(s) atualizada(s)`, res.preco, res.boletos.length, atualizados, res.resposta);
    registrarLogAuditoria({
      usuario_nome: usuario, acao: 'BUSCOU BOLETO DE MULTA (PREFEITURA SP)', setor: 'OPERACIONAL',
      equipamento_id: veiculo.id, equipamento_nome: `${veiculo.apelido} (${veiculo.placa}) — ${atualizados} boleto(s)`,
    });
    return { ok: true, info: { fonte: 'PREFEITURA_SP', atualizados, semBoleto, preco: res.preco } };
  }

  // ---------------- DER-SP ----------------
  if (ehMultaDerSP(alvo)) {
    const res = await consultarPenalidadesDerSP({ renavam: veiculo.renavam });
    if (!res.ok) {
      await registrar(res.servico, false, res.codigo, res.mensagem, res.preco, 0, 0, res.resposta);
      return { ok: false, erro: res.mensagem };
    }
    // Só as DER em aberto e ainda sem boleto (cada PDF lido pela IA tem custo); a clicada sempre entra.
    const candidatas = abertas.filter(m => ehMultaDerSP(m) && (m.id === alvo.id || !m.linha_digitavel)).slice(0, 5);
    let atualizados = 0;
    const semBoleto: string[] = [];
    const avisos: string[] = [];
    const viaSne: string[] = [];
    for (const m of candidatas) {
      const p = res.penalidades.find(x => x.ait === normAitLocal(m.auto_infracao));
      if (!p?.np_pdf_url) { semBoleto.push(m.auto_infracao || m.id); continue; }
      const pdf = await guardarPdfRemoto(db, p.np_pdf_url, `multas/notificacoes/der-${normAitLocal(m.auto_infracao) || m.id}.pdf`);
      if (!pdf) { semBoleto.push(m.auto_infracao || m.id); avisos.push(`AIT ${m.auto_infracao}: não foi possível baixar o PDF do DER.`); continue; }

      // Texto nativo primeiro (grátis). Empresa aderida ao SNE: o DER devolve
      // só "NP não emitida — adesão ao SNE", sem boleto; o pagamento é pelo
      // app SNE / Carteira Digital de Trânsito, com 40% de desconto
      // (constatado 2026-11-11 no CAMINHÃO BRANCO).
      let textoNativo = '';
      try { textoNativo = await extrairTextoNativoPdf(pdf.buffer.toString('base64')); } catch { /* PDF sem texto: vai pra IA */ }
      if (/NP\s+n[aã]o\s+emitida|ades[aã]o\s+ao\s+SNE/i.test(textoNativo)) {
        viaSne.push(m.auto_infracao || m.id);
        continue;
      }
      let linha: string | null = null;
      const sequencia = textoNativo.replace(/[ .\-]/g, '').match(/\d{44,48}/g)?.find(sq => normalizarBoleto(sq));
      if (sequencia) {
        linha = sequencia;
      } else {
        const leitura = await lerNotificacaoMulta(pdf.buffer, 'application/pdf');
        if (leitura.ok) await registrarLeituraIa(db, { veiculoId: veiculo.id, empresaId: veiculo.empresa_id, modelo: leitura.modelo, entrada: leitura.tokensEntrada, saida: leitura.tokensSaida, usuario, referencia: `PDF DER AIT ${m.auto_infracao || '?'}` });
        linha = leitura.ok ? (leitura.dados.linha_digitavel || leitura.dados.codigo_barras) : null;
        if (!leitura.ok) avisos.push(`AIT ${m.auto_infracao}: ${leitura.erro}`);
        else if (leitura.dados.observacoes) avisos.push(`AIT ${m.auto_infracao}: ${leitura.dados.observacoes}`);
      }
      const { error } = await db.from('frota_multas_debitos').update({
        notificacao_url: m.notificacao_url || pdf.url,
        ...(linha ? { ...camposBoleto(linha, 'DER_SP'), boleto_url: pdf.url } : {}),
        updated_at: agora,
      }).eq('id', m.id);
      if (!error && linha && normalizarBoleto(linha)) atualizados++;
      else semBoleto.push(m.auto_infracao || m.id);
    }
    if (viaSne.length) {
      avisos.unshift(`A empresa aderiu ao SNE: o DER não emite boleto (${viaSne.join(', ')}). Pague pelo app SNE / Carteira Digital de Trânsito, com 40% de desconto até o vencimento, e cole a linha digitável aqui.`);
    }
    await registrar(res.servico, true, res.codigo, `${res.penalidades.length} penalidade(s) no DER; ${atualizados} boleto(s) lido(s)${viaSne.length ? `; ${viaSne.length} via SNE (sem boleto do DER)` : ''}`, res.preco, res.penalidades.length, atualizados, res.resposta);
    registrarLogAuditoria({
      usuario_nome: usuario, acao: 'BUSCOU BOLETO DE MULTA (DER-SP)', setor: 'OPERACIONAL',
      equipamento_id: veiculo.id, equipamento_nome: `${veiculo.apelido} (${veiculo.placa}) — ${atualizados} boleto(s)`,
    });
    return { ok: true, info: { fonte: 'DER_SP', atualizados, semBoleto, avisos, viaSne, preco: res.preco } };
  }

  return { ok: false, erro: 'Busca automática de boleto disponível só para multas da Prefeitura de São Paulo e do DER-SP. Para as demais, escaneie a notificação ou cole a linha digitável.' };
}

// ---------------------------------------------------------------------------
// Prazos de indicação do condutor pela SENATRAN (botão na aba Veículos)
// ---------------------------------------------------------------------------
export async function buscarPrazosSenatranAction(params: { veiculoId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const { data: veiculo } = await db.from('frota_veiculos')
    .select('id, apelido, placa, renavam, empresa_id, propriedade').eq('id', params.veiculoId).maybeSingle();
  if (!veiculo) return { ok: false, erro: 'Veículo não encontrado.' };
  if (!empresaPermitida(auth.empresasPermitidas, veiculo.empresa_id)) return { ok: false, erro: 'Você não tem acesso a este veículo.' };
  const r = await atualizarPrazosSenatran(db, veiculo, auth.perfil.nome.toUpperCase());
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, info: r };
}

// ---------------------------------------------------------------------------
// Dados para indicar o condutor (FICI em PDF / "Dados para o SNE")
// Lê a ficha com select('*') — funciona mesmo antes das colunas de CNH
// existirem; o que faltar volta em `faltando` pra tela avisar.
// ---------------------------------------------------------------------------
export async function dadosIndicacaoCondutorAction(params: { debitoId: string }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const d = r.debito;
  if (d.tipo !== 'MULTA') return { ok: false, erro: 'Indicação de condutor só se aplica a multa.' };
  if (!d.condutor_nome) return { ok: false, erro: 'Defina o condutor antes.' };

  const [{ data: veic }, { data: func }, { data: emp }] = await Promise.all([
    db.from('frota_veiculos').select('apelido, placa, renavam, marca, modelo').eq('id', d.veiculo_id).maybeSingle(),
    db.from('folha_funcionarios').select('*').eq('nome_completo', d.condutor_nome).maybeSingle(),
    d.empresa_id ? db.from('empresas').select('razao_social, nome, cnpj').eq('id', d.empresa_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!func) return { ok: false, erro: 'Condutor não encontrado no cadastro de funcionários.' };
  if (!empresaPermitida(auth.empresasPermitidas, func.empresa_id)) return { ok: false, erro: 'Você não tem acesso a este colaborador.' };

  const f = func as Record<string, unknown>;
  const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
  const endereco = [txt(f.endereco), txt(f.numero), txt(f.complemento)].filter(Boolean).join(', ');
  const condutor = {
    nome: d.condutor_nome,
    cpf: txt(f.cpf),
    cnh_numero: txt(f.cnh_numero),
    cnh_categoria: txt(f.cnh_categoria),
    cnh_validade: txt(f.cnh_validade),
    endereco: endereco || null,
    bairro: txt(f.bairro),
    cidade: txt(f.cidade),
    cep: txt(f.cep),
    celular: txt(f.celular),
  };
  const faltando = [
    !condutor.cpf && 'CPF', !condutor.cnh_numero && 'número da CNH', !condutor.cnh_categoria && 'categoria da CNH',
    !condutor.cnh_validade && 'validade da CNH', !condutor.endereco && 'endereço',
  ].filter(Boolean) as string[];
  const cnhVencida = condutor.cnh_validade ? condutor.cnh_validade < new Date().toISOString().slice(0, 10) : false;

  return {
    ok: true,
    info: {
      multa: {
        auto_infracao: d.auto_infracao, orgao_autuador: d.orgao_autuador, codigo_infracao: d.codigo_infracao,
        descricao: d.descricao, data_infracao: d.data_infracao, hora_infracao: d.hora_infracao,
        local_infracao: d.local_infracao, municipio: d.municipio, prazo_indicacao: d.prazo_indicacao_condutor,
      },
      veiculo: veic ? { placa: veic.placa, renavam: veic.renavam, marca_modelo: [veic.marca, veic.modelo].filter(Boolean).join(' ') || veic.apelido } : null,
      empresa: emp ? { razao_social: (emp as { razao_social: string | null; nome: string }).razao_social || (emp as { nome: string }).nome, cnpj: (emp as { cnpj: string | null }).cnpj } : null,
      condutor, faltando, cnhVencida,
    },
  };
}

// Registra uma leitura por IA no log de consultas (controle de custos).
// preco em US$ (provedor ANTHROPIC). Sem veículo só grava depois do SQL
// operacional_multas_custos.sql (veiculo_id passa a aceitar null) — antes
// disso o insert falha em silêncio e nada quebra.
async function registrarLeituraIa(db: ReturnType<typeof supabaseAdmin>, p: { veiculoId: string | null; empresaId: number | null; modelo: string; entrada: number; saida: number; usuario: string; referencia: string }) {
  try {
    await db.from('frota_multas_consultas').insert([{
      empresa_id: p.empresaId, veiculo_id: p.veiculoId, provedor: 'ANTHROPIC', servico: `claude/${p.modelo}`,
      status: 'OK', codigo: 200, mensagem: `${p.referencia} — ${p.entrada}+${p.saida} tokens`,
      encontrados: 1, novos: 0, baixados: 0, preco: custoLeituraUsd(p.entrada, p.saida), consultado_por: p.usuario,
    }]);
  } catch { /* log de custo nunca bloqueia a leitura */ }
}

// ---------------------------------------------------------------------------
// Defesa / recurso da multa. DEFERIDO cancela o débito (multa anulada);
// sair de DEFERIDO reabre o que tinha sido cancelado por ele.
// ---------------------------------------------------------------------------
export async function salvarRecursoAction(params: { debitoId: string; status: 'PROTOCOLADO' | 'DEFERIDO' | 'INDEFERIDO' | null; protocolo: string | null; prazoDefesa?: string | null }, accessToken: string): Promise<Resultado> {
  const auth = await autorizar(accessToken);
  if (!auth.ok) return { ok: false, erro: auth.erro };
  const db = supabaseAdmin();
  const usuario = auth.perfil.nome.toUpperCase();
  const r = await carregarDebitoAutorizado(db, params.debitoId, auth.empresasPermitidas);
  if (!r.ok) return { ok: false, erro: r.erro };
  const d = r.debito;
  if (d.tipo !== 'MULTA') return { ok: false, erro: 'Recurso só se aplica a multa.' };
  if (params.status && !['PROTOCOLADO', 'DEFERIDO', 'INDEFERIDO'].includes(params.status)) return { ok: false, erro: 'Situação de recurso inválida.' };

  const agora = new Date().toISOString();
  const cancelarPorRecurso = params.status === 'DEFERIDO' && d.status === 'ABERTO';
  const reabrir = d.recurso_status === 'DEFERIDO' && params.status !== 'DEFERIDO' && d.status === 'CANCELADO' && d.status_alterado_por?.startsWith('RECURSO DEFERIDO');

  const { error } = await db.from('frota_multas_debitos').update({
    recurso_status: params.status,
    recurso_protocolo: params.protocolo?.trim() || null,
    ...(params.prazoDefesa !== undefined ? { prazo_defesa: params.prazoDefesa || null } : {}),
    recurso_atualizado_em: agora,
    recurso_atualizado_por: usuario,
    ...(cancelarPorRecurso ? { status: 'CANCELADO', baixa_automatica: false, pago_em: null, status_alterado_por: `RECURSO DEFERIDO (${usuario})` } : {}),
    ...(reabrir ? { status: 'ABERTO', status_alterado_por: usuario } : {}),
    updated_at: agora,
  }).eq('id', d.id);
  if (error) return { ok: false, erro: error.message };

  registrarLogAuditoria({
    usuario_nome: usuario, acao: `RECURSO DE MULTA: ${params.status || 'SEM RECURSO'}`, setor: 'OPERACIONAL',
    equipamento_id: d.id, equipamento_nome: `AIT ${d.auto_infracao || 'S/N'}${params.protocolo ? ` — protocolo ${params.protocolo}` : ''}${cancelarPorRecurso ? ' — débito cancelado' : ''}`,
  });
  return { ok: true, info: { cancelado: cancelarPorRecurso, reaberto: !!reabrir } };
}
