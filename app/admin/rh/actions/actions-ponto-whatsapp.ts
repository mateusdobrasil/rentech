'use server';

// app/admin/rh/actions/actions-ponto-whatsapp.ts
// Server actions de LEITURA para a tela de Ponto: estatísticas e o ledger
// (somente-leitura, é append-only) das batidas confirmadas via WhatsApp.
// Gravação acontece só pelo webhook (app/api/webhooks/zapi-ponto), nunca
// por aqui — esta tela não deve poder editar/apagar uma batida do ledger.
import { supabaseAdmin } from '../../../lib/supabase';

type Resultado<T> = { ok: boolean; erro?: string; info?: T };

export interface EstatisticasPontoWhatsapp {
  funcionariosHabilitados: number;
  batidasHoje: number;
  batidasMes: number;
}

export async function estatisticasPontoWhatsappAction(mesAno: string): Promise<Resultado<EstatisticasPontoWhatsapp>> {
  const db = supabaseAdmin();
  try {
    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const ultimoDia = new Date(Number(ano), Number(mes), 0).getDate();
    const dataFim = `${ano}-${mes}-${String(ultimoDia).padStart(2, '0')}`;
    const hojeIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    const [{ count: habilitados }, { count: hoje }, { count: mesTotal }] = await Promise.all([
      db.from('folha_funcionarios').select('nome_completo', { count: 'exact', head: true }).eq('ativo', true).eq('ponto_whatsapp_ativo', true),
      db.from('folha_ponto_whatsapp_registros').select('nsr', { count: 'exact', head: true }).eq('data_referencia', hojeIso),
      db.from('folha_ponto_whatsapp_registros').select('nsr', { count: 'exact', head: true }).gte('data_referencia', dataInicio).lte('data_referencia', dataFim),
    ]);

    return {
      ok: true,
      info: {
        funcionariosHabilitados: habilitados || 0,
        batidasHoje: hoje || 0,
        batidasMes: mesTotal || 0,
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
