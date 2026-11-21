// app/lib/financeiro/gerarFaturaPdf.ts
// PDF da NOTA DE DÉBITO (fatura de locação) — Faturamento, 2026-11-20.
// Emitente, cliente, referência (OS, fichas de locação, evento), itens
// (equipamentos + serviços + prorrogações, com abatimentos), parcelas e dados
// para pagamento. Série de ENSAIO sai com a marca d'água "ENSAIO".
import { PDFDocument, StandardFonts, rgb, degrees, type PDFPage, type PDFFont, type PDFImage } from 'pdf-lib';
import { A4, AZUL, AZUL_MEDIO, CINZA, CINZA_CLARO, FUNDO, BRANCO, BRL, dataBR, qtd, s, quebrar, lerLogo, larguraReal, formatarDocumento } from '../locacao/pdfBase';
import { numeroExibicao, type ItemFatura } from './faturamento';

const M = 34;
const LARG = A4.w - 2 * M;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const limpo = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim();

export async function gerarFaturaPdf(d: { fatura: any; empresa: any; cliente: any; os: any; parcelas: any[]; conta: any; fichasLocacao: string[] }): Promise<Uint8Array> {
  const f = d.fatura;
  const nf = numeroExibicao(f);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Nota de Débito ${nf}`);
  const fr = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const nomeEmp = `${d.empresa?.nome_curto || ''} ${d.empresa?.nome || ''}`.toUpperCase();
  let logo: PDFImage | null = null;
  try { const b = lerLogo(/ALFA/.test(nomeEmp) ? 'ALFALIGHT' : 'RENTECH'); logo = b ? await pdf.embedPng(b) : null; } catch { logo = null; }

  let pg!: PDFPage;
  let y = 0;
  const texto = (t: string, x: number, yy: number, tam = 8.5, fonte: PDFFont = fr, cor = AZUL) => pg.drawText(s(t), { x, y: yy, size: tam, font: fonte, color: cor });
  const direita = (t: string, xd: number, yy: number, tam = 8.5, fonte: PDFFont = fr, cor = AZUL) => texto(t, xd - larguraReal(fonte, s(t), tam), yy, tam, fonte, cor);
  const novaPagina = () => {
    pg = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    if (f.serie === 'ENSAIO') pg.drawText('ENSAIO', { x: 130, y: 330, size: 110, font: fb, color: rgb(0.85, 0.2, 0.2), opacity: 0.09, rotate: degrees(35) });
    if (f.status === 'CANCELADA') pg.drawText('CANCELADA', { x: 90, y: 300, size: 100, font: fb, color: rgb(0.85, 0.1, 0.1), opacity: 0.12, rotate: degrees(35) });
  };
  novaPagina();

  // cabeçalho
  pg.drawRectangle({ x: M, y: y - 58, width: LARG, height: 58, color: AZUL });
  let xt = M + 12;
  if (logo) {
    const h = 34, w = Math.min(120, h * (logo.width / logo.height)), hh = w / (logo.width / logo.height);
    pg.drawRectangle({ x: M + 8, y: y - 29 - hh / 2 - 3, width: w + 6, height: hh + 6, color: BRANCO });
    pg.drawImage(logo, { x: M + 11, y: y - 29 - hh / 2, width: w, height: hh });
    xt = M + w + 28;
  }
  texto('NOTA DE DÉBITO', xt, y - 22, 14, fb, BRANCO);
  texto(f.serie === 'ENSAIO' ? 'Documento de ENSAIO — sem valor de cobrança' : 'Documento de cobrança de locação', xt, y - 36, 7.5, fr, rgb(0.85, 0.9, 1));
  direita(`Nº ${nf}`, A4.w - M - 12, y - 24, 16, fb, BRANCO);
  direita(`Emissão ${dataBR(f.data_emissao)}`, A4.w - M - 12, y - 39, 8, fr, rgb(0.85, 0.9, 1));
  y -= 70;

  // emitente × cliente
  const col = (LARG - 12) / 2;
  const bloco = (x: number, titulo: string, linhas: string[]) => {
    pg.drawRectangle({ x, y: y - 14, width: col, height: 14, color: FUNDO });
    texto(titulo, x + 6, y - 10, 7, fb, CINZA);
    let yy = y - 26;
    linhas.filter(Boolean).forEach((l, i) => { for (const p of quebrar(l, i === 0 ? fb : fr, i === 0 ? 9 : 7.5, col - 12)) { texto(p, x + 6, yy, i === 0 ? 9 : 7.5, i === 0 ? fb : fr); yy -= i === 0 ? 11 : 9.5; } });
    return y - yy;
  };
  const e = d.empresa || {};
  const c = d.cliente || {};
  const endCli = [[c.endereco1, c.numero1].filter(Boolean).join(', '), c.complemento1, c.bairro1, [c.cidade1, c.estado1].filter(Boolean).join('/'), c.cep1 ? `CEP ${c.cep1}` : null].filter(Boolean).join(' - ');
  const h1 = bloco(M, 'EMITENTE', [limpo(e.razao_social || e.nome), [formatarDocumento(e.cnpj, null) && `CNPJ ${formatarDocumento(e.cnpj, null)}`, e.inscricao_estadual && `IE ${e.inscricao_estadual}`].filter(Boolean).join(' · '), limpo(e.endereco), [e.telefone, e.email_contato].filter(Boolean).join(' · ')]);
  const h2 = bloco(M + col + 12, 'CLIENTE', [limpo(c.nome_completo || c.nome_exibicao || '—'), [formatarDocumento(c.cnpj, c.cpf) && `${c.cnpj ? 'CNPJ' : 'CPF'} ${formatarDocumento(c.cnpj, c.cpf)}`, c.inscricao_estadual && `IE ${c.inscricao_estadual}`].filter(Boolean).join(' · '), endCli]);
  y -= Math.max(h1, h2) + 10;

  // referência
  const ref = [
    d.os ? `OS ${`FR-${String(d.os.id).padStart(5, '0')}`}` : null,
    d.fichasLocacao.length ? `Ficha(s) de locação ${d.fichasLocacao.join(', ')}` : null,
    d.os?.evento?.nome ? `Evento ${d.os.evento.nome}` : null,
    d.os ? `Período ${dataBR(d.os.data_inicio)} a ${dataBR(d.os.data_fim)}` : null,
    d.os?.local_entrega ? `Local ${limpo(d.os.local_entrega)}` : null,
    f.antecipada ? 'Faturamento antecipado' : null,
  ].filter(Boolean).join('  ·  ');
  for (const l of quebrar(`Referência: ${ref}`, fr, 8, LARG)) { texto(l, M, y - 8, 8, fr, AZUL_MEDIO); y -= 10.5; }
  y -= 8;

  // itens
  const cQtd = 42, cDias = 38, cUnit = 74, cTot = 82;
  const cDesc = LARG - cQtd - cDias - cUnit - cTot;
  const cab = () => {
    pg.drawRectangle({ x: M, y: y - 16, width: LARG, height: 16, color: AZUL });
    let x = M;
    for (const [t, w, dir] of [['DESCRIÇÃO', cDesc, false], ['QTD', cQtd, true], ['DIAS', cDias, true], ['UNITÁRIO', cUnit, true], ['TOTAL', cTot, true]] as [string, number, boolean][]) {
      if (dir) direita(t, x + w - 6, y - 11, 7, fb, BRANCO); else texto(t, x + 6, y - 11, 7, fb, BRANCO);
      x += w;
    }
    y -= 16;
  };
  cab();
  for (const it of (f.itens || []) as ItemFatura[]) {
    const neg = n(it.valor_total) < 0;
    const linhas = quebrar(limpo(it.descricao), neg ? fr : fb, 8, cDesc - 12);
    const h = Math.max(15, linhas.length * 9.5 + 5);
    if (y - h < M + 180) { novaPagina(); cab(); }
    let yy = y - 10;
    linhas.forEach(l => { texto(l, M + 6, yy, 8, neg ? fr : fb, neg ? CINZA : AZUL); yy -= 9.5; });
    if (!neg) {
      direita(qtd(n(it.quantidade)), M + cDesc + cQtd - 6, y - 10, 8);
      if (it.dias) direita(String(it.dias), M + cDesc + cQtd + cDias - 6, y - 10, 8);
      direita(BRL(n(it.valor_unitario)), M + cDesc + cQtd + cDias + cUnit - 6, y - 10, 8);
    }
    direita(neg ? `- ${BRL(Math.abs(n(it.valor_total)))}` : BRL(n(it.valor_total)), A4.w - M - 6, y - 10, 8, fb, neg ? rgb(0.7, 0.15, 0.15) : AZUL);
    y -= h;
    pg.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.3, color: CINZA_CLARO });
  }
  y -= 6;
  pg.drawRectangle({ x: A4.w - M - 200, y: y - 24, width: 200, height: 24, color: AZUL });
  texto('TOTAL A PAGAR', A4.w - M - 192, y - 15, 8.5, fb, BRANCO);
  direita(BRL(n(f.valor_total)), A4.w - M - 8, y - 16, 12, fb, BRANCO);
  y -= 40;

  // parcelas + pagamento
  if (y < M + 150) novaPagina();
  texto('VENCIMENTO(S)', M, y - 8, 8, fb, CINZA);
  let yp = y - 22;
  for (const p of d.parcelas) {
    texto(`${p.total_parcelas > 1 ? `${p.parcela}/${p.total_parcelas}  ` : ''}${dataBR(p.vencimento)}`, M, yp, 9, fb);
    direita(BRL(n(p.valor)), M + 200, yp, 9, fb);
    if (p.status === 'PAGO') texto(`pago ${dataBR(p.data_pagamento)}`, M + 210, yp, 7.5, fr, rgb(0.1, 0.5, 0.3));
    yp -= 12;
  }
  const xPag = M + LARG / 2 + 10;
  texto('DADOS PARA PAGAMENTO', xPag, y - 8, 8, fb, CINZA);
  const pag = [
    f.forma_pagamento ? `Forma: ${f.forma_pagamento}` : null,
    d.conta ? `${d.conta.nome}${d.conta.banco_codigo ? ` · banco ${d.conta.banco_codigo}` : ''}` : null,
    d.conta && (d.conta.agencia || d.conta.numero_conta) ? `Agência ${d.conta.agencia || '—'} · Conta ${d.conta.numero_conta || '—'}` : null,
    `Favorecido: ${limpo(e.razao_social || e.nome)}${formatarDocumento(e.cnpj, null) ? ` · CNPJ ${formatarDocumento(e.cnpj, null)}` : ''}`,
  ].filter(Boolean) as string[];
  let yd = y - 22;
  for (const l of pag) for (const p of quebrar(l, fr, 8, LARG / 2 - 10)) { texto(p, xPag, yd, 8); yd -= 10; }
  y = Math.min(yp, yd) - 10;

  if (f.observacoes) {
    for (const l of quebrar(`Observações: ${f.observacoes}`, fr, 8, LARG)) { if (y < M + 30) novaPagina(); texto(l, M, y - 8, 8, fr, CINZA); y -= 10; }
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    const t = s(`Nota de Débito ${nf} · ${limpo(e.nome_curto || e.nome)} · página ${i + 1} de ${paginas.length}`);
    p.drawText(t, { x: A4.w / 2 - larguraReal(fr, t, 6.5) / 2, y: 16, size: 6.5, font: fr, color: CINZA });
  });
  return pdf.save();
}
