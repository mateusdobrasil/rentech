"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { contadoresSuporteAction } from './suporte/actions';
import { Analytics } from "@vercel/analytics/next";
import { useModuleAccess } from '../components/hooks/useModuleAccess';
import ModuleGrid from '../components/ui/ModuleGrid';
import { HubLoading, HubPerfilNaoLocalizado, HubErro } from '../components/ui/HubStates';
import { VERSAO_APP } from '../lib/versaoApp';

// Estrutura dos módulos do sistema. As permissões de cada um NÃO ficam mais
// aqui — vêm da tabela parametros_paginas_permissoes (gerida em /admin/parametros/permissoes),
// buscadas pelo campo "link" (= endereco_route). Isso mantém o hub sempre em
// sincronia com o que a própria página de destino já exige para entrar.
const MODULOS_SISTEMA = [
  {
    titulo: 'Diretor (IA)',
    descricao: 'Relatório diário de cada empresa: recebimentos, pagamentos, locações, expedição, frota, RH e o que pede atenção.',
    icone: '🧭',
    link: '/admin/diretoria',
    cor: 'border-[#0C1D4D]/50 hover:border-[#0C1D4D]',
    bgIcon: 'bg-slate-100 text-[#0C1D4D]'
  },
  {
    titulo: 'Ordens de Pagamentos',
    descricao: 'Solicite novas Ordens de Pagamento, acompanhe as suas e gerencie assinaturas de contratos.',
    icone: '📋',
    link: '/admin/op',
    cor: 'border-[#336699]/50 hover:border-[#336699]',
    bgIcon: 'bg-blue-50 text-[#336699]'
  }, 
  {
    titulo: 'RH',
    descricao: 'Funcionários, holerites, ponto, benefícios, documentos, férias, rescisões e relatórios de RH.',
    icone: '❤️',
    link: '/admin/rh',
    cor: 'border-rose-500/50 hover:border-rose-500',
    bgIcon: 'bg-rose-50 text-rose-600'
  },
  {
    titulo: 'Financeiro',
    descricao: 'Lotes de pagamento, Ordens de Pagamento, Consignado, contas a pagar e integração bancária.',
    icone: '💰',
    link: '/admin/financeiro',
    cor: 'border-emerald-500/50 hover:border-emerald-500',
    bgIcon: 'bg-emerald-50 text-emerald-600'
  },
  {
    titulo: 'Comercial',
    descricao: 'Documentos da empresa e da frota, parceiros e cadastro de eventos/feiras.',
    icone: '🤝',
    link: '/admin/comercial',
    cor: 'border-slate-500/50 hover:border-slate-500',
    bgIcon: 'bg-slate-50 text-slate-600'
  },
  {
    titulo: 'Locações',
    descricao: 'Fichas de reserva e de locação: orçamentos, reservas, disponibilidade de equipamentos e tabelas de preço.',
    icone: '🎛️',
    link: '/admin/locacoes',
    cor: 'border-violet-500/50 hover:border-violet-500',
    bgIcon: 'bg-violet-50 text-violet-600'
  },
  {
    titulo: 'Relatórios',
    descricao: 'Vendas, conversão de orçamentos, financeiro e equipamentos — por período e empresa, com Excel e PDF.',
    icone: '📈',
    link: '/admin/relatorios',
    cor: 'border-sky-500/50 hover:border-sky-500',
    bgIcon: 'bg-sky-50 text-sky-600'
  },
  {
    titulo: 'Operacional',
    descricao: 'Controle de frota, documentos de veículos, relatórios operacionais e registro de ponto.',
    icone: '👷‍♂️',
    link: '/admin/operacional',
    cor: 'border-slate-500/50 hover:border-slate-500',
    bgIcon: 'bg-slate-50 text-slate-600'
  },
  {
    titulo: 'Estoque',
    descricao: 'Controle de estoque, expedição, produtos e marcas.',
    icone: '📦',
    link: '/admin/estoque',
    cor: 'border-amber-500/50 hover:border-amber-500',
    bgIcon: 'bg-amber-50 text-amber-600'
  },
  {
    titulo: 'Banco de Talentos',
    descricao: 'Acesso à lista de colaboradores Freelance, especialidades e chaves PIX.',
    icone: '👷',
    link: '/admin/freelance',
    cor: 'border-blue-500/50 hover:border-blue-500',
    bgIcon: 'bg-blue-50 text-blue-600'
  },
  {
    titulo: 'Portal de Downloads',
    descricao: 'Faça upload e gerencie os arquivos, softwares e manuais públicos da Rentech.',
    icone: '📁',
    link: '/admin/downloads',
    cor: 'border-cyan-500/50 hover:border-cyan-500',
    bgIcon: 'bg-cyan-50 text-cyan-600'
  },
  {
    titulo: 'Rentech Academy',
    descricao: 'Gerencie os artigos de dicas técnicas de TV, LED, som e luz publicados em /academy.',
    icone: '🎓',
    link: '/admin/academy',
    cor: 'border-indigo-500/50 hover:border-indigo-500',
    bgIcon: 'bg-indigo-50 text-indigo-600'
  },
  {
    titulo: 'Suporte e Chamados',
    descricao: 'Abra chamados para TI, Financeiro, Operacional, RH e outras áreas e acompanhe até a solução.',
    icone: '🛟',
    link: '/admin/suporte',
    cor: 'border-teal-500/50 hover:border-teal-500',
    bgIcon: 'bg-teal-50 text-teal-600'
  },
  {
    titulo: 'Manuais',
    descricao: 'Manuais do sistema com as telas reais: locação, inventário, suporte, Diretor (IA), ponto e roteiros de teste.',
    icone: '📚',
    link: '/admin/manuais',
    cor: 'border-sky-500/50 hover:border-sky-500',
    bgIcon: 'bg-sky-50 text-sky-600'
  },
  {
    titulo: 'Parâmetros',
    descricao: 'Controle de acesso, conteúdo do site, integrações, agendamentos, empresas do grupo e log de auditoria.',
    icone: '⚙️',
    link: '/admin/parametros',
    cor: 'border-purple-500/50 hover:border-purple-500',
    bgIcon: 'bg-purple-50 text-purple-600'
  }
];

