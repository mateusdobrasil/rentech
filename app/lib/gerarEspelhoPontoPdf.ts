// lib/gerarEspelhoPontoPdf.ts
// Gera o PDF do espelho de ponto (batidas dia a dia do mês) no servidor,
// usando pdf-lib — mesmo padrão do gerarHoleritePdf.ts. Anexado ao holerite
// no envio para assinatura, para o colaborador atestar a jornada registrada.
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';

export interface RegistroPontoDia {
  data: string; // ISO AAAA-MM-DD
  entrada_1: string | null;
  saida_1: string | null;
  entrada_2: string | null;
  saida_2: string | null;
  minutosTrabalhados: number;
  minutosAbonados: number;
  motivoAbono: string | null;
}

export interface GerarEspelhoPontoParams {
  nome: string;
  cpf?: string | null;
  mesReferencia: string; // competência 'AAAA-MM'
  registros: RegistroPontoDia[];
  feriados?: string[];
  dataAdmissao?: string | null;
  dataDesligamento?: string | null;
  empresaNome?: string;
}

const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const hhmm = (min: number) => `${Math.floor((min || 0) / 60).toString().padStart(2, '0')}:${((min || 0) % 60).toString().padStart(2, '0')}`;
const hhmmBatida = (t: string | null) => (t ? t.slice(0, 5) : '-');
const mesAnoBR = (iso: string) => { const [a, m] = iso.split('-'); return `${m}/${a}`; };

