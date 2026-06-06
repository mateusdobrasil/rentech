"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '../app/lib/supabase';
import logoPB from '../app/imgs/logo_pb.png'; 

export default function Navbar() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    // 1. Verifica se já existe uma sessão ativa ao carregar a página
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setIsLoggedIn(!!session);
    };
    checkSession();

    // 2. Escuta mudanças em tempo real (ex: o usuário logou em outra aba)
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setIsLoggedIn(!!session);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    // Encerra a sessão no cofre do Supabase
    await supabase.auth.signOut();
    
    // Destrói o Cookie para o Middleware trancar a rota novamente
    document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    
    // Atualiza o estado da Navbar e joga para a Home
    setIsLoggedIn(false);
    router.push('/');
  };

  return (
    <nav className="fixed top-0 left-0 w-full border-b border-[#0C1D4D] bg-[#0C1D4D]/95 backdrop-blur z-50 print:hidden">
      <div className="container mx-auto px-6 py-4 flex justify-between items-center">
        
        {/* Aplicação do Logo Monocromático */}
        <Link href="/" className="flex items-center">
          <Image 
            src={logoPB} 
            alt="Rentech Locadora" 
            width={160} 
            height={60} 
            className="h-10 w-auto object-contain"
            priority
          />
        </Link>

        {/* Links de Navegação Principal e Ecossistema */}
        <div className="hidden lg:flex items-center space-x-8 text-sm font-bold text-[#B3B3B3]">
          {/* Links Públicos */}
          <Link href="/#especialidades" className="hover:text-[#336699] transition-colors">Especialidades</Link>
          <Link href="/#portfolio" className="hover:text-[#336699] transition-colors">Cases</Link>
          
          {/* Divisor Visual */}
          <div className="w-px h-5 bg-[#284B8C]/50"></div>

          {/* Links do Ecossistema Operacional/Interno */}
          <div className="relative group">
            <Link href="/simulador" className="flex items-center gap-1 hover:text-[#336699] transition-colors">
              Simuladores
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </Link>
            {/* Dropdown de Simuladores */}
            <div className="absolute top-full left-0 mt-4 w-56 bg-[#0C1D4D] border border-[#284B8C] rounded-md shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
              <Link href="/simulador/videowall" className="block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white border-b border-[#284B8C]/30">Simulador de LED / VW / TV</Link>
              <Link href="/simulador/tela" className="block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white border-b border-[#284B8C]/30">Simulador de Tela</Link>
              <Link href="/simulador/grid" className="block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white border-b border-[#284B8C]/30">Simulador de LED em GRID</Link>
              <Link href="/simulador/curvatura" className="block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white">Simulador de Curvatura</Link>
            </div>
          </div>

          {/* Link Dinâmico para o Dashboard */}
          <Link href="/admin/op" className="flex items-center gap-2 text-[#999999] hover:text-white transition-colors border border-[#666666]/30 px-3 py-1.5 rounded-md hover:border-[#336699] bg-black/20">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            {isLoggedIn ? 'Painel Administrativo' : 'Acesso Restrito'}
          </Link>

          {/* Botão de Sair (Aparece apenas quando logado) */}
          {isLoggedIn && (
            <button 
              onClick={handleLogout} 
              className="flex items-center gap-2 text-red-400 hover:text-white transition-colors border border-red-500/30 px-3 py-1.5 rounded-md hover:border-red-500 hover:bg-red-600 bg-red-500/10"
              title="Encerrar Sessão"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
              Sair
            </button>
          )}
        </div>
        
        {/* Botão de Orçamento (Público) */}
        {!isLoggedIn && (
          <Link href="/#contato" className="bg-[#284B8C] text-white px-6 py-2 rounded-md text-sm font-black hover:bg-[#336699] hover:shadow-lg hover:shadow-[#284B8C]/40 transition-all uppercase tracking-wide">
            Orçamento
          </Link>
        )}
      </div>
    </nav>
  );
}