// app/lib/locacao/gerarContratoPdf.ts
// PDF do CONTRATO DE LOCAÇÃO DE BENS MÓVEIS E OUTRAS AVENÇAS (2026-11-17),
// no layout do "contrato padrao.pdf" da Rentech: partes, objetos da locação,
// extras, prazo/evento, local, valor e prazo de pagamento, e as cláusulas
// (texto padrão em textosPadrao.ts ou o da empresa em Parâmetros → Empresas).
// Assinado na Autentique pelo cliente e pelo representante da locadora.
import { PDFDocument, StandardFonts, type PDFPage, type PDFImage } from 'pdf-lib';
import {
  A4, AZUL, CINZA, CINZA_CLARO, BRL, dataBR, dataExtenso, qtd, s, quebrar, quebrarRico, desenharLinhaRica, lerLogo, larguraReal,
} from './pdfBase';

export interface DadosContratoPdf {
  numero: string;
  data: string;   // ISO — data de emissão (local e data das assinaturas)
  empresa: { razao_social: string; cnpj?: string | null; endereco?: string | null; inscricao_estadual?: string | null; inscricao_municipal?: string | null; logo: 'RENTECH' | 'ALFALIGHT' };
  cliente: { nome: string; pessoaFisica: boolean; documento?: string | null; inscricao_estadual?: string | null; logradouro?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null };
  objetos: { codigo: string; quantidade: number; descricao: string }[];
  extras: { descricao: string; dataRef?: string | null; quantidade: number }[];
  inicio: string;
  termino: string;
  evento?: string | null;
  local?: string | null;
  estande?: string | null;
  condicao?: string | null;
  forma?: string | null;
  parcelas: { vencimento: string; valor: number }[];
  valores: { locacao: number; servicos: number; desconto: number; total: number };
  clausulas: string;
  /** Quem assina (no envio). Sem lista = linhas em branco, como no modelo. */
  assinantes?: { papel: string; nome: string }[];
}

const M = 40;
const LARG = A4.w - 2 * M;
const CIDADE_FORO = 'São Paulo (SP)';

