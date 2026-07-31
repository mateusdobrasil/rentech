"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { Analytics } from "@vercel/analytics/next";

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
  return 'USUARIO';
};

// ============================================================================
// TIPOS
// ============================================================================
type StatusChecklist = 'RASCUNHO' | 'SAIDA_CONFERIDA' | 'FINALIZADO';

const STATUS_CHECKLIST: StatusChecklist[] = ['RASCUNHO', 'SAIDA_CONFERIDA', 'FINALIZADO'];
const LABEL_STATUS: Record<StatusChecklist, string> = {
  RASCUNHO: 'Rascunho',
  SAIDA_CONFERIDA: 'Saída Conferida',
  FINALIZADO: 'Finalizado',
};
const COR_STATUS: Record<StatusChecklist, string> = {
  RASCUNHO: 'bg-gray-100 text-gray-600 border-gray-300',
  SAIDA_CONFERIDA: 'bg-blue-100 text-blue-700 border-blue-300',
  FINALIZADO: 'bg-green-100 text-green-700 border-green-300',
};

interface Categoria { id: string; nome: string; }
interface EquipamentoLeve { id: string; categoria_id: string; nome: string; ativo: boolean; }

interface EventoFeiraBusca {
  nome: string;
  local: string | null;
  data_inicial: string | null;
  data_final: string | null;
}

interface ChecklistHeader {
  id: string;
  numero: number;
  evento_feira: string;
  cliente: string;
  local: string;
  periodo_inicio: string;
  periodo_fim: string;
  data_entrega: string;
  observacoes: string;
  responsavel_saida: string;
  responsavel_montagem: string;
  responsavel_retorno: string;
  status: StatusChecklist;
}

interface ChecklistGridRow {
  id: string;
  numero: number;
  evento_feira: string | null;
  cliente: string | null;
  local: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  status: StatusChecklist;
  created_at: string;
}

interface ChecklistItem {
  id: string; // uuid real, ou "novo-..." enquanto não salvo
  ordem: number;
  secao: string;
  equipamento_id: string | null;
  descricao: string;
  qtd_prevista: string;
  saida_ok: boolean;
  saida_qtd: number | null;
  retorno_ok: boolean;
  retorno_qtd: number | null;
}

interface ModeloItem {
  id: string;
  ordem: number;
  secao: string;
  equipamento_id: string | null;
  descricao: string;
  qtd_padrao: string;
  ativo: boolean;
}

