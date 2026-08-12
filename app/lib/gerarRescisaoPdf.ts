// lib/gerarRescisaoPdf.ts
// Gera o Termo de Rescisão (TRCT) no servidor usando pdf-lib, no mesmo
// padrão visual do holerite (gerarHoleritePdf.ts) — cabeçalho com logo,
// dados do colaborador, duas colunas (proventos/descontos), totais e
// assinatura. Serve tanto pra "visualizar o que calculamos" quanto pra
// anexar/enviar pra assinatura via Autentique.
//
// ATENÇÃO: reflete o cálculo estimado pelo sistema (app/lib/calculoRescisao.ts).
// Conferir com a contabilidade antes de tratar como documento oficial.
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

export interface ItemRescisaoPdf {
  descricao: string;
  tipo: 'PROVENTO' | 'DESCONTO' | 'INFORMATIVO';
  valor: number;
}

export interface GerarRescisaoPdfParams {
  nome: string;
  cpf?: string | null;
  cargo?: string | null;
  dataAdmissao: string | null;
  dataDesligamento: string;
  motivoLabel: string;
  avisoPrevioLabel: string;
  itens: ItemRescisaoPdf[];
  totalProventos: number;
  totalDescontos: number;
  valorLiquido: number;
  saldoFgtsInformado?: number | null;
  fgtsPercentualMulta?: number | null;
  fgtsValorMulta?: number | null;
  calculadoEm?: string | null;
  empresaNome?: string;
}

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso: string | null | undefined) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

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

