"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { sincronizarProdutosP2sAction } from './actions';
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

interface ProdutoGrid {
  id: number;
  codigo: number | null;
  codigo_formatado: string | null;
  nome_item: string | null;
  categoria_nome: string | null;
  marca_nome: string | null;
  modelo: string | null;
  unidade: string | null;
  habilitado_para_locacao: boolean;
  habilitado_para_venda: boolean;
  peso_unitario: number | null;
}

interface PrecoItem { tabela: string | null; preco: number | null; }
interface EstoqueItem { estoque: string | null; custo_medio: number | null; localizacao: string | null; }

// Registro completo (todas as ~115 colunas) — usado só no modal de detalhe.
type ProdutoCompleto = Record<string, unknown> & { precos: PrecoItem[] | null; estoques: EstoqueItem[] | null };

const TAMANHO_PAGINA = 50;

// Campos que já têm exibição dedicada no modal (cabeçalho + tabelas) —
// não repetir na lista genérica "Demais atributos".
const CAMPOS_JA_EXIBIDOS = new Set([
  'id', 'p2s_oid', 'created_at', 'updated_at', 'precos', 'estoques',
  'nome_item', 'codigo', 'codigo_formatado', 'categoria_nome', 'sub_categoria_nome', 'marca_nome',
  'categoria', 'sub_categoria', 'marca',
]);

// snake_case -> Rótulo Legível, só pra exibição (não muda o nome real da coluna).
const humanizar = (campo: string): string =>
  campo.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const formatarValor = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
};

