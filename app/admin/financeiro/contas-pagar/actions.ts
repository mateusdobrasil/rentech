'use server';

// app/admin/financeiro/contas-pagar/actions.ts
// Wrapper fino: só checa permissão e delega pra contasPagarCore.ts, que tem
// a lógica de sync de verdade (e é reaproveitada também por
// app/api/cron/sync-p2s/route.ts, que roda sem sessão de usuário — ver
// comentário no topo de contasPagarCore.ts).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { obterUltimaSincronizacao } from '../../../lib/syncLog';
import { sincronizarContasPagarCore, type SincronizarContasPagarOpcoes } from './contasPagarCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/financeiro/contas-pagar';

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

// ============================================================================
// DADOS DE PAGAMENTO (PIX/conta bancária) — o sync do PrimeStart não traz
// nada disso (ver comentário no topo de .sql/contas_pagar_pagamento_lote.sql:
// o campo do PrimeStart existe mas está vazio em 100% das contas testadas),
// então quem monta o lote em /admin/financeiro/rh digita uma vez aqui e fica
// salvo pra próxima vez que a mesma conta (mesmo id) aparecer num lote.
// Permissão checada pela rota do lote (/admin/financeiro/rh), não pela desta
// tela de listagem, já que é de lá que a ação é chamada.
// ============================================================================
export async function salvarDadosPagamentoContaPagarAction(payload: {
  id: number;
  documentoFornecedor?: string | null;
  pixTipo?: string | null;
  pixChave?: string | null;
  bancoCodigo?: string | null;
  bancoAgencia?: string | null;
  bancoConta?: string | null;
  bancoTipo?: string | null;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/financeiro/rh');
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { error } = await db.from('financeiro_contas_pagar').update({
      documento_fornecedor: payload.documentoFornecedor || null,
      pix_tipo: payload.pixTipo || null,
      pix_chave: payload.pixChave || null,
      banco_codigo: payload.bancoCodigo || null,
      banco_agencia: payload.bancoAgencia || null,
      banco_conta: payload.bancoConta || null,
      banco_tipo: payload.bancoTipo || null,
    }).eq('id', payload.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
