"use client";

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import logoColorido from '../../../app/imgs/logo.png';

export default function PortalPagamentos() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  // Simulação do sistema de Login antigo.
  // Em produção, isso chamará o Supabase Auth (ex: supabase.auth.signInWithPassword)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErro('');

    // Lógica provisória baseada no seu script anterior para direcionamento
    setTimeout(() => {
      if (email === 'admin@rentech.com.br' || email === 'financeiro@locadorarentech.com.br') {
        // Direciona para o Painel Completo do Financeiro
        router.push('/admin/op/financeiro');
      } else if (email) {
        // Direciona para o Painel Restrito do Responsável
        router.push('/admin/op/responsavel');
      } else {
        setErro('Preencha os dados de acesso.');
        setLoading(false);
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 font-sans">
      
      <div className="bg-white p-8 md:p-10 rounded-2xl shadow-xl w-full max-w-md text-center border border-[#E2E8F0] transform transition-all">
        
        {/* Cabeçalho / Logo */}
        <div className="flex justify-center mb-8">
          <Image 
            src={logoColorido} 
            alt="Rentech Locadora" 
            width={200} 
            height={60} 
            priority
            className="hover:scale-105 transition-transform duration-300"
          />
        </div>

        <div className="mb-8">
          <h1 className="text-xl font-black text-[#0A2A4A] uppercase tracking-wide">Portal Administrativo</h1>
          <p className="text-sm text-[#64748B] font-medium mt-1">Gestão de Ordens de Pagamento</p>
        </div>

        {/* Área Pública - Criar Nova OP */}
        <div className="mb-8 pb-8 border-b-2 border-dashed border-[#E2E8F0]">
          <Link 
            href="/admin/op/nova" 
            className="block w-full bg-green-600 text-white font-black uppercase tracking-widest text-sm py-4 rounded-xl hover:bg-green-500 hover:shadow-[0_0_20px_rgba(22,163,74,0.3)] transition-all"
          >
            ➕ Cadastrar Nova OP
          </Link>
          <p className="text-[10px] text-[#94A3B8] mt-3 font-semibold uppercase">
            Acesso livre para líderes e responsáveis de equipe.
          </p>
        </div>

        {/* Área Restrita - Login */}
        <div>
          <h3 className="text-xs font-bold text-[#0A2A4A] uppercase tracking-widest mb-4">
            Acesso Restrito (Financeiro)
          </h3>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input 
                type="email" 
                placeholder="E-mail Corporativo" 
                className="w-full p-3.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] focus:border-[#0C1D4D] outline-none font-semibold transition-colors"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <input 
                type="password" 
                placeholder="Senha de Acesso" 
                className="w-full p-3.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] focus:border-[#0C1D4D] outline-none font-semibold transition-colors"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>

            {erro && (
              <p className="text-xs text-red-500 font-bold bg-red-50 p-2 rounded-md">{erro}</p>
            )}

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-sm py-3.5 rounded-xl hover:bg-[#284B8C] transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? 'Autenticando...' : 'Entrar no Sistema'}
            </button>
          </form>
        </div>

      </div>

    </div>
  );
}