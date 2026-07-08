// lib/gerarHoleritePdf.ts
// Gera o PDF do holerite no servidor usando pdf-lib (JS puro, compatível com
// serverless/Vercel — sem headless Chrome). Retorna Uint8Array pronto para envio.
//
// Depende de: npm i pdf-lib
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';

// Espelha o snapshot DadosHolerite (o que é congelado no fechamento)
export interface DadosHoleritePdf {
  minutosExtras60: number; minutosExtras100: number;
  totalExtra60: number; totalExtra100: number; totalDiariasFdsFechada: number;
  diasTrabalhadosFds: number;
  diasFaltas: number; valorDescontoFaltas: number;
  salarioBaseExibido: number; complementoContratoExibido: number;
  bonusAtivos: { descricao: string; recorrencia: string; valor: number }[];
  descontosAtivos: { descricao: string; tipo: string; parcelas: number; mes_inicio: string; valor_parcela: number }[];
  valorAdiantamento: number;
  qtdVr: number; qtdVt: number; diariaVr: number; diariaVt: number;
  totalVr: number; totalVt: number;
  descontoVrFaltas: number; descontoVtFaltas: number;
  regra: { tipo_pagamento_fds: string; percentual_extra_semana: number; percentual_extra_dom_fer: number; desconta_faltas: boolean };
  cargo: string; tipoContrato: string; ativo: boolean;
  totalCreditos: number; totalDebitos: number; valorLiquidoReceber: number;
}

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (min: number) => `${Math.floor((min || 0) / 60).toString().padStart(2, '0')}:${((min || 0) % 60).toString().padStart(2, '0')}`;

