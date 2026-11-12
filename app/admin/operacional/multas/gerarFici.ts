// Gera o "Formulário de Identificação do Condutor Infrator" (FICI) em PDF,
// pré-preenchido com os dados da multa, da empresa e do condutor — roda no
// navegador (pdf-lib, fonte Helvetica WinAnsi: acentos do português ok).
// É um modelo interno: órgãos que exigem formulário próprio continuam
// valendo o deles; no SNE a indicação é feita pelo app. Serve também de
// comprovante assinado pelo condutor.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatarDataBR } from '../../../lib/formatadores';

export interface DadosFici {
  multa: {
    auto_infracao: string | null; orgao_autuador: string | null; codigo_infracao: string | null; descricao: string | null;
    data_infracao: string | null; hora_infracao: string | null; local_infracao: string | null; municipio: string | null;
    prazo_indicacao: string | null;
  };
  veiculo: { placa: string; renavam: string | null; marca_modelo: string } | null;
  empresa: { razao_social: string; cnpj: string | null } | null;
  condutor: {
    nome: string; cpf: string | null; cnh_numero: string | null; cnh_categoria: string | null; cnh_validade: string | null;
    endereco: string | null; bairro: string | null; cidade: string | null; cep: string | null;
  };
}

const dataBR = (d: string | null) => formatarDataBR(d, '');
const cpfFmt = (c: string | null) => { const d = (c || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (c || ''); };
const cnpjFmt = (c: string | null) => { const d = (c || '').replace(/\D/g, ''); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (c || ''); };
const horaFmt = (h: string | null) => (h && !/^00:00(:00)?$/.test(h) ? h.slice(0, 5) : '');
// Tira o que a WinAnsi não sabe desenhar (emoji, símbolos) pra não quebrar a geração.
const limpar = (s: string) => s.replace(/[^\x20-\x7E -ÿ–—‘’“”•]/g, '');

export async function gerarFiciPdf(dados: DadosFici): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595, 842]);
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margem = 40;
  const largura = 595 - margem * 2;
  let y = 800;

  const texto = (p: PDFPage, t: string, x: number, yy: number, f: PDFFont, tam: number, cor = rgb(0.05, 0.11, 0.3)) =>
    p.drawText(limpar(t), { x, y: yy, size: tam, font: f, color: cor });

  const quebrar = (t: string, f: PDFFont, tam: number, max: number): string[] => {
    const palavras = limpar(t).split(/\s+/);
    const linhas: string[] = [];
    let atual = '';
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p;
      if (f.widthOfTextAtSize(teste, tam) > max && atual) { linhas.push(atual); atual = p; } else atual = teste;
    }
    if (atual) linhas.push(atual);
    return linhas;
  };

  // Cabeçalho
  texto(pagina, 'FORMULÁRIO DE IDENTIFICAÇÃO DO CONDUTOR INFRATOR', margem, y, negrito, 13); y -= 15;
  texto(pagina, 'Indicação do condutor responsável pela infração (art. 257, §7º, do Código de Trânsito Brasileiro)', margem, y, fonte, 8.5, rgb(0.35, 0.4, 0.5)); y -= 10;
  if (dados.multa.prazo_indicacao) {
    texto(pagina, `Prazo para apresentar a indicação: ${dataBR(dados.multa.prazo_indicacao)}`, margem, y, negrito, 9, rgb(0.7, 0.1, 0.1)); y -= 6;
  }
  y -= 10;

  // Bloco de seção com campos em grade
  const secao = (titulo: string, campos: [string, string, number][]) => {
    pagina.drawRectangle({ x: margem, y: y - 14, width: largura, height: 16, color: rgb(0.05, 0.11, 0.3) });
    texto(pagina, titulo, margem + 6, y - 9, negrito, 9, rgb(1, 1, 1));
    y -= 16;
    let x = margem;
    const alturaLinha = 30;
    let linhaUsada = 0;
    for (const [rotulo, valor, frac] of campos) {
      const w = largura * frac;
      if (linhaUsada + frac > 1.0001) { y -= alturaLinha; x = margem; linhaUsada = 0; }
      pagina.drawRectangle({ x, y: y - alturaLinha, width: w, height: alturaLinha, borderColor: rgb(0.75, 0.78, 0.84), borderWidth: 0.7 });
      texto(pagina, rotulo.toUpperCase(), x + 4, y - 9, negrito, 6.5, rgb(0.45, 0.5, 0.6));
      const linhas = quebrar(valor || ' ', fonte, 9, w - 8).slice(0, 2);
      linhas.forEach((l, i) => texto(pagina, l, x + 4, y - 19 - i * 9, fonte, 9));
      x += w; linhaUsada += frac;
    }
    y -= alturaLinha + 12;
  };

  const m = dados.multa;
  secao('1. IDENTIFICAÇÃO DA INFRAÇÃO', [
    ['Órgão autuador', m.orgao_autuador || '', 0.4],
    ['Nº do auto de infração (AIT)', m.auto_infracao || '', 0.35],
    ['Código da infração', m.codigo_infracao || '', 0.25],
    ['Placa', dados.veiculo?.placa || '', 0.2],
    ['Renavam', dados.veiculo?.renavam || '', 0.25],
    ['Marca / modelo', dados.veiculo?.marca_modelo || '', 0.55],
    ['Data', dataBR(m.data_infracao), 0.2],
    ['Hora', horaFmt(m.hora_infracao), 0.15],
    ['Local', [m.local_infracao, m.municipio].filter(Boolean).join(' - '), 0.65],
    ['Descrição da infração', m.descricao || '', 1],
  ]);

  secao('2. PROPRIETÁRIO DO VEÍCULO', [
    ['Nome / razão social', dados.empresa?.razao_social || '', 0.7],
    ['CNPJ', cnpjFmt(dados.empresa?.cnpj || null), 0.3],
  ]);

  const c = dados.condutor;
  secao('3. CONDUTOR INFRATOR', [
    ['Nome completo', c.nome, 0.7],
    ['CPF', cpfFmt(c.cpf), 0.3],
    ['Nº de registro da CNH', c.cnh_numero || '', 0.4],
    ['Categoria', c.cnh_categoria || '', 0.2],
    ['Validade', dataBR(c.cnh_validade), 0.4],
    ['Endereço', c.endereco || '', 0.6],
    ['Bairro', c.bairro || '', 0.4],
    ['Município', c.cidade || '', 0.6],
    ['CEP', c.cep || '', 0.4],
  ]);

  // Declaração
  pagina.drawRectangle({ x: margem, y: y - 14, width: largura, height: 16, color: rgb(0.05, 0.11, 0.3) });
  texto(pagina, '4. DECLARAÇÃO', margem + 6, y - 9, negrito, 9, rgb(1, 1, 1));
  y -= 28;
  const declaracao = `Declaramos, sob as penas da lei, que o condutor identificado no item 3 conduzia o veículo descrito no item 1 no momento da infração, e que o condutor está ciente de que a pontuação correspondente será registrada em seu prontuário. O condutor declara serem verdadeiras as informações acima.`;
  for (const l of quebrar(declaracao, fonte, 9, largura)) { texto(pagina, l, margem, y, fonte, 9); y -= 12; }
  y -= 30;

  // Assinaturas
  const linhaAss = (x: number, rotulo: string, sub: string) => {
    pagina.drawLine({ start: { x, y }, end: { x: x + 230, y }, thickness: 0.7, color: rgb(0.3, 0.3, 0.35) });
    texto(pagina, rotulo, x, y - 11, negrito, 8);
    texto(pagina, sub, x, y - 21, fonte, 7.5, rgb(0.35, 0.4, 0.5));
  };
  linhaAss(margem, 'Assinatura do condutor infrator', limpar(c.nome).slice(0, 48));
  linhaAss(margem + largura - 230, 'Assinatura do proprietário / representante legal', limpar(dados.empresa?.razao_social || '').slice(0, 48));
  y -= 45;
  texto(pagina, 'Local e data: _______________________________, ____/____/________', margem, y, fonte, 9);
  y -= 26;

  // Orientações
  const orientacoes = [
    'Anexar cópia legível da CNH do condutor e do documento do representante legal do proprietário (com o ato que lhe dá poderes).',
    'Assinaturas devem conferir com as dos documentos apresentados. Enviar ao órgão autuador até o prazo indicado na notificação.',
    'Veículo aderido ao SNE: a indicação pode ser feita pelo app SNE / Carteira Digital de Trânsito, dispensando este formulário.',
    'Modelo interno do sistema: se o órgão autuador exigir o formulário próprio que acompanha a notificação, utilize o dele.',
  ];
  texto(pagina, 'ORIENTAÇÕES', margem, y, negrito, 8, rgb(0.35, 0.4, 0.5)); y -= 11;
  for (const o of orientacoes) for (const l of quebrar(`• ${o}`, fonte, 7.5, largura)) { texto(pagina, l, margem, y, fonte, 7.5, rgb(0.35, 0.4, 0.5)); y -= 10; }

  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
