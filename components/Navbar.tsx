"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '../app/lib/supabase';
import logoPB from '../app/imgs/logo_pb.png';

export default function Navbar() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);

  useEffect(() => {
    // Se o Supabase não estiver configurado, mantém o estado deslogado e evita chamadas que falhariam.
    if (!isSupabaseConfigured) return;

    // 1. Verifica se já existe uma sessão ativa ao carregar a página
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setIsLoggedIn(!!session);
      } catch {
        setIsLoggedIn(false);
      }
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

  // Trava o scroll do body enquanto o menu mobile estiver aberto
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    // Encerra a sessão no cofre do Supabase
    await supabase.auth.signOut();

    // Destrói o Cookie para o Middleware trancar a rota novamente
    document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';

    // Atualiza o estado da Navbar e joga para a Home
    setIsLoggedIn(false);
    setMenuOpen(false);
    router.push('/');
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setSimOpen(false);
  };

  const simuladores = [
    { href: '/simulador/videowall', label: 'Simulador de LED / VW / TV' },
    { href: '/simulador/tela', label: 'Simulador de Tela' },
    { href: '/simulador/grid', label: 'Simulador de LED em GRID' },
    { href: '/simulador/curvatura', label: 'Simulador de Curvatura' },
  ];

  return (
    <nav className="fixed top-0 left-0 w-full border-b border-[#284B8C]/40 bg-[#0C1D4D]/95 backdrop-blur z-50 print:hidden">
      <div className="container mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">

        {/* Aplicação do Logo Monocromático */}
        <Link href="/" className="flex items-center shrink-0" onClick={closeMenu}>
          <Image
            src={logoPB}
            alt="Rentech Locadora"
            width={160}
            height={60}
            className="h-10 sm:h-12 w-auto object-contain"
            priority
          />
        </Link>

        {/* ===================== NAVEGAÇÃO DESKTOP ===================== */}
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
              {simuladores.map((s, i) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className={`block px-4 py-3 text-xs text-[#B3B3B3] hover:bg-[#284B8C]/30 hover:text-white ${i < simuladores.length - 1 ? 'border-b border-[#284B8C]/30' : ''}`}
                >
                  {s.label}
                </Link>
              ))}
            </div>
          </div>

          <Link href="https://rentech.dashboard.primestart.net/" target="_blank" className="hover:text-[#336699] transition-colors">
            Dashboard P2S
          </Link>

          {/* Link Dinâmico para o Dashboard */}
          <Link href="/admin" className="flex items-center gap-2 text-[#999999] hover:text-white transition-colors border border-[#666666]/30 px-3 py-1.5 rounded-md hover:border-[#336699] bg-black/20">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            {isLoggedIn ? 'Painel Administrativo' : 'Acesso Restrito'}
          </Link>

          {/* Botão de Sair (Aparece apenas quando logado) */}
          {isLoggedIn ? (
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-red-400 hover:text-white transition-colors border border-red-500/30 px-3 py-1.5 rounded-md hover:border-red-500 hover:bg-red-600 bg-red-500/10"
              title="Encerrar Sessão"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
              Sair
            </button>
          ) : (
            <Link href="/#contato" className="bg-[#284B8C] text-white px-6 py-2 rounded-md text-sm font-black hover:bg-[#336699] hover:shadow-lg hover:shadow-[#284B8C]/40 transition-all uppercase tracking-wide">
              Orçamento
            </Link>
          )}
        </div>

        {/* ===================== AÇÕES MOBILE ===================== */}
        <div className="flex items-center gap-2 lg:hidden">
          {!isLoggedIn && (
            <Link
              href="/#contato"
              onClick={closeMenu}
              className="hidden sm:inline-block bg-[#284B8C] text-white px-4 py-2 rounded-md text-xs font-black hover:bg-[#336699] transition-all uppercase tracking-wide"
            >
              Orçamento
            </Link>
          )}

          {/* Botão Hambúrguer animado */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="relative flex h-10 w-10 items-center justify-center rounded-md border border-[#284B8C]/40 bg-black/20 text-white"
            aria-label="Abrir menu"
            aria-expanded={menuOpen}
          >
            <span className="sr-only">Menu</span>
            <div className="relative h-4 w-5">
              <span className={`absolute left-0 block h-0.5 w-5 bg-current transition-all duration-300 ${menuOpen ? 'top-1.5 rotate-45' : 'top-0'}`}></span>
              <span className={`absolute left-0 top-1.5 block h-0.5 w-5 bg-current transition-all duration-300 ${menuOpen ? 'opacity-0' : 'opacity-100'}`}></span>
              <span className={`absolute left-0 block h-0.5 w-5 bg-current transition-all duration-300 ${menuOpen ? 'top-1.5 -rotate-45' : 'top-3'}`}></span>
            </div>
          </button>
        </div>
      </div>

      {/* ===================== OVERLAY + DRAWER MOBILE ===================== */}
      {/* Overlay escuro */}
      <div
        onClick={closeMenu}
        className={`fixed inset-0 top-[65px] bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden ${menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-hidden="true"
      />

      {/* Painel deslizante */}
      <div
        className={`fixed right-0 top-[65px] z-50 h-[calc(100vh-65px)] w-full max-w-xs overflow-y-auto border-l border-[#284B8C]/40 bg-[#0C1D4D] transition-transform duration-300 lg:hidden ${menuOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex flex-col p-5 text-[#B3B3B3]">
          {/* Links públicos */}
          <span className="px-1 pb-2 text-[10px] font-black uppercase tracking-widest text-[#666666]">Navegação</span>
          <Link href="/#especialidades" onClick={closeMenu} className="rounded-md px-3 py-3 text-base font-bold hover:bg-[#284B8C]/30 hover:text-white transition-colors">Especialidades</Link>
          <Link href="/#portfolio" onClick={closeMenu} className="rounded-md px-3 py-3 text-base font-bold hover:bg-[#284B8C]/30 hover:text-white transition-colors">Cases</Link>

          {/* Acordeão de Simuladores */}
          <button
            onClick={() => setSimOpen((v) => !v)}
            className="flex items-center justify-between rounded-md px-3 py-3 text-base font-bold hover:bg-[#284B8C]/30 hover:text-white transition-colors"
            aria-expanded={simOpen}
          >
            Simuladores
            <svg className={`h-4 w-4 transition-transform duration-200 ${simOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${simOpen ? 'max-h-72' : 'max-h-0'}`}>
            <div className="ml-3 flex flex-col border-l border-[#284B8C]/40 pl-2">
              {simuladores.map((s) => (
                <Link key={s.href} href={s.href} onClick={closeMenu} className="rounded-md px-3 py-2.5 text-sm hover:bg-[#284B8C]/30 hover:text-white transition-colors">
                  {s.label}
                </Link>
              ))}
            </div>
          </div>

          <Link href="https://rentech.dashboard.primestart.net/" target="_blank" onClick={closeMenu} className="rounded-md px-3 py-3 text-base font-bold hover:bg-[#284B8C]/30 hover:text-white transition-colors">
            Dashboard P2S
          </Link>

          <div className="my-4 h-px w-full bg-[#284B8C]/40" />

          {/* Acesso restrito / Admin */}
          <Link href="/admin" onClick={closeMenu} className="flex items-center gap-2 rounded-md border border-[#666666]/30 bg-black/20 px-3 py-3 text-sm font-bold text-[#999999] hover:border-[#336699] hover:text-white transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            {isLoggedIn ? 'Painel Administrativo' : 'Acesso Restrito'}
          </Link>

          {/* CTA Orçamento (visível também em telas pequenas) */}
          {!isLoggedIn && (
            <Link href="/#contato" onClick={closeMenu} className="mt-3 rounded-md bg-[#284B8C] px-3 py-3 text-center text-sm font-black uppercase tracking-wide text-white hover:bg-[#336699] transition-colors">
              Solicitar Orçamento
            </Link>
          )}

          {/* Sair */}
          {isLoggedIn && (
            <button
              onClick={handleLogout}
              className="mt-3 flex items-center justify-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm font-bold text-red-400 hover:bg-red-600 hover:text-white transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
              Encerrar Sessão
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
