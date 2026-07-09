"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Analytics } from "@vercel/analytics/next";
import {
  listarIntegracoesAction, salvarIntegracaoAction,
  montarLoteSalariosAction, salvarLoteAction, listarLotesAction, enviarLoteAoBancoAction,
  listarPdfsContabilidadeAction
} from '../actions/actions-integracao';

// pdf.js e tesseract.js expostos globalmente pelos <Script> abaixo (CDN)
declare global { interface Window { pdfjsLib: any; Tesseract: any; } }

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtMesBR = (m: string) => { const [a, mm] = m.split('-'); return `${mm}/${a}`; };

interface Integracao {
  id: number; parceiro: string; nome_exibicao: string; tipo: string;
  ativo: boolean; ambiente: string; config: any;
}
type FonteLote = 'FOLHA' | 'ADIANTAMENTO' | 'PAGAMENTO' | 'BENEFICIOS';

interface ItemLote {
  funcionario_nome: string; cpf: string; valor: number; metodo: string;
  fonte: FonteLote; fonte_rotulo: string;
  temDoc: boolean; // depende de OCR (adiantamento ou pagamento)
  pix_tipo: string | null; pix_chave: string | null;
  banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null;
  pronto: boolean;
}
interface Lote {
  id: number; parceiro: string; mes_referencia: string; tipo_lote: string;
  nome_lote: string | null;
  qtd_pagamentos: number; valor_total: number; status: string; criado_por: string | null; criado_em: string;
}

const ICONE_TIPO: Record<string, string> = { BANCO: '🏦', BENEFICIO: '🎁', ASSINATURA: '✍️' };

// ==========================================================================
// OCR do holerite da contabilidade (roda no NAVEGADOR do usuário)
// - pdf.js renderiza cada página como imagem (canvas)
// - tesseract.js lê o texto
// - regex procura o valor líquido a receber
// ==========================================================================

