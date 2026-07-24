// lib/gerarReciboOpPdf.ts
// Gera o PDF do recibo de uma Ordem de Pagamento para envio à Autentique.
// Mesma técnica de app/lib/gerarHoleritePdf.ts (pdf-lib, JS puro, sem headless
// Chrome — compatível com serverless/Vercel).
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import { ItemOPNormalizado } from '../admin/op/utils';

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso: string) => { if (!iso) return '—'; const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };

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

export interface DadosReciboOpPdf {
  numero_op?: string | null;
  os_numero: string;
  os_cliente: string;
  os_evento?: string;
  os_periodo?: string;
  empresa_recebedora: string;
  cnpj_cpf_recebedora?: string;
  itens: ItemOPNormalizado[];
  total_geral: number;
  data_vencimento: string; // YYYY-MM-DD
  empresaNome?: string;
}

export async function gerarReciboOpPdf(p: DadosReciboOpPdf): Promise<Uint8Array> {
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
  txt(p.empresaNome || 'RENTECH', M, y - 4, 18, bold, azul);
  txtRight('RECIBO DE PAGAMENTO', width - M, y - 2, 13, bold, azul);
  txtRight(`OP: ${p.numero_op || '—'}`, width - M, y - 18, 9, font, cinza);
  txtRight(`Vencimento: ${dataBR(p.data_vencimento)}`, width - M, y - 30, 9, bold, verde);
  y -= 42;
  linha(M, y, width - M, 1.5, preto);
  y -= 18;

  // ===== Dados da OS / evento =====
  box(M, y - 46, width - 2 * M, 58, cinzaClaro);
  txt('REFERENTE A', M + 8, y - 4, 7, bold, cinza);
  txt(`OS ${p.os_numero || 'S/N'} — ${p.os_cliente || ''}`.toUpperCase(), M + 8, y - 16, 11, bold, preto);
  txt(`Evento: ${p.os_evento || '—'}`, M + 8, y - 30, 8, font, preto);
  txt(`Período: ${p.os_periodo || '—'}`, M + 8, y - 41, 8, font, preto);
  y -= 62;

  // ===== Dados do favorecido =====
  box(M, y - 34, width - 2 * M, 38, cinzaClaro);
  txt('FAVORECIDO', M + 8, y - 4, 7, bold, cinza);
  txt((p.empresa_recebedora || '').toUpperCase(), M + 8, y - 16, 11, bold, preto);
  if (p.cnpj_cpf_recebedora) txt(`CPF/CNPJ: ${p.cnpj_cpf_recebedora}`, M + 8, y - 28, 8, font, preto);
  y -= 50;

  // ===== Tabela de itens =====
  const topTab = y;
  box(M, y - 14, width - 2 * M, 16, azul);
  txt('DESCRIÇÃO', M + 6, y - 10, 8, bold, rgb(1, 1, 1));
  txt('QTD', width - M - 170, y - 10, 8, bold, rgb(1, 1, 1));
  txt('VALOR UNIT.', width - M - 120, y - 10, 8, bold, rgb(1, 1, 1));
  txtRight('TOTAL', width - M - 6, y - 10, 8, bold, rgb(1, 1, 1));
  y -= 18;

  const linhaAltura = 15;
  p.itens.forEach((item, i) => {
    const yy = y - i * linhaAltura - 4;
    if (i % 2 === 1) box(M, yy - 3, width - 2 * M, linhaAltura, rgb(0.97, 0.98, 0.99));
    txt((item.descricao || '').slice(0, 55), M + 6, yy, 8);
    txt(String(item.qtd), width - M - 170, yy, 8, font, cinza);
    txt(BRL(item.valor_unitario), width - M - 120, yy, 8, font, cinza);
    txtRight(BRL(item.total), width - M - 6, yy, 8);
  });
  y -= p.itens.length * linhaAltura + 6;

  const botTab = y - 4;
  [M, width - M].forEach(x => page.drawLine({ start: { x, y: topTab + 2 }, end: { x, y: botTab }, thickness: 1, color: preto }));
  y -= 20;

  // ===== Total =====
  box(M, y - 22, width - 2 * M, 26, azul);
  txt('VALOR TOTAL', M + 8, y - 14, 11, bold, rgb(1, 1, 1));
  txtRight(BRL(p.total_geral), width - M - 8, y - 15, 14, bold, rgb(1, 1, 1));
  y -= 30;
  txt(extenso(p.total_geral), M + 2, y, 8, font, cinza);
  y -= 34;

  // ===== Texto de confirmação =====
  const textoConfirmacao = `Confirmo o recebimento da importância de ${BRL(p.total_geral)}, referente à prestação de serviços como favorecido (${p.empresa_recebedora}) no evento ${p.os_cliente || '—'}.`;
  const larguraMax = width - 2 * M;
  const palavras = textoConfirmacao.split(' ');
  let linhaAtual = '';
  const linhasTexto: string[] = [];
  for (const palavra of palavras) {
    const teste = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;
    if (font.widthOfTextAtSize(teste, 9) > larguraMax) {
      linhasTexto.push(linhaAtual);
      linhaAtual = palavra;
    } else {
      linhaAtual = teste;
    }
  }
  if (linhaAtual) linhasTexto.push(linhaAtual);
  linhasTexto.forEach((l, i) => txt(l, M, y - i * 13, 9, font, preto));
  y -= linhasTexto.length * 13 + 30;

  // ===== Assinatura (espaço reservado — preenchido pela Autentique) =====
  const xSig = M + 60;
  linha(xSig, y, width - M - 60, 1, preto);
  y -= 12;
  const nomeW = bold.widthOfTextAtSize((p.empresa_recebedora || '').toUpperCase(), 9);
  txt((p.empresa_recebedora || '').toUpperCase(), width / 2 - nomeW / 2, y, 9, bold);
  y -= 11;
  const s2 = 'Assinatura de Quitação';
  txt(s2, width / 2 - font.widthOfTextAtSize(s2, 7) / 2, y, 7, font, cinza);

  txt('Documento gerado eletronicamente pelo sistema de OP da RENTECH.', M, M, 7, font, cinza);

  return await pdf.save();
}
