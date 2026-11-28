"use client";

// Aba "Por Colaborador" de /admin/rh/assinaturas: escolhe uma pessoa e vê
// tudo dela num lugar só — holerites de todos os meses, documentos avulsos e
// TRCT (com status e datas), os holerites fechados que nunca foram enviados
// e os documentos oficiais de RH → Documentos, com a validade. Os botões são
// os mesmos das outras abas (consultar status, baixar assinado, cancelar).
// Abre direto numa pessoa com ?aba=colaborador&funcionario=<id> (atalho da
// Ficha do Funcionário).
import { useEffect, useMemo, useState } from 'react';
import { colaboradoresAssinaturaAction, dossieAssinaturasAction, urlDocumentoColaboradorAction } from '../actions/actions-assinaturas-colaborador';
import { consultarAssinaturaAction, baixarAssinadoAction, cancelarAssinaturaAction } from '../actions/actions-assinatura';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';

type Tipo = 'HOLERITE' | 'AVULSO' | 'RESCISAO' | 'DECIMO_TERCEIRO';
interface Colaborador { id: string; nome: string; cargo: string; empresaId: number | null; ativo: boolean; total: number; assinados: number; pendentes: number; rejeitados: number }
interface ItemAssinatura {
  id: number; tipo: Tipo; titulo: string; mesReferencia: string; competencia: string | null; rescisaoId: number | null;
  status: string; sandbox: boolean; temAssinado: boolean; temLink: boolean;
  enviadoPor: string | null; enviadoEm: string | null; visualizadoEm: string | null; assinadoEm: string | null;
  canceladoPor: string | null; canceladoEm: string | null;
}
interface Documento {
  id: number; categoria: string; exigeValidade: boolean; titulo: string; arquivo: string; validade: string | null;
  situacao: 'VENCIDO' | 'VENCENDO' | 'OK' | 'SEM'; dias: number | null; historico: boolean;
  enviadoEm: string; enviadoPor: string | null; visivelPortal: boolean; observacao: string;
}
interface Dossie {
  colaborador: { id: string; nome: string; cpf: string | null; cargo: string; departamento: string; tipoContrato: string; empresaId: number | null; empresa: string; ativo: boolean; dataAdmissao: string | null; dataDesligamento: string | null };
  assinaturas: ItemAssinatura[];
  holeritesSemEnvio: { mesReferencia: string; fechadoEm: string; valorLiquido: number }[];
  documentos: Documento[];
}

const STATUS: Record<string, { label: string; cor: string; bg: string; icone: string }> = {
  ENVIADO: { label: 'Enviado', cor: '#4F46E5', bg: '#EEF2FF', icone: '📤' },
  VISUALIZADO: { label: 'Visualizado', cor: '#2563EB', bg: '#EFF6FF', icone: '👁' },
  ASSINADO: { label: 'Assinado', cor: '#16A34A', bg: '#F0FDF4', icone: '✅' },
  REJEITADO: { label: 'Rejeitado', cor: '#DC2626', bg: '#FEF2F2', icone: '✖' },
  PENDENTE: { label: 'Pendente', cor: '#64748B', bg: '#F8FAFC', icone: '⏳' },
  CANCELADO: { label: 'Cancelado', cor: '#94A3B8', bg: '#F1F5F9', icone: '🚫' },
};
const TIPO: Record<Tipo, { label: string; icone: string }> = {
  HOLERITE: { label: 'Holerite', icone: '💰' },
  AVULSO: { label: 'Documento avulso', icone: '📎' },
  RESCISAO: { label: 'Rescisão (TRCT)', icone: '📤' },
  DECIMO_TERCEIRO: { label: '13º Salário', icone: '🎄' },
};
const SITUACAO_DOC: Record<Documento['situacao'], { label: string; classe: string }> = {
  VENCIDO: { label: 'Vencido', classe: 'bg-red-100 text-red-700 border-red-300' },
  VENCENDO: { label: 'Vencendo', classe: 'bg-amber-100 text-amber-800 border-amber-300' },
  OK: { label: 'Em dia', classe: 'bg-green-100 text-green-800 border-green-300' },
  SEM: { label: 'Sem validade', classe: 'bg-gray-100 text-gray-600 border-gray-300' },
};
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const mesBR = (aaaamm: string | null) => (aaaamm ? aaaamm.split('-').reverse().join('/') : '');
const pendente = (s: string) => s === 'ENVIADO' || s === 'VISUALIZADO' || s === 'PENDENTE';

