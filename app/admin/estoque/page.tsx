"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";

// Interfaces do Banco de Dados
interface Categoria {
  id: string;
  nome: string;
}

interface Equipamento {
  id: string;
  categoria_id: string;
  nome: string;
  peso: number;
  consumo_watts: number;
  largura: number;
  altura: number;
  profundidade: number;
  resolucao?: string;
  dmx?: string;
  detalhes?: string;
  ativo: boolean;
}

interface Gatilho {
  id: string;
  acessorio_id: string;
  equipamento_alvo_id: string;
  acessorio_nome?: string; 
}

export default function PainelEstoque() {
  const router = useRouter();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  // Estados de Dados
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Estados de Filtro
  const [busca, setBusca] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('TODOS');

  // Estados de UI (Modais)
  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'success' | 'error'; title: string; msg: string }>({ open: false, type: 'loading', title: '', msg: '' });
  const [modalEdit, setModalEdit] = useState<{ open: boolean; isNew: boolean; eq: Partial<Equipamento> | null }>({ open: false, isNew: false, eq: null });
  const [modalAcessorios, setModalAcessorios] = useState<{ open: boolean; eq: Equipamento | null; gatilhos: Gatilho[] }>({ open: false, eq: null, gatilhos: [] });
  const [novoAcessorioId, setNovoAcessorioId] = useState('');

  // Estados Modal Categorias
  const [modalCategorias, setModalCategorias] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState({ id: '', nome: '' });
  const [editandoCategoriaId, setEditandoCategoriaId] = useState<string | null>(null);
  const [editandoCategoriaNome, setEditandoCategoriaNome] = useState('');

  // 1. Validar Sessão
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      const { data: perfil } = await supabase.from('perfis_usuarios').select('*').eq('id', session.user.id).single();
      if (perfil) {
        setUsuarioAtual(perfil.nome || 'Equipe');
        const permissao = String(perfil.permissao || perfil.nivel || '').toUpperCase();
        if (!['DIR', 'DIRETOR', 'ADMINISTRADOR', 'ADMIN', 'ESTOQUE'].includes(permissao)) {
          router.push('/admin');
          return;
        }
      }
      setAuthLoading(false);
    }
    checkAuth();
  }, [router]);

  // 2. Carregar Dados Principais (Equipamentos e Categorias)
  const carregarDados = async () => {
    setLoading(true);
    
    // Dispara as duas buscas em paralelo para ganhar performance
    const [resEq, resCat] = await Promise.all([
      supabase.from('equipamentos').select('*').order('nome', { ascending: true }),
      supabase.from('categorias').select('*').order('nome', { ascending: true })
    ]);

    if (resCat.data) setCategorias(resCat.data);
    if (resEq.data) setEquipamentos(resEq.data);
    
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading) carregarDados();
  }, [authLoading]);

  // Filtro Dinâmico
  const equipamentosFiltrados = useMemo(() => {
    return equipamentos.filter(eq => {
      const matchBusca = eq.nome.toLowerCase().includes(busca.toLowerCase()) || (eq.detalhes || '').toLowerCase().includes(busca.toLowerCase());
      const matchCat = filtroCategoria === 'TODOS' || eq.categoria_id === filtroCategoria;
      return matchBusca && matchCat;
    });
  }, [equipamentos, busca, filtroCategoria]);

  const listaAcessorios = useMemo(() => equipamentos.filter(eq => eq.categoria_id.toLowerCase() === 'acc' && eq.ativo), [equipamentos]);

  // Função Auxiliar para pegar o nome da Categoria
  const getNomeCategoria = (catId: string) => {
    const cat = categorias.find(c => c.id === catId);
    return cat ? cat.nome : catId.toUpperCase();
  };

  // ============================================================================
  // AÇÕES DE CRUD - EQUIPAMENTOS
  // ============================================================================

  const toggleAtivo = async (eq: Equipamento) => {
    const novoStatus = !eq.ativo;
    setEquipamentos(prev => prev.map(item => item.id === eq.id ? { ...item, ativo: novoStatus } : item)); 
    await supabase.from('equipamentos').update({ ativo: novoStatus }).eq('id', eq.id);
  };

  const abrirModalNovo = () => {
    setModalEdit({
      open: true,
      isNew: true,
      eq: { nome: '', categoria_id: '', peso: 0, consumo_watts: 0, largura: 0, altura: 0, profundidade: 0, resolucao: '', dmx: '', detalhes: '', ativo: true }
    });
  };

  const abrirModalEditar = (eq: Equipamento) => {
    setModalEdit({ open: true, isNew: false, eq: { ...eq } });
  };

  const salvarEquipamento = async () => {
    if (!modalEdit.eq?.nome || !modalEdit.eq?.categoria_id) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'O Nome e a Categoria são obrigatórios.' });
      return;
    }

    setDialog({ open: true, type: 'loading', title: 'Salvando...', msg: 'Atualizando catálogo.' });

    let res;
    if (modalEdit.isNew) {
      res = await supabase.from('equipamentos').insert([modalEdit.eq]);
    } else {
      res = await supabase.from('equipamentos').update(modalEdit.eq).eq('id', modalEdit.eq.id);
    }

    if (res.error) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.error.message });
    } else {
      setDialog({ open: true, type: 'success', title: 'Concluído', msg: 'Equipamento salvo com sucesso.' });
      setModalEdit({ open: false, isNew: false, eq: null });
      carregarDados();
      setTimeout(() => setDialog(prev => ({ ...prev, open: false })), 2000);
    }
  };

  // ============================================================================
  // AÇÕES DE CRUD - CATEGORIAS
  // ============================================================================

  const salvarNovaCategoria = async () => {
    if (!novaCategoria.id || !novaCategoria.nome) return;
    
    // Normaliza ID: minúsculo e sem espaços (ex: "painel led" -> "painel_led")
    const idNormalizado = novaCategoria.id.trim().toLowerCase().replace(/\s+/g, '_');
    
    const { error } = await supabase.from('categorias').insert([{ id: idNormalizado, nome: novaCategoria.nome }]);
    if (error) {
      alert(`Erro: ${error.message}`);
    } else {
      setNovaCategoria({ id: '', nome: '' });
      carregarDados(); // Recarrega a lista
    }
  };

  const iniciarEdicaoCategoria = (cat: Categoria) => {
    setEditandoCategoriaId(cat.id);
    setEditandoCategoriaNome(cat.nome);
  };

  const confirmarEdicaoCategoria = async () => {
    if (!editandoCategoriaId || !editandoCategoriaNome) return;

    const { error } = await supabase.from('categorias').update({ nome: editandoCategoriaNome }).eq('id', editandoCategoriaId);
    if (!error) {
      setEditandoCategoriaId(null);
      carregarDados();
    } else {
      alert(`Erro: ${error.message}`);
    }
  };

  // ============================================================================
  // AÇÕES DE VÍNCULO - ACESSÓRIOS (GATILHOS)
  // ============================================================================

  const abrirModalAcessorios = async (eq: Equipamento) => {
    setDialog({ open: true, type: 'loading', title: 'Aguarde', msg: 'Buscando vínculos...' });
    
    const { data, error } = await supabase.from('gatilhos_acessorios').select('*').eq('equipamento_alvo_id', eq.id);
    
    if (!error && data) {
      const gatilhosComNome = data.map(g => {
        const accInfo = equipamentos.find(e => e.id === g.acessorio_id);
        return { ...g, acessorio_nome: accInfo ? accInfo.nome : 'Acessório Desconhecido' };
      });
      
      setModalAcessorios({ open: true, eq, gatilhos: gatilhosComNome });
      setNovoAcessorioId('');
      setDialog({ ...dialog, open: false });
    } else {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: 'Falha ao buscar acessórios vinculados.' });
    }
  };

  const vincularAcessorio = async () => {
    if (!novoAcessorioId || !modalAcessorios.eq) return;

    if (modalAcessorios.gatilhos.some(g => g.acessorio_id === novoAcessorioId)) {
      alert("Este acessório já está vinculado a este equipamento.");
      return;
    }

    const payload = {
      equipamento_alvo_id: modalAcessorios.eq.id,
      acessorio_id: novoAcessorioId
    };

    const { data, error } = await supabase.from('gatilhos_acessorios').insert([payload]).select().single();

    if (!error && data) {
      const accInfo = equipamentos.find(e => e.id === data.acessorio_id);
      const novoGatilho = { ...data, acessorio_nome: accInfo?.nome };
      setModalAcessorios(prev => ({ ...prev, gatilhos: [...prev.gatilhos, novoGatilho] }));
      setNovoAcessorioId('');
    }
  };

  const desvincularAcessorio = async (gatilhoId: string) => {
    const { error } = await supabase.from('gatilhos_acessorios').delete().eq('id', gatilhoId);
    if (!error) {
      setModalAcessorios(prev => ({ ...prev, gatilhos: prev.gatilhos.filter(g => g.id !== gatilhoId) }));
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

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics/>

      {/* IDENTIFICAÇÃO E NAVEGAÇÃO ALINHADOS À NAVBAR GLOBAL */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          📦 <strong>Olá, {usuarioAtual}</strong>. Gerencie o catálogo técnico de equipamentos e categorias da locadora.
        </p>
        <button onClick={() => router.push('/admin')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      {/* BARRA DE CONTROLE (BUSCA E AÇÕES) */}
      <div className="px-4 md:px-8 pt-6 flex-shrink-0">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="flex w-full md:w-auto gap-4 flex-grow max-w-2xl">
            <input 
              type="text" 
              placeholder="🔍 Buscar equipamento..." 
              className="flex-grow p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <select 
              className="p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer w-48"
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
            >
              <option value="TODOS">TODAS CATEGORIAS</option>
              {categorias.map(cat => <option key={cat.id} value={cat.id}>{cat.nome}</option>)}
            </select>
          </div>
          
          <div className="flex w-full md:w-auto gap-2">
            <button onClick={() => setModalCategorias(true)} className="flex-1 md:flex-none bg-[#E2E8F0] hover:bg-[#CBD5E1] text-[#0C1D4D] px-4 py-3 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-sm border border-[#CBD5E1]">
              🏷️ Categorias
            </button>
            <button onClick={abrirModalNovo} className="flex-1 md:flex-none bg-[#336699] hover:bg-[#284B8C] text-white px-6 py-3 rounded-lg font-black text-xs uppercase tracking-wider transition-colors shadow-md hover:shadow-lg">
              ➕ Adicionar Item
            </button>
          </div>
        </div>
      </div>

      {/* TABELA DE DADOS (Scrollável) */}
      <div className="px-4 md:px-8 py-6 flex-grow overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-10">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-4 border-b-2 border-[#E2E8F0] w-20 text-center">Status</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Categoria</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Equipamento / Modelo</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-32 text-center">Dimensões</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-24 text-center">Peso</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-24 text-center">Consumo</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-48 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando catálogo...</td></tr>
              ) : equipamentosFiltrados.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhum equipamento encontrado.</td></tr>
              ) : (
                equipamentosFiltrados.map((eq) => (
                  <tr key={eq.id} className={`transition-colors ${!eq.ativo ? 'bg-gray-50 opacity-60' : 'hover:bg-[#F8FAFC]'}`}>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => toggleAtivo(eq)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${eq.ativo ? 'bg-[#16A34A]' : 'bg-[#CBD5E1]'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${eq.ativo ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </td>
                    <td className="p-4">
                      <span className="bg-[#E2E8F0] text-[#475569] font-black px-2 py-1 rounded text-[9px] uppercase tracking-widest block truncate" title={getNomeCategoria(eq.categoria_id)}>
                        {getNomeCategoria(eq.categoria_id)}
                      </span>
                    </td>
                    <td className="p-4">
                      <strong className="text-[#0C1D4D] text-sm block truncate max-w-[300px]">{eq.nome}</strong>
                      <span className="text-[#64748B] text-[10px] truncate max-w-[300px] block mt-0.5">{eq.detalhes || 'Sem especificações complementares'}</span>
                    </td>
                    <td className="p-4 text-center text-[#64748B] font-medium">
                      {(eq.largura && eq.altura) ? `${eq.largura}x${eq.altura}${eq.profundidade ? `x${eq.profundidade}` : ''}m` : 'N/A'}
                    </td>
                    <td className="p-4 text-center font-bold text-[#0A2A4A]">{eq.peso ? `${eq.peso} kg` : '-'}</td>
                    <td className="p-4 text-center font-bold text-[#D97706]">{eq.consumo_watts ? `${eq.consumo_watts} W` : '-'}</td>
                    <td className="p-4 text-center space-x-2">
                      <button onClick={() => abrirModalEditar(eq)} className="bg-amber-100 text-amber-700 hover:bg-amber-200 font-bold text-[10px] uppercase px-3 py-2 rounded transition-colors">
                        ✏️ Editar
                      </button>
                      <button onClick={() => abrirModalAcessorios(eq)} className="bg-blue-50 text-[#336699] hover:bg-blue-100 border border-blue-200 font-bold text-[10px] uppercase px-3 py-2 rounded transition-colors">
                        🔗 Acessórios
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================================ */}
      {/* MODAL: CRIAR / EDITAR EQUIPAMENTO COMPLETADO */}
      {/* ============================================================================ */}
      {modalEdit.open && modalEdit.eq && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#336699] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">{modalEdit.isNew ? '➕ Novo Equipamento' : '✏️ Editar Equipamento'}</h3>
              <button onClick={() => setModalEdit({ open: false, isNew: false, eq: null })} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Nome Comercial</label>
                  <input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-bold text-[#0C1D4D]" value={modalEdit.eq.nome || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, nome: e.target.value }})} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Categoria</label>
                  <select 
                    className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm font-semibold cursor-pointer" 
                    value={modalEdit.eq.categoria_id || ''} 
                    onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, categoria_id: e.target.value }})}
                  >
                    <option value="" disabled>-- Escolha --</option>
                    {categorias.map(cat => <option key={cat.id} value={cat.id}>{cat.nome}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0]">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Peso Bruto (kg)</label>
                  <input type="number" step="0.1" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalEdit.eq.peso || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, peso: parseFloat(e.target.value) || 0 }})} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Consumo (Watts)</label>
                  <input type="number" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm text-[#D97706] font-bold" value={modalEdit.eq.consumo_watts || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, consumo_watts: parseFloat(e.target.value) || 0 }})} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Largura (m)</label>
                  <input type="number" step="0.01" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalEdit.eq.largura || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, largura: parseFloat(e.target.value) || 0 }})} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Altura (m)</label>
                  <input type="number" step="0.01" className="w-full p-2 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalEdit.eq.altura || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, altura: parseFloat(e.target.value) || 0 }})} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Profundidade (m) Opcional</label>
                  <input type="number" step="0.01" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalEdit.eq.profundidade || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, profundidade: parseFloat(e.target.value) || 0 }})} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Resolução (Para LED/Telas)</label>
                  <input type="text" placeholder="Ex: 128 (se for 128x128px)" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalEdit.eq.resolucao || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, resolucao: e.target.value }})} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">DMX / Canais (Para Luz)</label>
                  <input type="text" placeholder="Ex: 16CH" className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm" value={modalEdit.eq.dmx || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, dmx: e.target.value }})} />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Detalhes Técnicos Descritivos</label>
                <textarea rows={3} className="w-full p-2.5 border border-[#CBD5E1] rounded outline-none focus:border-[#336699] text-sm resize-none" value={modalEdit.eq.detalhes || ''} onChange={e => setModalEdit({ ...modalEdit, eq: { ...modalEdit.eq, detalhes: e.target.value }})} />
              </div>
            </div>

            <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">
              <button onClick={salvarEquipamento} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-sm uppercase tracking-widest py-4 rounded-xl shadow-lg transition-colors">
                💾 Confirmar e Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: GERENCIAR CATEGORIAS */}
      {/* ============================================================================ */}
      {modalCategorias && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">🏷️ Gerenciar Categorias</h3>
              <button onClick={() => setModalCategorias(false)} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto bg-[#F8FAFC]">
              {/* Add New Category */}
              <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm mb-6">
                <h4 className="text-[10px] font-black uppercase text-[#64748B] mb-3">Adicionar Nova Categoria</h4>
                <div className="flex flex-col md:flex-row gap-3">
                  <input 
                    type="text" 
                    placeholder="ID Curto (ex: led)" 
                    className="w-full md:w-1/3 p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs font-mono"
                    value={novaCategoria.id}
                    onChange={(e) => setNovaCategoria({ ...novaCategoria, id: e.target.value })}
                  />
                  <input 
                    type="text" 
                    placeholder="Nome de Exibição (ex: Painéis de LED)" 
                    className="w-full flex-grow p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-xs font-semibold"
                    value={novaCategoria.nome}
                    onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })}
                  />
                  <button 
                    onClick={salvarNovaCategoria}
                    disabled={!novaCategoria.id || !novaCategoria.nome}
                    className="bg-[#16A34A] hover:bg-[#15803D] text-white px-4 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </div>
              </div>

              <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Categorias Existentes</h4>
              <div className="space-y-2">
                {categorias.map(cat => (
                  <div key={cat.id} className="flex justify-between items-center bg-white p-3 border border-[#E2E8F0] rounded-lg shadow-sm">
                    {editandoCategoriaId === cat.id ? (
                      <div className="flex w-full gap-2">
                        <span className="p-2 bg-gray-100 rounded text-xs font-mono text-gray-500 w-16 text-center select-none">{cat.id}</span>
                        <input 
                          type="text" 
                          className="flex-grow p-2 border border-[#336699] rounded outline-none text-xs font-bold"
                          value={editandoCategoriaNome}
                          onChange={(e) => setEditandoCategoriaNome(e.target.value)}
                          autoFocus
                        />
                        <button onClick={confirmarEdicaoCategoria} className="bg-[#336699] text-white px-3 rounded text-xs font-bold">OK</button>
                        <button onClick={() => setEditandoCategoriaId(null)} className="bg-gray-200 text-gray-600 px-3 rounded text-xs font-bold">X</button>
                      </div>
                    ) : (
                      <div className="flex justify-between w-full items-center">
                        <div>
                          <span className="inline-block w-12 text-[10px] font-mono text-[#94A3B8]">{cat.id}</span>
                          <span className="text-sm font-bold text-[#0C1D4D]">{cat.nome}</span>
                        </div>
                        <button 
                          onClick={() => iniciarEdicaoCategoria(cat)}
                          className="text-amber-600 hover:bg-amber-50 px-2 py-1 rounded text-xs font-black transition-colors"
                        >
                          Editar Nome
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================ */}
      {/* MODAL: GERENCIAR VÍNCULOS DE ACESSÓRIOS */}
      {/* ============================================================================ */}
      {modalAcessorios.open && modalAcessorios.eq && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white flex-shrink-0">
              <div>
                <h3 className="font-black uppercase tracking-wider text-sm">🔗 Gerenciar Gatilhos / Acessórios</h3>
                <p className="text-[10px] text-blue-200 mt-0.5">Equipamento: {modalAcessorios.eq.nome}</p>
              </div>
              <button onClick={() => setModalAcessorios({ open: false, eq: null, gatilhos: [] })} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto bg-[#F8FAFC]">
              
              <div className="bg-white p-4 rounded-xl border border-[#E2E8F0] shadow-sm mb-6">
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-2">Vincular Novo Acessório</label>
                <div className="flex gap-2">
                  <select 
                    className="flex-grow p-2.5 border border-[#CBD5E1] rounded-lg outline-none focus:border-[#336699] text-sm text-[#0C1D4D] font-semibold"
                    value={novoAcessorioId}
                    onChange={(e) => setNovoAcessorioId(e.target.value)}
                  >
                    <option value="">-- Selecione um acessório --</option>
                    {listaAcessorios.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.nome}</option>
                    ))}
                  </select>
                  <button 
                    onClick={vincularAcessorio}
                    disabled={!novoAcessorioId}
                    className="bg-[#336699] hover:bg-[#284B8C] text-white px-5 rounded-lg font-black text-[10px] uppercase tracking-widest transition-colors disabled:opacity-50"
                  >
                    Vincular
                  </button>
                </div>
              </div>

              <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#CBD5E1] pb-2 mb-3">Acessórios Vinculados Atualmente</h4>
              
              <div className="space-y-2">
                {modalAcessorios.gatilhos.length === 0 ? (
                  <p className="text-xs text-center text-[#94A3B8] py-4 bg-white border border-dashed border-[#CBD5E1] rounded-lg">Nenhum acessório vinculado a este item.</p>
                ) : (
                  modalAcessorios.gatilhos.map(g => (
                    <div key={g.id} className="flex justify-between items-center bg-white p-3 border border-[#E2E8F0] rounded-lg shadow-sm">
                      <span className="text-sm font-bold text-[#0C1D4D]">{g.acessorio_nome}</span>
                      <button 
                        onClick={() => desvincularAcessorio(g.id)}
                        className="text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-black transition-colors"
                        title="Remover Vínculo"
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