export async function gerarRescisaoPdf(p: GerarRescisaoPdfParams): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 retrato em pontos
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const preto = rgb(0, 0, 0);
  const azul = rgb(0.047, 0.114, 0.302);
  const cinza = rgb(0.4, 0.4, 0.4);
  const cinzaClaro = rgb(0.93, 0.95, 0.97);
  const vermelho = rgb(0.7, 0.11, 0.11);

  const M = 40;
  let y = height - M;

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
  txtRight('TERMO DE RESCISÃO DO CONTRATO DE TRABALHO', width - M, y - 2, 12, bold, azul);
  txtRight(`Desligamento: ${dataBR(p.dataDesligamento)}`, width - M, y - 18, 9, font, cinza);
  txtRight(`Emissão: ${p.calculadoEm ? new Date(p.calculadoEm).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')}`, width - M, y - 30, 9, font, cinza);
  y -= 42;
  linha(M, y, width - M, 1.5, preto);
  y -= 18;

  // ===== Dados do colaborador =====
  box(M, y - 58, width - 2 * M, 70, cinzaClaro);
  txt('COLABORADOR', M + 8, y - 4, 7, bold, cinza);
  txt(p.nome.toUpperCase(), M + 8, y - 16, 11, bold, preto);
  txt(`Função: ${p.cargo || '—'}`, M + 8, y - 30, 8, font, preto);
  txt(`Admissão: ${dataBR(p.dataAdmissao)}`, M + 8, y - 42, 8, font, preto);
  txt(`Desligamento: ${dataBR(p.dataDesligamento)}`, M + 8, y - 54, 8, font, preto);
  if (p.cpf) txtRight(`CPF: ${p.cpf}`, width - M - 8, y - 30, 8, font, preto);
  txtRight(`Motivo: ${p.motivoLabel}`, width - M - 8, y - 42, 8, font, preto);
  txtRight(`Aviso prévio: ${p.avisoPrevioLabel}`, width - M - 8, y - 54, 8, font, preto);
  y -= 74;

  // ===== Tabela Proventos / Descontos =====
  const colGap = 12;
  const colW = (width - 2 * M - colGap) / 2;
  const xCred = M;
  const xDeb = M + colW + colGap;
  const topTab = y;

  box(xCred, y - 14, colW, 16, azul);
  box(xDeb, y - 14, colW, 16, azul);
  txt('PROVENTOS', xCred + colW / 2 - 24, y - 10, 9, bold, rgb(1, 1, 1));
  txt('DESCONTOS', xDeb + colW / 2 - 24, y - 10, 9, bold, rgb(1, 1, 1));
  y -= 20;

  const proventos = p.itens.filter(i => i.tipo === 'PROVENTO');
  const descontos = p.itens.filter(i => i.tipo === 'DESCONTO');

  const linhaAltura = 15;
  const maxLinhas = Math.max(proventos.length, descontos.length, 4);
  const yLinhas = y;

  for (let i = 0; i < maxLinhas; i++) {
    const yy = yLinhas - i * linhaAltura - 4;
    if (i % 2 === 1) { box(xCred, yy - 3, colW, linhaAltura, rgb(0.97, 0.98, 0.99)); box(xDeb, yy - 3, colW, linhaAltura, rgb(0.97, 0.98, 0.99)); }
    if (proventos[i]) {
      txt(proventos[i].descricao.toUpperCase().slice(0, 42), xCred + 6, yy, 8);
      txtRight(BRL(proventos[i].valor), xCred + colW - 6, yy, 8);
    }
    if (descontos[i]) {
      txt(descontos[i].descricao.toUpperCase().slice(0, 42), xDeb + 6, yy, 8);
      txtRight(BRL(descontos[i].valor), xDeb + colW - 6, yy, 8);
    }
  }
  y = yLinhas - maxLinhas * linhaAltura - 6;

  box(xCred, y - 14, colW, 16, cinzaClaro);
  box(xDeb, y - 14, colW, 16, cinzaClaro);
  txt('TOTAL PROVENTOS', xCred + 6, y - 10, 8, bold);
  txtRight(BRL(p.totalProventos), xCred + colW - 6, y - 10, 9, bold);
  txt('TOTAL DESCONTOS', xDeb + 6, y - 10, 8, bold);
  txtRight(BRL(p.totalDescontos), xDeb + colW - 6, y - 10, 9, bold);

  const botTab = y - 14;
  [xCred, xCred + colW, xDeb, xDeb + colW].forEach(x => page.drawLine({ start: { x, y: topTab + 2 }, end: { x, y: botTab }, thickness: 1, color: preto }));
  y -= 30;

  // ===== Líquido =====
  box(M, y - 22, width - 2 * M, 26, azul);
  txt('VALOR LÍQUIDO A RECEBER', M + 8, y - 14, 11, bold, rgb(1, 1, 1));
  txtRight(BRL(p.valorLiquido), width - M - 8, y - 15, 14, bold, rgb(1, 1, 1));
  y -= 30;
  txt(extenso(p.valorLiquido), M + 2, y, 8, font, cinza);
  y -= 20;

  // ===== FGTS (informativo — não soma no líquido) =====
  if (p.saldoFgtsInformado != null) {
    txt(
      `FGTS — saldo informado: ${BRL(p.saldoFgtsInformado)}  |  multa ${p.fgtsPercentualMulta ?? 0}%: ${BRL(p.fgtsValorMulta || 0)}  (depositado na conta do FGTS, não incluso no valor líquido acima)`,
      M, y, 7.5, font, vermelho
    );
    y -= 22;
  } else {
    y -= 8;
  }

  // ===== Assinatura =====
  const xSig = M + 60;
  linha(xSig, y, width - M - 60, 1, preto);
  y -= 12;
  const nomeW = bold.widthOfTextAtSize(p.nome.toUpperCase(), 9);
  txt(p.nome.toUpperCase(), width / 2 - nomeW / 2, y, 9, bold);
  y -= 11;
  const s2 = 'Assinatura de Quitação da Rescisão';
  txt(s2, width / 2 - font.widthOfTextAtSize(s2, 7) / 2, y, 7, font, cinza);

  // Rodapé
  txt(
    'Documento gerado eletronicamente pelo sistema de folha da RENTECH — valores calculados por regras gerais da CLT, sujeitos a conferência contábil.',
    M, M, 6.5, font, cinza
  );

  return await pdf.save();
}
