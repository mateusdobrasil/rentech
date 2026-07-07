"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarCatalogosBeneficioAction, criarTipoBeneficioAction, criarMeioBeneficioAction,
  salvarBeneficioAction, alternarBeneficioAction, historicoBeneficioAction, painelBeneficiosAction
} from '../actions/actions-beneficios';

const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

interface LinhaFunc {
  nome: string; cargo: string; contrato: string;
  vr: { valor: number; modalidade: string } | null;
  vt: { valor: number; modalidade: string } | null;
  beneficiosFixos: { id: number; tipo: string; meio: string; valor: number; modalidade: string; observacao: string | null }[];
  totalFixos: number;
  semNenhum: boolean;
}

export default function BeneficiosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<LinhaFunc[]>([]);
  const [tipos, setTipos] = useState<{ id: number; nome: string }[]>([]);
  const [meios, setMeios] = useState<{ id: number; nome: string }[]>([]);
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'TODOS' | 'COM' | 'SEM'>('TODOS');

  // Modal de concessão
  const [modalFunc, setModalFunc] = useState<string | null>(null);
  const [formTipo, setFormTipo] = useState('');
  const [formMeio, setFormMeio] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formModalidade, setFormModalidade] = useState<'VALOR_UNICO' | 'POR_DIARIA'>('VALOR_UNICO');
  const [formObs, setFormObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Histórico
  const [histAberto, setHistAberto] = useState<number | null>(null);
  const [historico, setHistorico] = useState<any[]>([]);

  // Novos catálogos
  const [novoTipo, setNovoTipo] = useState('');
  const [novoMeio, setNovoMeio] = useState('');
  const [mostrarCatalogos, setMostrarCatalogos] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('rh_usuario');
      if (raw) setUsuarioAtual(JSON.parse(raw)?.nome || '');
    } catch {}
    carregar();
  }, []);

  const carregar = async () => {
    setLoading(true);
    try {
      const [painel, cats] = await Promise.all([painelBeneficiosAction(), listarCatalogosBeneficioAction()]);
      if (painel.ok) setLinhas(painel.info.linhas);
      if (cats.ok) { setTipos(cats.info.tipos); setMeios(cats.info.meios); }
    } catch (e: any) {
      alert('Erro ao carregar: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const filtradas = useMemo(() => linhas
    .filter(l => l.nome.toLowerCase().includes(busca.toLowerCase()))
    .filter(l => filtro === 'TODOS' || (filtro === 'SEM' ? l.semNenhum : !l.semNenhum)),
    [linhas, busca, filtro]);

  const totais = useMemo(() => ({
    total: linhas.length,
    sem: linhas.filter(l => l.semNenhum).length,
    somaFixos: linhas.reduce((s, l) => s + l.totalFixos, 0)
  }), [linhas]);

  const abrirModal = (nome: string) => {
    setModalFunc(nome); setFormTipo(''); setFormMeio(''); setFormValor(''); setFormModalidade('VALOR_UNICO'); setFormObs('');
  };

  const salvarBeneficio = async () => {
    if (!formTipo || !formMeio) { alert('Escolha o tipo e o meio de pagamento.'); return; }
    setSalvando(true);
    try {
      const res = await salvarBeneficioAction({
        funcionarioNome: modalFunc!, tipoId: Number(formTipo), meioId: Number(formMeio),
        valorMensal: Number(formValor) || 0, modalidade: formModalidade, observacao: formObs || null, usuarioNome: usuarioAtual
      });
      if (!res.ok) throw new Error(res.erro);
      setModalFunc(null);
      carregar();
    } catch (e: any) {
      alert('Erro ao salvar: ' + e.message);
    } finally {
      setSalvando(false);
    }
  };

  const removerBeneficio = async (id: number, tipo: string, nome: string) => {
    if (!confirm(`Remover o benefício "${tipo}" de ${nome}?\n\nO histórico é preservado.`)) return;
    try {
      const res = await alternarBeneficioAction({ id, ativo: false, usuarioNome: usuarioAtual });
      if (!res.ok) throw new Error(res.erro);
      carregar();
    } catch (e: any) {
      alert('Erro ao remover: ' + e.message);
    }
  };

  const verHistorico = async (id: number) => {
    setHistAberto(id); setHistorico([]);
    const res = await historicoBeneficioAction({ beneficioId: id });
    if (res.ok) setHistorico(res.info.historico);
  };

  const adicionarTipo = async () => {
    if (!novoTipo.trim()) return;
    const res = await criarTipoBeneficioAction({ nome: novoTipo });
    if (!res.ok) { alert(res.erro); return; }
    setNovoTipo('');
    const cats = await listarCatalogosBeneficioAction();
    if (cats.ok) setTipos(cats.info.tipos);
  };

  const adicionarMeio = async () => {
    if (!novoMeio.trim()) return;
    const res = await criarMeioBeneficioAction({ nome: novoMeio });
    if (!res.ok) { alert(res.erro); return; }
    setNovoMeio('');
    const cats = await listarCatalogosBeneficioAction();
    if (cats.ok) setMeios(cats.info.meios);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#FEF3C7] border-b border-[#FDE68A] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#92400E] font-medium text-sm">
          🎁 <strong>Benefícios</strong>. Controle de VR/VT, vale-alimentação e demais benefícios concedidos.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-amber-50 border border-[#FDE68A] text-[#92400E] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Funcionários</p>
            <p className="text-2xl font-black text-[#0C1D4D]">{totais.total}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Sem nenhum benefício</p>
            <p className={`text-2xl font-black ${totais.sem > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totais.sem}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Soma benefícios fixos/mês</p>
            <p className="text-2xl font-black text-[#336699]">{BRL(totais.somaFixos)}</p>
          </div>
        </div>

        {/* Barra de controles */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Buscar funcionário..." value={busca} onChange={e => setBusca(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['TODOS', 'COM', 'SEM'] as const).map(f => (
                <button key={f} onClick={() => setFiltro(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtro === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                  {f === 'TODOS' ? 'Todos' : f === 'COM' ? 'Com benefício' : 'Sem benefício'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setMostrarCatalogos(!mostrarCatalogos)} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2.5 rounded-lg uppercase tracking-wider">
            ⚙ Tipos e Meios
          </button>
        </div>

        {/* Painel de catálogos (colapsável) */}
        {mostrarCatalogos && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border-2 border-amber-200 mb-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Tipos de benefício</h3>
              <div className="flex gap-2 mb-3">
                <input type="text" value={novoTipo} onChange={e => setNovoTipo(e.target.value)} placeholder="Ex: Auxílio home office" className="flex-1 p-2 border border-gray-300 rounded text-sm uppercase" />
                <button onClick={adicionarTipo} className="bg-[#336699] text-white font-black text-xs px-4 rounded-lg uppercase">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tipos.map(t => <span key={t.id} className="text-[10px] font-black bg-blue-50 text-blue-700 px-2 py-1 rounded uppercase">{t.nome}</span>)}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Meios de pagamento</h3>
              <div className="flex gap-2 mb-3">
                <input type="text" value={novoMeio} onChange={e => setNovoMeio(e.target.value)} placeholder="Ex: Cartão VR" className="flex-1 p-2 border border-gray-300 rounded text-sm uppercase" />
                <button onClick={adicionarMeio} className="bg-[#336699] text-white font-black text-xs px-4 rounded-lg uppercase">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {meios.map(m => <span key={m.id} className="text-[10px] font-black bg-green-50 text-green-700 px-2 py-1 rounded uppercase">{m.nome}</span>)}
              </div>
            </div>
          </div>
        )}

        {/* Tabela principal */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando benefícios...</div>
          ) : filtradas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum funcionário neste filtro.</div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {filtradas.map(l => (
                <div key={l.nome} className={`p-4 ${l.semNenhum ? 'bg-amber-50/40' : ''}`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="min-w-[200px]">
                      <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                      <span className="text-[10px] text-gray-500 font-bold uppercase">{l.cargo || '—'} • {l.contrato}</span>
                    </div>

                    {/* Chips de benefícios */}
                    <div className="flex flex-wrap gap-2 flex-1">
                      {l.vr && <span className="text-[10px] font-black bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full uppercase">VR {BRL(l.vr.valor)}{l.vr.modalidade === 'VALOR_FECHADO' ? '/mês' : '/dia'}</span>}
                      {l.vt && <span className="text-[10px] font-black bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full uppercase">VT {BRL(l.vt.valor)}{l.vt.modalidade === 'VALOR_FECHADO' ? '/mês' : '/dia'}</span>}
                      {l.beneficiosFixos.map(b => (
                        <span key={b.id} className="text-[10px] font-black bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full uppercase inline-flex items-center gap-1.5 group">
                          {b.tipo} {BRL(b.valor)}{b.modalidade === 'POR_DIARIA' ? '/dia' : ''} · {b.meio}
                          <button onClick={() => verHistorico(b.id)} title="Histórico" className="text-indigo-400 hover:text-indigo-700">🕐</button>
                          <button onClick={() => removerBeneficio(b.id, b.tipo, l.nome)} title="Remover" className="text-indigo-400 hover:text-red-600">✕</button>
                        </span>
                      ))}
                      {l.semNenhum && <span className="text-[10px] font-black text-amber-600 uppercase px-2 py-1">⚠ Sem benefícios</span>}
                    </div>

                    <button onClick={() => abrirModal(l.nome)} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg uppercase tracking-wider whitespace-nowrap">
                      + Benefício
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 font-medium mt-4 text-center">
          VR e VT vêm da configuração de contrato e da ficha (calculados por dia no holerite). Os demais benefícios são fixos mensais, gerenciados aqui.
        </p>
      </div>

      {/* Modal de concessão */}
      {modalFunc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalFunc(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Conceder benefício</h2>
            <p className="text-sm text-gray-500 mb-4">{modalFunc}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Tipo</label>
                <select value={formTipo} onChange={e => setFormTipo(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Meio de pagamento</label>
                <select value={formMeio} onChange={e => setFormMeio(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {meios.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Modalidade</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setFormModalidade('VALOR_UNICO')} className={`p-2.5 rounded-lg text-[11px] font-black uppercase tracking-wider border-2 transition-all ${formModalidade === 'VALOR_UNICO' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-400'}`}>
                    Valor único
                  </button>
                  <button type="button" onClick={() => setFormModalidade('POR_DIARIA')} className={`p-2.5 rounded-lg text-[11px] font-black uppercase tracking-wider border-2 transition-all ${formModalidade === 'POR_DIARIA' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-400'}`}>
                    Por diária
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">
                  {formModalidade === 'POR_DIARIA' ? 'Valor da diária (R$/dia)' : 'Valor mensal (R$)'}
                </label>
                <input type="number" step="0.01" value={formValor} onChange={e => setFormValor(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                {formModalidade === 'POR_DIARIA' && <p className="text-[10px] font-bold text-indigo-500 mt-1 uppercase">O total do mês = diária × dias úteis (calculado no relatório de cada mês).</p>}
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Observação (opcional)</label>
                <input type="text" value={formObs} onChange={e => setFormObs(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setModalFunc(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarBeneficio} disabled={salvando} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Conceder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de histórico */}
      {histAberto && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setHistAberto(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">Histórico do benefício</h2>
              <button onClick={() => setHistAberto(null)} className="text-[10px] font-black bg-gray-100 px-3 py-1.5 rounded-lg uppercase">Fechar</button>
            </div>
            {historico.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Sem registros.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {historico.map(h => (
                  <div key={h.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="font-black text-[#0C1D4D] uppercase text-[11px]">{h.acao.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-gray-400 font-bold">{new Date(h.alterado_em).toLocaleString('pt-BR')}</span>
                    </div>
                    {h.acao === 'VALOR_ALTERADO' && <p className="text-[11px] text-gray-600 mt-1">{BRL(Number(h.valor_anterior))} → <strong>{BRL(Number(h.valor_novo))}</strong></p>}
                    {h.acao === 'MEIO_ALTERADO' && <p className="text-[11px] text-gray-600 mt-1">{h.meio_anterior} → <strong>{h.meio_novo}</strong></p>}
                    {h.acao === 'CRIADO' && <p className="text-[11px] text-gray-600 mt-1">Criado com {BRL(Number(h.valor_novo))} via {h.meio_novo}</p>}
                    {h.alterado_por && <p className="text-[10px] text-gray-400 mt-1">por {h.alterado_por}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}