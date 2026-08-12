"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../lib/supabase';
import { painelRhAction } from './actions/actions-dashboard';

// Tipagem do Perfil
interface PerfilUsuario {
  nome: string;
  email: string;
  permissao: string;
  permissaoNormalizada?: string;
}

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();

  // 1. ADMINISTRATIVO deve vir ANTES de ADMIN para evitar a colisão de texto
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  
  // 2. ALTA GESTÃO (Acesso Total)
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  
  // 3. DEMAIS DEPARTAMENTOS
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  if (p.includes('GESTOR')) return 'GESTORES';
  
  // PADRÃO
  return 'USUARIO'; 
};

interface PainelRh {
  mesAno: string;
  documentosVencidos: number;
  documentosVencendo: number;
  holeritesAbertos: number;
  assinaturasPendentes: number;
  solicitacoesPontoPendentes: number;
  pontosImpares: number;
  aniversariantes: { nome: string; dia: number; mes: number; departamento: string | null }[];
  feriasVencidas: number;
  feriasVencendo: number;
  afastamentosAtivos: number;
  rescisoesEmAndamento: number;
}

// Lista de módulos do hub. As permissões de cada um NÃO ficam mais aqui —
// vêm da tabela folha_paginas_permissoes (gerida em /admin/permissoes),
// buscadas pelo campo "link" (= endereco_route). Isso mantém o hub sempre
// em sincronia com o que a própria página de destino já exige para entrar.
const modulosRh = [
  {
    titulo: 'Gestão de Funcionários',
    descricao: 'Gestão de cadastro e gerenciamento dos os funcionários.',
    icone: '🧑', link: '/admin/rh/funcionario',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  },
  {
    titulo: 'Gestão de Holerites',
    descricao: 'Visualizaçao de holerites, fechamentos e envio de assinaturas.',
    icone: '💰', link: '/admin/rh/holerite',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  },
  {
    titulo: 'Gestão de Assinaturas',
    descricao: 'Gestão de Assinaturas de contratos e documentos.',
    icone: '📃', link: '/admin/rh/assinaturas',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  },
  {
    titulo: 'Gestão de Benefícios',
    descricao: 'Transporte, refeição, alimentação e outros benefícios.',
    icone: '🎁', link: '/admin/rh/beneficios',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  },
  {
    titulo: 'Gestão de Documentos',
    descricao: 'Gestão de RG, CPF, CTPS, comprovante de residência, contrato, ASO admissional/periódico, CNH, certificados, advertência e outros',
    icone: '📁', link: '/admin/rh/documentos',
    cor: 'bg-green-50 border-green-200 text-green-700', hover: 'hover:border-green-500'
  },
  {
    titulo: 'Controle de Ponto',
    descricao: 'Importação de registros, cálculo de horas extras e espelhos.',
    icone: '⏱️', link: '/admin/rh/ponto',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Férias e Afastamentos',
    descricao: 'Prazos de férias por período aquisitivo e controle de atestados/licenças.',
    icone: '🏖️', link: '/admin/rh/ferias-afastamentos',
    cor: 'bg-emerald-50 border-emerald-200 text-emerald-700', hover: 'hover:border-emerald-500'
  },
  {
    titulo: 'Rescisão de Funcionário',
    descricao: 'Registro e cálculo de rescisões CLT, com upload do TRCT para casos de folha na contabilidade.',
    icone: '📤', link: '/admin/rh/rescisao',
    cor: 'bg-red-50 border-red-200 text-red-700', hover: 'hover:border-red-500'
  },
  {
    titulo: 'Relatórios e Dashboards',
    descricao: 'Relatórios financeiros e analíticos.',
    icone: '📊', link: '/admin/rh/relatorios',
    cor: 'bg-blue-50 border-blue-200 text-blue-700', hover: 'hover:border-blue-500'
  },
  {
    titulo: 'Parâmetros de Contrato',
    descricao: 'Motor de regras de cálculo (CLT, PJ, Temporário, etc).',
    icone: '⚙️', link: '/admin/rh/parametros',
    cor: 'bg-purple-50 border-purple-200 text-purple-700', hover: 'hover:border-purple-500'
  }
];

