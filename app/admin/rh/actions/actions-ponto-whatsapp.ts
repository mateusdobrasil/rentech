'use server';

// app/admin/rh/actions/actions-ponto-whatsapp.ts
// Server actions para a tela de Ponto: estatísticas, o ledger (somente-
// leitura, é append-only) das batidas confirmadas via WhatsApp, e a fila de
// aprovação de JUSTIFICAR/ABONAR. O ledger em si nunca é editado/apagado
// por aqui — só o webhook (app/api/webhooks/zapi-ponto) grava nele. As
// solicitações de justificativa/abono, por outro lado, só viram ajuste/abono
// de verdade quando aprovadas aqui pelo RH — o funcionário nunca aprova a
// própria exceção.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { consolidarDia, timestampBR, formatarPeriodoBR } from '../../../lib/pontoWhatsapp';
import { notificarPontoWhatsApp } from '../../../lib/whatsapp';
import { registrarLogAuditoria } from '../../../actions';

type Resultado<T> = { ok: boolean; erro?: string; info?: T };

// Usado por /admin/rh/ponto, /admin/operacional/registro-ponto e (leitura de
// estatísticas) /admin/rh/holerite.
const ROTAS_PERMITIDAS = ['/admin/rh/ponto', '/admin/operacional/registro-ponto', '/admin/rh/holerite'];

async function validarAcessoPontoWhatsapp(accessToken: string) {
  for (const rota of ROTAS_PERMITIDAS) {
    const acesso = await validarAcesso(accessToken, rota);
    if (acesso.ok) return acesso;
  }
  return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
}

export interface EstatisticasPontoWhatsapp {
  funcionariosHabilitados: number;
  batidasHoje: number;
  batidasMes: number;
  solicitacoesPendentes: number;
  folgasPendentes: number;
}

