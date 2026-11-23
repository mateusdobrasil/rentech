'use server';

// app/admin/comercial/eventos-feiras/actions.ts
// Wrapper fino: só checa permissão e delega pra eventosCore.ts, que tem a
// lógica de sync de verdade (e é reaproveitada também por
// app/api/cron/sync-p2s/route.ts, que roda sem sessão de usuário — ver
// comentário no topo de eventosCore.ts).
import { validarAcesso } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import { sincronizarEventosFeirasCore, type SincronizarEventosOpcoes } from './eventosCore';
import { supabaseAdmin } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { cadastrosNoSistema } from '../../../lib/cadastros/parceiros';
import { eventoEditavel, salvarEvento, type DadosEvento } from '../../../lib/cadastros/eventos';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/comercial/eventos-feiras';

// O botão "Sincronizar Fichas/Eventos" de /admin/estoque/expedicao também
// chama esta action — quem tem acesso à Expedição precisa conseguir usar o
// botão da própria página, mesmo sem acesso ao módulo Comercial.
const ROTAS_SINCRONIZAR = [ROTA, '/admin/estoque/expedicao'];

export async function sincronizarEventosFeirasP2sAction(opcoes: SincronizarEventosOpcoes, accessToken: string): Promise<Resultado> {
  let acesso = await validarAcesso(accessToken, ROTAS_SINCRONIZAR[0]);
  for (const rota of ROTAS_SINCRONIZAR.slice(1)) {
    if (acesso.ok) break;
    acesso = await validarAcesso(accessToken, rota);
  }
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  return sincronizarEventosFeirasCore(opcoes);
}

export async function buscarUltimaSincronizacaoEventosAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const info = await obterUltimaSincronizacao('eventos_feiras', 'PRODUCAO');
  return { ok: true, info };
}

// ============================================================================
// CADASTRO PRÓPRIO (2026-11-23) — regras em app/lib/cadastros/eventos.ts
// ============================================================================
export async function contextoCadastroEventoAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try { return { ok: true, info: { sistemaOrigem: await cadastrosNoSistema(supabaseAdmin()) } }; } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : 'Erro.' }; }
}

export async function carregarEventoAction(id: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('eventos_feiras').select('*').eq('id', String(id)).maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, erro: 'Evento não encontrado.' };
    const e = await eventoEditavel(db, data);
    return { ok: true, info: { evento: data, editavel: e.editavel, motivo: e.motivo } };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : 'Erro.' }; }
}

export async function salvarEventoAction(dados: DadosEvento, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const r = await salvarEvento(supabaseAdmin(), dados);
    registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: r.novo ? 'CADASTROU EVENTO' : 'ALTEROU EVENTO', setor: 'COMERCIAL', equipamento_nome: `${dados.nome} (${dados.data_inicial})` });
    return { ok: true, info: r };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : 'Erro.' }; }
}
