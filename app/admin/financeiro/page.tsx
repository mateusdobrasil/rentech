"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { painelFinanceiroAction } from './actions';
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';
import { formatarMoeda } from '../../lib/formatadores';

// Lista de módulos do hub. As permissões de cada um NÃO ficam mais aqui —
// vêm da tabela parametros_paginas_permissoes (gerida em /admin/permissoes),
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

type ValorQtd = { valor: number; qtd: number };
interface PainelFinanceiro {
  hoje: string;
  ops: { pendentes: ValorQtd; vencidas: ValorQtd; vencendo7d: ValorQtd; aguardandoBanco: ValorQtd } | null;
  contasPagar: { vencidas: ValorQtd; vencendo7d: ValorQtd } | null;
}

const BRL = formatarMoeda;

export default function FinanceiroHub() {
  const router = useRouter();
  const { perfil, loading, modulosAutorizados, erro, tentarNovamente, accessToken } = useModuleAccess(modulosFinanceiro);
  const [painel, setPainel] = useState<PainelFinanceiro | null>(null);
  const [painelLoading, setPainelLoading] = useState(true);

  // Indicadores: carregam depois do perfil liberado, sem bloquear o hub
  useEffect(() => {
    if (!perfil) return;
    setPainelLoading(true);
    painelFinanceiroAction(accessToken).then(res => {
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
        <div className="mb-8">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Financeiro</h1>
          <p className="text-[#64748B] font-medium">Lotes de pagamento, Ordens de Pagamento, Consignado, contas a pagar e integração bancária.</p>
        </div>

        {/* INDICADORES — mesmo formato do hub de RH: cada cartão só aparece se
            o usuário acessa o módulo de destino e leva direto pra lá. Os totais
            que ficavam no topo de /admin/financeiro/ops vieram pra cá. */}
        {(() => {
          const linksAutorizados = new Set(modulosAutorizados.map(m => m.link));
          const cartoes: { chave: string; titulo: string; icone: string; valor: string; sub?: string; destaque: boolean; link: string }[] = [];
          const qtdTxt = (v?: ValorQtd) => painelLoading ? 'carregando...' : `${v?.qtd ?? 0} ${v?.qtd === 1 ? 'registro' : 'registros'}`;
          const valorTxt = (v?: ValorQtd) => painelLoading ? '—' : BRL(v?.valor ?? 0);

          if (linksAutorizados.has('/admin/financeiro/ops') && (painelLoading || painel?.ops)) {
            const o = painel?.ops;
            cartoes.push(
              { chave: 'ops-pendentes', titulo: 'OPs Pendentes', icone: '📋', valor: valorTxt(o?.pendentes), sub: qtdTxt(o?.pendentes), destaque: false, link: '/admin/financeiro/ops' },
              { chave: 'ops-vencidas', titulo: 'OPs Vencidas', icone: '⏰', valor: valorTxt(o?.vencidas), sub: qtdTxt(o?.vencidas), destaque: (o?.vencidas.qtd ?? 0) > 0, link: '/admin/financeiro/ops' },
              { chave: 'ops-7d', titulo: 'OPs a Vencer (7 dias)', icone: '📅', valor: valorTxt(o?.vencendo7d), sub: qtdTxt(o?.vencendo7d), destaque: false, link: '/admin/financeiro/ops' },
              { chave: 'ops-banco', titulo: 'OPs Aguardando Banco', icone: '🏦', valor: valorTxt(o?.aguardandoBanco), sub: painelLoading ? 'carregando...' : `${o?.aguardandoBanco.qtd ?? 0} Pix enviado(s), sem baixa`, destaque: false, link: '/admin/financeiro/ops' },
            );
          }
          if (linksAutorizados.has('/admin/financeiro/contas-pagar') && (painelLoading || painel?.contasPagar)) {
            const c = painel?.contasPagar;
            cartoes.push(
              { chave: 'cp-vencidas', titulo: 'Contas a Pagar Vencidas', icone: '💳', valor: valorTxt(c?.vencidas), sub: qtdTxt(c?.vencidas), destaque: (c?.vencidas.qtd ?? 0) > 0, link: '/admin/financeiro/contas-pagar' },
              { chave: 'cp-7d', titulo: 'Contas a Vencer (7 dias)', icone: '🗓️', valor: valorTxt(c?.vencendo7d), sub: qtdTxt(c?.vencendo7d), destaque: false, link: '/admin/financeiro/contas-pagar' },
            );
          }

          if (cartoes.length === 0) return null;

          return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
              {cartoes.map(c => (
                <button
                  key={c.chave}
                  onClick={() => router.push(c.link)}
                  className={`text-left bg-white p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all min-w-0 ${c.destaque ? 'border-red-200 hover:border-red-400' : 'border-[#E2E8F0] hover:border-[#336699]'}`}
                >
                  <div className="text-lg mb-1">{c.icone}</div>
                  <p className={`text-lg font-black leading-tight truncate ${c.destaque ? 'text-red-600' : 'text-[#0C1D4D]'}`} title={c.valor}>{c.valor}</p>
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
