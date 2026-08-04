// lib/gerarReciboPdf.ts
// Gera o recibo de pagamento (página de quitação, só o valor total — sem
// tabela de créditos/débitos) no servidor, usando pdf-lib. Anexado como o
// ÚLTIMO arquivo do pacote de assinatura de TODOS os colaboradores: quem tem
// folha calculada usa o valorLiquidoReceber do snapshot; quem é só
// documental usa o valor digitado manualmente pelo RH ao enviar.
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

let logoBytesCache: Buffer | null = null;
function lerLogoBytes(): Buffer {
  if (!logoBytesCache) {
    logoBytesCache = fs.readFileSync(path.join(process.cwd(), 'app', 'imgs', 'logo.png'));
  }
  return logoBytesCache;
}

export interface GerarReciboPdfParams {
  nome: string;
  cpf?: string | null;
  mesReferencia: string; // competência 'AAAA-MM'
  valor: number;
  formaPagamento: string; // 'PIX' | 'Transferência bancária' | 'A combinar'
  feriados?: string[]; // feriados do mês de pagamento, para calcular o 5º dia útil
  empresaNome?: string;
  // Discrimina de onde vem o "VALOR RECEBIDO" (ex.: salário líquido calculado
  // pela Rentech + holerite pago à parte pela contabilidade) — soma sempre
  // igual a `valor`. Puramente informativo/transparência.
  detalhamento?: { descricao: string; valor: number }[];
  // Benefícios fixos ativos do funcionário referentes ao MÊS SEGUINTE à
  // competência do holerite (ex.: holerite de julho → benefício de agosto,
  // já que é creditado em cartão/plano para o mês que está por vir). Só
  // informativo: NÃO entra na soma de `valor` nem na declaração de quitação.
  beneficios?: { tipo: string; meio: string; valor: number }[];
  mesReferenciaBeneficio?: string; // competência 'AAAA-MM' dos benefícios acima
}

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesAnoBR = (iso: string) => { const [a, m] = iso.split('-'); return `${m}/${a}`; };
const dataBR = (iso: string) => iso.split('-').reverse().join('/');

// ---- valor por extenso (pt-BR) — mesmo algoritmo do gerarHoleritePdf.ts ----
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

