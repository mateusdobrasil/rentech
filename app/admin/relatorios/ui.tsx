"use client";

// Peças compartilhadas do HUB Relatórios (2026-11-17): filtros, indicadores,
// gráficos de barras (SVG, com dica no hover), tabela ordenável e exportação
// (Excel no navegador, PDF pelo servidor). Cores dos gráficos validadas
// (paleta de referência do dataviz: azul #2a78d6 / laranja #eb6834).
import { useState, useMemo, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';
import { useToast } from '../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../lib/coresEmpresa';
import { relatorioPdfAction } from './actions';
import type { DadosRelatorioPdf } from '../../lib/relatorios/gerarRelatorioPdf';

export const SERIE_1 = '#2a78d6';
export const SERIE_2 = '#eb6834';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const moeda = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const moedaCurta = (v: number) => {
  const a = Math.abs(v || 0);
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return moeda(v);
};
export const inteiro = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
export const decimal = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const mesRotulo = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

// ---------------------------------------------------------------- período
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
export function periodoPreset(chave: string): { de: string; ate: string } {
  const h = hoje(); const a = Number(h.slice(0, 4)), m = Number(h.slice(5, 7));
  const mes = (aa: number, mm: number) => `${aa}-${String(mm).padStart(2, '0')}`;
  const voltar = (k: number) => { let aa = a, mm = m - k; while (mm < 1) { mm += 12; aa--; } return { aa, mm }; };
  switch (chave) {
    case 'mes': return { de: `${mes(a, m)}-01`, ate: ultimoDia(a, m) };
    case 'mes_passado': { const { aa, mm } = voltar(1); return { de: `${mes(aa, mm)}-01`, ate: ultimoDia(aa, mm) }; }
    case '3m': { const { aa, mm } = voltar(2); return { de: `${mes(aa, mm)}-01`, ate: ultimoDia(a, m) }; }
    case '12m': { const { aa, mm } = voltar(11); return { de: `${mes(aa, mm)}-01`, ate: ultimoDia(a, m) }; }
    case 'ano_passado': return { de: `${a - 1}-01-01`, ate: `${a - 1}-12-31` };
    default: return { de: `${a}-01-01`, ate: `${a}-12-31` };
  }
}
const PRESETS: [string, string][] = [['mes', 'Este mês'], ['mes_passado', 'Mês passado'], ['3m', 'Últimos 3 meses'], ['ano', 'Este ano'], ['12m', 'Últimos 12 meses'], ['ano_passado', 'Ano passado']];

export interface Filtros { de: string; ate: string; empresaId: number | null; vendedorId?: number | null }

export function Cabecalho({ titulo, descricao, children }: { titulo: string; descricao: string; children?: ReactNode }) {
  return (
    <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
      <div>
        <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">{titulo}</h1>
        <p className="text-sm text-gray-500">{descricao}</p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {children}
        <Link href="/admin/relatorios" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-5 py-2.5 rounded-lg uppercase tracking-wider shadow-sm">⬅ Relatórios</Link>
      </div>
    </div>
  );
}

export function BarraFiltros({ filtros, mudar, empresas, vendedores, soDoVendedor, carregando }: {
  filtros: Filtros; mudar: (f: Filtros) => void; empresas: { id: number; nome: string }[];
  vendedores?: { id: number; nome: string }[]; soDoVendedor?: string | null; carregando?: boolean;
}) {
  const chip = (ativo: boolean) => `px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 whitespace-nowrap ${ativo ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white text-gray-600 border-[#E2E8F0] hover:border-[#336699]'}`;
  const presetAtivo = PRESETS.find(([k]) => { const p = periodoPreset(k); return p.de === filtros.de && p.ate === filtros.ate; })?.[0];
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(([k, r]) => <button key={k} onClick={() => mudar({ ...filtros, ...periodoPreset(k) })} className={chip(presetAtivo === k)}>{r}</button>)}
        <span className="flex items-center gap-1 text-xs text-gray-500 ml-1">
          <input type="date" value={filtros.de} onChange={e => e.target.value && mudar({ ...filtros, de: e.target.value })} className="border border-[#CBD5E1] rounded-lg px-2 py-1 text-xs" />
          a
          <input type="date" value={filtros.ate} onChange={e => e.target.value && mudar({ ...filtros, ate: e.target.value })} className="border border-[#CBD5E1] rounded-lg px-2 py-1 text-xs" />
        </span>
        {carregando && <span className="text-[10px] text-gray-400 font-bold uppercase">carregando…</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {empresas.length > 1 && (
          <>
            <button onClick={() => mudar({ ...filtros, empresaId: null })} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtros.empresaId === null ? `${corSeloEmpresa(null)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>Todas as empresas</button>
            {empresas.map(e => (
              <button key={e.id} onClick={() => mudar({ ...filtros, empresaId: e.id })} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtros.empresaId === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>
            ))}
          </>
        )}
        {soDoVendedor && <span className="text-[10px] font-black uppercase px-3 py-1.5 rounded-full bg-violet-100 text-violet-700">Só as suas vendas · {soDoVendedor}</span>}
        {!soDoVendedor && vendedores && vendedores.length > 0 && (
          <select value={filtros.vendedorId ?? ''} onChange={e => mudar({ ...filtros, vendedorId: e.target.value ? Number(e.target.value) : null })} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs font-bold text-[#0C1D4D]">
            <option value="">Todos os vendedores</option>
            {vendedores.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export interface Kpi { rotulo: string; valor: string; detalhe?: string; tom?: 'bom' | 'ruim' | 'neutro' }
export function Indicadores({ itens }: { itens: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {itens.map(k => (
        <div key={k.rotulo} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 min-w-0">
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">{k.rotulo}</p>
          <p className="text-xl font-black text-[#0C1D4D] mt-1 truncate" title={k.valor}>{k.valor}</p>
          {k.detalhe && <p className={`text-[10px] mt-0.5 ${k.tom === 'bom' ? 'text-emerald-700 font-bold' : k.tom === 'ruim' ? 'text-red-600 font-bold' : 'text-gray-400'}`}>{k.detalhe}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- gráficos
/** Barras verticais (1 ou 2 séries) por categoria, com dica no hover. */
export function GraficoBarras({ titulo, categorias, series, formatar }: {
  titulo: string; categorias: string[]; series: { nome: string; cor: string; valores: number[] }[]; formatar: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap(s => s.valores));
  const H = 180, padL = 64, padB = 26, larguraCat = Math.max(28, Math.min(64, 760 / Math.max(1, categorias.length)));
  const W = padL + categorias.length * larguraCat + 8;
  const gap = 2, barW = Math.max(4, (larguraCat - 12 - gap * (series.length - 1)) / series.length);
  const y = (v: number) => H - padB - (v / max) * (H - padB - 10);
  const linhas = [0, 0.5, 1].map(p => p * max);
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">{titulo}</h3>
        {series.length > 1 && (
          <div className="flex gap-3">{series.map(s => <span key={s.nome} className="flex items-center gap-1 text-[10px] text-gray-600 font-bold"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.cor }}></span>{s.nome}</span>)}</div>
        )}
      </div>
      <div className="relative overflow-x-auto">
        <svg width={W} height={H} className="block">
          {linhas.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={W - 4} y1={y(v)} y2={y(v)} stroke="#E2E8F0" strokeWidth={1} />
              <text x={padL - 6} y={y(v) + 3} fontSize={9} textAnchor="end" fill="#64748B">{formatar(v)}</text>
            </g>
          ))}
          {categorias.map((c, i) => {
            const x0 = padL + i * larguraCat + 6;
            return (
              <g key={c} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={padL + i * larguraCat} y={0} width={larguraCat} height={H - padB} fill={hover === i ? '#F1F5F9' : 'transparent'} />
                {series.map((s, k) => {
                  const v = s.valores[i] || 0;
                  const top = y(v), h = Math.max(0, H - padB - top);
                  const x = x0 + k * (barW + gap);
                  return h > 0 ? <path key={k} d={`M${x},${H - padB} V${top + Math.min(4, h)} Q${x},${top} ${x + Math.min(4, barW / 2)},${top} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${top} ${x + barW},${top + Math.min(4, h)} V${H - padB} Z`} fill={s.cor} /> : null;
                })}
                <text x={padL + i * larguraCat + larguraCat / 2} y={H - 8} fontSize={9} textAnchor="middle" fill="#64748B">{c}</text>
              </g>
            );
          })}
          <line x1={padL} x2={W - 4} y1={H - padB} y2={H - padB} stroke="#94A3B8" strokeWidth={1} />
        </svg>
        {hover !== null && (
          <div className="absolute top-1 pointer-events-none bg-[#0C1D4D] text-white text-[11px] rounded-lg px-3 py-2 shadow-lg" style={{ left: Math.min(padL + hover * larguraCat + larguraCat, W - 150) }}>
            <p className="font-black mb-0.5">{categorias[hover]}</p>
            {series.map(s => <p key={s.nome} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: s.cor }}></span>{s.nome}: <strong>{formatar(s.valores[hover] || 0)}</strong></p>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Barras horizontais (ranking, 1 série) com o valor ao lado. */
export function GraficoRanking({ titulo, itens, formatar }: { titulo: string; itens: { rotulo: string; valor: number }[]; formatar: (v: number) => string }) {
  const max = Math.max(1, ...itens.map(i => i.valor));
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
      <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">{titulo}</h3>
      {!itens.length && <p className="text-xs text-gray-400">Sem dados no período.</p>}
      <div className="space-y-1.5">
        {itens.map(i => (
          <div key={i.rotulo} className="grid grid-cols-[minmax(90px,180px)_1fr_auto] items-center gap-2 group" title={`${i.rotulo}: ${formatar(i.valor)}`}>
            <span className="text-[11px] text-gray-600 truncate">{i.rotulo}</span>
            <div className="h-3.5 bg-[#F1F5F9] rounded-r"><div className="h-full rounded-r group-hover:opacity-80" style={{ width: `${Math.max(1, (i.valor / max) * 100)}%`, background: SERIE_1 }}></div></div>
            <span className="text-[11px] font-bold text-[#0C1D4D] whitespace-nowrap">{formatar(i.valor)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tabela
export interface Coluna<T> { chave: keyof T & string; titulo: string; direita?: boolean; formato?: (v: any, linha: T) => string; peso?: number }
export function Tabela<T extends Record<string, any>>({ titulo, colunas, linhas, rodape, vazio, limite = 100 }: {
  titulo: string; colunas: Coluna<T>[]; linhas: T[]; rodape?: Partial<Record<keyof T & string, string>>; vazio?: string; limite?: number;
}) {
  const [ordem, setOrdem] = useState<{ chave: string; desc: boolean } | null>(null);
  const [tudo, setTudo] = useState(false);
  const ordenadas = useMemo(() => {
    if (!ordem) return linhas;
    return [...linhas].sort((a, b) => {
      const x = a[ordem.chave], y = b[ordem.chave];
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR');
      return ordem.desc ? -r : r;
    });
  }, [linhas, ordem]);
  const visiveis = tudo ? ordenadas : ordenadas.slice(0, limite);
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
      <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">{titulo} <span className="text-gray-400 font-bold normal-case">({linhas.length})</span></h3>
      {!linhas.length ? <p className="text-xs text-gray-400">{vazio || 'Sem dados no período.'}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                {colunas.map(c => (
                  <th key={c.chave} className={`p-2 cursor-pointer select-none whitespace-nowrap ${c.direita ? 'text-right' : ''}`}
                    onClick={() => setOrdem(o => (o?.chave === c.chave ? { chave: c.chave, desc: !o.desc } : { chave: c.chave, desc: true }))}>
                    {c.titulo}{ordem?.chave === c.chave ? (ordem.desc ? ' ▾' : ' ▴') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l, i) => (
                <tr key={i} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC]">
                  {colunas.map(c => <td key={c.chave} className={`p-2 ${c.direita ? 'text-right whitespace-nowrap' : ''}`}>{c.formato ? c.formato(l[c.chave], l) : String(l[c.chave] ?? '—')}</td>)}
                </tr>
              ))}
            </tbody>
            {rodape && (
              <tfoot>
                <tr className="border-t-2 border-[#0C1D4D] font-black text-[#0C1D4D]">
                  {colunas.map(c => <td key={c.chave} className={`p-2 ${c.direita ? 'text-right whitespace-nowrap' : ''}`}>{rodape[c.chave] ?? ''}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
          {linhas.length > limite && <button onClick={() => setTudo(v => !v)} className="mt-2 text-[10px] font-black uppercase text-[#336699] hover:underline">{tudo ? 'Mostrar menos' : `Mostrar todas (${linhas.length})`}</button>}
        </div>
      )}
    </div>
  );
}

/** Converte uma tabela da tela em tabela do PDF / aba do Excel. */
export function paraExportar<T extends Record<string, any>>(titulo: string, colunas: Coluna<T>[], linhas: T[], rodape?: Partial<Record<string, string>>) {
  return {
    titulo,
    colunas: colunas.map(c => ({ titulo: c.titulo, direita: c.direita, peso: c.peso })),
    linhas: linhas.map(l => colunas.map(c => (c.formato ? c.formato(l[c.chave], l) : String(l[c.chave] ?? '')))),
    rodape: rodape ? colunas.map(c => rodape[c.chave] ?? '') : undefined,
    bruto: linhas.map(l => Object.fromEntries(colunas.map(c => [c.titulo, l[c.chave] ?? '']))),
  };
}
export type TabelaExport = ReturnType<typeof paraExportar>;

function abrirBase64(base64: string, nome: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new File([bytes], nome, { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function BotoesExportar({ nome, accessToken, montar, avisar }: {
  nome: string; accessToken: string; avisar: (m: string, t: 'error' | 'success' | 'info') => void;
  montar: () => { titulo: string; subtitulo: string; indicadores: DadosRelatorioPdf['indicadores']; tabelas: TabelaExport[] } | null;
}) {
  const [gerando, setGerando] = useState(false);
  const excel = () => {
    const d = montar(); if (!d) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.indicadores.map(k => ({ Indicador: k.rotulo, Valor: k.valor, Detalhe: k.detalhe || '' }))), 'Resumo');
    d.tabelas.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t.bruto), `${i + 1} ${t.titulo}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
    XLSX.writeFile(wb, `${nome}.xlsx`);
  };
  const pdf = async () => {
    const d = montar(); if (!d) return;
    setGerando(true);
    const r = await relatorioPdfAction({ titulo: d.titulo, subtitulo: d.subtitulo, indicadores: d.indicadores, tabelas: d.tabelas.map(({ bruto: _b, ...t }) => t) }, accessToken);
    setGerando(false);
    if (!r.ok) return avisar(r.erro || 'Erro ao gerar o PDF.', 'error');
    abrirBase64(r.info.base64, `${nome}.pdf`);
  };
  const btn = 'px-4 py-2.5 rounded-lg font-black text-xs uppercase tracking-wider border shadow-sm';
  return (
    <>
      <button onClick={excel} className={`${btn} bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100`}>⬇ Excel</button>
      <button onClick={pdf} disabled={gerando} className={`${btn} bg-white text-[#0C1D4D] border-[#CBD5E1] hover:bg-gray-50 disabled:opacity-50`}>{gerando ? 'Gerando…' : '🖨 PDF'}</button>
    </>
  );
}

export function TelaRelatorio({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">{children}</div>;
}

// ---------------------------------------------------------------- gancho comum

type AcaoRelatorio = (f: Filtros, token: string) => Promise<{ ok: boolean; erro?: string; info?: any }>;

/** Acesso + filtros (padrão: este ano) + carregamento do relatório. */
export function useRelatorio(rota: string, acao: AcaoRelatorio) {
  const toast = useToast();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota });
  const [filtros, setFiltros] = useState<Filtros>({ ...periodoPreset('ano'), empresaId: null, vendedorId: null });
  const [info, setInfo] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let vivo = true;
    setCarregando(true);
    acao(filtros, accessToken).then(r => {
      if (!vivo) return;
      setCarregando(false);
      if (r.ok) { setInfo(r.info); setFalha(null); } else setFalha(r.erro || 'Erro ao carregar o relatório.');
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, filtros.de, filtros.ate, filtros.empresaId, filtros.vendedorId]);

  let bloqueio: ReactNode = null;
  if (authLoading) bloqueio = <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div></div>;
  else if (erro) bloqueio = <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  else if (acessoNegado) bloqueio = <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md border border-red-200"><div className="text-5xl mb-3">⛔</div><p className="text-sm text-gray-600 mb-4">Você não tem acesso a este relatório.</p><Link href="/admin/relatorios" className="text-xs font-black uppercase text-[#336699]">Voltar aos relatórios</Link></div></div>;

  const subtitulo = (empresas: { id: number; nome: string }[]) =>
    `${dataBR(filtros.de)} a ${dataBR(filtros.ate)} · ${filtros.empresaId ? empresas.find(e => e.id === filtros.empresaId)?.nome || '' : 'todas as empresas'}`;
  const avisar = (m: string, t: 'error' | 'success' | 'info') => toast(m, t);
  return { bloqueio, filtros, setFiltros, info, carregando, falha, accessToken, subtitulo, avisar };
}
