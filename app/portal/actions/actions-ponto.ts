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
import { existeSolicitacaoPendente, validarPeriodoFolga, formatarPeriodoBR, MAX_DIAS_PERIODO_FOLGA, type TipoBatida } from '../../lib/pontoWhatsapp';
import { dispararAutomacoesPorEventoWhatsApp } from '../../lib/automacoes';
import { notificarPush } from '../../lib/push';
import { filtrarFicha, filtrarPorFuncionario, type RefOuNome } from '../../lib/funcionarioRef';
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
    const espelho = await montarEspelhoDoMes(db, func, mesReferencia);
    return { ok: true, info: espelho };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

export async function baixarMeuEspelhoPontoPdfAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const espelho = await montarEspelhoDoMes(db, func, mesReferencia);
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
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
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

    const { data, error } = await filtrarPorFuncionario(db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('id, tipo, data_referencia, tipo_batida, horario_solicitado, motivo, status, motivo_rejeicao'), func)
      .neq('tipo', 'FOLGA_DIA')
      .gte('data_referencia', dataInicio)
      .lte('data_referencia', dataFim);
    if (error) throw new Error(error.message);
    return { ok: true, info: (data || []) as MinhaSolicitacaoPonto[] };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

// Celular + empresa do funcionário logado — mesmo par de dados que o fluxo
// WhatsApp já carrega a cada gravação (ver empresaIdDoFuncionario em
// app/lib/pontoWhatsapp.ts); aqui também precisa do celular (pra notificação
// de aprovação/rejeição, que continua saindo por WhatsApp mesmo quando o
// pedido nasceu no Portal).
async function celularEEmpresaDoFuncionario(db: ReturnType<typeof supabaseAdmin>, funcionario: RefOuNome): Promise<{ celular: string | null; empresaId: number | null }> {
  const { data } = await filtrarFicha(db.from('folha_funcionarios').select('celular, empresa_id'), funcionario).maybeSingle();
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
    const jaExiste = await existeSolicitacaoPendente(db, func, dataReferencia, 'JUSTIFICATIVA_BATIDA', tipoBatida);
    if (jaExiste) return { ok: false, erro: 'Você já tem uma solicitação pendente para esse dia/batida. Aguarde a análise.' };

    const { celular, empresaId } = await celularEEmpresaDoFuncionario(db, func);
    const { error } = await db.from('folha_ponto_whatsapp_solicitacoes').insert({
      tipo: 'JUSTIFICATIVA_BATIDA',
      funcionario_nome: func.funcionarioNome,
      ...(func.funcionarioId ? { funcionario_id: func.funcionarioId } : {}),
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
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

// Atestado do abono (foto ou PDF): o navegador sobe DIRETO pro Storage privado
// por um link assinado (server action tem limite de corpo — o mesmo 413 dos
// documentos), no mesmo bucket do atestado que chega pelo WhatsApp
// (salvarAnexoAbono em app/lib/pontoWhatsapp.ts). O RH abre pelo "Ver anexo"
// (urlAnexoSolicitacaoAction), com link de 10 minutos — dado de saúde (LGPD).
const BUCKET_ATESTADOS = 'documentos-funcionarios';
const LIMITE_ATESTADO_MB = 10;
const TIPO_ATESTADO_OK = /^(image\/[a-z0-9.+-]+|application\/pdf)$/i;
const EXTENSAO_ATESTADO_OK = /\.(jpe?g|png|webp|heic|heif|gif|pdf)$/i;

function slugTexto(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}
const prefixoAtestado = (funcionarioNome: string) => `${slugTexto(funcionarioNome)}/atestados-portal/`;

function validarDiaAbono(dataReferencia: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia || '')) return 'Data inválida.';
  if (dataReferencia > hojeIsoSaoPaulo()) return 'Não é possível pedir abono de um dia futuro.';
  return null;
}

// 1º passo do envio do atestado: confere o arquivo e o dia (sem pedido
// pendente, pra não deixar arquivo solto) e devolve o link assinado de upload.
export async function urlUploadAtestadoAction(
  payload: { dataReferencia: string; nomeArquivo: string; tamanho: number; tipo: string },
  accessToken: string
): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const erroDia = validarDiaAbono(payload.dataReferencia);
  if (erroDia) return { ok: false, erro: erroDia };
  const nomeArquivo = String(payload.nomeArquivo || '');
  if (!TIPO_ATESTADO_OK.test(payload.tipo || '') && !EXTENSAO_ATESTADO_OK.test(nomeArquivo)) return { ok: false, erro: 'Envie uma foto ou um PDF.' };
  if (!(Number(payload.tamanho) > 0)) return { ok: false, erro: 'O arquivo está vazio.' };
  if (Number(payload.tamanho) > LIMITE_ATESTADO_MB * 1024 * 1024) return { ok: false, erro: `Arquivo acima de ${LIMITE_ATESTADO_MB} MB.` };

  const db = supabaseAdmin();
  try {
    if (await existeSolicitacaoPendente(db, func, payload.dataReferencia, 'ABONO_DIA', null)) {
      return { ok: false, erro: 'Você já tem uma solicitação de abono pendente para esse dia. Aguarde a análise.' };
    }
    const extensao = (nomeArquivo.includes('.') ? nomeArquivo.split('.').pop() || '' : '').toLowerCase();
    const nomeBase = slugTexto(nomeArquivo.replace(/\.[^.]+$/, '')).slice(0, 60) || 'atestado';
    const caminho = `${prefixoAtestado(func.funcionarioNome)}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nomeBase}${/^[a-z0-9]{2,5}$/.test(extensao) ? '.' + extensao : ''}`;
    const { data, error } = await db.storage.from(BUCKET_ATESTADOS).createSignedUploadUrl(caminho);
    if (error) throw new Error(error.message);
    return { ok: true, info: { bucket: BUCKET_ATESTADOS, caminho, token: data.token } };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

// Cria a solicitação de ABONO_DIA pelo Portal — equivalente ao fluxo ABONAR
// do WhatsApp, com o atestado opcional (já enviado ao Storage por
// urlUploadAtestadoAction). Nunca abona direto: só cria a solicitação PENDENTE.
export async function solicitarAbonoDiaAction(
  payload: { dataReferencia: string; motivo: string; anexo?: { caminho: string; nome: string } | null },
  accessToken: string
): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const { dataReferencia, motivo, anexo } = payload;
  const erroDia = validarDiaAbono(dataReferencia);
  if (erroDia) return { ok: false, erro: erroDia };
  if (!motivo?.trim()) return { ok: false, erro: 'Informe o motivo.' };

  const db = supabaseAdmin();
  // o anexo só vale se estiver na pasta do PRÓPRIO funcionário e existir de fato
  let anexoOk: { caminho: string; nome: string } | null = null;
  if (anexo?.caminho) {
    const prefixo = prefixoAtestado(func.funcionarioNome);
    const caminho = String(anexo.caminho);
    const arquivo = caminho.slice(prefixo.length);
    if (!caminho.startsWith(prefixo) || !arquivo || arquivo.includes('/') || caminho.includes('..')) return { ok: false, erro: 'Anexo inválido.' };
    const { data: achados } = await db.storage.from(BUCKET_ATESTADOS).list(prefixo.slice(0, -1), { search: arquivo, limit: 5 });
    if (!(achados || []).some(o => o.name === arquivo)) return { ok: false, erro: 'O atestado não chegou. Envie de novo.' };
    anexoOk = { caminho, nome: String(anexo.nome || 'atestado').slice(0, 120) };
  }
  const descartarAnexo = async () => {
    if (anexoOk) await db.storage.from(BUCKET_ATESTADOS).remove([anexoOk.caminho]).catch(() => {});
  };

  try {
    const jaExiste = await existeSolicitacaoPendente(db, func, dataReferencia, 'ABONO_DIA', null);
    if (jaExiste) {
      await descartarAnexo();
      return { ok: false, erro: 'Você já tem uma solicitação de abono pendente para esse dia. Aguarde a análise.' };
    }

    const { celular, empresaId } = await celularEEmpresaDoFuncionario(db, func);
    const { error } = await db.from('folha_ponto_whatsapp_solicitacoes').insert({
      tipo: 'ABONO_DIA',
      funcionario_nome: func.funcionarioNome,
      ...(func.funcionarioId ? { funcionario_id: func.funcionarioId } : {}),
      empresa_id: empresaId,
      celular,
      data_referencia: dataReferencia,
      dia_todo: true,
      motivo: motivo.trim(),
      anexo_path: anexoOk?.caminho || null,
      anexo_nome: anexoOk?.nome || null,
    });
    if (error) { await descartarAnexo(); throw new Error(error.message); }

    await registrarLogAuditoria({
      usuario_nome: `${func.funcionarioNome} (PORTAL)`,
      acao: `SOLICITAÇÃO DE ABONO: ${func.funcionarioNome} — ${dataReferencia}${anexoOk ? ' (com anexo)' : ''}`,
      setor: SETOR_AUDITORIA,
    });

    try {
      await notificarPush('/mobile/ponto', 'Nova solicitação de abono', `${func.funcionarioNome} pediu abono em ${formatarDataBR(dataReferencia)}.`, { tipo: 'ponto' });
    } catch (e) {
      console.error('Falha ao notificar aprovadores sobre novo abono (Portal):', e);
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

// ============================================================================
// FOLGA pelo Portal — equivalente à opção 4 do WhatsApp (avancarFolgar em
// app/lib/pontoWhatsapp.ts): mesma regra de período, mesma fila FOLGA_DIA,
// mesmo aviso aos gestores (automação "Solicitação Folga") e push. Quem aprova
// é o RH ou o gestor do Operacional; nunca grava abono direto.
// ============================================================================
export interface MinhaFolga {
  id: number;
  data_referencia: string;
  data_referencia_fim: string | null;
  motivo: string;
  status: 'PENDENTE' | 'APROVADA' | 'REJEITADA';
  motivo_rejeicao: string | null;
}

const ERROS_PERIODO_FOLGA: Record<'FORMATO' | 'PASSADO' | 'ORDEM' | 'PERIODO_LONGO', string> = {
  FORMATO: 'Data inválida.',
  PASSADO: 'A folga não pode começar no passado.',
  ORDEM: 'A data final não pode ser antes da inicial.',
  PERIODO_LONGO: `O período não pode passar de ${MAX_DIAS_PERIODO_FOLGA} dias corridos. Para mais tempo, fale com o RH (férias e afastamentos).`,
};

export async function solicitarFolgaAction(
  payload: { inicio: string; fim: string; motivo: string },
  accessToken: string
): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const inicio = String(payload.inicio || '');
  const fim = String(payload.fim || '') || inicio;
  const motivo = String(payload.motivo || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) return { ok: false, erro: ERROS_PERIODO_FOLGA.FORMATO };
  const periodo = validarPeriodoFolga(inicio, fim, new Date());
  if (!periodo.ok) return { ok: false, erro: ERROS_PERIODO_FOLGA[periodo.erro] };
  if (!motivo) return { ok: false, erro: 'Informe o motivo.' };

  const db = supabaseAdmin();
  try {
    if (await existeSolicitacaoPendente(db, func, inicio, 'FOLGA_DIA', null)) {
      return { ok: false, erro: 'Você já tem uma solicitação de folga pendente começando nessa data. Aguarde a análise.' };
    }

    const { celular, empresaId } = await celularEEmpresaDoFuncionario(db, func);
    const { error } = await db.from('folha_ponto_whatsapp_solicitacoes').insert({
      tipo: 'FOLGA_DIA',
      funcionario_nome: func.funcionarioNome,
      ...(func.funcionarioId ? { funcionario_id: func.funcionarioId } : {}),
      empresa_id: empresaId,
      celular,
      data_referencia: inicio,
      data_referencia_fim: fim,
      dia_todo: true,
      motivo,
    });
    if (error) throw new Error(error.message);

    const periodoBR = formatarPeriodoBR(inicio, fim);
    await registrarLogAuditoria({
      usuario_nome: `${func.funcionarioNome} (PORTAL)`,
      acao: `SOLICITAÇÃO DE FOLGA: ${func.funcionarioNome} — ${periodoBR}`,
      setor: SETOR_AUDITORIA,
    });

    try {
      await dispararAutomacoesPorEventoWhatsApp('SOLICITACAO_FOLGA', { solicitante: func.funcionarioNome, periodo: periodoBR, motivo });
    } catch (e) {
      console.error('Falha ao notificar gestores sobre nova solicitação de folga (Portal):', e);
    }
    try {
      await notificarPush('/mobile/ponto', 'Nova solicitação de folga', `${func.funcionarioNome} pediu folga em ${periodoBR}.`, { tipo: 'ponto' });
    } catch (e) {
      console.error('Falha ao notificar aprovadores sobre nova folga (Portal):', e);
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

// Folgas do PRÓPRIO funcionário: as que ainda não acabaram e as dos últimos
// 60 dias, pra ele acompanhar o status sem depender do WhatsApp.
export async function listarMinhasFolgasAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const desde = new Date(Date.now() - 60 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const { data, error } = await filtrarPorFuncionario(db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('id, data_referencia, data_referencia_fim, motivo, status, motivo_rejeicao'), func)
      .eq('tipo', 'FOLGA_DIA')
      .or(`data_referencia_fim.gte.${desde},and(data_referencia_fim.is.null,data_referencia.gte.${desde})`)
      .order('data_referencia', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { ok: true, info: (data || []) as MinhaFolga[] };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}
