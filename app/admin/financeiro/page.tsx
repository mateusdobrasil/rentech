"use client";

import { Analytics } from "@vercel/analytics/next";
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';

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
  const { perfil, loading, modulosAutorizados, erro, tentarNovamente } = useModuleAccess(modulosFinanceiro);

  if (loading) return <HubLoading />;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (!perfil) return <HubPerfilNaoLocalizado />;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Financeiro</h1>
          <p className="text-[#64748B] font-medium">Lotes de pagamento, Ordens de Pagamento e Crédito Consignado.</p>
        </div>

        <ModuleGrid modulos={modulosAutorizados} variant="button-plain" />

        <HubBackButton />
      </div>
    </div>
  );
}
