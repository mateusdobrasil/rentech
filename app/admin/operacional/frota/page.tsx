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

const ROTA_CONTROLE = '/admin/operacional/frota/controle';

// Listas fixas de apoio
const ICONE_TIPO: Record<string, string> = {
  'CAMINHÃO': '🚛', 'VAN': '🚐', 'CARRO': '🚗', 'UTILITÁRIO': '🚚',
  'CARRETA': '⛟', 'MOTO': '🏍️', 'ÔNIBUS': '🚌', 'OUTRO': '🚙'
};
const STATUS_VEICULO = ['ATIVO', 'EM MANUTENÇÃO', 'INATIVO'];
const COR_STATUS: Record<string, string> = {
  'ATIVO': 'bg-green-100 text-green-700 border-green-300',
  'EM MANUTENÇÃO': 'bg-amber-100 text-amber-700 border-amber-300',
  'INATIVO': 'bg-gray-100 text-gray-500 border-gray-300'
};
const PROPRIEDADE_VEICULO = ['PRÓPRIO', 'ALUGADO'];
const COR_PROPRIEDADE: Record<string, string> = {
  'PRÓPRIO': 'bg-slate-100 text-slate-600 border-slate-300',
  'ALUGADO': 'bg-indigo-100 text-indigo-700 border-indigo-300'
};
const ICONE_DOCUMENTO: Record<string, string> = {
  'APÓLICE DE SEGURO': '🛡️', 'CRLV': '🪪', 'CONTRATO DE LOCAÇÃO': '📃', 'NOTA FISCAL': '🧾', 'OUTRO': '📎'
};

// ============================================================================
// CHECKLIST DE VEÍCULOS (saída/retorno) — consulta apenas; quem preenche é o
// motorista pelo Portal do Colaborador.
// ============================================================================
type StatusChecklistVeiculo = 'EM_ANDAMENTO' | 'FINALIZADO';
const LABEL_STATUS_CHECKLIST: Record<StatusChecklistVeiculo, string> = {
  EM_ANDAMENTO: 'Em Andamento', FINALIZADO: 'Finalizado'
};
const COR_STATUS_CHECKLIST: Record<StatusChecklistVeiculo, string> = {
  EM_ANDAMENTO: 'bg-blue-100 text-blue-700 border-blue-300',
  FINALIZADO: 'bg-green-100 text-green-700 border-green-300',
};
const gerarNumeroChecklist = (n: number) => `CKL-VEI-${String(n).padStart(6, '0')}`;
const TAMANHO_PAGINA_CHECKLIST = 20;

interface ChecklistVeiculoRow {
  id: string;
  numero: number;
  veiculo_id: string;
  motorista_nome: string;
  status: StatusChecklistVeiculo;
  destino: string | null;
  km_inicial: number | null;
  km_final: number | null;
  combustivel_saida: string | null;
  combustivel_retorno: string | null;
  observacoes_saida: string | null;
  observacoes_retorno: string | null;
  saida_em: string;
  retorno_em: string | null;
}

interface ChecklistVeiculoItem {
  id: string;
  etapa: 'SAIDA' | 'RETORNO';
  ordem: number;
  descricao: string;
  marcado: boolean;
}

interface ChecklistVeiculoAvaria {
  id: string;
  etapa: 'SAIDA' | 'RETORNO';
  descricao: string;
  foto_url: string | null;
  created_at: string;
}

const formatarDataHoraBR = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// Interfaces do Banco de Dados
interface Veiculo {
  id: string;
  apelido: string;
  tipo: string;
  marca?: string;
  modelo?: string;
  ano_fabricacao?: number | null;
  ano_modelo?: number | null;
  placa: string;
  renavam?: string;
  chassi?: string;
  cor?: string;
  combustivel?: string;
  km_atual?: number | null;
  status: string;
  propriedade: string;
  exibir_na_frota: boolean;
  locacao_locadora?: string;
  locacao_vigencia_inicio?: string | null;
  locacao_vigencia_fim?: string | null;
  locacao_apolice?: string;
  locacao_contato_nome?: string;
  locacao_contato_telefone?: string;
  apolice_numero?: string;
  segurado_nome?: string;
  segurado_cnpj?: string;
  seguradora?: string;
  seguradora_telefone?: string;
  corretora?: string;
  seguro_vigencia_inicio?: string | null;
  seguro_vigencia_fim?: string | null;
  crlv_vencimento?: string | null;
  ipva_vencimento?: string | null;
  observacoes?: string;
}

interface Documento {
  id: string;
  veiculo_id: string;
  tipo: string;
  descricao?: string;
  arquivo_url: string;
}

interface Manutencao {
  id: string;
  veiculo_id: string;
  tipo: string;
  data: string;
  km_atual?: number | null;
  custo?: number | null;
  fornecedor?: string;
  descricao?: string;
  proxima_data?: string | null;
  proxima_km?: number | null;
  anexo_url?: string;
  anexo_path?: string;
}

interface TipoManutencao {
  id: string;
  nome: string;
}

