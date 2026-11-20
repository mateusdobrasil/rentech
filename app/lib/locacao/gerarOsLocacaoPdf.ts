// app/lib/locacao/gerarOsLocacaoPdf.ts
// OS (Ordem de Serviço) da Ficha de Locação própria (2026-11-20): o documento
// que vai pra rua com os equipamentos (SAÍDA) e o comprovante da volta
// (DEVOLUÇÃO). Traz os itens daquele movimento com os patrimônios, os
// serviços da ficha, o que ainda está com o cliente e a assinatura de quem
// recebeu/entregou (desenhada na tela). Só servidor.
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFImage, type PDFFont } from 'pdf-lib';
import { A4, AZUL, AZUL_MEDIO, CINZA, CINZA_CLARO, FUNDO, BRANCO, dataBR, qtd, s, quebrar, lerLogo, larguraReal } from './pdfBase';

export interface ItemOs { quantidade: number; descricao: string; codigo?: string | null; patrimonios?: string[]; observacao?: string | null }
export interface DadosOsLocacao {
  tipo: 'SAIDA' | 'DEVOLUCAO';
  logo: 'RENTECH' | 'ALFALIGHT';
  empresa: { nome: string; documento?: string | null; endereco?: string | null; telefone?: string | null };
  os: string;                 // FR-07050
  fichaLocacao: string;       // FL-07050/A
  data: string;
  cliente: { nome: string; documento?: string | null };
  evento?: string | null;
  local?: string | null;
  estande?: string | null;
  contato?: string | null;
  vendedor?: string | null;
  periodo: { montagem?: string | null; inicio?: string | null; fim?: string | null; desmontagem?: string | null };
  itens: ItemOs[];
  servicos: ItemOs[];
  comCliente?: ItemOs[];       // devolução: o que ainda não voltou
  avarias?: string[];
  observacoes?: string | null;
  registradoPor?: string | null;
  recebedor?: { nome?: string | null; documento?: string | null; assinaturaPng?: string | null; assinadoEm?: string | null } | null;
}

const M = 32;
const LARG = A4.w - 2 * M;
const LARANJA = rgb(0.85, 0.47, 0.04);

