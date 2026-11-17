"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { agendaAction } from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarDataBR } from '../../../lib/formatadores';
import { somarDias } from '../../../lib/locacao/datas';
import { STATUS_FICHA, numeroFicha } from '../reservas/statusFicha';

// Agenda de disponibilidade (2026-11-17): uma linha por equipamento, uma
// coluna por dia; a célula mostra quanto sobra LIVRE (estoque − reservado).
// Ocupação = fichas do P2S importadas (aprovadas/em locação) + fichas daqui
// reservadas, com dias de preparo/retorno de cada produto.

interface Produto {
  produto_id: number; nome: string; codigo: string | null; controle: 'INDIVIDUAL' | 'QUANTIDADE';
  capacidade: number; ocupacao: number[]; categoria: string | null; unidade: string | null;
  alocacoes: { ficha_id: number; quantidade: number; inicio: string; fim: string }[];
}
interface FichaRef {
  id: number; status: keyof typeof STATUS_FICHA; origem: 'SISTEMA' | 'P2S'; p2s_numero: string | null; p2s_status: string | null;
  data_inicio: string; data_fim: string; cliente: string; evento: string | null;
}

const PERIODOS = [14, 30, 60, 90];
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const diaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

function corCelula(ocup: number, cap: number): string {
  if (ocup <= 0) return '';
  const livre = cap - ocup;
  if (livre < 0) return 'bg-red-500 text-white font-black';
  if (livre === 0) return 'bg-orange-400 text-white font-black';
  const uso = cap > 0 ? ocup / cap : 1;
  if (uso >= 0.75) return 'bg-amber-300 text-amber-900 font-bold';
  if (uso >= 0.4) return 'bg-amber-100 text-amber-800 font-bold';
  return 'bg-emerald-100 text-emerald-800 font-bold';
}

