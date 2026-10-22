"use server";

// app/portal/actions/actions-ponto.ts
// Espelho de ponto do PRÓPRIO funcionário logado, só leitura. Mesma lógica de
// montagem dia a dia usada em actions-assinatura.ts (gerarEspelhoPontoBytes),
// mas devolvendo os dados prontos para a tabela do Portal e, opcionalmente,
// o PDF gerado sob demanda (não há PDF arquivado fora do fluxo de assinatura
// de holerite — aqui ele é gerado na hora, não persistido).
//
// A partir daqui este arquivo também expõe a criação de solicitações de
// JUSTIFICATIVA_BATIDA/ABONO_DIA direto do Portal (aba Espelho de Ponto),
// reaproveitando a MESMA tabela/fila/aprovação do fluxo WhatsApp (ver
// app/lib/pontoWhatsapp.ts e app/admin/rh/actions/actions-ponto-whatsapp.ts)
// — o colaborador nunca grava um ajuste/abono de verdade por aqui, só cria a
// solicitação PENDENTE; quem aprova é sempre o RH/Operacional.
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';
import { gerarEspelhoPontoPdf } from '../../lib/gerarEspelhoPontoPdf';
import { montarEspelhoDoMes } from '../lib/espelhoPonto';
import { existeSolicitacaoPendente, type TipoBatida } from '../../lib/pontoWhatsapp';
import { notificarPush } from '../../lib/push';
import { registrarLogAuditoria } from '../../actions';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';
const SETOR_AUDITORIA = 'RECURSOS HUMANOS / PONTO WHATSAPP';

const ROTULO_BATIDA: Record<TipoBatida, string> = { ENTRADA_1: 'Entrada', SAIDA_1: 'Saída', ENTRADA_2: 'Entrada', SAIDA_2: 'Saída' };
const formatarDataBR = (dataIso: string) => dataIso.split('-').reverse().join('/');

