"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  if (p.includes('GESTOR')) return 'GESTORES';
  return 'USUARIO'; 
};

interface LogEntry {
  id: string;
  data_hora: string;
  usuario_nome: string;
  acao: string;
  setor: string | null;
  equipamento_id: string | null;
  equipamento_nome: string | null;
}

const PAGE_SIZE = 75;

const SETORES = ['ACESSO', 'OP', 'ESTOQUE', 'FREELANCE', 'CONTEÚDO', 'PERMISSÕES'];

const SETOR_STYLE: Record<string, string> = {
  'ACESSO':     'bg-purple-100 text-purple-700 border-purple-200',
  'OP':         'bg-blue-100 text-blue-700 border-blue-200',
  'ESTOQUE':    'bg-amber-100 text-amber-700 border-amber-200',
  'FREELANCE':  'bg-green-100 text-green-700 border-green-200',
  'CONTEÚDO':   'bg-cyan-100 text-cyan-700 border-cyan-200',
  'PERMISSÕES': 'bg-red-100 text-red-700 border-red-200',
};

const SETOR_ICON: Record<string, string> = {
  'ACESSO':     '🔐',
  'OP':         '💳',
  'ESTOQUE':    '📦',
  'FREELANCE':  '👷',
  'CONTEÚDO':   '🌐',
  'PERMISSÕES': '⚙️',
};

function formatarDataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