export async function gerarOsLocacaoPdf(d: DadosOsLocacao): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const titulo = d.tipo === 'SAIDA' ? 'ORDEM DE SERVIÇO — SAÍDA DE EQUIPAMENTOS' : 'COMPROVANTE DE DEVOLUÇÃO';
  pdf.setTitle(`${d.tipo === 'SAIDA' ? 'OS' : 'Devolução'} ${d.fichaLocacao}`);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  try { const b = lerLogo(d.logo); logo = b ? await pdf.embedPng(b) : null; } catch { logo = null; }
  let assinatura: PDFImage | null = null;
  if (d.recebedor?.assinaturaPng) {
    try { assinatura = await pdf.embedPng(Buffer.from(d.recebedor.assinaturaPng.replace(/^data:image\/png;base64,/, ''), 'base64')); } catch { assinatura = null; }
  }

  let pg!: PDFPage;
  let y = 0;
  let folha = 0;
  const texto = (t: string, x: number, yy: number, tam = 8.5, fonte: PDFFont = f, cor = AZUL) => pg.drawText(s(t), { x, y: yy, size: tam, font: fonte, color: cor });
  const direita = (t: string, xd: number, yy: number, tam = 8.5, fonte: PDFFont = f, cor = AZUL) => texto(t, xd - larguraReal(fonte, s(t), tam), yy, tam, fonte, cor);

  const cabecalho = () => {
    folha++;
    pg = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    const corFaixa = d.tipo === 'SAIDA' ? AZUL : LARANJA;
    pg.drawRectangle({ x: M, y: y - 48, width: LARG, height: 48, color: corFaixa });
    let xt = M + 12;
    if (logo) {
      const h = 32, w = Math.min(110, h * (logo.width / logo.height)), hh = w / (logo.width / logo.height);
      pg.drawRectangle({ x: M + 8, y: y - 24 - hh / 2 - 3, width: w + 6, height: hh + 6, color: BRANCO });
      pg.drawImage(logo, { x: M + 11, y: y - 24 - hh / 2, width: w, height: hh });
      xt = M + w + 26;
    }
    texto(titulo, xt, y - 19, 10.5, fb, BRANCO);
    texto([d.empresa.nome, d.empresa.documento].filter(Boolean).join(' · '), xt, y - 31, 7, f, rgb(0.88, 0.92, 1));
    texto([d.empresa.endereco, d.empresa.telefone].filter(Boolean).join(' · '), xt, y - 40, 6.5, f, rgb(0.88, 0.92, 1));
    direita(`OS ${d.os}`, A4.w - M - 12, y - 20, 14, fb, BRANCO);
    direita(`${d.fichaLocacao} · ${dataBR(d.data)}${folha > 1 ? ` · folha ${folha}` : ''}`, A4.w - M - 12, y - 33, 7.5, f, rgb(0.88, 0.92, 1));
    y -= 58;
  };
  cabecalho();

  // dados
  const per = d.periodo;
  const pares: [string, string | null | undefined][] = [
    ['Cliente', [d.cliente.nome, d.cliente.documento].filter(Boolean).join(' · ')], ['Evento', d.evento],
    ['Local', d.local], ['Estande', d.estande], ['Contato', d.contato], ['Vendedor(a)', d.vendedor],
    ['Montagem', per.montagem ? dataBR(per.montagem) : null], ['Período', per.inicio ? `${dataBR(per.inicio)} a ${dataBR(per.fim)}` : null],
    ['Desmontagem', per.desmontagem ? dataBR(per.desmontagem) : null], ['Registrado por', d.registradoPor],
  ];
  const validos = pares.filter(([, v]) => v && String(v).trim());
  const col = LARG / 2;
  for (let i = 0; i < validos.length; i += 2) {
    const linha = validos.slice(i, i + 2);
    const alt = Math.max(...linha.map(([, v]) => quebrar(String(v), fb, 8.5, col - 80).length)) * 10 + 6;
    linha.forEach(([r, v], k) => {
      const x = M + k * col;
      texto(r.toUpperCase(), x, y - 8, 6.5, f, CINZA);
      quebrar(String(v), fb, 8.5, col - 80).forEach((l, j) => texto(l, x + 66, y - 8 - j * 10, 8.5, fb));
    });
    y -= alt;
    pg.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.3, color: CINZA_CLARO });
  }
  if (d.observacoes) {
    const linhas = quebrar(`Obs.: ${d.observacoes}`, f, 7.5, LARG).slice(0, 5);
    linhas.forEach((l, j) => texto(l, M, y - 9 - j * 9, 7.5, f, CINZA));
    y -= linhas.length * 9 + 4;
  }
  y -= 8;

  const RESERVA_ASSINATURA = 150;
  const cQtd = 44, cCod = 70, cConf = 46;
  const cDesc = LARG - cQtd - cCod - cConf;
  const garantir = (h: number, titulo: string, cor = AZUL) => { if (y - h < M + 30) { cabecalho(); cabTabela(titulo, cor); } };
  const cabTabela = (t: string, cor = AZUL) => {
    pg.drawRectangle({ x: M, y: y - 18, width: LARG, height: 18, color: cor });
    texto(t, M + 8, y - 12.5, 8.5, fb, BRANCO);
    y -= 18;
    pg.drawRectangle({ x: M, y: y - 14, width: LARG, height: 14, color: FUNDO });
    texto('QTD', M + cQtd / 2 - larguraReal(fb, 'QTD', 6.5) / 2, y - 10, 6.5, fb, CINZA);
    texto('DESCRIÇÃO / PATRIMÔNIOS', M + cQtd + 4, y - 10, 6.5, fb, CINZA);
    texto('CÓDIGO', M + cQtd + cDesc + 4, y - 10, 6.5, fb, CINZA);
    texto('CONF.', M + cQtd + cDesc + cCod + cConf / 2 - larguraReal(fb, 'CONF.', 6.5) / 2, y - 10, 6.5, fb, CINZA);
    y -= 14;
  };
  const tabela = (t: string, itens: ItemOs[], cor = AZUL, comCaixa = true) => {
    if (!itens.length) return;
    garantir(50, t, cor);
    cabTabela(t, cor);
    for (const it of itens) {
      const linhas = quebrar(it.descricao, fb, 8, cDesc - 8);
      const sub = [it.patrimonios?.length ? `Patrimônios: ${it.patrimonios.join(', ')}` : null, it.observacao].filter(Boolean).join(' · ');
      const linhasSub = sub ? quebrar(sub, f, 6.5, cDesc - 8) : [];
      const h = Math.max(18, linhas.length * 9.5 + linhasSub.length * 8 + 7);
      garantir(h, `${t} (cont.)`, cor);
      const tq = qtd(it.quantidade);
      texto(tq, M + cQtd / 2 - larguraReal(fb, tq, 9) / 2, y - 11, 9, fb);
      let yy = y - 10;
      linhas.forEach(l => { texto(l, M + cQtd + 4, yy, 8, fb); yy -= 9.5; });
      linhasSub.forEach(l => { texto(l, M + cQtd + 4, yy, 6.5, f, CINZA); yy -= 8; });
      if (it.codigo) texto(it.codigo, M + cQtd + cDesc + 4, y - 11, 7, f, CINZA);
      if (comCaixa) pg.drawRectangle({ x: M + cQtd + cDesc + cCod + cConf / 2 - 5, y: y - h / 2 - 5, width: 10, height: 10, borderColor: AZUL, borderWidth: 0.8 });
      y -= h;
      pg.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.4, color: CINZA_CLARO });
    }
    y -= 10;
  };
  const totalQtd = (l: ItemOs[]) => qtd(l.reduce((a, i) => a + i.quantidade, 0));
  tabela(`${d.tipo === 'SAIDA' ? 'EQUIPAMENTOS ENTREGUES' : 'EQUIPAMENTOS DEVOLVIDOS'} (${totalQtd(d.itens)} un.)`, d.itens, d.tipo === 'SAIDA' ? AZUL : LARANJA);
  if (d.tipo === 'SAIDA') tabela(`SERVIÇOS / EXTRAS DA OS (${d.servicos.length})`, d.servicos, AZUL_MEDIO, false);
  if (d.comCliente?.length) tabela(`AINDA COM O CLIENTE (${totalQtd(d.comCliente)} un.)`, d.comCliente, rgb(0.7, 0.15, 0.15), false);
  if (d.avarias?.length) {
    garantir(30, 'AVARIAS', rgb(0.7, 0.15, 0.15));
    texto('AVARIAS REGISTRADAS', M, y - 10, 8, fb, rgb(0.7, 0.15, 0.15));
    y -= 14;
    for (const a of d.avarias) for (const l of quebrar(`• ${a}`, f, 7.5, LARG)) { garantir(10, 'AVARIAS'); texto(l, M, y - 8, 7.5, f); y -= 9.5; }
    y -= 6;
  }

  // declaração + assinatura
  if (y - RESERVA_ASSINATURA < M + 20) cabecalho();
  const decl = d.tipo === 'SAIDA'
    ? 'Declaro que recebi os equipamentos acima, em perfeito estado de funcionamento e conservação, e que me responsabilizo por eles até a devolução, nos termos do contrato de locação.'
    : 'Declaro que entreguei os equipamentos acima à locadora. A conferência técnica final é feita pela locadora; avarias identificadas depois serão comunicadas.';
  const linhasDecl = quebrar(decl, f, 7.5, LARG);
  linhasDecl.forEach((l, j) => texto(l, M, y - 9 - j * 9.5, 7.5, f));
  y -= linhasDecl.length * 9.5 + 12;
  const w = (LARG - 16) / 2;
  const hBox = 92;
  for (const k of [0, 1]) {
    const x = M + k * (w + 16);
    pg.drawRectangle({ x, y: y - hBox, width: w, height: hBox, borderColor: CINZA_CLARO, borderWidth: 0.8 });
    pg.drawRectangle({ x, y: y - 14, width: w, height: 14, color: k === 0 ? (d.tipo === 'SAIDA' ? AZUL : LARANJA) : AZUL_MEDIO });
    texto(k === 0 ? (d.tipo === 'SAIDA' ? 'RECEBIDO POR (CLIENTE)' : 'ENTREGUE POR (CLIENTE)') : 'PELA LOCADORA', x + 8, y - 10, 7.5, fb, BRANCO);
    if (k === 0) {
      const r = d.recebedor;
      if (assinatura) {
        const maxW = w - 20, maxH = 42;
        const esc = Math.min(maxW / assinatura.width, maxH / assinatura.height);
        pg.drawImage(assinatura, { x: x + 10, y: y - 20 - assinatura.height * esc, width: assinatura.width * esc, height: assinatura.height * esc });
      }
      pg.drawLine({ start: { x: x + 8, y: y - 64 }, end: { x: x + w - 8, y: y - 64 }, thickness: 0.5, color: AZUL });
      texto(r?.nome ? `${r.nome}${r.documento ? ` · ${r.documento}` : ''}` : 'Nome e documento', x + 8, y - 73, 7, r?.nome ? fb : f, r?.nome ? AZUL : CINZA);
      texto(r?.assinadoEm ? `Assinado na tela em ${new Date(r.assinadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'Data: ____/____/______   Hora: ____:____', x + 8, y - 84, 6.5, f, CINZA);
    } else {
      pg.drawLine({ start: { x: x + 8, y: y - 64 }, end: { x: x + w - 8, y: y - 64 }, thickness: 0.5, color: AZUL });
      texto(d.registradoPor || 'Responsável', x + 8, y - 73, 7, d.registradoPor ? fb : f, d.registradoPor ? AZUL : CINZA);
      texto(d.empresa.nome, x + 8, y - 84, 6.5, f, CINZA);
    }
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    const t = s(`${d.tipo === 'SAIDA' ? 'OS' : 'Devolução'} ${d.os} · ${d.fichaLocacao} · página ${i + 1} de ${paginas.length}`);
    p.drawText(t, { x: A4.w / 2 - larguraReal(f, t, 6.5) / 2, y: 16, size: 6.5, font: f, color: CINZA });
  });
  return pdf.save();
}
