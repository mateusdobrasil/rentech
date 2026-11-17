// app/lib/locacao/gerarPropostaPdf.ts
// PDF da Proposta de Locação (Ficha de Reserva própria). Layout de 2026-11-17
// inspirado no modelo do Grupo Pleno escolhido pelo usuário:
//   cabeçalho com nº / emissão / validade / vendedor (telefone e e-mail);
//   01 Das partes · 02 Período e evento · 03 Equipamentos (por categoria, com
//   subtotal; ficha técnica dos painéis de LED) · 04 Pagamento (forma,
//   condição, parcelas) · 05 Extras e Termo de Responsabilidade (textos do
//   orçamento padrão da Rentech) · assinaturas.
// Só servidor. Vai para o cliente assinar na Autentique e pode ser baixado.
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFImage } from 'pdf-lib';
import {
  A4, AZUL, AZUL_MEDIO, CINZA, CINZA_CLARO, FUNDO, BRANCO, BRL, dataBR, qtd, num, s, quebrar, lerLogo, larguraReal,
} from './pdfBase';
import type { MontagemLed } from './ledTecnico';

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
  composicao?: string | null;   // kits: "10x Gabinete · 1x Processadora"
  grupo: string;                // categoria do produto ou "SERVIÇOS E LOGÍSTICA"
  led?: { montagem: MontagemLed; descricao?: string | null; pitch?: number | null } | null;
}

export interface DadosPropostaPdf {
  numero: string;
  emitidaEm: string;            // ISO
  validade?: string | null;     // ISO data
  empresa: { nome: string; razao_social?: string | null; cnpj?: string | null; endereco?: string | null; telefone?: string | null; email?: string | null; site?: string | null; logo: 'RENTECH' | 'ALFALIGHT' };
  cliente: { nome: string; documento?: string | null; inscricao?: string | null; endereco?: string | null; contato?: string | null; telefone?: string | null; email?: string | null };
  evento: { nome?: string | null; local?: string | null; estande?: string | null; inicio: string; fim: string; dias: number; diasCobrados?: number | null; montagem?: string | null; desmontagem?: string | null; saida?: string | null; retorno?: string | null };
  modalidade: string;
  vendedor?: { nome: string; telefone?: string | null; email?: string | null } | null;
  itens: ItemPropostaPdf[];
  totais: { equipamentos: number; servicos: number; desconto: number; total: number };
  mostrarValoresItens: boolean;
  pagamento: { forma?: string | null; condicao?: string | null; parcelas: { vencimento: string; valor: number }[] };
  observacoes?: string | null;
  extras: string;               // um item por linha
  termo: string;                // um item por linha
}

