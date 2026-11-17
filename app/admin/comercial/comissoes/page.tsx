"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import {
  painelComissoesAction, fecharMesComissoesAction, reabrirFechamentoAction, marcarComissaoPagaAction,
  salvarTaxaVendedorAction, salvarInicioComissoesAction,
} from './actions';

// Comissões de Vendas (2026-11-17): % por vendedor sobre o valor líquido
// (locação e serviços; frete fora), liberada conforme o cliente paga.

const ROTA = '/admin/comercial/comissoes';
const mesAtual = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7);
const somarMes = (m: string, d: number) => { const [a, mm] = m.split('-').map(Number); const x = new Date(Date.UTC(a, mm - 1 + d, 1)); return x.toISOString().slice(0, 7); };
const nomeMes = (m: string) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
const pct = (v: number) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const lerNum = (v: unknown) => { const x = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(x) ? x : NaN; };

function EditorRegra({ t, salvando, onSalvar, onMudar }: { t: any; salvando: boolean; onSalvar: () => void; onMudar: (p: any) => void }) {
  const inp = 'w-20 border border-[#CBD5E1] rounded px-2 py-1 text-right text-xs';
  const fd: any[] = t.faixas_desconto || [];
  const fp: any[] = t.faixas_prazo || [];
  const setFd = (lista: any[]) => onMudar({ faixas_desconto: lista });
  const setFp = (lista: any[]) => onMudar({ faixas_prazo: lista });
  return (
    <div className={`border rounded-xl p-4 ${t.ativo ? 'border-[#E2E8F0]' : 'border-dashed border-gray-300 opacity-70'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-black text-[#0C1D4D] uppercase text-sm">{t.vendedor}</p>
          {t.atualizado_por && <p className="text-[9px] text-gray-400">alterado por {t.atualizado_por}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1 font-bold text-gray-600">% cheia locação <input value={t.pct_locacao} inputMode="decimal" onChange={e => onMudar({ pct_locacao: e.target.value })} className={inp} /></label>
          <label className="flex items-center gap-1 font-bold text-gray-600">% serviços <input value={t.pct_servicos} inputMode="decimal" onChange={e => onMudar({ pct_servicos: e.target.value })} className={inp} /></label>
          <label className="flex items-center gap-1 font-bold text-gray-600"><input type="checkbox" checked={t.ativo} onChange={e => onMudar({ ativo: e.target.checked })} className="w-4 h-4" /> comissiona</label>
          <button onClick={onSalvar} disabled={salvando} className="px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider disabled:opacity-40 bg-[#0C1D4D] text-white">Salvar</button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-3">
        <div className="bg-[#F8FAFC] rounded-lg p-3">
          <p className="text-[10px] font-black text-gray-500 uppercase mb-2">Faixas de desconto sobre a tabela</p>
          <p className="text-[10px] text-gray-500 mb-1">Sem desconto → <strong>{t.pct_locacao || 0}%</strong> (cheia)</p>
          {fd.map((f, k) => (
            <div key={k} className="flex items-center gap-1 text-[11px] text-gray-600 mb-1">
              desconto até <input value={f.ate_pct} inputMode="decimal" onChange={e => setFd(fd.map((x, j) => j === k ? { ...x, ate_pct: e.target.value } : x))} className={inp} />%
              → comissão <input value={f.pct} inputMode="decimal" onChange={e => setFd(fd.map((x, j) => j === k ? { ...x, pct: e.target.value } : x))} className={inp} />%
              <button onClick={() => setFd(fd.filter((_, j) => j !== k))} className="text-gray-300 hover:text-red-500 text-base px-1">×</button>
            </div>
          ))}
          <button onClick={() => setFd([...fd, { ate_pct: '', pct: '' }])} className="text-[10px] font-black text-[#336699] uppercase mt-1">+ faixa</button>
          {!fd.length && <p className="text-[10px] text-amber-600 mt-1">Sem faixas: desconto não muda a comissão.</p>}
        </div>
        <div className="bg-[#F8FAFC] rounded-lg p-3">
          <p className="text-[10px] font-black text-gray-500 uppercase mb-2">Faixas de prazo (dias do evento não cobrados)</p>
          <p className="text-[10px] text-gray-500 mb-1">Todos os dias cobrados → sem redução</p>
          {fp.map((f, k) => (
            <div key={k} className="flex items-center gap-1 text-[11px] text-gray-600 mb-1">
              até <input value={f.ate_dias} inputMode="numeric" onChange={e => setFp(fp.map((x, j) => j === k ? { ...x, ate_dias: e.target.value } : x))} className={inp} /> dia(s) a menos
              → −<input value={f.reducao} inputMode="decimal" onChange={e => setFp(fp.map((x, j) => j === k ? { ...x, reducao: e.target.value } : x))} className={inp} /> ponto(s)
              <button onClick={() => setFp(fp.filter((_, j) => j !== k))} className="text-gray-300 hover:text-red-500 text-base px-1">×</button>
            </div>
          ))}
          <button onClick={() => setFp([...fp, { ate_dias: '', reducao: '' }])} className="text-[10px] font-black text-[#336699] uppercase mt-1">+ faixa</button>
          {!fp.length && <p className="text-[10px] text-amber-600 mt-1">Sem faixas: cobrar menos dias não muda a comissão.</p>}
        </div>
      </div>
    </div>
  );
}

function TabelaLinhas({ linhas }: { linhas: any[] }) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
            <th className="p-1.5">Recebido</th><th className="p-1.5">Ficha</th><th className="p-1.5">Cliente</th><th className="p-1.5">Origem</th>
            <th className="p-1.5 text-right">Valor recebido</th><th className="p-1.5">Regra (locação)</th><th className="p-1.5 text-right">% efetiva</th><th className="p-1.5 text-right">Comissão</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.fonte}-${l.titulo_ref}-${l.ficha_chave}-${i}`} className="border-b border-[#F1F5F9]">
              <td className="p-1.5 whitespace-nowrap">{formatarDataBR(l.recebido_em)}</td>
              <td className="p-1.5 whitespace-nowrap font-bold text-[#0C1D4D]">
                {l.ficha_id ? <Link href={`/admin/locacoes/reservas/${l.ficha_id}`} className="hover:underline">{l.ficha_numero}</Link> : l.ficha_numero}
                {l.rateio && <span className="ml-1 text-[8px] font-black px-1 py-0.5 rounded bg-slate-100 text-slate-600" title="Título com mais de uma ficha: rateado pelo valor das fichas">rateio</span>}
              </td>
              <td className="p-1.5 min-w-[160px]">{l.cliente}</td>
              <td className="p-1.5"><span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase ${l.fonte === 'P2S' ? 'bg-orange-100 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>{l.fonte === 'P2S' ? 'P2S' : 'sistema'}</span></td>
              <td className="p-1.5 text-right whitespace-nowrap">{formatarMoeda(Number(l.valor_recebido))}</td>
              <td className="p-1.5 text-[10px] text-gray-500 min-w-[180px]">{l.pct_locacao_aplicada !== null && l.pct_locacao_aplicada !== undefined ? <><strong className="text-[#0C1D4D]">{pct(Number(l.pct_locacao_aplicada))}</strong> · {l.regra_motivo}</> : '—'}</td>
              <td className="p-1.5 text-right whitespace-nowrap">{pct(Number(l.pct_efetivo))}</td>
              <td className="p-1.5 text-right whitespace-nowrap font-black text-[#0C1D4D]">{formatarMoeda(Number(l.valor_comissao))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ComissoesPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota: ROTA });

  const [mes, setMes] = useState(mesAtual());
  const [painel, setPainel] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroPainel, setErroPainel] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [aba, setAba] = useState<'mes' | 'taxas'>('mes');
  const [taxas, setTaxas] = useState<any[]>([]);
  const [inicio, setInicio] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [recarregar, setRecarregar] = useState(0);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    (async () => {
      setCarregando(true); setErroPainel('');
      const r = await painelComissoesAction(mes, accessToken);
      setCarregando(false);
      if (!r.ok) { setErroPainel(r.erro || 'Erro ao carregar.'); setPainel(null); return; }
      setPainel(r.info); setTaxas(r.info.taxas); setInicio(r.info.inicio);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, mes, recarregar]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Comissões de Vendas.</p>
          <button onClick={() => router.push('/admin/comercial')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const gestao = !!painel?.gestao;
  const emAberto: any[] = painel?.emAberto || [];
  const fechamentos: any[] = painel?.fechamentos || [];
  const totalAberto = emAberto.reduce((s, g) => s + g.comissao, 0);
  const totalFechado = fechamentos.reduce((s, f) => s + Number(f.valor_comissao), 0);
  const fechaveis = emAberto.filter(g => !g.jaFechadoNoMes);
  const mesFuturo = mes > mesAtual();

  const fechar = async () => {
    const corrente = mes === mesAtual();
    if (!(await confirmar({
      title: `Fechar ${nomeMes(mes)}`, confirmLabel: 'Fechar mês',
      message: `Grava a comissão de ${fechaveis.length} vendedor(es), total ${formatarMoeda(fechaveis.reduce((s, g) => s + g.comissao, 0))}. Depois de fechado o valor não muda (recebimento que entrar depois vai para o mês seguinte).${corrente ? ' Atenção: o mês ainda não terminou.' : ''}`,
    }))) return;
    setSalvando(true);
    const r = await fecharMesComissoesAction(mes, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao fechar.', 'error');
    toast(`Mês fechado: ${r.info.vendedores} vendedor(es), ${formatarMoeda(r.info.total)}.`, 'success');
    setRecarregar(x => x + 1);
  };

  const acaoFechamento = async (f: any, tipo: 'reabrir' | 'pagar') => {
    if (tipo === 'reabrir' && !(await confirmar({ title: 'Reabrir fechamento', danger: true, confirmLabel: 'Reabrir', message: `Desfaz o fechamento de ${f.vendedor} (${formatarMoeda(Number(f.valor_comissao))}). Os recebimentos voltam a ficar em aberto e são recalculados.` }))) return;
    if (tipo === 'pagar' && !(await confirmar({ title: 'Marcar como paga', confirmLabel: 'Marcar paga', message: `Confirma que a comissão de ${f.vendedor} (${formatarMoeda(Number(f.valor_comissao))}) foi paga?` }))) return;
    setSalvando(true);
    const r = tipo === 'reabrir' ? await reabrirFechamentoAction(f.id, accessToken) : await marcarComissaoPagaAction(f.id, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast(tipo === 'reabrir' ? 'Fechamento reaberto.' : 'Comissão marcada como paga.', 'success');
    setRecarregar(x => x + 1);
  };

  const salvarTaxa = async (t: any) => {
    setSalvando(true);
    const r = await salvarTaxaVendedorAction({
      vendedor_id: t.vendedor_id, pct_locacao: lerNum(t.pct_locacao), pct_servicos: lerNum(t.pct_servicos), ativo: t.ativo,
      faixas_desconto: (t.faixas_desconto || []).map((f: any) => ({ ate_pct: lerNum(f.ate_pct), pct: lerNum(f.pct) })),
      faixas_prazo: (t.faixas_prazo || []).map((f: any) => ({ ate_dias: lerNum(f.ate_dias), reducao: lerNum(f.reducao) })),
    }, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast(`% de ${t.vendedor} salva.`, 'success');
    setRecarregar(x => x + 1);
  };

  const card = 'bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6';
  const btn = 'px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider disabled:opacity-40';

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">💰 <strong>Olá, {usuarioAtual}</strong>. Comissões de vendas.</p>
        <button onClick={() => router.push('/admin/comercial')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg shadow-sm tracking-wider uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className={card}>
            <div className="flex flex-col lg:flex-row justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-tight">Comissões de Vendas</h1>
                <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                  % do vendedor sobre o valor líquido da ficha (locação e serviços; frete fora), liberada conforme o cliente paga.
                  Recebimentos do P2S (título com o nº da ficha) e títulos das fichas daqui. Vendedor da ficha = quem recebe.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMes(m => somarMes(m, -1))} className="px-3 py-2 border border-[#CBD5E1] rounded-lg font-black text-[#0C1D4D]">‹</button>
                <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm font-bold text-[#0C1D4D]" />
                <button onClick={() => setMes(m => somarMes(m, 1))} className="px-3 py-2 border border-[#CBD5E1] rounded-lg font-black text-[#0C1D4D]">›</button>
              </div>
            </div>
            {gestao && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => setAba('mes')} className={`${btn} ${aba === 'mes' ? 'bg-[#0C1D4D] text-white' : 'bg-white border border-[#CBD5E1] text-gray-600'}`}>Mês</button>
                <button onClick={() => setAba('taxas')} className={`${btn} ${aba === 'taxas' ? 'bg-[#0C1D4D] text-white' : 'bg-white border border-[#CBD5E1] text-gray-600'}`}>% dos vendedores</button>
              </div>
            )}
          </div>

          {erroPainel && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{erroPainel}</div>}
          {carregando && <p className="text-sm text-gray-400 text-center py-6">Calculando...</p>}

          {!carregando && painel && aba === 'mes' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className={card}><p className="text-[10px] font-black text-gray-500 uppercase">Em aberto até {nomeMes(mes)}</p><p className="text-2xl font-black text-[#0C1D4D] mt-1">{formatarMoeda(totalAberto)}</p><p className="text-[10px] text-gray-400 mt-1">{emAberto.reduce((s, g) => s + g.linhas.length, 0)} recebimento(s)</p></div>
                <div className={card}><p className="text-[10px] font-black text-gray-500 uppercase">Fechado em {nomeMes(mes)}</p><p className="text-2xl font-black text-emerald-700 mt-1">{formatarMoeda(totalFechado)}</p><p className="text-[10px] text-gray-400 mt-1">{fechamentos.filter(f => f.status === 'PAGO').length} de {fechamentos.length} pago(s)</p></div>
                <div className={card}><p className="text-[10px] font-black text-gray-500 uppercase">Comissões contam a partir de</p><p className="text-2xl font-black text-[#0C1D4D] mt-1">{formatarDataBR(painel.inicio)}</p><p className="text-[10px] text-gray-400 mt-1">recebimentos anteriores ficam fora</p></div>
              </div>

              {mes < String(painel.inicio).slice(0, 7) && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-xs">Este mês é anterior ao início das comissões ({formatarDataBR(painel.inicio)}).</div>}

              <div className={card}>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-2">
                  <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Em aberto</h2>
                  {gestao && <button onClick={fechar} disabled={salvando || !fechaveis.length || mesFuturo} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`}>🔒 Fechar {nomeMes(mes)}</button>}
                </div>
                <p className="text-[10px] text-gray-400 mb-3">Recebimentos até o fim do mês ainda não fechados (inclui sobras de meses anteriores). Muda se a ficha, o recebimento ou a % mudar — o fechamento congela.</p>
                {emAberto.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Nada em aberto.</p>}
                <div className="space-y-2">
                  {emAberto.map(g => {
                    const chave = `a${g.vendedor_id}`;
                    return (
                      <div key={chave} className="border border-[#E2E8F0] rounded-xl p-3">
                        <button onClick={() => setAberto(aberto === chave ? null : chave)} className="w-full flex flex-wrap justify-between items-center gap-2 text-left">
                          <span className="font-black text-[#0C1D4D] uppercase text-sm">{aberto === chave ? '▾' : '▸'} {g.vendedor}
                            {g.jaFechadoNoMes && <span className="ml-2 text-[9px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 normal-case">já fechado neste mês — entra no próximo</span>}
                            {g.deMesesAnteriores > 0 && <span className="ml-2 text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 normal-case">{g.deMesesAnteriores} de mês anterior</span>}
                          </span>
                          <span className="text-xs text-gray-500">{g.linhas.length} receb. · {formatarMoeda(g.recebido)} → <strong className="text-[#0C1D4D] text-sm">{formatarMoeda(g.comissao)}</strong></span>
                        </button>
                        {aberto === chave && <TabelaLinhas linhas={g.linhas} />}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={card}>
                <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Fechamentos de {nomeMes(mes)}</h2>
                {fechamentos.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">Nenhum fechamento neste mês.</p>}
                <div className="space-y-2">
                  {fechamentos.map(f => {
                    const chave = `f${f.id}`;
                    return (
                      <div key={chave} className="border border-[#E2E8F0] rounded-xl p-3">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                          <button onClick={() => setAberto(aberto === chave ? null : chave)} className="text-left font-black text-[#0C1D4D] uppercase text-sm">
                            {aberto === chave ? '▾' : '▸'} {f.vendedor}
                            <span className={`ml-2 text-[9px] font-black px-2 py-0.5 rounded-full ${f.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{f.status === 'PAGO' ? `pago${f.pago_em ? ` em ${new Date(f.pago_em).toLocaleDateString('pt-BR')}` : ''}` : 'fechado'}</span>
                          </button>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{f.qtd_lancamentos} receb. · {formatarMoeda(Number(f.valor_recebido))} → <strong className="text-[#0C1D4D] text-sm">{formatarMoeda(Number(f.valor_comissao))}</strong></span>
                            {gestao && f.status === 'FECHADO' && (
                              <>
                                <button onClick={() => acaoFechamento(f, 'pagar')} disabled={salvando} className={`${btn} bg-emerald-600 text-white`}>Marcar paga</button>
                                <button onClick={() => acaoFechamento(f, 'reabrir')} disabled={salvando} className={`${btn} bg-white border border-red-200 text-red-600`}>Reabrir</button>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">Fechado por {f.fechado_por} em {new Date(f.fechado_em).toLocaleString('pt-BR')}{f.pago_por ? ` · pago por ${f.pago_por}` : ''}</p>
                        {aberto === chave && <TabelaLinhas linhas={f.lancamentos} />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {gestao && (painel.pendencias.length > 0 || painel.pendenciasAnteriores > 0) && (
                <div className={`${card} border-amber-200`}>
                  <button onClick={() => setAberto(aberto === 'pend' ? null : 'pend')} className="w-full text-left">
                    <h2 className="text-sm font-black text-amber-700 uppercase tracking-wider">{aberto === 'pend' ? '▾' : '▸'} Recebimentos sem comissão neste mês ({painel.pendencias.length})</h2>
                    <p className="text-[10px] text-gray-500 mt-1">Título sem nº de ficha, ficha não importada ou ficha sem vendedor — não geram comissão até serem resolvidos.{painel.pendenciasAnteriores ? ` Há mais ${painel.pendenciasAnteriores} de meses anteriores.` : ''}</p>
                  </button>
                  {aberto === 'pend' && (
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-[11px]">
                        <thead><tr className="text-left text-[9px] font-black text-gray-500 uppercase border-b border-[#E2E8F0]"><th className="p-1.5">Recebido</th><th className="p-1.5">Cliente</th><th className="p-1.5">Descrição</th><th className="p-1.5">Motivo</th><th className="p-1.5 text-right">Valor</th></tr></thead>
                        <tbody>
                          {painel.pendencias.map((p: any, i: number) => (
                            <tr key={i} className="border-b border-[#F1F5F9]">
                              <td className="p-1.5 whitespace-nowrap">{formatarDataBR(p.recebido_em)}</td>
                              <td className="p-1.5">{p.cliente}</td>
                              <td className="p-1.5 text-gray-500 max-w-[320px] truncate" title={p.descricao}>{p.descricao}</td>
                              <td className="p-1.5 text-amber-700 font-bold whitespace-nowrap">{p.motivo}</td>
                              <td className="p-1.5 text-right whitespace-nowrap">{formatarMoeda(p.valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!carregando && painel && aba === 'taxas' && gestao && (
            <div className={card}>
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Regra de comissão por vendedor</h2>
              <p className="text-xs text-gray-500 mb-4">
                <strong>% cheia de locação</strong> = preço da tabela padrão e todos os dias do evento cobrados. Deu desconto sobre a tabela → vale a % da <strong>faixa de desconto</strong>.
                Cobrou menos dias que o evento → tira os pontos da <strong>faixa de prazo</strong>. Acima da última faixa vale a última. Serviços: % própria; frete não comissiona.
                As % iniciais vieram do P2S — ajuste aqui (não volta para o P2S). Mudança vale para o que ainda não foi fechado.
              </p>
              <div className="space-y-3">
                {taxas.map((t, i) => (
                  <EditorRegra key={t.vendedor_id} t={t} salvando={salvando} onSalvar={() => salvarTaxa(t)}
                    onMudar={parcial => setTaxas(prev => prev.map((x, j) => j === i ? { ...x, ...parcial } : x))} />
                ))}
              </div>
              <div className="mt-6 border-t border-[#E2E8F0] pt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Comissões contam a partir de</label>
                  <input type="date" value={inicio} onChange={e => setInicio(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm" />
                </div>
                <button disabled={salvando || !inicio} onClick={async () => {
                  setSalvando(true);
                  const r = await salvarInicioComissoesAction(inicio, accessToken);
                  setSalvando(false);
                  if (!r.ok) return toast(r.erro || 'Erro.', 'error');
                  toast('Início das comissões salvo.', 'success');
                  setRecarregar(x => x + 1);
                }} className={`${btn} bg-[#0C1D4D] text-white`}>Salvar</button>
                <p className="text-[10px] text-gray-400 max-w-md">Recebimentos antes desta data não entram (o que já foi pago por fora).</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
