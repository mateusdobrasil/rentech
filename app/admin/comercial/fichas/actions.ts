'use server';

// app/admin/comercial/fichas/actions.ts
// Wrapper fino: só checa permissão e delega pra fichasCore.ts, que tem a
// lógica de sync de verdade (e é reaproveitada também por
// app/api/cron/sync-p2s/route.ts, que roda sem sessão de usuário — ver
// comentário no topo de fichasCore.ts).
import { validarAcesso } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import { sincronizarFichasReservaCore, type SincronizarFichasReservaOpcoes } from './fichasCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/comercial/fichas';

export type { SincronizarFichasReservaOpcoes };

export async function sincronizarFichasReservaP2sAction(opcoes: SincronizarFichasReservaOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  return sincronizarFichasReservaCore(opcoes);
}

export async function buscarUltimaSincronizacaoFichasAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const info = await obterUltimaSincronizacao('fichas_reserva', 'PRODUCAO');
  return { ok: true, info };
}
