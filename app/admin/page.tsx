"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import logoColorido from '../../app/imgs/logo.png';

// Tipagem do Perfil
interface PerfilUsuario {
  nome: string;
  email: string;
  permissao: string;
}

// Estrutura inteligente dos módulos do sistema
const MODULOS_SISTEMA = [
  {
    titulo: 'Aprovação Financeira (OP)',
    descricao: 'Painel geral para aprovação, baixa e conferência de todas as Ordens de Pagamento.',
    icone: '💰',
    link: '/admin/op/financeiro',
    permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO'],
    cor: 'border-green-500/50 hover:border-green-500'
  },
  {
    titulo: 'Minhas OPs',
    descricao: 'Acompanhe o status ou edite as Ordens de Pagamento solicitadas por você.',
    icone: '📋',
    link: '/admin/op/responsavel',
    permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO', 'ADMINISTRATIVO', 'OPERACIONAL', 'ESTOQUE'],
    cor: 'border-[#336699]/50 hover:border-[#336699]'
  },
  {
    titulo: 'Solicitar Nova OP',
    descricao: 'Preencha o formulário para enviar um pagamento para análise da diretoria.',
    icone: '➕',
    link: '/admin/op/nova',
    permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO', 'ADMINISTRATIVO', 'OPERACIONAL', 'ESTOQUE'],
    cor: 'border-[#336699]/50 hover:border-[#336699]'
  },
  {
    titulo: 'Gestão de Acessos',
    descricao: 'Controle de usuários, bloqueios e alteração de níveis de permissão da equipe.',
    icone: '🔐',
    link: '/admin/permissoes',
    permissoes_permitidas: ['ADMINISTRADOR'],
    cor: 'border-purple-500/50 hover:border-purple-500'
  },
  {
    titulo: 'Controle de Estoque',
    descricao: 'Gestão de entrada, saída e manutenção de equipamentos (Módulo em Breve).',
    icone: '📦',
    link: '#',
    permissoes_permitidas: ['ADMINISTRADOR', 'ESTOQUE'],
    cor: 'border-amber-500/50 hover:border-amber-500'
  }
];

export default function HubAdministrativo() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const carregarAcesso = async () => {
      // 1. Pega a sessão atual do cofre do Supabase
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }

      // 2. Busca o perfil do usuário na tabela pública
      const { data: userProfile, error } = await supabase
        .from('perfis_usuarios')
        .select('nome, email, permissao')
        .eq('id', session.user.id)
        .single();

      if (userProfile && !error) {
        setPerfil(userProfile);
      } else {
        console.error("Perfil não encontrado no banco de dados.");
      }
      setLoading(false);
    };

    carregarAcesso();
  }, [router]);

  // Função para deslogar
  const handleSair = async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Carregando permissões...</h2>
        </div>
      </div>
    );
  }

  if (!perfil) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Perfil não localizado</h2>
          <p className="text-[#64748B] text-sm mb-6">Sua conta de autenticação existe, mas seu perfil de permissões não foi encontrado no banco de dados. Contate o Administrador.</p>
          <button onClick={handleSair} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors w-full">
            Voltar para Login
          </button>
        </div>
      </div>
    );
  }

  // Filtra os módulos que este usuário tem permissão para ver
  const modulosAutorizados = MODULOS_SISTEMA.filter(modulo => 
    modulo.permissoes_permitidas.includes(perfil.permissao)
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pb-10">
      
      {/* HEADER DA PLATAFORMA */}
      <header className="bg-[#0C1D4D] text-white p-4 md:px-8 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-4">
          <Image src={logoColorido} alt="Rentech" width={140} height={40} className="brightness-0 invert hover:scale-105 transition-transform" />
          <h2 className="text-xs font-black tracking-widest uppercase hidden md:block border-l-2 border-[#284B8C] pl-4">Hub Operacional</h2>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden sm:block text-right">
            <strong className="block text-[11px] font-black uppercase tracking-wider leading-tight">{perfil.nome}</strong>
            <span className="text-[9px] text-[#94A3B8] font-bold tracking-widest uppercase">{perfil.permissao}</span>
          </div>
          <div className="w-px h-8 bg-[#284B8C] hidden sm:block"></div>
          <button onClick={handleSair} className="text-[10px] font-black uppercase tracking-wider text-red-400 hover:text-white bg-white/5 hover:bg-red-500/20 border border-white/10 px-4 py-2 rounded-lg transition-colors">
            SAIR
          </button>
        </div>
      </header>

      {/* BOAS VINDAS */}
      <div className="container mx-auto px-4 mt-10 mb-8 max-w-6xl">
        <h1 className="text-3xl md:text-4xl font-black text-[#0C1D4D] tracking-tight mb-2">
          Bem-vindo ao Ecossistema, <span className="text-[#336699]">{perfil.nome.split(' ')[0]}</span>.
        </h1>
        <p className="text-[#64748B] font-medium text-sm md:text-base">
          Selecione abaixo o módulo que deseja acessar. Suas ferramentas foram liberadas conforme o seu nível de acesso.
        </p>
      </div>

      {/* GRID DE MÓDULOS (CARDS) */}
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {modulosAutorizados.map((modulo, index) => (
            <Link 
              href={modulo.link} 
              key={index}
              className={`bg-white p-6 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border-2 border-transparent ${modulo.cor} group relative overflow-hidden`}
            >
              {/* Efeito de brilho de fundo no hover */}
              <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-gradient-to-bl from-current to-transparent opacity-5 rounded-full group-hover:scale-150 transition-transform duration-500 pointer-events-none"></div>

              <div className="text-4xl mb-4">{modulo.icone}</div>
              <h3 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-2">
                {modulo.titulo}
              </h3>
              <p className="text-[#64748B] text-sm font-medium leading-relaxed mb-6">
                {modulo.descricao}
              </p>
              
              <div className="flex items-center text-[10px] font-black uppercase tracking-widest text-[#336699] group-hover:text-[#0C1D4D] transition-colors">
                Acessar Módulo <span className="ml-2 group-hover:translate-x-1 transition-transform">➔</span>
              </div>
            </Link>
          ))}

        </div>
      </div>

    </div>
  );
}