// app/lib/relatorios/gerarRelatorioPdf.ts
// PDF genérico do HUB Relatórios (2026-11-17): título, filtros, indicadores e
// tabelas, em A4 deitado. A tela manda os textos já formatados. Só servidor.
import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { AZUL, CINZA, CINZA_CLARO, FUNDO, BRANCO, s, quebrar, larguraReal, lerLogo } from '../locacao/pdfBase';

export interface TabelaPdf { titulo: string; colunas: { titulo: string; direita?: boolean; peso?: number }[]; linhas: string[][]; rodape?: string[] }
export interface DadosRelatorioPdf { titulo: string; subtitulo: string; indicadores: { rotulo: string; valor: string; detalhe?: string }[]; tabelas: TabelaPdf[] }

const W = 841.89, H = 595.28, M = 28;
const LARG = W - 2 * M;

export async function gerarRelatorioPdf(d: DadosRelatorioPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.titulo);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null as Awaited<ReturnType<typeof pdf.embedPng>> | null;
  const b = lerLogo('RENTECH');
  if (b) { try { logo = await pdf.embedPng(b); } catch { logo = null; } }

  let pg!: PDFPage;
  let y = 0;
  const texto = (t: string, x: number, yy: number, tam = 8, fonte = f, cor = AZUL) => pg.drawText(s(t), { x, y: yy, size: tam, font: fonte, color: cor });
  const direita = (t: string, xd: number, yy: number, tam = 8, fonte = f, cor = AZUL) => texto(t, xd - larguraReal(fonte, s(t), tam), yy, tam, fonte, cor);

  const novaPagina = () => {
    pg = pdf.addPage([W, H]);
    y = H - M;
    pg.drawRectangle({ x: M, y: y - 34, width: LARG, height: 34, color: AZUL });
    let xt = M + 12;
    if (logo) {
      const h = 22, w = h * (logo.width / logo.height);
      pg.drawRectangle({ x: M + 8, y: y - 30, width: w + 6, height: h + 4, color: BRANCO });
      pg.drawImage(logo, { x: M + 11, y: y - 28, width: w, height: h });
      xt = M + w + 26;
    }
    texto(d.titulo.toUpperCase(), xt, y - 15, 11, fb, BRANCO);
    texto(d.subtitulo, xt, y - 27, 7.5, f, rgb(0.85, 0.9, 1));
    direita(`Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, W - M - 10, y - 21, 7, f, rgb(0.85, 0.9, 1));
    y -= 44;
  };
  const garantir = (h: number) => { if (y - h < M + 16) { novaPagina(); return true; } return false; };

  novaPagina();
  // indicadores
  if (d.indicadores.length) {
    const porLinha = Math.min(6, d.indicadores.length);
    const w = (LARG - (porLinha - 1) * 8) / porLinha;
    for (let i = 0; i < d.indicadores.length; i += porLinha) {
      garantir(46);
      d.indicadores.slice(i, i + porLinha).forEach((k, j) => {
        const x = M + j * (w + 8);
        pg.drawRectangle({ x, y: y - 40, width: w, height: 40, color: FUNDO });
        texto(k.rotulo.toUpperCase(), x + 8, y - 12, 6.5, fb, CINZA);
        texto(k.valor, x + 8, y - 26, 12, fb);
        if (k.detalhe) texto(quebrar(k.detalhe, f, 6.5, w - 16)[0] || '', x + 8, y - 36, 6.5, f, CINZA);
      });
      y -= 48;
    }
    y -= 4;
  }
  // tabelas
  for (const t of d.tabelas) {
    if (!t.linhas.length) continue;
    const pesos = t.colunas.map(c => c.peso || 1);
    const tot = pesos.reduce((a, b2) => a + b2, 0);
    const larg = pesos.map(p => (p / tot) * LARG);
    const cab = () => {
      texto(t.titulo.toUpperCase(), M, y - 10, 9, fb);
      y -= 16;
      pg.drawRectangle({ x: M, y: y - 14, width: LARG, height: 14, color: AZUL });
      let x = M;
      t.colunas.forEach((c, i) => { if (c.direita) direita(c.titulo, x + larg[i] - 5, y - 10, 6.5, fb, BRANCO); else texto(c.titulo, x + 5, y - 10, 6.5, fb, BRANCO); x += larg[i]; });
      y -= 14;
    };
    garantir(50);
    cab();
    t.linhas.forEach((linha, li) => {
      if (garantir(14)) cab();
      if (li % 2 === 1) pg.drawRectangle({ x: M, y: y - 12, width: LARG, height: 12, color: FUNDO });
      let x = M;
      linha.forEach((v, i) => {
        const c = t.colunas[i];
        const txt = quebrar(v || '', f, 7, larg[i] - 10)[0] || '';
        if (c?.direita) direita(txt, x + larg[i] - 5, y - 9, 7); else texto(txt, x + 5, y - 9, 7);
        x += larg[i];
      });
      y -= 12;
    });
    if (t.rodape) {
      garantir(14);
      pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: AZUL });
      let x = M;
      t.rodape.forEach((v, i) => { const c = t.colunas[i]; if (c?.direita) direita(v, x + larg[i] - 5, y - 9, 7, fb); else texto(v, x + 5, y - 9, 7, fb); x += larg[i]; });
      y -= 14;
    }
    pg.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.4, color: CINZA_CLARO });
    y -= 14;
  }
  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    const t = s(`${d.titulo} · página ${i + 1} de ${paginas.length}`);
    p.drawText(t, { x: W / 2 - larguraReal(f, t, 6.5) / 2, y: 12, size: 6.5, font: f, color: CINZA });
  });
  return pdf.save();
}
