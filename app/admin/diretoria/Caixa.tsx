"use client";

import { useEffect, useState } from 'react';
import { projecaoCaixaDiretoriaAction } from './actions';
import { formatarMoeda } from '../../lib/formatadores';

// Aba "Caixa" de /admin/diretoria — projeção de 30/60/90 dias (app/lib/diretoria/caixa.ts).
// Gráfico 1: entradas (para cima) × saídas (para baixo) por semana, mesmo eixo em R$.
// Gráfico 2: saldo acumulado previsto (gráfico separado — nada de eixo duplo).
// Cores: slots 1 e 2 da paleta categórica de referência (validados juntos, light).

const COR_ENTRADA = '#2a78d6';
const COR_SAIDA = '#eb6834';
const BRL = formatarMoeda;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const compacto = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1).replace('.', ',')} mi` : a >= 1e3 ? `${Math.round(a / 1e3)} mil` : String(Math.round(a));
  return `${v < 0 ? '−' : ''}R$ ${s}`;
};

interface Semana { inicio: string; fim: string; entradas: number; saidas: number; saldo_semana: number; saldo_acumulado: number }
interface Projecao {
  fonte_recebimentos: 'P2S' | 'EXTERNA';
  hoje: string;
  horizontes: { dias: number; ate: string; entradas: number; saidas: number; saldo: number }[];
  semanas: Semana[];
  maiores_entradas_30d: { nome: string; valor: number; data: string; origem: string }[];
  maiores_saidas_30d: { nome: string; valor: number; data: string; origem: string }[];
  saidas_por_centro_30d: { nome: string; valor: number }[];
  vencidos_a_receber_ate_90_dias: { valor: number; qtd: number };
  limitacoes: string[];
}

export default function Caixa({ accessToken, empresaId }: { accessToken: string; empresaId: number }) {
  const [p, setP] = useState<Projecao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verTabela, setVerTabela] = useState(false);

  useEffect(() => {
    let ativo = true;
    projecaoCaixaDiretoriaAction(empresaId, accessToken).then(res => {
      if (!ativo) return;
      if (res.ok) setP(res.info); else setErro(res.erro || 'Erro ao calcular a projeção.');
    });
    return () => { ativo = false; };
  }, [empresaId, accessToken]);

  if (erro) return <div className="bg-white rounded-2xl border border-red-200 p-6 text-sm text-red-600">{erro}</div>;
  if (!p) return <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-400">Calculando a projeção…</div>;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {p.horizontes.map(h => (
          <div key={h.dias} className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Próximos {h.dias} dias · até {dm(h.ate)}</p>
            <p className={`text-xl font-black mt-1 ${h.saldo < 0 ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{h.saldo < 0 ? '−' : '+'}{BRL(Math.abs(h.saldo))}</p>
            <p className="text-[11px] text-gray-500 mt-1">
              <span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: COR_ENTRADA }} />entradas {BRL(h.entradas)}
              <span className="inline-block w-2 h-2 rounded-sm ml-3 mr-1 align-middle" style={{ background: COR_SAIDA }} />saídas {BRL(h.saidas)}
            </p>
          </div>
        ))}
      </section>

      <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs font-black text-[#0C1D4D]">Entradas e saídas previstas por semana</p>
          <div className="flex items-center gap-4 text-[11px] text-gray-600">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: COR_ENTRADA }} />Entradas (a receber)</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: COR_SAIDA }} />Saídas (a pagar + OPs)</span>
            <button onClick={() => setVerTabela(v => !v)} className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:underline">{verTabela ? 'Ver gráfico' : 'Ver tabela'}</button>
          </div>
        </div>
        {verTabela ? <TabelaSemanas semanas={p.semanas} /> : (
          <>
            <GraficoEntradasSaidas semanas={p.semanas} />
            <p className="text-xs font-black text-[#0C1D4D] mt-5 mb-1">Saldo acumulado previsto (variação a partir de hoje)</p>
            <GraficoSaldo semanas={p.semanas} />
          </>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Lista titulo="Maiores entradas · 30 dias" itens={p.maiores_entradas_30d} vazio={p.fonte_recebimentos === 'EXTERNA' ? 'Recebimentos desta empresa vêm de fonte externa.' : 'Nada a receber nos próximos 30 dias.'} />
        <Lista titulo="Maiores saídas · 30 dias" itens={p.maiores_saidas_30d} vazio="Nada a pagar nos próximos 30 dias." />
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Saídas por centro · 30 dias</p>
          {p.saidas_por_centro_30d.length === 0 ? <p className="text-xs text-gray-500">—</p> : (
            <ul className="space-y-1.5">
              {p.saidas_por_centro_30d.map(c => {
                const max = p.saidas_por_centro_30d[0].valor || 1;
                return (
                  <li key={c.nome} className="text-xs">
                    <div className="flex justify-between gap-2"><span className="text-gray-700 truncate">{c.nome}</span><span className="text-gray-500 shrink-0">{BRL(c.valor)}</span></div>
                    <div className="h-1.5 bg-[#F0F4F8] rounded-full mt-0.5"><div className="h-1.5 rounded-full" style={{ width: `${(c.valor / max) * 100}%`, background: COR_SAIDA }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="bg-slate-50 rounded-2xl border border-[#E2E8F0] p-4">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Como ler</p>
        <ul className="space-y-1">
          {p.limitacoes.map((l, i) => <li key={i} className="text-[11px] text-gray-500">• {l}</li>)}
          {p.fonte_recebimentos === 'P2S' && p.vencidos_a_receber_ate_90_dias.qtd > 0 && (
            <li className="text-[11px] text-gray-500">• Fora da projeção: {BRL(p.vencidos_a_receber_ate_90_dias.valor)} em {p.vencidos_a_receber_ate_90_dias.qtd} título(s) vencidos há até 90 dias, que ainda podem entrar.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function Lista({ titulo, itens, vazio }: { titulo: string; itens: { nome: string; valor: number; data: string; origem: string }[]; vazio: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">{titulo}</p>
      {itens.length === 0 ? <p className="text-xs text-gray-500">{vazio}</p> : (
        <ul className="space-y-1.5">
          {itens.map((it, i) => (
            <li key={i} className="flex justify-between gap-2 text-xs">
              <span className="min-w-0"><span className="block text-gray-700 truncate">{it.nome}</span><span className="text-[10px] text-gray-400">{dm(it.data)} · {it.origem}</span></span>
              <span className="text-gray-700 font-bold shrink-0">{BRL(it.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TabelaSemanas({ semanas }: { semanas: Semana[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-left text-[10px] text-gray-400 uppercase"><th className="py-2 pr-3">Semana</th><th className="py-2 pr-3 text-right">Entradas</th><th className="py-2 pr-3 text-right">Saídas</th><th className="py-2 pr-3 text-right">Saldo da semana</th><th className="py-2 text-right">Acumulado</th></tr></thead>
        <tbody>
          {semanas.map(s => (
            <tr key={s.inicio} className="border-t border-gray-100">
              <td className="py-1.5 pr-3 text-gray-700">{dm(s.inicio)} a {dm(s.fim)}</td>
              <td className="py-1.5 pr-3 text-right text-gray-700">{BRL(s.entradas)}</td>
              <td className="py-1.5 pr-3 text-right text-gray-700">{BRL(s.saidas)}</td>
              <td className={`py-1.5 pr-3 text-right ${s.saldo_semana < 0 ? 'text-red-600' : 'text-gray-700'}`}>{BRL(s.saldo_semana)}</td>
              <td className={`py-1.5 text-right font-bold ${s.saldo_acumulado < 0 ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{BRL(s.saldo_acumulado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const L = 640, ALT = 220, ESQ = 64, DIR = 8, TOPO = 10, BASE = 24;

function Tooltip({ x, y, linhas }: { x: number; y: number; linhas: string[] }) {
  return (
    <div className="pointer-events-none absolute z-10 bg-[#0C1D4D] text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap"
      style={{ left: `${(x / L) * 100}%`, top: y, transform: 'translate(-50%, -110%)' }}>
      {linhas.map((l, i) => <div key={i} className={i === 0 ? 'font-black' : ''}>{l}</div>)}
    </div>
  );
}

function GraficoEntradasSaidas({ semanas }: { semanas: Semana[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...semanas.map(s => Math.max(s.entradas, s.saidas)));
  const meio = TOPO + (ALT - TOPO - BASE) / 2;
  const escala = (ALT - TOPO - BASE) / 2 / max;
  const larguraCol = (L - ESQ - DIR) / semanas.length;
  const barra = Math.min(22, larguraCol * 0.55);
  const s = hover != null ? semanas[hover] : null;
  return (
    <div className="relative overflow-x-auto">
      <div className="min-w-[560px] relative">
        <svg viewBox={`0 0 ${L} ${ALT}`} className="w-full h-auto" role="img" aria-label="Entradas e saídas previstas por semana nas próximas 13 semanas">
          {[max, max / 2, 0, -max / 2, -max].map(v => (
            <g key={v}>
              <line x1={ESQ} x2={L - DIR} y1={meio - v * escala} y2={meio - v * escala} stroke={v === 0 ? '#94a3b8' : '#e2e8f0'} strokeWidth={v === 0 ? 1 : 0.75} />
              <text x={ESQ - 6} y={meio - v * escala + 3} textAnchor="end" fontSize="9" fill="#64748b">{compacto(v)}</text>
            </g>
          ))}
          {semanas.map((sem, i) => {
            const cx = ESQ + larguraCol * i + larguraCol / 2;
            const hE = sem.entradas * escala, hS = sem.saidas * escala;
            return (
              <g key={sem.inicio} opacity={hover == null || hover === i ? 1 : 0.45}>
                {/* 4px de raio só na ponta do dado; a base encosta no zero */}
                {hE > 0 && <path d={`M${cx - barra / 2},${meio - 1} V${meio - hE + Math.min(4, hE)} Q${cx - barra / 2},${meio - hE} ${cx - barra / 2 + Math.min(4, hE)},${meio - hE} H${cx + barra / 2 - Math.min(4, hE)} Q${cx + barra / 2},${meio - hE} ${cx + barra / 2},${meio - hE + Math.min(4, hE)} V${meio - 1} Z`} fill={COR_ENTRADA} />}
                {hS > 0 && <path d={`M${cx - barra / 2},${meio + 1} V${meio + hS - Math.min(4, hS)} Q${cx - barra / 2},${meio + hS} ${cx - barra / 2 + Math.min(4, hS)},${meio + hS} H${cx + barra / 2 - Math.min(4, hS)} Q${cx + barra / 2},${meio + hS} ${cx + barra / 2},${meio + hS - Math.min(4, hS)} V${meio + 1} Z`} fill={COR_SAIDA} />}
                {i % 2 === 0 && <text x={cx} y={ALT - 8} textAnchor="middle" fontSize="9" fill="#64748b">{dm(sem.inicio)}</text>}
                <rect x={ESQ + larguraCol * i} y={TOPO} width={larguraCol} height={ALT - TOPO - BASE} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
                  aria-label={`Semana de ${dm(sem.inicio)}: entradas ${BRL(sem.entradas)}, saídas ${BRL(sem.saidas)}`} />
              </g>
            );
          })}
        </svg>
        {s && hover != null && (
          <Tooltip x={ESQ + larguraCol * hover + larguraCol / 2} y={20} linhas={[`${dm(s.inicio)} a ${dm(s.fim)}`, `Entradas ${BRL(s.entradas)}`, `Saídas ${BRL(s.saidas)}`, `Saldo da semana ${BRL(s.saldo_semana)}`]} />
        )}
      </div>
    </div>
  );
}

function GraficoSaldo({ semanas }: { semanas: Semana[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const alt = 150;
  const valores = [0, ...semanas.map(s => s.saldo_acumulado)];
  const maxV = Math.max(...valores), minV = Math.min(...valores);
  const faixa = Math.max(1, maxV - minV);
  const y = (v: number) => TOPO + (alt - TOPO - BASE) * (1 - (v - minV) / faixa);
  const larguraCol = (L - ESQ - DIR) / semanas.length;
  const x = (i: number) => ESQ + larguraCol * i + larguraCol / 2;
  const pontos = semanas.map((s, i) => `${x(i)},${y(s.saldo_acumulado)}`).join(' ');
  const s = hover != null ? semanas[hover] : null;
  return (
    <div className="relative overflow-x-auto">
      <div className="min-w-[560px] relative">
        <svg viewBox={`0 0 ${L} ${alt}`} className="w-full h-auto" role="img" aria-label="Saldo acumulado previsto por semana">
          {[maxV, (maxV + minV) / 2, minV].map((v, i) => (
            <g key={i}>
              <line x1={ESQ} x2={L - DIR} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={0.75} />
              <text x={ESQ - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#64748b">{compacto(v)}</text>
            </g>
          ))}
          {minV < 0 && maxV > 0 && <line x1={ESQ} x2={L - DIR} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />}
          <polyline points={pontos} fill="none" stroke={COR_ENTRADA} strokeWidth={2} strokeLinejoin="round" />
          {semanas.map((sem, i) => (
            <g key={sem.inicio}>
              <circle cx={x(i)} cy={y(sem.saldo_acumulado)} r={hover === i ? 5 : 4} fill={COR_ENTRADA} stroke="#fff" strokeWidth={2} />
              {i % 2 === 0 && <text x={x(i)} y={alt - 8} textAnchor="middle" fontSize="9" fill="#64748b">{dm(sem.inicio)}</text>}
              <rect x={ESQ + larguraCol * i} y={TOPO} width={larguraCol} height={alt - TOPO - BASE} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={TOPO} y2={alt - BASE} stroke="#94a3b8" strokeDasharray="3 3" />}
        </svg>
        {s && hover != null && <Tooltip x={x(hover)} y={10} linhas={[`Até ${dm(s.fim)}`, `Acumulado ${BRL(s.saldo_acumulado)}`]} />}
      </div>
    </div>
  );
}