const formatarMoeda = (v: number | null): string =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ProdutosPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [usuarioAtual, setUsuarioAtual] = useState('');

  const [sincronizando, setSincronizando] = useState(false);
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; tipo: 'success' | 'error' }>({ show: false, msg: '', tipo: 'success' });

  const [produtosGrid, setProdutosGrid] = useState<ProdutoGrid[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridErro, setGridErro] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroDisponibilidade, setFiltroDisponibilidade] = useState<'todos' | 'locacao' | 'venda'>('todos');
  const [pagina, setPagina] = useState(0);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [refreshGrid, setRefreshGrid] = useState(0);

  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoCompleto | null>(null);
  const [detalheLoading, setDetalheLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();

      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao } = await supabase
        .from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', pathname).single();

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true); setAuthLoading(false); return;
      }

      setUsuarioAtual(perfil.nome || 'Usuário');
      setAuthLoading(false);
    })();
  }, [router, pathname]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;

    const handle = setTimeout(async () => {
      setGridLoading(true);
      setGridErro('');

      let query = supabase
        .from('produtos')
        .select('id, codigo, codigo_formatado, nome_item, categoria_nome, marca_nome, modelo, unidade, habilitado_para_locacao, habilitado_para_venda, peso_unitario', { count: 'exact' })
        .order('codigo', { ascending: true })
        .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);

      if (filtroDisponibilidade === 'locacao') query = query.eq('habilitado_para_locacao', true);
      else if (filtroDisponibilidade === 'venda') query = query.eq('habilitado_para_venda', true);

      if (filtroTexto.trim()) {
        const termo = `%${filtroTexto.trim()}%`;
        query = query.or(`nome_item.ilike.${termo},codigo_formatado.ilike.${termo},marca_nome.ilike.${termo},categoria_nome.ilike.${termo},modelo.ilike.${termo}`);
      }

      const { data, error, count } = await query;
      if (error) {
        setGridErro(error.message);
        setProdutosGrid([]);
      } else {
        setProdutosGrid(data || []);
        setTotalRegistros(count || 0);
      }
      setGridLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, pagina, filtroDisponibilidade, filtroTexto, refreshGrid]);

  const sincronizarViaApi = async () => {
    setSincronizando(true);
    setFeedback({ show: false, msg: '', tipo: 'success' });
    try {
      const res = await sincronizarProdutosP2sAction();
      if (!res.ok) {
        setFeedback({ show: true, tipo: 'error', msg: `Falha ao sincronizar com o PrimeStart: ${res.erro}` });
        return;
      }
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'SINCRONIZOU PRODUTOS VIA API (P2S)',
        setor: 'OPERACIONAL',
        equipamento_nome: `${res.info.processados} registro(s)`,
      });
      setFeedback({ show: true, tipo: 'success', msg: `${res.info.processados} produto(s) sincronizado(s) direto do PrimeStart (${res.info.totalEncontradas} no catálogo).` });
      setPagina(0);
      setRefreshGrid(v => v + 1);
    } finally {
      setSincronizando(false);
    }
  };

  const abrirDetalhe = async (id: number) => {
    setDetalheLoading(true);
    setProdutoSelecionado(null);
    const { data, error } = await supabase.from('produtos').select('*').eq('id', id).single();
    if (!error && data) setProdutoSelecionado(data as ProdutoCompleto);
    setDetalheLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Produtos.</p>
          <button onClick={() => router.push('/admin/operacional')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          📦 <strong>Olá, {usuarioAtual}</strong>. Catálogo de produtos sincronizado direto do PrimeStart.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Sincronizar via API</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Puxa o catálogo inteiro de produtos direto do PrimeStart (produção) — todos os atributos, inclusive preços por tabela e estoque por local. Sem tela de upload manual — essa integração é só via API.
            </p>
            <button
              onClick={sincronizarViaApi}
              disabled={sincronizando}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider transition-colors"
            >
              {sincronizando ? 'Sincronizando...' : '🔄 Sincronizar agora'}
            </button>
          </div>

          {feedback.show && (
            <div className={`p-4 rounded-xl border font-bold text-sm ${feedback.tipo === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {feedback.tipo === 'success' ? '✅' : '⚠'} {feedback.msg}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Produtos</h2>
              <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                {totalRegistros} registro(s)
              </span>
            </div>

            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <input
                type="text"
                value={filtroTexto}
                onChange={(e) => { setFiltroTexto(e.target.value); setPagina(0); }}
                placeholder="Buscar por nome, código, marca, categoria ou modelo..."
                className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
              />
              <select
                value={filtroDisponibilidade}
                onChange={(e) => { setFiltroDisponibilidade(e.target.value as typeof filtroDisponibilidade); setPagina(0); }}
                className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
              >
                <option value="todos">Todos</option>
                <option value="locacao">Habilitados p/ Locação</option>
                <option value="venda">Habilitados p/ Venda</option>
              </select>
            </div>

            {gridErro && (
              <p className="mb-3 text-sm font-bold text-red-600">⚠ {gridErro}</p>
            )}

            <div className="overflow-x-auto max-h-96 border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
              {gridLoading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                </div>
              )}
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8] sticky top-0">
                  <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                    <th className="p-2">Código</th>
                    <th className="p-2">Nome</th>
                    <th className="p-2">Categoria</th>
                    <th className="p-2">Marca</th>
                    <th className="p-2">Modelo</th>
                    <th className="p-2">Un.</th>
                    <th className="p-2">Locação</th>
                    <th className="p-2">Venda</th>
                  </tr>
                </thead>
                <tbody>
                  {produtosGrid.length === 0 && !gridLoading ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                        Nenhum produto encontrado.
                      </td>
                    </tr>
                  ) : (
                    produtosGrid.map((p) => (
                      <tr key={p.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer" onClick={() => abrirDetalhe(p.id)}>
                        <td className="p-2 font-mono">{p.codigo_formatado || p.codigo || '—'}</td>
                        <td className="p-2 font-bold">{p.nome_item || '—'}</td>
                        <td className="p-2">{p.categoria_nome || '—'}</td>
                        <td className="p-2">{p.marca_nome || '—'}</td>
                        <td className="p-2">{p.modelo || '—'}</td>
                        <td className="p-2">{p.unidade || '—'}</td>
                        <td className="p-2">{p.habilitado_para_locacao ? <span className="text-green-600 font-bold">Sim</span> : '—'}</td>
                        <td className="p-2">{p.habilitado_para_venda ? <span className="text-green-600 font-bold">Sim</span> : '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 mt-4">
              <button
                onClick={() => setPagina(p => Math.max(0, p - 1))}
                disabled={pagina === 0 || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
              >
                ⬅ Anterior
              </button>
              <span className="text-xs font-bold text-[#64748B]">
                Página {totalRegistros === 0 ? 0 : pagina + 1} de {Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA))}
              </span>
              <button
                onClick={() => setPagina(p => p + 1)}
                disabled={(pagina + 1) * TAMANHO_PAGINA >= totalRegistros || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
              >
                Próxima ➡
              </button>
            </div>
          </div>
        </div>
      </div>

      {(produtoSelecionado || detalheLoading) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setProdutoSelecionado(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            {detalheLoading ? (
              <p className="text-center text-[#64748B] font-bold uppercase text-xs py-8">Carregando...</p>
            ) : produtoSelecionado && (
              <>
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{String(produtoSelecionado.nome_item || '—')}</h2>
                <p className="text-[11px] text-gray-400 font-bold uppercase mb-4">
                  {String(produtoSelecionado.codigo_formatado || produtoSelecionado.codigo || '—')} · {String(produtoSelecionado.categoria_nome || '—')} · {String(produtoSelecionado.marca_nome || '—')}
                </p>

                {Array.isArray(produtoSelecionado.precos) && produtoSelecionado.precos.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-[10px] font-black text-gray-500 uppercase mb-2">Preços por Tabela ({produtoSelecionado.precos.length})</h3>
                    <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {produtoSelecionado.precos.map((p, idx) => (
                            <tr key={idx} className="border-t border-[#E2E8F0] first:border-t-0">
                              <td className="p-2">{p.tabela || '—'}</td>
                              <td className="p-2 text-right font-bold">{formatarMoeda(p.preco)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {Array.isArray(produtoSelecionado.estoques) && produtoSelecionado.estoques.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-[10px] font-black text-gray-500 uppercase mb-2">Estoques ({produtoSelecionado.estoques.length})</h3>
                    <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-[#F8FAFC]">
                          <tr className="text-left text-gray-400 uppercase text-[9px] font-black">
                            <th className="p-2">Estoque</th>
                            <th className="p-2">Localização</th>
                            <th className="p-2 text-right">Custo Médio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {produtoSelecionado.estoques.map((e, idx) => (
                            <tr key={idx} className="border-t border-[#E2E8F0]">
                              <td className="p-2">{e.estoque || '—'}</td>
                              <td className="p-2">{e.localizacao || '—'}</td>
                              <td className="p-2 text-right font-bold">{formatarMoeda(e.custo_medio)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <h3 className="text-[10px] font-black text-gray-500 uppercase mb-2">Demais atributos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {Object.entries(produtoSelecionado)
                    .filter(([campo, valor]) => !CAMPOS_JA_EXIBIDOS.has(campo) && valor !== null && valor !== '' && valor !== false)
                    .map(([campo, valor]) => (
                      <div key={campo} className="flex justify-between gap-2 border-b border-gray-100 py-1">
                        <span className="text-gray-400 font-bold">{humanizar(campo)}</span>
                        <span className="text-right font-medium">{formatarValor(valor)}</span>
                      </div>
                    ))}
                </div>

                <button onClick={() => setProdutoSelecionado(null)} className="w-full mt-5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
