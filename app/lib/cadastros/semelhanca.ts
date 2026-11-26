// app/lib/cadastros/semelhanca.ts
// Semelhança entre nomes de itens ("Mesa Digital Yamaha TF5" × "MESA DE SOM
// DIGITAL YAMAHA TF5"): Dice ponderado sobre as palavras, sem acento e sem
// palavras vazias. Palavra com número (modelo, polegada) pesa o dobro; prefixo
// de 4+ letras conta meio ("micro" × "microfone"). 0 = nada a ver, 1 = igual.
const VAZIAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'COM', 'PARA', 'P', 'X', 'C', 'EM', 'A', 'O', 'AS', 'OS', 'UN', 'PC', 'PCS']);

export const normalizarNome = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function palavras(nome: unknown): string[] {
  return [...new Set(normalizarNome(nome).replace(/["”″']/g, ' ').split(/[^A-Z0-9]+/).filter(p => p && !VAZIAS.has(p)))];
}

const peso = (p: string) => (/\d/.test(p) ? 2 : 1);

export function semelhanca(a: unknown, b: unknown): number {
  const A = palavras(a), B = palavras(b);
  if (!A.length || !B.length) return 0;
  let comum = 0;
  const usadas = new Set<string>();
  for (const p of A) {
    if (B.includes(p)) { comum += peso(p); usadas.add(p); continue; }
    const parcial = p.length >= 4 && B.find(q => !usadas.has(q) && q.length >= 4 && (q.startsWith(p) || p.startsWith(q)));
    if (parcial) { comum += peso(p) / 2; usadas.add(parcial); }
  }
  const total = A.reduce((s, p) => s + peso(p), 0) + B.reduce((s, p) => s + peso(p), 0);
  return Math.round(((2 * comum) / total) * 100) / 100;
}

export interface Sugestao<T> { item: T; nota: number }

/** As `max` mais parecidas acima de `minimo`, da maior para a menor. */
export function maisParecidos<T>(nome: string, lista: T[], nomeDe: (x: T) => string, max = 3, minimo = 0.3): Sugestao<T>[] {
  return lista.map(item => ({ item, nota: semelhanca(nome, nomeDe(item)) }))
    .filter(s => s.nota >= minimo).sort((x, y) => y.nota - x.nota).slice(0, max);
}