// Renderiza a primeira página do PDF (base64) como canvas para OCR
const pdfParaCanvas = async (pdfBase64: string): Promise<HTMLCanvasElement> => {
  const pdfjs = window.pdfjsLib;
  const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  // Escala alta melhora o OCR — 3x ajuda a ler valores pequenos no rodapé
  const viewport = page.getViewport({ scale: 3 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
};

// Fallback por palavra-chave (usado só se a extração por posição falhar).
// NÃO usa "maior valor" — isso pegava o salário base por engano.
const extrairValorLiquido = (texto: string): number | null => {
  const t = texto.toUpperCase().replace(/\s+/g, ' ');
  const chaves = [
    /L[IÍ]QUIDO\s+A\s+RECEBER[^\d]{0,40}([\d.,]+)/,
    /TOTAL\s+L[IÍ]QUIDO[^\d]{0,40}([\d.,]+)/,
    /VALOR\s+L[IÍ]QUIDO[^\d]{0,40}([\d.,]+)/,
    /L[IÍ]QUIDO[^\d]{0,20}([\d.,]+)/
  ];
  for (const rx of chaves) {
    const m = t.match(rx);
    if (m && m[1]) {
      const v = parseValorBR(m[1]);
      if (v !== null && v >= 10) return v;
    }
  }
  return null;
};

// Converte "1.234,56" (formato BR) para número. Retorna null se inválido.
const parseValorBR = (s: string): number | null => {
  const numero = s.replace(/\./g, '').replace(',', '.');
  const v = Number(numero);
  return isNaN(v) ? null : v;
};

// Extrai o valor líquido pela POSIÇÃO na página. O líquido a receber fica no
// canto INFERIOR DIREITO do holerite da contabilidade — diferente do salário
// base, que fica à esquerda. Coleta as palavras que são valores monetários e
// escolhe a que está mais à direita na região inferior da página.
const extrairValorPorPosicao = (data: any, largura: number, altura: number): number | null => {
  // Reúne todas as palavras com bbox (tesseract v5 traz em data.words ou dentro de blocks)
  const palavras: { texto: string; x: number; y: number }[] = [];
  const coletar = (arr: any[]) => {
    (arr || []).forEach(w => {
      if (w?.text && w?.bbox) {
        palavras.push({
          texto: w.text,
          x: (w.bbox.x0 + w.bbox.x1) / 2,
          y: (w.bbox.y0 + w.bbox.y1) / 2
        });
      }
    });
  };
  if (data.words?.length) coletar(data.words);
  if (palavras.length === 0 && data.blocks) {
    // Percorre a hierarquia blocks → paragraphs → lines → words
    data.blocks.forEach((b: any) =>
      b.paragraphs?.forEach((p: any) =>
        p.lines?.forEach((l: any) => coletar(l.words))));
  }
  if (palavras.length === 0) return null;

  // Só valores monetários no formato BR (1.234,56 ou 234,56)
  const rxValor = /^\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
  const candidatos = palavras
    .map(w => { const m = w.texto.match(rxValor); return m ? { valor: parseValorBR(m[1]), x: w.x, y: w.y } : null; })
    .filter((c): c is { valor: number; x: number; y: number } => !!c && c.valor !== null && c.valor >= 10);

  if (candidatos.length === 0) return null;

  // Foca na metade DIREITA e no terço INFERIOR da página (onde fica o líquido).
  // Se não houver candidato nessa região, relaxa para a metade inferior.
  const direita = largura * 0.5;
  let regiao = candidatos.filter(c => c.x >= direita && c.y >= altura * 0.66);
  if (regiao.length === 0) regiao = candidatos.filter(c => c.x >= direita && c.y >= altura * 0.5);
  if (regiao.length === 0) return null;

  // Entre os da região, o líquido é o que está mais ABAIXO (maior y);
  // em empate de linha, o mais à direita.
  regiao.sort((a, b) => (b.y - a.y) || (b.x - a.x));
  return regiao[0].valor;
};

export default function IntegracaoPage() {
  const router = useRouter();
  const [aba, setAba] = useState<'PARCEIROS' | 'PAGAMENTOS'>('PARCEIROS');
  const [usuarioAtual, setUsuarioAtual] = useState('');

  const [integracoes, setIntegracoes] = useState<Integracao[]>([]);
  const [loading, setLoading] = useState(true);

  // Config de parceiro
  const [editParceiro, setEditParceiro] = useState<Integracao | null>(null);
  const [edAtivo, setEdAtivo] = useState(false);
  const [edAmbiente, setEdAmbiente] = useState<'SANDBOX' | 'PRODUCAO'>('SANDBOX');
  const [edAgencia, setEdAgencia] = useState('');
  const [edConta, setEdConta] = useState('');

  // Pagamentos
  const [mesReferencia, setMesReferencia] = useState(() => {
    const h = new Date(); const c = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
  });
  const [itens, setItens] = useState<ItemLote[]>([]);
  const [fontesSel, setFontesSel] = useState<FonteLote[]>(['FOLHA']); // FOLHA marcada por padrão
  const [resumoLote, setResumoLote] = useState({
    semDados: 0, semOcr: 0, valorTotal: 0, totalItens: 0,
    totaisPorFonte: { FOLHA: 0, ADIANTAMENTO: 0, PAGAMENTO: 0, BENEFICIOS: 0 }
  });

  // OCR: valores lidos por tipo (adiantamento e pagamento têm conjuntos separados)
  const [valoresAdiant, setValoresAdiant] = useState<Record<string, number>>({});
  const [valoresPagto, setValoresPagto] = useState<Record<string, number>>({});
  const [ocrRodando, setOcrRodando] = useState(false);
  const [ocrProgresso, setOcrProgresso] = useState({ atual: 0, total: 0, nome: '', tipo: '' as string });
  const [ocrFalhas, setOcrFalhas] = useState<string[]>([]);
  const [ocrDebug, setOcrDebug] = useState<string | null>(null);
  const [montando, setMontando] = useState(false);
  const [salvandoLote, setSalvandoLote] = useState(false);
  const [lotes, setLotes] = useState<Lote[]>([]);

  useEffect(() => {
    try { const raw = localStorage.getItem('rh_usuario'); if (raw) setUsuarioAtual(JSON.parse(raw)?.nome || ''); } catch {}
    carregar();
  }, []);

  const carregar = async () => {
    setLoading(true);
    try {
      const [integ, lotesRes] = await Promise.all([listarIntegracoesAction(), listarLotesAction({})]);
      if (integ.ok) setIntegracoes(integ.info.integracoes);
      if (lotesRes.ok) setLotes(lotesRes.info.lotes);
    } finally { setLoading(false); }
  };

  const abrirConfig = (i: Integracao) => {
    setEditParceiro(i); setEdAtivo(i.ativo); setEdAmbiente(i.ambiente as any);
    setEdAgencia(i.config?.agencia_debito || ''); setEdConta(i.config?.conta_debito || '');
  };

  const salvarConfig = async () => {
    if (!editParceiro) return;
    const res = await salvarIntegracaoAction({
      parceiro: editParceiro.parceiro, ativo: edAtivo, ambiente: edAmbiente,
      config: { ...editParceiro.config, agencia_debito: edAgencia, conta_debito: edConta }
    });
    if (!res.ok) { alert(res.erro); return; }
    setEditParceiro(null);
    carregar();
  };

  const montarLote = async () => {
    if (fontesSel.length === 0) { alert('Selecione ao menos uma fonte de pagamento.'); return; }
    setMontando(true); setItens([]);
    try {
      const res = await montarLoteSalariosAction({
        mesReferencia, fontes: fontesSel,
        valoresAdiantamento: valoresAdiant,
        valoresPagamento: valoresPagto
      });
      if (!res.ok) throw new Error(res.erro);
      setItens(res.info.itens);
      setResumoLote({
        semDados: res.info.semDados,
        semOcr: res.info.semOcr,
        valorTotal: res.info.valorTotal,
        totalItens: res.info.totalItens,
        totaisPorFonte: res.info.totaisPorFonte
      });
    } catch (e: any) { alert(e.message); }
    finally { setMontando(false); }
  };

  // Roda OCR nos PDFs de um tipo específico (ADIANTAMENTO ou HOLERITE_MENSAL)
  const rodarOcrTipo = async (tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL', rotulo: string) => {
    if (!window.pdfjsLib || !window.Tesseract) {
      alert('As bibliotecas de OCR ainda não carregaram. Aguarde uns 5 segundos após abrir a página e tente de novo.');
      return;
    }
    setOcrRodando(true); setOcrFalhas([]); setOcrDebug(null);
    try {
      const res = await listarPdfsContabilidadeAction({ mesReferencia, tipo });
      if (!res.ok) throw new Error(res.erro);
      const pdfs: { funcionario_nome: string; pdfBase64: string }[] = res.info.pdfs;
      if (pdfs.length === 0) {
        alert(`Nenhum PDF de ${rotulo.toLowerCase()} encontrado neste mês.`);
        return;
      }
      setOcrProgresso({ atual: 0, total: pdfs.length, nome: '', tipo: rotulo });

      const anteriores = tipo === 'ADIANTAMENTO' ? valoresAdiant : valoresPagto;
      const novos: Record<string, number> = { ...anteriores };
      const falhas: string[] = [];
      let primeiroTexto = ''; // guarda o texto do 1º PDF para diagnóstico

      // Cria o worker com os caminhos explícitos do CDN (essencial no navegador)
      const worker = await window.Tesseract.createWorker('por', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0'
      });
      try {
        for (let i = 0; i < pdfs.length; i++) {
          const { funcionario_nome, pdfBase64 } = pdfs[i];
          setOcrProgresso({ atual: i + 1, total: pdfs.length, nome: funcionario_nome, tipo: rotulo });
          try {
            const canvas = await pdfParaCanvas(pdfBase64);
            const { data } = await worker.recognize(canvas, {}, { blocks: true });
            if (i === 0) primeiroTexto = data.text || '';
            // Usa a POSIÇÃO das palavras: o líquido fica no canto inferior direito
            const valor = extrairValorPorPosicao(data, canvas.width, canvas.height)
                       ?? extrairValorLiquido(data.text); // fallback por palavra-chave
            if (valor !== null) novos[funcionario_nome] = valor;
            else falhas.push(`${funcionario_nome} (${rotulo})`);
          } catch (errPdf: any) {
            falhas.push(`${funcionario_nome} (${rotulo}): ${errPdf?.message || 'erro'}`);
          }
        }
      } finally {
        await worker.terminate();
      }

      if (tipo === 'ADIANTAMENTO') setValoresAdiant(novos); else setValoresPagto(novos);
      setOcrFalhas(prev => [...prev, ...falhas]);

      // Se TUDO falhou, guarda o texto do 1º PDF para diagnóstico do usuário
      const lidos = Object.keys(novos).length - Object.keys(anteriores).length;
      if (lidos === 0 && primeiroTexto) {
        setOcrDebug(primeiroTexto.slice(0, 800));
      }

      // Remonta o lote com os novos valores
      const res2 = await montarLoteSalariosAction({
        mesReferencia, fontes: fontesSel,
        valoresAdiantamento: tipo === 'ADIANTAMENTO' ? novos : valoresAdiant,
        valoresPagamento: tipo === 'HOLERITE_MENSAL' ? novos : valoresPagto
      });
      if (res2.ok) {
        setItens(res2.info.itens);
        setResumoLote({
          semDados: res2.info.semDados, semOcr: res2.info.semOcr,
          valorTotal: res2.info.valorTotal, totalItens: res2.info.totalItens,
          totaisPorFonte: res2.info.totaisPorFonte
        });
      }
    } catch (e: any) {
      alert('Erro no OCR: ' + e.message);
    } finally {
      setOcrRodando(false);
      setOcrProgresso({ atual: 0, total: 0, nome: '', tipo: '' });
    }
  };

  // Alterna uma fonte selecionada
  const alternarFonte = (f: FonteLote) => {
    setFontesSel(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  };

  // Ajusta valor de uma linha (para fontes com OCR)
  const ajustarValorLinha = (nome: string, fonte: FonteLote, valor: number) => {
    if (fonte === 'ADIANTAMENTO') setValoresAdiant(v => ({ ...v, [nome]: valor }));
    else if (fonte === 'PAGAMENTO') setValoresPagto(v => ({ ...v, [nome]: valor }));
    setItens(prev => prev.map(i => (i.funcionario_nome === nome && i.fonte === fonte)
      ? { ...i, valor, pronto: i.metodo !== 'SEM_DADOS' && valor > 0 } : i));
  };

  const alternarItemFonte = (nome: string, fonte: FonteLote) => {
    setItens(prev => prev.map(i => (i.funcionario_nome === nome && i.fonte === fonte)
      ? { ...i, pronto: i.metodo !== 'SEM_DADOS' && i.valor > 0 ? !i.pronto : false } : i));
  };

  // Edição inline dos valores com máscara BRL
  const [editandoValor, setEditandoValor] = useState<string | null>(null);
  const [textoEdicao, setTextoEdicao] = useState('');
  const parseBRL = (texto: string): number => {
    // Aceita "R$ 3.500,00", "3500", "3500,50", "3.500,50"
    const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
    return Number(limpo) || 0;
  };

  const prontos = itens.filter(i => i.pronto);
  const totalSelecionado = prontos.reduce((s, i) => s + Number(i.valor || 0), 0);

  const gerarLote = async () => {
    if (prontos.length === 0) { alert('Nenhum pagamento pronto para gerar o lote.'); return; }
    const sugestao = `${fontesSel.map(f => ({ FOLHA: 'Folha', ADIANTAMENTO: 'Adiantamento', PAGAMENTO: 'Pagamento', BENEFICIOS: 'Benefícios' }[f])).join(' + ')} ${fmtMesBR(mesReferencia)}`;
    const nome = prompt(`Nome do lote (para identificar no histórico):`, sugestao);
    if (nome === null) return; // cancelou
    setSalvandoLote(true);
    try {
      const res = await salvarLoteAction({
        parceiro: 'ITAU', mesReferencia, tipoLote: fontesSel.join('+'),
        nomeLote: nome || sugestao, itens, criadoPor: usuarioAtual
      });
      if (!res.ok) throw new Error(res.erro);
      alert(`Lote "${nome || sugestao}" gerado: ${res.info.qtd} pagamentos, ${BRL(res.info.valorTotal)}.`);
      setItens([]); carregar();
    } catch (e: any) { alert(e.message); }
    finally { setSalvandoLote(false); }
  };

  const exportarLoteCSV = () => {
    if (prontos.length === 0) { alert('Nenhum pagamento pronto para exportar.'); return; }
    const cab = 'Funcionário;CPF;Fonte;Método;Chave PIX / Conta;Valor';
    const linhas = prontos.map(i => {
      const destino = i.metodo === 'PIX' ? `${i.pix_tipo}: ${i.pix_chave}` : `Ag ${i.banco_agencia} C/C ${i.banco_conta} (${i.banco_codigo})`;
      return `"${i.funcionario_nome}";${i.cpf};"${i.fonte_rotulo}";${i.metodo};"${destino}";${i.valor.toFixed(2).replace('.', ',')}`;
    });
    const csv = '\uFEFF' + [cab, ...linhas, `"TOTAL";;;;;${totalSelecionado.toFixed(2).replace('.', ',')}`].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lote-pagamento-${mesReferencia}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportarCnabItauPix = () => {
    // Filtra apenas pagamentos prontos e que sejam do método PIX.
    // O manual do Itaú exige que lotes de PIX sejam enviados em arquivo separado.
    const pagamentosPix = prontos.filter(i => i.metodo === 'PIX');
    
    if (pagamentosPix.length === 0) {
      alert('Nenhum pagamento via PIX pronto para exportar.');
      return;
    }

    // --- FUNÇÕES DE FORMATAÇÃO CNAB ---
    const padR = (str: string, len: number, char = ' ') => String(str || '').substring(0, len).padEnd(len, char);
    const padL = (str: string | number, len: number, char = '0') => String(str || '').substring(0, len).padStart(len, char);
    const limpaNum = (str: string) => String(str || '').replace(/\D/g, '');
    const formataTexto = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, "");
    
    // Dados da sua empresa (estes campos idealmente viriam do banco/configurações reais)
    // Usaremos os campos de edição ou valores genéricos para não quebrar o layout
    const cnpjEmpresa = padL(limpaNum('22.618.891/0001-87'), 14); // Substitua pelo CNPJ real
    const nomeEmpresa = padR(formataTexto('RENTECH-L E A INFORMATICA LTDA'), 30); // Substitua pelo Nome real
    const agencia = padL(limpaNum(edAgencia || '7480  '), 5);
    const conta = padL(limpaNum(edConta || '09312'), 12);
    const dac = padL('4', 1); // Substitua pelo Dígito da Conta
    
    const hoje = new Date();
    const dataGeracao = padL(hoje.getDate(), 2) + padL(hoje.getMonth() + 1, 2) + hoje.getFullYear();
    const horaGeracao = padL(hoje.getHours(), 2) + padL(hoje.getMinutes(), 2) + padL(hoje.getSeconds(), 2);

    let sequencialRegistro = 1;
    let linhasCnab: string[] = [];

    // --- REGISTRO 0: HEADER DE ARQUIVO ---
    const headerArq = 
      '341' + '0000' + '0' + padR('', 6) + '080' + '2' + cnpjEmpresa + 
      padR('', 20) + agencia + ' ' + conta + ' ' + dac + nomeEmpresa + 
      padR('BANCO ITAU', 30) + padR('', 10) + '1' + dataGeracao + horaGeracao + 
      padL('', 9) + '00000' + padR('', 69);
    linhasCnab.push(headerArq);

    // --- REGISTRO 1: HEADER DE LOTE ---
    // Forma '45' = PIX Transferência | Tipo '30' = Salários
    const headerLote = 
      '341' + '0001' + '1' + 'C' + '30' + '45' + '040' + ' ' + '2' + cnpjEmpresa + 
      padR('1707', 4) + padR('', 16) + agencia + ' ' + conta + ' ' + dac + nomeEmpresa + 
      padR('', 30) + padR('', 10) + padR('', 30) + padL('', 5) + padR('', 15) + 
      padR('', 20) + padL('', 8) + padR('', 2) + padR('', 8) + padR('', 10);
    linhasCnab.push(headerLote);

    let somaValores = 0;

    // --- REGISTROS 3: DETALHES (SEGMENTOS A e B) ---
    pagamentosPix.forEach((item, index) => {
      const valorCentavos = Math.round(item.valor * 100);
      somaValores += valorCentavos;
      
      const numDocStr = padL(limpaNum(item.cpf), 14);
      const nomeFuncionario = padR(formataTexto(item.funcionario_nome), 30);
      const idPagamento = padR(`PGTO${index + 1}`, 20);
      const valorStr = padL(valorCentavos, 15);

      sequencialRegistro++;
      
      // Segmento A (Obrigatório)
      const segA = 
        '341' + '0001' + '3' + padL(sequencialRegistro, 5) + 'A' + '000' + 
        '009' + '000' + padL('', 20) + nomeFuncionario + idPagamento + 
        dataGeracao + '009' + padL('', 8) + '04' + padL('', 5) + valorStr + 
        padR('', 15) + padR('', 5) + padL('', 8) + padL('', 15) + padR('HP01', 20) + 
        padL('', 6) + numDocStr + padR('', 2) + padR('', 5) + padR('', 5) + '0' + padR('', 10);
      linhasCnab.push(segA);

      sequencialRegistro++;

      // Mapeamento do Tipo de Chave PIX (01 a 04)
      const tp = (item.pix_tipo || '').toUpperCase();
      let tipoChavePix = '04'; // Aleatória
      if (tp.includes('TEL') || tp.includes('CEL')) tipoChavePix = '01';
      else if (tp.includes('MAIL')) tipoChavePix = '02';
      else if (tp.includes('CPF') || tp.includes('CNPJ')) tipoChavePix = '03';

      const chavePix = padR(item.pix_chave || '', 100);

      // Segmento B (Obrigatório para modelo Chave PIX)
      const segB = 
        '341' + '0001' + '3' + padL(sequencialRegistro, 5) + 'B' + tipoChavePix + ' ' + 
        '1' + numDocStr + padR('', 30) + padL('', 65) + chavePix + 
        padR('', 3) + padR('', 10);
      linhasCnab.push(segB);
    });

    // --- REGISTRO 5: TRAILER DE LOTE ---
    // Registros no lote: 1 Header + (N pagamentos * 2 segmentos) + 1 Trailer
    const qtdRegistrosLote = padL(2 + (pagamentosPix.length * 2), 6);
    const trailerLote = 
      '341' + '0001' + '5' + padR('', 9) + qtdRegistrosLote + 
      padL(somaValores, 18) + padL('', 18) + padR('', 171) + padR('', 10);
    linhasCnab.push(trailerLote);

    // --- REGISTRO 9: TRAILER DE ARQUIVO ---
    // Registros totais: 1 Header Arq + Lote inteiro + 1 Trailer Arq
    const qtdRegistrosArq = padL(4 + (pagamentosPix.length * 2), 6);
    const trailerArq = 
      '341' + '9999' + '9' + padR('', 9) + '000001' + 
      qtdRegistrosArq + padR('', 211);
    linhasCnab.push(trailerArq);

    // --- DOWNLOAD DO ARQUIVO ---
    const txtFinal = linhasCnab.join('\r\n');
    const blob = new Blob([txtFinal], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; 
    a.download = `SISPAG_PIX_${mesReferencia.replace('-', '')}.txt`; 
    a.click();
    URL.revokeObjectURL(url);
  };

  const enviarLote = async (loteId: number) => {
    const res = await enviarLoteAoBancoAction({ loteId });
    // Nesta versão o envio direto ainda não está ativo — mostra a orientação
    alert(res.erro || (res.ok ? 'Enviado.' : 'Não foi possível enviar.'));
  };

  const badgeStatus = (s: string) => {
    const mapa: Record<string, string> = {
      RASCUNHO: 'bg-gray-100 text-gray-500', GERADO: 'bg-blue-100 text-blue-700',
      ENVIADO: 'bg-amber-100 text-amber-700', PROCESSADO: 'bg-emerald-100 text-emerald-700', ERRO: 'bg-red-100 text-red-700'
    };
    return <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${mapa[s] || 'bg-gray-100 text-gray-500'}`}>{s}</span>;
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />
      {/* Bibliotecas de OCR carregadas via CDN (evita peso no bundle) */}
      <Script
        src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"
        strategy="afterInteractive"
        onLoad={() => {
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
          }
        }}
      />
      <Script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" strategy="afterInteractive" />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          🔗 <strong>Integrações</strong>. Bancos e parceiros para pagamentos e envio de informações.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* Abas */}
        <div className="flex gap-2 mb-6">
          {(['PARCEIROS', 'PAGAMENTOS'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${aba === a ? 'bg-[#0C1D4D] text-white shadow-md' : 'bg-white text-gray-500 border border-[#E2E8F0]'}`}>
              {a === 'PARCEIROS' ? '🔌 Parceiros' : '💸 Pagamentos'}
            </button>
          ))}
        </div>

        {/* ===== ABA PARCEIROS ===== */}
        {aba === 'PARCEIROS' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {loading ? <p className="text-gray-400 font-bold uppercase p-8">Carregando...</p> : integracoes.map(i => (
                <div key={i.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{ICONE_TIPO[i.tipo] || '🔗'}</span>
                      <div>
                        <h3 className="font-black text-[#0C1D4D] uppercase text-sm">{i.nome_exibicao}</h3>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">{i.tipo}</p>
                      </div>
                    </div>
                    <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase ${i.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                      {i.ativo ? '● Ativo' : '○ Inativo'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-black uppercase ${i.ambiente === 'PRODUCAO' ? 'text-red-600' : 'text-amber-600'}`}>
                      {i.ambiente === 'PRODUCAO' ? '🔴 Produção' : '🟡 Sandbox'}
                    </span>
                    <button onClick={() => abrirConfig(i)} className="text-[10px] font-black text-[#0C1D4D] bg-white border border-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">⚙ Configurar</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <p className="text-sm text-amber-800 font-medium">
                🔒 <strong>Segurança das credenciais.</strong> Chaves de API, certificados digitais e segredos dos bancos
                <strong> nunca</strong> devem ser digitados aqui nem guardados no banco de dados. Eles vivem em variáveis de
                ambiente no servidor. Esta tela guarda apenas metadados (agência/conta de débito, ambiente e status).
                A integração direta com a API do Itaú será ativada quando as credenciais homologadas estiverem configuradas.
              </p>
            </div>
          </>
        )}

        {/* ===== ABA PAGAMENTOS ===== */}
        {aba === 'PAGAMENTOS' && (
          <>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4">
              <div className="flex flex-wrap items-end gap-4 mb-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Competência</label>
                  <input type="month" value={mesReferencia} onChange={e => setMesReferencia(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Fontes a incluir no lote</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ['FOLHA', '💼 Nossa folha', 'bg-blue-50 text-blue-700 border-blue-300'],
                      ['ADIANTAMENTO', '📄 Adiantamento', 'bg-purple-50 text-purple-700 border-purple-300'],
                      ['PAGAMENTO', '📄 Pagamento', 'bg-purple-50 text-purple-700 border-purple-300'],
                      ['BENEFICIOS', '🎁 Benefícios', 'bg-emerald-50 text-emerald-700 border-emerald-300']
                    ] as const).map(([f, lbl, cor]) => (
                      <label key={f} className={`cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-[11px] font-black uppercase tracking-wider transition-all ${fontesSel.includes(f) ? cor : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                        <input type="checkbox" checked={fontesSel.includes(f)} onChange={() => alternarFonte(f)} className="w-4 h-4" />
                        {lbl}
                      </label>
                    ))}
                  </div>
                </div>
                <button onClick={montarLote} disabled={montando || fontesSel.length === 0} className="text-xs font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
                  {montando ? '⏳ Montando...' : '📥 Montar lote'}
                </button>
              </div>

              {/* Botões de OCR (só quando a fonte correspondente está selecionada) */}
              {itens.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                  {fontesSel.includes('ADIANTAMENTO') && (
                    <button onClick={() => rodarOcrTipo('ADIANTAMENTO', 'Adiantamento')} disabled={ocrRodando} className="text-[10px] font-black bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                      🔍 OCR Adiantamento
                    </button>
                  )}
                  {fontesSel.includes('PAGAMENTO') && (
                    <button onClick={() => rodarOcrTipo('HOLERITE_MENSAL', 'Pagamento')} disabled={ocrRodando} className="text-[10px] font-black bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                      🔍 OCR Pagamento
                    </button>
                  )}
                  <div className="flex-1" />
                  <button onClick={exportarLoteCSV} className="text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider">⬇ Exportar CSV</button>
                  <button onClick={exportarCnabItauPix} className="text-xs font-black bg-[#ec7000] hover:bg-[#c95f00] text-white px-4 py-2 rounded-lg uppercase tracking-wider">
                    📄 Gerar SISPAG Itaú (PIX)
                  </button>
                  <button onClick={gerarLote} disabled={salvandoLote} className="text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                    {salvandoLote ? '⏳' : '✓ Gerar Lote'}
                  </button>
                </div>
              )}
            </div>

            {/* Barra de progresso do OCR */}
            {ocrRodando && ocrProgresso.total > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 mb-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-black text-purple-800 uppercase">Lendo {ocrProgresso.tipo}: {ocrProgresso.nome}</span>
                  <span className="text-xs font-black text-purple-800">{ocrProgresso.atual}/{ocrProgresso.total}</span>
                </div>
                <div className="w-full bg-purple-100 rounded-full h-2 overflow-hidden">
                  <div className="bg-purple-600 h-2 transition-all" style={{ width: `${(ocrProgresso.atual / ocrProgresso.total) * 100}%` }} />
                </div>
                <p className="text-[10px] text-purple-700 mt-2 font-medium">O OCR roda no seu navegador. Pode levar alguns segundos por PDF.</p>
              </div>
            )}

            {/* Falhas do OCR */}
            {ocrFalhas.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
                <p className="text-xs font-black text-amber-800 uppercase mb-1">⚠ OCR não conseguiu ler {ocrFalhas.length} holerite(s)</p>
                <p className="text-[11px] text-amber-700">{ocrFalhas.join(', ')}. Digite os valores manualmente na coluna "Valor" da tabela abaixo.</p>
              </div>
            )}

            {/* Diagnóstico: texto que o OCR leu do 1º PDF (quando tudo falha) */}
            {ocrDebug && (
              <div className="bg-gray-50 border border-gray-300 rounded-2xl p-4 mb-4">
                <p className="text-xs font-black text-gray-700 uppercase mb-2">🔎 Diagnóstico — texto lido do primeiro holerite</p>
                <p className="text-[11px] text-gray-500 mb-2">Se aparecer texto legível abaixo mas os valores não foram capturados, me mostre este conteúdo. Se estiver vazio ou puro ruído, o PDF pode estar com qualidade baixa para OCR.</p>
                <pre className="text-[10px] bg-white border border-gray-200 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap font-mono text-gray-700">{ocrDebug || '(vazio — o OCR não extraiu nenhum texto)'}</pre>
              </div>
            )}

            {/* Resumo do lote em montagem */}
            {itens.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Linhas prontas</p>
                    <p className="text-2xl font-black text-[#0C1D4D]">{prontos.length}<span className="text-sm text-gray-300">/{itens.length}</span></p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Sem dados / OCR</p>
                    <p className={`text-2xl font-black ${(resumoLote.semDados + resumoLote.semOcr) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{resumoLote.semDados + resumoLote.semOcr}</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total do lote</p>
                    <p className="text-2xl font-black text-indigo-700">{BRL(totalSelecionado)}</p>
                  </div>
                </div>

                {/* Resumo por fonte (só das que estão selecionadas) */}
                <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 mb-4">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Total por fonte</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {fontesSel.map(f => {
                      const rot = { FOLHA: 'Nossa folha', ADIANTAMENTO: 'Adiantamento', PAGAMENTO: 'Pagamento', BENEFICIOS: 'Benefícios' }[f];
                      const cor = f === 'FOLHA' ? 'text-blue-700' : (f === 'ADIANTAMENTO' || f === 'PAGAMENTO') ? 'text-purple-700' : 'text-emerald-700';
                      return (
                        <div key={f}>
                          <span className="text-[10px] font-bold text-gray-400 uppercase">{rot}</span>
                          <p className={`font-black tabular-nums ${cor}`}>{BRL(resumoLote.totaisPorFonte[f])}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden mb-6">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                          <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] w-12">✓</th>
                          <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Funcionário</th>
                          <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Fonte</th>
                          <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Método</th>
                          <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens.map((it, idx) => {
                          const editavel = it.temDoc; // só ADIANTAMENTO/PAGAMENTO são editáveis (vêm de OCR)
                          const semValor = it.valor <= 0;
                          const corFonte = it.fonte === 'FOLHA' ? 'bg-blue-100 text-blue-700'
                            : (it.fonte === 'ADIANTAMENTO' || it.fonte === 'PAGAMENTO') ? 'bg-purple-100 text-purple-700'
                            : 'bg-emerald-100 text-emerald-700';
                          const chaveEdit = `${it.funcionario_nome}::${it.fonte}`;
                          return (
                            <tr key={chaveEdit} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0] ${it.metodo === 'SEM_DADOS' ? 'opacity-60' : ''}`}>
                              <td className="p-3 text-center">
                                <input type="checkbox" checked={it.pronto} disabled={it.metodo === 'SEM_DADOS' || semValor} onChange={() => alternarItemFonte(it.funcionario_nome, it.fonte)} className="w-4 h-4" />
                              </td>
                              <td className="p-3">
                                <span className="font-black text-[#0C1D4D] block">{it.funcionario_nome}</span>
                                <span className="text-[10px] text-gray-400">
                                  {it.metodo === 'SEM_DADOS' ? <span className="text-amber-600 font-black">⚠ Sem dados bancários na ficha</span>
                                    : it.metodo === 'PIX' ? `PIX ${it.pix_tipo}: ${it.pix_chave}`
                                    : `Ag ${it.banco_agencia} · C/C ${it.banco_conta}`}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${corFonte}`}>{it.fonte_rotulo}</span>
                              </td>
                              <td className="p-3">
                                {it.metodo === 'SEM_DADOS'
                                  ? <span className="text-[10px] font-black text-amber-600 uppercase">⚠</span>
                                  : <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${it.metodo === 'PIX' ? 'bg-teal-100 text-teal-700' : 'bg-blue-100 text-blue-700'}`}>{it.metodo}</span>}
                              </td>
                              <td className="p-3 text-right">
                                {editavel ? (
                                  editandoValor === chaveEdit ? (
                                    <input
                                      type="text" autoFocus inputMode="decimal" value={textoEdicao}
                                      onChange={e => setTextoEdicao(e.target.value)}
                                      onBlur={() => { ajustarValorLinha(it.funcionario_nome, it.fonte, parseBRL(textoEdicao)); setEditandoValor(null); setTextoEdicao(''); }}
                                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setEditandoValor(null); setTextoEdicao(''); } }}
                                      className="w-32 p-1.5 border border-purple-400 rounded text-right font-black text-purple-700 tabular-nums bg-white"
                                    />
                                  ) : (
                                    <button
                                      onClick={() => { setEditandoValor(chaveEdit); setTextoEdicao(it.valor.toFixed(2).replace('.', ',')); }}
                                      title={semValor ? 'OCR não leu — clique para digitar' : 'Clique para editar'}
                                      className={`w-32 p-1.5 border rounded text-right font-black tabular-nums bg-white hover:bg-purple-50 ${semValor ? 'border-amber-300 text-amber-600 border-dashed' : 'border-purple-200 text-purple-700'}`}
                                    >
                                      {semValor ? 'Digitar' : BRL(it.valor)}
                                    </button>
                                  )
                                ) : (
                                  <span className="font-black text-[#0C1D4D] tabular-nums">{BRL(it.valor)}</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#F8FAFC] border-t-2 border-[#0C1D4D] font-black">
                          <td colSpan={4} className="p-3 text-[#0C1D4D] uppercase text-[11px]">Total do lote</td>
                          <td className="p-3 text-right tabular-nums text-indigo-700 text-base bg-indigo-100">{BRL(totalSelecionado)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Histórico de lotes */}
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Histórico de lotes</h3>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              {lotes.length === 0 ? (
                <div className="p-12 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum lote gerado ainda.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Data</th>
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Nome do lote</th>
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Competência</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Pagtos</th>
                        <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Total</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Status</th>
                        <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotes.map((l, idx) => (
                        <tr key={l.id} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                          <td className="p-3 text-[11px] text-gray-500">{fmtDataHora(l.criado_em)}</td>
                          <td className="p-3">
                            <span className="font-black text-[#0C1D4D] block">{l.nome_lote || l.tipo_lote}</span>
                            <span className="text-[10px] font-bold text-gray-400 uppercase">{l.parceiro}</span>
                          </td>
                          <td className="p-3 font-bold">{fmtMesBR(l.mes_referencia)}</td>
                          <td className="p-3 text-center font-black text-[#336699]">{l.qtd_pagamentos}</td>
                          <td className="p-3 text-right font-black text-indigo-700 tabular-nums">{BRL(l.valor_total)}</td>
                          <td className="p-3 text-center">{badgeStatus(l.status)}</td>
                          <td className="p-3 text-right">
                            <button onClick={() => enviarLote(l.id)} className="text-[10px] font-black text-[#0C1D4D] bg-white border border-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">↗ Enviar ao banco</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal de configuração de parceiro */}
      {editParceiro && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditParceiro(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{editParceiro.nome_exibicao}</h2>
            <p className="text-[11px] text-gray-400 font-bold uppercase mb-4">{editParceiro.tipo}</p>

            <div className="space-y-4">
              <label className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-xl cursor-pointer">
                <span className="text-xs font-black text-[#0C1D4D] uppercase">Integração ativa</span>
                <input type="checkbox" checked={edAtivo} onChange={e => setEdAtivo(e.target.checked)} className="w-5 h-5" />
              </label>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Ambiente</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['SANDBOX', 'PRODUCAO'] as const).map(amb => (
                    <button key={amb} onClick={() => setEdAmbiente(amb)} className={`p-2.5 rounded-lg text-[11px] font-black uppercase border-2 ${edAmbiente === amb ? (amb === 'PRODUCAO' ? 'border-red-400 bg-red-50 text-red-600' : 'border-amber-400 bg-amber-50 text-amber-600') : 'border-gray-200 text-gray-400'}`}>
                      {amb === 'SANDBOX' ? '🟡 Sandbox' : '🔴 Produção'}
                    </button>
                  ))}
                </div>
              </div>

              {editParceiro.tipo === 'BANCO' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Agência débito</label>
                    <input type="text" value={edAgencia} onChange={e => setEdAgencia(e.target.value)} placeholder="0000" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Conta débito</label>
                    <input type="text" value={edConta} onChange={e => setEdConta(e.target.value)} placeholder="00000-0" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                  </div>
                </div>
              )}

              <p className="text-[10px] text-gray-400 font-medium bg-gray-50 rounded-lg p-3">
                🔒 Certificado e chaves de API não são inseridos aqui — ficam no servidor. Esta config guarda só dados não sensíveis.
              </p>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditParceiro(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarConfig} className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}