const ITEM_NOVO_PREFIXO = 'novo-';
const ehItemNovo = (id: string) => id.startsWith(ITEM_NOVO_PREFIXO);
const gerarIdTemporario = () => `${ITEM_NOVO_PREFIXO}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const gerarNumeroExibicao = (n: number) => `CKL-${String(n).padStart(6, '0')}`;

// Colunas do tipo "date" no Postgres rejeitam string vazia — normaliza para null
const dataOuNulo = (v?: string | null) => (v && v.trim() !== '' ? v : null);

// Casa o nome do evento/feira (texto livre) com o cadastro eventos_feiras, ignorando
// acentuação/maiúsculas — mesma normalização usada no Calendário Operacional (relatorios).
const normalizarNomeEvento = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const formatarDataBR = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
};

const TAMANHO_PAGINA = 20;

const cabecalhoVazio: ChecklistHeader = {
  id: '', numero: 0,
  evento_feira: '', cliente: '', local: '',
  periodo_inicio: '', periodo_fim: '', data_entrega: '',
  observacoes: '', responsavel_saida: '', responsavel_montagem: '', responsavel_retorno: '',
  status: 'RASCUNHO',
};

// ============================================================================
// COMPONENTE
// ============================================================================
export default function ChecklistCargaRetorno() {
  const router = useRouter();
  const pathname = usePathname();

  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [usuarioAtual, setUsuarioAtual] = useState('');

  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'success' | 'error'; title: string; msg: string }>({ open: false, type: 'loading', title: '', msg: '' });

  const [view, setView] = useState<'lista' | 'editor'>('lista');
  const [abrindoAutomatico, setAbrindoAutomatico] = useState(false);

  // Catálogo (equipamentos/categorias) — usado nos modais de item e no modelo padrão
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [equipamentos, setEquipamentos] = useState<EquipamentoLeve[]>([]);
  // Mapa nome (normalizado) → local padrão, carregado de eventos_feiras — usado para
  // preencher "Local do Evento" automaticamente a partir do Evento/Feira informado.
  const [mapaLocaisEventos, setMapaLocaisEventos] = useState<Record<string, string>>({});

  // ------------------------------------------------------------------------
  // Estado: view Lista
  // ------------------------------------------------------------------------
  const [checklists, setChecklists] = useState<ChecklistGridRow[]>([]);
  const [listaLoading, setListaLoading] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [pagina, setPagina] = useState(0);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [refreshLista, setRefreshLista] = useState(0);

  const [modalNovo, setModalNovo] = useState(false);
  const [camposManuais, setCamposManuais] = useState({ evento_feira: '', cliente: '', local: '', periodo_inicio: '', periodo_fim: '', data_entrega: '' });
  const [criando, setCriando] = useState(false);

  // Busca de evento/feira cadastrado (tabela eventos_feiras, única fonte de dados
  // usada para vincular um checklist a um evento — sem relação com fichas de locação).
  const [resultadosEvento, setResultadosEvento] = useState<EventoFeiraBusca[]>([]);
  const [buscandoEvento, setBuscandoEvento] = useState(false);
  const [eventoSelecionado, setEventoSelecionado] = useState<EventoFeiraBusca | null>(null);
  const [nonceEvento, setNonceEvento] = useState(0);

  // Modal: modelo padrão
  const [modalModelo, setModalModelo] = useState(false);
  const [modeloItens, setModeloItens] = useState<ModeloItem[]>([]);
  const [modeloLoading, setModeloLoading] = useState(false);
  const [novoModelo, setNovoModelo] = useState({ secao: '', modo: 'livre' as 'catalogo' | 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', qtdPadrao: '' });

  // ------------------------------------------------------------------------
  // Estado: view Editor
  // ------------------------------------------------------------------------
  const [checklistAtual, setChecklistAtual] = useState<ChecklistHeader>(cabecalhoVazio);
  const [itens, setItens] = useState<ChecklistItem[]>([]);
  const [itensRemovidos, setItensRemovidos] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  const [modalAddItem, setModalAddItem] = useState<{ open: boolean; secao: string; modo: 'catalogo' | 'livre'; categoriaId: string; equipamentoId: string; descricaoLivre: string; qtdPrevista: string }>({
    open: false, secao: '', modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', qtdPrevista: '',
  });

  // 1. Validar Sessão e Consultar Permissões Dinâmicas no Banco
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();

      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao } = await supabase
        .from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', pathname).single();

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true); setAuthLoading(false); return;
      }

      setUsuarioAtual(perfil.nome || 'Usuário');
      setAuthLoading(false);

      const [resCat, resEq, resEventos] = await Promise.all([
        supabase.from('categorias').select('*').order('nome', { ascending: true }),
        supabase.from('equipamentos').select('id, categoria_id, nome, ativo').order('nome', { ascending: true }),
        supabase.from('eventos_feiras').select('nome, local').not('local', 'is', null),
      ]);
      if (resCat.data) setCategorias(resCat.data);
      if (resEq.data) setEquipamentos(resEq.data);
      if (resEventos.data) {
        const mapa: Record<string, string> = {};
        resEventos.data.forEach((ev: { nome: string; local: string | null }) => {
          const chave = normalizarNomeEvento(ev.nome);
          if (ev.local && !mapa[chave]) mapa[chave] = ev.local;
        });
        setMapaLocaisEventos(mapa);
      }
    })();
  }, [router, pathname]);

  // 2. Carregar Lista de Checklists
  useEffect(() => {
    if (authLoading || acessoNegado || view !== 'lista') return;

    const handle = setTimeout(async () => {
      setListaLoading(true);

      let query = supabase
        .from('checklists')
        .select('id, numero, evento_feira, cliente, local, periodo_inicio, periodo_fim, status, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);

      if (filtroStatus) query = query.eq('status', filtroStatus);
      if (busca.trim()) {
        const termo = `%${busca.trim()}%`;
        query = query.or(`cliente.ilike.${termo},evento_feira.ilike.${termo},local.ilike.${termo}`);
      }

      const { data, error, count } = await query;
      if (!error) {
        setChecklists(data || []);
        setTotalRegistros(count || 0);
      }
      setListaLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, view, pagina, filtroStatus, busca, refreshLista]);

  // ------------------------------------------------------------------------
  // Catálogo agrupado por categoria (para os selects de "Do catálogo")
  // ------------------------------------------------------------------------
  const equipamentosAtivos = useMemo(() => equipamentos.filter(e => e.ativo), [equipamentos]);

  // Local padrão cadastrado em eventos_feiras para um nome de evento/feira, se houver.
  const buscarLocalPadrao = (nomeEvento: string): string | undefined =>
    nomeEvento.trim() ? mapaLocaisEventos[normalizarNomeEvento(nomeEvento)] : undefined;

  // ------------------------------------------------------------------------
  // BUSCA DE EVENTO/FEIRA (tabela eventos_feiras — única fonte, sem relação
  // com fichas de locação) para vincular ao criar um novo checklist.
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (!modalNovo) return;

    const handle = setTimeout(async () => {
      if (eventoSelecionado) {
        setResultadosEvento([]);
        return;
      }
      setBuscandoEvento(true);

      const hojeISO = new Date().toISOString().slice(0, 10);
      let query = supabase
        .from('eventos_feiras')
        .select('nome, local, data_inicial, data_final')
        .gte('data_inicial', hojeISO)
        .order('data_inicial', { ascending: true, nullsFirst: false })
        .limit(20);

      const termoBusca = camposManuais.evento_feira.trim();
      if (termoBusca.length >= 2) query = query.ilike('nome', `%${termoBusca}%`);

      const { data, error } = await query;
      setResultadosEvento(error ? [] : (data || []));
      setBuscandoEvento(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [camposManuais.evento_feira, modalNovo, eventoSelecionado, nonceEvento]);

  const abrirModalNovo = () => {
    setModalNovo(true);
    setEventoSelecionado(null);
    setResultadosEvento([]);
    setNonceEvento(v => v + 1);
    setCamposManuais({ evento_feira: '', cliente: '', local: '', periodo_inicio: '', periodo_fim: '', data_entrega: '' });
  };

  const selecionarEvento = (ev: EventoFeiraBusca) => {
    setEventoSelecionado(ev);
    setResultadosEvento([]);
    setCamposManuais(prev => ({
      ...prev,
      evento_feira: ev.nome,
      cliente: ev.local || prev.cliente,
      periodo_inicio: ev.data_inicial || '',
      periodo_fim: ev.data_final || '',
    }));

    // Join só para completar Endereço e Data de Entrega: fichas de locação já têm
    // esses dois campos preenchidos por evento, mas o checklist não fica vinculado
    // a nenhuma ficha específica — é só uma leitura pontual dos dados mais comuns.
    // Um mesmo nome de evento pode se repetir com data corrigida/alterada na ficha
    // (diferente do que está em eventos_feiras) — por isso o mesmo corte de "ainda
    // não passou" (data_inicial >= hoje) é aplicado aqui, e o período do checklist
    // passa a considerar a data_inicial/data_final da própria ficha.
    (async () => {
      const hojeISO = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('fichas_reserva')
        .select('endereco_entrega, endereco_estande, data_entrega, data_inicial, data_final')
        .ilike('evento_feira', ev.nome)
        .gte('data_inicial', hojeISO)
        .order('data_inicial', { ascending: true })
        .limit(10);

      if (!data || data.length === 0) return;

      const endereco = data.map(f => f.endereco_entrega || f.endereco_estande).find(v => v);
      const dataEntrega = data.map(f => f.data_entrega).find(v => v);
      const primeira = data[0];

      setCamposManuais(prev => ({
        ...prev,
        local: endereco || prev.local,
        data_entrega: dataEntrega || prev.data_entrega,
        periodo_inicio: primeira.data_inicial || prev.periodo_inicio,
        periodo_fim: primeira.data_final || prev.periodo_fim,
      }));
    })();
  };

  // ------------------------------------------------------------------------
  // CRIAR CHECKLIST (header + cópia do modelo padrão de itens)
  // ------------------------------------------------------------------------
  const criarChecklist = async () => {
    if (!camposManuais.cliente.trim() && !camposManuais.evento_feira.trim()) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'Informe ao menos o Local do Evento ou o Evento/Feira.' });
      return;
    }

    setCriando(true);

    const payloadHeader = {
      evento_feira: camposManuais.evento_feira || null,
      cliente: camposManuais.cliente || null,
      local: camposManuais.local || null,
      periodo_inicio: dataOuNulo(camposManuais.periodo_inicio),
      periodo_fim: dataOuNulo(camposManuais.periodo_fim),
      data_entrega: camposManuais.data_entrega || null,
      status: 'RASCUNHO',
      created_by: usuarioAtual,
    };

    const { data: header, error: erroHeader } = await supabase.from('checklists').insert([payloadHeader]).select().single();
    if (erroHeader || !header) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: erroHeader?.message || 'Falha ao criar checklist.' });
      setCriando(false);
      return;
    }

    const { data: modelo } = await supabase.from('checklist_modelo_itens').select('*').eq('ativo', true).order('ordem', { ascending: true });

    let itensCriados: ChecklistItem[] = [];
    if (modelo && modelo.length > 0) {
      const payloadItens = modelo.map((m: ModeloItem) => ({
        checklist_id: header.id,
        ordem: m.ordem,
        secao: m.secao,
        equipamento_id: m.equipamento_id,
        descricao: m.descricao,
        qtd_prevista: m.qtd_padrao,
      }));
      const { data: itensInseridos, error: erroItens } = await supabase.from('checklist_itens').insert(payloadItens).select();
      if (erroItens) {
        setDialog({ open: true, type: 'error', title: 'Erro', msg: `Checklist criado, mas falhou ao copiar itens do modelo: ${erroItens.message}` });
      }
      itensCriados = itensInseridos || [];
    }

    registrarLogAuditoria({
      usuario_nome: usuarioAtual,
      acao: 'CRIOU CHECKLIST DE CARGA',
      setor: 'OPERACIONAL',
      equipamento_nome: `${gerarNumeroExibicao(header.numero)} — ${header.evento_feira || header.cliente || ''}`,
    });

    setChecklistAtual({
      id: header.id, numero: header.numero,
      evento_feira: header.evento_feira || '', cliente: header.cliente || '', local: header.local || '',
      periodo_inicio: header.periodo_inicio || '', periodo_fim: header.periodo_fim || '', data_entrega: header.data_entrega || '',
      observacoes: header.observacoes || '', responsavel_saida: header.responsavel_saida || '',
      responsavel_montagem: header.responsavel_montagem || '', responsavel_retorno: header.responsavel_retorno || '',
      status: header.status,
    });
    setItens(itensCriados.map(i => ({ ...i, qtd_prevista: i.qtd_prevista || '' })));
    setItensRemovidos([]);
    setModalNovo(false);
    setView('editor');
    setCriando(false);
    router.replace(`/admin/operacional/checklist?id=${header.id}`);
  };

  // ------------------------------------------------------------------------
  // ABRIR CHECKLIST EXISTENTE
  // ------------------------------------------------------------------------
  const abrirChecklist = async (id: number | string) => {
    const checklistId = typeof id === 'string' ? id : String(id);

    const [{ data: header, error: erroHeader }, { data: itensData, error: erroItens }] = await Promise.all([
      supabase.from('checklists').select('*').eq('id', checklistId).single(),
      supabase.from('checklist_itens').select('*').eq('checklist_id', checklistId).order('ordem', { ascending: true }),
    ]);

    if (erroHeader || !header) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: erroHeader?.message || 'Checklist não encontrado.' });
      return;
    }
    if (erroItens) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: erroItens.message });
    }

    setChecklistAtual({
      id: header.id, numero: header.numero,
      evento_feira: header.evento_feira || '', cliente: header.cliente || '', local: header.local || '',
      periodo_inicio: header.periodo_inicio || '', periodo_fim: header.periodo_fim || '', data_entrega: header.data_entrega || '',
      observacoes: header.observacoes || '', responsavel_saida: header.responsavel_saida || '',
      responsavel_montagem: header.responsavel_montagem || '', responsavel_retorno: header.responsavel_retorno || '',
      status: header.status,
    });
    setItens((itensData || []).map((i: ChecklistItem) => ({ ...i, qtd_prevista: i.qtd_prevista || '' })));
    setItensRemovidos([]);
    setView('editor');
  };

  const voltarParaLista = () => {
    setView('lista');
    setRefreshLista(v => v + 1);
  };

  // ------------------------------------------------------------------------
  // EDIÇÃO DE ITENS (estado local)
  // ------------------------------------------------------------------------
  const atualizarItem = (id: string, patch: Partial<ChecklistItem>) => {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  const removerItem = (item: ChecklistItem) => {
    setItens(prev => prev.filter(i => i.id !== item.id));
    if (!ehItemNovo(item.id)) setItensRemovidos(prev => [...prev, item.id]);
  };

  const secoesExistentes = useMemo(() => Array.from(new Set(itens.map(i => i.secao))), [itens]);

  const itensPorSecao = useMemo(() => {
    const mapa = new Map<string, ChecklistItem[]>();
    [...itens].sort((a, b) => a.ordem - b.ordem).forEach(i => {
      if (!mapa.has(i.secao)) mapa.set(i.secao, []);
      mapa.get(i.secao)!.push(i);
    });
    return Array.from(mapa.entries());
  }, [itens]);

  const abrirModalAddItem = (secaoPreSelecionada: string) => {
    setModalAddItem({ open: true, secao: secaoPreSelecionada, modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', qtdPrevista: '' });
  };

  const confirmarAddItem = () => {
    const descricao = modalAddItem.modo === 'catalogo'
      ? (equipamentos.find(e => e.id === modalAddItem.equipamentoId)?.nome || '')
      : modalAddItem.descricaoLivre.trim();

    if (!descricao || !modalAddItem.secao.trim()) return;

    const maiorOrdem = itens.length > 0 ? Math.max(...itens.map(i => i.ordem)) : 0;
    const novoItem: ChecklistItem = {
      id: gerarIdTemporario(),
      ordem: maiorOrdem + 1,
      secao: modalAddItem.secao.trim().toUpperCase(),
      equipamento_id: modalAddItem.modo === 'catalogo' ? (modalAddItem.equipamentoId || null) : null,
      descricao,
      qtd_prevista: modalAddItem.qtdPrevista,
      saida_ok: false, saida_qtd: null, retorno_ok: false, retorno_qtd: null,
    };
    setItens(prev => [...prev, novoItem]);
    setModalAddItem({ open: false, secao: '', modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', qtdPrevista: '' });
  };

  // ------------------------------------------------------------------------
  // SALVAR CHECKLIST (header + itens)
  // ------------------------------------------------------------------------
  const salvarChecklist = async () => {
    setSalvando(true);

    const payloadHeader = {
      evento_feira: checklistAtual.evento_feira || null,
      cliente: checklistAtual.cliente || null,
      local: checklistAtual.local || null,
      periodo_inicio: dataOuNulo(checklistAtual.periodo_inicio),
      periodo_fim: dataOuNulo(checklistAtual.periodo_fim),
      data_entrega: checklistAtual.data_entrega || null,
      observacoes: checklistAtual.observacoes || null,
      responsavel_saida: checklistAtual.responsavel_saida || null,
      responsavel_montagem: checklistAtual.responsavel_montagem || null,
      responsavel_retorno: checklistAtual.responsavel_retorno || null,
      status: checklistAtual.status,
      updated_at: new Date().toISOString(),
    };

    const { error: erroHeader } = await supabase.from('checklists').update(payloadHeader).eq('id', checklistAtual.id);
    if (erroHeader) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: erroHeader.message });
      setSalvando(false);
      return;
    }

    const itensExistentes = itens.filter(i => !ehItemNovo(i.id));
    const itensNovos = itens.filter(i => ehItemNovo(i.id));

    if (itensExistentes.length > 0) {
      const payload = itensExistentes.map(i => ({
        id: i.id, checklist_id: checklistAtual.id, ordem: i.ordem, secao: i.secao,
        equipamento_id: i.equipamento_id, descricao: i.descricao, qtd_prevista: i.qtd_prevista || null,
        saida_ok: i.saida_ok, saida_qtd: i.saida_qtd, retorno_ok: i.retorno_ok, retorno_qtd: i.retorno_qtd,
      }));
      const { error } = await supabase.from('checklist_itens').upsert(payload, { onConflict: 'id' });
      if (error) {
        setDialog({ open: true, type: 'error', title: 'Erro', msg: `Falha ao salvar itens: ${error.message}` });
        setSalvando(false);
        return;
      }
    }

    if (itensNovos.length > 0) {
      const payload = itensNovos.map(i => ({
        checklist_id: checklistAtual.id, ordem: i.ordem, secao: i.secao,
        equipamento_id: i.equipamento_id, descricao: i.descricao, qtd_prevista: i.qtd_prevista || null,
        saida_ok: i.saida_ok, saida_qtd: i.saida_qtd, retorno_ok: i.retorno_ok, retorno_qtd: i.retorno_qtd,
      }));
      const { error } = await supabase.from('checklist_itens').insert(payload);
      if (error) {
        setDialog({ open: true, type: 'error', title: 'Erro', msg: `Falha ao inserir novos itens: ${error.message}` });
        setSalvando(false);
        return;
      }
    }

    if (itensRemovidos.length > 0) {
      const { error } = await supabase.from('checklist_itens').delete().in('id', itensRemovidos);
      if (error) {
        setDialog({ open: true, type: 'error', title: 'Erro', msg: `Falha ao remover itens: ${error.message}` });
        setSalvando(false);
        return;
      }
    }

    registrarLogAuditoria({
      usuario_nome: usuarioAtual,
      acao: 'SALVOU CHECKLIST DE CARGA',
      setor: 'OPERACIONAL',
      equipamento_nome: `${gerarNumeroExibicao(checklistAtual.numero)} — ${checklistAtual.evento_feira || checklistAtual.cliente || ''}`,
    });

    // Recarrega do banco para normalizar ids dos itens recém-criados
    const { data: itensAtualizados } = await supabase.from('checklist_itens').select('*').eq('checklist_id', checklistAtual.id).order('ordem', { ascending: true });
    setItens((itensAtualizados || []).map((i: ChecklistItem) => ({ ...i, qtd_prevista: i.qtd_prevista || '' })));
    setItensRemovidos([]);

    setSalvando(false);
    setDialog({ open: true, type: 'success', title: 'Salvo', msg: 'Checklist atualizado com sucesso.' });
    setTimeout(() => setDialog(prev => ({ ...prev, open: false })), 1800);
  };

  const excluirChecklist = async (c: ChecklistGridRow) => {
    if (!confirm(`Excluir o checklist ${gerarNumeroExibicao(c.numero)} (${c.evento_feira || c.cliente || 'sem evento'})? Essa ação não pode ser desfeita.`)) return;

    const { error } = await supabase.from('checklists').delete().eq('id', c.id);
    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      return;
    }

    registrarLogAuditoria({
      usuario_nome: usuarioAtual,
      acao: 'EXCLUIU CHECKLIST DE CARGA',
      setor: 'OPERACIONAL',
      equipamento_nome: `${gerarNumeroExibicao(c.numero)} — ${c.evento_feira || c.cliente || ''}`,
    });

    setRefreshLista(v => v + 1);
  };

  // ------------------------------------------------------------------------
  // MODELO PADRÃO — CRUD sobre checklist_modelo_itens
  // ------------------------------------------------------------------------
  const carregarModelo = async () => {
    setModeloLoading(true);
    const { data } = await supabase.from('checklist_modelo_itens').select('*').order('ordem', { ascending: true });
    setModeloItens((data || []).map((m: ModeloItem) => ({ ...m, qtd_padrao: m.qtd_padrao || '' })));
    setModeloLoading(false);
  };

  const abrirModalModelo = () => {
    setModalModelo(true);
    setNovoModelo({ secao: '', modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', qtdPadrao: '' });
    carregarModelo();
  };

  const adicionarItemModelo = async () => {
    const descricao = novoModelo.modo === 'catalogo'
      ? (equipamentos.find(e => e.id === novoModelo.equipamentoId)?.nome || '')
      : novoModelo.descricaoLivre.trim();

    if (!descricao || !novoModelo.secao.trim()) return;

    const maiorOrdem = modeloItens.length > 0 ? Math.max(...modeloItens.map(m => m.ordem)) : 0;
    const { error } = await supabase.from('checklist_modelo_itens').insert([{
      ordem: maiorOrdem + 1,
      secao: novoModelo.secao.trim().toUpperCase(),
      equipamento_id: novoModelo.modo === 'catalogo' ? (novoModelo.equipamentoId || null) : null,
      descricao,
      qtd_padrao: novoModelo.qtdPadrao || null,
      ativo: true,
    }]);

    if (error) {
      alert(`Erro: ${error.message}`);
      return;
    }

    registrarLogAuditoria({ usuario_nome: usuarioAtual, acao: 'ADICIONOU ITEM AO MODELO PADRÃO DE CHECKLIST', setor: 'OPERACIONAL', equipamento_nome: descricao });
    setNovoModelo({ secao: '', modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', qtdPadrao: '' });
    carregarModelo();
  };

  const alternarAtivoModelo = async (item: ModeloItem) => {
    const novoValor = !item.ativo;
    setModeloItens(prev => prev.map(m => m.id === item.id ? { ...m, ativo: novoValor } : m));
    await supabase.from('checklist_modelo_itens').update({ ativo: novoValor }).eq('id', item.id);
  };

  const removerItemModelo = async (item: ModeloItem) => {
    if (!confirm(`Remover "${item.descricao}" do modelo padrão?`)) return;
    const { error } = await supabase.from('checklist_modelo_itens').delete().eq('id', item.id);
    if (error) { alert(`Erro: ${error.message}`); return; }
    registrarLogAuditoria({ usuario_nome: usuarioAtual, acao: 'REMOVEU ITEM DO MODELO PADRÃO DE CHECKLIST', setor: 'OPERACIONAL', equipamento_nome: item.descricao });
    setModeloItens(prev => prev.filter(m => m.id !== item.id));
  };

  const modeloPorSecao = useMemo(() => {
    const mapa = new Map<string, ModeloItem[]>();
    [...modeloItens].sort((a, b) => a.ordem - b.ordem).forEach(m => {
      if (!mapa.has(m.secao)) mapa.set(m.secao, []);
      mapa.get(m.secao)!.push(m);
    });
    return Array.from(mapa.entries());
  }, [modeloItens]);

  // ------------------------------------------------------------------------
  // Abre automaticamente um checklist (?id=) ou o modal de modelo padrão
  // (?modelo=1) quando chega aqui a partir da aba "Checklists" em Relatórios.
  // ------------------------------------------------------------------------
  useEffect(() => {
    if (authLoading || acessoNegado) return;

    const handle = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const idParam = params.get('id');
      const modeloParam = params.get('modelo');

      if (idParam) {
        setAbrindoAutomatico(true);
        abrirChecklist(idParam).finally(() => setAbrindoAutomatico(false));
      } else if (modeloParam) {
        abrirModalModelo();
      }
    }, 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado]);

  // ============================================================================
  // RENDERIZAÇÃO
  // ============================================================================
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Checklist de Carga.</p>
          <button onClick={() => router.push('/admin/operacional')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm no-print">
        <p className="text-[#0369A1] font-medium text-sm">
          ✅ <strong>Olá, {usuarioAtual}</strong>. Checklist de carga e retorno de equipamentos por evento.
        </p>
        <button onClick={() => (view === 'editor' ? voltarParaLista() : router.push('/admin/operacional'))} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ {view === 'editor' ? 'VOLTAR À LISTA' : 'VOLTAR AO HUB'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* ==================================================================== */}
          {/* VIEW: LISTA */}
          {/* ==================================================================== */}
          {view === 'lista' && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Checklists de Carga</h2>
                <div className="flex gap-2">
                  <button onClick={abrirModalModelo} className="bg-[#E2E8F0] hover:bg-[#CBD5E1] text-[#0C1D4D] px-4 py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-sm border border-[#CBD5E1]">
                    🛠️ Modelo Padrão
                  </button>
                  <button onClick={abrirModalNovo} className="bg-[#336699] hover:bg-[#284B8C] text-white px-6 py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-md hover:shadow-lg">
                    ➕ Novo Checklist
                  </button>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-3 mb-4">
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => { setBusca(e.target.value); setPagina(0); }}
                  placeholder="Buscar por local do evento, evento/feira ou endereço..."
                  className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
                />
                <select
                  value={filtroStatus}
                  onChange={(e) => { setFiltroStatus(e.target.value); setPagina(0); }}
                  className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
                >
                  <option value="">Todos os status</option>
                  {STATUS_CHECKLIST.map(s => <option key={s} value={s}>{LABEL_STATUS[s]}</option>)}
                </select>
              </div>

              <div className="overflow-x-auto border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
                {(listaLoading || abrindoAutomatico) && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                    <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                  </div>
                )}
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8] sticky top-0">
                    <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                      <th className="p-2">Número</th>
                      <th className="p-2">Evento/Feira</th>
                      <th className="p-2">Local do Evento</th>
                      <th className="p-2">Endereço</th>
                      <th className="p-2">Período</th>
                      <th className="p-2">Status</th>
                      <th className="p-2 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checklists.length === 0 && !listaLoading ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                          Nenhum checklist encontrado.
                        </td>
                      </tr>
                    ) : (
                      checklists.map((c) => (
                        <tr key={c.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC]">
                          <td className="p-2 font-bold">{gerarNumeroExibicao(c.numero)}</td>
                          <td className="p-2">{c.evento_feira || '—'}</td>
                          <td className="p-2">{c.cliente || '—'}</td>
                          <td className="p-2">{c.local || '—'}</td>
                          <td className="p-2">{formatarDataBR(c.periodo_inicio)} a {formatarDataBR(c.periodo_fim)}</td>
                          <td className="p-2">
                            <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${COR_STATUS[c.status]}`}>{LABEL_STATUS[c.status]}</span>
                          </td>
                          <td className="p-2 text-center space-x-2">
                            <button onClick={() => abrirChecklist(c.id)} className="bg-blue-50 text-[#336699] hover:bg-blue-100 border border-blue-200 font-bold text-[10px] uppercase px-3 py-1.5 rounded transition-colors">
                              📂 Abrir
                            </button>
                            <button onClick={() => excluirChecklist(c)} className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-bold text-[10px] uppercase px-3 py-1.5 rounded transition-colors">
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center mt-4">
                <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0 || listaLoading} className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">
                  ⬅ Anterior
                </button>
                <span className="text-xs font-bold text-[#64748B]">
                  Página {totalRegistros === 0 ? 0 : pagina + 1} de {Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA))}
                </span>
                <button onClick={() => setPagina(p => p + 1)} disabled={(pagina + 1) * TAMANHO_PAGINA >= totalRegistros || listaLoading} className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">
                  Próxima ➡
                </button>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* VIEW: EDITOR */}
          {/* ==================================================================== */}
          {view === 'editor' && (
            <>
              {/* Cabeçalho visível apenas na tela — edição dos campos do evento */}
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6 no-print">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                  <div>
                    <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">{gerarNumeroExibicao(checklistAtual.numero)}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={checklistAtual.status}
                      onChange={(e) => setChecklistAtual(prev => ({ ...prev, status: e.target.value as StatusChecklist }))}
                      className={`text-xs font-black uppercase px-3 py-2 rounded-lg border ${COR_STATUS[checklistAtual.status]}`}
                    >
                      {STATUS_CHECKLIST.map(s => <option key={s} value={s}>{LABEL_STATUS[s]}</option>)}
                    </select>
                    <button onClick={() => window.print()} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-5 py-2.5 rounded-xl shadow-md hover:bg-[#284B8C] transition-all">
                      🖨️ Imprimir / PDF
                    </button>
                    <button onClick={salvarChecklist} disabled={salvando} className="bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-xs uppercase tracking-widest px-5 py-2.5 rounded-xl shadow-md transition-colors disabled:opacity-50">
                      {salvando ? '⏳ Salvando...' : '💾 Salvar Checklist'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Evento / Feira</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-bold" value={checklistAtual.evento_feira} onChange={e => { const v = e.target.value; const localAuto = buscarLocalPadrao(v); setChecklistAtual(prev => ({ ...prev, evento_feira: v, cliente: localAuto || prev.cliente })); }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Local do Evento</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.cliente} onChange={e => setChecklistAtual(prev => ({ ...prev, cliente: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Endereço do Local</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.local} onChange={e => setChecklistAtual(prev => ({ ...prev, local: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Data de Entrega</label>
                    <input type="text" placeholder="Ex: 02/08/2026" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.data_entrega} onChange={e => setChecklistAtual(prev => ({ ...prev, data_entrega: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Período Início</label>
                    <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.periodo_inicio} onChange={e => setChecklistAtual(prev => ({ ...prev, periodo_inicio: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Período Fim</label>
                    <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.periodo_fim} onChange={e => setChecklistAtual(prev => ({ ...prev, periodo_fim: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Resp. Conferência / Saída</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.responsavel_saida} onChange={e => setChecklistAtual(prev => ({ ...prev, responsavel_saida: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Resp. Recebimento / Montagem</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.responsavel_montagem} onChange={e => setChecklistAtual(prev => ({ ...prev, responsavel_montagem: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Resp. Conferência / Retorno</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.responsavel_retorno} onChange={e => setChecklistAtual(prev => ({ ...prev, responsavel_retorno: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Cabeçalho de impressão — reproduz o layout do checklist físico */}
              <div className="hidden print:block bg-white border-2 border-black rounded-none p-4">
                <h1 className="text-xl font-black uppercase">Checklist de Carga e Retorno</h1>
                <p className="text-xs">Controle de Saída e Devolução de Equipamentos • {gerarNumeroExibicao(checklistAtual.numero)}</p>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <p><strong>Evento:</strong> {checklistAtual.evento_feira || '—'}</p>
                  <p><strong>Local do Evento:</strong> {checklistAtual.cliente || '—'}</p>
                  <p><strong>Período:</strong> {formatarDataBR(checklistAtual.periodo_inicio)} a {formatarDataBR(checklistAtual.periodo_fim)}</p>
                  <p><strong>Data de Entrega:</strong> {checklistAtual.data_entrega || '—'}</p>
                  <p className="col-span-2"><strong>Endereço:</strong> {checklistAtual.local || '—'}</p>
                </div>
              </div>

              {/* Seções de itens */}
              <div className="space-y-5">
                {itensPorSecao.map(([secao, linhas]) => (
                  <div key={secao} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden print:border print:border-black print:shadow-none print:break-inside-avoid">
                    <div className="bg-[#0C1D4D] text-white px-4 py-2.5 flex justify-between items-center print:bg-white print:text-black print:border-b-2 print:border-black">
                      <h3 className="font-black uppercase tracking-wider text-xs">{secao}</h3>
                      <button onClick={() => abrirModalAddItem(secao)} className="no-print bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase px-2 py-1 rounded transition-colors">
                        + Item
                      </button>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="bg-[#F8FAFC] print:bg-white">
                        <tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                          <th className="p-2">Descrição do Item</th>
                          <th className="p-2 w-24 text-center">Qtd. Prevista</th>
                          <th className="p-2 w-32 text-center">Saída (Separação)</th>
                          <th className="p-2 w-32 text-center">Retorno (Desmontagem)</th>
                          <th className="p-2 w-10 no-print"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map(item => (
                          <tr key={item.id} className="border-t border-[#E2E8F0]">
                            <td className="p-2">
                              <input type="text" className="w-full bg-transparent outline-none font-semibold print:font-normal" value={item.descricao} onChange={e => atualizarItem(item.id, { descricao: e.target.value })} />
                            </td>
                            <td className="p-2 text-center">
                              <input type="text" className="w-full bg-transparent outline-none text-center" value={item.qtd_prevista} onChange={e => atualizarItem(item.id, { qtd_prevista: e.target.value })} />
                            </td>
                            <td className="p-2">
                              <div className="flex items-center justify-center gap-1.5">
                                <input type="checkbox" className="w-4 h-4 accent-[#336699]" checked={item.saida_ok} onChange={e => atualizarItem(item.id, { saida_ok: e.target.checked })} />
                                <span className="text-[10px] text-[#94A3B8]">Qtd:</span>
                                <input type="number" className="w-14 bg-transparent border-b border-[#CBD5E1] outline-none text-center" value={item.saida_qtd ?? ''} onChange={e => atualizarItem(item.id, { saida_qtd: e.target.value === '' ? null : Number(e.target.value) })} />
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="flex items-center justify-center gap-1.5">
                                <input type="checkbox" className="w-4 h-4 accent-[#336699]" checked={item.retorno_ok} onChange={e => atualizarItem(item.id, { retorno_ok: e.target.checked })} />
                                <span className="text-[10px] text-[#94A3B8]">Qtd:</span>
                                <input type="number" className="w-14 bg-transparent border-b border-[#CBD5E1] outline-none text-center" value={item.retorno_qtd ?? ''} onChange={e => atualizarItem(item.id, { retorno_qtd: e.target.value === '' ? null : Number(e.target.value) })} />
                              </div>
                            </td>
                            <td className="p-2 text-center no-print">
                              <button onClick={() => removerItem(item)} className="text-red-500 hover:bg-red-50 rounded px-1.5 py-0.5 text-xs font-black">✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              <div className="no-print">
                <button onClick={() => abrirModalAddItem('')} className="bg-[#F0F4F8] hover:bg-[#E2E8F0] text-[#0C1D4D] border border-[#CBD5E1] font-black text-xs uppercase tracking-wider px-5 py-2.5 rounded-lg transition-colors">
                  + Adicionar Item em Nova Seção
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6 print:border print:border-black print:shadow-none">
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Observações de Campo / Avarias / Faltas</label>
                <textarea rows={3} className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm resize-none" value={checklistAtual.observacoes} onChange={e => setChecklistAtual(prev => ({ ...prev, observacoes: e.target.value }))} />
              </div>

              {/* Assinaturas — só aparece na impressão */}
              <div className="hidden print:grid print:grid-cols-3 print:gap-6 print:mt-8 text-xs text-center">
                <div className="border-t border-black pt-2">
                  <p className="font-bold">Conferência / Saída</p>
                  <p>{checklistAtual.responsavel_saida || 'Responsável Estoque / Galpão'}</p>
                </div>
                <div className="border-t border-black pt-2">
                  <p className="font-bold">Recebimento / Montagem</p>
                  <p>{checklistAtual.responsavel_montagem || 'Técnico no Local (Evento)'}</p>
                </div>
                <div className="border-t border-black pt-2">
                  <p className="font-bold">Conferência / Retorno</p>
                  <p>{checklistAtual.responsavel_retorno || 'Responsável Devolução'}</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ============================================================================ */}
      {/* MODAL: NOVO CHECKLIST */}
      {/* ============================================================================ */}
      {modalNovo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#336699] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">➕ Novo Checklist</h3>
              <button onClick={() => setModalNovo(false)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Evento / Feira</label>
                <input
                  type="text"
                  placeholder="Buscar evento/feira cadastrado..."
                  autoComplete="off"
                  className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm"
                  value={camposManuais.evento_feira}
                  onChange={e => {
                    setEventoSelecionado(null);
                    setCamposManuais(prev => ({ ...prev, evento_feira: e.target.value }));
                  }}
                />

                {!eventoSelecionado && (
                  <>
                    <p className="mt-2 text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider">
                      {camposManuais.evento_feira.trim().length >= 2 ? 'Resultados da busca' : 'Eventos em aberto'}
                    </p>
                    <div className="mt-1 border border-[#E2E8F0] rounded-lg divide-y divide-[#E2E8F0] max-h-56 overflow-y-auto relative min-h-[48px]">
                      {buscandoEvento && (
                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                          <div className="w-5 h-5 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                        </div>
                      )}
                      {resultadosEvento.length === 0 && !buscandoEvento ? (
                        <p className="p-3 text-center text-[10px] text-[#94A3B8] font-bold uppercase">Nenhum evento encontrado.</p>
                      ) : (
                        resultadosEvento.map(ev => (
                          <button key={ev.nome} onClick={() => selecionarEvento(ev)} className="w-full text-left p-2.5 hover:bg-[#F0F4F8] transition-colors">
                            <p className="text-xs font-bold text-[#0C1D4D]">{ev.nome}</p>
                            <p className="text-[10px] text-[#64748B]">{ev.local || 'Sem local cadastrado'} · {formatarDataBR(ev.data_inicial)} a {formatarDataBR(ev.data_final)}</p>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}

                {eventoSelecionado && (
                  <p className="mt-2 text-xs font-bold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex justify-between items-center">
                    <span>✅ Vinculado ao evento {eventoSelecionado.nome}</span>
                    <button onClick={() => { setEventoSelecionado(null); setNonceEvento(v => v + 1); }} className="text-[10px] uppercase underline text-green-800">Trocar</button>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Local do Evento</label>
                <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={camposManuais.cliente} onChange={e => setCamposManuais(prev => ({ ...prev, cliente: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Endereço do Local</label>
                <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={camposManuais.local} onChange={e => setCamposManuais(prev => ({ ...prev, local: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Período Início</label>
                  <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={camposManuais.periodo_inicio} onChange={e => setCamposManuais(prev => ({ ...prev, periodo_inicio: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Período Fim</label>
                  <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={camposManuais.periodo_fim} onChange={e => setCamposManuais(prev => ({ ...prev, periodo_fim: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Data de Entrega</label>
                <input type="text" placeholder="Ex: 02/08/2026" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={camposManuais.data_entrega} onChange={e => setCamposManuais(prev => ({ ...prev, data_entrega: e.target.value }))} />
              </div>
              <p className="text-[10px] text-[#64748B]">O checklist já nasce com o modelo padrão de itens (editável depois na tela do checklist).</p>
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={criarChecklist} disabled={criando} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-sm uppercase tracking-widest py-4 rounded-xl shadow-lg transition-colors disabled:opacity-50">
                {criando ? '⏳ Criando...' : '💾 Criar Checklist'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: ADICIONAR ITEM (no editor de um checklist) */}
      {/* ============================================================================ */}
      {modalAddItem.open && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#336699] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">+ Adicionar Item</h3>
              <button onClick={() => setModalAddItem(prev => ({ ...prev, open: false }))} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Seção</label>
                <input type="text" list="secoes-existentes" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm font-semibold" value={modalAddItem.secao} onChange={e => setModalAddItem(prev => ({ ...prev, secao: e.target.value }))} placeholder="Ex: PAINEL DE LED" />
                <datalist id="secoes-existentes">
                  {secoesExistentes.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setModalAddItem(prev => ({ ...prev, modo: 'livre' }))} className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${modalAddItem.modo === 'livre' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Item Livre</button>
                <button onClick={() => setModalAddItem(prev => ({ ...prev, modo: 'catalogo' }))} className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${modalAddItem.modo === 'catalogo' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Do Catálogo</button>
              </div>

              {modalAddItem.modo === 'livre' ? (
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Descrição</label>
                  <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm" value={modalAddItem.descricaoLivre} onChange={e => setModalAddItem(prev => ({ ...prev, descricaoLivre: e.target.value }))} placeholder="Ex: Cabos de Rede (Patch Cords)" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Categoria</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm" value={modalAddItem.categoriaId} onChange={e => setModalAddItem(prev => ({ ...prev, categoriaId: e.target.value, equipamentoId: '' }))}>
                      <option value="">-- Categoria --</option>
                      {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Equipamento</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm" value={modalAddItem.equipamentoId} onChange={e => setModalAddItem(prev => ({ ...prev, equipamentoId: e.target.value }))}>
                      <option value="">-- Equipamento --</option>
                      {equipamentosAtivos.filter(e => !modalAddItem.categoriaId || e.categoria_id === modalAddItem.categoriaId).map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Qtd. Prevista</label>
                <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm" value={modalAddItem.qtdPrevista} onChange={e => setModalAddItem(prev => ({ ...prev, qtdPrevista: e.target.value }))} placeholder="Ex: 01, Lote, Pacote..." />
              </div>
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={confirmarAddItem} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-sm uppercase tracking-widest py-3 rounded-xl shadow-lg transition-colors">
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: MODELO PADRÃO */}
      {/* ============================================================================ */}
      {modalModelo && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <div>
                <h3 className="font-black uppercase tracking-wider text-sm">🛠️ Modelo Padrão de Itens</h3>
                <p className="text-[10px] text-blue-200 mt-0.5">Usado para pré-carregar todo checklist novo.</p>
              </div>
              <button onClick={() => setModalModelo(false)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto bg-[#F8FAFC]">
              <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm mb-6">
                <h4 className="text-[10px] font-black uppercase text-[#64748B] mb-3">Adicionar Item ao Modelo</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <input type="text" list="secoes-modelo" placeholder="Seção (ex: PAINEL DE LED)" className="p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs font-semibold" value={novoModelo.secao} onChange={e => setNovoModelo(prev => ({ ...prev, secao: e.target.value }))} />
                  <datalist id="secoes-modelo">
                    {Array.from(new Set(modeloItens.map(m => m.secao))).map(s => <option key={s} value={s} />)}
                  </datalist>
                  <input type="text" placeholder="Qtd. Padrão (ex: 01, Lote, Pacote)" className="p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs" value={novoModelo.qtdPadrao} onChange={e => setNovoModelo(prev => ({ ...prev, qtdPadrao: e.target.value }))} />
                </div>
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setNovoModelo(prev => ({ ...prev, modo: 'livre' }))} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors ${novoModelo.modo === 'livre' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Item Livre</button>
                  <button onClick={() => setNovoModelo(prev => ({ ...prev, modo: 'catalogo' }))} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors ${novoModelo.modo === 'catalogo' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Do Catálogo</button>
                </div>
                {novoModelo.modo === 'livre' ? (
                  <input type="text" placeholder="Descrição do item" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs mb-3" value={novoModelo.descricaoLivre} onChange={e => setNovoModelo(prev => ({ ...prev, descricaoLivre: e.target.value }))} />
                ) : (
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <select className="p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs" value={novoModelo.categoriaId} onChange={e => setNovoModelo(prev => ({ ...prev, categoriaId: e.target.value, equipamentoId: '' }))}>
                      <option value="">-- Categoria --</option>
                      {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    <select className="p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs" value={novoModelo.equipamentoId} onChange={e => setNovoModelo(prev => ({ ...prev, equipamentoId: e.target.value }))}>
                      <option value="">-- Equipamento --</option>
                      {equipamentosAtivos.filter(e => !novoModelo.categoriaId || e.categoria_id === novoModelo.categoriaId).map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  </div>
                )}
                <button onClick={adicionarItemModelo} className="bg-[#16A34A] hover:bg-[#15803D] text-white px-4 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest transition-colors w-full">
                  Adicionar ao Modelo
                </button>
              </div>

              {modeloLoading ? (
                <p className="text-center text-[#94A3B8] text-xs font-bold py-6">Carregando modelo...</p>
              ) : (
                <div className="space-y-4">
                  {modeloPorSecao.map(([secao, linhas]) => (
                    <div key={secao}>
                      <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-2">{secao}</h4>
                      <div className="space-y-1.5">
                        {linhas.map(item => (
                          <div key={item.id} className={`flex justify-between items-center bg-white p-2.5 border border-[#E2E8F0] rounded-lg ${!item.ativo ? 'opacity-50' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-[#0C1D4D] truncate">{item.descricao}</p>
                              <p className="text-[10px] text-[#94A3B8]">Qtd. padrão: {item.qtd_padrao || '—'}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <label className="flex items-center gap-1 cursor-pointer" title="Ativo no modelo">
                                <input type="checkbox" className="w-3.5 h-3.5 accent-[#336699]" checked={item.ativo} onChange={() => alternarAtivoModelo(item)} />
                                <span className="text-[9px] font-bold text-[#64748B] uppercase">{item.ativo ? 'Ativo' : 'Inativo'}</span>
                              </label>
                              <button onClick={() => removerItemModelo(item)} className="text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-black">🗑️</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* DIALOG GERAL DE RESPOSTAS */}
      {dialog.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 no-print">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4">
            <div className="text-5xl mb-4">
              {dialog.type === 'loading' ? '⏳' : dialog.type === 'success' ? '✅' : '❌'}
            </div>
            <h3 className={`text-xl font-black uppercase tracking-wider mb-2 ${dialog.type === 'error' ? 'text-red-600' : 'text-[#0C1D4D]'}`}>
              {dialog.title}
            </h3>
            <p className="text-sm text-[#64748B] font-medium mb-6">{dialog.msg}</p>
            {dialog.type !== 'loading' && (
              <button onClick={() => setDialog(prev => ({ ...prev, open: false }))} className="w-full py-3 bg-[#0C1D4D] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg">OK, Entendido</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