export default function AssinaturasPorColaborador({ accessToken, usuarioAtual, empresasVisiveis, funcionarioInicial }: {
  accessToken: string;
  usuarioAtual: string;
  empresasVisiveis: { id: number; nome: string }[];
  funcionarioInicial: string | null;
}) {
  const toast = useToast();
  const confirmar = useConfirm();

  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroEmpresa, setFiltroEmpresa] = useState('TODAS');
  const [mostrarDesligados, setMostrarDesligados] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(funcionarioInicial);

  const [dossie, setDossie] = useState<Dossie | null>(null);
  const [carregandoDossie, setCarregandoDossie] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | Tipo>('TODOS');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verHistoricoDocs, setVerHistoricoDocs] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let vivo = true;
    setCarregandoLista(true);
    colaboradoresAssinaturaAction(accessToken)
      .then(r => { if (!vivo) return; if (r.ok) setColaboradores(r.info.colaboradores); else toast(r.erro || 'Erro ao listar colaboradores.', 'error'); })
      .finally(() => vivo && setCarregandoLista(false));
    return () => { vivo = false; };
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // pessoa aberta pelo atalho da Ficha que está desligada: mostra os desligados
  useEffect(() => {
    if (funcionarioInicial && colaboradores.some(c => c.id === funcionarioInicial && !c.ativo)) setMostrarDesligados(true);
  }, [colaboradores, funcionarioInicial]);

  const carregarDossie = async (id: string) => {
    setCarregandoDossie(true);
    try {
      const r = await dossieAssinaturasAction({ funcionarioId: id }, accessToken);
      if (!r.ok) { toast(r.erro || 'Erro ao carregar.', 'error'); setDossie(null); return; }
      setDossie(r.info);
    } finally {
      setCarregandoDossie(false);
    }
  };
  useEffect(() => { if (selecionado && accessToken) carregarDossie(selecionado); else setDossie(null); }, [selecionado, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return colaboradores.filter(c =>
      (mostrarDesligados || c.ativo || c.id === selecionado) &&
      (filtroEmpresa === 'TODAS' || String(c.empresaId) === filtroEmpresa) &&
      (!t || c.nome.toLowerCase().includes(t)));
  }, [colaboradores, busca, filtroEmpresa, mostrarDesligados, selecionado]);

  const itens = useMemo(() => (dossie?.assinaturas || []).filter(a => filtroTipo === 'TODOS' || a.tipo === filtroTipo), [dossie, filtroTipo]);
  const resumo = useMemo(() => {
    const a = (dossie?.assinaturas || []).filter(x => x.status !== 'CANCELADO');
    return {
      assinados: a.filter(x => x.status === 'ASSINADO').length,
      pendentes: a.filter(x => pendente(x.status)).length,
      rejeitados: a.filter(x => x.status === 'REJEITADO').length,
      semEnvio: dossie?.holeritesSemEnvio.length || 0,
      docsAlerta: (dossie?.documentos || []).filter(d => !d.historico && (d.situacao === 'VENCIDO' || d.situacao === 'VENCENDO')).length,
    };
  }, [dossie]);
  const documentosVisiveis = (dossie?.documentos || []).filter(d => verHistoricoDocs || !d.historico);

  // ---- ações (as mesmas das outras abas) ----
  const ref = (a: ItemAssinatura) => ({ funcionarioId: dossie!.colaborador.id, funcionarioNome: dossie!.colaborador.nome, mesReferencia: a.mesReferencia });
  const consultar = async (a: ItemAssinatura) => {
    setOcupado(`c${a.id}`);
    try {
      const r = await consultarAssinaturaAction(ref(a), accessToken);
      if (!r.ok) throw new Error(r.erro);
      await carregarDossie(dossie!.colaborador.id);
    } catch (e: any) { toast('Erro ao atualizar status: ' + e.message, 'error'); } finally { setOcupado(null); }
  };
  const baixar = async (a: ItemAssinatura) => {
    setOcupado(`b${a.id}`);
    try {
      const r = await baixarAssinadoAction(ref(a), accessToken);
      if (!r.ok) throw new Error(r.erro);
      window.open(r.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { toast('Erro ao abrir o documento assinado: ' + e.message, 'error'); } finally { setOcupado(null); }
  };
  const cancelar = async (a: ItemAssinatura) => {
    if (!(await confirmar(`Cancelar o envio de "${a.titulo}" para ${dossie!.colaborador.nome}?\n\nO link de assinatura deixa de funcionar e o registro fica marcado como CANCELADO (não é apagado).`))) return;
    setOcupado(`x${a.id}`);
    try {
      const r = await cancelarAssinaturaAction({ ...ref(a), canceladoPor: usuarioAtual }, accessToken);
      if (!r.ok) throw new Error(r.erro);
      toast('Envio cancelado.', 'success');
      await carregarDossie(dossie!.colaborador.id);
    } catch (e: any) { toast('Erro ao cancelar: ' + e.message, 'error'); } finally { setOcupado(null); }
  };
  const abrirDocumento = async (d: Documento, download = false) => {
    setOcupado(`d${d.id}`);
    try {
      const r = await urlDocumentoColaboradorAction({ id: d.id, download }, accessToken);
      if (!r.ok) throw new Error(r.erro);
      window.open(r.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { toast('Erro ao abrir o documento: ' + e.message, 'error'); } finally { setOcupado(null); }
  };

  const exportarExcel = async () => {
    if (!dossie) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const add = (dados: Record<string, any>[], nome: string, vazio: string) => {
        const linhas = dados.length ? dados : [{ Aviso: vazio }];
        const ws = XLSX.utils.json_to_sheet(linhas);
        ws['!cols'] = Object.keys(linhas[0]).map(k => ({ wch: Math.min(45, Math.max(k.length + 2, ...linhas.map(l => String(l[k] ?? '').length + 1))) }));
        XLSX.utils.book_append_sheet(wb, ws, nome);
      };
      add(dossie.assinaturas.map(a => ({
        'Tipo': TIPO[a.tipo].label, 'Documento': a.titulo, 'Competência': mesBR(a.competencia),
        'Status': STATUS[a.status]?.label || a.status, 'Enviado em': dataHora(a.enviadoEm), 'Enviado por': a.enviadoPor || '',
        'Visualizado em': dataHora(a.visualizadoEm), 'Assinado em': dataHora(a.assinadoEm),
        'Cancelado em': dataHora(a.canceladoEm), 'Cancelado por': a.canceladoPor || '', 'Ambiente': a.sandbox ? 'Teste' : 'Produção',
      })), 'Assinaturas', 'Nada enviado para assinar');
      add(dossie.holeritesSemEnvio.map(h => ({ 'Competência': mesBR(h.mesReferencia), 'Folha fechada em': dataHora(h.fechadoEm), 'Líquido': formatarMoeda(h.valorLiquido) })), 'Holerites sem envio', 'Todos os holerites fechados foram enviados');
      add(dossie.documentos.map(d => ({
        'Categoria': d.categoria, 'Título': d.titulo, 'Validade': formatarDataBR(d.validade, ''), 'Situação': SITUACAO_DOC[d.situacao].label,
        'Versão': d.historico ? 'Histórico' : 'Atual', 'Enviado em': dataHora(d.enviadoEm), 'Visível no Portal': d.visivelPortal ? 'Sim' : 'Não', 'Arquivo': d.arquivo, 'Observação': d.observacao,
      })), 'Documentos oficiais', 'Nenhum documento em RH → Documentos');
      const slug = dossie.colaborador.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      XLSX.writeFile(wb, `assinaturas-${slug}-${new Date().toLocaleDateString('sv-SE')}.xlsx`);
    } catch (e: any) {
      toast('Não foi possível gerar o Excel: ' + e.message, 'error');
    }
  };

  const btn = 'text-[10px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 whitespace-nowrap';

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* ===== lista de colaboradores ===== */}
      <aside className="w-full lg:w-80 flex-shrink-0 space-y-3">
        <div className="bg-[#0C1D4D] p-4 rounded-2xl shadow-md text-white space-y-2">
          <h2 className="font-black uppercase tracking-wider text-sm">Colaboradores</h2>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome..." className="w-full p-2.5 rounded-lg text-sm text-white bg-[#1E3A6E] outline-none font-bold placeholder:text-blue-200" />
          {empresasVisiveis.length > 1 && (
            <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} className="w-full p-2.5 rounded-lg text-sm text-white bg-[#1E3A6E] outline-none font-bold cursor-pointer">
              <option value="TODAS">Todas as empresas</option>
              {empresasVisiveis.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 text-[11px] font-bold text-blue-100 cursor-pointer">
            <input type="checkbox" checked={mostrarDesligados} onChange={e => setMostrarDesligados(e.target.checked)} /> Mostrar desligados
          </label>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden max-h-[65vh] overflow-y-auto overscroll-contain">
          {carregandoLista && <p className="p-6 text-center text-xs font-bold text-gray-400 uppercase">Carregando...</p>}
          {!carregandoLista && lista.length === 0 && <p className="p-6 text-center text-xs font-bold text-gray-400 uppercase">Ninguém com esses filtros.</p>}
          {lista.map(c => (
            <button key={c.id} onClick={() => setSelecionado(c.id)}
              className={`w-full text-left p-3 border-b border-[#E2E8F0] transition-colors ${selecionado === c.id ? 'bg-blue-50 border-l-4 border-l-[#336699]' : 'hover:bg-gray-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <strong className={`block text-xs uppercase tracking-wide ${c.ativo ? 'text-[#0C1D4D]' : 'text-gray-400 line-through'}`}>{c.nome}</strong>
                {c.pendentes > 0 && <span className="text-[9px] font-black bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full flex-shrink-0" title="Aguardando assinatura">{c.pendentes} pend.</span>}
              </div>
              <span className="text-[10px] text-gray-500 font-medium">{c.cargo || 'Sem função'} • {c.assinados} assinado(s){c.rejeitados ? ` • ${c.rejeitados} rejeitado(s)` : ''}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* ===== dossiê ===== */}
      <main className="flex-grow min-w-0 space-y-4">
        {!selecionado && (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
            Escolha um colaborador na lista para ver tudo o que ele assinou.
          </div>
        )}
        {selecionado && carregandoDossie && !dossie && (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando...</div>
        )}
        {dossie && (<>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col md:flex-row justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">{dossie.colaborador.nome}</h2>
              <p className="text-xs text-gray-500 font-bold">
                {[dossie.colaborador.cargo, dossie.colaborador.departamento, dossie.colaborador.tipoContrato].filter(Boolean).join(' • ')}
                {dossie.colaborador.dataAdmissao && ` • Admissão ${formatarDataBR(dossie.colaborador.dataAdmissao)}`}
                {!dossie.colaborador.ativo && ` • Desligado${dossie.colaborador.dataDesligamento ? ` em ${formatarDataBR(dossie.colaborador.dataDesligamento)}` : ''}`}
              </p>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase inline-block mt-1 ${corSeloEmpresa(dossie.colaborador.empresaId)}`}>{dossie.colaborador.empresa || 'Sem empresa'}</span>
            </div>
            <div className="flex items-start gap-2">
              <button onClick={() => carregarDossie(dossie.colaborador.id)} disabled={carregandoDossie} className={`${btn} border-[#CBD5E1] text-gray-600 hover:bg-gray-50`}>{carregandoDossie ? '...' : '↻ Recarregar'}</button>
              <button onClick={exportarExcel} className={`${btn} border-[#16A34A] bg-[#16A34A] text-white hover:bg-[#15803D]`}>📗 Excel</button>
            </div>
          </div>

          {/* resumo */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { t: 'Assinados', v: resumo.assinados, c: '#16A34A' },
              { t: 'Aguardando', v: resumo.pendentes, c: '#4F46E5' },
              { t: 'Rejeitados', v: resumo.rejeitados, c: '#DC2626' },
              { t: 'Holerites sem envio', v: resumo.semEnvio, c: '#D97706' },
              { t: 'Docs vencidos/vencendo', v: resumo.docsAlerta, c: '#DC2626' },
            ].map(k => (
              <div key={k.t} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-3 text-center">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{k.t}</p>
                <p className="text-2xl font-black" style={{ color: k.v > 0 ? k.c : '#CBD5E1' }}>{k.v}</p>
              </div>
            ))}
          </div>

          {/* holerites fechados sem envio */}
          {dossie.holeritesSemEnvio.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-[11px] font-black text-amber-800 uppercase tracking-wider mb-1">⚠ Holerite fechado na folha e não enviado para assinatura</p>
              <p className="text-xs text-amber-800">
                {dossie.holeritesSemEnvio.map(h => mesBR(h.mesReferencia)).join(', ')} — envie pela aba Holerites (escolha o mês) ou pela página Holerite.
              </p>
            </div>
          )}

          {/* assinaturas */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="p-4 border-b border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">✍️ Enviados para assinatura ({dossie.assinaturas.length})</h3>
              <div className="flex bg-gray-100 p-1 rounded-xl">
                {(['TODOS', 'HOLERITE', 'DECIMO_TERCEIRO', 'AVULSO', 'RESCISAO'] as const).map(t => (
                  <button key={t} onClick={() => setFiltroTipo(t)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg ${filtroTipo === t ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                    {t === 'TODOS' ? 'Todos' : t === 'HOLERITE' ? 'Holerites' : t === 'DECIMO_TERCEIRO' ? '13º' : t === 'AVULSO' ? 'Avulsos' : 'Rescisão'}
                  </button>
                ))}
              </div>
            </div>
            {itens.length === 0 ? (
              <p className="p-10 text-center text-xs font-bold text-gray-400 uppercase">Nada enviado para assinar{filtroTipo !== 'TODOS' ? ' neste tipo' : ''}.</p>
            ) : (
              <div className="divide-y divide-[#F1F5F9]">
                {itens.map(a => {
                  const st = STATUS[a.status] || STATUS.PENDENTE;
                  return (
                    <div key={a.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base" title={TIPO[a.tipo].label}>{TIPO[a.tipo].icone}</span>
                          <strong className="text-sm text-[#0C1D4D]">{a.titulo}</strong>
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full border uppercase" style={{ color: st.cor, background: st.bg, borderColor: st.cor + '55' }}>{st.icone} {st.label}</span>
                          {a.sandbox && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">Teste</span>}
                          {a.tipo === 'AVULSO' && a.competencia && <span className="text-[10px] text-gray-400 font-bold">enviado no mês {mesBR(a.competencia)}</span>}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1">
                          {a.enviadoEm && <>Enviado {dataHora(a.enviadoEm)}{a.enviadoPor ? ` por ${a.enviadoPor}` : ''}</>}
                          {a.visualizadoEm && <> • Visto {dataHora(a.visualizadoEm)}</>}
                          {a.assinadoEm && <> • <strong className="text-green-700">Assinado {dataHora(a.assinadoEm)}</strong></>}
                          {a.canceladoEm && <> • Cancelado {dataHora(a.canceladoEm)}{a.canceladoPor ? ` por ${a.canceladoPor}` : ''}</>}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5 flex-shrink-0">
                        {a.status === 'ASSINADO' && (
                          <button onClick={() => baixar(a)} disabled={ocupado !== null} className={`${btn} border-green-300 text-green-700 hover:bg-green-50`}>{ocupado === `b${a.id}` ? '...' : '📄 Assinado'}</button>
                        )}
                        {pendente(a.status) && (
                          <button onClick={() => consultar(a)} disabled={ocupado !== null} className={`${btn} border-[#CBD5E1] text-gray-600 hover:bg-gray-50`}>{ocupado === `c${a.id}` ? '...' : '↻ Status'}</button>
                        )}
                        {pendente(a.status) && (
                          <button onClick={() => cancelar(a)} disabled={ocupado !== null} className={`${btn} border-red-200 text-red-600 hover:bg-red-50`}>{ocupado === `x${a.id}` ? '...' : 'Cancelar'}</button>
                        )}
                        {a.rescisaoId && (
                          <a href={`/admin/rh/rescisao/${a.rescisaoId}`} className={`${btn} border-[#CBD5E1] text-[#336699] hover:bg-blue-50`}>Ver rescisão →</a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* documentos oficiais */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="p-4 border-b border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">🪪 Documentos oficiais ({documentosVisiveis.length})</h3>
                <p className="text-[11px] text-gray-500">Arquivos guardados em RH → Documentos (não passam pela assinatura digital).</p>
              </div>
              {dossie.documentos.some(d => d.historico) && (
                <label className="flex items-center gap-2 text-[11px] font-bold text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={verHistoricoDocs} onChange={e => setVerHistoricoDocs(e.target.checked)} /> Mostrar versões antigas
                </label>
              )}
            </div>
            {documentosVisiveis.length === 0 ? (
              <p className="p-10 text-center text-xs font-bold text-gray-400 uppercase">Nenhum documento cadastrado.</p>
            ) : (
              <div className="divide-y divide-[#F1F5F9]">
                {documentosVisiveis.map(d => (
                  <div key={d.id} className={`p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 ${d.historico ? 'opacity-60' : ''}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm text-[#0C1D4D]">{d.categoria}</strong>
                        {d.titulo && <span className="text-xs text-gray-600">— {d.titulo}</span>}
                        {d.exigeValidade && !d.validade
                          ? <span className="text-[9px] font-black px-2 py-0.5 rounded-full border uppercase bg-amber-100 text-amber-800 border-amber-300">Sem data de validade</span>
                          : <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border uppercase ${SITUACAO_DOC[d.situacao].classe}`}>{SITUACAO_DOC[d.situacao].label}</span>}
                        {d.historico && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase">Versão antiga</span>}
                        {d.visivelPortal && <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 uppercase">No Portal</span>}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1">
                        {d.validade && <>Validade {formatarDataBR(d.validade)}{d.dias != null && (d.dias < 0 ? ` (vencido há ${-d.dias} dia(s))` : ` (${d.dias === 0 ? 'vence hoje' : `vence em ${d.dias} dia(s)`})`)} • </>}
                        Enviado {dataHora(d.enviadoEm)}{d.enviadoPor ? ` por ${d.enviadoPor}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => abrirDocumento(d)} disabled={ocupado !== null} className={`${btn} border-[#CBD5E1] text-[#336699] hover:bg-blue-50`}>{ocupado === `d${d.id}` ? '...' : '👁 Abrir'}</button>
                      <button onClick={() => abrirDocumento(d, true)} disabled={ocupado !== null} className={`${btn} border-[#CBD5E1] text-gray-600 hover:bg-gray-50`}>⬇ Baixar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>)}
      </main>
    </div>
  );
}
