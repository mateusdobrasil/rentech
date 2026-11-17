"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { resumoCarteiraAction, listarCarteiraAction, definirVendedorClientesAction, transferirCarteiraAction } from './actions';

// Carteira de Clientes (2026-11-17): vendedor responsável por cliente.
// O vendedor padrão só vê as fichas dos clientes da carteira dele.

interface Vendedor { id: number; nome: string; ativo: boolean }
interface ClienteCarteira { id: number; nome: string; razao: string | null; cidade: string; vendedor_id: number | null; origem: string | null; definido_por: string | null; definido_em: string | null }

const ROTA = '/admin/comercial/carteira';
const ROTULO_ORIGEM: Record<string, string> = { INICIAL: 'histórico de fichas', PRIMEIRA_FICHA: '1ª ficha', MANUAL: 'manual' };

export default function CarteiraClientesPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota: ROTA });

  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [porVendedor, setPorVendedor] = useState<Record<number, number>>({});
  const [totais, setTotais] = useState({ naCarteira: 0, totalClientes: 0 });
  const [filtroVend, setFiltroVend] = useState<number | 'SEM' | null>(null);
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(0);
  const [clientes, setClientes] = useState<ClienteCarteira[]>([]);
  const [total, setTotal] = useState(0);
  const [porPagina, setPorPagina] = useState(50);
  const [carregando, setCarregando] = useState(true);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [destino, setDestino] = useState<string>('');
  const [transfDe, setTransfDe] = useState<string>('');
  const [transfPara, setTransfPara] = useState<string>('');
  const [salvando, setSalvando] = useState(false);
  const [recarregar, setRecarregar] = useState(0);

  const pronto = !authLoading && !acessoNegado && !erro && !!accessToken;

  useEffect(() => {
    if (!pronto) return;
    resumoCarteiraAction(accessToken).then(r => {
      if (!r.ok) return toast(r.erro || 'Erro ao carregar.', 'error');
      setVendedores(r.info.vendedores); setPorVendedor(r.info.porVendedor);
      setTotais({ naCarteira: r.info.naCarteira, totalClientes: r.info.totalClientes });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, recarregar]);

  useEffect(() => {
    if (!pronto) return;
    const t = setTimeout(async () => {
      setCarregando(true);
      const r = await listarCarteiraAction({ busca, vendedor: filtroVend, pagina }, accessToken);
      setCarregando(false);
      if (!r.ok) return toast(r.erro || 'Erro ao listar.', 'error');
      setClientes(r.info.clientes); setTotal(r.info.total); setPorPagina(r.info.porPagina);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, busca, filtroVend, pagina, recarregar]);

  const nomeVend = (id: number | null) => (id ? vendedores.find(v => v.id === id)?.nome || `#${id}` : null);
  const ativos = vendedores.filter(v => v.ativo);

  const mover = async (ids: number[], vendedorId: number | null) => {
    setSalvando(true);
    const r = await definirVendedorClientesAction(ids, vendedorId, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast(`${r.info.qtd} cliente(s) ${vendedorId ? `na carteira de ${nomeVend(vendedorId)}` : 'sem carteira'}.`, 'success');
    setSelecionados(new Set());
    setRecarregar(x => x + 1);
  };

  const transferir = async () => {
    const de = Number(transfDe), para = Number(transfPara);
    if (!de || !para) return toast('Escolha os dois vendedores.', 'info');
    if (!(await confirmar({ title: 'Transferir carteira', confirmLabel: 'Transferir', message: `Passar todos os ${porVendedor[de] || 0} cliente(s) de ${nomeVend(de)} para ${nomeVend(para)}? As fichas desses clientes passam a aparecer para ${nomeVend(para)}. As fichas já feitas continuam com o vendedor delas (comissão).` }))) return;
    setSalvando(true);
    const r = await transferirCarteiraAction(de, para, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast(`${r.info.qtd} cliente(s) transferido(s).`, 'success');
    setTransfDe(''); setTransfPara('');
    setRecarregar(x => x + 1);
  };

  if (authLoading) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Carteira de Clientes.</p>
          <button onClick={() => router.push('/admin/comercial')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const todosMarcados = clientes.length > 0 && clientes.every(c => selecionados.has(c.id));
  const chip = (ativo: boolean) => `px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 whitespace-nowrap ${ativo ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white text-gray-600 border-[#E2E8F0] hover:border-[#336699]'}`;
  const semCarteira = Math.max(0, totais.totalClientes - totais.naCarteira);

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">👥 <strong>Olá, {usuarioAtual}</strong>. Carteira de clientes por vendedor.</p>
        <button onClick={() => router.push('/admin/comercial')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg shadow-sm tracking-wider uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
            <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-tight">Carteira de Clientes</h1>
            <p className="text-xs text-gray-500 mt-1">
              O vendedor que vê "só a carteira" (Parâmetros → Permissões → usuário → Locação) enxerga apenas as fichas dos clientes dele.
              Cliente sem carteira entra na carteira de quem fizer a primeira ficha (aqui ou importada do P2S).
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={() => { setFiltroVend(null); setPagina(0); }} className={chip(filtroVend === null)}>Todos · {totais.totalClientes}</button>
              <button onClick={() => { setFiltroVend('SEM'); setPagina(0); }} className={chip(filtroVend === 'SEM')}>Sem carteira · {semCarteira}</button>
              {vendedores.filter(v => v.ativo || porVendedor[v.id]).map(v => (
                <button key={v.id} onClick={() => { setFiltroVend(v.id); setPagina(0); }} className={chip(filtroVend === v.id)}>
                  {v.nome}{!v.ativo ? ' (inativo)' : ''} · {porVendedor[v.id] || 0}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
            <div className="flex flex-col lg:flex-row gap-3 justify-between mb-4">
              <input value={busca} onChange={e => { setBusca(e.target.value); setPagina(0); }} placeholder="Buscar cliente..." className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm w-full lg:w-80 focus:outline-none focus:border-[#336699]" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black text-gray-500 uppercase">{selecionados.size} selecionado(s) →</span>
                <select value={destino} onChange={e => setDestino(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold text-[#0C1D4D]">
                  <option value="">Mover para...</option>
                  {ativos.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
                  <option value="SEM">— tirar da carteira —</option>
                </select>
                <button disabled={salvando || !selecionados.size || !destino} onClick={() => mover([...selecionados], destino === 'SEM' ? null : Number(destino))}
                  className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-40 text-white px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">Aplicar</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                    <th className="p-2 w-8"><input type="checkbox" checked={todosMarcados} onChange={e => setSelecionados(prev => { const s = new Set(prev); clientes.forEach(c => e.target.checked ? s.add(c.id) : s.delete(c.id)); return s; })} /></th>
                    <th className="p-2">Cliente</th><th className="p-2">Cidade</th><th className="p-2">Vendedor</th><th className="p-2">Definido</th>
                  </tr>
                </thead>
                <tbody>
                  {carregando && <tr><td colSpan={5} className="p-6 text-center text-gray-400">Carregando...</td></tr>}
                  {!carregando && clientes.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-gray-400">Nenhum cliente.</td></tr>}
                  {!carregando && clientes.map(c => (
                    <tr key={c.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC]">
                      <td className="p-2"><input type="checkbox" checked={selecionados.has(c.id)} onChange={e => setSelecionados(prev => { const s = new Set(prev); if (e.target.checked) s.add(c.id); else s.delete(c.id); return s; })} /></td>
                      <td className="p-2 min-w-[220px]"><p className="font-bold text-[#0C1D4D]">{c.nome}</p>{c.razao && <p className="text-[10px] text-gray-400">{c.razao}</p>}</td>
                      <td className="p-2 text-gray-500 whitespace-nowrap">{c.cidade || '—'}</td>
                      <td className="p-2">
                        <select value={c.vendedor_id ?? ''} disabled={salvando} onChange={e => mover([c.id], e.target.value ? Number(e.target.value) : null)}
                          className={`border rounded-lg px-2 py-1 text-xs font-bold ${c.vendedor_id ? 'border-[#CBD5E1] text-[#0C1D4D]' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
                          <option value="">— sem carteira —</option>
                          {c.vendedor_id && !ativos.some(v => v.id === c.vendedor_id) && <option value={c.vendedor_id}>{nomeVend(c.vendedor_id)} (inativo)</option>}
                          {ativos.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
                        </select>
                      </td>
                      <td className="p-2 text-[10px] text-gray-400 whitespace-nowrap">
                        {c.origem ? <>{ROTULO_ORIGEM[c.origem] || c.origem}{c.definido_em ? ` · ${new Date(c.definido_em).toLocaleDateString('pt-BR')}` : ''}{c.origem === 'MANUAL' && c.definido_por ? ` · ${c.definido_por}` : ''}</> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center mt-4 text-xs text-gray-500">
              <span>{total} cliente(s)</span>
              <div className="flex items-center gap-2">
                <button disabled={pagina === 0} onClick={() => setPagina(p => p - 1)} className="px-3 py-1 border rounded-lg disabled:opacity-30">‹</button>
                <span>{pagina + 1} / {paginas}</span>
                <button disabled={pagina + 1 >= paginas} onClick={() => setPagina(p => p + 1)} className="px-3 py-1 border rounded-lg disabled:opacity-30">›</button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
            <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Transferir carteira inteira</h2>
            <p className="text-xs text-gray-500 mb-3">Para quando um vendedor sai ou muda de região. As fichas já feitas continuam com o vendedor delas (a comissão não muda).</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={transfDe} onChange={e => setTransfDe(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold text-[#0C1D4D]">
                <option value="">De...</option>
                {vendedores.filter(v => porVendedor[v.id]).map(v => <option key={v.id} value={v.id}>{v.nome} ({porVendedor[v.id]})</option>)}
              </select>
              <span className="text-gray-400">→</span>
              <select value={transfPara} onChange={e => setTransfPara(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold text-[#0C1D4D]">
                <option value="">Para...</option>
                {ativos.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
              <button disabled={salvando || !transfDe || !transfPara} onClick={transferir} className="bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">Transferir</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