const mesAnoBR = (iso: string) => { const [a, m] = iso.split('-'); return `${m}/${a}`; };
const pagamentoBR = (iso: string) => { const [a, m] = iso.split('-').map(Number); const d = new Date(a, m, 1); return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

// ---- valor por extenso (pt-BR) ----
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

export interface GerarPdfParams {
  nome: string;
  cpf?: string | null;
  mesReferencia: string;   // competência 'AAAA-MM'
  dados: DadosHoleritePdf;
  fechadoEm?: string | null; // ISO — data de emissão/fechamento
  empresaNome?: string;
}

export async function gerarHoleritePdf(p: GerarPdfParams): Promise<Uint8Array> {
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

  const M = 40;                 // margem
  let y = height - M;
  const v = p.dados;

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
  txtRight('DEMONSTRATIVO DE PAGAMENTO', width - M, y - 2, 13, bold, azul);
  txtRight(`Competência: ${mesAnoBR(p.mesReferencia)}`, width - M, y - 18, 9, font, cinza);
  txtRight(`Pagamento: ${pagamentoBR(p.mesReferencia)}`, width - M, y - 30, 9, bold, verde);
  y -= 42;
  linha(M, y, width - M, 1.5, preto);
  y -= 18;

  // ===== Dados do funcionário =====
  box(M, y - 46, width - 2 * M, 58, cinzaClaro);
  txt('COLABORADOR', M + 8, y - 4, 7, bold, cinza);
  txt(p.nome.toUpperCase(), M + 8, y - 16, 11, bold, preto);
  txt(`Função: ${v.cargo || '—'}`, M + 8, y - 30, 8, font, preto);
  txt(`Contrato: ${v.tipoContrato || '—'}`, M + 8, y - 41, 8, font, preto);
  if (p.cpf) txtRight(`CPF: ${p.cpf}`, width - M - 8, y - 30, 8, font, preto);
  txtRight(`Emissão: ${p.fechadoEm ? new Date(p.fechadoEm).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')}`, width - M - 8, y - 41, 8, font, preto);
  y -= 62;

  // ===== Tabela Créditos / Débitos =====
  const colGap = 12;
  const colW = (width - 2 * M - colGap) / 2;
  const xCred = M;
  const xDeb = M + colW + colGap;
  const topTab = y;

  // Cabeçalhos das colunas
  box(xCred, y - 14, colW, 16, azul);
  box(xDeb, y - 14, colW, 16, azul);
  txt('CRÉDITOS', xCred + colW / 2 - 22, y - 10, 9, bold, rgb(1, 1, 1));
  txt('DÉBITOS', xDeb + colW / 2 - 20, y - 10, 9, bold, rgb(1, 1, 1));
  y -= 20;

  // Linhas de crédito
  // Parcela atual do desconto parcelado (igual à tela): meses desde o início + 1
  const getParcelaAtual = (mesInicio: string, mesRef: string) => {
    if (!mesInicio || !mesRef) return 1;
    const [anoI, mesI] = mesInicio.split('-').map(Number);
    const [anoR, mesR] = mesRef.split('-').map(Number);
    return (anoR - anoI) * 12 + (mesR - mesI) + 1;
  };

  const creditos: [string, string, number][] = [];
  if (v.salarioBaseExibido > 0) creditos.push(['SALÁRIO BASE CONTRATUAL', '30', v.salarioBaseExibido]);
  if (v.complementoContratoExibido > 0) creditos.push(['COMPLEMENTO DE ACORDO CLASSE', '30', v.complementoContratoExibido]);
  if (v.regra.tipo_pagamento_fds === 'HORA_PERCENTUAL') {
    if (v.totalExtra60 > 0) creditos.push([`HORA EXTRA ${v.regra.percentual_extra_semana}% (SEG A SÁB)`, hhmm(v.minutosExtras60), v.totalExtra60]);
    if (v.totalExtra100 > 0) creditos.push([`HORA EXTRA ${v.regra.percentual_extra_dom_fer}% (DOM/FERIADO)`, hhmm(v.minutosExtras100), v.totalExtra100]);
  } else if (v.totalDiariasFdsFechada > 0) {
    creditos.push(['DIÁRIAS DE FIM DE SEMANA / APOIO', `${v.diasTrabalhadosFds}D`, v.totalDiariasFdsFechada]);
  }
  v.bonusAtivos.forEach(b => creditos.push([b.descricao.toUpperCase().slice(0, 30), b.recorrencia === 'MENSAL' ? 'FIXO' : 'PRÊMIO', b.valor]));
  if (v.totalVr > 0) creditos.push([`VALE REFEIÇÃO (VR)`, `${v.qtdVr} ${v.qtdVr === 1 ? 'DIA' : 'DIAS'}`, v.totalVr]);
  if (v.totalVt > 0) creditos.push([`VALE TRANSPORTE (VT)`, `${v.qtdVt} ${v.qtdVt === 1 ? 'DIA' : 'DIAS'}`, v.totalVt]);

  // Linhas de débito
  const debitos: [string, string, number][] = [];
  if (v.valorAdiantamento > 0) debitos.push(['ADIANTAMENTO', 'DIA 20', v.valorAdiantamento]);
  v.descontosAtivos.forEach(d => {
    // Igual à tela: parcelado mostra "atual/total" (ex: 3/12), fixo mostra FIXO
    const ref = d.tipo === 'FIXO' ? 'FIXO' : `${getParcelaAtual(d.mes_inicio, p.mesReferencia)}/${d.parcelas}`;
    debitos.push([d.descricao.toUpperCase().slice(0, 30), ref, d.valor_parcela]);
  });
  if (v.regra.desconta_faltas && v.valorDescontoFaltas > 0) debitos.push(['FALTAS (CONTRATO ÷ 30 POR DIA)', `${v.diasFaltas}D`, v.valorDescontoFaltas]);
  if (v.descontoVrFaltas > 0) debitos.push([`DESC. VR POR FALTA`, `${v.diasFaltas} ${v.diasFaltas === 1 ? 'DIA' : 'DIAS'}`, v.descontoVrFaltas]);
  if (v.descontoVtFaltas > 0) debitos.push([`DESC. VT POR FALTA`, `${v.diasFaltas} ${v.diasFaltas === 1 ? 'DIA' : 'DIAS'}`, v.descontoVtFaltas]);

  const linhaAltura = 15;
  const maxLinhas = Math.max(creditos.length, debitos.length, 4);
  const yLinhas = y;

  for (let i = 0; i < maxLinhas; i++) {
    const yy = yLinhas - i * linhaAltura - 5;
    if (i % 2 === 1) { box(xCred, yy - 3, colW, linhaAltura, rgb(0.97, 0.98, 0.99)); box(xDeb, yy - 3, colW, linhaAltura, rgb(0.97, 0.98, 0.99)); }
    if (creditos[i]) {
      txt(creditos[i][0], xCred + 6, yy, 8);
      txt(creditos[i][1], xCred + colW - 85, yy, 7, font, cinza);
      txtRight(BRL(creditos[i][2]), xCred + colW - 6, yy, 8);
    }
    if (debitos[i]) {
      txt(debitos[i][0], xDeb + 6, yy, 8);
      txt(debitos[i][1], xDeb + colW - 90, yy, 7, font, cinza);
      txtRight(BRL(debitos[i][2]), xDeb + colW - 6, yy, 8);
    }
  }
  y = yLinhas - maxLinhas * linhaAltura - 6;

  // Totais das colunas
  box(xCred, y - 14, colW, 16, cinzaClaro);
  box(xDeb, y - 14, colW, 16, cinzaClaro);
  txt('TOTAL CRÉDITOS', xCred + 6, y - 10, 8, bold);
  txtRight(BRL(v.totalCreditos), xCred + colW - 6, y - 10, 9, bold);
  txt('TOTAL DÉBITOS', xDeb + 6, y - 10, 8, bold);
  txtRight(BRL(v.totalDebitos), xDeb + colW - 6, y - 10, 9, bold);

  // Bordas da tabela
  const botTab = y - 14;
  [xCred, xCred + colW, xDeb, xDeb + colW].forEach(x => page.drawLine({ start: { x, y: topTab + 2 }, end: { x, y: botTab }, thickness: 1, color: preto }));
  y -= 30;

  // ===== Líquido =====
  box(M, y - 22, width - 2 * M, 26, azul);
  txt('VALOR LÍQUIDO A RECEBER', M + 8, y - 14, 11, bold, rgb(1, 1, 1));
  txtRight(BRL(v.valorLiquidoReceber), width - M - 8, y - 15, 14, bold, rgb(1, 1, 1));
  y -= 30;
  txt(extenso(v.valorLiquidoReceber), M + 2, y, 8, font, cinza);
  y -= 40;

  // ===== Assinatura =====
  const xSig = M + 60;
  linha(xSig, y, width - M - 60, 1, preto);
  y -= 12;
  const nomeW = bold.widthOfTextAtSize(p.nome.toUpperCase(), 9);
  txt(p.nome.toUpperCase(), width / 2 - nomeW / 2, y, 9, bold);
  y -= 11;
  const s2 = 'Assinatura de Quitação';
  txt(s2, width / 2 - font.widthOfTextAtSize(s2, 7) / 2, y, 7, font, cinza);

  // Rodapé
  txt('Documento gerado eletronicamente pelo sistema de folha da RENTECH.', M, M, 7, font, cinza);

  return await pdf.save();
}