// Hoje em São Paulo, como data pura (sem hora) — mesmo critério usado pro
// Espelho de Ponto não deixar aparecer dias futuros.
function hojeIsoSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export async function buscarMeuEspelhoPontoAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const espelho = await montarEspelhoDoMes(db, func.funcionarioNome, mesReferencia);
    return { ok: true, info: espelho };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarMeuEspelhoPontoPdfAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const espelho = await montarEspelhoDoMes(db, func.funcionarioNome, mesReferencia);
    const bytes = await gerarEspelhoPontoPdf({
      nome: func.funcionarioNome,
      cpf: espelho.cpf,
      mesReferencia,
      registros: espelho.registros,
      feriados: espelho.feriados,
      dataAdmissao: espelho.dataAdmissao,
      dataDesligamento: espelho.dataDesligamento,
      empresaNome: espelho.empresaNome,
    });
    return { ok: true, info: { pdfBase64: Buffer.from(bytes).toString('base64') } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface MinhaSolicitacaoPonto {
  id: number;
  tipo: 'JUSTIFICATIVA_BATIDA' | 'ABONO_DIA';
  data_referencia: string;
  tipo_batida: TipoBatida | null;
  horario_solicitado: string | null;
  motivo: string;
  status: 'PENDENTE' | 'APROVADA' | 'REJEITADA';
  motivo_rejeicao: string | null;
}

// Solicitações de Justificativa/Abono do PRÓPRIO funcionário no mês — pra a
// aba Espelho de Ponto saber, por dia, se já existe pedido (pendente ou já
// analisado) antes de oferecer o botão de novo, e mostrar o status de quem
// já foi enviado. FOLGA_DIA fica de fora de propósito: aquele fluxo já tem
// tela própria (solicitação de folga, ver project_ponto_whatsapp_folga).
export async function listarMinhasSolicitacoesPontoAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const [ano, mes] = mesReferencia.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const dataFim = `${ano}-${mes}-${String(new Date(Number(ano), Number(mes), 0).getDate()).padStart(2, '0')}`;

    const { data, error } = await db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('id, tipo, data_referencia, tipo_batida, horario_solicitado, motivo, status, motivo_rejeicao')
      .eq('funcionario_nome', func.funcionarioNome)
      .neq('tipo', 'FOLGA_DIA')
      .gte('data_referencia', dataInicio)
      .lte('data_referencia', dataFim);
    if (error) throw new Error(error.message);
    return { ok: true, info: (data || []) as MinhaSolicitacaoPonto[] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Celular + empresa do funcionário logado — mesmo par de dados que o fluxo
// WhatsApp já carrega a cada gravação (ver empresaIdDoFuncionario em
// app/lib/pontoWhatsapp.ts); aqui também precisa do celular (pra notificação
// de aprovação/rejeição, que continua saindo por WhatsApp mesmo quando o
// pedido nasceu no Portal).
async function celularEEmpresaDoFuncionario(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string): Promise<{ celular: string | null; empresaId: number | null }> {
  const { data } = await db.from('folha_funcionarios').select('celular, empresa_id').eq('nome_completo', funcionarioNome).maybeSingle();
  return { celular: data?.celular || null, empresaId: data?.empresa_id ?? null };
}

const BATIDAS_VALIDAS: TipoBatida[] = ['ENTRADA_1', 'SAIDA_1', 'ENTRADA_2', 'SAIDA_2'];

// Cria a solicitação de JUSTIFICATIVA_BATIDA pelo Portal — equivalente ao
// fluxo JUSTIFICAR do WhatsApp (avancarJustificar em app/lib/pontoWhatsapp.ts),
// só que o colaborador já escolhe a batida certa na tela em vez de navegar
// por um menu numerado. Nunca grava o ajuste direto: só a fila de aprovação.
export async function solicitarJustificativaBatidaAction(
  payload: { dataReferencia: string; tipoBatida: TipoBatida; horario: string; motivo: string },
  accessToken: string
): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const { dataReferencia, tipoBatida, horario, motivo } = payload;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia || '')) return { ok: false, erro: 'Data inválida.' };
  if (dataReferencia > hojeIsoSaoPaulo()) return { ok: false, erro: 'Não é possível justificar um dia futuro.' };
  if (!BATIDAS_VALIDAS.includes(tipoBatida)) return { ok: false, erro: 'Batida inválida.' };
  if (!/^\d{2}:\d{2}$/.test(horario || '')) return { ok: false, erro: 'Informe um horário válido.' };
  if (!motivo?.trim()) return { ok: false, erro: 'Informe o motivo.' };

  const db = supabaseAdmin();
  try {
    const jaExiste = await existeSolicitacaoPendente(db, func.funcionarioNome, dataReferencia, 'JUSTIFICATIVA_BATIDA', tipoBatida);
    if (jaExiste) return { ok: false, erro: 'Você já tem uma solicitação pendente para esse dia/batida. Aguarde a análise.' };

    const { celular, empresaId } = await celularEEmpresaDoFuncionario(db, func.funcionarioNome);
    const { error } = await db.from('folha_ponto_whatsapp_solicitacoes').insert({
      tipo: 'JUSTIFICATIVA_BATIDA',
      funcionario_nome: func.funcionarioNome,
      empresa_id: empresaId,
      celular,
      data_referencia: dataReferencia,
      tipo_batida: tipoBatida,
      horario_solicitado: horario,
      motivo: motivo.trim(),
    });
    if (error) throw new Error(error.message);

    await registrarLogAuditoria({
      usuario_nome: `${func.funcionarioNome} (PORTAL)`,
      acao: `SOLICITAÇÃO DE JUSTIFICATIVA: ${func.funcionarioNome} — ${ROTULO_BATIDA[tipoBatida]} em ${dataReferencia}`,
      setor: SETOR_AUDITORIA,
    });

    try {
      await notificarPush('/mobile/ponto', 'Nova justificativa de ponto', `${func.funcionarioNome} pediu justificativa de ${ROTULO_BATIDA[tipoBatida]} em ${formatarDataBR(dataReferencia)}.`, { tipo: 'ponto' });
    } catch (e) {
      console.error('Falha ao notificar aprovadores sobre nova justificativa (Portal):', e);
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Cria a solicitação de ABONO_DIA pelo Portal — equivalente ao fluxo ABONAR
// do WhatsApp, sem o anexo de atestado (o WhatsApp aceita foto/PDF no meio da
// conversa; aqui o colaborador pode enviar o atestado depois pelo RH/pela
// própria aba Documentos — não duplicar o upload direto pra Storage aqui por
// ora). Nunca abona direto: só cria a solicitação PENDENTE.
export async function solicitarAbonoDiaAction(
  payload: { dataReferencia: string; motivo: string },
  accessToken: string
): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const { dataReferencia, motivo } = payload;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia || '')) return { ok: false, erro: 'Data inválida.' };
  if (dataReferencia > hojeIsoSaoPaulo()) return { ok: false, erro: 'Não é possível pedir abono de um dia futuro.' };
  if (!motivo?.trim()) return { ok: false, erro: 'Informe o motivo.' };

  const db = supabaseAdmin();
  try {
    const jaExiste = await existeSolicitacaoPendente(db, func.funcionarioNome, dataReferencia, 'ABONO_DIA', null);
    if (jaExiste) return { ok: false, erro: 'Você já tem uma solicitação de abono pendente para esse dia. Aguarde a análise.' };

    const { celular, empresaId } = await celularEEmpresaDoFuncionario(db, func.funcionarioNome);
    const { error } = await db.from('folha_ponto_whatsapp_solicitacoes').insert({
      tipo: 'ABONO_DIA',
      funcionario_nome: func.funcionarioNome,
      empresa_id: empresaId,
      celular,
      data_referencia: dataReferencia,
      dia_todo: true,
      motivo: motivo.trim(),
    });
    if (error) throw new Error(error.message);

    await registrarLogAuditoria({
      usuario_nome: `${func.funcionarioNome} (PORTAL)`,
      acao: `SOLICITAÇÃO DE ABONO: ${func.funcionarioNome} — ${dataReferencia}`,
      setor: SETOR_AUDITORIA,
    });

    try {
      await notificarPush('/mobile/ponto', 'Nova solicitação de abono', `${func.funcionarioNome} pediu abono em ${formatarDataBR(dataReferencia)}.`, { tipo: 'ponto' });
    } catch (e) {
      console.error('Falha ao notificar aprovadores sobre novo abono (Portal):', e);
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
