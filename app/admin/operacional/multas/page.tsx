"use client";

// /admin/operacional/multas — Gerenciamento de Multas e Débitos.
// Consulta automática (Infosimples DETRAN/SP) dos veículos PRÓPRIOS (alugado
// é lançamento manual), controle de status, condutor sugerido pelo Checklist
// de Veículos, NIC ligada à infração de origem, desconto em folha com aviso
// por WhatsApp, OP de pagamento (uma ou várias multas) e relatórios.
// Regras de negócio em app/admin/operacional/actions/actions-multas.ts e
// app/lib/multasCore.ts.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import * as XLSX from 'xlsx';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import {
  carregarPainelMultasAction, consultarDebitosVeiculoAction, sugerirCondutorAction, definirCondutorAction,
  lancarDescontoFolhaAction, atualizarStatusDebitoAction, salvarObservacaoDebitoAction,
  salvarDebitoManualAction, excluirDebitoManualAction, avisarCondutorAction,
  type DebitoMulta, type VeiculoMultas, type ConsultaMulta, type TipoDebitoMulta, type StatusDebito,
} from '../actions/actions-multas';

// ============================================================================
// Apoio visual
// ============================================================================
const ICONE_TIPO: Record<TipoDebitoMulta, string> = { MULTA: '🚨', IPVA: '🧾', LICENCIAMENTO: '🪪', OUTRO: '📎' };
const LABEL_TIPO: Record<TipoDebitoMulta, string> = { MULTA: 'Multa', IPVA: 'IPVA', LICENCIAMENTO: 'Licenciamento', OUTRO: 'Outro' };

const fmtBRL = (v: number | null | undefined) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtData = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const fmtDataHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtHora = (h?: string | null) => (h && !/^00:00(:00)?$/.test(h) ? h.slice(0, 5) : '');
const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const mesAtualIso = () => hojeIso().slice(0, 7);

