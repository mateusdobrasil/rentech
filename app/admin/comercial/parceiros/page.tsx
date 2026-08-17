"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { sincronizarParceirosP2sAction, sincronizarColaboradoresP2sAction, buscarColaboradoresAction, buscarColaboradorDetalheAction } from './actions';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';

interface ParceiroGrid {
  id: number;
  codigo_parceiro: number | null;
  nome_exibicao: string | null;
  nome_completo: string | null;
  cnpj: string | null;
  cpf: string | null;
  cidade1: string | null;
  estado1: string | null;
  telefone1: string | null;
  flag_cliente: boolean;
  flag_fornecedor: boolean;
}

interface ContatoItem { nome: string | null; cargo: string | null; departamento: string | null; telefone: string | null; email: string | null; principal: boolean; }
interface EnderecoItem { tipo: string | null; endereco_completo: string | null; cidade: string | null; estado: string | null; cep: string | null; observacoes: string | null; }

// Registro completo (todas as colunas) — usado só no modal de detalhe.
type ParceiroCompleto = Record<string, unknown> & { contatos: ContatoItem[] | null; enderecos: EnderecoItem[] | null };

interface ColaboradorGrid {
  id: number;
  codigo_colaborador: number | null;
  nome_exibicao: string | null;
  nome_completo: string | null;
  cpf: string | null;
  status_colaborador: string | null;
  data_admissao: string | null;
  telefone1: string | null;
  email1: string | null;
}

const TAMANHO_PAGINA = 50;

const CAMPOS_JA_EXIBIDOS_PARCEIRO = new Set([
  'id', 'p2s_oid', 'created_at', 'updated_at', 'contatos', 'enderecos',
  'nome_completo', 'nome_exibicao', 'codigo_parceiro', 'cnpj', 'cpf',
  'flag_cliente', 'flag_fornecedor', 'flag_transportadora', 'flag_vendedor_rep', 'flag_intermediador',
  'cidade1', 'estado1', 'telefone1',
]);

const CAMPOS_JA_EXIBIDOS_COLABORADOR = new Set([
  'id', 'p2s_oid', 'created_at', 'updated_at',
  'nome_completo', 'nome_exibicao', 'codigo_colaborador', 'status_colaborador',
  'funcao_padrao', 'funcao_padrao_nome', 'data_admissao',
]);

const humanizar = (campo: string): string =>
  campo.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const formatarValor = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
};

