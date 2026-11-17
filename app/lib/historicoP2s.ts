// app/lib/historicoP2s.ts
// Carga do HISTÓRICO COMPLETO do P2S (item 2 do roteiro, 2026-11-17): fichas de
// reserva, fichas de locação, contas a receber e contas a pagar de todos os
// anos, mês a mês, retomável (cursor em integracoes_backfill = AAAAMM do
// próximo mês). Roda de madrugada (/api/cron/historico-p2s) e pode ser
// adiantada em Parâmetros → Histórico do P2S. Tudo é upsert pelo p2s_oid —
// rodar de novo um mês só atualiza. Depois de concluída, os syncs diários
// seguem mantendo o que muda.
import type { supabaseAdmin } from './supabase';
import { consultarObjetos, criterio } from './p2s';
import { importarFichasP2sCore } from './locacao/importarFichasP2s';
import { importarFichasLocacaoP2s } from './locacao/importarFichasLocacaoP2s';
import { gravarContasReceberP2s } from '../admin/financeiro/contas-receber/contasReceberCore';
import { gravarContasPagarP2s } from '../admin/financeiro/contas-pagar/contasPagarCore';

type Db = ReturnType<typeof supabaseAdmin>;

export type TrabalhoHistorico = 'hist_fichas_reserva' | 'hist_fichas_locacao' | 'hist_contas_receber' | 'hist_contas_pagar';
export const TRABALHOS: { chave: TrabalhoHistorico; rotulo: string; mesesAFrente: number }[] = [
  { chave: 'hist_fichas_reserva', rotulo: 'Fichas de reserva (com itens)', mesesAFrente: 24 },
  { chave: 'hist_fichas_locacao', rotulo: 'Fichas de locação (saídas, devoluções e extras)', mesesAFrente: 1 },
  { chave: 'hist_contas_receber', rotulo: 'Contas a receber', mesesAFrente: 24 },
  { chave: 'hist_contas_pagar', rotulo: 'Contas a pagar', mesesAFrente: 24 },
];

const serial = (iso: string) => Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
export const mesDoCursor = (c: number) => ({ ano: Math.floor(c / 100), mes: c % 100 });
export function proximoMes(c: number): number { const { ano, mes } = mesDoCursor(c); return mes === 12 ? (ano + 1) * 100 + 1 : c + 1; }
function intervaloMes(c: number): { de: string; ate: string } {
  const { ano, mes } = mesDoCursor(c);
  const de = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ate = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  return { de, ate };
}
function cursorLimite(mesesAFrente: number): number {
  const hoje = new Date();
  let c = hoje.getUTCFullYear() * 100 + hoje.getUTCMonth() + 1;
  for (let i = 0; i < mesesAFrente; i++) c = proximoMes(c);
  return c;
}

/** Importa UM mês de um trabalho. Devolve quantos registros gravou. */
async function rodarMes(db: Db, trabalho: TrabalhoHistorico, cursor: number): Promise<number> {
  const { de, ate } = intervaloMes(cursor);
  switch (trabalho) {
    case 'hist_fichas_reserva': {
      const r = await importarFichasP2sCore(db, { de, ate });
      return r.gravadas;
    }
    case 'hist_fichas_locacao': {
      const r = await importarFichasLocacaoP2s(db, { de, ate });
      return r.gravadas;
    }
    case 'hist_contas_receber':
    case 'hist_contas_pagar': {
      const classe = trabalho === 'hist_contas_receber' ? 'TCustomContaReceber' : 'TCustomContaPagar';
      const r = await consultarObjetos('PRODUCAO', classe, [
        criterio('DataVencimento', 'ge', 'dbl', serial(de)),
        criterio('DataVencimento', 'le', 'dbl', serial(ate)),
      ], { order: 'DataVencimento', proxy: true });
      return trabalho === 'hist_contas_receber' ? gravarContasReceberP2s('PRODUCAO', r.objectlist) : gravarContasPagarP2s('PRODUCAO', r.objectlist);
    }
  }
}

export interface PassoHistorico { trabalho: TrabalhoHistorico; mes: string; gravados: number; erro?: string }

/**
 * Avança a carga enquanto houver tempo: um mês de cada trabalho por rodada
 * (reservas → locações → a receber → a pagar), para a ficha de locação já
 * achar a reserva do mesmo período. Erro num trabalho para só ele nesta rodada.
 */
export async function avancarHistoricoP2s(db: Db, orcamentoMs: number): Promise<{ passos: PassoHistorico[]; concluidos: TrabalhoHistorico[] }> {
  const inicio = Date.now();
  const passos: PassoHistorico[] = [];
  const comErro = new Set<TrabalhoHistorico>();
  for (;;) {
    const { data: estados, error } = await db.from('integracoes_backfill').select('*').in('integracao', TRABALHOS.map(t => t.chave));
    if (error) throw error;
    const porChave = new Map(((estados || []) as any[]).map(e => [e.integracao as TrabalhoHistorico, e]));
    const pendentes = TRABALHOS.filter(t => porChave.has(t.chave) && !porChave.get(t.chave).concluido && !comErro.has(t.chave));
    if (!pendentes.length) break;
    let andou = false;
    for (const t of pendentes) {
      if (Date.now() - inicio > orcamentoMs) return { passos, concluidos: TRABALHOS.filter(x => porChave.get(x.chave)?.concluido).map(x => x.chave) };
      const e = porChave.get(t.chave);
      const cursor = Number(e.cursor) || 201001;
      const limite = cursorLimite(t.mesesAFrente);
      const mesTxt = `${String(cursor % 100).padStart(2, '0')}/${Math.floor(cursor / 100)}`;
      if (cursor > limite) {
        await db.from('integracoes_backfill').update({ concluido: true, atualizado_em: new Date().toISOString() }).eq('integracao', t.chave);
        continue;
      }
      try {
        const gravados = await rodarMes(db, t.chave, cursor);
        const prox = proximoMes(cursor);
        await db.from('integracoes_backfill').update({
          cursor: prox, processados: (Number(e.processados) || 0) + gravados, concluido: prox > limite,
          ultimo_erro: null, atualizado_em: new Date().toISOString(),
        }).eq('integracao', t.chave);
        passos.push({ trabalho: t.chave, mes: mesTxt, gravados });
        andou = true;
      } catch (err: any) {
        comErro.add(t.chave);
        await db.from('integracoes_backfill').update({ ultimo_erro: `${mesTxt}: ${err?.message || err}`.slice(0, 500), atualizado_em: new Date().toISOString() }).eq('integracao', t.chave);
        passos.push({ trabalho: t.chave, mes: mesTxt, gravados: 0, erro: err?.message || String(err) });
      }
    }
    if (!andou) break;
  }
  const { data: fim } = await db.from('integracoes_backfill').select('integracao, concluido').in('integracao', TRABALHOS.map(t => t.chave));
  return { passos, concluidos: ((fim || []) as any[]).filter(e => e.concluido).map(e => e.integracao) };
}
