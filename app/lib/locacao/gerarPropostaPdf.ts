// app/lib/locacao/gerarPropostaPdf.ts
// PDF da Proposta de Locação (Ficha de Reserva própria), 2026-11-16.
// Só servidor (lê o logo de app/imgs, mesmo padrão de gerarHoleritePdf).
// Vai para o cliente assinar no Autentique e também pode ser baixado.
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';

export interface ItemPropostaPdf {
  tipo: string;
  descricao: string;
  codigo?: string | null;
  unidade?: string | null;
  quantidade: number;
  dias?: number | null;
  valor_unitario: number;
  desconto_valor: number;
  valor_total: number;
  composicao?: string | null;   // kits: "10× Gabinete · 1× Processadora"
}

export interface DadosPropostaPdf {
  numero: string;
  emitidaEm: string;            // ISO
  validade?: string | null;     // ISO data
  empresa: { nome: string; razao_social?: string | null; cnpj?: string | null; endereco?: string | null; telefone?: string | null; email?: string | null; site?: string | null; logo: 'RENTECH' | 'ALFALIGHT' };
  cliente: { nome: string; documento?: string | null; endereco?: string | null; contato?: string | null; telefone?: string | null; email?: string | null };
  evento: { nome?: string | null; local?: string | null; estande?: string | null; inicio: string; fim: string; dias: number; montagem?: string | null; desmontagem?: string | null; saida?: string | null; retorno?: string | null };
  modalidade: string;
  vendedor?: string | null;
  itens: ItemPropostaPdf[];
  totais: { equipamentos: number; servicos: number; desconto: number; total: number };
  mostrarValoresItens: boolean;
  condicaoPagamento?: string | null;
  observacoes?: string | null;
  condicoesGerais: string;
}

export const CONDICOES_GERAIS_PADRAO = [
  'Esta proposta é válida até a data indicada e a reserva dos equipamentos só é garantida após o aceite (assinatura) do cliente.',
  'Os equipamentos são entregues testados e em perfeito funcionamento. A partir da entrega até a devolução, a guarda e a conservação são de responsabilidade do cliente.',
  'Avarias, perdas, furtos ou extravios serão cobrados pelo valor de reposição/indenização do equipamento.',
  'Atrasos na devolução geram cobrança de diárias adicionais conforme a tabela vigente.',
  'Alterações de quantidades, itens ou datas estão sujeitas à disponibilidade e podem alterar os valores desta proposta.',
  'Cancelamentos após a confirmação estão sujeitos às condições comerciais acordadas.',
].map((t, i) => `${i + 1}. ${t}`).join('\n');

const AZUL = rgb(12 / 255, 29 / 255, 77 / 255);
const AZUL_MEDIO = rgb(51 / 255, 102 / 255, 153 / 255);
const CINZA = rgb(0.39, 0.45, 0.55);
const CINZA_CLARO = rgb(0.89, 0.91, 0.94);
const FUNDO = rgb(0.97, 0.98, 0.99);

const A4 = { w: 595.28, h: 841.89 };
const M = 36;
const LARG = A4.w - 2 * M;

