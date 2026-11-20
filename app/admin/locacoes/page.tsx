"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { painelLocacoesAction } from './actions-dashboard';
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';

interface PainelLocacoes {
  fichasEmAndamento: number;
  fichasProximos7Dias: number;
  orcamentosAbertos: number;
  valorOrcamentosAbertos: number;
  reservasProximos7Dias: number;
}

// Hub Locações (criado 2026-11-16, Fase 1 da substituição do P2S): reúne tudo
// que envolve Ficha de Reserva e Ficha de Locação. As permissões de cada
// módulo vêm de parametros_paginas_permissoes (campo "link" = endereco_route),
// como nos outros hubs. Os próximos módulos (Orçamentos/Fichas próprias,
// Tabelas de Preço, Disponibilidade, Fichas de Locação) entram aqui conforme
// ficarem prontos.
const modulosLocacoes = [
  {
    titulo: 'Orçamentos e Reservas',
    descricao: 'Fichas de reserva próprias: orçamento com preço pela tabela, checagem de disponibilidade e reserva dos equipamentos.',
    icone: '📝', link: '/admin/locacoes/reservas',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Fichas de Locação',
    descricao: 'Saídas e devoluções das OSs, trocas, extravios, prorrogação e complemento — com a OS assinada pelo cliente na tela. Inclui o histórico do P2S.',
    icone: '🚚', link: '/admin/locacoes/fichas-locacao',
    cor: 'bg-indigo-50 border-indigo-200 text-indigo-700', hover: 'hover:border-indigo-500'
  },
  {
    titulo: 'Agenda de Disponibilidade',
    descricao: 'Calendário por equipamento: quanto sobra livre em cada dia, com as reservas do P2S e as daqui, e as faltas em destaque.',
    icone: '📅', link: '/admin/locacoes/agenda',
    cor: 'bg-amber-50 border-amber-200 text-amber-700', hover: 'hover:border-amber-500'
  },
  {
    titulo: 'Indicadores de Utilização',
    descricao: 'Taxa de utilização, ociosidade, receita e retorno sobre o valor do estoque por equipamento — o que comprar e o que está parado.',
    icone: '📊', link: '/admin/locacoes/indicadores',
    cor: 'bg-emerald-50 border-emerald-200 text-emerald-700', hover: 'hover:border-emerald-500'
  },
  {
    titulo: 'Fichas de Reserva (P2S)',
    descricao: 'Consulta, importação e sincronização das fichas de reserva do PrimeStart (P2S), vinculadas aos eventos e feiras.',
    icone: '📋', link: '/admin/locacoes/fichas-reserva',
    cor: 'bg-emerald-50 border-emerald-200 text-emerald-700', hover: 'hover:border-emerald-500'
  },
  {
    titulo: 'Tabelas de Preço',
    descricao: 'Preços de locação por faixa de dias (1, 3, 5…), diária extra e mensal — tabelas padrão, por cliente e por evento, com vigência.',
    icone: '💲', link: '/admin/locacoes/tabelas-preco',
    cor: 'bg-violet-50 border-violet-200 text-violet-700', hover: 'hover:border-violet-500'
  },
];

export default function LocacoesHub() {
  const router = useRouter();
  const { perfil, loading, modulosAutorizados, accessToken, erro, tentarNovamente } = useModuleAccess(modulosLocacoes);
  const [painel, setPainel] = useState<PainelLocacoes | null>(null);
  const [painelLoading, setPainelLoading] = useState(true);

  useEffect(() => {
    if (!perfil) return;
    setPainelLoading(true);
    painelLocacoesAction(accessToken).then(res => {
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
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Locações</h1>
          <p className="text-[#64748B] font-medium">Fichas de reserva e de locação, orçamentos, disponibilidade e tabelas de preço.</p>
        </div>

        {/* PAINEL — cada cartão só aparece se o usuário tem acesso ao módulo
            correspondente, e leva direto pra lá ao clicar. */}
        {(() => {
          const linksAutorizados = new Set(modulosAutorizados.map(m => m.link));
          const cartoes: { chave: string; titulo: string; icone: string; valor: string; destaque: boolean; link: string; sub?: string }[] = [];

          if (linksAutorizados.has('/admin/locacoes/reservas')) {
            cartoes.push({
              chave: 'orcamentos', titulo: 'Orçamentos em Aberto', icone: '📝',
              valor: painelLoading ? '—' : `${painel?.orcamentosAbertos ?? 0}`,
              sub: painelLoading ? '' : (painel?.valorOrcamentosAbertos ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
              destaque: false, link: '/admin/locacoes/reservas'
            });
            cartoes.push({
              chave: 'reservas7', titulo: 'Reservas em 7 Dias', icone: '📦',
              valor: painelLoading ? '—' : `${painel?.reservasProximos7Dias ?? 0}`,
              sub: 'reservadas com início na próxima semana',
              destaque: (painel?.reservasProximos7Dias ?? 0) > 0, link: '/admin/locacoes/reservas'
            });
          }

          if (linksAutorizados.has('/admin/locacoes/fichas-reserva')) {
            cartoes.push({
              chave: 'andamento', titulo: 'Em Andamento (P2S)', icone: '🎬',
              valor: painelLoading ? '—' : `${painel?.fichasEmAndamento ?? 0}`,
              sub: 'fichas com evento acontecendo hoje',
              destaque: false, link: '/admin/locacoes/fichas-reserva'
            });
            cartoes.push({
              chave: 'proximas', titulo: 'Começam em 7 Dias (P2S)', icone: '📅',
              valor: painelLoading ? '—' : `${painel?.fichasProximos7Dias ?? 0}`,
              sub: 'fichas com início na próxima semana',
              destaque: (painel?.fichasProximos7Dias ?? 0) > 0, link: '/admin/locacoes/fichas-reserva'
            });
          }

          if (cartoes.length === 0) return null;

          return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
              {cartoes.map(c => (
                <button
                  key={c.chave}
                  onClick={() => router.push(c.link)}
                  className={`text-left bg-white p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all ${c.destaque ? 'border-amber-200 hover:border-amber-400' : 'border-[#E2E8F0] hover:border-[#336699]'}`}
                >
                  <div className="text-lg mb-1">{c.icone}</div>
                  <p className={`text-2xl font-black leading-tight ${c.destaque ? 'text-amber-600' : 'text-[#0C1D4D]'}`}>{c.valor}</p>
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
