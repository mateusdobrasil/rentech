// app/lib/financeiro/parcelas.ts
// Sugestão de parcelas a partir do texto livre da condição de pagamento da
// ficha (2026-11-17). Funções puras (navegador e servidor). É só sugestão:
// a tela mostra as parcelas para o usuário conferir/editar antes de gerar.
//   "à vista" / vazio      → 1 parcela em base+3 dias
//   "50% + 50%", "30/70%"  → percentuais: 1ª em base+3, demais no fim do evento (+30 a cada uma extra)
//   "30/60/90", "28 dias"  → prazos em dias a partir da base, parcelas iguais
//   "3x", "3 vezes"        → 3 parcelas mensais iguais (1ª em base+3)
import { somarDias } from '../locacao/datas';

export interface ParcelaSugerida { valor: number; vencimento: string; descricao: string }

const arred = (v: number) => Math.round(v * 100) / 100;

function distribuir(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, p) => s + p, 0) || 1;
  const vals = pesos.map(p => arred((total * p) / soma));
  const dif = arred(total - vals.reduce((s, v) => s + v, 0));
  vals[vals.length - 1] = arred(vals[vals.length - 1] + dif); // centavos na última
  return vals;
}

export function sugerirParcelas(total: number, condicao: string | null | undefined, dataBase: string, fimEvento?: string | null): ParcelaSugerida[] {
  const t = (condicao || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!(total > 0)) return [];
  const primeira = somarDias(dataBase, 3);

  // percentuais
  const pcts = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(m => Number(m[1].replace(',', '.'))).filter(x => x > 0);
  if (pcts.length >= 2) {
    const vals = distribuir(total, pcts);
    const segunda = fimEvento && fimEvento > primeira ? fimEvento : somarDias(primeira, 30);
    return vals.map((v, i) => ({
      valor: v,
      vencimento: i === 0 ? primeira : somarDias(segunda, 30 * (i - 1)),
      descricao: `${pcts[i]}%`,
    }));
  }

  // Nx
  const nx = t.match(/(\d+)\s*(x|vezes|parcelas)\b/);
  if (nx && Number(nx[1]) >= 1 && Number(nx[1]) <= 24) {
    const n = Number(nx[1]);
    return distribuir(total, Array(n).fill(1)).map((v, i) => ({ valor: v, vencimento: somarDias(primeira, 30 * i), descricao: `${i + 1}/${n}` }));
  }

  // prazos em dias: "30/60/90", "28 dias", "30 60 90 ddl"
  const dias = [...t.matchAll(/\d+/g)].map(m => Number(m[0])).filter(d => d >= 0 && d <= 365);
  if (dias.length >= 1 && /\d/.test(t) && !/%/.test(t)) {
    return distribuir(total, Array(dias.length).fill(1)).map((v, i) => ({ valor: v, vencimento: somarDias(dataBase, dias[i]), descricao: `${dias[i]} dias` }));
  }

  return [{ valor: arred(total), vencimento: primeira, descricao: 'à vista' }];
}
