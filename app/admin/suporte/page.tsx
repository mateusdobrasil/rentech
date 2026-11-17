"use client";

// Suporte e Chamados (2026-11-17) — abrir e acompanhar chamados; fila da área
// para os atendentes; visão geral para quem tem a gestão (/admin/suporte/areas).
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';
import { useToast } from '../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../lib/coresEmpresa';
import { PRIORIDADES, STATUS, STATUS_EM_ABERTO, ROTA_SUPORTE_AREAS } from '../../lib/suporte/constantes';
import { painelSuporteAction } from './actions';
import NovoChamado from './NovoChamado';
import DetalheChamado from './DetalheChamado';
import { dataHora, situacaoPrazo, type AreaSuporte, type ChamadoLista } from './tipos';

type Aba = 'MEUS' | 'FILA' | 'TODOS';
type FiltroStatus = 'ABERTOS' | 'RESOLVIDOS' | 'ENCERRADOS' | 'TODOS';
const ORDEM_PRIO: Record<string, number> = { URGENTE: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 };

export default function SuportePage() {
  const router = useRouter();
  const toast = useToast();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [carregando, setCarregando] = useState(true);
  const [eu, setEu] = useState<{ id: string; nome: string } | null>(null);
  const [gestor, setGestor] = useState(false);
  const [minhasAreas, setMinhasAreas] = useState<number[]>([]);
  const [areas, setAreas] = useState<AreaSuporte[]>([]);
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [chamados, setChamados] = useState<ChamadoLista[]>([]);
  const [aba, setAba] = useState<Aba>('MEUS');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('ABERTOS');
  const [filtroArea, setFiltroArea] = useState<number | 'TODAS'>('TODAS');
  const [soMeus, setSoMeus] = useState(false);
  const [busca, setBusca] = useState('');
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = async (primeira = false) => {
    const r = await painelSuporteAction(accessToken);
    setCarregando(false);
    if (!r.ok) { toast(r.erro || 'Erro ao carregar os chamados.', 'error'); return; }
    const i = r.info;
    setEu(i.eu); setGestor(i.gestor); setMinhasAreas(i.minhasAreas); setAreas(i.areas); setEmpresas(i.empresas); setChamados(i.chamados);
    if (primeira) {
      const atende = i.minhasAreas.length > 0;
      if (atende) setAba('FILA');
      if (atende && i.minhasAreas.length === 1) setFiltroArea(i.minhasAreas[0]);
    }
  };

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    carregar(true);
    // link direto do aviso: /admin/suporte?chamado=123 (sem useSearchParams → sem Suspense)
    const id = Number(new URLSearchParams(window.location.search).get('chamado'));
    if (id > 0) setAberto(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado]);

  // atualiza a lista a cada 60s com a aba visível
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, accessToken]);

  const abrir = (id: number | null) => {
    setAberto(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('chamado', String(id)); else url.searchParams.delete('chamado');
    window.history.replaceState(null, '', url.toString());
  };

  const areaPor = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas]);
  const atendeAlguma = minhasAreas.length > 0;

  const daAba = useMemo(() => chamados.filter(c =>
    aba === 'MEUS' ? c.sou_solicitante
      : aba === 'FILA' ? minhasAreas.includes(c.area_id)
        : true), [chamados, aba, minhasAreas]);

  const contadores = useMemo(() => {
    const abertos = (l: ChamadoLista[]) => l.filter(c => STATUS_EM_ABERTO.includes(c.status));
    const fila = chamados.filter(c => minhasAreas.includes(c.area_id));
    return {
      meusAbertos: abertos(chamados.filter(c => c.sou_solicitante)).length,
      meusParaAvaliar: chamados.filter(c => c.sou_solicitante && c.status === 'RESOLVIDO').length,
      semResponsavel: fila.filter(c => c.status === 'ABERTO' && !c.responsavel_id).length,
      comigo: abertos(fila.filter(c => c.responsavel_id === eu?.id)).length,
      atrasados: abertos(aba === 'TODOS' ? chamados : fila).filter(c => situacaoPrazo(c)?.atrasado).length,
      naoLidosMeus: chamados.filter(c => c.sou_solicitante && c.nao_lido).length,
      naoLidosFila: fila.filter(c => c.nao_lido).length,
    };
  }, [chamados, minhasAreas, eu, aba]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return daAba
      .filter(c => filtroStatus === 'TODOS' ? true
        : filtroStatus === 'ABERTOS' ? STATUS_EM_ABERTO.includes(c.status)
          : filtroStatus === 'RESOLVIDOS' ? c.status === 'RESOLVIDO'
            : ['FECHADO', 'CANCELADO'].includes(c.status))
      .filter(c => aba === 'MEUS' || filtroArea === 'TODAS' || c.area_id === filtroArea)
      .filter(c => !soMeus || c.responsavel_id === eu?.id)
      .filter(c => !termo || `#${c.id} ${c.titulo} ${c.solicitante_nome} ${c.responsavel_nome || ''} ${c.categoria || ''}`.toLowerCase().includes(termo))
      .sort((a, b) => {
        if (filtroStatus === 'ABERTOS' && aba !== 'MEUS') {
          const pa = ORDEM_PRIO[a.prioridade] - ORDEM_PRIO[b.prioridade];
          if (pa) return pa;
          return new Date(a.prazo_em || 0).getTime() - new Date(b.prazo_em || 0).getTime();
        }
        return new Date(b.ultima_interacao_em).getTime() - new Date(a.ultima_interacao_em).getTime();
      });
  }, [daAba, filtroStatus, filtroArea, soMeus, busca, aba, eu]);

  if (authLoading || (carregando && !acessoNegado && !erro)) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Suporte e Chamados.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">Voltar ao Início</button>
        </div>
      </div>
    );
  }

  const abas: { id: Aba; rotulo: string; badge: number; visivel: boolean }[] = [
    { id: 'MEUS', rotulo: 'Meus chamados', badge: contadores.naoLidosMeus, visivel: true },
    { id: 'FILA', rotulo: minhasAreas.length === 1 ? `Fila · ${areaPor.get(minhasAreas[0])?.nome || ''}` : 'Fila das minhas áreas', badge: contadores.naoLidosFila, visivel: atendeAlguma },
    { id: 'TODOS', rotulo: 'Todos', badge: 0, visivel: gestor },
  ];
  const areasDoFiltro = aba === 'FILA' ? areas.filter(a => minhasAreas.includes(a.id)) : areas;

  return (
    <div className="min-h-screen bg-[#F0F4F8] text-[#0C1D4D] font-sans pt-12 pb-4 px-4">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">🛟 Suporte e Chamados</h1>
            <p className="text-[#64748B] font-medium">Peça ajuda para TI, Financeiro, Operacional e as outras áreas — e acompanhe cada pedido até a solução.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {gestor && (
              <button onClick={() => router.push(ROTA_SUPORTE_AREAS)} className="bg-white border border-[#CBD5E1] hover:border-[#336699] text-[#475569] px-4 py-3 rounded-lg font-black uppercase text-xs tracking-wider transition-colors">⚙️ Áreas e atendentes</button>
            )}
            <button onClick={() => setNovo(true)} className="bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-3 rounded-lg font-black uppercase text-xs tracking-wider shadow-sm transition-colors">+ Abrir chamado</button>
          </div>
        </div>

        {/* indicadores */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {aba === 'MEUS' ? (<>
            <Indicador rotulo="Meus em aberto" valor={contadores.meusAbertos} />
            <Indicador rotulo="Para avaliar" valor={contadores.meusParaAvaliar} destaque={contadores.meusParaAvaliar > 0 ? 'emerald' : undefined} onClick={() => setFiltroStatus('RESOLVIDOS')} />
            <Indicador rotulo="Com novidade" valor={contadores.naoLidosMeus} destaque={contadores.naoLidosMeus > 0 ? 'blue' : undefined} />
            <Indicador rotulo="Total aberto por mim" valor={chamados.filter(c => c.sou_solicitante).length} />
          </>) : (<>
            <Indicador rotulo="Sem responsável" valor={contadores.semResponsavel} destaque={contadores.semResponsavel > 0 ? 'blue' : undefined} onClick={() => { setFiltroStatus('ABERTOS'); setSoMeus(false); }} />
            <Indicador rotulo="Comigo" valor={contadores.comigo} onClick={() => { setFiltroStatus('ABERTOS'); setSoMeus(true); }} />
            <Indicador rotulo="Atrasados" valor={contadores.atrasados} destaque={contadores.atrasados > 0 ? 'red' : undefined} />
            <Indicador rotulo="Em aberto" valor={daAba.filter(c => STATUS_EM_ABERTO.includes(c.status)).length} />
          </>)}
        </div>

        {/* abas + filtros */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm">
          <div className="flex overflow-x-auto border-b border-[#E2E8F0] px-2">
            {abas.filter(a => a.visivel).map(a => (
              <button key={a.id} onClick={() => { setAba(a.id); setSoMeus(false); if (a.id !== 'FILA') setFiltroArea('TODAS'); else if (minhasAreas.length === 1) setFiltroArea(minhasAreas[0]); }}
                className={`relative whitespace-nowrap px-4 py-3.5 text-xs font-black uppercase tracking-wider transition-colors ${aba === a.id ? 'text-[#0C1D4D]' : 'text-[#94A3B8] hover:text-[#475569]'}`}>
                {a.rotulo}
                {a.badge > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#336699] text-white text-[10px]">{a.badge}</span>}
                {aba === a.id && <span className="absolute left-3 right-3 -bottom-px h-[3px] rounded-full bg-[#0C1D4D]" />}
              </button>
            ))}
          </div>

          <div className="p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número, assunto, pessoa…"
              className="flex-1 min-w-0 border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]" />
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-lg border border-[#CBD5E1] overflow-hidden text-[11px] font-black uppercase">
                {(['ABERTOS', 'RESOLVIDOS', 'ENCERRADOS', 'TODOS'] as FiltroStatus[]).map(s => (
                  <button key={s} onClick={() => setFiltroStatus(s)} className={`px-3 py-2 ${filtroStatus === s ? 'bg-[#0C1D4D] text-white' : 'bg-white text-[#64748B] hover:bg-[#F1F5F9]'}`}>
                    {s === 'ABERTOS' ? 'Em aberto' : s === 'RESOLVIDOS' ? 'Resolvidos' : s === 'ENCERRADOS' ? 'Encerrados' : 'Todos'}
                  </button>
                ))}
              </div>
              {aba !== 'MEUS' && areasDoFiltro.length > 1 && (
                <select value={filtroArea} onChange={e => setFiltroArea(e.target.value === 'TODAS' ? 'TODAS' : Number(e.target.value))}
                  className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold bg-white">
                  <option value="TODAS">Todas as áreas</option>
                  {areasDoFiltro.map(a => <option key={a.id} value={a.id}>{a.icone} {a.nome}</option>)}
                </select>
              )}
              {aba !== 'MEUS' && (
                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-[#475569] px-2 cursor-pointer">
                  <input type="checkbox" checked={soMeus} onChange={e => setSoMeus(e.target.checked)} /> Só comigo
                </label>
              )}
            </div>
          </div>

          {/* lista */}
          {lista.length === 0 ? (
            <div className="px-6 pb-12 pt-6 text-center">
              <div className="text-4xl mb-2">{aba === 'MEUS' ? '🙌' : '✨'}</div>
              <p className="text-sm font-bold text-[#64748B]">
                {aba === 'MEUS' && chamados.filter(c => c.sou_solicitante).length === 0 ? 'Você ainda não abriu nenhum chamado.' : 'Nada por aqui com esses filtros.'}
              </p>
              {aba === 'MEUS' && <button onClick={() => setNovo(true)} className="mt-4 text-xs font-black uppercase tracking-wider text-[#336699] hover:text-[#0C1D4D]">+ Abrir chamado</button>}
            </div>
          ) : (
            <ul className="divide-y divide-[#F1F5F9]">
              {lista.map(c => {
                const area = areaPor.get(c.area_id);
                const prio = PRIORIDADES.find(p => p.valor === c.prioridade);
                const prazo = situacaoPrazo(c);
                const emp = c.empresa_id ? empresas.find(e => e.id === c.empresa_id) : null;
                return (
                  <li key={c.id}>
                    <button onClick={() => abrir(c.id)} className="w-full text-left px-4 py-3.5 hover:bg-[#F8FAFC] transition-colors flex gap-3 items-start">
                      <span className="w-1.5 self-stretch rounded-full shrink-0" style={{ background: area?.cor || '#CBD5E1' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {c.nao_lido && <span className="w-2 h-2 rounded-full bg-[#336699] shrink-0" title="Novidade" />}
                          <span className="text-[11px] font-black text-[#94A3B8] shrink-0">#{c.id}</span>
                          <span className={`truncate text-sm ${c.nao_lido ? 'font-black text-[#0C1D4D]' : 'font-bold text-[#334155]'}`}>{c.titulo}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-[#64748B]">
                          <span className="font-bold">{area?.icone} {area?.nome || '—'}{c.categoria ? ` · ${c.categoria}` : ''}</span>
                          {aba !== 'MEUS' && <span>de <strong className="text-[#475569]">{c.solicitante_nome}</strong></span>}
                          <span>{c.responsavel_nome ? <>com <strong className="text-[#475569]">{c.responsavel_nome}</strong></> : <em className="text-[#94A3B8]">na fila</em>}</span>
                          <span>{dataHora(c.ultima_interacao_em)}</span>
                          {emp && <span className={`px-1.5 py-0.5 rounded font-black uppercase text-[9px] ${corSeloEmpresa(emp.id)}`}>{emp.nome}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex gap-1">
                          {prio && <span className={`hidden sm:inline text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${prio.cor}`}>{prio.rotulo}</span>}
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${STATUS[c.status]?.cor}`}>{STATUS[c.status]?.rotulo}</span>
                        </div>
                        {prazo && <span className={`text-[10px] ${prazo.cor}`}>{prazo.texto}</span>}
                        {c.avaliacao && <span className="text-[10px] text-amber-500">{'★'.repeat(c.avaliacao)}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <HubBackButton />
      </div>

      <NovoChamado aberto={novo} onFechar={() => setNovo(false)} areas={areas} empresas={empresas} accessToken={accessToken}
        onCriado={id => { setNovo(false); setAba('MEUS'); setFiltroStatus('ABERTOS'); carregar(); abrir(id); }} />
      <DetalheChamado id={aberto} onFechar={() => abrir(null)} onMudou={() => carregar()} areas={areas} empresas={empresas} euId={eu?.id || ''} accessToken={accessToken} />
    </div>
  );
}

function Indicador({ rotulo, valor, destaque, onClick }: { rotulo: string; valor: number; destaque?: 'red' | 'blue' | 'emerald'; onClick?: () => void }) {
  const cores = { red: 'border-red-300 text-red-600', blue: 'border-[#336699] text-[#336699]', emerald: 'border-emerald-400 text-emerald-600' };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`text-left bg-white rounded-xl border-2 px-4 py-3 shadow-sm ${destaque ? cores[destaque] : 'border-transparent text-[#0C1D4D]'} ${onClick ? 'hover:shadow-md transition-shadow' : ''}`}>
      <div className="text-2xl font-black leading-none">{valor}</div>
      <div className="text-[10px] font-black uppercase tracking-widest text-[#94A3B8] mt-1.5">{rotulo}</div>
    </Tag>
  );
}
