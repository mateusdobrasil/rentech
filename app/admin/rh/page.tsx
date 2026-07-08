"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../lib/supabase';

// Tipagem do Perfil
interface PerfilUsuario {
  nome: string;
  email: string;
  permissao: string;
  permissaoNormalizada?: string;
}

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES
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

export default function RhHub() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [loading, setLoading] = useState(true);

  // Lista de todos os módulos e quem pode aceder a eles
  const modulosRh = [
    {
      titulo: 'Controle de Ponto',
      descricao: 'Importação de registros, cálculo de horas extras e espelhos.',
      icone: '⏱️', link: '/admin/rh/ponto',
      permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO'],
      cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
    },
    {
      titulo: 'Gestão de Holerites',
      descricao: 'Configuração de salários, descontos, bônus e emissão.',
      icone: '💰', link: '/admin/rh/holerite',
      permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO'],
      cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
    },
    {
      titulo: 'Gestão de Assinaturas',
      descricao: 'Gestão de Assinaturas de contratos e documentos.',
      icone: '📃', link: '/admin/rh/assinaturas',
      permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO'],
      cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
    },
    {
      titulo: 'Gestão de Benefícios',
      descricao: 'Transporte, refeição, alimentação e outros benefícios.',
      icone: '🎁', link: '/admin/rh/beneficios',
      permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO'],
      cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
    },
    {
      titulo: 'Gestão de Documentos',
      descricao: 'Gestão de RG, CPF, CTPS, comprovante de residência, contrato, ASO admissional/periódico, CNH, certificados, advertência e outros',
      icone: '📁', link: '/admin/rh/documentos',
      permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO', 'ADMINISTRATIVO'],
      cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
    },
    {
      titulo: 'Parâmetros de Contrato',
      descricao: 'Motor de regras de cálculo (CLT, PJ, Temporário, etc).',
      icone: '⚙️', link: '/admin/rh/parametros',
      permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO'],
      cor: 'bg-purple-50 border-purple-200 text-purple-700', hover: 'hover:border-purple-500'
    },
    {
      titulo: 'Relatórios e Dashboards',
      descricao: 'Relatórios financeiros e analíticos.',
      icone: '📊', link: '/admin/rh/relatorios',
      permissoes_permitidas: ['ADMINISTRADOR', 'FINANCEIRO'],
      cor: 'bg-purple-50 border-purple-200 text-purple-700', hover: 'hover:border-purple-500'
    }
  ];

  useEffect(() => {
    const carregarAcesso = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }

      const { data: userProfile, error } = await supabase
        .from('perfis_usuarios')
        .select('nome, email, permissao')
        .eq('id', session.user.id)
        .single();

      if (userProfile && !error) {
        setPerfil({
          ...userProfile,
          permissaoNormalizada: normalizarPermissao(userProfile.permissao)
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

  // Ecrã de Loading
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

  // Tratamento se o Perfil não existir
  if (!perfil) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 pt-24">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-[#BAE6FD]">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Perfil não localizado</h2>
          <p className="text-[#64748B] text-sm mb-6">A sua conta de autenticação existe, mas o seu perfil de permissões não foi encontrado no banco de dados. Contate o Administrador.</p>
          <button onClick={handleSair} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors w-full">
            Voltar para Login
          </button>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // FILTRO DE SEGURANÇA APLICADO
  // ==========================================================================
  const modulosAutorizados = modulosRh.filter(modulo => 
    modulo.permissoes_permitidas.includes(perfil.permissaoNormalizada!)
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Setor de RH</h1>
          <p className="text-[#64748B] font-medium">Gestão de jornada, folha financeira e regras operacionais.</p>
        </div>
        
        {/* Renderiza APENAS a variável modulosAutorizados */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modulosAutorizados.length === 0 ? (
            <div className="col-span-full p-8 text-center text-gray-500 font-bold uppercase border-2 border-dashed border-gray-300 rounded-xl">
              Você não tem permissão para aceder a nenhum módulo desta área.
            </div>
          ) : (
            modulosAutorizados.map((m) => (
              <button key={m.titulo} onClick={() => router.push(m.link)} className={`text-left p-6 rounded-2xl border-2 transition-all shadow-sm ${m.cor} ${m.hover} group`}>
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">{m.icone}</div>
                <h2 className="text-lg font-black uppercase tracking-wider mb-2">{m.titulo}</h2>
                <p className="text-xs font-medium opacity-80">{m.descricao}</p>
              </button>
            ))
          )}
        </div>
        
        <div className="mt-12 text-center pb-12">
          <button onClick={() => router.push('/admin')} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors">
            ⬅ Voltar ao Painel Administrativo Geral
          </button>
        </div>
      </div>
    </div>
  );
}