"use client";

import { Analytics } from "@vercel/analytics/next";
import { useModuleAccess } from '../../components/hooks/useModuleAccess';
import ModuleGrid from '../../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';

// Lista de módulos do hub. As permissões de cada um NÃO ficam aqui — vêm da
// tabela folha_paginas_permissoes (gerida em Parâmetros → Controle de Acesso),
// buscadas pelo campo "link" (= endereco_route). Isso mantém o hub sempre em
// sincronia com o que a própria página de destino já exige para entrar.
const modulosParametros = [
  {
    titulo: 'Controle de Acesso e Diretórios',
    descricao: 'Usuários, setores de permissão e mapeamento de rotas protegidas do sistema.',
    icone: '🔐', link: '/admin/parametros/permissoes',
    cor: 'border-purple-500/50 hover:border-purple-500', bgIcon: 'bg-purple-50 text-purple-600'
  },
  {
    titulo: 'Agendamentos e Disparos',
    descricao: 'Automações de lembretes e rotinas diárias via WhatsApp e e-mail.',
    icone: '⏰', link: '/admin/parametros/agendamentos',
    cor: 'border-blue-500/50 hover:border-blue-500', bgIcon: 'bg-blue-50 text-blue-600'
  },
  {
    titulo: 'Conteúdo do Site',
    descricao: 'Textos, imagens e vídeos do site institucional exibidos em tempo real.',
    icone: '🌐', link: '/admin/parametros/conteudo',
    cor: 'border-[#336699]/50 hover:border-[#336699]', bgIcon: 'bg-blue-50 text-[#336699]'
  },
  {
    titulo: 'Integrações',
    descricao: 'Bancos e parceiros para pagamentos, assinaturas e envio de informações.',
    icone: '🔗', link: '/admin/parametros/integracao',
    cor: 'border-emerald-500/50 hover:border-emerald-500', bgIcon: 'bg-emerald-50 text-emerald-600'
  },
  {
    titulo: 'Cadastro de Empresas',
    descricao: 'Empresas do Grupo Rentech (CNPJs) usadas para vincular funcionários e restringir acesso.',
    icone: '🏢', link: '/admin/parametros/empresas',
    cor: 'border-amber-500/50 hover:border-amber-500', bgIcon: 'bg-amber-50 text-amber-600'
  },
  {
    titulo: 'Log de Auditoria',
    descricao: 'Histórico completo de ações realizadas no sistema: acessos, edições e alterações.',
    icone: '🔍', link: '/admin/parametros/log',
    cor: 'border-slate-500/50 hover:border-slate-500', bgIcon: 'bg-slate-50 text-slate-600'
  }
];

export default function ParametrosHub() {
  const { perfil, loading, modulosAutorizados, erro, tentarNovamente } = useModuleAccess(modulosParametros);

  if (loading) return <HubLoading />;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (!perfil) return <HubPerfilNaoLocalizado />;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Parâmetros do Sistema</h1>
          <p className="text-[#64748B] font-medium">Configurações centrais: acessos, integrações, conteúdo do site, agendamentos, empresas do grupo e auditoria.</p>
        </div>

        <ModuleGrid modulos={modulosAutorizados} variant="button-icon" />

        <HubBackButton />
      </div>
    </div>
  );
}
