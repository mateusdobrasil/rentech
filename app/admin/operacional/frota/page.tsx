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

// Listas fixas de apoio
const TIPOS_VEICULO = ['CAMINHÃO', 'VAN', 'CARRO', 'UTILITÁRIO', 'CARRETA', 'MOTO', 'ÔNIBUS', 'OUTRO'];
const ICONE_TIPO: Record<string, string> = {
  'CAMINHÃO': '🚚', 'VAN': '🚐', 'CARRO': '🚗', 'UTILITÁRIO': '🛻',
  'CARRETA': '🚛', 'MOTO': '🏍️', 'ÔNIBUS': '🚌', 'OUTRO': '🚙'
};
const STATUS_VEICULO = ['ATIVO', 'EM MANUTENÇÃO', 'INATIVO'];
const COR_STATUS: Record<string, string> = {
  'ATIVO': 'bg-green-100 text-green-700 border-green-300',
  'EM MANUTENÇÃO': 'bg-amber-100 text-amber-700 border-amber-300',
  'INATIVO': 'bg-gray-100 text-gray-500 border-gray-300'
};
const TIPOS_MANUTENCAO = ['REVISÃO', 'TROCA DE ÓLEO', 'TROCA DE PNEUS', 'REPARO', 'OUTRO'];
const PROPRIEDADE_VEICULO = ['PRÓPRIO', 'ALUGADO'];
const COR_PROPRIEDADE: Record<string, string> = {
  'PRÓPRIO': 'bg-slate-100 text-slate-600 border-slate-300',
  'ALUGADO': 'bg-indigo-100 text-indigo-700 border-indigo-300'
};

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
  documento_url?: string;
  documento_path?: string;
  observacoes?: string;
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

// Calcula o status de vencimento de uma data (seguro, CRLV, próxima manutenção)
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

// Padroniza a escrita em maiúsculas nos campos de texto livre
const up = (v: string) => v.toUpperCase();

// Colunas do tipo "date" no Postgres rejeitam string vazia — normaliza para null
const dataOuNulo = (v?: string | null) => (v && v.trim() !== '' ? v : null);

const veiculoVazio: Partial<Veiculo> = {
  apelido: '', tipo: 'CAMINHÃO', marca: '', modelo: '', ano_fabricacao: undefined, ano_modelo: undefined,
  placa: '', renavam: '', chassi: '', cor: '', combustivel: '', km_atual: undefined, status: 'ATIVO',
  propriedade: 'PRÓPRIO', locacao_locadora: '', locacao_vigencia_inicio: '', locacao_vigencia_fim: '',
  locacao_apolice: '', locacao_contato_nome: '', locacao_contato_telefone: '',
  apolice_numero: '', segurado_nome: '', segurado_cnpj: '', seguradora: '', seguradora_telefone: '',
  corretora: '', seguro_vigencia_inicio: '', seguro_vigencia_fim: '', crlv_vencimento: '', observacoes: ''
};

const manutencaoVazia: Partial<Manutencao> = {
  tipo: 'REVISÃO', data: '', km_atual: undefined, custo: undefined, fornecedor: '', descricao: '',
  proxima_data: '', proxima_km: undefined
};

