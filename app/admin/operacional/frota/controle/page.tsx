"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../../lib/supabase';
import { registrarLogAuditoria } from '../../../../actions';
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
const TIPOS_DOCUMENTO = ['APÓLICE DE SEGURO', 'CRLV', 'CONTRATO DE LOCAÇÃO', 'NOTA FISCAL', 'OUTRO'];
const ICONE_DOCUMENTO: Record<string, string> = {
  'APÓLICE DE SEGURO': '🛡️', 'CRLV': '🪪', 'CONTRATO DE LOCAÇÃO': '📃', 'NOTA FISCAL': '🧾', 'OUTRO': '📎'
};

// Interface do Banco de Dados
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
  arquivo_path: string;
  visivel_frota: boolean;
  created_at?: string;
}

// Calcula o status de vencimento de uma data (seguro, CRLV, locação)
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
  propriedade: 'PRÓPRIO', exibir_na_frota: false, locacao_locadora: '', locacao_vigencia_inicio: '', locacao_vigencia_fim: '',
  locacao_apolice: '', locacao_contato_nome: '', locacao_contato_telefone: '',
  apolice_numero: '', segurado_nome: '', segurado_cnpj: '', seguradora: '', seguradora_telefone: '',
  corretora: '', seguro_vigencia_inicio: '', seguro_vigencia_fim: '', crlv_vencimento: '', ipva_vencimento: '', observacoes: ''
};

