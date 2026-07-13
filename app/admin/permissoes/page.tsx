"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation'; // <-- CORRIGIDO: Import adicionado
import { supabase } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';
import { Analytics } from "@vercel/analytics/next"; // <-- CORRIGIDO: Barra adicionada

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

// Setores de permissão: antes era uma lista fixa aqui no código, agora vem
// do banco (tabela setores_permissao) e pode ser gerida na aba "Setores".
type NivelPermissao = string;

interface Setor {
  id: number;
  nome: string;
}

interface UsuarioAuth {
  id: string;
  nome: string;
  email: string;
  permissao: NivelPermissao;
  ativo: boolean;
  ultimo_acesso?: string;
}

interface PaginaPermissao {
  id?: number;
  nome_pagina: string;
  endereco_route: string;
  permissoes_permitidas: NivelPermissao[];
}

export default function GestaoPermissoes() {
  const router = useRouter();
  const pathname = usePathname();

  // Estados de Segurança e Autenticação
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [usuarioNome, setUsuarioNome] = useState('Usuário');

  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [abaAtiva, setAbaAtiva] = useState<'usuarios' | 'paginas' | 'setores'>('usuarios');
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [buscaPagina, setBuscaPagina] = useState('');

  // Estados da aba de Usuários
  const [usuarios, setUsuarios] = useState<UsuarioAuth[]>([]);
  const [modalEdicao, setModalEdicao] = useState<{ open: boolean; user: UsuarioAuth | null }>({ open: false, user: null });

  // Estados da aba de Páginas
  const [paginas, setPaginas] = useState<PaginaPermissao[]>([]);
  const formPaginaPadrao: PaginaPermissao = { nome_pagina: '', endereco_route: '', permissoes_permitidas: [] };
  const [formPagina, setFormPagina] = useState<PaginaPermissao>(formPaginaPadrao);
  const [editandoPaginaId, setEditandoPaginaId] = useState<number | null>(null);

  // Estados da aba de Setores
  const [setores, setSetores] = useState<Setor[]>([]);
  const [novoSetor, setNovoSetor] = useState('');
  const [salvandoSetor, setSalvandoSetor] = useState(false);

  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });

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
      setUsuarioNome(perfil.nome || 'Usuário');
      setAuthLoading(false);
      carregarUsuarios();
      carregarPaginas();
      carregarSetores();
    }
    
    checkAuth();
  }, [router, pathname]);

  // ============================================================================
  // OPERAÇÕES: COLABORADORES
  // ============================================================================
  const carregarUsuarios = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('perfis_usuarios').select('*').order('nome');
      if (error) throw error;
      if (data) setUsuarios(data as UsuarioAuth[]);
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao carregar lista de usuários.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const salvarPermissao = async () => {
    if (!modalEdicao.user) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('perfis_usuarios')
        .update({ permissao: modalEdicao.user.permissao, ativo: modalEdicao.user.ativo })
        .eq('id', modalEdicao.user.id);
        
      if (error) throw error;

      const original = usuarios.find(u => u.id === modalEdicao.user!.id);
      const acoes: string[] = [];
      if (original?.permissao !== modalEdicao.user.permissao)
        acoes.push(`PERMISSÃO: ${original?.permissao} → ${modalEdicao.user.permissao}`);
      if (original?.ativo !== modalEdicao.user.ativo)
        acoes.push(modalEdicao.user.ativo ? 'CONTA REATIVADA' : 'CONTA BLOQUEADA');

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'ALTEROU ACESSO DE USUÁRIO',
        setor: 'PERMISSÕES',
        equipamento_id: modalEdicao.user.id,
        equipamento_nome: `${modalEdicao.user.nome} — ${acoes.join(' | ')}`,
      });

      setUsuarios(usuarios.map(u => u.id === modalEdicao.user?.id ? modalEdicao.user : u));
      mostrarFeedback('Permissões atualizadas com sucesso!', 'success');
      setModalEdicao({ open: false, user: null });
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao atualizar permissões no banco.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // OPERAÇÕES: PÁGINAS E ROTAS DO SISTEMA
  // ============================================================================
  const carregarPaginas = async () => {
    try {
      const { data, error } = await supabase.from('folha_paginas_permissoes').select('*').order('nome_pagina');
      if (error) throw error;
      if (data) setPaginas(data as PaginaPermissao[]);
    } catch (error) {
      console.error(error);
    }
  };

  const handleCheckboxPage = (perm: NivelPermissao, checked: boolean) => {
    if (checked) {
      setFormPagina(prev => ({ ...prev, permissoes_permitidas: [...prev.permissoes_permitidas, perm] }));
    } else {
      setFormPagina(prev => ({ ...prev, permissoes_permitidas: prev.permissoes_permitidas.filter(p => p !== perm) }));
    }
  };

  const salvarConfigPagina = async () => {
    if (!formPagina.nome_pagina.trim() || !formPagina.endereco_route.trim()) {
      return alert('Nome da página e Endereço (URL) são obrigatórios.');
    }

    setLoading(true);
    try {
      const payload = {
        nome_pagina: formPagina.nome_pagina.toUpperCase().trim(),
        endereco_route: formPagina.endereco_route.toLowerCase().trim(),
        permissoes_permitidas: formPagina.permissoes_permitidas
      };

      let error;
      if (editandoPaginaId) {
        const { error: err } = await supabase.from('folha_paginas_permissoes').update(payload).eq('id', editandoPaginaId);
        error = err;
      } else {
        const { error: err } = await supabase.from('folha_paginas_permissoes').insert([payload]);
        error = err;
      }

      if (error) {
        if (error.code === '23505') throw new Error('Já existe uma página mapeada para este endereço (URL).');
        throw error;
      }

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: editandoPaginaId ? 'ATUALIZOU PERMISSÃO DE ROTA' : 'CADASTROU ROTA DE SISTEMA',
        setor: 'PERMISSÕES',
        equipamento_nome: `${payload.nome_pagina} → [${payload.permissoes_permitidas.join(', ')}]`,
      });

      mostrarFeedback(editandoPaginaId ? 'Rota atualizada com sucesso!' : 'Nova rota mapeada com sucesso!', 'success');
      setFormPagina(formPaginaPadrao);
      setEditandoPaginaId(null);
      carregarPaginas();
    } catch (error: any) {
      alert(error.message || 'Erro ao salvar parametrização da página.');
    } finally {
      setLoading(false);
    }
  };

  const prepararEdicaoPagina = (p: PaginaPermissao) => {
    setFormPagina(p);
    setEditandoPaginaId(p.id || null);
  };

  const deletarMapeamentoPagina = async (id: number, nome: string) => {
    if (!confirm(`Remover as regras de acesso da página "${nome}"? Colaboradores comuns poderão acessar a rota diretamente se ela não estiver no banco.`)) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.from('folha_paginas_permissoes').delete().eq('id', id);
      if (error) throw error;
      
      mostrarFeedback('Mapeamento de rota removido.', 'success');
      if (editandoPaginaId === id) { setFormPagina(formPaginaPadrao); setEditandoPaginaId(null); }
      carregarPaginas();
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao remover rota.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // OPERAÇÕES: SETORES DE PERMISSÃO
  // ============================================================================
  const carregarSetores = async () => {
    try {
      const { data, error } = await supabase.from('setores_permissao').select('*').order('nome');
      if (error) throw error;
      if (data) setSetores(data as Setor[]);
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao carregar setores de permissão.', 'error');
    }
  };

  const adicionarSetor = async () => {
    const nome = novoSetor.toUpperCase().trim();
    if (!nome) return;

    setSalvandoSetor(true);
    try {
      const { error } = await supabase.from('setores_permissao').insert([{ nome }]);
      if (error) {
        if (error.code === '23505') throw new Error('Esse setor já está cadastrado.');
        throw error;
      }

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'CADASTROU SETOR DE PERMISSÃO',
        setor: 'PERMISSÕES',
        equipamento_nome: nome,
      });

      setNovoSetor('');
      mostrarFeedback('Setor cadastrado com sucesso!', 'success');
      carregarSetores();
    } catch (error: any) {
      mostrarFeedback(error.message || 'Erro ao cadastrar setor.', 'error');
    } finally {
      setSalvandoSetor(false);
    }
  };

  const removerSetor = async (setor: Setor) => {
    const paginasComUso = paginas.filter(p => p.permissoes_permitidas.includes(setor.nome)).length;
    const usuariosComUso = usuarios.filter(u => u.permissao === setor.nome).length;

    const aviso = (paginasComUso > 0 || usuariosComUso > 0)
      ? ` Atenção: este setor está em uso em ${paginasComUso} página(s) e ${usuariosComUso} colaborador(es) — eles não serão alterados, mas o setor deixará de aparecer nas opções.`
      : '';

    if (!confirm(`Remover o setor "${setor.nome}"?${aviso}`)) return;

    try {
      const { error } = await supabase.from('setores_permissao').delete().eq('id', setor.id);
      if (error) throw error;

      registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'REMOVEU SETOR DE PERMISSÃO',
        setor: 'PERMISSÕES',
        equipamento_nome: setor.nome,
      });

      mostrarFeedback('Setor removido.', 'success');
      carregarSetores();
    } catch (error) {
      console.error(error);
      mostrarFeedback('Erro ao remover setor.', 'error');
    }
  };

  // ============================================================================
  // FILTROS E AUXILIARES
  // ============================================================================
  const mostrarFeedback = (msg: string, type: 'success' | 'error') => {
    setFeedback({ show: true, msg, type });
    setTimeout(() => setFeedback({ show: false, msg: '', type: 'success' }), 3000);
  };

  const usuariosFiltrados = useMemo(() => {
    return usuarios
      .filter(u =>
        u.nome.toLowerCase().includes(busca.toLowerCase()) ||
        u.email.toLowerCase().includes(busca.toLowerCase()) ||
        u.permissao.toLowerCase().includes(busca.toLowerCase())
      )
      .sort((a, b) => Number(b.ativo) - Number(a.ativo));
  }, [usuarios, busca]);

  const paginasFiltradas = useMemo(() => {
    return paginas.filter(p => 
      p.nome_pagina.toLowerCase().includes(buscaPagina.toLowerCase()) ||
      p.endereco_route.toLowerCase().includes(buscaPagina.toLowerCase())
    );
  }, [paginas, buscaPagina]);

  const getBadgeColor = (permissao: NivelPermissao) => {
    switch(permissao) {
      case 'ADMINISTRADOR': return 'bg-purple-100 text-purple-700 border-purple-300';
      case 'FINANCEIRO': return 'bg-green-100 text-green-700 border-green-300';
      case 'ESTOQUE': return 'bg-amber-100 text-amber-700 border-amber-300';
      case 'ADMINISTRATIVO': return 'bg-blue-100 text-blue-700 border-blue-300';
      case 'OPERACIONAL': return 'bg-gray-100 text-gray-700 border-gray-300';
      default: return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Gestão de Acessos e Diretórios.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics/>

      {/* CABEÇALHO GLOBAL */}
      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Gestão de Acessos e Diretórios</h1>
          <p className="text-sm font-medium text-gray-500">Controle contas de usuários e regras de segurança de páginas dinamicamente.</p>
        </div>
        <Link href="/admin" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-6 py-3 rounded-lg transition-colors uppercase tracking-wider shadow-sm">
          ⬅ Voltar ao Hub
        </Link>
      </div>

      {/* ABA DE SELEÇÃO DE GERENCIAMENTO */}
      <div className="px-4 md:px-8 pb-4 flex-shrink-0">
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm gap-1">
          <button onClick={() => setAbaAtiva('usuarios')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'usuarios' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
            👤 Colaboradores e Contas
          </button>
          <button onClick={() => setAbaAtiva('paginas')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'paginas' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:text-[#336699]'}`}>
            🖥️ Páginas do Sistema
          </button>
          <button onClick={() => setAbaAtiva('setores')} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${abaAtiva === 'setores' ? 'bg-amber-600 text-white shadow-sm' : 'text-[#64748B] hover:text-amber-600'}`}>
            🏷️ Setores de Permissão
          </button>
        </div>
      </div>

      {/* FEEDBACK POPUP */}
      {feedback.show && (
        <div className={`fixed top-6 right-8 px-6 py-3 rounded-lg shadow-xl z-50 font-black text-xs uppercase tracking-wider ${feedback.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {feedback.type === 'success' ? '✅ ' : '❌ '}{feedback.msg}
        </div>
      )}

      {/* ==================================================================== */}
      {/* MÓDULO 1: GERENCIAMENTO DE COLABORADORES */}
      {/* ==================================================================== */}
      {abaAtiva === 'usuarios' && (
        <>
          <div className="px-4 md:px-8 pb-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
            <div className="w-full md:w-1/2">
              <input 
                type="text" 
                placeholder="🔍 Buscar colaborador por nome, e-mail ou setor..." 
                className="w-full p-3.5 border border-gray-300 rounded-xl text-sm font-semibold text-[#0C1D4D] bg-white outline-none focus:border-[#336699] shadow-sm"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <button 
              onClick={() => alert("Crie as novas credenciais primeiro na aba 'Authentication' do painel do Supabase. Assim que o e-mail for registrado, ele constará nesta lista automaticamente para atribuição de perfil.")}
              className="w-full md:w-auto bg-[#336699] text-white px-6 py-3.5 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-[#284B8C] transition-colors shadow-sm text-center"
            >
              ➕ Registrar Novo Usuário
            </button>
          </div>

          <div className="px-4 md:px-8 pb-8 flex-grow overflow-hidden flex flex-col">
            <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-10 border-b border-[#E2E8F0]">
                  <tr className="text-[#64748B] text-[10px] uppercase tracking-widest font-black">
                    <th className="p-4 w-20 text-center">Status</th>
                    <th className="p-4">Colaborador / E-mail</th>
                    <th className="p-4">Nível de Permissão Atribuído</th>
                    <th className="p-4 text-center w-40">Configuração</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-sm">
                  {loading ? (
                    <tr><td colSpan={4} className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Carregando lista de segurança...</td></tr>
                  ) : usuariosFiltrados.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Nenhum registro localizado.</td></tr>
                  ) : (
                    usuariosFiltrados.map((user) => (
                      <tr key={user.id} className={`hover:bg-[#F8FAFC] transition-colors ${!user.ativo ? 'opacity-40 bg-gray-50' : ''}`}>
                        <td className="p-4 text-center">
                          <div className={`w-3 h-3 rounded-full mx-auto ${user.ativo ? 'bg-green-500 shadow-sm' : 'bg-red-500 shadow-sm'}`}></div>
                        </td>
                        <td className="p-4">
                          <strong className="block text-[#0C1D4D] font-black uppercase tracking-tight">{user.nome}</strong>
                          <span className="text-xs text-[#64748B] font-bold">{user.email}</span>
                        </td>
                        <td className="p-4">
                          <span className={`px-3 py-1 border rounded-full text-[10px] font-black tracking-widest ${getBadgeColor(user.permissao)}`}>
                            {user.permissao}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <button onClick={() => setModalEdicao({ open: true, user: { ...user } })} className="bg-white hover:bg-gray-50 border border-gray-300 font-black text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg transition-colors shadow-sm text-[#0C1D4D]">
                            ⚙️ Gerenciar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* MÓDULO 2: DIRETÓRIO DE PÁGINAS E ROTAS PROTEGIDAS */}
      {/* ==================================================================== */}
      {abaAtiva === 'paginas' && (
        <div className="px-4 md:px-8 pb-8 flex-grow flex flex-col lg:flex-row gap-6 overflow-hidden">
          
          {/* Form lateral de inserção/edição */}
          <div className="w-full lg:w-[400px] bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">
                {editandoPaginaId ? 'Editar Página Protegida' : 'Mapear Nova Rota'}
              </h2>
              <p className="text-[11px] text-gray-400 font-bold uppercase mt-0.5">Defina as diretrizes do motor de proteção</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nome Identificador da Página</label>
                <input type="text" placeholder="Ex: CONTROLE DE ESTOQUE" value={formPagina.nome_pagina} onChange={e => setFormPagina({...formPagina, nome_pagina: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-bold uppercase bg-gray-50 text-[#0C1D4D]" />
              </div>
              
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Caminho da Rota / Endereço (URL)</label>
                <input type="text" placeholder="Ex: /admin/estoque" value={formPagina.endereco_route} onChange={e => setFormPagina({...formPagina, endereco_route: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 outline-none focus:border-[#336699]" />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Setores com Acesso Permitido</label>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 max-h-[220px] overflow-y-auto shadow-inner">
                  {setores.length === 0 && (
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Nenhum setor cadastrado. Crie um na aba "Setores de Permissão".</p>
                  )}
                  {setores.map(s => {
                    const incluso = formPagina.permissoes_permitidas.includes(s.nome);
                    return (
                      <label key={s.id} className="flex items-center gap-3 font-bold text-xs text-[#0C1D4D] cursor-pointer hover:bg-gray-200/50 p-1 rounded transition-colors select-none">
                        <input
                          type="checkbox"
                          checked={incluso}
                          onChange={e => handleCheckboxPage(s.nome, e.target.checked)}
                          className="w-4 h-4 accent-[#336699]"
                        />
                        {s.nome}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                {editandoPaginaId && (
                  <button onClick={() => { setFormPagina(formPaginaPadrao); setEditandoPaginaId(null); }} className="bg-gray-100 text-gray-500 font-black text-[10px] uppercase tracking-wider px-4 py-3 rounded-xl hover:bg-gray-200 transition-colors">
                    Limpar
                  </button>
                )}
                {/* <-- CORRIGIDO AQUI --> */}
                <button onClick={salvarConfigPagina} disabled={loading} className="w-full bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-[#284B8C] transition-all shadow-md">
                  {loading ? '...' : editandoPaginaId ? '💾 Gravar Alterações' : '➕ Ativar Proteção de Rota'}
                </button>
              </div>
            </div>
          </div>

          {/* Grid/Tabela de visualização das rotas protegidas */}
          <div className="flex-grow bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col h-full">
            <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <input 
                type="text" 
                placeholder="🔍 Filtrar rotas por endereço ou nome da página..." 
                value={buscaPagina} onChange={e => setBuscaPagina(e.target.value)}
                className="w-full max-w-md p-2 border border-gray-300 rounded-lg text-xs font-semibold outline-none focus:border-[#336699]" 
              />
            </div>
            
            <div className="overflow-auto flex-grow">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] sticky top-0 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                  <tr>
                    <th className="p-4">Página Mapeada / Rota de Endereço</th>
                    <th className="p-4">Setores com Permissão Concedida</th>
                    <th className="p-4 text-center w-48">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-sm font-medium">
                  {paginasFiltradas.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="p-4">
                        <strong className="block text-[#0C1D4D] font-black uppercase tracking-tight">{p.nome_pagina}</strong>
                        <code className="text-xs text-[#336699] font-mono bg-blue-50/70 border border-blue-100 rounded px-1.5 py-0.5 mt-1 inline-block">{p.endereco_route}</code>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1 max-w-[400px]">
                          {p.permissoes_permitidas.map(perm => (
                            <span key={perm} className={`px-2 py-0.5 border rounded-full text-[9px] font-black tracking-wider ${getBadgeColor(perm)}`}>
                              {perm}
                            </span>
                          ))}
                          {p.permissoes_permitidas.length === 0 && (
                            <span className="text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">⛔ BLOQUEIO TOTAL (Sem acessos)</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex justify-center items-center gap-2">
                          <button onClick={() => prepararEdicaoPagina(p)} className="bg-blue-50 border border-blue-200 text-[#0369A1] font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-blue-100 transition-colors">
                            Editar
                          </button>
                          <button onClick={() => deletarMapeamentoPagina(p.id!, p.nome_pagina)} className="bg-red-50 border border-red-200 text-red-600 font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-red-100 transition-colors">
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Nenhuma rota configurada nesta visualização.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* ==================================================================== */}
      {/* MÓDULO 3: SETORES DE PERMISSÃO */}
      {/* ==================================================================== */}
      {abaAtiva === 'setores' && (
        <div className="px-4 md:px-8 pb-8 flex-grow flex flex-col lg:flex-row gap-6 overflow-hidden">

          {/* Form de cadastro de novo setor */}
          <div className="w-full lg:w-[400px] bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] h-fit space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">Novo Setor de Permissão</h2>
              <p className="text-[11px] text-gray-400 font-bold uppercase mt-0.5">Setores aparecem como opção ao configurar colaboradores e páginas</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nome do Setor</label>
                <input
                  type="text"
                  placeholder="Ex: LOGÍSTICA"
                  value={novoSetor}
                  onChange={e => setNovoSetor(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && adicionarSetor()}
                  className="w-full p-2 border border-gray-300 rounded-lg text-xs font-bold uppercase bg-gray-50 text-[#0C1D4D] outline-none focus:border-amber-500"
                />
              </div>
              <button
                onClick={adicionarSetor}
                disabled={salvandoSetor || !novoSetor.trim()}
                className="w-full bg-amber-600 text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-amber-700 transition-all shadow-md disabled:opacity-50"
              >
                {salvandoSetor ? '...' : '➕ Cadastrar Setor'}
              </button>
            </div>
          </div>

          {/* Lista de setores cadastrados */}
          <div className="flex-grow bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col h-full">
            <div className="overflow-auto flex-grow">
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] sticky top-0 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                  <tr>
                    <th className="p-4">Setor</th>
                    <th className="p-4">Em uso</th>
                    <th className="p-4 text-center w-32">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-sm font-medium">
                  {setores.map(s => {
                    const paginasComUso = paginas.filter(p => p.permissoes_permitidas.includes(s.nome)).length;
                    const usuariosComUso = usuarios.filter(u => u.permissao === s.nome).length;
                    return (
                      <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                        <td className="p-4">
                          <span className={`px-3 py-1 border rounded-full text-[10px] font-black tracking-widest ${getBadgeColor(s.nome)}`}>
                            {s.nome}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-gray-500 font-semibold">
                          {paginasComUso} página(s) · {usuariosComUso} colaborador(es)
                        </td>
                        <td className="p-4 text-center">
                          <button onClick={() => removerSetor(s)} className="bg-red-50 border border-red-200 text-red-600 font-bold text-[10px] uppercase px-3 py-1.5 rounded-md hover:bg-red-100 transition-colors">
                            Excluir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {setores.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider text-xs">Nenhum setor cadastrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* MODAL EXISTENTE DE EDIÇÃO DE ACESSO DO COLABORADOR */}
      {modalEdicao.open && modalEdicao.user && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-none">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">Privilégios de Acesso</h3>
              <button onClick={() => setModalEdicao({ open: false, user: null })} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-4 rounded-xl text-center shadow-inner">
                <div className="w-14 h-16 bg-[#336699] text-white rounded-full flex items-center justify-center text-xl font-black mx-auto mb-2">
                  {modalEdicao.user.nome.charAt(0)}
                </div>
                <strong className="block text-base text-[#0C1D4D] font-black uppercase tracking-tight">{modalEdicao.user.nome}</strong>
                <span className="text-xs text-[#64748B] font-bold">{modalEdicao.user.email}</span>
              </div>

              <div>
                <label className="block text-[10px] font-black text-[#64748B] uppercase tracking-widest mb-2">Papel no Ecossistema (Setor)</label>
                <select 
                  className="w-full p-3 bg-white border-2 border-[#CBD5E1] rounded-xl text-sm font-bold text-[#0A2A4A] outline-none focus:border-[#336699] shadow-sm transition-all cursor-pointer"
                  value={modalEdicao.user.permissao}
                  onChange={(e) => setModalEdicao({ ...modalEdicao, user: { ...modalEdicao.user!, permissao: e.target.value as NivelPermissao } })}
                >
                  {setores.map(s => <option key={s.id} value={s.nome}>{s.nome}</option>)}
                </select>
                <p className="text-[10px] text-[#94A3B8] font-bold uppercase mt-2 leading-tight">Este papel definirá quais painéis, simuladores e botões o usuário poderá visualizar.</p>
              </div>

              <div className="flex items-center justify-between bg-gray-50 p-4 border border-gray-200 rounded-xl">
                <div>
                  <strong className="block text-sm text-[#0A2A4A] font-black uppercase tracking-tight">Status da Conta</strong>
                  <span className="text-[10px] text-[#64748B] font-bold uppercase">Bloquear ou liberar acesso</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={modalEdicao.user.ativo}
                    onChange={(e) => setModalEdicao({ ...modalEdicao, user: { ...modalEdicao.user!, ativo: e.target.checked } })}
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500 shadow-inner"></div>
                </label>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex gap-3">
                <button onClick={() => setModalEdicao({ open: false, user: null })} className="flex-1 py-3.5 bg-gray-100 text-gray-500 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-gray-200 transition-colors">Cancelar</button>
                <button onClick={salvarPermissao} disabled={loading} className="flex-1 py-3.5 bg-[#0C1D4D] text-white font-black text-[10px] uppercase tracking-widest rounded-xl shadow-md hover:bg-[#284B8C] transition-colors disabled:opacity-50">{loading ? '...' : 'Salvar Regras'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}