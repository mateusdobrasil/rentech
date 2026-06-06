"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../lib/supabase';

// Definição estrita das permissões do ecossistema Rentech
type NivelPermissao = 'ADMINISTRADOR' | 'ADMINISTRATIVO' | 'FINANCEIRO' | 'ESTOQUE' | 'OPERACIONAL';

const LISTA_PERMISSOES: NivelPermissao[] = [
  'ADMINISTRADOR',
  'ADMINISTRATIVO',
  'FINANCEIRO',
  'ESTOQUE',
  'OPERACIONAL'
];

interface UsuarioAuth {
  id: string;
  nome: string;
  email: string;
  permissao: NivelPermissao;
  ativo: boolean;
  ultimo_acesso?: string;
}

export default function GestaoPermissoes() {
  const [usuarios, setUsuarios] = useState<UsuarioAuth[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  
  const [modalEdicao, setModalEdicao] = useState<{ open: boolean; user: UsuarioAuth | null }>({ open: false, user: null });
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });

  // 1. Carregar lista real de usuários do Supabase
  const carregarUsuarios = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .order('nome');
      
      if (error) throw error;
      
      if (data) {
        setUsuarios(data as UsuarioAuth[]);
      }
    } catch (error) {
      console.error("Erro ao carregar usuários:", error);
      setFeedback({ show: true, msg: 'Erro ao carregar lista de usuários.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarUsuarios();
  }, []);

  // 2. Filtro de Busca Dinâmico
  const usuariosFiltrados = useMemo(() => {
    return usuarios.filter(u => 
      u.nome.toLowerCase().includes(busca.toLowerCase()) || 
      u.email.toLowerCase().includes(busca.toLowerCase()) ||
      u.permissao.toLowerCase().includes(busca.toLowerCase())
    );
  }, [usuarios, busca]);

  // 3. Função Real para Salvar a Alteração de Permissão no Banco
  const salvarPermissao = async () => {
    if (!modalEdicao.user) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('perfis_usuarios')
        .update({ 
          permissao: modalEdicao.user.permissao, 
          ativo: modalEdicao.user.ativo 
        })
        .eq('id', modalEdicao.user.id);
        
      if (error) throw error;
      
      // Atualiza o estado local para refletir a mudança instantaneamente na tabela
      setUsuarios(usuarios.map(u => u.id === modalEdicao.user?.id ? modalEdicao.user : u));
      
      setFeedback({ show: true, msg: 'Permissões atualizadas com sucesso!', type: 'success' });
      setModalEdicao({ open: false, user: null });
      
      setTimeout(() => setFeedback({ show: false, msg: '', type: 'success' }), 3000);
    } catch (error) {
      console.error("Erro ao atualizar permissão:", error);
      setFeedback({ show: true, msg: 'Erro ao atualizar permissões no banco.', type: 'error' });
      setTimeout(() => setFeedback({ show: false, msg: '', type: 'error' }), 3000);
    } finally {
      setLoading(false);
    }
  };

  // Cores dinâmicas para as badges de cada setor
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

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-24">
      
      {/* CABEÇALHO DA PÁGINA (Alinhado com a Navbar global) */}
      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Gestão de Acessos</h1>
          <p className="text-[#64748B] text-sm font-medium">Controle os níveis de permissão da sua equipe.</p>
        </div>
        <Link href="/admin" className="text-xs font-bold bg-[#E2E8F0] text-[#64748B] hover:bg-[#CBD5E1] px-6 py-3 rounded-lg transition-colors uppercase tracking-wider shadow-sm">
          ⬅ Voltar ao Hub
        </Link>
      </div>

      {/* FEEDBACK FLUTUANTE */}
      {feedback.show && (
        <div className={`fixed top-24 right-8 px-6 py-3 rounded-lg shadow-xl z-50 font-bold text-sm uppercase tracking-wider animate-bounce ${feedback.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {feedback.type === 'success' ? '✅ ' : '❌ '}{feedback.msg}
        </div>
      )}

      {/* CONTROLES DA PÁGINA */}
      <div className="px-4 md:px-8 pb-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
        <div className="w-full md:w-1/2 relative">
          <input 
            type="text" 
            placeholder="🔍 Buscar usuário por nome, e-mail ou setor..." 
            className="w-full p-4 pl-12 border-2 border-[#E2E8F0] rounded-xl text-sm font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none shadow-sm"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <button 
          onClick={() => alert("Para registrar novos usuários de forma segura, crie a credencial no Painel Supabase (Authentication > Users) e depois ajuste o nível de permissão aqui.")}
          className="w-full md:w-auto bg-[#336699] text-white px-8 py-4 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-[#284B8C] transition-colors shadow-lg"
        >
          ➕ Registrar Novo Usuário
        </button>
      </div>

      {/* TABELA DE USUÁRIOS */}
      <div className="px-4 md:px-8 pb-8 flex-grow overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-10">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-4 border-b-2 border-[#E2E8F0] w-16 text-center">Status</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Colaborador / E-mail</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Nível de Permissão (Setor)</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] text-center w-32">Configuração</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-sm">
              {loading ? (
                <tr><td colSpan={4} className="text-center py-12 text-[#94A3B8] font-bold">Carregando lista do banco de dados...</td></tr>
              ) : usuariosFiltrados.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-[#94A3B8] font-bold">Nenhum usuário encontrado na busca.</td></tr>
              ) : (
                usuariosFiltrados.map((user) => (
                  <tr key={user.id} className={`hover:bg-[#F8FAFC] transition-colors ${!user.ativo ? 'opacity-50 grayscale' : ''}`}>
                    <td className="p-4 text-center">
                      <div className={`w-3 h-3 rounded-full mx-auto shadow-sm ${user.ativo ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'}`} title={user.ativo ? 'Ativo' : 'Bloqueado'}></div>
                    </td>
                    <td className="p-4">
                      <strong className="block text-[#0C1D4D] font-black uppercase tracking-tight">{user.nome}</strong>
                      <span className="text-xs text-[#64748B] font-semibold">{user.email}</span>
                    </td>
                    <td className="p-4">
                      <span className={`px-3 py-1 border rounded-full text-[10px] font-black tracking-widest ${getBadgeColor(user.permissao)}`}>
                        {user.permissao}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => setModalEdicao({ open: true, user: { ...user } })}
                        className="bg-[#E0F2FE] text-[#0369A1] hover:bg-[#BAE6FD] border border-[#BAE6FD] font-bold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg transition-colors"
                      >
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

      {/* MODAL DE EDIÇÃO DE ACESSO */}
      {modalEdicao.open && modalEdicao.user && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">Privilégios de Acesso</h3>
              <button onClick={() => setModalEdicao({ open: false, user: null })} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 space-y-6">
              
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-4 rounded-xl text-center">
                <div className="w-16 h-16 bg-[#336699] text-white rounded-full flex items-center justify-center text-2xl font-black mx-auto mb-2 shadow-inner">
                  {modalEdicao.user.nome.charAt(0)}
                </div>
                <strong className="block text-lg text-[#0C1D4D] font-black uppercase tracking-tight">{modalEdicao.user.nome}</strong>
                <span className="text-xs text-[#64748B] font-semibold">{modalEdicao.user.email}</span>
              </div>

              <div>
                <label className="block text-[10px] font-black text-[#64748B] uppercase tracking-widest mb-2">
                  Papel no Ecossistema (Setor)
                </label>
                <select 
                  className="w-full p-3 bg-white border-2 border-[#CBD5E1] rounded-xl text-sm font-bold text-[#0A2A4A] outline-none focus:border-[#336699] shadow-sm transition-all"
                  value={modalEdicao.user.permissao}
                  onChange={(e) => setModalEdicao({ ...modalEdicao, user: { ...modalEdicao.user!, permissao: e.target.value as NivelPermissao } })}
                >
                  {LISTA_PERMISSOES.map(perm => (
                    <option key={perm} value={perm}>{perm}</option>
                  ))}
                </select>
                <p className="text-[10px] text-[#94A3B8] font-medium mt-2 leading-tight">
                  Este papel definirá quais painéis, simuladores e botões o usuário poderá visualizar.
                </p>
              </div>

              <div className="flex items-center justify-between bg-gray-50 p-4 border border-gray-200 rounded-xl">
                <div>
                  <strong className="block text-sm text-[#0A2A4A] font-black uppercase tracking-tight">Status da Conta</strong>
                  <span className="text-[10px] text-[#64748B] font-semibold">Bloquear ou liberar acesso</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={modalEdicao.user.ativo}
                    onChange={(e) => setModalEdicao({ ...modalEdicao, user: { ...modalEdicao.user!, ativo: e.target.checked } })}
                  />
                  <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                </label>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex gap-3">
                <button 
                  onClick={() => setModalEdicao({ open: false, user: null })}
                  className="flex-1 py-3.5 bg-[#F0F4F8] text-[#64748B] font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-[#E2E8F0] transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={salvarPermissao}
                  disabled={loading}
                  className="flex-1 py-3.5 bg-[#336699] text-white font-black text-[10px] uppercase tracking-widest rounded-xl shadow-lg hover:bg-[#284B8C] transition-colors disabled:opacity-50"
                >
                  {loading ? 'Salvando...' : 'Salvar Regras'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}