export default function PainelControleFrota() {
  const router = useRouter();
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');

  // Estados de Segurança e Autenticação
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  // Estados de Dados
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroPropriedade, setFiltroPropriedade] = useState('TODOS');

  // Estados de UI (Modal)
  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'success' | 'error'; title: string; msg: string }>({ open: false, type: 'loading', title: '', msg: '' });
  const [modalVeiculo, setModalVeiculo] = useState<{ open: boolean; isNew: boolean; v: Partial<Veiculo> | null }>({ open: false, isNew: false, v: null });
  const [enviando, setEnviando] = useState(false);

  // Estados do modal de Documentos
  const [modalDocumentos, setModalDocumentos] = useState<{ open: boolean; veiculo: Veiculo | null }>({ open: false, veiculo: null });
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [carregandoDocumentos, setCarregandoDocumentos] = useState(false);
  const [novoDocTipo, setNovoDocTipo] = useState(TIPOS_DOCUMENTO[0]);
  const [novoDocDescricao, setNovoDocDescricao] = useState('');
  const [novoDocVisivel, setNovoDocVisivel] = useState(false);
  const [arquivoNovoDocumento, setArquivoNovoDocumento] = useState<File | null>(null);
  const [enviandoDocumento, setEnviandoDocumento] = useState(false);

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

  // 2. Carregar Veículos
  const carregarDados = async () => {
    setLoading(true);
    const { data } = await supabase.from('frota_veiculos').select('*').order('apelido', { ascending: true });
    if (data) setVeiculos(data);
    setLoading(false);
  };

  // Filtro Dinâmico
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
    return veiculos.filter(v => {
      const crlv = getStatusVencimento(v.crlv_vencimento);
      const ipva = getStatusVencimento(v.ipva_vencimento);
      const alertaCrlvIpva = crlv.cor.includes('red') || crlv.cor.includes('amber') || ipva.cor.includes('red') || ipva.cor.includes('amber');
      if (v.propriedade === 'ALUGADO') {
        const locacao = getStatusVencimento(v.locacao_vigencia_fim);
        return alertaCrlvIpva || locacao.cor.includes('red') || locacao.cor.includes('amber');
      }
      const seguro = getStatusVencimento(v.seguro_vigencia_fim);
      return alertaCrlvIpva || seguro.cor.includes('red') || seguro.cor.includes('amber');
    });
  }, [veiculos]);

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
    setModalVeiculo({ open: true, isNew: true, v: { ...veiculoVazio } });
  };

  const abrirModalEditarVeiculo = (v: Veiculo) => {
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
      ipva_vencimento: dataOuNulo(modalVeiculo.v.ipva_vencimento),
      locacao_vigencia_inicio: dataOuNulo(modalVeiculo.v.locacao_vigencia_inicio),
      locacao_vigencia_fim: dataOuNulo(modalVeiculo.v.locacao_vigencia_fim),
    };

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

  const excluirVeiculo = async (v: Veiculo) => {
    if (!confirm(`Tem certeza que deseja remover "${v.apelido}" (${v.placa})? Essa ação não pode ser desfeita.`)) return;

    const { error } = await supabase.from('frota_veiculos').delete().eq('id', v.id);
    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      return;
    }

    registrarLogAuditoria({
      usuario_nome: usuarioAtual,
      acao: 'REMOVEU VEÍCULO',
      setor: 'FROTA',
      equipamento_id: v.id,
      equipamento_nome: `${v.apelido} (${v.placa})`,
    });
    carregarDados();
  };

  // ============================================================================
  // AÇÕES DE CRUD - DOCUMENTOS
  // ============================================================================
  const carregarDocumentos = async (veiculoId: string) => {
    setCarregandoDocumentos(true);
    const { data } = await supabase.from('frota_documentos').select('*').eq('veiculo_id', veiculoId).order('created_at', { ascending: false });
    setDocumentos(data || []);
    setCarregandoDocumentos(false);
  };

  const abrirModalDocumentos = (v: Veiculo) => {
    setModalDocumentos({ open: true, veiculo: v });
    setNovoDocTipo(TIPOS_DOCUMENTO[0]);
    setNovoDocDescricao('');
    setNovoDocVisivel(false);
    setArquivoNovoDocumento(null);
    carregarDocumentos(v.id);
  };

  const adicionarDocumento = async () => {
    if (!modalDocumentos.veiculo || !arquivoNovoDocumento) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'Selecione um arquivo para anexar.' });
      return;
    }

    setEnviandoDocumento(true);
    const resultado = await enviarArquivo(arquivoNovoDocumento, `documentos/${modalDocumentos.veiculo.id}`);
    if (!resultado) { setEnviandoDocumento(false); return; }

    const { error } = await supabase.from('frota_documentos').insert([{
      veiculo_id: modalDocumentos.veiculo.id,
      tipo: novoDocTipo,
      descricao: novoDocDescricao || null,
      arquivo_url: resultado.url,
      arquivo_path: resultado.path,
      visivel_frota: novoDocVisivel,
    }]);

    setEnviandoDocumento(false);

    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      return;
    }

    registrarLogAuditoria({
      usuario_nome: usuarioAtual,
      acao: `ANEXOU DOCUMENTO (${novoDocTipo})`,
      setor: 'FROTA',
      equipamento_id: modalDocumentos.veiculo.id,
      equipamento_nome: `${modalDocumentos.veiculo.apelido} (${modalDocumentos.veiculo.placa})`,
    });

    setNovoDocDescricao('');
    setNovoDocVisivel(false);
    setArquivoNovoDocumento(null);
    carregarDocumentos(modalDocumentos.veiculo.id);
  };

  const alternarVisibilidadeDocumento = async (doc: Documento) => {
    const novoValor = !doc.visivel_frota;
    setDocumentos(prev => prev.map(d => d.id === doc.id ? { ...d, visivel_frota: novoValor } : d));
    await supabase.from('frota_documentos').update({ visivel_frota: novoValor }).eq('id', doc.id);
  };

  const excluirDocumento = async (doc: Documento) => {
    if (!confirm('Tem certeza que deseja remover este documento?')) return;

    await supabase.storage.from('frota').remove([doc.arquivo_path]);
    const { error } = await supabase.from('frota_documentos').delete().eq('id', doc.id);
    if (error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: error.message });
      return;
    }

    setDocumentos(prev => prev.filter(d => d.id !== doc.id));
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
          <button onClick={() => router.push('/admin/operacional/frota')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar à Frota
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
          🔧 <strong>Olá, {usuarioAtual}</strong>. Cadastro, documentos e seguros da frota.
        </p>
        <button onClick={() => router.push('/admin/operacional/frota')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR À FROTA
        </button>
      </div>

      <div className="px-4 md:px-8 pt-6 flex-shrink-0">
        {veiculosComAlerta.length > 0 && (
          <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg">
            ⚠️ {veiculosComAlerta.length} veículo(s) com seguro, CRLV, IPVA ou contrato de locação vencido ou vencendo nos próximos 30 dias.
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
            <select
              className="p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer w-48"
              value={filtroPropriedade}
              onChange={(e) => setFiltroPropriedade(e.target.value)}
            >
              <option value="TODOS">PRÓPRIO / ALUGADO</option>
              {PROPRIEDADE_VEICULO.map(p => <option key={p} value={p}>{p}</option>)}
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
              const ipva = getStatusVencimento(v.ipva_vencimento);
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
                      {!v.exibir_na_frota && (
                        <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border bg-gray-100 text-gray-400 border-gray-300" title="Este veículo não aparece na página de visualização da Frota">🙈 Oculto</span>
                      )}
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
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-[#94A3B8] font-bold uppercase">IPVA</span>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${ipva.cor}`}>{ipva.texto}</span>
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
                    <button onClick={() => abrirModalDocumentos(v)} className="bg-gray-100 text-gray-600 hover:bg-gray-200 font-bold text-[10px] uppercase px-3 py-2 rounded transition-colors" title="Documentos anexados">
                      📁
                    </button>
                    <button onClick={() => excluirVeiculo(v)} className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 font-bold text-[10px] uppercase px-3 py-2 rounded transition-colors" title="Remover veículo">
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
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
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Exibir na Frota</label>
                    <label className="flex items-center gap-2 p-2 border border-[#CBD5E1] rounded cursor-pointer h-[38px]">
                      <input type="checkbox" className="w-4 h-4 accent-[#336699]" checked={!!modalVeiculo.v.exibir_na_frota} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, exibir_na_frota: e.target.checked } })} />
                      <span className="text-xs font-semibold text-[#0C1D4D]">{modalVeiculo.v.exibir_na_frota ? 'Sim' : 'Não'}</span>
                    </label>
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
                      <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">CNPJ/CPF do Segurado</label>
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

              {/* Documentação */}
              <div>
                <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Documentação</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vencimento do CRLV</label>
                    <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.crlv_vencimento || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, crlv_vencimento: e.target.value } })} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vencimento do IPVA</label>
                    <input type="date" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalVeiculo.v.ipva_vencimento || ''} onChange={e => setModalVeiculo({ ...modalVeiculo, v: { ...modalVeiculo.v, ipva_vencimento: e.target.value } })} />
                  </div>
                </div>
                {!modalVeiculo.isNew && modalVeiculo.v.id && (
                  <p className="text-[10px] text-[#64748B] mt-3">
                    Para anexar apólice, CRLV e outros arquivos, use o botão{' '}
                    <button type="button" onClick={() => abrirModalDocumentos(modalVeiculo.v as Veiculo)} className="text-[#336699] font-bold underline">📁 Documentos</button>{' '}
                    no card do veículo.
                  </p>
                )}
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
      {/* MODAL: DOCUMENTOS DO VEÍCULO */}
      {/* ============================================================================ */}
      {modalDocumentos.open && modalDocumentos.veiculo && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <div>
                <h3 className="font-black uppercase tracking-wider text-sm">📁 Documentos do Veículo</h3>
                <p className="text-[10px] text-blue-200 mt-0.5">{modalDocumentos.veiculo.apelido} ({modalDocumentos.veiculo.placa})</p>
              </div>
              <button onClick={() => setModalDocumentos({ open: false, veiculo: null })} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 overflow-y-auto bg-[#F8FAFC] space-y-6">
              {/* Formulário de novo documento */}
              <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm">
                <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest mb-3">Anexar Novo Documento</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Tipo</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer" value={novoDocTipo} onChange={e => setNovoDocTipo(e.target.value)}>
                      {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{ICONE_DOCUMENTO[t]} {t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Descrição (opcional)</label>
                    <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm" value={novoDocDescricao} onChange={e => setNovoDocDescricao(up(e.target.value))} />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Arquivo (PDF ou imagem)</label>
                  <input type="file" accept=".pdf,image/*" className="w-full p-1.5 border border-[#CBD5E1] rounded-lg outline-none text-xs" onChange={e => setArquivoNovoDocumento(e.target.files?.[0] || null)} />
                </div>
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-[#336699]" checked={novoDocVisivel} onChange={e => setNovoDocVisivel(e.target.checked)} />
                    <span className="text-xs font-bold text-[#78350F]">Este documento pode ser exibido para a equipe de Operações na tela da Frota</span>
                  </label>
                  <p className="text-[10px] text-[#92400E] mt-1 ml-6">Deixe desmarcado se o arquivo contiver dados financeiros ou informações sensíveis (ex: boleto, valor pago, dados bancários).</p>
                </div>
                <button
                  onClick={adicionarDocumento}
                  disabled={enviandoDocumento || !arquivoNovoDocumento}
                  className="mt-3 w-full bg-[#336699] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-2.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {enviandoDocumento ? '⏳ Enviando...' : '➕ Adicionar Documento'}
                </button>
              </div>

              {/* Lista de documentos existentes */}
              <div>
                <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Documentos Anexados</h4>
                {carregandoDocumentos ? (
                  <p className="text-center text-[#94A3B8] text-xs font-bold py-6">Carregando...</p>
                ) : documentos.length === 0 ? (
                  <p className="text-center text-[#94A3B8] text-xs font-bold py-6 bg-white border border-dashed border-[#CBD5E1] rounded-lg">Nenhum documento anexado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {documentos.map(doc => (
                      <div key={doc.id} className="bg-white p-3 rounded-lg border border-[#E2E8F0] flex items-center gap-3">
                        <span className="text-xl">{ICONE_DOCUMENTO[doc.tipo] || '📎'}</span>
                        <div className="flex-grow min-w-0">
                          <p className="text-xs font-black text-[#0C1D4D] uppercase truncate">{doc.tipo}</p>
                          {doc.descricao && <p className="text-[10px] text-[#64748B] truncate">{doc.descricao}</p>}
                        </div>
                        <a href={doc.arquivo_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#336699] font-bold underline flex-shrink-0">Ver</a>
                        <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer" title="Visível na Frota">
                          <input type="checkbox" className="w-3.5 h-3.5 accent-[#336699]" checked={doc.visivel_frota} onChange={() => alternarVisibilidadeDocumento(doc)} />
                          <span className="text-[9px] font-bold text-[#64748B] uppercase">{doc.visivel_frota ? 'Visível' : 'Restrito'}</span>
                        </label>
                        <button onClick={() => excluirDocumento(doc)} className="text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-black flex-shrink-0" title="Remover documento">🗑️</button>
                      </div>
                    ))}
                  </div>
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
