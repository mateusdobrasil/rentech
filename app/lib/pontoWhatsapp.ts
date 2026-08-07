// Ponto via WhatsApp: motor da conversa (PONTO, JUSTIFICAR, ABONAR), matching
// do funcionário por celular, e consolidação das batidas confirmadas em
// folha_ponto_diaria. O ledger em si (folha_ponto_whatsapp_registros) é
// append-only — NSR e cadeia de hash são calculados por trigger no banco
// (ver folha_ponto_whatsapp.sql). Esta lib nunca edita/apaga uma batida já
// confirmada, só grava novas ou lança ajustes aditivos.
//
// JUSTIFICAR (batida esquecida) e ABONAR (dia sem bater ponto) nunca gravam
// direto: criam uma solicitação pendente em folha_ponto_whatsapp_solicitacoes,
// que só vira ajuste/abono de verdade quando o RH aprova (ver
// actions-ponto-whatsapp.ts) — o funcionário nunca aprova a própria exceção.
import { supabaseAdmin } from './supabase';
import { registrarLogAuditoria } from '../actions';

export type TipoBatida = 'ENTRADA_1' | 'SAIDA_1' | 'ENTRADA_2' | 'SAIDA_2';
type Fluxo = 'MENU_INICIAL' | 'CONFIRMAR_BATIDA' | 'JUSTIFICAR' | 'ABONAR' | 'FOLGAR';

const ORDEM_BATIDAS: TipoBatida[] = ['ENTRADA_1', 'SAIDA_1', 'ENTRADA_2', 'SAIDA_2'];

// Rótulos propositalmente sem menção a "almoço" — estava confundindo
// funcionários (achavam que Saída/Volta do almoço era opcional). ENTRADA_1
// e ENTRADA_2 mostram o mesmo texto "Entrada", SAIDA_1 e SAIDA_2 mostram o
// mesmo texto "Saída"; a ordem (1ª ou 2ª batida do tipo) some do texto mas
// continua implícita na sequência ENTRADA_1→SAIDA_1→ENTRADA_2→SAIDA_2.
const ROTULO_BATIDA: Record<TipoBatida, string> = {
  ENTRADA_1: 'Entrada',
  SAIDA_1: 'Saída',
  ENTRADA_2: 'Entrada',
  SAIDA_2: 'Saída',
};

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const MINUTOS_EXPIRACAO_PENDENCIA = 5;
// Janela retroativa para JUSTIFICAR/ABONAR pelo WhatsApp — regra de negócio
// combinada: no máximo os últimos 7 dias corridos (hoje incluso).
const JANELA_DIAS_RETROATIVOS = 7;
// FOLGAR é prospectivo (data futura, digitada em texto livre, sem menu
// numerado) — limite de tamanho do período só pra evitar erro de digitação
// virar um pedido de meses inteiros sem querer.
const MAX_DIAS_PERIODO_FOLGA = 30;

export interface ResultadoPonto {
  mensagem: string;
}

interface Contexto {
  tipo_batida?: TipoBatida;
  data_hora_proposta?: string; // ISO — usado no fluxo CONFIRMAR_BATIDA
  data_referencia?: string;    // YYYY-MM-DD — usado em JUSTIFICAR/ABONAR/FOLGAR
  data_referencia_fim?: string; // YYYY-MM-DD — fim do período, usado em FOLGAR
  horario?: string;            // HH:MM — usado em JUSTIFICAR
  motivo?: string;             // usado em ABONAR/FOLGAR, antes de gravar a solicitação
}

export interface AnexoWhatsApp {
  url: string;
  nomeArquivo: string;
  mimeType: string;
  // Presente quando a URL exige autenticação para ser baixada (Meta Cloud
  // API); a Z-API entrega uma URL pública direta, sem precisar disso.
  authHeader?: string;
}

interface PendenciaPonto {
  celular: string;
  funcionario_nome: string;
  fluxo: Fluxo;
  etapa: string;
  contexto: Contexto;
  expira_em: string;
}

function digitsOnly(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '');
}

// Normaliza um número de celular BR para comparação, tolerando variações
// comuns entre o que fica cadastrado na ficha do funcionário e o que a
// Z-API entrega no webhook: presença/ausência do 55 (país) e do 9º dígito.
function normalizarParaComparacao(numero: string): string {
  let d = digitsOnly(numero);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) d = d.slice(0, 2) + d.slice(3);
  return d;
}

function horaHHMM(data: Date): string {
  return data.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
}

