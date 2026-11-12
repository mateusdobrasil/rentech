// app/lib/formatadores.ts
// Formatadores de exibição compartilhados (tela e servidor). Antes cada página
// tinha a sua cópia local (BRL, fmtBRL, formatCurrency, fmtData, dataBR...) —
// tour de melhorias 2026-11-11, item 7. Os nomes locais antigos continuam
// existindo nos arquivos como apelido destes (ex.: `const BRL = formatarMoeda`).
//
// Ficaram de fora, de propósito, os que têm comportamento próprio: data com
// fuso de São Paulo (timestamps), data por extenso, "---" de vazio e o valor
// com espaço comum no lugar do não separável (texto enviado ao P2S).

// R$ 1.234,56 — aceita número, texto numérico, null e undefined (vira R$ 0,00).
export const formatarMoeda = (valor: number | string | null | undefined): string =>
  (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// "2026-11-11" (ou "2026-11-11T15:00:00Z", só a parte da data) → "11/11/2026".
// Vazio/null → `vazio` (padrão "—"). Data pura, sem conversão de fuso.
export const formatarDataBR = (iso: string | null | undefined, vazio = '—'): string => {
  if (!iso) return vazio;
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : vazio;
};

// ============================================================================
// VALOR POR EXTENSO (pt-BR) — holerite e rescisão (protege o valor numérico
// contra adulteração). Ex.: 1234.5 → "MIL DUZENTOS E TRINTA E QUATRO REAIS E
// CINQUENTA CENTAVOS".
// ============================================================================
const UNIDADES = ['', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE'];
const DEZ_A_DEZENOVE = ['DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
const DEZENAS = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
const CENTENAS = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];

const trioParaExtenso = (n: number): string => {
  if (n === 0) return '';
  if (n === 100) return 'CEM';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const d = Math.floor(resto / 10);
  const u = resto % 10;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto >= 10 && resto <= 19) {
    partes.push(DEZ_A_DEZENOVE[resto - 10]);
  } else {
    if (d > 0) partes.push(DEZENAS[d]);
    if (u > 0) partes.push(UNIDADES[u]);
  }
  return partes.join(' E ');
};

export const numeroParaExtenso = (valor: number): string => {
  const negativo = valor < 0;
  const absoluto = Math.abs(valor || 0);
  let reais = Math.floor(absoluto);
  let centavos = Math.round((absoluto - reais) * 100);
  if (centavos === 100) { reais += 1; centavos = 0; }

  const milhoes = Math.floor(reais / 1_000_000);
  const milhares = Math.floor((reais % 1_000_000) / 1000);
  const resto = reais % 1000;

  const partes: string[] = [];
  if (milhoes > 0) partes.push(`${trioParaExtenso(milhoes)} ${milhoes === 1 ? 'MILHÃO' : 'MILHÕES'}`);
  if (milhares > 0) partes.push(milhares === 1 ? 'MIL' : `${trioParaExtenso(milhares)} MIL`);
  if (resto > 0) partes.push(trioParaExtenso(resto));

  let texto = partes.length > 0 ? partes.join(' E ') : 'ZERO';
  if (reais === 1) texto += ' REAL';
  else if (milhoes > 0 && reais % 1_000_000 === 0) texto += ' DE REAIS';
  else texto += ' REAIS';
  if (centavos > 0) texto += ` E ${trioParaExtenso(centavos)} ${centavos === 1 ? 'CENTAVO' : 'CENTAVOS'}`;
  return `${negativo ? 'MENOS ' : ''}${texto}`;
};
