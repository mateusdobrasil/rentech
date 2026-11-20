"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarDataBR, formatarMoeda } from '../../../lib/formatadores';
import { hojeISO, somarDias } from '../../../lib/locacao/datas';
import { listarSublocacoesAction, rankingSublocacaoAction } from './actions';
import FormSublocacao from './FormSublocacao';

// Sublocação (2026-11-20): equipamento que pegamos com parceiros quando falta
// no nosso estoque — pedidos, situação física e de pagamento, e ranking.
const STATUS: Record<string, { rotulo: string; cls: string }> = {
  SOLICITADO: { rotulo: 'Solicitada', cls: 'bg-amber-100 text-amber-700' },
  CONFIRMADO: { rotulo: 'Confirmada', cls: 'bg-blue-100 text-blue-700' },
  ENCERRADO: { rotulo: 'Encerrada', cls: 'bg-gray-200 text-gray-600' },
  CANCELADO: { rotulo: 'Cancelada', cls: 'bg-red-50 text-red-400' },
};
const PAGTO: Record<string, { rotulo: string; cls: string }> = {
  SEM_OP: { rotulo: 'sem OP', cls: 'text-red-600' }, PARCIAL: { rotulo: 'OP parcial', cls: 'text-amber-700' },
  EM_OP: { rotulo: 'em OP', cls: 'text-blue-700' }, PAGO: { rotulo: 'pago', cls: 'text-emerald-700' }, SEM_CUSTO: { rotulo: 'sem custo', cls: 'text-gray-400' },
};
const q3 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default function SublocacoesPage() {
  const router = useRouter();
  const toast = useToast();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [aba, setAba] = useState<'lista' | 'ranking'>('lista');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [linhas, setLinhas] = useState<any[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [nova, setNova] = useState(false);
  const [de, setDe] = useState(somarDias(hojeISO(), -365));
  const [ate, setAte] = useState(hojeISO());
  const [ranking, setRanking] = useState<any>(null);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken || aba !== 'lista') return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await listarSublocacoesAction({ status, busca: '' }, accessToken);
      if (!vivo) return;
      if (r.ok) { setLinhas(r.info.linhas); setPodeEditar(r.info.podeEditar); setEmpresas(r.info.empresas || []); } else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, status, recarregar, aba]);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken || aba !== 'ranking') return;
    let vivo = true;
    rankingSublocacaoAction(de, ate, accessToken).then(r => { if (vivo) { if (r.ok) setRanking(r.info); else toast(r.erro || 'Erro.', 'error'); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, aba, de, ate]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const t = busca.trim().toLowerCase();
  const visiveis = linhas.filter(l => !t || [l.numero, l.fornecedor, l.os, l.cliente, l.evento, l.itens].some((x: string | null) => (x || '').toLowerCase().includes(t)));
  const ativas = linhas.filter(l => l.status === 'CONFIRMADO');
  const kpis = [
    { rotulo: 'Solicitadas', valor: String(linhas.filter(l => l.status === 'SOLICITADO').length) },
    { rotulo: 'Confirmadas', valor: String(ativas.length) },
    { rotulo: 'Com a gente agora', valor: q3(ativas.reduce((a, l) => a + l.recebido - l.devolvido, 0)) + ' un.' },
    { rotulo: 'A pagar (fora de OP)', valor: formatarMoeda(linhas.filter(l => l.status !== 'CANCELADO').reduce((a, l) => a + Math.max(0, l.custo - l.emOp), 0)) },
  ];

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">🤝 <strong>Olá, {usuarioAtual}</strong>. Sublocação: equipamento de parceiros quando falta no nosso estoque.</p>
        <div className="flex gap-2">
          {podeEditar && <button onClick={() => setNova(true)} className="text-[10px] md:text-xs font-black bg-[#0C1D4D] text-white px-4 py-2 rounded-lg tracking-wider uppercase">+ Nova sublocação</button>}
          <button onClick={() => router.push('/admin/locacoes')} className="text-[10px] md:text-xs font-black bg-white border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ Voltar ao hub</button>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-[10px] font-black uppercase tracking-wider w-fit bg-white">
            {([['lista', 'Sublocações'], ['ranking', 'Ranking de parceiros e produtos']] as const).map(([v, r]) => (
              <button key={v} onClick={() => setAba(v)} className={`px-4 py-2 ${aba === v ? 'bg-[#0C1D4D] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{r}</button>
            ))}
          </div>

          {aba === 'lista' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {kpis.map(k => (
                  <div key={k.rotulo} className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
                    <p className="text-xl font-black text-[#0C1D4D]">{carregando ? '—' : k.valor}</p>
                    <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">{k.rotulo}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 flex flex-col md:flex-row gap-3">
                <select value={status} onChange={e => setStatus(e.target.value)} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm">
                  <option value="">Todas as situações</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
                </select>
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por SL, parceiro, OS, cliente, evento ou equipamento…" className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto relative min-h-[120px]">
                {carregando && <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10"><div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>}
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8]">
                    <tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                      <th className="p-3">Sublocação</th><th className="p-3">Parceiro</th><th className="p-3">OS / cliente</th><th className="p-3">Equipamentos</th>
                      <th className="p-3">Período</th><th className="p-3 text-right">Recebido / devolvido</th><th className="p-3 text-right">Custo</th><th className="p-3">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!carregando && !visiveis.length && <tr><td colSpan={8} className="p-8 text-center text-gray-400 font-bold text-xs uppercase">Nenhuma sublocação. Elas nascem da falta na OS (“Sublocar o que falta”) ou em “+ Nova sublocação”.</td></tr>}
                    {visiveis.map(l => (
                      <tr key={l.id} onClick={() => router.push(`/admin/locacoes/sublocacoes/${l.id}`)} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer">
                        <td className="p-3 whitespace-nowrap"><span className="font-black text-[#0C1D4D]">{l.numero}</span><span className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded ${corSeloEmpresa(l.empresa_id)}`}>●</span></td>
                        <td className="p-3 font-bold min-w-[160px]">{l.fornecedor}</td>
                        <td className="p-3 min-w-[180px]">{l.os ? <><p className="font-bold">{l.os}</p><p className="text-[10px] text-gray-500">{[l.cliente, l.evento].filter(Boolean).join(' · ')}</p></> : <span className="text-gray-400">avulsa</span>}</td>
                        <td className="p-3 min-w-[200px] text-gray-600">{l.itens}</td>
                        <td className="p-3 whitespace-nowrap">{formatarDataBR(l.retirada)} a {formatarDataBR(l.devolucao)}</td>
                        <td className="p-3 text-right whitespace-nowrap">{q3(l.recebido)} / {q3(l.devolvido)} <span className="text-gray-400">de {q3(l.quantidade)}</span></td>
                        <td className="p-3 text-right whitespace-nowrap"><p className="font-black">{formatarMoeda(l.custo)}</p><p className={`text-[10px] font-bold ${PAGTO[l.pagamento]?.cls}`}>{PAGTO[l.pagamento]?.rotulo}</p></td>
                        <td className="p-3"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS[l.status]?.cls}`}>{STATUS[l.status]?.rotulo}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {aba === 'ranking' && (
            <>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 flex flex-wrap gap-3 items-end">
                <label className="text-xs font-bold">De<input type="date" value={de} onChange={e => setDe(e.target.value)} className="mt-1 block border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
                <label className="text-xs font-bold">Até<input type="date" value={ate} onChange={e => setAte(e.target.value)} className="mt-1 block border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
                {ranking && <p className="text-xs text-gray-600 pb-2">{ranking.sublocacoes} sublocação(ões) pela data de retirada · <strong>{formatarMoeda(ranking.total)}</strong> gastos com parceiros</p>}
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                <TabelaRanking titulo="Parceiros" colunas={['Parceiro', 'Sublocações', 'Unidades', 'Gasto']}
                  linhas={(ranking?.fornecedores || []).map((f: any) => [f.fornecedor, String(f.sublocacoes), q3(f.unidades), formatarMoeda(f.valor)])} />
                <TabelaRanking titulo="Equipamentos mais sublocados (candidatos a compra)" colunas={['Equipamento', 'Vezes', 'Unidades', 'Gasto']}
                  linhas={(ranking?.produtos || []).map((p: any) => [p.produto, String(p.vezes), q3(p.unidades), formatarMoeda(p.valor)])} />
              </div>
              <p className="text-[11px] text-gray-500">Equipamento sublocado várias vezes, com gasto alto, é candidato a compra: compare o gasto no período com o custo de aquisição.</p>
            </>
          )}
        </div>
      </div>

      {accessToken && (
        <FormSublocacao aberto={nova} onClose={() => setNova(false)} accessToken={accessToken} inicial={{ itens: [] }} empresas={empresas}
          onSalvo={(id, aviso) => { setNova(false); if (aviso) toast(aviso, 'info'); setRecarregar(v => v + 1); router.push(`/admin/locacoes/sublocacoes/${id}`); }} />
      )}
    </div>
  );
}

function TabelaRanking({ titulo, colunas, linhas }: { titulo: string; colunas: string[]; linhas: string[][] }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <h2 className="px-5 py-3 border-b border-[#E2E8F0] text-sm font-black text-[#0C1D4D] uppercase tracking-wider">{titulo}</h2>
      <table className="w-full text-xs">
        <thead className="bg-[#F0F4F8]"><tr className="text-[#64748B] uppercase tracking-wider font-black text-[10px]">{colunas.map((c, i) => <th key={c} className={`p-3 ${i ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr></thead>
        <tbody>
          {!linhas.length && <tr><td colSpan={colunas.length} className="p-6 text-center text-gray-400">Sem dados no período.</td></tr>}
          {linhas.slice(0, 30).map((l, i) => <tr key={i} className="border-t border-[#E2E8F0]">{l.map((c, j) => <td key={j} className={`p-3 ${j ? 'text-right' : 'font-bold'}`}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