export async function gerarContratoPdf(d: DadosContratoPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Contrato de Locação ${d.numero}`);
  pdf.setAuthor(d.empresa.razao_social);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  const bytesLogo = lerLogo(d.empresa.logo);
  if (bytesLogo) { try { logo = await pdf.embedPng(bytesLogo); } catch { logo = null; } }

  const paginas: PDFPage[] = [];
  let pg!: PDFPage;
  let y = 0;
  const texto = (t: string, x: number, yy: number, tam = 8.5, fonte = f, cor = AZUL) => pg.drawText(s(t), { x, y: yy, size: tam, font: fonte, color: cor });
  const centro = (t: string, yy: number, tam = 8.5, fonte = fb, cor = AZUL) => texto(t, A4.w / 2 - larguraReal(fonte, s(t), tam) / 2, yy, tam, fonte, cor);

  const novaPagina = () => {
    pg = pdf.addPage([A4.w, A4.h]);
    paginas.push(pg);
    y = A4.h - M + 6;
    if (logo && paginas.length === 1) {
      const h = 44, w = h * (logo.width / logo.height);
      pg.drawImage(logo, { x: A4.w - M - w, y: y - h, width: w, height: h });
      y -= h + 10;
    } else if (paginas.length > 1) {
      texto(`Contrato de Locação ${d.numero}`, M, y - 8, 7, f, CINZA);
      y -= 18;
    }
  };
  const garantir = (h: number) => { if (y - h < M + 20) novaPagina(); };

  // faixa cinza de título de quadro (como no modelo)
  const faixa = (titulo: string) => {
    garantir(30);
    pg.drawRectangle({ x: M, y: y - 14, width: LARG, height: 14, color: CINZA_CLARO, borderColor: AZUL, borderWidth: 0.6 });
    centro(titulo, y - 10, 8);
    y -= 14;
  };
  // linha de tabela com bordas
  const linhaTabela = (cols: { t: string; w: number; bold?: boolean; centro?: boolean }[], tam = 7.5) => {
    const alturas = cols.map(c => quebrar(c.t, c.bold ? fb : f, tam, c.w - 6).length || 1);
    const h = Math.max(...alturas) * (tam + 2.5) + 5;
    garantir(h);
    let x = M;
    for (const c of cols) {
      pg.drawRectangle({ x, y: y - h, width: c.w, height: h, borderColor: AZUL, borderWidth: 0.4 });
      quebrar(c.t, c.bold ? fb : f, tam, c.w - 6).forEach((l, i) => {
        const fonte = c.bold ? fb : f;
        const xt = c.centro ? x + c.w / 2 - larguraReal(fonte, l, tam) / 2 : x + 3;
        texto(l, xt, y - tam - 2 - i * (tam + 2.5), tam, fonte);
      });
      x += c.w;
    }
    y -= h;
  };
  const paragrafo = (t: string, tam = 8, recuo = 0, espacoDepois = 6) => {
    const linhas = quebrarRico(t, f, fb, tam, LARG - recuo);
    for (const l of linhas) {
      garantir(tam + 3);
      desenharLinhaRica(pg, l, M + recuo, y - tam, tam, f, fb, AZUL, true, LARG - recuo);
      y -= tam + 2.6;
    }
    y -= espacoDepois;
  };

  novaPagina();

  // ---------------- título e partes ----------------
  pg.drawRectangle({ x: M, y: y - 16, width: LARG, height: 16, color: CINZA_CLARO, borderColor: AZUL, borderWidth: 0.8 });
  centro('CONTRATO DE LOCAÇÃO DE BENS MÓVEIS E OUTRAS AVENÇAS', y - 11, 9);
  y -= 26;
  paragrafo('**Pelo presente instrumento de locação de bens móveis, são partes:**', 8.5, 10, 6);

  const e = d.empresa;
  const locadora = `**${e.razao_social}**, pessoa jurídica de direito privado, com sede social na ${e.endereco || '__________'}; Inscrita regularmente no CNPJ/MF sob nº ${e.cnpj || '__________'}`
    + `${e.inscricao_estadual ? `, Inscrição Estadual sob nº ${e.inscricao_estadual}` : ''}${e.inscricao_municipal ? `, Inscrição Municipal sob nº ${e.inscricao_municipal}` : ''}`
    + ` neste ato, devidamente representada por seu representante legal, nos termos de seu Contrato Social, doravante designada simplesmente de **LOCADORA**, e de outro lado;`;
  const c = d.cliente;
  const sede = [c.logradouro, c.bairro ? `Bairro ${c.bairro}` : null, c.cidade ? `na cidade de ${c.cidade}` : null, c.uf ? `Estado de ${c.uf}` : null, c.cep ? `CEP: ${c.cep}` : null].filter(Boolean).join(', ') || '__________';
  const locataria = c.pessoaFisica
    ? `**${c.nome}**, pessoa física, inscrita no CPF/MF sob nº ${c.documento || '__________'}, residente e domiciliada na ${sede}, neste ato designado(a) simplesmente de **LOCATÁRIA(O)**`
    : `**${c.nome}**, pessoa jurídica de direito privado, com sede social na ${sede}; Inscrita regularmente no CNPJ/MF sob nº ${c.documento || '__________'}`
      + `${c.inscricao_estadual ? `, Inscrição Estadual sob nº ${c.inscricao_estadual}` : ''}, neste ato designado(a) simplesmente de **LOCATÁRIA(O)**`;
  for (const [i, p] of [locadora, locataria].entries()) {
    garantir(30);
    texto(`${i + 1}.`, M + 10, y - 8, 8, fb);
    paragrafo(p, 8, 24, 6);
  }
  y -= 4;

  // ---------------- objetos da locação ----------------
  faixa('OBJETOS DA LOCAÇÃO');
  const wCod = 70, wQtd = 40;
  linhaTabela([{ t: 'Código', w: wCod, bold: true, centro: true }, { t: 'Qtd.', w: wQtd, bold: true, centro: true }, { t: 'Descrição', w: LARG - wCod - wQtd, bold: true, centro: true }]);
  if (!d.objetos.length) linhaTabela([{ t: '—', w: LARG }]);
  for (const o of d.objetos) linhaTabela([{ t: o.codigo, w: wCod }, { t: qtd(o.quantidade), w: wQtd }, { t: o.descricao, w: LARG - wCod - wQtd }]);
  y -= 8;

  // ---------------- extras ----------------
  faixa('EXTRAS');
  const wData = 90, wQ2 = 50;
  linhaTabela([{ t: 'Descrição Extra', w: LARG - wData - wQ2, bold: true, centro: true }, { t: 'Data Ref.', w: wData, bold: true, centro: true }, { t: 'Qtde.', w: wQ2, bold: true, centro: true }]);
  for (const x of d.extras) linhaTabela([{ t: x.descricao, w: LARG - wData - wQ2 }, { t: x.dataRef ? dataBR(x.dataRef) : '', w: wData, centro: true }, { t: qtd(x.quantidade), w: wQ2, centro: true }]);
  y -= 8;

  // ---------------- prazo / evento ----------------
  faixa('PRAZO DO CONTRATO DE LOCAÇÃO / EVENTO');
  linhaTabela([{ t: `Início: ${dataBR(d.inicio)}`, w: LARG / 2 }, { t: `Término: ${dataBR(d.termino)}`, w: LARG / 2 }]);
  linhaTabela([{ t: `Evento / Feira: ${d.evento || '—'}`, w: LARG, bold: true }]);
  y -= 8;

  // ---------------- local ----------------
  faixa('LOCAL DE UTILIZAÇÃO/ENTREGA');
  linhaTabela([{ t: `Endereço: ${d.local || '—'}`, w: LARG }]);
  if (d.estande) linhaTabela([{ t: `Estande: ${d.estande}`, w: LARG }]);
  y -= 8;

  // ---------------- valor / pagamento ----------------
  faixa('VALOR DA LOCAÇÃO/PRAZO DE PAGAMENTO');
  y -= 4;
  const linhasValor = [
    d.condicao ? `Condição de Pagamento: ${d.condicao}` : null,
    d.forma ? `Forma de Pagamento: ${d.forma}` : null,
    `Valor da locação: ${BRL(d.valores.locacao).replace('R$ ', '')}`,
    d.valores.servicos > 0 ? `Valor dos extras/serviços: ${BRL(d.valores.servicos).replace('R$ ', '')}` : null,
    d.valores.desconto > 0 ? `Desconto: ${BRL(d.valores.desconto).replace('R$ ', '')}` : null,
    d.parcelas.length > 1 ? `Parcelas: ${d.parcelas.map((p, i) => `${i + 1}ª ${dataBR(p.vencimento)} ${BRL(p.valor)}`).join('; ')}` : null,
  ].filter(Boolean) as string[];
  for (const l of linhasValor) for (const q of quebrar(l, f, 8, LARG - 10)) { garantir(11); texto(q, M + 4, y - 8, 8); y -= 10.5; }
  garantir(12);
  texto(`Valor total: ${BRL(d.valores.total)}.`, M + 4, y - 8, 8.5, fb); y -= 20;

  // ---------------- cláusulas ----------------
  for (const bloco of d.clausulas.replace(/\r/g, '').split(/\n\s*\n/)) {
    const t = bloco.trim();
    if (!t) continue;
    if (t.startsWith('## ')) {
      const titulo = t.slice(3).trim();
      if (/^DEFINI/.test(titulo)) faixa(titulo);
      else { garantir(40); y -= 6; centro(titulo, y - 9, 8.5); y -= 20; }
      if (/^DEFINI/.test(titulo)) y -= 8;
      continue;
    }
    paragrafo(t.replace(/\n/g, ' '), 8, 0, 7);
  }

  // ---------------- assinaturas ----------------
  garantir(230);
  y -= 10;
  const dataTxt = `${CIDADE_FORO}, ${dataExtenso(d.data)}.`;
  texto(dataTxt, A4.w - M - larguraReal(f, s(dataTxt), 8.5), y - 8, 8.5);
  y -= 50;
  const wAss = 260, xAss = A4.w - M - wAss;
  const lista = d.assinantes || [];
  const daLocadora = lista.filter(a => a.papel === 'VENDEDOR' || a.papel === 'REPRESENTANTE');
  const clientes = lista.filter(a => a.papel === 'LOCATARIA' || a.papel === 'OUTRO');
  const testemunhas = lista.filter(a => a.papel === 'TESTEMUNHA');
  const linhaAss = (nome: string, papel: string, subtitulo?: string) => {
    garantir(60);
    pg.drawLine({ start: { x: xAss, y }, end: { x: xAss + wAss, y }, thickness: 0.6, color: AZUL });
    const linhasNome = quebrar(nome, f, 8, wAss).slice(0, 2);
    linhasNome.forEach((l, k) => texto(l, xAss + wAss / 2 - larguraReal(f, l, 8) / 2, y - 10 - k * 10, 8));
    const rot = subtitulo ? `${papel} - ${subtitulo}` : papel;
    texto(rot, xAss + wAss / 2 - larguraReal(f, s(rot), 8) / 2, y - 10 - linhasNome.length * 10, 8);
    y -= 52 + (linhasNome.length - 1) * 10;
  };
  // locadora: razão social + quem assina por ela
  if (daLocadora.length) for (const a of daLocadora) linhaAss(`${d.empresa.razao_social}`, '(LOCADORA)', `${a.nome}${a.papel === 'VENDEDOR' ? ' (vendedor(a))' : ' (representante)'}`);
  else linhaAss(d.empresa.razao_social, '(LOCADORA)');
  // locatária (e outras pessoas incluídas)
  if (clientes.length) for (const a of clientes) linhaAss(a.papel === 'LOCATARIA' ? d.cliente.nome : a.nome, a.papel === 'LOCATARIA' ? '(LOCATÁRIA(O))' : '(INTERVENIENTE)', a.papel === 'LOCATARIA' && a.nome !== d.cliente.nome ? a.nome : undefined);
  else linhaAss(d.cliente.nome, '(LOCATÁRIA(O))');
  garantir(40 + Math.max(2, testemunhas.length) * 52);
  texto('TESTEMUNHAS:', M, y + 14, 8);
  const nomesTest = testemunhas.length ? testemunhas.map(a => a.nome) : ['', ''];
  for (const nome of nomesTest) {
    y -= 22;
    pg.drawLine({ start: { x: M, y }, end: { x: M + 200, y }, thickness: 0.6, color: AZUL });
    texto(`NOME: ${nome}`, M, y - 9, 7.5);
    texto('RG Nº', M, y - 18, 7.5); texto('CPF Nº', M, y - 27, 7.5);
    y -= 30;
  }
  y -= 6;
  for (const l of quebrar('Documento assinado eletronicamente pela plataforma Autentique, com validade jurídica (MP 2.200-2/2001 e Cláusula 37ª).', f, 6.5, LARG)) {
    texto(l, M, y, 6.5, f, CINZA); y -= 8;
  }

  // rodapé
  const total = paginas.length;
  paginas.forEach((p, i) => {
    const t = `${d.empresa.razao_social}  ·  Contrato ${d.numero}  ·  Página ${i + 1} de ${total}`;
    p.drawLine({ start: { x: M, y: 26 }, end: { x: A4.w - M, y: 26 }, thickness: 0.5, color: CINZA_CLARO });
    p.drawText(s(t), { x: A4.w / 2 - larguraReal(f, s(t), 6.5) / 2, y: 16, size: 6.5, font: f, color: CINZA });
  });
  return pdf.save();
}
