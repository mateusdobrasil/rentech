// app/lib/locacao/etiquetasPatrimonio.ts
// Etiquetas de patrimônio com QR (PDF A4, 3 colunas × 8 linhas, 70 × 37 mm —
// formato comum de folha adesiva, ex. Pimaco A4 3x8). Roda no navegador.
// O QR carrega o qr_code do patrimônio ("PAT-<empresa>-<número>"), que é o
// que o app/expedição vai ler para dar saída e retorno peça a peça.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';

export interface EtiquetaPatrimonio {
  qr: string;
  numero: string;
  produto: string;
  empresa: string;
  serie?: string | null;
}

const MM = 72 / 25.4;
const A4 = { w: 210 * MM, h: 297 * MM };
const COLS = 3, LINHAS = 8;
const ETQ = { w: 70 * MM, h: 37 * MM };
const MARGEM_X = (A4.w - COLS * ETQ.w) / 2;
const MARGEM_Y = (A4.h - LINHAS * ETQ.h) / 2;

// Helvetica padrão do pdf-lib só tem WinAnsi — tira o que não cabe.
const seguro = (s: string) => (s || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[^\x20-\x7E -ÿ]/g, '');

function quebrar(texto: string, larguraMax: number, medir: (s: string) => number, maxLinhas: number): string[] {
  const palavras = seguro(texto).split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = '';
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (medir(tentativa) <= larguraMax) { atual = tentativa; continue; }
    if (atual) linhas.push(atual);
    atual = p;
    if (linhas.length === maxLinhas) break;
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual);
  if (linhas.length === maxLinhas && palavras.join(' ').length > linhas.join(' ').length) {
    let ult = linhas[maxLinhas - 1];
    while (ult.length > 1 && medir(`${ult}...`) > larguraMax) ult = ult.slice(0, -1);
    linhas[maxLinhas - 1] = `${ult}...`;
  }
  return linhas;
}

export async function gerarEtiquetasPatrimonioPdf(etiquetas: EtiquetaPatrimonio[], posicaoInicial = 0): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const azul = rgb(12 / 255, 29 / 255, 77 / 255);
  const cinza = rgb(0.4, 0.45, 0.5);

  let pagina = pdf.addPage([A4.w, A4.h]);
  let pos = Math.max(0, Math.min(COLS * LINHAS - 1, Math.floor(posicaoInicial)));

  for (const e of etiquetas) {
    if (pos >= COLS * LINHAS) { pagina = pdf.addPage([A4.w, A4.h]); pos = 0; }
    const col = pos % COLS, lin = Math.floor(pos / COLS);
    const x0 = MARGEM_X + col * ETQ.w;
    const y0 = A4.h - MARGEM_Y - (lin + 1) * ETQ.h;

    const png = await QRCode.toDataURL(e.qr, { margin: 0, width: 300, errorCorrectionLevel: 'M' });
    const img = await pdf.embedPng(png);
    const lado = 27 * MM;
    const pad = 4 * MM;
    pagina.drawImage(img, { x: x0 + pad, y: y0 + (ETQ.h - lado) / 2, width: lado, height: lado });

    const tx = x0 + pad + lado + 3 * MM;
    const larg = ETQ.w - (tx - x0) - pad;
    let y = y0 + ETQ.h - pad - 7;

    pagina.drawText(seguro(e.empresa).toUpperCase().slice(0, 30), { x: tx, y, size: 6, font: negrito, color: cinza });
    y -= 13;
    let tamNumero = 12;
    while (tamNumero > 7 && negrito.widthOfTextAtSize(seguro(e.numero), tamNumero) > larg) tamNumero--;
    pagina.drawText(seguro(e.numero), { x: tx, y, size: tamNumero, font: negrito, color: azul });
    y -= 10;
    for (const l of quebrar(e.produto, larg, s => fonte.widthOfTextAtSize(s, 6.5), 3)) {
      pagina.drawText(l, { x: tx, y, size: 6.5, font: fonte, color: azul });
      y -= 8;
    }
    if (e.serie) pagina.drawText(`S/N ${seguro(e.serie)}`.slice(0, 34), { x: tx, y: y0 + pad, size: 5.5, font: fonte, color: cinza });

    pos++;
  }
  return pdf.save();
}
