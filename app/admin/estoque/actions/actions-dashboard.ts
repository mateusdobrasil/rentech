'use server';

// app/admin/estoque/actions/actions-dashboard.ts
// Painel de pendências do hub Estoque (/admin/estoque) — mesmo espírito de
// painelOperacionalAction (app/admin/operacional/actions/actions-dashboard.ts):
// agrega, num só round-trip, números que hoje só apareciam depois de entrar
// em cada módulo. A contagem de expedições em aberto morava em
// painelOperacionalAction (como "checklistsCargaAbertos") antes do Checklist
// de Carga virar Expedição e se mudar pra este hub.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

export async function painelEstoqueAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/estoque');
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { count } = await db.from('checklists').select('id', { count: 'exact', head: true }).neq('status', 'FINALIZADO');

    return {
      ok: true,
      info: {
        expedicoesAbertas: count || 0,
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
