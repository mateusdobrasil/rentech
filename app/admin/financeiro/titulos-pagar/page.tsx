"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import * as XLSX from 'xlsx';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { hojeISO, somarDias } from '../../../lib/locacao/datas';
import {
  painelPagarAction, buscarFornecedoresPagarAction, salvarTituloAction, baixarTituloAction, estornarTituloAction, cancelarTituloPagarAction,
  salvarRecorrenciaAction, definirFonteAction,
} from './actions';

// Contas a Pagar próprio + Recorrentes + OP (Financeiro completo, 2026-11-20).
const FORMAS = ['BOLETO', 'TRANSFERÊNCIA', 'PIX', 'DÉBITO AUTOMÁTICO', 'CARTÃO', 'DINHEIRO'];
const PERIODOS: Record<string, string> = { MENSAL: 'Mensal', BIMESTRAL: 'Bimestral', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual' };
const ORIGEM: Record<string, { rot: string; cls: string }> = { MANUAL: { rot: 'lançada', cls: 'bg-slate-100 text-slate-600' }, OP: { rot: 'OP', cls: 'bg-blue-100 text-blue-700' }, RECORRENCIA: { rot: 'recorrente', cls: 'bg-violet-100 text-violet-700' } };
const num = (s: string) => { const x = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const vs = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const inp = 'mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm';

export default function TitulosPagarPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [aba, setAba] = useState<'contas' | 'recorrentes' | 'virada'>('contas');
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [status, setStatus] = useState('ABERTO');
  const [de, setDe] = useState(somarDias(hojeISO(), -90));
  const [ate, setAte] = useState(somarDias(hojeISO(), 60));
  const [busca, setBusca] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [form, setForm] = useState<any>(null);         // título
  const [baixa, setBaixa] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);           // recorrência
  const [fornBusca, setFornBusca] = useState('');
  const [fornAchados, setFornAchados] = useState<any[]>([]);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await painelPagarAction({ empresaId, de, ate, status }, accessToken);
      if (!vivo) return;
      if (r.ok) setInfo(r.info); else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, empresaId, de, ate, status, recarregar]);

  useEffect(() => {
    if ((!form && !rec) || fornBusca.trim().length < 2 || !accessToken) return;
    const t = setTimeout(async () => { const r = await buscarFornecedoresPagarAction(fornBusca, accessToken); if (r.ok) setFornAchados(r.info); }, 300);
    return () => clearTimeout(t);
  }, [form, rec, fornBusca, accessToken]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200"><div className="text-5xl mb-4">⛔</div><h2 className="text-xl font-black text-red-600 uppercase mb-4">Acesso Restrito</h2><button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Financeiro</button></div></div>;

  const tok = accessToken as string;
  const atualizar = () => setRecarregar(v => v + 1);
  const empresas: any[] = info?.empresas || [];
  const hoje = info?.hoje || hojeISO();
  const fonteDe = (id: number) => empresas.find(e => e.id === id)?.fonte || 'P2S';
  const nomeEmpresa = (id: number) => empresas.find(e => e.id === id)?.nome || '';
  const t = busca.trim().toLowerCase();
  const titulos: any[] = (info?.titulos || []).filter((x: any) => !t || [x.fornecedor_nome, x.descricao, x.documento, x.classificacao].some(v => (v || '').toLowerCase().includes(t)));
  const contasDaEmpresa = (id: number) => (info?.contas || []).filter((c: any) => c.empresa_id === id);

  const abrirTitulo = (x?: any) => {
    setFornBusca(''); setFornAchados([]);
    setForm(x ? {
      id: x.id, empresa_id: x.empresa_id, fornecedor_id: x.fornecedor_id, fornecedor_nome: x.fornecedor_nome, descricao: x.descricao, documento: x.documento || '',
      subcentro_id: x.subcentro_id ? String(x.subcentro_id) : '', competencia: x.competencia || '', vencimento: x.vencimento, valor: vs(x.valor), parcelas: '1',
      forma_pagamento: x.forma_pagamento || '', boleto_linha: x.boleto_linha || '', pix_chave: x.pix_chave || '', conta_prevista_id: x.conta_prevista_id ? String(x.conta_prevista_id) : '', observacoes: x.observacoes || '', origem: x.origem,
    } : { id: null, empresa_id: empresaId || empresas[0]?.id, fornecedor_id: null, fornecedor_nome: '', descricao: '', documento: '', subcentro_id: '', competencia: '', vencimento: hoje, valor: '', parcelas: '1', forma_pagamento: 'BOLETO', boleto_linha: '', pix_chave: '', conta_prevista_id: '', observacoes: '' });
  };
  const salvarTitulo = async () => {
    setOcupado(true);
    const r = await salvarTituloAction(form.id, {
      empresa_id: Number(form.empresa_id), fornecedor_id: form.fornecedor_id, fornecedor_nome: form.fornecedor_nome, descricao: form.descricao, documento: form.documento,
      subcentro_id: form.subcentro_id ? Number(form.subcentro_id) : null, competencia: form.competencia || null, vencimento: form.vencimento, valor: num(form.valor),
      parcelas: Number(form.parcelas) || 1, forma_pagamento: form.forma_pagamento || null, boleto_linha: form.boleto_linha, pix_chave: form.pix_chave,
      conta_prevista_id: form.conta_prevista_id ? Number(form.conta_prevista_id) : null, observacoes: form.observacoes,
    }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao salvar.', 'error'); return; }
    toast(form.id ? 'Conta atualizada.' : `Conta lançada${r.info.ids.length > 1 ? ` em ${r.info.ids.length} parcelas` : ''}.`, 'success'); setForm(null); atualizar();
  };
  const abrirBaixa = (x: any) => setBaixa({ id: x.id, empresa_id: x.empresa_id, descricao: x.descricao, valor: x.valor, data: hoje, conta: String(x.conta_prevista_id || contasDaEmpresa(x.empresa_id)[0]?.id || ''), juros: '', desconto: '' });
  const salvarBaixa = async () => {
    setOcupado(true);
    const r = await baixarTituloAction(baixa.id, { data_pagamento: baixa.data, conta_id: baixa.conta ? Number(baixa.conta) : null, juros_multa: num(baixa.juros), desconto: num(baixa.desconto) }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(r.info.movimentou ? 'Pago — a saída entrou no caixa.' : 'Pago (ensaio): enquanto a fonte for o P2S, o caixa usa o pagamento lançado lá.', 'success'); setBaixa(null); atualizar();
  };
  const estornar = async (x: any) => {
    if (!(await confirmar({ message: `Estornar o pagamento de "${x.descricao}"? A conta volta a ficar em aberto (e a saída sai do caixa).`, danger: true, confirmLabel: 'Estornar' }))) return;
    const r = await estornarTituloAction(x.id, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Pagamento estornado.', 'success'); atualizar();
  };
  const cancelar = async (x: any) => {
    const motivo = await pedir({ title: 'Cancelar conta a pagar', message: `Motivo do cancelamento de "${x.descricao}":`, confirmLabel: 'Cancelar conta' });
    if (!motivo) return;
    const r = await cancelarTituloPagarAction(x.id, motivo, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Conta cancelada.', 'success'); atualizar();
  };
  const abrirRec = (r?: any) => {
    setFornBusca(''); setFornAchados([]);
    setRec(r ? { id: r.id, empresa_id: r.empresa_id, fornecedor_id: r.fornecedor_id, fornecedor_nome: r.fornecedor_nome || '', descricao: r.descricao, subcentro_id: r.subcentro_id ? String(r.subcentro_id) : '', valor: vs(r.valor), dia_vencimento: String(r.dia_vencimento), periodicidade: r.periodicidade, inicio: r.inicio, fim: r.fim || '', forma_pagamento: r.forma_pagamento || '', conta_id: r.conta_id ? String(r.conta_id) : '', ativa: r.ativa }
      : { id: null, empresa_id: empresaId || empresas[0]?.id, fornecedor_id: null, fornecedor_nome: '', descricao: '', subcentro_id: '', valor: '', dia_vencimento: '10', periodicidade: 'MENSAL', inicio: `${hoje.slice(0, 8)}01`, fim: '', forma_pagamento: 'BOLETO', conta_id: '', ativa: true });
  };
  const salvarRec = async () => {
    setOcupado(true);
    const r = await salvarRecorrenciaAction(rec.id, {
      empresa_id: Number(rec.empresa_id), fornecedor_id: rec.fornecedor_id, fornecedor_nome: rec.fornecedor_nome, descricao: rec.descricao, subcentro_id: rec.subcentro_id ? Number(rec.subcentro_id) : null,
      valor: num(rec.valor), dia_vencimento: Number(rec.dia_vencimento), periodicidade: rec.periodicidade, inicio: rec.inicio, fim: rec.fim || null, forma_pagamento: rec.forma_pagamento || null,
      conta_id: rec.conta_id ? Number(rec.conta_id) : null, ativa: rec.ativa,
    }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Conta recorrente salva — os vencimentos dos próximos 45 dias já estão em Contas.', 'success'); setRec(null); atualizar();
  };
  const virar = async (e: any, fonte: 'P2S' | 'SISTEMA') => {
    const msg = fonte === 'SISTEMA'
      ? `Virar a chave do financeiro da ${e.nome}?\n\nA partir de agora: caixa, fluxo e DRE usam as contas a pagar/receber DO SISTEMA; os pagamentos aqui geram as saídas no caixa; a sincronização dos pagamentos do P2S para o caixa PARA para esta empresa.\n\nFaça isso só quando as contas em aberto estiverem lançadas aqui.`
      : `Voltar o financeiro da ${e.nome} para o P2S? O caixa volta a receber os pagamentos do P2S.`;
    if (!(await confirmar({ title: 'Virada da chave', message: msg, danger: fonte === 'SISTEMA', confirmLabel: fonte === 'SISTEMA' ? 'Virar a chave' : 'Voltar ao P2S' }))) return;
    const r = await definirFonteAction(e.id, fonte, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(`Financeiro da ${e.nome}: fonte ${fonte === 'SISTEMA' ? 'SISTEMA' : 'P2S'}.`, 'success'); atualizar();
  };
  const exportar = () => {
    const ws = XLSX.utils.json_to_sheet(titulos.map(x => ({
      Empresa: nomeEmpresa(x.empresa_id), Vencimento: formatarDataBR(x.vencimento), Fornecedor: x.fornecedor_nome, Descrição: x.descricao, Documento: x.documento || '', Classificação: x.classificacao || '',
      Origem: ORIGEM[x.origem]?.rot, Valor: x.valor, Situação: x.status, 'Pago em': formatarDataBR(x.data_pagamento, ''), 'Valor pago': x.valor_pago ?? '', Conta: x.conta_pagamento || '',
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Contas a pagar'); XLSX.writeFile(wb, `contas-a-pagar-${de}-a-${ate}.xlsx`);
  };

  const campoFornecedor = (obj: any, set: (v: any) => void) => (
    <div className="text-xs font-bold md:col-span-2">Fornecedor
      <input value={obj.fornecedor_nome} onChange={e => { set({ ...obj, fornecedor_nome: e.target.value, fornecedor_id: null }); setFornBusca(e.target.value); if (e.target.value.trim().length < 2) setFornAchados([]); }} placeholder="Busque no cadastro ou digite o nome" className={inp} />
      {fornAchados.length > 0 && (
        <div className="border border-[#E2E8F0] rounded-xl max-h-36 overflow-y-auto divide-y divide-[#E2E8F0] mt-1 font-normal">
          {fornAchados.map(p => <button key={p.id} onClick={() => { set({ ...obj, fornecedor_id: p.id, fornecedor_nome: p.nome }); setFornAchados([]); setFornBusca(''); }} className="w-full text-left px-3 py-2 text-xs hover:bg-[#F8FAFC]"><strong>{p.nome}</strong> <span className="text-gray-400">{p.detalhe}</span></button>)}
        </div>
      )}
      {obj.fornecedor_id && <span className="text-[10px] text-emerald-700 font-normal">ligado ao cadastro</span>}
    </div>
  );
  const kpi = (rot: string, v: { qtd: number; valor: number } | undefined, tom: string) => (
    <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className={`text-xl font-black ${tom}`}>{v ? formatarMoeda(v.valor) : '—'}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">{rot} {v ? `· ${v.qtd}` : ''}</p></div>
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#ECFDF5] border-b border-[#A7F3D0] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#047857] font-medium text-sm">💸 <strong>Olá, {usuarioAtual}</strong>. Contas a pagar: lançadas, recorrentes e OPs.</p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white border border-[#A7F3D0] text-[#047857] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ Voltar ao Financeiro</button>
      </div>
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-[10px] font-black uppercase tracking-wider bg-white">
              {([['contas', 'Contas'], ['recorrentes', 'Recorrentes'], ['virada', 'Virada da chave']] as const).map(([v, r]) => <button key={v} onClick={() => setAba(v)} className={`px-4 py-2.5 ${aba === v ? 'bg-[#047857] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{r}</button>)}
            </div>
            <select value={empresaId ?? ''} onChange={e => setEmpresaId(e.target.value ? Number(e.target.value) : null)} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white"><option value="">Todas as empresas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
            {aba === 'contas' && <button onClick={() => abrirTitulo()} className={`${btn} bg-[#0C1D4D] text-white`}>+ Nova conta</button>}
            {aba === 'recorrentes' && <button onClick={() => abrirRec()} className={`${btn} bg-[#0C1D4D] text-white`}>+ Nova recorrente</button>}
            {carregando && <span className="text-xs text-gray-400">carregando…</span>}
          </div>
          {empresas.some(e => e.fonte === 'P2S') && aba !== 'virada' && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Transição: enquanto a fonte da empresa for o P2S, pagar aqui é ENSAIO — fica registrado, mas o caixa usa o pagamento lançado no P2S. Na virada da chave, os pagamentos daqui passam a movimentar o caixa.</p>
          )}

          {aba === 'contas' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {kpi('Vencidas', info?.kpis.vencidos, 'text-red-600')}
                {kpi('Vencem em 7 dias', info?.kpis.proximos7, 'text-amber-700')}
                {kpi('Pagas no mês', info?.kpis.pagosMes, 'text-[#047857]')}
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 flex flex-wrap gap-2 items-end">
                <select value={status} onChange={e => setStatus(e.target.value)} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm"><option value="ABERTO">Em aberto</option><option value="VENCIDO">Vencidas</option><option value="PAGO">Pagas</option><option value="CANCELADO">Canceladas</option><option value="">Todas</option></select>
                <label className="text-[10px] font-bold">Vencimento de<input type="date" value={de} onChange={e => setDe(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-xs" /></label>
                <label className="text-[10px] font-bold">até<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-xs" /></label>
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar fornecedor, descrição, documento…" className="flex-1 min-w-[200px] border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" />
                <button onClick={exportar} disabled={!titulos.length} className={`${btn} bg-white border border-[#E2E8F0]`}>Excel</button>
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8]"><tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                    <th className="p-3">Vencimento</th><th className="p-3">Fornecedor / descrição</th><th className="p-3">Classificação</th><th className="p-3 text-right">Valor</th><th className="p-3">Situação</th><th className="p-3"></th>
                  </tr></thead>
                  <tbody>
                    {!carregando && !titulos.length && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nenhuma conta nesse filtro.</td></tr>}
                    {titulos.map(x => {
                      const vencida = x.status === 'ABERTO' && x.vencimento < hoje;
                      return (
                        <tr key={x.id} className={`border-t border-[#E2E8F0] ${vencida ? 'bg-red-50/50' : ''}`}>
                          <td className={`p-3 whitespace-nowrap font-bold ${vencida ? 'text-red-600' : ''}`}>{formatarDataBR(x.vencimento)}</td>
                          <td className="p-3 min-w-[240px]">
                            <p className="font-bold">{x.fornecedor_nome} <span className={`ml-1 text-[9px] font-black px-1.5 py-0.5 rounded ${ORIGEM[x.origem]?.cls}`}>{ORIGEM[x.origem]?.rot}</span> <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${corSeloEmpresa(x.empresa_id)}`}>{nomeEmpresa(x.empresa_id)}</span></p>
                            <p className="text-[10px] text-gray-500">{x.descricao}{x.documento ? ` · ${x.documento}` : ''}{x.forma_pagamento ? ` · ${x.forma_pagamento}` : ''}</p>
                          </td>
                          <td className="p-3 text-gray-600 min-w-[160px]">{x.classificacao || <span className="text-amber-700">sem classificação</span>}</td>
                          <td className="p-3 text-right font-black whitespace-nowrap">{formatarMoeda(x.valor)}</td>
                          <td className="p-3 whitespace-nowrap">
                            {x.status === 'PAGO' ? <span className="text-emerald-700 font-bold">pago {formatarDataBR(x.data_pagamento)}{x.conta_pagamento ? ` · ${x.conta_pagamento}` : ''}</span>
                              : x.status === 'CANCELADO' ? <span className="text-gray-400">cancelada</span>
                                : vencida ? <span className="text-red-600 font-bold">vencida</span> : <span className="text-gray-600">em aberto</span>}
                          </td>
                          <td className="p-3 whitespace-nowrap text-right space-x-2">
                            {x.status === 'ABERTO' && x.origem !== 'OP' && <button onClick={() => abrirBaixa(x)} className="text-[10px] font-black text-white bg-[#047857] px-3 py-1.5 rounded-lg">Pagar</button>}
                            {x.status === 'ABERTO' && x.origem === 'OP' && <span className="text-[10px] text-gray-400">paga pela OP</span>}
                            {x.status === 'ABERTO' && x.origem !== 'OP' && <button onClick={() => abrirTitulo(x)} className="text-[10px] font-black text-[#336699]">editar</button>}
                            {x.status === 'ABERTO' && x.origem !== 'OP' && <button onClick={() => cancelar(x)} className="text-[10px] font-black text-gray-400 hover:text-red-500">cancelar</button>}
                            {x.status === 'PAGO' && x.origem !== 'OP' && <button onClick={() => estornar(x)} className="text-[10px] font-black text-gray-400 hover:text-red-500">estornar</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {aba === 'recorrentes' && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8]"><tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                  <th className="p-3">Conta recorrente</th><th className="p-3">Periodicidade</th><th className="p-3 text-right">Valor base</th><th className="p-3">Próximo vencimento</th><th className="p-3">Vigência</th><th className="p-3"></th>
                </tr></thead>
                <tbody>
                  {!(info?.recorrencias || []).length && <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nenhuma conta recorrente. Cadastre aluguel, luz, água, internet, sistemas, contador… — os vencimentos aparecem sozinhos em Contas para pagar.</td></tr>}
                  {(info?.recorrencias || []).map((r: any) => (
                    <tr key={r.id} className={`border-t border-[#E2E8F0] ${r.ativa ? '' : 'opacity-50'}`}>
                      <td className="p-3"><p className="font-bold">{r.descricao}</p><p className="text-[10px] text-gray-500">{[r.fornecedor_nome, r.subcentro_nome, nomeEmpresa(r.empresa_id)].filter(Boolean).join(' · ')}</p></td>
                      <td className="p-3">{PERIODOS[r.periodicidade]} · dia {r.dia_vencimento}</td>
                      <td className="p-3 text-right font-bold">{formatarMoeda(r.valor)}</td>
                      <td className="p-3">{r.proximo ? <>{formatarDataBR(r.proximo.vencimento)} · {formatarMoeda(Number(r.proximo.valor))}</> : '—'}</td>
                      <td className="p-3 whitespace-nowrap">{formatarDataBR(r.inicio)}{r.fim ? ` a ${formatarDataBR(r.fim)}` : ' em diante'}{r.ativa ? '' : ' · inativa'}</td>
                      <td className="p-3"><button onClick={() => abrirRec(r)} className="text-[10px] font-black text-[#336699]">editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="p-3 text-[10px] text-gray-500">Os vencimentos dos próximos 45 dias viram contas a pagar sozinhos (uma por vencimento). Conta de valor variável (luz, água): ajuste o valor da conta do mês em Contas antes de pagar.</p>
            </div>
          )}

          {aba === 'virada' && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 space-y-4">
              <p className="text-sm text-gray-700">Enquanto o P2S é oficial, o financeiro de cada empresa roda <strong>em paralelo</strong>: caixa, fluxo e DRE usam os pagamentos/recebimentos do P2S. Na virada da chave, passam a usar as contas a pagar/receber do sistema e os pagamentos daqui movimentam o caixa.</p>
              {empresas.map(e => (
                <div key={e.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 border border-[#E2E8F0] rounded-xl p-4">
                  <div><p className="font-black text-[#0C1D4D]">{e.nome}</p><p className="text-xs text-gray-500">Fonte atual: <strong className={e.fonte === 'SISTEMA' ? 'text-emerald-700' : 'text-amber-700'}>{e.fonte === 'SISTEMA' ? 'SISTEMA (rentech-web)' : 'P2S (paralelo)'}</strong></p></div>
                  {info?.podeVirarChave
                    ? (e.fonte === 'SISTEMA'
                      ? <button onClick={() => virar(e, 'P2S')} className={`${btn} bg-white border border-[#E2E8F0] text-gray-600`}>Voltar ao P2S</button>
                      : <button onClick={() => virar(e, 'SISTEMA')} className={`${btn} bg-red-600 text-white`}>Virar a chave</button>)
                    : <span className="text-xs text-gray-400">só o Administrador</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? '✏️ Editar conta a pagar' : '+ Nova conta a pagar'} maxWidthClassName="max-w-3xl"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={salvarTitulo} className={`${btn} bg-[#0C1D4D] text-white`}>Salvar</button></div>}>
        {form && (
          <div className="grid md:grid-cols-2 gap-3">
            {!form.id && <label className="text-xs font-bold">Empresa<select value={form.empresa_id} onChange={e => setForm({ ...form, empresa_id: Number(e.target.value) })} className={inp}>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></label>}
            <label className="text-xs font-bold">Documento (NF / boleto)<input value={form.documento} onChange={e => setForm({ ...form, documento: e.target.value })} className={inp} /></label>
            {campoFornecedor(form, setForm)}
            <label className="text-xs font-bold md:col-span-2">Descrição<input value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} className={inp} /></label>
            <label className="text-xs font-bold md:col-span-2">Classificação (plano de contas)<select value={form.subcentro_id} onChange={e => setForm({ ...form, subcentro_id: e.target.value })} className={inp}><option value="">— escolha —</option>{(info?.subcentros || []).map((s: any) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
            <label className="text-xs font-bold">Valor{!form.id && Number(form.parcelas) > 1 ? ' total' : ''} (R$)<input value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} className={inp} /></label>
            {!form.id ? <label className="text-xs font-bold">Parcelas (mensais)<input type="number" min={1} max={60} value={form.parcelas} onChange={e => setForm({ ...form, parcelas: e.target.value })} className={inp} /></label> : <div />}
            <label className="text-xs font-bold">{!form.id && Number(form.parcelas) > 1 ? '1º vencimento' : 'Vencimento'}<input type="date" value={form.vencimento} onChange={e => setForm({ ...form, vencimento: e.target.value })} className={inp} /></label>
            <label className="text-xs font-bold">Competência (mês da despesa)<input type="date" value={form.competencia} onChange={e => setForm({ ...form, competencia: e.target.value })} className={inp} /></label>
            <label className="text-xs font-bold">Forma de pagamento<select value={form.forma_pagamento} onChange={e => setForm({ ...form, forma_pagamento: e.target.value })} className={inp}><option value="">—</option>{FORMAS.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
            <label className="text-xs font-bold">Conta prevista<select value={form.conta_prevista_id} onChange={e => setForm({ ...form, conta_prevista_id: e.target.value })} className={inp}><option value="">—</option>{contasDaEmpresa(Number(form.empresa_id)).map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            {form.forma_pagamento === 'BOLETO' && <label className="text-xs font-bold md:col-span-2">Linha digitável<input value={form.boleto_linha} onChange={e => setForm({ ...form, boleto_linha: e.target.value })} className={inp} /></label>}
            {form.forma_pagamento === 'PIX' && <label className="text-xs font-bold md:col-span-2">Chave PIX<input value={form.pix_chave} onChange={e => setForm({ ...form, pix_chave: e.target.value })} className={inp} /></label>}
            <label className="text-xs font-bold md:col-span-2">Observações<input value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} className={inp} /></label>
          </div>
        )}
      </Modal>

      <Modal open={!!baixa} onClose={() => setBaixa(null)} title="💸 Pagar conta" headerColor="#047857"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setBaixa(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={salvarBaixa} className={`${btn} bg-[#047857] text-white`}>Confirmar pagamento</button></div>}>
        {baixa && (
          <>
            <p className="text-sm"><strong>{baixa.descricao}</strong> · {formatarMoeda(baixa.valor)}</p>
            {fonteDe(baixa.empresa_id) === 'P2S' && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Ensaio: a fonte desta empresa ainda é o P2S — o pagamento fica registrado aqui, mas o caixa usa o lançado no P2S.</p>}
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-xs font-bold">Data do pagamento<input type="date" value={baixa.data} max={hoje} onChange={e => setBaixa({ ...baixa, data: e.target.value })} className={inp} /></label>
              <label className="text-xs font-bold">Conta de onde saiu<select value={baixa.conta} onChange={e => setBaixa({ ...baixa, conta: e.target.value })} className={inp}><option value="">—</option>{contasDaEmpresa(baixa.empresa_id).map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
              <label className="text-xs font-bold">Juros / multa (R$)<input value={baixa.juros} onChange={e => setBaixa({ ...baixa, juros: e.target.value })} placeholder="0,00" className={inp} /></label>
              <label className="text-xs font-bold">Desconto (R$)<input value={baixa.desconto} onChange={e => setBaixa({ ...baixa, desconto: e.target.value })} placeholder="0,00" className={inp} /></label>
            </div>
            <p className="text-sm font-black text-[#047857]">Valor pago: {formatarMoeda(baixa.valor + num(baixa.juros) - num(baixa.desconto))}</p>
          </>
        )}
      </Modal>

      <Modal open={!!rec} onClose={() => setRec(null)} title={rec?.id ? '✏️ Editar conta recorrente' : '🔁 Nova conta recorrente'} maxWidthClassName="max-w-3xl"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setRec(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={salvarRec} className={`${btn} bg-[#0C1D4D] text-white`}>Salvar</button></div>}>
        {rec && (
          <div className="grid md:grid-cols-2 gap-3">
            {!rec.id && <label className="text-xs font-bold md:col-span-2">Empresa<select value={rec.empresa_id} onChange={e => setRec({ ...rec, empresa_id: Number(e.target.value) })} className={inp}>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></label>}
            <label className="text-xs font-bold md:col-span-2">Descrição<input value={rec.descricao} onChange={e => setRec({ ...rec, descricao: e.target.value })} placeholder="ex.: Aluguel galpão, Energia (Enel), Internet" className={inp} /></label>
            {campoFornecedor(rec, setRec)}
            <label className="text-xs font-bold md:col-span-2">Classificação (plano de contas)<select value={rec.subcentro_id} onChange={e => setRec({ ...rec, subcentro_id: e.target.value })} className={inp}><option value="">— escolha —</option>{(info?.subcentros || []).map((s: any) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
            <label className="text-xs font-bold">Valor (R$)<input value={rec.valor} onChange={e => setRec({ ...rec, valor: e.target.value })} className={inp} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-bold">Dia do vencimento<input type="number" min={1} max={31} value={rec.dia_vencimento} onChange={e => setRec({ ...rec, dia_vencimento: e.target.value })} className={inp} /></label>
              <label className="text-xs font-bold">Periodicidade<select value={rec.periodicidade} onChange={e => setRec({ ...rec, periodicidade: e.target.value })} className={inp}>{Object.entries(PERIODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
            <label className="text-xs font-bold">Início<input type="date" value={rec.inicio} onChange={e => setRec({ ...rec, inicio: e.target.value })} className={inp} /></label>
            <label className="text-xs font-bold">Fim (opcional)<input type="date" value={rec.fim} onChange={e => setRec({ ...rec, fim: e.target.value })} className={inp} /></label>
            <label className="text-xs font-bold">Forma de pagamento<select value={rec.forma_pagamento} onChange={e => setRec({ ...rec, forma_pagamento: e.target.value })} className={inp}><option value="">—</option>{FORMAS.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
            <label className="text-xs font-bold">Conta prevista<select value={rec.conta_id} onChange={e => setRec({ ...rec, conta_id: e.target.value })} className={inp}><option value="">—</option>{contasDaEmpresa(Number(rec.empresa_id)).map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
            <label className="flex items-center gap-2 text-xs font-bold md:col-span-2"><input type="checkbox" checked={rec.ativa} onChange={e => setRec({ ...rec, ativa: e.target.checked })} /> Ativa (desmarque para parar de gerar)</label>
          </div>
        )}
      </Modal>
    </div>
  );
}