// Data de pagamento: sempre o 5º dia útil do mês seguinte à competência,
// pulando sábado, domingo e os feriados informados — mesma regra de "dia
// útil" já usada no ponto (isDiaNaoUtil em app/admin/rh/ponto/page.tsx).
function calcularDataPagamento(mesReferencia: string, feriados: string[]): string {
  const [anoComp, mesComp] = mesReferencia.split('-').map(Number);
  let anoPag = anoComp, mesPag = mesComp + 1;
  if (mesPag > 12) { mesPag = 1; anoPag++; }

  let uteisEncontrados = 0;
  let dia = 1;
  const diasNoMes = new Date(anoPag, mesPag, 0).getDate();
  while (dia <= diasNoMes) {
    const dataIso = `${anoPag}-${String(mesPag).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const diaSemana = new Date(anoPag, mesPag - 1, dia).getDay();
    if (diaSemana !== 0 && diaSemana !== 6 && !feriados.includes(dataIso)) {
      uteisEncontrados++;
      if (uteisEncontrados === 5) return dataIso;
    }
    dia++;
  }
  // Fallback (não deve ocorrer): último dia do mês de pagamento.
  return `${anoPag}-${String(mesPag).padStart(2, '0')}-${String(diasNoMes).padStart(2, '0')}`;
}

export async function gerarReciboPdf(p: GerarReciboPdfParams): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 retrato em pontos
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const preto = rgb(0, 0, 0);
  const azul = rgb(0.047, 0.114, 0.302);
  const cinza = rgb(0.4, 0.4, 0.4);
  const cinzaClaro = rgb(0.93, 0.95, 0.97);

  const M = 40;
  let y = height - M;

  const txt = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = preto) =>
    page.drawText(s || '', { x, y: yy, size, font: f, color });
  const txtRight = (s: string, xRight: number, yy: number, size = 9, f: PDFFont = font, color = preto) => {
    const w = f.widthOfTextAtSize(s || '', size);
    page.drawText(s || '', { x: xRight - w, y: yy, size, font: f, color });
  };
  const txtWrap = (s: string, x: number, yy: number, maxWidth: number, size = 9.5, f: PDFFont = font, color = preto, lineHeight = 13): number => {
    const palavras = s.split(' ');
    let linha = '';
    let cursorY = yy;
    for (const palavra of palavras) {
      const teste = linha ? `${linha} ${palavra}` : palavra;
      if (f.widthOfTextAtSize(teste, size) > maxWidth && linha) {
        page.drawText(linha, { x, y: cursorY, size, font: f, color });
        cursorY -= lineHeight;
        linha = palavra;
      } else {
        linha = teste;
      }
    }
    if (linha) { page.drawText(linha, { x, y: cursorY, size, font: f, color }); cursorY -= lineHeight; }
    return cursorY;
  };
  const linha = (x1: number, yy: number, x2: number, w = 1, color = preto) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });
  const box = (x: number, yy: number, w: number, h: number, color = cinzaClaro) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });

  const feriados = p.feriados || [];
  const dataPagamento = calcularDataPagamento(p.mesReferencia, feriados);
  const referenteA = `Salário — Competência ${mesAnoBR(p.mesReferencia)}`;

  // ===== Cabeçalho =====
  const logoImg = await pdf.embedPng(lerLogoBytes());
  const logoH = 28;
  const logoW = logoH * (logoImg.width / logoImg.height);
  page.drawImage(logoImg, { x: M, y: y - 24, width: logoW, height: logoH });
  const titulo = 'RECIBO DE PAGAMENTO';
  txtRight(titulo, width - M, y - 2, 13, bold, azul);
  const comp = `Competência: ${mesAnoBR(p.mesReferencia)}`;
  txtRight(comp, width - M, y - 18, 9, font, cinza);
  y -= 42;
  linha(M, y, width - M, 1.5, preto);
  y -= 18;

  // ===== Colaborador =====
  box(M, y - 46, width - 2 * M, 58, cinzaClaro);
  txt('COLABORADOR', M + 8, y - 4, 7, bold, cinza);
  txt(p.nome.toUpperCase(), M + 8, y - 16, 11, bold, preto);
  if (p.cpf) txt(`CPF: ${p.cpf}`, M + 8, y - 30, 8, font, preto);
  y -= 62;

  // ===== Valor =====
  box(M, y - 22, width - 2 * M, 26, azul);
  txt('VALOR RECEBIDO', M + 8, y - 14, 11, bold, rgb(1, 1, 1));
  txtRight(BRL(p.valor), width - M - 8, y - 15, 14, bold, rgb(1, 1, 1));
  y -= 30;
  txt(extenso(p.valor), M + 2, y, 8, font, cinza);
  y -= 24;

  // ===== Composição do valor (de onde vem o total acima) =====
  if (p.detalhamento && p.detalhamento.length > 0) {
    txt('COMPOSIÇÃO DO VALOR', M, y, 7.5, bold, cinza);
    y -= 13;
    p.detalhamento.forEach((item) => {
      txt(item.descricao, M + 4, y, 8.5, font, preto);
      txtRight(BRL(item.valor), width - M - 4, y, 8.5, bold, preto);
      y -= 13;
    });
    y -= 10;
  }

  // ===== Declaração =====
  const declaracao =
    `Eu, ${p.nome.toUpperCase()}${p.cpf ? `, portador(a) do CPF nº ${p.cpf}` : ''}, declaro ter recebido da ` +
    `${(p.empresaNome || 'RENTECH').toUpperCase()}, nesta data, a importância de ` +
    `${BRL(p.valor)} (${extenso(p.valor).toLowerCase()}), referente a ${referenteA.toLowerCase()}, dando plena, geral e ` +
    `irrevogável quitação do valor ora recebido, nada mais tendo a reclamar a este título.`;
  y = txtWrap(declaracao, M, y, width - 2 * M, 9.5, font, rgb(0.12, 0.13, 0.16), 13.5);
  y -= 12;

  // ===== Detalhes =====
  const detalhes: [string, string][] = [
    ['REFERENTE A', referenteA],
    ['FORMA DE PAGAMENTO', p.formaPagamento],
    ['DATA DO PAGAMENTO', dataBR(dataPagamento)],
    ['EMISSÃO', new Date().toLocaleDateString('pt-BR')],
  ];
  const linhaAltura = 17;
  const topDet = y;
  detalhes.forEach(([label, valor], i) => {
    const yy = topDet - i * linhaAltura;
    if (i % 2 === 1) box(M, yy - linhaAltura + 5, width - 2 * M, linhaAltura, rgb(0.97, 0.98, 0.99));
    txt(label, M + 8, yy - 7, 7.5, bold, cinza);
    txtRight(valor, width - M - 8, yy - 7, 9, bold, preto);
  });
  const botDet = topDet - detalhes.length * linhaAltura + 5;
  y = botDet - 24;

  // ===== Benefícios do mês seguinte (informativo — fora da soma acima) =====
  if (p.beneficios && p.beneficios.length > 0) {
    const tituloBenef = p.mesReferenciaBeneficio
      ? `BENEFÍCIOS — COMPETÊNCIA ${mesAnoBR(p.mesReferenciaBeneficio)}`
      : 'BENEFÍCIOS';
    txt(tituloBenef, M, y, 9, bold, azul);
    y -= 12;
    txt('Creditados para o mês seguinte (cartão/plano); não compõem o valor declarado acima.', M, y, 7, font, cinza);
    y -= 14;
    p.beneficios.forEach((b) => {
      txt(`${b.tipo}${b.meio ? ` (${b.meio})` : ''}`, M + 4, y, 8.5, font, preto);
      txtRight(BRL(b.valor), width - M - 4, y, 8.5, bold, preto);
      y -= 13;
    });
    y -= 10;
  }

  // ===== Assinatura =====
  const xSig = M + 60;
  linha(xSig, y, width - M - 60, 1, preto);
  y -= 12;
  const nomeW = bold.widthOfTextAtSize(p.nome.toUpperCase(), 9);
  txt(p.nome.toUpperCase(), width / 2 - nomeW / 2, y, 9, bold);
  y -= 11;
  const s2 = 'Declaro ter recebido a importância acima descrita, dando plena quitação.';
  txt(s2, width / 2 - font.widthOfTextAtSize(s2, 7) / 2, y, 7, font, cinza);

  txt(`Documento gerado eletronicamente pelo sistema de folha da ${(p.empresaNome || 'RENTECH').toUpperCase()}.`, M, M, 7, font, cinza);

  return await pdf.save();
}
