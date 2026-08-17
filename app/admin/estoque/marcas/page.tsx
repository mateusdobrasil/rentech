"use client";

// app/admin/estoque/marcas/page.tsx
// Visão somente-leitura das marcas já presentes no catálogo de Produtos
// (sincronizado do PrimeStart em /admin/estoque/produtos) — sem tabela
// própria, sem sincronização própria. Agrupa `produtos.marca_nome` no
// client (catálogo pequeno, ~500 registros) e permite abrir a lista de
// produtos de uma marca reaproveitando as mesmas colunas/modal de detalhe
// da tela de Produtos.
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';

interface ProdutoGrid {
  id: number;
  codigo: number | null;
  codigo_formatado: string | null;
  nome_item: string | null;
  categoria_nome: string | null;
  modelo: string | null;
  unidade: string | null;
  habilitado_para_locacao: boolean;
  habilitado_para_venda: boolean;
}

interface Marca {
  nome: string;
  qtdProdutos: number;
}

const CAMPOS_JA_EXIBIDOS = new Set([
  'id', 'p2s_oid', 'created_at', 'updated_at', 'precos', 'estoques',
  'nome_item', 'codigo', 'codigo_formatado', 'categoria_nome', 'sub_categoria_nome', 'marca_nome',
  'categoria', 'sub_categoria', 'marca',
]);

const humanizar = (campo: string): string =>
  campo.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const formatarValor = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
};

export default function MarcasPage() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente } = usePageAccess();

  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [listaLoading, setListaLoading] = useState(false);
  const [listaErro, setListaErro] = useState('');
  const [buscaMarca, setBuscaMarca] = useState('');

  const [marcaSelecionada, setMarcaSelecionada] = useState<string | null>(null);
  const [produtosMarca, setProdutosMarca] = useState<ProdutoGrid[]>([]);
  const [produtosLoading, setProdutosLoading] = useState(false);

  const [produtoSelecionado, setProdutoSelecionado] = useState<Record<string, unknown> | null>(null);
  const [detalheLoading, setDetalheLoading] = useState(false);

  useEffect(() => {
    if (authLoading || acessoNegado) return;

    (async () => {
      setListaLoading(true);
      setListaErro('');
      const { data, error } = await supabase.from('produtos').select('marca_nome').not('marca_nome', 'is', null);
      if (error) {
        setListaErro(error.message);
        setMarcas([]);
      } else {
        const contagem = new Map<string, number>();
        (data || []).forEach(p => {
          const nome = (p.marca_nome as string) || '';
          if (!nome) return;
          contagem.set(nome, (contagem.get(nome) || 0) + 1);
        });
        const lista = [...contagem.entries()]
          .map(([nome, qtdProdutos]) => ({ nome, qtdProdutos }))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        setMarcas(lista);
      }
      setListaLoading(false);
    })();
  }, [authLoading, acessoNegado]);

  const marcasFiltradas = useMemo(() => {
    const termo = buscaMarca.trim().toLowerCase();
    if (!termo) return marcas;
    return marcas.filter(m => m.nome.toLowerCase().includes(termo));
  }, [marcas, buscaMarca]);

  const abrirMarca = async (nome: string) => {
    setMarcaSelecionada(nome);
    setProdutosLoading(true);
    setProdutosMarca([]);
    const { data, error } = await supabase
      .from('produtos')
      .select('id, codigo, codigo_formatado, nome_item, categoria_nome, modelo, unidade, habilitado_para_locacao, habilitado_para_venda')
      .eq('marca_nome', nome)
      .order('nome_item', { ascending: true });
    if (!error) setProdutosMarca(data || []);
    setProdutosLoading(false);
  };

  const abrirDetalheProduto = async (id: number) => {
    setDetalheLoading(true);
    setProdutoSelecionado(null);
    const { data, error } = await supabase.from('produtos').select('*').eq('id', id).single();
    if (!error && data) setProdutoSelecionado(data as Record<string, unknown>);
    setDetalheLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Marcas.</p>
          <button onClick={() => router.push('/admin/estoque')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
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
          🏷️ <strong>Olá, {usuarioAtual}</strong>. Marcas dos produtos sincronizados do PrimeStart — somente leitura.
        </p>
        <button
          onClick={() => (marcaSelecionada ? setMarcaSelecionada(null) : router.push('/admin/estoque'))}
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ {marcaSelecionada ? 'VOLTAR ÀS MARCAS' : 'VOLTAR AO HUB'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">

          {!marcaSelecionada ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Marcas</h2>
                <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                  {marcas.length} marca(s)
                </span>
              </div>

              <input
                type="text"
                value={buscaMarca}
                onChange={(e) => setBuscaMarca(e.target.value)}
                placeholder="Buscar marca..."
                className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#336699]"
              />

              {listaErro && <p className="mb-3 text-sm font-bold text-red-600">⚠ {listaErro}</p>}

              {listaLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                </div>
              ) : marcasFiltradas.length === 0 ? (
                <p className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">Nenhuma marca encontrada.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {marcasFiltradas.map(m => (
                    <button
                      key={m.nome}
                      onClick={() => abrirMarca(m.nome)}
                      className="text-left bg-[#F8FAFC] hover:bg-[#F0F4F8] border border-[#E2E8F0] hover:border-[#336699] rounded-xl p-4 transition-colors"
                    >
                      <p className="font-black text-[#0C1D4D] text-sm truncate">{m.nome}</p>
                      <p className="text-xs text-[#64748B] font-medium mt-1">{m.qtdProdutos} produto(s)</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">{marcaSelecionada}</h2>
                <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                  {produtosMarca.length} produto(s)
                </span>
              </div>

              <div className="overflow-x-auto max-h-[28rem] border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
                {produtosLoading && (
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
                      <th className="p-2">Modelo</th>
                      <th className="p-2">Un.</th>
                      <th className="p-2">Locação</th>
                      <th className="p-2">Venda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produtosMarca.length === 0 && !produtosLoading ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                          Nenhum produto encontrado.
                        </td>
                      </tr>
                    ) : (
                      produtosMarca.map((p) => (
                        <tr key={p.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer" onClick={() => abrirDetalheProduto(p.id)}>
                          <td className="p-2 font-mono">{p.codigo_formatado || p.codigo || '—'}</td>
                          <td className="p-2 font-bold">{p.nome_item || '—'}</td>
                          <td className="p-2">{p.categoria_nome || '—'}</td>
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
            </div>
          )}
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
