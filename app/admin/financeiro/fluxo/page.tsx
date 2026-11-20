"use client";

import { useState, useEffect, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import * as XLSX from 'xlsx';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { hojeISO, somarDias } from '../../../lib/locacao/datas';
import { GraficoBarras, SERIE_1, SERIE_2 } from '../../relatorios/ui';
import { fluxoCaixaAction, dreAction } from './actions';

// Fluxo de Caixa e DRE (Financeiro completo, 2026-11-20).
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloPeriodo = (p: string, g: string) => g === 'MES' ? `${MESES[Number(p.slice(5, 7)) - 1]}/${p.slice(2, 4)}` : g === 'SEMANA' ? `sem ${formatarDataBR(p).slice(0, 5)}` : formatarDataBR(p).slice(0, 5);
const curta = (v: number) => Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : Math.abs(v) >= 1e3 ? `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : formatarMoeda(v);
const GRUPOS: Record<string, string> = { RECEITA: 'Receitas', DESPESA: 'Despesas', ENTRADA_FINANCEIRA: 'Entradas financeiras', SAIDA_FINANCEIRA: 'Investimentos e saídas financeiras' };

export default function FluxoPage() {
  const router = useRouter();
  const toast = useToast();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [aba, setAba] = useState<'fluxo' | 'dre'>('fluxo');
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(false);
  // fluxo
  const [fDe, setFDe] = useState(somarDias(hojeISO(), -30));
  const [fAte, setFAte] = useState(somarDias(hojeISO(), 90));
  const [agrup, setAgrup] = useState<'DIA' | 'SEMANA' | 'MES'>('SEMANA');
  const [fluxo, setFluxo] = useState<any>(null);
  // dre
  const [dDe, setDDe] = useState(`${hojeISO().slice(0, 4)}-01-01`);
  const [dAte, setDAte] = useState(hojeISO());
  const [regime, setRegime] = useState<'CAIXA' | 'COMPETENCIA'>('CAIXA');
  const [dreD, setDreD] = useState<any>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = aba === 'fluxo'
        ? await fluxoCaixaAction({ empresaId, de: fDe, ate: fAte, agrupamento: agrup }, accessToken)
        : await dreAction({ empresaId, de: dDe, ate: dAte, regime }, accessToken);
      if (!vivo) return;
      if (r.ok) { setEmpresas(r.info.empresas); if (aba === 'fluxo') setFluxo(r.info.dados); else setDreD(r.info.dados); }
      else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, aba, empresaId, fDe, fAte, agrup, dDe, dAte, regime]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200"><div className="text-5xl mb-4">⛔</div><h2 className="text-xl font-black text-red-600 uppercase mb-4">Acesso Restrito</h2><button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Financeiro</button></div></div>;

  const exportarFluxo = () => {
    if (!fluxo) return;
    const ws = XLSX.utils.json_to_sheet(fluxo.linhas.map((l: any) => ({ Período: rotuloPeriodo(l.periodo, fluxo.agrupamento), 'Entradas realizadas': l.entradas_realizadas, 'Saídas realizadas': l.saidas_realizadas, 'Entradas previstas': l.entradas_previstas, 'Saídas previstas': l.saidas_previstas, Saldo: l.saldo })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Fluxo'); XLSX.writeFile(wb, `fluxo-caixa-${fDe}-a-${fAte}.xlsx`);
  };
  const exportarDre = () => {
    if (!dreD) return;
    const linhas: any[] = [];
    const add = (rot: string, meses: Record<string, number>, total: number) => linhas.push({ Conta: rot, ...Object.fromEntries(dreD.meses.map((m: string) => [rotuloPeriodo(m, 'MES'), meses[m] || 0])), Total: total });
    for (const g of ['RECEITA', 'DESPESA']) { for (const l of dreD.linhas.filter((x: any) => x.grupo === g)) add(`${GRUPOS[g]} · ${l.centro} · ${l.sub}`, l.meses, l.total); add(`TOTAL ${GRUPOS[g].toUpperCase()}`, (g === 'RECEITA' ? dreD.totais.receitas : dreD.totais.despesas).meses, (g === 'RECEITA' ? dreD.totais.receitas : dreD.totais.despesas).total); }
    add('RESULTADO OPERACIONAL', dreD.totais.resultado_operacional.meses, dreD.totais.resultado_operacional.total);
    for (const g of ['ENTRADA_FINANCEIRA', 'SAIDA_FINANCEIRA']) for (const l of dreD.linhas.filter((x: any) => x.grupo === g)) add(`${GRUPOS[g]} · ${l.centro} · ${l.sub}`, l.meses, l.total);
    add('RESULTADO LÍQUIDO', dreD.totais.resultado_liquido.meses, dreD.totais.resultado_liquido.total);
    const ws = XLSX.utils.json_to_sheet(linhas); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'DRE'); XLSX.writeFile(wb, `dre-${regime.toLowerCase()}-${dDe}-a-${dAte}.xlsx`);
  };

  const sel = 'border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white';
  const kpi = (rotulo: string, valor: string, tom = 'text-[#0C1D4D]', detalhe?: string) => (
    <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm"><p className={`text-xl font-black ${tom}`}>{valor}</p><p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">{rotulo}</p>{detalhe && <p className="text-[10px] text-gray-400 mt-0.5">{detalhe}</p>}</div>
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#ECFDF5] border-b border-[#A7F3D0] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#047857] font-medium text-sm">📈 <strong>Olá, {usuarioAtual}</strong>. Fluxo de caixa (realizado × previsto) e DRE gerencial.</p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white border border-[#A7F3D0] text-[#047857] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ Voltar ao Financeiro</button>
      </div>
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-[10px] font-black uppercase tracking-wider bg-white">
              {([['fluxo', 'Fluxo de caixa'], ['dre', 'DRE']] as const).map(([v, r]) => <button key={v} onClick={() => setAba(v)} className={`px-4 py-2.5 ${aba === v ? 'bg-[#047857] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{r}</button>)}
            </div>
            <select value={empresaId ?? ''} onChange={e => setEmpresaId(e.target.value ? Number(e.target.value) : null)} className={sel}><option value="">Todas as empresas</option>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select>
            {aba === 'fluxo' ? (
              <>
                <label className="text-[10px] font-bold">De<input type="date" value={fDe} onChange={e => setFDe(e.target.value)} className={`block ${sel}`} /></label>
                <label className="text-[10px] font-bold">Até<input type="date" value={fAte} onChange={e => setFAte(e.target.value)} className={`block ${sel}`} /></label>
                <select value={agrup} onChange={e => setAgrup(e.target.value as any)} className={sel}><option value="DIA">Por dia</option><option value="SEMANA">Por semana</option><option value="MES">Por mês</option></select>
                <button onClick={exportarFluxo} disabled={!fluxo} className="text-[10px] font-black uppercase px-4 py-2.5 rounded-lg bg-white border border-[#E2E8F0]">Excel</button>
              </>
            ) : (
              <>
                <label className="text-[10px] font-bold">De<input type="date" value={dDe} onChange={e => setDDe(e.target.value)} className={`block ${sel}`} /></label>
                <label className="text-[10px] font-bold">Até<input type="date" value={dAte} onChange={e => setDAte(e.target.value)} className={`block ${sel}`} /></label>
                <select value={regime} onChange={e => setRegime(e.target.value as any)} className={sel}><option value="CAIXA">Regime de caixa (pago/recebido)</option><option value="COMPETENCIA">Regime de competência</option></select>
                <button onClick={exportarDre} disabled={!dreD} className="text-[10px] font-black uppercase px-4 py-2.5 rounded-lg bg-white border border-[#E2E8F0]">Excel</button>
              </>
            )}
            {carregando && <span className="text-xs text-gray-400 pb-2">carregando…</span>}
          </div>

          {aba === 'fluxo' && fluxo && (
            <>
              {fluxo.contas_sem_saldo && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">Nenhuma conta financeira com saldo — cadastre em Caixa e Bancos para o fluxo partir do saldo real. Sem isso, o saldo mostrado é só a variação do período.</p>}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {kpi('Saldo no início', formatarMoeda(fluxo.saldo_inicial), 'text-[#0C1D4D]', formatarDataBR(somarDias(fluxo.de, -1)))}
                {kpi('Saldo projetado no fim', formatarMoeda(fluxo.saldo_final), fluxo.saldo_final < 0 ? 'text-red-600' : 'text-[#047857]', formatarDataBR(fluxo.ate))}
                {kpi('Menor saldo no período', formatarMoeda(Math.min(...fluxo.linhas.map((l: any) => l.saldo), fluxo.saldo_inicial)), Math.min(...fluxo.linhas.map((l: any) => l.saldo)) < 0 ? 'text-red-600' : 'text-[#0C1D4D]')}
                {kpi('A receber vencido', formatarMoeda(fluxo.vencidos.receber), 'text-amber-700', 'até 90 dias — fora da projeção')}
                {kpi('A pagar vencido', formatarMoeda(fluxo.vencidos.pagar), 'text-red-600', 'até 90 dias — fora da projeção')}
              </div>
              <GraficoBarras titulo="Entradas × saídas (realizado até hoje, previsto depois)" categorias={fluxo.linhas.map((l: any) => rotuloPeriodo(l.periodo, fluxo.agrupamento))} formatar={curta}
                series={[
                  { nome: 'Entradas', cor: SERIE_1, valores: fluxo.linhas.map((l: any) => l.entradas_realizadas + l.entradas_previstas) },
                  { nome: 'Saídas', cor: SERIE_2, valores: fluxo.linhas.map((l: any) => l.saidas_realizadas + l.saidas_previstas) },
                ]} />
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8]"><tr className="text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                    <th className="p-3 text-left">Período</th><th className="p-3 text-right">Entradas realizadas</th><th className="p-3 text-right">Saídas realizadas</th><th className="p-3 text-right">Entradas previstas</th><th className="p-3 text-right">Saídas previstas</th><th className="p-3 text-right">Saldo</th>
                  </tr></thead>
                  <tbody>
                    {fluxo.linhas.map((l: any) => (
                      <tr key={l.periodo} className="border-t border-[#E2E8F0]">
                        <td className="p-3 font-bold whitespace-nowrap">{rotuloPeriodo(l.periodo, fluxo.agrupamento)}</td>
                        <td className="p-3 text-right">{l.entradas_realizadas ? formatarMoeda(l.entradas_realizadas) : '—'}</td>
                        <td className="p-3 text-right">{l.saidas_realizadas ? formatarMoeda(l.saidas_realizadas) : '—'}</td>
                        <td className="p-3 text-right text-gray-500">{l.entradas_previstas ? formatarMoeda(l.entradas_previstas) : '—'}</td>
                        <td className="p-3 text-right text-gray-500">{l.saidas_previstas ? formatarMoeda(l.saidas_previstas) : '—'}</td>
                        <td className={`p-3 text-right font-black ${l.saldo < 0 ? 'text-red-600' : ''}`}>{formatarMoeda(l.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                {([['Maiores entradas previstas', fluxo.maiores_entradas], ['Maiores saídas previstas', fluxo.maiores_saidas]] as const).map(([t, lista]) => (
                  <div key={t} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
                    <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-2">{t}</h3>
                    {!(lista as any[]).length && <p className="text-xs text-gray-400">Nada previsto.</p>}
                    <ul className="space-y-1 text-xs">{(lista as any[]).map((p, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate"><strong>{formatarDataBR(p.data)}</strong> · {p.nome}{p.descricao ? <span className="text-gray-400"> · {p.descricao}</span> : null}</span><strong className="whitespace-nowrap">{formatarMoeda(p.valor)}</strong></li>)}</ul>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">Realizado = movimentos das contas (sem transferências entre contas). Previsto = contas a pagar e a receber em aberto pelo vencimento (na transição, as do P2S + OPs pendentes ainda não lançadas lá).</p>
            </>
          )}

          {aba === 'dre' && dreD && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {kpi('Receitas', formatarMoeda(dreD.totais.receitas.total), 'text-[#047857]')}
                {kpi('Despesas', formatarMoeda(dreD.totais.despesas.total), 'text-red-600')}
                {kpi('Resultado operacional', formatarMoeda(dreD.totais.resultado_operacional.total), dreD.totais.resultado_operacional.total < 0 ? 'text-red-600' : 'text-[#047857]', dreD.totais.receitas.total > 0 ? `margem ${Math.round(dreD.totais.resultado_operacional.total / dreD.totais.receitas.total * 100)}%` : undefined)}
                {kpi('Resultado líquido', formatarMoeda(dreD.totais.resultado_liquido.total), dreD.totais.resultado_liquido.total < 0 ? 'text-red-600' : 'text-[#0C1D4D]', 'com entradas/saídas financeiras')}
              </div>
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8]"><tr className="text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                    <th className="p-3 text-left min-w-[260px]">Conta</th>{dreD.meses.map((m: string) => <th key={m} className="p-3 text-right whitespace-nowrap">{rotuloPeriodo(m, 'MES')}</th>)}<th className="p-3 text-right">Total</th>
                  </tr></thead>
                  <tbody>
                    {(['RECEITA', 'DESPESA', 'RESULTADO', 'ENTRADA_FINANCEIRA', 'SAIDA_FINANCEIRA', 'LIQUIDO'] as const).map(g => {
                      if (g === 'RESULTADO' || g === 'LIQUIDO') {
                        const t = g === 'RESULTADO' ? dreD.totais.resultado_operacional : dreD.totais.resultado_liquido;
                        return <tr key={g} className="border-t-2 border-[#0C1D4D] bg-[#F8FAFC] font-black"><td className="p-3 uppercase">{g === 'RESULTADO' ? 'Resultado operacional' : 'Resultado líquido'}</td>{dreD.meses.map((m: string) => <td key={m} className={`p-3 text-right ${(t.meses[m] || 0) < 0 ? 'text-red-600' : ''}`}>{formatarMoeda(t.meses[m] || 0)}</td>)}<td className={`p-3 text-right ${t.total < 0 ? 'text-red-600' : ''}`}>{formatarMoeda(t.total)}</td></tr>;
                      }
                      const linhas = dreD.linhas.filter((l: any) => l.grupo === g);
                      if (!linhas.length) return null;
                      const tot = g === 'RECEITA' ? dreD.totais.receitas : g === 'DESPESA' ? dreD.totais.despesas : g === 'ENTRADA_FINANCEIRA' ? dreD.totais.entradas_financeiras : dreD.totais.saidas_financeiras;
                      // centros do grupo (soma dos sub-centros), expansíveis
                      const centros = new Map<string, any[]>();
                      for (const l of linhas) centros.set(l.centro, [...(centros.get(l.centro) || []), l]);
                      return (
                        <Fragment key={g}>
                          <tr className="border-t border-[#E2E8F0] font-black text-[#0C1D4D]"><td className="p-3 uppercase">{GRUPOS[g]}</td>{dreD.meses.map((m: string) => <td key={m} className="p-3 text-right">{formatarMoeda(tot.meses[m] || 0)}</td>)}<td className="p-3 text-right">{formatarMoeda(tot.total)}</td></tr>
                          {[...centros.entries()].sort((a, b) => b[1].reduce((s: number, x: any) => s + x.total, 0) - a[1].reduce((s: number, x: any) => s + x.total, 0)).map(([c, subs]) => {
                            const k = `${g}|${c}`;
                            const soma = (m?: string) => subs.reduce((s: number, x: any) => s + (m ? (x.meses[m] || 0) : x.total), 0);
                            return (
                              <Fragment key={k}>
                                <tr onClick={() => setAbertos(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className="border-t border-[#F1F5F9] cursor-pointer hover:bg-[#F8FAFC]">
                                  <td className="p-3 pl-6 font-bold">{abertos.has(k) ? '▾' : '▸'} {c}</td>{dreD.meses.map((m: string) => <td key={m} className="p-3 text-right">{soma(m) ? formatarMoeda(soma(m)) : '—'}</td>)}<td className="p-3 text-right font-bold">{formatarMoeda(soma())}</td>
                                </tr>
                                {abertos.has(k) && subs.map((s: any) => (
                                  <tr key={`${k}|${s.sub}`} className="text-gray-500"><td className="p-2 pl-12">{s.sub}</td>{dreD.meses.map((m: string) => <td key={m} className="p-2 text-right">{s.meses[m] ? formatarMoeda(s.meses[m]) : '—'}</td>)}<td className="p-2 text-right">{formatarMoeda(s.total)}</td></tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500">Pelo plano de contas. Investimento (compra de equipamento), empréstimo, resgate, aplicação, devolução, conta garantida e sócios ficam fora do resultado operacional. Na transição, os valores vêm das contas a pagar/receber do P2S.{regime === 'COMPETENCIA' ? ' Competência: receitas pela data de competência/emissão; despesas pela emissão (ou vencimento).' : ''}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
