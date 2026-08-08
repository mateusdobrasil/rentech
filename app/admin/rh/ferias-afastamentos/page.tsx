"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import {
  painelFeriasAction, agendarFeriasAction, cancelarAgendamentoFeriasAction
} from '../actions/actions-ferias';
import {
  listarTiposAfastamentoAction, criarTipoAfastamentoAction, painelAfastamentosAction,
  salvarAfastamentoAction, encerrarAfastamentoAction, excluirAfastamentoAction, urlAnexoAfastamentoAction
} from '../actions/actions-afastamentos';

const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

// ============================================================================
// TIPOS
// ============================================================================
interface PeriodoFerias {
  id: number; periodo_aquisitivo_inicio: string; periodo_aquisitivo_fim: string; periodo_concessivo_fim: string;
  data_inicio_gozo: string | null; data_fim_gozo: string | null; dias_gozo: number | null; dias_abono: number;
  status: 'DISPONIVEL' | 'AGENDADA' | 'CANCELADA';
  statusExibicao: 'DISPONIVEL' | 'AGENDADA' | 'EM_GOZO' | 'CONCLUIDA' | 'CANCELADA';
  vencida: boolean; vencendo: boolean; observacao: string | null;
}
interface LinhaFerias { nome: string; cargo: string | null; departamento: string | null; ativo: boolean; periodos: PeriodoFerias[]; temVencida: boolean; temVencendo: boolean; }

interface Afastamento {
  id: number; funcionario_nome: string; tipo_id: number; tipo: string; cargo: string | null;
  data_inicio: string; data_fim: string | null; cid: string | null; observacao: string | null;
  status: 'ATIVO' | 'ENCERRADO'; temAnexo: boolean; dias: number;
}

