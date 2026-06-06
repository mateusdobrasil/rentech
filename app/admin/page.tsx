"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { Analytics } from "@vercel/analytics/next"

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
    cor: 'border-green-500/50 hover:border-green-500',
    bgIcon: 'bg-green-50 text-green-600'
  },
  {
    titulo: 'Minhas OPs',
    descricao: 'Acompanhe o status ou edite as Ordens de Pagamento solicitadas por você.',
    icone: '📋',
    link: '/admin/op/responsavel',
    permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO', 'ADMINISTRATIVO', 'OPERACIONAL', 'ESTOQUE'],
    cor: 'border-[#336699]/50 hover:border-[#336699]',
    bgIcon: 'bg-blue-50 text-[#336699]'
  },
  {
    titulo: 'Solicitar Nova OP',
    descricao: 'Preencha o formulário para enviar um pagamento para análise da diretoria.',
    icone: '➕',
    link: '/admin/op/nova',
    permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO', 'ADMINISTRATIVO', 'OPERACIONAL', 'ESTOQUE'],
    cor: 'border-[#336699]/50 hover:border-[#336699]',
    bgIcon: 'bg-blue-50 text-[#336699]'
  },
  {
    titulo: 'Gestão de Acessos',
    descricao: 'Controle de usuários, bloqueios e alteração de níveis de permissão da equipe.',
    icone: '🔐',
    link: '/admin/permissoes',
    permissoes_permitidas: ['ADMINISTRADOR'],
    cor: 'border-purple-500/50 hover:border-purple-500',
    bgIcon: 'bg-purple-50 text-purple-600'
  },
  {
    titulo: 'Controle de Estoque',
    descricao: 'Gestão de entrada, saída e manutenção de equipamentos (Módulo em Breve).',
    icone: '📦',
    link: '#',
    permissoes_permitidas: ['ADMINISTRADOR', 'ESTOQUE'],
    cor: 'border-amber-500/50 hover:border-amber-500',
    bgIcon: 'bg-amber-50 text-amber-600'
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

  // Função para deslogar (Usada apenas como fallback na tela de erro)
  const handleSair = async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-24">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Carregando módulos...</h2>
        </div>
      </div>
    );
  }
  <Analytics/>

  if (!perfil) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 pt-24">
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
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-24 pb-12">
      
      {/* BOAS VINDAS E INFORMAÇÕES DO PERFIL */}
      <div className="container mx-auto px-4 mt-6 mb-10 max-w-6xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-[#E2E8F0] pb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-[#0C1D4D] tracking-tight mb-2">
              Bem-vindo ao Ecossistema, <span className="text-[#336699]">{perfil.nome.split(' ')[0]}</span>.
            </h1>
            <p className="text-[#64748B] font-medium text-sm md:text-base">
              Selecione abaixo o módulo que deseja acessar. Suas ferramentas foram liberadas conforme o seu nível de acesso.
            </p>
          </div>
          
          <div className="bg-white px-5 py-3 rounded-xl shadow-sm border border-[#E2E8F0] text-left md:text-right min-w-[200px]">
            <span className="block text-[10px] text-[#94A3B8] font-bold tracking-widest uppercase mb-1">Seu Nível de Acesso</span>
            <strong className="block text-sm text-[#336699] font-black uppercase tracking-wider">{perfil.permissao}</strong>
          </div>
        </div>
      </div>

      {/* GRID DE MÓDULOS (CARDS) */}
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {modulosAutorizados.map((modulo, index) => (
            <Link 
              href={modulo.link} 
              key={index}
              className={`bg-white p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border-2 border-transparent ${modulo.cor} group relative overflow-hidden`}
            >
              {/* Efeito de brilho de fundo no hover */}
              <div className="absolute top-0 right-0 -mt-6 -mr-6 w-32 h-32 bg-gradient-to-bl from-current to-transparent opacity-[0.03] rounded-full group-hover:scale-150 transition-transform duration-500 pointer-events-none"></div>

              <div className={`w-14 h-14 ${modulo.bgIcon} rounded-xl flex items-center justify-center text-3xl mb-6 shadow-sm`}>
                {modulo.icone}
              </div>
              
              <h3 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-3">
                {modulo.titulo}
              </h3>
              
              <p className="text-[#64748B] text-sm font-medium leading-relaxed mb-8 h-10">
                {modulo.descricao}
              </p>
              
              <div className="flex items-center text-[11px] font-black uppercase tracking-widest text-[#336699] group-hover:text-[#0C1D4D] transition-colors pt-4 border-t border-[#F1F5F9]">
                Acessar Módulo <span className="ml-2 group-hover:translate-x-2 transition-transform">➔</span>
              </div>
            </Link>
          ))}

        </div>
      </div>

    </div>
  );
}