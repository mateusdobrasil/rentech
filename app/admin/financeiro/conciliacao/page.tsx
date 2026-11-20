"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/NotificationProvider';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { hojeISO } from '../../../lib/locacao/datas';
import {
  contasConciliacaoAction, previaOfxAction, importarOfxAction, painelConciliacaoAction, conciliarAutomaticoAction, conciliarManualAction,
  lancarDoExtratoAction, ignorarLinhaAction, desfazerLinhaAction,
} from './actions';

// Conciliação bancária por OFX (Financeiro completo, 2026-11-20).
const STATUS: Record<string, string> = { PENDENTE: 'bg-amber-100 text-amber-700', CONCILIADO: 'bg-emerald-100 text-emerald-700', IGNORADO: 'bg-gray-200 text-gray-500' };
const ROT: Record<string, string> = { PENDENTE: 'pendente', CONCILIADO: 'conciliado', IGNORADO: 'ignorado' };
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const inp = 'mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm';
const dist = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000));

export default function ConciliacaoPage() {
  const router = useRouter();
  const toast = useToast();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [contas, setContas] = useState<any[]>([]);
  const [subcentros, setSubcentros] = useState<{ id: number; nome: string }[]>([]);
  const [contaId, setContaId] = useState<number | null>(null);
  const [de, setDe] = useState(`${hojeISO().slice(0, 8)}01`);
  const [ate, setAte] = useState(hojeISO());
  const [painel, setPainel] = useState<any>(null);
  const [soPendentes, setSoPendentes] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<{ base64: string; nome: string; info: any; conta: string } | null>(null);
  const [resolver, setResolver] = useState<any>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [lanc, setLanc] = useState({ descricao: '', subcentro: '', parceiro: '' });

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    contasConciliacaoAction(accessToken).then(r => {
      if (!r.ok) { toast(r.erro || 'Erro.', 'error'); return; }
      setContas(r.info.contas); setSubcentros(r.info.subcentros);
      setContaId(id => id ?? (r.info.contas.sort((a: any, b: any) => b.pendentes - a.pendentes)[0]?.id ?? null));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, recarregar]);

  useEffect(() => {
    if (!contaId || !accessToken) return;
    let vivo = true;
    painelConciliacaoAction(contaId, de, ate, accessToken).then(r => { if (vivo) { if (r.ok) setPainel(r.info); else toast(r.erro || 'Erro.', 'error'); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contaId, de, ate, accessToken, recarregar]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200"><div className="text-5xl mb-4">⛔</div><h2 className="text-xl font-black text-red-600 uppercase mb-4">Acesso Restrito</h2><button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Financeiro</button></div></div>;

  const tok = accessToken as string;
  const atualizar = () => setRecarregar(v => v + 1);

  const escolherArquivo = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) { toast('Arquivo grande demais (máx. 5 MB).', 'error'); return; }
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const base64 = btoa(bin);
    setOcupado(true);
    const r = await previaOfxAction(base64, tok);
    setOcupado(false);
    if (arquivoRef.current) arquivoRef.current.value = '';
    if (!r.ok) { toast(r.erro || 'Não foi possível ler o arquivo.', 'error'); return; }
    setPrevia({ base64, nome: f.name, info: r.info, conta: String(r.info.contaSugeridaId || contaId || contas[0]?.id || '') });
  };
  const importar = async () => {
    if (!previa?.conta) { toast('Escolha a conta.', 'error'); return; }
    setOcupado(true);
    const r = await importarOfxAction(Number(previa.conta), previa.base64, previa.nome, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao importar.', 'error'); return; }
    const i = r.info;
    toast(`${i.novas} lançamento(s) novo(s)${i.repetidas ? ` (${i.repetidas} já importado(s))` : ''} · ${i.conciliadas} conciliado(s) automaticamente.${i.antesDoSaldo ? ' Atenção: o extrato começa antes do saldo inicial da conta — esses lançamentos não têm par no sistema (ignore-os).' : ''}`, 'success');
    setContaId(Number(previa.conta)); setPrevia(null); atualizar();
  };
  const auto = async () => {
    if (!contaId) return;
    setOcupado(true);
    const r = await conciliarAutomaticoAction(contaId, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(`${r.info.conciliadas} lançamento(s) conciliado(s).`, 'success'); atualizar();
  };
  const abrirResolver = (l: any) => { setResolver(l); setSelecionados(new Set()); setLanc({ descricao: l.descricao, subcentro: '', parceiro: '' }); };
  const acao = async (fn: () => Promise<any>, msg: string) => {
    setOcupado(true);
    const r = await fn();
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return false; }
    toast(msg, 'success'); atualizar(); return true;
  };

  const linhas = (painel?.linhas || []).filter((l: any) => !soPendentes || l.status === 'PENDENTE');
  const conta = contas.find(c => c.id === contaId);
  const candidatos = resolver ? (painel?.candidatos || [])
    .filter((m: any) => m.tipo === (resolver.valor >= 0 ? 'ENTRADA' : 'SAIDA') && dist(m.data, resolver.data) <= 10)
    .sort((a: any, b: any) => (Math.abs(a.valor - Math.abs(resolver.valor)) - Math.abs(b.valor - Math.abs(resolver.valor))) || dist(a.data, resolver.data) - dist(b.data, resolver.data)) : [];
  const somaSel = candidatos.filter((m: any) => selecionados.has(m.id)).reduce((a: number, m: any) => a + m.valor, 0);
  const alvo = resolver ? Math.abs(resolver.valor) : 0;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#ECFDF5] border-b border-[#A7F3D0] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#047857] font-medium text-sm">🔗 <strong>Olá, {usuarioAtual}</strong>. Conciliação bancária: extrato do banco (OFX) × movimentos do sistema.</p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white border border-[#A7F3D0] text-[#047857] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ Voltar ao Financeiro</button>
      </div>
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          {!contas.length && <div className="bg-white rounded-2xl border border-dashed border-[#CBD5E1] p-8 text-center text-sm text-gray-500">Nenhuma conta financeira ainda. Cadastre em <button className="text-[#336699] font-bold underline" onClick={() => router.push('/admin/financeiro/caixa')}>Caixa e Bancos</button> (com o saldo inicial) antes de conciliar.</div>}
          {contas.length > 0 && (
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-[10px] font-bold">Conta<select value={contaId ?? ''} onChange={e => setContaId(Number(e.target.value))} className="block border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white">{contas.map(c => <option key={c.id} value={c.id}>{c.nome}{c.pendentes ? ` (${c.pendentes} pendentes)` : ''}</option>)}</select></label>
              <label className="text-[10px] font-bold">De<input type="date" value={de} onChange={e => setDe(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
              <label className="text-[10px] font-bold">Até<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="block border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
              <input ref={arquivoRef} type="file" accept=".ofx,.OFX,application/x-ofx,text/plain" className="hidden" onChange={e => escolherArquivo(e.target.files?.[0])} />
              <button disabled={ocupado} onClick={() => arquivoRef.current?.click()} className={`${btn} bg-[#047857] text-white`}>⬆ Importar OFX</button>
              <button disabled={ocupado || !painel?.resumo.pendentes} onClick={auto} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>⚡ Conciliar automaticamente</button>
            </div>
          )}

          {painel && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className="text-xl font-black text-amber-700">{painel.resumo.pendentes}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Do banco a conciliar</p></div>
                <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className="text-xl font-black text-emerald-700">{painel.resumo.conciliadas}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Conciliados</p></div>
                <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className="text-xl font-black text-[#0C1D4D]">{painel.soNoSistema.length}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Só no sistema</p></div>
                <div className="md:col-span-2 bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
                  {painel.comparacao ? (
                    <>
                      <p className={`text-xl font-black ${Math.abs(painel.comparacao.diferenca) < 0.01 ? 'text-emerald-700' : 'text-red-600'}`}>{Math.abs(painel.comparacao.diferenca) < 0.01 ? '✔ Saldo bate' : `Diferença ${formatarMoeda(painel.comparacao.diferenca)}`}</p>
                      <p className="text-[10px] text-gray-500 mt-1">Em {formatarDataBR(painel.comparacao.data)}: banco {formatarMoeda(painel.comparacao.banco)} · sistema {formatarMoeda(painel.comparacao.sistema)}</p>
                    </>
                  ) : <p className="text-xs text-gray-500">Importe um OFX com saldo (depois da data do saldo inicial) para comparar banco × sistema.</p>}
                </div>
              </div>

              <div className="grid xl:grid-cols-[3fr_2fr] gap-4">
                <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-[#E2E8F0] flex justify-between items-center">
                    <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Extrato do banco</h2>
                    <label className="text-[10px] font-bold flex items-center gap-1"><input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} /> só pendentes</label>
                  </div>
                  <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[#F0F4F8] sticky top-0"><tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]"><th className="p-3">Data</th><th className="p-3">Histórico</th><th className="p-3 text-right">Valor</th><th className="p-3">Situação</th><th className="p-3"></th></tr></thead>
                      <tbody>
                        {!linhas.length && <tr><td colSpan={5} className="p-6 text-center text-gray-400">{painel.linhas.length ? 'Tudo conciliado no período. ✔' : 'Nenhum lançamento do banco no período — importe o OFX.'}</td></tr>}
                        {linhas.map((l: any) => (
                          <tr key={l.id} className="border-t border-[#E2E8F0]">
                            <td className="p-3 whitespace-nowrap">{formatarDataBR(l.data)}</td>
                            <td className="p-3 min-w-[220px]"><p className="font-bold">{l.descricao}</p>{l.movimento && <p className="text-[10px] text-emerald-700">↔ {l.movimento}</p>}{l.documento && <p className="text-[10px] text-gray-400">doc {l.documento}</p>}</td>
                            <td className={`p-3 text-right font-black whitespace-nowrap ${l.valor < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatarMoeda(l.valor)}</td>
                            <td className="p-3"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS[l.status]}`}>{ROT[l.status]}</span></td>
                            <td className="p-3 whitespace-nowrap">{l.status === 'PENDENTE'
                              ? <button onClick={() => abrirResolver(l)} className="text-[10px] font-black text-[#336699] hover:underline">resolver</button>
                              : <button onClick={() => acao(() => desfazerLinhaAction(l.id, tok), 'Desfeito.')} className="text-[10px] font-black text-gray-400 hover:text-red-500">desfazer</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-[#E2E8F0]"><h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Só no sistema</h2><p className="text-[10px] text-gray-500">Movimentos do período sem lançamento do banco (ainda não compensou, ou não casou).</p></div>
                  <div className="max-h-[70vh] overflow-y-auto divide-y divide-[#E2E8F0]">
                    {!painel.soNoSistema.length && <p className="p-5 text-xs text-gray-400">Nada pendente.</p>}
                    {painel.soNoSistema.map((m: any) => (
                      <div key={m.id} className="p-3 text-xs flex justify-between gap-3">
                        <span><strong>{formatarDataBR(m.data)}</strong> · {m.descricao}{m.parceiro_nome ? <span className="text-gray-400"> · {m.parceiro_nome}</span> : null}</span>
                        <strong className={`whitespace-nowrap ${m.tipo === 'SAIDA' ? 'text-red-600' : 'text-emerald-700'}`}>{m.tipo === 'SAIDA' ? '−' : ''}{formatarMoeda(m.valor)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {painel.extratos.length > 0 && (
                <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 text-xs">
                  <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Extratos importados · {conta?.nome}</h3>
                  <ul className="space-y-1">{painel.extratos.map((e: any) => <li key={e.id}>{new Date(e.importado_em).toLocaleString('pt-BR')} · {e.arquivo_nome} · {formatarDataBR(e.inicio)} a {formatarDataBR(e.fim)} · {e.linhas} novo(s){e.saldo_final != null ? ` · saldo ${formatarMoeda(Number(e.saldo_final))} em ${formatarDataBR(e.saldo_final_data)}` : ''} · {e.importado_por}</li>)}</ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={!!previa} onClose={() => setPrevia(null)} title="⬆ Importar extrato OFX"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setPrevia(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={importar} className={`${btn} bg-[#047857] text-white`}>{ocupado ? 'Importando…' : 'Importar e conciliar'}</button></div>}>
        {previa && (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <p><span className="text-gray-500">Arquivo:</span> <strong>{previa.nome}</strong></p>
              <p><span className="text-gray-500">Banco / ag. / conta:</span> <strong>{[previa.info.banco, previa.info.agencia, previa.info.conta].filter(Boolean).join(' / ') || '—'}</strong></p>
              <p><span className="text-gray-500">Período:</span> <strong>{formatarDataBR(previa.info.inicio)} a {formatarDataBR(previa.info.fim)}</strong></p>
              <p><span className="text-gray-500">Lançamentos:</span> <strong>{previa.info.lancamentos}</strong></p>
              <p><span className="text-gray-500">Créditos:</span> <strong className="text-emerald-700">{formatarMoeda(previa.info.creditos)}</strong></p>
              <p><span className="text-gray-500">Débitos:</span> <strong className="text-red-600">{formatarMoeda(previa.info.debitos)}</strong></p>
              {previa.info.saldo != null && <p className="col-span-2"><span className="text-gray-500">Saldo do banco:</span> <strong>{formatarMoeda(previa.info.saldo)}</strong> em {formatarDataBR(previa.info.saldoData)}</p>}
            </div>
            <label className="block text-xs font-bold">Conta do sistema
              <select value={previa.conta} onChange={e => setPrevia({ ...previa, conta: e.target.value })} className={inp}>{contas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
              {previa.info.contaSugeridaId ? <span className="text-[10px] text-emerald-700 font-normal">Reconhecida pelo número da conta.</span> : <span className="text-[10px] text-amber-700 font-normal">Não reconheci a conta pelo número — confira (cadastre agência/conta em Caixa e Bancos para reconhecer sozinho).</span>}
            </label>
            <p className="text-[10px] text-gray-500">Lançamentos já importados antes (mesmo identificador do banco) não entram de novo.</p>
          </>
        )}
      </Modal>

      <Modal open={!!resolver} onClose={() => setResolver(null)} title="Resolver lançamento do banco" maxWidthClassName="max-w-3xl">
        {resolver && (
          <>
            <div className="bg-[#F8FAFC] rounded-xl p-3 text-sm flex justify-between gap-3">
              <span><strong>{formatarDataBR(resolver.data)}</strong> · {resolver.descricao}</span>
              <strong className={resolver.valor < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatarMoeda(resolver.valor)}</strong>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-[#0C1D4D] mb-2">1. Casar com movimento(s) do sistema</p>
              <div className="border border-[#E2E8F0] rounded-xl max-h-64 overflow-y-auto divide-y divide-[#E2E8F0]">
                {!candidatos.length && <p className="p-3 text-xs text-gray-400">Nenhum {resolver.valor < 0 ? 'débito' : 'crédito'} do sistema sem conciliar em até 10 dias.</p>}
                {candidatos.map((m: any) => (
                  <label key={m.id} className="p-2.5 text-xs flex items-center gap-2 cursor-pointer hover:bg-[#F8FAFC]">
                    <input type="checkbox" checked={selecionados.has(m.id)} onChange={e => setSelecionados(prev => { const s = new Set(prev); if (e.target.checked) s.add(m.id); else s.delete(m.id); return s; })} />
                    <span className="flex-1"><strong>{formatarDataBR(m.data)}</strong> · {m.descricao}{m.parceiro_nome ? <span className="text-gray-400"> · {m.parceiro_nome}</span> : null}</span>
                    <strong className={Math.abs(m.valor - alvo) < 0.01 ? 'text-emerald-700' : ''}>{formatarMoeda(m.valor)}</strong>
                  </label>
                ))}
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className={`text-xs font-bold ${Math.abs(somaSel - alvo) < 0.01 ? 'text-emerald-700' : 'text-gray-500'}`}>Selecionado {formatarMoeda(somaSel)} de {formatarMoeda(alvo)}{selecionados.size > 1 ? ` (${selecionados.size} movimentos)` : ''}</span>
                <button disabled={ocupado || !selecionados.size || Math.abs(somaSel - alvo) > 0.009} onClick={async () => { if (await acao(() => conciliarManualAction(resolver.id, [...selecionados], tok), 'Conciliado.')) setResolver(null); }} className={`${btn} bg-[#047857] text-white`}>Conciliar</button>
              </div>
            </div>
            <div className="border-t border-[#E2E8F0] pt-4">
              <p className="text-xs font-black uppercase tracking-wider text-[#0C1D4D] mb-2">2. Ou lançar no caixa a partir do extrato (tarifa, rendimento, algo não lançado)</p>
              <div className="grid md:grid-cols-2 gap-2">
                <label className="text-xs font-bold md:col-span-2">Descrição<input value={lanc.descricao} onChange={e => setLanc({ ...lanc, descricao: e.target.value })} className={inp} /></label>
                <label className="text-xs font-bold">Classificação<select value={lanc.subcentro} onChange={e => setLanc({ ...lanc, subcentro: e.target.value })} className={inp}><option value="">— sem classificação —</option>{subcentros.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label>
                <label className="text-xs font-bold">Favorecido / pagador<input value={lanc.parceiro} onChange={e => setLanc({ ...lanc, parceiro: e.target.value })} className={inp} /></label>
              </div>
              <p className="text-[10px] text-amber-700 mt-1">Enquanto a fonte for o P2S, só lance aqui o que NÃO está no P2S — o resto entra pela sincronização.</p>
              <div className="flex justify-end mt-2"><button disabled={ocupado} onClick={async () => { if (await acao(() => lancarDoExtratoAction(resolver.id, { descricao: lanc.descricao, subcentro_id: lanc.subcentro ? Number(lanc.subcentro) : null, parceiro_nome: lanc.parceiro }, tok), 'Lançado e conciliado.')) setResolver(null); }} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>Lançar e conciliar</button></div>
            </div>
            <div className="border-t border-[#E2E8F0] pt-4 flex justify-between items-center">
              <p className="text-[10px] text-gray-500">3. Ou ignorar (ex.: lançamento anterior ao saldo inicial, estorno que se anula).</p>
              <button disabled={ocupado} onClick={async () => { if (await acao(() => ignorarLinhaAction(resolver.id, tok), 'Ignorado.')) setResolver(null); }} className={`${btn} bg-white border border-[#E2E8F0] text-gray-500`}>Ignorar</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
