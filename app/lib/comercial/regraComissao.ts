// app/lib/comercial/regraComissao.ts
// Regra da % de comissão de LOCAÇÃO (2026-11-17, definida pelo usuário):
//   - % cheia: preço da tabela padrão e prazo padrão (todos os dias do evento cobrados);
//   - deu desconto sobre a tabela → a % de locação vira a da FAIXA de desconto
//     (ex.: até 5% → 4%; até 10% → 3%). Acima da última faixa vale a última;
//   - cobrou menos dias que o evento → tira os pontos da FAIXA de prazo
//     (ex.: até 1 dia a menos → −0,5; até 3 → −1). Acima da última vale a última;
//   - faixas por vendedor. Serviços: % própria, sem faixas. Frete não comissiona.
// Função pura (sem banco) — usada no cálculo da comissão e na estimativa da ficha.

export interface FaixaDesconto { ate_pct: number; pct: number }
export interface FaixaPrazo { ate_dias: number; reducao: number }
export interface RegraComissao {
  pct_locacao: number;
  pct_servicos: number;
  faixas_desconto: FaixaDesconto[];
  faixas_prazo: FaixaPrazo[];
}

export interface PctAplicada {
  pct: number;
  faixaDesconto: FaixaDesconto | null;
  faixaPrazo: FaixaPrazo | null;
  motivo: string;
}

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function normalizarFaixasDesconto(f: unknown): FaixaDesconto[] {
  return (Array.isArray(f) ? f : [])
    .map((x: any) => ({ ate_pct: num(x?.ate_pct), pct: num(x?.pct) }))
    .filter(x => x.ate_pct > 0 && x.pct >= 0)
    .sort((a, b) => a.ate_pct - b.ate_pct);
}
export function normalizarFaixasPrazo(f: unknown): FaixaPrazo[] {
  return (Array.isArray(f) ? f : [])
    .map((x: any) => ({ ate_dias: Math.floor(num(x?.ate_dias)), reducao: num(x?.reducao) }))
    .filter(x => x.ate_dias > 0 && x.reducao >= 0)
    .sort((a, b) => a.ate_dias - b.ate_dias);
}

/** % de comissão de locação para um desconto (% sobre a tabela) e dias não cobrados. */
export function pctLocacaoAplicada(regra: RegraComissao, descontoPct: number, diasNaoCobrados: number): PctAplicada {
  const fd = normalizarFaixasDesconto(regra.faixas_desconto);
  const fp = normalizarFaixasPrazo(regra.faixas_prazo);
  let pct = num(regra.pct_locacao);
  let faixaDesconto: FaixaDesconto | null = null;
  let faixaPrazo: FaixaPrazo | null = null;
  const partes: string[] = [];

  if (descontoPct > 0.005 && fd.length) {
    faixaDesconto = fd.find(f => descontoPct <= f.ate_pct + 0.005) || fd[fd.length - 1];
    pct = faixaDesconto.pct;
    partes.push(`desconto ${fmt(descontoPct)}% → faixa até ${fmt(faixaDesconto.ate_pct)}%`);
  }
  const dias = Math.max(0, Math.floor(diasNaoCobrados || 0));
  if (dias > 0 && fp.length) {
    faixaPrazo = fp.find(f => dias <= f.ate_dias) || fp[fp.length - 1];
    pct = Math.max(0, pct - faixaPrazo.reducao);
    partes.push(`${dias} dia(s) a menos → −${fmt(faixaPrazo.reducao)} ponto(s)`);
  }
  pct = Math.round(pct * 10000) / 10000;
  return { pct, faixaDesconto, faixaPrazo, motivo: partes.length ? partes.join(' · ') : 'tabela e prazo padrão (cheia)' };
}

export const REGRA_VAZIA: RegraComissao = { pct_locacao: 0, pct_servicos: 0, faixas_desconto: [], faixas_prazo: [] };