export default function FeriasAfastamentosPage() {
  const router = useRouter();
  const [aba, setAba] = useState<'ferias' | 'afastamentos'>('ferias');

  // Estados de Autenticação
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil } = await supabase.from('perfis_usuarios').select('*').eq('id', session.user.id).single();
      if (perfil) {
        setUsuarioAtual(perfil.nome || 'Equipe RH');
        const permissaoBanco = String(perfil.permissao || perfil.nivel || '').toUpperCase();
        const cargosAltaGestao = ['DIR', 'DIRETOR', 'ADMINISTRADOR', 'ADMIN', 'FINANCEIRO', 'ADMINISTRATIVO'];
        if (!cargosAltaGestao.includes(permissaoBanco)) { router.push('/admin'); return; }
      } else {
        setUsuarioAtual('Equipe RH');
      }
      setAuthLoading(false);
    }
    checkAuth();
  }, [router]);

  // ==========================================================================
  // ABA FÉRIAS
  // ==========================================================================
  const [loadingFerias, setLoadingFerias] = useState(true);
  const [linhasFerias, setLinhasFerias] = useState<LinhaFerias[]>([]);
  const [totaisFerias, setTotaisFerias] = useState({ funcionarios: 0, vencidas: 0, vencendo: 0, agendadas: 0 });
  const [buscaFerias, setBuscaFerias] = useState('');
  const [filtroFerias, setFiltroFerias] = useState<'TODOS' | 'DISPONIVEL' | 'VENCIDAS' | 'VENCENDO' | 'AGENDADAS'>('TODOS');

  const [modalPeriodo, setModalPeriodo] = useState<{ periodo: PeriodoFerias; nome: string } | null>(null);
  const [fDataInicio, setFDataInicio] = useState('');
  const [fDias, setFDias] = useState('30');
  const [fAbono, setFAbono] = useState('0');
  const [fObs, setFObs] = useState('');
  const [salvandoFerias, setSalvandoFerias] = useState(false);

  const carregarFerias = async () => {
    setLoadingFerias(true);
    try {
      const res = await painelFeriasAction();
      if (res.ok) { setLinhasFerias(res.info.linhas); setTotaisFerias(res.info.totais); }
      else alert('Erro ao carregar férias: ' + res.erro);
    } catch (e: any) { alert('Erro ao carregar férias: ' + e.message); }
    finally { setLoadingFerias(false); }
  };

  useEffect(() => { carregarFerias(); }, []);

  const abrirAgendamento = (nome: string, periodo: PeriodoFerias) => {
    setModalPeriodo({ periodo, nome });
    setFDataInicio(periodo.data_inicio_gozo || '');
    setFDias(String(periodo.dias_gozo || 30));
    setFAbono(String(periodo.dias_abono || 0));
    setFObs(periodo.observacao || '');
  };

  const salvarAgendamento = async () => {
    if (!modalPeriodo) return;
    if (!fDataInicio) { alert('Escolha a data de início.'); return; }
    setSalvandoFerias(true);
    try {
      const res = await agendarFeriasAction({
        id: modalPeriodo.periodo.id, dataInicioGozo: fDataInicio, diasGozo: Number(fDias),
        diasAbono: Number(fAbono), observacao: fObs || null, usuarioNome: usuarioAtual
      });
      if (!res.ok) throw new Error(res.erro);
      setModalPeriodo(null);
      carregarFerias();
    } catch (e: any) { alert('Erro ao agendar: ' + e.message); }
    finally { setSalvandoFerias(false); }
  };

  const cancelarAgendamento = async (periodo: PeriodoFerias) => {
    if (!confirm('Cancelar este agendamento de férias? O período volta a ficar disponível.')) return;
    try {
      const res = await cancelarAgendamentoFeriasAction({ id: periodo.id });
      if (!res.ok) throw new Error(res.erro);
      carregarFerias();
    } catch (e: any) { alert('Erro ao cancelar: ' + e.message); }
  };

  // Um período "combina" com o filtro selecionado — usado tanto pra decidir
  // se o funcionário aparece quanto pra esconder, dentro da linha dele, os
  // períodos que não são do filtro (ex: não misturar Concluída junto de Agendadas).
  const periodoCombinaFiltro = (p: PeriodoFerias, filtro: typeof filtroFerias): boolean => {
    if (p.status === 'CANCELADA') return false;
    if (filtro === 'TODOS') return true;
    if (filtro === 'DISPONIVEL') return p.status === 'DISPONIVEL' && !p.vencida && !p.vencendo;
    if (filtro === 'VENCIDAS') return p.vencida;
    if (filtro === 'VENCENDO') return p.vencendo;
    return p.statusExibicao === 'AGENDADA' || p.statusExibicao === 'EM_GOZO'; // AGENDADAS
  };

  const linhasFeriasFiltradas = useMemo(() => linhasFerias
    .filter(l => l.nome.toLowerCase().includes(buscaFerias.toLowerCase()))
    .filter(l => l.periodos.some(p => periodoCombinaFiltro(p, filtroFerias))),
    [linhasFerias, buscaFerias, filtroFerias]);

  const badgeFerias = (p: PeriodoFerias) => {
    if (p.statusExibicao === 'CANCELADA') return null;
    if (p.vencida) return <span className="text-[9px] font-black bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase">⚠ Vencida</span>;
    if (p.statusExibicao === 'EM_GOZO') return <span className="text-[9px] font-black bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase">🏖 Em gozo</span>;
    if (p.statusExibicao === 'CONCLUIDA') return <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">✓ Concluída</span>;
    if (p.statusExibicao === 'AGENDADA') return <span className="text-[9px] font-black bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full uppercase">📅 Agendada</span>;
    if (p.vencendo) return <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">⏳ Vencendo</span>;
    return <span className="text-[9px] font-black bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">Disponível</span>;
  };

  // ==========================================================================
  // ABA AFASTAMENTOS
  // ==========================================================================
  const [loadingAfast, setLoadingAfast] = useState(true);
  const [afastamentos, setAfastamentos] = useState<Afastamento[]>([]);
  const [totaisAfast, setTotaisAfast] = useState({ ativos: 0, encerradosNoMes: 0, total: 0 });
  const [tiposAfast, setTiposAfast] = useState<{ id: number; nome: string }[]>([]);
  const [funcionariosAtivos, setFuncionariosAtivos] = useState<{ nome_completo: string; cargo: string | null }[]>([]);
  const [buscaAfast, setBuscaAfast] = useState('');
  const [filtroAfast, setFiltroAfast] = useState<'TODOS' | 'ATIVO' | 'ENCERRADO'>('ATIVO');

  const [modalAfast, setModalAfast] = useState(false);
  const [editAfastId, setEditAfastId] = useState<number | null>(null);
  const [aFunc, setAFunc] = useState('');
  const [aTipo, setATipo] = useState('');
  const [aInicio, setAInicio] = useState('');
  const [aFim, setAFim] = useState('');
  const [aCid, setACid] = useState('');
  const [aObs, setAObs] = useState('');
  const [aArquivo, setAArquivo] = useState<File | null>(null);
  const [salvandoAfast, setSalvandoAfast] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const [mostrarNovoTipo, setMostrarNovoTipo] = useState(false);
  const [novoTipoNome, setNovoTipoNome] = useState('');

  const carregarAfastamentos = async () => {
    setLoadingAfast(true);
    try {
      const [painel, tipos] = await Promise.all([painelAfastamentosAction(), listarTiposAfastamentoAction()]);
      if (painel.ok) { setAfastamentos(painel.info.linhas); setTotaisAfast(painel.info.totais); }
      if (tipos.ok) setTiposAfast(tipos.info.tipos);
    } catch (e: any) { alert('Erro ao carregar afastamentos: ' + e.message); }
    finally { setLoadingAfast(false); }
  };

  const carregarFuncionarios = async () => {
    const { data } = await supabase.from('folha_funcionarios').select('nome_completo, cargo').eq('ativo', true).order('nome_completo');
    setFuncionariosAtivos(data || []);
  };

  useEffect(() => { carregarAfastamentos(); carregarFuncionarios(); }, []);

  const abrirNovoAfastamento = () => {
    setModalAfast(true); setEditAfastId(null);
    setAFunc(''); setATipo(''); setAInicio(''); setAFim(''); setACid(''); setAObs(''); setAArquivo(null);
    if (arquivoRef.current) arquivoRef.current.value = '';
  };

  const abrirEdicaoAfastamento = (a: Afastamento) => {
    setModalAfast(true); setEditAfastId(a.id);
    setAFunc(a.funcionario_nome); setATipo(String(a.tipo_id)); setAInicio(a.data_inicio);
    setAFim(a.data_fim || ''); setACid(a.cid || ''); setAObs(a.observacao || ''); setAArquivo(null);
    if (arquivoRef.current) arquivoRef.current.value = '';
  };

  const fileParaBase64 = (file: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej; r.readAsDataURL(file);
  });

  const salvarAfastamento = async () => {
    if (!aFunc || !aTipo || !aInicio) { alert('Funcionário, tipo e data de início são obrigatórios.'); return; }
    setSalvandoAfast(true);
    try {
      let arquivoBase64: string | null = null;
      if (aArquivo) arquivoBase64 = await fileParaBase64(aArquivo);
      const res = await salvarAfastamentoAction({
        id: editAfastId || undefined, funcionarioNome: aFunc, tipoId: Number(aTipo),
        dataInicio: aInicio, dataFim: aFim || null, cid: aCid || null, observacao: aObs || null,
        arquivoBase64, nomeArquivo: aArquivo?.name || null, tipoMime: aArquivo?.type || null,
        usuarioNome: usuarioAtual
      });
      if (!res.ok) throw new Error(res.erro);
      setModalAfast(false);
      carregarAfastamentos();
    } catch (e: any) { alert('Erro ao salvar: ' + e.message); }
    finally { setSalvandoAfast(false); }
  };

  const encerrarAgora = async (a: Afastamento) => {
    const hoje = new Date().toISOString().slice(0, 10);
    const dataFim = prompt(`Data de fim do afastamento de ${a.funcionario_nome}:`, hoje);
    if (!dataFim) return;
    try {
      const res = await encerrarAfastamentoAction({ id: a.id, dataFim });
      if (!res.ok) throw new Error(res.erro);
      carregarAfastamentos();
    } catch (e: any) { alert('Erro ao encerrar: ' + e.message); }
  };

  const excluirAgora = async (a: Afastamento) => {
    if (!confirm(`Excluir o afastamento de ${a.funcionario_nome} (${a.tipo})?\n\nEsta ação é permanente.`)) return;
    try {
      const res = await excluirAfastamentoAction({ id: a.id });
      if (!res.ok) throw new Error(res.erro);
      carregarAfastamentos();
    } catch (e: any) { alert('Erro ao excluir: ' + e.message); }
  };

  const abrirAnexo = async (a: Afastamento) => {
    try {
      const res = await urlAnexoAfastamentoAction({ id: a.id });
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { alert('Erro ao abrir anexo: ' + e.message); }
  };

  const adicionarTipoAfast = async () => {
    if (!novoTipoNome.trim()) return;
    const res = await criarTipoAfastamentoAction({ nome: novoTipoNome });
    if (!res.ok) { alert(res.erro); return; }
    setNovoTipoNome(''); setMostrarNovoTipo(false);
    const tipos = await listarTiposAfastamentoAction();
    if (tipos.ok) setTiposAfast(tipos.info.tipos);
  };

  const afastamentosFiltrados = useMemo(() => afastamentos
    .filter(a => `${a.funcionario_nome} ${a.tipo}`.toLowerCase().includes(buscaAfast.toLowerCase()))
    .filter(a => filtroAfast === 'TODOS' || a.status === filtroAfast),
    [afastamentos, buscaAfast, filtroAfast]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Verificando acesso...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#D1FAE5] border-b border-[#A7F3D0] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#065F46] font-medium text-sm">
          🏖 <strong>Férias e Afastamentos</strong>. Prazos legais de férias e controle de atestados/licenças.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-emerald-50 border border-[#A7F3D0] text-[#065F46] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      {/* ABAS */}
      <div className="px-4 md:px-8 pt-4 flex-shrink-0 flex gap-2 border-b border-[#E2E8F0] bg-white">
        <button
          onClick={() => setAba('ferias')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'ferias' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          🏖 Férias {totaisFerias.vencidas > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[9px]">{totaisFerias.vencidas}</span>}
        </button>
        <button
          onClick={() => setAba('afastamentos')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'afastamentos' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          🩺 Afastamentos {totaisAfast.ativos > 0 && <span className="ml-1 bg-amber-500 text-white rounded-full px-1.5 py-0.5 text-[9px]">{totaisAfast.ativos}</span>}
        </button>
      </div>

      {/* ============================================================================ */}
      {/* ABA: FÉRIAS */}
      {/* ============================================================================ */}
      {aba === 'ferias' && (
        <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Funcionários</p>
              <p className="text-2xl font-black text-[#0C1D4D]">{totaisFerias.funcionarios}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vencidas</p>
              <p className={`text-2xl font-black ${totaisFerias.vencidas > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{totaisFerias.vencidas}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vencendo (60d)</p>
              <p className={`text-2xl font-black ${totaisFerias.vencendo > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totaisFerias.vencendo}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Agendadas/Em gozo</p>
              <p className="text-2xl font-black text-indigo-600">{totaisFerias.agendadas}</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-4">
            <input type="text" placeholder="Buscar funcionário..." value={buscaFerias} onChange={e => setBuscaFerias(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <div className="flex bg-gray-100 p-1 rounded-xl flex-wrap">
              {(['TODOS', 'DISPONIVEL', 'VENCIDAS', 'VENCENDO', 'AGENDADAS'] as const).map(f => (
                <button key={f} onClick={() => setFiltroFerias(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtroFerias === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                  {f === 'TODOS' ? 'Todos' : f === 'DISPONIVEL' ? 'Disponível' : f === 'VENCIDAS' ? 'Vencidas' : f === 'VENCENDO' ? 'Vencendo' : 'Agendadas'}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            {loadingFerias ? (
              <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando férias...</div>
            ) : linhasFeriasFiltradas.length === 0 ? (
              <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum funcionário neste filtro.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Funcionário</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Período aquisitivo</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Concessivo até</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Gozo</th>
                      <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Status</th>
                      <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider w-32">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasFeriasFiltradas.map((l, idx) => {
                      const periodos = l.periodos.filter(p => periodoCombinaFiltro(p, filtroFerias));
                      const linhas = periodos.length || 1;
                      const zebra = idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white';
                      return periodos.length === 0 ? (
                        <tr key={l.nome} className={`${zebra} border-b border-[#E2E8F0]`}>
                          <td className="p-3"><span className="font-black text-[#0C1D4D] block">{l.nome}</span><span className="text-[10px] text-gray-400 font-bold uppercase">{l.cargo || '—'}</span></td>
                          <td className="p-3 text-[11px] font-black text-gray-400 uppercase" colSpan={5}>Sem período aquisitivo completo ainda</td>
                        </tr>
                      ) : (
                        periodos.map((p, pi) => (
                          <tr key={`${l.nome}-${p.id}`} className={`${zebra} ${pi === linhas - 1 ? 'border-b border-[#E2E8F0]' : ''}`}>
                            {pi === 0 && (
                              <td className="p-3 align-top" rowSpan={linhas}>
                                <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                                <span className="text-[10px] text-gray-400 font-bold uppercase">{l.cargo || '—'}</span>
                              </td>
                            )}
                            <td className="p-3 text-[11px] font-bold text-gray-600 whitespace-nowrap">{fmtData(p.periodo_aquisitivo_inicio)} — {fmtData(p.periodo_aquisitivo_fim)}</td>
                            <td className={`p-3 text-[11px] font-black whitespace-nowrap ${p.vencida ? 'text-red-600' : p.vencendo ? 'text-amber-600' : 'text-gray-600'}`}>{fmtData(p.periodo_concessivo_fim)}</td>
                            <td className="p-3 text-[11px] font-bold text-gray-600 whitespace-nowrap">
                              {p.data_inicio_gozo ? (
                                <>
                                  {fmtData(p.data_inicio_gozo)} — {fmtData(p.data_fim_gozo)}
                                  <span className="text-[9px] text-gray-400 font-bold block">{p.dias_gozo}d gozo{p.dias_abono ? ` + ${p.dias_abono}d abono` : ''}</span>
                                </>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                            <td className="p-3 text-center whitespace-nowrap">{badgeFerias(p)}</td>
                            <td className="p-3 text-center whitespace-nowrap">
                              {p.statusExibicao === 'DISPONIVEL' && (
                                <button onClick={() => abrirAgendamento(l.nome, p)} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg uppercase">Agendar</button>
                              )}
                              {p.statusExibicao === 'AGENDADA' && (
                                <div className="flex gap-1 justify-center">
                                  <button onClick={() => abrirAgendamento(l.nome, p)} title="Editar" className="text-gray-400 hover:text-indigo-600 px-1">✏️</button>
                                  <button onClick={() => cancelarAgendamento(p)} title="Cancelar" className="text-gray-400 hover:text-red-600 px-1">✕</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[10px] text-gray-400 font-medium mt-4 text-center">
            Período concessivo = prazo legal de 12 meses após o fim do aquisitivo para tirar as férias, sob pena de dobra. Fracionamento em até 3 períodos não é suportado nesta versão.
          </p>
        </div>
      )}

      {/* ============================================================================ */}
      {/* ABA: AFASTAMENTOS */}
      {/* ============================================================================ */}
      {aba === 'afastamentos' && (
        <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Ativos agora</p>
              <p className={`text-2xl font-black ${totaisAfast.ativos > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totaisAfast.ativos}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Encerrados no mês</p>
              <p className="text-2xl font-black text-[#0C1D4D]">{totaisAfast.encerradosNoMes}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total no histórico</p>
              <p className="text-2xl font-black text-[#0C1D4D]">{totaisAfast.total}</p>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <input type="text" placeholder="Buscar funcionário ou tipo..." value={buscaAfast} onChange={e => setBuscaAfast(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
              <div className="flex bg-gray-100 p-1 rounded-xl">
                {(['ATIVO', 'ENCERRADO', 'TODOS'] as const).map(f => (
                  <button key={f} onClick={() => setFiltroAfast(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtroAfast === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                    {f === 'ATIVO' ? 'Ativos' : f === 'ENCERRADO' ? 'Encerrados' : 'Todos'}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={abrirNovoAfastamento} className="text-[10px] font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">
              + Lançar afastamento
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            {loadingAfast ? (
              <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando afastamentos...</div>
            ) : afastamentosFiltrados.length === 0 ? (
              <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum afastamento neste filtro.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Funcionário</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Tipo</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Início</th>
                      <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Fim</th>
                      <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Dias</th>
                      <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Status</th>
                      <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider w-40">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {afastamentosFiltrados.map((a, idx) => (
                      <tr key={a.id} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                        <td className="p-3"><span className="font-black text-[#0C1D4D] block">{a.funcionario_nome}</span><span className="text-[10px] text-gray-400 font-bold uppercase">{a.cargo || '—'}</span></td>
                        <td className="p-3 text-[11px] font-black text-indigo-700 uppercase whitespace-nowrap">{a.tipo}</td>
                        <td className="p-3 text-[11px] font-bold text-gray-600 whitespace-nowrap">{fmtData(a.data_inicio)}</td>
                        <td className="p-3 text-[11px] font-bold text-gray-600 whitespace-nowrap">{a.data_fim ? fmtData(a.data_fim) : <span className="text-amber-600">em aberto</span>}</td>
                        <td className="p-3 text-right tabular-nums font-black text-[#0C1D4D]">{a.dias}</td>
                        <td className="p-3 text-center whitespace-nowrap">
                          {a.status === 'ATIVO'
                            ? <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">Ativo</span>
                            : <span className="text-[9px] font-black bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">Encerrado</span>}
                        </td>
                        <td className="p-3 text-center whitespace-nowrap">
                          {a.temAnexo && <button onClick={() => abrirAnexo(a)} title="Ver anexo" className="text-gray-400 hover:text-indigo-600 px-1">📎</button>}
                          <button onClick={() => abrirEdicaoAfastamento(a)} title="Editar" className="text-gray-400 hover:text-indigo-600 px-1">✏️</button>
                          {a.status === 'ATIVO' && <button onClick={() => encerrarAgora(a)} title="Encerrar" className="text-gray-400 hover:text-emerald-600 px-1">✓</button>}
                          <button onClick={() => excluirAgora(a)} title="Excluir" className="text-gray-400 hover:text-red-600 px-1">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: agendar/editar férias */}
      {modalPeriodo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalPeriodo(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Agendar férias</h2>
            <p className="text-sm text-gray-500 mb-1">{modalPeriodo.nome}</p>
            <p className="text-[10px] text-gray-400 font-bold uppercase mb-4">
              Aquisitivo {fmtData(modalPeriodo.periodo.periodo_aquisitivo_inicio)} — {fmtData(modalPeriodo.periodo.periodo_aquisitivo_fim)}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data de início do gozo</label>
                <input type="date" value={fDataInicio} onChange={e => setFDataInicio(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Dias de gozo (5–30)</label>
                  <input type="number" min={5} max={30} value={fDias} onChange={e => setFDias(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Abono pecuniário (0–10)</label>
                  <input type="number" min={0} max={10} value={fAbono} onChange={e => setFAbono(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                </div>
              </div>
              {fDataInicio && Number(fDias) > 0 && (
                <p className="text-[10px] font-bold text-indigo-600 uppercase">
                  Retorno previsto: {fmtData(new Date(new Date(fDataInicio + 'T00:00:00').getTime() + (Number(fDias) - 1) * 86400000).toISOString().slice(0, 10))}
                </p>
              )}
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Observação (opcional)</label>
                <input type="text" value={fObs} onChange={e => setFObs(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setModalPeriodo(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarAgendamento} disabled={salvandoFerias} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl disabled:opacity-50">
                {salvandoFerias ? 'Salvando...' : 'Agendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: lançar/editar afastamento */}
      {modalAfast && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalAfast(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-4">{editAfastId ? 'Editar afastamento' : 'Lançar afastamento'}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Funcionário</label>
                <select value={aFunc} onChange={e => setAFunc(e.target.value)} disabled={!!editAfastId} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white disabled:bg-gray-100">
                  <option value="">— Selecione —</option>
                  {funcionariosAtivos.map(f => <option key={f.nome_completo} value={f.nome_completo}>{f.nome_completo}</option>)}
                </select>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] font-black text-gray-500 uppercase">Tipo</label>
                  <button type="button" onClick={() => setMostrarNovoTipo(!mostrarNovoTipo)} className="text-[9px] font-black text-indigo-600 uppercase">+ Novo tipo</button>
                </div>
                <select value={aTipo} onChange={e => setATipo(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {tiposAfast.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
                {mostrarNovoTipo && (
                  <div className="flex gap-2 mt-2">
                    <input type="text" value={novoTipoNome} onChange={e => setNovoTipoNome(e.target.value)} placeholder="Ex: Licença Não Remunerada" className="flex-1 p-2 border border-gray-300 rounded text-xs uppercase" />
                    <button onClick={adicionarTipoAfast} className="bg-[#336699] text-white font-black text-xs px-3 rounded-lg uppercase">Add</button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data de início</label>
                  <input type="date" value={aInicio} onChange={e => setAInicio(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data de fim (opcional)</label>
                  <input type="date" value={aFim} onChange={e => setAFim(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">CID (opcional)</label>
                <input type="text" value={aCid} onChange={e => setACid(e.target.value.toUpperCase())} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold uppercase" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Observação (opcional)</label>
                <input type="text" value={aObs} onChange={e => setAObs(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Anexo — atestado/laudo (opcional)</label>
                <input ref={arquivoRef} type="file" accept="image/*,application/pdf" onChange={e => setAArquivo(e.target.files?.[0] || null)} className="w-full text-xs" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setModalAfast(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarAfastamento} disabled={salvandoAfast} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl disabled:opacity-50">
                {salvandoAfast ? 'Salvando...' : editAfastId ? 'Salvar' : 'Lançar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
