"use client";

import { Fragment, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarCatalogosBeneficioAction, criarTipoBeneficioAction, criarMeioBeneficioAction,
  salvarBeneficioAction, alternarBeneficioAction, historicoBeneficioAction, painelBeneficiosAction,
  gridBeneficiosAction, gerarBeneficioAction, listarPedidosFlashAction, confirmarPagamentoFlashAction, cancelarPedidoFlashAction
} from '../actions/actions-beneficios';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { supabase } from '../../../lib/supabase';
import { ehAdministradorGlobal } from '../../../lib/permissoes';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';

const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

interface LinhaFunc {
  nome: string; cargo: string; contrato: string; empresaId?: number | null;
  beneficiosFixos: { id: number; tipoId: number; meioId: number; tipo: string; meio: string; valor: number; modalidade: string; qtdDias: number | null; observacao: string | null; removidoEm?: string | null }[];
  removidos: LinhaFunc['beneficiosFixos'];   // ativo=false — só aparecem com "Mostrar removidos"
  totalFixos: number;
  temVariavel: boolean;
  semNenhum: boolean;
}

export default function BeneficiosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<LinhaFunc[]>([]);
  const [tipos, setTipos] = useState<{ id: number; nome: string }[]>([]);
  const [meios, setMeios] = useState<{ id: number; nome: string }[]>([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'TODOS' | 'COM' | 'SEM'>('TODOS');
  const [filtroMeio, setFiltroMeio] = useState('TODOS');       // filtro da aba
  const [mostrarRemovidos, setMostrarRemovidos] = useState(false);

  // Modal de concessão/edição
  const [modalFunc, setModalFunc] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [formTipo, setFormTipo] = useState('');
  const [formMeio, setFormMeio] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formModalidade, setFormModalidade] = useState<'VALOR_UNICO' | 'POR_DIARIA' | 'DIAS_FIXOS'>('VALOR_UNICO');
  const [formQtdDias, setFormQtdDias] = useState('');
  const [formObs, setFormObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  const { usuarioAtual, emailUsuario, authLoading, acessoNegado, erro, tentarNovamente, accessToken, permissaoBruta } = usePageAccess({ nomeFallback: 'Equipe RH' });

  // O painel já vem restrito à(s) empresa(s) do usuário (query filtrada no
  // servidor); este seletor é só a escolha ADICIONAL de qual empresa ver,
  // útil pro Administrador global, que enxerga as duas.
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>('TODAS');

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    async function carregarEmpresas() {
      const { data } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(data || []);

      if (ehAdministradorGlobal(permissaoBruta)) { setEmpresasPermitidas(null); return; }
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

  const nomeEmpresa = (id: number | null | undefined) =>
    id == null ? '—' : (empresasCatalogo.find(e => e.id === id)?.nome || 'Empresa removida');
  const toast = useToast();

  // Grid consolidado (mês)
  const [mostrarGrid, setMostrarGrid] = useState(false);
  const [gridMes, setGridMes] = useState(() => {
    const h = new Date(); const c = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
  });
  const [grid, setGrid] = useState<{
    diasUteis: number; colunas: string[]; funcionarios: any[]; totaisColuna: Record<string, number>; totalGeral: number;
    jaGerados: Record<string, { em: string; geracaoId: number; pagoEm: string | null }>;
  } | null>(null);
  const [carregandoGrid, setCarregandoGrid] = useState(false);
  const [gerandoBeneficio, setGerandoBeneficio] = useState(false);
  // Mês do Grid que está na tela — o "Gerar Benefício" usa este, não o seletor
  const [gridMesExibido, setGridMesExibido] = useState('');
  // Base dos valores: benefício é pago adiantado, então competência atual ou
  // passada usa o cadastro da virada do mês (o que mudou depois já é do mês
  // seguinte); competência futura usa o cadastro de hoje. O RH pode trocar.
  const baseSugerida = (mes: string): 'INICIO_MES' | 'ATUAL' => {
    const h = new Date();
    const mesAtual = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
    return mes <= mesAtual ? 'INICIO_MES' : 'ATUAL';
  };
  const [gridBase, setGridBase] = useState<'INICIO_MES' | 'ATUAL'>('ATUAL');
  const [gridBaseExibida, setGridBaseExibida] = useState<'INICIO_MES' | 'ATUAL'>('ATUAL');
  // "Já foi pago — só registrar": competência paga por fora (ex.: outubro pago
  // no fim de setembro). Grava o histórico já pago: sem arquivo Flash, sem lote.
  // Data sugerida: último dia do mês anterior à competência (pagamento adiantado).
  const [jaPago, setJaPago] = useState(false);
  const [jaPagoData, setJaPagoData] = useState('');
  const ultimoDiaMesAnterior = (mes: string) => {
    const [a, m] = mes.split('-').map(Number);
    const d = new Date(a, m - 1, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  useEffect(() => { setGridBase(baseSugerida(gridMes)); setJaPagoData(ultimoDiaMesAnterior(gridMes)); }, [gridMes]);
  const gridDesatualizado = gridMes !== gridMesExibido || gridBase !== gridBaseExibida;
  // Quem entra no "Gerar Benefício" (chave = funcionario_nome); nasce tudo
  // marcado a cada Grid, menos quem já teve benefício gerado no mês
  const [gridSelecionados, setGridSelecionados] = useState<Set<string>>(new Set());

  const alternarSelecaoGrid = (nome: string) => {
    setGridSelecionados(prev => {
      const novo = new Set(prev);
      if (novo.has(nome)) novo.delete(nome); else novo.add(nome);
      return novo;
    });
  };

  const alternarTodosGrid = (marcar: boolean) => {
    setGridSelecionados(marcar && grid ? new Set(grid.funcionarios.map((f: any) => f.funcionario_nome)) : new Set());
  };

  // Totais do rodapé recalculados só com os marcados
  const gridTotaisSelecionados = useMemo(() => {
    const totaisColuna: Record<string, number> = {};
    let totalGeral = 0;
    let totalFlash = 0, totalLote = 0;
    if (!grid) return { totaisColuna, totalGeral, totalFlash, totalLote };
    grid.funcionarios.filter((f: any) => gridSelecionados.has(f.funcionario_nome)).forEach((f: any) => {
      grid.colunas.forEach(c => { totaisColuna[c] = (totaisColuna[c] || 0) + (f.valores[c] || 0); });
      totalGeral += f.total;
      totalFlash += f.totalFlash || 0;
      totalLote += f.totalLote || 0;
    });
    return { totaisColuna, totalGeral, totalFlash, totalLote };
  }, [grid, gridSelecionados]);

  // Pedidos Flash do mês — rastreio interno: o "Gerar Benefício" grava o pedido e,
  // depois de pago na plataforma da Flash, o RH confirma aqui. É o que o
  // Resumo de Recebimentos do holerite usa pra dizer se o benefício foi pago.
  const [modalPedidosAberto, setModalPedidosAberto] = useState(false);
  const [pedidosFlash, setPedidosFlash] = useState<any[]>([]);
  const [carregandoPedidos, setCarregandoPedidos] = useState(false);
  const [pedidoExpandido, setPedidoExpandido] = useState<number | null>(null);
  const [dataPagtoPedido, setDataPagtoPedido] = useState<Record<number, string>>({});
  const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const carregarPedidosFlash = async () => {
    setCarregandoPedidos(true);
    try {
      const res = await listarPedidosFlashAction({ mesReferencia: gridMes }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setPedidosFlash(res.info.pedidos);
    } catch (e: any) {
      toast('Erro ao carregar pedidos Flash: ' + e.message, 'error');
    } finally {
      setCarregandoPedidos(false);
    }
  };

  const abrirPedidosFlash = () => { setModalPedidosAberto(true); setPedidoExpandido(null); carregarPedidosFlash(); };

  const confirmarPedidoFlash = async (pedido: any) => {
    const data = dataPagtoPedido[pedido.id] || hojeIso();
    if (!confirm(`Confirmar que o pedido Flash #${pedido.id} (${pedido.qtd_funcionarios} funcionário(s), ${BRL(Number(pedido.valor_total))}) foi PAGO em ${data.split('-').reverse().join('/')}?`)) return;
    const res = await confirmarPagamentoFlashAction({ pedidoId: pedido.id, dataPagamento: data, usuarioNome: usuarioAtual }, accessToken);
    if (!res.ok) { toast(res.erro || 'Erro ao confirmar pagamento.', 'error'); return; }
    toast('Pagamento do pedido Flash confirmado.', 'success');
    carregarPedidosFlash();
  };

  const cancelarPedidoFlash = async (pedido: any) => {
    if (!confirm(`Cancelar o pedido Flash #${pedido.id}? Use quando o arquivo foi gerado mas NÃO vai ser pago.`)) return;
    const res = await cancelarPedidoFlashAction({ pedidoId: pedido.id, usuarioNome: usuarioAtual }, accessToken);
    if (!res.ok) { toast(res.erro || 'Erro ao cancelar pedido.', 'error'); return; }
    carregarPedidosFlash();
  };

  // Arquivo Flash (colunas idênticas à planilha modelo) com as linhas que o
  // servidor gravou no pedido — só é chamado depois do "Gerar Benefício" gravar.
  const baixarArquivoFlash = (selecionadas: any[], pedidoId: number, mes: string) => {
    const cab = ['CNPJ', 'NOME COMPLETO', 'CPF', 'MOBILIDADE (R$)', 'REFEICAO (R$)', 'ALIMENTACAO (R$)', 'PREMIACAO NO CARTAO (R$)', 'REFEICAO E ALIMENTACAO (R$)', 'PREMIACAO VIRTUAL (R$)'];
    const num = (v: number) => v.toFixed(2).replace('.', ',');
    const linhasCsv = selecionadas.map(l => [
      l.cnpj, l.nome, l.cpf,
      num(l.mobilidade), num(l.refeicao), num(l.alimentacao),
      num(l.premiacaoCartao), num(l.refeicaoEAlimentacao), num(l.premiacaoVirtual)
    ].join(';'));

    const csv = '﻿' + [cab.join(';'), ...linhasCsv].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pedido-flash-${mes}-${pedidoId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Gerar Benefício: grava no banco (pedido Flash + parte do lote) e só
  // depois baixa o arquivo Flash. A parte fora do Flash fica disponível em
  // Financeiro RH → fonte Benefícios, na mesma competência.
  const gerarBeneficio = async () => {
    if (!grid || !gridMesExibido) return;
    const mes = gridMesExibido;
    const nomes = grid.funcionarios.filter((f: any) => gridSelecionados.has(f.funcionario_nome)).map((f: any) => f.funcionario_nome);
    if (nomes.length === 0) { toast('Selecione ao menos um funcionário.', 'error'); return; }
    const repetidos = nomes.filter(n => grid.jaGerados?.[n]);
    const t = gridTotaisSelecionados;
    const mesBR = mes.split('-').reverse().join('/');
    if (jaPago && !jaPagoData) { toast('Informe a data em que foi pago.', 'error'); return; }
    const dataPagoBR = jaPagoData.split('-').reverse().join('/');
    const msg = (jaPago
      ? `REGISTRAR como já pagos em ${dataPagoBR} os benefícios de ${mesBR} de ${nomes.length} funcionário(s)?\n\n` +
        `Nenhum arquivo Flash será baixado e nada vai para o lote — só fica o histórico, marcado como pago.\n\n` +
        `⚡ Cartão Flash: ${BRL(t.totalFlash)}\n🏦 Transferência: ${BRL(t.totalLote)}`
      : `Gerar os benefícios de ${mesBR} para ${nomes.length} funcionário(s)?\n\n` +
        `⚡ Cartão Flash: ${BRL(t.totalFlash)} — o arquivo será baixado e o pedido registrado\n` +
        `🏦 Lote de pagamento: ${BRL(t.totalLote)} — fica disponível em Financeiro RH (fonte Benefícios)`) +
      (repetidos.length ? `\n\n⚠ ${repetidos.length} já tiveram benefício gerado neste mês: ${repetidos.join(', ')}` : '');
    if (!confirm(msg)) return;

    setGerandoBeneficio(true);
    try {
      const res = await gerarBeneficioAction({
        mesReferencia: mes, nomes, base: gridBaseExibida, jaPagoEm: jaPago ? jaPagoData : null, usuarioNome: usuarioAtual
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const { pedidoId, linhasFlash, qtdFlash, valorFlash, qtdLote, valorLote } = res.info;
      if (jaPago) {
        toast(`Benefícios de ${mesBR} registrados como pagos em ${dataPagoBR}: ${nomes.length} func., ${BRL(valorFlash + valorLote)}.`, 'success');
      } else {
        if (pedidoId && linhasFlash?.length) baixarArquivoFlash(linhasFlash, pedidoId, mes);
        toast(
          [
            qtdFlash ? `Pedido Flash #${pedidoId}: ${qtdFlash} func., ${BRL(valorFlash)} (confirme o pagamento em "🧾 Pedidos Flash")` : null,
            qtdLote ? `Lote: ${qtdLote} func., ${BRL(valorLote)} disponível em Financeiro RH` : null,
          ].filter(Boolean).join(' · ') || 'Benefícios gerados.',
          'success'
        );
      }
      gerarGrid(); // atualiza os "já gerado"
    } catch (e: any) {
      toast('Benefícios NÃO gerados: ' + e.message, 'error');
    } finally {
      setGerandoBeneficio(false);
    }
  };

  // Histórico
  const [histAberto, setHistAberto] = useState<number | null>(null);
  const [historico, setHistorico] = useState<any[]>([]);

  // Novos catálogos
  const [novoTipo, setNovoTipo] = useState('');
  const [novoMeio, setNovoMeio] = useState('');
  const [mostrarCatalogos, setMostrarCatalogos] = useState(false);

  useEffect(() => {
    if (accessToken) carregar();
  }, [accessToken]);

  const carregar = async () => {
    setLoading(true);
    try {
      const [painel, cats] = await Promise.all([painelBeneficiosAction(accessToken), listarCatalogosBeneficioAction(accessToken)]);
      if (painel.ok) setLinhas(painel.info.linhas);
      if (cats.ok) { setTipos(cats.info.tipos); setMeios(cats.info.meios); }
    } catch (e: any) {
      toast('Erro ao carregar: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // linhas já vem restrita à(s) empresa(s) do usuário (query filtrada no
  // servidor); linhasEscopo aplica por cima a empresa ESCOLHIDA no filtro.
  const linhasEscopo = useMemo(() =>
    filtroEmpresa === 'TODAS' ? linhas : linhas.filter(l => String(l.empresaId) === filtroEmpresa),
    [linhas, filtroEmpresa]);

  const filtradas = useMemo(() => linhasEscopo
    .map(l => {
      // Quando um meio é selecionado, mostra só os benefícios daquele meio
      if (filtroMeio === 'TODOS') return l;
      const fixos = l.beneficiosFixos.filter(b => String(b.meioId) === filtroMeio);
      const removidos = (l.removidos || []).filter(b => String(b.meioId) === filtroMeio);
      return { ...l, beneficiosFixos: fixos, removidos, semNenhum: fixos.length === 0 };
    })
    .filter(l => l.nome.toLowerCase().includes(busca.toLowerCase()))
    .filter(l => {
      // Com filtro de meio ativo, esconde quem ficou sem benefício naquele meio
      if (filtroMeio !== 'TODOS') return l.beneficiosFixos.length > 0 || (mostrarRemovidos && l.removidos.length > 0);
      return filtro === 'TODOS' || (filtro === 'SEM' ? l.semNenhum : !l.semNenhum);
    }),
    [linhasEscopo, busca, filtro, filtroMeio, mostrarRemovidos]);

  const qtdRemovidos = useMemo(() => linhasEscopo.reduce((s, l) => s + (l.removidos?.length || 0), 0), [linhasEscopo]);

  const totais = useMemo(() => ({
    total: linhasEscopo.length,
    sem: linhasEscopo.filter(l => l.semNenhum).length,
    com: linhasEscopo.length - linhasEscopo.filter(l => l.semNenhum).length,
    somaFixos: linhasEscopo.reduce((s, l) => s + l.totalFixos, 0)
  }), [linhasEscopo]);

  const abrirNovo = (nome: string) => {
    setModalFunc(nome); setEditId(null);
    setFormTipo(''); setFormMeio(''); setFormValor(''); setFormModalidade('VALOR_UNICO'); setFormQtdDias(''); setFormObs('');
  };

  // Item 4: editar um benefício já lançado — abre o modal preenchido
  const abrirEdicao = (nome: string, b: LinhaFunc['beneficiosFixos'][0]) => {
    setModalFunc(nome); setEditId(b.id);
    setFormTipo(String(b.tipoId)); setFormMeio(String(b.meioId));
    setFormValor(String(b.valor)); setFormModalidade(b.modalidade as any);
    setFormQtdDias(b.qtdDias ? String(b.qtdDias) : ''); setFormObs(b.observacao || '');
  };

  const salvarBeneficio = async () => {
    if (!formTipo || !formMeio) { toast('Escolha o tipo e o meio de pagamento.', 'error'); return; }
    if (formModalidade === 'DIAS_FIXOS' && (!Number(formQtdDias) || Number(formQtdDias) <= 0)) {
      toast('Informe a quantidade de dias.', 'error'); return;
    }
    setSalvando(true);
    try {
      const res = await salvarBeneficioAction({
        id: editId || undefined,
        funcionarioNome: modalFunc!, tipoId: Number(formTipo), meioId: Number(formMeio),
        valorMensal: Number(formValor) || 0, modalidade: formModalidade,
        qtdDias: formModalidade === 'DIAS_FIXOS' ? Number(formQtdDias) : null,
        observacao: formObs || null, usuarioNome: usuarioAtual
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setModalFunc(null); setEditId(null);
      carregar();
      if (mostrarGrid) gerarGrid();
    } catch (e: any) {
      toast('Erro ao salvar: ' + e.message, 'error');
    } finally {
      setSalvando(false);
    }
  };

  // Grid do mês (todos os meios — o "Gerar Benefício" separa Flash e lote)
  const gerarGrid = async () => {
    setMostrarGrid(true); setCarregandoGrid(true);
    try {
      const mes = gridMes, base = gridBase;
      const res = await gridBeneficiosAction({ mesReferencia: mes, base }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setGrid(res.info);
      setGridMesExibido(mes);
      setGridBaseExibida(base);
      // Já gerado no mês nasce desmarcado (dá pra marcar de novo se precisar)
      const jaGerados = res.info.jaGerados || {};
      setGridSelecionados(new Set(res.info.funcionarios.map((f: any) => f.funcionario_nome).filter((n: string) => !jaGerados[n])));
    } catch (e: any) {
      toast('Erro ao gerar grid: ' + e.message, 'error');
    } finally {
      setCarregandoGrid(false);
    }
  };

  // CSV de conferência (matriz, abre no Excel) — não grava nada
  const exportarCSV = () => {
    if (!grid) return;
    const selecionados = grid.funcionarios.filter((f: any) => gridSelecionados.has(f.funcionario_nome));
    if (selecionados.length === 0) { toast('Selecione ao menos um funcionário.', 'error'); return; }
    const sep = ';';
    const num = (v: number) => (v || 0).toFixed(2).replace('.', ',');
    const cabecalho = ['Funcionário', ...grid.colunas, 'Flash', 'Lote', 'Total'].map(c => `"${c}"`).join(sep);
    const linhas: string[] = [cabecalho];
    selecionados.forEach((f: any) => {
      const cels = [`"${f.funcionario_nome}"`];
      grid.colunas.forEach(c => cels.push(num(f.valores[c])));
      cels.push(num(f.totalFlash), num(f.totalLote), num(f.total));
      linhas.push(cels.join(sep));
    });
    // Rodapé de totais (só dos marcados)
    const rodape = ['"TOTAL"'];
    grid.colunas.forEach(c => rodape.push(num(gridTotaisSelecionados.totaisColuna[c])));
    rodape.push(num(gridTotaisSelecionados.totalFlash), num(gridTotaisSelecionados.totalLote), num(gridTotaisSelecionados.totalGeral));
    linhas.push(rodape.join(sep));

    const csv = '﻿' + linhas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `conferencia-beneficios-${gridMes}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const removerBeneficio = async (id: number, tipo: string, nome: string) => {
    if (!confirm(`Remover o benefício "${tipo}" de ${nome}?\n\nO histórico é preservado.`)) return;
    try {
      const res = await alternarBeneficioAction({ id, ativo: false, usuarioNome: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      carregar();
    } catch (e: any) {
      toast('Erro ao remover: ' + e.message, 'error');
    }
  };

  // Reativa com os mesmos valores de quando foi removido (editar depois, se mudou)
  const reativarBeneficio = async (b: LinhaFunc['beneficiosFixos'][0], nome: string) => {
    const valorTxt = `${BRL(b.valor)}${b.modalidade === 'POR_DIARIA' ? '/dia' : b.modalidade === 'DIAS_FIXOS' ? `/dia ×${b.qtdDias}` : '/mês'}`;
    if (!confirm(`Reativar o benefício "${b.tipo}" de ${nome}?\n\nVolta com os valores de antes: ${valorTxt} via ${b.meio}. Se mudou, edite depois.`)) return;
    try {
      const res = await alternarBeneficioAction({ id: b.id, ativo: true, usuarioNome: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      toast(`"${b.tipo}" reativado para ${nome}.`, 'success');
      carregar();
      if (mostrarGrid) gerarGrid();
    } catch (e: any) {
      toast('Erro ao reativar: ' + e.message, 'error');
    }
  };

  const verHistorico = async (id: number) => {
    setHistAberto(id); setHistorico([]);
    const res = await historicoBeneficioAction({ beneficioId: id }, accessToken);
    if (res.ok) setHistorico(res.info.historico);
  };

  const adicionarTipo = async () => {
    if (!novoTipo.trim()) return;
    const res = await criarTipoBeneficioAction({ nome: novoTipo }, accessToken);
    if (!res.ok) { toast(res.erro || 'Erro ao criar o tipo de benefício.', 'error'); return; }
    setNovoTipo('');
    const cats = await listarCatalogosBeneficioAction(accessToken);
    if (cats.ok) setTipos(cats.info.tipos);
  };

  const adicionarMeio = async () => {
    if (!novoMeio.trim()) return;
    const res = await criarMeioBeneficioAction({ nome: novoMeio }, accessToken);
    if (!res.ok) { toast(res.erro || 'Erro ao criar o meio de pagamento.', 'error'); return; }
    setNovoMeio('');
    const cats = await listarCatalogosBeneficioAction(accessToken);
    if (cats.ok) setMeios(cats.info.meios);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar esta página.</p>
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

      <div className="bg-[#FEF3C7] border-b border-[#FDE68A] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#92400E] font-medium text-sm">
          🎁 <strong>Benefícios</strong>. Controle de VR/VT, vale-alimentação e demais benefícios concedidos.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-amber-50 border border-[#FDE68A] text-[#92400E] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Funcionários</p>
            <p className="text-2xl font-black text-[#0C1D4D]">{totais.total}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Sem nenhum benefício</p>
            <p className={`text-2xl font-black ${totais.sem > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totais.sem}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Com benefício</p>
            <p className={`text-2xl font-black ${totais.com > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{totais.com}</p>
          </div>
        </div>

        {/* Barra de controles */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Buscar funcionário..." value={busca} onChange={e => setBusca(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['TODOS', 'COM', 'SEM'] as const).map(f => (
                <button key={f} onClick={() => setFiltro(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtro === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                  {f === 'TODOS' ? 'Todos' : f === 'COM' ? 'Com benefício' : 'Sem benefício'}
                </button>
              ))}
            </div>
            <select value={filtroMeio} onChange={e => setFiltroMeio(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-[11px] font-black uppercase text-gray-600 bg-[#F8FAFC]">
              <option value="TODOS">Todos os meios</option>
              {meios.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            <button onClick={() => setMostrarRemovidos(v => !v)} title="Benefícios removidos (desativados) — com histórico e opção de reativar"
              className={`px-3 py-2.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all ${mostrarRemovidos ? 'bg-gray-700 text-white border-gray-700' : 'bg-[#F8FAFC] text-gray-500 border-gray-300 hover:bg-gray-100'}`}>
              {mostrarRemovidos ? '🙈 Ocultar removidos' : '👁 Mostrar removidos'} ({qtdRemovidos})
            </button>
            {empresasCatalogoVisivel.length > 1 && (
              <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-[11px] font-black uppercase text-gray-600 bg-[#F8FAFC]">
                <option value="TODAS">🏭 Todas as empresas</option>
                {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            )}
          </div>
          <button onClick={() => setMostrarCatalogos(!mostrarCatalogos)} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2.5 rounded-lg uppercase tracking-wider">
            ⚙ Tipos e Meios
          </button>
          <input type="month" value={gridMes} onChange={e => setGridMes(e.target.value)} title="Competência dos benefícios" className="text-[10px] font-bold p-2.5 border border-gray-300 rounded-lg bg-[#F8FAFC]" />
          <button onClick={gerarGrid} className="text-[10px] font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">
            📊 Gerar Grid
          </button>
          <button onClick={abrirPedidosFlash} title="Pedidos Flash do mês e confirmação de pagamento" className="text-[10px] font-black bg-orange-50 hover:bg-orange-100 text-[#E85A28] border border-orange-200 px-4 py-2.5 rounded-lg uppercase tracking-wider">
            🧾 Pedidos Flash
          </button>
        </div>

        {/* Painel de catálogos (colapsável) */}
        {mostrarCatalogos && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border-2 border-amber-200 mb-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Tipos de benefício</h3>
              <div className="flex gap-2 mb-3">
                <input type="text" value={novoTipo} onChange={e => setNovoTipo(e.target.value)} placeholder="Ex: Auxílio home office" className="flex-1 p-2 border border-gray-300 rounded text-sm uppercase" />
                <button onClick={adicionarTipo} className="bg-[#336699] text-white font-black text-xs px-4 rounded-lg uppercase">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tipos.map(t => <span key={t.id} className="text-[10px] font-black bg-blue-50 text-blue-700 px-2 py-1 rounded uppercase">{t.nome}</span>)}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Meios de pagamento</h3>
              <div className="flex gap-2 mb-3">
                <input type="text" value={novoMeio} onChange={e => setNovoMeio(e.target.value)} placeholder="Ex: Cartão VR" className="flex-1 p-2 border border-gray-300 rounded text-sm uppercase" />
                <button onClick={adicionarMeio} className="bg-[#336699] text-white font-black text-xs px-4 rounded-lg uppercase">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {meios.map(m => <span key={m.id} className="text-[10px] font-black bg-green-50 text-green-700 px-2 py-1 rounded uppercase">{m.nome}</span>)}
              </div>
            </div>
          </div>
        )}

        {/* Tabela principal */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando benefícios...</div>
          ) : filtradas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum funcionário neste filtro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Funcionário</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Benefício</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Meio</th>
                    <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Valor</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider w-28">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((l, idx) => {
                    const zebra = idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white';
                    // Linhas do funcionário: ativos (ou o aviso "sem benefícios")
                    // seguidos dos removidos, quando "Mostrar removidos" está ligado.
                    const removidosVisiveis = mostrarRemovidos ? l.removidos : [];
                    const qtdLinhas = (l.beneficiosFixos.length || 1) + removidosVisiveis.length;
                    const celulaNome = (
                      <td className="p-3 align-top" rowSpan={qtdLinhas}>
                        <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                        <span className="text-[10px] text-gray-400 font-bold uppercase">{l.cargo || '—'}</span>
                        {empresasCatalogoVisivel.length > 1 && (
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase inline-block mt-0.5 ${corSeloEmpresa(l.empresaId)}`}>
                            🏭 {nomeEmpresa(l.empresaId)}
                          </span>
                        )}
                      </td>
                    );
                    const sufixo = (b: LinhaFunc['beneficiosFixos'][0]) =>
                      b.modalidade === 'POR_DIARIA' ? '/dia (úteis)' : b.modalidade === 'DIAS_FIXOS' ? `/dia ×${b.qtdDias}` : '/mês';
                    const bordaFinal = (i: number) => i === qtdLinhas - 1 ? 'border-b border-[#E2E8F0]' : '';

                    return (
                      <Fragment key={l.nome}>
                        {l.beneficiosFixos.length === 0 ? (
                          <tr className={`${zebra} ${bordaFinal(0)}`}>
                            {celulaNome}
                            <td className="p-3 text-[11px] font-black text-amber-500 uppercase" colSpan={3}>⚠ Sem benefícios</td>
                            <td className="p-3 text-center">
                              <button onClick={() => abrirNovo(l.nome)} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg uppercase">+ Add</button>
                            </td>
                          </tr>
                        ) : (
                          l.beneficiosFixos.map((b, bi) => (
                            <tr key={b.id} className={`${zebra} ${bordaFinal(bi)}`}>
                              {bi === 0 && celulaNome}
                              <td className="p-3 text-[11px] font-black text-indigo-700 uppercase whitespace-nowrap">{b.tipo}</td>
                              <td className="p-3 text-[11px] font-bold text-gray-500 uppercase whitespace-nowrap">{b.meio}</td>
                              <td className="p-3 text-right tabular-nums whitespace-nowrap">
                                <span className="font-black text-[#0C1D4D]">{BRL(b.valor)}</span>
                                <span className="text-[9px] text-gray-400 font-bold ml-1">{sufixo(b)}</span>
                              </td>
                              <td className="p-3 text-center whitespace-nowrap">
                                <button onClick={() => abrirEdicao(l.nome, b)} title="Editar" className="text-gray-400 hover:text-indigo-600 px-1">✏️</button>
                                <button onClick={() => verHistorico(b.id)} title="Histórico" className="text-gray-400 hover:text-indigo-600 px-1">🕐</button>
                                <button onClick={() => removerBeneficio(b.id, b.tipo, l.nome)} title="Remover" className="text-gray-400 hover:text-red-600 px-1">✕</button>
                                {bi === 0 && <button onClick={() => abrirNovo(l.nome)} title="Adicionar" className="text-gray-400 hover:text-emerald-600 px-1 font-black">+</button>}
                              </td>
                            </tr>
                          ))
                        )}
                        {removidosVisiveis.map((b, ri) => (
                          <tr key={`rem-${b.id}`} className={`${zebra} ${bordaFinal((l.beneficiosFixos.length || 1) + ri)} opacity-60`}>
                            <td className="p-3 text-[11px] font-black text-gray-400 uppercase whitespace-nowrap">
                              <span className="line-through">{b.tipo}</span>
                              <span className="ml-2 text-[9px] font-black bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded no-underline">
                                REMOVIDO{b.removidoEm ? ` ${new Date(b.removidoEm).toLocaleDateString('pt-BR')}` : ''}
                              </span>
                            </td>
                            <td className="p-3 text-[11px] font-bold text-gray-400 uppercase whitespace-nowrap">{b.meio}</td>
                            <td className="p-3 text-right tabular-nums whitespace-nowrap text-gray-400">
                              <span className="font-black line-through">{BRL(b.valor)}</span>
                              <span className="text-[9px] font-bold ml-1">{sufixo(b)}</span>
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">
                              <button onClick={() => verHistorico(b.id)} title="Histórico" className="text-gray-400 hover:text-indigo-600 px-1">🕐</button>
                              <button onClick={() => reativarBeneficio(b, l.nome)} title="Reativar com os valores de antes" className="text-[9px] font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-1 rounded uppercase ml-1">↺ Reativar</button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 font-medium mt-4 text-center">
          VR e VT vêm da configuração de contrato e da ficha (calculados por dia no holerite). Os demais benefícios são fixos mensais, gerenciados aqui.
        </p>
      </div>

      {/* Modal do GRID consolidado */}
      {mostrarGrid && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setMostrarGrid(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap justify-between items-center gap-3 p-5 border-b border-gray-200">
              <div>
                <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">📊 Grid de Benefícios — {gridMesExibido.split('-').reverse().join('/')}</h2>
                <p className="text-sm text-gray-500">
                  {grid ? `${grid.diasUteis} dias úteis no mês · ${gridSelecionados.size} de ${grid.funcionarios.length} selecionado(s). Desmarque quem não deve receber.` : 'Carregando...'}
                </p>
                {grid && (
                  <p className="text-[11px] font-bold text-indigo-600">
                    Valores: {gridBaseExibida === 'INICIO_MES'
                      ? `cadastro como estava em 01/${gridMesExibido.slice(5)}/${gridMesExibido.slice(0, 4)} (alterações feitas depois não entram)`
                      : 'cadastro atual (todas as alterações até agora)'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input type="month" value={gridMes} onChange={e => setGridMes(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                <select value={gridBase} onChange={e => setGridBase(e.target.value as 'INICIO_MES' | 'ATUAL')}
                  title="Benefício é pago adiantado: para a competência atual/passada, o padrão é o cadastro da virada do mês"
                  className="p-2 border border-gray-300 rounded-lg text-[11px] font-black uppercase text-gray-600 bg-[#F8FAFC]">
                  <option value="INICIO_MES">Cadastro em 01/{gridMes.slice(5)}</option>
                  <option value="ATUAL">Cadastro atual</option>
                </select>
                <button onClick={gerarGrid} className={`text-[10px] font-black text-white px-3 py-2 rounded-lg uppercase ${gridDesatualizado ? 'bg-amber-500 animate-pulse' : 'bg-[#336699]'}`}>Atualizar</button>
                <button onClick={exportarCSV} disabled={!grid || gridSelecionados.size === 0} title="Planilha só para conferência — não grava nada" className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-2 rounded-lg uppercase disabled:opacity-50">⬇ Conferência</button>
                <label title="Competência já paga por fora: grava só o histórico, marcado como pago — sem arquivo Flash e sem lote"
                  className={`flex items-center gap-1.5 text-[10px] font-black uppercase px-2 py-1.5 rounded-lg border cursor-pointer ${jaPago ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-gray-300 text-gray-500'}`}>
                  <input type="checkbox" checked={jaPago} onChange={e => setJaPago(e.target.checked)} className="w-3.5 h-3.5" />
                  Já foi pago
                  {jaPago && (
                    <input type="date" value={jaPagoData} onChange={e => setJaPagoData(e.target.value)}
                      className="ml-1 p-1 border border-amber-300 rounded text-[11px] font-bold bg-white normal-case" />
                  )}
                </label>
                <button onClick={gerarBeneficio} disabled={!grid || gridSelecionados.size === 0 || gerandoBeneficio || carregandoGrid || gridDesatualizado}
                  title={gridDesatualizado ? 'Mês ou base alterados — clique em Atualizar antes de gerar'
                    : jaPago ? 'Grava o histórico já pago (sem arquivo Flash, sem lote)'
                      : 'Grava no banco, baixa o arquivo Flash e deixa o restante para o lote do Financeiro RH'}
                  className={`text-[10px] font-black text-white px-4 py-2 rounded-lg uppercase disabled:opacity-50 ${jaPago ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                  {gerandoBeneficio ? '⏳ Gerando...' : jaPago ? `📝 Registrar como pago (${gridSelecionados.size})` : `✓ Gerar Benefício (${gridSelecionados.size})`}
                </button>
                <button onClick={() => setMostrarGrid(false)} className="text-[10px] font-black bg-gray-100 px-3 py-2 rounded-lg uppercase">Fechar</button>
              </div>
            </div>

            <div className="overflow-auto p-5">
              {carregandoGrid ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Calculando...</p>
              ) : !grid || grid.funcionarios.length === 0 ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Nenhum benefício cadastrado.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#0C1D4D] text-white">
                      <th className="p-2.5 text-left font-black uppercase text-[10px] tracking-wider sticky left-0 bg-[#0C1D4D] z-10">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={gridSelecionados.size === grid.funcionarios.length}
                            onChange={e => alternarTodosGrid(e.target.checked)} title="Marcar / desmarcar todos" className="w-4 h-4" />
                          Funcionário
                        </label>
                      </th>
                      {grid.colunas.map(c => (
                        <th key={c} className="p-2.5 text-right font-black uppercase text-[10px] tracking-wider whitespace-nowrap">{c}</th>
                      ))}
                      <th className="p-2.5 text-right font-black uppercase text-[10px] tracking-wider whitespace-nowrap bg-[#E85A28]" title="Vai no arquivo Flash">⚡ Flash</th>
                      <th className="p-2.5 text-right font-black uppercase text-[10px] tracking-wider whitespace-nowrap bg-emerald-700" title="Fica para o lote do Financeiro RH (fonte Benefícios)">🏦 Lote</th>
                      <th className="p-2.5 text-right font-black uppercase text-[10px] tracking-wider bg-indigo-700">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.funcionarios.map((f: any, idx: number) => {
                      const marcado = gridSelecionados.has(f.funcionario_nome);
                      return (
                      <tr key={f.funcionario_nome} className={`group ${idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'} ${!marcado ? 'opacity-40' : ''}`}>
                        <td className={`p-2.5 font-black text-[#0C1D4D] whitespace-nowrap sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`}>
                          <div className="flex items-center gap-2">
                            <input type="checkbox" checked={marcado} onChange={() => alternarSelecaoGrid(f.funcionario_nome)} className="w-4 h-4 cursor-pointer" />
                            <span className="cursor-pointer" onClick={() => alternarSelecaoGrid(f.funcionario_nome)}>{f.funcionario_nome}</span>
                            {grid.jaGerados?.[f.funcionario_nome] && (
                              <span title="Já teve benefício gerado nesta competência — marque de novo só se for gerar outra vez"
                                className="text-[9px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase">
                                {grid.jaGerados[f.funcionario_nome].pagoEm
                                  ? `✓ registrado pago ${String(grid.jaGerados[f.funcionario_nome].pagoEm).split('-').reverse().join('/')}`
                                  : `⚠ já gerado ${new Date(grid.jaGerados[f.funcionario_nome].em).toLocaleDateString('pt-BR')}`}
                              </span>
                            )}
                            <button onClick={() => setGridSelecionados(new Set([f.funcionario_nome]))} title="Deixar só este funcionário selecionado"
                              className="opacity-0 group-hover:opacity-100 text-[9px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded uppercase">
                              só este
                            </button>
                          </div>
                        </td>
                        {grid.colunas.map(c => (
                          <td key={c} className="p-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                            {f.valores[c] ? (
                              <>
                                {f.detalhes?.[c] && <span className="text-[9px] text-gray-400 font-medium mr-1.5">{f.detalhes[c]}</span>}
                                {BRL(f.valores[c])}
                              </>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                        <td className="p-2.5 text-right font-bold text-[#E85A28] tabular-nums whitespace-nowrap bg-orange-50/50">{f.totalFlash ? BRL(f.totalFlash) : <span className="text-gray-300">—</span>}</td>
                        <td className="p-2.5 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap bg-emerald-50/50">{f.totalLote ? BRL(f.totalLote) : <span className="text-gray-300">—</span>}</td>
                        <td className="p-2.5 text-right font-black text-indigo-700 tabular-nums whitespace-nowrap bg-indigo-50/50">{BRL(f.total)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#F8FAFC] border-t-2 border-[#0C1D4D]">
                      <td className="p-2.5 font-black text-[#0C1D4D] uppercase text-[11px] sticky left-0 bg-[#F8FAFC] z-10">Total</td>
                      {grid.colunas.map(c => (
                        <td key={c} className="p-2.5 text-right font-black text-[#0C1D4D] tabular-nums whitespace-nowrap">{BRL(gridTotaisSelecionados.totaisColuna[c] || 0)}</td>
                      ))}
                      <td className="p-2.5 text-right font-black text-[#E85A28] tabular-nums whitespace-nowrap bg-orange-100">{BRL(gridTotaisSelecionados.totalFlash)}</td>
                      <td className="p-2.5 text-right font-black text-emerald-700 tabular-nums whitespace-nowrap bg-emerald-100">{BRL(gridTotaisSelecionados.totalLote)}</td>
                      <td className="p-2.5 text-right font-black text-indigo-700 text-base tabular-nums whitespace-nowrap bg-indigo-100">{BRL(gridTotaisSelecionados.totalGeral)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal dos pedidos Flash (confirmação de pagamento) */}
      {modalPedidosAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalPedidosAberto(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 border-b border-gray-200">
              <div>
                <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">🧾 Pedidos Flash — {gridMes}</h2>
                <p className="text-sm text-gray-500">Cada &quot;Gerar Benefício&quot; com Cartão Flash gera um pedido. Depois de pagar na plataforma da Flash, confirme aqui. Cancelar libera a pessoa para gerar de novo.</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="month" value={gridMes} onChange={e => setGridMes(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                <button onClick={carregarPedidosFlash} className="text-[10px] font-black bg-[#336699] text-white px-3 py-2 rounded-lg uppercase">Atualizar</button>
                <button onClick={() => setModalPedidosAberto(false)} className="text-[10px] font-black bg-gray-100 px-3 py-2 rounded-lg uppercase">Fechar</button>
              </div>
            </div>

            <div className="overflow-auto p-5 flex-1 space-y-3">
              {carregandoPedidos ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Carregando...</p>
              ) : pedidosFlash.length === 0 ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Nenhum pedido Flash gerado neste mês.</p>
              ) : pedidosFlash.map(pd => {
                const itensPedido: any[] = Array.isArray(pd.itens) ? pd.itens : [];
                const corStatus = pd.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : pd.status === 'CANCELADO' ? 'bg-gray-100 text-gray-400' : 'bg-amber-100 text-amber-700';
                return (
                  <div key={pd.id} className={`border border-[#E2E8F0] rounded-xl ${pd.status === 'CANCELADO' ? 'opacity-50' : ''}`}>
                    <div className="flex flex-wrap items-center gap-3 p-3">
                      <span className={`text-[10px] font-black px-2 py-1 rounded uppercase ${corStatus}`}>
                        {pd.status === 'PAGO' ? `✓ Pago em ${String(pd.pago_em).split('-').reverse().join('/')}` : pd.status === 'CANCELADO' ? 'Cancelado' : 'Aguardando pagamento'}
                      </span>
                      <div className="flex-1 min-w-[180px]">
                        <span className="font-black text-[#0C1D4D] text-sm">Pedido #{pd.id}</span>
                        <span className="text-[11px] text-gray-500 ml-2">
                          {pd.qtd_funcionarios} funcionário(s) · {BRL(Number(pd.valor_total))} · gerado {new Date(pd.gerado_em).toLocaleString('pt-BR')}{pd.gerado_por ? ` por ${pd.gerado_por}` : ''}
                        </span>
                        {pd.status === 'PAGO' && pd.confirmado_por && <span className="block text-[10px] text-gray-400">Confirmado por {pd.confirmado_por}</span>}
                      </div>
                      <button onClick={() => setPedidoExpandido(pedidoExpandido === pd.id ? null : pd.id)} className="text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg uppercase">
                        {pedidoExpandido === pd.id ? 'Ocultar' : 'Ver nomes'}
                      </button>
                      {pd.status === 'GERADO' && (
                        <>
                          <input type="date" value={dataPagtoPedido[pd.id] || hojeIso()} onChange={e => setDataPagtoPedido(prev => ({ ...prev, [pd.id]: e.target.value }))}
                            title="Data em que o pedido foi pago na Flash" className="p-1.5 border border-gray-300 rounded-lg text-[11px] font-bold bg-[#F8FAFC]" />
                          <button onClick={() => confirmarPedidoFlash(pd)} className="text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg uppercase">✓ Confirmar pagamento</button>
                          <button onClick={() => cancelarPedidoFlash(pd)} title="Arquivo gerado mas não vai ser pago" className="text-[10px] font-black text-gray-500 hover:text-red-600 px-2 py-1.5 uppercase">Cancelar</button>
                        </>
                      )}
                    </div>
                    {pedidoExpandido === pd.id && (
                      <table className="w-full text-sm border-collapse border-t border-[#E2E8F0]">
                        <tbody>
                          {itensPedido.map((l, idx) => (
                            <tr key={l.cpf || l.nome} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}>
                              <td className="p-2 pl-4 font-black text-[#0C1D4D] whitespace-nowrap">{l.nome}</td>
                              <td className="p-2 text-gray-500 whitespace-nowrap">{l.cpf}</td>
                              <td className="p-2 pr-4 text-right font-black text-indigo-700 tabular-nums whitespace-nowrap">{BRL(Number(l.total))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Modal de concessão */}
      {modalFunc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalFunc(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{editId ? 'Editar benefício' : 'Conceder benefício'}</h2>
            <p className="text-sm text-gray-500 mb-4">{modalFunc}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Tipo</label>
                <select value={formTipo} onChange={e => setFormTipo(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Meio de pagamento</label>
                <select value={formMeio} onChange={e => setFormMeio(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {meios.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Modalidade</label>
                <div className="grid grid-cols-3 gap-2">
                  {([['VALOR_UNICO', 'Valor único'], ['POR_DIARIA', 'Dias úteis'], ['DIAS_FIXOS', 'Dias fixos']] as const).map(([val, lbl]) => (
                    <button key={val} type="button" onClick={() => setFormModalidade(val)} className={`p-2 rounded-lg text-[10px] font-black uppercase tracking-wider border-2 transition-all ${formModalidade === val ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-400'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">
                    {formModalidade === 'VALOR_UNICO' ? 'Valor mensal (R$)' : 'Valor da diária (R$)'}
                  </label>
                  <input type="number" step="0.01" value={formValor} onChange={e => setFormValor(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                </div>
                {formModalidade === 'DIAS_FIXOS' && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Qtd. de dias</label>
                    <input type="number" step="1" value={formQtdDias} onChange={e => setFormQtdDias(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                  </div>
                )}
              </div>
              {formModalidade === 'POR_DIARIA' && <p className="text-[10px] font-bold text-indigo-500 uppercase">Total do mês = diária × dias úteis (calculado por mês no grid/relatório).</p>}
              {formModalidade === 'DIAS_FIXOS' && Number(formValor) > 0 && Number(formQtdDias) > 0 && (
                <p className="text-[10px] font-bold text-indigo-600 uppercase">Total: {BRL(Number(formValor) * Number(formQtdDias))} ({BRL(Number(formValor))}/dia × {formQtdDias} dias)</p>
              )}
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Observação (opcional)</label>
                <input type="text" value={formObs} onChange={e => setFormObs(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => { setModalFunc(null); setEditId(null); }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarBeneficio} disabled={salvando} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl disabled:opacity-50">
                {salvando ? 'Salvando...' : editId ? 'Salvar' : 'Conceder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de histórico */}
      {histAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setHistAberto(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">Histórico do benefício</h2>
              <button onClick={() => setHistAberto(null)} className="text-[10px] font-black bg-gray-100 px-3 py-1.5 rounded-lg uppercase">Fechar</button>
            </div>
            {historico.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sem registros.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {historico.map(h => (
                  <div key={h.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-black text-[#0C1D4D] uppercase text-[11px]">{h.acao.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-gray-400 font-bold">{new Date(h.alterado_em).toLocaleString('pt-BR')}</span>
                    </div>
                    {h.acao === 'VALOR_ALTERADO' && <p className="text-[11px] text-gray-600 mt-1">{BRL(Number(h.valor_anterior))} → <strong>{BRL(Number(h.valor_novo))}</strong></p>}
                    {h.acao === 'MEIO_ALTERADO' && <p className="text-[11px] text-gray-600 mt-1">{h.meio_anterior} → <strong>{h.meio_novo}</strong></p>}
                    {h.acao === 'MODALIDADE_ALTERADA' && (() => {
                      const rotulo = (m: string | null, d: number | null) => m === 'POR_DIARIA' ? 'por diária' : m === 'DIAS_FIXOS' ? `dias fixos ×${d ?? '?'}` : 'valor único (mês)';
                      return <p className="text-[11px] text-gray-600 mt-1">{rotulo(h.modalidade_anterior, h.qtd_dias_anterior)} → <strong>{rotulo(h.modalidade_nova, h.qtd_dias_novo)}</strong></p>;
                    })()}
                    {h.acao === 'CRIADO' && <p className="text-[11px] text-gray-600 mt-1">Criado com {BRL(Number(h.valor_novo))} via {h.meio_novo}</p>}
                    {h.alterado_por && <p className="text-[10px] text-gray-400 mt-1">por {h.alterado_por}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
