"use client";

// Virada da chave (2026-11-21): tira o P2S de cena empresa por empresa.
// 1 Preparar (checklist + última leitura) → 2 Congelar → 3 OS → 4 Receber → 5 Pagar → 6 Concluir.
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda } from '../../../lib/formatadores';
import { painelViradaAction, salvarConferenciaAction, lerP2sAgoraAction, simularViradaAction, executarViradaAction } from './actions';

const ROTA = '/admin/parametros/virada';
const ETAPA: Record<string, { rot: string; cls: string }> = {
  PREPARACAO: { rot: 'preparação', cls: 'bg-gray-100 text-gray-600' },
  CONGELADA: { rot: 'P2S congelado', cls: 'bg-amber-100 text-amber-800' },
  CONCLUIDA: { rot: 'virada concluída', cls: 'bg-emerald-100 text-emerald-700' },
};
const dataBR = (iso?: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
const num = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const card = 'bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-5';

function Passo({ n, titulo, feito, ativo, children }: { n: number; titulo: string; feito: boolean; ativo: boolean; children: React.ReactNode }) {
  return (
    <div className={`${card} ${ativo ? 'ring-2 ring-[#336699]/30' : ''} ${!ativo && !feito ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-3 mb-3">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${feito ? 'bg-emerald-600 text-white' : ativo ? 'bg-[#0C1D4D] text-white' : 'bg-gray-200 text-gray-500'}`}>{feito ? '✓' : n}</span>
        <h2 className="text-sm font-black uppercase tracking-wider text-[#0C1D4D]">{titulo}</h2>
      </div>
      {children}
    </div>
  );
}
function ResumoContas({ p }: { p: any }) {
  if (!p) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-gray-600">
        <strong>{p.resumo.aMigrar}</strong> título(s) · <strong>{formatarMoeda(p.resumo.valorAMigrar)}</strong> vencendo desde {dataBR(p.resumo.desde)} migram.
        {' '}{p.resumo.ficamNoP2s} ({formatarMoeda(p.resumo.valorFica)}) mais antigos ficam só no histórico do P2S.
        {p.resumo.ligadosOp ? ` ${p.resumo.ligadosOp} já têm título pela OP (só são ligados).` : ''}
        {p.resumo.semCliente ? ` ⚠ ${p.resumo.semCliente} sem cliente no cadastro.` : ''}
        {p.resumo.semSubcentro ? ` ${p.resumo.semSubcentro} sem natureza correspondente.` : ''}
        {p.resumo.gravados ? ` ✔ ${p.resumo.gravados} gravado(s).` : ''}
      </p>
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-left text-[10px] font-black uppercase text-gray-500 border-b"><th className="p-1.5">Vencimento</th><th className="p-1.5 text-right">Em aberto no P2S</th><th className="p-1.5 text-right">Valor</th><th className="p-1.5 text-right">Migram</th><th className="p-1.5 text-right">Valor que migra</th></tr></thead>
        <tbody>{(p.anos || []).map((a: any) => <tr key={a.ano} className={`border-b border-[#F1F5F9] ${a.migra ? '' : 'text-gray-400'}`}><td className="p-1.5">{a.ano}</td><td className="p-1.5 text-right">{a.titulos}</td><td className="p-1.5 text-right">{formatarMoeda(a.valor)}</td><td className="p-1.5 text-right font-bold">{a.migra}</td><td className="p-1.5 text-right font-bold">{formatarMoeda(a.valorMigra)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}

export default function ViradaPage() {
  const toast = useToast();
  const confirmar = useConfirm();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota: ROTA });
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [conf, setConf] = useState<Record<string, boolean>>({});
  const [desde, setDesde] = useState('');
  const [finDesde, setFinDesde] = useState('');
  const [previas, setPrevias] = useState<Record<string, any>>({});

  const carregar = useCallback(async (id: number | null) => {
    if (!accessToken) return;
    const r = await painelViradaAction(id, accessToken);
    if (!r.ok) { setFalha(r.erro || 'Erro ao carregar.'); return; }
    setInfo(r.info); setFalha(null); setEmpresaId(r.info.empresaId ?? null);
    setConf(r.info.estado?.confirmacoes || {}); setDesde(r.info.contasDesdePadrao || ''); setFinDesde(d => d || r.info.finalizadasDesdePadrao || '');
  }, [accessToken]);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar(null);
  }, [authLoading, acessoNegado, erro, accessToken, carregar]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md border border-red-200"><div className="text-5xl mb-3">⛔</div><p className="text-sm text-gray-600 mb-4">Só o Administrador conduz a virada da chave.</p><Link href="/admin/parametros" className="text-xs font-black uppercase text-[#336699]">Voltar</Link></div></div>;

  const tok = accessToken as string;
  const est = info?.estado;
  const etapa: string = est?.etapa || 'PREPARACAO';
  const empresa = info?.empresas?.find((e: any) => e.id === empresaId);
  const checklist = info?.checklist;
  const pendentesAuto = (checklist?.itens || []).filter((i: any) => i.ok === false).length;
  const pendentesManuais = (checklist?.manuais || []).filter((m: any) => !conf[m.chave]).length;

  const rodar = async (chave: string, fn: () => Promise<any>, ok?: string) => {
    setOcupado(chave);
    const r = await fn();
    setOcupado(null);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return null; }
    if (ok) toast(ok, 'success');
    return r;
  };
  const salvarConf = async (novo: Record<string, boolean>) => { setConf(novo); await salvarConferenciaAction(empresaId!, novo, desde || null, tok); };
  const ler = async (qual: 'fichas' | 'locacao' | 'receber' | 'pagar', rot: string) => {
    const r = await rodar(`ler-${qual}`, () => lerP2sAgoraAction(empresaId!, qual, tok));
    if (r) { toast(`${rot}: leitura concluída.`, 'success'); carregar(empresaId); }
  };
  const previa = async (parte: 'os' | 'receber' | 'pagar') => {
    const r = await rodar(`prev-${parte}`, () => simularViradaAction(empresaId!, parte, parte === 'os' ? finDesde : desde, tok));
    if (r) setPrevias(p => ({ ...p, [parte]: r.info }));
  };
  const executar = async (passo: 'congelar' | 'descongelar' | 'os' | 'receber' | 'pagar' | 'concluir', titulo: string, mensagem: string) => {
    if (!(await confirmar({ title: titulo, message: mensagem, confirmLabel: titulo }))) return;
    const r = await rodar(`exec-${passo}`, () => executarViradaAction(empresaId!, passo, (passo === 'os' ? finDesde : desde) || null, tok), `${titulo}: feito.`);
    if (r) { if (r.info) setPrevias(p => ({ ...p, [passo]: r.info })); carregar(empresaId); }
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] text-[#0A2A4A] pt-20 pb-16 px-3 md:px-8">
      <Analytics />
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <Link href="/admin/parametros" className="text-xs font-bold text-[#336699] hover:underline">← Parâmetros</Link>
            <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-tight">Virada da chave</h1>
            <p className="text-sm text-gray-500 max-w-3xl">Tira o P2S de cena, empresa por empresa: congela a leitura e a escrita no P2S, traz as OS em andamento e as contas em aberto para o sistema e liga o Financeiro e o Faturamento oficiais. Toda migração tem prévia antes de gravar.</p>
          </div>
        </div>
        {falha && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">{falha}</div>}

        <div className="flex flex-wrap gap-2">
          {(info?.empresas || []).map((e: any) => (
            <button key={e.id} onClick={() => { setPrevias({}); carregar(e.id); }} className={`px-4 py-2 rounded-xl border-2 text-xs font-black uppercase tracking-wider ${e.id === empresaId ? 'border-[#0C1D4D] bg-white' : 'border-[#E2E8F0] bg-white/60'}`}>
              <span className={`px-2 py-0.5 rounded ${corSeloEmpresa(e.id)}`}>{e.nome}</span>
              <span className={`ml-2 px-2 py-0.5 rounded-full text-[9px] ${ETAPA[e.etapa]?.cls}`}>{ETAPA[e.etapa]?.rot}</span>
            </button>
          ))}
        </div>

        {est && (
          <>
            <Passo n={1} titulo="Preparar" feito={etapa !== 'PREPARACAO'} ativo={etapa === 'PREPARACAO'}>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] font-black uppercase text-gray-500 mb-2">Conferido pelo sistema</p>
                  <ul className="space-y-1.5">
                    {(checklist?.itens || []).map((i: any) => (
                      <li key={i.chave} className="flex gap-2 text-xs">
                        <span className={i.ok === true ? 'text-emerald-600' : i.ok === false ? 'text-red-600' : 'text-gray-400'}>{i.ok === true ? '✔' : i.ok === false ? '✖' : '•'}</span>
                        <span><strong>{i.titulo}</strong> — <span className="text-gray-500">{i.detalhe}</span>{i.link && <> · <Link href={i.link} className="text-[#336699] font-bold hover:underline">abrir</Link></>}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[11px] font-black uppercase text-gray-500 mb-2">Conferido por você</p>
                  <ul className="space-y-1.5">
                    {(checklist?.manuais || []).map((m: any) => (
                      <li key={m.chave}><label className="flex gap-2 text-xs cursor-pointer">
                        <input type="checkbox" disabled={etapa === 'CONCLUIDA'} checked={!!conf[m.chave]} onChange={e => salvarConf({ ...conf, [m.chave]: e.target.checked })} className="mt-0.5" />
                        <span><strong>{m.titulo}</strong><span className="block text-gray-500">{m.dica}</span></span>
                      </label></li>
                    ))}
                  </ul>
                </div>
              </div>
              {etapa === 'PREPARACAO' && (
                <div className="mt-4 border-t border-[#F1F5F9] pt-3">
                  <p className="text-[11px] font-black uppercase text-gray-500 mb-2">Última leitura do P2S (logo antes de congelar)</p>
                  <div className="flex flex-wrap gap-2">
                    {([['fichas', 'Fichas de reserva'], ['locacao', 'Fichas de locação (150 dias)'], ['receber', 'Contas a receber'], ['pagar', 'Contas a pagar']] as const).map(([q, rot]) => (
                      <button key={q} disabled={!!ocupado} onClick={() => ler(q, rot)} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D] hover:bg-gray-50`}>{ocupado === `ler-${q}` ? 'Lendo…' : rot}</button>
                    ))}
                  </div>
                </div>
              )}
            </Passo>

            <Passo n={2} titulo="Congelar o P2S" feito={etapa !== 'PREPARACAO'} ativo={etapa === 'PREPARACAO'}>
              <p className="text-xs text-gray-600">A partir daqui o sistema <strong>para de ler e de escrever no P2S</strong> para {empresa?.nome}: nada de importar fichas ou contas, nada de mandar OP, baixa ou devolução para lá. Ainda dá para voltar atrás enquanto nada tiver sido migrado.</p>
              {etapa !== 'PREPARACAO' && <p className="text-xs mt-2 text-amber-800">Congelado em {quando(est.congelada_em)} por {est.congelada_por}.</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                {etapa === 'PREPARACAO' && <button disabled={!!ocupado} onClick={() => executar('congelar', 'Congelar o P2S', `${empresa?.nome}: o P2S deixa de ser lido e escrito.${pendentesAuto || pendentesManuais ? ` Atenção: ${pendentesAuto + pendentesManuais} item(ns) do checklist ainda pendente(s).` : ''}`)} className={`${btn} bg-amber-600 text-white`}>Congelar</button>}
                {etapa === 'CONGELADA' && <button disabled={!!ocupado} onClick={() => executar('descongelar', 'Descongelar', 'Volta a ler e escrever no P2S (só enquanto nada foi migrado).')} className={`${btn} bg-white border border-[#CBD5E1] text-gray-600`}>Descongelar</button>}
              </div>
            </Passo>

            <Passo n={3} titulo="Migrar OS em andamento" feito={!!est.resultado_os} ativo={etapa === 'CONGELADA' && !est.resultado_os}>
              <p className="text-xs text-gray-600">OS reservadas, em locação e finalizadas ainda sem Nota de Débito passam a ser do sistema, com o mesmo nº do P2S. As fichas de locação trazem o que já saiu e voltou, a agenda é refeita (na rua = locado, a sair = reservado) e o que o P2S já faturou é abatido do Faturamento.</p>
              <label className="text-xs inline-flex flex-wrap items-center gap-2 mt-3"><span className="font-black uppercase text-gray-500 text-[11px]">Finalizadas &quot;não faturado&quot; devolvidas a partir de</span>
                <input type="date" value={finDesde} disabled={etapa !== 'PREPARACAO' && etapa !== 'CONGELADA'} onChange={e => { setFinDesde(e.target.value); setPrevias(p => ({ ...p, os: null })); }} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white" />
                <span className="text-[11px] text-gray-500">O P2S deixa cerca de 1 em cada 5 fichas devolvidas como &quot;não faturado&quot; — as antigas ficam lá. Sem valor ou já faturadas por inteiro também ficam.</span>
              </label>
              {est.resultado_os && <p className="text-xs mt-2 text-emerald-700 font-bold">✔ {est.resultado_os.migradas} de {est.resultado_os.os} OS migradas em {quando(est.resultado_os.em)}.{est.resultado_os.erros?.length ? ` ${est.resultado_os.erros.length} erro(s): ${est.resultado_os.erros.join('; ')}` : ''}</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                <button disabled={!!ocupado || !finDesde} onClick={() => previa('os')} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>{ocupado === 'prev-os' ? 'Calculando…' : 'Prévia'}</button>
                {etapa === 'CONGELADA' && <button disabled={!!ocupado || !previas.os} onClick={() => executar('os', 'Migrar as OS', `${previas.os?.resumo.os ?? ''} OS de ${empresa?.nome} passam a ser do sistema.`)} className={`${btn} bg-[#0C1D4D] text-white`}>{ocupado === 'exec-os' ? 'Migrando…' : 'Migrar'}</button>}
              </div>
              {previas.os && (
                <div className="mt-3">
                  <p className="text-xs text-gray-600 mb-2"><strong>{previas.os.resumo.os}</strong> OS · {num(previas.os.resumo.naRua)} un. na rua · {num(previas.os.resumo.aSair)} un. a sair · {formatarMoeda(previas.os.resumo.faturadoP2s)} já faturado no P2S{previas.os.resumo.finalizadasSemSaldo ? ` · ${previas.os.resumo.finalizadasSemSaldo} finalizada(s) sem nada a faturar ficam no P2S` : ''}</p>
                  {previas.os.resumo.comAlerta > 0 && <p className="text-xs mb-2 text-amber-700 font-bold">⚠ {previas.os.resumo.comAlerta} OS com aviso (veja na tabela). Em locação sem ficha lida: rode &quot;Fichas de locação&quot; na última leitura antes de congelar.</p>}
                  <div className="overflow-x-auto max-h-72 overflow-y-auto border border-[#E2E8F0] rounded-xl"><table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#F8FAFC]"><tr className="text-left text-[10px] font-black uppercase text-gray-500"><th className="p-1.5">OS</th><th className="p-1.5">Cliente</th><th className="p-1.5">Situação</th><th className="p-1.5">Fichas de locação</th><th className="p-1.5 text-right">Na rua</th><th className="p-1.5 text-right">A sair</th><th className="p-1.5 text-right">Valor da OS</th><th className="p-1.5 text-right">Faturado no P2S</th></tr></thead>
                    <tbody>{previas.os.plano.map((p: any) => <tr key={p.id} className="border-t border-[#F1F5F9]"><td className="p-1.5 font-bold whitespace-nowrap">{p.os}</td><td className="p-1.5">{p.cliente}{p.alerta && <span className="block text-[10px] text-amber-700 font-bold">⚠ {p.alerta}</span>}</td><td className="p-1.5">{p.status.toLowerCase().replace('_', ' ')}</td><td className="p-1.5">{p.fichasLocacao}</td><td className="p-1.5 text-right">{num(p.unidadesNaRua)}</td><td className="p-1.5 text-right">{num(p.unidadesASair)}</td><td className="p-1.5 text-right">{formatarMoeda(p.valorOs)}</td><td className="p-1.5 text-right">{formatarMoeda(p.faturadoP2s)}</td></tr>)}</tbody>
                  </table></div>
                </div>
              )}
            </Passo>

            <Passo n={4} titulo="Contas em aberto: data de corte" feito={!!est.resultado_receber && !!est.resultado_pagar} ativo={etapa === 'CONGELADA' && (!est.resultado_receber || !est.resultado_pagar)}>
              <p className="text-xs text-gray-600">O P2S tem muita conta antiga &quot;em aberto&quot; que nunca foi baixada lá. Só migra o que <strong>vence a partir da data abaixo</strong> (o resto fica no histórico do P2S). Veja a prévia por ano antes de gravar.</p>
              <label className="text-xs inline-flex items-center gap-2 mt-3"><span className="font-black uppercase text-gray-500 text-[11px]">Migrar o que vence a partir de</span>
                <input type="date" value={desde} disabled={etapa === 'CONCLUIDA'} onChange={e => { setDesde(e.target.value); setPrevias(p => ({ ...p, receber: null, pagar: null })); }} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white" />
              </label>
              <div className="grid md:grid-cols-2 gap-4 mt-3">
                {(['receber', 'pagar'] as const).map(parte => {
                  const feito = parte === 'receber' ? est.resultado_receber : est.resultado_pagar;
                  return (
                    <div key={parte} className="border border-[#E2E8F0] rounded-xl p-3">
                      <p className="text-xs font-black uppercase text-[#0C1D4D]">{parte === 'receber' ? 'Contas a receber' : 'Contas a pagar'}</p>
                      {feito && <p className="text-xs mt-1 text-emerald-700 font-bold">✔ {feito.gravados} título(s){feito.ligadosOp ? ` + ${feito.ligadosOp} ligados à OP` : ''} · {formatarMoeda(feito.valorAMigrar)} · desde {dataBR(feito.desde)} · {quando(feito.em)}</p>}
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button disabled={!!ocupado || !desde} onClick={() => previa(parte)} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>{ocupado === `prev-${parte}` ? 'Calculando…' : 'Prévia'}</button>
                        {etapa === 'CONGELADA' && <button disabled={!!ocupado || !previas[parte]} onClick={() => executar(parte, parte === 'receber' ? 'Migrar contas a receber' : 'Migrar contas a pagar', `${previas[parte]?.resumo.aMigrar ?? ''} título(s), ${formatarMoeda(previas[parte]?.resumo.valorAMigrar || 0)}, vencendo desde ${dataBR(desde)}.`)} className={`${btn} bg-[#0C1D4D] text-white`}>{ocupado === `exec-${parte}` ? 'Migrando…' : 'Migrar'}</button>}
                      </div>
                      <ResumoContas p={previas[parte]} />
                    </div>
                  );
                })}
              </div>
            </Passo>

            <Passo n={5} titulo="Concluir" feito={etapa === 'CONCLUIDA'} ativo={etapa === 'CONGELADA' && !!est.resultado_os && !!est.resultado_receber && !!est.resultado_pagar}>
              <p className="text-xs text-gray-600">Liga o <strong>Financeiro na fonte Sistema</strong> (baixas geram movimento no caixa) e a <strong>Nota de Débito na série oficial</strong> (continua do último nº do P2S).</p>
              {etapa === 'CONCLUIDA' && <p className="text-xs mt-2 text-emerald-700 font-bold">✔ Virada concluída em {quando(est.concluida_em)} por {est.concluida_por}.</p>}
              {etapa === 'CONGELADA' && <button disabled={!!ocupado} onClick={() => executar('concluir', 'Concluir a virada', `${empresa?.nome} passa a operar só pelo sistema.`)} className={`${btn} bg-emerald-700 text-white mt-3`}>Concluir a virada</button>}
            </Passo>

            <div className={card}>
              <h2 className="text-sm font-black uppercase tracking-wider text-[#0C1D4D] mb-2">Fiscal</h2>
              {info?.fiscal?.ativo ? (
                <p className="text-xs text-gray-600">Ambiente atual: <strong>{info.fiscal.ambiente === 'PRODUCAO' ? 'produção' : 'homologação'}</strong>. A troca para produção fica em <Link href="/admin/financeiro/fiscal" className="text-[#336699] font-bold hover:underline">Financeiro › Fiscal › Parâmetros</Link> (depois de ajustar a numeração no painel da Focus). Regime: {info.fiscal.lucro_presumido_desde ? `Simples até ${dataBR(info.fiscal.lucro_presumido_desde)}, depois Lucro Presumido (automático)` : (info.fiscal.regime || '—').toLowerCase().replace('_', ' ')}.</p>
              ) : <p className="text-xs text-gray-600">Esta empresa não emite nota fiscal pelo sistema.</p>}
            </div>

            <div className={card}>
              <h2 className="text-sm font-black uppercase tracking-wider text-[#0C1D4D] mb-2">Registro</h2>
              {!(est.log || []).length ? <p className="text-xs text-gray-400">Nada ainda.</p> : (
                <ul className="space-y-1 text-xs max-h-60 overflow-y-auto">{[...est.log].reverse().map((l: any, k: number) => <li key={k}><span className="text-gray-400">{quando(l.em)}</span> · <strong>{l.acao}</strong> · {l.detalhe} <span className="text-gray-400">({l.por})</span></li>)}</ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
