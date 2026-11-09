"use client";

// Aba "Benefícios por Mês" de /admin/rh/beneficios — escolhe a competência e
// vê quem recebeu os benefícios: o que foi gerado no botão Gerar Benefício
// (total, parte Flash e parte do lote) e a situação de pagamento de cada
// parte; a 🔍 abre os benefícios da pessoa (sem estourar a tela na
// horizontal). "Registrar mês pago por fora" (veio do Grid em 2026-11-09)
// grava uma competência paga fora do sistema já como paga.
// Dados: beneficiosPorMesAction (actions-beneficios.ts).
import { useEffect, useMemo, useState } from 'react';
import { beneficiosPorMesAction } from '../actions/actions-beneficios';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import RegistrarMesPago from './RegistrarMesPago';

const BRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mesAtualIso = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`; };
const semAcento = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const ehFlash = (meio: string) => semAcento(meio).includes('FLASH');

type Situacao = { status: 'PAGO' | 'PENDENTE' | 'CANCELADO' | 'ERRO'; texto: string } | null;
interface LinhaMes {
  funcionario_nome: string; empresaId: number | null;
  valores: Record<string, number>; totalFlash: number; totalLote: number; total: number;
  itens: { tipo: string; meio: string; valor: number; detalhe: string }[];
  flash: Situacao; lote: Situacao; geradoEm: string; geradoPor: string | null; geracaoId: number;
}

const COR_SITUACAO: Record<string, string> = {
  PAGO: 'bg-emerald-100 text-emerald-700', PENDENTE: 'bg-amber-100 text-amber-700',
  CANCELADO: 'bg-gray-100 text-gray-500', ERRO: 'bg-red-100 text-red-700',
};
function ChipSituacao({ s }: { s: Situacao }) {
  if (!s) return null;
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase whitespace-nowrap ${COR_SITUACAO[s.status]}`}>{s.texto}</span>;
}
// Recebeu = toda parte que existe está paga
const recebeuTudo = (l: LinhaMes) => (!l.flash || l.flash.status === 'PAGO') && (!l.lote || l.lote.status === 'PAGO');

