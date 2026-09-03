"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import {
  montarLoteSalariosAction, salvarLoteAction, listarLotesAction, enviarLoteAoBancoAction,
  listarPdfsContabilidadeAction, processarOcrAwsAction, alternarAtivoLoteAction, buscarLoteAction,
  consultarStatusAtualItauAction, buscarDetalhesOPAction, salvarValorOcrManualAction
} from '../../rh/actions/actions-financeiro';
import { listarIntegracoesAction } from '../../parametros/integracao/actions';
import { normalizarItensOP, ItemOPNormalizado } from '../../op/utils';
import SepararHolerites from '../../rh/holerite/SepararHolerites';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { ehAdministradorGlobal } from '../../../lib/permissoes';

// Contas bancárias no sistema são salvas como "12345-6" (número-DAC). O CNAB
// exige o dígito verificador em campo separado do número da conta.
const separarContaDac = (contaComDac: string | null | undefined): { conta: string; dac: string } => {
  const [conta, dac] = String(contaComDac || '').split('-');
  return { conta: conta || '', dac: dac || '' };
};

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtMesBR = (m: string) => { const [a, mm] = m.split('-'); return `${mm}/${a}`; };
// Espelha STATUS_PIX_SUCESSO em actions-financeiro.ts — itens já pagos com
// sucesso via API (PIX por chave OU por dados bancários, ambos passam pelo
// mesmo "Enviar ao banco") não podem entrar nos exports CNAB manuais, senão
// pagam em dobro.
const STATUS_JA_PAGO_VIA_API = ['Sucesso', 'Sucesso (pre-autorizado)'];

interface Integracao {
  id: number; parceiro: string; nome_exibicao: string; tipo: string;
  ativo: boolean; ambiente: string; config: any;
}
type FonteLote = 'FOLHA' | 'ADIANTAMENTO' | 'PAGAMENTO' | 'BENEFICIOS' | 'DECIMO_TERCEIRO' | 'FERIAS' | 'RESCISAO' | 'OP';

interface ItemLote {
  funcionario_nome: string; cpf: string; empresa_id: number | null; valor: number; metodo: string;
  fonte: FonteLote; fonte_rotulo: string;
  temDoc: boolean;
  origem: string | null;
  rescisaoId: number | null;
  opId: string | null;
  // Só preenchido pelas OPs sem Pix (BOLETO/TRANSFERÊNCIA/DINHEIRO) — o que
  // foi digitado na OP, exibido no lugar do aviso genérico de "sem dados
  // bancários" já que não há como pagar/exportar isso automaticamente.
  nota: string | null;
  // Só preenchido nos itens de OP (= data_vencimento da própria OP) — usado
  // no lugar da "Data de pagamento" digitada nesta tela, tanto no envio via
  // API (enviarLoteAoBancoAction) quanto na exportação CNAB. Demais fontes
  // ficam null e usam a data digitada, como sempre.
  dataPagamento: string | null;
  pix_tipo: string | null; pix_chave: string | null;
  banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null;
  pronto: boolean;
  // Preenchidos por enviarLoteAoBancoAction após a chamada à API do Itaú
  // (app/lib/itauSispag.ts) — ausentes até o item ser realmente enviado.
  api_status?: string | null;
  api_cod_pagamento?: string | null;
  api_numero_lote?: string | null;
  api_motivo_recusa?: { codigo?: string; nome?: string }[] | null;
  api_erro?: string | null;
  api_enviado_em?: string | null;
  api_resposta_bruta?: any;
}
interface Lote {
  id: number; parceiro: string; mes_referencia: string; tipo_lote: string;
  nome_lote: string | null;
  data_pagamento: string | null;
  empresa_id: number | null;
  qtd_pagamentos: number; valor_total: number; status: string; ativo: boolean; criado_por: string | null; criado_em: string;
}

