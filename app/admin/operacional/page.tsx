"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../lib/supabase';
import { painelOperacionalAction } from './actions/actions-dashboard';

// Tipagem do Perfil
interface PerfilUsuario {
  nome: string;
  email: string;
  permissao: string;
  permissaoNormalizada?: string;
}

interface PainelOperacional {
  documentosVencidos: number;
  documentosVencendo: number;
  checklistsCargaAbertos: number;
  checklistsVeiculosAbertos: number;
  folgasPendentes: number;
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
  if (p.includes('GESTOR')) return 'GESTORES';

  // PADRÃO
  return 'USUARIO';
};

// Lista de módulos do hub. As permissões de cada um NÃO ficam mais aqui —
// vêm da tabela folha_paginas_permissoes (gerida em /admin/permissoes),
// buscadas pelo campo "link" (= endereco_route). Isso mantém o hub sempre
// em sincronia com o que a própria página de destino já exige para entrar.
const modulosOperacional = [
  {
    titulo: 'Controle de Estoque',
    descricao: 'Gestão de entrada, saída e manutenção de equipamentos cadastrados.',
    icone: '📦', link: '/admin/operacional/estoque',
    cor: 'bg-amber-50 border-amber-200 text-amber-700', hover: 'hover:border-amber-500'
  },
  {
    titulo: 'Controle de Frota',
    descricao: 'Ficha dos veículos, documentos, seguros, vencimentos e manutenções.',
    icone: '🚚', link: '/admin/operacional/frota',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Relatórios Operacionais',
    descricao: 'Relatório completo da frota e controle de estoque, com indicadores e gráficos.',
    icone: '📊', link: '/admin/operacional/relatorios',
    cor: 'bg-indigo-50 border-indigo-200 text-indigo-700', hover: 'hover:border-indigo-500'
  },
  {
    titulo: 'Checklist de Carga',
    descricao: 'Checklist de saída e devolução de equipamentos por evento, vinculado às fichas de reserva.',
    icone: '✅', link: '/admin/operacional/checklist',
    cor: 'bg-teal-50 border-teal-200 text-teal-700', hover: 'hover:border-teal-500'
  },
  {
    titulo: 'Registro de Ponto',
    descricao: 'Consulta (somente leitura) se cada colaborador já registrou o ponto do dia.',
    icone: '🕒', link: '/admin/operacional/registro-ponto',
    cor: 'bg-sky-50 border-sky-200 text-sky-700', hover: 'hover:border-sky-500'
  },
  {
    titulo: 'Produtos',
    descricao: 'Catálogo de produtos sincronizado direto do PrimeStart (P2S) — todos os atributos, preços por tabela e estoque por local.',
    icone: '📦', link: '/admin/operacional/produtos',
    cor: 'bg-rose-50 border-rose-200 text-rose-700', hover: 'hover:border-rose-500'
  }
];

export default function OperacionalHub() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [mapaPermissoes, setMapaPermissoes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [painel, setPainel] = useState<PainelOperacional | null>(null);
  const [painelLoading, setPainelLoading] = useState(true);

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
          .in('endereco_route', modulosOperacional.map(m => m.link))
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

  // Painel de pendências: carrega só depois do perfil liberado, em paralelo
  // com a renderização dos módulos (não bloqueia o hub).
  useEffect(() => {
    if (!perfil) return;
    setPainelLoading(true);
    painelOperacionalAction().then(res => {
      if (res.ok) setPainel(res.info);
      setPainelLoading(false);
    });
  }, [perfil]);

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
  const modulosAutorizados = modulosOperacional.filter(modulo =>
    (mapaPermissoes[modulo.link] || []).includes(perfil.permissaoNormalizada!)
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Setor Operacional</h1>
          <p className="text-[#64748B] font-medium">Controles e cadastros de equipamentos, acessórios, veículos e afins.</p>
        </div>

        {/* PAINEL DE PENDÊNCIAS — cada cartão só aparece se o usuário tem acesso
            ao módulo correspondente, e leva direto pra lá ao clicar. */}
        {(() => {
          const linksAutorizados = new Set(modulosAutorizados.map(m => m.link));
          const cartoes: { chave: string; titulo: string; icone: string; valor: string; destaque: boolean; link: string; sub?: string }[] = [];

          if (linksAutorizados.has('/admin/operacional/frota')) {
            const vencidos = painel?.documentosVencidos ?? 0;
            const vencendo = painel?.documentosVencendo ?? 0;
            cartoes.push({
              chave: 'documentos', titulo: 'Documentos da Frota', icone: '📁',
              valor: painelLoading ? '—' : `${vencidos}`,
              sub: painelLoading ? 'carregando...' : `${vencidos} vencido(s) · ${vencendo} a vencer (30d)`,
              destaque: vencidos > 0, link: '/admin/operacional/frota'
            });
            cartoes.push({
              chave: 'checklist_veiculos', titulo: 'Checklist de Veículos', icone: '🚚',
              valor: painelLoading ? '—' : `${painel?.checklistsVeiculosAbertos ?? 0}`,
              sub: 'em rota (saída sem retorno)',
              destaque: false, link: '/admin/operacional/frota'
            });
          }
          if (linksAutorizados.has('/admin/operacional/checklist')) {
            cartoes.push({
              chave: 'checklist_carga', titulo: 'Checklist de Carga', icone: '✅',
              valor: painelLoading ? '—' : `${painel?.checklistsCargaAbertos ?? 0}`,
              sub: 'aguardando devolução/finalização',
              destaque: (painel?.checklistsCargaAbertos ?? 0) > 0, link: '/admin/operacional/checklist'
            });
          }
          if (linksAutorizados.has('/admin/operacional/registro-ponto')) {
            cartoes.push({
              chave: 'folgas', titulo: 'Solicitações de Folga', icone: '🏖️',
              valor: painelLoading ? '—' : `${painel?.folgasPendentes ?? 0}`,
              sub: 'pendentes via WhatsApp',
              destaque: (painel?.folgasPendentes ?? 0) > 0, link: '/admin/operacional/registro-ponto'
            });
          }

          if (cartoes.length === 0) return null;

          return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
              {cartoes.map(c => (
                <button
                  key={c.chave}
                  onClick={() => router.push(c.link)}
                  className={`text-left bg-white p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all ${c.destaque ? 'border-red-200 hover:border-red-400' : 'border-[#E2E8F0] hover:border-[#336699]'}`}
                >
                  <div className="text-lg mb-1">{c.icone}</div>
                  <p className={`text-2xl font-black leading-tight ${c.destaque ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{c.valor}</p>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider leading-tight mt-1">{c.titulo}</p>
                  {c.sub && <p className="text-[9px] text-gray-400 font-medium mt-1 truncate">{c.sub}</p>}
                </button>
              ))}
            </div>
          );
        })()}

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
