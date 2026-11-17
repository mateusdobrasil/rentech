// app/lib/sispagBoletos.ts
// Pagamento de boletos pelo SISPAG do Itaú via arquivo CNAB 240 (não há API
// de pagamento de boleto liberada — a API do SISPAG só inclui Pix, ver
// app/lib/itauSispag.ts). O arquivo é baixado na tela do lote
// (/admin/financeiro/rh) e enviado no Itaú Empresas, onde é aprovado como
// qualquer outro arquivo SISPAG.
//
// Layout: manual "SISPAG — Sistema de Contas a Pagar Itaú — CNAB 240",
// versão 085 (outubro/2020), download.itau.com.br/bankline/sispag_cnab.pdf:
//   - Boleto bancário (código começando com o banco): lote de "Liquidação de
//     títulos (boletos)" com Segmento J + Segmento J-52 (obrigatório nas
//     formas 30 e 31). Forma 30 = boleto do Itaú, 31 = de outros bancos.
//     Tipo de pagamento 20 (Fornecedores).
//   - Arrecadação (código começando com "8": multas, concessionárias,
//     tributos): lote de "Contas de Concessionárias e Tributos com código de
//     barras" com Segmento O. A forma depende do segmento Febraban (2º
//     dígito do código) — ver formaArrecadacao().
// Sem dependências — roda no navegador (a geração do arquivo é client-side,
// igual aos arquivos de PIX e TED da mesma tela).

import { normalizarBoleto, soDigitos } from './boletoMulta';

export type BoletoLote = {
  codigo: string;               // código de barras, 44 dígitos
  linha: string;                // linha digitável (47 bancário / 48 arrecadação)
  tipo: 'BANCARIO' | 'ARRECADACAO';
  banco: string | null;         // 3 dígitos (só bancário)
  valor: number | null;         // valor embutido no código (null = sem valor / valor de referência)
  vencimento: string | null;    // yyyy-mm-dd pelo fator de vencimento (só bancário; null = sem fator)
  valido: boolean;              // dígitos verificadores conferem
  rotulo: string | null;        // texto antes do ":" (ex.: "AIT 1E1234567"), quando a OP junta vários
};

// ---------------------------------------------------------------------------
// Leitura da linha digitável
// ---------------------------------------------------------------------------

// Fator de vencimento Febraban: dias desde 07/10/1997. Ao chegar em 9999
// (21/02/2025) o fator voltou para 1000 em 22/02/2025 — o mesmo fator
// representa duas datas, separadas por 9000 dias. Fica a mais próxima de hoje.
function dataDoFator(fator: number, hoje = new Date()): string | null {
  if (!fator) return null;
  const DIA = 86400000;
  const base = Date.UTC(1997, 9, 7);
  const candidatos = [base + fator * DIA, base + (fator + 9000) * DIA];
  const ref = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const escolhido = candidatos.reduce((a, b) => Math.abs(b - ref) < Math.abs(a - ref) ? b : a);
  return new Date(escolhido).toISOString().slice(0, 10);
}

function montarBoleto(digitos: string, rotulo: string | null): BoletoLote | null {
  const b = normalizarBoleto(digitos);
  if (!b) return null;
  const c = b.codigo;
  if (c[0] === '8') {
    // 3º dígito 6 ou 8 = valor efetivo em reais nas posições 5–15; 7 ou 9 =
    // valor de referência (índice), que não serve como valor a pagar.
    const valor = (c[2] === '6' || c[2] === '8') ? Number(c.slice(4, 15)) / 100 : null;
    return { codigo: c, linha: b.linha, tipo: 'ARRECADACAO', banco: null, valor: valor || null, vencimento: null, valido: b.valido, rotulo };
  }
  const valor = Number(c.slice(9, 19)) / 100;
  return {
    codigo: c, linha: b.linha, tipo: 'BANCARIO', banco: c.slice(0, 3),
    valor: valor || null, vencimento: dataDoFator(Number(c.slice(5, 9))), valido: b.valido, rotulo,
  };
}

