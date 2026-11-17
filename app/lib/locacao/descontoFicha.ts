// app/lib/locacao/descontoFicha.ts
// % de desconto da ficha contra o preço de TABELA (2026-11-17). Calculado no
// servidor — o navegador só mostra uma estimativa. Referência:
//   equipamento/kit com preço na tabela → qtd × valor da tabela (recalculado aqui);
//   demais itens (serviço, frete, sem tabela) → qtd × valor unitário digitado.
// Desconto = (referência − total final) ÷ referência. Conta preço manual abaixo
// da tabela, desconto por item e desconto geral. Nunca negativo.
import type { supabaseAdmin } from '../supabase';
import { precificarItens, type Modalidade } from './precificacao';

type Db = ReturnType<typeof supabaseAdmin>;

export interface ItemParaDesconto { tipo: string; produto_id: number | null; quantidade: number; dias: number | null; valor_unitario: number }

export async function calcularDescontoPct(db: Db, args: {
  empresaId: number; parceiroId: number | null; eventoId: string | null; dataInicio: string; modalidade: Modalidade;
  diasCobrados: number; itens: ItemParaDesconto[]; total: number;
}): Promise<{ pct: number; referencia: number }> {
  const equip = args.itens.map((i, idx) => ({ i, chave: String(idx) })).filter(x => (x.i.tipo === 'EQUIPAMENTO' || x.i.tipo === 'KIT') && x.i.produto_id);
  let precos: Record<string, { valor_unitario: number | null }> = {};
  if (equip.length) {
    const r = await precificarItens(db, {
      empresaId: args.empresaId, parceiroId: args.parceiroId, eventoId: args.eventoId, dataRef: args.dataInicio, modalidade: args.modalidade,
      itens: equip.map(x => ({ chave: x.chave, produto_id: x.i.produto_id!, dias: x.i.dias || args.diasCobrados })),
    });
    precos = r.precos;
  }
  const referencia = args.itens.reduce((s, i, idx) => {
    const tabela = precos[String(idx)]?.valor_unitario;
    return s + i.quantidade * (tabela !== null && tabela !== undefined ? tabela : i.valor_unitario);
  }, 0);
  if (referencia <= 0.009) return { pct: 0, referencia: 0 };
  const pct = Math.max(0, ((referencia - args.total) / referencia) * 100);
  return { pct: Math.round(pct * 100) / 100, referencia: Math.round(referencia * 100) / 100 };
}

/** Desconto acima do aprovado? (aprovado null = 0) */
export const descontoPendente = (f: { origem?: string | null; desconto_pct?: number | string | null; desconto_aprovado_pct?: number | string | null }) =>
  f.origem !== 'P2S' && (Number(f.desconto_pct) || 0) > (Number(f.desconto_aprovado_pct) || 0) + 0.005;
