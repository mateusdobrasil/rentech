"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import {
  montarLoteSalariosAction, salvarLoteAction, listarLotesAction, enviarLoteAoBancoAction,
  listarPdfsContabilidadeAction, processarOcrAwsAction
} from '../actions/actions-financeiro';
import { listarIntegracoesAction } from '../../integracao/actions';

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  if (p.includes('GESTOR')) return 'GESTORES';
  return 'USUARIO';
};

// Contas bancárias no sistema são salvas como "12345-6" (número-DAC). O CNAB
// exige o dígito verificador em campo separado do número da conta.
const separarContaDac = (contaComDac: string | null | undefined): { conta: string; dac: string } => {
  const [conta, dac] = String(contaComDac || '').split('-');
  return { conta: conta || '', dac: dac || '' };
};

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
  temDoc: boolean;
  origem: string | null;
  pix_tipo: string | null; pix_chave: string | null;
  banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null;
  pronto: boolean;
}
interface Lote {
  id: number; parceiro: string; mes_referencia: string; tipo_lote: string;
  nome_lote: string | null;
  qtd_pagamentos: number; valor_total: number; status: string; criado_por: string | null; criado_em: string;
}

export default function FinanceiroPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [emailUsuario, setEmailUsuario] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  const [integracoes, setIntegracoes] = useState<Integracao[]>([]);

  // Data em que o lote deve ser efetivamente pago (usada no CNAB, separada da
  // data de geração do arquivo — permite gerar o arquivo com antecedência).
  const [dataPagamento, setDataPagamento] = useState(() => new Date().toISOString().slice(0, 10));

  const [mesReferencia, setMesReferencia] = useState(() => {
    const h = new Date(); const c = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
  });
  const [itens, setItens] = useState<ItemLote[]>([]);
  const [fontesSel, setFontesSel] = useState<FonteLote[]>(['FOLHA']);
  const [resumoLote, setResumoLote] = useState({
    semDados: 0, semOcr: 0, valorTotal: 0, totalItens: 0,
    totaisPorFonte: { FOLHA: 0, ADIANTAMENTO: 0, PAGAMENTO: 0, BENEFICIOS: 0 }
  });

  const [valoresAdiant, setValoresAdiant] = useState<Record<string, number>>({});
  const [valoresPagto, setValoresPagto] = useState<Record<string, number>>({});
  const [ocrRodando, setOcrRodando] = useState(false);
  const [ocrProgresso, setOcrProgresso] = useState({ atual: 0, total: 0, nome: '', tipo: '' as string });
  const [ocrFalhas, setOcrFalhas] = useState<string[]>([]);
  const [ocrDebug, setOcrDebug] = useState<string | null>(null);
  const [montando, setMontando] = useState(false);
  const [salvandoLote, setSalvandoLote] = useState(false);
  const [lotes, setLotes] = useState<Lote[]>([]);

  // Valida a sessão e a permissão (dinâmica, via banco) antes de liberar a página
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (perfilError || !perfil) {
        console.error("Erro crítico ao buscar perfil do usuário:", perfilError);
        router.push('/login');
        return;
      }

      // Consulta no banco de dados quem pode aceder a esta rota
      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      // Normaliza o perfil logado e verifica contra o banco
      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      // Aprovado
      setUsuarioAtual(perfil.nome || 'Equipe RH');
      setEmailUsuario(perfil.email || session.user.email || '');
      setAuthLoading(false);
      carregar();
    }
    checkAuth();
  }, [router, pathname]);

  const carregar = async () => {
    const [lotesRes, integRes] = await Promise.all([
      listarLotesAction({}),
      listarIntegracoesAction()
    ]);
    if (lotesRes.ok) setLotes(lotesRes.info.lotes);
    if (integRes.ok) setIntegracoes(integRes.info.integracoes);
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
      if (res.info.itens.length === 0 && res.info._debug) {
        alert(`Nenhum funcionário encontrado no grid.`);
      }
    } catch (e: any) { alert(e.message); }
    finally { setMontando(false); }
  };

  // Nova função de OCR operando 100% via Backend (AWS Textract)
  const rodarOcrTipo = async (tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL', rotulo: string) => {
    setOcrRodando(true);
    setOcrFalhas([]);
    setOcrDebug(null);

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
      let primeiroTexto = '';

      for (let i = 0; i < pdfs.length; i++) {
        const { funcionario_nome, pdfBase64 } = pdfs[i];
        setOcrProgresso({ atual: i + 1, total: pdfs.length, nome: funcionario_nome, tipo: rotulo });

        try {
          // Chamada para a Server Action conectada à AWS Textract
          const respostaAws = await processarOcrAwsAction(pdfBase64, tipo);

          if (i === 0 && respostaAws._textoLido) {
            primeiroTexto = `[VALOR CAPTURADO: ${respostaAws.valor ?? 'nenhum'}]\n\n${respostaAws._textoLido}`;
          }

          if (respostaAws.ok && respostaAws.valor) {
            novos[funcionario_nome] = respostaAws.valor;
          } else {
            falhas.push(`${funcionario_nome} (${rotulo}): ${respostaAws.erro}`);
          }
        } catch (errReq: any) {
          falhas.push(`${funcionario_nome} (${rotulo}): Falha de conexão.`);
        }
      }

      if (tipo === 'ADIANTAMENTO') setValoresAdiant(novos); else setValoresPagto(novos);
      setOcrFalhas(prev => [...prev, ...falhas]);
      if (primeiroTexto) setOcrDebug(primeiroTexto);

      // Remonta a tabela com os novos valores
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
      alert('Erro na operação de leitura: ' + e.message);
    } finally {
      setOcrRodando(false);
      setOcrProgresso({ atual: 0, total: 0, nome: '', tipo: '' });
    }
  };

  const alternarFonte = (f: FonteLote) => {
    setFontesSel(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  };

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

  const parseBRL = (texto: string): number => {
    const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
    return Number(limpo) || 0;
  };

  const [editandoValor, setEditandoValor] = useState<string | null>(null);
  const [textoEdicao, setTextoEdicao] = useState('');

  const prontos = itens.filter(i => i.pronto);
  const totalSelecionado = prontos.reduce((s, i) => s + Number(i.valor || 0), 0);

  const gerarLote = async () => {
    if (prontos.length === 0) { alert('Nenhum pagamento pronto para gerar o lote.'); return; }
    const sugestao = `${fontesSel.map(f => ({ FOLHA: 'Folha', ADIANTAMENTO: 'Adiantamento', PAGAMENTO: 'Pagamento', BENEFICIOS: 'Benefícios' }[f])).join(' + ')} ${fmtMesBR(mesReferencia)}`;
    const nome = prompt(`Nome do lote (para identificar no histórico):`, sugestao);
    if (nome === null) return;
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
    const csv = '﻿' + [cab, ...linhas, `"TOTAL";;;;;${totalSelecionado.toFixed(2).replace('.', ',')}`].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lote-pagamento-${mesReferencia}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportarCnabItauPix = () => {
    const pagamentosPix = prontos.filter(i => i.metodo === 'PIX');

    if (pagamentosPix.length === 0) {
      alert('Nenhum pagamento via PIX pronto para exportar.');
      return;
    }

    // Dados da empresa/conta vêm da configuração salva do parceiro ITAU
    // (Integrações → ⚙ Configurar). Sem fallback silencioso: se algo
    // essencial não estiver configurado, o arquivo não é gerado.
    const itauIntegracao = integracoes.find(i => i.parceiro === 'ITAU');
    const cfg = itauIntegracao?.config || {};
    const camposFaltando = (['cnpj', 'razao_social', 'agencia_debito', 'conta_debito'] as const)
      .filter(campo => !String(cfg[campo] || '').trim());

    if (camposFaltando.length > 0) {
      alert(`Configure primeiro (tela Integrações → ⚙ Configurar Itaú): ${camposFaltando.join(', ')}.`);
      return;
    }

    const padR = (str: string, len: number, char = ' ') => String(str || '').substring(0, len).padEnd(len, char);
    const padL = (str: string | number, len: number, char = '0') => String(str || '').substring(0, len).padStart(len, char);
    const limpaNum = (str: string) => String(str || '').replace(/\D/g, '');
    const formataTexto = (str: string) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, "");

    const cnpjEmpresa = padL(limpaNum(cfg.cnpj), 14);
    const nomeEmpresa = padR(formataTexto(cfg.razao_social), 30);
    const agencia = padL(limpaNum(cfg.agencia_debito), 5);
    const contaDebitoSep = separarContaDac(cfg.conta_debito);
    const conta = padL(limpaNum(contaDebitoSep.conta), 12);
    const dac = padL(limpaNum(contaDebitoSep.dac) || '0', 1);

    const hoje = new Date();
    const dataGeracao = padL(hoje.getDate(), 2) + padL(hoje.getMonth() + 1, 2) + hoje.getFullYear();
    const horaGeracao = padL(hoje.getHours(), 2) + padL(hoje.getMinutes(), 2) + padL(hoje.getSeconds(), 2);

    // Data de pagamento é escolhida pelo usuário (pode ser diferente do dia
    // de geração do arquivo, ex.: gerar hoje para pagar daqui a alguns dias).
    const [anoPag, mesPag, diaPag] = dataPagamento.split('-').map(Number);
    const dataPagamentoStr = padL(diaPag, 2) + padL(mesPag, 2) + String(anoPag);

    let sequencialRegistro = 1;
    let linhasCnab: string[] = [];

    // Header de Arquivo: posições 15-17 ("080") são o Nº da Versão do Layout
    // do Arquivo exigido pelo manual SISPAG — não são espaço em branco.
    const headerArq =
      '341' + '0000' + '0' + padR('', 6) + '080' + '2' + cnpjEmpresa +
      padR('', 20) + agencia + ' ' + conta + ' ' + dac + nomeEmpresa +
      padR('BANCO ITAU', 30) + padR('', 10) + '1' + dataGeracao + horaGeracao +
      padL('', 9) + '00000' + padR('', 69);
    linhasCnab.push(headerArq);

    // Header de Lote: posições 33-36 ("1707") ativam o "histórico variável"
    // (Nota 13 do manual) — sem esse código o extrato do favorecido mostra
    // apenas "REMUNERAÇÃO/SALÁRIO" em vez do código informado no Segmento A.
    const headerLote =
      '341' + '0001' + '1' + 'C' + '30' + '45' + '040' + ' ' + '2' + cnpjEmpresa +
      padR('1707', 4) + padR('', 16) + agencia + ' ' + conta + ' ' + dac + nomeEmpresa +
      padR('', 30) + padR('', 10) + padR('', 30) + padL('', 5) + padR('', 15) +
      padR('', 20) + padL('', 8) + padR('', 2) + padR('', 8) + padR('', 10);
    linhasCnab.push(headerLote);

    let somaValores = 0;

    pagamentosPix.forEach((item, index) => {
      const valorCentavos = Math.round(item.valor * 100);
      somaValores += valorCentavos;

      const numDocStr = padL(limpaNum(item.cpf), 14);
      const nomeFuncionario = padR(formataTexto(item.funcionario_nome), 30);
      const idPagamento = padR(`PGTO${index + 1}`, 20);
      const valorStr = padL(valorCentavos, 15);

      sequencialRegistro++;

      // Segmento A: posição 113-114 ("04") = Identificação do Tipo de
      // Transferência = Chave de Endereçamento (Nota 36) — é o que diz ao
      // Itaú para rotear o PIX pela chave informada no Segmento B. Posição
      // 178-181 ("HP01") = código de Histórico Variável "PAGTO SALÁRIO"
      // (Nota 13), só tem efeito documentado com o "1707" do Header de Lote.
      const segA =
        '341' + '0001' + '3' + padL(sequencialRegistro, 5) + 'A' + '000' +
        '009' + '000' + padL('', 20) + nomeFuncionario + idPagamento +
        dataPagamentoStr + '009' + padL('', 8) + '04' + padL('', 5) + valorStr +
        padR('', 15) + padR('', 5) + padL('', 8) + padL('', 15) + padR('HP01', 20) +
        padL('', 6) + numDocStr + padR('', 2) + padR('', 5) + padR('', 5) + '0' + padR('', 10);
      linhasCnab.push(segA);

      sequencialRegistro++;

      const tp = (item.pix_tipo || '').toUpperCase();
      let tipoChavePix = '04';
      if (tp.includes('TEL') || tp.includes('CEL')) tipoChavePix = '01';
      else if (tp.includes('MAIL')) tipoChavePix = '02';
      else if (tp.includes('CPF') || tp.includes('CNPJ')) tipoChavePix = '03';

      const chavePix = padR(item.pix_chave || '', 100);

      const segB =
        '341' + '0001' + '3' + padL(sequencialRegistro, 5) + 'B' + tipoChavePix + ' ' +
        '1' + numDocStr + padR('', 30) + padL('', 65) + chavePix +
        padR('', 3) + padR('', 10);
      linhasCnab.push(segB);
    });

    const qtdRegistrosLote = padL(2 + (pagamentosPix.length * 2), 6);
    const trailerLote =
      '341' + '0001' + '5' + padR('', 9) + qtdRegistrosLote +
      padL(somaValores, 18) + padL('', 18) + padR('', 171) + padR('', 10);
    linhasCnab.push(trailerLote);

    const qtdRegistrosArq = padL(4 + (pagamentosPix.length * 2), 6);
    const trailerArq =
      '341' + '9999' + '9' + padR('', 9) + '000001' +
      qtdRegistrosArq + padR('', 211);
    linhasCnab.push(trailerArq);

    const txtFinal = linhasCnab.join('\r\n');
    const blob = new Blob([txtFinal], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SISPAG_PIX_${mesReferencia.replace('-', '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Gera o SISPAG de quem tem conta bancária cadastrada (em vez de chave PIX).
  // O Itaú exige que PIX venha em arquivo separado das demais formas, por
  // isso este é um arquivo distinto do exportarCnabItauPix. Dentro dele, cada
  // forma de pagamento vai em um lote próprio: lote 1 = crédito em conta
  // corrente no próprio Itaú (forma 01), lote 2 = TED para outro titular em
  // outro banco (forma 41) — a Nota 5 do manual exige negociação prévia com o
  // Itaú para liberar TED de salário; sem isso o lote 2 será rejeitado.
  const exportarCnabContaCorrenteTed = () => {
    const pagamentosConta = prontos.filter(i => i.metodo === 'TED');

    if (pagamentosConta.length === 0) {
      alert('Nenhum pagamento via conta bancária pronto para exportar.');
      return;
    }

    const itauIntegracao = integracoes.find(i => i.parceiro === 'ITAU');
    const cfg = itauIntegracao?.config || {};
    const camposFaltando = (['cnpj', 'razao_social', 'agencia_debito', 'conta_debito'] as const)
      .filter(campo => !String(cfg[campo] || '').trim());

    if (camposFaltando.length > 0) {
      alert(`Configure primeiro (tela Integrações → ⚙ Configurar Itaú): ${camposFaltando.join(', ')}.`);
      return;
    }

    const padR = (str: string, len: number, char = ' ') => String(str || '').substring(0, len).padEnd(len, char);
    const padL = (str: string | number, len: number, char = '0') => String(str || '').substring(0, len).padStart(len, char);
    const limpaNum = (str: string) => String(str || '').replace(/\D/g, '');
    const formataTexto = (str: string) => str.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, "");

    const cnpjEmpresa = padL(limpaNum(cfg.cnpj), 14);
    const nomeEmpresa = padR(formataTexto(cfg.razao_social), 30);
    const agenciaDebito = padL(limpaNum(cfg.agencia_debito), 5);
    const contaDebitoSep = separarContaDac(cfg.conta_debito);
    const contaDebito = padL(limpaNum(contaDebitoSep.conta), 12);
    const dacDebito = padL(limpaNum(contaDebitoSep.dac) || '0', 1);

    const hoje = new Date();
    const dataGeracao = padL(hoje.getDate(), 2) + padL(hoje.getMonth() + 1, 2) + hoje.getFullYear();
    const horaGeracao = padL(hoje.getHours(), 2) + padL(hoje.getMinutes(), 2) + padL(hoje.getSeconds(), 2);
    const [anoPag, mesPag, diaPag] = dataPagamento.split('-').map(Number);
    const dataPagamentoStr = padL(diaPag, 2) + padL(mesPag, 2) + String(anoPag);

    const itensItau = pagamentosConta.filter(i => limpaNum(i.banco_codigo || '') === '341');
    const itensOutrosBancos = pagamentosConta.filter(i => limpaNum(i.banco_codigo || '') !== '341');

    const linhasCnab: string[] = [];
    let numeroLote = 0;
    let totalRegistrosArquivo = 2; // header + trailer de arquivo

    const headerArq =
      '341' + '0000' + '0' + padR('', 6) + '080' + '2' + cnpjEmpresa +
      padR('', 20) + agenciaDebito + ' ' + contaDebito + ' ' + dacDebito + nomeEmpresa +
      padR('BANCO ITAU', 30) + padR('', 10) + '1' + dataGeracao + horaGeracao +
      padL('', 9) + '00000' + padR('', 69);
    linhasCnab.push(headerArq);

    // usaHistoricoVariavel: a Nota 13 só documenta o código "1707"/"HP01"
    // para as formas 01 e 60 — por isso só aplicamos no lote da conta Itaú.
    const montarLote = (formaPagamento: string, itens: typeof pagamentosConta, usaHistoricoVariavel: boolean) => {
      if (itens.length === 0) return;
      numeroLote++;
      const codLote = padL(numeroLote, 4);

      const headerLote =
        '341' + codLote + '1' + 'C' + '30' + formaPagamento + '040' + ' ' + '2' + cnpjEmpresa +
        (usaHistoricoVariavel ? padR('1707', 4) : padR('', 4)) + padR('', 16) +
        agenciaDebito + ' ' + contaDebito + ' ' + dacDebito + nomeEmpresa +
        padR('', 30) + padR('', 10) + padR('', 30) + padL('', 5) + padR('', 15) +
        padR('', 20) + padL('', 8) + padR('', 2) + padR('', 8) + padR('', 10);
      linhasCnab.push(headerLote);

      let somaValores = 0;
      let seq = 0;

      itens.forEach((item, index) => {
        const valorCentavos = Math.round(item.valor * 100);
        somaValores += valorCentavos;

        const numDocStr = padL(limpaNum(item.cpf), 14);
        const nomeFuncionario = padR(formataTexto(item.funcionario_nome), 30);
        const idPagamento = padR(`PGTO${index + 1}`, 20);
        const valorStr = padL(valorCentavos, 15);
        const bancoFavorecido = padL(limpaNum(item.banco_codigo || ''), 3);
        const contaFavorecidoSep = separarContaDac(item.banco_conta);

        // Nota 11 do manual: para favorecido no próprio Itaú (341) a conta
        // usa 6 dígitos; para outros bancos, 12 dígitos — layouts diferentes.
        const ehFavorecidoItau = limpaNum(item.banco_codigo || '') === '341';
        const agenciaContaFavorecido = ehFavorecidoItau
          ? '0' + padL(limpaNum(item.banco_agencia || ''), 4) + ' ' +
            padL('', 6) + padL(limpaNum(contaFavorecidoSep.conta), 6) + ' ' +
            padL(limpaNum(contaFavorecidoSep.dac) || '0', 1)
          : padL(limpaNum(item.banco_agencia || ''), 5) + ' ' +
            padL(limpaNum(contaFavorecidoSep.conta), 12) + ' ' +
            padL(limpaNum(contaFavorecidoSep.dac) || '0', 1);

        seq++;
        const segA =
          '341' + codLote + '3' + padL(seq, 5) + 'A' + '000' +
          '000' + bancoFavorecido + agenciaContaFavorecido + nomeFuncionario + idPagamento +
          dataPagamentoStr + '009' + padL('', 8) + padL('', 2) + padL('', 5) + valorStr +
          padR('', 15) + padR('', 5) + padL('', 8) + padL('', 15) +
          (usaHistoricoVariavel ? padR('HP01', 20) : padR('', 20)) +
          padL('', 6) + numDocStr + padR('', 2) + padR('', 5) + padR('', 5) + '0' + padR('', 10);
        linhasCnab.push(segA);
      });

      const qtdRegistrosLote = padL(2 + itens.length, 6);
      const trailerLote =
        '341' + codLote + '5' + padR('', 9) + qtdRegistrosLote +
        padL(somaValores, 18) + padL('', 18) + padR('', 171) + padR('', 10);
      linhasCnab.push(trailerLote);

      totalRegistrosArquivo += 2 + itens.length;
    };

    montarLote('01', itensItau, true);
    montarLote('41', itensOutrosBancos, false);

    const trailerArq =
      '341' + '9999' + '9' + padR('', 9) + padL(numeroLote, 6) +
      padL(totalRegistrosArquivo, 6) + padR('', 211);
    linhasCnab.push(trailerArq);

    const txtFinal = linhasCnab.join('\r\n');
    const blob = new Blob([txtFinal], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SISPAG_CC_TED_${mesReferencia.replace('-', '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const enviarLote = async (loteId: number) => {
    const res = await enviarLoteAoBancoAction({ loteId });
    alert(res.erro || (res.ok ? 'Enviado.' : 'Não foi possível enviar.'));
  };

  const badgeStatus = (s: string) => {
    const mapa: Record<string, string> = {
      RASCUNHO: 'bg-gray-100 text-gray-500',
      GERADO: 'bg-blue-100 text-blue-700',
      ENVIADO: 'bg-amber-100 text-amber-700',
      PROCESSADO: 'bg-emerald-100 text-emerald-700',
      ERRO: 'bg-slate-100 text-slate-700'
    };
    return <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${mapa[s] || 'bg-gray-100 text-gray-500'}`}>{s}</span>;
  };

  // Enquanto valida a sessão, mostra um estado de carregamento (evita piscar a
  // página antes da checagem de permissão)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <p className="text-[#64748B] font-bold text-sm uppercase tracking-wider">Validando acesso...</p>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Financeiro.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          💸 <strong>Financeiro</strong>. Lotes de pagamento, OCR de comprovantes e arquivos bancários (CNAB).
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
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

          {itens.length > 0 && (
            <div className="pt-3 border-t border-gray-100 space-y-4">
              {(fontesSel.includes('ADIANTAMENTO') || fontesSel.includes('PAGAMENTO')) && (
                <div className="flex flex-wrap gap-2">
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
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data de pagamento</label>
                  <input type="date" value={dataPagamento} onChange={e => setDataPagamento(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]" />
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={exportarLoteCSV} className="text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">⬇ Exportar CSV</button>
                  <button onClick={gerarLote} disabled={salvandoLote} className="text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
                    {salvandoLote ? '⏳ Gerando...' : '✓ Gerar Lote'}
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={exportarCnabItauPix} className="text-xs font-black bg-[#ec7000] hover:bg-[#c95f00] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">📄 SISPAG Itaú (PIX)</button>
                  <button onClick={exportarCnabContaCorrenteTed} className="text-xs font-black bg-[#0369A1] hover:bg-[#025688] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">📄 SISPAG Itaú (Conta/TED)</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {ocrRodando && ocrProgresso.total > 0 && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-black text-purple-800 uppercase">Lendo {ocrProgresso.tipo} na AWS: {ocrProgresso.nome}</span>
              <span className="text-xs font-black text-purple-800">{ocrProgresso.atual}/{ocrProgresso.total}</span>
            </div>
            <div className="w-full bg-purple-100 rounded-full h-2 overflow-hidden">
              <div className="bg-purple-600 h-2 transition-all" style={{ width: `${(ocrProgresso.atual / ocrProgresso.total) * 100}%` }} />
            </div>
          </div>
        )}

        {ocrFalhas.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
            <p className="text-xs font-black text-amber-800 uppercase mb-1">⚠ OCR não conseguiu ler {ocrFalhas.length} holerite(s)</p>
            <p className="text-[11px] text-amber-700">{ocrFalhas.join(', ')}. Digite os valores manualmente na coluna "Valor" da tabela abaixo.</p>
          </div>
        )}

        {ocrDebug && (
          <div className="bg-gray-50 border border-gray-300 rounded-2xl p-4 mb-4">
            <p className="text-xs font-black text-gray-700 uppercase mb-2">🔎 Diagnóstico — texto lido da AWS no primeiro documento</p>
            <pre className="text-[10px] bg-white border border-gray-200 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap font-mono text-gray-700">{ocrDebug || '(vazio)'}</pre>
          </div>
        )}

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
                <p className="text-2xl font-black text-[#0C1D4D]">{BRL(totalSelecionado)}</p>
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
                      const editavel = it.temDoc;
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
                            {it.origem && <span className="ml-1 text-[9px] font-bold text-gray-400 uppercase">{it.origem === 'FICHA' ? '📋 ficha' : '🔍 ocr'}</span>}
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
                                  onBlur={() => { ajustarValorLinha(it.funcionario_nome, it.fonte, parseBRL(textoEdicao) || 0); setEditandoValor(null); setTextoEdicao(''); }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setEditandoValor(null); setTextoEdicao(''); } }}
                                  className="w-32 p-1.5 border border-purple-400 rounded text-right font-black text-purple-700 tabular-nums bg-white"
                                />
                              ) : (
                                <button
                                  onClick={() => { setEditandoValor(chaveEdit); setTextoEdicao(it.valor.toFixed(2).replace('.', ',')); }}
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
                      <td className="p-3 text-right tabular-nums text-[#0C1D4D] text-base bg-blue-50">{BRL(totalSelecionado)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}

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
                      <td className="p-3 text-center font-black text-[#0C1D4D]">{l.qtd_pagamentos}</td>
                      <td className="p-3 text-right font-black text-[#0C1D4D] tabular-nums">{BRL(l.valor_total)}</td>
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
      </div>
    </div>
  );
}
