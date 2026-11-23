// app/lib/virada/estado.ts
// Estado da virada da chave por empresa (2026-11-21). Empresa CONGELADA ou
// CONCLUIDA não é mais lida nem escrita no P2S: os importadores pulam, e as
// chamadas que escreviam lá (OP, baixas, devolução da expedição) não escrevem.
// Sem a tabela (SQL ainda não rodado) nada está congelado.
import type { supabaseAdmin } from '../supabase';

type Db = ReturnType<typeof supabaseAdmin>;
export type EtapaVirada = 'PREPARACAO' | 'CONGELADA' | 'CONCLUIDA';

export async function empresasCongeladas(db: Db): Promise<Set<number>> {
  const { data, error } = await db.from('parametros_virada').select('empresa_id, etapa').neq('etapa', 'PREPARACAO');
  if (error) return new Set();
  return new Set(((data || []) as any[]).map(r => r.empresa_id as number));
}

/** true = a empresa já virou (ou está virando): não ler nem escrever no P2S. */
export async function p2sCongelado(db: Db, empresaId: number | null | undefined): Promise<boolean> {
  if (!empresaId) return false;
  return (await empresasCongeladas(db)).has(empresaId);
}

export const MSG_P2S_CONGELADO = 'Empresa já virou a chave — nada mais é enviado ao P2S.';

/** OP de empresa que já virou: não envia, não atualiza, não baixa nem exclui no P2S. */
export async function opEmEmpresaCongelada(db: Db, opId: string | null | undefined): Promise<boolean> {
  if (!opId) return false;
  const congeladas = await empresasCongeladas(db);
  if (!congeladas.size) return false;
  const { data } = await db.from('op_ordens_pagamento').select('empresa_id').eq('id', opId).maybeSingle();
  return !!data?.empresa_id && congeladas.has(data.empresa_id);
}

/** Conta a pagar do espelho do P2S (pelo oid ou pelo id) de empresa que já virou. */
export async function contaPagarEmEmpresaCongelada(db: Db, chave: { p2sOid?: string | null; id?: number | null }): Promise<boolean> {
  const congeladas = await empresasCongeladas(db);
  if (!congeladas.size) return false;
  let q = db.from('financeiro_contas_pagar').select('empresa_id');
  if (chave.id) q = q.eq('id', chave.id); else if (chave.p2sOid) q = q.eq('p2s_oid', chave.p2sOid); else return false;
  const { data } = await q.maybeSingle();
  return !!data?.empresa_id && congeladas.has(data.empresa_id);
}

/** Ficha de locação do P2S já migrada (origem SISTEMA) ou de empresa que já virou. */
export async function fichaLocacaoP2sCongelada(db: Db, p2sOid: string): Promise<boolean> {
  const { data } = await db.from('locacao_fichas_locacao').select('empresa_id, origem').eq('p2s_oid', p2sOid).maybeSingle();
  if (!data) return false;
  if (data.origem && data.origem !== 'P2S') return true;
  return !!data.empresa_id && (await empresasCongeladas(db)).has(data.empresa_id);
}

// ============================================================================
// P2S DESLIGADO (2026-11-23) — quando TODAS as empresas ativas CONCLUÍREM a
// virada, nada mais chama a API do P2S em produção (rotinas, botões, buscas):
// app/lib/p2s.ts recusa a chamada com MSG_P2S_DESLIGADO. É na conclusão, não no
// congelamento: a migração da segunda empresa ainda consulta o P2S.
// ============================================================================
export const MSG_P2S_DESLIGADO = 'P2S desligado: todas as empresas concluíram a virada da chave — o sistema não consulta mais o PrimeStart.';
let cacheDesligado: { valor: boolean; ate: number } | null = null;

export async function p2sDesligado(db: Db): Promise<boolean> {
  if (cacheDesligado && cacheDesligado.ate > Date.now()) return cacheDesligado.valor;
  const [{ data: emps, error: e1 }, { data: virada, error: e2 }] = await Promise.all([
    db.from('empresas').select('id').eq('ativo', true),
    db.from('parametros_virada').select('empresa_id, etapa'),
  ]);
  let valor = false;
  if (!e1 && !e2) {
    const concluidas = new Set(((virada || []) as { empresa_id: number; etapa: string }[]).filter(v => v.etapa === 'CONCLUIDA').map(v => v.empresa_id));
    const ativas = ((emps || []) as { id: number }[]).map(e => e.id);
    valor = ativas.length > 0 && ativas.every(id => concluidas.has(id));
  }
  cacheDesligado = { valor, ate: Date.now() + 60_000 };
  return valor;
}
