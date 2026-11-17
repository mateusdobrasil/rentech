// app/lib/locacao/gerarConferenciaMontagemPdf.ts
// Relatório "Conferência de Montagem / Desmontagem" da Expedição (2026-11-17):
// uma folha por OS do evento (as OSs que estão nos checklists dele), com os
// equipamentos e os serviços/extras e colunas de check para a equipe marcar
// na montagem e na desmontagem, mais assinaturas. Só servidor.
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFImage, type PDFFont } from 'pdf-lib';
import { A4, AZUL, AZUL_MEDIO, CINZA, CINZA_CLARO, FUNDO, BRANCO, dataBR, qtd, s, quebrar, lerLogo, larguraReal } from './pdfBase';

export interface ItemConferencia { quantidade: number; descricao: string; codigo?: string | null; detalhe?: string | null }
export interface OsConferencia {
  numero: string;
  logo: 'RENTECH' | 'ALFALIGHT';
  empresa?: string | null;
  cliente: string;
  estande?: string | null;
  local?: string | null;
  contato?: string | null;
  vendedor?: string | null;
  montagem?: string | null;
  inicio?: string | null;
  fim?: string | null;
  desmontagem?: string | null;
  observacoes?: string | null;
  equipamentos: ItemConferencia[];
  servicos: ItemConferencia[];
  /** sem ficha no sistema: itens vieram do checklist */
  doChecklist?: boolean;
}

const M = 32;
const LARG = A4.w - 2 * M;