const M = 36;
const LARG = A4.w - 2 * M;
const GRUPO_SERVICOS = 'SERVIÇOS E LOGÍSTICA';

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
  const direita = (t: string, xDir: number, yy: number, tam = 9, fonte = f, cor = AZUL) => texto(t, xDir - larguraReal(fonte, s(t), tam), yy, tam, fonte, cor);

  const novaPagina = (primeira: boolean) => {
    pg = pdf.addPage([A4.w, A4.h]);
    paginas.push(pg);
    y = A4.h - M;
    if (!primeira) {
      texto(`PROPOSTA COMERCIAL  ${d.numero}`, M, y - 10, 9, fb);
      direita(d.empresa.razao_social || d.empresa.nome, A4.w - M, y - 10, 8, f, CINZA);
      pg.drawLine({ start: { x: M, y: y - 16 }, end: { x: A4.w - M, y: y - 16 }, thickness: 0.5, color: CINZA_CLARO });
      y -= 30;
      return;
    }
    // faixa escura com logo e dados da empresa
    const hFaixa = 70;
    pg.drawRectangle({ x: M, y: y - hFaixa, width: LARG, height: hFaixa, color: AZUL });
    let xTexto = M + 14;
    if (logo) {
      const h = 46, w = Math.min(150, h * (logo.width / logo.height)), hh = w / (logo.width / logo.height);
      pg.drawRectangle({ x: M + 10, y: y - hFaixa / 2 - hh / 2 - 4, width: w + 8, height: hh + 8, color: BRANCO });
      pg.drawImage(logo, { x: M + 14, y: y - hFaixa / 2 - hh / 2, width: w, height: hh });
      xTexto = M + w + 34;
    }
    const linhasEmp = [
      [d.empresa.razao_social || d.empresa.nome, 10, fb],
      [[d.empresa.cnpj ? `CNPJ ${d.empresa.cnpj}` : '', d.empresa.telefone].filter(Boolean).join('  ·  '), 7.5, f],
      [[d.empresa.email, d.empresa.site].filter(Boolean).join('  ·  '), 7.5, f],
    ] as const;
    let ye = y - 24;
    for (const [t, tam, fonte] of linhasEmp) { if (t) { texto(t, xTexto, ye, tam, fonte, BRANCO); ye -= 12; } }
    y -= hFaixa + 10;

    // cartão título + cartão nº/validade/vendedor
    const hCard = 74, wDir = 190;
    pg.drawRectangle({ x: M, y: y - hCard, width: LARG - wDir - 10, height: hCard, color: FUNDO });
    texto('PROPOSTA COMERCIAL', M + 14, y - 20, 8, fb, CINZA);
    texto('LOCAÇÃO DE EQUIPAMENTOS', M + 14, y - 40, 15, fb);
    quebrar(`${d.cliente.nome}${d.cliente.documento ? `  ·  ${d.cliente.documento}` : ''}`, f, 9, LARG - wDir - 40).slice(0, 2)
      .forEach((l, i) => texto(l, M + 14, y - 56 - i * 11, 9, f, CINZA));
    const xD = A4.w - M - wDir;
    pg.drawRectangle({ x: xD, y: y - hCard, width: wDir, height: hCard, color: FUNDO });
    direita(d.numero, A4.w - M - 12, y - 18, 13, fb);
    direita(`Emitida em ${dataBR(d.emitidaEm)}`, A4.w - M - 12, y - 30, 7.5, f, CINZA);
    if (d.validade) direita(`Válida até ${dataBR(d.validade)}`, A4.w - M - 12, y - 40, 7.5, fb, rgb(0.8, 0.1, 0.15));
    if (d.vendedor?.nome) {
      direita('VENDEDOR', A4.w - M - 12, y - 52, 6.5, fb, CINZA);
      direita(d.vendedor.nome, A4.w - M - 12, y - 61, 8, fb);
      const contato = [d.vendedor.telefone, d.vendedor.email].filter(Boolean).join('  ·  ');
      if (contato) direita(contato, A4.w - M - 12, y - 70, 6.5, f, CINZA);
    }
    y -= hCard + 16;
  };

  const garantir = (altura: number) => { if (y - altura < M + 30) novaPagina(false); };

  // "01  DAS PARTES"
  const secao = (n: string, titulo: string) => {
    garantir(40);
    texto(n, M, y - 20, 20, fb, CINZA_CLARO);
    texto(titulo.toUpperCase(), M + 32, y - 17, 12, fb);
    pg.drawLine({ start: { x: M, y: y - 25 }, end: { x: A4.w - M, y: y - 25 }, thickness: 1.2, color: AZUL });
    y -= 36;
  };

  // linhas rótulo/valor numa coluna (x, largura); devolve a altura usada
  const blocoCampos = (x: number, largura: number, yIni: number, titulo: string | null, pares: [string, string | null | undefined][]) => {
    let yy = yIni;
    if (titulo) { texto(titulo, x, yy - 9, 8.5, fb); pg.drawLine({ start: { x, y: yy - 13 }, end: { x: x + largura, y: yy - 13 }, thickness: 0.5, color: CINZA_CLARO }); yy -= 20; }
    const rot = 78;
    for (const [r, v] of pares) {
      if (!v || !String(v).trim()) continue;
      const linhas = quebrar(String(v), fb, 8, largura - rot - 4);
      texto(r.toUpperCase(), x, yy - 8, 6.5, f, CINZA);
      linhas.forEach((l, i) => texto(l, x + rot, yy - 8 - i * 10, 8, fb));
      yy -= Math.max(1, linhas.length) * 10 + 5;
      pg.drawLine({ start: { x, y: yy + 2 }, end: { x: x + largura, y: yy + 2 }, thickness: 0.3, color: CINZA_CLARO });
    }
    return yIni - yy;
  };

  novaPagina(true);

  // ======================= 01 DAS PARTES =======================
  secao('01', 'Das partes');
  {
    const col = (LARG - 20) / 2;
    const parcCli: [string, string | null | undefined][] = [
      ['Razão social', d.cliente.nome], ['CNPJ / CPF', d.cliente.documento], ['Inscr. estadual', d.cliente.inscricao],
      ['Endereço', d.cliente.endereco], ['Responsável', d.cliente.contato], ['Telefone', d.cliente.telefone], ['E-mail', d.cliente.email],
    ];
    const parcEmp: [string, string | null | undefined][] = [
      ['Empresa', d.empresa.razao_social || d.empresa.nome], ['CNPJ', d.empresa.cnpj], ['Endereço', d.empresa.endereco],
      ['Telefone', d.empresa.telefone], ['E-mail', d.empresa.email], ['Site', d.empresa.site],
    ];
    garantir(150);
    const h1 = blocoCampos(M, col, y, 'LOCATÁRIA', parcCli);
    const h2 = blocoCampos(M + col + 20, col, y, 'LOCADORA', parcEmp);
    y -= Math.max(h1, h2) + 14;
  }

  // ======================= 02 PERÍODO E EVENTO =======================
  secao('02', 'Período e evento');
  {
    const col = (LARG - 20) / 2;
    const dias = `${dataBR(d.evento.inicio)} a ${dataBR(d.evento.fim)}  (${d.evento.dias} dia${d.evento.dias > 1 ? 's' : ''})`;
    const esq: [string, string | null | undefined][] = [
      ['Evento', d.evento.nome], ['Local de entrega', d.evento.local], ['Estande', d.evento.estande],
      ['Data do evento', dias],
    ];
    const dir: [string, string | null | undefined][] = [
      ['Saída', d.evento.saida ? dataBR(d.evento.saida) : null], ['Montagem', d.evento.montagem ? dataBR(d.evento.montagem) : null],
      ['Desmontagem', d.evento.desmontagem ? dataBR(d.evento.desmontagem) : null], ['Retorno', d.evento.retorno ? dataBR(d.evento.retorno) : null],
      ['Diárias cobradas', d.evento.diasCobrados && d.evento.diasCobrados !== d.evento.dias ? String(d.evento.diasCobrados) : null],
      ['Modalidade', d.modalidade],
    ];
    garantir(110);
    const h1 = blocoCampos(M, col, y, null, esq);
    const h2 = blocoCampos(M + col + 20, col, y, null, dir);
    y -= Math.max(h1, h2) + 14;
  }

  // ======================= 03 EQUIPAMENTOS =======================
  const grupos = new Map<string, ItemPropostaPdf[]>();
  for (const it of d.itens) grupos.set(it.grupo, [...(grupos.get(it.grupo) || []), it]);
  // serviços e logística sempre por último
  const ordem = [...grupos.keys()].sort((a, b) => (a === GRUPO_SERVICOS ? 1 : 0) - (b === GRUPO_SERVICOS ? 1 : 0));
  secao('03', 'Equipamentos');
  texto(`${d.itens.length} ite${d.itens.length === 1 ? 'm' : 'ns'} · ${ordem.length} grupo${ordem.length === 1 ? '' : 's'}`, A4.w - M - 120, y + 19, 7.5, f, CINZA);
  const comValores = d.mostrarValoresItens;
  const wQtd = 70, wVal = comValores ? 150 : 0;
  const largDesc = LARG - 24 - wQtd - wVal;

  for (const nomeGrupo of ordem) {
    const lista = grupos.get(nomeGrupo)!;
    const subtotal = lista.reduce((acc, i) => acc + i.valor_total, 0);
    garantir(60);
    pg.drawRectangle({ x: M, y: y - 22, width: LARG, height: 22, color: AZUL });
    texto(nomeGrupo.toUpperCase(), M + 12, y - 15, 9.5, fb, BRANCO);
    if (comValores) direita(BRL(subtotal), A4.w - M - 12, y - 15, 9.5, fb, BRANCO);
    y -= 30;

    lista.forEach((it, idx) => {
      const linhasDesc = quebrar(it.descricao, fb, 9, largDesc);
      const sub = [it.codigo, it.unidade].filter(Boolean).join(' · ');
      const linhasComp = it.composicao ? quebrar(`Composição: ${it.composicao}`, f, 7, largDesc) : [];
      const led = it.led;
      const hLed = led ? 96 : 0;
      const h = linhasDesc.length * 11 + (sub ? 9 : 0) + linhasComp.length * 8.5 + hLed + 12;
      garantir(h);
      let yy = y - 10;
      texto(String(idx + 1).padStart(2, '0'), M + 2, yy, 7, fb, CINZA_CLARO);
      linhasDesc.forEach(l => { texto(l, M + 16, yy, 9, fb); yy -= 11; });
      if (sub) { texto(sub, M + 16, yy, 7, f, CINZA); yy -= 9; }
      linhasComp.forEach(l => { texto(l, M + 16, yy, 7, f, CINZA); yy -= 8.5; });
      // qtd · dias
      const xQ = M + 16 + largDesc;
      const qtdTxt = `${qtd(it.quantidade)} ${led ? 'm²' : it.unidade ? it.unidade.toLowerCase() : 'un'}`;
      direita(qtdTxt, xQ + wQtd, y - 10, 8, f, CINZA);
      if (it.dias) direita(`${it.dias} diária${it.dias > 1 ? 's' : ''}`, xQ + wQtd, y - 20, 7, f, CINZA);
      if (comValores) {
        direita(`${BRL(it.valor_unitario)}/${led ? 'm²' : 'un'}`, A4.w - M - 80, y - 10, 7.5, f, CINZA);
        direita(BRL(it.valor_total), A4.w - M - 6, y - 10, 10, fb);
        if (it.desconto_valor > 0) direita(`desconto ${BRL(it.desconto_valor)}`, A4.w - M - 6, y - 21, 6.5, f, CINZA);
      }
      // ficha técnica do painel de LED
      if (led) {
        const m = led.montagem;
        const yL = yy - 2;
        texto('INFORMAÇÕES TÉCNICAS', M + 16, yL - 6, 6.5, fb, CINZA);
        const chips = [
          `${num(m.m2)} m²  ·  ${num(m.larguraM)} m (L) x ${num(m.alturaM)} m (A)`,
          `Pixel map ${m.pixelLargura.toLocaleString('pt-BR')} x ${m.pixelAltura.toLocaleString('pt-BR')} px`,
          `${m.gabinetes} gabinetes (${m.colunas} x ${m.linhas})`,
          [m.pesoKg !== null ? `Peso ~${num(m.pesoKg, 0)} kg` : null, m.consumoKw !== null ? `Consumo ~${num(m.consumoKw, 1)} kW` : null].filter(Boolean).join('  ·  '),
        ].filter(Boolean);
        let yc = yL - 18;
        for (const c of chips) {
          const w = larguraReal(f, s(c), 7) + 12;
          pg.drawRectangle({ x: M + 16, y: yc - 4, width: w, height: 12, color: FUNDO, borderColor: CINZA_CLARO, borderWidth: 0.5 });
          texto(c, M + 22, yc, 7, f, AZUL);
          yc -= 15;
        }
        if (led.descricao) quebrar(led.descricao, f, 6.5, 250).slice(0, 2).forEach((l, k) => texto(l, M + 16, yc - k * 8, 6.5, f, CINZA));
        // desenho do painel (grade de gabinetes) à direita
        const caixaW = 170, caixaH = 64;
        const escala = Math.min(caixaW / m.colunas, caixaH / m.linhas);
        const gw = m.colunas * escala, gh = m.linhas * escala;
        const gx = M + 280, gyTop = yL - 8;
        pg.drawRectangle({ x: gx, y: gyTop - gh, width: gw, height: gh, color: rgb(0.93, 0.96, 1), borderColor: AZUL_MEDIO, borderWidth: 1 });
        if (m.colunas <= 60) for (let c = 1; c < m.colunas; c++) pg.drawLine({ start: { x: gx + c * escala, y: gyTop }, end: { x: gx + c * escala, y: gyTop - gh }, thickness: 0.3, color: rgb(0.75, 0.82, 0.92) });
        if (m.linhas <= 40) for (let l = 1; l < m.linhas; l++) pg.drawLine({ start: { x: gx, y: gyTop - l * escala }, end: { x: gx + gw, y: gyTop - l * escala }, thickness: 0.3, color: rgb(0.75, 0.82, 0.92) });
        const lbl = String(m.colunas);
        texto(lbl, gx + gw / 2 - larguraReal(f, lbl, 7) / 2, gyTop - gh - 9, 7, f, CINZA);
        texto(String(m.linhas), gx + gw + 4, gyTop - gh / 2 - 3, 7, f, CINZA);
      }
      y -= h;
      pg.drawLine({ start: { x: M, y: y + 3 }, end: { x: A4.w - M, y: y + 3 }, thickness: 0.4, color: CINZA_CLARO });
    });
    if (comValores) {
      garantir(20);
      pg.drawRectangle({ x: M, y: y - 18, width: LARG, height: 18, color: FUNDO });
      direita(`SUBTOTAL ${nomeGrupo.toUpperCase()}`, A4.w - M - 100, y - 12, 7, fb, CINZA);
      direita(BRL(subtotal), A4.w - M - 8, y - 12, 9, fb);
      y -= 26;
    }
    y -= 6;
  }

  // totais
  garantir(70);
  const bruto = d.totais.equipamentos + d.totais.servicos;
  const hTot = 52;
  pg.drawRectangle({ x: M, y: y - hTot, width: LARG, height: hTot, color: FUNDO });
  texto(d.totais.desconto > 0 ? 'SUB-TOTAL SEM DESCONTO' : 'VALOR TOTAL', M + 14, y - 18, 7, fb, CINZA);
  texto(BRL(bruto), M + 14, y - 34, 12, f, CINZA);
  if (d.totais.desconto > 0) {
    texto('DESCONTO', M + 180, y - 18, 7, fb, CINZA);
    texto(`- ${BRL(d.totais.desconto)}`, M + 180, y - 34, 12, f, CINZA);
  }
  direita('VALOR FINAL', A4.w - M - 14, y - 18, 7, fb, CINZA);
  direita(BRL(d.totais.total), A4.w - M - 14, y - 40, 18, fb);
  y -= hTot + 16;

  // ======================= 04 PAGAMENTO =======================
  secao('04', 'Pagamento');
  {
    const col = (LARG - 20) / 2;
    const parc = d.pagamento.parcelas;
    const esq: [string, string | null | undefined][] = [
      ['Forma de pagamento', d.pagamento.forma], ['Condição', d.pagamento.condicao],
      ['Parcelas', parc.length ? `${parc.length}x` : null],
      ['Validade', d.validade ? `${dataBR(d.validade)}, ou enquanto durarem os estoques` : null],
    ];
    garantir(80);
    const h1 = blocoCampos(M, col, y, null, esq);
    // parcelas
    let h2 = 0;
    if (parc.length) {
      const x = M + col + 20;
      let yy = y;
      texto('PARCELA', x, yy - 8, 6.5, fb, CINZA); texto('VENCIMENTO', x + 60, yy - 8, 6.5, fb, CINZA); direita('VALOR', x + col, yy - 8, 6.5, fb, CINZA);
      yy -= 14;
      parc.slice(0, 12).forEach((p, i) => {
        texto(`${i + 1}ª`, x, yy - 8, 8, fb); texto(dataBR(p.vencimento), x + 60, yy - 8, 8, f); direita(BRL(p.valor), x + col, yy - 8, 8, fb);
        yy -= 12;
        pg.drawLine({ start: { x, y: yy + 1 }, end: { x: x + col, y: yy + 1 }, thickness: 0.3, color: CINZA_CLARO });
      });
      texto('Vencimentos estimados pela condição de pagamento.', x, yy - 8, 6, f, CINZA);
      h2 = y - (yy - 12);
    }
    y -= Math.max(h1, h2) + 12;
    if (d.observacoes) {
      garantir(30);
      texto('OBSERVAÇÕES', M, y - 8, 6.5, fb, CINZA); y -= 14;
      for (const l of quebrar(d.observacoes, f, 8.5, LARG)) { garantir(12); texto(l, M, y - 8, 8.5); y -= 11; }
      y -= 8;
    }
  }

  // ======================= 05 TERMOS =======================
  secao('05', 'Termos e responsabilidades');
  const lista = (titulo: string, textoLista: string, marcador: string) => {
    const itens = textoLista.split('\n').map(x => x.trim().replace(/^[-*•]\s*/, '')).filter(Boolean);
    if (!itens.length) return;
    garantir(30);
    texto(titulo.toUpperCase(), M, y - 8, 8, fb); y -= 16;
    for (const it of itens) {
      const linhas = quebrar(it, f, 7.8, LARG - 14);
      garantir(linhas.length * 10 + 3);
      texto(marcador, M + 2, y - 8, 7.8, fb, AZUL_MEDIO);
      linhas.forEach((l, i) => texto(l, M + 12, y - 8 - i * 10, 7.8, f, rgb(0.2, 0.25, 0.32)));
      y -= linhas.length * 10 + 3;
    }
    y -= 8;
  };
  lista('Extras sob consulta', d.extras, '+');
  lista('Termo de responsabilidade', d.termo, '-');

  // ======================= assinaturas =======================
  garantir(90);
  y -= 30;
  const wAss = (LARG - 40) / 2;
  for (const [i, rot] of [[0, 'LOCADORA'], [1, 'LOCATÁRIA']] as const) {
    const x = M + i * (wAss + 40);
    pg.drawLine({ start: { x, y }, end: { x: x + wAss, y }, thickness: 0.8, color: AZUL });
    const nome = i === 0 ? (d.empresa.razao_social || d.empresa.nome) : d.cliente.nome;
    const linhasNome = quebrar(nome, f, 7, wAss).slice(0, 2);
    linhasNome.forEach((l, k) => texto(l, x + wAss / 2 - larguraReal(f, l, 7) / 2, y - 10 - k * 9, 7, f, CINZA));
    texto(rot, x + wAss / 2 - larguraReal(fb, rot, 7) / 2, y - 12 - linhasNome.length * 9, 7, fb, CINZA);
  }
  y -= 44;
  const aviso = 'Esta proposta só terá validade mediante aceite do cliente. A assinatura eletrônica é registrada pela plataforma Autentique.';
  for (const l of quebrar(aviso, f, 7, LARG)) { texto(l, A4.w / 2 - larguraReal(f, l, 7) / 2, y, 7, f, CINZA); y -= 9; }

  // rodapé
  const total = paginas.length;
  paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 28 }, end: { x: A4.w - M, y: 28 }, thickness: 1.2, color: AZUL_MEDIO });
    p.drawText(s(`${d.empresa.razao_social || d.empresa.nome}  ·  Proposta ${d.numero}`), { x: M, y: 17, size: 6.5, font: f, color: CINZA });
    const t = `Página ${i + 1} de ${total}`;
    p.drawText(t, { x: A4.w - M - larguraReal(f, t, 6.5), y: 17, size: 6.5, font: f, color: CINZA });
  });

  return pdf.save();
}

export { GRUPO_SERVICOS };