export async function gerarEspelhoPontoPdf(p: GerarEspelhoPontoParams): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 retrato em pontos
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const preto = rgb(0, 0, 0);
  const azul = rgb(0.047, 0.114, 0.302);
  const cinza = rgb(0.4, 0.4, 0.4);
  const cinzaClaro = rgb(0.93, 0.95, 0.97);
  const vermelho = rgb(0.7, 0.15, 0.15);

  const M = 40;
  let y = height - M;
  const feriados = p.feriados || [];

  const txt = (s: string, x: number, yy: number, size = 8, f: PDFFont = font, color = preto) =>
    page.drawText(s || '', { x, y: yy, size, font: f, color });
  const linha = (x1: number, yy: number, x2: number, w = 1, color = preto) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });
  const box = (x: number, yy: number, w: number, h: number, color = cinzaClaro) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });

  // ===== Cabeçalho =====
  txt(p.empresaNome || 'RENTECH', M, y - 4, 18, bold, azul);
  const titulo = 'ESPELHO DE PONTO';
  const tW = bold.widthOfTextAtSize(titulo, 13);
  txt(titulo, width - M - tW, y - 2, 13, bold, azul);
  const comp = `Competência: ${mesAnoBR(p.mesReferencia)}`;
  txt(comp, width - M - font.widthOfTextAtSize(comp, 9), y - 18, 9, font, cinza);
  y -= 42;
  linha(M, y, width - M, 1.5, preto);
  y -= 18;

  // ===== Dados do funcionário =====
  box(M, y - 34, width - 2 * M, 46, cinzaClaro);
  txt('COLABORADOR', M + 8, y - 4, 7, bold, cinza);
  txt(p.nome.toUpperCase(), M + 8, y - 16, 11, bold, preto);
  if (p.cpf) txt(`CPF: ${p.cpf}`, M + 8, y - 28, 8, font, preto);
  y -= 50;

  // ===== Tabela =====
  const cols = [
    { label: 'DATA', w: 45 },
    { label: 'DIA', w: 30 },
    { label: 'ENTRADA', w: 55 },
    { label: 'SAÍDA ALM.', w: 55 },
    { label: 'RET. ALM.', w: 55 },
    { label: 'SAÍDA', w: 55 },
    { label: 'TOTAL', w: 50 },
    { label: 'OBSERVAÇÃO', w: 170 },
  ];
  const tableW = cols.reduce((acc, c) => acc + c.w, 0);
  const xTable = M;

  box(xTable, y - 14, tableW, 16, azul);
  let xCursor = xTable;
  cols.forEach(c => {
    txt(c.label, xCursor + 4, y - 10, 7, bold, rgb(1, 1, 1));
    xCursor += c.w;
  });
  y -= 16;
  const topTab = y;

  const porDia: Record<string, RegistroPontoDia> = {};
  p.registros.forEach(r => { porDia[r.data] = r; });

  const [ano, mesNum] = p.mesReferencia.split('-').map(Number);
  const diasNoMes = new Date(ano, mesNum, 0).getDate();
  const hoje = new Date(); hoje.setHours(23, 59, 59, 999);

  let totalTrabalhado = 0;
  let totalAbonado = 0;
  let totalFaltas = 0;

  const linhaAltura = 14;
  let linhaIdx = 0;

  for (let d = 1; d <= diasNoMes; d++) {
    const data = new Date(ano, mesNum - 1, d);
    if (data > hoje) break;
    const dataIso = `${ano}-${String(mesNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (p.dataAdmissao && dataIso < p.dataAdmissao) continue;
    if (p.dataDesligamento && dataIso > p.dataDesligamento) continue;

    const diaSemana = data.getDay();
    const isFeriado = feriados.includes(dataIso);
    const reg = porDia[dataIso];
    const trabalhados = reg?.minutosTrabalhados || 0;
    const abonados = reg?.minutosAbonados || 0;
    const temRegistro = trabalhados > 0 || abonados > 0;

    totalTrabalhado += trabalhados;
    totalAbonado += abonados;

    let observacao = '';
    let corObs = preto;
    if (isFeriado) observacao = temRegistro ? 'TRABALHADO (FERIADO)' : 'FERIADO';
    else if (diaSemana === 0) observacao = temRegistro ? 'TRABALHADO (DSR)' : 'DSR';
    else if (diaSemana === 6) observacao = temRegistro ? '' : '';
    else if (!temRegistro) { observacao = 'FALTA'; corObs = vermelho; totalFaltas++; }
    if (abonados > 0) {
      const motivo = reg?.motivoAbono ? ` - ${reg.motivoAbono}` : '';
      observacao = `ABONO ${hhmm(abonados)}${motivo}`;
    }
    if (observacao.length > 34) observacao = observacao.slice(0, 34) + '…';

    const yy = topTab - linhaIdx * linhaAltura - 10;
    if (linhaIdx % 2 === 1) box(xTable, yy - 3, tableW, linhaAltura, rgb(0.97, 0.98, 0.99));

    // Sem intervalo registrado (só entrada+saída): a saída final vai na
    // coluna SAÍDA, deixando as colunas de almoço em branco.
    const temIntervalo = !!(reg?.entrada_2 && reg?.saida_2);
    const colEntrada = reg?.entrada_1 ?? null;
    const colSaidaAlmoco = temIntervalo ? reg?.saida_1 ?? null : null;
    const colRetAlmoco = temIntervalo ? reg?.entrada_2 ?? null : null;
    const colSaida = temIntervalo ? reg?.saida_2 ?? null : reg?.saida_1 ?? null;

    xCursor = xTable;
    txt(dataIso.split('-').reverse().slice(0, 2).join('/'), xCursor + 4, yy, 7.5); xCursor += cols[0].w;
    txt(DIAS_SEMANA[diaSemana], xCursor + 4, yy, 7.5, font, (diaSemana === 0 || diaSemana === 6) ? cinza : preto); xCursor += cols[1].w;
    txt(hhmmBatida(colEntrada), xCursor + 4, yy, 7.5); xCursor += cols[2].w;
    txt(hhmmBatida(colSaidaAlmoco), xCursor + 4, yy, 7.5); xCursor += cols[3].w;
    txt(hhmmBatida(colRetAlmoco), xCursor + 4, yy, 7.5); xCursor += cols[4].w;
    txt(hhmmBatida(colSaida), xCursor + 4, yy, 7.5); xCursor += cols[5].w;
    txt(trabalhados > 0 ? hhmm(trabalhados) : '-', xCursor + 4, yy, 7.5); xCursor += cols[6].w;
    txt(observacao, xCursor + 4, yy, 7, font, corObs);

    linhaIdx++;
  }

  // Bordas verticais da tabela
  const botTab = topTab - linhaIdx * linhaAltura - 6;
  xCursor = xTable;
  cols.forEach(c => {
    page.drawLine({ start: { x: xCursor, y: topTab + 2 }, end: { x: xCursor, y: botTab }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    xCursor += c.w;
  });
  page.drawLine({ start: { x: xCursor, y: topTab + 2 }, end: { x: xCursor, y: botTab }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  linha(xTable, botTab, xTable + tableW, 1, preto);

  y = botTab - 16;

  // ===== Totais =====
  box(xTable, y - 14, tableW, 16, cinzaClaro);
  txt(`TOTAL TRABALHADO: ${hhmm(totalTrabalhado)}`, xTable + 6, y - 10, 8, bold);
  txt(`TOTAL ABONADO: ${hhmm(totalAbonado)}`, xTable + 190, y - 10, 8, bold);
  txt(`FALTAS: ${totalFaltas}`, xTable + 380, y - 10, 8, bold, totalFaltas > 0 ? vermelho : preto);
  y -= 40;

  // ===== Assinatura =====
  const xSig = M + 60;
  linha(xSig, y, width - M - 60, 1, preto);
  y -= 12;
  const nomeW = bold.widthOfTextAtSize(p.nome.toUpperCase(), 9);
  txt(p.nome.toUpperCase(), width / 2 - nomeW / 2, y, 9, bold);
  y -= 11;
  const s2 = 'Declaro estarem corretos os registros de ponto acima referentes ao período.';
  txt(s2, width / 2 - font.widthOfTextAtSize(s2, 7) / 2, y, 7, font, cinza);

  txt('Documento gerado eletronicamente pelo sistema de folha da RENTECH.', M, M, 7, font, cinza);

  return await pdf.save();
}
