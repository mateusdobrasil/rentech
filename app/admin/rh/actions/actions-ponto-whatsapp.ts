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
import { consolidarDia, timestampBR } from '../../../lib/pontoWhatsapp';
import { enviarWhatsApp } from '../../../lib/zapi';
import { registrarLogAuditoria } from '../../../actions';

type Resultado<T> = { ok: boolean; erro?: string; info?: T };

export interface EstatisticasPontoWhatsapp {
  funcionariosHabilitados: number;
  batidasHoje: number;
  batidasMes: number;
  solicitacoesPendentes: number;
}

export async function estatisticasPontoWhatsappAction(mesAno: string): Promise<Resultado<EstatisticasPontoWhatsapp>> {
  const db = supabaseAdmin();
  try {
    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;
    const hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    const [{ count: habilitados }, { count: hoje }, { count: mesTotal }, { count: pendentes }] = await Promise.all([
      db.from('folha_funcionarios').select('nome_completo', { count: 'exact', head: true }).eq('ativo', true).eq('ponto_whatsapp_ativo', true),
      db.from('folha_ponto_whatsapp_registros').select('nsr', { count: 'exact', head: true }).eq('data_referencia', hojeIso),
      db.from('folha_ponto_whatsapp_registros').select('nsr', { count: 'exact', head: true }).gte('data_referencia', dataInicio).lte('data_referencia', dataFim),
      db.from('folha_ponto_whatsapp_solicitacoes').select('id', { count: 'exact', head: true }).eq('status', 'PENDENTE'),
    ]);

    return {
      ok: true,
      info: {
        funcionariosHabilitados: habilitados || 0,
        batidasHoje: hoje || 0,
        batidasMes: mesTotal || 0,
        solicitacoesPendentes: pendentes || 0,
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
export async function listarLedgerPontoWhatsappAction(mesAno: string): Promise<Resultado<RegistroLedger[]>> {
  const db = supabaseAdmin();
  try {
    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;

    const { data, error } = await db
      .from('folha_ponto_whatsapp_registros')
      .select('nsr, funcionario_nome, tipo_batida, data_referencia, data_hora_batida, hash_registro')
      .gte('data_referencia', dataInicio)
      .lte('data_referencia', dataFim)
      .order('nsr', { ascending: false });

    if (error) throw new Error(error.message);
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface SolicitacaoPendente {
  id: number;
  tipo: 'JUSTIFICATIVA_BATIDA' | 'ABONO_DIA';
  funcionario_nome: string;
  data_referencia: string;
  tipo_batida: string | null;
  horario_solicitado: string | null;
  motivo: string;
  criado_em: string;
}

// Fila de solicitações de JUSTIFICAR/ABONAR feitas pelo funcionário via
// WhatsApp, ainda não analisadas pelo RH.
export async function listarSolicitacoesPendentesAction(): Promise<Resultado<SolicitacaoPendente[]>> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('id, tipo, funcionario_nome, data_referencia, tipo_batida, horario_solicitado, motivo, criado_em')
      .eq('status', 'PENDENTE')
      .order('criado_em', { ascending: true });
    if (error) throw new Error(error.message);
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Aprova a solicitação: JUSTIFICATIVA_BATIDA vira um ajuste aditivo no
// ledger (e recalcula o dia em folha_ponto_diaria); ABONO_DIA vira uma linha
// em folha_ponto_abono. Nunca edita o ledger em si. Avisa o funcionário pelo
// próprio WhatsApp.
export async function aprovarSolicitacaoAction(payload: { id: number; aprovadorNome: string }): Promise<Resultado<null>> {
  const db = supabaseAdmin();
  const { id, aprovadorNome } = payload;
  try {
    const { data: solicitacao, error: buscaErr } = await db
      .from('folha_ponto_whatsapp_solicitacoes')
      .select('*')
      .eq('id', id)
      .single();
    if (buscaErr || !solicitacao) throw new Error('Solicitação não encontrada.');
    if (solicitacao.status !== 'PENDENTE') throw new Error('Esta solicitação já foi analisada.');

    if (solicitacao.tipo === 'JUSTIFICATIVA_BATIDA') {
      const { error: ajusteErr } = await db.from('folha_ponto_whatsapp_ajustes').insert({
        funcionario_nome: solicitacao.funcionario_nome,
        data_referencia: solicitacao.data_referencia,
        tipo_batida: solicitacao.tipo_batida,
        data_hora_ajustada: timestampBR(solicitacao.data_referencia, solicitacao.horario_solicitado),
        motivo: solicitacao.motivo,
        autor: aprovadorNome,
      });
      if (ajusteErr) throw new Error(`Falha ao gravar o ajuste: ${ajusteErr.message}`);
      await consolidarDia(db, solicitacao.funcionario_nome, solicitacao.data_referencia);
    } else {
      const { error: abonoErr } = await db.from('folha_ponto_abono').insert({
        funcionario_nome: solicitacao.funcionario_nome,
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

    const rotuloTipo = solicitacao.tipo === 'JUSTIFICATIVA_BATIDA' ? 'sua justificativa de ponto' : 'seu abono';
    await enviarWhatsApp(solicitacao.celular, `✅ O RH aprovou ${rotuloTipo} referente a ${String(solicitacao.data_referencia).split('-').reverse().join('/')}.`);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function rejeitarSolicitacaoAction(payload: { id: number; aprovadorNome: string; motivoRejeicao: string }): Promise<Resultado<null>> {
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

    const rotuloTipo = solicitacao.tipo === 'JUSTIFICATIVA_BATIDA' ? 'sua justificativa de ponto' : 'seu abono';
    await enviarWhatsApp(solicitacao.celular, `❌ O RH não aprovou ${rotuloTipo} referente a ${String(solicitacao.data_referencia).split('-').reverse().join('/')}. Motivo: ${motivoRejeicao}. Fale com o RH se tiver dúvidas.`);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