export default function AgendaPage() {
  const router = useRouter();
  const toast = useToast();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [inicio, setInicio] = useState(hojeISO());
  const [periodo, setPeriodo] = useState(30);
  const [dias, setDias] = useState<string[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [fichas, setFichas] = useState<Record<number, FichaRef>>({});
  const [ultimaImportacao, setUltimaImportacao] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [soComReserva, setSoComReserva] = useState(true);
  const [soConflito, setSoConflito] = useState(false);
  const [detalhe, setDetalhe] = useState<{ produto: Produto; dia: string | null } | null>(null);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let cancelado = false;
    (async () => {
      setCarregando(true);
      const r = await agendaAction({ empresa_id: empresaId, inicio, dias: periodo }, accessToken);
      if (cancelado) return;
      if (r.ok) {
        setEmpresas(r.info.empresas); setDias(r.info.dias); setProdutos(r.info.produtos); setFichas(r.info.fichas);
        setUltimaImportacao(r.info.ultimaImportacaoP2s);
        if (r.info.empresaId && r.info.empresaId !== empresaId) setEmpresaId(r.info.empresaId);
      } else toast(r.erro || 'Erro ao carregar a agenda.', 'error');
      setCarregando(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, empresaId, inicio, periodo]);

  const categorias = useMemo(() => [...new Set(produtos.map(p => p.categoria).filter(Boolean) as string[])].sort(), [produtos]);
  const temConflito = (p: Produto) => p.ocupacao.some(o => o > p.capacidade);
  const temReserva = (p: Produto) => p.ocupacao.some(o => o > 0);

  const visiveis = produtos.filter(p => {
    if (soComReserva && !temReserva(p)) return false;
    if (soConflito && !temConflito(p)) return false;
    if (categoria && p.categoria !== categoria) return false;
    const t = busca.trim().toLowerCase();
    if (t && ![p.nome, p.codigo, p.categoria].some(x => (x || '').toLowerCase().includes(t))) return false;
    return true;
  });

  const comConflito = produtos.filter(temConflito);
  const diasConflito = produtos.reduce((s, p) => s + p.ocupacao.filter(o => o > p.capacidade).length, 0);
  const fichasNoPeriodo = new Set(produtos.flatMap(p => p.alocacoes.map(a => a.ficha_id))).size;
  const hoje = hojeISO();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Agenda de Disponibilidade.</p>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const fichasDoDetalhe = detalhe
    ? detalhe.produto.alocacoes.filter(a => !detalhe.dia || (a.inicio <= detalhe.dia && a.fim >= detalhe.dia))
    : [];
  const rotuloFicha = (f?: FichaRef, id?: number) => (f?.origem === 'P2S' ? `P2S ${f.p2s_numero}` : numeroFicha(f?.id || id || 0));

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">📅 <strong>Olá, {usuarioAtual}</strong>. Agenda de disponibilidade dos equipamentos.</p>
        <button onClick={() => router.push('/admin/locacoes')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[1800px] mx-auto space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button onClick={() => { setSoConflito(true); setSoComReserva(true); }}
              className={`text-left bg-white p-4 rounded-2xl border shadow-sm ${comConflito.length ? 'border-red-200 hover:border-red-400' : 'border-[#E2E8F0]'}`}>
              <p className={`text-2xl font-black ${comConflito.length ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{carregando ? '—' : comConflito.length}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Equipamentos com falta</p>
              <p className="text-[10px] text-gray-400 mt-1">{carregando ? '' : `${diasConflito} dia(s)-equipamento acima do estoque`}</p>
            </button>
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
              <p className="text-2xl font-black text-[#0C1D4D]">{carregando ? '—' : produtos.filter(temReserva).length}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Equipamentos reservados</p>
              <p className="text-[10px] text-gray-400 mt-1">{carregando ? '' : `de ${produtos.length} com estoque/reserva`}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
              <p className="text-2xl font-black text-[#0C1D4D]">{carregando ? '—' : fichasNoPeriodo}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Fichas ocupando o período</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
              <p className="text-xs font-black text-[#0C1D4D] mt-1">{ultimaImportacao ? new Date(ultimaImportacao).toLocaleString('pt-BR') : '—'}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Última importação do P2S</p>
              <p className="text-[10px] text-gray-400 mt-1">automática às 11h e 17h</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
            <div className="flex flex-wrap items-center gap-2">
              {empresas.length > 1 && empresas.map(e => (
                <button key={e.id} onClick={() => setEmpresaId(e.id)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${empresaId === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>
              ))}
              <div className="flex items-center gap-1 ml-1">
                <button onClick={() => setInicio(somarDias(inicio, -periodo))} className="px-2 py-1.5 rounded-lg border border-[#CBD5E1] text-xs font-black text-[#0C1D4D]" title="Período anterior">◀</button>
                <input type="date" value={inicio} onChange={e => e.target.value && setInicio(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs" />
                <button onClick={() => setInicio(somarDias(inicio, periodo))} className="px-2 py-1.5 rounded-lg border border-[#CBD5E1] text-xs font-black text-[#0C1D4D]" title="Próximo período">▶</button>
                <button onClick={() => setInicio(hojeISO())} className="px-2 py-1.5 rounded-lg border border-[#CBD5E1] text-[10px] font-black uppercase text-gray-500">Hoje</button>
              </div>
              <div className="flex rounded-lg border border-[#CBD5E1] overflow-hidden">
                {PERIODOS.map(p => (
                  <button key={p} onClick={() => setPeriodo(p)} className={`px-2.5 py-1.5 text-[10px] font-black ${periodo === p ? 'bg-[#0C1D4D] text-white' : 'bg-white text-gray-500'}`}>{p}d</button>
                ))}
              </div>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar equipamento..."
                className="border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs w-52 focus:outline-none focus:border-[#336699]" />
              <select value={categoria} onChange={e => setCategoria(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs font-bold text-[#0C1D4D] max-w-[180px]">
                <option value="">Todas as categorias</option>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-[10px] font-black uppercase text-gray-500"><input type="checkbox" checked={soComReserva} onChange={e => setSoComReserva(e.target.checked)} />Só reservados</label>
              <label className="flex items-center gap-1.5 text-[10px] font-black uppercase text-red-600"><input type="checkbox" checked={soConflito} onChange={e => setSoConflito(e.target.checked)} />Só com falta</label>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-gray-500">
              <span className="font-black uppercase">Célula = quanto sobra livre:</span>
              <span className="flex items-center gap-1"><span className="w-4 h-3 rounded bg-emerald-100 border border-emerald-200" />pouco uso</span>
              <span className="flex items-center gap-1"><span className="w-4 h-3 rounded bg-amber-100" />40%+</span>
              <span className="flex items-center gap-1"><span className="w-4 h-3 rounded bg-amber-300" />75%+</span>
              <span className="flex items-center gap-1"><span className="w-4 h-3 rounded bg-orange-400" />esgotado (0)</span>
              <span className="flex items-center gap-1"><span className="w-4 h-3 rounded bg-red-500" />falta (negativo)</span>
              <span>· vazio = nada reservado · clique na célula para ver as fichas</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            {carregando ? (
              <p className="text-sm text-gray-400 py-10 text-center">Carregando agenda...</p>
            ) : visiveis.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center">Nenhum equipamento com esses filtros no período.</p>
            ) : (
              <div className="overflow-auto max-h-[70vh]">
                <table className="text-[10px] border-separate border-spacing-0">
                  <thead className="sticky top-0 z-20">
                    <tr>
                      <th className="sticky left-0 z-30 bg-white border-b border-r border-[#E2E8F0] p-2 text-left min-w-[260px] text-[10px] font-black text-gray-500 uppercase">Equipamento · estoque</th>
                      {dias.map(d => {
                        const ds = diaSemana(d), fds = ds === 0 || ds === 6;
                        return (
                          <th key={d} className={`border-b border-[#E2E8F0] px-0.5 py-1 min-w-[34px] text-center font-bold ${d === hoje ? 'bg-[#0C1D4D] text-white' : fds ? 'bg-slate-100 text-gray-500' : 'bg-white text-gray-500'}`}>
                            <div className="text-[8px]">{SEMANA[ds]}</div>
                            <div>{d.slice(8, 10)}</div>
                            {(d.slice(8, 10) === '01' || d === dias[0]) && <div className="text-[7px] uppercase">{['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(d.slice(5, 7)) - 1]}</div>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map(p => (
                      <tr key={p.produto_id} className="group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-[#F8FAFC] border-b border-r border-[#F1F5F9] p-1.5">
                          <button onClick={() => setDetalhe({ produto: p, dia: null })} className="text-left w-full">
                            <p className={`font-bold text-[11px] leading-tight truncate max-w-[250px] ${temConflito(p) ? 'text-red-600' : 'text-[#0C1D4D]'}`} title={p.nome}>{p.nome}</p>
                            <p className="text-[9px] text-gray-400 truncate max-w-[250px]">
                              {[p.codigo, `estoque ${fmt(p.capacidade)}${p.unidade ? ` ${p.unidade}` : ''}`, p.controle === 'INDIVIDUAL' ? 'patrimônio' : null].filter(Boolean).join(' · ')}
                            </p>
                          </button>
                        </td>
                        {p.ocupacao.map((o, i) => {
                          const d = dias[i];
                          const ds = diaSemana(d);
                          const livre = p.capacidade - o;
                          return (
                            <td key={d} onClick={() => o > 0 && setDetalhe({ produto: p, dia: d })}
                              title={o > 0 ? `${formatarDataBR(d)}: ${fmt(o)} reservado(s) de ${fmt(p.capacidade)} — ${livre < 0 ? `FALTAM ${fmt(-livre)}` : `${fmt(livre)} livre(s)`}` : `${formatarDataBR(d)}: livre (${fmt(p.capacidade)})`}
                              className={`border-b border-[#F1F5F9] text-center h-8 ${o > 0 ? 'cursor-pointer hover:ring-2 hover:ring-[#336699] hover:ring-inset' : ''} ${corCelula(o, p.capacidade) || (ds === 0 || ds === 6 ? 'bg-slate-50' : '')} ${d === hoje ? 'border-x-2 border-x-[#0C1D4D]/30' : ''}`}>
                              {o > 0 ? fmt(livre) : ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!carregando && visiveis.length > 0 && (
              <p className="text-[10px] text-gray-400 px-4 py-2 border-t border-[#F1F5F9]">
                {visiveis.length} equipamento(s) · {formatarDataBR(dias[0])} a {formatarDataBR(dias[dias.length - 1])}. Estoque = saldo menos manutenção (ou patrimônios ativos). O período de cada reserva já inclui os dias de preparo e retorno do equipamento.
              </p>
            )}
          </div>
        </div>
      </div>

      <Modal open={!!detalhe} onClose={() => setDetalhe(null)} maxWidthClassName="max-w-3xl"
        title={detalhe ? `${detalhe.produto.nome}${detalhe.dia ? ` · ${formatarDataBR(detalhe.dia)}` : ''}` : ''}>
        {detalhe && (
          <>
            <div className="flex flex-wrap gap-4 text-xs">
              <span>Estoque: <strong>{fmt(detalhe.produto.capacidade)}</strong></span>
              {detalhe.dia && (() => {
                const o = detalhe.produto.ocupacao[dias.indexOf(detalhe.dia)] || 0;
                const livre = detalhe.produto.capacidade - o;
                return <>
                  <span>Reservado no dia: <strong>{fmt(o)}</strong></span>
                  <span className={livre < 0 ? 'text-red-600 font-black' : 'text-emerald-700 font-bold'}>{livre < 0 ? `Faltam ${fmt(-livre)}` : `Livre: ${fmt(livre)}`}</span>
                </>;
              })()}
              {!detalhe.dia && <span className="text-gray-500">Todas as reservas no período mostrado</span>}
            </div>
            {fichasDoDetalhe.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma reserva.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                    <th className="p-2">Ficha</th><th className="p-2">Cliente / evento</th><th className="p-2">Na agenda</th><th className="p-2 text-right">Qtd</th><th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fichasDoDetalhe.map(a => {
                    const f = fichas[a.ficha_id];
                    return (
                      <tr key={a.ficha_id} onClick={() => router.push(`/admin/locacoes/reservas/${a.ficha_id}`)} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer">
                        <td className="p-2 font-black text-[#0C1D4D] whitespace-nowrap">
                          {f?.origem === 'P2S' && <span className="text-[8px] font-black px-1 py-0.5 rounded bg-orange-100 text-orange-700 mr-1">P2S</span>}
                          {rotuloFicha(f, a.ficha_id)}
                        </td>
                        <td className="p-2"><p className="font-bold">{f?.cliente || '—'}</p>{f?.evento && <p className="text-[10px] text-gray-500">{f.evento}</p>}</td>
                        <td className="p-2 whitespace-nowrap">{formatarDataBR(a.inicio)} a {formatarDataBR(a.fim)}</td>
                        <td className="p-2 text-right font-black">{fmt(a.quantidade)}</td>
                        <td className="p-2">{f && <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${STATUS_FICHA[f.status]?.cls}`}>{STATUS_FICHA[f.status]?.rotulo}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-gray-400">"Na agenda" já inclui preparo e retorno. Clique na ficha para abrir.</p>
          </>
        )}
      </Modal>
    </div>
  );
}
