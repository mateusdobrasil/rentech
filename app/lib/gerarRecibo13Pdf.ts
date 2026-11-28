// lib/gerarRecibo13Pdf.ts
// Holerite de uma parcela do 13º Salário (Via Empresa), no MESMO modelo do
// holerite de salário (gerarHoleritePdf.ts): "Demonstrativo de Pagamento",
// tabela Créditos/Débitos, valor líquido e assinatura. Um por parcela, com o
// texto simples "13º Salário - 1ª parcela" / "13º Salário - 2ª parcela"
// (pedido do usuário, 2026-11-28).
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

let logoBytesCache: Buffer | null = null;
function lerLogoBytes(): Buffer {
  if (!logoBytesCache) {
    logoBytesCache = fs.readFileSync(path.join(process.cwd(), 'app', 'imgs', 'logo.png'));
  }
  return logoBytesCache;
}

export interface GerarRecibo13PdfParams {
  nome: string;
  cpf?: string | null;
  cargo?: string | null;
  tipoContrato?: string | null;
  ano: number;
  parcela: 1 | 2;
  valorLiquido: number;
  creditos: { descricao: string; valor: number }[];
  debitos: { descricao: string; valor: number }[];
  // Parcelas digitadas pela empresa (sem INSS/IRRF) × cálculo sugerido pela CLT.
  manual: boolean;
  calculadoEm?: string | null;
  empresaNome?: string;
}

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- valor por extenso (pt-BR) — mesma lógica de gerarHoleritePdf.ts ----
const U = ['', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE'];
const D10 = ['DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
const D = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
const C = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];
const trio = (n: number): string => {
  if (n === 0) return ''; if (n === 100) return 'CEM';
  const c = Math.floor(n / 100), r = n % 100, d = Math.floor(r / 10), u = r % 10; const p: string[] = [];
  if (c > 0) p.push(C[c]);
  if (r >= 10 && r <= 19) p.push(D10[r - 10]); else { if (d > 0) p.push(D[d]); if (u > 0) p.push(U[u]); }
  return p.join(' E ');
};
const extenso = (valor: number): string => {
  const abs = Math.abs(valor || 0); let reais = Math.floor(abs); let cent = Math.round((abs - reais) * 100);
  if (cent === 100) { reais++; cent = 0; }
  const mi = Math.floor(reais / 1_000_000), mil = Math.floor((reais % 1_000_000) / 1000), r = reais % 1000; const p: string[] = [];
  if (mi > 0) p.push(`${trio(mi)} ${mi === 1 ? 'MILHÃO' : 'MILHÕES'}`);
  if (mil > 0) p.push(mil === 1 ? 'MIL' : `${trio(mil)} MIL`);
  if (r > 0) p.push(trio(r));
  let t = p.length ? p.join(' E ') : 'ZERO';
  t += reais === 1 ? ' REAL' : ' REAIS';
  if (cent > 0) t += ` E ${trio(cent)} ${cent === 1 ? 'CENTAVO' : 'CENTAVOS'}`;
  return t;
};

export async function gerarRecibo13Pdf(p: GerarRecibo13PdfParams): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 retrato em pontos
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const preto = rgb(0, 0, 0);
  const azul = rgb(0.047, 0.114, 0.302);
  const cinza = rgb(0.4, 0.4, 0.4);
  const cinzaClaro = rgb(0.93, 0.95, 0.97);
  const verde = rgb(0.086, 0.639, 0.290);

  const M = 40;
  let y = height - M;
  const titulo13 = `13º Salário - ${p.parcela}ª parcela`;

  const txt = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = preto) =>
    page.drawText(s || '', { x, y: yy, size, font: f, color });
  const txtRight = (s: string, xRight: number, yy: number, size = 9, f: PDFFont = font, color = preto) => {
    const w = f.widthOfTextAtSize(s || '', size);
    page.drawText(s || '', { x: xRight - w, y: yy, size, font: f, color });
  };
  const linha = (x1: number, yy: number, x2: number, w = 1, color = preto) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });
  const box = (x: number, yy: number, w: number, h: number, color = cinzaClaro) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });

  // ===== Cabeçalho =====
  const logoImg = await pdf.embedPng(lerLogoBytes());
  const logoH = 28;
  const logoW = logoH * (logoImg.width / logoImg.height);
  page.drawImage(logoImg, { x: M, y: y - 24, width: logoW, height: logoH });
  txtRight('DEMONSTRATIVO DE PAGAMENTO', width - M, y - 2, 13, bold, azul);
  txtRight(`${titulo13} / ${p.ano}`, width - M, y - 18, 9, bold, verde);
  y -= 42;
  linha(M, y, width - M, 1.5, preto);
  y -= 18;

  // ===== Dados do funcionário =====
  box(M, y - 46, width - 2 * M, 58, cinzaClaro);
  txt('COLABORADOR', M + 8, y - 4, 7, bold, cinza);
  txt(p.nome.toUpperCase(), M + 8, y - 16, 11, bold, preto);
  txt(`Função: ${p.cargo || '—'}`, M + 8, y - 30, 8, font, preto);
  txt(`Contrato: ${p.tipoContrato || '—'}`, M + 8, y - 41, 8, font, preto);
  if (p.cpf) txtRight(`CPF: ${p.cpf}`, width - M - 8, y - 30, 8, font, preto);
  txtRight(`Emissão: ${p.calculadoEm ? new Date(p.calculadoEm).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')}`, width - M - 8, y - 41, 8, font, preto);
  y -= 62;

  // ===== Tabela Créditos / Débitos =====
  const colGap = 12;
  const colW = (width - 2 * M - colGap) / 2;
  const xCred = M;
  const xDeb = M + colW + colGap;
  const topTab = y;

  box(xCred, y - 14, colW, 16, azul);
  box(xDeb, y - 14, colW, 16, azul);
  txt('CRÉDITOS', xCred + colW / 2 - 22, y - 10, 9, bold, rgb(1, 1, 1));
  txt('DÉBITOS', xDeb + colW / 2 - 20, y - 10, 9, bold, rgb(1, 1, 1));
  y -= 20;

  const linhaAltura = 15;
  const maxLinhas = Math.max(p.creditos.length, p.debitos.length, 4);
  const yLinhas = y;
  for (let i = 0; i < maxLinhas; i++) {
    const yy = yLinhas - i * linhaAltura - 4;
    if (i % 2 === 1) { box(xCred, yy - 3, colW, linhaAltura, rgb(0.97, 0.98, 0.99)); box(xDeb, yy - 3, colW, linhaAltura, rgb(0.97, 0.98, 0.99)); }
    if (p.creditos[i]) {
      txt(p.creditos[i].descricao.toUpperCase().slice(0, 34), xCred + 6, yy, 8);
      txtRight(BRL(p.creditos[i].valor), xCred + colW - 6, yy, 8);
    }
    if (p.debitos[i]) {
      txt(p.debitos[i].descricao.toUpperCase().slice(0, 34), xDeb + 6, yy, 8);
      txtRight(BRL(p.debitos[i].valor), xDeb + colW - 6, yy, 8);
    }
  }
  y = yLinhas - maxLinhas * linhaAltura - 6;

  const totalCreditos = p.creditos.reduce((s, c) => s + c.valor, 0);
  const totalDebitos = p.debitos.reduce((s, d) => s + d.valor, 0);
  box(xCred, y - 14, colW, 16, cinzaClaro);
  box(xDeb, y - 14, colW, 16, cinzaClaro);
  txt('TOTAL CRÉDITOS', xCred + 6, y - 10, 8, bold);
  txtRight(BRL(totalCreditos), xCred + colW - 6, y - 10, 9, bold);
  txt('TOTAL DÉBITOS', xDeb + 6, y - 10, 8, bold);
  txtRight(BRL(totalDebitos), xDeb + colW - 6, y - 10, 9, bold);

  const botTab = y - 14;
  [xCred, xCred + colW, xDeb, xDeb + colW].forEach(x => page.drawLine({ start: { x, y: topTab + 2 }, end: { x, y: botTab }, thickness: 1, color: preto }));
  y -= 30;

  // ===== Líquido =====
  box(M, y - 22, width - 2 * M, 26, azul);
  txt('VALOR LÍQUIDO A RECEBER', M + 8, y - 14, 11, bold, rgb(1, 1, 1));
  txtRight(BRL(p.valorLiquido), width - M - 8, y - 15, 14, bold, rgb(1, 1, 1));
  y -= 30;
  txt(extenso(p.valorLiquido), M + 2, y, 8, font, cinza);
  y -= 40;

  // ===== Assinatura =====
  const xSig = M + 60;
  linha(xSig, y, width - M - 60, 1, preto);
  y -= 12;
  const nomeW = bold.widthOfTextAtSize(p.nome.toUpperCase(), 9);
  txt(p.nome.toUpperCase(), width / 2 - nomeW / 2, y, 9, bold);
  y -= 11;
  const s2 = `Assinatura de Quitação — ${titulo13}`;
  txt(s2, width / 2 - font.widthOfTextAtSize(s2, 7) / 2, y, 7, font, cinza);

  // Rodapé
  const empresa = (p.empresaNome || 'RENTECH').toUpperCase();
  txt(
    p.manual
      ? `Documento gerado eletronicamente pelo sistema de folha da ${empresa} — valores definidos pela empresa.`
      : `Documento gerado eletronicamente pelo sistema de folha da ${empresa} — valores calculados por regras gerais da CLT, sujeitos a conferência contábil.`,
    M, M, 6.5, font, cinza
  );

  return await pdf.save();
}
