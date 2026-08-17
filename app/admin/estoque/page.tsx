"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { painelEstoqueAction } from './actions/actions-dashboard';
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';

interface PainelEstoque {
  expedicoesAbertas: number;
}

// Lista de módulos do hub. As permissões de cada um NÃO ficam mais aqui —
// vêm da tabela folha_paginas_permissoes (gerida em /admin/parametros/permissoes),
// buscadas pelo campo "link" (= endereco_route). Isso mantém o hub sempre
// em sincronia com o que a própria página de destino já exige para entrar.
//
// Transferidos para cá (antes viviam soltos em /admin/operacional): Controle
// de Estoque, Produtos e Checklist de Carga (agora "Expedição").
const modulosEstoque = [
  {
    titulo: 'Controle de Estoque',
    descricao: 'Gestão de entrada, saída e manutenção de equipamentos cadastrados.',
    icone: '📦', link: '/admin/estoque/controle',
    cor: 'bg-amber-50 border-amber-200 text-amber-700', hover: 'hover:border-amber-500'
  },
  {
    titulo: 'Expedição',
    descricao: 'Saída e retorno de equipamentos por evento, vinculado às fichas de reserva.',
    icone: '✅', link: '/admin/estoque/expedicao',
    cor: 'bg-teal-50 border-teal-200 text-teal-700', hover: 'hover:border-teal-500'
  },
  {
    titulo: 'Produtos',
    descricao: 'Catálogo de produtos sincronizado direto do PrimeStart (P2S) — todos os atributos, preços por tabela e estoque por local.',
    icone: '📦', link: '/admin/estoque/produtos',
    cor: 'bg-rose-50 border-rose-200 text-rose-700', hover: 'hover:border-rose-500'
  },
  {
    titulo: 'Marcas',
    descricao: 'Marcas dos produtos sincronizados do PrimeStart, agrupadas com a contagem de itens de cada uma.',
    icone: '🏷️', link: '/admin/estoque/marcas',
    cor: 'bg-indigo-50 border-indigo-200 text-indigo-700', hover: 'hover:border-indigo-500'
  }
];

export default function EstoqueHub() {
  const router = useRouter();
  const { perfil, loading, modulosAutorizados, accessToken, erro, tentarNovamente } = useModuleAccess(modulosEstoque);
  const [painel, setPainel] = useState<PainelEstoque | null>(null);
  const [painelLoading, setPainelLoading] = useState(true);

  // Painel de pendências: carrega só depois do perfil liberado, em paralelo
  // com a renderização dos módulos (não bloqueia o hub).
  useEffect(() => {
    if (!perfil) return;
    setPainelLoading(true);
    painelEstoqueAction(accessToken).then(res => {
      if (res.ok) setPainel(res.info);
      setPainelLoading(false);
    });
  }, [perfil, accessToken]);

  if (loading) return <HubLoading />;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (!perfil) return <HubPerfilNaoLocalizado />;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Estoque</h1>
          <p className="text-[#64748B] font-medium">Controle de estoque, expedição, produtos e marcas.</p>
        </div>

        {/* PAINEL DE PENDÊNCIAS — cada cartão só aparece se o usuário tem acesso
            ao módulo correspondente, e leva direto pra lá ao clicar. */}
        {(() => {
          const linksAutorizados = new Set(modulosAutorizados.map(m => m.link));
          const cartoes: { chave: string; titulo: string; icone: string; valor: string; destaque: boolean; link: string; sub?: string }[] = [];

          if (linksAutorizados.has('/admin/estoque/expedicao')) {
            cartoes.push({
              chave: 'expedicoes', titulo: 'Expedições em Aberto', icone: '✅',
              valor: painelLoading ? '—' : `${painel?.expedicoesAbertas ?? 0}`,
              sub: 'aguardando devolução/finalização',
              destaque: (painel?.expedicoesAbertas ?? 0) > 0, link: '/admin/estoque/expedicao'
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

        <ModuleGrid modulos={modulosAutorizados} variant="button-plain" />

        <HubBackButton />
      </div>
    </div>
  );
}
