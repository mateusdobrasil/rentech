'use server';

// app/admin/financeiro/contas-pagar/actions.ts
// Wrapper fino: só checa permissão e delega pra contasPagarCore.ts, que tem
// a lógica de sync de verdade (e é reaproveitada também por
// app/api/cron/sync-p2s/route.ts, que roda sem sessão de usuário — ver
// comentário no topo de contasPagarCore.ts).
import { validarAcesso } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import { sincronizarContasPagarCore, type SincronizarContasPagarOpcoes } from './contasPagarCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/financeiro/contas-pagar';

export type { SincronizarContasPagarOpcoes };

export async function sincronizarContasPagarP2sAction(opcoes: SincronizarContasPagarOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  return sincronizarContasPagarCore(opcoes);
}

export async function buscarUltimaSincronizacaoContasPagarAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const info = await obterUltimaSincronizacao('contas_pagar', 'PRODUCAO');
  return { ok: true, info };
}
