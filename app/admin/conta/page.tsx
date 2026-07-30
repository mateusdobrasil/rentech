"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';
import { Analytics } from "@vercel/analytics/next";

// Página aberta a QUALQUER usuário autenticado — de propósito não checa
// folha_paginas_permissoes (diferente das demais páginas do /admin). Um
// usuário recém-criado, ainda sem nenhum módulo liberado, precisa conseguir
// trocar a senha provisória mesmo assim.
export default function MinhaConta() {
  const router = useRouter();

  const [authLoading, setAuthLoading] = useState(true);
  const [perfil, setPerfil] = useState<{ nome: string; email: string; permissao: string } | null>(null);

  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });

  useEffect(() => {
    async function carregar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const { data } = await supabase
        .from('perfis_usuarios')
        .select('nome, permissao')
        .eq('id', session.user.id)
        .single();

      setPerfil({
        nome: data?.nome || session.user.email || 'Usuário',
        email: session.user.email || '',
        permissao: data?.permissao || '',
      });
      setAuthLoading(false);
    }

    carregar();
  }, [router]);

  const mostrarFeedback = (msg: string, type: 'success' | 'error') => {
    setFeedback({ show: true, msg, type });
    setTimeout(() => setFeedback({ show: false, msg: '', type: 'success' }), 3000);
  };

  const alterarSenha = async () => {
    if (novaSenha.length < 8) {
      return mostrarFeedback('A nova senha precisa ter pelo menos 8 caracteres.', 'error');
    }
    if (novaSenha !== confirmarSenha) {
      return mostrarFeedback('As senhas digitadas não coincidem.', 'error');
    }

    setSalvando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;

      registrarLogAuditoria({
        usuario_nome: perfil?.nome || 'Usuário',
        acao: 'ALTEROU A PRÓPRIA SENHA',
        setor: 'ACESSO',
      });

      mostrarFeedback('Senha alterada com sucesso!', 'success');
      setNovaSenha('');
      setConfirmarSenha('');
    } catch (error: any) {
      mostrarFeedback(error.message || 'Erro ao alterar senha.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Minha Conta</h1>
          <p className="text-sm font-medium text-gray-500">Gerencie seus dados de acesso ao sistema.</p>
        </div>
        <Link href="/admin" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-6 py-3 rounded-lg transition-colors uppercase tracking-wider shadow-sm">
          ⬅ Voltar ao Hub
        </Link>
      </div>

      {feedback.show && (
        <div className={`fixed top-6 right-8 px-6 py-3 rounded-lg shadow-xl z-50 font-black text-xs uppercase tracking-wider ${feedback.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {feedback.type === 'success' ? '✅ ' : '❌ '}{feedback.msg}
        </div>
      )}

      <div className="px-4 md:px-8 pb-8 flex-grow flex justify-center">
        <div className="w-full max-w-lg space-y-6">

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0]">
            <div className="w-14 h-14 bg-[#336699] text-white rounded-full flex items-center justify-center text-xl font-black mx-auto mb-3">
              {perfil?.nome.charAt(0)}
            </div>
            <div className="text-center">
              <strong className="block text-base text-[#0C1D4D] font-black uppercase tracking-tight">{perfil?.nome}</strong>
              <span className="text-xs text-[#64748B] font-bold block">{perfil?.email}</span>
              {perfil?.permissao && (
                <span className="inline-block mt-2 px-3 py-1 border rounded-full text-[10px] font-black tracking-widest bg-blue-100 text-blue-700 border-blue-300">
                  {perfil.permissao}
                </span>
              )}
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">Alterar Senha</h2>
              <p className="text-[11px] text-gray-400 font-bold uppercase mt-0.5">Defina uma nova senha para o seu acesso</p>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nova Senha</label>
              <input
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={novaSenha}
                onChange={e => setNovaSenha(e.target.value)}
                className="w-full p-3 border-2 border-[#CBD5E1] rounded-xl text-sm font-bold bg-gray-50 text-[#0C1D4D] outline-none focus:border-[#336699]"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Confirmar Nova Senha</label>
              <input
                type="password"
                placeholder="Repita a nova senha"
                value={confirmarSenha}
                onChange={e => setConfirmarSenha(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && alterarSenha()}
                className="w-full p-3 border-2 border-[#CBD5E1] rounded-xl text-sm font-bold bg-gray-50 text-[#0C1D4D] outline-none focus:border-[#336699]"
              />
            </div>

            <button
              onClick={alterarSenha}
              disabled={salvando}
              className="w-full bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-[#284B8C] transition-all shadow-md disabled:opacity-50"
            >
              {salvando ? '...' : '🔒 Salvar Nova Senha'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
