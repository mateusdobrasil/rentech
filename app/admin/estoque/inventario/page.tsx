"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import * as XLSX from 'xlsx';
import {
  listarInventariosAction, criarInventarioAction, carregarInventarioAction, contarItemAction,
  lerPecaInventarioAction, removerPecaInventarioAction, concluirInventarioAction, cancelarInventarioAction,
} from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import LeitorQR, { bipLeitura } from '../../../components/ui/LeitorQR';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda } from '../../../lib/formatadores';

// Inventário de estoque (2026-11-17). Regras em ./actions.ts.

interface Inventario {
  id: number; empresa_id: number; nome: string; local: string | null; categorias: string[] | null;
  status: 'ABERTO' | 'CONCLUIDO' | 'CANCELADO'; criado_por: string; criado_em: string; concluido_por: string | null; concluido_em: string | null;
  resumo_aplicacao: any; total_itens?: number; contados?: number;
}
interface Item {
  id: number; produto_id: number; controle: 'INDIVIDUAL' | 'QUANTIDADE'; saldo_sistema: number; manutencao_sistema: number; em_locacao: number;
  contado: number | null; contado_por: string | null; contado_em: string | null; observacao: string | null;
  nome: string; codigo: string | null; categoria: string | null; unidade: string | null; valor_unitario: number | null;
}
interface Peca { id: number; codigo: string; patrimonio_id: number | null; produto_id: number | null; numero: string | null; lido_por: string; lido_em: string }
type Aba = 'contar' | 'qr' | 'divergencias';

const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
function lerNum(s: string): number | null {
  const t = (s || '').trim();
  if (!t) return null;
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(v) ? v : NaN;
}
const esperado = (i: Item) => Math.max(0, i.saldo_sistema - i.em_locacao);