// Lê os boletos do texto livre de "dados de pagamento" da OP (ou da conta a
// pagar). Aceita um boleto só (linha digitável formatada ou não, ou código
// de barras) ou vários no formato que a OP de multas monta:
// "AIT 123: 81610000001-2 ... | AIT 456: 8161...". `trechosNaoLidos` lista
// pedaços que têm cara de boleto (40+ dígitos) mas não deram 44/47/48.
export function extrairBoletos(texto: string | null | undefined): { boletos: BoletoLote[]; trechosNaoLidos: string[] } {
  const boletos: BoletoLote[] = [];
  const trechosNaoLidos: string[] = [];
  const pedacos = String(texto || '').split(/\s*[|\n;]\s*/).map(p => p.trim()).filter(Boolean);
  for (const pedaco of pedacos) {
    const doisPontos = pedaco.lastIndexOf(':');
    const rotulo = doisPontos > 0 ? pedaco.slice(0, doisPontos).trim() || null : null;
    const valor = doisPontos > 0 ? pedaco.slice(doisPontos + 1) : pedaco;
    const digitos = soDigitos(valor);
    if (digitos.length < 40) continue; // texto solto, observação etc.
    const boleto = (digitos.length === 44 || digitos.length === 47 || digitos.length === 48) ? montarBoleto(digitos, rotulo) : null;
    if (boleto) boletos.push(boleto);
    else trechosNaoLidos.push(pedaco);
  }
  return { boletos, trechosNaoLidos };
}

