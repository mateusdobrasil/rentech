"use client";

import { Analytics } from "@vercel/analytics/next";
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';

// Lista de módulos do hub. As permissões de cada um NÃO ficam aqui — vêm da
// tabela folha_paginas_permissoes (gerida em /admin/permissoes), buscadas
// pelo campo "link" (= endereco_route). Isso mantém o hub sempre em
// sincronia com o que a própria página de destino já exige para entrar.
const modulosComercial = [
  {
    titulo: 'Documentos da Empresa',
    descricao: 'Consulte e baixe certidões, cartão CNPJ, contrato social e demais documentos da Rentech.',
    icone: '📁', link: '/admin/comercial/documentos',
    cor: 'bg-slate-50 border-slate-200 text-slate-700', hover: 'hover:border-slate-500'
  },
  {
    titulo: 'Documentos da Frota',
    descricao: 'Ficha dos veículos e documentos dos veículos da empresa.',
    icone: '🚚', link: '/admin/comercial/frota',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Fichas de Reserva',
    descricao: 'Importação e consulta das fichas de reserva vinculadas aos eventos e feiras.',
    icone: '📋', link: '/admin/comercial/fichas',
    cor: 'bg-emerald-50 border-emerald-200 text-emerald-700', hover: 'hover:border-emerald-500'
  },
  {
    titulo: 'Eventos/Feiras',
    descricao: 'Cadastro de eventos e feiras com local padrão, usado para localizar o calendário operacional.',
    icone: '📍', link: '/admin/comercial/eventos-feiras',
    cor: 'bg-cyan-50 border-cyan-200 text-cyan-700', hover: 'hover:border-cyan-500'
  }
];

export default function ComercialHub() {
  const { perfil, loading, modulosAutorizados, erro, tentarNovamente } = useModuleAccess(modulosComercial);

  if (loading) return <HubLoading />;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (!perfil) return <HubPerfilNaoLocalizado />;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Setor Comercial</h1>
          <p className="text-[#64748B] font-medium">Documentos da empresa e da frota, fichas de reserva e eventos/feiras.</p>
        </div>

        <ModuleGrid modulos={modulosAutorizados} variant="button-plain" />

        <HubBackButton />
      </div>
    </div>
  );
}
