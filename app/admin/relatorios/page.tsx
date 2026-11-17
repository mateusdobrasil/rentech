"use client";

import { Analytics } from "@vercel/analytics/next";
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';

// HUB Relatórios (2026-11-17). Permissão de cada relatório em
// parametros_paginas_permissoes (campo link = endereco_route), como nos outros hubs.
const modulosRelatorios = [
  {
    titulo: 'Vendas',
    descricao: 'Locações confirmadas por período, vendedor, cliente e evento; ticket médio e comparação com o ano anterior.',
    icone: '💰', link: '/admin/relatorios/vendas',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Orçamentos e Conversão',
    descricao: 'Emitidos × aprovados × perdidos, taxa de conversão por vendedor, prazo até aprovar, motivos de perda e orçamentos em aberto.',
    icone: '🎯', link: '/admin/relatorios/orcamentos',
    cor: 'bg-violet-50 border-violet-200 text-violet-700', hover: 'hover:border-violet-500'
  },
  {
    titulo: 'Financeiro',
    descricao: 'Recebido × pago por mês, a receber e a pagar, inadimplência por idade, maiores devedores e despesas por categoria.',
    icone: '🏦', link: '/admin/relatorios/financeiro',
    cor: 'bg-emerald-50 border-emerald-200 text-emerald-700', hover: 'hover:border-emerald-500'
  },
  {
    titulo: 'Equipamentos e Operação',
    descricao: 'Mais e menos alugados, receita por equipamento e categoria, saídas e devoluções, devoluções atrasadas.',
    icone: '📦', link: '/admin/relatorios/equipamentos',
    cor: 'bg-amber-50 border-amber-200 text-amber-700', hover: 'hover:border-amber-500'
  },
];

export default function RelatoriosHub() {
  const { perfil, loading, modulosAutorizados, erro, tentarNovamente } = useModuleAccess(modulosRelatorios);
  if (loading) return <HubLoading />;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (!perfil) return <HubPerfilNaoLocalizado />;
  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Relatórios</h1>
          <p className="text-[#64748B] font-medium">Vendas, conversão de orçamentos, financeiro e equipamentos — com filtros por período e empresa, Excel e PDF. O histórico do P2S completa os anos anteriores conforme a carga avança.</p>
        </div>
        <ModuleGrid modulos={modulosAutorizados} variant="button-plain" />
        <HubBackButton />
      </div>
    </div>
  );
}
