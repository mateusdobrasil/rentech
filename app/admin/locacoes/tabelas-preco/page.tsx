"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarTabelasPrecoAction, salvarTabelaPrecoAction, excluirTabelaPrecoAction, duplicarTabelaPrecoAction,
  carregarTabelaPrecoAction, salvarPrecosTabelaAction, removerProdutosTabelaAction,
  buscarProdutosLocacaoAction, buscarClientesAction, buscarEventosAction, importarTabelasP2sAction,
  type DadosTabelaPreco, type LinhaPrecoEntrada,
} from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import CampoBusca, { type OpcaoBusca } from '../../../components/ui/CampoBusca';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { calcularPrecoPorFaixas, faixasIncoerentes, tabelaVigente, type FaixaPreco, type TipoTabelaPreco } from '../../../lib/locacao/preco';
import { hojeISO } from '../../../lib/locacao/datas';

// Tabelas de Preço da locação (2026-11-16). Uma tabela tem produtos; cada
// produto tem faixas de dias (o valor é a DIÁRIA da faixa), diária extra e
// valor mensal. Regra de cálculo em app/lib/locacao/preco.ts.

interface EmpresaOpcao { id: number; nome: string }
interface TabelaLista {
  id: number; nome: string; tipo: TipoTabelaPreco; empresa_id: number;
  parceiro_id: number | null; evento_id: string | null; parceiro_nome: string | null; evento_nome: string | null;
  vigencia_inicio: string | null; vigencia_fim: string | null; ativa: boolean; observacoes: string | null;
  qtd_produtos: number; p2s_origem: string | null; updated_at: string;
}
interface LinhaGrade {
  produto_id: number; nome: string; codigo: string | null; unidade: string | null; categoria: string | null;
  em_desuso: boolean; valor_indenizacao: number | null;
  faixas: Record<string, string>; extra: string; mensal: string;
  novo: boolean; alterado: boolean;
}

const ROTULO_TIPO: Record<TipoTabelaPreco, string> = { PADRAO: 'Padrão', CLIENTE: 'Cliente', EVENTO: 'Evento/Feira' };
const COR_TIPO: Record<TipoTabelaPreco, string> = {
  PADRAO: 'bg-slate-100 text-slate-700', CLIENTE: 'bg-amber-100 text-amber-700', EVENTO: 'bg-violet-100 text-violet-700',
};

// "1.234,56" / "1234,56" / "1234.56" → 1234.56 ; vazio → null ; inválido → NaN
function lerValor(s: string): number | null {
  const t = (s || '').replace(/\s|R\$/g, '');
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}
// Faixas válidas da linha da grade (ignora célula vazia ou inválida).
function faixasDaLinha(l: { faixas: Record<string, string> }): FaixaPreco[] {
  return Object.entries(l.faixas)
    .map(([d, s]) => ({ dias: Number(d), valor_diaria: lerValor(s) }))
    .filter((f): f is FaixaPreco => f.valor_diaria !== null && !Number.isNaN(f.valor_diaria));
}
const mostrarValor = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


