'use server';

// app/admin/parametros/historico-p2s/actions.ts
// Acompanhamento e "avançar agora" da carga do histórico completo do P2S
// (app/lib/historicoP2s.ts). Só Administrador (rota em historico_p2s.sql).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { avancarHistoricoP2s, TRABALHOS } from '../../../lib/historicoP2s';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/parametros/historico-p2s';

async function totais() {
  const db = supabaseAdmin();
  const conta = async (t: string) => (await db.from(t).select('id', { count: 'exact', head: true })).count || 0;
  const [reservas, locacoes, movimentos, receber, pagar] = await Promise.all([
    conta('locacao_fichas_reserva'), conta('locacao_fichas_locacao'), conta('locacao_fichas_locacao_movimentos'),
    conta('financeiro_contas_receber'), conta('financeiro_contas_pagar'),
  ]);
  return { reservas, locacoes, movimentos, receber, pagar };
}

export async function statusHistoricoAction(accessToken: string): Promise<Resultado> {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { ok: false, erro: v.message };
  try {
    const { data, error } = await supabaseAdmin().from('integracoes_backfill').select('*').in('integracao', TRABALHOS.map(t => t.chave));
    if (error) throw error;
    const porChave = new Map(((data || []) as any[]).map(e => [e.integracao, e]));
    return {
      ok: true,
      info: {
        trabalhos: TRABALHOS.map(t => ({ ...t, estado: porChave.get(t.chave) || null })),
        totais: await totais(),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function avancarHistoricoAgoraAction(accessToken: string): Promise<Resultado> {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { ok: false, erro: v.message };
  try {
    const r = await avancarHistoricoP2s(supabaseAdmin(), 200_000);
    const gravados = r.passos.reduce((s, p) => s + p.gravados, 0);
    registrarLogAuditoria({ usuario_nome: v.perfil.nome, acao: 'AVANÇOU CARGA DO HISTÓRICO P2S', setor: 'PARÂMETROS', equipamento_nome: `${r.passos.length} mês(es) · ${gravados} registro(s)` });
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
