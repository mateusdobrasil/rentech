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
const modulosOp = [
  {
    titulo: 'Solicitar Nova OP',
    descricao: 'Preencha o formulário para enviar um pagamento para análise da diretoria.',
    icone: '➕', link: '/admin/op/nova',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  },
  {
    titulo: 'Minhas OPs',
    descricao: 'Acompanhe o status ou edite as Ordens de Pagamento solicitadas por você.',
    icone: '📋', link: '/admin/op/responsavel',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Gestão de Assinaturas',
    descricao: 'Gestão de Assinaturas de contratos e documentos.',
    icone: '📃', link: '/admin/op/assinaturas',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  }
];

export default function OpHub() {
  const { perfil, loading, modulosAutorizados, erro, tentarNovamente } = useModuleAccess(modulosOp);

  if (loading) return <HubLoading />;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (!perfil) return <HubPerfilNaoLocalizado />;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Setor de OPs</h1>
          <p className="text-[#64748B] font-medium">Gestão de Ordens de Pagamentos, solicitações e análises.</p>
        </div>

        <ModuleGrid modulos={modulosAutorizados} variant="button-plain" />

        <HubBackButton />
      </div>
    </div>
  );
}