// Calcula o status de vencimento de uma data (seguro, CRLV, locação, próxima manutenção)
function getStatusVencimento(dataStr?: string | null): { texto: string; cor: string } {
  if (!dataStr) return { texto: 'Sem data cadastrada', cor: 'bg-gray-100 text-gray-500 border-gray-300' };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${dataStr}T00:00:00`);
  const diffDias = Math.ceil((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDias < 0) return { texto: `Vencido há ${Math.abs(diffDias)}d`, cor: 'bg-red-100 text-red-700 border-red-300' };
  if (diffDias <= 30) return { texto: `Vence em ${diffDias}d`, cor: 'bg-amber-100 text-amber-700 border-amber-300' };
  return { texto: `Válido até ${alvo.toLocaleDateString('pt-BR')}`, cor: 'bg-green-100 text-green-700 border-green-300' };
}

// Pior urgência entre os documentos do veículo (CRLV + IPVA + Seguro ou Locação, conforme o caso)
function getUrgenciaVeiculo(v: Veiculo): 'vencido' | 'proximo' | null {
  const status = [getStatusVencimento(v.crlv_vencimento), getStatusVencimento(v.ipva_vencimento)];
  status.push(v.propriedade === 'ALUGADO' ? getStatusVencimento(v.locacao_vigencia_fim) : getStatusVencimento(v.seguro_vigencia_fim));

  if (status.some(s => s.cor.includes('red'))) return 'vencido';
  if (status.some(s => s.cor.includes('amber'))) return 'proximo';
  return null;
}

// Padroniza a escrita em maiúsculas nos campos de texto livre
const up = (v: string) => v.toUpperCase();

// Colunas do tipo "date" no Postgres rejeitam string vazia — normaliza para null
const dataOuNulo = (v?: string | null) => (v && v.trim() !== '' ? v : null);

const manutencaoVazia: Partial<Manutencao> = {
  tipo: '', data: '', km_atual: undefined, custo: undefined, fornecedor: '', descricao: '',
  proxima_data: '', proxima_km: undefined
};

export default function VisualizacaoFrota() {
  const router = useRouter();
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');

  // Estados de Segurança e Autenticação
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [podeGerenciar, setPodeGerenciar] = useState(false);

  // Aba ativa
  const [abaAtiva, setAbaAtiva] = useState<'veiculos' | 'manutencao' | 'checklists'>('veiculos');

  // Estados de Dados
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [manutencoes, setManutencoes] = useState<Manutencao[]>([]);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [tiposManutencao, setTiposManutencao] = useState<TipoManutencao[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros da aba Veículos
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroPropriedade, setFiltroPropriedade] = useState('TODOS');

  // Veículo selecionado na aba Veículos (ficha lateral)
  const [veiculoSelecionadoId, setVeiculoSelecionadoId] = useState('');

  // Filtro de veículo na aba Manutenção — vazio mostra o histórico de todos
  const [filtroManutencaoVeiculoId, setFiltroManutencaoVeiculoId] = useState('');

  // Estados da aba Checklist Veículos
  const [checklistsVeiculo, setChecklistsVeiculo] = useState<ChecklistVeiculoRow[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistBusca, setChecklistBusca] = useState('');
  const [checklistFiltroStatus, setChecklistFiltroStatus] = useState('');
  const [checklistPagina, setChecklistPagina] = useState(0);
  const [checklistTotal, setChecklistTotal] = useState(0);
  const [checklistEmAndamentoCount, setChecklistEmAndamentoCount] = useState(0);
  const [previewChecklist, setPreviewChecklist] = useState<ChecklistVeiculoRow | null>(null);
  const [previewChecklistItens, setPreviewChecklistItens] = useState<ChecklistVeiculoItem[]>([]);
  const [previewChecklistAvarias, setPreviewChecklistAvarias] = useState<ChecklistVeiculoAvaria[]>([]);
  const [previewChecklistLoading, setPreviewChecklistLoading] = useState(false);

  // Estados de UI (Modal e Dialog)
  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'success' | 'error'; title: string; msg: string }>({ open: false, type: 'loading', title: '', msg: '' });
  const [modalManutencao, setModalManutencao] = useState<{ open: boolean; isNew: boolean; m: Partial<Manutencao> | null }>({ open: false, isNew: true, m: null });
  const [previewManutencao, setPreviewManutencao] = useState<Manutencao | null>(null);
  const [arquivoAnexo, setArquivoAnexo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [modalTipos, setModalTipos] = useState(false);
  const [novoTipoNome, setNovoTipoNome] = useState('');

  // 1. Validar Sessão e Consultar Permissões Dinâmicas no Banco
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

      const [rotaAtualRes, rotaControleRes] = await Promise.all([
        supabase.from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', pathname).single(),
        supabase.from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', ROTA_CONTROLE).single()
      ]);

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaAtualRes.data?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      const permissoesControle = rotaControleRes.data?.permissoes_permitidas || [];
      setPodeGerenciar(permissoesControle.includes(permissaoNormalizada));

      setUsuarioAtual(perfil.nome || 'Usuário');
      setAuthLoading(false);
      carregarDados();
    }

    checkAuth();
  }, [router, pathname]);

  // 2. Carregar apenas os veículos liberados para exibição na Frota, e as manutenções deles
  const carregarDados = async () => {
    setLoading(true);
    const [{ data: veiculosData }, { data: tiposData }] = await Promise.all([
      supabase.from('frota_veiculos').select('*').eq('exibir_na_frota', true).order('apelido', { ascending: true }),
      supabase.from('frota_tipos_manutencao').select('*').order('nome', { ascending: true })
    ]);

    setTiposManutencao(tiposData || []);

    if (veiculosData) {
      setVeiculos(veiculosData);
      const ids = veiculosData.map(v => v.id);
      if (ids.length > 0) {
        const [{ data: manutencoesData }, { data: documentosData }] = await Promise.all([
          supabase.from('frota_manutencoes').select('*').in('veiculo_id', ids).order('data', { ascending: false }),
          supabase.from('frota_documentos').select('id, veiculo_id, tipo, descricao, arquivo_url').in('veiculo_id', ids).eq('visivel_frota', true)
        ]);
        setManutencoes(manutencoesData || []);
        setDocumentos(documentosData || []);
      } else {
        setManutencoes([]);
        setDocumentos([]);
      }
    }
    setLoading(false);
  };

  // 3. Carregar Checklists de Veículos (paginado, só quando a aba está ativa)
  useEffect(() => {
    if (authLoading || acessoNegado || abaAtiva !== 'checklists') return;

    const handle = setTimeout(async () => {
      setChecklistLoading(true);

      let query = supabase
        .from('frota_checklists')
        .select('id, numero, veiculo_id, motorista_nome, status, destino, km_inicial, km_final, combustivel_saida, combustivel_retorno, observacoes_saida, observacoes_retorno, saida_em, retorno_em', { count: 'exact' })
        .order('saida_em', { ascending: false })
        .range(checklistPagina * TAMANHO_PAGINA_CHECKLIST, checklistPagina * TAMANHO_PAGINA_CHECKLIST + TAMANHO_PAGINA_CHECKLIST - 1);

      if (checklistFiltroStatus) query = query.eq('status', checklistFiltroStatus);
      if (checklistBusca.trim()) {
        const termo = `%${checklistBusca.trim()}%`;
        query = query.or(`motorista_nome.ilike.${termo},destino.ilike.${termo}`);
      }

      const { data, error, count } = await query;
      if (!error) {
        setChecklistsVeiculo(data || []);
        setChecklistTotal(count || 0);
      }
      setChecklistLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, abaAtiva, checklistPagina, checklistFiltroStatus, checklistBusca]);

  // 3b. Contagem de checklists em andamento, para o badge da aba
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    (async () => {
      const { count } = await supabase.from('frota_checklists').select('id', { count: 'exact', head: true }).eq('status', 'EM_ANDAMENTO');
      setChecklistEmAndamentoCount(count || 0);
    })();
  }, [authLoading, acessoNegado, checklistsVeiculo]);

  const abrirPreviewChecklist = async (c: ChecklistVeiculoRow) => {
    setPreviewChecklist(c);
    setPreviewChecklistLoading(true);
    const [{ data: itensData }, { data: avariasData }] = await Promise.all([
      supabase.from('frota_checklist_itens').select('*').eq('checklist_id', c.id).order('etapa', { ascending: true }).order('ordem', { ascending: true }),
      supabase.from('frota_checklist_avarias').select('*').eq('checklist_id', c.id).order('created_at', { ascending: true }),
    ]);
    setPreviewChecklistItens(itensData || []);
    setPreviewChecklistAvarias(avariasData || []);
    setPreviewChecklistLoading(false);
  };

  // ============================================================================
  // AÇÕES DE CRUD - TIPOS DE MANUTENÇÃO
  // ============================================================================
  const adicionarTipoManutencao = async () => {
    const nome = novoTipoNome.trim().toUpperCase();
    if (!nome) return;

    const { data, error } = await supabase.from('frota_tipos_manutencao').insert([{ nome }]).select().single();
    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      return;
    }

    setTiposManutencao(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)));
    setNovoTipoNome('');
  };

  const excluirTipoManutencao = async (tipo: TipoManutencao) => {
    if (!confirm(`Remover o tipo "${tipo.nome}"? Manutenções já registradas com esse tipo não serão alteradas.`)) return;

    const { error } = await supabase.from('frota_tipos_manutencao').delete().eq('id', tipo.id);
    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      return;
    }

    setTiposManutencao(prev => prev.filter(t => t.id !== tipo.id));
  };

  // Filtro Dinâmico da aba Veículos
  const veiculosFiltrados = useMemo(() => {
    return veiculos.filter(v => {
      const termo = busca.toLowerCase();
      const matchBusca = v.apelido.toLowerCase().includes(termo) || (v.placa || '').toLowerCase().includes(termo) || (v.modelo || '').toLowerCase().includes(termo);
      const matchStatus = filtroStatus === 'TODOS' || v.status === filtroStatus;
      const matchPropriedade = filtroPropriedade === 'TODOS' || v.propriedade === filtroPropriedade;
      return matchBusca && matchStatus && matchPropriedade;
    });
  }, [veiculos, busca, filtroStatus, filtroPropriedade]);

  // Veículos com documentação vencida ou a vencer em até 30 dias
  const veiculosComAlerta = useMemo(() => {
    return veiculos.filter(v => getUrgenciaVeiculo(v) !== null);
  }, [veiculos]);

  // Todas as manutenções (já vêm ordenadas por data desc.), filtradas pelo veículo quando um for selecionado
  const manutencoesExibidas = useMemo(() => {
    if (!filtroManutencaoVeiculoId) return manutencoes;
    return manutencoes.filter(m => m.veiculo_id === filtroManutencaoVeiculoId);
  }, [manutencoes, filtroManutencaoVeiculoId]);

  // Mantém sempre um veículo selecionado para a ficha lateral, acompanhando os filtros
  useEffect(() => {
    if (veiculosFiltrados.length === 0) return;
    if (!veiculosFiltrados.some(v => v.id === veiculoSelecionadoId)) {
      setVeiculoSelecionadoId(veiculosFiltrados[0].id);
    }
  }, [veiculosFiltrados, veiculoSelecionadoId]);

  const veiculoDetalhe = useMemo(() => {
    return veiculos.find(v => v.id === veiculoSelecionadoId) || null;
  }, [veiculos, veiculoSelecionadoId]);

  const getVeiculoNome = (id: string) => {
    const v = veiculos.find(x => x.id === id);
    return v ? `${v.apelido} (${v.placa})` : 'Veículo removido';
  };

  // ============================================================================
  // UPLOAD DE ARQUIVOS (Storage bucket "frota")
  // ============================================================================
  const enviarArquivo = async (file: File, pasta: string): Promise<{ url: string; path: string } | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `${pasta}/${fileName}`;

    const { error: uploadError } = await supabase.storage.from('frota').upload(filePath, file);
    if (uploadError) {
      setDialog({ open: true, type: 'error', title: 'Erro no Upload', msg: uploadError.message });
      return null;
    }

    const { data } = supabase.storage.from('frota').getPublicUrl(filePath);
    return { url: data.publicUrl, path: filePath };
  };

  // ============================================================================
  // AÇÕES DE CRUD - MANUTENÇÕES
  // ============================================================================
  const abrirModalNovaManutencao = () => {
    if (!filtroManutencaoVeiculoId) return;
    setArquivoAnexo(null);
    setModalManutencao({ open: true, isNew: true, m: { ...manutencaoVazia, tipo: tiposManutencao[0]?.nome || '', veiculo_id: filtroManutencaoVeiculoId, data: new Date().toISOString().slice(0, 10) } });
  };

  const abrirModalEditarManutencao = (m: Manutencao) => {
    setArquivoAnexo(null);
    setModalManutencao({ open: true, isNew: false, m: { ...m } });
  };

  const salvarManutencao = async () => {
    if (!modalManutencao.m?.tipo || !modalManutencao.m?.data) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'O Tipo e a Data são obrigatórios.' });
      return;
    }

    setEnviando(true);
    let payload: Partial<Manutencao> = {
      ...modalManutencao.m,
      proxima_data: dataOuNulo(modalManutencao.m.proxima_data),
    };

    if (arquivoAnexo) {
      const resultado = await enviarArquivo(arquivoAnexo, 'manutencoes');
      if (!resultado) { setEnviando(false); return; }
      payload.anexo_url = resultado.url;
      payload.anexo_path = resultado.path;
    }

    const res = modalManutencao.isNew
      ? await supabase.from('frota_manutencoes').insert([payload])
      : await supabase.from('frota_manutencoes').update(payload).eq('id', payload.id);
    setEnviando(false);

    if (res.error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.error.message });
    } else {
      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: `${modalManutencao.isNew ? 'REGISTROU' : 'EDITOU'} MANUTENÇÃO (${payload.tipo})`,
        setor: 'FROTA',
        equipamento_id: payload.veiculo_id ?? null,
        equipamento_nome: getVeiculoNome(payload.veiculo_id || ''),
      });
      setDialog({ open: true, type: 'success', title: 'Concluído', msg: `Manutenção ${modalManutencao.isNew ? 'registrada' : 'atualizada'} com sucesso.` });
      setModalManutencao({ open: false, isNew: true, m: null });
      carregarDados();
      setTimeout(() => setDialog(prev => ({ ...prev, open: false })), 2000);
    }
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Frota.</p>
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

      {/* IDENTIFICAÇÃO E NAVEGAÇÃO ALINHADOS À NAVBAR GLOBAL */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🚚 <strong>Olá, {usuarioAtual}</strong>. Consulte os veículos da frota e registre manutenções.
        </p>
        <div className="flex gap-2 w-full md:w-auto">
          {podeGerenciar && (
            <button onClick={() => router.push(ROTA_CONTROLE)} className="flex-1 md:flex-none text-[10px] md:text-xs font-black bg-[#336699] hover:bg-[#284B8C] text-white px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
              ⚙️ Gerenciar Frota
            </button>
          )}
          <button onClick={() => router.push('/admin/operacional')} className="flex-1 md:flex-none text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
            ⬅ VOLTAR AO HUB
          </button>
        </div>
      </div>

      {/* ABAS */}
      <div className="px-4 md:px-8 pt-4 flex-shrink-0 flex flex-wrap gap-2 border-b border-[#E2E8F0] bg-white">
        <button
          onClick={() => setAbaAtiva('veiculos')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${abaAtiva === 'veiculos' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          🚚 Veículos {veiculosComAlerta.length > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[9px]">{veiculosComAlerta.length}</span>}
        </button>
        <button
          onClick={() => setAbaAtiva('manutencao')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${abaAtiva === 'manutencao' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          🔧 Manutenção
        </button>
        <button
          onClick={() => setAbaAtiva('checklists')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${abaAtiva === 'checklists' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          ✅ Checklist Veículos {checklistEmAndamentoCount > 0 && <span className="ml-1 bg-blue-500 text-white rounded-full px-1.5 py-0.5 text-[9px]">{checklistEmAndamentoCount}</span>}
        </button>
      </div>

      {/* ============================================================================ */}
      {/* ABA: VEÍCULOS (ficha lateral + detalhe) */}
      {/* ============================================================================ */}
      {abaAtiva === 'veiculos' && (
        <div className="px-4 md:px-8 py-6 flex-grow flex flex-col">
          {veiculosComAlerta.length > 0 && (
            <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg">
              ⚠️ {veiculosComAlerta.length} veículo(s) com Seguro, Licenciamento, IPVA ou Contrato de Locação vencido ou vencendo nos próximos 30 dias.
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando frota...</div>
          ) : veiculos.length === 0 ? (
            <div className="text-center py-12 text-[#94A3B8] font-bold text-sm bg-white rounded-xl border border-dashed border-[#CBD5E1]">Nenhum veículo disponível para visualização no momento.</div>
          ) : (
            <div className="flex flex-col md:flex-row gap-5 flex-grow min-h-0">
              {/* SIDEBAR: busca, filtros e lista de veículos */}
              <div className="w-full md:w-80 flex-shrink-0 flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="🔍 Buscar..."
                  className="p-2.5 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none bg-white"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                <div className="flex gap-2">
                  <select
                    className="flex-1 p-2 border-2 border-[#E2E8F0] rounded-lg text-[11px] font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white"
                    value={filtroStatus}
                    onChange={(e) => setFiltroStatus(e.target.value)}
                  >
                    <option value="TODOS">TODOS OS STATUS</option>
                    {STATUS_VEICULO.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select
                    className="flex-1 p-2 border-2 border-[#E2E8F0] rounded-lg text-[11px] font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white"
                    value={filtroPropriedade}
                    onChange={(e) => setFiltroPropriedade(e.target.value)}
                  >
                    <option value="TODOS">PRÓPRIO / ALUGADO</option>
                    {PROPRIEDADE_VEICULO.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-y-auto flex-grow max-h-[70vh] md:max-h-none divide-y divide-[#F1F5F9]">
                  {veiculosFiltrados.length === 0 ? (
                    <p className="text-center text-[#94A3B8] text-xs font-bold p-6">Nenhum veículo encontrado.</p>
                  ) : (
                    veiculosFiltrados.map(v => (
                      <button
                        key={v.id}
                        onClick={() => setVeiculoSelecionadoId(v.id)}
                        className={`w-full text-left p-3 flex items-center gap-3 transition-colors ${v.id === veiculoSelecionadoId ? 'bg-blue-50 border-l-4 border-[#336699]' : 'hover:bg-[#F8FAFC] border-l-4 border-transparent'}`}
                      >
                        <span className="relative text-2xl flex-shrink-0">
                          {ICONE_TIPO[v.tipo] || '🚙'}
                          {(() => {
                            const urgencia = getUrgenciaVeiculo(v);
                            if (!urgencia) return null;
                            return (
                              <span
                                className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white ${urgencia === 'vencido' ? 'bg-red-500' : 'bg-amber-500'}`}
                                title={urgencia === 'vencido' ? 'Documento vencido' : 'Documento vence em até 30 dias'}
                              />
                            );
                          })()}
                        </span>
                        <div className="min-w-0 flex-grow">
                          <p className="font-black text-[#0C1D4D] text-xs uppercase truncate">{v.apelido}</p>
                          <p className="text-[10px] text-[#64748B] font-bold uppercase">{v.placa}</p>
                        </div>
                        <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border flex-shrink-0 ${COR_STATUS[v.status] || COR_STATUS['INATIVO']}`}>{v.status}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* FICHA COMPLETA DO VEÍCULO SELECIONADO */}
              <div className="flex-grow bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-y-auto">
                {!veiculoDetalhe ? (
                  <div className="h-full flex items-center justify-center text-[#94A3B8] text-sm font-bold p-12 text-center">Selecione um veículo na lista ao lado para ver a ficha completa.</div>
                ) : (
                  <FichaVeiculo veiculo={veiculoDetalhe} documentos={documentos.filter(d => d.veiculo_id === veiculoDetalhe.id)} onVerManutencoes={() => { setFiltroManutencaoVeiculoId(veiculoDetalhe.id); setAbaAtiva('manutencao'); }} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================================ */}
      {/* ABA: MANUTENÇÃO */}
      {/* ============================================================================ */}
      {abaAtiva === 'manutencao' && (
        <div className="px-4 md:px-8 py-6 flex-grow flex flex-col">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
            <select
              className="w-full md:w-96 p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#0C1D4D] focus:border-[#336699] outline-none cursor-pointer"
              value={filtroManutencaoVeiculoId}
              onChange={(e) => setFiltroManutencaoVeiculoId(e.target.value)}
            >
              <option value="">TODOS OS VEÍCULOS</option>
              {veiculos.map(v => <option key={v.id} value={v.id}>{v.apelido} ({v.placa})</option>)}
            </select>

            <div className="flex gap-2 w-full md:w-auto">
              <button
                onClick={() => setModalTipos(true)}
                className="flex-1 md:flex-none bg-[#E2E8F0] hover:bg-[#CBD5E1] text-[#0C1D4D] px-4 py-3 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-sm border border-[#CBD5E1]"
              >
                🏷️ Tipos
              </button>
              <button
                onClick={abrirModalNovaManutencao}
                disabled={!filtroManutencaoVeiculoId}
                title={!filtroManutencaoVeiculoId ? 'Selecione ou clique em um veículo para registrar uma manutenção' : undefined}
                className="flex-1 md:flex-none bg-[#336699] hover:bg-[#284B8C] text-white px-6 py-3 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ➕ Nova Manutenção
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando manutenções...</div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-10">
                  <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-44">Veículo</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-36">Tipo</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-28">Data</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-24 text-center">KM</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-28 text-center">Custo</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Oficina / Fornecedor</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0]">Descrição</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Próxima</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-16 text-center">Anexo</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-16 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {manutencoesExibidas.length === 0 ? (
                    <tr><td colSpan={10} className="text-center py-12 text-[#94A3B8] font-bold text-sm">{filtroManutencaoVeiculoId ? 'Nenhuma manutenção registrada para este veículo.' : 'Nenhuma manutenção registrada.'}</td></tr>
                  ) : (
                    manutencoesExibidas.map(m => {
                      const proxima = getStatusVencimento(m.proxima_data);
                      return (
                        <tr
                          key={m.id}
                          onClick={() => setPreviewManutencao(m)}
                          className="cursor-pointer transition-colors hover:bg-[#F8FAFC]"
                          title="Clique para ver os detalhes"
                        >
                          <td className="p-4 font-black text-[#0C1D4D] text-[11px] uppercase truncate max-w-[170px]" title={getVeiculoNome(m.veiculo_id)}>{getVeiculoNome(m.veiculo_id)}</td>
                          <td className="p-4"><span className="bg-[#E2E8F0] text-[#475569] font-black px-2 py-1 rounded text-[9px] uppercase tracking-widest">{m.tipo}</span></td>
                          <td className="p-4 font-bold text-[#0C1D4D]">{new Date(`${m.data}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                          <td className="p-4 text-center text-[#64748B] font-medium">{m.km_atual ? `${m.km_atual.toLocaleString('pt-BR')} km` : '-'}</td>
                          <td className="p-4 text-center font-bold text-[#0A2A4A]">{m.custo ? m.custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}</td>
                          <td className="p-4 text-[#475569]">{m.fornecedor || '-'}</td>
                          <td className="p-4 text-[#475569] max-w-[260px] truncate" title={m.descricao}>{m.descricao || '-'}</td>
                          <td className="p-4">
                            {m.proxima_data ? <span className={`text-[9px] font-black uppercase px-2 py-1 rounded border ${proxima.cor}`}>{proxima.texto}</span> : <span className="text-[#CBD5E1]">-</span>}
                          </td>
                          <td className="p-4 text-center">
                            {m.anexo_url ? <a href={m.anexo_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title="Ver anexo">📎</a> : '-'}
                          </td>
                          <td className="p-4 text-center">
                            {podeGerenciar ? (
                              <button onClick={e => { e.stopPropagation(); abrirModalEditarManutencao(m); }} className="text-amber-600 hover:bg-amber-50 px-2 py-1 rounded text-xs font-black transition-colors" title="Editar manutenção">✏️</button>
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ============================================================================ */}
      {/* ABA: CHECKLIST VEÍCULOS (consulta) */}
      {/* ============================================================================ */}
      {abaAtiva === 'checklists' && (
        <div className="px-4 md:px-8 py-6 flex-grow flex flex-col">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col md:flex-row gap-3 justify-between items-center mb-6">
            <input
              type="text"
              value={checklistBusca}
              onChange={(e) => { setChecklistBusca(e.target.value); setChecklistPagina(0); }}
              placeholder="🔍 Buscar por motorista ou destino..."
              className="w-full md:flex-1 p-2.5 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none bg-white"
            />
            <select
              value={checklistFiltroStatus}
              onChange={(e) => { setChecklistFiltroStatus(e.target.value); setChecklistPagina(0); }}
              className="w-full md:w-56 p-2.5 border-2 border-[#E2E8F0] rounded-lg text-[11px] font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white"
            >
              <option value="">TODOS OS STATUS</option>
              <option value="EM_ANDAMENTO">Em Andamento</option>
              <option value="FINALIZADO">Finalizado</option>
            </select>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto relative min-h-[160px]">
            {checklistLoading && (
              <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
              </div>
            )}
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-[5]">
                <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-32">Número</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-44">Veículo</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Motorista</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-36">Saída</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-36">Retorno</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] text-center w-32">KM</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-32">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {checklistsVeiculo.length === 0 && !checklistLoading ? (
                  <tr><td colSpan={7} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhum checklist registrado.</td></tr>
                ) : (
                  checklistsVeiculo.map(c => (
                    <tr key={c.id} onClick={() => abrirPreviewChecklist(c)} className="cursor-pointer transition-colors hover:bg-[#F8FAFC]" title="Clique para ver os detalhes">
                      <td className="p-4 font-black text-[#0C1D4D]">{gerarNumeroChecklist(c.numero)}</td>
                      <td className="p-4 font-bold text-[#0C1D4D] text-[11px] uppercase truncate max-w-[170px]" title={getVeiculoNome(c.veiculo_id)}>{getVeiculoNome(c.veiculo_id)}</td>
                      <td className="p-4 text-[#475569] font-semibold">{c.motorista_nome}</td>
                      <td className="p-4 text-[#475569]">{formatarDataHoraBR(c.saida_em)}</td>
                      <td className="p-4 text-[#475569]">{formatarDataHoraBR(c.retorno_em)}</td>
                      <td className="p-4 text-center text-[#64748B] font-medium">{c.km_inicial ?? '-'}{c.km_final ? ` → ${c.km_final}` : ''}</td>
                      <td className="p-4">
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${COR_STATUS_CHECKLIST[c.status]}`}>{LABEL_STATUS_CHECKLIST[c.status]}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center mt-4">
            <button onClick={() => setChecklistPagina(p => Math.max(0, p - 1))} disabled={checklistPagina === 0 || checklistLoading} className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">
              ⬅ Anterior
            </button>
            <span className="text-xs font-bold text-[#64748B]">
              Página {checklistTotal === 0 ? 0 : checklistPagina + 1} de {Math.max(1, Math.ceil(checklistTotal / TAMANHO_PAGINA_CHECKLIST))}
            </span>
            <button onClick={() => setChecklistPagina(p => p + 1)} disabled={(checklistPagina + 1) * TAMANHO_PAGINA_CHECKLIST >= checklistTotal || checklistLoading} className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">
              Próxima ➡
            </button>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: DETALHE DO CHECKLIST DE VEÍCULO */}
      {/* ============================================================================ */}
      {previewChecklist && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <div>
                <h3 className="font-black uppercase tracking-wider text-sm">✅ {gerarNumeroChecklist(previewChecklist.numero)}</h3>
                <p className="text-[10px] text-blue-200 mt-0.5">{getVeiculoNome(previewChecklist.veiculo_id)} · {previewChecklist.motorista_nome}</p>
              </div>
              <button onClick={() => setPreviewChecklist(null)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full border ${COR_STATUS_CHECKLIST[previewChecklist.status]}`}>{LABEL_STATUS_CHECKLIST[previewChecklist.status]}</span>
              </div>

              {previewChecklistLoading ? (
                <div className="text-center py-8 text-[#94A3B8] font-bold text-sm">Carregando detalhes...</div>
              ) : (
                <>
                  <div>
                    <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">🚚 Saída</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                      <Campo label="Data/Hora" valor={formatarDataHoraBR(previewChecklist.saida_em)} />
                      <Campo label="KM Inicial" valor={previewChecklist.km_inicial} />
                      <Campo label="Combustível" valor={previewChecklist.combustivel_saida} />
                      <Campo label="Destino" valor={previewChecklist.destino} />
                    </div>
                    <ul className="space-y-1">
                      {previewChecklistItens.filter(i => i.etapa === 'SAIDA').map(i => (
                        <li key={i.id} className="flex items-center gap-2 text-sm text-[#0C1D4D] font-medium">
                          <span>{i.marcado ? '✅' : '⬜'}</span> {i.descricao}
                        </li>
                      ))}
                    </ul>
                    {previewChecklist.observacoes_saida && <p className="text-sm text-[#475569] font-medium whitespace-pre-wrap mt-2">{previewChecklist.observacoes_saida}</p>}
                  </div>

                  <div>
                    <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">🔁 Retorno</h4>
                    {previewChecklist.status === 'EM_ANDAMENTO' ? (
                      <p className="text-xs text-[#94A3B8] font-bold">Ainda não finalizado.</p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                          <Campo label="Data/Hora" valor={formatarDataHoraBR(previewChecklist.retorno_em)} />
                          <Campo label="KM Final" valor={previewChecklist.km_final} />
                          <Campo label="Combustível" valor={previewChecklist.combustivel_retorno} />
                        </div>
                        <ul className="space-y-1">
                          {previewChecklistItens.filter(i => i.etapa === 'RETORNO').map(i => (
                            <li key={i.id} className="flex items-center gap-2 text-sm text-[#0C1D4D] font-medium">
                              <span>{i.marcado ? '✅' : '⬜'}</span> {i.descricao}
                            </li>
                          ))}
                        </ul>
                        {previewChecklist.observacoes_retorno && <p className="text-sm text-[#475569] font-medium whitespace-pre-wrap mt-2">{previewChecklist.observacoes_retorno}</p>}
                      </>
                    )}
                  </div>

                  {previewChecklistAvarias.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">⚠️ Avarias Reportadas</h4>
                      <div className="space-y-3">
                        {previewChecklistAvarias.map(a => (
                          <div key={a.id} className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
                            <p className="text-[9px] font-black uppercase text-[#94A3B8] mb-1">{a.etapa === 'SAIDA' ? 'Saída' : 'Retorno'} · {formatarDataHoraBR(a.created_at)}</p>
                            <p className="text-sm text-[#0C1D4D] font-medium">{a.descricao}</p>
                            {a.foto_url && (
                              <a href={a.foto_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2">
                                <img src={a.foto_url} alt="Foto da avaria" className="max-h-40 rounded-lg border border-[#E2E8F0]" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={() => setPreviewChecklist(null)} className="w-full py-3 bg-[#E2E8F0] text-[#0C1D4D] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#CBD5E1] transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: NOVA MANUTENÇÃO */}
      {/* ============================================================================ */}
      {modalManutencao.open && modalManutencao.m && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <div>
                <h3 className="font-black uppercase tracking-wider text-sm">{modalManutencao.isNew ? '🔧 Nova Manutenção' : '✏️ Editar Manutenção'}</h3>
                <p className="text-[10px] text-blue-200 mt-0.5">Veículo: {getVeiculoNome(modalManutencao.m.veiculo_id || '')}</p>
              </div>
              <button onClick={() => setModalManutencao({ open: false, isNew: true, m: null })} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 bg-[#F8FAFC]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Tipo</label>
                  <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer bg-white" value={modalManutencao.m.tipo || ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, tipo: e.target.value } })}>
                    {tiposManutencao.length === 0 && <option value="">-- Cadastre um tipo em "🏷️ Tipos" --</option>}
                    {tiposManutencao.map(t => <option key={t.id} value={t.nome}>{t.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Data</label>
                  <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm bg-white" value={modalManutencao.m.data || ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, data: e.target.value } })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">KM Atual</label>
                  <input type="number" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm bg-white" value={modalManutencao.m.km_atual ?? ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, km_atual: e.target.value ? parseFloat(e.target.value) : undefined } })} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Custo (R$)</label>
                  <input type="number" step="0.01" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm bg-white" value={modalManutencao.m.custo ?? ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, custo: e.target.value ? parseFloat(e.target.value) : undefined } })} />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Oficina / Fornecedor</label>
                <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm bg-white" value={modalManutencao.m.fornecedor || ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, fornecedor: up(e.target.value) } })} />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Descrição</label>
                <textarea rows={3} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm resize-none bg-white" value={modalManutencao.m.descricao || ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, descricao: up(e.target.value) } })} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Próxima Manutenção (Data)</label>
                  <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm bg-white" value={modalManutencao.m.proxima_data || ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, proxima_data: e.target.value } })} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Próxima Manutenção (KM)</label>
                  <input type="number" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm bg-white" value={modalManutencao.m.proxima_km ?? ''} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, proxima_km: e.target.value ? parseFloat(e.target.value) : undefined } })} />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Anexar Nota Fiscal / Comprovante</label>
                <input type="file" accept=".pdf,image/*" className="w-full p-1.5 border border-[#CBD5E1] rounded-lg outline-none text-xs bg-white" onChange={e => setArquivoAnexo(e.target.files?.[0] || null)} />
                {modalManutencao.m.anexo_url && !arquivoAnexo && (
                  <a href={modalManutencao.m.anexo_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#336699] font-bold underline mt-1 inline-block">📎 Ver anexo atual</a>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={salvarManutencao} disabled={enviando} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-sm uppercase tracking-widest py-4 rounded-xl shadow-lg transition-colors disabled:opacity-50">
                {enviando ? '⏳ Enviando...' : modalManutencao.isNew ? '💾 Registrar Manutenção' : '💾 Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: PREVIEW DA MANUTENÇÃO */}
      {/* ============================================================================ */}
      {previewManutencao && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <div>
                <h3 className="font-black uppercase tracking-wider text-sm">🔧 {previewManutencao.tipo}</h3>
                <p className="text-[10px] text-blue-200 mt-0.5">{getVeiculoNome(previewManutencao.veiculo_id)}</p>
              </div>
              <button onClick={() => setPreviewManutencao(null)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Campo label="Data" valor={new Date(`${previewManutencao.data}T00:00:00`).toLocaleDateString('pt-BR')} />
                <Campo label="KM Atual" valor={previewManutencao.km_atual ? `${previewManutencao.km_atual.toLocaleString('pt-BR')} km` : undefined} />
                <Campo label="Custo" valor={previewManutencao.custo ? previewManutencao.custo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : undefined} />
                <Campo label="Oficina / Fornecedor" valor={previewManutencao.fornecedor} />
              </div>

              <div>
                <span className="block text-[10px] font-bold text-[#94A3B8] uppercase tracking-wide mb-0.5">Descrição</span>
                <p className="text-sm font-medium text-[#0C1D4D] whitespace-pre-wrap">{previewManutencao.descricao || '—'}</p>
              </div>

              {(previewManutencao.proxima_data || previewManutencao.proxima_km) && (
                <div className="grid grid-cols-2 gap-4">
                  <Campo label="Próxima (Data)" valor={previewManutencao.proxima_data ? new Date(`${previewManutencao.proxima_data}T00:00:00`).toLocaleDateString('pt-BR') : undefined} />
                  <Campo label="Próxima (KM)" valor={previewManutencao.proxima_km ? `${previewManutencao.proxima_km.toLocaleString('pt-BR')} km` : undefined} />
                </div>
              )}

              {previewManutencao.anexo_url && (
                <a href={previewManutencao.anexo_url} target="_blank" rel="noopener noreferrer" className="inline-block bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs px-3 py-2 rounded-lg transition-colors">
                  📎 Ver Anexo
                </a>
              )}
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0 flex gap-3">
              <button onClick={() => setPreviewManutencao(null)} className="flex-1 py-3 bg-[#E2E8F0] text-[#0C1D4D] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#CBD5E1] transition-colors">
                Fechar
              </button>
              {podeGerenciar && (
                <button
                  onClick={() => { const m = previewManutencao; setPreviewManutencao(null); abrirModalEditarManutencao(m); }}
                  className="flex-1 py-3 bg-[#336699] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-wider rounded-lg shadow-lg transition-colors"
                >
                  ✏️ Editar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: GERENCIAR TIPOS DE MANUTENÇÃO */}
      {/* ============================================================================ */}
      {modalTipos && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">🏷️ Tipos de Manutenção</h3>
              <button onClick={() => setModalTipos(false)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto bg-[#F8FAFC]">
              <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm mb-6">
                <h4 className="text-[10px] font-black uppercase text-[#64748B] mb-3">Adicionar Novo Tipo</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Ex: TROCA DE FILTRO"
                    className="flex-grow p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs font-semibold"
                    value={novoTipoNome}
                    onChange={(e) => setNovoTipoNome(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') adicionarTipoManutencao(); }}
                  />
                  <button
                    onClick={adicionarTipoManutencao}
                    disabled={!novoTipoNome.trim()}
                    className="bg-[#16A34A] hover:bg-[#15803D] text-white px-4 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </div>
              </div>

              <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Tipos Cadastrados</h4>
              <div className="space-y-2">
                {tiposManutencao.length === 0 ? (
                  <p className="text-xs text-center text-[#94A3B8] py-4 bg-white border border-dashed border-[#CBD5E1] rounded-lg">Nenhum tipo cadastrado ainda.</p>
                ) : (
                  tiposManutencao.map(tipo => (
                    <div key={tipo.id} className="flex justify-between items-center bg-white p-3 border border-[#E2E8F0] rounded-lg shadow-sm">
                      <span className="text-sm font-bold text-[#0C1D4D]">{tipo.nome}</span>
                      <button
                        onClick={() => excluirTipoManutencao(tipo)}
                        className="text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-black transition-colors"
                        title="Remover tipo"
                      >
                        Remover
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG GERAL DE RESPOSTAS */}
      {dialog.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4">
            <div className="text-5xl mb-4">
              {dialog.type === 'loading' ? '⏳' : dialog.type === 'success' ? '✅' : '❌'}
            </div>
            <h3 className={`text-xl font-black uppercase tracking-wider mb-2 ${dialog.type === 'error' ? 'text-red-600' : 'text-[#0C1D4D]'}`}>
              {dialog.title}
            </h3>
            <p className="text-sm text-[#64748B] font-medium mb-6">{dialog.msg}</p>
            {dialog.type !== 'loading' && (
              <button onClick={() => setDialog({ ...dialog, open: false })} className="w-full py-3 bg-[#0C1D4D] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg">OK, Entendido</button>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ============================================================================
// FICHA COMPLETA DO VEÍCULO (somente leitura)
// ============================================================================
function Campo({ label, valor }: { label: string; valor?: string | number | null }) {
  return (
    <div>
      <span className="block text-[10px] font-bold text-[#94A3B8] uppercase tracking-wide mb-0.5">{label}</span>
      <span className="block text-sm font-bold text-[#0C1D4D]">{valor || valor === 0 ? valor : '—'}</span>
    </div>
  );
}

function FichaVeiculo({ veiculo, documentos, onVerManutencoes }: { veiculo: Veiculo; documentos: Documento[]; onVerManutencoes: () => void }) {
  const seguro = getStatusVencimento(veiculo.seguro_vigencia_fim);
  const crlv = getStatusVencimento(veiculo.crlv_vencimento);
  const ipva = getStatusVencimento(veiculo.ipva_vencimento);
  const locacao = getStatusVencimento(veiculo.locacao_vigencia_fim);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{ICONE_TIPO[veiculo.tipo] || '🚙'}</span>
          <div>
            <h2 className="font-black text-[#0C1D4D] text-lg uppercase tracking-wide">{veiculo.apelido}</h2>
            <p className="text-xs text-[#64748B] font-bold uppercase">{veiculo.placa} · {veiculo.tipo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full border ${COR_STATUS[veiculo.status] || COR_STATUS['INATIVO']}`}>{veiculo.status}</span>
          <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full border ${COR_PROPRIEDADE[veiculo.propriedade] || COR_PROPRIEDADE['PRÓPRIO']}`}>{veiculo.propriedade || 'PRÓPRIO'}</span>
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Dados do Veículo</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Campo label="Marca" valor={veiculo.marca} />
          <Campo label="Modelo" valor={veiculo.modelo} />
          <Campo label="Ano Fabricação" valor={veiculo.ano_fabricacao} />
          <Campo label="Ano Modelo" valor={veiculo.ano_modelo} />
          <Campo label="RENAVAM" valor={veiculo.renavam} />
          <Campo label="Chassi" valor={veiculo.chassi} />
          <Campo label="Cor" valor={veiculo.cor} />
          <Campo label="Combustível" valor={veiculo.combustivel} />
          <Campo label="KM Atual" valor={veiculo.km_atual ? `${veiculo.km_atual.toLocaleString('pt-BR')} km` : undefined} />
        </div>
      </div>

      {veiculo.propriedade === 'ALUGADO' ? (
        <div>
          <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Dados da Locação</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Campo label="Locadora" valor={veiculo.locacao_locadora} />
            <Campo label="Apólice da Locadora" valor={veiculo.locacao_apolice} />
            <Campo label="Contato" valor={veiculo.locacao_contato_nome} />
            <Campo label="Telefone" valor={veiculo.locacao_contato_telefone} />
          </div>
          <div className="flex items-center gap-2 mt-4">
            <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Vigência do Contrato</span>
            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${locacao.cor}`}>{locacao.texto}</span>
          </div>
        </div>
      ) : (
        <div>
          <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Dados do Seguro</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Campo label="Apólice" valor={veiculo.apolice_numero} />
            <Campo label="Seguradora" valor={veiculo.seguradora} />
            <Campo label="Segurado" valor={veiculo.segurado_nome} />
            <Campo label="CNPJ do Segurado" valor={veiculo.segurado_cnpj} />
            <Campo label="Telefone Seguradora" valor={veiculo.seguradora_telefone} />
            <Campo label="Corretora" valor={veiculo.corretora} />
          </div>
          <div className="flex items-center gap-2 mt-4">
            <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Vigência do Seguro</span>
            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${seguro.cor}`}>{seguro.texto}</span>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Documentação</h4>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Licenciamento</span>
          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${crlv.cor}`}>{crlv.texto}</span>
          <span className="text-[10px] text-[#94A3B8] font-bold uppercase">IPVA</span>
          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${ipva.cor}`}>{ipva.texto}</span>
        </div>
        {documentos.length === 0 ? (
          <p className="text-xs text-[#94A3B8] font-medium">Nenhum documento disponível para visualização.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {documentos.map(doc => (
              <a key={doc.id} href={doc.arquivo_url} target="_blank" rel="noopener noreferrer" className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-2 w-fit">
                <span>{ICONE_DOCUMENTO[doc.tipo] || '📎'}</span>
                <span className="uppercase">{doc.tipo}</span>
                {doc.descricao && <span className="text-[#94A3B8] font-medium normal-case">— {doc.descricao}</span>}
              </a>
            ))}
          </div>
        )}
      </div>

      {veiculo.observacoes && (
        <div>
          <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Observações</h4>
          <p className="text-sm text-[#475569] font-medium whitespace-pre-wrap">{veiculo.observacoes}</p>
        </div>
      )}

      <div className="pt-2">
        <button onClick={onVerManutencoes} className="bg-blue-50 text-[#336699] hover:bg-blue-100 border border-blue-200 font-bold text-[10px] uppercase px-4 py-2.5 rounded transition-colors">
          🔧 Ver Manutenções deste Veículo
        </button>
      </div>
    </div>
  );
}