export default function FinanceiroPage() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken, permissaoBruta } = usePageAccess({ nomeFallback: 'Equipe RH' });
  const toast = useToast();

  const [integracoes, setIntegracoes] = useState<Integracao[]>([]);

  // Empresa (Rentech × AlfaLight) escolhida ANTES de montar o lote — igual ao
  // padrão de /admin/op/nova: trava sozinha se o usuário só tem acesso a uma;
  // se tem a mais de uma, precisa escolher antes de montar. Revalidada no
  // servidor em montarLoteSalariosAction, nunca só filtro de exibição.
  const [empresaSelecionada, setEmpresaSelecionada] = useState<number | null>(null);
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);

  // Data em que o lote deve ser efetivamente pago (usada no CNAB, separada da
  // data de geração do arquivo — permite gerar o arquivo com antecedência).
  const [dataPagamento, setDataPagamento] = useState(() => new Date().toISOString().slice(0, 10));

  const [mesReferencia, setMesReferencia] = useState(() => {
    const h = new Date(); const c = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
  });
  const [itens, setItens] = useState<ItemLote[]>([]);
  const [fontesSel, setFontesSel] = useState<FonteLote[]>([]);
  const [resumoLote, setResumoLote] = useState({
    semDados: 0, semOcr: 0, valorTotal: 0, totalItens: 0,
    totaisPorFonte: { FOLHA: 0, ADIANTAMENTO: 0, PAGAMENTO: 0, BENEFICIOS: 0, DECIMO_TERCEIRO: 0, FERIAS: 0, RESCISAO: 0, OP: 0 }
  });

  const [valoresAdiant, setValoresAdiant] = useState<Record<string, number>>({});
  const [valoresPagto, setValoresPagto] = useState<Record<string, number>>({});
  const [valoresDecimoTerceiro, setValoresDecimoTerceiro] = useState<Record<string, number>>({});
  const [valoresFerias, setValoresFerias] = useState<Record<string, number>>({});
  const [ocrRodando, setOcrRodando] = useState(false);
  const [ocrProgresso, setOcrProgresso] = useState({ atual: 0, total: 0, nome: '', tipo: '' as string });
  const [ocrFalhas, setOcrFalhas] = useState<string[]>([]);
  const [ocrDebug, setOcrDebug] = useState<string | null>(null);
  const [montando, setMontando] = useState(false);
  const [salvandoLote, setSalvandoLote] = useState(false);
  const [lotes, setLotes] = useState<Lote[]>([]);
  // Lote do histórico reaberto só pra exportar de novo (não é um lote sendo
  // montado do zero) — enquanto ativo, esconde os controles de montagem/OCR/
  // Gerar Lote pra não criar um lote duplicado sem querer.
  const [loteReaberto, setLoteReaberto] = useState<{ id: number; nome: string } | null>(null);
  const [abrindoLote, setAbrindoLote] = useState<number | null>(null);
  const [enviandoLoteId, setEnviandoLoteId] = useState<number | null>(null);

  // Separação dos holerites da contabilidade — mesma tela usada em
  // /admin/rh/ponto (componente compartilhado), pra RH e Financeiro poderem
  // importar independentemente.
  const [viewMode, setViewMode] = useState<'resumo' | 'separar_holerites'>('resumo');
  const [elegiveisContabilidade, setElegiveisContabilidade] = useState<{ nome_completo: string; tipo_contrato: string }[]>([]);

  // Aba "Retorno API Itaú" — consulta o que foi persistido em
  // folha_lotes_pagamento.itens por enviarLoteAoBancoAction, item a item.
  const [abaAtiva, setAbaAtiva] = useState<'lotes' | 'retorno_itau'>('lotes');
  const [loteRetornoId, setLoteRetornoId] = useState<number | null>(null);
  const [itensRetorno, setItensRetorno] = useState<ItemLote[]>([]);
  const [carregandoRetorno, setCarregandoRetorno] = useState(false);
  const [detalheBrutoItem, setDetalheBrutoItem] = useState<ItemLote | null>(null);
  const [consultandoStatusId, setConsultandoStatusId] = useState<string | null>(null);
  const [statusAtual, setStatusAtual] = useState<{ item: ItemLote; ambiente: string; pagamento: any } | null>(null);

  // Popup "ver" de uma OP incluída no lote (fonte 'OP') — mostra os dados da
  // Ordem de Pagamento sem sair da tela, em vez de navegar para
  // /admin/financeiro/ops.
  const [modalOP, setModalOP] = useState<{ open: boolean; carregando: boolean; op: any | null; erro: string | null }>({ open: false, carregando: false, op: null, erro: null });

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregar();
  }, [authLoading, acessoNegado]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    async function carregarEmpresas() {
      const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(empresasData || []);

      if (ehAdministradorGlobal(permissaoBruta)) {
        setEmpresasPermitidas(null);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: vinculos } = await supabase
        .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
      setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
    }
    carregarEmpresas();
  }, [authLoading, acessoNegado, permissaoBruta]);

  const empresasCatalogoVisivel = useMemo(() =>
    empresasPermitidas === null
      ? empresasCatalogo
      : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id)),
    [empresasCatalogo, empresasPermitidas]);

  // Se só existe uma empresa visível, trava a escolha nela.
  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) {
      setEmpresaSelecionada(empresasCatalogoVisivel[0].id);
    }
  }, [empresasCatalogoVisivel]);

  // Histórico de lotes só mostra a empresa escolhida no topo — lotes sem
  // empresa_id própria (anteriores à coluna, ou mistos) continuam visíveis
  // independente do filtro, mesmo critério usado em todo o resto do sistema.
  const lotesVisiveis = useMemo(() =>
    !empresaSelecionada ? lotes : lotes.filter(l => l.empresa_id == null || l.empresa_id === empresaSelecionada),
    [lotes, empresaSelecionada]);

  const carregar = async () => {
    const [lotesRes, integRes] = await Promise.all([
      listarLotesAction({}, accessToken),
      listarIntegracoesAction(accessToken)
    ]);
    if (lotesRes.ok) setLotes(lotesRes.info.lotes);
    if (integRes.ok) setIntegracoes(integRes.info.integracoes);
    carregarElegiveisContabilidade();
  };

  // Funcionários elegíveis à separação de holerite (contrato com a flag
  // recebe_holerite_contabilidade ligada), em ordem alfabética — mesma
  // lógica usada em /admin/rh/ponto.
  const carregarElegiveisContabilidade = async () => {
    const { data: regrasData } = await supabase
      .from('folha_parametros')
      .select('nome_regra, recebe_holerite_contabilidade');
    const contratosComHolerite = new Set(
      (regrasData || []).filter(r => r.recebe_holerite_contabilidade !== false).map(r => r.nome_regra)
    );
    const { data: funcData } = await supabase
      .from('folha_funcionarios')
      .select('nome_completo, tipo_contrato')
      .eq('ativo', true)
      .order('nome_completo');
    const elegiveis = (funcData || [])
      .filter(f => contratosComHolerite.has(f.tipo_contrato))
      .map(f => ({ nome_completo: f.nome_completo, tipo_contrato: f.tipo_contrato }));
    setElegiveisContabilidade(elegiveis);
  };

  const montarLote = async () => {
    if (fontesSel.length === 0) { toast('Selecione ao menos uma fonte de pagamento.', 'error'); return; }
    if (!empresaSelecionada) { toast('Selecione a empresa (Rentech/AlfaLight) antes de montar o lote.', 'error'); return; }
    setMontando(true); setItens([]);
    try {
      const res = await montarLoteSalariosAction({
        mesReferencia, fontes: fontesSel, empresaId: empresaSelecionada,
        valoresAdiantamento: valoresAdiant,
        valoresPagamento: valoresPagto,
        valoresDecimoTerceiro, valoresFerias
      }, accessToken);
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
        toast(`Nenhum funcionário encontrado no grid.`, 'info');
      }
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setMontando(false); }
  };

  // Nova função de OCR operando 100% via Backend (AWS Textract). Documentos já
  // lidos antes voltam do banco em `cache` (ver listarPdfsContabilidadeAction)
  // e não são reenviados à AWS — só `forcar: true` (releitura manual) ignora
  // o cache e lê tudo de novo.
  // Cada tipo de documento OCRável mapeia pro seu próprio par de estado
  // (valores lidos por OCR, cacheados em folha_documentos_contabeis.valor_ocr).
  const estadoOcrPorTipo = {
    ADIANTAMENTO: { valores: valoresAdiant, setValores: setValoresAdiant },
    HOLERITE_MENSAL: { valores: valoresPagto, setValores: setValoresPagto },
    DECIMO_TERCEIRO: { valores: valoresDecimoTerceiro, setValores: setValoresDecimoTerceiro },
    FERIAS: { valores: valoresFerias, setValores: setValoresFerias }
  };

  const rodarOcrTipo = async (tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL' | 'DECIMO_TERCEIRO' | 'FERIAS', rotulo: string, forcar = false) => {
    setOcrRodando(true);
    setOcrFalhas([]);
    setOcrDebug(null);

    try {
      const res = await listarPdfsContabilidadeAction({ mesReferencia, tipo, forcar }, accessToken);
      if (!res.ok) throw new Error(res.erro);

      const pdfs: { funcionario_nome: string; pdfBase64: string }[] = res.info.pdfs;
      const cache: { funcionario_nome: string; valor: number }[] = res.info.cache || [];

      if (pdfs.length === 0 && cache.length === 0) {
        toast(`Nenhum PDF de ${rotulo.toLowerCase()} encontrado neste mês.`, 'info');
        return;
      }

      const { valores: anteriores, setValores } = estadoOcrPorTipo[tipo];
      const novos: Record<string, number> = { ...anteriores };
      cache.forEach(c => { novos[c.funcionario_nome] = c.valor; });

      if (pdfs.length > 0) {
        setOcrProgresso({ atual: 0, total: pdfs.length, nome: '', tipo: rotulo });

        const falhas: string[] = [];
        let primeiroTexto = '';

        for (let i = 0; i < pdfs.length; i++) {
          const { funcionario_nome, pdfBase64 } = pdfs[i];
          setOcrProgresso({ atual: i + 1, total: pdfs.length, nome: funcionario_nome, tipo: rotulo });

          try {
            // Chamada para a Server Action conectada à AWS Textract — salva o
            // resultado em banco (mesReferencia + funcionario_nome) para não
            // precisar reler este PDF nas próximas vezes.
            const respostaAws = await processarOcrAwsAction(pdfBase64, tipo, mesReferencia, funcionario_nome, accessToken);

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

        setOcrFalhas(prev => [...prev, ...falhas]);
        if (primeiroTexto) setOcrDebug(primeiroTexto);
      }

      setValores(novos);

      // Remonta a tabela com os novos valores
      const res2 = await montarLoteSalariosAction({
        mesReferencia, fontes: fontesSel, empresaId: empresaSelecionada,
        valoresAdiantamento: tipo === 'ADIANTAMENTO' ? novos : valoresAdiant,
        valoresPagamento: tipo === 'HOLERITE_MENSAL' ? novos : valoresPagto,
        valoresDecimoTerceiro: tipo === 'DECIMO_TERCEIRO' ? novos : valoresDecimoTerceiro,
        valoresFerias: tipo === 'FERIAS' ? novos : valoresFerias
      }, accessToken);
      if (res2.ok) {
        setItens(res2.info.itens);
        setResumoLote({
          semDados: res2.info.semDados, semOcr: res2.info.semOcr,
          valorTotal: res2.info.valorTotal, totalItens: res2.info.totalItens,
          totaisPorFonte: res2.info.totaisPorFonte
        });
      }
    } catch (e: any) {
      toast('Erro na operação de leitura: ' + e.message, 'error');
    } finally {
      setOcrRodando(false);
      setOcrProgresso({ atual: 0, total: 0, nome: '', tipo: '' });
    }
  };

  const alternarFonte = (f: FonteLote) => {
    setFontesSel(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  };

  // Mapa fonte (deste lote) -> tipo (folha_documentos_contabeis) pras 4
  // fontes que vêm de documento da contabilidade lido por OCR.
  const TIPO_DOCUMENTO_POR_FONTE: Partial<Record<FonteLote, 'ADIANTAMENTO' | 'HOLERITE_MENSAL' | 'DECIMO_TERCEIRO' | 'FERIAS'>> = {
    ADIANTAMENTO: 'ADIANTAMENTO', PAGAMENTO: 'HOLERITE_MENSAL', DECIMO_TERCEIRO: 'DECIMO_TERCEIRO', FERIAS: 'FERIAS',
  };

  const ajustarValorLinha = (nome: string, fonte: FonteLote, valor: number) => {
    if (fonte === 'ADIANTAMENTO') setValoresAdiant(v => ({ ...v, [nome]: valor }));
    else if (fonte === 'PAGAMENTO') setValoresPagto(v => ({ ...v, [nome]: valor }));
    else if (fonte === 'DECIMO_TERCEIRO') setValoresDecimoTerceiro(v => ({ ...v, [nome]: valor }));
    else if (fonte === 'FERIAS') setValoresFerias(v => ({ ...v, [nome]: valor }));
    setItens(prev => prev.map(i => (i.funcionario_nome === nome && i.fonte === fonte)
      ? { ...i, valor, pronto: i.metodo !== 'SEM_DADOS' && valor > 0 } : i));

    // Grava também em folha_documentos_contabeis.valor_ocr — é de lá que
    // /admin/rh/holerite lê o valor pago pela contabilidade na hora de gerar
    // a prévia/enviar pra assinatura. Sem isso, um valor digitado manualmente
    // aqui (quando o OCR automático falha) nunca aparecia lá.
    const tipoDocumento = TIPO_DOCUMENTO_POR_FONTE[fonte];
    if (tipoDocumento && valor > 0) {
      salvarValorOcrManualAction({ funcionarioNome: nome, mesReferencia, tipo: tipoDocumento, valor }, accessToken)
        .then(res => { if (!res.ok) toast(`Valor atualizado aqui, mas não foi possível salvar pra prévia do holerite: ${res.erro}`, 'error'); })
        .catch(() => toast('Valor atualizado aqui, mas houve falha de conexão ao salvar pra prévia do holerite.', 'error'));
    }
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
    if (prontos.length === 0) { toast('Nenhum pagamento pronto para gerar o lote.', 'info'); return; }
    const sugestao = `${fontesSel.map(f => ({ FOLHA: 'Folha', ADIANTAMENTO: 'Adiantamento', PAGAMENTO: 'Pagamento', BENEFICIOS: 'Benefícios', DECIMO_TERCEIRO: '13º', FERIAS: 'Férias', RESCISAO: 'Rescisão', OP: 'OP' }[f])).join(' + ')} ${fmtMesBR(mesReferencia)}`;
    const nome = prompt(`Nome do lote (para identificar no histórico):`, sugestao);
    if (nome === null) return;
    setSalvandoLote(true);
    try {
      const res = await salvarLoteAction({
        parceiro: 'ITAU', mesReferencia, tipoLote: fontesSel.join('+'),
        nomeLote: nome || sugestao, dataPagamento, itens, criadoPor: usuarioAtual
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      toast(`Lote "${nome || sugestao}" gerado: ${res.info.qtd} pagamentos, ${BRL(res.info.valorTotal)}.`, 'success');
      setItens([]); carregar();
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setSalvandoLote(false); }
  };

  const exportarLoteCSV = () => {
    if (prontos.length === 0) { toast('Nenhum pagamento pronto para exportar.', 'info'); return; }
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
    const candidatosPix = prontos.filter(i => i.metodo === 'PIX');
    const pagamentosPix = candidatosPix.filter(i => !STATUS_JA_PAGO_VIA_API.includes(i.api_status || ''));
    const jaPagosViaApi = candidatosPix.length - pagamentosPix.length;

    if (pagamentosPix.length === 0) {
      toast(jaPagosViaApi > 0
        ? `Todos os ${jaPagosViaApi} pagamento(s) via PIX deste lote já foram enviados com sucesso pela API — nada para exportar (evita pagar em dobro).`
        : 'Nenhum pagamento via PIX pronto para exportar.', 'info');
      return;
    }
    if (jaPagosViaApi > 0 && !confirm(`${jaPagosViaApi} pagamento(s) via PIX deste lote já foram enviados com sucesso pela API e serão EXCLUÍDOS deste arquivo (evita pagar em dobro). Continuar exportando os ${pagamentosPix.length} restantes?`)) {
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
      toast(`Configure primeiro (tela Integrações → ⚙ Configurar Itaú): ${camposFaltando.join(', ')}.`, 'error');
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
    // de geração do arquivo, ex.: gerar hoje para pagar daqui a alguns dias)
    // — exceto para itens de OP, que usam a própria data de vencimento da OP
    // (item.dataPagamento), nunca a digitada nesta tela.
    const formatarDataPagamentoCnab = (dataStr: string) => {
      const [ano, mes, dia] = dataStr.split('-').map(Number);
      return padL(dia, 2) + padL(mes, 2) + String(ano);
    };

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
      const dataPagamentoStr = formatarDataPagamentoCnab(item.dataPagamento || dataPagamento);

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
    const candidatosConta = prontos.filter(i => i.metodo === 'TED');
    const pagamentosConta = candidatosConta.filter(i => !STATUS_JA_PAGO_VIA_API.includes(i.api_status || ''));
    const jaPagosViaApi = candidatosConta.length - pagamentosConta.length;

    if (pagamentosConta.length === 0) {
      toast(jaPagosViaApi > 0
        ? `Todos os ${jaPagosViaApi} pagamento(s) via conta bancária deste lote já foram enviados com sucesso pela API (Pix por dados bancários) — nada para exportar (evita pagar em dobro).`
        : 'Nenhum pagamento via conta bancária pronto para exportar.', 'info');
      return;
    }
    if (jaPagosViaApi > 0 && !confirm(`${jaPagosViaApi} pagamento(s) via conta bancária deste lote já foram enviados com sucesso pela API (Pix por dados bancários) e serão EXCLUÍDOS deste arquivo (evita pagar em dobro). Continuar exportando os ${pagamentosConta.length} restantes?`)) {
      return;
    }

    const itauIntegracao = integracoes.find(i => i.parceiro === 'ITAU');
    const cfg = itauIntegracao?.config || {};
    const camposFaltando = (['cnpj', 'razao_social', 'agencia_debito', 'conta_debito'] as const)
      .filter(campo => !String(cfg[campo] || '').trim());

    if (camposFaltando.length > 0) {
      toast(`Configure primeiro (tela Integrações → ⚙ Configurar Itaú): ${camposFaltando.join(', ')}.`, 'error');
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
    // Itens de OP usam a própria data de vencimento da OP (item.dataPagamento),
    // nunca a digitada nesta tela — ver formatarDataPagamentoCnab acima.
    const formatarDataPagamentoCnab = (dataStr: string) => {
      const [ano, mes, dia] = dataStr.split('-').map(Number);
      return padL(dia, 2) + padL(mes, 2) + String(ano);
    };

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
        const dataPagamentoStr = formatarDataPagamentoCnab(item.dataPagamento || dataPagamento);
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
    if (!confirm(`Enviar os pagamentos deste lote via API do Itaú (Pix por chave, ou por dados bancários pra quem não tem chave cadastrada), com data de pagamento ${dataPagamento.split('-').reverse().join('/')}?\n\nIsso move dinheiro de verdade (ou do sandbox, conforme o Ambiente configurado em Integrações). Se algum favorecido não tiver chave PIX nem conta bancária cadastrada, ou o banco não for reconhecido, esse item fica pendente pra exportação manual (CNAB).`)) return;
    setEnviandoLoteId(loteId);
    try {
      const res = await enviarLoteAoBancoAction({ loteId, dataPagamento, usuarioNome: usuarioAtual }, accessToken);
      if (res.info) {
        const { sucesso, rejeitado, comErro, total } = res.info;
        toast(`Envio concluído: ${sucesso}/${total} pagos, ${rejeitado} rejeitados pelo banco, ${comErro} com erro.` + (res.erro ? `\n\n${res.erro}` : ''), 'success');
      } else {
        toast(res.erro || (res.ok ? 'Enviado.' : 'Não foi possível enviar.'), res.ok ? 'success' : 'error');
      }
      carregar();
      if (loteRetornoId === loteId) carregarRetornoLote(loteId);
    } finally {
      setEnviandoLoteId(null);
    }
  };

  const alternarAtivoLote = async (lote: Lote) => {
    const novoAtivo = !lote.ativo;
    const confirmMsg = novoAtivo
      ? `Reativar o lote "${lote.nome_lote || lote.tipo_lote}"?`
      : `Inativar o lote "${lote.nome_lote || lote.tipo_lote}"?\n\nO histórico continua salvo, só fica sinalizado como inativo (ex.: lote duplicado ou gerado por engano).`;
    if (!confirm(confirmMsg)) return;

    const res = await alternarAtivoLoteAction({ loteId: lote.id, ativo: novoAtivo, usuarioNome: usuarioAtual }, accessToken);
    if (!res.ok) { toast(res.erro || 'Não foi possível atualizar o lote.', 'error'); return; }
    setLotes(prev => prev.map(l => l.id === lote.id ? { ...l, ativo: novoAtivo } : l));
  };

  // Reabre um lote já salvo no histórico (carrega os itens exatamente como
  // foram gerados na época) só pra poder exportar de novo o CSV/CNAB.
  const abrirLoteParaExportar = async (lote: Lote) => {
    setAbrindoLote(lote.id);
    try {
      const res = await buscarLoteAction({ loteId: lote.id }, accessToken);
      if (!res.ok) { toast(res.erro || 'Não foi possível abrir o lote.', 'error'); return; }
      const itensSalvos: ItemLote[] = res.info.lote.itens || [];
      if (itensSalvos.length === 0) { toast('Este lote não tem itens salvos para exportar.', 'info'); return; }
      setItens(itensSalvos);
      setMesReferencia(res.info.lote.mes_referencia);
      setLoteReaberto({ id: lote.id, nome: lote.nome_lote || lote.tipo_lote });
      setViewMode('resumo');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setAbrindoLote(null);
    }
  };

  const fecharLoteReaberto = () => {
    setItens([]);
    setLoteReaberto(null);
  };

  // Carrega os itens salvos de um lote pra exibir na aba "Retorno API Itaú"
  // — reaproveita buscarLoteAction (já usada em abrirLoteParaExportar), só
  // muda o destino do resultado.
  const carregarRetornoLote = async (loteId: number) => {
    setCarregandoRetorno(true);
    try {
      const res = await buscarLoteAction({ loteId }, accessToken);
      if (!res.ok) { toast(res.erro || 'Não foi possível abrir o lote.', 'error'); setItensRetorno([]); return; }
      const itensSalvos: ItemLote[] = res.info.lote.itens || [];
      // 'TED' também é enviado via API hoje (Pix por dados bancários quando
      // não há chave PIX cadastrada — ver enviarLoteAoBancoAction), por isso
      // entra aqui igual a 'PIX', não só quem tem chave.
      setItensRetorno(itensSalvos.filter(i => (i.metodo === 'PIX' || i.metodo === 'TED') && i.pronto));
    } finally {
      setCarregandoRetorno(false);
    }
  };

  // "Sucesso" salvo em api_status é só o que a API respondeu na hora do
  // envio (aceito pela API) — pagamentos SISPAG passam por aprovação manual
  // no Itaú Empresas antes de serem efetivados de verdade, então o status
  // real só se sabe consultando de novo. Ver consultarStatusAtualItauAction.
  const consultarStatusAtual = async (item: ItemLote) => {
    if (!item.api_cod_pagamento) return;
    setConsultandoStatusId(item.api_cod_pagamento);
    try {
      const res = await consultarStatusAtualItauAction({ idPagamentoSispag: item.api_cod_pagamento }, accessToken);
      if (!res.ok) { toast(res.erro || 'Não foi possível consultar o status atual.', 'error'); return; }
      setStatusAtual({ item, ambiente: res.info.ambiente, pagamento: res.info.pagamento });
    } finally {
      setConsultandoStatusId(null);
    }
  };

  const abrirDetalhesOP = async (opId: string) => {
    setModalOP({ open: true, carregando: true, op: null, erro: null });
    const res = await buscarDetalhesOPAction({ opId }, accessToken);
    if (!res.ok) { setModalOP({ open: true, carregando: false, op: null, erro: res.erro || 'Não foi possível carregar a OP.' }); return; }
    setModalOP({ open: true, carregando: false, op: res.info.op, erro: null });
  };

  // Datas do Itaú vêm como "2026-08-12-22.46.12.850000" — não é ISO.
  const fmtDataItau = (d: string | null | undefined) => {
    if (!d) return '—';
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.(\d{2})\.(\d{2})/);
    if (!m) return d;
    const [, ano, mes, dia, h, min, s] = m;
    return `${dia}/${mes}/${ano} ${h}:${min}:${s}`;
  };

  // Ao abrir a aba pela primeira vez, seleciona automaticamente o lote Itaú
  // mais recente (lotes já vem ordenado por criado_em desc de listarLotesAction).
  useEffect(() => {
    if (abaAtiva !== 'retorno_itau' || loteRetornoId !== null) return;
    const maisRecente = lotesVisiveis.find(l => l.parceiro === 'ITAU');
    if (maisRecente) {
      setLoteRetornoId(maisRecente.id);
      carregarRetornoLote(maisRecente.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abaAtiva, lotesVisiveis]);

  const badgeApiStatus = (item: ItemLote) => {
    if (!item.api_status) {
      return <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-gray-100 text-gray-500">— Não enviado</span>;
    }
    const cores: Record<string, string> = {
      'Sucesso': 'bg-emerald-100 text-emerald-700',
      'Sucesso (pre-autorizado)': 'bg-emerald-100 text-emerald-700',
      'Rejeitado': 'bg-red-100 text-red-600',
      'Nao incluido': 'bg-amber-100 text-amber-700',
      'Erro': 'bg-red-100 text-red-600',
    };
    return <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${cores[item.api_status] || 'bg-gray-100 text-gray-500'}`}>{item.api_status}</span>;
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

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

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
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO FINANCEIRO
        </button>
      </div>

      {viewMode === 'separar_holerites' && (
        <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
          <SepararHolerites
            mesReferencia={mesReferencia}
            usuarioAtual={usuarioAtual}
            accessToken={accessToken}
            elegiveis={elegiveisContabilidade}
            onFechar={() => setViewMode('resumo')}
          />
        </div>
      )}

      {viewMode === 'resumo' && (
      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm mb-4">
          <button onClick={() => setAbaAtiva('lotes')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'lotes' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            💰 Lotes de Pagamento
          </button>
          <button onClick={() => setAbaAtiva('retorno_itau')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'retorno_itau' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            🔌 Retorno API Itaú
          </button>
        </div>

        {abaAtiva === 'lotes' && (<>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">📄 Holerites da Contabilidade</h3>
            <p className="text-[11px] text-gray-500">Importar e separar por funcionário os PDFs de adiantamento, pagamento, 13º e férias, para anexar à assinatura.</p>
          </div>
          <button onClick={() => setViewMode('separar_holerites')} className="text-xs font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-2.5 rounded-lg uppercase tracking-wider flex items-center justify-center gap-2 shrink-0">
            📄 SEPARAR HOLERITES
            <span className="bg-white/25 px-2 py-0.5 rounded-full text-[10px]">{elegiveisContabilidade.length}</span>
          </button>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4">
          {loteReaberto && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-xs font-black text-emerald-700 uppercase tracking-wider">
                📤 Reabrindo lote do histórico: {loteReaberto.nome} · {itens.length} pagamento(s)
              </p>
              <button onClick={fecharLoteReaberto} className="text-[10px] font-black text-emerald-700 bg-white border border-emerald-600 hover:bg-emerald-600 hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">
                ✕ Fechar
              </button>
            </div>
          )}

          {!loteReaberto && (
            <div className="flex flex-wrap items-end gap-4 mb-4">
              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Empresa</label>
                  <select
                    value={empresaSelecionada ?? ''}
                    onChange={(e) => setEmpresaSelecionada(e.target.value ? Number(e.target.value) : null)}
                    disabled={empresasCatalogoVisivel.length <= 1}
                    className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC] disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {empresasCatalogoVisivel.length !== 1 && <option value="">Selecione...</option>}
                    {empresasCatalogoVisivel.map((e) => (
                      <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Competência</label>
                  <input type="month" value={mesReferencia} onChange={e => setMesReferencia(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Fontes a incluir no lote</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    ['FOLHA', '💼 Nossa folha', 'bg-blue-50 text-blue-700 border-blue-300'],
                    ['ADIANTAMENTO', '📄 Adiantamento', 'bg-purple-50 text-purple-700 border-purple-300'],
                    ['PAGAMENTO', '📄 Pagamento', 'bg-purple-50 text-purple-700 border-purple-300'],
                    ['BENEFICIOS', '🎁 Benefícios', 'bg-emerald-50 text-emerald-700 border-emerald-300'],
                    ['DECIMO_TERCEIRO', '🎄 13º Salário', 'bg-amber-50 text-amber-700 border-amber-300'],
                    ['FERIAS', '🏖️ Férias', 'bg-cyan-50 text-cyan-700 border-cyan-300'],
                    ['RESCISAO', '📤 Rescisão', 'bg-red-50 text-red-700 border-red-300'],
                    ['OP', '🧾 Ordem de Pagamento', 'bg-indigo-50 text-indigo-700 border-indigo-300']
                  ] as const).map(([f, lbl, cor]) => (
                    <label key={f} className={`cursor-pointer inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 text-[11px] font-black uppercase tracking-wider transition-all ${fontesSel.includes(f) ? cor : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                      <input type="checkbox" checked={fontesSel.includes(f)} onChange={() => alternarFonte(f)} className="w-4 h-4 shrink-0" />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
              <button onClick={montarLote} disabled={montando || fontesSel.length === 0 || !empresaSelecionada} title={!empresaSelecionada ? 'Selecione a empresa antes de montar o lote' : ''} className="text-xs font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
                {montando ? '⏳ Montando...' : '📥 Montar lote'}
              </button>
            </div>
          )}

          {itens.length > 0 && (
            <div className="pt-3 border-t border-gray-100 space-y-4">
              {!loteReaberto && (fontesSel.includes('ADIANTAMENTO') || fontesSel.includes('PAGAMENTO') || fontesSel.includes('DECIMO_TERCEIRO') || fontesSel.includes('FERIAS')) && (
                <div className="flex flex-wrap items-center gap-2">
                  {fontesSel.includes('ADIANTAMENTO') && (
                    <>
                      <button onClick={() => rodarOcrTipo('ADIANTAMENTO', 'Adiantamento')} disabled={ocrRodando} className="text-[10px] font-black bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔍 OCR Adiantamento
                      </button>
                      <button onClick={() => rodarOcrTipo('ADIANTAMENTO', 'Adiantamento', true)} disabled={ocrRodando} title="Ignora o valor já salvo e lê os comprovantes de novo" className="text-[10px] font-black bg-white border border-purple-300 text-purple-700 hover:bg-purple-50 px-3 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔄 Reler tudo
                      </button>
                    </>
                  )}
                  {fontesSel.includes('PAGAMENTO') && (
                    <>
                      <button onClick={() => rodarOcrTipo('HOLERITE_MENSAL', 'Pagamento')} disabled={ocrRodando} className="text-[10px] font-black bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔍 OCR Pagamento
                      </button>
                      <button onClick={() => rodarOcrTipo('HOLERITE_MENSAL', 'Pagamento', true)} disabled={ocrRodando} title="Ignora o valor já salvo e lê os comprovantes de novo" className="text-[10px] font-black bg-white border border-purple-300 text-purple-700 hover:bg-purple-50 px-3 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔄 Reler tudo
                      </button>
                    </>
                  )}
                  {fontesSel.includes('DECIMO_TERCEIRO') && (
                    <>
                      <button onClick={() => rodarOcrTipo('DECIMO_TERCEIRO', '13º Salário')} disabled={ocrRodando} className="text-[10px] font-black bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔍 OCR 13º Salário
                      </button>
                      <button onClick={() => rodarOcrTipo('DECIMO_TERCEIRO', '13º Salário', true)} disabled={ocrRodando} title="Ignora o valor já salvo e lê os comprovantes de novo" className="text-[10px] font-black bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 px-3 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔄 Reler tudo
                      </button>
                    </>
                  )}
                  {fontesSel.includes('FERIAS') && (
                    <>
                      <button onClick={() => rodarOcrTipo('FERIAS', 'Férias')} disabled={ocrRodando} className="text-[10px] font-black bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔍 OCR Férias
                      </button>
                      <button onClick={() => rodarOcrTipo('FERIAS', 'Férias', true)} disabled={ocrRodando} title="Ignora o valor já salvo e lê os comprovantes de novo" className="text-[10px] font-black bg-white border border-cyan-300 text-cyan-700 hover:bg-cyan-50 px-3 py-2 rounded-lg uppercase tracking-wider disabled:opacity-50">
                        🔄 Reler tudo
                      </button>
                    </>
                  )}
                  <span className="text-[10px] text-gray-400 font-bold">Comprovantes já lidos usam o valor salvo — só os novos vão para a AWS.</span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data de pagamento</label>
                  <input type="date" value={dataPagamento} onChange={e => setDataPagamento(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]" />
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={exportarLoteCSV} className="text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">⬇ Exportar CSV</button>
                  {!loteReaberto && (
                    <button onClick={gerarLote} disabled={salvandoLote} className="text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
                      {salvandoLote ? '⏳ Gerando...' : '✓ Gerar Lote'}
                    </button>
                  )}
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
                        : it.fonte === 'DECIMO_TERCEIRO' ? 'bg-amber-100 text-amber-700'
                        : it.fonte === 'FERIAS' ? 'bg-cyan-100 text-cyan-700'
                        : it.fonte === 'RESCISAO' ? 'bg-red-100 text-red-700'
                        : it.fonte === 'OP' ? 'bg-indigo-100 text-indigo-700'
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
                              {it.metodo === 'SEM_DADOS'
                                ? (it.fonte === 'OP' && it.nota
                                    ? <span className="text-amber-600 font-black">⚠ Pagar manualmente: {it.nota}</span>
                                    : <span className="text-amber-600 font-black">⚠ Sem dados bancários na ficha</span>)
                                : it.metodo === 'PIX' ? `PIX ${it.pix_tipo}: ${it.pix_chave}`
                                : `Ag ${it.banco_agencia} · C/C ${it.banco_conta}`}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${corFonte}`}>{it.fonte_rotulo}</span>
                            {it.origem && <span className="ml-1 text-[9px] font-bold text-gray-400 uppercase">{it.origem === 'FICHA' ? '📋 ficha' : '🔍 ocr'}</span>}
                            {it.fonte === 'RESCISAO' && it.rescisaoId && (
                              <button type="button" onClick={() => router.push(`/admin/rh/rescisao/${it.rescisaoId}`)} className="ml-1 text-[9px] font-black text-gray-400 hover:text-red-600 uppercase underline">
                                ↗ ver
                              </button>
                            )}
                            {it.fonte === 'OP' && it.dataPagamento && (
                              <span className="block text-[9px] font-bold text-gray-400 mt-0.5" title="Data de pagamento desta OP — usa o vencimento próprio, não a data digitada acima">
                                📅 Venc.: {fmtData(it.dataPagamento)}
                              </span>
                            )}
                            {it.fonte === 'OP' && it.opId && (
                              <button type="button" onClick={() => abrirDetalhesOP(it.opId!)} className="ml-1 text-[9px] font-black text-gray-400 hover:text-indigo-600 uppercase underline">
                                ↗ ver
                              </button>
                            )}
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
          {lotesVisiveis.length === 0 ? (
            <div className="p-12 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum lote gerado ainda.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Gerado em</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Pagamento</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Nome do lote</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Competência</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Pagtos</th>
                    <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Total</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Status</th>
                    <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {lotesVisiveis.map((l, idx) => (
                    <tr key={l.id} className={`${l.ativo === false ? 'opacity-50' : ''} ${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                      <td className="p-3 text-[11px] text-gray-500">{fmtDataHora(l.criado_em)}</td>
                      <td className="p-3 text-[11px] font-bold text-gray-700">{fmtData(l.data_pagamento)}</td>
                      <td className="p-3">
                        <span className="font-black text-[#0C1D4D] block">{l.nome_lote || l.tipo_lote}</span>
                        <span className="text-[10px] font-bold text-gray-400 uppercase">{l.parceiro}</span>
                      </td>
                      <td className="p-3 font-bold">{fmtMesBR(l.mes_referencia)}</td>
                      <td className="p-3 text-center font-black text-[#0C1D4D]">{l.qtd_pagamentos}</td>
                      <td className="p-3 text-right font-black text-[#0C1D4D] tabular-nums">{BRL(l.valor_total)}</td>
                      <td className="p-3 text-center">
                        {badgeStatus(l.status)}
                        {l.ativo === false && <span className="block mt-1 text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-red-100 text-red-600">Inativo</span>}
                      </td>
                      <td className="p-3 text-right">
                        {(l.status === 'ENVIADO' || l.status === 'PROCESSADO') ? (
                          <span className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">✓ Enviado ao banco</span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button onClick={() => abrirLoteParaExportar(l)} disabled={abrindoLote === l.id} className="text-[10px] font-black text-emerald-700 bg-white border border-emerald-600 hover:bg-emerald-600 hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors disabled:opacity-50">
                              {abrindoLote === l.id ? '⏳ Abrindo...' : '📤 Abrir p/ Exportar'}
                            </button>
                            <button onClick={() => enviarLote(l.id)} disabled={l.ativo === false || enviandoLoteId === l.id} className="text-[10px] font-black text-[#0C1D4D] bg-white border border-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-[#0C1D4D]">
                              {enviandoLoteId === l.id ? '⏳ Enviando...' : '↗ Enviar ao banco'}
                            </button>
                            {l.ativo === false ? (
                              <button onClick={() => alternarAtivoLote(l)} className="text-[10px] font-black text-emerald-700 bg-white border border-emerald-600 hover:bg-emerald-600 hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">✓ Reativar</button>
                            ) : (
                              <button onClick={() => alternarAtivoLote(l)} className="text-[10px] font-black text-red-600 bg-white border border-red-500 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">🚫 Inativar</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>)}

        {abaAtiva === 'retorno_itau' && (
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0]">
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">🔌 Retorno da API Itaú (SISPAG)</h3>
            <p className="text-[11px] text-gray-500 mb-4">Status devolvido pelo Itaú, item a item, para cada pagamento enviado via API — por chave PIX ou, quando não há chave cadastrada, por dados bancários (agência/conta). Itens sem chave PIX nem conta bancária, ou com banco não reconhecido, continuam só no arquivo CNAB.</p>

            <div className="mb-4 max-w-md flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Lote</label>
                <select
                  value={loteRetornoId ?? ''}
                  onChange={e => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setLoteRetornoId(id);
                    if (id) carregarRetornoLote(id);
                    else setItensRetorno([]);
                  }}
                  className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]"
                >
                  <option value="">Selecione um lote</option>
                  {lotesVisiveis.filter(l => l.parceiro === 'ITAU').map(l => (
                    <option key={l.id} value={l.id}>
                      {(l.nome_lote || l.tipo_lote)} · {fmtMesBR(l.mes_referencia)} · {l.status}
                    </option>
                  ))}
                </select>
              </div>
              {loteRetornoId && (() => {
                const loteSelecionado = lotesVisiveis.find(l => l.id === loteRetornoId);
                return loteSelecionado ? (
                  <div className="pb-2.5">
                    <span className="block text-[10px] font-black text-gray-500 uppercase mb-1">Status do lote</span>
                    {badgeStatus(loteSelecionado.status)}
                  </div>
                ) : null;
              })()}
            </div>

            {carregandoRetorno && (
              <div className="p-12 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando...</div>
            )}

            {!carregandoRetorno && loteRetornoId && itensRetorno.length === 0 && (
              <div className="p-12 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum pagamento pronto pra envio via API neste lote.</div>
            )}

            {!carregandoRetorno && !loteRetornoId && (
              <div className="p-12 text-center text-gray-400 font-bold uppercase tracking-wider">Selecione um lote acima para ver o retorno da API.</div>
            )}

            {!carregandoRetorno && itensRetorno.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Funcionário</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Chave PIX / Conta</th>
                      <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Valor</th>
                      <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Status Itaú</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Código / Lote Itaú</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Motivo / Erro</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Enviado em</th>
                      <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensRetorno.map((item, idx) => (
                      <tr key={`${item.funcionario_nome}-${idx}`} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                        <td className="p-3">
                          <span className="font-black text-[#0C1D4D] block">{item.funcionario_nome}</span>
                          <span className="text-[10px] font-bold text-gray-400 uppercase">{item.fonte_rotulo}</span>
                        </td>
                        <td className="p-3 text-[11px] text-gray-600">
                          {item.pix_chave
                            ? `${item.pix_tipo}: ${item.pix_chave}`
                            : `Ag ${item.banco_agencia || '—'} C/C ${item.banco_conta || '—'} (${item.banco_codigo || '—'})`}
                        </td>
                        <td className="p-3 text-right font-black text-[#0C1D4D] tabular-nums">{BRL(item.valor)}</td>
                        <td className="p-3 text-center">{badgeApiStatus(item)}</td>
                        <td className="p-3 text-[10px] text-gray-500 font-mono">
                          {item.api_cod_pagamento && <span className="block break-all">{item.api_cod_pagamento}</span>}
                          {item.api_numero_lote && <span className="block text-gray-400">lote {item.api_numero_lote}</span>}
                        </td>
                        <td className="p-3 text-[11px] text-gray-600">
                          {item.api_erro && <span className="text-red-600 font-bold">{item.api_erro}</span>}
                          {item.api_motivo_recusa && item.api_motivo_recusa.length > 0 && (
                            <span className="text-red-600">{item.api_motivo_recusa.map(m => m.nome).filter(Boolean).join('; ')}</span>
                          )}
                        </td>
                        <td className="p-3 text-[11px] text-gray-500">{item.api_enviado_em ? fmtDataHora(item.api_enviado_em) : '—'}</td>
                        <td className="p-3 text-center whitespace-nowrap">
                          {item.api_cod_pagamento && (
                            <button onClick={() => consultarStatusAtual(item)} disabled={consultandoStatusId === item.api_cod_pagamento} className="text-[10px] font-black text-emerald-700 hover:underline uppercase disabled:opacity-50 mr-2">
                              {consultandoStatusId === item.api_cod_pagamento ? '⏳...' : '🔄 Status atual'}
                            </button>
                          )}
                          {item.api_resposta_bruta && (
                            <button onClick={() => setDetalheBrutoItem(item)} className="text-[10px] font-black text-[#1E40AF] hover:underline uppercase">
                              Ver JSON
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {detalheBrutoItem && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetalheBrutoItem(null)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">
                  Resposta bruta da API — {detalheBrutoItem.funcionario_nome}
                </h3>
                <button onClick={() => setDetalheBrutoItem(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <pre className="text-[10px] bg-[#F8FAFC] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(detalheBrutoItem.api_resposta_bruta, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {statusAtual && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setStatusAtual(null)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">
                  Status atual no Itaú — {statusAtual.item.funcionario_nome}
                </h3>
                <button onClick={() => setStatusAtual(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <span className={`inline-block mb-3 text-[9px] font-black px-2.5 py-1 rounded-full uppercase ${statusAtual.ambiente === 'PRODUCAO' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>
                Ambiente: {statusAtual.ambiente === 'PRODUCAO' ? 'Produção' : 'Sandbox'}
              </span>

              {statusAtual.pagamento?.dados_pagamento && (() => {
                const p = statusAtual.pagamento.dados_pagamento;
                return (
                  <div className="bg-[#F8FAFC] rounded-lg p-3 text-xs space-y-1.5 mb-3">
                    <p><span className="text-gray-400">Status:</span> <span className="font-black text-[#0C1D4D]">{p.status || '—'}</span></p>
                    <p><span className="text-gray-400">Nº do lote / lançamento:</span> <strong>{p.numero_lote || '—'} / {p.numero_lancamento || '—'}</strong></p>
                    <p><span className="text-gray-400">Favorecido:</span> <strong>{p.nome_favorecido || '—'}</strong></p>
                    <p><span className="text-gray-400">Banco favorecido:</span> {p.nome_banco_favorecido || '—'} · Ag {p.numero_agencia_favorecido || '—'} · C/C {p.numero_conta_favorecido || '—'}</p>
                    <p><span className="text-gray-400">Valor:</span> <strong>{BRL(Number(p.valor_pagamento) || 0)}</strong></p>
                    {p.motivo_rejeicao && p.motivo_rejeicao.length > 0 && (
                      <p className="text-red-600"><span className="text-gray-400">Motivo:</span> {p.motivo_rejeicao.map((m: any) => m.nome).filter(Boolean).join('; ')}</p>
                    )}
                  </div>
                );
              })()}

              {Array.isArray(statusAtual.pagamento?.historico_pagamento) && statusAtual.pagamento.historico_pagamento.length > 0 && (
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-2">Histórico</p>
                  <div className="space-y-2">
                    {statusAtual.pagamento.historico_pagamento.map((h: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-xs border-b border-gray-100 pb-1.5">
                        <span className="font-bold">{h.status}</span>
                        <span className="text-gray-400">{fmtDataItau(h.data)}{h.nome_operador ? ` · ${h.nome_operador}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!statusAtual.pagamento?.dados_pagamento && (
                <pre className="text-[10px] bg-[#F8FAFC] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(statusAtual.pagamento, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {modalOP.open && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalOP({ open: false, carregando: false, op: null, erro: null })}>
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">
                  🧾 Ordem de Pagamento {modalOP.op ? `#${modalOP.op.numero_op}` : ''}
                </h3>
                <button onClick={() => setModalOP({ open: false, carregando: false, op: null, erro: null })} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>

              {modalOP.carregando && (
                <div className="p-12 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando...</div>
              )}

              {!modalOP.carregando && modalOP.erro && (
                <div className="p-6 text-center text-red-600 font-bold text-sm">{modalOP.erro}</div>
              )}

              {!modalOP.carregando && modalOP.op && (() => {
                const op = modalOP.op;
                const itensOp: ItemOPNormalizado[] = normalizarItensOP(op.itens);
                const anexos: string[] = (op.file_urls && op.file_urls.length > 0) ? op.file_urls : (op.file_url ? [op.file_url] : []);
                const ehPix = String(op.tipo_pagamento || '').toUpperCase() === 'PIX';
                const coresStatusOp: Record<string, string> = {
                  PENDENTE: 'bg-amber-100 text-amber-700',
                  PAGO: 'bg-emerald-100 text-emerald-700',
                };
                return (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0]">
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">OS</span><strong className="text-xs">{op.os_numero || '—'}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Status</span>
                        <span className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${coresStatusOp[(op.status || '').toUpperCase()] || 'bg-purple-100 text-purple-700'}`}>{op.status || '—'}</span>
                      </div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Solicitante</span><strong className="text-xs">{op.responsavel_nome || '—'}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Cliente</span><strong className="text-xs">{op.os_cliente || '—'}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Evento</span><strong className="text-xs">{op.os_evento || '—'}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Período</span><strong className="text-xs">{op.os_periodo || '—'}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Natureza</span><strong className="text-xs">{op.natureza_pagamento || '—'}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Vencimento</span><strong className="text-xs">{fmtData(op.data_vencimento)}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">Favorecido</span><strong className="text-xs">{op.empresa_recebedora || '—'}</strong></div>
                      <div><span className="block text-[10px] uppercase text-gray-400 font-bold">CNPJ/CPF</span><strong className="text-xs">{op.cnpj_cpf_recebedora || '—'}</strong></div>
                      <div className="col-span-2"><span className="block text-[10px] uppercase text-gray-400 font-bold">Pagamento</span>
                        <strong className="text-xs">{ehPix ? `PIX ${op.chave_pix || ''}: ${op.dados_pagamento || '—'}` : `${op.tipo_pagamento || '—'}: ${op.dados_pagamento || '—'}`}</strong>
                      </div>
                    </div>

                    {op.status === 'PENDENTE' && op.pago_em && (
                      <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3">
                        <p className="text-[10px] font-black text-blue-700">
                          📡 Enviado via Pix pelo lote do Financeiro em {fmtDataHora(op.pago_em)}{op.pago_lote_id ? ` (lote #${op.pago_lote_id})` : ''} — aguardando confirmação bancária. A API só aceitou o pedido; pagamentos SISPAG passam por aprovação manual no Itaú Empresas antes de serem efetivados. Confirme no banco antes de baixar como paga em /admin/financeiro/ops.
                        </p>
                      </div>
                    )}

                    {itensOp.length > 0 && (
                      <>
                        <h4 className="text-xs font-black uppercase text-[#0C1D4D] tracking-widest mb-2 border-b border-[#E2E8F0] pb-2">Itens Solicitados</h4>
                        <div className="space-y-2 mb-4">
                          {itensOp.map((it, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-white border border-[#E2E8F0] p-3 rounded-lg text-xs">
                              <span className="flex-grow font-semibold text-[#0A2A4A] uppercase">{it.descricao} <span className="text-gray-400 font-normal">(x{it.qtd})</span></span>
                              <strong className="w-24 text-right text-[#336699]">{BRL(it.total)}</strong>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {op.observacao && (
                      <div className="mb-4">
                        <span className="block text-[10px] uppercase text-gray-400 font-bold mb-1">Observação</span>
                        <p className="text-xs text-gray-600">{op.observacao}</p>
                      </div>
                    )}

                    {anexos.length > 0 && (
                      <div className="mb-4 flex flex-wrap gap-2">
                        {anexos.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer" className="text-[10px] font-black text-indigo-600 hover:underline uppercase">
                            📎 Comprovante {anexos.length > 1 ? i + 1 : ''}
                          </a>
                        ))}
                      </div>
                    )}

                    <div className="bg-[#F8FAFC] rounded-lg p-3 flex justify-between items-center border-t border-[#E2E8F0]">
                      <span className="text-xs font-bold text-gray-500 uppercase">Valor Total</span>
                      <span className="text-xl font-black text-[#0C1D4D]">{BRL(op.total_geral)}</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