type SituacaoVisual = 'VENCIDO' | 'VENCE_LOGO' | 'ABERTO' | 'PAGO' | 'CANCELADO';
function situacao(d: DebitoMulta): SituacaoVisual {
  if (d.status === 'PAGO') return 'PAGO';
  if (d.status === 'CANCELADO') return 'CANCELADO';
  if (d.data_vencimento) {
    const dias = Math.ceil((new Date(`${d.data_vencimento}T00:00:00`).getTime() - new Date(`${hojeIso()}T00:00:00`).getTime()) / 86400000);
    if (dias < 0) return 'VENCIDO';
    if (dias <= 10) return 'VENCE_LOGO';
  }
  return 'ABERTO';
}
const SELO_SITUACAO: Record<SituacaoVisual, { label: string; cls: string }> = {
  VENCIDO: { label: 'Vencido', cls: 'bg-red-100 text-red-700 border-red-300' },
  VENCE_LOGO: { label: 'Vence em breve', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  ABERTO: { label: 'Em aberto', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
  PAGO: { label: 'Pago', cls: 'bg-green-100 text-green-700 border-green-300' },
  CANCELADO: { label: 'Cancelado', cls: 'bg-gray-100 text-gray-500 border-gray-300' },
};

// Restrição "relevante" = qualquer texto que não seja nada consta / não consta.
const restricaoRelevante = (s: string | null | undefined) => !!s && !/^(nada consta|n[aã]o consta.*|n[aã]o)$/i.test(s.trim());

interface Empresa { id: number; nome: string }
interface Candidato { checklist_id: string | null; numero: number | null; motorista_nome: string; saida_em: string | null; retorno_em: string | null; destino: string | null; precisao: 'ORIGEM' | 'HORARIO' | 'DIA' }
interface Motorista { nome: string; pode_dirigir: boolean }
interface OrigemNic { id: string; auto_infracao: string | null; data_infracao: string | null; hora_infracao: string | null; condutor_nome: string | null }
interface Certificado { titular: string; validoAte: string; diasRestantes: number }

const FORM_MANUAL_VAZIO = {
  id: null as string | null, veiculoId: '', tipo: 'MULTA' as TipoDebitoMulta, descricao: '', autoInfracao: '', orgaoAutuador: '',
  dataInfracao: '', horaInfracao: '', localInfracao: '', valor: '', dataVencimento: '', observacao: '',
};

// ============================================================================
export default function MultasDebitosPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [veiculos, setVeiculos] = useState<VeiculoMultas[]>([]);
  const [debitos, setDebitos] = useState<DebitoMulta[]>([]);
  const [consultas, setConsultas] = useState<ConsultaMulta[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [provedorOk, setProvedorOk] = useState(true);
  const [certificado, setCertificado] = useState<Certificado | null>(null);

  const [aba, setAba] = useState<'debitos' | 'veiculos' | 'relatorios' | 'consultas'>('debitos');
  const [filtroEmpresa, setFiltroEmpresa] = useState('TODAS');
  const [filtroStatus, setFiltroStatus] = useState<'ABERTOS' | 'PAGO' | 'CANCELADO' | 'TODOS'>('ABERTOS');
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | TipoDebitoMulta | 'NIC'>('TODOS');
  const [filtroVeiculo, setFiltroVeiculo] = useState('TODOS');
  const [busca, setBusca] = useState('');

  const [consultandoIds, setConsultandoIds] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState<{ atual: number; total: number } | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [manual, setManual] = useState<typeof FORM_MANUAL_VAZIO | null>(null);
  const [salvandoManual, setSalvandoManual] = useState(false);

  const carregar = useCallback(async () => {
    if (!accessToken) return;
    const res = await carregarPainelMultasAction(accessToken);
    if (!res.ok) { setErroCarga(res.erro || 'Falha ao carregar.'); setCarregando(false); return; }
    setErroCarga(null);
    setVeiculos(res.info.veiculos);
    setDebitos(res.info.debitos);
    setConsultas(res.info.consultas);
    setEmpresas(res.info.empresas);
    setProvedorOk(res.info.provedorConfigurado);
    setCertificado(res.info.certificado || null);
    setCarregando(false);
  }, [accessToken]);

  useEffect(() => {
    if (authLoading || acessoNegado || !accessToken) return;
    carregar();
    // só na liberação do acesso — o token renovado não precisa recarregar tudo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado]);

  const veiculoPorId = useMemo(() => new Map(veiculos.map(v => [v.id, v])), [veiculos]);
  const debitoPorId = useMemo(() => new Map(debitos.map(d => [d.id, d])), [debitos]);
  const empresaNome = (id: number | null) => (id === null ? 'Todas as empresas' : empresas.find(e => e.id === id)?.nome || `Empresa ${id}`);

  // Escopo central por empresa — todos os consumidores abaixo partem daqui.
  const debitosEscopo = useMemo(
    () => (filtroEmpresa === 'TODAS' ? debitos : debitos.filter(d => String(d.empresa_id) === filtroEmpresa)),
    [debitos, filtroEmpresa]
  );
  const veiculosEscopo = useMemo(
    () => (filtroEmpresa === 'TODAS' ? veiculos : veiculos.filter(v => String(v.empresa_id) === filtroEmpresa)),
    [veiculos, filtroEmpresa]
  );

  const kpis = useMemo(() => {
    const abertos = debitosEscopo.filter(d => d.status === 'ABERTO');
    const nics = debitosEscopo.filter(d => d.eh_nic && d.status !== 'CANCELADO');
    return {
      totalAberto: abertos.reduce((s, d) => s + d.valor, 0),
      qtdAbertos: abertos.length,
      vencidos: abertos.filter(d => situacao(d) === 'VENCIDO').length,
      valorVencido: abertos.filter(d => situacao(d) === 'VENCIDO').reduce((s, d) => s + d.valor, 0),
      semCondutor: abertos.filter(d => d.tipo === 'MULTA' && !d.condutor_nome).length,
      nicQtd: nics.length,
      nicValor: nics.reduce((s, d) => s + d.valor, 0),
    };
  }, [debitosEscopo]);

  const debitosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return debitosEscopo.filter(d => {
      if (filtroStatus === 'ABERTOS' && d.status !== 'ABERTO') return false;
      if (filtroStatus !== 'ABERTOS' && filtroStatus !== 'TODOS' && d.status !== filtroStatus) return false;
      if (filtroTipo === 'NIC' && !d.eh_nic) return false;
      if (filtroTipo !== 'TODOS' && filtroTipo !== 'NIC' && d.tipo !== filtroTipo) return false;
      if (filtroVeiculo !== 'TODOS' && d.veiculo_id !== filtroVeiculo) return false;
      if (termo) {
        const v = veiculoPorId.get(d.veiculo_id);
        const alvo = [d.auto_infracao, d.descricao, d.condutor_nome, d.local_infracao, d.orgao_autuador, v?.placa, v?.apelido].join(' ').toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Abertos: vencimento mais próximo primeiro; demais: mais recentes primeiro.
      if (a.status === 'ABERTO' && b.status === 'ABERTO') return (a.data_vencimento || '9999').localeCompare(b.data_vencimento || '9999');
      return (b.updated_at || '').localeCompare(a.updated_at || '');
    });
  }, [debitosEscopo, filtroStatus, filtroTipo, filtroVeiculo, busca, veiculoPorId]);

  const abertoPorVeiculo = useMemo(() => {
    const m = new Map<string, { qtd: number; valor: number }>();
    debitos.filter(d => d.status === 'ABERTO').forEach(d => {
      const a = m.get(d.veiculo_id) || { qtd: 0, valor: 0 };
      a.qtd++; a.valor += d.valor; m.set(d.veiculo_id, a);
    });
    return m;
  }, [debitos]);

  // --------------------------------------------------------------------------
  // Seleção para OP (várias multas numa OP só)
  // --------------------------------------------------------------------------
  const podeSelecionar = (d: DebitoMulta) => d.status === 'ABERTO' && !(d.op && d.op.status !== 'REPROVADA');
  const selecionadosLista = useMemo(() => Array.from(selecionados).map(id => debitoPorId.get(id)).filter((d): d is DebitoMulta => !!d && podeSelecionar(d)), [selecionados, debitoPorId]);
  const alternarSelecao = (id: string) => setSelecionados(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selecionaveisVisiveis = debitosFiltrados.filter(podeSelecionar);
  const todosVisiveisSelecionados = selecionaveisVisiveis.length > 0 && selecionaveisVisiveis.every(d => selecionados.has(d.id));
  const alternarTodos = () => setSelecionados(s => {
    const n = new Set(s);
    if (todosVisiveisSelecionados) selecionaveisVisiveis.forEach(d => n.delete(d.id));
    else selecionaveisVisiveis.forEach(d => n.add(d.id));
    return n;
  });

  const gerarOpSelecionados = () => {
    if (selecionadosLista.length === 0) return;
    const empresasSel = new Set(selecionadosLista.map(d => d.empresa_id ?? 'null'));
    if (empresasSel.size > 1) { toast('Os débitos selecionados são de empresas diferentes — gere uma OP por empresa.', 'error'); return; }
    router.push(`/admin/op/nova?multaIds=${selecionadosLista.map(d => d.id).join(',')}`);
  };

  // --------------------------------------------------------------------------
  // Consulta automática (só veículos PRÓPRIOS)
  // --------------------------------------------------------------------------
  const consultarVeiculo = async (v: VeiculoMultas, silencioso = false): Promise<boolean> => {
    setConsultandoIds(s => new Set(s).add(v.id));
    const res = await consultarDebitosVeiculoAction({ veiculoId: v.id }, accessToken);
    setConsultandoIds(s => { const n = new Set(s); n.delete(v.id); return n; });
    if (!res.ok) {
      toast(`${v.apelido} (${v.placa}): ${res.erro}`, 'error');
      return false;
    }
    if (!silencioso) {
      const i = res.info;
      const partes = [`${i.encontrados} débito(s) em aberto`, i.novos ? `${i.novos} novo(s)` : null, i.baixados ? `${i.baixados} baixado(s)` : null].filter(Boolean);
      toast(`${v.apelido} (${v.placa}): ${partes.join(' · ')}`, 'success');
      if (i.avisos?.length) toast(`Aviso do Detran: ${i.avisos.join(' | ')}`, 'info');
    }
    return true;
  };

  const consultarUm = async (v: VeiculoMultas) => {
    await consultarVeiculo(v);
    await carregar();
  };

  const consultarTodos = async () => {
    const alvos = veiculosEscopo.filter(v => v.propriedade !== 'ALUGADO' && v.placa && v.renavam);
    if (alvos.length === 0) { toast('Nenhum veículo próprio com placa e Renavam cadastrados.', 'info'); return; }
    const ok = await confirm({
      title: 'Consultar veículos próprios',
      message: `Vai consultar ${alvos.length} veículo(s) próprio(s) no Detran-SP, um por vez (~1 min cada, R$ 0,28 cada). Alugados ficam de fora — lançamento manual. A consulta semanal automática já faz isso toda segunda. Continuar?`,
      confirmLabel: 'Consultar',
    });
    if (!ok) return;
    let sucesso = 0;
    for (let i = 0; i < alvos.length; i++) {
      setLote({ atual: i + 1, total: alvos.length });
      if (await consultarVeiculo(alvos[i], true)) sucesso++;
    }
    setLote(null);
    await carregar();
    toast(`Consulta concluída: ${sucesso} de ${alvos.length} veículo(s) consultados.`, sucesso === alvos.length ? 'success' : 'info');
  };

  // --------------------------------------------------------------------------
  // Lançamento manual
  // --------------------------------------------------------------------------
  const abrirManual = (d?: DebitoMulta, veiculoId?: string) => {
    if (d) {
      setManual({
        id: d.id, veiculoId: d.veiculo_id, tipo: d.tipo, descricao: d.descricao || '', autoInfracao: d.auto_infracao || '',
        orgaoAutuador: d.orgao_autuador || '', dataInfracao: d.data_infracao || '', horaInfracao: fmtHora(d.hora_infracao),
        localInfracao: d.local_infracao || '', valor: String(d.valor || ''), dataVencimento: d.data_vencimento || '', observacao: d.observacao || '',
      });
    } else {
      setManual({ ...FORM_MANUAL_VAZIO, veiculoId: veiculoId || (filtroVeiculo !== 'TODOS' ? filtroVeiculo : '') });
    }
  };

  const salvarManual = async () => {
    if (!manual) return;
    if (!manual.veiculoId) { toast('Selecione o veículo.', 'error'); return; }
    setSalvandoManual(true);
    const res = await salvarDebitoManualAction({
      id: manual.id, veiculoId: manual.veiculoId, tipo: manual.tipo, descricao: manual.descricao,
      autoInfracao: manual.autoInfracao, orgaoAutuador: manual.orgaoAutuador, dataInfracao: manual.dataInfracao || null,
      horaInfracao: manual.horaInfracao || null, localInfracao: manual.localInfracao,
      valor: Number(String(manual.valor).replace(/\./g, '').replace(',', '.')), dataVencimento: manual.dataVencimento || null, observacao: manual.observacao,
    }, accessToken);
    setSalvandoManual(false);
    if (!res.ok) { toast(res.erro || 'Falha ao salvar.', 'error'); return; }
    toast(manual.id ? 'Lançamento atualizado.' : 'Débito lançado.', 'success');
    setManual(null);
    await carregar();
  };

  // ==========================================================================
  // Render
  // ==========================================================================
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
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar esta página.</p>
          <button onClick={() => router.push('/admin/operacional')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  const detalhe = detalheId ? debitoPorId.get(detalheId) || null : null;
  const consultandoAlgum = consultandoIds.size > 0 || !!lote;
  const totalSelecionado = selecionadosLista.reduce((s, d) => s + d.valor, 0);

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] pt-4 pb-24">
      <Analytics />

      <div className="bg-rose-50 border-b border-rose-200 px-4 md:px-8 py-4 flex justify-between items-center gap-3 shadow-sm">
        <p className="text-rose-800 font-medium text-sm">
          🚨 <strong>Multas e Débitos</strong>. Consulta no Detran-SP, condutor, desconto em folha e pagamento.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="shrink-0 text-[10px] md:text-xs font-black bg-white hover:bg-rose-50 border border-rose-200 text-rose-800 px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 mt-6">
        {certificado && certificado.diasRestantes <= 30 && (
          <div className={`mb-4 rounded-xl p-3 text-xs font-medium border ${certificado.diasRestantes < 0 ? 'bg-red-50 border-red-300 text-red-700' : 'bg-amber-50 border-amber-300 text-amber-800'}`}>
            🔐 {certificado.diasRestantes < 0
              ? <>O certificado digital A1 de <strong>{certificado.titular}</strong> <strong>venceu em {fmtData(certificado.validoAte)}</strong>. A consulta automática de multas está parada até ele ser renovado no servidor.</>
              : <>O certificado digital A1 de <strong>{certificado.titular}</strong> vence em <strong>{fmtData(certificado.validoAte)}</strong> ({certificado.diasRestantes === 0 ? 'hoje' : `${certificado.diasRestantes} dia(s)`}). Sem ele a consulta automática de multas para — renove e atualize no servidor.</>}
          </div>
        )}
        {!provedorOk && (
          <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 rounded-xl p-3 text-xs font-medium">
            ⚠️ Consulta automática ainda não configurada no servidor: precisa do <code className="font-mono">INFOSIMPLES_TOKEN</code> e do login GOV.BR — certificado A1 da empresa + <code className="font-mono">INFOSIMPLES_ENCRYPTION_KEY</code> (ou <code className="font-mono">INFOSIMPLES_DETRAN_SP_CPF</code>/<code className="font-mono">_SENHA</code>). Os lançamentos manuais funcionam normalmente.
          </div>
        )}
        {erroCarga && (
          <div className="mb-4 bg-red-50 border border-red-300 text-red-700 rounded-xl p-3 text-xs font-medium flex justify-between items-center gap-3">
            <span>❌ {erroCarga}</span>
            <button onClick={() => { setCarregando(true); carregar(); }} className="font-black uppercase text-[10px] underline">Tentar de novo</button>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          <Kpi titulo="Total em aberto" valor={carregando ? '—' : fmtBRL(kpis.totalAberto)} sub={`${kpis.qtdAbertos} débito(s)`} />
          <Kpi titulo="Vencidos" valor={carregando ? '—' : String(kpis.vencidos)} sub={fmtBRL(kpis.valorVencido)} destaque={kpis.vencidos > 0} />
          <Kpi titulo="Multas sem condutor" valor={carregando ? '—' : String(kpis.semCondutor)} sub="confirmar pelo checklist" destaque={kpis.semCondutor > 0} />
          <Kpi titulo="Por não indicar condutor" valor={carregando ? '—' : fmtBRL(kpis.nicValor)} sub={`${kpis.nicQtd} multa(s) NIC`} destaque={kpis.nicQtd > 0}
            onClick={() => { setAba('debitos'); setFiltroTipo('NIC'); setFiltroStatus('TODOS'); }} />
          <Kpi titulo="Selecionados p/ OP" valor={String(selecionadosLista.length)} sub={fmtBRL(totalSelecionado)} />
        </div>

        {/* Abas + ações */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {([['debitos', '📋 Débitos'], ['veiculos', '🚚 Veículos'], ['relatorios', '📊 Relatórios'], ['consultas', '🔎 Consultas']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setAba(k)}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider border transition-colors ${aba === k ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white text-[#0C1D4D] border-[#E2E8F0] hover:border-[#336699]'}`}>
              {l}
            </button>
          ))}
          <div className="flex-1" />
          {empresas.length > 1 && (
            <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} className="p-2 border border-[#E2E8F0] rounded-lg text-xs bg-white">
              <option value="TODAS">Todas as empresas</option>
              {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          )}
          <button onClick={() => abrirManual()} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider bg-white border border-[#E2E8F0] text-[#0C1D4D] hover:border-[#336699]">
            ＋ Lançamento manual
          </button>
          <button onClick={consultarTodos} disabled={!provedorOk || consultandoAlgum}
            className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider bg-[#0C1D4D] text-white hover:bg-[#284B8C] disabled:opacity-50 disabled:cursor-not-allowed">
            {lote ? `Consultando ${lote.atual}/${lote.total}...` : '🔄 Consultar próprios'}
          </button>
        </div>

        {carregando ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-400">Carregando...</div>
        ) : aba === 'debitos' ? (
          <>
            {/* Filtros */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 mb-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as typeof filtroStatus)} className="p-2 border border-[#E2E8F0] rounded-lg text-xs">
                <option value="ABERTOS">Em aberto</option>
                <option value="PAGO">Pagos</option>
                <option value="CANCELADO">Cancelados</option>
                <option value="TODOS">Todos</option>
              </select>
              <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as typeof filtroTipo)} className="p-2 border border-[#E2E8F0] rounded-lg text-xs">
                <option value="TODOS">Todos os tipos</option>
                {(Object.keys(LABEL_TIPO) as TipoDebitoMulta[]).map(t => <option key={t} value={t}>{ICONE_TIPO[t]} {LABEL_TIPO[t]}</option>)}
                <option value="NIC">⚠ Só não identificação do condutor</option>
              </select>
              <select value={filtroVeiculo} onChange={e => setFiltroVeiculo(e.target.value)} className="p-2 border border-[#E2E8F0] rounded-lg text-xs">
                <option value="TODOS">Todos os veículos</option>
                {veiculosEscopo.map(v => <option key={v.id} value={v.id}>{v.apelido} · {v.placa}</option>)}
              </select>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar AIT, condutor, local..." className="p-2 border border-[#E2E8F0] rounded-lg text-xs" />
            </div>

            {debitosFiltrados.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center">
                <div className="text-4xl mb-2">✅</div>
                <p className="text-sm font-bold text-[#0C1D4D]">Nenhum débito {filtroStatus === 'ABERTOS' ? 'em aberto' : 'encontrado'} com esses filtros.</p>
                {debitos.length === 0 && <p className="text-xs text-gray-400 mt-1">Use “Consultar próprios” ou consulte um veículo na aba Veículos.</p>}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="bg-[#F8FAFC] text-[10px] uppercase tracking-wider text-gray-500 text-left">
                      <th className="p-3 w-8">
                        <input type="checkbox" aria-label="Selecionar todos os visíveis" checked={todosVisiveisSelecionados} disabled={selecionaveisVisiveis.length === 0} onChange={alternarTodos} />
                      </th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3">Veículo</th>
                      <th className="p-3">Descrição</th>
                      <th className="p-3">Infração</th>
                      <th className="p-3">Condutor</th>
                      <th className="p-3 text-right">Valor</th>
                      <th className="p-3">Vencimento</th>
                      <th className="p-3">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debitosFiltrados.map(d => {
                      const v = veiculoPorId.get(d.veiculo_id);
                      const s = SELO_SITUACAO[situacao(d)];
                      const selecionavel = podeSelecionar(d);
                      return (
                        <tr key={d.id} onClick={() => setDetalheId(d.id)} className={`border-t border-[#F1F5F9] hover:bg-blue-50/40 cursor-pointer ${selecionados.has(d.id) ? 'bg-indigo-50/60' : ''}`}>
                          <td className="p-3" onClick={e => e.stopPropagation()}>
                            {selecionavel && <input type="checkbox" aria-label="Selecionar para OP" checked={selecionados.has(d.id)} onChange={() => alternarSelecao(d.id)} />}
                          </td>
                          <td className="p-3 whitespace-nowrap font-bold">{ICONE_TIPO[d.tipo]} {LABEL_TIPO[d.tipo]}</td>
                          <td className="p-3 whitespace-nowrap">
                            <div className="font-bold text-[#0C1D4D]">{v?.apelido || '—'}</div>
                            <div className="text-[10px] text-gray-400 font-mono">{v?.placa}</div>
                          </td>
                          <td className="p-3 max-w-[260px]">
                            <div className="truncate" title={d.descricao || ''}>{d.descricao || '—'}</div>
                            <div className="text-[10px] text-gray-400 flex gap-2 flex-wrap">
                              {d.auto_infracao && <span className="font-mono">AIT {d.auto_infracao}</span>}
                              {d.eh_nic && <span className="text-red-600 font-black">NÃO IDENT. CONDUTOR</span>}
                              {d.origem === 'MANUAL' && <span className="text-violet-600 font-bold">MANUAL</span>}
                              {d.fonte === 'RENAINF' && <span className="text-orange-600 font-bold">RENAINF</span>}
                            </div>
                          </td>
                          <td className="p-3 whitespace-nowrap">{d.tipo === 'MULTA' ? <>{fmtData(d.data_infracao)} <span className="text-gray-400">{fmtHora(d.hora_infracao)}</span></> : '—'}</td>
                          <td className="p-3 whitespace-nowrap">
                            {d.tipo !== 'MULTA' ? <span className="text-gray-300">—</span>
                              : d.condutor_nome ? <span className="font-bold">{d.condutor_nome}</span>
                              : <span className="text-amber-600 font-bold">⚠ definir</span>}
                            {d.desconto_lancado_em && <div className="text-[10px] text-emerald-600 font-bold">💸 desconto {d.desconto_parcelas}x</div>}
                            {d.condutor_avisado_em && <div className="text-[10px] text-sky-600 font-bold">📲 avisado</div>}
                          </td>
                          <td className="p-3 text-right font-black whitespace-nowrap">{fmtBRL(d.valor)}</td>
                          <td className="p-3 whitespace-nowrap">{fmtData(d.data_vencimento)}</td>
                          <td className="p-3 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${s.cls}`}>{s.label}</span>
                            {d.op && d.op.status !== 'REPROVADA' && <div className="text-[10px] text-indigo-600 font-bold mt-0.5">💳 OP #{d.op.numero_op} · {d.op.status}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : aba === 'veiculos' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {veiculosEscopo.map(v => {
              const ab = abertoPorVeiculo.get(v.id);
              const consultando = consultandoIds.has(v.id);
              const alugado = v.propriedade === 'ALUGADO';
              const semDoc = !v.placa || !v.renavam;
              const sit = v.situacao;
              const restricoes = sit ? [
                ['Financeira', sit.restricao_financeira], ['Administrativa', sit.restricao_administrativa],
                ['Judicial', sit.restricao_judiciaria], ['Tributária', sit.restricao_tributaria], ['Furto', sit.bloqueio_furto],
              ].filter(([, valor]) => restricaoRelevante(valor)) as [string, string][] : [];
              return (
                <div key={v.id} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 flex flex-col gap-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="font-black text-[#0C1D4D] uppercase">{v.apelido}</p>
                      <p className="text-xs font-mono text-gray-500">{v.placa || 'sem placa'} · Renavam {v.renavam || '—'}</p>
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${corSeloEmpresa(v.empresa_id)}`}>{v.empresa_id === null ? '🌐 Todas' : empresaNome(v.empresa_id)}</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap text-[9px] font-black uppercase">
                    <span className={`px-2 py-0.5 rounded-full border ${alugado ? 'bg-indigo-100 text-indigo-700 border-indigo-300' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>{v.propriedade || '—'}</span>
                    {!v.exibir_na_frota && <span className="px-2 py-0.5 rounded-full border bg-gray-50 text-gray-400 border-gray-200">fora da frota</span>}
                    {sit?.ultimo_licenciamento && (() => {
                      const ano = sit.ultimo_licenciamento.replace(/exerc[ií]cio\s*/i, '').trim();
                      const atrasado = /^\d{4}$/.test(ano) && Number(ano) < Number(hojeIso().slice(0, 4));
                      return (
                        <span title={atrasado ? 'Licenciamento do ano corrente ainda não consta no Detran — confira o calendário pelo final da placa.' : ''}
                          className={`px-2 py-0.5 rounded-full border ${atrasado ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                          {atrasado ? '⚠ ' : ''}Licenc. {ano}
                        </span>
                      );
                    })()}
                    {restricoes.map(([tipo, valor]) => (
                      <span key={tipo} title={valor} className="px-2 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200">⚠ {tipo}: {valor.length > 22 ? valor.slice(0, 22) + '…' : valor}</span>
                    ))}
                  </div>
                  {alugado && <p className="text-[10px] text-indigo-600">Alugado: fora da consulta automática — lance as multas que a locadora repassar manualmente.</p>}
                  <div className="bg-[#F8FAFC] rounded-xl p-3 text-xs">
                    <p className="font-black text-[#0C1D4D]">{ab ? `${ab.qtd} débito(s) · ${fmtBRL(ab.valor)}` : 'Nada em aberto'}</p>
                    {!alugado && (
                      <>
                        <p className="text-[10px] text-gray-500 mt-1">
                          {v.ultima_consulta
                            ? <>Última consulta: {fmtDataHora(v.ultima_consulta.consultado_em)} {v.ultima_consulta.status === 'ERRO' ? <span className="text-red-600 font-bold">· erro</span> : <span className="text-green-600 font-bold">· ok</span>}</>
                            : 'Nunca consultado'}
                        </p>
                        {v.ultima_consulta?.status === 'ERRO' && <p className="text-[10px] text-red-500 mt-0.5 line-clamp-2" title={v.ultima_consulta.mensagem || ''}>{v.ultima_consulta.mensagem}</p>}
                      </>
                    )}
                  </div>
                  <div className="flex gap-2 mt-auto">
                    <button onClick={() => { setFiltroVeiculo(v.id); setFiltroStatus('ABERTOS'); setFiltroTipo('TODOS'); setAba('debitos'); }}
                      className="flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider border border-[#E2E8F0] text-[#0C1D4D] hover:border-[#336699]">Ver débitos</button>
                    {alugado ? (
                      <button onClick={() => abrirManual(undefined, v.id)}
                        className="flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-600 text-white hover:bg-indigo-700">＋ Lançar multa</button>
                    ) : (
                      <button onClick={() => consultarUm(v)} disabled={!provedorOk || semDoc || consultando || !!lote}
                        title={semDoc ? 'Cadastre placa e Renavam no Controle de Frota' : ''}
                        className="flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-[#0C1D4D] text-white hover:bg-[#284B8C] disabled:opacity-50 disabled:cursor-not-allowed">
                        {consultando ? 'Consultando...' : '🔄 Consultar'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {veiculosEscopo.length === 0 && <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-400 col-span-full">Nenhum veículo cadastrado no Controle de Frota.</div>}
          </div>
        ) : aba === 'relatorios' ? (
          <Relatorios debitos={debitosEscopo} veiculoPorId={veiculoPorId} empresaNome={empresaNome} />
        ) : (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr className="bg-[#F8FAFC] text-[10px] uppercase tracking-wider text-gray-500 text-left">
                  <th className="p-3">Quando</th><th className="p-3">Veículo</th><th className="p-3">Resultado</th>
                  <th className="p-3 text-right">Encontrados</th><th className="p-3 text-right">Novos</th><th className="p-3 text-right">Baixados</th>
                  <th className="p-3 text-right">Custo</th><th className="p-3">Por</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {consultas.filter(c => filtroEmpresa === 'TODAS' || String(veiculoPorId.get(c.veiculo_id)?.empresa_id) === filtroEmpresa).map(c => {
                  const v = veiculoPorId.get(c.veiculo_id);
                  return (
                    <tr key={c.id} className="border-t border-[#F1F5F9]">
                      <td className="p-3 whitespace-nowrap">{fmtDataHora(c.consultado_em)}</td>
                      <td className="p-3 whitespace-nowrap font-bold">{v?.apelido || '—'} <span className="font-mono text-gray-400 font-normal">{v?.placa}</span></td>
                      <td className="p-3 max-w-[280px]">
                        <span className={`font-black ${c.status === 'OK' ? 'text-green-600' : 'text-red-600'}`}>{c.status}</span>
                        {c.mensagem && <span className="text-gray-500"> · <span title={c.mensagem}>{c.mensagem.length > 90 ? c.mensagem.slice(0, 90) + '…' : c.mensagem}</span></span>}
                      </td>
                      <td className="p-3 text-right">{c.encontrados}</td>
                      <td className="p-3 text-right">{c.novos}</td>
                      <td className="p-3 text-right">{c.baixados}</td>
                      <td className="p-3 text-right whitespace-nowrap">{c.preco !== null ? fmtBRL(c.preco) : '—'}</td>
                      <td className="p-3 whitespace-nowrap text-gray-500">{c.consultado_por || '—'}</td>
                      <td className="p-3">{c.site_receipt && <a href={c.site_receipt} target="_blank" rel="noreferrer" className="text-[#336699] font-bold underline whitespace-nowrap">comprovante</a>}</td>
                    </tr>
                  );
                })}
                {consultas.length === 0 && <tr><td colSpan={9} className="p-10 text-center text-gray-400">Nenhuma consulta feita ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Barra de seleção para OP */}
      {selecionadosLista.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-indigo-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-3">
            <p className="text-sm font-black text-[#0C1D4D]">{selecionadosLista.length} selecionado(s) · {fmtBRL(totalSelecionado)}</p>
            <button onClick={() => setSelecionados(new Set())} className="text-[10px] font-black uppercase text-gray-500 underline">Limpar</button>
            <span className="flex-1" />
            <button onClick={gerarOpSelecionados} className="px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider bg-indigo-600 text-white hover:bg-indigo-700">
              💳 Gerar uma OP com {selecionadosLista.length}
            </button>
          </div>
        </div>
      )}

      {detalhe && (
        <DetalheDebito
          key={detalhe.id}
          debito={detalhe}
          veiculo={veiculoPorId.get(detalhe.veiculo_id) || null}
          empresaNome={empresaNome(detalhe.empresa_id)}
          origem={detalhe.multa_origem_id ? debitoPorId.get(detalhe.multa_origem_id) || null : null}
          nicsDaOrigem={debitos.filter(x => x.multa_origem_id === detalhe.id)}
          accessToken={accessToken}
          onFechar={() => setDetalheId(null)}
          onAbrir={id => setDetalheId(id)}
          onAlterado={carregar}
          onEditarManual={() => { abrirManual(detalhe); setDetalheId(null); }}
          onCriarOp={() => router.push(`/admin/op/nova?multaIds=${detalhe.id}`)}
        />
      )}

      {manual && (
        <Modal titulo={manual.id ? 'Editar lançamento manual' : 'Lançamento manual'} onFechar={() => setManual(null)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Veículo *" className="sm:col-span-2">
              <select value={manual.veiculoId} onChange={e => setManual({ ...manual, veiculoId: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm">
                <option value="">Selecione...</option>
                {veiculos.map(v => <option key={v.id} value={v.id}>{v.apelido} · {v.placa}{v.propriedade === 'ALUGADO' ? ' (alugado)' : ''}</option>)}
              </select>
            </Campo>
            <Campo label="Tipo *">
              <select value={manual.tipo} onChange={e => setManual({ ...manual, tipo: e.target.value as TipoDebitoMulta })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm">
                {(Object.keys(LABEL_TIPO) as TipoDebitoMulta[]).map(t => <option key={t} value={t}>{LABEL_TIPO[t]}</option>)}
              </select>
            </Campo>
            <Campo label="Valor (R$) *">
              <input inputMode="decimal" value={manual.valor} onChange={e => setManual({ ...manual, valor: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" placeholder="0,00" />
            </Campo>
            {manual.tipo === 'MULTA' && (
              <>
                <Campo label="Nº do auto de infração (AIT)">
                  <input value={manual.autoInfracao} onChange={e => setManual({ ...manual, autoInfracao: e.target.value.toUpperCase() })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm font-mono" />
                </Campo>
                <Campo label="Órgão autuador">
                  <input value={manual.orgaoAutuador} onChange={e => setManual({ ...manual, orgaoAutuador: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" placeholder="Ex.: DER-SP, CET, PRF" />
                </Campo>
                <Campo label="Data da infração">
                  <input type="date" value={manual.dataInfracao} onChange={e => setManual({ ...manual, dataInfracao: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" />
                </Campo>
                <Campo label="Hora da infração">
                  <input type="time" value={manual.horaInfracao} onChange={e => setManual({ ...manual, horaInfracao: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" />
                </Campo>
                <Campo label="Local" className="sm:col-span-2">
                  <input value={manual.localInfracao} onChange={e => setManual({ ...manual, localInfracao: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" />
                </Campo>
              </>
            )}
            <Campo label="Descrição" className="sm:col-span-2">
              <input value={manual.descricao} onChange={e => setManual({ ...manual, descricao: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" placeholder={manual.tipo === 'MULTA' ? 'Ex.: Transitar em velocidade superior à máxima permitida em até 20%' : ''} />
            </Campo>
            <Campo label="Vencimento">
              <input type="date" value={manual.dataVencimento} onChange={e => setManual({ ...manual, dataVencimento: e.target.value })} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" />
            </Campo>
            <Campo label="Observação" className="sm:col-span-2">
              <textarea value={manual.observacao} onChange={e => setManual({ ...manual, observacao: e.target.value })} rows={2} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" />
            </Campo>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setManual(null)} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-[#E2E8F0]">Cancelar</button>
            <button onClick={salvarManual} disabled={salvandoManual} className="px-4 py-2 rounded-lg text-xs font-black uppercase bg-[#0C1D4D] text-white hover:bg-[#284B8C] disabled:opacity-50">
              {salvandoManual ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================================================================
// Relatórios: ranking por condutor / veículo / órgão + exportação Excel
// ============================================================================
function Relatorios({ debitos, veiculoPorId, empresaNome }: {
  debitos: DebitoMulta[]; veiculoPorId: Map<string, VeiculoMultas>; empresaNome: (id: number | null) => string;
}) {
  const [periodo, setPeriodo] = useState<'12M' | 'ANO' | 'TUDO'>('12M');

  const base = useMemo(() => {
    const hoje = hojeIso();
    const corte = periodo === '12M' ? `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}` : periodo === 'ANO' ? `${hoje.slice(0, 4)}-01-01` : '0000';
    // Cancelado (recurso deferido etc.) não conta como custo.
    return debitos.filter(d => d.status !== 'CANCELADO' && (d.data_infracao || d.data_vencimento || d.created_at.slice(0, 10)) >= corte);
  }, [debitos, periodo]);

  const multas = base.filter(d => d.tipo === 'MULTA');

  const agrupar = (lista: DebitoMulta[], chave: (d: DebitoMulta) => string) => {
    const m = new Map<string, { qtd: number; valor: number; nic: number; aberto: number }>();
    lista.forEach(d => {
      const k = chave(d);
      const a = m.get(k) || { qtd: 0, valor: 0, nic: 0, aberto: 0 };
      a.qtd++; a.valor += d.valor; if (d.eh_nic) a.nic++; if (d.status === 'ABERTO') a.aberto += d.valor;
      m.set(k, a);
    });
    return Array.from(m.entries()).map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.valor - a.valor);
  };

  const porCondutor = agrupar(multas, d => d.condutor_nome || '— sem condutor definido —');
  const porVeiculo = agrupar(base, d => { const v = veiculoPorId.get(d.veiculo_id); return v ? `${v.apelido} (${v.placa})` : '—'; });
  const porOrgao = agrupar(multas, d => d.orgao_autuador || '—');
  const nics = multas.filter(d => d.eh_nic);

  const exportar = () => {
    const linhas = base.map(d => {
      const v = veiculoPorId.get(d.veiculo_id);
      return {
        Empresa: empresaNome(d.empresa_id), Veículo: v?.apelido || '', Placa: v?.placa || '', Propriedade: v?.propriedade || '',
        Tipo: LABEL_TIPO[d.tipo], 'Não ident. condutor': d.eh_nic ? 'SIM' : '', AIT: d.auto_infracao || '', Descrição: d.descricao || '',
        'Órgão autuador': d.orgao_autuador || '', 'Data infração': fmtData(d.data_infracao).replace('—', ''), Hora: fmtHora(d.hora_infracao),
        Local: [d.local_infracao, d.municipio].filter(Boolean).join(' — '), Valor: d.valor, Vencimento: fmtData(d.data_vencimento).replace('—', ''),
        Situação: SELO_SITUACAO[situacao(d)].label, Condutor: d.condutor_nome || '',
        'Desconto em folha': d.desconto_lancado_em ? `${d.desconto_parcelas}x ${fmtBRL(d.desconto_valor_parcela)} a partir de ${d.desconto_mes_inicio}` : '',
        OP: d.op && d.op.status !== 'REPROVADA' ? `#${d.op.numero_op} (${d.op.status})` : '', Origem: d.origem === 'MANUAL' ? 'Manual' : 'Consulta Detran',
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Débitos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porCondutor.map(r => ({ Condutor: r.nome, Multas: r.qtd, 'Valor total': r.valor, 'Não ident. condutor': r.nic, 'Em aberto': r.aberto }))), 'Por condutor');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porVeiculo.map(r => ({ Veículo: r.nome, Débitos: r.qtd, 'Valor total': r.valor, 'Não ident. condutor': r.nic, 'Em aberto': r.aberto }))), 'Por veículo');
    XLSX.writeFile(wb, `multas-e-debitos-${hojeIso()}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">Período (data da infração)</span>
        {([['12M', 'Últimos 12 meses'], ['ANO', 'Este ano'], ['TUDO', 'Tudo']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setPeriodo(k)} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border ${periodo === k ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white text-[#0C1D4D] border-[#E2E8F0]'}`}>{l}</button>
        ))}
        <span className="flex-1" />
        <button onClick={exportar} disabled={base.length === 0} className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">📥 Exportar Excel</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi titulo="Multas no período" valor={String(multas.length)} sub={fmtBRL(multas.reduce((s, d) => s + d.valor, 0))} />
        <Kpi titulo="Não identificação do condutor" valor={String(nics.length)} sub={fmtBRL(nics.reduce((s, d) => s + d.valor, 0))} destaque={nics.length > 0} />
        <Kpi titulo="Com desconto em folha" valor={String(multas.filter(d => d.desconto_lancado_em).length)} sub={fmtBRL(multas.filter(d => d.desconto_lancado_em).reduce((s, d) => s + d.valor, 0))} />
        <Kpi titulo="Sem condutor definido" valor={String(multas.filter(d => !d.condutor_nome).length)} sub={fmtBRL(multas.filter(d => !d.condutor_nome).reduce((s, d) => s + d.valor, 0))} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TabelaRanking titulo="👤 Multas por condutor" colNome="Condutor" linhas={porCondutor} colQtd="Multas" />
        <TabelaRanking titulo="🚚 Débitos por veículo" colNome="Veículo" linhas={porVeiculo} colQtd="Débitos" />
        <TabelaRanking titulo="🏛️ Multas por órgão autuador" colNome="Órgão" linhas={porOrgao} colQtd="Multas" />
      </div>
    </div>
  );
}

function TabelaRanking({ titulo, colNome, colQtd, linhas }: { titulo: string; colNome: string; colQtd: string; linhas: { nome: string; qtd: number; valor: number; nic: number; aberto: number }[] }) {
  const max = Math.max(1, ...linhas.map(l => l.valor));
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      <p className="px-4 pt-4 pb-2 text-[10px] font-black uppercase tracking-wider text-gray-500">{titulo}</p>
      {linhas.length === 0 ? <p className="px-4 pb-4 text-xs text-gray-400">Nada no período.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-gray-400 text-left">
                <th className="px-4 py-2">{colNome}</th><th className="px-2 py-2 text-right">{colQtd}</th><th className="px-2 py-2 text-right">NIC</th>
                <th className="px-2 py-2 text-right">Em aberto</th><th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.nome} className="border-t border-[#F1F5F9]">
                  <td className="px-4 py-2">
                    <div className="font-bold text-[#0C1D4D]">{l.nome}</div>
                    <div className="h-1.5 mt-1 rounded-full bg-[#F1F5F9]"><div className="h-1.5 rounded-full bg-rose-400" style={{ width: `${(l.valor / max) * 100}%` }} /></div>
                  </td>
                  <td className="px-2 py-2 text-right">{l.qtd}</td>
                  <td className={`px-2 py-2 text-right ${l.nic ? 'text-red-600 font-black' : 'text-gray-300'}`}>{l.nic || '—'}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">{l.aberto ? fmtBRL(l.aberto) : '—'}</td>
                  <td className="px-4 py-2 text-right font-black whitespace-nowrap">{fmtBRL(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Detalhe do débito: dados, NIC, condutor, desconto em folha, aviso, OP, status
// ============================================================================
function DetalheDebito({ debito: d, veiculo, empresaNome, origem, nicsDaOrigem, accessToken, onFechar, onAbrir, onAlterado, onEditarManual, onCriarOp }: {
  debito: DebitoMulta; veiculo: VeiculoMultas | null; empresaNome: string; origem: DebitoMulta | null; nicsDaOrigem: DebitoMulta[]; accessToken: string;
  onFechar: () => void; onAbrir: (id: string) => void; onAlterado: () => Promise<void>; onEditarManual: () => void; onCriarOp: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [salvando, setSalvando] = useState<string | null>(null);

  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [origemInfo, setOrigemInfo] = useState<OrigemNic | null>(null);
  const [escolhaManual, setEscolhaManual] = useState('');

  const [parcelas, setParcelas] = useState(1);
  const [mesInicio, setMesInicio] = useState(mesAtualIso());
  const [valorDesconto, setValorDesconto] = useState(String(d.valor.toFixed(2)).replace('.', ','));
  const [observacao, setObservacao] = useState(d.observacao || '');

  const s = SELO_SITUACAO[situacao(d)];
  const ehMulta = d.tipo === 'MULTA';

  useEffect(() => {
    if (!ehMulta) return;
    sugerirCondutorAction({ debitoId: d.id }, accessToken).then(res => {
      if (!res.ok) { toast(res.erro || 'Falha ao buscar o checklist.', 'error'); setCandidatos([]); return; }
      setCandidatos(res.info.candidatos);
      setMotoristas(res.info.motoristas);
      setOrigemInfo(res.info.origem || null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id]);

  const executar = async (chave: string, fn: () => Promise<{ ok: boolean; erro?: string; info?: { avisoEnviado?: boolean; avisoErro?: string | null } }>, msgOk: string) => {
    setSalvando(chave);
    const res = await fn();
    setSalvando(null);
    if (!res.ok) { toast(res.erro || 'Falha.', 'error'); return false; }
    toast(msgOk, 'success');
    if (res.info && 'avisoEnviado' in res.info) {
      if (res.info.avisoEnviado) toast('Condutor avisado por WhatsApp.', 'info');
      else if (res.info.avisoErro) toast(`WhatsApp ao condutor não enviado: ${res.info.avisoErro}`, 'info');
    }
    await onAlterado();
    return true;
  };

  const definirCondutor = (nome: string | null, checklistId: string | null) =>
    executar('condutor', () => definirCondutorAction({ debitoId: d.id, condutorNome: nome, checklistId }, accessToken), nome ? `Condutor definido: ${nome}` : 'Condutor removido.');

  const valorDescontoNum = Number(valorDesconto.replace(/\./g, '').replace(',', '.')) || 0;
  const valorParcela = parcelas > 0 ? Math.round((valorDescontoNum / parcelas) * 100) / 100 : 0;

  const lancarDesconto = async () => {
    const ok = await confirm({
      title: 'Lançar desconto em folha',
      message: `Lançar ${parcelas}x de ${fmtBRL(valorParcela)} no holerite de ${d.condutor_nome}, a partir de ${mesInicio.split('-').reverse().join('/')}? O desconto aparece em RH › Holerite › Bônus e Descontos, e o condutor é avisado por WhatsApp.${d.eh_nic ? '\n\nAtenção: esta é a multa por NÃO IDENTIFICAÇÃO do condutor — avalie se a falha de indicação foi dele.' : ''}`,
      confirmLabel: 'Lançar desconto',
    });
    if (!ok) return;
    await executar('desconto', () => lancarDescontoFolhaAction({ debitoId: d.id, parcelas, mesInicio, valorTotal: valorDescontoNum }, accessToken), 'Desconto lançado no Holerite.');
  };

  const avisarCondutor = async () => {
    if (!(await confirm({ message: `Enviar WhatsApp para ${d.condutor_nome} avisando desta multa?`, confirmLabel: 'Enviar' }))) return;
    await executar('aviso', () => avisarCondutorAction({ debitoId: d.id }, accessToken), 'Condutor avisado por WhatsApp.');
  };

  const mudarStatus = async (status: StatusDebito) => {
    const textos: Record<StatusDebito, string> = {
      PAGO: 'Marcar este débito como pago?',
      CANCELADO: 'Cancelar este débito (ex.: recurso deferido, multa indevida)? Ele sai da lista de abertos.',
      ABERTO: 'Reabrir este débito?',
    };
    if (!(await confirm({ message: textos[status], danger: status === 'CANCELADO' }))) return;
    await executar('status', () => atualizarStatusDebitoAction({ debitoId: d.id, status, observacao }, accessToken), 'Status atualizado.');
  };

  const excluir = async () => {
    if (!(await confirm({ message: 'Excluir este lançamento manual? Não tem como desfazer.', danger: true, confirmLabel: 'Excluir' }))) return;
    if (await executar('excluir', () => excluirDebitoManualAction({ debitoId: d.id }, accessToken), 'Lançamento excluído.')) onFechar();
  };

  const opAtiva = d.op && d.op.status !== 'REPROVADA' ? d.op : null;

  return (
    <Modal titulo={`${ICONE_TIPO[d.tipo]} ${LABEL_TIPO[d.tipo]}${d.auto_infracao ? ` · AIT ${d.auto_infracao}` : ''}`} onFechar={onFechar} largo>
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${s.cls}`}>{s.label}</span>
        {d.baixa_automatica && <span className="text-[10px] text-green-700 font-bold">baixado automaticamente (sumiu da consulta do Detran)</span>}
        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${corSeloEmpresa(d.empresa_id)}`}>{d.empresa_id === null ? '🌐 Todas as empresas' : empresaNome}</span>
        {d.origem === 'MANUAL' && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Manual</span>}
        {d.fonte === 'RENAINF' && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">RENAINF (outro estado)</span>}
        <span className="flex-1" />
        <span className="text-2xl font-black text-[#0C1D4D]">{fmtBRL(d.valor)}</span>
      </div>

      {/* NIC: ligação com a infração original */}
      {d.eh_nic && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-xs">
          <p className="font-black text-red-700 uppercase text-[10px] tracking-wider mb-1">⚠ Multa por não identificação do condutor</p>
          <p className="text-red-800">Cobrada da empresa porque o condutor da infração original não foi indicado no prazo.</p>
          {origem ? (
            <button onClick={() => onAbrir(origem.id)} className="mt-2 text-left underline font-bold text-red-800">
              Infração original: AIT {origem.auto_infracao || 'S/N'} · {fmtData(origem.data_infracao)} {fmtHora(origem.hora_infracao)} · {fmtBRL(origem.valor)}{origem.condutor_nome ? ` · condutor ${origem.condutor_nome}` : ''} →
            </button>
          ) : (
            <p className="mt-2 text-red-700">Infração original não encontrada no sistema — provavelmente já foi paga e saiu do Detran antes da primeira consulta.</p>
          )}
        </div>
      )}
      {nicsDaOrigem.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          ⚠ Esta infração gerou {nicsDaOrigem.length} multa(s) por não identificação do condutor ({fmtBRL(nicsDaOrigem.reduce((s2, n) => s2 + n.valor, 0))}):{' '}
          {nicsDaOrigem.map(n => <button key={n.id} onClick={() => onAbrir(n.id)} className="underline font-bold mr-2">AIT {n.auto_infracao || 'S/N'}</button>)}
        </div>
      )}

      {/* Dados */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 bg-[#F8FAFC] rounded-xl p-4 text-xs mb-4">
        <Info label="Veículo" valor={veiculo ? `${veiculo.apelido} · ${veiculo.placa}` : '—'} />
        <Info label="Vencimento" valor={fmtData(d.data_vencimento)} />
        {ehMulta && <Info label={d.eh_nic ? 'Data da NIC' : 'Infração'} valor={`${fmtData(d.data_infracao)} ${fmtHora(d.hora_infracao)}`} />}
        {ehMulta && <Info label="Órgão autuador" valor={d.orgao_autuador || '—'} />}
        {ehMulta && <Info label="Local" valor={[d.local_infracao, d.municipio].filter(Boolean).join(' — ') || '—'} className="col-span-2" />}
        {!ehMulta && <Info label="Exercício" valor={d.exercicio || '—'} />}
        {d.cota && <Info label="Cota" valor={d.cota} />}
        <Info label="Descrição" valor={d.descricao || '—'} className="col-span-2 md:col-span-3" />
        <Info label="Na consulta desde" valor={fmtDataHora(d.primeira_consulta_em || d.created_at)} />
        <Info label="Última consulta" valor={fmtDataHora(d.ultima_consulta_em)} />
        {d.status_alterado_por && <Info label="Status alterado por" valor={`${d.status_alterado_por}${d.pago_em ? ` em ${fmtDataHora(d.pago_em)}` : ''}`} />}
      </div>

      {/* Condutor */}
      {ehMulta && (
        <Secao titulo="👤 Condutor responsável">
          {d.condutor_nome ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-black text-[#0C1D4D]">{d.condutor_nome}</p>
                <p className="text-[10px] text-gray-500">Confirmado por {d.condutor_confirmado_por} em {fmtDataHora(d.condutor_confirmado_em)}{d.condutor_checklist_id ? ' · pelo checklist' : ' · escolha manual'}</p>
                {d.condutor_avisado_em && <p className="text-[10px] text-sky-700 font-bold">📲 Avisado por WhatsApp em {fmtDataHora(d.condutor_avisado_em)} ({d.condutor_avisado_por})</p>}
              </div>
              <div className="flex gap-3 items-center">
                <button onClick={avisarCondutor} disabled={!!salvando} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">
                  {salvando === 'aviso' ? 'Enviando...' : d.condutor_avisado_em ? '📲 Avisar de novo' : '📲 Avisar condutor'}
                </button>
                {!d.desconto_lancado_em && (
                  <button onClick={() => definirCondutor(null, null)} disabled={!!salvando} className="text-[10px] font-black uppercase text-red-600 underline">Trocar</button>
                )}
              </div>
            </div>
          ) : (
            <>
              {d.eh_nic && origemInfo && !origemInfo.condutor_nome && (
                <p className="text-[10px] text-gray-500 mb-2">Buscando quem dirigia na infração original (AIT {origemInfo.auto_infracao || 'S/N'}, {fmtData(origemInfo.data_infracao)} {fmtHora(origemInfo.hora_infracao)}).</p>
              )}
              {candidatos === null ? <p className="text-xs text-gray-400">Buscando no checklist de veículos...</p>
                : candidatos.length === 0 ? <p className="text-xs text-gray-500">Nenhum checklist de saída/retorno deste veículo cobre a data {d.eh_nic && origemInfo ? 'da infração original' : 'da infração'}. Escolha o condutor manualmente.</p>
                : (
                  <div className="space-y-2 mb-3">
                    {candidatos.map((c, i) => (
                      <div key={`${c.checklist_id || 'origem'}-${i}`} className={`flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border ${c.precisao !== 'DIA' ? 'border-emerald-300 bg-emerald-50' : 'border-[#E2E8F0] bg-white'}`}>
                        <div className="text-xs">
                          <p className="font-black text-[#0C1D4D]">
                            {c.motorista_nome}{' '}
                            {c.precisao === 'ORIGEM' ? <span className="text-emerald-700 text-[10px]">✔ condutor já confirmado na infração original</span>
                              : c.precisao === 'HORARIO' ? <span className="text-emerald-700 text-[10px]">✔ estava com o veículo no horário</span>
                              : <span className="text-amber-600 text-[10px]">usou o veículo no dia</span>}
                          </p>
                          {c.numero !== null && <p className="text-[10px] text-gray-500">CKL-VEI-{String(c.numero).padStart(6, '0')} · saída {fmtDataHora(c.saida_em)} · retorno {c.retorno_em ? fmtDataHora(c.retorno_em) : 'sem retorno'}{c.destino ? ` · ${c.destino}` : ''}</p>}
                        </div>
                        <button onClick={() => definirCondutor(c.motorista_nome, c.checklist_id)} disabled={!!salvando}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Confirmar</button>
                      </div>
                    ))}
                  </div>
                )}
              <div className="flex gap-2">
                <select value={escolhaManual} onChange={e => setEscolhaManual(e.target.value)} className="flex-1 p-2 border border-[#E2E8F0] rounded-lg text-xs">
                  <option value="">Escolher outro colaborador...</option>
                  {motoristas.map(m => <option key={m.nome} value={m.nome}>{m.nome}{m.pode_dirigir ? ' 🚗' : ''}</option>)}
                </select>
                <button onClick={() => escolhaManual && definirCondutor(escolhaManual, null)} disabled={!escolhaManual || !!salvando}
                  className="px-3 py-2 rounded-lg text-[10px] font-black uppercase bg-[#0C1D4D] text-white disabled:opacity-50">Definir</button>
              </div>
            </>
          )}
        </Secao>
      )}

      {/* Desconto em folha */}
      {ehMulta && d.condutor_nome && (
        <Secao titulo="💸 Desconto em folha">
          {d.desconto_lancado_em ? (
            <div className="text-xs">
              <p className="font-black text-emerald-700">{d.desconto_parcelas}x de {fmtBRL(d.desconto_valor_parcela)} a partir de {(d.desconto_mes_inicio || '').split('-').reverse().join('/')}</p>
              <p className="text-[10px] text-gray-500">“{d.desconto_descricao}” · lançado por {d.desconto_lancado_por} em {fmtDataHora(d.desconto_lancado_em)}. Ajustes ou exclusão: RH › Holerite › Bônus e Descontos.</p>
            </div>
          ) : d.status === 'CANCELADO' ? (
            <p className="text-xs text-gray-500">Débito cancelado — sem desconto.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
              <Campo label="Valor a descontar">
                <input inputMode="decimal" value={valorDesconto} onChange={e => setValorDesconto(e.target.value)} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" />
              </Campo>
              <Campo label="Parcelas">
                <select value={parcelas} onChange={e => setParcelas(Number(e.target.value))} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}x</option>)}
                </select>
              </Campo>
              <Campo label="1º desconto em">
                <input type="month" value={mesInicio} min={mesAtualIso()} onChange={e => setMesInicio(e.target.value)} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" />
              </Campo>
              <button onClick={lancarDesconto} disabled={!!salvando || !(valorDescontoNum > 0) || !mesInicio}
                className="px-3 py-2.5 rounded-lg text-[10px] font-black uppercase bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                {salvando === 'desconto' ? 'Lançando...' : `Lançar ${parcelas}x ${fmtBRL(valorParcela)}`}
              </button>
            </div>
          )}
        </Secao>
      )}

      {/* Pagamento (OP) */}
      <Secao titulo="💳 Pagamento">
        {opAtiva ? (
          <p className="text-xs"><span className="font-black text-indigo-700">OP #{opAtiva.numero_op}</span> · {opAtiva.status}{opAtiva.pago_em ? ` · paga em ${fmtDataHora(opAtiva.pago_em)}` : ''}. Acompanhe em Financeiro › OPs.</p>
        ) : d.status === 'ABERTO' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">{d.op?.status === 'REPROVADA' ? `A OP #${d.op.numero_op} foi reprovada. ` : ''}Gera a OP pré-preenchida (natureza Multas e Débitos Veiculares). Para pagar várias de uma vez, marque-as na lista e use “Gerar uma OP”.</p>
            <button onClick={onCriarOp} className="px-3 py-2 rounded-lg text-[10px] font-black uppercase bg-indigo-600 text-white hover:bg-indigo-700">Criar OP de pagamento</button>
          </div>
        ) : <p className="text-xs text-gray-500">Sem OP.</p>}
      </Secao>

      {/* Observação + status */}
      <Secao titulo="📝 Observação">
        <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2} className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm" placeholder="Ex.: recurso protocolado em 10/11, indicação de condutor enviada..." />
        {observacao !== (d.observacao || '') && (
          <button onClick={() => executar('obs', () => salvarObservacaoDebitoAction({ debitoId: d.id, observacao }, accessToken), 'Observação salva.')}
            disabled={!!salvando} className="mt-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-[#0C1D4D] text-white disabled:opacity-50">Salvar observação</button>
        )}
      </Secao>

      <div className="flex flex-wrap justify-end gap-2 mt-4 pt-4 border-t border-[#F1F5F9]">
        {d.origem === 'MANUAL' && (
          <>
            <button onClick={excluir} disabled={!!salvando} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-red-200 text-red-600 hover:bg-red-50">Excluir</button>
            <button onClick={onEditarManual} disabled={!!salvando} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-[#E2E8F0] text-[#0C1D4D]">Editar</button>
          </>
        )}
        {d.status === 'ABERTO' ? (
          <>
            <button onClick={() => mudarStatus('CANCELADO')} disabled={!!salvando} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-[#E2E8F0] text-gray-600">Cancelar débito</button>
            <button onClick={() => mudarStatus('PAGO')} disabled={!!salvando} className="px-4 py-2 rounded-lg text-xs font-black uppercase bg-green-600 text-white hover:bg-green-700">Marcar como pago</button>
          </>
        ) : (
          <button onClick={() => mudarStatus('ABERTO')} disabled={!!salvando} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-[#E2E8F0] text-[#0C1D4D]">Reabrir</button>
        )}
      </div>
    </Modal>
  );
}

// ============================================================================
// Componentes pequenos
// ============================================================================
function Kpi({ titulo, valor, sub, destaque, onClick }: { titulo: string; valor: string; sub?: string; destaque?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`text-left bg-white p-4 rounded-2xl border shadow-sm ${destaque ? 'border-red-200' : 'border-[#E2E8F0]'} ${onClick ? 'hover:shadow-md hover:border-red-400 transition-all' : ''}`}>
      <p className={`text-xl md:text-2xl font-black leading-tight ${destaque ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{valor}</p>
      <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider leading-tight mt-1">{titulo}</p>
      {sub && <p className="text-[9px] text-gray-400 font-medium mt-1 truncate">{sub}</p>}
    </Tag>
  );
}

function Modal({ titulo, onFechar, children, largo }: { titulo: string; onFechar: () => void; children: React.ReactNode; largo?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start md:items-center justify-center p-3 overflow-y-auto" onClick={onFechar}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${largo ? 'max-w-3xl' : 'max-w-xl'} my-6`} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-5 py-4 border-b border-[#F1F5F9]">
          <h3 className="font-black text-[#0C1D4D] uppercase tracking-wide text-sm">{titulo}</h3>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fechar">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#E2E8F0] rounded-xl p-4 mb-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-gray-500 mb-2">{titulo}</p>
      {children}
    </div>
  );
}

function Campo({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-[9px] font-black uppercase tracking-wider text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Info({ label, valor, className = '' }: { label: string; valor: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[9px] font-black uppercase tracking-wider text-gray-400">{label}</p>
      <p className="font-bold text-[#0C1D4D] break-words">{valor}</p>
    </div>
  );
}