const logos = new Map<string, Buffer>();
function lerLogo(qual: 'RENTECH' | 'ALFALIGHT'): Buffer | null {
  if (!logos.has(qual)) {
    // caminhos literais de propósito: o file tracing da Vercel só empacota o
    // arquivo se enxergar o caminho fixo no código
    try {
      logos.set(qual, qual === 'ALFALIGHT'
        ? fs.readFileSync(path.join(process.cwd(), 'app', 'imgs', 'logo-alfalight.png'))
        : fs.readFileSync(path.join(process.cwd(), 'app', 'imgs', 'logo.png')));
    } catch { return null; }
  }
  return logos.get(qual) || null;
}

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso?: string | null) => { if (!iso) return '—'; const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
// Helvetica do pdf-lib = WinAnsi; troca/tira o que não existe nela.
const s = (t?: string | null) => (t || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/×/g, 'x').replace(/•/g, '-').replace(/[^\x20-\x7E -ÿ\n]/g, '');

function quebrar(texto: string, fonte: PDFFont, tam: number, largura: number): string[] {
  const linhas: string[] = [];
  for (const par of s(texto).split('\n')) {
    const palavras = par.split(/\s+/).filter(Boolean);
    if (!palavras.length) { linhas.push(''); continue; }
    let atual = '';
    for (const p of palavras) {
      const tent = atual ? `${atual} ${p}` : p;
      if (fonte.widthOfTextAtSize(tent, tam) <= largura) { atual = tent; continue; }
      if (atual) linhas.push(atual);
      // palavra maior que a linha: corta
      let resto = p;
      while (fonte.widthOfTextAtSize(resto, tam) > largura && resto.length > 1) {
        let k = resto.length;
        while (k > 1 && fonte.widthOfTextAtSize(resto.slice(0, k), tam) > largura) k--;
        linhas.push(resto.slice(0, k)); resto = resto.slice(k);
      }
      atual = resto;
    }
    if (atual) linhas.push(atual);
  }
  return linhas;
}

export async function gerarPropostaPdf(d: DadosPropostaPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Proposta de Locação ${d.numero}`);
  pdf.setAuthor(d.empresa.razao_social || d.empresa.nome);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  const bytesLogo = lerLogo(d.empresa.logo);
  if (bytesLogo) { try { logo = await pdf.embedPng(bytesLogo); } catch { logo = null; } }

  const paginas: PDFPage[] = [];
  let pg!: PDFPage;
  let y = 0;

  const texto = (t: string, x: number, yy: number, tam = 9, fonte = f, cor = AZUL) => pg.drawText(s(t), { x, y: yy, size: tam, font: fonte, color: cor });
  const direita = (t: string, xDir: number, yy: number, tam = 9, fonte = f, cor = AZUL) => texto(t, xDir - fonte.widthOfTextAtSize(s(t), tam), yy, tam, fonte, cor);

  const novaPagina = (primeira: boolean) => {
    pg = pdf.addPage([A4.w, A4.h]);
    paginas.push(pg);
    y = A4.h - M;
    if (primeira) {
      // cabeçalho completo
      let xTexto = M;
      if (logo) {
        const h = 42, w = Math.min(150, h * (logo.width / logo.height));
        const hh = w / (logo.width / logo.height);
        pg.drawImage(logo, { x: M, y: y - hh, width: w, height: hh });
        xTexto = M + w + 14;
      }
      const linhasEmp = [
        d.empresa.razao_social || d.empresa.nome,
        d.empresa.cnpj ? `CNPJ ${d.empresa.cnpj}` : '',
        d.empresa.endereco || '',
        [d.empresa.telefone, d.empresa.email, d.empresa.site].filter(Boolean).join('  ·  '),
      ].filter(Boolean);
      let ye = y - 9;
      linhasEmp.forEach((l, i) => {
        for (const q of quebrar(l, i === 0 ? fb : f, i === 0 ? 10 : 8, A4.w - M - xTexto)) { texto(q, xTexto, ye, i === 0 ? 10 : 8, i === 0 ? fb : f, i === 0 ? AZUL : CINZA); ye -= i === 0 ? 13 : 10.5; }
      });
      y = Math.min(y - 50, ye - 4);
      pg.drawRectangle({ x: M, y: y - 34, width: LARG, height: 34, color: AZUL });
      texto('PROPOSTA DE LOCAÇÃO', M + 12, y - 22, 13, fb, rgb(1, 1, 1));
      direita(`Nº ${d.numero}`, A4.w - M - 12, y - 15, 11, fb, rgb(1, 1, 1));
      direita(`Emitida em ${dataBR(d.emitidaEm)}${d.validade ? `  ·  Válida até ${dataBR(d.validade)}` : ''}`, A4.w - M - 12, y - 27, 8, f, rgb(0.85, 0.9, 1));
      y -= 48;
    } else {
      texto(`PROPOSTA DE LOCAÇÃO Nº ${d.numero}`, M, y - 10, 9, fb);
      direita(d.empresa.razao_social || d.empresa.nome, A4.w - M, y - 10, 8, f, CINZA);
      pg.drawLine({ start: { x: M, y: y - 16 }, end: { x: A4.w - M, y: y - 16 }, thickness: 0.5, color: CINZA_CLARO });
      y -= 30;
    }
  };

  const garantir = (altura: number) => { if (y - altura < M + 30) novaPagina(false); };

  const secao = (titulo: string) => {
    garantir(30);
    texto(titulo.toUpperCase(), M, y - 10, 8.5, fb, AZUL_MEDIO);
    pg.drawLine({ start: { x: M, y: y - 14 }, end: { x: A4.w - M, y: y - 14 }, thickness: 0.6, color: CINZA_CLARO });
    y -= 24;
  };

  // pares rótulo/valor em 2 colunas
  const campos = (pares: [string, string | null | undefined][]) => {
    const validos = pares.filter(([, v]) => v && String(v).trim());
    const col = LARG / 2;
    for (let i = 0; i < validos.length; i += 2) {
      const linha = validos.slice(i, i + 2);
      const alturas = linha.map(([, v]) => quebrar(String(v), f, 9, col - 12).length);
      const h = Math.max(...alturas) * 11 + 12;
      garantir(h);
      linha.forEach(([r, v], k) => {
        const x = M + k * col;
        texto(r.toUpperCase(), x, y - 7, 6.5, fb, CINZA);
        quebrar(String(v), f, 9, col - 12).forEach((l, j) => texto(l, x, y - 18 - j * 11, 9));
      });
      y -= h + 2;
    }
  };

  novaPagina(true);

  // ---------------- cliente ----------------
  secao('Cliente');
  campos([
    ['Cliente', d.cliente.nome], ['CNPJ / CPF', d.cliente.documento],
    ['Contato', d.cliente.contato], ['Telefone / e-mail', [d.cliente.telefone, d.cliente.email].filter(Boolean).join('  ·  ')],
    ['Endereço', d.cliente.endereco],
  ]);

  // ---------------- evento ----------------
  secao('Evento');
  campos([
    ['Evento', d.evento.nome], ['Local de entrega', d.evento.local],
    ['Período do evento', `${dataBR(d.evento.inicio)} a ${dataBR(d.evento.fim)}  (${d.evento.dias} dia${d.evento.dias > 1 ? 's' : ''})`],
    ['Estande / endereço', d.evento.estande],
    ['Montagem', d.evento.montagem ? dataBR(d.evento.montagem) : null], ['Desmontagem', d.evento.desmontagem ? dataBR(d.evento.desmontagem) : null],
    ['Modalidade', d.modalidade], ['Vendedor', d.vendedor],
  ]);

  // ---------------- itens ----------------
  secao('Equipamentos e serviços');
  const comValores = d.mostrarValoresItens;
  const cols = comValores
    ? [{ t: 'ITEM', w: LARG - 250, al: 'e' }, { t: 'QTD', w: 45, al: 'd' }, { t: 'DIAS', w: 35, al: 'd' }, { t: 'VALOR UNIT.', w: 80, al: 'd' }, { t: 'TOTAL', w: 90, al: 'd' }]
    : [{ t: 'ITEM', w: LARG - 90, al: 'e' }, { t: 'QTD', w: 50, al: 'd' }, { t: 'DIAS', w: 40, al: 'd' }];
  const cabTabela = () => {
    pg.drawRectangle({ x: M, y: y - 16, width: LARG, height: 16, color: FUNDO });
    let x = M;
    for (const c of cols) {
      if (c.al === 'd') direita(c.t, x + c.w - 6, y - 11, 7, fb, CINZA); else texto(c.t, x + 6, y - 11, 7, fb, CINZA);
      x += c.w;
    }
    y -= 20;
  };
  cabTabela();
  for (const it of d.itens) {
    const largItem = cols[0].w - 12;
    const linhasDesc = quebrar(it.descricao, fb, 8.5, largItem);
    const ROTULO_TIPO: Record<string, string> = { SERVICO: 'Serviço', FRETE: 'Frete', OUTRO: 'Outro' };
    const sub = [it.codigo, ROTULO_TIPO[it.tipo] || null].filter(Boolean).join(' · ');
    const linhasComp = it.composicao ? quebrar(`Composição: ${it.composicao}`, f, 7, largItem) : [];
    const linhasDesconto = comValores && it.desconto_valor > 0 ? 1 : 0;
    const h = linhasDesc.length * 10.5 + (sub ? 9 : 0) + linhasComp.length * 8.5 + linhasDesconto * 9 + 8;
    if (y - h < M + 30) { novaPagina(false); cabTabela(); }
    let yy = y - 9;
    linhasDesc.forEach(l => { texto(l, M + 6, yy, 8.5, fb); yy -= 10.5; });
    if (sub) { texto(sub, M + 6, yy, 7, f, CINZA); yy -= 9; }
    linhasComp.forEach(l => { texto(l, M + 6, yy, 7, f, CINZA); yy -= 8.5; });
    let x = M + cols[0].w;
    direita(qtd(it.quantidade) + (it.unidade ? ` ${it.unidade}` : ''), x + cols[1].w - 6, y - 9, 8.5); x += cols[1].w;
    direita(it.dias ? String(it.dias) : '—', x + cols[2].w - 6, y - 9, 8.5); x += cols[2].w;
    if (comValores) {
      direita(BRL(it.valor_unitario), x + cols[3].w - 6, y - 9, 8.5); x += cols[3].w;
      direita(BRL(it.valor_total), x + cols[4].w - 6, y - 9, 8.5, fb);
      if (it.desconto_valor > 0) direita(`desconto ${BRL(it.desconto_valor)}`, x + cols[4].w - 6, y - 19, 6.5, f, CINZA);
    }
    y -= h;
    pg.drawLine({ start: { x: M, y: y + 2 }, end: { x: A4.w - M, y: y + 2 }, thickness: 0.4, color: CINZA_CLARO });
  }

  // ---------------- totais ----------------
  const linhasTot: [string, string, boolean][] = [];
  if (d.totais.servicos > 0) {
    linhasTot.push(['Equipamentos', BRL(d.totais.equipamentos), false]);
    linhasTot.push(['Serviços / frete', BRL(d.totais.servicos), false]);
  }
  if (d.totais.desconto > 0) {
    if (!linhasTot.length) linhasTot.push(['Subtotal', BRL(d.totais.equipamentos + d.totais.servicos), false]);
    linhasTot.push(['Desconto', `- ${BRL(d.totais.desconto)}`, false]);
  }
  garantir(linhasTot.length * 13 + 40);
  y -= 6;
  for (const [r, v] of linhasTot) { direita(r, A4.w - M - 110, y - 9, 8.5, f, CINZA); direita(v, A4.w - M - 6, y - 9, 8.5); y -= 13; }
  pg.drawRectangle({ x: A4.w - M - 230, y: y - 26, width: 230, height: 24, color: AZUL });
  texto('TOTAL DA PROPOSTA', A4.w - M - 222, y - 17, 8.5, fb, rgb(1, 1, 1));
  direita(BRL(d.totais.total), A4.w - M - 8, y - 18, 12, fb, rgb(1, 1, 1));
  y -= 40;

  // ---------------- pagamento / observações ----------------
  if (d.condicaoPagamento || d.observacoes) {
    secao('Condições comerciais');
    campos([['Condição de pagamento', d.condicaoPagamento], ['Validade da proposta', d.validade ? dataBR(d.validade) : null]]);
    if (d.observacoes) {
      for (const l of quebrar(d.observacoes, f, 8.5, LARG)) { garantir(12); texto(l, M, y - 9, 8.5); y -= 11.5; }
      y -= 6;
    }
  }

  // ---------------- condições gerais ----------------
  secao('Condições gerais');
  for (const l of quebrar(d.condicoesGerais || CONDICOES_GERAIS_PADRAO, f, 7.5, LARG)) { garantir(11); texto(l, M, y - 8, 7.5, f, CINZA); y -= 10; }

  // ---------------- aceite ----------------
  garantir(70);
  y -= 16;
  pg.drawRectangle({ x: M, y: y - 46, width: LARG, height: 46, borderColor: CINZA_CLARO, borderWidth: 0.8, color: FUNDO });
  texto('ACEITE DO CLIENTE', M + 10, y - 14, 8, fb, AZUL_MEDIO);
  for (const [i, l] of quebrar(`Ao assinar eletronicamente esta proposta, ${d.cliente.nome} declara estar de acordo com os itens, valores, datas e condições acima. A assinatura é registrada pela plataforma Autentique.`, f, 7.5, LARG - 20).entries()) {
    texto(l, M + 10, y - 26 - i * 9.5, 7.5, f, CINZA);
  }
  y -= 56;

  // ---------------- rodapé ----------------
  const total = paginas.length;
  paginas.forEach((p, i) => {
    p.drawText(s(`${d.empresa.razao_social || d.empresa.nome}  ·  Proposta ${d.numero}`), { x: M, y: 18, size: 6.5, font: f, color: CINZA });
    const t = `Página ${i + 1} de ${total}`;
    p.drawText(t, { x: A4.w - M - f.widthOfTextAtSize(t, 6.5), y: 18, size: 6.5, font: f, color: CINZA });
  });

  return pdf.save();
}
