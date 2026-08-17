"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria, sincronizarEstoqueEmLocacao } from '../../../actions';
import { finalizarFichasLocacaoPorEventoAction } from './actions';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';

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

// Vínculo equipamento/categoria → acessório sugerido (mesma tabela usada em
// Estoque > Gatilhos/Acessórios e no Simulador de Videowall).
interface GatilhoAcessorio {
  id: string;
  acessorio_id: string | null;
  acessorio_categoria_id: string | null;
  categoria_alvo_id: string | null;
  equipamento_alvo_id: string | null;
}

interface AcessorioSugerido {
  id: string;
  nome: string;
  categoriaId: string | null;
  selecionado: boolean;
  qtd: string;
}

interface EventoFeiraBusca {
  nome: string;
  local: string | null;
  data_inicial: string | null;
  data_final: string | null;
  p2s_oid: string | null;
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
  // oid do Evento correspondente no PrimeStart (capturado ao vincular o
  // checklist a um evento já sincronizado) — usado só ao Finalizar, pra
  // localizar e marcar como concluídas as Fichas de Locação do evento lá.
  evento_p2s_oid: string | null;
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
  // Unidades a mais do que o pedido original prevê (ex: pedido de 50 TVs, mas
  // enviando 53 — as 3 a mais entram como uma linha separada com extra=true).
  extra: boolean;
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

// Linha extraída da coluna livre "itens" de uma OS (fichas_reserva), para revisão
// antes de importar para o checklist — nunca é gravada como está, o usuário confere.
interface ItemImportadoOS {
  key: string;
  ficha_numero: string;
  ficha_cliente: string;
  descricao: string;
  qtd: string;
  categoriaId: string; // '' = sem categoria, cai em DIVERSOS
  selecionado: boolean;
  jaExiste: boolean;
}

// Mesmo material somado entre várias OS's do evento (modo "Consolidado") —
// derivado de ItemImportadoOS, nunca editado diretamente: a quantidade é a soma
// das linhas com a mesma descrição.
interface ItemConsolidadoOS {
  descricao: string;
  qtdSomada: string;
  temQtdNaoNumerica: boolean;
  osNumeros: string[];
  categoriaId: string;
  selecionado: boolean;
  jaExiste: boolean;
}

type TipoDivergencia = 'SAIDA' | 'RETORNO';

interface DivergenciaRow {
  id: string;
  checklist_id: string;
  item_id: string | null;
  checklist_numero: number;
  tipo: TipoDivergencia;
  secao: string;
  descricao: string;
  qtd_esperada: number | null;
  qtd_real: number | null;
  usuario_nome: string;
  evento_feira: string | null;
  cliente: string | null;
  created_at: string;
}

const LABEL_TIPO_DIVERGENCIA: Record<TipoDivergencia, string> = { SAIDA: 'Saída', RETORNO: 'Retorno' };
const COR_TIPO_DIVERGENCIA: Record<TipoDivergencia, string> = {
  SAIDA: 'bg-blue-100 text-blue-700 border-blue-300',
  RETORNO: 'bg-orange-100 text-orange-700 border-orange-300',
};

const ITEM_NOVO_PREFIXO = 'novo-';
const ehItemNovo = (id: string) => id.startsWith(ITEM_NOVO_PREFIXO);
const gerarIdTemporario = () => `${ITEM_NOVO_PREFIXO}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const gerarNumeroExibicao = (n: number) => `CKL-${String(n).padStart(6, '0')}`;

// Seção usada para itens "livres" (sem vínculo com o catálogo de equipamentos) —
// evita que o usuário crie categorias/seções avulsas digitando texto livre.
const SECAO_DIVERSOS = 'DIVERSOS';

// Colunas do tipo "date" no Postgres rejeitam string vazia — normaliza para null
const dataOuNulo = (v?: string | null) => (v && v.trim() !== '' ? v : null);

// Padroniza todo texto digitado em maiúsculas (exceto campos de busca/filtro e
// campos de data/número, que não passam por aqui).
const up = (v: string) => v.toUpperCase();

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

// A coluna "itens" de fichas_reserva é texto livre — não tem estrutura
// garantida. Quebra em linhas e, se não houver quebra de linha, tenta
// separar por ponto-e-vírgula (formato usado pelo sync via API, ver
// resumoItens() em app/admin/comercial/fichas/fichasCore.ts, que sempre
// junta os itens com "; "). NÃO separa por vírgula: a observação de um item
// pode ter vírgula decimal (ex: "3,0 X 50 = 1,5" numa medida de painel de
// LED) — separar por vírgula também picava esse número em itens fantasmas
// (confirmado com a OS 027048 em produção, 2026-08-17).
const dividirItensTexto = (texto: string): string[] => {
  const porLinha = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (porLinha.length > 1) return porLinha;
  return texto.split(/;/).map(l => l.trim()).filter(Boolean);
};

// Formato da linha em fichas_reserva.itens: os dígitos até o primeiro espaço são
// a quantidade, o restante da linha é a descrição do item. Dois formatos
// convivem na mesma coluna: "2 Mesa Redonda" (upload manual antigo) e
// "10x METROS DE PAINEL..." (sync via API do PrimeStart, ver resumoItens()
// em app/admin/comercial/fichas/fichasCore.ts, que sempre grava "Nx descricao")
// — o "x"/"X" opcional entre o número e a descrição cobre os dois. Sem número
// no início, a linha inteira vira descrição e a quantidade fica em branco
// para o usuário revisar.
const parseLinhaItemOS = (linhaBruta: string): { qtd: string; descricao: string } => {
  const linha = linhaBruta.trim();
  const m = linha.match(/^(\d+)\s*[xX]?\s+(.+)$/);
  if (m) return { qtd: String(parseInt(m[1], 10)), descricao: m[2].trim() };
  return { qtd: '', descricao: linha };
};

const formatarDataHoraBR = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const TAMANHO_PAGINA = 20;

const cabecalhoVazio: ChecklistHeader = {
  id: '', numero: 0,
  evento_feira: '', cliente: '', local: '',
  periodo_inicio: '', periodo_fim: '', data_entrega: '',
  observacoes: '', responsavel_saida: '', responsavel_montagem: '', responsavel_retorno: '',
  status: 'RASCUNHO',
  evento_p2s_oid: null,
};

// ============================================================================
// COMPONENTE
// ============================================================================
export default function ChecklistCargaRetorno() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ nomeFallback: 'Usuário' });

  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'success' | 'error'; title: string; msg: string }>({ open: false, type: 'loading', title: '', msg: '' });

  const [view, setView] = useState<'lista' | 'editor' | 'divergencias'>('lista');
  const [abrindoAutomatico, setAbrindoAutomatico] = useState(false);

  // Catálogo (equipamentos/categorias) — usado nos modais de item e no modelo padrão
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [equipamentos, setEquipamentos] = useState<EquipamentoLeve[]>([]);
  const [gatilhosAcessorios, setGatilhosAcessorios] = useState<GatilhoAcessorio[]>([]);
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

  // ------------------------------------------------------------------------
  // Estado: view Divergências
  // ------------------------------------------------------------------------
  const [divergencias, setDivergencias] = useState<DivergenciaRow[]>([]);
  const [divergenciasLoading, setDivergenciasLoading] = useState(false);
  const [filtroTipoDivergencia, setFiltroTipoDivergencia] = useState<'' | TipoDivergencia>('');
  const [paginaDivergencias, setPaginaDivergencias] = useState(0);
  const [totalDivergencias, setTotalDivergencias] = useState(0);
  // Contador exibido no botão "⚠️ Divergências" da lista — toda linha em
  // checklist_divergencias é uma divergência em aberto (as resolvidas são
  // removidas de lá ao salvar), então a contagem total já é a de "ativas".
  const [totalDivergenciasAbertas, setTotalDivergenciasAbertas] = useState(0);
  const [imprimindoDivergencias, setImprimindoDivergencias] = useState(false);
  const [divergenciasImpressao, setDivergenciasImpressao] = useState<DivergenciaRow[]>([]);

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
  const [novoModelo, setNovoModelo] = useState({ modo: 'livre' as 'catalogo' | 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', observacaoCatalogo: '', qtdPadrao: '' });

  // ------------------------------------------------------------------------
  // Estado: view Editor
  // ------------------------------------------------------------------------
  const [checklistAtual, setChecklistAtual] = useState<ChecklistHeader>(cabecalhoVazio);
  const [itens, setItens] = useState<ChecklistItem[]>([]);
  // Snapshot dos itens tal como estão gravados no banco (última leitura/gravação) —
  // usado para calcular, na hora de salvar, a variação de "Em Locação" no estoque
  // (o que mudou de saida_ok/retorno_ok desde a última vez), não o estado local editado.
  const [itensOriginais, setItensOriginais] = useState<ChecklistItem[]>([]);
  const [itensRemovidos, setItensRemovidos] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  const [modalAddItem, setModalAddItem] = useState<{ open: boolean; modo: 'catalogo' | 'livre'; categoriaId: string; equipamentoId: string; descricaoLivre: string; observacaoCatalogo: string; qtdPrevista: string; extra: boolean }>({
    open: false, modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', observacaoCatalogo: '', qtdPrevista: '', extra: false,
  });

  // Modal: sugestão de acessórios (gatilhos_acessorios) ao adicionar um item do catálogo
  const [modalSugestaoAcessorios, setModalSugestaoAcessorios] = useState<{
    open: boolean;
    itemPrincipal: { secao: string; equipamentoId: string; descricao: string; qtd: string; extra: boolean } | null;
    acessorios: AcessorioSugerido[];
  }>({ open: false, itemPrincipal: null, acessorios: [] });

  // Modal: Importar Itens das OS's (fichas_reserva.itens do evento do checklist)
  const [modalImportarOS, setModalImportarOS] = useState(false);
  const [importandoOS, setImportandoOS] = useState(false);
  const [itensImportadosOS, setItensImportadosOS] = useState<ItemImportadoOS[]>([]);
  const [modoConsolidadoOS, setModoConsolidadoOS] = useState(false);

  // 1. Carregar Catálogo (equipamentos/categorias/eventos/gatilhos) após o acesso ser liberado
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    (async () => {
      const [resCat, resEq, resEventos, resGatilhos] = await Promise.all([
        supabase.from('categorias').select('*').order('nome', { ascending: true }),
        supabase.from('equipamentos').select('id, categoria_id, nome, ativo').order('nome', { ascending: true }),
        supabase.from('eventos_feiras').select('nome, local').not('local', 'is', null),
        supabase.from('gatilhos_acessorios').select('id, acessorio_id, acessorio_categoria_id, categoria_alvo_id, equipamento_alvo_id'),
      ]);
      if (resCat.data) setCategorias(resCat.data);
      if (resEq.data) setEquipamentos(resEq.data);
      if (resGatilhos.data) setGatilhosAcessorios(resGatilhos.data);
      if (resEventos.data) {
        const mapa: Record<string, string> = {};
        resEventos.data.forEach((ev: { nome: string; local: string | null }) => {
          const chave = normalizarNomeEvento(ev.nome);
          if (ev.local && !mapa[chave]) mapa[chave] = ev.local;
        });
        setMapaLocaisEventos(mapa);
      }
    })();
  }, [authLoading, acessoNegado]);

  // 2. Carregar Lista de Checklists
  useEffect(() => {
    if (authLoading || acessoNegado || view !== 'lista') return;

    const handle = setTimeout(async () => {
      setListaLoading(true);

      let query = supabase
        .from('checklists')
        .select('id, numero, evento_feira, cliente, local, periodo_inicio, periodo_fim, status, created_at', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (filtroStatus) query = query.eq('status', filtroStatus);
      if (busca.trim()) {
        const termo = `%${busca.trim()}%`;
        query = query.or(`cliente.ilike.${termo},evento_feira.ilike.${termo},local.ilike.${termo}`);
      }

      if (filtroStatus) {
        // Filtro já deixa todo mundo com o mesmo status — pode paginar direto no banco.
        query = query.range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);
        const { data, error, count } = await query;
        if (!error) {
          setChecklists(data || []);
          setTotalRegistros(count || 0);
        }
      } else {
        // Sem filtro de status: finalizados vão pro final da fila, então a
        // ordenação não dá pra fazer só com .order() do banco (misturaria
        // RASCUNHO e SAÍDA_CONFERIDA por status em vez de por recência).
        // Busca tudo que bate com a busca textual e pagina no cliente depois
        // de reordenar: ativos primeiro (por data mais recente), finalizados
        // por último (também por data mais recente).
        const { data, error, count } = await query;
        if (!error) {
          const ordenados = [...(data || [])].sort((a, b) => {
            const aFinalizado = a.status === 'FINALIZADO' ? 1 : 0;
            const bFinalizado = b.status === 'FINALIZADO' ? 1 : 0;
            if (aFinalizado !== bFinalizado) return aFinalizado - bFinalizado;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          setTotalRegistros(count ?? ordenados.length);
          setChecklists(ordenados.slice(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA));
        }
      }
      setListaLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, view, pagina, filtroStatus, busca, refreshLista]);

  // 2b. Carregar Lista de Divergências
  useEffect(() => {
    if (authLoading || acessoNegado || view !== 'divergencias') return;

    (async () => {
      setDivergenciasLoading(true);

      let query = supabase
        .from('checklist_divergencias')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(paginaDivergencias * TAMANHO_PAGINA, paginaDivergencias * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);

      if (filtroTipoDivergencia) query = query.eq('tipo', filtroTipoDivergencia);

      const { data, error, count } = await query;
      if (!error) {
        setDivergencias(data || []);
        setTotalDivergencias(count || 0);
      }
      setDivergenciasLoading(false);
    })();
  }, [authLoading, acessoNegado, view, paginaDivergencias, filtroTipoDivergencia]);

  // 2c. Contagem de divergências para o badge do botão "⚠️ Divergências" na lista
  useEffect(() => {
    if (authLoading || acessoNegado || view !== 'lista') return;
    (async () => {
      const { count } = await supabase.from('checklist_divergencias').select('id', { count: 'exact', head: true });
      setTotalDivergenciasAbertas(count || 0);
    })();
  }, [authLoading, acessoNegado, view, refreshLista]);

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
        .select('nome, local, data_inicial, data_final, p2s_oid')
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
      evento_p2s_oid: eventoSelecionado?.p2s_oid || null,
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
      evento_p2s_oid: header.evento_p2s_oid || null,
    });
    const itensIniciais = itensCriados.map(i => ({ ...i, qtd_prevista: i.qtd_prevista || '', extra: i.extra ?? false }));
    setItens(itensIniciais);
    setItensOriginais(itensIniciais);
    setItensRemovidos([]);
    setModalNovo(false);
    setView('editor');
    setCriando(false);
    router.replace(`/admin/estoque/expedicao?id=${header.id}`);
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
      evento_p2s_oid: header.evento_p2s_oid || null,
    });
    const itensCarregados = (itensData || []).map((i: ChecklistItem) => ({ ...i, qtd_prevista: i.qtd_prevista || '', extra: i.extra ?? false }));
    setItens(itensCarregados);
    setItensOriginais(itensCarregados);
    setItensRemovidos([]);
    setView('editor');
  };

  const voltarParaLista = () => {
    setView('lista');
    setRefreshLista(v => v + 1);
  };

  // Busca todas as divergências (sem paginação, respeitando o filtro de tipo em
  // tela) para gerar o relatório impresso/PDF — a tabela na tela mostra só a
  // página atual, mas a impressão precisa do total.
  const imprimirDivergencias = async () => {
    setImprimindoDivergencias(true);

    let query = supabase.from('checklist_divergencias').select('*').order('created_at', { ascending: false });
    if (filtroTipoDivergencia) query = query.eq('tipo', filtroTipoDivergencia);
    const { data, error } = await query;

    setImprimindoDivergencias(false);

    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      return;
    }
    if (!data || data.length === 0) {
      setDialog({ open: true, type: 'error', title: 'Nada para imprimir', msg: 'Não há divergências para exportar.' });
      return;
    }

    setDivergenciasImpressao(data);
    setTimeout(() => window.print(), 150);
  };

  // ------------------------------------------------------------------------
  // EDIÇÃO DE ITENS (estado local)
  // ------------------------------------------------------------------------
  const atualizarItem = (id: string, patch: Partial<ChecklistItem>) => {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  // Extrai o número da qtd. prevista (ex: "02" -> 2). Quando não é numérica
  // (ex: "Lote", "Pacote"), retorna null e o campo fica para preenchimento manual.
  const qtdNumericaPrevista = (qtdPrevista: string): number | null => {
    const n = parseInt(qtdPrevista, 10);
    return Number.isNaN(n) ? null : n;
  };

  // Marcar "Saída"/"Retorno" já preenche a quantidade com o previsto — agiliza o
  // caso comum (saiu/voltou tudo); se faltou algo, o usuário ajusta o número na mão.
  // Desmarcar limpa a quantidade, já que ela deixou de estar confirmada.
  const alternarConferencia = (item: ChecklistItem, campo: 'saida' | 'retorno', checked: boolean) => {
    atualizarItem(item.id, campo === 'saida'
      ? { saida_ok: checked, saida_qtd: checked ? qtdNumericaPrevista(item.qtd_prevista) : null }
      : { retorno_ok: checked, retorno_qtd: checked ? qtdNumericaPrevista(item.qtd_prevista) : null });
  };

  // Itens de saída cuja quantidade real não bate com a prevista (ignora itens sem
  // qtd. prevista numérica ou ainda sem saída conferida — nada para comparar).
  const itensDivergentesSaida = (lista: ChecklistItem[]): ChecklistItem[] =>
    lista.filter(i => {
      const previsto = qtdNumericaPrevista(i.qtd_prevista);
      return previsto !== null && i.saida_qtd !== null && i.saida_qtd !== previsto;
    });

  // Itens de retorno cuja quantidade real não bate com o que saiu.
  const itensDivergentesRetorno = (lista: ChecklistItem[]): ChecklistItem[] =>
    lista.filter(i => i.saida_qtd !== null && i.retorno_qtd !== null && i.retorno_qtd !== i.saida_qtd);

  // Quanto um item contribui para "Em Locação" no estoque agora: só conta enquanto
  // a Saída está conferida e o Retorno ainda não — depois do retorno, a peça volta
  // a ficar disponível. Sem quantidade real informada, assume 1 unidade.
  const contribuicaoEmLocacao = (item?: Pick<ChecklistItem, 'saida_ok' | 'retorno_ok' | 'saida_qtd'>): number => {
    if (!item || !item.saida_ok || item.retorno_ok) return 0;
    return item.saida_qtd && item.saida_qtd > 0 ? item.saida_qtd : 1;
  };

  const removerItem = (item: ChecklistItem) => {
    setItens(prev => prev.filter(i => i.id !== item.id));
    if (!ehItemNovo(item.id)) setItensRemovidos(prev => [...prev, item.id]);
  };

  const itensPorSecao = useMemo(() => {
    const mapa = new Map<string, ChecklistItem[]>();
    [...itens].sort((a, b) => a.ordem - b.ordem).forEach(i => {
      if (!mapa.has(i.secao)) mapa.set(i.secao, []);
      mapa.get(i.secao)!.push(i);
    });
    return Array.from(mapa.entries());
  }, [itens]);

  // Some itens acabam duplicados (mesmo item adicionado mais de uma vez, ou
  // importado de várias OS's do evento) — "Unificar Duplicados" junta as linhas
  // iguais (mesma seção + mesmo equipamento do catálogo, ou mesma descrição para
  // itens livres) numa só, somando as quantidades.
  const unificarItensDuplicados = () => {
    // Inclui o flag "extra" na chave: uma linha normal e uma linha extra do mesmo
    // equipamento não devem se fundir (é exatamente a separação que o usuário quer manter).
    const chaveGrupo = (i: ChecklistItem) => `${i.secao}::${i.equipamento_id || `LIVRE:${i.descricao.trim().toUpperCase()}`}::${i.extra ? 'EXTRA' : 'NORMAL'}`;
    const grupos = new Map<string, ChecklistItem[]>();
    itens.forEach(i => {
      const chave = chaveGrupo(i);
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave)!.push(i);
    });

    let qtdUnificada = 0;
    const idsRemovidosNaUniao: string[] = [];
    const novaLista: ChecklistItem[] = [];

    grupos.forEach(grupo => {
      if (grupo.length === 1) {
        novaLista.push(grupo[0]);
        return;
      }
      qtdUnificada += grupo.length - 1;

      // Prefere manter um item já existente no banco (evita apagar+recriar à toa);
      // na ausência de um, mantém o primeiro da lista.
      const base = grupo.find(i => !ehItemNovo(i.id)) || grupo[0];

      const valoresPrevistos = grupo.map(i => qtdNumericaPrevista(i.qtd_prevista));
      const qtdPrevistaFinal = valoresPrevistos.every(v => v !== null)
        ? String(valoresPrevistos.reduce((soma: number, v) => soma + (v as number), 0))
        : base.qtd_prevista;

      const todosSaidaOk = grupo.every(i => i.saida_ok);
      const todosRetornoOk = grupo.every(i => i.retorno_ok);

      novaLista.push({
        ...base,
        qtd_prevista: qtdPrevistaFinal,
        saida_ok: todosSaidaOk,
        saida_qtd: todosSaidaOk ? grupo.reduce((soma, i) => soma + (i.saida_qtd || 0), 0) : null,
        retorno_ok: todosRetornoOk,
        retorno_qtd: todosRetornoOk ? grupo.reduce((soma, i) => soma + (i.retorno_qtd || 0), 0) : null,
      });

      grupo.forEach(i => {
        if (i.id !== base.id && !ehItemNovo(i.id)) idsRemovidosNaUniao.push(i.id);
      });
    });

    if (qtdUnificada === 0) {
      setDialog({ open: true, type: 'error', title: 'Nada para unificar', msg: 'Não há itens duplicados neste checklist.' });
      return;
    }

    setItens(novaLista.sort((a, b) => a.ordem - b.ordem));
    if (idsRemovidosNaUniao.length > 0) setItensRemovidos(prev => [...prev, ...idsRemovidosNaUniao]);

    setDialog({ open: true, type: 'success', title: 'Unificado', msg: `${qtdUnificada} item(ns) duplicado(s) unificado(s). Clique em "Salvar Checklist" para confirmar.` });
    setTimeout(() => setDialog(prev => ({ ...prev, open: false })), 2400);
  };

  // Ao clicar em "+ Item" numa seção já existente, tenta pré-selecionar a categoria
  // do catálogo com o mesmo nome, para o novo item continuar naquela seção.
  const abrirModalAddItem = (secaoPreSelecionada: string) => {
    const categoriaCorrespondente = categorias.find(c => c.nome.toUpperCase() === secaoPreSelecionada.toUpperCase());
    setModalAddItem({
      open: true,
      modo: categoriaCorrespondente ? 'catalogo' : 'livre',
      categoriaId: categoriaCorrespondente?.id || '',
      equipamentoId: '', descricaoLivre: '', observacaoCatalogo: '', qtdPrevista: '', extra: false,
    });
  };

  // Empilha novos itens no checklist, atribuindo ordem sequencial a partir do maior
  // valor atual — usado tanto para um item só quanto para item + acessórios juntos.
  const adicionarItensNaLista = (novosItens: Omit<ChecklistItem, 'id' | 'ordem'>[]) => {
    let ordemAtual = itens.length > 0 ? Math.max(...itens.map(i => i.ordem)) : 0;
    const itensCompletos: ChecklistItem[] = novosItens.map(i => {
      ordemAtual += 1;
      return { ...i, id: gerarIdTemporario(), ordem: ordemAtual };
    });
    setItens(prev => [...prev, ...itensCompletos]);
  };

  // Acessórios cadastrados em Estoque > Gatilhos/Acessórios para o equipamento
  // escolhido — por vínculo direto (equipamento_alvo_id) ou por categoria inteira
  // (categoria_alvo_id), ex: toda TV sugere cabo HDMI, suporte e controle.
  const sugerirAcessorios = (equipamento: EquipamentoLeve): EquipamentoLeve[] => {
    // categoria_alvo_id vem do mesmo slug de categorias.id usado em equipamentos.categoria_id
    // (ver Estoque > Acessórios por Categoria) — normaliza como o Simulador de Videowall faz,
    // pra não perder o match por causa de maiúsculas/espaços.
    const limpar = (v: string | null) => (v || '').toLowerCase().trim();
    const categoriaAtual = limpar(equipamento.categoria_id);
    const idsSugeridos = new Set(
      gatilhosAcessorios
        .filter(g => g.equipamento_alvo_id === equipamento.id || (g.categoria_alvo_id && limpar(g.categoria_alvo_id) === categoriaAtual))
        .flatMap(g => {
          if (g.acessorio_categoria_id) {
            return equipamentosAtivos.filter(e => limpar(e.categoria_id) === limpar(g.acessorio_categoria_id)).map(e => e.id);
          }
          return g.acessorio_id ? [g.acessorio_id] : [];
        })
    );
    return equipamentosAtivos.filter(e => idsSugeridos.has(e.id) && e.id !== equipamento.id);
  };

  const modalAddItemFechado = { open: false, modo: 'livre' as const, categoriaId: '', equipamentoId: '', descricaoLivre: '', observacaoCatalogo: '', qtdPrevista: '', extra: false };

  // A seção do item nunca é digitada livremente: no modo "catálogo" ela vem da
  // categoria cadastrada do equipamento escolhido; no modo "livre" cai sempre em
  // DIVERSOS. Isso impede a criação de categorias/seções avulsas.
  const confirmarAddItem = () => {
    let descricao = '';
    let secao = SECAO_DIVERSOS;
    let equipamentoId: string | null = null;
    let equipamentoEscolhido: EquipamentoLeve | null = null;

    if (modalAddItem.modo === 'catalogo') {
      const equipamento = equipamentos.find(e => e.id === modalAddItem.equipamentoId);
      if (!equipamento) return;
      const categoria = categorias.find(c => c.id === equipamento.categoria_id);
      const observacao = modalAddItem.observacaoCatalogo.trim();
      descricao = observacao ? `${equipamento.nome} (${observacao})` : equipamento.nome;
      secao = categoria?.nome.toUpperCase() || SECAO_DIVERSOS;
      equipamentoId = equipamento.id;
      equipamentoEscolhido = equipamento;
    } else {
      descricao = modalAddItem.descricaoLivre.trim();
    }

    if (!descricao) return;

    // Se o equipamento escolhido tem acessórios sugeridos, pausa aqui e abre a
    // modal de confirmação em vez de inserir o item direto na lista.
    if (equipamentoEscolhido) {
      const sugestoes = sugerirAcessorios(equipamentoEscolhido);
      if (sugestoes.length > 0) {
        setModalSugestaoAcessorios({
          open: true,
          itemPrincipal: { secao, equipamentoId: equipamentoEscolhido.id, descricao, qtd: modalAddItem.qtdPrevista, extra: modalAddItem.extra },
          // Começa tudo desmarcado — evita inserir acessórios em massa por engano,
          // principalmente quando a sugestão vem de uma categoria inteira vinculada.
          acessorios: sugestoes.map(a => ({ id: a.id, nome: a.nome, categoriaId: a.categoria_id, selecionado: false, qtd: modalAddItem.qtdPrevista || '1' })),
        });
        setModalAddItem(modalAddItemFechado);
        return;
      }
    }

    adicionarItensNaLista([{
      secao, equipamento_id: equipamentoId, descricao, qtd_prevista: modalAddItem.qtdPrevista,
      saida_ok: false, saida_qtd: null, retorno_ok: false, retorno_qtd: null, extra: modalAddItem.extra,
    }]);
    setModalAddItem(modalAddItemFechado);
  };

  const atualizarAcessorioSugerido = (id: string, patch: Partial<AcessorioSugerido>) => {
    setModalSugestaoAcessorios(prev => ({ ...prev, acessorios: prev.acessorios.map(a => a.id === id ? { ...a, ...patch } : a) }));
  };

  // Confirma o item principal (que já ficou pendente ao abrir esta modal) e, se
  // aceito, os acessórios marcados — cada um assumindo a categoria do próprio
  // acessório no catálogo (ou DIVERSOS, se ele não tiver uma).
  const confirmarSugestaoAcessorios = (incluirAcessorios: boolean) => {
    const principal = modalSugestaoAcessorios.itemPrincipal;
    if (!principal) { setModalSugestaoAcessorios({ open: false, itemPrincipal: null, acessorios: [] }); return; }

    const novos: Omit<ChecklistItem, 'id' | 'ordem'>[] = [{
      secao: principal.secao, equipamento_id: principal.equipamentoId, descricao: principal.descricao,
      qtd_prevista: principal.qtd, saida_ok: false, saida_qtd: null, retorno_ok: false, retorno_qtd: null, extra: principal.extra,
    }];

    if (incluirAcessorios) {
      modalSugestaoAcessorios.acessorios.filter(a => a.selecionado).forEach(a => {
        const categoria = categorias.find(c => c.id === a.categoriaId);
        novos.push({
          secao: categoria?.nome.toUpperCase() || SECAO_DIVERSOS,
          equipamento_id: a.id,
          descricao: a.nome,
          qtd_prevista: a.qtd,
          // Acessório de um item extra também nasce marcado como extra (ex: cabo/suporte
          // das 3 TVs a mais também não fazem parte do pedido original).
          saida_ok: false, saida_qtd: null, retorno_ok: false, retorno_qtd: null, extra: principal.extra,
        });
      });
    }

    adicionarItensNaLista(novos);
    setModalSugestaoAcessorios({ open: false, itemPrincipal: null, acessorios: [] });
  };

  // ------------------------------------------------------------------------
  // IMPORTAR ITENS DAS OS's (fichas_reserva.itens, filtradas pelo evento do checklist)
  // ------------------------------------------------------------------------
  const abrirImportarOS = async () => {
    const evento = checklistAtual.evento_feira.trim();
    if (!evento) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'Preencha o Evento/Feira antes de importar itens das OS\'s.' });
      return;
    }

    setModalImportarOS(true);
    setImportandoOS(true);
    setItensImportadosOS([]);
    setModoConsolidadoOS(false);

    const { data, error } = await supabase
      .from('fichas_reserva')
      .select('numero, cliente, itens')
      .ilike('evento_feira', evento)
      .not('itens', 'is', null);

    setImportandoOS(false);

    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      setModalImportarOS(false);
      return;
    }

    // Itens já presentes no checklist não vêm pré-marcados, pra evitar duplicar
    // ao importar mais de uma vez.
    const descricoesAtuais = new Set(itens.map(i => i.descricao.trim().toUpperCase()));
    const linhas: ItemImportadoOS[] = [];

    (data || []).forEach((ficha: { numero: string; cliente: string | null; itens: string | null }) => {
      if (!ficha.itens || !ficha.itens.trim()) return;
      dividirItensTexto(ficha.itens).forEach((linhaBruta, idx) => {
        const { qtd, descricao } = parseLinhaItemOS(linhaBruta);
        if (!descricao) return;
        const descricaoUpper = up(descricao);
        linhas.push({
          key: `${ficha.numero}-${idx}`,
          ficha_numero: ficha.numero,
          ficha_cliente: ficha.cliente || '',
          descricao: descricaoUpper,
          qtd,
          categoriaId: '',
          selecionado: !descricoesAtuais.has(descricaoUpper),
          jaExiste: descricoesAtuais.has(descricaoUpper),
        });
      });
    });

    setItensImportadosOS(linhas);

    if (linhas.length === 0) {
      setDialog({ open: true, type: 'error', title: 'Nada encontrado', msg: `Nenhum item encontrado nas OS's do evento "${evento}".` });
      setModalImportarOS(false);
    }
  };

  const atualizarItemImportadoOS = (key: string, patch: Partial<ItemImportadoOS>) => {
    setItensImportadosOS(prev => prev.map(i => i.key === key ? { ...i, ...patch } : i));
  };

  const alternarTodosImportadosOS = (selecionar: boolean) => {
    setItensImportadosOS(prev => prev.map(i => ({ ...i, selecionado: selecionar })));
  };

  // Aplica a mesma categoria do catálogo a todas as linhas marcadas de uma vez —
  // evita ter que escolher item por item quando várias linhas são da mesma seção.
  const aplicarCategoriaSelecionadosOS = (categoriaId: string) => {
    setItensImportadosOS(prev => prev.map(i => i.selecionado ? { ...i, categoriaId } : i));
  };

  const itensImportadosPorOS = useMemo(() => {
    const mapa = new Map<string, ItemImportadoOS[]>();
    itensImportadosOS.forEach(i => {
      if (!mapa.has(i.ficha_numero)) mapa.set(i.ficha_numero, []);
      mapa.get(i.ficha_numero)!.push(i);
    });
    return Array.from(mapa.entries());
  }, [itensImportadosOS]);

  // Modo "Consolidado": agrupa linhas de OS's diferentes com a mesma descrição
  // num único item com a quantidade somada — facilita separar o material de uma
  // vez só, em vez de repetir a mesma peça uma vez por OS.
  const itensConsolidadosOS = useMemo(() => {
    const mapa = new Map<string, ItemConsolidadoOS & { qtdNumerica: number }>();
    itensImportadosOS.forEach(i => {
      const chave = i.descricao.trim().toUpperCase();
      if (!chave) return;
      const qtdNum = parseInt(i.qtd, 10);
      const existente = mapa.get(chave);
      if (!existente) {
        mapa.set(chave, {
          descricao: chave,
          qtdSomada: '',
          qtdNumerica: Number.isNaN(qtdNum) ? 0 : qtdNum,
          temQtdNaoNumerica: Number.isNaN(qtdNum),
          osNumeros: [i.ficha_numero],
          categoriaId: i.categoriaId,
          selecionado: i.selecionado,
          jaExiste: i.jaExiste,
        });
      } else {
        existente.qtdNumerica += Number.isNaN(qtdNum) ? 0 : qtdNum;
        if (Number.isNaN(qtdNum)) existente.temQtdNaoNumerica = true;
        if (!existente.osNumeros.includes(i.ficha_numero)) existente.osNumeros.push(i.ficha_numero);
        if (existente.categoriaId !== i.categoriaId) existente.categoriaId = '';
        existente.selecionado = existente.selecionado || i.selecionado;
        existente.jaExiste = existente.jaExiste && i.jaExiste;
      }
    });
    return Array.from(mapa.values()).map(v => ({
      descricao: v.descricao,
      qtdSomada: v.qtdNumerica > 0 ? String(v.qtdNumerica) : '',
      temQtdNaoNumerica: v.temQtdNaoNumerica,
      osNumeros: v.osNumeros,
      categoriaId: v.categoriaId,
      selecionado: v.selecionado,
      jaExiste: v.jaExiste,
    }));
  }, [itensImportadosOS]);

  // No modo Consolidado, marcar/trocar categoria de um grupo aplica em todas as
  // linhas originais com a mesma descrição — mantém tudo sincronizado se o usuário
  // voltar para o modo Individual.
  const alternarConsolidadoOS = (descricaoChave: string, checked: boolean) => {
    setItensImportadosOS(prev => prev.map(i => i.descricao.trim().toUpperCase() === descricaoChave ? { ...i, selecionado: checked } : i));
  };

  const aplicarCategoriaConsolidadoOS = (descricaoChave: string, categoriaId: string) => {
    setItensImportadosOS(prev => prev.map(i => i.descricao.trim().toUpperCase() === descricaoChave ? { ...i, categoriaId } : i));
  };

  // Itens importados não têm vínculo com um equipamento do catálogo (são texto
  // livre da OS), mas a seção pode ser uma categoria já cadastrada — escolhida na
  // revisão — ou, se nenhuma for escolhida, cai em DIVERSOS como um item livre.
  // No modo Consolidado, um item é criado por descrição (já com a soma das OS's);
  // no modo Individual, um item por linha de OS selecionada.
  const confirmarImportarOS = () => {
    const selecionados = modoConsolidadoOS
      ? itensConsolidadosOS.filter(c => c.selecionado).map(c => ({ descricao: c.descricao, qtd: c.qtdSomada, categoriaId: c.categoriaId }))
      : itensImportadosOS.filter(i => i.selecionado && i.descricao.trim()).map(i => ({ descricao: i.descricao.trim(), qtd: i.qtd, categoriaId: i.categoriaId }));

    if (selecionados.length === 0) { setModalImportarOS(false); return; }

    let ordemAtual = itens.length > 0 ? Math.max(...itens.map(i => i.ordem)) : 0;
    const novos: ChecklistItem[] = selecionados.map(i => {
      ordemAtual += 1;
      const categoria = categorias.find(c => c.id === i.categoriaId);
      return {
        id: gerarIdTemporario(),
        ordem: ordemAtual,
        secao: categoria?.nome.toUpperCase() || SECAO_DIVERSOS,
        equipamento_id: null,
        descricao: i.descricao,
        qtd_prevista: i.qtd,
        saida_ok: false, saida_qtd: null, retorno_ok: false, retorno_qtd: null, extra: false,
      };
    });

    setItens(prev => [...prev, ...novos]);
    registrarLogAuditoria({
      usuario_nome: usuarioAtual,
      acao: `IMPORTOU ${novos.length} ITEM(NS) DAS OS'S${modoConsolidadoOS ? ' (CONSOLIDADO)' : ''}`,
      setor: 'OPERACIONAL',
      equipamento_nome: `${gerarNumeroExibicao(checklistAtual.numero)} — ${checklistAtual.evento_feira || checklistAtual.cliente || ''}`,
    });
    setModalImportarOS(false);
    setItensImportadosOS([]);
  };

  // ------------------------------------------------------------------------
  // SALVAR CHECKLIST (header + itens)
  // ------------------------------------------------------------------------
  const salvarChecklist = async () => {
    // Resp. Conferência / Saída e / Retorno não são editáveis: são preenchidos
    // automaticamente com o usuário logado sempre que o checklist é salvo como
    // Saída Conferida / Finalizado, respectivamente. Se algum item estiver com
    // quantidade divergente, avisa antes de salvar; depois de salvo, a aba
    // Divergências é reconciliada com o estado atual dos itens (itens que
    // deixaram de divergir são removidos de lá automaticamente).
    let statusSalvo = checklistAtual.status;

    // Sugestão automática de avanço de status: se todos os itens já estão com a
    // Saída (ou o Retorno) conferidos, pergunta se quer avançar o status agora
    // em vez de exigir que o usuário troque manualmente no seletor.
    const todosSaidaConferida = itens.length > 0 && itens.every(i => i.saida_ok);
    const todosRetornoConferido = itens.length > 0 && itens.every(i => i.retorno_ok);

    if (statusSalvo === 'RASCUNHO' && todosSaidaConferida) {
      if (confirm('Todos os itens de Saída (Separação) já estão conferidos.\n\nDeseja mudar o status para "Saída Conferida"?')) {
        statusSalvo = 'SAIDA_CONFERIDA';
      }
    }

    if ((statusSalvo === 'RASCUNHO' || statusSalvo === 'SAIDA_CONFERIDA') && todosRetornoConferido) {
      if (confirm('Todos os itens de Retorno (Desmontagem) já estão conferidos.\n\nDeseja mudar o status para "Finalizado"?')) {
        statusSalvo = 'FINALIZADO';
      }
    }

    let responsavelSaida = checklistAtual.responsavel_saida;
    let responsavelRetorno = checklistAtual.responsavel_retorno;

    if (statusSalvo === 'SAIDA_CONFERIDA') {
      responsavelSaida = usuarioAtual;
      const divergentes = itensDivergentesSaida(itens);
      if (divergentes.length > 0) {
        const confirmado = confirm(`⚠️ ${divergentes.length} item(ns) de saída com quantidade divergente da prevista.\n\nDeseja salvar mesmo assim?`);
        if (!confirmado) return;
      }
    }

    if (statusSalvo === 'FINALIZADO') {
      responsavelRetorno = usuarioAtual;
      const divergentes = itensDivergentesRetorno(itens);
      if (divergentes.length > 0) {
        const confirmado = confirm(`⚠️ ${divergentes.length} item(ns) de retorno com quantidade divergente da saída.\n\nDeseja salvar mesmo assim?`);
        if (!confirmado) return;
      }
    }

    setSalvando(true);
    setChecklistAtual(prev => ({ ...prev, status: statusSalvo, responsavel_saida: responsavelSaida, responsavel_retorno: responsavelRetorno }));

    const payloadHeader = {
      evento_feira: checklistAtual.evento_feira || null,
      cliente: checklistAtual.cliente || null,
      local: checklistAtual.local || null,
      periodo_inicio: dataOuNulo(checklistAtual.periodo_inicio),
      periodo_fim: dataOuNulo(checklistAtual.periodo_fim),
      data_entrega: checklistAtual.data_entrega || null,
      observacoes: checklistAtual.observacoes || null,
      responsavel_saida: responsavelSaida || null,
      responsavel_montagem: checklistAtual.responsavel_montagem || null,
      responsavel_retorno: responsavelRetorno || null,
      status: statusSalvo,
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
        saida_ok: i.saida_ok, saida_qtd: i.saida_qtd, retorno_ok: i.retorno_ok, retorno_qtd: i.retorno_qtd, extra: i.extra,
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
        saida_ok: i.saida_ok, saida_qtd: i.saida_qtd, retorno_ok: i.retorno_ok, retorno_qtd: i.retorno_qtd, extra: i.extra,
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

    // ------------------------------------------------------------------------
    // SINCRONIZAR "EM LOCAÇÃO" NO ESTOQUE
    // Compara o que cada item contribuía para "Em Locação" antes (itensOriginais,
    // última leitura/gravação do banco) contra agora (itens, estado local recém
    // salvo) e aplica só a diferença por equipamento — assim funciona mesmo com
    // vários checklists mexendo no mesmo equipamento ao mesmo tempo. Item excluído
    // do checklist enquanto ainda estava "em locação" libera a peça de volta.
    const deltasPorEquipamento: Record<string, number> = {};
    const registrarDelta = (equipamentoId: string | null, delta: number) => {
      if (!equipamentoId || delta === 0) return;
      deltasPorEquipamento[equipamentoId] = (deltasPorEquipamento[equipamentoId] || 0) + delta;
    };

    itens.forEach(item => {
      const original = itensOriginais.find(o => o.id === item.id);
      registrarDelta(item.equipamento_id, contribuicaoEmLocacao(item) - contribuicaoEmLocacao(original));
    });
    itensRemovidos.forEach(id => {
      const original = itensOriginais.find(o => o.id === id);
      if (original) registrarDelta(original.equipamento_id, -contribuicaoEmLocacao(original));
    });

    let erroEstoque: string | null = null;
    const idsEquipamentosAfetados = Object.keys(deltasPorEquipamento);
    if (idsEquipamentosAfetados.length > 0) {
      // Roda como Server Action com a service role: a tabela `estoque` não libera
      // INSERT para o cliente autenticado via RLS, e aqui pode ser necessário criar
      // a linha na primeira vez que o equipamento sai (ver app/actions.ts).
      const resultado = await sincronizarEstoqueEmLocacao(
        idsEquipamentosAfetados.map(id => ({ equipamento_id: id, delta: deltasPorEquipamento[id] })),
        accessToken
      );

      if (!resultado.success) {
        erroEstoque = resultado.message || 'Falha desconhecida ao atualizar o estoque.';
      } else {
        registrarLogAuditoria({
          usuario_nome: usuarioAtual,
          acao: 'ATUALIZOU ESTOQUE (EM LOCAÇÃO) VIA CHECKLIST',
          setor: 'ESTOQUE',
          equipamento_nome: `${gerarNumeroExibicao(checklistAtual.numero)} — ${idsEquipamentosAfetados.length} equipamento(s)`,
        });
      }
    }

    // ------------------------------------------------------------------------
    // FINALIZAR FICHAS DE LOCAÇÃO NO PRIMESTART (P2S)
    // A tentativa original (Update genérico setando Status="F" direto) não
    // funcionava — o campo é recalculado pelo servidor, não é livre. A P2S
    // confirmou (2026-08-17) que o jeito certo é chamar o método de negócio
    // gExpedicao.EfetuaRetornoLocacao, e finalizarFichasLocacaoPorEventoAction
    // (./actions) foi reescrita pra usar ele — validado em Sandbox com round-
    // trip completo (Status virou "F", saldo de estoque voltou). Ainda
    // Habilitada em 2026-08-17 após validação completa em Sandbox.
    const ESCRITA_P2S_FICHA_LOCACAO_HABILITADA = true;
    let erroP2s: string | null = null;
    let avisoP2s = '';
    if (ESCRITA_P2S_FICHA_LOCACAO_HABILITADA && statusSalvo === 'FINALIZADO' && checklistAtual.evento_p2s_oid) {
      const resultadoP2s = await finalizarFichasLocacaoPorEventoAction(checklistAtual.evento_p2s_oid, accessToken);
      if (!resultadoP2s.ok) {
        erroP2s = resultadoP2s.erro || 'Falha desconhecida ao atualizar fichas no PrimeStart.';
      } else {
        const info = resultadoP2s.info as import('./actions').FinalizarFichasLocacaoInfo;
        if (info.falhas.length > 0) {
          erroP2s = `${info.atualizadas} ficha(s) finalizada(s), mas ${info.falhas.length} falharam: ${info.falhas.map(f => f.numero).join(', ')}`;
        } else if (info.atualizadas > 0 || info.jaEstavamFinalizadas > 0) {
          avisoP2s = ` PrimeStart: ${info.atualizadas} ficha(s) de locação marcada(s) como finalizada(s)${info.jaEstavamFinalizadas > 0 ? ` (${info.jaEstavamFinalizadas} já estavam)` : ''}.`;
          registrarLogAuditoria({
            usuario_nome: usuarioAtual,
            acao: 'FINALIZOU FICHAS DE LOCAÇÃO NO PRIMESTART (P2S)',
            setor: 'OPERACIONAL',
            equipamento_nome: `${gerarNumeroExibicao(checklistAtual.numero)} — ${info.atualizadas} ficha(s)`,
          });
        }
      }
    }

    // Recarrega do banco para normalizar ids dos itens recém-criados (necessário
    // antes de reconciliar divergências, que usam o id real do item como chave)
    const { data: itensAtualizados } = await supabase.from('checklist_itens').select('*').eq('checklist_id', checklistAtual.id).order('ordem', { ascending: true });
    const itensSalvos: ChecklistItem[] = (itensAtualizados || []).map((i: ChecklistItem) => ({ ...i, qtd_prevista: i.qtd_prevista || '', extra: i.extra ?? false }));
    setItens(itensSalvos);
    setItensOriginais(itensSalvos);
    setItensRemovidos([]);

    // Reconcilia a aba Divergências apenas para o tipo do status salvo agora:
    // itens ainda divergentes são gravados/atualizados, itens que deixaram de
    // divergir (corrigidos) são removidos da lista.
    let erroDivergencia: string | null = null;
    let qtdDivergenciasAtivas = 0;
    if (statusSalvo === 'SAIDA_CONFERIDA' || statusSalvo === 'FINALIZADO') {
      const tipo: TipoDivergencia = statusSalvo === 'SAIDA_CONFERIDA' ? 'SAIDA' : 'RETORNO';
      const divergentesAtuais = tipo === 'SAIDA' ? itensDivergentesSaida(itensSalvos) : itensDivergentesRetorno(itensSalvos);
      const idsDivergentes = divergentesAtuais.map(i => i.id);
      qtdDivergenciasAtivas = divergentesAtuais.length;

      const { data: existentes, error: erroConsulta } = await supabase
        .from('checklist_divergencias').select('id, item_id').eq('checklist_id', checklistAtual.id).eq('tipo', tipo);

      if (erroConsulta) {
        erroDivergencia = erroConsulta.message;
      } else {
        const idsResolvidos = (existentes || []).filter(d => d.item_id && !idsDivergentes.includes(d.item_id)).map(d => d.id);
        if (idsResolvidos.length > 0) {
          const { error } = await supabase.from('checklist_divergencias').delete().in('id', idsResolvidos);
          if (error) erroDivergencia = error.message;
        }

        if (!erroDivergencia && divergentesAtuais.length > 0) {
          const payload = divergentesAtuais.map(item => ({
            checklist_id: checklistAtual.id,
            item_id: item.id,
            checklist_numero: checklistAtual.numero,
            tipo,
            secao: item.secao,
            descricao: item.descricao,
            qtd_esperada: tipo === 'SAIDA' ? qtdNumericaPrevista(item.qtd_prevista) : item.saida_qtd,
            qtd_real: tipo === 'SAIDA' ? item.saida_qtd : item.retorno_qtd,
            usuario_nome: usuarioAtual,
            evento_feira: checklistAtual.evento_feira || null,
            cliente: checklistAtual.cliente || null,
            updated_at: new Date().toISOString(),
          }));
          const { error } = await supabase.from('checklist_divergencias').upsert(payload, { onConflict: 'item_id,tipo' });
          if (error) erroDivergencia = error.message;
        }

        if (!erroDivergencia && (qtdDivergenciasAtivas > 0 || idsResolvidos.length > 0)) {
          registrarLogAuditoria({
            usuario_nome: usuarioAtual,
            acao: `RECONCILIOU DIVERGÊNCIAS (${LABEL_TIPO_DIVERGENCIA[tipo].toUpperCase()}): ${qtdDivergenciasAtivas} ATIVA(S), ${idsResolvidos.length} RESOLVIDA(S)`,
            setor: 'OPERACIONAL',
            equipamento_nome: `${gerarNumeroExibicao(checklistAtual.numero)} — ${checklistAtual.evento_feira || checklistAtual.cliente || ''}`,
          });
        }
      }
    }

    setSalvando(false);

    const erroPosSalvamento = erroDivergencia || erroEstoque || erroP2s;
    const avisoEstoque = idsEquipamentosAfetados.length > 0 && !erroEstoque
      ? ` Estoque atualizado (${idsEquipamentosAfetados.length} equipamento(s) em locação/liberado(s)).`
      : '';

    setDialog(erroPosSalvamento
      ? {
          open: true, type: 'error', title: 'Checklist salvo, mas...',
          msg: erroDivergencia ? `Falhou ao atualizar a aba Divergências: ${erroDivergencia}`
            : erroEstoque ? `Falhou ao atualizar o estoque: ${erroEstoque}`
            : `Falhou ao atualizar fichas no PrimeStart: ${erroP2s}`,
        }
      : { open: true, type: 'success', title: 'Salvo', msg: `Checklist atualizado com sucesso.${qtdDivergenciasAtivas > 0 ? ` ${qtdDivergenciasAtivas} item(ns) divergente(s) em Divergências.` : ''}${avisoEstoque}${avisoP2s}` });
    if (!erroPosSalvamento) {
      setTimeout(() => setDialog(prev => ({ ...prev, open: false })), qtdDivergenciasAtivas > 0 || avisoEstoque || avisoP2s ? 2400 : 1800);
      voltarParaLista();
    }
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
    setNovoModelo({ modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', observacaoCatalogo: '', qtdPadrao: '' });
    carregarModelo();
  };

  // Mesma regra do checklist: seção vem da categoria do equipamento (catálogo) ou
  // é DIVERSOS (item livre) — nunca digitada livremente.
  const adicionarItemModelo = async () => {
    let descricao = '';
    let secao = SECAO_DIVERSOS;
    let equipamentoId: string | null = null;

    if (novoModelo.modo === 'catalogo') {
      const equipamento = equipamentos.find(e => e.id === novoModelo.equipamentoId);
      if (!equipamento) return;
      const categoria = categorias.find(c => c.id === equipamento.categoria_id);
      const observacao = novoModelo.observacaoCatalogo.trim();
      descricao = observacao ? `${equipamento.nome} (${observacao})` : equipamento.nome;
      secao = categoria?.nome.toUpperCase() || SECAO_DIVERSOS;
      equipamentoId = equipamento.id;
    } else {
      descricao = novoModelo.descricaoLivre.trim();
    }

    if (!descricao) return;

    const maiorOrdem = modeloItens.length > 0 ? Math.max(...modeloItens.map(m => m.ordem)) : 0;
    const { error } = await supabase.from('checklist_modelo_itens').insert([{
      ordem: maiorOrdem + 1,
      secao,
      equipamento_id: equipamentoId,
      descricao,
      qtd_padrao: novoModelo.qtdPadrao || null,
      ativo: true,
    }]);

    if (error) {
      alert(`Erro: ${error.message}`);
      return;
    }

    registrarLogAuditoria({ usuario_nome: usuarioAtual, acao: 'ADICIONOU ITEM AO MODELO PADRÃO DE CHECKLIST', setor: 'OPERACIONAL', equipamento_nome: descricao });
    setNovoModelo({ modo: 'livre', categoriaId: '', equipamentoId: '', descricaoLivre: '', observacaoCatalogo: '', qtdPadrao: '' });
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

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Expedição.</p>
          <button onClick={() => router.push('/admin/estoque')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
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
          ✅ <strong>Olá, {usuarioAtual}</strong>. Expedição: saída e retorno de equipamentos por evento.
        </p>
        <button onClick={() => (view === 'lista' ? router.push('/admin/estoque') : voltarParaLista())} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ {view === 'lista' ? 'VOLTAR AO HUB' : 'VOLTAR À LISTA'}
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
                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  <button onClick={() => setView('divergencias')} className="bg-orange-50 hover:bg-orange-100 text-orange-700 px-4 py-2.5 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-sm border border-orange-200">
                    ⚠️ Divergências{totalDivergenciasAbertas > 0 ? ` (${totalDivergenciasAbertas})` : ''}
                  </button>
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
          {/* VIEW: DIVERGÊNCIAS */}
          {/* ==================================================================== */}
          {view === 'divergencias' && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6 no-print">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">⚠️ Divergências</h2>
                  <p className="text-xs text-[#64748B] mt-0.5">Itens salvos com quantidade diferente da esperada na Saída ou no Retorno.</p>
                </div>
                <div className="flex gap-2 items-center">
                  <select
                    value={filtroTipoDivergencia}
                    onChange={(e) => { setFiltroTipoDivergencia(e.target.value as '' | TipoDivergencia); setPaginaDivergencias(0); }}
                    className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
                  >
                    <option value="">Todos os tipos</option>
                    <option value="SAIDA">Saída</option>
                    <option value="RETORNO">Retorno</option>
                  </select>
                  <button onClick={imprimirDivergencias} disabled={imprimindoDivergencias} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-5 py-2.5 rounded-xl shadow-md hover:bg-[#284B8C] transition-all disabled:opacity-50">
                    {imprimindoDivergencias ? '⏳ Gerando...' : '🖨️ Imprimir / PDF'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
                {divergenciasLoading && (
                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                    <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                  </div>
                )}
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8] sticky top-0">
                    <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                      <th className="p-2">Data</th>
                      <th className="p-2">Checklist</th>
                      <th className="p-2">Tipo</th>
                      <th className="p-2">Item</th>
                      <th className="p-2 text-center">Esperado</th>
                      <th className="p-2 text-center">Real</th>
                      <th className="p-2">Usuário</th>
                      <th className="p-2 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {divergencias.length === 0 && !divergenciasLoading ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                          Nenhuma divergência registrada.
                        </td>
                      </tr>
                    ) : (
                      divergencias.map((d) => (
                        <tr key={d.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC]">
                          <td className="p-2 whitespace-nowrap">{formatarDataHoraBR(d.created_at)}</td>
                          <td className="p-2">
                            <p className="font-bold">{gerarNumeroExibicao(d.checklist_numero)}</p>
                            <p className="text-[10px] text-[#64748B]">{d.evento_feira || d.cliente || '—'}</p>
                          </td>
                          <td className="p-2">
                            <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${COR_TIPO_DIVERGENCIA[d.tipo]}`}>{LABEL_TIPO_DIVERGENCIA[d.tipo]}</span>
                          </td>
                          <td className="p-2">
                            <p className="font-semibold">{d.descricao}</p>
                            <p className="text-[10px] text-[#64748B]">{d.secao}</p>
                          </td>
                          <td className="p-2 text-center">{d.qtd_esperada ?? '—'}</td>
                          <td className="p-2 text-center font-bold text-orange-600">{d.qtd_real ?? '—'}</td>
                          <td className="p-2">{d.usuario_nome}</td>
                          <td className="p-2 text-center">
                            <button onClick={() => abrirChecklist(d.checklist_id)} className="bg-blue-50 text-[#336699] hover:bg-blue-100 border border-blue-200 font-bold text-[10px] uppercase px-3 py-1.5 rounded transition-colors">
                              📂 Abrir
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center mt-4">
                <button onClick={() => setPaginaDivergencias(p => Math.max(0, p - 1))} disabled={paginaDivergencias === 0 || divergenciasLoading} className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">
                  ⬅ Anterior
                </button>
                <span className="text-xs font-bold text-[#64748B]">
                  Página {totalDivergencias === 0 ? 0 : paginaDivergencias + 1} de {Math.max(1, Math.ceil(totalDivergencias / TAMANHO_PAGINA))}
                </span>
                <button onClick={() => setPaginaDivergencias(p => p + 1)} disabled={(paginaDivergencias + 1) * TAMANHO_PAGINA >= totalDivergencias || divergenciasLoading} className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">
                  Próxima ➡
                </button>
              </div>
            </div>
          )}

          {/* Relatório de divergências — só existe/aparece na impressão, gerado pelo
              botão Imprimir/PDF acima (busca todas as páginas, sem paginação). Preso
              à view Divergências pra não vazar pro print do checklist em outra aba. */}
          {view === 'divergencias' && divergenciasImpressao.length > 0 && (
            <div className="hidden print:block bg-white p-4">
              <h1 className="text-xl font-black uppercase">Relatório de Divergências</h1>
              <p className="text-xs">
                Gerado em {formatarDataHoraBR(new Date().toISOString())}
                {filtroTipoDivergencia ? ` • Filtro: ${LABEL_TIPO_DIVERGENCIA[filtroTipoDivergencia]}` : ''}
                {` • ${divergenciasImpressao.length} registro(s)`}
              </p>
              <table className="w-full text-xs mt-4 border-collapse">
                <thead>
                  <tr className="text-left border-b-2 border-black">
                    <th className="p-1">Data</th>
                    <th className="p-1">Checklist</th>
                    <th className="p-1">Tipo</th>
                    <th className="p-1">Item</th>
                    <th className="p-1 text-center">Esperado</th>
                    <th className="p-1 text-center">Real</th>
                    <th className="p-1">Usuário</th>
                  </tr>
                </thead>
                <tbody>
                  {divergenciasImpressao.map(d => (
                    <tr key={d.id} className="border-b border-gray-300">
                      <td className="p-1 whitespace-nowrap">{formatarDataHoraBR(d.created_at)}</td>
                      <td className="p-1">{gerarNumeroExibicao(d.checklist_numero)} — {d.evento_feira || d.cliente || '—'}</td>
                      <td className="p-1">{LABEL_TIPO_DIVERGENCIA[d.tipo]}</td>
                      <td className="p-1">{d.descricao} ({d.secao})</td>
                      <td className="p-1 text-center">{d.qtd_esperada ?? '—'}</td>
                      <td className="p-1 text-center">{d.qtd_real ?? '—'}</td>
                      <td className="p-1">{d.usuario_nome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                  <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                    <select
                      value={checklistAtual.status}
                      onChange={(e) => setChecklistAtual(prev => ({ ...prev, status: e.target.value as StatusChecklist }))}
                      className={`text-xs font-black uppercase px-3 py-2 rounded-lg border ${COR_STATUS[checklistAtual.status]}`}
                    >
                      {STATUS_CHECKLIST.map(s => <option key={s} value={s}>{LABEL_STATUS[s]}</option>)}
                    </select>
                    <button onClick={abrirImportarOS} className="bg-[#E2E8F0] hover:bg-[#CBD5E1] text-[#0C1D4D] font-black uppercase tracking-widest text-xs px-3 md:px-5 py-2.5 rounded-xl shadow-sm border border-[#CBD5E1] transition-colors">
                      📦 Importar das OS&apos;s
                    </button>
                    <button onClick={unificarItensDuplicados} title="Junta itens repetidos (mesma seção e mesmo item) somando as quantidades" className="bg-[#E2E8F0] hover:bg-[#CBD5E1] text-[#0C1D4D] font-black uppercase tracking-widest text-xs px-3 md:px-5 py-2.5 rounded-xl shadow-sm border border-[#CBD5E1] transition-colors">
                      🧩 Unificar Duplicados
                    </button>
                    <button onClick={() => window.print()} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-3 md:px-5 py-2.5 rounded-xl shadow-md hover:bg-[#284B8C] transition-all">
                      🖨️ Imprimir / PDF
                    </button>
                    <button onClick={salvarChecklist} disabled={salvando} className="bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-xs uppercase tracking-widest px-3 md:px-5 py-2.5 rounded-xl shadow-md transition-colors disabled:opacity-50">
                      {salvando ? '⏳ Salvando...' : '💾 Salvar Checklist'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Evento / Feira</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-bold uppercase" value={checklistAtual.evento_feira} onChange={e => { const v = up(e.target.value); const localAuto = buscarLocalPadrao(v); setChecklistAtual(prev => ({ ...prev, evento_feira: v, cliente: localAuto || prev.cliente })); }} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Local do Evento</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm uppercase" value={checklistAtual.cliente} onChange={e => setChecklistAtual(prev => ({ ...prev, cliente: up(e.target.value) }))} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Endereço do Local</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm uppercase" value={checklistAtual.local} onChange={e => setChecklistAtual(prev => ({ ...prev, local: up(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Data de Entrega</label>
                    <input type="text" placeholder="Ex: 02/08/2026" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={checklistAtual.data_entrega} onChange={e => setChecklistAtual(prev => ({ ...prev, data_entrega: up(e.target.value) }))} />
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
                    <input type="text" readOnly disabled className="w-full p-2 border border-[#E2E8F0] bg-[#F0F4F8] rounded outline-none text-sm uppercase text-[#64748B] cursor-not-allowed" value={checklistAtual.responsavel_saida} placeholder="Preenchido ao salvar como Saída Conferida" />
                    <p className="mt-1 text-[9px] text-[#94A3B8]">Automático: preenchido com o usuário logado ao salvar como Saída Conferida.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Resp. Recebimento / Montagem</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm uppercase" value={checklistAtual.responsavel_montagem} onChange={e => setChecklistAtual(prev => ({ ...prev, responsavel_montagem: up(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Resp. Conferência / Retorno</label>
                    <input type="text" readOnly disabled className="w-full p-2 border border-[#E2E8F0] bg-[#F0F4F8] rounded outline-none text-sm uppercase text-[#64748B] cursor-not-allowed" value={checklistAtual.responsavel_retorno} placeholder="Preenchido ao salvar como Finalizado" />
                    <p className="mt-1 text-[9px] text-[#94A3B8]">Automático: preenchido com o usuário logado ao salvar como Finalizado.</p>
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
                    {/* Mobile: cartões empilhados — a tabela abaixo não cabe numa tela de
                        celular sem cortar colunas, e é nela que o time preenche o checklist
                        em campo. */}
                    <div className="md:hidden print:hidden divide-y divide-[#E2E8F0]">
                      {linhas.map(item => (
                        <div key={item.id} className={`p-3 space-y-2.5 ${item.extra ? 'bg-amber-50' : ''}`}>
                          <div className="flex items-start gap-2">
                            <input type="text" className="flex-1 min-w-0 bg-transparent outline-none font-semibold uppercase text-sm" value={item.descricao} onChange={e => atualizarItem(item.id, { descricao: up(e.target.value) })} />
                            {item.extra && <span className="flex-shrink-0 bg-amber-400 text-amber-900 text-[9px] font-black uppercase px-1.5 py-0.5 rounded">Extra</span>}
                            <button onClick={() => removerItem(item)} className="flex-shrink-0 text-red-500 hover:bg-red-50 rounded px-2 py-1 text-xs font-black">✕</button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[11px] text-[#64748B] font-bold uppercase">
                              <span>Qtd. Prevista:</span>
                              <input type="text" className="w-16 bg-transparent border-b border-[#CBD5E1] outline-none text-center uppercase text-[#0A2A4A]" value={item.qtd_prevista} onChange={e => atualizarItem(item.id, { qtd_prevista: up(e.target.value) })} />
                            </div>
                            <label className="flex items-center gap-1.5 text-[10px] text-amber-700 font-bold uppercase">
                              <input type="checkbox" className="w-4 h-4 accent-amber-600 flex-shrink-0" checked={item.extra} onChange={e => atualizarItem(item.id, { extra: e.target.checked })} />
                              Extra
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="flex items-center justify-center gap-1.5 border border-[#E2E8F0] rounded-lg p-2">
                              <input type="checkbox" className="w-4 h-4 accent-[#336699] flex-shrink-0" checked={item.saida_ok} onChange={e => alternarConferencia(item, 'saida', e.target.checked)} />
                              <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Saída:</span>
                              <input type="number" className="w-12 bg-transparent border-b border-[#CBD5E1] outline-none text-center" value={item.saida_qtd ?? ''} onChange={e => atualizarItem(item.id, { saida_qtd: e.target.value === '' ? null : Number(e.target.value) })} />
                            </label>
                            <label className="flex items-center justify-center gap-1.5 border border-[#E2E8F0] rounded-lg p-2">
                              <input type="checkbox" className="w-4 h-4 accent-[#336699] flex-shrink-0" checked={item.retorno_ok} onChange={e => alternarConferencia(item, 'retorno', e.target.checked)} />
                              <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Retorno:</span>
                              <input type="number" className="w-12 bg-transparent border-b border-[#CBD5E1] outline-none text-center" value={item.retorno_qtd ?? ''} onChange={e => atualizarItem(item.id, { retorno_qtd: e.target.value === '' ? null : Number(e.target.value) })} />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop / impressão: tabela original */}
                    <table className="hidden md:table print:table w-full text-xs">
                      <thead className="bg-[#F8FAFC] print:bg-white">
                        <tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                          <th className="p-2">Descrição do Item</th>
                          <th className="p-2 w-24 text-center">Qtd. Prevista</th>
                          <th className="p-2 w-16 text-center no-print">Extra</th>
                          <th className="p-2 w-32 text-center">Saída (Separação)</th>
                          <th className="p-2 w-32 text-center">Retorno (Desmontagem)</th>
                          <th className="p-2 w-10 no-print"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map(item => (
                          <tr key={item.id} className={`border-t border-[#E2E8F0] ${item.extra ? 'bg-amber-50' : ''}`}>
                            <td className="p-2">
                              <div className="flex items-center gap-1.5">
                                <input type="text" className="flex-1 min-w-0 bg-transparent outline-none font-semibold print:font-normal uppercase" value={item.descricao} onChange={e => atualizarItem(item.id, { descricao: up(e.target.value) })} />
                                {item.extra && <span className="flex-shrink-0 bg-amber-400 text-amber-900 text-[9px] font-black uppercase px-1.5 py-0.5 rounded">Extra</span>}
                              </div>
                            </td>
                            <td className="p-2 text-center">
                              <input type="text" className="w-full bg-transparent outline-none text-center uppercase" value={item.qtd_prevista} onChange={e => atualizarItem(item.id, { qtd_prevista: up(e.target.value) })} />
                            </td>
                            <td className="p-2 text-center no-print">
                              <input type="checkbox" className="w-4 h-4 accent-amber-600" checked={item.extra} onChange={e => atualizarItem(item.id, { extra: e.target.checked })} />
                            </td>
                            <td className="p-2">
                              <div className="flex items-center justify-center gap-1.5">
                                <input type="checkbox" className="w-4 h-4 accent-[#336699]" checked={item.saida_ok} onChange={e => alternarConferencia(item, 'saida', e.target.checked)} />
                                <span className="text-[10px] text-[#94A3B8]">Qtd:</span>
                                <input type="number" className="w-14 bg-transparent border-b border-[#CBD5E1] outline-none text-center" value={item.saida_qtd ?? ''} onChange={e => atualizarItem(item.id, { saida_qtd: e.target.value === '' ? null : Number(e.target.value) })} />
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="flex items-center justify-center gap-1.5">
                                <input type="checkbox" className="w-4 h-4 accent-[#336699]" checked={item.retorno_ok} onChange={e => alternarConferencia(item, 'retorno', e.target.checked)} />
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
                <textarea rows={3} className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm resize-none uppercase" value={checklistAtual.observacoes} onChange={e => setChecklistAtual(prev => ({ ...prev, observacoes: up(e.target.value) }))} />
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
                  className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm uppercase"
                  value={camposManuais.evento_feira}
                  onChange={e => {
                    setEventoSelecionado(null);
                    setCamposManuais(prev => ({ ...prev, evento_feira: up(e.target.value) }));
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
                <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm uppercase" value={camposManuais.cliente} onChange={e => setCamposManuais(prev => ({ ...prev, cliente: up(e.target.value) }))} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Endereço do Local</label>
                <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm uppercase" value={camposManuais.local} onChange={e => setCamposManuais(prev => ({ ...prev, local: up(e.target.value) }))} />
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
                <input type="text" placeholder="Ex: 02/08/2026" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={camposManuais.data_entrega} onChange={e => setCamposManuais(prev => ({ ...prev, data_entrega: up(e.target.value) }))} />
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
              <div className="flex gap-2">
                <button onClick={() => setModalAddItem(prev => ({ ...prev, modo: 'livre' }))} className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${modalAddItem.modo === 'livre' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Item Livre</button>
                <button onClick={() => setModalAddItem(prev => ({ ...prev, modo: 'catalogo' }))} className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${modalAddItem.modo === 'catalogo' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Do Catálogo</button>
              </div>

              {modalAddItem.modo === 'livre' ? (
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Descrição</label>
                  <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm uppercase" value={modalAddItem.descricaoLivre} onChange={e => setModalAddItem(prev => ({ ...prev, descricaoLivre: up(e.target.value) }))} placeholder="Ex: Cabos de Rede (Patch Cords)" />
                  <p className="mt-1 text-[10px] text-[#94A3B8]">Itens livres entram na seção <strong>{SECAO_DIVERSOS}</strong>.</p>
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
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Observação (opcional)</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm uppercase" value={modalAddItem.observacaoCatalogo} onChange={e => setModalAddItem(prev => ({ ...prev, observacaoCatalogo: up(e.target.value) }))} placeholder="Ex: cor branca, com estabilizador..." />
                    {modalAddItem.equipamentoId && (
                      <p className="mt-1 text-[10px] text-[#94A3B8]">
                        Descrição final: <strong>{equipamentos.find(e => e.id === modalAddItem.equipamentoId)?.nome}{modalAddItem.observacaoCatalogo.trim() ? ` (${modalAddItem.observacaoCatalogo.trim()})` : ''}</strong>
                      </p>
                    )}
                  </div>
                  <p className="col-span-2 text-[10px] text-[#94A3B8]">A seção do item é a categoria do equipamento escolhido — não é possível criar seções avulsas.</p>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Qtd. Prevista</label>
                <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm uppercase" value={modalAddItem.qtdPrevista} onChange={e => setModalAddItem(prev => ({ ...prev, qtdPrevista: up(e.target.value) }))} placeholder="Ex: 01, Lote, Pacote..." />
              </div>

              <label className="flex items-center gap-2 p-2.5 border border-amber-300 bg-amber-50 rounded-lg cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-amber-600 flex-shrink-0" checked={modalAddItem.extra} onChange={e => setModalAddItem(prev => ({ ...prev, extra: e.target.checked }))} />
                <span className="text-xs font-bold text-amber-800 uppercase">Equipamento Extra (a mais do que o pedido original)</span>
              </label>
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={confirmarAddItem} disabled={modalAddItem.modo === 'catalogo' ? !modalAddItem.equipamentoId : !modalAddItem.descricaoLivre.trim()} className="w-full bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm uppercase tracking-widest py-3 rounded-xl shadow-lg transition-colors">
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: SUGESTÃO DE ACESSÓRIOS (gatilhos_acessorios) */}
      {/* ============================================================================ */}
      {modalSugestaoAcessorios.open && modalSugestaoAcessorios.itemPrincipal && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#336699] p-5 text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">🧩 Acessórios Sugeridos</h3>
              <p className="text-[10px] text-blue-100 mt-0.5">Para {modalSugestaoAcessorios.itemPrincipal.descricao}, o estoque tem os seguintes acessórios vinculados:</p>
            </div>

            <div className="p-6 overflow-y-auto space-y-2 bg-[#F8FAFC]">
              {modalSugestaoAcessorios.acessorios.map(a => (
                <div key={a.id} className="flex items-center gap-2 p-2 border border-[#E2E8F0] bg-white rounded-lg">
                  <input type="checkbox" className="w-4 h-4 accent-[#336699] flex-shrink-0" checked={a.selecionado} onChange={e => atualizarAcessorioSugerido(a.id, { selecionado: e.target.checked })} />
                  <span className="flex-1 min-w-0 text-xs font-semibold uppercase truncate">{a.nome}</span>
                  <input type="text" className="w-16 flex-shrink-0 bg-transparent border-b border-[#CBD5E1] outline-none text-xs text-center uppercase" placeholder="Qtd." value={a.qtd} onChange={e => atualizarAcessorioSugerido(a.id, { qtd: up(e.target.value) })} />
                </div>
              ))}
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0 flex gap-3">
              <button onClick={() => confirmarSugestaoAcessorios(false)} className="flex-1 bg-[#F0F4F8] hover:bg-[#E2E8F0] text-[#0C1D4D] border border-[#CBD5E1] font-black text-xs uppercase tracking-widest py-3 rounded-xl transition-colors">
                Só o item principal
              </button>
              <button onClick={() => confirmarSugestaoAcessorios(true)} className="flex-1 bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-xs uppercase tracking-widest py-3 rounded-xl shadow-lg transition-colors">
                Adicionar com selecionados
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: IMPORTAR ITENS DAS OS's */}
      {/* ============================================================================ */}
      {modalImportarOS && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#336699] p-5 flex justify-between items-center text-white flex-shrink-0">
              <div>
                <h3 className="font-black uppercase tracking-wider text-sm">📦 Importar Itens das OS&apos;s</h3>
                <p className="text-[10px] text-blue-100 mt-0.5">Evento: {checklistAtual.evento_feira || '—'}</p>
              </div>
              <button onClick={() => setModalImportarOS(false)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 bg-[#F8FAFC]">
              {importandoOS ? (
                <p className="text-center text-[#94A3B8] text-xs font-bold py-6">Buscando OS&apos;s do evento...</p>
              ) : itensImportadosOS.length === 0 ? (
                <p className="text-center text-[#94A3B8] text-xs font-bold py-6">Nenhum item encontrado.</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <button onClick={() => setModoConsolidadoOS(false)} className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${!modoConsolidadoOS ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>
                      📋 Individual (por OS)
                    </button>
                    <button onClick={() => setModoConsolidadoOS(true)} className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${modoConsolidadoOS ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>
                      🔗 Consolidado (agrupado)
                    </button>
                  </div>

                  <div className="bg-white p-2.5 rounded-lg border border-[#E2E8F0] space-y-2">
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] font-black text-[#64748B] uppercase">
                        {modoConsolidadoOS
                          ? `${itensConsolidadosOS.filter(c => c.selecionado).length} de ${itensConsolidadosOS.length} selecionado(s)`
                          : `${itensImportadosOS.filter(i => i.selecionado).length} de ${itensImportadosOS.length} selecionado(s)`}
                      </p>
                      <div className="flex gap-3">
                        <button onClick={() => alternarTodosImportadosOS(true)} className="text-[10px] font-black uppercase text-[#336699] underline">Marcar todos</button>
                        <button onClick={() => alternarTodosImportadosOS(false)} className="text-[10px] font-black uppercase text-[#64748B] underline">Desmarcar todos</button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 border-t border-[#E2E8F0] pt-2">
                      <label className="text-[10px] font-bold text-[#64748B] uppercase flex-shrink-0">Categoria p/ selecionados:</label>
                      <select onChange={e => { if (e.target.value !== '__placeholder__') aplicarCategoriaSelecionadosOS(e.target.value); e.target.value = '__placeholder__'; }} defaultValue="__placeholder__" className="flex-1 p-1.5 border border-[#CBD5E1] rounded text-xs outline-none focus:border-[#336699]">
                        <option value="__placeholder__" disabled>-- Aplicar categoria do catálogo --</option>
                        <option value="">DIVERSOS (sem categoria)</option>
                        {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </div>
                  </div>

                  {modoConsolidadoOS ? (
                    <div className="space-y-1.5">
                      {itensConsolidadosOS.map(item => (
                        <div key={item.descricao} className={`flex flex-wrap items-center gap-2 p-2 border rounded-lg ${item.jaExiste ? 'border-amber-200 bg-amber-50' : 'border-[#E2E8F0] bg-white'}`}>
                          <input type="checkbox" className="w-4 h-4 accent-[#336699] flex-shrink-0" checked={item.selecionado} onChange={e => alternarConsolidadoOS(item.descricao, e.target.checked)} />
                          <div className="flex-1 min-w-[120px]">
                            <p className="text-xs font-semibold">{item.descricao}</p>
                            <p className="text-[9px] text-[#94A3B8]">OS&apos;s: {item.osNumeros.join(', ')}</p>
                          </div>
                          <span className="flex-shrink-0 w-14 text-xs text-center font-bold">
                            {item.qtdSomada || '—'}{item.temQtdNaoNumerica && '+'}
                          </span>
                          <select className="flex-shrink-0 w-36 p-1 border border-[#CBD5E1] rounded text-[10px] outline-none focus:border-[#336699]" value={item.categoriaId} onChange={e => aplicarCategoriaConsolidadoOS(item.descricao, e.target.value)}>
                            <option value="">DIVERSOS</option>
                            {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                          </select>
                          {item.jaExiste && <span className="flex-shrink-0 text-[8px] font-black uppercase text-amber-600">já existe</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    itensImportadosPorOS.map(([numeroFicha, linhas]) => (
                      <div key={numeroFicha}>
                        <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-2">
                          OS Nº {numeroFicha}{linhas[0]?.ficha_cliente ? ` — ${linhas[0].ficha_cliente}` : ''}
                        </h4>
                        <div className="space-y-1.5">
                          {linhas.map(item => (
                            <div key={item.key} className={`flex flex-wrap items-center gap-2 p-2 border rounded-lg ${item.jaExiste ? 'border-amber-200 bg-amber-50' : 'border-[#E2E8F0] bg-white'}`}>
                              <input type="checkbox" className="w-4 h-4 accent-[#336699] flex-shrink-0" checked={item.selecionado} onChange={e => atualizarItemImportadoOS(item.key, { selecionado: e.target.checked })} />
                              <input type="text" className="flex-1 min-w-[120px] bg-transparent outline-none text-xs font-semibold uppercase" value={item.descricao} onChange={e => atualizarItemImportadoOS(item.key, { descricao: up(e.target.value) })} />
                              <input type="text" className="w-14 flex-shrink-0 bg-transparent border-b border-[#CBD5E1] outline-none text-xs text-center uppercase" placeholder="Qtd." value={item.qtd} onChange={e => atualizarItemImportadoOS(item.key, { qtd: up(e.target.value) })} />
                              <select className="flex-shrink-0 w-36 p-1 border border-[#CBD5E1] rounded text-[10px] outline-none focus:border-[#336699]" value={item.categoriaId} onChange={e => atualizarItemImportadoOS(item.key, { categoriaId: e.target.value })}>
                                <option value="">DIVERSOS</option>
                                {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                              </select>
                              {item.jaExiste && <span className="flex-shrink-0 text-[8px] font-black uppercase text-amber-600">já existe</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              {(() => {
                const qtdSelecionados = modoConsolidadoOS
                  ? itensConsolidadosOS.filter(c => c.selecionado).length
                  : itensImportadosOS.filter(i => i.selecionado).length;
                return (
                  <button onClick={confirmarImportarOS} disabled={qtdSelecionados === 0} className="w-full bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm uppercase tracking-widest py-3 rounded-xl shadow-lg transition-colors">
                    Importar {qtdSelecionados > 0 ? `(${qtdSelecionados})` : ''}
                  </button>
                );
              })()}
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
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setNovoModelo(prev => ({ ...prev, modo: 'livre' }))} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors ${novoModelo.modo === 'livre' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Item Livre</button>
                  <button onClick={() => setNovoModelo(prev => ({ ...prev, modo: 'catalogo' }))} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-colors ${novoModelo.modo === 'catalogo' ? 'bg-[#336699] text-white border-[#336699]' : 'bg-white text-[#64748B] border-[#CBD5E1]'}`}>Do Catálogo</button>
                </div>
                {novoModelo.modo === 'livre' ? (
                  <div className="mb-3">
                    <input type="text" placeholder="Descrição do item" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs uppercase" value={novoModelo.descricaoLivre} onChange={e => setNovoModelo(prev => ({ ...prev, descricaoLivre: up(e.target.value) }))} />
                    <p className="mt-1 text-[10px] text-[#94A3B8]">Itens livres entram na seção <strong>{SECAO_DIVERSOS}</strong>.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 mb-1">
                    <select className="p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs" value={novoModelo.categoriaId} onChange={e => setNovoModelo(prev => ({ ...prev, categoriaId: e.target.value, equipamentoId: '' }))}>
                      <option value="">-- Categoria --</option>
                      {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    <select className="p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs" value={novoModelo.equipamentoId} onChange={e => setNovoModelo(prev => ({ ...prev, equipamentoId: e.target.value }))}>
                      <option value="">-- Equipamento --</option>
                      {equipamentosAtivos.filter(e => !novoModelo.categoriaId || e.categoria_id === novoModelo.categoriaId).map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                    <div className="col-span-2">
                      <input type="text" placeholder="Observação (opcional) — ex: cor branca, com estabilizador..." className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs uppercase" value={novoModelo.observacaoCatalogo} onChange={e => setNovoModelo(prev => ({ ...prev, observacaoCatalogo: up(e.target.value) }))} />
                      {novoModelo.equipamentoId && (
                        <p className="mt-1 text-[10px] text-[#94A3B8]">
                          Descrição final: <strong>{equipamentosAtivos.find(e => e.id === novoModelo.equipamentoId)?.nome}{novoModelo.observacaoCatalogo.trim() ? ` (${novoModelo.observacaoCatalogo.trim()})` : ''}</strong>
                        </p>
                      )}
                    </div>
                    <p className="col-span-2 text-[10px] text-[#94A3B8] mb-2">A seção do item é a categoria do equipamento escolhido — não é possível criar seções avulsas.</p>
                  </div>
                )}
                <div>
                  <input type="text" placeholder="Qtd. Padrão (ex: 01, Lote, Pacote)" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs mb-3 uppercase" value={novoModelo.qtdPadrao} onChange={e => setNovoModelo(prev => ({ ...prev, qtdPadrao: up(e.target.value) }))} />
                </div>
                <button onClick={adicionarItemModelo} disabled={novoModelo.modo === 'catalogo' ? !novoModelo.equipamentoId : !novoModelo.descricaoLivre.trim()} className="bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest transition-colors w-full">
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
