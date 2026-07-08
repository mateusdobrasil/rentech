"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarCatalogosBeneficioAction, criarTipoBeneficioAction, criarMeioBeneficioAction,
  salvarBeneficioAction, alternarBeneficioAction, historicoBeneficioAction, painelBeneficiosAction,
  gridBeneficiosAction, gerarFlashAction
} from '../actions/actions-beneficios';

const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

interface LinhaFunc {
  nome: string; cargo: string; contrato: string;
  beneficiosFixos: { id: number; tipoId: number; meioId: number; tipo: string; meio: string; valor: number; modalidade: string; qtdDias: number | null; observacao: string | null }[];
  totalFixos: number;
  temVariavel: boolean;
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
  const [filtroMeio, setFiltroMeio] = useState('TODOS');       // filtro da aba
  const [gridFiltroMeio, setGridFiltroMeio] = useState('TODOS'); // filtro do grid

  // Modal de concessão/edição
  const [modalFunc, setModalFunc] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [formTipo, setFormTipo] = useState('');
  const [formMeio, setFormMeio] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formModalidade, setFormModalidade] = useState<'VALOR_UNICO' | 'POR_DIARIA' | 'DIAS_FIXOS'>('VALOR_UNICO');
  const [formQtdDias, setFormQtdDias] = useState('');
  const [formObs, setFormObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Grid consolidado (mês)
  const [mostrarGrid, setMostrarGrid] = useState(false);
  const [gridMes, setGridMes] = useState(() => {
    const h = new Date(); const c = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
  });
  const [grid, setGrid] = useState<{ diasUteis: number; colunas: string[]; funcionarios: any[]; totaisColuna: Record<string, number>; totalGeral: number } | null>(null);
  const [carregandoGrid, setCarregandoGrid] = useState(false);
  const [gerandoFlash, setGerandoFlash] = useState(false);

  // Gera o arquivo Flash (CSV) com as colunas exatas da planilha de pedido
  const gerarFlash = async () => {
    setGerandoFlash(true);
    try {
      const res = await gerarFlashAction({ mesReferencia: gridMes });
      if (!res.ok) throw new Error(res.erro);
      const linhas = res.info.linhas as any[];
      if (linhas.length === 0) {
        alert('Nenhum funcionário com benefício no Cartão Flash neste mês.');
        return;
      }

      // Cabeçalhos idênticos à planilha modelo
      const cab = ['CNPJ', 'NOME COMPLETO', 'CPF', 'MOBILIDADE (R$)', 'REFEICAO (R$)', 'ALIMENTACAO (R$)', 'PREMIACAO NO CARTAO (R$)', 'REFEICAO E ALIMENTACAO (R$)', 'PREMIACAO VIRTUAL (R$)'];
      const num = (v: number) => v.toFixed(2).replace('.', ',');
      const linhasCsv = linhas.map(l => [
        l.cnpj, `"${l.nome}"`, l.cpf,
        num(l.mobilidade), num(l.refeicao), num(l.alimentacao),
        num(l.premiacaoCartao), num(l.refeicaoEAlimentacao), num(l.premiacaoVirtual)
      ].join(';'));

      const csv = '\uFEFF' + [cab.join(';'), ...linhasCsv].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `pedido-flash-${gridMes}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Erro ao gerar o arquivo Flash: ' + e.message);
    } finally {
      setGerandoFlash(false);
    }
  };

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
    .map(l => {
      // Quando um meio é selecionado, mostra só os benefícios daquele meio
      if (filtroMeio === 'TODOS') return l;
      const fixos = l.beneficiosFixos.filter(b => String(b.meioId) === filtroMeio);
      return { ...l, beneficiosFixos: fixos, semNenhum: fixos.length === 0 };
    })
    .filter(l => l.nome.toLowerCase().includes(busca.toLowerCase()))
    .filter(l => {
      // Com filtro de meio ativo, esconde quem ficou sem benefício naquele meio
      if (filtroMeio !== 'TODOS') return l.beneficiosFixos.length > 0;
      return filtro === 'TODOS' || (filtro === 'SEM' ? l.semNenhum : !l.semNenhum);
    }),
    [linhas, busca, filtro, filtroMeio]);

  const totais = useMemo(() => ({
    total: linhas.length,
    sem: linhas.filter(l => l.semNenhum).length,
    somaFixos: linhas.reduce((s, l) => s + l.totalFixos, 0)
  }), [linhas]);

  const abrirNovo = (nome: string) => {
    setModalFunc(nome); setEditId(null);
    setFormTipo(''); setFormMeio(''); setFormValor(''); setFormModalidade('VALOR_UNICO'); setFormQtdDias(''); setFormObs('');
  };

  // Item 4: editar um benefício já lançado — abre o modal preenchido
  const abrirEdicao = (nome: string, b: LinhaFunc['beneficiosFixos'][0]) => {
    setModalFunc(nome); setEditId(b.id);
    setFormTipo(String(b.tipoId)); setFormMeio(String(b.meioId));
    setFormValor(String(b.valor)); setFormModalidade(b.modalidade as any);
    setFormQtdDias(b.qtdDias ? String(b.qtdDias) : ''); setFormObs(b.observacao || '');
  };

  const salvarBeneficio = async () => {
    if (!formTipo || !formMeio) { alert('Escolha o tipo e o meio de pagamento.'); return; }
    if (formModalidade === 'DIAS_FIXOS' && (!Number(formQtdDias) || Number(formQtdDias) <= 0)) {
      alert('Informe a quantidade de dias.'); return;
    }
    setSalvando(true);
    try {
      const res = await salvarBeneficioAction({
        id: editId || undefined,
        funcionarioNome: modalFunc!, tipoId: Number(formTipo), meioId: Number(formMeio),
        valorMensal: Number(formValor) || 0, modalidade: formModalidade,
        qtdDias: formModalidade === 'DIAS_FIXOS' ? Number(formQtdDias) : null,
        observacao: formObs || null, usuarioNome: usuarioAtual
      });
      if (!res.ok) throw new Error(res.erro);
      setModalFunc(null); setEditId(null);
      carregar();
      if (mostrarGrid) gerarGrid();
    } catch (e: any) {
      alert('Erro ao salvar: ' + e.message);
    } finally {
      setSalvando(false);
    }
  };

  // Item 2: grid consolidado por meio de pagamento
  const gerarGrid = async () => {
    setMostrarGrid(true); setCarregandoGrid(true);
    try {
      const res = await gridBeneficiosAction({ mesReferencia: gridMes, meioId: gridFiltroMeio === 'TODOS' ? null : Number(gridFiltroMeio) });
      if (res.ok) setGrid(res.info);
    } catch (e: any) {
      alert('Erro ao gerar grid: ' + e.message);
    } finally {
      setCarregandoGrid(false);
    }
  };

  // Exporta o grid como CSV matriz (abre no Excel)
  const exportarCSV = () => {
    if (!grid) return;
    const sep = ';';
    const cabecalho = ['Funcionário', ...grid.colunas, 'Total'].map(c => `"${c}"`).join(sep);
    const linhas: string[] = [cabecalho];
    grid.funcionarios.forEach((f: any) => {
      const cels = [`"${f.funcionario_nome}"`];
      grid.colunas.forEach(c => cels.push((f.valores[c] || 0).toFixed(2).replace('.', ',')));
      cels.push(f.total.toFixed(2).replace('.', ','));
      linhas.push(cels.join(sep));
    });
    // Rodapé de totais
    const rodape = ['"TOTAL"'];
    grid.colunas.forEach(c => rodape.push((grid.totaisColuna[c] || 0).toFixed(2).replace('.', ',')));
    rodape.push(grid.totalGeral.toFixed(2).replace('.', ','));
    linhas.push(rodape.join(sep));

    const csv = '\uFEFF' + linhas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `beneficios-${gridMes}.csv`; a.click();
    URL.revokeObjectURL(url);
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
            <select value={filtroMeio} onChange={e => setFiltroMeio(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-[11px] font-black uppercase text-gray-600 bg-[#F8FAFC]">
              <option value="TODOS">Todos os meios</option>
              {meios.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <button onClick={() => setMostrarCatalogos(!mostrarCatalogos)} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2.5 rounded-lg uppercase tracking-wider">
            ⚙ Tipos e Meios
          </button>
          <input type="month" value={gridMes} onChange={e => setGridMes(e.target.value)} title="Mês de referência para Grid e Flash" className="text-[10px] font-bold p-2.5 border border-gray-300 rounded-lg bg-[#F8FAFC]" />
          <button onClick={gerarGrid} className="text-[10px] font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">
            📊 Gerar Grid
          </button>
          <button onClick={gerarFlash} disabled={gerandoFlash} className="text-[10px] font-black bg-[#FF6B35] hover:bg-[#E85A28] text-white px-4 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
            {gerandoFlash ? '⏳' : '⚡ Gerar Flash'}
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Funcionário</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Benefício</th>
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Meio</th>
                    <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Valor</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider w-28">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((l, idx) => {
                    const linhas = l.beneficiosFixos.length || 1;
                    const zebra = idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white';
                    return l.beneficiosFixos.length === 0 ? (
                      <tr key={l.nome} className={`${zebra} border-b border-[#E2E8F0]`}>
                        <td className="p-3">
                          <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                          <span className="text-[10px] text-gray-400 font-bold uppercase">{l.cargo || '—'}</span>
                        </td>
                        <td className="p-3 text-[11px] font-black text-amber-500 uppercase" colSpan={3}>⚠ Sem benefícios</td>
                        <td className="p-3 text-center">
                          <button onClick={() => abrirNovo(l.nome)} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg uppercase">+ Add</button>
                        </td>
                      </tr>
                    ) : (
                      l.beneficiosFixos.map((b, bi) => (
                        <tr key={`${l.nome}-${b.id}`} className={`${zebra} ${bi === linhas - 1 ? 'border-b border-[#E2E8F0]' : ''}`}>
                          {bi === 0 && (
                            <td className="p-3 align-top" rowSpan={linhas}>
                              <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                              <span className="text-[10px] text-gray-400 font-bold uppercase">{l.cargo || '—'}</span>
                            </td>
                          )}
                          <td className="p-3 text-[11px] font-black text-indigo-700 uppercase whitespace-nowrap">{b.tipo}</td>
                          <td className="p-3 text-[11px] font-bold text-gray-500 uppercase whitespace-nowrap">{b.meio}</td>
                          <td className="p-3 text-right tabular-nums whitespace-nowrap">
                            <span className="font-black text-[#0C1D4D]">{BRL(b.valor)}</span>
                            <span className="text-[9px] text-gray-400 font-bold ml-1">
                              {b.modalidade === 'POR_DIARIA' ? '/dia (úteis)' : b.modalidade === 'DIAS_FIXOS' ? `/dia ×${b.qtdDias}` : '/mês'}
                            </span>
                          </td>
                          <td className="p-3 text-center whitespace-nowrap">
                            <button onClick={() => abrirEdicao(l.nome, b)} title="Editar" className="text-gray-400 hover:text-indigo-600 px-1">✏️</button>
                            <button onClick={() => verHistorico(b.id)} title="Histórico" className="text-gray-400 hover:text-indigo-600 px-1">🕐</button>
                            <button onClick={() => removerBeneficio(b.id, b.tipo, l.nome)} title="Remover" className="text-gray-400 hover:text-red-600 px-1">✕</button>
                            {bi === 0 && <button onClick={() => abrirNovo(l.nome)} title="Adicionar" className="text-gray-400 hover:text-emerald-600 px-1 font-black">+</button>}
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
          VR e VT vêm da configuração de contrato e da ficha (calculados por dia no holerite). Os demais benefícios são fixos mensais, gerenciados aqui.
        </p>
      </div>

      {/* Modal do GRID consolidado */}
      {mostrarGrid && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setMostrarGrid(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 border-b border-gray-200">
              <div>
                <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">📊 Grid de Benefícios</h2>
                <p className="text-sm text-gray-500">{grid ? `${grid.diasUteis} dias úteis no mês` : 'Carregando...'}</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="month" value={gridMes} onChange={e => setGridMes(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                <select value={gridFiltroMeio} onChange={e => setGridFiltroMeio(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-[11px] font-black uppercase text-gray-600 bg-[#F8FAFC]">
                  <option value="TODOS">Todos os meios</option>
                  {meios.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
                <button onClick={gerarGrid} className="text-[10px] font-black bg-[#336699] text-white px-3 py-2 rounded-lg uppercase">Atualizar</button>
                <button onClick={exportarCSV} disabled={!grid} className="text-[10px] font-black bg-emerald-600 text-white px-3 py-2 rounded-lg uppercase disabled:opacity-50">⬇ CSV</button>
                <button onClick={() => setMostrarGrid(false)} className="text-[10px] font-black bg-gray-100 px-3 py-2 rounded-lg uppercase">Fechar</button>
              </div>
            </div>

            <div className="overflow-auto p-5">
              {carregandoGrid ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Calculando...</p>
              ) : !grid || grid.funcionarios.length === 0 ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Nenhum benefício cadastrado.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#0C1D4D] text-white">
                      <th className="p-2.5 text-left font-black uppercase text-[10px] tracking-wider sticky left-0 bg-[#0C1D4D] z-10">Funcionário</th>
                      {grid.colunas.map(c => (
                        <th key={c} className="p-2.5 text-right font-black uppercase text-[10px] tracking-wider whitespace-nowrap">{c}</th>
                      ))}
                      <th className="p-2.5 text-right font-black uppercase text-[10px] tracking-wider bg-indigo-700">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.funcionarios.map((f: any, idx: number) => (
                      <tr key={f.funcionario_nome} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}>
                        <td className={`p-2.5 font-black text-[#0C1D4D] whitespace-nowrap sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'}`}>{f.funcionario_nome}</td>
                        {grid.colunas.map(c => (
                          <td key={c} className="p-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                            {f.valores[c] ? (
                              <>
                                {f.detalhes?.[c] && <span className="text-[9px] text-gray-400 font-medium mr-1.5">{f.detalhes[c]}</span>}
                                {BRL(f.valores[c])}
                              </>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                        <td className="p-2.5 text-right font-black text-indigo-700 tabular-nums whitespace-nowrap bg-indigo-50/50">{BRL(f.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#F8FAFC] border-t-2 border-[#0C1D4D]">
                      <td className="p-2.5 font-black text-[#0C1D4D] uppercase text-[11px] sticky left-0 bg-[#F8FAFC] z-10">Total</td>
                      {grid.colunas.map(c => (
                        <td key={c} className="p-2.5 text-right font-black text-[#0C1D4D] tabular-nums whitespace-nowrap">{BRL(grid.totaisColuna[c] || 0)}</td>
                      ))}
                      <td className="p-2.5 text-right font-black text-indigo-700 text-base tabular-nums whitespace-nowrap bg-indigo-100">{BRL(grid.totalGeral)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de concessão */}
      {modalFunc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setModalFunc(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{editId ? 'Editar benefício' : 'Conceder benefício'}</h2>
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
                <div className="grid grid-cols-3 gap-2">
                  {([['VALOR_UNICO', 'Valor único'], ['POR_DIARIA', 'Dias úteis'], ['DIAS_FIXOS', 'Dias fixos']] as const).map(([val, lbl]) => (
                    <button key={val} type="button" onClick={() => setFormModalidade(val)} className={`p-2 rounded-lg text-[10px] font-black uppercase tracking-wider border-2 transition-all ${formModalidade === val ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-400'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">
                    {formModalidade === 'VALOR_UNICO' ? 'Valor mensal (R$)' : 'Valor da diária (R$)'}
                  </label>
                  <input type="number" step="0.01" value={formValor} onChange={e => setFormValor(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                </div>
                {formModalidade === 'DIAS_FIXOS' && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Qtd. de dias</label>
                    <input type="number" step="1" value={formQtdDias} onChange={e => setFormQtdDias(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold" />
                  </div>
                )}
              </div>
              {formModalidade === 'POR_DIARIA' && <p className="text-[10px] font-bold text-indigo-500 uppercase">Total do mês = diária × dias úteis (calculado por mês no grid/relatório).</p>}
              {formModalidade === 'DIAS_FIXOS' && Number(formValor) > 0 && Number(formQtdDias) > 0 && (
                <p className="text-[10px] font-bold text-indigo-600 uppercase">Total: {BRL(Number(formValor) * Number(formQtdDias))} ({BRL(Number(formValor))}/dia × {formQtdDias} dias)</p>
              )}
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Observação (opcional)</label>
                <input type="text" value={formObs} onChange={e => setFormObs(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => { setModalFunc(null); setEditId(null); }} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarBeneficio} disabled={salvando} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl disabled:opacity-50">
                {salvando ? 'Salvando...' : editId ? 'Salvar' : 'Conceder'}
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