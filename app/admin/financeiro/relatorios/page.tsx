"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import { buscarRelatorioFinanceiroAction } from '../actions';

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES (mesmo padrão das páginas irmãs)
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  if (p.includes('GESTOR')) return 'GESTORES';
  return 'USUARIO';
};

// ============================================================================
// FORMATADORES
// ============================================================================
const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtMesBR = (m: string) => { const [a, mm] = (m || '').split('-'); return mm ? `${mm}/${a}` : '—'; };
const fmtDataBR = (d: string) => { if (!d) return '—'; const [a, m, dd] = d.split('-'); return `${dd}/${m}/${a}`; };
const fmtDataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Paleta categórica validada (dataviz skill — ordem fixa, nunca ciclada por
// aleatoriedade). Cada ranking (natureza, responsáveis, instituições) usa
// esta mesma ordem para as posições 1ª..5ª; "OUTROS" sempre em cinza neutro.
const CORES_CATEGORICAS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const COR_NEUTRA = '#94a3b8';
const corRanking = (idx: number, label: string) => (label === 'OUTROS' ? COR_NEUTRA : (CORES_CATEGORICAS[idx] || COR_NEUTRA));

// Status semânticos — mesma paleta de chip já usada no resto do app.
const COR_PAGO = '#16A34A';     // emerald-600
const COR_PENDENTE = '#D97706'; // amber-600
const COR_VENCIDA = '#DC2626';  // red-600

interface ItemRanking { label: string; valor: number; qtd: number; }
interface RelatorioInfo {
  mesReferencia: string;
  ops: {
    qtd: number; valor: number;
    pendenteQtd: number; pendenteValor: number; pagoQtd: number; pagoValor: number;
    natureza: ItemRanking[];
    topResponsaveis: ItemRanking[];
    vencidas: { qtd: number; valor: number; lista: { id: string; os_numero: string; favorecido: string; valor: number; vencimento: string; dias: number; responsavel: string }[] };
    trend: { mes: string; pago: number; pendente: number }[];
  };
  lotes: {
    qtd: number; valor: number;
    statusBreakdown: { status: string; valor: number; qtd: number }[];
    trend: { mes: string; valor: number }[];
    recentes: { nome: string; mes: string; valor: number; qtd: number; status: string; criadoEm: string }[];
  };
  consignado: {
    qtdAtivos: number; valorMensalTotal: number;
    funcionariosComConsignado: number; funcionariosAtivos: number;
    topInstituicoes: ItemRanking[];
    atualizadoEm: string | null;
  };
}

// ============================================================================
// PEÇAS DE VISUALIZAÇÃO — construídas em HTML/CSS puro (sem lib de gráfico),
// seguindo as specs da skill dataviz: marca fina, ponta arredondada, gap de
// 2px entre segmentos, rótulo direto no valor, legenda sempre que houver
// mais de uma série.
// ============================================================================
function Kpi({ label, value, sub, corValor }: { label: string; value: string; sub?: string; corValor?: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{label}</p>
      <p className="text-2xl font-black tabular-nums" style={{ color: corValor || '#0C1D4D' }}>{value}</p>
      {sub && <p className="text-[10px] font-bold text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function CardVazio({ texto }: { texto: string }) {
  return <div className="text-center text-gray-400 font-bold text-xs uppercase tracking-wider py-10">{texto}</div>;
}

// Barra horizontal única, ranking (natureza / responsáveis / instituições).
function BarraRanking({ itens, formatarValor }: { itens: ItemRanking[]; formatarValor: (v: number) => string }) {
  if (itens.length === 0) return <CardVazio texto="Sem dados no período" />;
  const max = Math.max(...itens.map(i => i.valor), 1);
  return (
    <div className="space-y-3">
      {itens.map((it, idx) => (
        <div key={it.label} title={`${it.label}: ${formatarValor(it.valor)} (${it.qtd})`}>
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-[11px] font-black text-[#0C1D4D] uppercase truncate pr-2">{it.label}</span>
            <span className="text-[11px] font-black text-gray-600 tabular-nums shrink-0">{formatarValor(it.valor)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-[#F1F5F9] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(2, (it.valor / max) * 100)}%`, backgroundColor: corRanking(idx, it.label) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// Barra empilhada única (proporção pago x pendente) + legenda.
function BarraProporcao({ pago, pendente }: { pago: number; pendente: number }) {
  const total = pago + pendente;
  if (total <= 0) return <CardVazio texto="Sem dados no período" />;
  const pctPago = (pago / total) * 100;
  const pctPendente = 100 - pctPago;
  return (
    <div>
      <div className="h-7 rounded-full bg-[#F1F5F9] overflow-hidden flex gap-[2px] p-0">
        {pago > 0 && <div className="h-full rounded-full" style={{ width: `${pctPago}%`, backgroundColor: COR_PAGO }} title={`Pago: ${BRL(pago)}`} />}
        {pendente > 0 && <div className="h-full rounded-full" style={{ width: `${pctPendente}%`, backgroundColor: COR_PENDENTE }} title={`Pendente: ${BRL(pendente)}`} />}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 text-[11px] font-bold">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COR_PAGO }} />Pago — {BRL(pago)} <span className="text-gray-400">({pctPago.toFixed(0)}%)</span></span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COR_PENDENTE }} />Pendente — {BRL(pendente)} <span className="text-gray-400">({pctPendente.toFixed(0)}%)</span></span>
      </div>
    </div>
  );
}

// Colunas verticais — tendência mensal. `serieExtra` (opcional) empilha uma
// segunda cor sobre a primeira (ex.: pago + pendente); sem ela é uma coluna só.
function GraficoMensal({
  dados, mesAtual, corPrincipal, corExtra, campoPrincipal, campoExtra
}: {
  dados: Record<string, any>[];
  mesAtual: string;
  corPrincipal: string;
  corExtra?: string;
  campoPrincipal: string;
  campoExtra?: string;
}) {
  const totais = dados.map(d => Number(d[campoPrincipal] || 0) + (campoExtra ? Number(d[campoExtra] || 0) : 0));
  const max = Math.max(...totais, 1);
  const semDados = totais.every(t => t === 0);
  if (semDados) return <CardVazio texto="Sem histórico nos últimos 6 meses" />;

  return (
    <div>
      <div className="flex items-end justify-between gap-2 h-36 px-1">
        {dados.map((d) => {
          const principal = Number(d[campoPrincipal] || 0);
          const extra = campoExtra ? Number(d[campoExtra] || 0) : 0;
          const total = principal + extra;
          const alturaTotal = Math.max(total > 0 ? 4 : 0, (total / max) * 100);
          const alturaPrincipal = total > 0 ? (principal / total) * 100 : 0;
          const ehMesAtual = d.mes === mesAtual;
          return (
            <div key={d.mes} className="flex flex-col items-center justify-end flex-1 h-full gap-1.5" title={`${fmtMesBR(d.mes)}: ${BRL(total)}`}>
              <div className="w-full max-w-[28px] flex flex-col justify-end rounded-t-[4px] overflow-hidden gap-[2px]" style={{ height: `${alturaTotal}%` }}>
                {extra > 0 && <div style={{ height: `${100 - alturaPrincipal}%`, backgroundColor: corExtra }} />}
                {principal > 0 && <div style={{ height: `${alturaPrincipal}%`, backgroundColor: corPrincipal }} className={extra > 0 ? '' : 'rounded-t-[4px]'} />}
              </div>
              <span className={`text-[9px] font-black uppercase ${ehMesAtual ? 'text-[#0C1D4D]' : 'text-gray-400'}`}>{fmtMesBR(d.mes).slice(0, 2)}/{fmtMesBR(d.mes).slice(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RelatoriosFinanceiroPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  const [mesReferencia, setMesReferencia] = useState(() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dados, setDados] = useState<RelatorioInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();
      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }
      setAuthLoading(false);
    }
    checkAuth();
  }, [router, pathname]);

  const carregar = async () => {
    setLoading(true);
    setErro(null);
    const res = await buscarRelatorioFinanceiroAction({ mesReferencia });
    if (res.ok) setDados(res.info);
    else setErro(res.erro || 'Não foi possível carregar o relatório.');
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregar();
  }, [mesReferencia, authLoading, acessoNegado]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <p className="text-[#64748B] font-bold text-sm uppercase tracking-wider">Validando acesso...</p>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Relatórios do Financeiro.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  const ehMesAtual = mesReferencia === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const mudarMes = (delta: number) => {
    const [a, m] = mesReferencia.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    setMesReferencia(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          📊 <strong>Relatórios do Financeiro</strong>. Ordens de Pagamento, Lotes de Pagamento e Crédito Consignado consolidados.
        </p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase shrink-0">
          ⬅ VOLTAR AO FINANCEIRO
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 pb-12 max-w-[1400px] mx-auto w-full">
        {/* Seletor de mês */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-6 flex flex-wrap items-center gap-3">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Competência</label>
          <button onClick={() => mudarMes(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 font-black">‹</button>
          <input type="month" value={mesReferencia} onChange={e => setMesReferencia(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
          <button onClick={() => mudarMes(1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 font-black">›</button>
          {!ehMesAtual && (
            <button onClick={() => setMesReferencia(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)} className="text-[10px] font-black text-[#336699] hover:underline uppercase">Voltar para o mês atual</button>
          )}
          <span className="text-[11px] font-bold text-gray-400 ml-auto">
            OPs: qualquer data de criação · Lotes: mês de competência · Consignado: situação atual (não é filtrado por mês)
          </span>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando relatório...</div>
        ) : erro ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center text-red-600 font-bold">{erro}</div>
        ) : dados && (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <Kpi label="OPs no mês" value={String(dados.ops.qtd)} sub={BRL(dados.ops.valor)} />
              <Kpi label="OPs pagas" value={String(dados.ops.pagoQtd)} sub={BRL(dados.ops.pagoValor)} corValor="#16A34A" />
              <Kpi label="OPs pendentes" value={String(dados.ops.pendenteQtd)} sub={BRL(dados.ops.pendenteValor)} corValor="#D97706" />
              <Kpi label="OPs vencidas" value={String(dados.ops.vencidas.qtd)} sub={BRL(dados.ops.vencidas.valor)} corValor={dados.ops.vencidas.qtd > 0 ? COR_VENCIDA : undefined} />
              <Kpi label="Lotes no mês" value={String(dados.lotes.qtd)} sub={BRL(dados.lotes.valor)} />
              <Kpi label="Consignado ativo" value={String(dados.consignado.qtdAtivos)} sub={`${BRL(dados.consignado.valorMensalTotal)}/mês`} />
            </div>

            {/* Alerta de OPs vencidas — auditoria rápida */}
            {dados.ops.vencidas.qtd > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden mb-6">
                <div className="px-5 py-3.5 bg-red-50 border-b border-red-200 flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-xs font-black text-red-700 uppercase tracking-wider">⚠ Ordens de Pagamento vencidas e não pagas</h3>
                  <span className="text-[11px] font-bold text-red-600">{dados.ops.vencidas.qtd} OP(s) · {BRL(dados.ops.vencidas.valor)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">OS</th>
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Favorecido</th>
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Responsável</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Venceu em</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Dias em atraso</th>
                        <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.ops.vencidas.lista.map((op, idx) => (
                        <tr key={op.id} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                          <td className="p-3 font-black text-[#0C1D4D]">{op.os_numero}</td>
                          <td className="p-3">{op.favorecido}</td>
                          <td className="p-3 text-gray-500">{op.responsavel}</td>
                          <td className="p-3 text-center">{fmtDataBR(op.vencimento)}</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-700">{op.dias}d</span>
                          </td>
                          <td className="p-3 text-right font-black tabular-nums">{BRL(op.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {dados.ops.vencidas.qtd > dados.ops.vencidas.lista.length && (
                  <p className="text-[10px] text-gray-400 font-bold text-center py-2 border-t border-[#E2E8F0]">
                    Mostrando as {dados.ops.vencidas.lista.length} mais antigas de {dados.ops.vencidas.qtd} vencidas.
                  </p>
                )}
              </div>
            )}

            {/* OPs: status x natureza */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-4">OPs por status — {fmtMesBR(mesReferencia)}</h3>
                <BarraProporcao pago={dados.ops.pagoValor} pendente={dados.ops.pendenteValor} />
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-4">OPs por natureza de pagamento — {fmtMesBR(mesReferencia)}</h3>
                <BarraRanking itens={dados.ops.natureza} formatarValor={BRL} />
              </div>
            </div>

            {/* Tendência 6 meses */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Ordens de Pagamento — últimos 6 meses</h3>
                <p className="text-[10px] text-gray-400 font-bold mb-4">Valor total por mês de criação</p>
                <GraficoMensal dados={dados.ops.trend} mesAtual={mesReferencia} corPrincipal={COR_PAGO} corExtra={COR_PENDENTE} campoPrincipal="pago" campoExtra="pendente" />
                <div className="flex gap-4 mt-3 text-[10px] font-bold text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_PAGO }} />Pago</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: COR_PENDENTE }} />Pendente</span>
                </div>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Lotes de Pagamento — últimos 6 meses</h3>
                <p className="text-[10px] text-gray-400 font-bold mb-4">Valor total por mês de competência</p>
                <GraficoMensal dados={dados.lotes.trend} mesAtual={mesReferencia} corPrincipal="#2a78d6" campoPrincipal="valor" />
              </div>
            </div>

            {/* Responsáveis x Consignado */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-4">Top responsáveis por valor solicitado — {fmtMesBR(mesReferencia)}</h3>
                <BarraRanking itens={dados.ops.topResponsaveis} formatarValor={BRL} />
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">Crédito Consignado — situação atual</h3>
                  {dados.consignado.atualizadoEm && (
                    <span className="text-[9px] font-bold text-gray-400">atualizado {fmtDataHora(dados.consignado.atualizadoEm)}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-center">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Colaboradores com consignação</p>
                    <p className="text-xl font-black text-[#0C1D4D] tabular-nums">{dados.consignado.funcionariosComConsignado}<span className="text-sm text-gray-300">/{dados.consignado.funcionariosAtivos}</span></p>
                  </div>
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-center">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Desconto mensal total</p>
                    <p className="text-xl font-black text-[#0C1D4D] tabular-nums">{BRL(dados.consignado.valorMensalTotal)}</p>
                  </div>
                </div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Por instituição concessora</p>
                <BarraRanking itens={dados.consignado.topInstituicoes} formatarValor={BRL} />
              </div>
            </div>

            {/* Lotes recentes */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
                <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">Lotes de pagamento recentes</h3>
                <button onClick={() => router.push('/admin/financeiro/rh')} className="text-[10px] font-black text-[#336699] hover:underline uppercase">Ver todos ➔</button>
              </div>
              {dados.lotes.recentes.length === 0 ? (
                <CardVazio texto="Nenhum lote gerado ainda." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Lote</th>
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Competência</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Pagtos</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Status</th>
                        <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.lotes.recentes.map((l, idx) => (
                        <tr key={idx} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                          <td className="p-3 font-black text-[#0C1D4D]">{l.nome}</td>
                          <td className="p-3 font-bold">{fmtMesBR(l.mes)}</td>
                          <td className="p-3 text-center font-black">{l.qtd}</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-100 text-blue-700">{l.status}</span>
                          </td>
                          <td className="p-3 text-right font-black tabular-nums">{BRL(l.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
