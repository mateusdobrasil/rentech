'use server';

// app/admin/estoque/produtos/actions.ts
// Wrapper fino: só checa permissão e delega pra produtosCore.ts, que tem a
// lógica de sync de verdade (e é reaproveitada também por
// app/api/cron/sync-p2s/route.ts, que roda sem sessão de usuário — ver
// comentário no topo de produtosCore.ts).
//
// Mapeamento de campos validado empiricamente contra o servidor de produção
// em 2026-08-10 (515 produtos reais inspecionados, catálogo inteiro) — ver
// produtosCore.ts para os detalhes.
import { validarAcesso } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import { sincronizarProdutosCore, type SincronizarProdutosOpcoes } from './produtosCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/estoque/produtos';

export async function sincronizarProdutosP2sAction(opcoes: SincronizarProdutosOpcoes, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  return sincronizarProdutosCore(opcoes);
}

export async function buscarUltimaSincronizacaoProdutosAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const info = await obterUltimaSincronizacao('produtos', 'PRODUCAO');
  return { ok: true, info };
}