function dataReferenciaBR(data: Date): string {
  return data.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function timeToMinutes(timeStr: string | null): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 60) + m;
}

function formatarDataBR(dataIso: string): string {
  return dataIso.split('-').reverse().join('/');
}

function formatarPeriodoBR(inicio: string, fim: string): string {
  return inicio === fim ? formatarDataBR(inicio) : `${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
}

// Data (YYYY-MM-DD) menos N dias, tratada como valor de calendário puro
// (sem hora), pra não sofrer com o fuso do relógio do servidor.
function subtrairDias(dataIso: string, dias: number): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().split('T')[0];
}

function diaSemanaDe(dataIso: string): number {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

// Combina uma data de referência com um horário HH:MM num timestamp válido.
// Brasil não observa mais horário de verão (abolido em 2019), então
// America/Sao_Paulo é sempre UTC-3 fixo — sem pegadinha de DST aqui (mesma
// premissa já usada em app/api/cron/motor/route.ts).
export function timestampBR(dataReferencia: string, horaHHMMValor: string): string {
  return new Date(`${dataReferencia}T${horaHHMMValor}:00-03:00`).toISOString();
}

function extrairHorario(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function normalizarResposta(texto: string): 'SIM' | 'NAO' | 'OUTRO' {
  const t = texto.trim().toUpperCase();
  if (['SIM', 'S', '1', 'YES', 'OK', 'CONFIRMAR'].includes(t)) return 'SIM';
  if (['NAO', 'NÃO', 'N', '2', 'NO', 'CANCELAR'].includes(t)) return 'NAO';
  return 'OUTRO';
}

interface ItemMenuDia { indice: number; dataIso: string; rotulo: string; }

// Menu numerado dos últimos JANELA_DIAS_RETROATIVOS dias (hoje incluso),
// usado tanto em JUSTIFICAR quanto em ABONAR — responder só o número evita
// ter que interpretar datas em texto livre.
function diasParaMenu(agora: Date): ItemMenuDia[] {
  const hojeIso = dataReferenciaBR(agora);
  const itens: ItemMenuDia[] = [];
  for (let i = 0; i < JANELA_DIAS_RETROATIVOS; i++) {
    const dataIso = subtrairDias(hojeIso, i);
    const rotuloBase = i === 0 ? 'Hoje' : i === 1 ? 'Ontem' : DIAS_SEMANA[diaSemanaDe(dataIso)];
    itens.push({ indice: i + 1, dataIso, rotulo: `${rotuloBase} (${formatarDataBR(dataIso)})` });
  }
  return itens;
}

function montarMenuDias(itens: ItemMenuDia[]): string {
  return itens.map(it => `${it.indice}) ${it.rotulo}`).join('\n');
}

function montarMenuInicial(): string {
  return 'Olá, tudo bem?O que você deseja fazer? Responda com o número:\n1) Registrar ponto\n2) Justificar batida esquecida\n3) Abonar o dia (falta/atestado)';
}

type Db = ReturnType<typeof supabaseAdmin>;

async function buscarFuncionarioPorCelular(db: Db, telefone: string): Promise<{ nome_completo: string } | null> {
  const { data } = await db
    .from('folha_funcionarios')
    .select('nome_completo, celular')
    .eq('ativo', true)
    .eq('ponto_whatsapp_ativo', true)
    .not('celular', 'is', null);

  const alvo = normalizarParaComparacao(telefone);
  const achado = (data || []).find((f) => normalizarParaComparacao(f.celular) === alvo);
  return achado ? { nome_completo: achado.nome_completo } : null;
}

// Batidas do dia ainda não registradas (nem no ledger, nem por ajuste
// aprovado), na ordem E1→S1→E2→S2. Usada tanto para decidir a próxima
// batida do fluxo PONTO quanto para montar o menu do fluxo JUSTIFICAR.
async function batidasFaltantesNoDia(db: Db, funcionarioNome: string, dataReferencia: string): Promise<TipoBatida[]> {
  const [{ data: batidas }, { data: ajustes }] = await Promise.all([
    db.from('folha_ponto_whatsapp_registros').select('tipo_batida').eq('funcionario_nome', funcionarioNome).eq('data_referencia', dataReferencia),
    db.from('folha_ponto_whatsapp_ajustes').select('tipo_batida').eq('funcionario_nome', funcionarioNome).eq('data_referencia', dataReferencia),
  ]);

  const jaFeitas = new Set<string>([
    ...(batidas || []).map((b) => b.tipo_batida),
    ...(ajustes || []).map((a) => a.tipo_batida),
  ]);
  return ORDEM_BATIDAS.filter(t => !jaFeitas.has(t));
}

async function existeSolicitacaoPendente(db: Db, funcionarioNome: string, dataReferencia: string, tipo: 'JUSTIFICATIVA_BATIDA' | 'ABONO_DIA', tipoBatida: TipoBatida | null): Promise<boolean> {
  let query = db.from('folha_ponto_whatsapp_solicitacoes')
    .select('id')
    .eq('funcionario_nome', funcionarioNome)
    .eq('data_referencia', dataReferencia)
    .eq('tipo', tipo)
    .eq('status', 'PENDENTE');
  if (tipoBatida) query = query.eq('tipo_batida', tipoBatida);

  const { data } = await query.limit(1);
  return !!(data && data.length > 0);
}

async function salvarPendencia(db: Db, celular: string, funcionarioNome: string, fluxo: Fluxo, etapa: string, contexto: Contexto, agora: Date): Promise<void> {
  const { error } = await db.from('folha_ponto_whatsapp_pendencias').upsert({
    celular,
    funcionario_nome: funcionarioNome,
    fluxo,
    etapa,
    contexto,
    expira_em: new Date(agora.getTime() + MINUTOS_EXPIRACAO_PENDENCIA * 60000).toISOString(),
  });
  // Falha aqui não pode passar em silêncio: sem a pendência salva, a próxima
  // mensagem do funcionário é tratada como uma conversa nova, e ele fica
  // preso vendo sempre a mesma pergunta de novo.
  if (error) throw new Error(`Falha ao salvar o estado da conversa: ${error.message}`);
}

async function limparPendencia(db: Db, celular: string): Promise<void> {
  await db.from('folha_ponto_whatsapp_pendencias').delete().eq('celular', celular);
}

async function buscarPendenciaValida(db: Db, celular: string, agora: Date): Promise<PendenciaPonto | null> {
  const { data } = await db.from('folha_ponto_whatsapp_pendencias').select('*').eq('celular', celular).maybeSingle();
  if (!data) return null;
  if (new Date(data.expira_em).getTime() < agora.getTime()) {
    await limparPendencia(db, celular);
    return null;
  }
  return data as PendenciaPonto;
}

// Reconstrói o dia (batidas do ledger + ajustes) e sobrescreve a linha
// WHATSAPP de folha_ponto_diaria. Nunca toca em linhas de origem
// CSV_PONTOMAIS: se o dia já tem ponto importado do Pontomais, a
// consolidação é pulada e um aviso é logado para o RH conciliar (o registro
// no ledger legal acontece de qualquer forma, isto só afeta o relatório).
// Exportada porque também é chamada depois que o RH aprova uma justificativa
// (novo ajuste some no dia, precisa recalcular o relatório).
export async function consolidarDia(db: Db, funcionarioNome: string, dataReferencia: string): Promise<void> {
  const { data: existenteOutraOrigem } = await db
    .from('folha_ponto_diaria')
    .select('id')
    .eq('funcionario_nome', funcionarioNome)
    .eq('data_registro', dataReferencia)
    .neq('origem', 'WHATSAPP')
    .maybeSingle();

  if (existenteOutraOrigem) {
    await registrarLogAuditoria({
      usuario_nome: 'SISTEMA (WHATSAPP)',
      acao: `CONFLITO DE PONTO: ${funcionarioNome} já tem ponto importado do Pontomais em ${dataReferencia}; batida via WhatsApp não sobrescreveu o relatório`,
      setor: 'RECURSOS HUMANOS / PONTO WHATSAPP',
    });
    return;
  }

  const [{ data: batidas }, { data: ajustes }] = await Promise.all([
    db.from('folha_ponto_whatsapp_registros')
      .select('tipo_batida, data_hora_batida')
      .eq('funcionario_nome', funcionarioNome)
      .eq('data_referencia', dataReferencia)
      .order('nsr', { ascending: true }),
    db.from('folha_ponto_whatsapp_ajustes')
      .select('tipo_batida, data_hora_ajustada')
      .eq('funcionario_nome', funcionarioNome)
      .eq('data_referencia', dataReferencia),
  ]);

  const porTipo: Partial<Record<TipoBatida, string>> = {};
  for (const b of (batidas || []) as { tipo_batida: TipoBatida; data_hora_batida: string }[]) {
    if (!porTipo[b.tipo_batida]) porTipo[b.tipo_batida] = horaHHMM(new Date(b.data_hora_batida));
  }
  // Ajustes do RH prevalecem sobre a batida original do ledger para o dia
  for (const a of (ajustes || []) as { tipo_batida: TipoBatida; data_hora_ajustada: string }[]) {
    porTipo[a.tipo_batida] = horaHHMM(new Date(a.data_hora_ajustada));
  }

  const e1 = porTipo.ENTRADA_1 || null;
  const s1 = porTipo.SAIDA_1 || null;
  const e2 = porTipo.ENTRADA_2 || null;
  const s2 = porTipo.SAIDA_2 || null;

  // Mesma regra de cálculo usada na importação do CSV do Pontomais
  // (app/admin/rh/ponto/page.tsx) — desconta 1h de almoço quando só há um
  // par de batidas cobrindo 6h ou mais corridas.
  let minutosTrabalhados = 0;
  if (e1 && s1 && !e2 && !s2) {
    let mins = timeToMinutes(s1) - timeToMinutes(e1);
    if (mins >= 360) mins -= 60;
    minutosTrabalhados = mins;
  } else {
    if (e1 && s1) minutosTrabalhados += timeToMinutes(s1) - timeToMinutes(e1);
    if (e2 && s2) minutosTrabalhados += timeToMinutes(s2) - timeToMinutes(e2);
  }

  await db.from('folha_ponto_diaria').delete()
    .eq('funcionario_nome', funcionarioNome)
    .eq('data_registro', dataReferencia)
    .eq('origem', 'WHATSAPP');

  await db.from('folha_ponto_diaria').insert({
    funcionario_nome: funcionarioNome,
    data_registro: dataReferencia,
    entrada_1: e1, saida_1: s1, entrada_2: e2, saida_2: s2,
    minutos_trabalhados: minutosTrabalhados,
    origem: 'WHATSAPP',
  });
}

interface DadosConfirmacaoBatida {
  funcionario_nome: string;
  celular: string;
  tipo_batida: TipoBatida;
  data_hora_proposta: string;
}

async function confirmarBatida(db: Db, dados: DadosConfirmacaoBatida, messageId: string | null, payloadBruto: unknown): Promise<{ nsr: number; tipo_batida: TipoBatida; data_hora_batida: string }> {
  const dataReferencia = dataReferenciaBR(new Date(dados.data_hora_proposta));

  const { data, error } = await db.from('folha_ponto_whatsapp_registros').insert({
    funcionario_nome: dados.funcionario_nome,
    celular: dados.celular,
    tipo_batida: dados.tipo_batida,
    data_referencia: dataReferencia,
    data_hora_batida: dados.data_hora_proposta,
    zapi_message_id: messageId,
    payload_bruto: payloadBruto ?? null,
  }).select('nsr, tipo_batida, data_hora_batida').single();

  if (error) throw new Error(`Falha ao gravar a batida no ledger: ${error.message}`);

  await consolidarDia(db, dados.funcionario_nome, dataReferencia);

  return data as { nsr: number; tipo_batida: TipoBatida; data_hora_batida: string };
}

// ============================================================================
// FLUXO: CONFIRMAR_BATIDA (bater ponto em tempo real — comportamento original)
// ============================================================================
async function iniciarFluxoConfirmarBatida(db: Db, funcionarioNome: string, celular: string, agora: Date): Promise<ResultadoPonto> {
  const dataReferencia = dataReferenciaBR(agora);
  const faltantes = await batidasFaltantesNoDia(db, funcionarioNome, dataReferencia);
  const proxima = faltantes[0];
  if (!proxima) {
    return { mensagem: 'Todas as batidas de hoje já foram registradas. Se precisar corrigir algo, envie qualquer mensagem para ver as opções.' };
  }

  await salvarPendencia(db, celular, funcionarioNome, 'CONFIRMAR_BATIDA', 'AGUARDANDO_CONFIRMACAO', {
    tipo_batida: proxima,
    data_hora_proposta: agora.toISOString(),
  }, agora);

  return { mensagem: `Confirma ${ROTULO_BATIDA[proxima]} às ${horaHHMM(agora)}? Responda SIM ou NAO.` };
}

async function avancarConfirmarBatida(db: Db, pendencia: PendenciaPonto, texto: string, messageId: string | null, payloadBruto: unknown): Promise<ResultadoPonto> {
  const { tipo_batida, data_hora_proposta } = pendencia.contexto;
  if (!tipo_batida || !data_hora_proposta) {
    await limparPendencia(db, pendencia.celular);
    return { mensagem: 'Ocorreu um erro no fluxo. Envie qualquer mensagem para recomeçar.' };
  }

  const resposta = normalizarResposta(texto);
  if (resposta === 'SIM') {
    const registro = await confirmarBatida(db, {
      funcionario_nome: pendencia.funcionario_nome,
      celular: pendencia.celular,
      tipo_batida,
      data_hora_proposta,
    }, messageId, payloadBruto);
    await limparPendencia(db, pendencia.celular);
    return { mensagem: `✅ Ponto registrado: ${ROTULO_BATIDA[registro.tipo_batida]} às ${horaHHMM(new Date(registro.data_hora_batida))} (NSR ${registro.nsr}).` };
  }
  if (resposta === 'NAO') {
    await limparPendencia(db, pendencia.celular);
    return { mensagem: 'Ok, registro cancelado. Envie uma nova mensagem quando quiser bater o ponto.' };
  }
  return { mensagem: `Confirma ${ROTULO_BATIDA[tipo_batida]} às ${horaHHMM(new Date(data_hora_proposta))}? Responda SIM ou NAO.` };
}

// ============================================================================
// FLUXO: JUSTIFICAR (bateu só uma parte do ponto, esqueceu uma batida)
// ============================================================================
async function iniciarFluxoJustificar(db: Db, funcionarioNome: string, celular: string, agora: Date): Promise<ResultadoPonto> {
  const itens = diasParaMenu(agora);
  await salvarPendencia(db, celular, funcionarioNome, 'JUSTIFICAR', 'ESCOLHER_DIA', {}, agora);
  return { mensagem: `Para qual dia é a justificativa? Responda com o número:\n${montarMenuDias(itens)}\n\nOu envie CANCELAR para desistir.` };
}

async function avancarJustificar(db: Db, pendencia: PendenciaPonto, texto: string, agora: Date): Promise<ResultadoPonto> {
  const contexto = pendencia.contexto;

  if (pendencia.etapa === 'ESCOLHER_DIA') {
    const itens = diasParaMenu(agora);
    const escolha = itens.find(it => String(it.indice) === texto.trim());
    if (!escolha) {
      return { mensagem: `Não entendi. Responda com o número do dia:\n${montarMenuDias(itens)}` };
    }

    const faltantes = await batidasFaltantesNoDia(db, pendencia.funcionario_nome, escolha.dataIso);
    if (faltantes.length === 0) {
      await limparPendencia(db, pendencia.celular);
      return { mensagem: `O dia ${escolha.rotulo} já está com as 4 batidas completas. Nada para justificar.` };
    }

    await salvarPendencia(db, pendencia.celular, pendencia.funcionario_nome, 'JUSTIFICAR', 'ESCOLHER_BATIDA', { data_referencia: escolha.dataIso }, agora);
    const menuBatidas = faltantes.map((t, i) => `${i + 1}) ${ROTULO_BATIDA[t]}`).join('\n');
    return { mensagem: `Qual batida falta em ${escolha.rotulo}?\n${menuBatidas}` };
  }

  if (pendencia.etapa === 'ESCOLHER_BATIDA') {
    const dataReferencia = contexto.data_referencia;
    if (!dataReferencia) { await limparPendencia(db, pendencia.celular); return { mensagem: 'Ocorreu um erro no fluxo. Envie qualquer mensagem para recomeçar.' }; }

    const faltantes = await batidasFaltantesNoDia(db, pendencia.funcionario_nome, dataReferencia);
    const tipoEscolhido = faltantes[Number(texto.trim()) - 1];
    if (!tipoEscolhido) {
      const menuBatidas = faltantes.map((t, i) => `${i + 1}) ${ROTULO_BATIDA[t]}`).join('\n');
      return { mensagem: `Não entendi. Responda com o número da batida:\n${menuBatidas}` };
    }

    await salvarPendencia(db, pendencia.celular, pendencia.funcionario_nome, 'JUSTIFICAR', 'INFORMAR_HORARIO', { ...contexto, tipo_batida: tipoEscolhido }, agora);
    return { mensagem: `A que horas foi essa batida (${ROTULO_BATIDA[tipoEscolhido]})? Responda no formato HH:MM (ex: 08:15).` };
  }

  if (pendencia.etapa === 'INFORMAR_HORARIO') {
    const horario = extrairHorario(texto);
    if (!horario) {
      return { mensagem: 'Não entendi o horário. Responda no formato HH:MM (ex: 08:15).' };
    }
    await salvarPendencia(db, pendencia.celular, pendencia.funcionario_nome, 'JUSTIFICAR', 'INFORMAR_MOTIVO', { ...contexto, horario }, agora);
    return { mensagem: 'Qual o motivo? (ex: esqueci de bater, celular sem internet)' };
  }

  if (pendencia.etapa === 'INFORMAR_MOTIVO') {
    const motivo = texto.trim();
    if (!motivo) {
      return { mensagem: 'Preciso de um motivo, mesmo que curto. Pode escrever?' };
    }

    const { data_referencia: dataReferencia, tipo_batida: tipoBatida, horario } = contexto;
    if (!dataReferencia || !tipoBatida || !horario) {
      await limparPendencia(db, pendencia.celular);
      return { mensagem: 'Ocorreu um erro no fluxo. Envie qualquer mensagem para recomeçar.' };
    }

    const jaExiste = await existeSolicitacaoPendente(db, pendencia.funcionario_nome, dataReferencia, 'JUSTIFICATIVA_BATIDA', tipoBatida);
    await limparPendencia(db, pendencia.celular);
    if (jaExiste) {
      return { mensagem: 'Você já tem uma solicitação pendente para esse dia/batida. Aguarde o RH analisar antes de enviar outra.' };
    }

    await db.from('folha_ponto_whatsapp_solicitacoes').insert({
      tipo: 'JUSTIFICATIVA_BATIDA',
      funcionario_nome: pendencia.funcionario_nome,
      celular: pendencia.celular,
      data_referencia: dataReferencia,
      tipo_batida: tipoBatida,
      horario_solicitado: horario,
      motivo,
    });

    await registrarLogAuditoria({
      usuario_nome: 'SISTEMA (WHATSAPP)',
      acao: `SOLICITAÇÃO DE JUSTIFICATIVA: ${pendencia.funcionario_nome} — ${ROTULO_BATIDA[tipoBatida]} em ${dataReferencia}`,
      setor: 'RECURSOS HUMANOS / PONTO WHATSAPP',
    });

    return { mensagem: `✅ Solicitação enviada ao RH: ${ROTULO_BATIDA[tipoBatida]} às ${horario} em ${formatarDataBR(dataReferencia)}. Você será avisado quando for analisada.` };
  }

  await limparPendencia(db, pendencia.celular);
  return { mensagem: 'Ocorreu um erro no fluxo. Envie qualquer mensagem para recomeçar.' };
}

// Bucket privado já usado para documentos de funcionário (RH → Documentos) —
// reaproveitado aqui para atestados anexados via WhatsApp. Nunca fica
// público: a visualização é sempre por signed URL, gerada sob demanda
// (ver urlAnexoSolicitacaoAction em actions-ponto-whatsapp.ts).
const BUCKET_DOCUMENTOS_FUNCIONARIO = 'documentos-funcionarios';

const REGEX_DIACRITICOS = new RegExp('[' + String.fromCodePoint(0x300) + '-' + String.fromCodePoint(0x36f) + ']', 'g');

function slugTexto(s: string): string {
  return s.normalize('NFD').replace(REGEX_DIACRITICOS, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

const RESPOSTAS_SEM_ANEXO = ['SEM ANEXO', 'SEMANEXO', 'SEM', 'PULAR', 'NAO', 'NÃO', 'N'];

// Baixa o anexo (foto/PDF) da URL temporária do provedor (Z-API ou Meta) e
// sobe para o Storage privado do funcionário — a URL expira, então precisa
// virar arquivo nosso na hora que chega.
async function salvarAnexoAbono(db: Db, funcionarioNome: string, anexo: AnexoWhatsApp): Promise<{ path: string; nome: string }> {
  const resposta = await fetch(anexo.url, anexo.authHeader ? { headers: { Authorization: anexo.authHeader } } : undefined);
  if (!resposta.ok) throw new Error(`Falha ao baixar o anexo (HTTP ${resposta.status}).`);
  const bytes = Buffer.from(await resposta.arrayBuffer());

  const extensao = (anexo.nomeArquivo.split('.').pop() || 'bin').toLowerCase();
  const nomeBase = slugTexto(anexo.nomeArquivo.replace(/\.[^.]+$/, '')) || 'anexo';
  const path = `${slugTexto(funcionarioNome)}/atestados-whatsapp/${Date.now()}-${nomeBase}.${extensao}`;

  const { error } = await db.storage.from(BUCKET_DOCUMENTOS_FUNCIONARIO).upload(path, bytes, {
    contentType: anexo.mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`Falha ao salvar o anexo: ${error.message}`);

  return { path, nome: anexo.nomeArquivo };
}

// ============================================================================
// FLUXO: ABONAR (dia inteiro sem bater ponto — atestado, falta justificada etc.)
// ============================================================================
async function iniciarFluxoAbonar(db: Db, funcionarioNome: string, celular: string, agora: Date): Promise<ResultadoPonto> {
  const itens = diasParaMenu(agora);
  await salvarPendencia(db, celular, funcionarioNome, 'ABONAR', 'ESCOLHER_DIA', {}, agora);
  return { mensagem: `Para qual dia é o abono? Responda com o número:\n${montarMenuDias(itens)}\n\nOu envie CANCELAR para desistir.` };
}

async function avancarAbonar(db: Db, pendencia: PendenciaPonto, texto: string, agora: Date, anexo: AnexoWhatsApp | null): Promise<ResultadoPonto> {
  const contexto = pendencia.contexto;

  if (pendencia.etapa === 'ESCOLHER_DIA') {
    const itens = diasParaMenu(agora);
    const escolha = itens.find(it => String(it.indice) === texto.trim());
    if (!escolha) {
      return { mensagem: `Não entendi. Responda com o número do dia:\n${montarMenuDias(itens)}` };
    }
    await salvarPendencia(db, pendencia.celular, pendencia.funcionario_nome, 'ABONAR', 'INFORMAR_MOTIVO', { data_referencia: escolha.dataIso }, agora);
    return { mensagem: `Qual o motivo do abono em ${escolha.rotulo}? (ex: atestado médico, falta justificada)` };
  }

  if (pendencia.etapa === 'INFORMAR_MOTIVO') {
    const motivo = texto.trim();
    if (!motivo) {
      return { mensagem: 'Preciso de um motivo, mesmo que curto. Pode escrever?' };
    }
    await salvarPendencia(db, pendencia.celular, pendencia.funcionario_nome, 'ABONAR', 'ANEXAR_ATESTADO', { ...contexto, motivo }, agora);
    return { mensagem: 'Se tiver atestado ou outro documento, envie a foto ou o PDF agora. Ou responda SEM ANEXO para continuar sem.' };
  }

  if (pendencia.etapa === 'ANEXAR_ATESTADO') {
    const dataReferencia = contexto.data_referencia;
    const motivo = contexto.motivo;
    if (!dataReferencia || !motivo) {
      await limparPendencia(db, pendencia.celular);
      return { mensagem: 'Ocorreu um erro no fluxo. Envie qualquer mensagem para recomeçar.' };
    }

    let anexoSalvo: { path: string; nome: string } | null = null;
    if (anexo) {
      try {
        anexoSalvo = await salvarAnexoAbono(db, pendencia.funcionario_nome, anexo);
      } catch {
        return { mensagem: 'Não consegui salvar o arquivo enviado. Tente reenviar a foto/PDF, ou responda SEM ANEXO para continuar sem.' };
      }
    } else if (!RESPOSTAS_SEM_ANEXO.includes(texto.trim().toUpperCase())) {
      return { mensagem: 'Não entendi. Envie a foto/PDF do atestado, ou responda SEM ANEXO para continuar sem.' };
    }

    const jaExiste = await existeSolicitacaoPendente(db, pendencia.funcionario_nome, dataReferencia, 'ABONO_DIA', null);
    await limparPendencia(db, pendencia.celular);
    if (jaExiste) {
      return { mensagem: 'Você já tem uma solicitação de abono pendente para esse dia. Aguarde o RH analisar.' };
    }

    await db.from('folha_ponto_whatsapp_solicitacoes').insert({
      tipo: 'ABONO_DIA',
      funcionario_nome: pendencia.funcionario_nome,
      celular: pendencia.celular,
      data_referencia: dataReferencia,
      dia_todo: true,
      motivo,
      anexo_path: anexoSalvo?.path || null,
      anexo_nome: anexoSalvo?.nome || null,
    });

    await registrarLogAuditoria({
      usuario_nome: 'SISTEMA (WHATSAPP)',
      acao: `SOLICITAÇÃO DE ABONO: ${pendencia.funcionario_nome} — ${dataReferencia}${anexoSalvo ? ' (com anexo)' : ''}`,
      setor: 'RECURSOS HUMANOS / PONTO WHATSAPP',
    });

    return { mensagem: `✅ Solicitação de abono enviada ao RH para ${formatarDataBR(dataReferencia)}${anexoSalvo ? ' (com anexo)' : ''}. Você será avisado quando for analisada.` };
  }

  await limparPendencia(db, pendencia.celular);
  return { mensagem: 'Ocorreu um erro no fluxo. Envie qualquer mensagem para recomeçar.' };
}

// ============================================================================
// FLUXO: MENU_INICIAL (toda primeira mensagem do funcionário cai aqui)
// ============================================================================
async function avancarMenuInicial(db: Db, pendencia: PendenciaPonto, texto: string, agora: Date): Promise<ResultadoPonto> {
  const escolha = texto.trim().toUpperCase();
  if (['1', 'PONTO', 'REGISTRAR PONTO'].includes(escolha)) {
    return await iniciarFluxoConfirmarBatida(db, pendencia.funcionario_nome, pendencia.celular, agora);
  }
  if (['2', 'JUSTIFICAR'].includes(escolha)) {
    return await iniciarFluxoJustificar(db, pendencia.funcionario_nome, pendencia.celular, agora);
  }
  if (['3', 'ABONAR'].includes(escolha)) {
    return await iniciarFluxoAbonar(db, pendencia.funcionario_nome, pendencia.celular, agora);
  }
  return { mensagem: `Não entendi. Responda só com o número:\n${montarMenuInicial()}` };
}

// ============================================================================
// ROTEADOR PRINCIPAL — chamado pelo webhook (app/api/webhooks/zapi-ponto)
// ============================================================================
export async function processarMensagemPontoWhatsApp(payload: {
  telefone: string;
  texto: string;
  messageId: string | null;
  anexo?: AnexoWhatsApp | null;
  payloadBruto?: unknown;
}): Promise<ResultadoPonto | null> {
  const texto = (payload.texto || '').trim();

  const db = supabaseAdmin();

  // Registra que este número acabou de falar com a gente — é o que abre a
  // janela de 24h de atendimento da Meta (ver janelaAbertaParaCelular em
  // app/lib/whatsapp.ts), usada pelas notificações de aprovação/rejeição de
  // ponto pra saber se pode mandar texto livre ou precisa de um Message
  // Template aprovado. O client do Supabase não lança exceção em erro (só
  // devolve `{ error }`), então isso nunca interrompe o fluxo de ponto.
  await db.from('folha_whatsapp_janela').upsert({ celular: payload.telefone, ultima_mensagem_em: new Date().toISOString() });

  const funcionario = await buscarFuncionarioPorCelular(db, payload.telefone);
  if (!funcionario) {
    await registrarLogAuditoria({
      usuario_nome: 'SISTEMA (WHATSAPP)',
      acao: `TENTATIVA DE PONTO DE NÚMERO NÃO HABILITADO: ${payload.telefone}`,
      setor: 'RECURSOS HUMANOS / PONTO WHATSAPP',
    });
    return { mensagem: 'Não localizamos seu número no cadastro de ponto via WhatsApp. Fale com o RH.' };
  }

  const agora = new Date();
  const pendencia = await buscarPendenciaValida(db, payload.telefone, agora);

  if (pendencia) {
    if (texto.toUpperCase() === 'CANCELAR' && (pendencia.fluxo === 'JUSTIFICAR' || pendencia.fluxo === 'ABONAR')) {
      await limparPendencia(db, payload.telefone);
      return { mensagem: 'Ok, solicitação cancelada.' };
    }
    if (pendencia.fluxo === 'MENU_INICIAL') {
      return await avancarMenuInicial(db, pendencia, texto, agora);
    }
    if (pendencia.fluxo === 'CONFIRMAR_BATIDA') {
      return await avancarConfirmarBatida(db, pendencia, texto, payload.messageId, payload.payloadBruto);
    }
    if (pendencia.fluxo === 'JUSTIFICAR') {
      return await avancarJustificar(db, pendencia, texto, agora);
    }
    return await avancarAbonar(db, pendencia, texto, agora, payload.anexo ?? null);
  }

  // Toda primeira mensagem (sem pendência ativa) mostra o menu de opções —
  // o funcionário responde só com o número (1/2/3) na próxima mensagem.
  await salvarPendencia(db, payload.telefone, funcionario.nome_completo, 'MENU_INICIAL', 'ESCOLHER_OPCAO', {}, agora);
  return { mensagem: montarMenuInicial() };
}