// ============================================================================
// PÁGINA
// ============================================================================
export default function TabelasPrecoPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  // ---------------- lista ----------------
  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [tabelas, setTabelas] = useState<TabelaLista[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<TipoTabelaPreco | ''>('');
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [importando, setImportando] = useState(false);

  // ---------------- cabeçalho (modal) ----------------
  const [modalCabecalho, setModalCabecalho] = useState(false);
  const [form, setForm] = useState<DadosTabelaPreco>({ nome: '', tipo: 'PADRAO', empresa_id: 0, ativa: true });
  const [clienteForm, setClienteForm] = useState<OpcaoBusca | null>(null);
  const [eventoForm, setEventoForm] = useState<OpcaoBusca | null>(null);
  const [salvandoCabecalho, setSalvandoCabecalho] = useState(false);

  // ---------------- duplicar (modal) ----------------
  const [modalDuplicar, setModalDuplicar] = useState<TabelaLista | null>(null);
  const [dup, setDup] = useState({ nome: '', reajuste: '0', inicio: '', fim: '' });
  const [duplicando, setDuplicando] = useState(false);

  // ---------------- editor ----------------
  const [aberta, setAberta] = useState<TabelaLista | null>(null);
  const [linhas, setLinhas] = useState<LinhaGrade[]>([]);
  const [faixasExtras, setFaixasExtras] = useState<string[]>([]);
  const [carregandoGrade, setCarregandoGrade] = useState(false);
  const [salvandoGrade, setSalvandoGrade] = useState(false);
  const [filtroGrade, setFiltroGrade] = useState('');
  const [diasSimulacao, setDiasSimulacao] = useState('');
  const [soAlertas, setSoAlertas] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [modalProdutos, setModalProdutos] = useState(false);

  const nomeEmpresa = (id: number) => empresas.find(e => e.id === id)?.nome || `Empresa ${id}`;

  const carregarLista = async () => {
    setCarregandoLista(true);
    const r = await listarTabelasPrecoAction(accessToken);
    if (r.ok) {
      setEmpresas(r.info.empresas);
      setTabelas(r.info.tabelas);
    } else toast(r.erro || 'Erro ao carregar as tabelas.', 'error');
    setCarregandoLista(false);
  };

  useEffect(() => {
    if (!authLoading && !acessoNegado && !erro && accessToken) carregarLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken]);

  // Funções de busca estáveis (o CampoBusca depende delas no useEffect).
  const buscarClientes = useMemo(() => async (t: string) => {
    const r = await buscarClientesAction(t, accessToken); return r.ok ? r.info : [];
  }, [accessToken]);
  const buscarEventos = useMemo(() => async (t: string) => {
    const r = await buscarEventosAction(t, accessToken); return r.ok ? r.info : [];
  }, [accessToken]);

  const hoje = hojeISO();
  const tabelasFiltradas = tabelas.filter(t =>
    (filtroEmpresa === null || t.empresa_id === filtroEmpresa) &&
    (!filtroTipo || t.tipo === filtroTipo) &&
    (mostrarInativas || t.ativa));

  // ---------------- ações da lista ----------------
  const abrirNovaTabela = () => {
    setForm({ nome: '', tipo: 'PADRAO', empresa_id: filtroEmpresa || empresas[0]?.id || 0, ativa: true, vigencia_inicio: '', vigencia_fim: '', observacoes: '' });
    setClienteForm(null); setEventoForm(null);
    setModalCabecalho(true);
  };

  const abrirEdicaoCabecalho = (t: TabelaLista) => {
    setForm({
      id: t.id, nome: t.nome, tipo: t.tipo, empresa_id: t.empresa_id, parceiro_id: t.parceiro_id, evento_id: t.evento_id,
      vigencia_inicio: t.vigencia_inicio || '', vigencia_fim: t.vigencia_fim || '', ativa: t.ativa, observacoes: t.observacoes || '',
    });
    setClienteForm(t.parceiro_id ? { id: t.parceiro_id, nome: t.parceiro_nome || `Cliente #${t.parceiro_id}` } : null);
    setEventoForm(t.evento_id ? { id: t.evento_id, nome: t.evento_nome || 'Evento' } : null);
    setModalCabecalho(true);
  };

  const salvarCabecalho = async () => {
    setSalvandoCabecalho(true);
    const r = await salvarTabelaPrecoAction({
      ...form,
      parceiro_id: clienteForm ? Number(clienteForm.id) : null,
      evento_id: eventoForm ? String(eventoForm.id) : null,
    }, accessToken);
    setSalvandoCabecalho(false);
    if (!r.ok) return toast(r.erro || 'Erro ao salvar a tabela.', 'error');
    toast(form.id ? 'Tabela atualizada.' : 'Tabela criada.', 'success');
    setModalCabecalho(false);
    await carregarLista();
    if (!form.id) {
      // tabela nova: abre direto o editor de preços
      const lista = await listarTabelasPrecoAction(accessToken);
      const nova = lista.ok ? (lista.info.tabelas as TabelaLista[]).find(t => t.id === r.info.id) : null;
      if (nova) abrirTabela(nova);
    } else if (aberta?.id === form.id) {
      const lista = await listarTabelasPrecoAction(accessToken);
      const atual = lista.ok ? (lista.info.tabelas as TabelaLista[]).find(t => t.id === form.id) : null;
      if (atual) setAberta(atual);
    }
  };

  const excluirTabela = async (t: TabelaLista) => {
    const ok = await confirmar({
      title: 'Excluir tabela', danger: true, confirmLabel: 'Excluir',
      message: `Excluir a tabela "${t.nome}" e todos os seus ${t.qtd_produtos} preço(s)? Isso não pode ser desfeito.`,
    });
    if (!ok) return;
    const r = await excluirTabelaPrecoAction(t.id, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro ao excluir.', 'error');
    toast('Tabela excluída.', 'success');
    if (aberta?.id === t.id) fecharEditor(true);
    carregarLista();
  };

  const abrirDuplicar = (t: TabelaLista) => {
    setDup({ nome: `${t.nome} (cópia)`, reajuste: '0', inicio: '', fim: '' });
    setModalDuplicar(t);
  };

  const confirmarDuplicar = async () => {
    if (!modalDuplicar) return;
    const pct = lerValor(dup.reajuste);
    if (pct !== null && Number.isNaN(pct)) return toast('Reajuste inválido.', 'error');
    setDuplicando(true);
    const r = await duplicarTabelaPrecoAction(modalDuplicar.id, {
      nome: dup.nome, reajustePct: pct || 0, vigencia_inicio: dup.inicio || null, vigencia_fim: dup.fim || null,
    }, accessToken);
    setDuplicando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao duplicar.', 'error');
    toast('Tabela duplicada.', 'success');
    setModalDuplicar(null);
    carregarLista();
  };

  const importarP2s = async () => {
    const ok = await confirmar({
      title: 'Importar preços do P2S',
      confirmLabel: 'Importar',
      message: 'Cria (ou atualiza) as tabelas "Padrão Rentech" (faixas de 1 a 5 diárias) e "Padrão Alfa Light" a partir dos preços do PrimeStart, e grava o valor de indenização dos produtos. Se essas tabelas já foram importadas antes, os preços delas são SUBSTITUÍDOS pelos do P2S. Tabelas criadas à mão não são alteradas.',
    });
    if (!ok) return;
    setImportando(true);
    const r = await importarTabelasP2sAction(accessToken);
    setImportando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao importar.', 'error');
    const partes = (r.info.resumo as any[]).map(x => `${x.tabela}: ${x.produtos} produtos (faixas ${x.faixas.join(', ')})`);
    toast(`Importação concluída. ${partes.join(' · ')} · Indenização em ${r.info.indenizacoes} produto(s).`, 'success');
    for (const a of r.info.avisos as string[]) toast(a, 'info');
    carregarLista();
  };

  // ---------------- editor ----------------
  const alteracoesPendentes = linhas.some(l => l.alterado);

  const abrirTabela = async (t: TabelaLista) => {
    setAberta(t);
    setCarregandoGrade(true);
    setLinhas([]); setFaixasExtras([]); setSelecionados(new Set()); setFiltroGrade('');
    const r = await carregarTabelaPrecoAction(t.id, accessToken);
    setCarregandoGrade(false);
    if (!r.ok) { toast(r.erro || 'Erro ao carregar a tabela.', 'error'); return; }
    setLinhas((r.info.linhas as any[]).map(l => ({
      produto_id: l.produto_id, nome: l.nome, codigo: l.codigo, unidade: l.unidade, categoria: l.categoria,
      em_desuso: l.em_desuso, valor_indenizacao: l.valor_indenizacao,
      faixas: Object.fromEntries(Object.entries(l.faixas as Record<string, number>).map(([d, v]) => [d, mostrarValor(v)])),
      extra: mostrarValor(l.valor_diaria_extra), mensal: mostrarValor(l.valor_mensal),
      novo: false, alterado: false,
    })));
  };

  const fecharEditor = async (forcar = false) => {
    if (!forcar && alteracoesPendentes) {
      const ok = await confirmar({ title: 'Alterações não salvas', message: 'Há preços alterados que não foram salvos. Sair mesmo assim?', confirmLabel: 'Sair sem salvar', danger: true });
      if (!ok) return;
    }
    setAberta(null); setLinhas([]);
    carregarLista();
  };

  const colunasFaixa = useMemo(() => {
    const s = new Set<string>(faixasExtras);
    for (const l of linhas) for (const [d, v] of Object.entries(l.faixas)) if (v !== '') s.add(d);
    return [...s].sort((a, b) => Number(a) - Number(b));
  }, [linhas, faixasExtras]);

  const editarCelula = (produtoId: number, campo: 'extra' | 'mensal' | { faixa: string }, valor: string) => {
    setLinhas(prev => prev.map(l => {
      if (l.produto_id !== produtoId) return l;
      if (typeof campo === 'object') return { ...l, faixas: { ...l.faixas, [campo.faixa]: valor }, alterado: true };
      return { ...l, [campo]: valor, alterado: true };
    }));
  };

  const adicionarFaixa = async () => {
    const r = await pedir({ title: 'Nova faixa de dias', message: 'A partir de quantos dias vale esta faixa? (ex.: 3)', placeholder: '3' });
    if (r === null) return;
    const d = Number(r.trim());
    if (!Number.isInteger(d) || d < 1 || d > 365) return toast('Informe um número inteiro de dias entre 1 e 365.', 'error');
    if (colunasFaixa.includes(String(d))) return toast(`A faixa de ${d} dia(s) já existe.`, 'info');
    setFaixasExtras(prev => [...prev, String(d)]);
  };

  const removerFaixa = async (dias: string) => {
    const comValor = linhas.filter(l => (l.faixas[dias] || '') !== '').length;
    if (comValor > 0) {
      const ok = await confirmar({
        title: `Remover faixa de ${dias} dia(s)`, danger: true, confirmLabel: 'Remover',
        message: `${comValor} produto(s) têm preço nesta faixa. Os valores serão apagados quando você salvar.`,
      });
      if (!ok) return;
    }
    setFaixasExtras(prev => prev.filter(d => d !== dias));
    setLinhas(prev => prev.map(l => {
      if ((l.faixas[dias] || '') === '') return l;
      const f = { ...l.faixas }; delete f[dias];
      return { ...l, faixas: f, alterado: true };
    }));
  };

  const salvarGrade = async () => {
    if (!aberta) return;
    const alteradas = linhas.filter(l => l.alterado);
    const entrada: LinhaPrecoEntrada[] = [];
    for (const l of alteradas) {
      const faixas: Record<string, number | null> = {};
      for (const [d, s] of Object.entries(l.faixas)) {
        const v = lerValor(s);
        if (Number.isNaN(v)) return toast(`Valor inválido em "${l.nome}", faixa de ${d} dia(s).`, 'error');
        faixas[d] = v;
      }
      const extra = lerValor(l.extra), mensal = lerValor(l.mensal);
      if (Number.isNaN(extra) || Number.isNaN(mensal)) return toast(`Valor inválido em "${l.nome}".`, 'error');
      entrada.push({ produto_id: l.produto_id, faixas, valor_diaria_extra: extra, valor_mensal: mensal });
    }
    setSalvandoGrade(true);
    const r = await salvarPrecosTabelaAction(aberta.id, entrada, accessToken);
    setSalvandoGrade(false);
    if (!r.ok) return toast(r.erro || 'Erro ao salvar os preços.', 'error');
    toast(`${r.info.salvos} produto(s) salvos.`, 'success');
    setFaixasExtras([]);
    abrirTabela(aberta);
  };

  const descartarGrade = async () => {
    if (!aberta) return;
    const ok = await confirmar({ title: 'Descartar alterações', message: 'Voltar os preços para o que está salvo?', confirmLabel: 'Descartar', danger: true });
    if (ok) abrirTabela(aberta);
  };

  const removerSelecionados = async () => {
    if (!aberta || selecionados.size === 0) return;
    const ok = await confirmar({
      title: 'Remover produtos da tabela', danger: true, confirmLabel: 'Remover',
      message: `Remover ${selecionados.size} produto(s) desta tabela? Os preços deles nesta tabela serão apagados.`,
    });
    if (!ok) return;
    const ids = [...selecionados];
    const salvos = ids.filter(id => !linhas.find(l => l.produto_id === id)?.novo);
    if (salvos.length) {
      const r = await removerProdutosTabelaAction(aberta.id, salvos, accessToken);
      if (!r.ok) return toast(r.erro || 'Erro ao remover.', 'error');
    }
    setLinhas(prev => prev.filter(l => !selecionados.has(l.produto_id)));
    setSelecionados(new Set());
    toast(`${ids.length} produto(s) removidos.`, 'success');
  };

  const adicionarProduto = (p: any) => {
    if (linhas.some(l => l.produto_id === p.id)) return;
    setLinhas(prev => [{
      produto_id: p.id, nome: p.nome_item, codigo: p.codigo_formatado, unidade: p.unidade, categoria: p.categoria_nome,
      em_desuso: false, valor_indenizacao: null, faixas: {}, extra: '', mensal: '', novo: true, alterado: true,
    }, ...prev]);
  };

  const diasSim = Number(diasSimulacao);
  const simular = Number.isInteger(diasSim) && diasSim >= 1;

  const qtdAlertas = linhas.filter(l => faixasIncoerentes(faixasDaLinha(l)).length > 0).length;
  const linhasVisiveis = linhas.filter(l => {
    if (soAlertas && faixasIncoerentes(faixasDaLinha(l)).length === 0) return false;
    const t = filtroGrade.trim().toLowerCase();
    if (!t) return true;
    return [l.nome, l.codigo, l.categoria].some(x => (x || '').toLowerCase().includes(t));
  });

  // ============================================================================
  // RENDER
  // ============================================================================
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar as Tabelas de Preço.</p>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Hub
          </button>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]';
  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          💲 <strong>Olá, {usuarioAtual}</strong>. Tabelas de preço da locação, com faixas de dias.
        </p>
        <button onClick={() => (aberta ? fecharEditor() : router.push('/admin/locacoes'))}
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ {aberta ? 'VOLTAR ÀS TABELAS' : 'VOLTAR AO HUB'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* ===================== LISTA ===================== */}
          {!aberta && (
            <>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Como o preço é calculado</h2>
                <div className="text-xs text-[#475569] space-y-1">
                  <p>Cada produto tem <strong>faixas de dias</strong> com o valor da <strong>diária</strong>. Para N dias, vale a maior faixa até N; os dias que passam dela são cobrados pela <strong>diária extra</strong> (sem diária extra cadastrada, usa a diária da faixa).</p>
                  <p className="text-[#64748B]">Ex.: 1 dia = R$ 500 · 3 dias = R$ 400 · 5 dias = R$ 300 · extra = R$ 250 → <strong>4 dias</strong> = 3 × 400 + 1 × 250 = R$ 1.450 · <strong>10 dias</strong> = 5 × 300 + 5 × 250 = R$ 2.750.</p>
                  <p className="text-[#64748B]">No orçamento, a tabela do <strong>evento</strong> tem prioridade sobre a do <strong>cliente</strong>, que tem prioridade sobre a <strong>padrão</strong> da empresa (só tabelas ativas e dentro da vigência). Produto que não está na tabela específica usa o preço da padrão.</p>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Tabelas de Preço</h2>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={importarP2s} disabled={importando}
                      className="bg-white border border-[#CBD5E1] hover:border-[#336699] text-[#0C1D4D] disabled:opacity-50 px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">
                      {importando ? 'Importando...' : '⬇ Importar do P2S'}
                    </button>
                    <button onClick={abrirNovaTabela} disabled={!empresas.length}
                      className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">
                      + Nova tabela
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {empresas.length > 1 && (
                    <>
                      <button onClick={() => setFiltroEmpresa(null)}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === null ? `${corSeloEmpresa(null)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>Todas</button>
                      {empresas.map(e => (
                        <button key={e.id} onClick={() => setFiltroEmpresa(e.id)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>
                      ))}
                    </>
                  )}
                  <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as any)}
                    className="border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs font-bold text-[#0C1D4D]">
                    <option value="">Todos os tipos</option>
                    <option value="PADRAO">Padrão</option>
                    <option value="CLIENTE">Cliente</option>
                    <option value="EVENTO">Evento/Feira</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-500 ml-1">
                    <input type="checkbox" checked={mostrarInativas} onChange={e => setMostrarInativas(e.target.checked)} />
                    Mostrar inativas
                  </label>
                </div>

                {carregandoLista ? (
                  <p className="text-sm text-gray-400 py-6 text-center">Carregando...</p>
                ) : tabelasFiltradas.length === 0 ? (
                  <div className="text-center py-10">
                    <p className="text-sm text-gray-500 font-medium">Nenhuma tabela de preço {tabelas.length ? 'com estes filtros' : 'cadastrada ainda'}.</p>
                    {!tabelas.length && <p className="text-xs text-gray-400 mt-1">Use <strong>Importar do P2S</strong> para trazer os preços atuais ou crie uma tabela nova.</p>}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                          <th className="p-2">Tabela</th>
                          <th className="p-2">Tipo</th>
                          <th className="p-2">Empresa</th>
                          <th className="p-2">Vigência</th>
                          <th className="p-2 text-right">Produtos</th>
                          <th className="p-2">Situação</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {tabelasFiltradas.map(t => {
                          const vigente = tabelaVigente(t, hoje);
                          const situacao = !t.ativa ? { txt: 'Inativa', cls: 'bg-gray-100 text-gray-500' }
                            : vigente ? { txt: 'Vigente', cls: 'bg-green-100 text-green-700' }
                            : (t.vigencia_inicio && hoje < t.vigencia_inicio) ? { txt: 'Futura', cls: 'bg-blue-100 text-blue-700' }
                            : { txt: 'Vencida', cls: 'bg-red-100 text-red-600' };
                          return (
                            <tr key={t.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC]">
                              <td className="p-2">
                                <button onClick={() => abrirTabela(t)} className="font-bold text-[#0C1D4D] hover:text-[#336699] text-left">{t.nome}</button>
                                {(t.parceiro_nome || t.evento_nome) && <p className="text-[10px] text-gray-500">{t.parceiro_nome || t.evento_nome}</p>}
                                {t.p2s_origem && <p className="text-[9px] text-gray-400 uppercase font-bold">importada do P2S</p>}
                              </td>
                              <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${COR_TIPO[t.tipo]}`}>{ROTULO_TIPO[t.tipo]}</span></td>
                              <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${corSeloEmpresa(t.empresa_id)}`}>{nomeEmpresa(t.empresa_id)}</span></td>
                              <td className="p-2 text-xs whitespace-nowrap">
                                {t.vigencia_inicio || t.vigencia_fim
                                  ? `${t.vigencia_inicio ? formatarDataBR(t.vigencia_inicio) : '…'} a ${t.vigencia_fim ? formatarDataBR(t.vigencia_fim) : '…'}`
                                  : <span className="text-gray-400">sem prazo</span>}
                              </td>
                              <td className="p-2 text-right font-bold">{t.qtd_produtos}</td>
                              <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${situacao.cls}`}>{situacao.txt}</span></td>
                              <td className="p-2 text-right whitespace-nowrap">
                                <button onClick={() => abrirTabela(t)} className="text-[10px] font-black uppercase text-[#336699] hover:underline mr-3">Preços</button>
                                <button onClick={() => abrirEdicaoCabecalho(t)} className="text-[10px] font-black uppercase text-gray-500 hover:underline mr-3">Editar</button>
                                <button onClick={() => abrirDuplicar(t)} className="text-[10px] font-black uppercase text-gray-500 hover:underline mr-3">Duplicar</button>
                                <button onClick={() => excluirTabela(t)} className="text-[10px] font-black uppercase text-red-500 hover:underline">Excluir</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ===================== EDITOR ===================== */}
          {aberta && (
            <>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
                <div className="flex flex-col md:flex-row justify-between items-start gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">{aberta.nome}</h2>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${COR_TIPO[aberta.tipo]}`}>{ROTULO_TIPO[aberta.tipo]}</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${corSeloEmpresa(aberta.empresa_id)}`}>{nomeEmpresa(aberta.empresa_id)}</span>
                      {!aberta.ativa && <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-gray-100 text-gray-500">Inativa</span>}
                    </div>
                    <p className="text-xs text-[#64748B]">
                      {aberta.parceiro_nome && <>Cliente: <strong>{aberta.parceiro_nome}</strong> · </>}
                      {aberta.evento_nome && <>Evento: <strong>{aberta.evento_nome}</strong> · </>}
                      Vigência: {aberta.vigencia_inicio || aberta.vigencia_fim
                        ? `${aberta.vigencia_inicio ? formatarDataBR(aberta.vigencia_inicio) : '…'} a ${aberta.vigencia_fim ? formatarDataBR(aberta.vigencia_fim) : '…'}`
                        : 'sem prazo'}
                    </p>
                    {aberta.p2s_origem && <p className="text-[10px] text-amber-600 font-bold mt-1">Importada do P2S — reimportar substitui os preços desta tabela.</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => abrirEdicaoCabecalho(aberta)} className="bg-white border border-[#CBD5E1] hover:border-[#336699] text-[#0C1D4D] px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">Editar dados</button>
                    <button onClick={() => abrirDuplicar(aberta)} className="bg-white border border-[#CBD5E1] hover:border-[#336699] text-[#0C1D4D] px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">Duplicar</button>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={filtroGrade} onChange={e => setFiltroGrade(e.target.value)} placeholder="Filtrar produto, código ou categoria..."
                      className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs w-64 focus:outline-none focus:border-[#336699]" />
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase text-gray-500 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-1.5">
                      Simular
                      <input value={diasSimulacao} onChange={e => setDiasSimulacao(e.target.value.replace(/\D/g, ''))} placeholder="nº"
                        className="w-12 border border-[#CBD5E1] rounded px-2 py-1 text-xs text-center" />
                      dias
                    </label>
                    {(qtdAlertas > 0 || soAlertas) && (
                      <label className="flex items-center gap-2 text-[10px] font-black uppercase text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <input type="checkbox" checked={soAlertas} onChange={e => setSoAlertas(e.target.checked)} />
                        Só com alerta ({qtdAlertas})
                      </label>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setModalProdutos(true)} className="bg-white border border-[#CBD5E1] hover:border-[#336699] text-[#0C1D4D] px-3 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">+ Produtos</button>
                    <button onClick={adicionarFaixa} className="bg-white border border-[#CBD5E1] hover:border-[#336699] text-[#0C1D4D] px-3 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">+ Faixa de dias</button>
                    {selecionados.size > 0 && (
                      <button onClick={removerSelecionados} className="bg-white border border-red-200 hover:border-red-400 text-red-600 px-3 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">Remover {selecionados.size}</button>
                    )}
                    {alteracoesPendentes && (
                      <button onClick={descartarGrade} className="bg-white border border-[#CBD5E1] text-gray-500 px-3 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">Descartar</button>
                    )}
                    <button onClick={salvarGrade} disabled={!alteracoesPendentes || salvandoGrade}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">
                      {salvandoGrade ? 'Salvando...' : `Salvar${alteracoesPendentes ? ` (${linhas.filter(l => l.alterado).length})` : ''}`}
                    </button>
                  </div>
                </div>

                {carregandoGrade ? (
                  <p className="text-sm text-gray-400 py-6 text-center">Carregando preços...</p>
                ) : linhas.length === 0 ? (
                  <div className="text-center py-10">
                    <p className="text-sm text-gray-500 font-medium">Esta tabela ainda não tem produtos.</p>
                    <p className="text-xs text-gray-400 mt-1">Clique em <strong>+ Produtos</strong> para adicionar e em <strong>+ Faixa de dias</strong> para criar as colunas (ex.: 1, 3, 5).</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                          <th className="p-2 w-6">
                            <input type="checkbox"
                              checked={linhasVisiveis.length > 0 && linhasVisiveis.every(l => selecionados.has(l.produto_id))}
                              onChange={e => setSelecionados(e.target.checked ? new Set(linhasVisiveis.map(l => l.produto_id)) : new Set())} />
                          </th>
                          <th className="p-2">Produto</th>
                          {colunasFaixa.map(d => (
                            <th key={d} className="p-2 text-right whitespace-nowrap">
                              {d} {Number(d) === 1 ? 'dia' : 'dias'}
                              <button onClick={() => removerFaixa(d)} title="Remover faixa" className="ml-1 text-gray-300 hover:text-red-500">×</button>
                              <span className="block text-[8px] text-gray-400 normal-case font-bold">diária</span>
                            </th>
                          ))}
                          <th className="p-2 text-right whitespace-nowrap">Diária extra<span className="block text-[8px] text-gray-400 normal-case font-bold">vazio = da faixa</span></th>
                          <th className="p-2 text-right">Mensal</th>
                          {simular && <th className="p-2 text-right whitespace-nowrap bg-emerald-50 text-emerald-700">Total {diasSim} {diasSim === 1 ? 'dia' : 'dias'}</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {linhasVisiveis.map(l => {
                          const faixasLinha = faixasDaLinha(l);
                          const incoerencias = faixasIncoerentes(faixasLinha);
                          let sim: ReturnType<typeof calcularPrecoPorFaixas> = null;
                          if (simular) {
                            const extra = lerValor(l.extra);
                            sim = calcularPrecoPorFaixas(faixasLinha, extra === null || Number.isNaN(extra) ? null : extra, diasSim);
                          }
                          return (
                            <tr key={l.produto_id} className={`border-b border-[#F1F5F9] ${l.alterado ? 'bg-amber-50/60' : 'hover:bg-[#F8FAFC]'}`}>
                              <td className="p-2">
                                <input type="checkbox" checked={selecionados.has(l.produto_id)}
                                  onChange={e => setSelecionados(prev => { const s = new Set(prev); if (e.target.checked) s.add(l.produto_id); else s.delete(l.produto_id); return s; })} />
                              </td>
                              <td className="p-2 min-w-[220px]">
                                <p className="font-bold text-[#0C1D4D]">{l.nome}</p>
                                <p className="text-[10px] text-gray-400">
                                  {[l.codigo, l.unidade, l.categoria].filter(Boolean).join(' · ')}
                                  {l.valor_indenizacao ? ` · indenização ${formatarMoeda(l.valor_indenizacao)}` : ''}
                                  {l.em_desuso && <span className="text-red-500 font-bold"> · em desuso</span>}
                                  {l.novo && <span className="text-emerald-600 font-bold"> · novo</span>}
                                </p>
                                {incoerencias.length > 0 && (
                                  <p className="text-[10px] text-amber-700 font-bold mt-0.5">
                                    ⚠ {incoerencias.map(i => `${i.maior} dias sai mais barato que ${i.menor}`).join(' · ')}
                                  </p>
                                )}
                              </td>
                              {colunasFaixa.map(d => (
                                <td key={d} className="p-1">
                                  <input value={l.faixas[d] ?? ''} onChange={e => editarCelula(l.produto_id, { faixa: d }, e.target.value)}
                                    inputMode="decimal" placeholder="—"
                                    className={`w-24 border rounded px-2 py-1 text-right ${Number.isNaN(lerValor(l.faixas[d] ?? '')) ? 'border-red-400 bg-red-50' : 'border-[#E2E8F0]'} focus:outline-none focus:border-[#336699]`} />
                                </td>
                              ))}
                              <td className="p-1">
                                <input value={l.extra} onChange={e => editarCelula(l.produto_id, 'extra', e.target.value)} inputMode="decimal" placeholder="—"
                                  className={`w-24 border rounded px-2 py-1 text-right ${Number.isNaN(lerValor(l.extra)) ? 'border-red-400 bg-red-50' : 'border-[#E2E8F0]'} focus:outline-none focus:border-[#336699]`} />
                              </td>
                              <td className="p-1">
                                <input value={l.mensal} onChange={e => editarCelula(l.produto_id, 'mensal', e.target.value)} inputMode="decimal" placeholder="—"
                                  className={`w-28 border rounded px-2 py-1 text-right ${Number.isNaN(lerValor(l.mensal)) ? 'border-red-400 bg-red-50' : 'border-[#E2E8F0]'} focus:outline-none focus:border-[#336699]`} />
                              </td>
                              {simular && (
                                <td className="p-2 text-right bg-emerald-50/60 whitespace-nowrap">
                                  {sim ? (
                                    <>
                                      <p className="font-black text-emerald-700">{formatarMoeda(sim.total)}</p>
                                      <p className="text-[9px] text-gray-500">
                                        {sim.faixaDias} × {formatarMoeda(sim.valorDiariaFaixa)}
                                        {sim.diasExtra > 0 && ` + ${sim.diasExtra} × ${formatarMoeda(sim.valorDiariaExtra)}${sim.extraPelaFaixa ? ' (faixa)' : ''}`}
                                      </p>
                                    </>
                                  ) : <span className="text-[10px] text-red-500 font-bold">sem faixa — preço manual</span>}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p className="text-[10px] text-gray-400 mt-3">
                      {linhasVisiveis.length} de {linhas.length} produto(s). Valores em reais — pode digitar 1.234,56 ou 1234,56. Linhas em amarelo têm alteração não salva.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===================== MODAL CABEÇALHO ===================== */}
      <Modal open={modalCabecalho} onClose={() => setModalCabecalho(false)} title={form.id ? 'Editar tabela de preço' : 'Nova tabela de preço'}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setModalCabecalho(false)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
            <button onClick={salvarCabecalho} disabled={salvandoCabecalho}
              className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">
              {salvandoCabecalho ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        }>
        <div>
          <label className={labelCls}>Nome</label>
          <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Padrão Rentech 2027" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Tipo</label>
          <div className="grid grid-cols-3 gap-2">
            {(['PADRAO', 'CLIENTE', 'EVENTO'] as TipoTabelaPreco[]).map(tp => (
              <button key={tp} type="button" onClick={() => setForm({ ...form, tipo: tp })}
                className={`py-2 rounded-lg text-xs font-black uppercase border-2 ${form.tipo === tp ? 'border-[#336699] bg-blue-50 text-[#0C1D4D]' : 'border-[#E2E8F0] text-gray-500'}`}>
                {ROTULO_TIPO[tp]}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            {form.tipo === 'PADRAO' && 'Vale para todos os clientes da empresa.'}
            {form.tipo === 'CLIENTE' && 'Preço especial de um cliente — tem prioridade sobre a padrão.'}
            {form.tipo === 'EVENTO' && 'Preço de uma feira/evento — tem prioridade sobre a do cliente e a padrão.'}
          </p>
        </div>
        {empresas.length > 1 && (
          <div>
            <label className={labelCls}>Empresa</label>
            <select value={form.empresa_id} onChange={e => setForm({ ...form, empresa_id: Number(e.target.value) })} className={inputCls}>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
        )}
        {form.tipo === 'CLIENTE' && (
          <div>
            <label className={labelCls}>Cliente</label>
            <CampoBusca placeholder="Buscar cliente pelo nome..." buscar={buscarClientes} valor={clienteForm}
              onEscolher={setClienteForm} onLimpar={() => setClienteForm(null)} />
          </div>
        )}
        {form.tipo === 'EVENTO' && (
          <div>
            <label className={labelCls}>Evento / Feira</label>
            <CampoBusca placeholder="Buscar evento pelo nome..." buscar={buscarEventos} valor={eventoForm}
              onEscolher={setEventoForm} onLimpar={() => setEventoForm(null)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Vigência — início</label>
            <input type="date" value={form.vigencia_inicio || ''} onChange={e => setForm({ ...form, vigencia_inicio: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Vigência — fim</label>
            <input type="date" value={form.vigencia_fim || ''} onChange={e => setForm({ ...form, vigencia_fim: e.target.value })} className={inputCls} />
          </div>
        </div>
        <p className="text-[10px] text-gray-400 -mt-3">Em branco = sem prazo. Vale a data de início do evento da ficha.</p>
        <label className="flex items-center gap-2 text-sm font-bold text-[#0C1D4D]">
          <input type="checkbox" checked={form.ativa} onChange={e => setForm({ ...form, ativa: e.target.checked })} />
          Tabela ativa
        </label>
        <div>
          <label className={labelCls}>Observações</label>
          <textarea value={form.observacoes || ''} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} className={inputCls} />
        </div>
      </Modal>

      {/* ===================== MODAL DUPLICAR ===================== */}
      <Modal open={!!modalDuplicar} onClose={() => setModalDuplicar(null)} title="Duplicar tabela"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setModalDuplicar(null)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
            <button onClick={confirmarDuplicar} disabled={duplicando}
              className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">
              {duplicando ? 'Duplicando...' : 'Duplicar'}
            </button>
          </div>
        }>
        <p className="text-xs text-[#64748B]">Copia todos os produtos e faixas de <strong>{modalDuplicar?.nome}</strong>. Útil para reajuste: duplique com a vigência nova e depois desative a antiga.</p>
        <div>
          <label className={labelCls}>Nome da nova tabela</label>
          <input value={dup.nome} onChange={e => setDup({ ...dup, nome: e.target.value })} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Reajuste (%)</label>
          <input value={dup.reajuste} onChange={e => setDup({ ...dup, reajuste: e.target.value })} inputMode="decimal" className={inputCls} />
          <p className="text-[10px] text-gray-400 mt-1">0 = cópia sem reajuste. Aceita negativo (ex.: -5 para desconto).</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Vigência — início</label>
            <input type="date" value={dup.inicio} onChange={e => setDup({ ...dup, inicio: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Vigência — fim</label>
            <input type="date" value={dup.fim} onChange={e => setDup({ ...dup, fim: e.target.value })} className={inputCls} />
          </div>
        </div>
      </Modal>

      {/* ===================== MODAL PRODUTOS ===================== */}
      <ModalAdicionarProdutos
        open={modalProdutos}
        onClose={() => setModalProdutos(false)}
        accessToken={accessToken}
        jaNaTabela={new Set(linhas.map(l => l.produto_id))}
        onAdicionar={adicionarProduto}
      />
    </div>
  );
}

// ============================================================================
// Modal de busca/adição de produtos (só produtos habilitados para locação)
// ============================================================================
function ModalAdicionarProdutos({ open, onClose, accessToken, jaNaTabela, onAdicionar }: {
  open: boolean; onClose: () => void; accessToken: string; jaNaTabela: Set<number>; onAdicionar: (p: any) => void;
}) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [adicionados, setAdicionados] = useState(0);
  const seq = useRef(0);

  useEffect(() => { if (open) { setTexto(''); setResultados([]); setAdicionados(0); } }, [open]);

  useEffect(() => {
    if (texto.trim().length < 2) { setResultados([]); return; }
    const meu = ++seq.current;
    const t = setTimeout(async () => {
      setCarregando(true);
      const r = await buscarProdutosLocacaoAction(texto.trim(), accessToken);
      if (meu === seq.current) { setResultados(r.ok ? r.info : []); setCarregando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [texto, accessToken]);

  return (
    <Modal open={open} onClose={onClose} title="Adicionar produtos à tabela" maxWidthClassName="max-w-3xl"
      footer={
        <div className="flex justify-between items-center">
          <p className="text-xs text-gray-500">{adicionados > 0 ? `${adicionados} produto(s) adicionado(s) — preencha os preços e salve.` : 'Só aparecem produtos habilitados para locação.'}</p>
          <button onClick={onClose} className="bg-[#0C1D4D] text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">Concluir</button>
        </div>
      }>
      <input autoFocus value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar por nome, código ou categoria..."
        className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]" />
      <div className="border border-[#E2E8F0] rounded-lg max-h-[50vh] overflow-y-auto">
        {carregando && <p className="p-4 text-xs text-gray-400">Buscando...</p>}
        {!carregando && texto.trim().length >= 2 && resultados.length === 0 && <p className="p-4 text-xs text-gray-400">Nenhum produto encontrado.</p>}
        {!carregando && texto.trim().length < 2 && <p className="p-4 text-xs text-gray-400">Digite ao menos 2 letras.</p>}
        {!carregando && resultados.map(p => {
          const ja = jaNaTabela.has(p.id);
          return (
            <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#F1F5F9] last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#0C1D4D] truncate">{p.nome_item}</p>
                <p className="text-[10px] text-gray-400">{[p.codigo_formatado, p.unidade, p.categoria_nome].filter(Boolean).join(' · ')}</p>
              </div>
              <button disabled={ja} onClick={() => { onAdicionar(p); setAdicionados(n => n + 1); }}
                className="flex-shrink-0 text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border disabled:opacity-40 border-[#336699] text-[#336699] hover:bg-blue-50">
                {ja ? 'Já na tabela' : '+ Adicionar'}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
