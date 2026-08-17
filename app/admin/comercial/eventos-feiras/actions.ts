'use server';

// app/admin/comercial/eventos-feiras/actions.ts
// Wrapper fino: só checa permissão e delega pra eventosCore.ts, que tem a
// lógica de sync de verdade (e é reaproveitada também por
// app/api/cron/sync-p2s/route.ts, que roda sem sessão de usuário — ver
// comentário no topo de eventosCore.ts).
import { validarAcesso } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import { sincronizarEventosFeirasCore, type SincronizarEventosOpcoes } from './eventosCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/comercial/eventos-feiras';

export async function sincronizarEventosFeirasP2sAction(opcoes: SincronizarEventosOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  return sincronizarEventosFeirasCore(opcoes);
}

export async function buscarUltimaSincronizacaoEventosAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const info = await obterUltimaSincronizacao('eventos_feiras', 'PRODUCAO');
  return { ok: true, info };
}