export async function gerarConferenciaMontagemPdf(evento: string, lista: OsConferencia[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Conferência de Montagem/Desmontagem - ${evento}`);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logos: Record<string, PDFImage | null> = {};
  for (const q of ['RENTECH', 'ALFALIGHT'] as const) {
    const b = lerLogo(q);
    try { logos[q] = b ? await pdf.embedPng(b) : null; } catch { logos[q] = null; }
  }

  let pg!: PDFPage;
  let y = 0;
  const texto = (t: string, x: number, yy: number, tam = 8.5, fonte: PDFFont = f, cor = AZUL) => pg.drawText(s(t), { x, y: yy, size: tam, font: fonte, color: cor });
  const direita = (t: string, xd: number, yy: number, tam = 8.5, fonte: PDFFont = f, cor = AZUL) => texto(t, xd - larguraReal(fonte, s(t), tam), yy, tam, fonte, cor);
  const caixa = (x: number, yy: number, lado = 9) => pg.drawRectangle({ x, y: yy, width: lado, height: lado, borderColor: AZUL, borderWidth: 0.8 });

  for (const [idxOs, os] of lista.entries()) {
    let parte = 1;
    const cabecalho = () => {
      pg = pdf.addPage([A4.w, A4.h]);
      y = A4.h - M;
      const logo = logos[os.logo];
      // faixa de título
      pg.drawRectangle({ x: M, y: y - 44, width: LARG, height: 44, color: AZUL });
      let xt = M + 12;
      if (logo) {
        const h = 30, w = Math.min(110, h * (logo.width / logo.height)), hh = w / (logo.width / logo.height);
        pg.drawRectangle({ x: M + 8, y: y - 22 - hh / 2 - 3, width: w + 6, height: hh + 6, color: BRANCO });
        pg.drawImage(logo, { x: M + 11, y: y - 22 - hh / 2, width: w, height: hh });
        xt = M + w + 26;
      }
      texto('CONFERÊNCIA DE MONTAGEM / DESMONTAGEM', xt, y - 18, 11, fb, BRANCO);
      texto(evento, xt, y - 32, 8.5, f, rgb(0.85, 0.9, 1));
      direita(`OS ${os.numero}`, A4.w - M - 12, y - 20, 14, fb, BRANCO);
      direita(parte > 1 ? `continuação · folha ${parte}` : `${idxOs + 1} de ${lista.length}`, A4.w - M - 12, y - 33, 7, f, rgb(0.85, 0.9, 1));
      y -= 54;
    };
    cabecalho();

    // dados da OS
    const pares: [string, string | null | undefined][] = [
      ['Cliente', os.cliente], ['Estande', os.estande], ['Local', os.local], ['Contato', os.contato],
      ['Montagem', os.montagem ? dataBR(os.montagem) : null],
      ['Evento', os.inicio ? `${dataBR(os.inicio)} a ${dataBR(os.fim)}` : null],
      ['Desmontagem', os.desmontagem ? dataBR(os.desmontagem) : null], ['Vendedor(a)', os.vendedor],
    ];
    const validos = pares.filter(([, v]) => v && String(v).trim());
    const col = LARG / 2;
    for (let i = 0; i < validos.length; i += 2) {
      const linha = validos.slice(i, i + 2);
      const alt = Math.max(...linha.map(([, v]) => quebrar(String(v), fb, 8.5, col - 80).length)) * 10 + 6;
      linha.forEach(([r, v], k) => {
        const x = M + k * col;
        texto(r.toUpperCase(), x, y - 8, 6.5, f, CINZA);
        quebrar(String(v), fb, 8.5, col - 80).forEach((l, j) => texto(l, x + 62, y - 8 - j * 10, 8.5, fb));
      });
      y -= alt;
      pg.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.3, color: CINZA_CLARO });
    }
    if (os.observacoes) {
      const linhas = quebrar(`Obs.: ${os.observacoes}`, f, 7.5, LARG).slice(0, 4);
      linhas.forEach((l, j) => texto(l, M, y - 9 - j * 9, 7.5, f, CINZA));
      y -= linhas.length * 9 + 4;
    }
    if (os.doChecklist) { texto('OS fora do sistema: itens tirados do checklist do evento.', M, y - 9, 7, f, rgb(0.75, 0.4, 0.05)); y -= 12; }
    y -= 6;

    // tabelas
    const cQtd = 40, cMont = 62, cDesm = 70, cObs = 110;
    const cDesc = LARG - cQtd - cMont - cDesm - cObs;
    const garantir = (h: number, titulo: string) => {
      if (y - h < M + 120) { parte++; cabecalho(); cabTabela(titulo); }
    };
    const cabTabela = (titulo: string) => {
      pg.drawRectangle({ x: M, y: y - 18, width: LARG, height: 18, color: titulo.startsWith('SERV') ? rgb(0.85, 0.47, 0.04) : AZUL });
      texto(titulo, M + 8, y - 12.5, 8.5, fb, BRANCO);
      y -= 18;
      pg.drawRectangle({ x: M, y: y - 14, width: LARG, height: 14, color: FUNDO });
      let x = M;
      const cols: [string, number, boolean][] = [['QTD', cQtd, true], ['DESCRIÇÃO', cDesc, false], ['MONTAGEM', cMont, true], ['DESMONTAGEM', cDesm, true], ['OBSERVAÇÃO', cObs, false]];
      for (const [t, w, centro] of cols) {
        const xt = centro ? x + w / 2 - larguraReal(fb, t, 6.5) / 2 : x + 4;
        texto(t, xt, y - 10, 6.5, fb, CINZA);
        x += w;
      }
      y -= 14;
    };
    const tabela = (titulo: string, itens: ItemConferencia[]) => {
      if (!itens.length) return;
      garantir(50, titulo);
      cabTabela(titulo);
      for (const it of itens) {
        const linhas = quebrar(it.descricao, fb, 8, cDesc - 8);
        const sub = [it.codigo, it.detalhe].filter(Boolean).join(' · ');
        const linhasSub = sub ? quebrar(sub, f, 6.5, cDesc - 8) : [];
        const h = Math.max(18, linhas.length * 9.5 + linhasSub.length * 8 + 7);
        garantir(h, `${titulo} (cont.)`);
        texto(qtd(it.quantidade), M + cQtd / 2 - larguraReal(fb, qtd(it.quantidade), 9) / 2, y - 11, 9, fb);
        let yy = y - 10;
        linhas.forEach(l => { texto(l, M + cQtd + 4, yy, 8, fb); yy -= 9.5; });
        linhasSub.forEach(l => { texto(l, M + cQtd + 4, yy, 6.5, f, CINZA); yy -= 8; });
        caixa(M + cQtd + cDesc + cMont / 2 - 5, y - h / 2 - 5, 10);
        caixa(M + cQtd + cDesc + cMont + cDesm / 2 - 5, y - h / 2 - 5, 10);
        pg.drawLine({ start: { x: M + cQtd + cDesc + cMont + cDesm + 4, y: y - h + 4 }, end: { x: A4.w - M - 4, y: y - h + 4 }, thickness: 0.3, color: CINZA_CLARO });
        y -= h;
        pg.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: CINZA_CLARO });
      }
      y -= 10;
    };
    tabela(`EQUIPAMENTOS (${os.equipamentos.length})`, os.equipamentos);
    tabela(`SERVIÇOS / EXTRAS (${os.servicos.length})`, os.servicos);
    if (!os.equipamentos.length && !os.servicos.length) { texto('Sem itens.', M, y - 10, 8.5, f, CINZA); y -= 20; }

    // assinaturas
    if (y < M + 120) { parte++; cabecalho(); }
    y = Math.min(y, M + 112);
    const wBloco = (LARG - 16) / 2;
    for (const [k, titulo] of [[0, 'MONTAGEM'], [1, 'DESMONTAGEM']] as const) {
      const x = M + k * (wBloco + 16);
      pg.drawRectangle({ x, y: y - 104, width: wBloco, height: 104, borderColor: CINZA_CLARO, borderWidth: 0.8 });
      pg.drawRectangle({ x, y: y - 14, width: wBloco, height: 14, color: k === 0 ? AZUL_MEDIO : rgb(0.85, 0.47, 0.04) });
      texto(titulo, x + 8, y - 10, 7.5, fb, BRANCO);
      texto('Data: ____/____/______     Hora: ____:____', x + 8, y - 30, 7.5, f);
      pg.drawLine({ start: { x: x + 8, y: y - 58 }, end: { x: x + wBloco - 8, y: y - 58 }, thickness: 0.5, color: AZUL });
      texto('Responsável Rentech (nome e assinatura)', x + 8, y - 66, 6.5, f, CINZA);
      pg.drawLine({ start: { x: x + 8, y: y - 90 }, end: { x: x + wBloco - 8, y: y - 90 }, thickness: 0.5, color: AZUL });
      texto('Cliente / responsável no local (nome e assinatura)', x + 8, y - 98, 6.5, f, CINZA);
    }
  }
  if (!lista.length) {
    pg = pdf.addPage([A4.w, A4.h]);
    pg.drawText(s(`Nenhuma OS nos checklists do evento ${evento}.`), { x: M, y: A4.h - M - 20, size: 11, font: fb, color: AZUL });
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    const t = s(`Conferência de Montagem/Desmontagem · ${evento} · página ${i + 1} de ${paginas.length}`);
    p.drawText(t, { x: A4.w / 2 - larguraReal(f, t, 6.5) / 2, y: 16, size: 6.5, font: f, color: CINZA });
  });
  return pdf.save();
}