export default function ParceirosPage() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [abaAtiva, setAbaAtiva] = useState<'parceiros' | 'colaboradores'>('parceiros');

  // ---------------------------------------------------------------------
  // ABA PARCEIROS
  // ---------------------------------------------------------------------
  const [sincronizando, setSincronizando] = useState(false);
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; tipo: 'success' | 'error' }>({ show: false, msg: '', tipo: 'success' });

  const [parceirosGrid, setParceirosGrid] = useState<ParceiroGrid[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridErro, setGridErro] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'cliente' | 'fornecedor'>('todos');
  const [pagina, setPagina] = useState(0);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [refreshGrid, setRefreshGrid] = useState(0);

  const [parceiroSelecionado, setParceiroSelecionado] = useState<ParceiroCompleto | null>(null);
  const [detalheLoading, setDetalheLoading] = useState(false);

  useEffect(() => {
    if (authLoading || acessoNegado || abaAtiva !== 'parceiros') return;

    const handle = setTimeout(async () => {
      setGridLoading(true);
      setGridErro('');

      let query = supabase
        .from('parceiros')
        .select('id, codigo_parceiro, nome_exibicao, nome_completo, cnpj, cpf, cidade1, estado1, telefone1, flag_cliente, flag_fornecedor', { count: 'exact' })
        .order('codigo_parceiro', { ascending: true })
        .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);

      if (filtroTipo === 'cliente') query = query.eq('flag_cliente', true);
      else if (filtroTipo === 'fornecedor') query = query.eq('flag_fornecedor', true);

      if (filtroTexto.trim()) {
        const termo = `%${filtroTexto.trim()}%`;
        query = query.or(`nome_exibicao.ilike.${termo},nome_completo.ilike.${termo},cnpj.ilike.${termo},cpf.ilike.${termo},cidade1.ilike.${termo}`);
      }

      const { data, error, count } = await query;
      if (error) {
        setGridErro(error.message);
        setParceirosGrid([]);
      } else {
        setParceirosGrid(data || []);
        setTotalRegistros(count || 0);
      }
      setGridLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, abaAtiva, pagina, filtroTipo, filtroTexto, refreshGrid]);

  const sincronizarViaApi = async () => {
    setSincronizando(true);
    setFeedback({ show: false, msg: '', tipo: 'success' });
    try {
      const res = await sincronizarParceirosP2sAction({}, accessToken);
      if (!res.ok) {
        setFeedback({ show: true, tipo: 'error', msg: `Falha ao sincronizar com o PrimeStart: ${res.erro}` });
        return;
      }
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'SINCRONIZOU PARCEIROS VIA API (P2S)',
        setor: 'COMERCIAL',
        equipamento_nome: `${res.info.processados} registro(s)`,
      });
      setFeedback({ show: true, tipo: 'success', msg: `${res.info.processados} parceiro(s) sincronizado(s) direto do PrimeStart.` });
      setPagina(0);
      setRefreshGrid(v => v + 1);
    } finally {
      setSincronizando(false);
    }
  };

  const abrirDetalhe = async (id: number) => {
    setDetalheLoading(true);
    setParceiroSelecionado(null);
    const { data, error } = await supabase.from('parceiros').select('*').eq('id', id).single();
    if (!error && data) setParceiroSelecionado(data as ParceiroCompleto);
    setDetalheLoading(false);
  };

  // ---------------------------------------------------------------------
  // ABA COLABORADORES — dado sensível, lido via Server Action (não
  // client-side direto) com permissão própria (ver actions.ts). Se a Server
  // Action voltar erro (sem permissão ou outro problema), mostramos um
  // painel de restrição só dentro desta aba, sem afetar a de Parceiros.
  // ---------------------------------------------------------------------
  const [colabSincronizando, setColabSincronizando] = useState(false);
  const [colabFeedback, setColabFeedback] = useState<{ show: boolean; msg: string; tipo: 'success' | 'error' }>({ show: false, msg: '', tipo: 'success' });

  const [colaboradoresGrid, setColaboradoresGrid] = useState<ColaboradorGrid[]>([]);
  const [colabGridLoading, setColabGridLoading] = useState(false);
  const [colabErroAcesso, setColabErroAcesso] = useState('');
  const [filtroTextoColab, setFiltroTextoColab] = useState('');
  const [paginaColab, setPaginaColab] = useState(0);
  const [totalColab, setTotalColab] = useState(0);
  const [refreshColabGrid, setRefreshColabGrid] = useState(0);

  const [colaboradorSelecionado, setColaboradorSelecionado] = useState<Record<string, unknown> | null>(null);
  const [colabDetalheLoading, setColabDetalheLoading] = useState(false);

  useEffect(() => {
    if (authLoading || acessoNegado || abaAtiva !== 'colaboradores') return;

    const handle = setTimeout(async () => {
      setColabGridLoading(true);
      setColabErroAcesso('');

      const res = await buscarColaboradoresAction({ texto: filtroTextoColab, pagina: paginaColab, tamanhoPagina: TAMANHO_PAGINA }, accessToken);
      if (!res.ok) {
        setColabErroAcesso(res.erro || 'Não foi possível carregar os colaboradores.');
        setColaboradoresGrid([]);
        setTotalColab(0);
      } else {
        setColaboradoresGrid(res.info.registros);
        setTotalColab(res.info.total);
      }
      setColabGridLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, abaAtiva, paginaColab, filtroTextoColab, refreshColabGrid, accessToken]);

  const sincronizarColaboradoresViaApi = async () => {
    setColabSincronizando(true);
    setColabFeedback({ show: false, msg: '', tipo: 'success' });
    try {
      const res = await sincronizarColaboradoresP2sAction({}, accessToken);
      if (!res.ok) {
        setColabFeedback({ show: true, tipo: 'error', msg: `Falha ao sincronizar com o PrimeStart: ${res.erro}` });
        return;
      }
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'SINCRONIZOU COLABORADORES VIA API (P2S)',
        setor: 'COMERCIAL',
        equipamento_nome: `${res.info.processados} registro(s)`,
      });
      setColabFeedback({ show: true, tipo: 'success', msg: `${res.info.processados} colaborador(es) sincronizado(s) direto do PrimeStart.` });
      setPaginaColab(0);
      setRefreshColabGrid(v => v + 1);
    } finally {
      setColabSincronizando(false);
    }
  };

  const abrirDetalheColaborador = async (id: number) => {
    setColabDetalheLoading(true);
    setColaboradorSelecionado(null);
    const res = await buscarColaboradorDetalheAction(id, accessToken);
    if (res.ok) setColaboradorSelecionado(res.info as Record<string, unknown>);
    setColabDetalheLoading(false);
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Parceiros.</p>
          <button onClick={() => router.push('/admin/comercial')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
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
          🤝 <strong>Olá, {usuarioAtual}</strong>. Cadastro sincronizado direto do PrimeStart.
        </p>
        <button onClick={() => router.push('/admin/comercial')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">

          <div className="flex gap-2 border-b border-[#E2E8F0]">
            <button
              onClick={() => setAbaAtiva('parceiros')}
              className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${abaAtiva === 'parceiros' ? 'border-[#336699] text-[#0C1D4D]' : 'border-transparent text-[#94A3B8] hover:text-[#64748B]'}`}
            >
              🤝 Parceiros
            </button>
            <button
              onClick={() => setAbaAtiva('colaboradores')}
              className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${abaAtiva === 'colaboradores' ? 'border-[#336699] text-[#0C1D4D]' : 'border-transparent text-[#94A3B8] hover:text-[#64748B]'}`}
            >
              🧑‍💼 Colaboradores
            </button>
          </div>

          {abaAtiva === 'parceiros' && (
            <>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Sincronizar via API</h2>
                <p className="text-xs text-[#64748B] mb-4">
                  Puxa parceiros (clientes e fornecedores) direto do PrimeStart (produção) — dados cadastrais, contatos e endereços. A base é grande, então a sincronização pagina por código e pode levar alguns minutos.
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
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Parceiros</h2>
                  <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                    {totalRegistros} registro(s)
                  </span>
                </div>

                <div className="flex flex-col md:flex-row gap-3 mb-4">
                  <input
                    type="text"
                    value={filtroTexto}
                    onChange={(e) => { setFiltroTexto(e.target.value); setPagina(0); }}
                    placeholder="Buscar por nome, CNPJ, CPF ou cidade..."
                    className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
                  />
                  <select
                    value={filtroTipo}
                    onChange={(e) => { setFiltroTipo(e.target.value as typeof filtroTipo); setPagina(0); }}
                    className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
                  >
                    <option value="todos">Todos</option>
                    <option value="cliente">Clientes</option>
                    <option value="fornecedor">Fornecedores</option>
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
                        <th className="p-2">CNPJ/CPF</th>
                        <th className="p-2">Cidade/UF</th>
                        <th className="p-2">Telefone</th>
                        <th className="p-2">Cliente</th>
                        <th className="p-2">Fornecedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parceirosGrid.length === 0 && !gridLoading ? (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                            Nenhum parceiro encontrado.
                          </td>
                        </tr>
                      ) : (
                        parceirosGrid.map((p) => (
                          <tr key={p.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer" onClick={() => abrirDetalhe(p.id)}>
                            <td className="p-2 font-mono">{p.codigo_parceiro ?? '—'}</td>
                            <td className="p-2 font-bold">{p.nome_exibicao || p.nome_completo || '—'}</td>
                            <td className="p-2">{p.cnpj || p.cpf || '—'}</td>
                            <td className="p-2">{p.cidade1 ? `${p.cidade1}${p.estado1 ? '/' + p.estado1 : ''}` : '—'}</td>
                            <td className="p-2">{p.telefone1 || '—'}</td>
                            <td className="p-2">{p.flag_cliente ? <span className="text-green-600 font-bold">Sim</span> : '—'}</td>
                            <td className="p-2">{p.flag_fornecedor ? <span className="text-green-600 font-bold">Sim</span> : '—'}</td>
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
            </>
          )}

          {abaAtiva === 'colaboradores' && (
            <>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Sincronizar via API</h2>
                <p className="text-xs text-[#64748B] mb-4">
                  Puxa colaboradores direto do PrimeStart (produção) — cadastro completo. Dado sensível: acesso restrito a quem tem permissão própria pra esta aba.
                </p>
                <button
                  onClick={sincronizarColaboradoresViaApi}
                  disabled={colabSincronizando}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider transition-colors"
                >
                  {colabSincronizando ? 'Sincronizando...' : '🔄 Sincronizar agora'}
                </button>
              </div>

              {colabFeedback.show && (
                <div className={`p-4 rounded-xl border font-bold text-sm ${colabFeedback.tipo === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {colabFeedback.tipo === 'success' ? '✅' : '⚠'} {colabFeedback.msg}
                </div>
              )}

              {colabErroAcesso ? (
                <div className="bg-white p-8 rounded-2xl border border-red-200 shadow-sm text-center">
                  <div className="text-4xl mb-3">⛔</div>
                  <h2 className="text-lg font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
                  <p className="text-sm text-gray-500">{colabErroAcesso}</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                    <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Colaboradores</h2>
                    <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                      {totalColab} registro(s)
                    </span>
                  </div>

                  <input
                    type="text"
                    value={filtroTextoColab}
                    onChange={(e) => { setFiltroTextoColab(e.target.value); setPaginaColab(0); }}
                    placeholder="Buscar por nome ou CPF..."
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#336699]"
                  />

                  <div className="overflow-x-auto max-h-96 border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
                    {colabGridLoading && (
                      <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                        <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                      </div>
                    )}
                    <table className="w-full text-xs">
                      <thead className="bg-[#F0F4F8] sticky top-0">
                        <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                          <th className="p-2">Código</th>
                          <th className="p-2">Nome</th>
                          <th className="p-2">CPF</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Admissão</th>
                          <th className="p-2">Telefone</th>
                          <th className="p-2">E-mail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colaboradoresGrid.length === 0 && !colabGridLoading ? (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                              Nenhum colaborador encontrado.
                            </td>
                          </tr>
                        ) : (
                          colaboradoresGrid.map((c) => (
                            <tr key={c.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer" onClick={() => abrirDetalheColaborador(c.id)}>
                              <td className="p-2 font-mono">{c.codigo_colaborador ?? '—'}</td>
                              <td className="p-2 font-bold">{c.nome_exibicao || c.nome_completo || '—'}</td>
                              <td className="p-2">{c.cpf || '—'}</td>
                              <td className="p-2">{c.status_colaborador === 'A' ? <span className="text-green-600 font-bold">Ativo</span> : (c.status_colaborador || '—')}</td>
                              <td className="p-2">{c.data_admissao || '—'}</td>
                              <td className="p-2">{c.telefone1 || '—'}</td>
                              <td className="p-2">{c.email1 || '—'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap justify-between items-center gap-2 mt-4">
                    <button
                      onClick={() => setPaginaColab(p => Math.max(0, p - 1))}
                      disabled={paginaColab === 0 || colabGridLoading}
                      className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
                    >
                      ⬅ Anterior
                    </button>
                    <span className="text-xs font-bold text-[#64748B]">
                      Página {totalColab === 0 ? 0 : paginaColab + 1} de {Math.max(1, Math.ceil(totalColab / TAMANHO_PAGINA))}
                    </span>
                    <button
                      onClick={() => setPaginaColab(p => p + 1)}
                      disabled={(paginaColab + 1) * TAMANHO_PAGINA >= totalColab || colabGridLoading}
                      className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
                    >
                      Próxima ➡
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {(parceiroSelecionado || detalheLoading) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setParceiroSelecionado(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            {detalheLoading ? (
              <p className="text-center text-[#64748B] font-bold uppercase text-xs py-8">Carregando...</p>
            ) : parceiroSelecionado && (
              <>
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{String(parceiroSelecionado.nome_exibicao || parceiroSelecionado.nome_completo || '—')}</h2>
                <p className="text-[11px] text-gray-400 font-bold uppercase mb-1">
                  {String(parceiroSelecionado.codigo_parceiro ?? '—')} · {String(parceiroSelecionado.cnpj || parceiroSelecionado.cpf || '—')}
                </p>
                <p className="text-[11px] text-gray-400 font-bold uppercase mb-4">
                  {parceiroSelecionado.flag_cliente ? 'Cliente' : ''}{parceiroSelecionado.flag_cliente && parceiroSelecionado.flag_fornecedor ? ' · ' : ''}{parceiroSelecionado.flag_fornecedor ? 'Fornecedor' : ''}
                  {!parceiroSelecionado.flag_cliente && !parceiroSelecionado.flag_fornecedor ? '—' : ''}
                </p>

                {Array.isArray(parceiroSelecionado.contatos) && parceiroSelecionado.contatos.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-[10px] font-black text-gray-500 uppercase mb-2">Contatos ({parceiroSelecionado.contatos.length})</h3>
                    <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {parceiroSelecionado.contatos.map((c, idx) => (
                            <tr key={idx} className="border-t border-[#E2E8F0] first:border-t-0">
                              <td className="p-2 font-bold">{c.nome || '—'}{c.principal ? ' ⭐' : ''}</td>
                              <td className="p-2">{c.cargo || c.departamento || '—'}</td>
                              <td className="p-2">{c.telefone || '—'}</td>
                              <td className="p-2">{c.email || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {Array.isArray(parceiroSelecionado.enderecos) && parceiroSelecionado.enderecos.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-[10px] font-black text-gray-500 uppercase mb-2">Endereços ({parceiroSelecionado.enderecos.length})</h3>
                    <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <tbody>
                          {parceiroSelecionado.enderecos.map((e, idx) => (
                            <tr key={idx} className="border-t border-[#E2E8F0] first:border-t-0">
                              <td className="p-2">{e.tipo || '—'}</td>
                              <td className="p-2 font-bold">{e.endereco_completo || '—'}</td>
                              <td className="p-2">{e.cidade || '—'}{e.estado ? '/' + e.estado : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <h3 className="text-[10px] font-black text-gray-500 uppercase mb-2">Demais atributos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {Object.entries(parceiroSelecionado)
                    .filter(([campo, valor]) => !CAMPOS_JA_EXIBIDOS_PARCEIRO.has(campo) && valor !== null && valor !== '' && valor !== false)
                    .map(([campo, valor]) => (
                      <div key={campo} className="flex justify-between gap-2 border-b border-gray-100 py-1">
                        <span className="text-gray-400 font-bold">{humanizar(campo)}</span>
                        <span className="text-right font-medium">{formatarValor(valor)}</span>
                      </div>
                    ))}
                </div>

                <button onClick={() => setParceiroSelecionado(null)} className="w-full mt-5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {(colaboradorSelecionado || colabDetalheLoading) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setColaboradorSelecionado(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            {colabDetalheLoading ? (
              <p className="text-center text-[#64748B] font-bold uppercase text-xs py-8">Carregando...</p>
            ) : colaboradorSelecionado && (
              <>
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{String(colaboradorSelecionado.nome_exibicao || colaboradorSelecionado.nome_completo || '—')}</h2>
                <p className="text-[11px] text-gray-400 font-bold uppercase mb-4">
                  {String(colaboradorSelecionado.codigo_colaborador ?? '—')} · {String(colaboradorSelecionado.funcao_padrao_nome || '—')} · {colaboradorSelecionado.status_colaborador === 'A' ? 'Ativo' : String(colaboradorSelecionado.status_colaborador || '—')}
                </p>

                <h3 className="text-[10px] font-black text-gray-500 uppercase mb-2">Demais atributos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {Object.entries(colaboradorSelecionado)
                    .filter(([campo, valor]) => !CAMPOS_JA_EXIBIDOS_COLABORADOR.has(campo) && valor !== null && valor !== '' && valor !== false)
                    .map(([campo, valor]) => (
                      <div key={campo} className="flex justify-between gap-2 border-b border-gray-100 py-1">
                        <span className="text-gray-400 font-bold">{humanizar(campo)}</span>
                        <span className="text-right font-medium">{formatarValor(valor)}</span>
                      </div>
                    ))}
                </div>

                <button onClick={() => setColaboradorSelecionado(null)} className="w-full mt-5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">
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