export async function estatisticasPontoWhatsappAction(mesAno: string, accessToken: string): Promise<Resultado<EstatisticasPontoWhatsapp>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const filtroEmpresa = <T,>(q: T): T => {
      if (!empresasPermitidas) return q;
      return (q as any).or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    };

    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;
    const hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    const [{ count: habilitados }, { count: hoje }, { count: mesTotal }, { count: pendentes }, { count: folgasPendentes }] = await Promise.all([
      filtroEmpresa(db.from('folha_funcionarios').select('nome_completo', { count: 'exact', head: true }).eq('ativo', true).eq('ponto_whatsapp_ativo', true)),
      filtroEmpresa(db.from('folha_ponto_whatsapp_registros').select('nsr', { count: 'exact', head: true }).eq('data_referencia', hojeIso)),
      filtroEmpresa(db.from('folha_ponto_whatsapp_registros').select('nsr', { count: 'exact', head: true }).gte('data_referencia', dataInicio).lte('data_referencia', dataFim)),
      // Só Justificativa/Abono — Folga tem contador e aba próprios (ver folgasPendentes).
      filtroEmpresa(db.from('folha_ponto_whatsapp_solicitacoes').select('id', { count: 'exact', head: true }).eq('status', 'PENDENTE').neq('tipo', 'FOLGA_DIA')),
      filtroEmpresa(db.from('folha_ponto_whatsapp_solicitacoes').select('id', { count: 'exact', head: true }).eq('status', 'PENDENTE').eq('tipo', 'FOLGA_DIA')),
    ]);

    return {
      ok: true,
      info: {
        funcionariosHabilitados: habilitados || 0,
        batidasHoje: hoje || 0,
        batidasMes: mesTotal || 0,
        solicitacoesPendentes: pendentes || 0,
        folgasPendentes: folgasPendentes || 0,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface RegistroLedger {
  nsr: number;
  funcionario_nome: string;
  tipo_batida: string;
  data_referencia: string;
  data_hora_batida: string;
  hash_registro: string;
}

// Lista o ledger do mês para auditoria/transparência na tela de Ponto —
// somente leitura, não expõe nenhuma ação de editar/apagar.
export async function listarLedgerPontoWhatsappAction(mesAno: string, accessToken: string): Promise<Resultado<RegistroLedger[]>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let query = db
      .from('folha_ponto_whatsapp_registros')
      .select('nsr, funcionario_nome, tipo_batida, data_referencia, data_hora_batida, hash_registro')
      .gte('data_referencia', dataInicio)
      .lte('data_referencia', dataFim)
      .order('nsr', { ascending: false });
    if (empresasPermitidas) query = query.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface SolicitacaoPendente {
  id: number;
  tipo: 'JUSTIFICATIVA_BATIDA' | 'ABONO_DIA' | 'FOLGA_DIA';
  funcionario_nome: string;
  data_referencia: string;
  data_referencia_fim: string | null;
  tipo_batida: string | null;
  horario_solicitado: string | null;
  motivo: string;
  anexo_nome: string | null;
  criado_em: string;
}

// Fila de solicitações de JUSTIFICAR/ABONAR feitas pelo funcionário via
// WhatsApp, ainda não analisadas pelo RH. FOLGA_DIA fica de fora — tem
// listagem e aba próprias (ver listarSolicitacoesFolgaAction).
export async function listarSolicitacoesPendentesAction(accessToken: string): Promise<Resultado<SolicitacaoPendente[]>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let query = db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('id, tipo, funcionario_nome, data_referencia, data_referencia_fim, tipo_batida, horario_solicitado, motivo, anexo_nome, criado_em')
      .eq('status', 'PENDENTE')
      .neq('tipo', 'FOLGA_DIA')
      .order('criado_em', { ascending: true });
    if (empresasPermitidas) query = query.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Todas as solicitações de FOLGA_DIA (qualquer status), mais recentes
// primeiro — fonte única da aba "Solicitação Folga", usada tanto em
// /admin/rh/ponto quanto em /admin/operacional/registro-ponto.
export async function listarSolicitacoesFolgaAction(accessToken: string): Promise<Resultado<SolicitacaoHistorico[]>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let query = db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('id, tipo, funcionario_nome, data_referencia, data_referencia_fim, tipo_batida, horario_solicitado, motivo, anexo_nome, status, resolvido_por, resolvido_em, motivo_rejeicao, criado_em')
      .eq('tipo', 'FOLGA_DIA')
      .order('criado_em', { ascending: false });
    if (empresasPermitidas) query = query.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface AbonoPendenteResumo {
  funcionario_nome: string;
  data_referencia: string;
  motivo: string;
}

// Usada pelo fechamento de folha (Holerite): enquanto uma solicitação de
// ABONO_DIA (ou FOLGA_DIA, que abona da mesma forma quando aprovada) estiver
// PENDENTE, o dia aparece como falta no cálculo (o abono só vira linha em
// folha_ponto_abono quando aprovado — ver aprovarSolicitacaoAction) — por
// isso a folha não deve fechar até o RH/gestor decidir. Limitação conhecida:
// compara só data_referencia (início) contra o mês, não o intervalo inteiro
// de uma folga em período — revisitar se aparecer caso de período cruzando
// virada de mês.
export async function listarAbonosPendentesDoMesAction(payload: { mesAno: string; nomes: string[] }, accessToken: string): Promise<Resultado<AbonoPendenteResumo[]>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    if (!payload.nomes.length) return { ok: true, info: [] };
    const [ano, mes] = payload.mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let query = db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('funcionario_nome, data_referencia, motivo')
      .eq('status', 'PENDENTE')
      .in('tipo', ['ABONO_DIA', 'FOLGA_DIA'])
      .gte('data_referencia', dataInicio)
      .lte('data_referencia', dataFim)
      .in('funcionario_nome', payload.nomes);
    if (empresasPermitidas) query = query.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface SolicitacaoHistorico extends SolicitacaoPendente {
  status: 'PENDENTE' | 'APROVADA' | 'REJEITADA';
  resolvido_por: string | null;
  resolvido_em: string | null;
  motivo_rejeicao: string | null;
}

// Histórico completo (todas as solicitações de Justificativa/Abono, qualquer
// status) para auditoria — nada aqui é apagado quando aprovado/rejeitado, só
// muda de status. FOLGA_DIA fica de fora, tem histórico próprio dentro da
// aba "Solicitação Folga" (ver listarSolicitacoesFolgaAction).
export async function listarHistoricoSolicitacoesAction(mesAno: string | undefined, accessToken: string): Promise<Resultado<SolicitacaoHistorico[]>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let query = db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('id, tipo, funcionario_nome, data_referencia, data_referencia_fim, tipo_batida, horario_solicitado, motivo, anexo_nome, status, resolvido_por, resolvido_em, motivo_rejeicao, criado_em')
      .neq('tipo', 'FOLGA_DIA')
      .order('criado_em', { ascending: false });
    if (empresasPermitidas) query = query.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);

    if (mesAno) {
      const [ano, mes] = mesAno.split('-');
      const dataInicio = `${ano}-${mes}-01`;
      const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
      const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;
      query = query.gte('data_referencia', dataInicio).lte('data_referencia', dataFim);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// URL temporária (10 min) para o RH visualizar/baixar o anexo (atestado)
// de uma solicitação — o arquivo mora no bucket privado
// "documentos-funcionarios" e nunca fica público.
export async function urlAnexoSolicitacaoAction(payload: { id: number }, accessToken: string): Promise<Resultado<{ url: string }>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: solicitacao } = await db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('anexo_path, anexo_nome, empresa_id')
      .eq('id', payload.id)
      .maybeSingle();
    if (!solicitacao?.anexo_path) return { ok: false, erro: 'Esta solicitação não tem anexo.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, solicitacao.empresa_id)) return { ok: false, erro: 'Esta solicitação não tem anexo.' };

    const { data, error } = await db.storage
      .from('documentos-funcionarios')
      .createSignedUrl(solicitacao.anexo_path, 60 * 10, solicitacao.anexo_nome ? { download: solicitacao.anexo_nome } : undefined);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Falha ao gerar link do anexo.');

    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Rótulo/data usados nas mensagens de aprovação/rejeição — período formatado
// quando é FOLGA_DIA com data_referencia_fim diferente da data inicial.
function rotuloEDataSolicitacao(solicitacao: { tipo: string; data_referencia: string; data_referencia_fim: string | null }): { rotuloTipo: string; dataBR: string } {
  if (solicitacao.tipo === 'JUSTIFICATIVA_BATIDA') return { rotuloTipo: 'sua justificativa de ponto', dataBR: String(solicitacao.data_referencia).split('-').reverse().join('/') };
  if (solicitacao.tipo === 'FOLGA_DIA') return { rotuloTipo: 'sua solicitação de folga', dataBR: formatarPeriodoBR(solicitacao.data_referencia, solicitacao.data_referencia_fim || solicitacao.data_referencia) };
  return { rotuloTipo: 'seu abono', dataBR: String(solicitacao.data_referencia).split('-').reverse().join('/') };
}

// Data (YYYY-MM-DD) inclusive entre início e fim, como valores de calendário
// puros (sem hora) — usada pra abonar cada dia útil ou não de um período de
// FOLGA_DIA aprovado.
function diasEntre(inicioIso: string, fimIso: string): string[] {
  const dias: string[] = [];
  const [anoI, mesI, diaI] = inicioIso.split('-').map(Number);
  const cursor = new Date(Date.UTC(anoI, mesI - 1, diaI));
  const fim = new Date(`${fimIso}T00:00:00Z`).getTime();
  while (cursor.getTime() <= fim) {
    dias.push(cursor.toISOString().split('T')[0]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

// Grava (ou atualiza, se já existir) uma linha de folha_ponto_abono pra um
// dia — mesmo padrão de abonarDiaManualAction (actions-ponto.ts), reusado
// aqui tanto pro Abono de dia único quanto, em loop, pro período de Folga.
async function gravarAbonoDoDia(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string, empresaId: number | null, dataAbono: string, motivo: string): Promise<void> {
  const { data: existente } = await db.from('folha_ponto_abono')
    .select('id')
    .eq('funcionario_nome', funcionarioNome)
    .eq('data_abono', dataAbono)
    .maybeSingle();

  const payload = { dia_todo: true, hora_inicio: null, hora_fim: null, minutos_abonados: 480, motivo, origem: 'WHATSAPP' as const };
  if (existente) {
    const { error } = await db.from('folha_ponto_abono').update(payload).eq('id', existente.id);
    if (error) throw new Error(`Falha ao gravar o abono de ${dataAbono}: ${error.message}`);
  } else {
    const { error } = await db.from('folha_ponto_abono').insert({ funcionario_nome: funcionarioNome, empresa_id: empresaId, data_abono: dataAbono, ...payload });
    if (error) throw new Error(`Falha ao gravar o abono de ${dataAbono}: ${error.message}`);
  }
}

// Aprova a solicitação: JUSTIFICATIVA_BATIDA vira um ajuste aditivo no
// ledger (e recalcula o dia em folha_ponto_diaria); ABONO_DIA vira uma linha
// em folha_ponto_abono; FOLGA_DIA vira uma linha em folha_ponto_abono pra
// cada dia do período (dias não-úteis só não geram crédito de horas na
// exibição — mesma regra do Abono de dia único, ver isDiaNaoUtil em
// app/admin/rh/ponto/page.tsx). Nunca edita o ledger em si. Avisa o
// funcionário pelo próprio WhatsApp.
export async function aprovarSolicitacaoAction(payload: { id: number; aprovadorNome: string }, accessToken: string): Promise<Resultado<null>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { id, aprovadorNome } = payload;
  try {
    const { data: solicitacao, error: buscaErr } = await db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('*')
      .eq('id', id)
      .single();
    if (buscaErr || !solicitacao) throw new Error('Solicitação não encontrada.');
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, solicitacao.empresa_id)) throw new Error('Solicitação não encontrada.');
    if (solicitacao.status !== 'PENDENTE') throw new Error('Esta solicitação já foi analisada.');

    if (solicitacao.tipo === 'JUSTIFICATIVA_BATIDA') {
      const { error: ajusteErr } = await db.from('folha_ponto_whatsapp_ajustes').insert({
        funcionario_nome: solicitacao.funcionario_nome,
        empresa_id: solicitacao.empresa_id,
        data_referencia: solicitacao.data_referencia,
        tipo_batida: solicitacao.tipo_batida,
        data_hora_ajustada: timestampBR(solicitacao.data_referencia, solicitacao.horario_solicitado),
        motivo: solicitacao.motivo,
        autor: aprovadorNome,
      });
      if (ajusteErr) throw new Error(`Falha ao gravar o ajuste: ${ajusteErr.message}`);
      await consolidarDia(db, solicitacao.funcionario_nome, solicitacao.data_referencia);
    } else if (solicitacao.tipo === 'FOLGA_DIA') {
      const dias = diasEntre(solicitacao.data_referencia, solicitacao.data_referencia_fim || solicitacao.data_referencia);
      for (const dia of dias) {
        await gravarAbonoDoDia(db, solicitacao.funcionario_nome, solicitacao.empresa_id, dia, solicitacao.motivo);
      }
    } else {
      const { error: abonoErr } = await db.from('folha_ponto_abono').insert({
        funcionario_nome: solicitacao.funcionario_nome,
        empresa_id: solicitacao.empresa_id,
        data_abono: solicitacao.data_referencia,
        dia_todo: true,
        hora_inicio: null,
        hora_fim: null,
        minutos_abonados: 480,
        motivo: solicitacao.motivo,
        origem: 'WHATSAPP',
      });
      if (abonoErr) throw new Error(`Falha ao gravar o abono: ${abonoErr.message}`);
    }

    await db.from('folha_ponto_whatsapp_solicitacoes').update({
      status: 'APROVADA',
      resolvido_por: aprovadorNome,
      resolvido_em: new Date().toISOString(),
    }).eq('id', id);

    await registrarLogAuditoria({
      usuario_nome: aprovadorNome,
      acao: `APROVOU SOLICITAÇÃO DE PONTO WHATSAPP (${solicitacao.tipo}): ${solicitacao.funcionario_nome} em ${solicitacao.data_referencia}`,
      setor: 'RECURSOS HUMANOS / PONTO WHATSAPP',
    });

    const { rotuloTipo, dataBR } = rotuloEDataSolicitacao(solicitacao);
    await notificarPontoWhatsApp(
      solicitacao.celular,
      `✅ O RH aprovou ${rotuloTipo} referente a ${dataBR}.`,
      { nome: 'ponto_solicitacao_aprovada', idioma: 'pt_BR', parametros: [rotuloTipo, dataBR] }
    );

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function rejeitarSolicitacaoAction(payload: { id: number; aprovadorNome: string; motivoRejeicao: string }, accessToken: string): Promise<Resultado<null>> {
  const acesso = await validarAcessoPontoWhatsapp(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { id, aprovadorNome, motivoRejeicao } = payload;
  try {
    if (!motivoRejeicao?.trim()) throw new Error('Informe o motivo da rejeição.');

    const { data: solicitacao, error: buscaErr } = await db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('*')
      .eq('id', id)
      .single();
    if (buscaErr || !solicitacao) throw new Error('Solicitação não encontrada.');
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, solicitacao.empresa_id)) throw new Error('Solicitação não encontrada.');
    if (solicitacao.status !== 'PENDENTE') throw new Error('Esta solicitação já foi analisada.');

    await db.from('folha_ponto_whatsapp_solicitacoes').update({
      status: 'REJEITADA',
      resolvido_por: aprovadorNome,
      resolvido_em: new Date().toISOString(),
      motivo_rejeicao: motivoRejeicao,
    }).eq('id', id);

    await registrarLogAuditoria({
      usuario_nome: aprovadorNome,
      acao: `REJEITOU SOLICITAÇÃO DE PONTO WHATSAPP (${solicitacao.tipo}): ${solicitacao.funcionario_nome} em ${solicitacao.data_referencia}`,
      setor: 'RECURSOS HUMANOS / PONTO WHATSAPP',
    });

    const { rotuloTipo, dataBR } = rotuloEDataSolicitacao(solicitacao);
    // FOLGA_DIA pode ser rejeitada tanto pelo RH quanto por um gestor do
    // Operacional — encaminha a dúvida pro gestor, não especificamente pro RH.
    const encaminhamento = solicitacao.tipo === 'FOLGA_DIA' ? 'Fale com o seu Gestor se tiver dúvidas.' : 'Fale com o RH se tiver dúvidas.';
    await notificarPontoWhatsApp(
      solicitacao.celular,
      `❌ O RH não aprovou ${rotuloTipo} referente a ${dataBR}. Motivo: ${motivoRejeicao}. ${encaminhamento}`,
      { nome: 'ponto_solicitacao_rejeitada', idioma: 'pt_BR', parametros: [rotuloTipo, dataBR, motivoRejeicao] }
    );

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