export default function InventarioPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  // lista
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [categoriasDisp, setCategoriasDisp] = useState<string[]>([]);
  const [locaisDisp, setLocaisDisp] = useState<string[]>([]);
  const [inventarios, setInventarios] = useState<Inventario[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [modalNovo, setModalNovo] = useState(false);
  const [novo, setNovo] = useState({ empresa_id: 0, nome: '', local: '', categorias: [] as string[], buscaCat: '' });
  const [criando, setCriando] = useState(false);

  // detalhe
  const [inv, setInv] = useState<Inventario | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [pecas, setPecas] = useState<Peca[]>([]);
  const [esperados, setEsperados] = useState<{ id: number; produto_id: number; numero_patrimonio: string; situacao: string }[]>([]);
  const [aba, setAba] = useState<Aba>('contar');
  const [cega, setCega] = useState(true);
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [filtro, setFiltro] = useState<'pendentes' | 'contados' | 'todos'>('pendentes');
  const [edicao, setEdicao] = useState<Record<number, string>>({});
  const [msgQR, setMsgQR] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null);
  const [soDiferenca, setSoDiferenca] = useState(true);
  const [modalConcluir, setModalConcluir] = useState(false);
  const [marcarExtraviados, setMarcarExtraviados] = useState(false);
  const [concluindo, setConcluindo] = useState(false);

  const carregarLista = useCallback(async () => {
    setCarregandoLista(true);
    const r = await listarInventariosAction(accessToken);
    if (r.ok) { setEmpresas(r.info.empresas); setCategoriasDisp(r.info.categorias); setLocaisDisp(r.info.locais); setInventarios(r.info.inventarios); }
    else toast(r.erro || 'Erro.', 'error');
    setCarregandoLista(false);
  }, [accessToken, toast]);

  const abrir = useCallback(async (id: number) => {
    const r = await carregarInventarioAction(id, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro ao abrir.', 'error');
    setInv(r.info.inventario); setItens(r.info.itens); setPecas(r.info.pecas); setEsperados(r.info.esperados);
    setEdicao({});
  }, [accessToken, toast]);

  useEffect(() => {
    if (!authLoading && !acessoNegado && !erro && accessToken) carregarLista();
  }, [authLoading, acessoNegado, erro, accessToken, carregarLista]);

  const nomeEmpresa = (id: number) => empresas.find(e => e.id === id)?.nome || '';
  const aberto = inv?.status === 'ABERTO';

  // ---------------- criar ----------------
  const abrirNovo = () => {
    const mes = new Date().toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');
    setNovo({ empresa_id: empresas[0]?.id || 0, nome: `Inventário ${mes}`, local: '', categorias: [], buscaCat: '' });
    setModalNovo(true);
  };
  const criar = async () => {
    setCriando(true);
    const r = await criarInventarioAction({ empresa_id: novo.empresa_id, nome: novo.nome, local: novo.local || null, categorias: novo.categorias }, accessToken);
    setCriando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    setModalNovo(false);
    toast('Inventário aberto — saldos do sistema congelados.', 'success');
    await carregarLista();
    abrir(r.info.id);
  };

  // ---------------- contar ----------------
  const salvarContagem = async (it: Item) => {
    const txt = edicao[it.id];
    if (txt === undefined) return;
    const v = lerNum(txt);
    if (Number.isNaN(v)) return toast('Quantidade inválida.', 'error');
    const r = await contarItemAction(it.id, v, it.observacao, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    setItens(prev => prev.map(x => x.id === it.id ? { ...x, contado: v, contado_por: v === null ? null : r.info.contado_por, contado_em: new Date().toISOString() } : x));
    setEdicao(e => { const c = { ...e }; delete c[it.id]; return c; });
  };

  const lerQR = async (codigo: string) => {
    if (!inv) return;
    const r = await lerPecaInventarioAction(inv.id, codigo, accessToken);
    if (!r.ok) { setMsgQR({ tipo: r.info?.duplicada ? 'aviso' : 'erro', texto: r.erro || 'Erro.' }); bipLeitura(false); return; }
    if (r.info.desconhecido) { setMsgQR({ tipo: 'aviso', texto: `Código ${r.info.codigo} não é de nenhum patrimônio cadastrado — ficou como desconhecido.` }); bipLeitura(false); }
    else {
      setMsgQR({ tipo: r.info.situacao === 'ATIVO' || r.info.situacao === 'MANUTENCAO' ? 'ok' : 'aviso', texto: `✔ ${r.info.numero} — ${r.info.produto} (${r.info.contagem} lida(s) deste produto)${r.info.situacao === 'EXTRAVIADO' ? ' · estava EXTRAVIADO: volta a ativo ao concluir' : r.info.situacao === 'BAIXADO' ? ' · está BAIXADO' : ''}` });
      bipLeitura(true);
    }
    abrir(inv.id);
  };

  const removerPeca = async (p: Peca) => {
    const r = await removerPecaInventarioAction(p.id, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    if (inv) abrir(inv.id);
  };

  // ---------------- divergências ----------------
  const contados = itens.filter(i => i.contado !== null);
  const linhasDiv = contados.map(i => ({ ...i, esperado: esperado(i), diferenca: (i.contado || 0) - esperado(i) }));
  const comDif = linhasDiv.filter(l => Math.abs(l.diferenca) > 0.0005);
  const valorDif = comDif.reduce((s, l) => s + l.diferenca * (l.valor_unitario || 0), 0);
  const lidosSet = new Set(pecas.map(p => p.patrimonio_id).filter(Boolean));
  const naoLidos = esperados.filter(e => !lidosSet.has(e.id));
  const desconhecidos = pecas.filter(p => !p.patrimonio_id);
  const emLocacaoPorProduto = new Map(itens.map(i => [i.produto_id, i.em_locacao]));

  const visiveis = useMemo(() => itens.filter(i => {
    if (filtro === 'pendentes' && i.contado !== null) return false;
    if (filtro === 'contados' && i.contado === null) return false;
    if (categoria && i.categoria !== categoria) return false;
    const t = busca.trim().toLowerCase();
    if (t && ![i.nome, i.codigo, i.categoria].some(x => (x || '').toLowerCase().includes(t))) return false;
    return true;
  }), [itens, filtro, categoria, busca]);
  const categoriasInv = useMemo(() => [...new Set(itens.map(i => i.categoria).filter(Boolean) as string[])].sort(), [itens]);

  const exportar = () => {
    if (!inv) return;
    const ws = XLSX.utils.json_to_sheet(itens.map(i => ({
      Código: i.codigo, Produto: i.nome, Categoria: i.categoria, Controle: i.controle === 'INDIVIDUAL' ? 'Patrimônio' : 'Quantidade',
      'Saldo sistema': i.saldo_sistema, 'Em locação': i.em_locacao, 'Esperado no depósito': esperado(i), Contado: i.contado,
      Diferença: i.contado === null ? null : i.contado - esperado(i), 'Valor unitário': i.valor_unitario,
      'Valor da diferença': i.contado === null || !i.valor_unitario ? null : (i.contado - esperado(i)) * i.valor_unitario,
      'Contado por': i.contado_por, Observação: i.observacao,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventário');
    if (naoLidos.length || desconhecidos.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        ...naoLidos.map(e => ({ Tipo: 'Não encontrado', Patrimônio: e.numero_patrimonio, Produto: itens.find(i => i.produto_id === e.produto_id)?.nome })),
        ...desconhecidos.map(d => ({ Tipo: 'Código desconhecido', Patrimônio: d.codigo, Produto: '' })),
      ]), 'Patrimônios');
    }
    XLSX.writeFile(wb, `inventario-${inv.id}.xlsx`);
  };

  const concluir = async () => {
    if (!inv) return;
    setConcluindo(true);
    const r = await concluirInventarioAction(inv.id, { marcarExtraviados }, accessToken);
    setConcluindo(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    setModalConcluir(false);
    toast(`Inventário concluído: ${r.info.saldosAjustados} saldo(s) ajustado(s)${r.info.extraviados ? `, ${r.info.extraviados} extraviado(s)` : ''}${r.info.reativados ? `, ${r.info.reativados} reativado(s)` : ''}.`, 'success');
    abrir(inv.id);
    carregarLista();
  };

  const cancelar = async () => {
    if (!inv || !(await confirmar({ title: 'Cancelar inventário', danger: true, confirmLabel: 'Cancelar inventário', message: 'As contagens ficam registradas, mas nada é aplicado no estoque.' }))) return;
    const r = await cancelarInventarioAction(inv.id, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    abrir(inv.id); carregarLista();
  };

  // ============================================================================
  if (authLoading) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Inventário.</p>
          <button onClick={() => router.push('/admin/estoque')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]';
  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';
  const progresso = itens.length ? contados.length / itens.length : 0;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">🧮 <strong>Olá, {usuarioAtual}</strong>. Inventário de estoque.</p>
        <button onClick={() => (inv ? (setInv(null), carregarLista()) : router.push('/admin/estoque'))}
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg shadow-sm tracking-wider uppercase">
          ⬅ {inv ? 'VOLTAR AOS INVENTÁRIOS' : 'VOLTAR AO HUB'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-8">
        <div className="max-w-6xl mx-auto space-y-4">

          {/* ===================== LISTA ===================== */}
          {!inv && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Inventários</h2>
                  <p className="text-xs text-gray-500">Geral (na virada do P2S) ou parcial, por local e/ou categorias. O que está em locação não é contado no depósito.</p>
                </div>
                <button onClick={abrirNovo} disabled={!empresas.length} className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold uppercase text-xs tracking-wider">+ Novo inventário</button>
              </div>
              {carregandoLista ? <p className="text-sm text-gray-400 py-6 text-center">Carregando...</p> : inventarios.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">Nenhum inventário ainda.</p>
              ) : (
                <div className="space-y-2">
                  {inventarios.map(i => {
                    const p = i.total_itens ? (i.contados || 0) / i.total_itens : 0;
                    return (
                      <button key={i.id} onClick={() => abrir(i.id)} className="w-full text-left border border-[#E2E8F0] hover:border-[#336699] rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-[#0C1D4D]">#{i.id} · {i.nome}</p>
                          <p className="text-[10px] text-gray-500">
                            <span className={`font-black px-1.5 py-0.5 rounded-full uppercase mr-1 ${corSeloEmpresa(i.empresa_id)}`}>{nomeEmpresa(i.empresa_id)}</span>
                            {i.local ? `local ${i.local} · ` : ''}{i.categorias?.length ? `${i.categorias.length} categoria(s) · ` : 'todas as categorias · '}
                            aberto por {i.criado_por} em {new Date(i.criado_em).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                        <div className="w-full md:w-48">
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#336699]" style={{ width: `${p * 100}%` }} /></div>
                          <p className="text-[10px] text-gray-500 mt-1">{i.contados}/{i.total_itens} contados</p>
                        </div>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase self-start md:self-center ${i.status === 'ABERTO' ? 'bg-blue-100 text-blue-700' : i.status === 'CONCLUIDO' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{i.status === 'ABERTO' ? 'Em contagem' : i.status === 'CONCLUIDO' ? 'Concluído' : 'Cancelado'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===================== DETALHE ===================== */}
          {inv && (
            <>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
                <div className="flex flex-col md:flex-row justify-between items-start gap-3">
                  <div>
                    <h1 className="text-xl font-black text-[#0C1D4D]">#{inv.id} · {inv.nome}</h1>
                    <p className="text-xs text-gray-500">
                      <span className={`font-black px-1.5 py-0.5 rounded-full uppercase mr-1 text-[10px] ${corSeloEmpresa(inv.empresa_id)}`}>{nomeEmpresa(inv.empresa_id)}</span>
                      {inv.local ? `Local ${inv.local}` : 'Todos os locais'} · {inv.categorias?.length ? inv.categorias.join(', ') : 'todas as categorias'}
                    </p>
                    {inv.status === 'CONCLUIDO' && inv.resumo_aplicacao && (
                      <p className="text-xs text-emerald-700 font-bold mt-1">Concluído por {inv.concluido_por} em {new Date(inv.concluido_em!).toLocaleString('pt-BR')}: {inv.resumo_aplicacao.saldosAjustados} saldo(s) ajustado(s), {inv.resumo_aplicacao.extraviados} extraviado(s), {inv.resumo_aplicacao.naoContados} não contado(s).</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={exportar} className="px-3 py-2 rounded-lg text-[10px] font-black uppercase border border-[#CBD5E1] text-[#0C1D4D] bg-white">⬇ Excel</button>
                    {aberto && <button onClick={cancelar} className="px-3 py-2 rounded-lg text-[10px] font-black uppercase border border-red-200 text-red-600 bg-white">Cancelar</button>}
                    {aberto && <button onClick={() => setModalConcluir(true)} className="px-4 py-2 rounded-lg text-[10px] font-black uppercase bg-emerald-600 hover:bg-emerald-700 text-white">✔ Concluir e aplicar</button>}
                  </div>
                </div>
                <div className="mt-3">
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-[#336699]" style={{ width: `${progresso * 100}%` }} /></div>
                  <p className="text-[10px] text-gray-500 mt-1">{contados.length} de {itens.length} produtos contados · {comDif.length} com diferença · {pecas.length} etiqueta(s) lida(s)</p>
                </div>
              </div>

              <div className="flex rounded-xl border border-[#CBD5E1] overflow-hidden bg-white">
                {([['contar', '🔢 Contar'], ['qr', '📷 Patrimônios'], ['divergencias', `⚠ Divergências (${comDif.length + naoLidos.length + desconhecidos.length})`]] as [Aba, string][]).map(([a, r]) => (
                  <button key={a} onClick={() => setAba(a)} className={`flex-1 py-3 text-xs font-black uppercase ${aba === a ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>{r}</button>
                ))}
              </div>

              {/* ---------- CONTAR ---------- */}
              {aba === 'contar' && (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 md:p-5 space-y-3">
                  <div className="flex flex-wrap gap-2 items-center">
                    <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto ou código..." className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]" />
                    <select value={categoria} onChange={e => setCategoria(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold max-w-[180px]">
                      <option value="">Todas as categorias</option>
                      {categoriasInv.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={filtro} onChange={e => setFiltro(e.target.value as any)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold">
                      <option value="pendentes">Não contados</option><option value="contados">Contados</option><option value="todos">Todos</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-[10px] font-black uppercase text-gray-500"><input type="checkbox" checked={cega} onChange={e => setCega(e.target.checked)} />Contagem cega</label>
                  </div>
                  {cega && <p className="text-[10px] text-gray-400">Contagem cega: o esperado fica escondido para não influenciar quem conta (desmarque para ver).</p>}
                  <div className="divide-y divide-[#F1F5F9]">
                    {visiveis.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">Nada aqui.</p>}
                    {visiveis.slice(0, 300).map(i => (
                      <div key={i.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm text-[#0C1D4D]">{i.nome}</p>
                          <p className="text-[10px] text-gray-400">
                            {[i.codigo, i.unidade, i.categoria].filter(Boolean).join(' · ')}
                            {!cega && <> · esperado <strong>{fmt(esperado(i))}</strong>{i.em_locacao ? ` (saldo ${fmt(i.saldo_sistema)} − ${fmt(i.em_locacao)} em locação)` : ''}</>}
                            {i.contado_por && <span className="text-emerald-700 font-bold"> · contado por {i.contado_por}</span>}
                          </p>
                        </div>
                        {i.controle === 'INDIVIDUAL' ? (
                          <button onClick={() => setAba('qr')} className="text-xs font-black text-[#336699] border border-[#336699] rounded-lg px-3 py-2 whitespace-nowrap">
                            {i.contado ?? 0} lida(s) · ler QR
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <input value={edicao[i.id] ?? (i.contado === null ? '' : String(i.contado).replace('.', ','))}
                              onChange={e => setEdicao(x => ({ ...x, [i.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') salvarContagem(i); }}
                              disabled={!aberto} inputMode="decimal" placeholder="qtd"
                              className={`w-24 border-2 rounded-lg px-3 py-2 text-lg font-black text-right ${i.contado !== null && edicao[i.id] === undefined ? 'border-emerald-300 bg-emerald-50' : 'border-[#CBD5E1]'}`} />
                            {aberto && edicao[i.id] !== undefined && <button onClick={() => salvarContagem(i)} className="bg-[#0C1D4D] text-white rounded-lg px-3 py-2.5 text-xs font-black">OK</button>}
                          </div>
                        )}
                      </div>
                    ))}
                    {visiveis.length > 300 && <p className="text-[10px] text-gray-400 pt-2">Mostrando 300 de {visiveis.length} — use a busca ou a categoria.</p>}
                  </div>
                </div>
              )}

              {/* ---------- PATRIMÔNIOS (QR) ---------- */}
              {aba === 'qr' && (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 md:p-5 space-y-3">
                  {aberto ? <LeitorQR onLer={lerQR} /> : <p className="text-xs text-gray-500">Inventário encerrado — só consulta.</p>}
                  {msgQR && <p className={`text-sm font-bold rounded-lg p-3 border ${msgQR.tipo === 'ok' ? 'bg-green-50 border-green-200 text-green-700' : msgQR.tipo === 'aviso' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msgQR.texto}</p>}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-black text-gray-500 uppercase mb-1">Por produto (lidas / esperadas no depósito)</p>
                      <ul className="text-xs divide-y divide-[#F1F5F9] border border-[#E2E8F0] rounded-lg max-h-80 overflow-y-auto">
                        {itens.filter(i => i.controle === 'INDIVIDUAL').map(i => {
                          const c = i.contado || 0, e = esperado(i);
                          return (
                            <li key={i.id} className="flex justify-between px-3 py-2 gap-2">
                              <span className="truncate">{i.nome}</span>
                              <span className={`font-black whitespace-nowrap ${c === e ? 'text-emerald-700' : c > e ? 'text-blue-700' : 'text-[#0C1D4D]'}`}>{c} / {fmt(e)}</span>
                            </li>
                          );
                        })}
                        {!itens.some(i => i.controle === 'INDIVIDUAL') && <li className="px-3 py-3 text-gray-400">Nenhum produto por patrimônio neste inventário.</li>}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-500 uppercase mb-1">Últimas leituras ({pecas.length})</p>
                      <ul className="text-xs divide-y divide-[#F1F5F9] border border-[#E2E8F0] rounded-lg max-h-80 overflow-y-auto">
                        {[...pecas].reverse().slice(0, 100).map(p => (
                          <li key={p.id} className="flex justify-between px-3 py-1.5 gap-2">
                            <span className={p.patrimonio_id ? 'font-bold text-[#0C1D4D]' : 'font-bold text-amber-700'}>{p.numero || p.codigo}{!p.patrimonio_id && ' (desconhecido)'}</span>
                            <span className="text-gray-400 whitespace-nowrap">{p.lido_por}{aberto && <button onClick={() => removerPeca(p)} className="ml-2 text-red-400 font-bold">desfazer</button>}</span>
                          </li>
                        ))}
                        {pecas.length === 0 && <li className="px-3 py-3 text-gray-400">Nenhuma leitura.</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------- DIVERGÊNCIAS ---------- */}
              {aba === 'divergencias' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0]"><p className="text-xl font-black text-[#0C1D4D]">{comDif.filter(l => l.diferenca < 0).length}</p><p className="text-[9px] font-black text-gray-500 uppercase">Produtos com falta</p></div>
                    <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0]"><p className="text-xl font-black text-[#0C1D4D]">{comDif.filter(l => l.diferenca > 0).length}</p><p className="text-[9px] font-black text-gray-500 uppercase">Produtos com sobra</p></div>
                    <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0]"><p className={`text-xl font-black ${valorDif < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatarMoeda(valorDif)}</p><p className="text-[9px] font-black text-gray-500 uppercase">Diferença em valor (reposição)</p></div>
                    <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0]"><p className="text-xl font-black text-amber-600">{itens.length - contados.length}</p><p className="text-[9px] font-black text-gray-500 uppercase">Ainda não contados</p></div>
                  </div>
                  <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 md:p-5">
                    <label className="flex items-center gap-2 text-[10px] font-black uppercase text-gray-500 mb-2"><input type="checkbox" checked={soDiferenca} onChange={e => setSoDiferenca(e.target.checked)} />Só com diferença</label>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-[10px] font-black text-gray-500 uppercase border-b border-[#E2E8F0]">
                          <th className="p-2">Produto</th><th className="p-2 text-right">Saldo</th><th className="p-2 text-right">Em locação</th><th className="p-2 text-right">Esperado</th><th className="p-2 text-right">Contado</th><th className="p-2 text-right">Diferença</th><th className="p-2 text-right">Valor</th>
                        </tr></thead>
                        <tbody>
                          {(soDiferenca ? comDif : linhasDiv).sort((a, b) => Math.abs(b.diferenca * (b.valor_unitario || 1)) - Math.abs(a.diferenca * (a.valor_unitario || 1))).map(l => (
                            <tr key={l.id} className="border-b border-[#F1F5F9]">
                              <td className="p-2"><p className="font-bold text-[#0C1D4D]">{l.nome}</p><p className="text-[10px] text-gray-400">{[l.codigo, l.contado_por].filter(Boolean).join(' · ')}</p></td>
                              <td className="p-2 text-right">{fmt(l.saldo_sistema)}</td>
                              <td className="p-2 text-right text-gray-500">{fmt(l.em_locacao)}</td>
                              <td className="p-2 text-right">{fmt(l.esperado)}</td>
                              <td className="p-2 text-right font-bold">{fmt(l.contado || 0)}</td>
                              <td className={`p-2 text-right font-black ${l.diferenca < 0 ? 'text-red-600' : l.diferenca > 0 ? 'text-blue-700' : 'text-gray-300'}`}>{l.diferenca > 0 ? '+' : ''}{fmt(l.diferenca)}</td>
                              <td className="p-2 text-right whitespace-nowrap">{l.valor_unitario ? formatarMoeda(l.diferenca * l.valor_unitario) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {(naoLidos.length > 0 || desconhecidos.length > 0) && (
                    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 md:p-5 grid md:grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="text-[10px] font-black text-red-600 uppercase mb-1">Patrimônios não lidos ({naoLidos.length})</p>
                        <p className="text-[10px] text-gray-400 mb-1">Se o produto tem peças em locação, parte deles pode estar com cliente.</p>
                        <ul className="max-h-60 overflow-y-auto divide-y divide-[#F1F5F9]">
                          {naoLidos.map(e => <li key={e.id} className="py-1"><strong>{e.numero_patrimonio}</strong> · {itens.find(i => i.produto_id === e.produto_id)?.nome}{e.situacao === 'MANUTENCAO' && <span className="text-blue-600"> · em manutenção (pode estar no conserto)</span>}{(emLocacaoPorProduto.get(e.produto_id) || 0) > 0 && <span className="text-amber-600"> · produto com peças em locação</span>}</li>)}
                        </ul>
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-amber-700 uppercase mb-1">Códigos desconhecidos ({desconhecidos.length})</p>
                        <p className="text-[10px] text-gray-400 mb-1">Etiqueta lida que não é de nenhum patrimônio — cadastre em Equipamentos de Locação.</p>
                        <ul className="max-h-60 overflow-y-auto divide-y divide-[#F1F5F9]">{desconhecidos.map(d => <li key={d.id} className="py-1 font-bold">{d.codigo}</li>)}</ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---------- MODAL NOVO ---------- */}
      <Modal open={modalNovo} onClose={() => setModalNovo(false)} title="Novo inventário"
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setModalNovo(false)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
          <button onClick={criar} disabled={criando} className="bg-[#0C1D4D] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{criando ? 'Abrindo...' : 'Abrir inventário'}</button>
        </div>}>
        <p className="text-xs text-gray-500">Ao abrir, o sistema congela o saldo atual e o que está em locação de cada produto do escopo. A contagem é comparada com isso.</p>
        <div><label className={labelCls}>Nome</label><input value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} className={inputCls} /></div>
        {empresas.length > 1 && (
          <div><label className={labelCls}>Empresa</label>
            <select value={novo.empresa_id} onChange={e => setNovo({ ...novo, empresa_id: Number(e.target.value) })} className={inputCls}>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
          </div>
        )}
        <div><label className={labelCls}>Local (opcional)</label>
          <select value={novo.local} onChange={e => setNovo({ ...novo, local: e.target.value })} className={inputCls}>
            <option value="">Todos os locais</option>{locaisDisp.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Categorias (vazio = todas)</label>
          <input value={novo.buscaCat} onChange={e => setNovo({ ...novo, buscaCat: e.target.value })} placeholder="Filtrar categorias..." className={`${inputCls} mb-2`} />
          <div className="max-h-48 overflow-y-auto border border-[#E2E8F0] rounded-lg p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {categoriasDisp.filter(c => c.toLowerCase().includes(novo.buscaCat.toLowerCase())).map(c => (
              <label key={c} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={novo.categorias.includes(c)} onChange={e => setNovo({ ...novo, categorias: e.target.checked ? [...novo.categorias, c] : novo.categorias.filter(x => x !== c) })} />{c}
              </label>
            ))}
          </div>
          {novo.categorias.length > 0 && <p className="text-[10px] text-gray-500 mt-1">{novo.categorias.length} selecionada(s)</p>}
        </div>
      </Modal>

      {/* ---------- MODAL CONCLUIR ---------- */}
      <Modal open={modalConcluir} onClose={() => setModalConcluir(false)} title="Concluir e aplicar inventário"
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setModalConcluir(false)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Voltar</button>
          <button onClick={concluir} disabled={concluindo} className="bg-emerald-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{concluindo ? 'Aplicando...' : 'Concluir e aplicar'}</button>
        </div>}>
        <ul className="text-sm space-y-1">
          <li><strong>{contados.length}</strong> produto(s) contado(s) — os de quantidade passam a ter saldo = contado + em locação.</li>
          <li><strong>{itens.length - contados.length}</strong> não contado(s) — ficam como estão.</li>
          <li><strong>{comDif.length}</strong> com diferença · {formatarMoeda(valorDif)} em valor de reposição.</li>
          <li><strong>{naoLidos.length}</strong> patrimônio(s) não lido(s) · <strong>{desconhecidos.length}</strong> código(s) desconhecido(s).</li>
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={marcarExtraviados} onChange={e => setMarcarExtraviados(e.target.checked)} className="mt-1" />
          <span>Marcar como <strong>EXTRAVIADO</strong> os patrimônios <strong>ativos</strong> não lidos de produtos sem nada em locação (não são marcados os de produtos com peças em locação — podem estar com cliente — nem os em manutenção — podem estar no conserto).</span>
        </label>
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">Fase paralela: enquanto o P2S for oficial, "Carregar saldos do P2S" (Equipamentos de Locação) sobrescreve o local PRINCIPAL. O inventário vale de vez na virada.</p>
      </Modal>
    </div>
  );
}
