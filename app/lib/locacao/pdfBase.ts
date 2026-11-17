// app/lib/locacao/pdfBase.ts
// Peças comuns dos PDFs de locação (proposta e contrato), 2026-11-17.
// Só servidor (lê os logos de app/imgs). pdf-lib com Helvetica (WinAnsi).
import fs from 'node:fs';
import path from 'node:path';
import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export const AZUL = rgb(12 / 255, 29 / 255, 77 / 255);
export const AZUL_MEDIO = rgb(51 / 255, 102 / 255, 153 / 255);
export const CINZA = rgb(0.39, 0.45, 0.55);
export const CINZA_CLARO = rgb(0.89, 0.91, 0.94);
export const FUNDO = rgb(0.96, 0.97, 0.98);
export const BRANCO = rgb(1, 1, 1);
export const A4 = { w: 595.28, h: 841.89 };

const logos = new Map<string, Buffer>();
export function lerLogo(qual: 'RENTECH' | 'ALFALIGHT'): Buffer | null {
  if (!logos.has(qual)) {
    // caminhos literais de propósito: o file tracing da Vercel só empacota o
    // arquivo se enxergar o caminho fixo no código
    try {
      logos.set(qual, qual === 'ALFALIGHT'
        ? fs.readFileSync(path.join(process.cwd(), 'app', 'imgs', 'logo-alfalight.png'))
        : fs.readFileSync(path.join(process.cwd(), 'app', 'imgs', 'logo.png')));
    } catch { return null; }
  }
  return logos.get(qual) || null;
}

export const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dataBR = (iso?: string | null) => { if (!iso) return '—'; const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
export const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
export const num = (n: number, casas = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const dataExtenso = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${a}`; };

/** Helvetica do pdf-lib = WinAnsi; troca/tira o que não existe nela. */
export const s = (t?: string | null) => (t || '')
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/•/g, '-')
  .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');

export function quebrar(texto: string, fonte: PDFFont, tam: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const par of s(texto).split('\n')) {
    const palavras = par.split(/\s+/).filter(Boolean);
    if (!palavras.length) { linhas.push(''); continue; }
    let atual = '';
    for (const p of palavras) {
      const tent = atual ? `${atual} ${p}` : p;
      if (larguraReal(fonte, tent, tam) <= largura) { atual = tent; continue; }
      if (atual) linhas.push(atual);
      let resto = p;
      while (larguraReal(fonte, resto, tam) > largura && resto.length > 1) {
        let k = resto.length;
        while (k > 1 && larguraReal(fonte, resto.slice(0, k), tam) > largura) k--;
        linhas.push(resto.slice(0, k)); resto = resto.slice(k);
      }
      atual = resto;
    }
    if (atual) linhas.push(atual);
  }
  return linhas;
}

// ---------------------------------------------------------------------------
// Texto rico: **negrito** no meio do parágrafo, com quebra e justificação.
// ---------------------------------------------------------------------------
export interface Palavra { t: string; b: boolean }
export type LinhaRica = { palavras: Palavra[]; ultima: boolean };

export function palavrasRicas(texto: string): Palavra[] {
  const out: Palavra[] = [];
  s(texto).split('**').forEach((trecho, i) => {
    for (const w of trecho.split(/\s+/).filter(Boolean)) out.push({ t: w, b: i % 2 === 1 });
  });
  // pontuação colada depois de um trecho em negrito ("**LOCADORA**,") vira palavra própria: junta na anterior
  const juntas: Palavra[] = [];
  for (const p of out) {
    if (juntas.length && /^[,.;:)]+$/.test(p.t)) juntas[juntas.length - 1] = { ...juntas[juntas.length - 1], t: juntas[juntas.length - 1].t + p.t };
    else juntas.push(p);
  }
  return juntas;
}

/**
 * Largura SEM kerning: widthOfTextAtSize do pdf-lib desconta os pares de
 * kerning ("AT", "TA"…), mas o drawText desenha sem eles — medir com kerning
 * deixava palavras como "LOCATÁRIA" grudadas na seguinte. Mede letra a letra.
 */
export const larguraReal = (fonte: PDFFont, t: string, tam: number) => [...t].reduce((acc, ch) => acc + fonte.widthOfTextAtSize(ch, tam), 0);
const larguraPalavra = (p: Palavra, f: PDFFont, fb: PDFFont, tam: number) => larguraReal(p.b ? fb : f, p.t, tam);

export function quebrarRico(texto: string, f: PDFFont, fb: PDFFont, tam: number, largura: number): LinhaRica[] {
  const palavras = palavrasRicas(texto);
  const espaco = f.widthOfTextAtSize(' ', tam);
  const linhas: LinhaRica[] = [];
  let atual: Palavra[] = [];
  let w = 0;
  for (const p of palavras) {
    const lp = larguraPalavra(p, f, fb, tam);
    if (atual.length && w + espaco + lp > largura) { linhas.push({ palavras: atual, ultima: false }); atual = []; w = 0; }
    w += (atual.length ? espaco : 0) + lp;
    atual.push(p);
  }
  if (atual.length) linhas.push({ palavras: atual, ultima: true });
  return linhas;
}

export function desenharLinhaRica(pg: PDFPage, linha: LinhaRica, x: number, y: number, tam: number, f: PDFFont, fb: PDFFont, cor = AZUL, justificar = false, largura = 0) {
  const espaco = f.widthOfTextAtSize(' ', tam);
  const total = linha.palavras.reduce((acc, p) => acc + larguraPalavra(p, f, fb, tam), 0);
  const gaps = linha.palavras.length - 1;
  const passo = justificar && !linha.ultima && gaps > 0 ? (largura - total) / gaps : espaco;
  let xx = x;
  for (const p of linha.palavras) {
    pg.drawText(p.t, { x: xx, y, size: tam, font: p.b ? fb : f, color: cor });
    xx += larguraPalavra(p, f, fb, tam) + passo;
  }
}

const digitos = (t?: string | null) => (t || '').replace(/\D/g, '');
export function formatarDocumento(cnpj?: string | null, cpf?: string | null): string | null {
  const c = digitos(cnpj);
  if (c.length === 14) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  const p = digitos(cpf);
  if (p.length === 11) return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6, 9)}-${p.slice(9)}`;
  return cnpj || cpf || null;
}

/** "01 - TV" → "TV"; "18 - PAINEL DE LED" → "PAINEL DE LED". */
export const nomeCategoria = (c?: string | null) => (c || '').replace(/^\s*\d+\s*-\s*/, '').trim();
