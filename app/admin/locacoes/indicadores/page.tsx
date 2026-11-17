"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import * as XLSX from 'xlsx';
import { indicadoresAction, importarHistoricoAction } from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { somarDias } from '../../../lib/locacao/datas';

// Indicadores de utilização dos equipamentos (2026-11-17). Cálculo em
// app/lib/locacao/indicadores.ts — utilização = dias-unidade locados ÷
// (estoque × dias do período), sobre fichas confirmadas (P2S + daqui).

interface Linha {
  produto_id: number; nome: string; codigo: string | null; categoria: string | null; estoque: number; locacoes: number;
  diasUnidade: number; utilizacao: number | null; receita: number; receitaPorUnidade: number | null;
  valorUnitario: number | null; retornoSobreEstoque: number | null;
}
type Visao = 'todos' | 'alta' | 'ociosos' | 'semEstoque';
type Ordem = 'utilizacao' | 'receita' | 'retorno' | 'locacoes' | 'nome';

const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const PRESETS = [
  { rotulo: '30 dias', dias: 30 }, { rotulo: '90 dias', dias: 90 }, { rotulo: '6 meses', dias: 182 }, { rotulo: '12 meses', dias: 365 },
];

export default function IndicadoresPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const hoje = hojeISO();
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [inicio, setInicio] = useState(somarDias(hoje, -89));
  const [fim, setFim] = useState(hoje);
  const [dados, setDados] = useState<{ diasPeriodo: number; fichasNoPeriodo: number; linhas: Linha[]; historicoDesde: string | null } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [visao, setVisao] = useState<Visao>('todos');
  const [ordem, setOrdem] = useState<Ordem>('utilizacao');
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [importando, setImportando] = useState<{ atual: string; feitos: number; total: number } | null>(null);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let cancelado = false;
    (async () => {
      setCarregando(true);
      const r = await indicadoresAction({ empresa_id: empresaId, inicio, fim }, accessToken);
      if (cancelado) return;
      if (r.ok) {
        setEmpresas(r.info.empresas);
        setDados({ diasPeriodo: r.info.diasPeriodo, fichasNoPeriodo: r.info.fichasNoPeriodo, linhas: r.info.linhas || [], historicoDesde: r.info.historicoDesde });
        if (r.info.empresaId && r.info.empresaId !== empresaId) setEmpresaId(r.info.empresaId);
      } else toast(r.erro || 'Erro ao calcular.', 'error');
      setCarregando(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, empresaId, inicio, fim, recarregar]);

  const linhas = useMemo(() => dados?.linhas || [], [dados]);
  const categorias = useMemo(() => [...new Set(linhas.map(l => l.categoria).filter(Boolean) as string[])].sort(), [linhas]);

  const comEstoque = linhas.filter(l => l.estoque > 0);
  const capTotal = comEstoque.reduce((s, l) => s + l.estoque, 0) * (dados?.diasPeriodo || 1);
  const usoTotal = comEstoque.reduce((s, l) => s + l.diasUnidade, 0);
  const utilizacaoMedia = capTotal > 0 ? usoTotal / capTotal : null;
  // Ponderada pelo valor de reposição: milhares de cabos baratos não diluem
  // o que importa (onde está o dinheiro investido).
  const comValor = comEstoque.filter(l => l.valorUnitario);
  const capValor = comValor.reduce((s, l) => s + l.estoque * (l.valorUnitario || 0), 0) * (dados?.diasPeriodo || 1);
  const usoValor = comValor.reduce((s, l) => s + l.diasUnidade * (l.valorUnitario || 0), 0);
  const utilizacaoPorValor = capValor > 0 ? usoValor / capValor : null;
  const receitaTotal = linhas.reduce((s, l) => s + l.receita, 0);
  const ociosos = comEstoque.filter(l => l.locacoes === 0);
  const valorParado = ociosos.reduce((s, l) => s + (l.valorUnitario ? l.valorUnitario * l.estoque : 0), 0);
  const altaDemanda = comEstoque.filter(l => (l.utilizacao || 0) >= 0.8);
  const semEstoque = linhas.filter(l => l.estoque === 0 && l.locacoes > 0);

  const visiveis = linhas.filter(l => {
    if (visao === 'alta' && !((l.utilizacao || 0) >= 0.8)) return false;
    if (visao === 'ociosos' && !(l.estoque > 0 && l.locacoes === 0)) return false;
    if (visao === 'semEstoque' && !(l.estoque === 0 && l.locacoes > 0)) return false;
    if (categoria && l.categoria !== categoria) return false;
    const t = busca.trim().toLowerCase();
    if (t && ![l.nome, l.codigo, l.categoria].some(x => (x || '').toLowerCase().includes(t))) return false;
    return true;
  }).sort((a, b) => {
    if (ordem === 'nome') return (a.codigo || a.nome).localeCompare(b.codigo || b.nome, 'pt-BR', { numeric: true });
    const v = (l: Linha) => ordem === 'utilizacao' ? (l.utilizacao ?? -1) : ordem === 'receita' ? l.receita : ordem === 'retorno' ? (l.retornoSobreEstoque ?? -1) : l.locacoes;
    return v(b) - v(a);
  });

  const historicoIncompleto = !!dados?.historicoDesde && inicio < dados.historicoDesde;

  const importarHistorico = async () => {
    const desde = somarDias(hoje, -365);
    const ok = await confirmar({
      title: 'Importar histórico do P2S',
      confirmLabel: 'Importar 12 meses',
      message: 'Traz do PrimeStart as fichas dos últimos 12 meses, um mês por vez (cada mês leva até 1–2 min). As fichas entram só para leitura e alimentam estes indicadores. Melhor fazer depois que a carga completa de parceiros (madrugada) terminar — senão cada cliente que faltar é buscado no P2S e fica mais lento. Pode fechar a tela no meio: o que já entrou fica.',
    });
    if (!ok) return;
    const meses: { de: string; ate: string }[] = [];
    for (let d = desde; d <= hoje; ) {
      const [a, m] = d.split('-').map(Number);
      const fimMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
      meses.push({ de: d, ate: fimMes < hoje ? fimMes : hoje });
      d = somarDias(fimMes, 1);
    }
    let fichas = 0;
    for (let i = 0; i < meses.length; i++) {
      setImportando({ atual: `${formatarDataBR(meses[i].de)} a ${formatarDataBR(meses[i].ate)}`, feitos: i, total: meses.length });
      const r = await importarHistoricoAction(meses[i], accessToken);
      if (!r.ok) { toast(`Parou em ${formatarDataBR(meses[i].de)}: ${r.erro}`, 'error'); break; }
      fichas += r.info.gravadas;
    }
    setImportando(null);
    toast(`Histórico importado: ${fichas} gravações de fichas.`, 'success');
    setRecarregar(x => x + 1);
  };

  const exportar = () => {
    const ws = XLSX.utils.json_to_sheet(visiveis.map(l => ({
      Código: l.codigo, Produto: l.nome, Categoria: l.categoria, Estoque: l.estoque, Locações: l.locacoes,
      'Dias-unidade': l.diasUnidade, 'Utilização %': l.utilizacao === null ? null : Math.round(l.utilizacao * 1000) / 10,
      'Receita (R$)': l.receita, 'Receita por unidade (R$)': l.receitaPorUnidade === null ? null : Math.round(l.receitaPorUnidade * 100) / 100,
      'Valor unitário (R$)': l.valorUnitario, 'Retorno s/ estoque %': l.retornoSobreEstoque === null ? null : Math.round(l.retornoSobreEstoque * 1000) / 10,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Utilização');
    XLSX.writeFile(wb, `utilizacao-equipamentos-${inicio}-a-${fim}.xlsx`);
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Indicadores de Utilização.</p>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const cartao = (titulo: string, valor: string, sub: string, destaque?: 'vermelho' | 'verde' | 'ambar', onClick?: () => void) => (
    <button onClick={onClick} disabled={!onClick} className={`text-left bg-white p-4 rounded-2xl border shadow-sm min-w-0 ${onClick ? 'hover:shadow-md' : 'cursor-default'} ${destaque === 'vermelho' ? 'border-red-200' : destaque === 'ambar' ? 'border-amber-200' : destaque === 'verde' ? 'border-emerald-200' : 'border-[#E2E8F0]'}`}>
      <p className={`text-xl font-black truncate ${destaque === 'vermelho' ? 'text-red-600' : destaque === 'ambar' ? 'text-amber-600' : destaque === 'verde' ? 'text-emerald-700' : 'text-[#0C1D4D]'}`}>{carregando ? '—' : valor}</p>
      <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">{titulo}</p>
      <p className="text-[10px] text-gray-400 mt-1 truncate">{carregando ? '' : sub}</p>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">📊 <strong>Olá, {usuarioAtual}</strong>. Utilização, ociosidade e retorno dos equipamentos.</p>
        <button onClick={() => router.push('/admin/locacoes')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 flex flex-wrap items-center gap-2">
            {empresas.length > 1 && empresas.map(e => (
              <button key={e.id} onClick={() => setEmpresaId(e.id)}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${empresaId === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>
            ))}
            <div className="flex rounded-lg border border-[#CBD5E1] overflow-hidden ml-1">
              {PRESETS.map(p => {
                const ini = somarDias(hoje, -(p.dias - 1));
                return <button key={p.dias} onClick={() => { setInicio(ini); setFim(hoje); }} className={`px-2.5 py-1.5 text-[10px] font-black ${inicio === ini && fim === hoje ? 'bg-[#0C1D4D] text-white' : 'bg-white text-gray-500'}`}>{p.rotulo}</button>;
              })}
            </div>
            <input type="date" value={inicio} onChange={e => e.target.value && setInicio(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs" />
            <span className="text-xs text-gray-400">a</span>
            <input type="date" value={fim} onChange={e => e.target.value && setFim(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs" />
            <span className="text-[10px] text-gray-400 ml-1">{dados ? `${dados.diasPeriodo} dias · ${dados.fichasNoPeriodo} fichas confirmadas` : ''}</span>
          </div>

          {(historicoIncompleto || importando) && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <p className="text-xs text-amber-900">
                {importando
                  ? <>Importando histórico do P2S: <strong>{importando.atual}</strong> ({importando.feitos + 1} de {importando.total})…</>
                  : <>O histórico importado começa em <strong>{formatarDataBR(dados?.historicoDesde)}</strong> — antes disso a utilização aparece menor do que foi. Importe os 12 meses anteriores do P2S.</>}
              </p>
              {!importando && <button onClick={importarHistorico} className="flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">⬇ Importar histórico (12 meses)</button>}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {cartao('Utilização média (por valor)', pct(utilizacaoPorValor ?? utilizacaoMedia), `por unidade: ${pct(utilizacaoMedia)} · ${comValor.length} itens com custo de reposição`)}
            {cartao('Receita no período', formatarMoeda(receitaTotal), 'locação de equipamentos (pró-rata)')}
            {cartao('Alta demanda (≥ 80%)', String(altaDemanda.length), 'candidatos a comprar mais', 'verde', () => setVisao('alta'))}
            {cartao('Ociosos', String(ociosos.length), valorParado ? `${formatarMoeda(valorParado)} parados em estoque` : 'sem nenhuma locação no período', 'ambar', () => setVisao('ociosos'))}
            {cartao('Locados sem estoque', String(semEstoque.length), 'sublocação ou saldo errado no P2S', 'vermelho', () => setVisao('semEstoque'))}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="flex rounded-lg border border-[#CBD5E1] overflow-hidden">
                {([['todos', 'Todos'], ['alta', 'Alta demanda'], ['ociosos', 'Ociosos'], ['semEstoque', 'Sem estoque']] as [Visao, string][]).map(([v, r]) => (
                  <button key={v} onClick={() => setVisao(v)} className={`px-3 py-1.5 text-[10px] font-black uppercase ${visao === v ? 'bg-[#0C1D4D] text-white' : 'bg-white text-gray-500'}`}>{r}</button>
                ))}
              </div>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar equipamento..." className="border border-[#CBD5E1] rounded-lg px-3 py-1.5 text-xs w-52" />
              <select value={categoria} onChange={e => setCategoria(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs font-bold text-[#0C1D4D] max-w-[180px]">
                <option value="">Todas as categorias</option>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={ordem} onChange={e => setOrdem(e.target.value as Ordem)} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-xs font-bold text-[#0C1D4D]">
                <option value="utilizacao">Ordenar: utilização</option>
                <option value="receita">Ordenar: receita</option>
                <option value="retorno">Ordenar: retorno s/ estoque</option>
                <option value="locacoes">Ordenar: nº de locações</option>
                <option value="nome">Ordenar: código</option>
              </select>
              <button onClick={exportar} disabled={!visiveis.length} className="ml-auto bg-white border border-[#CBD5E1] text-[#0C1D4D] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase disabled:opacity-40">⬇ Excel</button>
            </div>

            {carregando ? <p className="text-sm text-gray-400 py-8 text-center">Calculando...</p> : visiveis.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">Nada nesta visão.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                      <th className="p-2">Equipamento</th><th className="p-2 text-right">Estoque</th><th className="p-2 text-right">Locações</th>
                      <th className="p-2 w-44">Utilização</th><th className="p-2 text-right">Receita</th><th className="p-2 text-right">Por unidade</th>
                      <th className="p-2 text-right" title="Receita no período ÷ (estoque × custo de reposição)">Retorno s/ estoque</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map(l => {
                      const u = l.utilizacao;
                      const cor = u === null ? 'bg-gray-300' : u >= 0.8 ? 'bg-emerald-500' : u >= 0.4 ? 'bg-amber-400' : u > 0 ? 'bg-amber-200' : 'bg-gray-200';
                      return (
                        <tr key={l.produto_id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC]">
                          <td className="p-2 min-w-[240px]"><p className="font-bold text-[#0C1D4D]">{l.nome}</p><p className="text-[10px] text-gray-400">{[l.codigo, l.categoria].filter(Boolean).join(' · ')}</p></td>
                          <td className={`p-2 text-right font-bold ${l.estoque === 0 ? 'text-red-500' : ''}`}>{l.estoque.toLocaleString('pt-BR')}</td>
                          <td className="p-2 text-right">{l.locacoes}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${cor}`} style={{ width: `${Math.min(100, (u || 0) * 100)}%` }} /></div>
                              <span className={`w-14 text-right font-black ${u !== null && u > 1 ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{pct(u)}</span>
                            </div>
                          </td>
                          <td className="p-2 text-right font-bold whitespace-nowrap">{formatarMoeda(l.receita)}</td>
                          <td className="p-2 text-right whitespace-nowrap text-gray-500">{l.receitaPorUnidade === null ? '—' : formatarMoeda(l.receitaPorUnidade)}</td>
                          <td className="p-2 text-right whitespace-nowrap">{pct(l.retornoSobreEstoque)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-3">
                  {visiveis.length} equipamento(s). Utilização acima de 100% = alugou mais do que o estoque (sublocação ou saldo desatualizado). Estoque e custo de reposição são os atuais; o período das fichas do P2S é o da ficha (não o de cada item).
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
