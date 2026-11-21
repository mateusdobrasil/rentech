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
  },  {
    titulo: 'Clientes (Curva ABC)',
    descricao: 'Ranking por receita (classes A, B e C), ticket, clientes novos, recompra e quem parou de alugar.',
    icone: '👥', link: '/admin/relatorios/clientes',
    cor: 'bg-sky-50 border-sky-200 text-sky-700', hover: 'hover:border-sky-500'
  },
  {
    titulo: 'Eventos e Feiras',
    descricao: 'Receita, OS e clientes por evento, comparando com a edição anterior.',
    icone: '🎪', link: '/admin/relatorios/eventos',
    cor: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700', hover: 'hover:border-fuchsia-500'
  },
  {
    titulo: 'Comissão de Vendedores',
    descricao: 'Vendido × recebido e a comissão de cada vendedor (fechada e em aberto), pela regra de Comissões.',
    icone: '🤝', link: '/admin/relatorios/comissao',
    cor: 'bg-indigo-50 border-indigo-200 text-indigo-700', hover: 'hover:border-indigo-500'
  },
  {
    titulo: 'Faturamento',
    descricao: 'Notas de Débito emitidas, o que falta faturar e o prazo da devolução até a nota.',
    icone: '🧾', link: '/admin/relatorios/faturamento',
    cor: 'bg-teal-50 border-teal-200 text-teal-700', hover: 'hover:border-teal-500'
  },
  {
    titulo: 'Ocupação e Retorno',
    descricao: 'Ocupação do estoque por equipamento e categoria, o que ficou parado e a receita sobre o valor do bem.',
    icone: '📈', link: '/admin/relatorios/ocupacao',
    cor: 'bg-lime-50 border-lime-200 text-lime-700', hover: 'hover:border-lime-500'
  },
  {
    titulo: 'Sublocação',
    descricao: 'Custo com parceiros, margem na OS, avarias de parceiro e o que mais faltou.',
    icone: '🔁', link: '/admin/relatorios/sublocacao',
    cor: 'bg-orange-50 border-orange-200 text-orange-700', hover: 'hover:border-orange-500'
  },
  {
    titulo: 'Avarias e Extravios',
    descricao: 'Ocorrências, custo de reposição e cobrado × recebido × perdoado, por cliente e equipamento.',
    icone: '🛠️', link: '/admin/relatorios/avarias',
    cor: 'bg-rose-50 border-rose-200 text-rose-700', hover: 'hover:border-rose-500'
  },
  {
    titulo: 'Notas Fiscais',
    descricao: 'NF-e e NFS-e emitidas por tipo e período: autorizadas, canceladas e com erro.',
    icone: '🏛️', link: '/admin/relatorios/notas-fiscais',
    cor: 'bg-slate-50 border-slate-200 text-slate-700', hover: 'hover:border-slate-500'
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
          <p className="text-[#64748B] font-medium">Vendas, clientes, eventos, comissão, faturamento, financeiro, equipamentos, ocupação, sublocação, avarias e notas fiscais — com filtros por período e empresa, Excel e PDF. O histórico do P2S completa os anos anteriores conforme a carga avança.</p>
        </div>
        <ModuleGrid modulos={modulosAutorizados} variant="button-plain" />
        <HubBackButton />
      </div>
    </div>
  );
}