export default function HubAdministrativo() {
  const { perfil, loading, modulosAutorizados, accessToken, erro, tentarNovamente } = useModuleAccess(MODULOS_SISTEMA);
  const [badgeSuporte, setBadgeSuporte] = useState(0);
  const temSuporte = modulosAutorizados.some(m => m.link === '/admin/suporte');

  // Selo no card de Suporte: chamados com novidade + fila sem responsável.
  useEffect(() => {
    if (!temSuporte || !accessToken) return;
    contadoresSuporteAction(accessToken).then(r => setBadgeSuporte(r.info?.total || 0)).catch(() => {});
  }, [temSuporte, accessToken]);

  const modulosComBadge = modulosAutorizados.map(m => (m.link === '/admin/suporte' ? { ...m, badge: badgeSuporte } : m));

  if (loading) return <HubLoading />;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (!perfil) return <HubPerfilNaoLocalizado />;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-24 pb-12">
      <Analytics />
      
      <div className="container mx-auto px-4 mt-6 mb-10 max-w-6xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-[#E2E8F0] pb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-[#0C1D4D] tracking-tight mb-2">
              Bem-vindo ao Ecossistema, <span className="text-[#336699]">{perfil.nome.split(' ')[0]}</span>.
            </h1>
            <p className="text-[#64748B] font-medium text-sm md:text-base">
              Selecione abaixo o módulo que deseja acessar. Suas ferramentas foram liberadas conforme o seu nível de acesso.
            </p>
          </div>
          
          <div className="bg-white px-5 py-3 rounded-xl shadow-sm border border-[#E2E8F0] text-left md:text-right min-w-[200px]">
            <span className="block text-[10px] text-[#94A3B8] font-bold tracking-widest uppercase mb-1">Seu Nível de Acesso</span>
            <strong className="block text-sm text-[#336699] font-black uppercase tracking-wider" title={`Cargo Registado: ${perfil.permissao}`}>
              {perfil.permissaoNormalizada}
            </strong>
            <Link href="/admin/conta" className="inline-block mt-2 text-[10px] font-black text-[#64748B] hover:text-[#336699] uppercase tracking-widest transition-colors">
              ⚙️ Minha Conta
            </Link>
            <span title="Versão do sistema" className="block mt-1 text-[9px] text-[#CBD5E1] font-bold tracking-widest">
              v{VERSAO_APP}
            </span>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-6xl">
        <ModuleGrid
          modulos={modulosComBadge}
          variant="link-icon"
          emptyWrapsGrid={false}
          emptyState={
            <div className="bg-white p-10 rounded-2xl border border-dashed border-[#CBD5E1] text-center">
              <span className="text-4xl mb-4 block">🚫</span>
              <h3 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Acesso Restrito</h3>
              <p className="text-[#64748B] text-sm">Você não possui permissão para visualizar nenhum módulo ativo neste momento.</p>
            </div>
          }
        />
      </div>

    </div>
  );
}