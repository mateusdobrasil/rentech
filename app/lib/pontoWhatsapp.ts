// Ponto via WhatsApp: motor da conversa (menu com confirmação), matching do
// funcionário por celular, e consolidação das batidas confirmadas em
// folha_ponto_diaria. O ledger em si (folha_ponto_whatsapp_registros) é
// append-only — NSR e cadeia de hash são calculados por trigger no banco
// (ver folha_ponto_whatsapp.sql). Esta lib nunca edita/apaga uma batida já
// confirmada, só grava novas ou lança ajustes aditivos.
import { supabaseAdmin } from './supabase';
import { registrarLogAuditoria } from '../actions';

export type TipoBatida = 'ENTRADA_1' | 'SAIDA_1' | 'ENTRADA_2' | 'SAIDA_2';

const ORDEM_BATIDAS: TipoBatida[] = ['ENTRADA_1', 'SAIDA_1', 'ENTRADA_2', 'SAIDA_2'];

const ROTULO_BATIDA: Record<TipoBatida, string> = {
  ENTRADA_1: 'Entrada',
  SAIDA_1: 'Saída (almoço)',
  ENTRADA_2: 'Volta do almoço',
  SAIDA_2: 'Saída',
};

const MINUTOS_EXPIRACAO_PENDENCIA = 5;

export interface ResultadoPonto {
  mensagem: string;
}

interface PendenciaPonto {
  celular: string;
  funcionario_nome: string;
  tipo_batida_proposto: TipoBatida;
  data_hora_proposta: string;
  zapi_message_id_origem: string | null;
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

function normalizarResposta(texto: string): 'SIM' | 'NAO' | 'OUTRO' {
  const t = texto.trim().toUpperCase();
  if (['SIM', 'S', '1', 'YES', 'OK', 'CONFIRMAR'].includes(t)) return 'SIM';
  if (['NAO', 'NÃO', 'N', '2', 'NO', 'CANCELAR'].includes(t)) return 'NAO';
  return 'OUTRO';
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

async function proximaBatidaDoDia(db: Db, funcionarioNome: string, dataReferencia: string): Promise<TipoBatida | null> {
  const [{ data: batidas }, { data: ajustes }] = await Promise.all([
    db.from('folha_ponto_whatsapp_registros').select('tipo_batida').eq('funcionario_nome', funcionarioNome).eq('data_referencia', dataReferencia),
    db.from('folha_ponto_whatsapp_ajustes').select('tipo_batida').eq('funcionario_nome', funcionarioNome).eq('data_referencia', dataReferencia),
  ]);

  const jaFeitas = new Set<string>([
    ...(batidas || []).map((b) => b.tipo_batida),
    ...(ajustes || []).map((a) => a.tipo_batida),
  ]);
  return ORDEM_BATIDAS.find(t => !jaFeitas.has(t)) || null;
}

async function buscarPendenciaValida(db: Db, celular: string, agora: Date): Promise<PendenciaPonto | null> {
  const { data } = await db.from('folha_ponto_whatsapp_pendencias').select('*').eq('celular', celular).maybeSingle();
  if (!data) return null;
  if (new Date(data.expira_em).getTime() < agora.getTime()) {
    await db.from('folha_ponto_whatsapp_pendencias').delete().eq('celular', celular);
    return null;
  }
  return data;
}

// Reconstrói o dia (batidas do ledger + ajustes) e sobrescreve a linha
// WHATSAPP de folha_ponto_diaria. Nunca toca em linhas de origem
// CSV_PONTOMAIS: se o dia já tem ponto importado do Pontomais, a
// consolidação é pulada e um aviso é logado para o RH conciliar (o registro
// no ledger legal acontece de qualquer forma, isto só afeta o relatório).
async function consolidarDia(db: Db, funcionarioNome: string, dataReferencia: string): Promise<void> {
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

async function confirmarBatida(db: Db, pendencia: PendenciaPonto, messageId: string | null, payloadBruto: unknown): Promise<{ nsr: number; tipo_batida: TipoBatida; data_hora_batida: string }> {
  const dataHoraProposta = new Date(pendencia.data_hora_proposta);
  const dataReferencia = dataReferenciaBR(dataHoraProposta);

  const { data, error } = await db.from('folha_ponto_whatsapp_registros').insert({
    funcionario_nome: pendencia.funcionario_nome,
    celular: pendencia.celular,
    tipo_batida: pendencia.tipo_batida_proposto,
    data_referencia: dataReferencia,
    data_hora_batida: pendencia.data_hora_proposta,
    zapi_message_id: messageId,
    payload_bruto: payloadBruto ?? null,
  }).select('nsr, tipo_batida, data_hora_batida').single();

  if (error) throw new Error(`Falha ao gravar a batida no ledger: ${error.message}`);

  await consolidarDia(db, pendencia.funcionario_nome, dataReferencia);
  await db.from('folha_ponto_whatsapp_pendencias').delete().eq('celular', pendencia.celular);

  return data as { nsr: number; tipo_batida: TipoBatida; data_hora_batida: string };
}

// Ponto de entrada único chamado pelo webhook (app/api/webhooks/zapi-ponto).
// Recebe já os campos extraídos do payload cru da Z-API e devolve o texto de
// resposta a ser enviado de volta via enviarWhatsApp.
export async function processarMensagemPontoWhatsApp(payload: {
  telefone: string;
  texto: string;
  messageId: string | null;
  payloadBruto?: unknown;
}): Promise<ResultadoPonto | null> {
  const texto = (payload.texto || '').trim();
  if (!texto) {
    return { mensagem: 'Não entendi sua mensagem. Envie qualquer texto para iniciar o registro de ponto.' };
  }

  const db = supabaseAdmin();
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
    const resposta = normalizarResposta(texto);
    if (resposta === 'SIM') {
      const registro = await confirmarBatida(db, pendencia, payload.messageId, payload.payloadBruto);
      return { mensagem: `✅ Ponto registrado: ${ROTULO_BATIDA[registro.tipo_batida]} às ${horaHHMM(new Date(registro.data_hora_batida))} (NSR ${registro.nsr}).` };
    }
    if (resposta === 'NAO') {
      await db.from('folha_ponto_whatsapp_pendencias').delete().eq('celular', payload.telefone);
      return { mensagem: 'Ok, registro cancelado. Envie uma nova mensagem quando quiser bater o ponto.' };
    }
    return { mensagem: `Confirma ${ROTULO_BATIDA[pendencia.tipo_batida_proposto]} às ${horaHHMM(new Date(pendencia.data_hora_proposta))}? Responda SIM ou NAO.` };
  }

  const dataReferencia = dataReferenciaBR(agora);
  const proxima = await proximaBatidaDoDia(db, funcionario.nome_completo, dataReferencia);
  if (!proxima) {
    return { mensagem: 'Todas as batidas de hoje já foram registradas. Se precisar corrigir algo, fale com o RH.' };
  }

  await db.from('folha_ponto_whatsapp_pendencias').upsert({
    celular: payload.telefone,
    funcionario_nome: funcionario.nome_completo,
    tipo_batida_proposto: proxima,
    data_hora_proposta: agora.toISOString(),
    zapi_message_id_origem: payload.messageId,
    expira_em: new Date(agora.getTime() + MINUTOS_EXPIRACAO_PENDENCIA * 60000).toISOString(),
  });

  return { mensagem: `Confirma ${ROTULO_BATIDA[proxima]} às ${horaHHMM(agora)}? Responda SIM ou NAO.` };
}
