"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { Analytics } from "@vercel/analytics/next";

// Tipagem do Perfil
interface PerfilUsuario {
  nome: string;
  email: string;
  permissao: string;
  permissaoNormalizada?: string;
}

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES CORRIGIDO
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();

  // 1. ADMINISTRATIVO deve vir ANTES de ADMIN para evitar a colisão de texto
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  
  // 2. ALTA GESTÃO (Acesso Total)
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  
  // 3. DEMAIS DEPARTAMENTOS
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  
  // PADRÃO
  return 'USUARIO'; 
};

// Estrutura dos módulos do sistema. As permissões de cada um NÃO ficam mais
// aqui — vêm da tabela folha_paginas_permissoes (gerida em /admin/permissoes),
// buscadas pelo campo "link" (= endereco_route). Isso mantém o hub sempre em
// sincronia com o que a própria página de destino já exige para entrar.
const MODULOS_SISTEMA = [
  {
    titulo: 'Ordens de Pagamentos',
    descricao: 'Acompanhe o status ou edite as Ordens de Pagamento solicitadas por você.',
    icone: '📋',
    link: '/admin/op',
    cor: 'border-[#336699]/50 hover:border-[#336699]',
    bgIcon: 'bg-blue-50 text-[#336699]'
  }, 
  {
    titulo: 'RH',
    descricao: 'Importe os registros do relógio, calcule horas extras e gere espelhos de jornada.',
    icone: '🫀​',
    link: '/admin/rh',
    cor: 'border-rose-500/50 hover:border-rose-500',
    bgIcon: 'bg-rose-50 text-rose-600'
  },
  {
    titulo: 'Comercial',
    descricao: 'Gerencie documentos, oportunidades, leads e relacionamento com clientes.',
    icone: '🤝',
    link: '/admin/comercial',
    cor: 'border-slate-500/50 hover:border-slate-500',
    bgIcon: 'bg-slate-50 text-slate-600'
  },
  {
    titulo: 'Operacional',
    descricao: 'Controle de estoque e cadastros de equipamentos, acessórios, veículos e afins.',
    icone: '👷‍♂️',
    link: '/admin/operacional',
    cor: 'border-slate-500/50 hover:border-slate-500',
    bgIcon: 'bg-slate-50 text-slate-600'
  },
  {
    titulo: 'Banco de Talentos',
    descricao: 'Acesso à lista de colaboradores Freelance, especialidades e chaves PIX.',
    icone: '👷',
    link: '/admin/freelance',
    cor: 'border-blue-500/50 hover:border-blue-500',
    bgIcon: 'bg-blue-50 text-blue-600'
  },
  {
    titulo: 'Portal de Downloads',
    descricao: 'Faça upload e gerencie os arquivos, softwares e manuais públicos da Rentech.',
    icone: '📁',
    link: '/admin/downloads',
    cor: 'border-cyan-500/50 hover:border-cyan-500',
    bgIcon: 'bg-cyan-50 text-cyan-600'
  },
  {
    titulo: 'Conteúdo Site',
    descricao: 'Gerencie os textos principais, vídeos e canais de contato da página inicial em tempo real.',
    icone: '🌐',
    link: '/admin/conteudo',
    cor: 'border-[#336699]/50 hover:border-[#336699]',
    bgIcon: 'bg-blue-50 text-[#336699]'
  },
  {
    titulo: 'Agendamentos e Disparos',
    descricao: 'Gestão de agendas, lembretes e rotinas diárias para os colaboradores.',
    icone: '⏰',
    link: '/admin/agendamentos',
    cor: 'border-purple-500/50 hover:border-purple-500',
    bgIcon: 'bg-purple-50 text-purple-600'
  },
  {
    titulo: 'Integrações',
    descricao: 'Bancos e parceiros para pagamentos e envio de informações.',
    icone: '🔗',
    link: '/admin/integracao',
    cor: 'border-blue-500/50 hover:border-blue-500',
    bgIcon: 'bg-blue-50 text-blue-600'
  },
  {
    titulo: 'Controle de Acesso',
    descricao: 'Controle de usuários, blocks e alteração de níveis de permissão da equipe.',
    icone: '🔐',
    link: '/admin/permissoes',
    cor: 'border-purple-500/50 hover:border-purple-500',
    bgIcon: 'bg-purple-50 text-purple-600'
  },
  {
    titulo: 'Log de Auditoria',
    descricao: 'Histórico completo de todas as ações realizadas no sistema: acessos, edições e alterações.',
    icone: '🔍',
    link: '/admin/log',
    cor: 'border-slate-500/50 hover:border-slate-500',
    bgIcon: 'bg-slate-50 text-slate-600'
  }
];

export default function HubAdministrativo() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [mapaPermissoes, setMapaPermissoes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const carregarAcesso = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const [perfilRes, permissoesRes] = await Promise.all([
        supabase.from('perfis_usuarios').select('nome, email, permissao').eq('id', session.user.id).single(),
        supabase.from('folha_paginas_permissoes').select('endereco_route, permissoes_permitidas')
          .in('endereco_route', MODULOS_SISTEMA.map(m => m.link))
      ]);

      if (permissoesRes.error) {
        console.error("Erro ao buscar permissões das rotas:", permissoesRes.error);
      }
      const mapa: Record<string, string[]> = {};
      (permissoesRes.data || []).forEach(r => { mapa[r.endereco_route] = r.permissoes_permitidas || []; });
      setMapaPermissoes(mapa);

      if (perfilRes.data && !perfilRes.error) {
        setPerfil({
          ...perfilRes.data,
          permissaoNormalizada: normalizarPermissao(perfilRes.data.permissao)
        });
      } else {
        console.error("Perfil não encontrado no banco de dados.");
      }
      setLoading(false);
    };

    carregarAcesso();
  }, [router]);

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

  if (!perfil) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 pt-24">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-[#BAE6FD]">
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

  // Permissões vêm do banco (folha_paginas_permissoes), não mais de um array
  // fixo no código. Rota sem linha na tabela = ninguém acessa.
  const modulosAutorizados = MODULOS_SISTEMA.filter(modulo =>
    (mapaPermissoes[modulo.link] || []).includes(perfil.permissaoNormalizada!)
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-24 pb-12">
      <Analytics />
      
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
            <strong className="block text-sm text-[#336699] font-black uppercase tracking-wider" title={`Cargo Registado: ${perfil.permissao}`}>
              {perfil.permissaoNormalizada}
            </strong>
            <Link href="/admin/conta" className="inline-block mt-2 text-[10px] font-black text-[#64748B] hover:text-[#336699] uppercase tracking-widest transition-colors">
              ⚙️ Minha Conta
            </Link>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-6xl">
        {modulosAutorizados.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-dashed border-[#CBD5E1] text-center">
            <span className="text-4xl mb-4 block">🚫</span>
            <h3 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Acesso Restrito</h3>
            <p className="text-[#64748B] text-sm">Você não possui permissão para visualizar nenhum módulo ativo neste momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {modulosAutorizados.map((modulo, index) => (
              <Link 
                href={modulo.link} 
                key={index}
                className={`bg-white p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border-2 border-transparent ${modulo.cor} group relative overflow-hidden`}
              >
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
        )}
      </div>

    </div>
  );
}