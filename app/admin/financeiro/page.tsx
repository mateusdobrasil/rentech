"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../lib/supabase';
import { normalizarPermissao } from '../../lib/permissoes';

// Tipagem do Perfil
interface PerfilUsuario {
  nome: string;
  email: string;
  permissao: string;
  permissaoNormalizada?: string;
}

// Lista de módulos do hub. As permissões de cada um NÃO ficam mais aqui —
// vêm da tabela folha_paginas_permissoes (gerida em /admin/permissoes),
// buscadas pelo campo "link" (= endereco_route). Isso mantém o hub sempre
// em sincronia com o que a própria página de destino já exige para entrar.
//
// Transferidas para cá (antes viviam soltas em /admin/rh e /admin/op):
// Lotes de Pagamento (era "Financeiro" em /admin/rh), Ordens de Pagamento
// (eram /admin/rh/financeiro, /admin/rh/consignado e /admin/op/financeiro).
const modulosFinanceiro = [
  {
    titulo: 'Lotes de Pagamento',
    descricao: 'Lotes de pagamento, OCR de comprovantes e arquivos bancários (CNAB).',
    icone: '💰', link: '/admin/financeiro/rh',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  },
  {
    titulo: 'Ordens de Pagamento',
    descricao: 'Painel geral para aprovação, baixa e conferência de todas as Ordens de Pagamento.',
    icone: '📋', link: '/admin/financeiro/ops',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Crédito Consignado',
    descricao: 'Gestão de Empréstimos Consignados no GOV.BR.',
    icone: '💸', link: '/admin/financeiro/consignado',
    cor: 'bg-purple-50 border-purple-200 text-purple-700', hover: 'hover:border-purple-500'
  },
  {
    titulo: 'Relatórios e Dashboard',
    descricao: 'OPs, Lotes de Pagamento e Consignado consolidados para decisão e auditoria.',
    icone: '📊', link: '/admin/financeiro/relatorios',
    cor: 'bg-indigo-50 border-indigo-200 text-indigo-700', hover: 'hover:border-indigo-500'
  },
  {
    titulo: 'Integração Bancária',
    descricao: 'Consulta direta às APIs dos bancos integrados (Itaú SISPAG) para conciliação.',
    icone: '🔌', link: '/admin/financeiro/integracao',
    cor: 'bg-amber-50 border-amber-200 text-amber-700', hover: 'hover:border-amber-500'
  },
  {
    titulo: 'Contas a Pagar',
    descricao: 'Contas a pagar da locadora sincronizadas direto do PrimeStart (P2S) — em aberto, vencidas e quitadas.',
    icone: '💳', link: '/admin/financeiro/contas-pagar',
    cor: 'bg-rose-50 border-rose-200 text-rose-700', hover: 'hover:border-rose-500'
  }
];

export default function FinanceiroHub() {
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
          .in('endereco_route', modulosFinanceiro.map(m => m.link))
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
  // FILTRO DE SEGURANÇA APLICADO — permissões vêm do banco (folha_paginas_permissoes),
  // não mais de um array fixo no código. Rota sem linha na tabela = ninguém acessa.
  // ==========================================================================
  const modulosAutorizados = modulosFinanceiro.filter(modulo =>
    (mapaPermissoes[modulo.link] || []).includes(perfil.permissaoNormalizada!)
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Financeiro</h1>
          <p className="text-[#64748B] font-medium">Lotes de pagamento, Ordens de Pagamento e Crédito Consignado.</p>
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
