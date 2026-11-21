"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  painelFaturamentoAction, composicaoOsAction, emitirFaturaAction, emitirLoteAction, cancelarFaturaAction, pdfFaturaAction,
  enviarEmailFaturaAction, whatsappFaturaAction, marcarWhatsappAction,
} from './actions';

// Faturamento — Nota de Débito (2026-11-20): fila "a faturar" (OS finalizadas),
// emissão individual ou em lote, envio por e-mail/WhatsApp e link público.
const SITUACAO: Record<string, { rot: string; cls: string }> = {
  EM_ABERTO: { rot: 'em aberto', cls: 'bg-blue-100 text-blue-700' }, PARCIAL: { rot: 'paga em parte', cls: 'bg-amber-100 text-amber-700' },
  PAGA: { rot: 'paga', cls: 'bg-emerald-100 text-emerald-700' }, VENCIDA: { rot: 'vencida', cls: 'bg-red-100 text-red-700' }, CANCELADA: { rot: 'cancelada', cls: 'bg-gray-200 text-gray-500' },
};
const FORMAS = ['TRANSFERÊNCIA', 'PIX', 'BOLETO', 'DEPÓSITO', 'CARTÃO'];
const num = (s: string) => { const x = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const inp = 'mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm';

function baixar(base64: string, nome: string) {
  const bin = atob(base64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([b], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function Conteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [aba, setAba] = useState<'fila' | 'emitidas'>('fila');
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [emAndamento, setEmAndamento] = useState(false);
  const [de, setDe] = useState(`${hojeISO().slice(0, 8)}01`);
  const [ate, setAte] = useState(hojeISO());
  const [busca, setBusca] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [emitir, setEmitir] = useState<any>(null);
  const [ef, setEf] = useState({ nParcelas: '1', primeiro: '', forma: '', obs: '', desconto: '', parcelas: [] as { valor: string; vencimento: string }[] });

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await painelFaturamentoAction({ empresaId, emAndamento, de, ate }, accessToken);
      if (!vivo) return;
      if (r.ok) setInfo(r.info); else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, empresaId, emAndamento, de, ate, recarregar]);

  // ?os=ID abre direto a emissão (link vindo da OS)
  const osParam = params.get('os');
  useEffect(() => {
    if (!osParam || !accessToken || authLoading || acessoNegado) return;
    abrirEmitir(Number(osParam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osParam, accessToken, authLoading, acessoNegado]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200"><div className="text-5xl mb-4">⛔</div><h2 className="text-xl font-black text-red-600 uppercase mb-4">Acesso Restrito</h2><button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Financeiro</button></div></div>;

  const tok = accessToken as string;
  const atualizar = () => setRecarregar(v => v + 1);
  const empresas: any[] = info?.empresas || [];
  const nomeEmpresa = (id: number) => empresas.find(e => e.id === id)?.nome || '';
  const t = busca.trim().toLowerCase();
  const fila: any[] = (info?.fila || []).filter((o: any) => !t || [o.numero, o.cliente, o.evento].some((x: string | null) => (x || '').toLowerCase().includes(t)));
  const faturas: any[] = (info?.faturas || []).filter((x: any) => !t || [x.numero, x.cliente, x.os].some((y: string | null) => (y || '').toLowerCase().includes(t)));

  const gerarParcelas = (total: number, k: number, primeiro: string) => {
    const q = Math.max(1, Math.min(24, k || 1)); const base = Math.floor((total / q) * 100) / 100;
    return Array.from({ length: q }, (_, i) => ({ valor: String(i === q - 1 ? Math.round((total - base * (q - 1)) * 100) / 100 : base).replace('.', ','), vencimento: somarDias(primeiro, i * 30) }));
  };
  async function abrirEmitir(id: number) {
    setOcupado(true);
    const r = await composicaoOsAction(id, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    const c = r.info;
    const primeiro = c.parcelasSugeridas[0]?.vencimento || somarDias(hojeISO(), 7);
    setEmitir(c);
    setEf({ nParcelas: '1', primeiro, forma: c.os.forma || 'TRANSFERÊNCIA', obs: '', desconto: '', parcelas: gerarParcelas(c.saldo, 1, primeiro) });
  }
  const totalEmitir = emitir ? Math.round((emitir.saldo - num(ef.desconto)) * 100) / 100 : 0;
  const recalc = (k: string, primeiro: string, desconto: string) => setEf(p => ({ ...p, nParcelas: k, primeiro, desconto, parcelas: gerarParcelas(Math.round(((emitir?.saldo || 0) - num(desconto)) * 100) / 100, Number(k) || 1, primeiro) }));
  const confirmarEmissao = async () => {
    setOcupado(true);
    const r = await emitirFaturaAction(emitir.os.id, {
      parcelas: ef.parcelas.map(p => ({ valor: num(p.valor), vencimento: p.vencimento })), forma_pagamento: ef.forma || null, observacoes: ef.obs, desconto_extra: num(ef.desconto),
    }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao emitir.', 'error'); return; }
    toast(`Nota de Débito ${r.info.numero} emitida${r.info.serie === 'ENSAIO' ? ' (ensaio)' : ''} — ${formatarMoeda(r.info.total)}.`, 'success');
    setEmitir(null); setAba('emitidas'); atualizar();
    if (osParam) router.replace('/admin/financeiro/faturamento');
  };
  const lote = async () => {
    const ids = [...sel];
    const dias = await pedir({ title: `Faturar ${ids.length} OS em lote`, message: 'Uma Nota de Débito por OS, parcela única. Vencimento em quantos dias?', defaultValue: '7', confirmLabel: 'Faturar' });
    if (!dias) return;
    setOcupado(true);
    const r = await emitirLoteAction(ids, Number(dias), tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(`${r.info.emitidas.length} Nota(s) de Débito emitida(s).${r.info.falhas.length ? ` Falharam: ${r.info.falhas.join('; ')}` : ''}`, r.info.falhas.length ? 'info' : 'success');
    setSel(new Set()); atualizar();
  };
  const pdf = async (f: any) => {
    const r = await pdfFaturaAction(f.id, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    baixar(r.info.base64, r.info.nome);
  };
  const email = async (f: any) => {
    const w = await whatsappFaturaAction(f.id, tok);
    const sugerido = f.serie === 'ENSAIO' ? info?.usuarioEmail : (w.ok ? w.info.emailSugerido : '') || '';
    const para = await pedir({ title: `Enviar Nota de Débito ${f.numero} por e-mail`, message: f.serie === 'ENSAIO' ? 'Fatura de ENSAIO: só pode ir para o seu e-mail (teste).' : 'E-mail do cliente (contato da OS / financeiro):', defaultValue: sugerido, confirmLabel: 'Enviar' });
    if (!para) return;
    setOcupado(true);
    const r = await enviarEmailFaturaAction(f.id, para, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao enviar.', 'error'); return; }
    toast(`Enviada para ${para}.`, 'success'); atualizar();
  };
  const whatsapp = async (f: any) => {
    const r = await whatsappFaturaAction(f.id, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    if (f.serie === 'ENSAIO' && !(await confirmar({ title: 'Fatura de ENSAIO', message: 'Esta fatura é de ensaio (o P2S ainda é oficial). Abrir o WhatsApp mesmo assim, para teste? Não mande para o cliente.', confirmLabel: 'Abrir para teste' }))) return;
    if (!r.info.telefone) toast('Sem telefone do contato na OS/cliente — escolha o contato no WhatsApp.', 'info');
    window.open(r.info.link, '_blank');
    await marcarWhatsappAction(f.id, tok);
    atualizar();
  };
  const copiarLink = async (f: any) => { try { await navigator.clipboard.writeText(f.link); toast('Link copiado.', 'success'); } catch { toast(f.link, 'info'); } };
  const cancelar = async (f: any) => {
    const motivo = await pedir({ title: `Cancelar Nota de Débito ${f.numero}`, message: 'Motivo do cancelamento (as parcelas em aberto também são canceladas):', confirmLabel: 'Cancelar nota' });
    if (!motivo) return;
    const r = await cancelarFaturaAction(f.id, motivo, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Nota de Débito cancelada — a OS volta para a fila a faturar.', 'success'); atualizar();
  };
  const exportar = () => {
    const ws = XLSX.utils.json_to_sheet(faturas.map(f => ({ Número: f.numero, Série: f.serie, Empresa: nomeEmpresa(f.empresa_id), Emissão: formatarDataBR(f.emissao), Cliente: f.cliente, OS: f.os || '', Valor: f.valor, Situação: SITUACAO[f.situacao]?.rot, 'E-mail enviado': f.email_em ? formatarDataBR(f.email_em) : '' })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Notas de débito'); XLSX.writeFile(wb, `notas-de-debito-${de}-a-${ate}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#ECFDF5] border-b border-[#A7F3D0] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#047857] font-medium text-sm">🧾 <strong>Olá, {usuarioAtual}</strong>. Faturamento: Notas de Débito das locações devolvidas.</p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white border border-[#A7F3D0] text-[#047857] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ Voltar ao Financeiro</button>
      </div>
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className="text-xl font-black text-amber-700">{info ? formatarMoeda(info.kpis.aFaturar.valor) : '—'}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">A faturar · {info?.kpis.aFaturar.qtd ?? '—'} OS</p></div>
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className="text-xl font-black text-[#047857]">{info ? formatarMoeda(info.kpis.faturado.valor) : '—'}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Faturado no período · {info?.kpis.faturado.qtd ?? '—'}</p></div>
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className="text-xl font-black text-red-600">{info?.kpis.vencidas ?? '—'}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Notas com parcela vencida</p></div>
          </div>
          {empresas.some(e => e.fonte === 'P2S') && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Transição: enquanto a fonte financeira da empresa for o P2S, as Notas de Débito daqui são de <strong>ENSAIO</strong> (numeração ENS-, marca d’água, e-mail só para você) — a oficial continua sendo emitida no P2S. Na virada da chave, a numeração oficial continua do último nº do P2S.</p>}

          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-[10px] font-black uppercase tracking-wider bg-white">
              {([['fila', `A faturar${info ? ` (${info.fila.length})` : ''}`], ['emitidas', 'Notas emitidas']] as const).map(([v, r]) => <button key={v} onClick={() => setAba(v)} className={`px-4 py-2.5 ${aba === v ? 'bg-[#047857] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{r}</button>)}
            </div>
            <select value={empresaId ?? ''} onChange={e => setEmpresaId(e.target.value ? Number(e.target.value) : null)} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white"><option value="">Todas as empresas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar OS, cliente, evento, nº…" className="flex-1 min-w-[200px] border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" />
            {aba === 'fila' && <label className="text-[11px] font-bold flex items-center gap-1 bg-white border border-[#E2E8F0] rounded-lg px-3 py-2"><input type="checkbox" checked={emAndamento} onChange={e => setEmAndamento(e.target.checked)} /> incluir OS ainda em locação (antecipar)</label>}
            {aba === 'fila' && <button disabled={ocupado || !sel.size} onClick={lote} className={`${btn} bg-[#047857] text-white`}>Faturar {sel.size || ''} em lote</button>}
            {aba === 'emitidas' && (
              <>
                <label className="text-[10px] font-bold">Emissão de<input type="date" value={de} onChange={e => setDe(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-xs" /></label>
                <label className="text-[10px] font-bold">até<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-2 py-1.5 text-xs" /></label>
                <button onClick={exportar} disabled={!faturas.length} className={`${btn} bg-white border border-[#E2E8F0]`}>Excel</button>
              </>
            )}
            {carregando && <span className="text-xs text-gray-400">carregando…</span>}
          </div>

          {aba === 'fila' && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8]"><tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                  <th className="p-3"><input type="checkbox" checked={!!fila.length && fila.every(o => sel.has(o.id))} onChange={e => setSel(e.target.checked ? new Set(fila.map(o => o.id)) : new Set())} /></th>
                  <th className="p-3">OS</th><th className="p-3">Cliente / evento</th><th className="p-3">Período</th><th className="p-3">Devolvida</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Já cobrado</th><th className="p-3 text-right">A faturar</th><th className="p-3"></th>
                </tr></thead>
                <tbody>
                  {!carregando && !fila.length && <tr><td colSpan={9} className="p-8 text-center text-gray-400">Nada a faturar. As OSs entram aqui quando todos os equipamentos voltam (ficha de locação finalizada).</td></tr>}
                  {fila.map(o => (
                    <tr key={o.id} className="border-t border-[#E2E8F0]">
                      <td className="p-3"><input type="checkbox" checked={sel.has(o.id)} onChange={e => setSel(prev => { const s = new Set(prev); if (e.target.checked) s.add(o.id); else s.delete(o.id); return s; })} /></td>
                      <td className="p-3 whitespace-nowrap"><button onClick={() => router.push(`/admin/locacoes/reservas/${o.id}`)} className="font-black text-[#0C1D4D] hover:underline">{o.numero}</button> <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${corSeloEmpresa(o.empresa_id)}`}>{nomeEmpresa(o.empresa_id)}</span>{o.status !== 'FINALIZADA' && <span className="block text-[9px] text-amber-700 font-bold">{o.status === 'EM_LOCACAO' ? 'em locação' : 'reservada'}</span>}</td>
                      <td className="p-3 min-w-[200px]"><p className="font-bold">{o.cliente}</p>{o.evento && <p className="text-[10px] text-gray-500">{o.evento}</p>}</td>
                      <td className="p-3 whitespace-nowrap">{formatarDataBR(o.inicio)} a {formatarDataBR(o.fim)}</td>
                      <td className="p-3 whitespace-nowrap">{formatarDataBR(o.devolucao)}</td>
                      <td className="p-3 text-right whitespace-nowrap">{formatarMoeda(o.total)}</td>
                      <td className="p-3 text-right whitespace-nowrap text-gray-500">{o.ja_faturado ? formatarMoeda(o.ja_faturado) : '—'}</td>
                      <td className="p-3 text-right whitespace-nowrap font-black">{formatarMoeda(o.saldo)}</td>
                      <td className="p-3"><button disabled={ocupado} onClick={() => abrirEmitir(o.id)} className="text-[10px] font-black text-white bg-[#047857] px-3 py-1.5 rounded-lg">Faturar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {aba === 'emitidas' && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8]"><tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                  <th className="p-3">Nota</th><th className="p-3">Emissão</th><th className="p-3">Cliente</th><th className="p-3">OS</th><th className="p-3 text-right">Valor</th><th className="p-3">Situação</th><th className="p-3">Envio</th><th className="p-3"></th>
                </tr></thead>
                <tbody>
                  {!carregando && !faturas.length && <tr><td colSpan={8} className="p-8 text-center text-gray-400">Nenhuma Nota de Débito no período.</td></tr>}
                  {faturas.map(f => (
                    <tr key={f.id} className="border-t border-[#E2E8F0]">
                      <td className="p-3 whitespace-nowrap"><strong>{f.numero}</strong> {f.serie === 'ENSAIO' && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ensaio</span>}{f.antecipada && <span className="ml-1 text-[9px] text-gray-500">antecipada</span>}</td>
                      <td className="p-3 whitespace-nowrap">{formatarDataBR(f.emissao)}</td>
                      <td className="p-3 min-w-[180px] font-bold">{f.cliente} <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${corSeloEmpresa(f.empresa_id)}`}>{nomeEmpresa(f.empresa_id)}</span></td>
                      <td className="p-3 whitespace-nowrap">{f.os ? <button onClick={() => router.push(`/admin/locacoes/reservas/${f.os_id}`)} className="text-[#336699] font-bold hover:underline">{f.os}</button> : '—'}</td>
                      <td className="p-3 text-right font-black whitespace-nowrap">{formatarMoeda(f.valor)}</td>
                      <td className="p-3"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${SITUACAO[f.situacao]?.cls}`}>{SITUACAO[f.situacao]?.rot}</span></td>
                      <td className="p-3 text-[10px] text-gray-500 whitespace-nowrap">{f.email_em ? `✉ ${formatarDataBR(f.email_em)}` : ''}{f.whatsapp_em ? ` · 💬 ${formatarDataBR(f.whatsapp_em)}` : ''}{!f.email_em && !f.whatsapp_em ? '—' : ''}</td>
                      <td className="p-3 whitespace-nowrap text-right space-x-2">
                        <button onClick={() => pdf(f)} className="text-[10px] font-black text-[#336699]">PDF</button>
                        {f.status !== 'CANCELADA' && <button onClick={() => email(f)} className="text-[10px] font-black text-[#336699]">e-mail</button>}
                        {f.status !== 'CANCELADA' && <button onClick={() => whatsapp(f)} className="text-[10px] font-black text-[#047857]">WhatsApp</button>}
                        {f.status !== 'CANCELADA' && <button onClick={() => copiarLink(f)} className="text-[10px] font-black text-gray-500">link</button>}
                        {f.status !== 'CANCELADA' && <button onClick={() => router.push(`/admin/financeiro/fiscal?fatura=${f.id}`)} className="text-[10px] font-black text-slate-600" title="Emitir NFS-e (serviços ou locação) a partir desta Nota de Débito">NFS-e</button>}
                        {f.status !== 'CANCELADA' && f.situacao !== 'PAGA' && <button onClick={() => cancelar(f)} className="text-[10px] font-black text-gray-400 hover:text-red-500">cancelar</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal open={!!emitir} onClose={() => { setEmitir(null); if (osParam) router.replace('/admin/financeiro/faturamento'); }} title={emitir ? `🧾 Faturar ${emitir.os.numero}` : ''} maxWidthClassName="max-w-3xl"
        footer={<div className="flex flex-col md:flex-row justify-between gap-3 md:items-center"><span className="text-sm font-black text-[#0C1D4D]">Nota de Débito {emitir?.serie === 'ENSAIO' ? '(ensaio)' : ''}: {formatarMoeda(totalEmitir)}</span><div className="flex gap-2 justify-end"><button onClick={() => setEmitir(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado || !emitir || emitir.saldo <= 0} onClick={confirmarEmissao} className={`${btn} bg-[#047857] text-white`}>{ocupado ? 'Emitindo…' : 'Emitir Nota de Débito'}</button></div></div>}>
        {emitir && (
          <>
            <p className="text-sm"><strong>{emitir.os.cliente}</strong>{emitir.os.evento ? ` · ${emitir.os.evento}` : ''} · {formatarDataBR(emitir.os.inicio)} a {formatarDataBR(emitir.os.fim)}{emitir.os.status !== 'FINALIZADA' ? <span className="ml-2 text-[10px] font-black text-amber-700 uppercase">faturamento antecipado</span> : null}</p>
            <div className="border border-[#E2E8F0] rounded-xl max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {emitir.itens.map((i: any, k: number) => <tr key={k} className="border-b border-[#F1F5F9]"><td className="p-2">{i.descricao}<span className="text-gray-400"> · {i.quantidade}{i.dias ? ` × ${i.dias}d` : ''}</span></td><td className="p-2 text-right whitespace-nowrap">{formatarMoeda(i.valor_total)}</td></tr>)}
                  {emitir.descontoOs > 0 && <tr className="text-gray-500"><td className="p-2">Desconto da OS</td><td className="p-2 text-right">−{formatarMoeda(emitir.descontoOs)}</td></tr>}
                  {emitir.prorrogacoes.map((p: any, k: number) => <tr key={`p${k}`} className="text-violet-700"><td className="p-2">{p.descricao}</td><td className="p-2 text-right">{formatarMoeda(p.valor_total)}</td></tr>)}
                  {emitir.jaGerado > 0 && <tr className="text-gray-500"><td className="p-2">Já faturado/cobrado antes</td><td className="p-2 text-right">−{formatarMoeda(emitir.jaGerado)}</td></tr>}
                  <tr className="font-black"><td className="p-2">Saldo a faturar</td><td className="p-2 text-right">{formatarMoeda(emitir.saldo)}</td></tr>
                </tbody>
              </table>
            </div>
            {emitir.prorrogacoes.length > 0 && <p className="text-[10px] text-violet-700">Prorrogação entra pelo valor estimado na hora da prorrogação — se o comercial combinou outro, ajuste com o desconto.</p>}
            <div className="grid md:grid-cols-4 gap-3">
              <label className="text-xs font-bold">Parcelas<input type="number" min={1} max={24} value={ef.nParcelas} onChange={e => recalc(e.target.value, ef.primeiro, ef.desconto)} className={inp} /></label>
              <label className="text-xs font-bold">1º vencimento<input type="date" value={ef.primeiro} onChange={e => recalc(ef.nParcelas, e.target.value, ef.desconto)} className={inp} /></label>
              <label className="text-xs font-bold">Desconto (R$)<input value={ef.desconto} onChange={e => recalc(ef.nParcelas, ef.primeiro, e.target.value)} placeholder="0,00" className={inp} /></label>
              <label className="text-xs font-bold">Forma<select value={ef.forma} onChange={e => setEf({ ...ef, forma: e.target.value })} className={inp}>{FORMAS.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
            </div>
            {emitir.os.condicao && <p className="text-[10px] text-gray-500">Condição combinada na OS: {emitir.os.condicao}</p>}
            <div className="space-y-1">
              {ef.parcelas.map((p, k) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <span className="w-10 font-bold">{k + 1}/{ef.parcelas.length}</span>
                  <input type="date" value={p.vencimento} onChange={e => setEf(prev => ({ ...prev, parcelas: prev.parcelas.map((x, j) => j === k ? { ...x, vencimento: e.target.value } : x) }))} className="border rounded-lg px-2 py-1.5" />
                  <input value={p.valor} onChange={e => setEf(prev => ({ ...prev, parcelas: prev.parcelas.map((x, j) => j === k ? { ...x, valor: e.target.value } : x) }))} className="w-32 border rounded-lg px-2 py-1.5 text-right" />
                </div>
              ))}
            </div>
            <label className="block text-xs font-bold">Observações (saem na nota)<input value={ef.obs} onChange={e => setEf({ ...ef, obs: e.target.value })} className={inp} /></label>
            {emitir.faturas.length > 0 && <p className="text-[10px] text-gray-500">Notas anteriores desta OS: {emitir.faturas.map((f: any) => `${f.numero} (${f.status === 'CANCELADA' ? 'cancelada' : formatarMoeda(f.valor)})`).join(', ')}</p>}
          </>
        )}
      </Modal>
    </div>
  );
}

export default function FaturamentoPage() {
  return <Suspense fallback={null}><Conteudo /></Suspense>;
}
