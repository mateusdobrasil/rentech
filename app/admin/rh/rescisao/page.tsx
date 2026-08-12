"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  painelRescisoesAction, listarFuncionariosElegiveisRescisaoAction, criarRescisaoAction
} from '../actions/actions-rescisao';
import type { MotivoRescisao, TipoAvisoPrevio } from '../../../lib/calculoRescisao';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';

const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtMoeda = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

const MOTIVOS: { value: MotivoRescisao; label: string }[] = [
  { value: 'SEM_JUSTA_CAUSA', label: 'Sem justa causa (dispensa)' },
  { value: 'PEDIDO_DEMISSAO', label: 'Pedido de demissão' },
  { value: 'JUSTA_CAUSA', label: 'Justa causa' },
  { value: 'ACORDO_MUTUO', label: 'Acordo mútuo (CLT 484-A)' },
  { value: 'TERMINO_CONTRATO_EXPERIENCIA', label: 'Término de contrato de experiência' },
  { value: 'APOSENTADORIA', label: 'Aposentadoria' }
];
const motivoLabel = (m: string) => MOTIVOS.find(x => x.value === m)?.label || m;

const AVISO_LABEL: Record<TipoAvisoPrevio, string> = {
  INDENIZADO: 'Indenizado', TRABALHADO: 'Trabalhado', ISENTO: 'Não se aplica'
};
const opcoesAvisoPrevio = (motivo: MotivoRescisao): TipoAvisoPrevio[] => {
  if (motivo === 'JUSTA_CAUSA' || motivo === 'TERMINO_CONTRATO_EXPERIENCIA') return ['ISENTO'];
  if (motivo === 'SEM_JUSTA_CAUSA' || motivo === 'ACORDO_MUTUO') return ['INDENIZADO', 'TRABALHADO'];
  return ['TRABALHADO', 'ISENTO'];
};

const STATUS_INFO: Record<string, { label: string; cor: string }> = {
  RASCUNHO: { label: 'Rascunho', cor: 'bg-gray-100 text-gray-500' },
  EM_CALCULO: { label: 'Em cálculo', cor: 'bg-indigo-100 text-indigo-700' },
  AGUARDANDO_DOCUMENTO: { label: 'Aguard. documento', cor: 'bg-amber-100 text-amber-700' },
  AGUARDANDO_HOMOLOGACAO: { label: 'Aguard. homologação', cor: 'bg-amber-100 text-amber-700' },
  HOMOLOGADA: { label: 'Homologada', cor: 'bg-emerald-100 text-emerald-700' },
  CANCELADA: { label: 'Cancelada', cor: 'bg-gray-100 text-gray-400' }
};

interface Rescisao {
  id: number; funcionario_nome: string; motivo: string; data_desligamento: string;
  tipo_folha: 'PROPRIO' | 'CONTABILIDADE'; status: string; valor_total_liquido: number | null;
}
interface FuncionarioElegivel { nome: string; cargo: string | null; dataDesligamento: string | null; tipoFolha: 'PROPRIO' | 'CONTABILIDADE'; }