// Confere se dá pra pagar o item pelo arquivo. Retorna null se estiver ok,
// ou a mensagem pro alerta do item (que trava o checkbox no lote).
export function validarBoletosItem(params: {
  boletos: BoletoLote[]; trechosNaoLidos: string[]; valorTotal: number; documentoFavorecido: string | null;
}): string | null {
  const { boletos, trechosNaoLidos, valorTotal } = params;
  if (trechosNaoLidos.length > 0) {
    return `Linha digitável com quantidade de dígitos inválida ("${trechosNaoLidos[0].slice(0, 60)}") — confira se foi colada inteira.`;
  }
  const invalido = boletos.find(b => !b.valido);
  if (invalido) {
    return `Linha digitável com dígito verificador errado${invalido.rotulo ? ` (${invalido.rotulo})` : ''} — confira a digitação.`;
  }
  const doc = soDigitos(params.documentoFavorecido);
  if (boletos.some(b => b.tipo === 'BANCARIO') && doc.length !== 11 && doc.length !== 14) {
    return 'Falta o CPF/CNPJ do beneficiário — o Itaú recusa boleto sem ele (Segmento J-52).';
  }
  if (boletos.length > 1) {
    const semValor = boletos.find(b => !b.valor);
    if (semValor) {
      return `O boleto${semValor.rotulo ? ` ${semValor.rotulo}` : ''} não traz o valor no código — com mais de um boleto na mesma OP não dá pra dividir o total. Faça uma OP por boleto.`;
    }
    const soma = boletos.reduce((s, b) => s + (b.valor || 0), 0);
    if (Math.abs(soma - valorTotal) > 0.009) {
      return `A soma dos ${boletos.length} boletos (R$ ${soma.toFixed(2).replace('.', ',')}) não bate com o total da OP (R$ ${valorTotal.toFixed(2).replace('.', ',')}).`;
    }
  } else if (boletos.length === 1) {
    const b = boletos[0];
    // Guia de arrecadação tem valor fixo: pagar diferente é recusado.
    if (b.tipo === 'ARRECADACAO' && b.valor && Math.abs(b.valor - valorTotal) > 0.009) {
      return `O valor do código de barras (R$ ${b.valor.toFixed(2).replace('.', ',')}) não bate com o valor a pagar (R$ ${valorTotal.toFixed(2).replace('.', ',')}).`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Geração do arquivo CNAB 240
// ---------------------------------------------------------------------------

export type PagamentoBoletoCnab = {
  favorecido: string;                 // nome do beneficiário
  documentoFavorecido: string | null; // CPF/CNPJ do beneficiário (obrigatório no boleto bancário)
  dataPagamento: string;              // yyyy-mm-dd
  vencimentoPadrao: string | null;    // yyyy-mm-dd, quando o código não traz fator (vencimento da OP)
  seuNumero: string;                  // identificação nossa, volta no retorno (ex.: "OP487-1")
  boleto: BoletoLote;
  valorPagamento: number;
};

export type EmpresaPagadoraCnab = {
  cnpj: string; razaoSocial: string; agencia: string; conta: string; dac: string;
};

type Lote = { forma: string; tipo: string; segmento: 'J' | 'O'; pagamentos: PagamentoBoletoCnab[] };

// Forma de pagamento do lote de arrecadação (Nota 5), pelo segmento
// Febraban (2º dígito do código de barras): 1 = prefeituras, 5 = órgãos
// governamentais e 7 = multas de trânsito são tributos; o resto (água, luz,
// gás, telefone, carnês) é concessionária.
function formaArrecadacao(codigo: string): { forma: string; tipo: string } {
  const segmento = codigo[1];
  if (segmento === '1') return { forma: '19', tipo: '22' }; // IPTU/ISS/outros tributos municipais
  if (segmento === '5' || segmento === '7') return { forma: '91', tipo: '22' }; // GNRE e tributos com código de barras
  return { forma: '13', tipo: '20' }; // concessionárias
}

export const ROTULO_FORMA: Record<string, string> = {
  '30': 'Boletos Itaú',
  '31': 'Boletos outros bancos',
  '13': 'Concessionárias',
  '19': 'Tributos municipais',
  '91': 'Tributos com código de barras (multas)',
};

const padR = (s: string | number | null | undefined, n: number) => String(s ?? '').substring(0, n).padEnd(n, ' ');
const padL = (s: string | number | null | undefined, n: number) => String(s ?? '').substring(0, n).padStart(n, '0');
const texto = (s: string | null | undefined) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ddmmaaaa = (iso: string) => { const [a, m, d] = iso.split('-'); return `${d}${m}${a}`; };
const centavos = (v: number) => Math.round(v * 100);

// ---------------------------------------------------------------------------
// Leitura do arquivo de RETORNO (o que o Itaú devolve depois de processar a
// remessa: Transmissão de Arquivo → Retorno). Mesmo layout da remessa, com
// "Nosso Número" e as ocorrências (Nota 8) preenchidos. O J-52 não volta no
// retorno. Só os segmentos J e O são lidos — são os do arquivo de boletos; o
// "Seu Número" (OP622, OP622 1, CP45...) é o que liga cada pagamento de volta
// à OP / conta a pagar que gerou a remessa.
// ---------------------------------------------------------------------------

export const OCORRENCIAS_SISPAG: Record<string, string> = {
  '00': 'Pagamento efetuado',
  AE: 'Data de pagamento alterada',
  AG: 'Número do lote inválido',
  AH: 'Número sequencial do registro no lote inválido',
  AJ: 'Tipo de movimento inválido',
  AL: 'Código do banco favorecido inválido',
  AO: 'Nome do favorecido inválido',
  AP: 'Data de pagamento / vencimento inválida',
  AR: 'Valor arrecadado / lançamento inválido',
  BC: 'Nosso número inválido',
  BD: 'Pagamento agendado',
  BE: 'Pagamento agendado com forma alterada para OP',
  BI: 'CPF/CNPJ do beneficiário ou pagador (J-52) inválido',
  CD: 'CPF/CNPJ divergente do cadastrado',
  CE: 'Pagamento cancelado',
  CF: 'Valor do documento inválido',
  CG: 'Valor do abatimento inválido',
  CH: 'Valor do desconto inválido',
  CI: 'CPF/CNPJ / identificador inválido',
  CK: 'Tipo de inscrição inválida',
  HA: 'Erro no lote',
  HM: 'Erro no header do arquivo',
  IB: 'Valor do documento inválido',
  IC: 'Valor do abatimento inválido',
  ID: 'Valor do desconto inválido',
  IE: 'Valor da mora inválido',
  IF: 'Valor da multa inválido',
  IH: 'Valor do acréscimo inválido',
  II: 'Data de vencimento inválida',
  IK: 'Tributo não liquidável via SISPAG ou não conveniado com o Itaú',
  IM: 'Tipo x forma de pagamento não compatível',
  IN: 'Banco/agência não cadastrados',
  IO: 'DAC / valor / identificador inválido',
  IP: 'DAC do código de barras inválido',
  IR: 'Pagamento alterado',
  IS: 'Concessionária não conveniada com o Itaú',
  LA: 'Data de pagamento do lote alterada',
  LC: 'Lote de pagamentos cancelado',
  NA: 'Pagamento cancelado por falta de autorização',
  NI: 'Tributo já foi pago ou está vencido',
  NR: 'Operação não realizada',
  RJ: 'Registro rejeitado',
  SS: 'Cancelado por insuficiência de saldo / limite diário excedido',
  TA: 'Lote não aceito — totais com diferença',
  TI: 'Titularidade inválida',
};

// Ocorrências que não indicam problema (só informam o andamento).
const OCORRENCIAS_NEUTRAS = ['BD', 'AE', 'IR', 'LA'];

export type SituacaoRetorno = 'PAGO' | 'AGENDADO' | 'RECUSADO';

export type RegistroRetornoSispag = {
  segmento: 'J' | 'O';
  seuNumero: string;
  referencia: { tipo: 'OP' | 'CP'; numero: number; parte: number | null } | null;
  nossoNumero: string;
  favorecido: string;
  valorPago: number;
  dataPagamento: string | null; // yyyy-mm-dd
  ocorrencias: string[];
  descricao: string;
  situacao: SituacaoRetorno;
};

const dataIso = (ddmmaaaa: string) => /^\d{8}$/.test(ddmmaaaa) && ddmmaaaa !== '00000000'
  ? `${ddmmaaaa.slice(4, 8)}-${ddmmaaaa.slice(2, 4)}-${ddmmaaaa.slice(0, 2)}` : null;

export function lerRetornoSispag(conteudo: string):
  { ok: true; cnpj: string; registros: RegistroRetornoSispag[]; ignorados: number } | { ok: false; erro: string } {
  const linhas = String(conteudo || '').split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = linhas[0] || '';
  if (header.slice(0, 3) !== '341' || header[7] !== '0') return { ok: false, erro: 'Não parece um arquivo SISPAG do Itaú (o primeiro registro não é um header de arquivo 341).' };
  if (header[142] !== '2') return { ok: false, erro: 'Este arquivo é uma REMESSA, não um retorno — baixe o arquivo em Transmissão de Arquivo → Retorno.' };

  const registros: RegistroRetornoSispag[] = [];
  let ignorados = 0;
  let ultimoJ = '';
  for (const l of linhas) {
    if (l[7] !== '3') continue; // só registros de detalhe
    const seg = l[13];
    const chave = l.slice(3, 13); // lote + nº do registro
    if (seg === 'J' && chave === ultimoJ) continue; // J-52 (mesmo número do J) — não é pagamento
    if (seg !== 'J' && seg !== 'O') { ignorados++; continue; }
    if (seg === 'J') ultimoJ = chave;

    const seuNumero = (seg === 'J' ? l.slice(182, 202) : l.slice(174, 194)).trim();
    const ocorrencias = (l.slice(230, 240).match(/.{1,2}/g) || []).map(c => c.trim()).filter(Boolean);
    const m = /^(OP|CP)\s*(\d+)(?:\s+(\d+))?$/.exec(seuNumero);
    const situacao: SituacaoRetorno = ocorrencias.includes('00') ? 'PAGO'
      : ocorrencias.length > 0 && ocorrencias.every(c => OCORRENCIAS_NEUTRAS.includes(c)) ? 'AGENDADO'
      : 'RECUSADO';
    registros.push({
      segmento: seg,
      seuNumero,
      referencia: m ? { tipo: m[1] as 'OP' | 'CP', numero: Number(m[2]), parte: m[3] ? Number(m[3]) : null } : null,
      nossoNumero: l.slice(215, 230).trim(),
      favorecido: (seg === 'J' ? l.slice(61, 91) : l.slice(65, 95)).trim(),
      // J: valor do pagamento (153–167). O: valor pago (145–159), ou o previsto (122–136) se ainda não efetivado.
      valorPago: seg === 'J' ? Number(l.slice(152, 167)) / 100 : (Number(l.slice(144, 159)) || Number(l.slice(121, 136))) / 100,
      dataPagamento: dataIso(seg === 'J' ? l.slice(144, 152) : l.slice(136, 144)),
      ocorrencias,
      descricao: ocorrencias.map(c => `${c} — ${OCORRENCIAS_SISPAG[c] || 'ocorrência não catalogada'}`).join('; ') || 'Sem ocorrência',
      situacao,
    });
  }
  return { ok: true, cnpj: header.slice(18, 32), registros, ignorados };
}

export function gerarArquivoSispagBoletos(params: {
  empresa: EmpresaPagadoraCnab;
  pagamentos: PagamentoBoletoCnab[];
  agora?: Date;
}): { conteudo: string; lotes: { forma: string; rotulo: string; qtd: number; total: number }[] } {
  const { empresa } = params;
  const agora = params.agora || new Date();

  const cnpj = padL(soDigitos(empresa.cnpj), 14);
  const nomeEmpresa = padR(texto(empresa.razaoSocial), 30);
  const agencia = padL(soDigitos(empresa.agencia), 5);
  const conta = padL(soDigitos(empresa.conta), 12);
  const dac = padL(soDigitos(empresa.dac) || '0', 1);
  const contaDebito = agencia + ' ' + conta + ' ' + dac; // posições 053–072

  // Agrupa por forma de pagamento — cada forma vai num lote próprio.
  const lotes: Lote[] = [];
  for (const p of params.pagamentos) {
    const { forma, tipo, segmento } = p.boleto.tipo === 'BANCARIO'
      ? { forma: p.boleto.banco === '341' ? '30' : '31', tipo: '20', segmento: 'J' as const }
      : { ...formaArrecadacao(p.boleto.codigo), segmento: 'O' as const };
    let lote = lotes.find(l => l.forma === forma);
    if (!lote) { lote = { forma, tipo, segmento, pagamentos: [] }; lotes.push(lote); }
    lote.pagamentos.push(p);
  }

  const linhas: string[] = [];
  const dataGeracao = padL(agora.getDate(), 2) + padL(agora.getMonth() + 1, 2) + agora.getFullYear();
  const horaGeracao = padL(agora.getHours(), 2) + padL(agora.getMinutes(), 2) + padL(agora.getSeconds(), 2);

  // Header de arquivo — igual aos arquivos de PIX/TED da tela do lote.
  linhas.push(
    '341' + '0000' + '0' + padR('', 6) + '080' + '2' + cnpj + padR('', 20) + contaDebito + nomeEmpresa +
    padR('BANCO ITAU', 30) + padR('', 10) + '1' + dataGeracao + horaGeracao + padL('', 9) + '00000' + padR('', 69)
  );

  const resumo: { forma: string; rotulo: string; qtd: number; total: number }[] = [];
  let totalRegistros = 2; // header + trailer de arquivo

  lotes.forEach((lote, i) => {
    const codLote = padL(i + 1, 4);
    let registrosLote = 0;
    let somaCentavos = 0;

    // Header de lote (mesmo desenho para J e O): tipo de pagamento, forma,
    // versão do layout do lote "030", CNPJ e conta debitada; endereço da
    // empresa e finalidade ficam em branco, como nos outros arquivos.
    linhas.push(
      '341' + codLote + '1' + 'C' + lote.tipo + lote.forma + '030' + ' ' + '2' + cnpj + padR('', 20) + contaDebito + nomeEmpresa +
      padR('', 30) + padR('', 10) + padR('', 30) + padL('', 5) + padR('', 15) + padR('', 20) + padL('', 8) + padR('', 2) + padR('', 8) + padR('', 10)
    );
    registrosLote++;

    lote.pagamentos.forEach((p, j) => {
      const seq = padL(j + 1, 5);
      const valorPag = centavos(p.valorPagamento);
      somaCentavos += valorPag;
      const nomeFav = texto(p.favorecido);
      const dataPag = ddmmaaaa(p.dataPagamento);
      const venc = ddmmaaaa(p.boleto.vencimento || p.vencimentoPadrao || p.dataPagamento);

      if (lote.segmento === 'J') {
        // Segmento J: o código de barras de 44 dígitos ocupa as posições
        // 018–061 na ordem original (banco, moeda, DV, fator, valor, campo
        // livre). Valor do título = o do código; diferença para o valor pago
        // vai em desconto ou acréscimo.
        const valorTitulo = p.boleto.valor ? centavos(p.boleto.valor) : valorPag;
        const desconto = Math.max(0, valorTitulo - valorPag);
        const acrescimo = Math.max(0, valorPag - valorTitulo);
        linhas.push(
          '341' + codLote + '3' + seq + 'J' + '000' + p.boleto.codigo + padR(nomeFav, 30) + venc +
          padL(valorTitulo, 15) + padL(desconto, 15) + padL(acrescimo, 15) + dataPag + padL(valorPag, 15) +
          padL('', 15) + padR(texto(p.seuNumero), 20) + padR('', 13) + padR('', 15) + padR('', 10)
        );
        // Segmento J-52 (mesmo número do J): sacado = nossa empresa,
        // cedente = beneficiário do boleto (obrigatório — ocorrência "BI").
        const docFav = soDigitos(p.documentoFavorecido);
        linhas.push(
          '341' + codLote + '3' + seq + 'J' + '000' + '52' +
          '2' + padL(cnpj, 15) + padR(texto(empresa.razaoSocial), 40) +
          (docFav.length === 11 ? '1' : '2') + padL(docFav, 15) + padR(nomeFav, 40) +
          '0' + padL('', 15) + padR('', 40) + padR('', 53)
        );
        registrosLote += 2;
      } else {
        // Segmento O: código de barras (44 dígitos) no campo X(48), alinhado à
        // esquerda — o Anexo B do manual v086 (fev/2024) põe os 44 dígitos nas
        // posições 018–061; 062–065 ficam em branco.
        linhas.push(
          '341' + codLote + '3' + seq + 'O' + '000' + padR(p.boleto.codigo, 48) + padR(nomeFav, 30) + venc +
          'REA' + padL('', 15) + padL(valorPag, 15) + dataPag + padL('', 15) + padR('', 3) + padL('', 9) + padR('', 3) +
          padR(texto(p.seuNumero), 20) + padR('', 21) + padR('', 15) + padR('', 10)
        );
        registrosLote++;
      }
    });

    registrosLote++; // trailer de lote
    linhas.push(lote.segmento === 'J'
      ? '341' + codLote + '5' + padR('', 9) + padL(registrosLote, 6) + padL(somaCentavos, 18) + padL('', 18) + padR('', 171) + padR('', 10)
      : '341' + codLote + '5' + padR('', 9) + padL(registrosLote, 6) + padL(somaCentavos, 18) + padL('', 15) + padR('', 174) + padR('', 10)
    );
    totalRegistros += registrosLote;
    resumo.push({ forma: lote.forma, rotulo: ROTULO_FORMA[lote.forma] || lote.forma, qtd: lote.pagamentos.length, total: somaCentavos / 100 });
  });

  linhas.push('341' + '9999' + '9' + padR('', 9) + padL(lotes.length, 6) + padL(totalRegistros, 6) + padR('', 211));

  const errado = linhas.findIndex(l => l.length !== 240);
  if (errado >= 0) throw new Error(`Registro ${errado + 1} do arquivo saiu com ${linhas[errado].length} posições (esperado 240).`);

  // CRLF também depois do ÚLTIMO registro: sem ele o validador do Itaú
  // recusou o trailer de arquivo ("Tamanho do Registro 6 inválido", 1º teste
  // em 2026-11-17) — cada registro tem que ter 240 posições + CRLF.
  return { conteudo: linhas.map(l => l + '\r\n').join(''), lotes: resumo };
}