export default function RhHub() {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [mapaPermissoes, setMapaPermissoes] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [painel, setPainel] = useState<PainelRh | null>(null);
  const [painelLoading, setPainelLoading] = useState(true);
  const [mostrarAniversariantes, setMostrarAniversariantes] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const carregarAcesso = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const [perfilRes, permissoesRes] = await Promise.all([
        supabase.from('perfis_usuarios').select('nome, email, permissao').eq('id', session.user.id).single(),
        supabase.from('folha_paginas_permissoes').select('endereco_route, permissoes_permitidas')
          .in('endereco_route', modulosRh.map(m => m.link))
      ]);

      if (permissoesRes.error) {
        console.error("Erro ao buscar permissões das rotas:", permissoesRes.error);
      }
      const mapa: Record<string, string[]> = {};
      (permissoesRes.data || []).forEach(r => { mapa[r.endereco_route] = r.permissoes_permitidas || []; });
      setMapaPermissoes(mapa);

      if (perfilRes.data && !perfilRes.error) {
        setPerfil({
          ...perfilRes.data,
          permissaoNormalizada: normalizarPermissao(perfilRes.data.permissao)
        });
      } else {
        console.error("Perfil não encontrado no banco de dados.");
      }
      setLoading(false);
    };

    carregarAcesso();
  }, [router]);

  // Painel de pendências: carrega só depois do perfil liberado, em paralelo
  // com a renderização dos módulos (não bloqueia o hub).
  useEffect(() => {
    if (!perfil) return;
    setPainelLoading(true);
    painelRhAction().then(res => {
      if (res.ok) setPainel(res.info);
      setPainelLoading(false);
    });
  }, [perfil]);

  const textoAniversariantes = (painel?.aniversariantes || [])
    .map(a => `${String(a.dia).padStart(2, '0')}/${String(a.mes).padStart(2, '0')} — ${a.nome}${a.departamento ? ` (${a.departamento})` : ''}`)
    .join('\n');

  const copiarAniversariantes = async () => {
    try {
      await navigator.clipboard.writeText(textoAniversariantes);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      alert('Não foi possível copiar automaticamente. Selecione o texto manualmente.');
    }
  };

  const handleSair = async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    router.push('/login');
  };

  // Ecrã de Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-24">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Carregando módulos...</h2>
        </div>
      </div>
    );
  }

  // Tratamento se o Perfil não existir
  if (!perfil) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 pt-24">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-[#BAE6FD]">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Perfil não localizado</h2>
          <p className="text-[#64748B] text-sm mb-6">A sua conta de autenticação existe, mas o seu perfil de permissões não foi encontrado no banco de dados. Contate o Administrador.</p>
          <button onClick={handleSair} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors w-full">
            Voltar para Login
          </button>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // FILTRO DE SEGURANÇA APLICADO — permissões vêm do banco (folha_paginas_permissoes),
  // não mais de um array fixo no código. Rota sem linha na tabela = ninguém acessa.
  // ==========================================================================
  const modulosAutorizados = modulosRh.filter(modulo =>
    (mapaPermissoes[modulo.link] || []).includes(perfil.permissaoNormalizada!)
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Setor de RH</h1>
          <p className="text-[#64748B] font-medium">Gestão de jornada, folha financeira e regras operacionais.</p>
        </div>

        {/* PAINEL DE PENDÊNCIAS — cada cartão só aparece se o usuário tem acesso
            ao módulo correspondente, e leva direto pra lá ao clicar. */}
        {(() => {
          const linksAutorizados = new Set(modulosAutorizados.map(m => m.link));
          const cartoes: { chave: string; titulo: string; icone: string; valor: string; destaque: boolean; link: string; sub?: string; aoClicar?: () => void }[] = [];

          if (linksAutorizados.has('/admin/rh/documentos')) {
            const vencidos = painel?.documentosVencidos ?? 0;
            const vencendo = painel?.documentosVencendo ?? 0;
            cartoes.push({
              chave: 'documentos', titulo: 'Documentos', icone: '📁',
              valor: painelLoading ? '—' : `${vencidos}`,
              sub: painelLoading ? 'carregando...' : `${vencidos} vencido(s) · ${vencendo} a vencer (30d)`,
              destaque: vencidos > 0, link: '/admin/rh/documentos'
            });
          }
          if (linksAutorizados.has('/admin/rh/holerite')) {
            cartoes.push({
              chave: 'holerites', titulo: 'Holerites em Aberto', icone: '💰',
              valor: painelLoading ? '—' : `${painel?.holeritesAbertos ?? 0}`,
              sub: painel ? `competência ${painel.mesAno.split('-').reverse().join('/')}` : undefined,
              destaque: (painel?.holeritesAbertos ?? 0) > 0, link: '/admin/rh/holerite'
            });
          }
          if (linksAutorizados.has('/admin/rh/assinaturas')) {
            cartoes.push({
              chave: 'assinaturas', titulo: 'Assinaturas Pendentes', icone: '📃',
              valor: painelLoading ? '—' : `${painel?.assinaturasPendentes ?? 0}`,
              destaque: (painel?.assinaturasPendentes ?? 0) > 0, link: '/admin/rh/assinaturas'
            });
          }
          if (linksAutorizados.has('/admin/rh/ponto')) {
            cartoes.push({
              chave: 'solicitacoes', titulo: 'Solicitações de Ponto', icone: '📲',
              valor: painelLoading ? '—' : `${painel?.solicitacoesPontoPendentes ?? 0}`,
              sub: 'pendentes via WhatsApp',
              destaque: (painel?.solicitacoesPontoPendentes ?? 0) > 0, link: '/admin/rh/ponto'
            });
            cartoes.push({
              chave: 'inconsistencias', titulo: 'Pontos Ímpares', icone: '⚠️',
              valor: painelLoading ? '—' : `${painel?.pontosImpares ?? 0}`,
              sub: painel ? `competência ${painel.mesAno.split('-').reverse().join('/')}` : undefined,
              destaque: (painel?.pontosImpares ?? 0) > 0, link: '/admin/rh/ponto'
            });
          }
          if (linksAutorizados.has('/admin/rh/ferias-afastamentos')) {
            const feriasVencidas = painel?.feriasVencidas ?? 0;
            const feriasVencendo = painel?.feriasVencendo ?? 0;
            cartoes.push({
              chave: 'ferias', titulo: 'Férias Vencidas', icone: '🏖️',
              valor: painelLoading ? '—' : `${feriasVencidas}`,
              sub: painelLoading ? 'carregando...' : `${feriasVencendo} vencendo em 60d`,
              destaque: feriasVencidas > 0, link: '/admin/rh/ferias-afastamentos'
            });
            cartoes.push({
              chave: 'afastamentos', titulo: 'Afastamentos Ativos', icone: '🩺',
              valor: painelLoading ? '—' : `${painel?.afastamentosAtivos ?? 0}`,
              destaque: (painel?.afastamentosAtivos ?? 0) > 0, link: '/admin/rh/ferias-afastamentos'
            });
          }
          if (linksAutorizados.has('/admin/rh/rescisao')) {
            cartoes.push({
              chave: 'rescisoes', titulo: 'Rescisões em Andamento', icone: '📤',
              valor: painelLoading ? '—' : `${painel?.rescisoesEmAndamento ?? 0}`,
              destaque: (painel?.rescisoesEmAndamento ?? 0) > 0, link: '/admin/rh/rescisao'
            });
          }
          if (linksAutorizados.has('/admin/rh/funcionario')) {
            const aniversariantes = painel?.aniversariantes || [];
            cartoes.push({
              chave: 'aniversariantes', titulo: 'Aniversariantes do Mês', icone: '🎂',
              valor: painelLoading ? '—' : `${aniversariantes.length}`,
              sub: aniversariantes.length > 0 ? aniversariantes.slice(0, 3).map(a => `${a.nome.split(' ')[0]} (${a.dia})`).join(', ') + (aniversariantes.length > 3 ? '...' : '') : undefined,
              destaque: false, link: '/admin/rh/funcionario',
              aoClicar: () => { setCopiado(false); setMostrarAniversariantes(true); }
            });
          }

          if (cartoes.length === 0) return null;

          return (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
              {cartoes.map(c => (
                <button
                  key={c.chave}
                  onClick={c.aoClicar || (() => router.push(c.link))}
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

        {/* Renderiza APENAS a variável modulosAutorizados */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modulosAutorizados.length === 0 ? (
            <div className="col-span-full p-8 text-center text-gray-500 font-bold uppercase border-2 border-dashed border-gray-300 rounded-xl">
              Você não tem permissão para aceder a nenhum módulo desta área.
            </div>
          ) : (
            modulosAutorizados.map((m) => (
              <button key={m.titulo} onClick={() => router.push(m.link)} className={`text-left p-6 rounded-2xl border-2 transition-all shadow-sm ${m.cor} ${m.hover} group`}>
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">{m.icone}</div>
                <h2 className="text-lg font-black uppercase tracking-wider mb-2">{m.titulo}</h2>
                <p className="text-xs font-medium opacity-80">{m.descricao}</p>
              </button>
            ))
          )}
        </div>
        
        <div className="mt-12 text-center pb-12">
          <button onClick={() => router.push('/admin')} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors">
            ⬅ Voltar ao Painel Administrativo Geral
          </button>
        </div>
      </div>

      {/* POPUP — Aniversariantes do mês, pra copiar e colar */}
      {mostrarAniversariantes && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => setMostrarAniversariantes(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 border-b border-gray-200 bg-[#0C1D4D] text-white flex-shrink-0">
              <h3 className="font-black uppercase tracking-wider text-sm">🎂 Aniversariantes do Mês</h3>
              <button onClick={() => setMostrarAniversariantes(false)} className="text-white/70 hover:text-white font-bold text-lg leading-none">✕</button>
            </div>

            <div className="p-5 flex-grow overflow-y-auto">
              {(painel?.aniversariantes || []).length === 0 ? (
                <p className="text-center text-sm text-gray-400 font-bold uppercase py-8">Nenhum aniversariante este mês.</p>
              ) : (
                <textarea
                  readOnly
                  value={textoAniversariantes}
                  onFocus={e => e.target.select()}
                  rows={Math.min(12, (painel?.aniversariantes.length || 1) + 1)}
                  className="w-full p-3 border border-gray-300 rounded-lg text-sm font-bold text-[#0C1D4D] bg-gray-50 resize-none"
                />
              )}
            </div>

            {(painel?.aniversariantes || []).length > 0 && (
              <div className="p-4 border-t border-gray-200 flex-shrink-0">
                <button onClick={copiarAniversariantes} className={`w-full font-black uppercase tracking-widest text-xs py-3 rounded-xl transition-colors ${copiado ? 'bg-emerald-600 text-white' : 'bg-[#336699] hover:bg-[#284B8C] text-white'}`}>
                  {copiado ? '✓ Copiado!' : '📋 Copiar Lista'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}