export default function PainelAuditoria() {
  const router = useRouter();
  const pathname = usePathname();

  // Estados de Segurança
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  // Estados dos Dados
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [filtroSetor, setFiltroSetor] = useState('');
  const [filtroData, setFiltroData] = useState('');

  // 1. Validar Sessão e Consultar Permissões Dinâmicas no Banco
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) { 
        router.push('/login'); 
        return; 
      }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();
      
      if (perfilError || !perfil) {
        console.error("Erro crítico ao buscar perfil do usuário:", perfilError);
        router.push('/login');
        return;
      }

      // Consulta no banco de dados quem pode aceder a esta rota
      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      // Normaliza o perfil logado e verifica contra o banco
      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      // Aprovado
      setAuthLoading(false);
    }
    
    checkAuth();
  }, [router, pathname]);

  const carregarLogs = useCallback(async (reset: boolean, currentLogs: LogEntry[]) => {
    setLoading(true);
    const offset = reset ? 0 : currentLogs.length;

    let query = supabase
      .from('logs_auditoria')
      .select('*', { count: 'exact' })
      .order('data_hora', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (filtroSetor) query = query.eq('setor', filtroSetor);

    if (filtroData) {
      query = query
        .gte('data_hora', `${filtroData}T00:00:00`)
        .lte('data_hora', `${filtroData}T23:59:59`);
    }

    if (buscaAplicada) {
      query = query.or(
        `usuario_nome.ilike.%${buscaAplicada}%,acao.ilike.%${buscaAplicada}%,equipamento_nome.ilike.%${buscaAplicada}%`
      );
    }

    const { data, count, error } = await query;

    if (!error && data) {
      setLogs(prev => reset ? data : [...prev, ...data]);
      setTotalCount(count ?? 0);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoading(false);
  }, [filtroSetor, filtroData, buscaAplicada]);

  useEffect(() => {
    // Só carrega os logs se a autenticação estiver concluída e aprovada
    if (!authLoading && !acessoNegado) {
      carregarLogs(true, []);
    }
  }, [authLoading, acessoNegado, filtroSetor, filtroData, buscaAplicada]); // eslint-disable-line react-hooks/exhaustive-deps

  const limparFiltros = () => {
    setBusca('');
    setBuscaAplicada('');
    setFiltroSetor('');
    setFiltroData('');
  };

  const temFiltro = filtroSetor || filtroData || buscaAplicada;

  // ============================================================================
  // BARREIRAS DE ACESSO VISUAIS
  // ============================================================================
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm" />
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Logs de Auditoria.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      {/* HEADER */}
      <div className="bg-[#0C1D4D] border-b border-[#1e3a6e] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-md">
        <div>
          <p className="text-white font-black text-sm uppercase tracking-widest">🔍 Log de Auditoria</p>
          <p className="text-[#94A3B8] text-xs font-medium mt-0.5">Histórico completo de ações no sistema Rentech</p>
        </div>
        <button
          onClick={() => router.push('/admin/parametros')}
          className="text-[10px] md:text-xs font-black bg-white/10 hover:bg-white/20 border border-white/20 text-white px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ Voltar ao Hub
        </button>
      </div>

      {/* MÉTRICAS */}
      <div className="px-4 md:px-8 pt-6 pb-2 flex-shrink-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-[#0C1D4D]">
            <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total de Registos</p>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">{totalCount.toLocaleString('pt-BR')}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-purple-500">
            <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Carregados</p>
            <p className="text-2xl font-black text-purple-600 mt-1">{logs.length.toLocaleString('pt-BR')}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-[#336699] md:col-span-2">
            <p className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Filtros Activos</p>
            <p className="text-sm font-black text-[#336699] mt-1 truncate">
              {temFiltro
                ? [
                    filtroSetor && `Setor: ${filtroSetor}`,
                    filtroData && `Data: ${filtroData}`,
                    buscaAplicada && `Busca: "${buscaAplicada}"`,
                  ].filter(Boolean).join(' | ')
                : 'Nenhum — exibindo todos os registos'}
            </p>
          </div>
        </div>

        {/* FILTROS */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          <div className="flex flex-1 gap-2 min-w-0">
            <input
              type="text"
              placeholder="Buscar por usuário, ação ou contexto..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setBuscaAplicada(busca)}
              className="flex-1 p-2.5 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] outline-none focus:border-[#336699] min-w-0"
            />
            <button
              onClick={() => setBuscaAplicada(busca)}
              className="px-4 py-2.5 bg-[#0C1D4D] text-white font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#284B8C] transition-colors shrink-0"
            >
              Buscar
            </button>
          </div>

          <select
            value={filtroSetor}
            onChange={e => setFiltroSetor(e.target.value)}
            className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] outline-none focus:border-[#336699] bg-white lg:w-44 shrink-0"
          >
            <option value="">Todos os setores</option>
            {SETORES.map(s => (
              <option key={s} value={s}>{SETOR_ICON[s]} {s}</option>
            ))}
          </select>

          <input
            type="date"
            value={filtroData}
            onChange={e => setFiltroData(e.target.value)}
            className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm text-[#0A2A4A] outline-none focus:border-[#336699] lg:w-44 shrink-0"
          />

          {temFiltro && (
            <button
              onClick={limparFiltros}
              className="px-4 py-2.5 bg-red-50 border border-red-200 text-red-500 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-red-100 transition-colors shrink-0"
            >
              ✕ Limpar
            </button>
          )}
        </div>
      </div>

      {/* TABELA */}
      <div className="px-4 md:px-8 py-4 flex-grow overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead className="bg-[#0C1D4D] sticky top-0 z-10">
              <tr className="text-white text-[10px] uppercase tracking-wider font-bold">
                <th className="p-4 w-40">Data / Hora</th>
                <th className="p-4 w-28 text-center">Setor</th>
                <th className="p-4 w-44">Usuário</th>
                <th className="p-4">Ação</th>
                <th className="p-4">Contexto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16 text-[#94A3B8] font-bold text-sm">
                    Carregando registos...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-16 text-[#94A3B8] font-bold text-sm">
                    Nenhum registo encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="p-4 whitespace-nowrap">
                      <span className="text-[#64748B] font-semibold font-mono text-[11px]">
                        {formatarDataHora(log.data_hora)}
                      </span>
                    </td>

                    <td className="p-4 text-center">
                      {log.setor ? (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[9px] font-black tracking-wider border whitespace-nowrap ${SETOR_STYLE[log.setor] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {SETOR_ICON[log.setor] ?? '•'} {log.setor}
                        </span>
                      ) : (
                        <span className="text-[#CBD5E1]">—</span>
                      )}
                    </td>

                    <td className="p-4">
                      <span className="font-bold text-[#0C1D4D] block truncate max-w-[160px]" title={log.usuario_nome}>
                        {log.usuario_nome}
                      </span>
                    </td>

                    <td className="p-4">
                      <span className="font-black text-[#336699] uppercase tracking-wide text-[10px]">
                        {log.acao}
                      </span>
                    </td>

                    <td className="p-4">
                      <span className="text-[#64748B] font-medium block truncate max-w-[280px]" title={log.equipamento_nome ?? ''}>
                        {log.equipamento_nome ?? <span className="text-[#CBD5E1]">—</span>}
                      </span>
                      {log.equipamento_id && (
                        <span className="text-[#94A3B8] font-mono text-[9px] block mt-0.5 truncate max-w-[280px]">
                          ID: {log.equipamento_id}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* LOAD MORE */}
        <div className="pt-4 flex justify-center items-center gap-4 pb-4">
          {hasMore && !loading && (
            <button
              onClick={() => carregarLogs(false, logs)}
              className="px-8 py-3 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest rounded-xl shadow-md transition-colors"
            >
              Carregar Mais Registos
            </button>
          )}
          {loading && logs.length > 0 && (
            <div className="flex items-center gap-3 text-[#64748B] font-semibold text-sm">
              <div className="w-5 h-5 border-2 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" />
              Carregando...
            </div>
          )}
          {!hasMore && logs.length > 0 && !loading && (
            <p className="text-[11px] text-[#94A3B8] font-bold uppercase tracking-widest">
              Todos os {totalCount.toLocaleString('pt-BR')} registos carregados
            </p>
          )}
        </div>
      </div>
    </div>
  );
}