export default function PainelFrota() {
  const router = useRouter();
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');

  // Estados de Segurança e Autenticação
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  // Aba ativa
  const [abaAtiva, setAbaAtiva] = useState<'frota' | 'manutencao' | 'checkin'>('frota');

  // Estados de Dados
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [manutencoes, setManutencoes] = useState<Manutencao[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros da aba Frota
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');

  // Veículo selecionado na aba Manutenção
  const [veiculoSelecionadoId, setVeiculoSelecionadoId] = useState('');

  // Estados de UI (Modais)
  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'success' | 'error'; title: string; msg: string }>({ open: false, type: 'loading', title: '', msg: '' });
  const [modalVeiculo, setModalVeiculo] = useState<{ open: boolean; isNew: boolean; v: Partial<Veiculo> | null }>({ open: false, isNew: false, v: null });
  const [arquivoDocumento, setArquivoDocumento] = useState<File | null>(null);
  const [modalManutencao, setModalManutencao] = useState<{ open: boolean; m: Partial<Manutencao> | null }>({ open: false, m: null });
  const [arquivoAnexo, setArquivoAnexo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

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

      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      setUsuarioAtual(perfil.nome || 'Usuário');
      setAuthLoading(false);
      carregarDados();
    }

    checkAuth();
  }, [router, pathname]);

  // 2. Carregar Dados Principais (Veículos e Manutenções)
  const carregarDados = async () => {
    setLoading(true);

    const [resVeiculos, resManutencoes] = await Promise.all([
      supabase.from('frota_veiculos').select('*').order('apelido', { ascending: true }),
      supabase.from('frota_manutencoes').select('*').order('data', { ascending: false })
    ]);

    if (resVeiculos.data) setVeiculos(resVeiculos.data);
    if (resManutencoes.data) setManutencoes(resManutencoes.data);

    setLoading(false);
  };

  // Filtro Dinâmico da Frota
  const veiculosFiltrados = useMemo(() => {
    return veiculos.filter(v => {
      const termo = busca.toLowerCase();
      const matchBusca = v.apelido.toLowerCase().includes(termo) || (v.placa || '').toLowerCase().includes(termo) || (v.modelo || '').toLowerCase().includes(termo);
      const matchStatus = filtroStatus === 'TODOS' || v.status === filtroStatus;
      return matchBusca && matchStatus;
    });
  }, [veiculos, busca, filtroStatus]);

  // Veículos com documentação vencida ou a vencer em até 30 dias
  const veiculosComAlerta = useMemo(() => {
    return veiculos.filter(v => {
      const crlv = getStatusVencimento(v.crlv_vencimento);
      const alertaCrlv = crlv.cor.includes('red') || crlv.cor.includes('amber');
      if (v.propriedade === 'ALUGADO') {
        const locacao = getStatusVencimento(v.locacao_vigencia_fim);
        return alertaCrlv || locacao.cor.includes('red') || locacao.cor.includes('amber');
      }
      const seguro = getStatusVencimento(v.seguro_vigencia_fim);
      return alertaCrlv || seguro.cor.includes('red') || seguro.cor.includes('amber');
    });
  }, [veiculos]);

  const manutencoesDoVeiculo = useMemo(() => {
    return manutencoes.filter(m => m.veiculo_id === veiculoSelecionadoId);
  }, [manutencoes, veiculoSelecionadoId]);

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
  // AÇÕES DE CRUD - VEÍCULOS
  // ============================================================================
  const abrirModalNovoVeiculo = () => {
    setArquivoDocumento(null);
    setModalVeiculo({ open: true, isNew: true, v: { ...veiculoVazio } });
  };

  const abrirModalEditarVeiculo = (v: Veiculo) => {
    setArquivoDocumento(null);
    setModalVeiculo({ open: true, isNew: false, v: { ...v } });
  };

  const salvarVeiculo = async () => {
    if (!modalVeiculo.v?.apelido || !modalVeiculo.v?.placa) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'O Apelido e a Placa são obrigatórios.' });
      return;
    }

    setEnviando(true);
    let payload: Partial<Veiculo> = {
      ...modalVeiculo.v,
      seguro_vigencia_inicio: dataOuNulo(modalVeiculo.v.seguro_vigencia_inicio),
      seguro_vigencia_fim: dataOuNulo(modalVeiculo.v.seguro_vigencia_fim),
      crlv_vencimento: dataOuNulo(modalVeiculo.v.crlv_vencimento),
      locacao_vigencia_inicio: dataOuNulo(modalVeiculo.v.locacao_vigencia_inicio),
      locacao_vigencia_fim: dataOuNulo(modalVeiculo.v.locacao_vigencia_fim),
    };

    if (arquivoDocumento) {
      const resultado = await enviarArquivo(arquivoDocumento, 'documentos');
      if (!resultado) { setEnviando(false); return; }
      payload.documento_url = resultado.url;
      payload.documento_path = resultado.path;
    }

    let res;
    if (modalVeiculo.isNew) {
      res = await supabase.from('frota_veiculos').insert([payload]);
    } else {
      res = await supabase.from('frota_veiculos').update(payload).eq('id', payload.id);
    }

    setEnviando(false);

    if (res.error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.error.message });
    } else {
      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: modalVeiculo.isNew ? 'CADASTROU VEÍCULO' : 'EDITOU VEÍCULO',
        setor: 'FROTA',
        equipamento_id: modalVeiculo.isNew ? null : (payload.id ?? null),
        equipamento_nome: `${payload.apelido} (${payload.placa})`,
      });
      setDialog({ open: true, type: 'success', title: 'Concluído', msg: 'Veículo salvo com sucesso.' });
      setModalVeiculo({ open: false, isNew: false, v: null });
      carregarDados();
      setTimeout(() => setDialog(prev => ({ ...prev, open: false })), 2000);
    }
  };

  // ============================================================================
  // AÇÕES DE CRUD - MANUTENÇÕES
  // ============================================================================
  const abrirModalNovaManutencao = () => {
    if (!veiculoSelecionadoId) return;
    setArquivoAnexo(null);
    setModalManutencao({ open: true, m: { ...manutencaoVazia, veiculo_id: veiculoSelecionadoId, data: new Date().toISOString().slice(0, 10) } });
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

    const res = await supabase.from('frota_manutencoes').insert([payload]);
    setEnviando(false);

    if (res.error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.error.message });
    } else {
      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: `REGISTROU MANUTENÇÃO (${payload.tipo})`,
        setor: 'FROTA',
        equipamento_id: payload.veiculo_id ?? null,
        equipamento_nome: getVeiculoNome(payload.veiculo_id || ''),
      });
      setDialog({ open: true, type: 'success', title: 'Concluído', msg: 'Manutenção registrada com sucesso.' });
      setModalManutencao({ open: false, m: null });
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Controle de Frota.</p>
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
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🚚 <strong>Olá, {usuarioAtual}</strong>. Gerencie a frota, documentos, seguros e manutenções.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      {/* ABAS */}
      <div className="px-4 md:px-8 pt-4 flex-shrink-0 flex gap-2 border-b border-[#E2E8F0] bg-white">
        <button
          onClick={() => setAbaAtiva('frota')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${abaAtiva === 'frota' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          🚚 Frota {veiculosComAlerta.length > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[9px]">{veiculosComAlerta.length}</span>}
        </button>
        <button
          onClick={() => setAbaAtiva('manutencao')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${abaAtiva === 'manutencao' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          🔧 Manutenção
        </button>
        <button
          onClick={() => setAbaAtiva('checkin')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${abaAtiva === 'checkin' ? 'bg-[#336699] text-white' : 'text-[#94A3B8] hover:bg-[#F0F4F8]'}`}
        >
          🅿️ Check-in <span className="opacity-60 normal-case font-semibold">(em breve)</span>
        </button>
      </div>

      {/* ============================================================================ */}
      {/* ABA: FROTA */}
      {/* ============================================================================ */}
      {abaAtiva === 'frota' && (
        <>
          <div className="px-4 md:px-8 pt-6 flex-shrink-0">
            {veiculosComAlerta.length > 0 && (
              <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg">
                ⚠️ {veiculosComAlerta.length} veículo(s) com seguro, CRLV ou contrato de locação vencido ou vencendo nos próximos 30 dias.
              </div>
            )}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col md:flex-row gap-4 justify-between items-center">
              <div className="flex w-full md:w-auto gap-4 flex-grow max-w-2xl">
                <input
                  type="text"
                  placeholder="🔍 Buscar por apelido, placa ou modelo..."
                  className="flex-grow p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
                <select
                  className="p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer w-48"
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                >
                  <option value="TODOS">TODOS OS STATUS</option>
                  {STATUS_VEICULO.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button onClick={abrirModalNovoVeiculo} className="w-full md:w-auto bg-[#336699] hover:bg-[#284B8C] text-white px-6 py-3 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-md hover:shadow-lg">
                ➕ Novo Veículo
              </button>
            </div>
          </div>

          <div className="px-4 md:px-8 py-6 flex-grow">
            {loading ? (
              <div className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando frota...</div>
            ) : veiculosFiltrados.length === 0 ? (
              <div className="text-center py-12 text-[#94A3B8] font-bold text-sm bg-white rounded-xl border border-dashed border-[#CBD5E1]">Nenhum veículo encontrado.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {veiculosFiltrados.map(v => {
                  const seguro = getStatusVencimento(v.seguro_vigencia_fim);
                  const crlv = getStatusVencimento(v.crlv_vencimento);
                  const locacao = getStatusVencimento(v.locacao_vigencia_fim);
                  return (
                    <div key={v.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <span className="text-3xl">{ICONE_TIPO[v.tipo] || '🚙'}</span>
                          <div>
                            <h3 className="font-black text-[#0C1D4D] text-sm uppercase tracking-wide">{v.apelido}</h3>
                            <p className="text-[10px] text-[#64748B] font-bold uppercase">{v.placa}</p>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${COR_STATUS[v.status] || COR_STATUS['INATIVO']}`}>{v.status}</span>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${COR_PROPRIEDADE[v.propriedade] || COR_PROPRIEDADE['PRÓPRIO']}`}>{v.propriedade || 'PRÓPRIO'}</span>
                        </div>
                      </div>

                      <p className="text-xs text-[#475569] font-medium truncate" title={`${v.marca || ''} ${v.modelo || ''}`}>
                        {v.marca} {v.modelo} {v.ano_modelo ? `• ${v.ano_modelo}` : ''}
                      </p>

                      <div className="space-y-1.5 border-t border-[#F1F5F9] pt-3">
                        {v.propriedade !== 'ALUGADO' && (
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Seguro</span>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${seguro.cor}`}>{seguro.texto}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-[#94A3B8] font-bold uppercase">CRLV</span>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${crlv.cor}`}>{crlv.texto}</span>
                        </div>
                        {v.propriedade === 'ALUGADO' && (
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Locação</span>
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${locacao.cor}`}>{locacao.texto}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 pt-2 mt-auto">
                        <button onClick={() => abrirModalEditarVeiculo(v)} className="flex-1 bg-amber-100 text-amber-700 hover:bg-amber-200 font-bold text-[10px] uppercase px-3 py-2 rounded transition-colors">
                          ✏️ Editar Ficha
                        </button>
                        <button onClick={() => { setVeiculoSelecionadoId(v.id); setAbaAtiva('manutencao'); }} className="flex-1 bg-blue-50 text-[#336699] hover:bg-blue-100 border border-blue-200 font-bold text-[10px] uppercase px-3 py-2 rounded transition-colors">
                          🔧 Manutenções
                        </button>
                        {v.documento_url && (
                          <a href={v.documento_url} target="_blank" rel="noopener noreferrer" className="bg-gray-100 text-gray-600 hover:bg-gray-200 font-bold text-[10px] uppercase px-3 py-2 rounded transition-colors flex items-center" title="Ver documento anexado">
                            📎
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ============================================================================ */}
      {/* ABA: MANUTENÇÃO */}
      {/* ============================================================================ */}
      {abaAtiva === 'manutencao' && (
        <div className="px-4 md:px-8 py-6 flex-grow flex flex-col">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col md:flex-row gap-4 justify-between items-center mb-6">
            <select
              className="w-full md:w-96 p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#0C1D4D] focus:border-[#336699] outline-none cursor-pointer"
              value={veiculoSelecionadoId}
              onChange={(e) => setVeiculoSelecionadoId(e.target.value)}
            >
              <option value="">-- Selecione um veículo --</option>
              {veiculos.map(v => <option key={v.id} value={v.id}>{v.apelido} ({v.placa})</option>)}
            </select>

            <button
              onClick={abrirModalNovaManutencao}
              disabled={!veiculoSelecionadoId}
              className="w-full md:w-auto bg-[#336699] hover:bg-[#284B8C] text-white px-6 py-3 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-md hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ➕ Nova Manutenção
            </button>
          </div>

          {!veiculoSelecionadoId ? (
            <div className="text-center py-12 text-[#94A3B8] font-bold text-sm bg-white rounded-xl border border-dashed border-[#CBD5E1]">Selecione um veículo para ver o histórico de manutenções.</div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-10">
                  <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-36">Tipo</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-28">Data</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-24 text-center">KM</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-28 text-center">Custo</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Oficina / Fornecedor</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0]">Descrição</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Próxima</th>
                    <th className="p-4 border-b-2 border-[#E2E8F0] w-16 text-center">Anexo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {manutencoesDoVeiculo.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhuma manutenção registrada para este veículo.</td></tr>
                  ) : (
                    manutencoesDoVeiculo.map(m => {
                      const proxima = getStatusVencimento(m.proxima_data);
                      return (
                        <tr key={m.id} className="hover:bg-[#F8FAFC] transition-colors">
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
                            {m.anexo_url ? <a href={m.anexo_url} target="_blank" rel="noopener noreferrer" title="Ver anexo">📎</a> : '-'}
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
      {/* ABA: CHECK-IN (placeholder) */}
      {/* ============================================================================ */}
      {abaAtiva === 'checkin' && (
        <div className="px-4 md:px-8 py-12 flex-grow flex items-center justify-center">
          <div className="bg-white p-10 rounded-2xl border border-dashed border-[#CBD5E1] text-center max-w-md">
            <span className="text-4xl mb-4 block">🅿️</span>
            <h3 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Em Construção</h3>
            <p className="text-[#64748B] text-sm">O controle de entrada e saída da frota (check-in/check-out) será disponibilizado em uma próxima etapa.</p>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: CRIAR / EDITAR VEÍCULO */}
      {/* ============================================================================ */}
      {modalVeiculo.open && modalVeiculo.v && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#336699] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">{modalVeiculo.isNew ? '➕ Novo Veículo' : '✏️ Editar Veículo'}</h3>
              <button onClick={() => setModalVeiculo({ open: false, isNew: false, v: null })} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Dados do Veículo */}
              <div>
                <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Dados do Veículo</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Apelido</label>
                    <input type="text" placeholder="Ex: CAMINHÃO 01" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-bold text-[#0C1D4D]" value={modalVeiculo.v.apelido || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, apelido: up(e.target.value) } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Tipo</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer" value={modalVeiculo.v.tipo || 'OUTRO'} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, tipo: e.target.value } })}>
                      {TIPOS_VEICULO.map(t => <option key={t} value={t}>{ICONE_TIPO[t]} {t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Placa</label>
                    <input type="text" placeholder="Ex: KLY0182" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-bold uppercase text-[#0C1D4D]" value={modalVeiculo.v.placa || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, placa: e.target.value.toUpperCase() } })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Marca</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.marca || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, marca: up(e.target.value) } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Modelo</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.modelo || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, modelo: up(e.target.value) } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Ano Fabricação</label>
                    <input type="number" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.ano_fabricacao ?? ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, ano_fabricacao: e.target.value ? parseInt(e.target.value) : undefined } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Ano Modelo</label>
                    <input type="number" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.ano_modelo ?? ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, ano_modelo: e.target.value ? parseInt(e.target.value) : undefined } })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">RENAVAM</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.renavam || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, renavam: up(e.target.value) } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Chassi</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.chassi || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, chassi: up(e.target.value) } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Cor</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.cor || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, cor: up(e.target.value) } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Combustível</label>
                    <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.combustivel || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, combustivel: up(e.target.value) } })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">KM Atual</label>
                    <input type="number" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.km_atual ?? ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, km_atual: e.target.value ? parseFloat(e.target.value) : undefined } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Status</label>
                    <select className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer" value={modalVeiculo.v.status || 'ATIVO'} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, status: e.target.value } })}>
                      {STATUS_VEICULO.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Propriedade</label>
                    <select className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer" value={modalVeiculo.v.propriedade || 'PRÓPRIO'} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, propriedade: e.target.value } })}>
                      {PROPRIEDADE_VEICULO.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Dados da Locação (apenas se o veículo for alugado) */}
              {modalVeiculo.v.propriedade === 'ALUGADO' && (
                <div>
                  <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Dados da Locação</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Locadora</label>
                      <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.locacao_locadora || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, locacao_locadora: up(e.target.value) } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Apólice da Locadora</label>
                      <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.locacao_apolice || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, locacao_apolice: up(e.target.value) } })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vigência Início</label>
                      <input type="date" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.locacao_vigencia_inicio || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, locacao_vigencia_inicio: e.target.value } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vigência Fim</label>
                      <input type="date" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.locacao_vigencia_fim || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, locacao_vigencia_fim: e.target.value } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Contato (Nome)</label>
                      <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.locacao_contato_nome || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, locacao_contato_nome: up(e.target.value) } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Contato (Telefone)</label>
                      <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.locacao_contato_telefone || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, locacao_contato_telefone: up(e.target.value) } })} />
                    </div>
                  </div>
                </div>
              )}

              {/* Dados do Seguro (não se aplica a veículo alugado — fica sob responsabilidade da locadora) */}
              {modalVeiculo.v.propriedade !== 'ALUGADO' && (
                <div>
                  <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Dados do Seguro</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Apólice</label>
                      <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.apolice_numero || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, apolice_numero: up(e.target.value) } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Seguradora</label>
                      <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.seguradora || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, seguradora: up(e.target.value) } })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Segurado</label>
                      <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.segurado_nome || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, segurado_nome: up(e.target.value) } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">CNPJ do Segurado</label>
                      <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.segurado_cnpj || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, segurado_cnpj: up(e.target.value) } })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Telefone Seguradora</label>
                      <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.seguradora_telefone || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, seguradora_telefone: up(e.target.value) } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Corretora</label>
                      <input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.corretora || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, corretora: up(e.target.value) } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vigência Início</label>
                      <input type="date" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.seguro_vigencia_inicio || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, seguro_vigencia_inicio: e.target.value } })} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vigência Fim</label>
                      <input type="date" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.seguro_vigencia_fim || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, seguro_vigencia_fim: e.target.value } })} />
                    </div>
                  </div>
                </div>
              )}

              {/* Documentação e Anexos */}
              <div>
                <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Documentação</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vencimento do CRLV</label>
                    <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.crlv_vencimento || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, crlv_vencimento: e.target.value } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Anexar Apólice / CRLV (PDF ou imagem)</label>
                    <input type="file" accept=".pdf,image/*" className="w-full p-1.5 border border-[#CBD5E1] rounded outline-none text-xs" onChange={e => setArquivoDocumento(e.target.files?.[0] || null)} />
                    {modalVeiculo.v.documento_url && !arquivoDocumento && (
                      <a href={modalVeiculo.v.documento_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#336699] font-bold underline mt-1 inline-block">📎 Ver documento atual</a>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Observações</label>
                <textarea rows={2} className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm resize-none" value={modalVeiculo.v.observacoes || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, observacoes: up(e.target.value) } })} />
              </div>
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={salvarVeiculo} disabled={enviando} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-sm uppercase tracking-widest py-4 rounded-xl shadow-lg transition-colors disabled:opacity-50">
                {enviando ? '⏳ Enviando...' : '💾 Confirmar e Salvar'}
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
                <h3 className="font-black uppercase tracking-wider text-sm">🔧 Nova Manutenção</h3>
                <p className="text-[10px] text-blue-200 mt-0.5">Veículo: {getVeiculoNome(modalManutencao.m.veiculo_id || '')}</p>
              </div>
              <button onClick={() => setModalManutencao({ open: false, m: null })} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 bg-[#F8FAFC]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Tipo</label>
                  <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer bg-white" value={modalManutencao.m.tipo || 'REVISÃO'} onChange={e => setModalManutencao({ ...modalManutencao, m: { ...modalManutencao.m, tipo: e.target.value } })}>
                    {TIPOS_MANUTENCAO.map(t => <option key={t} value={t}>{t}</option>)}
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
              </div>
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={salvarManutencao} disabled={enviando} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-sm uppercase tracking-widest py-4 rounded-xl shadow-lg transition-colors disabled:opacity-50">
                {enviando ? '⏳ Enviando...' : '💾 Registrar Manutenção'}
              </button>
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
