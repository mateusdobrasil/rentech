"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { painelOperacionalAction } from './actions/actions-dashboard';
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';

interface PainelOperacional {
  documentosVencidos: number;
  documentosVencendo: number;
  checklistsCargaAbertos: number;
  checklistsVeiculosAbertos: number;
  folgasPendentes: number;
}

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
  const { perfil, loading, modulosAutorizados, accessToken, erro, tentarNovamente } = useModuleAccess(modulosOperacional);
  const [painel, setPainel] = useState<PainelOperacional | null>(null);
  const [painelLoading, setPainelLoading] = useState(true);

  // Painel de pendências: carrega só depois do perfil liberado, em paralelo
  // com a renderização dos módulos (não bloqueia o hub).
  useEffect(() => {
    if (!perfil) return;
    setPainelLoading(true);
    painelOperacionalAction(accessToken).then(res => {
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

        <ModuleGrid modulos={modulosAutorizados} variant="button-plain" />

        <HubBackButton />
      </div>
    </div>
  );
}
