// lib/gerarResumoRecebimentosPdf.ts
// Página "Resumo de Recebimentos" do pacote de assinatura do holerite: junta
// num lugar só tudo que o colaborador recebeu na competência — salário e
// adiantamento (o que já ia no recibo), benefícios e as Ordens de Pagamento
// discriminadas item a item. Puramente informativa: a quitação do salário
// continua sendo o recibo (último arquivo do pacote) e cada OP tem o seu
// próprio recibo assinado. Quebra de página automática se a lista de OPs
// não couber numa folha só.
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

export interface LinhaResumo {
  descricao: string;
  valor: number;
  // Linhas de detalhe (cinza, indentadas) — só explicam a linha, não somam
  detalhes?: { descricao: string; valor?: number }[];
}

export interface OpResumo {
  numero: number | string;
  natureza: string;
  referencia?: string | null; // evento / OS / cliente
  vencimento?: string | null; // 'AAAA-MM-DD'
  status: string;             // PENDENTE | PAGO
  valor: number;
  itens: { descricao: string; qtd: number; valorUnitario: number; total: number }[];
}

export interface GerarResumoRecebimentosParams {
  nome: string;
  cpf?: string | null;
  mesReferencia: string; // competência 'AAAA-MM'
  empresaNome?: string;
  salario: LinhaResumo[];
  beneficios: { tipo: string; meio: string; valor: number }[];
  mesReferenciaBeneficio?: string;
  ops: OpResumo[];
}

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mesAnoBR = (iso: string) => { const [a, m] = iso.split('-'); return `${m}/${a}`; };
const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const qtdBR = (n: number) => (n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export async function gerarResumoRecebimentosPdf(p: GerarResumoRecebimentosParams): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoImg = await pdf.embedPng(lerLogoBytes());

  const preto = rgb(0, 0, 0);
  const azul = rgb(0.047, 0.114, 0.302);
  const cinza = rgb(0.4, 0.4, 0.4);
  const cinzaClaro = rgb(0.93, 0.95, 0.97);
  const branco = rgb(1, 1, 1);

  const M = 40;
  const W = 595.28, H = 841.89; // A4 retrato em pontos
  const empresa = (p.empresaNome || 'RENTECH').toUpperCase();

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  // Fonte padrão (WinAnsi) não codifica tudo — descrição de item de OP é
  // texto livre e pode trazer emoji, "−" etc., que derrubariam o PDF inteiro.
  // Caractere não codificável vira espaço (cache por caractere).
  const codificavel = new Map<string, boolean>();
  const limpar = (s: string) => Array.from(s || '').map(ch => {
    if (!codificavel.has(ch)) {
      try { font.encodeText(ch); codificavel.set(ch, true); } catch { codificavel.set(ch, false); }
    }
    return codificavel.get(ch) ? ch : (ch === '−' ? '-' : ' ');
  }).join('');

  const txt = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = preto) =>
    page.drawText(limpar(s), { x, y: yy, size, font: f, color });
  const txtRight = (s: string, xRight: number, yy: number, size = 9, f: PDFFont = font, color = preto) => {
    const t = limpar(s);
    const w = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: xRight - w, y: yy, size, font: f, color });
  };
  // Corta o texto com "…" pra não invadir a coluna de valor
  const caber = (bruto: string, maxW: number, size: number, f: PDFFont = font) => {
    const s = limpar(bruto);
    if (f.widthOfTextAtSize(s, size) <= maxW) return s;
    let t = s;
    while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > maxW) t = t.slice(0, -1);
    return t + '…';
  };
  const linha = (x1: number, yy: number, x2: number, w = 1, color = preto) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });
  const box = (x: number, yy: number, w: number, h: number, color = cinzaClaro) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });

  const cabecalho = (continuacao: boolean) => {
    const logoH = 28;
    const logoW = logoH * (logoImg.width / logoImg.height);
    page.drawImage(logoImg, { x: M, y: y - 24, width: logoW, height: logoH });
    txtRight('RESUMO DE RECEBIMENTOS', W - M, y - 2, 13, bold, azul);
    txtRight(`Competência: ${mesAnoBR(p.mesReferencia)}${continuacao ? ' (continuação)' : ''}`, W - M, y - 18, 9, font, cinza);
    y -= 42;
    linha(M, y, W - M, 1.5, preto);
    y -= 18;
  };

  // Garante espaço pra próxima linha; senão abre página nova
  const RODAPE = M + 20;
  const garantir = (altura: number) => {
    if (y - altura >= RODAPE) return;
    page = pdf.addPage([W, H]);
    y = H - M;
    cabecalho(true);
  };

  cabecalho(false);

  // ===== Colaborador =====
  box(M, y - 46, W - 2 * M, 58, cinzaClaro);
  txt('COLABORADOR', M + 8, y - 4, 7, bold, cinza);
  txt(p.nome.toUpperCase(), M + 8, y - 16, 11, bold, preto);
  if (p.cpf) txt(`CPF: ${p.cpf}`, M + 8, y - 30, 8, font, preto);
  txtRight(`Emissão: ${new Date().toLocaleDateString('pt-BR')}`, W - M - 8, y - 30, 8, font, preto);
  y -= 66;

  const xValor = W - M - 4;
  const larguraDescricao = W - 2 * M - 110;

  const tituloSecao = (titulo: string, subtitulo?: string) => {
    garantir(subtitulo ? 40 : 28);
    box(M, y - 14, W - 2 * M, 16, azul);
    txt(titulo, M + 6, y - 10, 9, bold, branco);
    y -= 20;
    if (subtitulo) {
      txt(subtitulo, M + 4, y - 4, 7, font, cinza);
      y -= 14;
    }
  };
  const linhaValor = (descricao: string, valor: number, f: PDFFont = font, size = 8.5, indent = 4) => {
    garantir(14);
    txt(caber(descricao, larguraDescricao - indent, size, f), M + indent, y - 6, size, f, preto);
    txtRight(BRL(valor), xValor, y - 6, size, bold, preto);
    y -= 13;
  };
  const linhaDetalhe = (descricao: string, valor?: number, indent = 16) => {
    garantir(12);
    txt(caber(descricao, larguraDescricao - indent, 7.5), M + indent, y - 5, 7.5, font, cinza);
    if (valor !== undefined) txtRight(BRL(valor), xValor - 70, y - 5, 7.5, font, cinza);
    y -= 11;
  };
  const subtotal = (rotulo: string, valor: number) => {
    garantir(22);
    y -= 2;
    linha(M, y, W - M, 0.5, cinza);
    y -= 4;
    txt(rotulo, M + 4, y - 7, 8, bold, azul);
    txtRight(BRL(valor), xValor, y - 7, 9, bold, azul);
    y -= 24;
  };
  const vazio = (msg: string) => {
    garantir(14);
    txt(msg, M + 4, y - 6, 8, font, cinza);
    y -= 22;
  };

  // ===== 1) Salário e adiantamento =====
  tituloSecao('SALÁRIO, ADIANTAMENTO E EXTRAS');
  const totalSalario = p.salario.reduce((s, l) => s + (l.valor || 0), 0);
  if (p.salario.length === 0) {
    vazio('Nenhum valor de salário/adiantamento nesta competência.');
  } else {
    p.salario.forEach(l => {
      linhaValor(l.descricao, l.valor);
      (l.detalhes || []).forEach(d => linhaDetalhe(d.descricao, d.valor));
    });
    subtotal('SUBTOTAL SALÁRIO', totalSalario);
  }

  // ===== 2) Benefícios =====
  const totalBeneficios = p.beneficios.reduce((s, b) => s + (b.valor || 0), 0);
  tituloSecao(
    p.mesReferenciaBeneficio ? `BENEFÍCIOS — COMPETÊNCIA ${mesAnoBR(p.mesReferenciaBeneficio)}` : 'BENEFÍCIOS',
    p.beneficios.length > 0 ? 'Creditados para o mês seguinte (cartão/plano/transferência).' : undefined
  );
  if (p.beneficios.length === 0) {
    vazio('Nenhum benefício ativo.');
  } else {
    p.beneficios.forEach(b => linhaValor(`${b.tipo}${b.meio ? ` (${b.meio})` : ''}`, b.valor));
    subtotal('SUBTOTAL BENEFÍCIOS', totalBeneficios);
  }

  // ===== 3) Ordens de Pagamento =====
  const totalOps = p.ops.reduce((s, o) => s + (o.valor || 0), 0);
  tituloSecao('ORDENS DE PAGAMENTO', p.ops.length > 0 ? 'OPs com vencimento dentro da competência. Cada OP tem recibo próprio.' : undefined);
  if (p.ops.length === 0) {
    vazio('Nenhuma ordem de pagamento nesta competência.');
  } else {
    p.ops.forEach((op, i) => {
      garantir(30);
      if (i % 2 === 1) box(M, y - 15, W - 2 * M, 16, rgb(0.97, 0.98, 0.99));
      const cab = `OP #${op.numero} · ${op.natureza || '—'}${op.referencia ? ` · ${op.referencia}` : ''}`;
      txt(caber(cab, larguraDescricao - 4, 8.5, bold), M + 4, y - 10, 8.5, bold, preto);
      txtRight(BRL(op.valor), xValor, y - 10, 8.5, bold, preto);
      y -= 18;
      const situacao = op.status === 'PAGO' ? 'PAGO' : 'A PAGAR';
      linhaDetalhe(`${op.vencimento ? `Vencimento ${dataBR(op.vencimento)} · ` : ''}${situacao}`, undefined, 10);
      op.itens.forEach(it => {
        const qtd = it.qtd && it.qtd !== 1 ? `${qtdBR(it.qtd)} × ${BRL(it.valorUnitario)} — ` : '';
        linhaDetalhe(`${qtd}${it.descricao || 'Item'}`, it.total, 16);
      });
      y -= 4;
    });
    subtotal('SUBTOTAL ORDENS DE PAGAMENTO', totalOps);
  }

  // ===== Total geral =====
  const totalGeral = totalSalario + totalBeneficios + totalOps;
  garantir(60);
  box(M, y - 22, W - 2 * M, 26, azul);
  txt('TOTAL RECEBIDO NA COMPETÊNCIA', M + 8, y - 14, 11, bold, branco);
  txtRight(BRL(totalGeral), W - M - 8, y - 15, 14, bold, branco);
  y -= 36;
  txt('Resumo informativo. A quitação do salário é dada no recibo de pagamento deste pacote.', M + 2, y, 7, font, cinza);

  pdf.getPages().forEach(pg => {
    pg.drawText(`Documento gerado eletronicamente pelo sistema de folha da ${empresa}.`, { x: M, y: M, size: 7, font, color: cinza });
  });

  return await pdf.save();
}