export default function BeneficiosPorMes({ accessToken, usuarioAtual, empresas, nomeEmpresa }: {
  accessToken: string;
  usuarioAtual: string;
  empresas: { id: number; nome: string }[];
  nomeEmpresa: (id: number | null | undefined) => string;
}) {
  const [mes, setMes] = useState(mesAtualIso);
  const [linhas, setLinhas] = useState<LinhaMes[]>([]);
  const [colunas, setColunas] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState<'TODOS' | 'RECEBIDO' | 'PENDENTE'>('TODOS');
  const [filtroEmpresa, setFiltroEmpresa] = useState('TODAS');
  const [detalhe, setDetalhe] = useState<LinhaMes | null>(null);
  const [registrando, setRegistrando] = useState(false);

  const carregar = () => {
    if (!accessToken) return;
    setCarregando(true); setErro(null);
    beneficiosPorMesAction({ mesReferencia: mes }, accessToken).then(res => {
      if (res.ok) { setLinhas(res.info.funcionarios); setColunas(res.info.colunas); }
      else { setErro(res.erro || 'Não foi possível carregar.'); setLinhas([]); setColunas([]); }
      setCarregando(false);
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(carregar, [mes, accessToken]);

  const filtradas = useMemo(() => linhas.filter(l =>
    (filtroEmpresa === 'TODAS' || String(l.empresaId) === filtroEmpresa) &&
    (!busca || semAcento(l.funcionario_nome).includes(semAcento(busca))) &&
    (filtroSituacao === 'TODOS' || (filtroSituacao === 'RECEBIDO' ? recebeuTudo(l) : !recebeuTudo(l)))
  ), [linhas, busca, filtroSituacao, filtroEmpresa]);

  const totais = useMemo(() => {
    const porTipo: Record<string, number> = {};
    let flash = 0, lote = 0, pagoValor = 0;
    filtradas.forEach(l => {
      colunas.forEach(c => { porTipo[c] = (porTipo[c] || 0) + (l.valores[c] || 0); });
      flash += l.totalFlash; lote += l.totalLote;
      if (!l.flash || l.flash.status === 'PAGO') pagoValor += l.totalFlash;
      if (!l.lote || l.lote.status === 'PAGO') pagoValor += l.totalLote;
    });
    return { porTipo, flash, lote, total: flash + lote, pagoValor };
  }, [filtradas, colunas]);
  const qtdRecebeu = filtradas.filter(recebeuTudo).length;

  const mudarMes = (delta: number) => {
    const [a, m] = mes.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // CSV continua detalhado por tipo (no arquivo não tem problema de largura)
  const exportarCSV = () => {
    const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const num = (v: number) => (v || 0).toFixed(2).replace('.', ',');
    const cab = ['Funcionário', ...colunas, 'Flash', 'Lote', 'Total', 'Situação Flash', 'Situação Lote'];
    const corpo = filtradas.map(l => [
      l.funcionario_nome, ...colunas.map(c => num(l.valores[c] || 0)), num(l.totalFlash), num(l.totalLote), num(l.total),
      l.flash?.texto || '', l.lote?.texto || ''
    ].map(esc).join(';'));
    corpo.push(['TOTAL', ...colunas.map(c => num(totais.porTipo[c] || 0)), num(totais.flash), num(totais.lote), num(totais.total), '', ''].map(esc).join(';'));
    const blob = new Blob(['﻿' + [cab.map(esc).join(';'), ...corpo].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `beneficios-recebidos-${mes}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const celulaParte = (valor: number, s: Situacao, cor: string) => valor > 0 ? (
    <div className="flex flex-col items-start gap-1">
      <span className={`font-black tabular-nums ${cor}`}>{BRL(valor)}</span>
      <ChipSituacao s={s} />
    </div>
  ) : <span className="text-gray-300">—</span>;

  return (
    <div className="space-y-4">
      {/* Barra: competência + filtros + ações */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-wrap items-center gap-3">
        <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Competência</label>
        <button onClick={() => mudarMes(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 font-black">‹</button>
        <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
        <button onClick={() => mudarMes(1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 font-black">›</button>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar funcionário..." className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC] w-full sm:w-56" />
        <div className="flex bg-gray-100 p-1 rounded-xl">
          {([['TODOS', 'Todos'], ['RECEBIDO', '✓ Recebeu'], ['PENDENTE', '⏳ Pendente']] as const).map(([v, r]) => (
            <button key={v} onClick={() => setFiltroSituacao(v)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtroSituacao === v ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>{r}</button>
          ))}
        </div>
        {empresas.length > 1 && (
          <select value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-[11px] font-black uppercase text-gray-600 bg-[#F8FAFC]">
            <option value="TODAS">🏭 Todas as empresas</option>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={() => setRegistrando(true)} title="Competência paga fora do sistema (ex.: pago adiantado no mês anterior): grava o histórico já como pago — sem arquivo Flash e sem lote"
            className="text-[10px] font-black bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-300 px-4 py-2.5 rounded-lg uppercase tracking-wider">
            📝 Registrar mês pago por fora
          </button>
          <button onClick={exportarCSV} disabled={filtradas.length === 0} className="text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* Indicadores do mês (do filtro atual) */}
      {!carregando && linhas.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Funcionários', `${filtradas.length}`, `${qtdRecebeu} já receberam tudo`],
            ['Total gerado', BRL(totais.total), `⚡ Flash ${BRL(totais.flash)} · 🏦 Lote ${BRL(totais.lote)}`],
            ['Já pago', BRL(totais.pagoValor), totais.total > 0 ? `${Math.round((totais.pagoValor / totais.total) * 100)}% do gerado` : ''],
            ['Falta pagar', BRL(totais.total - totais.pagoValor), `${filtradas.length - qtdRecebeu} funcionário(s) com pendência`],
          ].map(([titulo, valor, sub]) => (
            <div key={titulo} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 min-w-0">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{titulo}</p>
              <p className="text-xl font-black text-[#0C1D4D] truncate">{valor}</p>
              <p className="text-[10px] font-bold text-gray-400 truncate">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Grid enxuto: total + Flash + Lote, detalhe na 🔍 */}
      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        {carregando ? (
          <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando...</div>
        ) : erro ? (
          <div className="p-10 text-center text-red-600 font-bold">{erro}</div>
        ) : linhas.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 font-bold uppercase tracking-wider">Nenhum benefício gerado em {mes.split('-').reverse().join('/')}.</p>
            <p className="text-[11px] text-gray-400 mt-2">
              Gere pelo 📊 Gerar Grid na aba Cadastro, ou, se este mês já foi pago fora do sistema, use <strong>📝 Registrar mês pago por fora</strong>.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#0C1D4D] text-white">
                  <th className="p-2.5 text-left font-black uppercase text-[10px] tracking-wider">Funcionário</th>
                  <th className="p-2.5 text-left font-black uppercase text-[10px] tracking-wider whitespace-nowrap">⚡ Flash</th>
                  <th className="p-2.5 text-left font-black uppercase text-[10px] tracking-wider whitespace-nowrap">🏦 Lote (transferência)</th>
                  <th className="p-2.5 text-right font-black uppercase text-[10px] tracking-wider">Total</th>
                  <th className="p-2.5 w-12" />
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr><td colSpan={5} className="p-10 text-center text-gray-400 font-bold text-xs uppercase">Ninguém neste filtro.</td></tr>
                ) : filtradas.map((l, idx) => (
                  <tr key={l.funcionario_nome} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-[#F8FAFC]'} border-b border-[#E2E8F0]`}>
                    <td className="p-2.5 font-black text-[#0C1D4D]">
                      <span className="mr-1.5">{recebeuTudo(l) ? '✅' : '⏳'}</span>{l.funcionario_nome}
                      {empresas.length > 1 && (
                        <span className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${corSeloEmpresa(l.empresaId)}`}>{nomeEmpresa(l.empresaId)}</span>
                      )}
                    </td>
                    <td className="p-2.5">{celulaParte(l.totalFlash, l.flash, 'text-[#E85A28]')}</td>
                    <td className="p-2.5">{celulaParte(l.totalLote, l.lote, 'text-emerald-700')}</td>
                    <td className="p-2.5 text-right font-black text-indigo-700 tabular-nums whitespace-nowrap">{BRL(l.total)}</td>
                    <td className="p-2.5 text-center">
                      <button onClick={() => setDetalhe(l)} title="Ver os benefícios desta pessoa" className="w-8 h-8 rounded-lg hover:bg-indigo-50 text-base">🔍</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filtradas.length > 0 && (
                <tfoot>
                  <tr className="bg-[#F8FAFC] border-t-2 border-[#0C1D4D]">
                    <td className="p-2.5 font-black text-[#0C1D4D] uppercase text-[11px]">Total ({filtradas.length})</td>
                    <td className="p-2.5 font-black text-[#E85A28] tabular-nums whitespace-nowrap">{BRL(totais.flash)}</td>
                    <td className="p-2.5 font-black text-emerald-700 tabular-nums whitespace-nowrap">{BRL(totais.lote)}</td>
                    <td className="p-2.5 text-right font-black text-indigo-700 tabular-nums whitespace-nowrap">{BRL(totais.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
      <p className="text-[10px] text-gray-400 font-medium text-center">
        Valores do que foi gerado no mês (se o funcionário foi gerado mais de uma vez, vale a última). Flash pago = pedido confirmado em 🧾 Pedidos Flash; Lote pago = "Efetuado" no Itaú (consultado em Lotes de Pagamento ou no Relatório de Lote).
      </p>

      {/* 🔍 Detalhe do funcionário */}
      {detalhe && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetalhe(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-3 p-5 border-b border-gray-200">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Benefícios de {mes.split('-').reverse().join('/')}</p>
                <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wide">{detalhe.funcionario_nome}</h2>
                <p className="text-[10px] text-gray-400 font-bold mt-0.5">
                  Gerado em {new Date(detalhe.geradoEm).toLocaleDateString('pt-BR')}{detalhe.geradoPor ? ` por ${detalhe.geradoPor}` : ''}
                </p>
              </div>
              <button onClick={() => setDetalhe(null)} className="text-[10px] font-black bg-gray-100 px-3 py-1.5 rounded-lg uppercase shrink-0">Fechar</button>
            </div>
            <div className="overflow-auto p-5 space-y-4">
              {([['⚡ Cartão Flash', true, detalhe.flash, 'text-[#E85A28]'], ['🏦 Lote (transferência)', false, detalhe.lote, 'text-emerald-700']] as const).map(([titulo, flash, sit, cor]) => {
                const itens = detalhe.itens.filter(i => ehFlash(i.meio) === flash);
                if (itens.length === 0) return null;
                return (
                  <div key={titulo}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-black text-[#0C1D4D] uppercase tracking-wider">{titulo}</h3>
                      <ChipSituacao s={sit} />
                    </div>
                    <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
                      {itens.map((i, k) => (
                        <div key={k} className="flex justify-between items-center gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-black text-[#0C1D4D] uppercase">{i.tipo}</p>
                            {i.detalhe && <p className="text-[10px] text-gray-400 font-bold">{i.detalhe}</p>}
                          </div>
                          <span className={`font-black tabular-nums whitespace-nowrap ${cor}`}>{BRL(i.valor)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between items-center p-5 border-t border-gray-200 bg-[#F8FAFC] rounded-b-2xl">
              <span className="text-[11px] font-black text-[#0C1D4D] uppercase">Total</span>
              <span className="text-lg font-black text-indigo-700 tabular-nums">{BRL(detalhe.total)}</span>
            </div>
          </div>
        </div>
      )}

      {registrando && (
        <RegistrarMesPago
          mesInicial={mes} accessToken={accessToken} usuarioAtual={usuarioAtual}
          onFechar={() => setRegistrando(false)}
          onRegistrado={(m) => { setRegistrando(false); if (m === mes) carregar(); else setMes(m); }}
        />
      )}
    </div>
  );
}
