"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import * as XLSX from 'xlsx';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { hojeISO, somarDias } from '../../../lib/locacao/datas';
import {
  painelCaixaAction, salvarContaAction, criarContasDoP2sAction, sincronizarP2sAction, extratoContaAction, transferirAction,
  lancarAvulsoAction, excluirMovimentoAction,
} from './actions';

// Caixa e Bancos (Financeiro completo, 2026-11-20): contas financeiras com
// saldo, extrato próprio, transferências e lançamentos avulsos. Na transição
// (fonte P2S) os movimentos vêm das contas pagas/recebidas do P2S.
const TIPOS: Record<string, string> = { BANCO: 'Banco', CAIXA: 'Caixa', CARTAO: 'Cartão', APLICACAO: 'Aplicação' };
const ORIGEM: Record<string, string> = {
  P2S_PAGAR: 'pago (P2S)', P2S_RECEBER: 'recebido (P2S)', TITULO_PAGAR: 'conta a pagar', TITULO_RECEBER: 'título a receber',
  TRANSFERENCIA: 'transferência', AJUSTE: 'ajuste', MANUAL: 'avulso', EXTRATO: 'do extrato',
};
const num = (s: string) => { const x = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const inicioMes = (iso: string) => `${iso.slice(0, 8)}01`;
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const inp = 'mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm';

interface FormConta { id: number | null; empresa_id: number; nome: string; tipo: string; banco_codigo: string; agencia: string; numero_conta: string; nomes_p2s: string; saldo_inicial: string; data_saldo_inicial: string; ativa: boolean; observacoes: string }

export default function CaixaPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [info, setInfo] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  // extrato
  const [contaSel, setContaSel] = useState<number | null>(null);
  const [de, setDe] = useState(inicioMes(hojeISO()));
  const [ate, setAte] = useState(hojeISO());
  const [extrato, setExtrato] = useState<any>(null);
  // modais
  const [formConta, setFormConta] = useState<FormConta | null>(null);
  const [transf, setTransf] = useState<{ de: string; para: string; data: string; valor: string; descricao: string } | null>(null);
  const [avulso, setAvulso] = useState<{ conta: string; data: string; tipo: 'ENTRADA' | 'SAIDA'; valor: string; descricao: string; subcentro: string; parceiro: string; ajuste: boolean } | null>(null);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await painelCaixaAction(null, accessToken);
      if (!vivo) return;
      if (r.ok) setInfo(r.info); else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, recarregar]);

  const carregarExtrato = useCallback(async () => {
    if (!contaSel || !accessToken) return;
    const r = await extratoContaAction(contaSel, de, ate, accessToken);
    if (r.ok) setExtrato(r.info); else toast(r.erro || 'Erro no extrato.', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contaSel, de, ate, accessToken]);
  useEffect(() => { carregarExtrato(); }, [carregarExtrato, recarregar]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Financeiro</button>
        </div>
      </div>
    );
  }

  const tok = accessToken as string;
  const empresas: any[] = info?.empresas || [];
  const contas: any[] = (info?.contas || []).filter((c: any) => filtroEmpresa === null || c.empresa_id === filtroEmpresa);
  const ativas = contas.filter(c => c.ativa);
  const nomeEmpresa = (id: number) => empresas.find(e => e.id === id)?.nome || '';
  const totalPorEmpresa = empresas.filter(e => filtroEmpresa === null || e.id === filtroEmpresa).map(e => ({ ...e, saldo: ativas.filter(c => c.empresa_id === e.id).reduce((a, c) => a + c.saldo, 0) }));

  const abrirConta = (c?: any) => setFormConta(c ? {
    id: c.id, empresa_id: c.empresa_id, nome: c.nome, tipo: c.tipo, banco_codigo: c.banco_codigo || '', agencia: c.agencia || '', numero_conta: c.numero_conta || '',
    nomes_p2s: (c.nomes_p2s || []).join('; '), saldo_inicial: String(c.saldo_inicial).replace('.', ','), data_saldo_inicial: c.data_saldo_inicial, ativa: c.ativa, observacoes: c.observacoes || '',
  } : { id: null, empresa_id: filtroEmpresa || empresas[0]?.id, nome: '', tipo: 'BANCO', banco_codigo: '341', agencia: '', numero_conta: '', nomes_p2s: '', saldo_inicial: '0', data_saldo_inicial: somarDias(hojeISO(), -1), ativa: true, observacoes: '' });

  const salvarConta = async () => {
    if (!formConta) return;
    setOcupado(true);
    const r = await salvarContaAction(formConta.id, {
      empresa_id: formConta.empresa_id, nome: formConta.nome, tipo: formConta.tipo as any, banco_codigo: formConta.banco_codigo, agencia: formConta.agencia,
      numero_conta: formConta.numero_conta, nomes_p2s: formConta.nomes_p2s.split(';').map(s => s.trim()).filter(Boolean), saldo_inicial: num(formConta.saldo_inicial),
      data_saldo_inicial: formConta.data_saldo_inicial, ativa: formConta.ativa, observacoes: formConta.observacoes,
    }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao salvar.', 'error'); return; }
    toast('Conta salva.', 'success'); setFormConta(null); setRecarregar(v => v + 1);
  };
  const criarDoP2s = async () => {
    if (!(await confirmar({ title: 'Criar contas a partir do P2S', confirmLabel: 'Criar', message: 'Cria uma conta para cada conta financeira usada no P2S nos últimos 2 anos (ex.: "Itaú - Rentech"), com saldo inicial 0 em ontem. Depois, edite cada conta e informe o saldo real do extrato numa data — os pagamentos/recebimentos do P2S a partir dali entram como movimentos.' }))) return;
    setOcupado(true);
    const r = await criarContasDoP2sAction(tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(r.info.criadas ? `${r.info.criadas} conta(s) criada(s): ${r.info.contas.join(', ')}. Ajuste o saldo inicial de cada uma.` : 'Nenhuma conta nova — todas as do P2S já estão ligadas.', 'success');
    setRecarregar(v => v + 1);
  };
  const sincronizar = async () => {
    setOcupado(true);
    const r = await sincronizarP2sAction(tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(`Sincronizado: ${r.info.criados} novo(s), ${r.info.atualizados} atualizado(s), ${r.info.removidos} removido(s).`, 'success');
    setRecarregar(v => v + 1);
  };
  const salvarTransf = async () => {
    if (!transf) return;
    setOcupado(true);
    const r = await transferirAction({ de_conta_id: Number(transf.de), para_conta_id: Number(transf.para), data: transf.data, valor: num(transf.valor), descricao: transf.descricao }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Transferência registrada.', 'success'); setTransf(null); setRecarregar(v => v + 1);
  };
  const salvarAvulso = async () => {
    if (!avulso) return;
    setOcupado(true);
    const r = await lancarAvulsoAction({
      conta_id: Number(avulso.conta), data: avulso.data, tipo: avulso.tipo, valor: num(avulso.valor), descricao: avulso.descricao,
      subcentro_id: avulso.subcentro ? Number(avulso.subcentro) : null, parceiro_nome: avulso.parceiro, ajuste: avulso.ajuste,
    }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Lançamento registrado.', 'success'); setAvulso(null); setRecarregar(v => v + 1);
  };
  const excluir = async (m: any) => {
    if (!(await confirmar({ message: `Excluir "${m.descricao}" (${formatarMoeda(m.valor)})?${m.transferencia ? ' As duas pontas da transferência saem.' : ''}`, danger: true, confirmLabel: 'Excluir' }))) return;
    const r = await excluirMovimentoAction(m.id, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Movimento excluído.', 'success'); setRecarregar(v => v + 1);
  };
  const exportar = () => {
    if (!extrato) return;
    const ws = XLSX.utils.json_to_sheet(extrato.linhas.map((l: any) => ({
      Data: formatarDataBR(l.data), Descrição: l.descricao, Parceiro: l.parceiro || '', Categoria: l.categoria || '', Documento: l.documento || '',
      Origem: ORIGEM[l.origem] || l.origem, Entrada: l.tipo === 'ENTRADA' ? l.valor : '', Saída: l.tipo === 'SAIDA' ? l.valor : '', Saldo: l.saldo,
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Extrato');
    XLSX.writeFile(wb, `extrato-${extrato.conta.nome.replace(/[^\w]+/g, '-')}-${de}-a-${ate}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#ECFDF5] border-b border-[#A7F3D0] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#047857] font-medium text-sm">🏦 <strong>Olá, {usuarioAtual}</strong>. Caixa e Bancos: saldos, extrato e transferências.</p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white border border-[#A7F3D0] text-[#047857] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ Voltar ao Financeiro</button>
      </div>

      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="flex flex-wrap gap-2 items-center">
            <select value={filtroEmpresa ?? ''} onChange={e => setFiltroEmpresa(e.target.value ? Number(e.target.value) : null)} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Todas as empresas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <button disabled={ocupado} onClick={() => abrirConta()} className={`${btn} bg-[#0C1D4D] text-white`}>+ Nova conta</button>
            <button disabled={ocupado} onClick={criarDoP2s} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>Criar contas do P2S</button>
            <button disabled={ocupado} onClick={sincronizar} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>⟳ Sincronizar P2S</button>
            <button disabled={ocupado || ativas.length < 2} onClick={() => setTransf({ de: String(ativas[0]?.id || ''), para: String(ativas[1]?.id || ''), data: hojeISO(), valor: '', descricao: '' })} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>⇄ Transferência</button>
            <button disabled={ocupado || !ativas.length} onClick={() => setAvulso({ conta: String(contaSel || ativas[0]?.id || ''), data: hojeISO(), tipo: 'SAIDA', valor: '', descricao: '', subcentro: '', parceiro: '', ajuste: false })} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>+ Lançamento avulso</button>
          </div>

          {empresas.some(e => e.fonte === 'P2S') && (
            <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              Transição em paralelo com o P2S: os pagamentos e recebimentos quitados no P2S entram aqui como movimentos (pela conta financeira do P2S), a partir da data do saldo inicial de cada conta. Sincroniza duas vezes ao dia e no botão “Sincronizar P2S”.
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {totalPorEmpresa.map(e => (
              <div key={e.id} className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
                <p className={`text-xl font-black ${e.saldo < 0 ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{carregando ? '—' : formatarMoeda(e.saldo)}</p>
                <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Saldo {e.nome} <span className="text-gray-400">· fonte {e.fonte === 'SISTEMA' ? 'sistema' : 'P2S'}</span></p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {!carregando && !contas.length && <div className="md:col-span-3 bg-white rounded-2xl border border-dashed border-[#CBD5E1] p-8 text-center text-sm text-gray-500">Nenhuma conta ainda. Use <strong>“Criar contas do P2S”</strong> para trazer as contas financeiras que o P2S usa, ou “+ Nova conta”.</div>}
            {contas.map(c => (
              <div key={c.id} onClick={() => { setContaSel(c.id); setExtrato(null); }} className={`bg-white rounded-2xl border shadow-sm p-4 cursor-pointer hover:shadow-md transition ${contaSel === c.id ? 'border-[#047857] ring-1 ring-[#047857]' : 'border-[#E2E8F0]'} ${c.ativa ? '' : 'opacity-50'}`}>
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-black text-[#0C1D4D]">{c.nome}</p>
                    <p className="text-[10px] text-gray-500"><span className={`font-black px-1.5 py-0.5 rounded ${corSeloEmpresa(c.empresa_id)}`}>{nomeEmpresa(c.empresa_id)}</span> · {TIPOS[c.tipo]}{c.agencia ? ` · ag ${c.agencia}` : ''}{c.numero_conta ? ` cc ${c.numero_conta}` : ''}{c.ativa ? '' : ' · inativa'}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); abrirConta(c); }} className="text-[10px] font-black text-[#336699] hover:underline">editar</button>
                </div>
                <p className={`text-2xl font-black mt-3 ${c.saldo < 0 ? 'text-red-600' : 'text-[#047857]'}`}>{formatarMoeda(c.saldo)}</p>
                <p className="text-[10px] text-gray-500">saldo inicial {formatarMoeda(c.saldo_inicial)} em {formatarDataBR(c.data_saldo_inicial)} · último movimento {formatarDataBR(c.ultimo_movimento)}</p>
                {c.pendentes_conciliar > 0 && <p className="text-[10px] font-bold text-amber-700 mt-1">{c.pendentes_conciliar} lançamento(s) do extrato a conciliar</p>}
                {!(c.nomes_p2s || []).length && empresas.find(e => e.id === c.empresa_id)?.fonte === 'P2S' && <p className="text-[10px] font-bold text-amber-700 mt-1">Sem conta do P2S ligada — os pagamentos do P2S não entram aqui.</p>}
              </div>
            ))}
          </div>

          {contaSel && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E2E8F0] flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Extrato · {extrato?.conta.nome || '…'}</h2>
                  {extrato && <p className="text-xs text-gray-500">Saldo anterior {formatarMoeda(extrato.saldo_anterior)} · entradas <span className="text-emerald-700 font-bold">{formatarMoeda(extrato.entradas)}</span> · saídas <span className="text-red-600 font-bold">{formatarMoeda(extrato.saidas)}</span> · saldo final <strong>{formatarMoeda(extrato.saldo_final)}</strong></p>}
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="text-[10px] font-bold">De<input type="date" value={de} onChange={e => setDe(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-xs" /></label>
                  <label className="text-[10px] font-bold">Até<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-xs" /></label>
                  <button onClick={exportar} disabled={!extrato?.linhas.length} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>Excel</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8]"><tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                    <th className="p-3">Data</th><th className="p-3">Descrição</th><th className="p-3">Categoria</th><th className="p-3">Origem</th><th className="p-3 text-right">Entrada</th><th className="p-3 text-right">Saída</th><th className="p-3 text-right">Saldo</th><th className="p-3"></th>
                  </tr></thead>
                  <tbody>
                    {extrato && !extrato.linhas.length && <tr><td colSpan={8} className="p-6 text-center text-gray-400">Sem movimentos no período.</td></tr>}
                    {(extrato?.linhas || []).map((l: any) => (
                      <tr key={l.id} className="border-t border-[#E2E8F0]">
                        <td className="p-3 whitespace-nowrap">{formatarDataBR(l.data)}</td>
                        <td className="p-3 min-w-[220px]"><p className="font-bold">{l.descricao}</p>{(l.parceiro || l.documento) && <p className="text-[10px] text-gray-500">{[l.parceiro, l.documento].filter(Boolean).join(' · ')}</p>}</td>
                        <td className="p-3 text-gray-600 min-w-[160px]">{l.categoria || '—'}</td>
                        <td className="p-3 whitespace-nowrap text-gray-500">{ORIGEM[l.origem] || l.origem}{l.conciliado ? ' · ✔ conciliado' : ''}</td>
                        <td className="p-3 text-right text-emerald-700 font-bold whitespace-nowrap">{l.tipo === 'ENTRADA' ? formatarMoeda(l.valor) : ''}</td>
                        <td className="p-3 text-right text-red-600 font-bold whitespace-nowrap">{l.tipo === 'SAIDA' ? formatarMoeda(l.valor) : ''}</td>
                        <td className={`p-3 text-right font-black whitespace-nowrap ${l.saldo < 0 ? 'text-red-600' : ''}`}>{formatarMoeda(l.saldo)}</td>
                        <td className="p-3">{['MANUAL', 'AJUSTE', 'TRANSFERENCIA', 'EXTRATO'].includes(l.origem) && <button onClick={() => excluir(l)} className="text-red-500 text-[10px] font-black">excluir</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal open={!!formConta} onClose={() => setFormConta(null)} title={formConta?.id ? '✏️ Editar conta' : '🏦 Nova conta'}
        footer={<div className="flex justify-end gap-2"><button onClick={() => setFormConta(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={salvarConta} className={`${btn} bg-[#0C1D4D] text-white`}>Salvar</button></div>}>
        {formConta && (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-xs font-bold">Empresa<select value={formConta.empresa_id} onChange={e => setFormConta({ ...formConta, empresa_id: Number(e.target.value) })} className={inp}>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></label>
              <label className="text-xs font-bold">Tipo<select value={formConta.tipo} onChange={e => setFormConta({ ...formConta, tipo: e.target.value })} className={inp}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="text-xs font-bold md:col-span-2">Nome<input value={formConta.nome} onChange={e => setFormConta({ ...formConta, nome: e.target.value })} placeholder="ex.: Itaú - Rentech" className={inp} /></label>
              <label className="text-xs font-bold">Banco (código)<input value={formConta.banco_codigo} onChange={e => setFormConta({ ...formConta, banco_codigo: e.target.value })} className={inp} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold">Agência<input value={formConta.agencia} onChange={e => setFormConta({ ...formConta, agencia: e.target.value })} className={inp} /></label>
                <label className="text-xs font-bold">Conta<input value={formConta.numero_conta} onChange={e => setFormConta({ ...formConta, numero_conta: e.target.value })} className={inp} /></label>
              </div>
              <label className="text-xs font-bold">Saldo inicial (R$)<input value={formConta.saldo_inicial} onChange={e => setFormConta({ ...formConta, saldo_inicial: e.target.value })} className={inp} /></label>
              <label className="text-xs font-bold">Saldo no fim do dia<input type="date" value={formConta.data_saldo_inicial} onChange={e => setFormConta({ ...formConta, data_saldo_inicial: e.target.value })} className={inp} /></label>
            </div>
            <p className="text-[10px] text-gray-500">Use o saldo do extrato do banco no fim de um dia. Os movimentos contam a partir do dia seguinte.</p>
            <label className="block text-xs font-bold">Conta(s) no P2S<input value={formConta.nomes_p2s} onChange={e => setFormConta({ ...formConta, nomes_p2s: e.target.value })} placeholder='ex.: Itaú - Rentech  (várias separadas por ";")' className={inp} /></label>
            <label className="block text-xs font-bold">Observações<input value={formConta.observacoes} onChange={e => setFormConta({ ...formConta, observacoes: e.target.value })} className={inp} /></label>
            <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={formConta.ativa} onChange={e => setFormConta({ ...formConta, ativa: e.target.checked })} /> Conta ativa</label>
          </>
        )}
      </Modal>

      <Modal open={!!transf} onClose={() => setTransf(null)} title="⇄ Transferência entre contas"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setTransf(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={salvarTransf} className={`${btn} bg-[#0C1D4D] text-white`}>Transferir</button></div>}>
        {transf && (
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-xs font-bold">De<select value={transf.de} onChange={e => setTransf({ ...transf, de: e.target.value })} className={inp}>{ativas.map(c => <option key={c.id} value={c.id}>{c.nome} ({nomeEmpresa(c.empresa_id)})</option>)}</select></label>
            <label className="text-xs font-bold">Para<select value={transf.para} onChange={e => setTransf({ ...transf, para: e.target.value })} className={inp}>{ativas.map(c => <option key={c.id} value={c.id}>{c.nome} ({nomeEmpresa(c.empresa_id)})</option>)}</select></label>
            <label className="text-xs font-bold">Data<input type="date" value={transf.data} onChange={e => setTransf({ ...transf, data: e.target.value })} className={inp} /></label>
            <label className="text-xs font-bold">Valor (R$)<input value={transf.valor} onChange={e => setTransf({ ...transf, valor: e.target.value })} className={inp} /></label>
            <label className="text-xs font-bold md:col-span-2">Descrição<input value={transf.descricao} onChange={e => setTransf({ ...transf, descricao: e.target.value })} placeholder="opcional" className={inp} /></label>
          </div>
        )}
      </Modal>

      <Modal open={!!avulso} onClose={() => setAvulso(null)} title="+ Lançamento avulso"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setAvulso(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={salvarAvulso} className={`${btn} bg-[#0C1D4D] text-white`}>Lançar</button></div>}>
        {avulso && (
          <>
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Use para o que não passa por conta a pagar/receber (tarifa, rendimento, ajuste). Enquanto a fonte for o P2S, o que já está lançado lá entra sozinho — não lance de novo.</p>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="text-xs font-bold">Conta<select value={avulso.conta} onChange={e => setAvulso({ ...avulso, conta: e.target.value })} className={inp}>{ativas.map(c => <option key={c.id} value={c.id}>{c.nome} ({nomeEmpresa(c.empresa_id)})</option>)}</select></label>
              <label className="text-xs font-bold">Tipo<select value={avulso.tipo} onChange={e => setAvulso({ ...avulso, tipo: e.target.value as any })} className={inp}><option value="SAIDA">Saída</option><option value="ENTRADA">Entrada</option></select></label>
              <label className="text-xs font-bold">Data<input type="date" value={avulso.data} onChange={e => setAvulso({ ...avulso, data: e.target.value })} className={inp} /></label>
              <label className="text-xs font-bold">Valor (R$)<input value={avulso.valor} onChange={e => setAvulso({ ...avulso, valor: e.target.value })} className={inp} /></label>
              <label className="text-xs font-bold md:col-span-2">Descrição<input value={avulso.descricao} onChange={e => setAvulso({ ...avulso, descricao: e.target.value })} className={inp} /></label>
              <label className="text-xs font-bold md:col-span-2">Classificação (plano de contas)
                <select value={avulso.subcentro} onChange={e => setAvulso({ ...avulso, subcentro: e.target.value })} className={inp}><option value="">— sem classificação —</option>{(info?.subcentros || []).map((s: any) => <option key={s.id} value={s.id}>{s.nome}</option>)}</select>
              </label>
              <label className="text-xs font-bold md:col-span-2">Favorecido / pagador<input value={avulso.parceiro} onChange={e => setAvulso({ ...avulso, parceiro: e.target.value })} placeholder="opcional" className={inp} /></label>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={avulso.ajuste} onChange={e => setAvulso({ ...avulso, ajuste: e.target.checked })} /> É ajuste de saldo (diferença com o extrato)</label>
          </>
        )}
      </Modal>
    </div>
  );
}