export default function RescisaoPage() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ nomeFallback: 'Equipe RH' });

  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<Rescisao[]>([]);
  const [totais, setTotais] = useState({ emAndamento: 0, homologadasNoMes: 0, proprio: 0, contabilidade: 0 });
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'TODOS' | 'EM_ANDAMENTO' | 'HOMOLOGADAS' | 'CANCELADAS'>('TODOS');

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await painelRescisoesAction(accessToken);
      if (res.ok) { setLinhas(res.info.linhas); setTotais(res.info.totais); }
      else alert('Erro ao carregar rescisões: ' + res.erro);
    } catch (e: any) { alert('Erro ao carregar rescisões: ' + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!authLoading && !acessoNegado) carregar(); }, [authLoading, acessoNegado]);

  const statusCombina = (r: Rescisao) => {
    if (filtro === 'TODOS') return true;
    if (filtro === 'EM_ANDAMENTO') return !['HOMOLOGADA', 'CANCELADA'].includes(r.status);
    if (filtro === 'HOMOLOGADAS') return r.status === 'HOMOLOGADA';
    return r.status === 'CANCELADA';
  };

  const linhasFiltradas = useMemo(() => linhas
    .filter(r => r.funcionario_nome.toLowerCase().includes(busca.toLowerCase()))
    .filter(statusCombina),
    [linhas, busca, filtro]);

  // ==========================================================================
  // MODAL: NOVA RESCISÃO
  // ==========================================================================
  const [modalAberto, setModalAberto] = useState(false);
  const [funcionarios, setFuncionarios] = useState<FuncionarioElegivel[]>([]);
  const [carregandoFuncionarios, setCarregandoFuncionarios] = useState(false);
  const [nFunc, setNFunc] = useState('');
  const [nData, setNData] = useState('');
  const [nMotivo, setNMotivo] = useState<MotivoRescisao>('SEM_JUSTA_CAUSA');
  const [nAviso, setNAviso] = useState<TipoAvisoPrevio>('INDENIZADO');
  const [salvando, setSalvando] = useState(false);

  const abrirModal = async () => {
    setModalAberto(true);
    setNFunc(''); setNData(''); setNMotivo('SEM_JUSTA_CAUSA'); setNAviso('INDENIZADO');
    setCarregandoFuncionarios(true);
    try {
      const res = await listarFuncionariosElegiveisRescisaoAction(accessToken);
      if (res.ok) setFuncionarios(res.info.linhas);
      else alert('Erro ao carregar funcionários: ' + res.erro);
    } catch (e: any) { alert('Erro ao carregar funcionários: ' + e.message); }
    finally { setCarregandoFuncionarios(false); }
  };

  const mudarMotivo = (m: MotivoRescisao) => {
    setNMotivo(m);
    setNAviso(opcoesAvisoPrevio(m)[0]);
  };

  // Se o funcionário já tem data de desligamento na ficha (lançada antes
  // dessa feature existir, ou deixada de uma rescisão anterior), pré-preenche
  // pra não ficarmos com duas datas divergentes entre ficha e rescisão.
  const mudarFuncionario = (nome: string) => {
    setNFunc(nome);
    const f = funcionarios.find(x => x.nome === nome);
    if (f?.dataDesligamento) setNData(f.dataDesligamento);
  };

  const funcionarioSelecionado = funcionarios.find(f => f.nome === nFunc) || null;

  const salvarNovaRescisao = async () => {
    if (!nFunc || !nData || !nMotivo) { alert('Selecione o funcionário, a data e o motivo.'); return; }
    setSalvando(true);
    try {
      const res = await criarRescisaoAction({
        funcionarioNome: nFunc, dataDesligamento: nData, motivo: nMotivo, tipoAvisoPrevio: nAviso, usuarioNome: usuarioAtual
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      router.push(`/admin/rh/rescisao/${res.info.id}`);
    } catch (e: any) { alert('Erro ao criar rescisão: ' + e.message); }
    finally { setSalvando(false); }
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Rescisão de Funcionário.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-red-50 border-b border-red-200 px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-red-700 font-medium text-sm">
          📤 <strong>Rescisão de Funcionário</strong>. Registro e cálculo de rescisões CLT.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-red-100 border border-red-200 text-red-700 px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Em andamento</p>
            <p className={`text-2xl font-black ${totais.emAndamento > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totais.emAndamento}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Homologadas no mês</p>
            <p className="text-2xl font-black text-[#0C1D4D]">{totais.homologadasNoMes}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Folha própria</p>
            <p className="text-2xl font-black text-indigo-600">{totais.proprio}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Folha contabilidade</p>
            <p className="text-2xl font-black text-gray-500">{totais.contabilidade}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Buscar funcionário..." value={busca} onChange={e => setBusca(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <div className="flex bg-gray-100 p-1 rounded-xl flex-wrap">
              {(['TODOS', 'EM_ANDAMENTO', 'HOMOLOGADAS', 'CANCELADAS'] as const).map(f => (
                <button key={f} onClick={() => setFiltro(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtro === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                  {f === 'TODOS' ? 'Todos' : f === 'EM_ANDAMENTO' ? 'Em andamento' : f === 'HOMOLOGADAS' ? 'Homologadas' : f === 'CANCELADAS' ? 'Canceladas' : ''}
                </button>
              ))}
            </div>
          </div>
          <button onClick={abrirModal} className="text-[10px] font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">
            + Nova Rescisão
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando rescisões...</div>
          ) : linhasFiltradas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhuma rescisão neste filtro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Funcionário</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Motivo</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Desligamento</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Tipo</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Status</th>
                    <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Valor líquido</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider w-24">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasFiltradas.map((r, idx) => (
                    <tr key={r.id} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                      <td className="p-3 font-black text-[#0C1D4D]">{r.funcionario_nome}</td>
                      <td className="p-3 text-[11px] font-bold text-gray-600">{motivoLabel(r.motivo)}</td>
                      <td className="p-3 text-[11px] font-bold text-gray-600 whitespace-nowrap">{fmtData(r.data_desligamento)}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${r.tipo_folha === 'PROPRIO' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                          {r.tipo_folha === 'PROPRIO' ? 'Própria' : 'Contabilidade'}
                        </span>
                      </td>
                      <td className="p-3 text-center whitespace-nowrap">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_INFO[r.status]?.cor || 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_INFO[r.status]?.label || r.status}
                        </span>
                      </td>
                      <td className="p-3 text-right tabular-nums font-black text-[#0C1D4D]">{r.tipo_folha === 'PROPRIO' ? fmtMoeda(r.valor_total_liquido) : '—'}</td>
                      <td className="p-3 text-center">
                        <button onClick={() => router.push(`/admin/rh/rescisao/${r.id}`)} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-3 py-1.5 rounded-lg uppercase">Abrir →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Nova Rescisão */}
      {modalAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalAberto(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-4">Nova Rescisão</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Funcionário</label>
                <select value={nFunc} onChange={e => mudarFuncionario(e.target.value)} disabled={carregandoFuncionarios} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white disabled:bg-gray-100">
                  <option value="">{carregandoFuncionarios ? 'Carregando...' : '— Selecione —'}</option>
                  {funcionarios.map(f => <option key={f.nome} value={f.nome}>{f.nome}{f.cargo ? ` (${f.cargo})` : ''}</option>)}
                </select>
                {funcionarioSelecionado && (
                  <p className={`text-[10px] font-black uppercase mt-1 ${funcionarioSelecionado.tipoFolha === 'PROPRIO' ? 'text-indigo-600' : 'text-gray-500'}`}>
                    {funcionarioSelecionado.tipoFolha === 'PROPRIO' ? '✓ Folha própria — cálculo automático' : '📎 Só holerite da contabilidade — sem cálculo, só anexo do TRCT'}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data de desligamento</label>
                {funcionarioSelecionado?.dataDesligamento && (
                  <p className="text-[10px] font-bold text-amber-600 mb-1">⚠ Preenchida a partir da ficha do funcionário — ajuste se necessário.</p>
                )}
                <input type="date" value={nData} onChange={e => setNData(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Motivo</label>
                <select value={nMotivo} onChange={e => mudarMotivo(e.target.value as MotivoRescisao)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  {MOTIVOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Aviso prévio</label>
                <select value={nAviso} onChange={e => setNAviso(e.target.value as TipoAvisoPrevio)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  {opcoesAvisoPrevio(nMotivo).map(a => <option key={a} value={a}>{AVISO_LABEL[a]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setModalAberto(false)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarNovaRescisao} disabled={salvando} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Criar e abrir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
