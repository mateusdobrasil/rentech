"use client";

// Aba "Relatório de Lote" de /admin/financeiro/relatorios — escolhe um lote
// gerado (Financeiro RH → Lotes de Pagamento) e mostra todos os pagamentos
// dele, com a situação do envio ao banco. Dados vêm de
// listarLotesRelatorioAction / detalheLoteRelatorioAction (../actions.ts).
import { useEffect, useMemo, useState } from 'react';
import { listarLotesRelatorioAction, detalheLoteRelatorioAction, atualizarStatusItauLoteAction } from '../actions';

const BRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtMesBR = (m: string) => { const [a, mm] = (m || '').split('-'); return mm ? `${mm}/${a}` : '—'; };
const fmtDataBR = (d: string | null) => { if (!d) return '—'; const [a, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${a}`; };
const fmtDataHora = (d: string | null) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const semAcento = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

interface LoteLista { id: number; nome: string; mes: string; dataPagamento: string | null; valor: number; qtd: number; status: string; ativo: boolean; criadoEm: string; }
interface ItemLote {
  seq: number; favorecido: string; fonte: string; referencia: string | null; metodo: string; destino: string; valor: number;
  envio: string | null; envioErro: string | null; enviadoEm: string | null; banco: string | null; efetuadoEm: string | null; observacao: string | null;
  consultadoEm: string | null; codPagamento: string | null;
}

const ehEfetuado = (i: ItemLote) => !!i.banco && semAcento(i.banco) === 'EFETUADO';
// Pagamento aceito pela API e ainda sem "Efetuado" — dá pra consultar no Itaú
const aguardaConsulta = (i: ItemLote) => !!i.codPagamento && i.envio !== 'Erro' && !ehEfetuado(i);
interface DetalheLote {
  lote: { id: number; nome: string; tipo: string; parceiro: string; mes: string; dataPagamento: string | null; status: string; ativo: boolean; criadoPor: string | null; criadoEm: string; empresa: string | null; valor: number; qtd: number };
  itens: ItemLote[];
}

// Situação do envio (API do Itaú) e situação no banco (status consultado depois)
function ChipEnvio({ item }: { item: ItemLote }) {
  if (item.envio === 'Erro') return <span title={item.envioErro || ''} className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-red-100 text-red-700 cursor-help">Recusado</span>;
  if (item.envio) return <span title={item.enviadoEm ? `Enviado em ${fmtDataHora(item.enviadoEm)}` : ''} className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-100 text-blue-700">Enviado</span>;
  return <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-gray-100 text-gray-500">Não enviado</span>;
}
function ChipBanco({ item }: { item: ItemLote }) {
  if (!item.banco) return <span title="Situação ainda não consultada no Itaú — use Atualizar situação no Itaú" className="text-[10px] font-bold text-gray-300 cursor-help">não consultado</span>;
  return (
    <span title={item.consultadoEm ? `Consultado no Itaú em ${fmtDataHora(item.consultadoEm)}` : ''}
      className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase cursor-help ${ehEfetuado(item) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
      {item.banco}
    </span>
  );
}

export default function RelatorioLote({ accessToken, empresaId, loteInicial }: { accessToken: string; empresaId: number | null; loteInicial: number | null }) {
  const [lotes, setLotes] = useState<LoteLista[]>([]);
  const [loteId, setLoteId] = useState<number | null>(loteInicial);
  const [detalhe, setDetalhe] = useState<DetalheLote | null>(null);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroFonte, setFiltroFonte] = useState('TODAS');

  useEffect(() => { if (loteInicial) setLoteId(loteInicial); }, [loteInicial]);

  useEffect(() => {
    setCarregandoLista(true);
    listarLotesRelatorioAction({ empresaId }, accessToken).then(res => {
      if (res.ok) {
        setLotes(res.info.lotes);
        setLoteId(atual => (atual && res.info.lotes.some((l: LoteLista) => l.id === atual)) ? atual : (res.info.lotes[0]?.id ?? null));
      } else setErro(res.erro || 'Não foi possível listar os lotes.');
      setCarregandoLista(false);
    });
  }, [empresaId, accessToken]);

  const carregarDetalhe = async (id: number, silencioso = false) => {
    if (!silencioso) { setCarregando(true); setBusca(''); setFiltroFonte('TODAS'); }
    setErro(null);
    const res = await detalheLoteRelatorioAction({ loteId: id, empresaId }, accessToken);
    if (res.ok) setDetalhe(res.info); else { setDetalhe(null); setErro(res.erro || 'Não foi possível carregar o lote.'); }
    if (!silencioso) setCarregando(false);
  };

  useEffect(() => {
    if (!loteId) { setDetalhe(null); return; }
    carregarDetalhe(loteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loteId, empresaId, accessToken]);

  // "Atualizar situação no Itaú": consulta, de 10 em 10, os pagamentos aceitos
  // pela API que ainda não estão como Efetuado, e grava no lote.
  const [atualizando, setAtualizando] = useState<{ feitos: number; total: number } | null>(null);
  const [avisoAtualizacao, setAvisoAtualizacao] = useState<string | null>(null);
  const atualizarSituacaoItau = async () => {
    if (!detalhe) return;
    const codigos = detalhe.itens.filter(aguardaConsulta).map(i => i.codPagamento!) ;
    if (codigos.length === 0) return;
    setAvisoAtualizacao(null);
    setAtualizando({ feitos: 0, total: codigos.length });
    const falhas: string[] = [];
    for (let i = 0; i < codigos.length; i += 10) {
      const res = await atualizarStatusItauLoteAction({ loteId: detalhe.lote.id, codigos: codigos.slice(i, i + 10), empresaId }, accessToken);
      if (!res.ok) { setAvisoAtualizacao(`Parou no meio: ${res.erro}`); break; }
      falhas.push(...(res.info.falhas || []));
      setAtualizando({ feitos: Math.min(i + 10, codigos.length), total: codigos.length });
    }
    await carregarDetalhe(detalhe.lote.id, true);
    setAtualizando(null);
    if (falhas.length) setAvisoAtualizacao(`O Itaú não respondeu para: ${falhas.join(', ')}. Tente de novo.`);
  };

  const fontes = useMemo(() => [...new Set((detalhe?.itens || []).map(i => i.fonte))].sort(), [detalhe]);
  const itensFiltrados = useMemo(() => (detalhe?.itens || []).filter(i =>
    (filtroFonte === 'TODAS' || i.fonte === filtroFonte) &&
    (!busca || semAcento(`${i.favorecido} ${i.referencia || ''}`).includes(semAcento(busca)))
  ), [detalhe, busca, filtroFonte]);

  // Resumos: por fonte e por situação (sempre do lote inteiro, não do filtro)
  const resumo = useMemo(() => {
    const porFonte: Record<string, { qtd: number; valor: number }> = {};
    const sit = { efetuado: { qtd: 0, valor: 0 }, enviado: { qtd: 0, valor: 0 }, recusado: { qtd: 0, valor: 0 }, naoEnviado: { qtd: 0, valor: 0 } };
    (detalhe?.itens || []).forEach(i => {
      (porFonte[i.fonte] ||= { qtd: 0, valor: 0 }); porFonte[i.fonte].qtd++; porFonte[i.fonte].valor += i.valor;
      const k = i.banco && semAcento(i.banco) === 'EFETUADO' ? 'efetuado' : i.envio === 'Erro' ? 'recusado' : i.envio ? 'enviado' : 'naoEnviado';
      sit[k].qtd++; sit[k].valor += i.valor;
    });
    return { porFonte: Object.entries(porFonte).sort((a, b) => b[1].valor - a[1].valor), sit };
  }, [detalhe]);

  const totalFiltrado = itensFiltrados.reduce((s, i) => s + i.valor, 0);

  const exportarCSV = () => {
    if (!detalhe) return;
    const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cab = ['#', 'Favorecido', 'Fonte', 'Referência', 'Método', 'Destino', 'Valor', 'Envio', 'Situação no banco', 'Observação'];
    const linhas = itensFiltrados.map(i => [
      i.seq, i.favorecido, i.fonte, i.referencia, i.metodo, i.destino, i.valor.toFixed(2).replace('.', ','),
      i.envio === 'Erro' ? `Recusado${i.envioErro ? ` (${i.envioErro})` : ''}` : i.envio ? 'Enviado' : 'Não enviado',
      i.banco || '', i.observacao || ''
    ].map(esc).join(';'));
    linhas.push(['', 'TOTAL', '', '', '', '', totalFiltrado.toFixed(2).replace('.', ','), '', '', ''].map(esc).join(';'));
    const blob = new Blob(['﻿' + [cab.map(esc).join(';'), ...linhas].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lote-${detalhe.lote.id}-${detalhe.lote.mes}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Escolha do lote */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">Lote gerado</label>
          <select value={loteId ?? ''} onChange={e => setLoteId(e.target.value ? Number(e.target.value) : null)} disabled={carregandoLista || lotes.length === 0}
            className="w-full min-w-0 p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC] truncate">
            {carregandoLista && <option>Carregando lotes...</option>}
            {!carregandoLista && lotes.length === 0 && <option value="">Nenhum lote gerado</option>}
            {lotes.map(l => (
              <option key={l.id} value={l.id}>
                #{l.id} · {l.dataPagamento ? `pagto ${fmtDataBR(l.dataPagamento)}` : `comp. ${fmtMesBR(l.mes)}`} · {l.nome} · {l.qtd} pgto(s) · {BRL(l.valor)}{l.ativo ? '' : ' · DESATIVADO'}
              </option>
            ))}
          </select>
        </div>
        <button onClick={exportarCSV} disabled={!detalhe || itensFiltrados.length === 0}
          className="text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50 shrink-0">
          ⬇ Exportar CSV
        </button>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center text-red-600 font-bold">{erro}</div>}
      {carregando && <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando lote...</div>}

      {!carregando && detalhe && (
        <>
          {/* Cabeçalho do lote */}
          <div className={`bg-white rounded-2xl shadow-sm border p-5 ${detalhe.lote.ativo ? 'border-[#E2E8F0]' : 'border-red-300'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Lote #{detalhe.lote.id} · {detalhe.lote.parceiro}</p>
                <h3 className="text-lg font-black text-[#0C1D4D] leading-tight">{detalhe.lote.nome}</h3>
              </div>
              <div className="flex gap-2">
                <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-blue-100 text-blue-700">{detalhe.lote.status}</span>
                {!detalhe.lote.ativo && <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-red-100 text-red-700">Desativado</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                ['Competência', fmtMesBR(detalhe.lote.mes)],
                ['Data de pagamento', fmtDataBR(detalhe.lote.dataPagamento)],
                ['Empresa', detalhe.lote.empresa || '—'],
                ['Gerado por', detalhe.lote.criadoPor || '—'],
                ['Gerado em', fmtDataHora(detalhe.lote.criadoEm)],
                ['Total', `${BRL(detalhe.lote.valor)} · ${detalhe.lote.qtd} pgto(s)`],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="bg-[#F8FAFC] rounded-xl p-3 min-w-0">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-0.5">{rotulo}</p>
                  <p className="text-sm font-black text-[#0C1D4D] truncate" title={valor}>{valor}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Resumos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Por fonte</h3>
              <div className="space-y-1.5">
                {resumo.porFonte.map(([fonte, v]) => (
                  <button key={fonte} onClick={() => setFiltroFonte(filtroFonte === fonte ? 'TODAS' : fonte)}
                    className={`w-full flex justify-between items-center text-left px-3 py-2 rounded-lg text-[11px] font-bold transition-colors ${filtroFonte === fonte ? 'bg-[#0C1D4D] text-white' : 'bg-[#F8FAFC] hover:bg-gray-100 text-[#0C1D4D]'}`}>
                    <span className="uppercase truncate pr-2">{fonte} <span className="opacity-60">({v.qtd})</span></span>
                    <span className="font-black tabular-nums shrink-0">{BRL(v.valor)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Situação dos pagamentos</h3>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ['Efetuado no banco', resumo.sit.efetuado, 'text-emerald-700 bg-emerald-50'],
                  ['Enviado (aguardando)', resumo.sit.enviado, 'text-blue-700 bg-blue-50'],
                  ['Recusado', resumo.sit.recusado, 'text-red-700 bg-red-50'],
                  ['Não enviado', resumo.sit.naoEnviado, 'text-gray-600 bg-gray-50'],
                ] as const).map(([rotulo, v, cor]) => (
                  <div key={rotulo} className={`rounded-xl p-3 ${cor}`}>
                    <p className="text-[9px] font-black uppercase tracking-widest opacity-80">{rotulo}</p>
                    <p className="text-lg font-black tabular-nums">{v.qtd}</p>
                    <p className="text-[10px] font-bold tabular-nums">{BRL(v.valor)}</p>
                  </div>
                ))}
              </div>
              {(() => {
                const pendentes = detalhe.itens.filter(aguardaConsulta).length;
                return (
                  <div className="mt-3 flex flex-col gap-1.5">
                    <button onClick={atualizarSituacaoItau} disabled={!!atualizando || pendentes === 0}
                      className="w-full text-[10px] font-black uppercase tracking-wider py-2.5 rounded-lg bg-[#0C1D4D] hover:bg-[#284B8C] text-white disabled:opacity-50">
                      {atualizando
                        ? `⏳ Consultando no Itaú... ${atualizando.feitos}/${atualizando.total}`
                        : pendentes === 0 ? '✓ Situação no Itaú em dia' : `🔄 Atualizar situação no Itaú (${pendentes})`}
                    </button>
                    {avisoAtualizacao && <p className="text-[10px] font-bold text-red-600">{avisoAtualizacao}</p>}
                    <p className="text-[9px] font-bold text-gray-400">"Efetuado" só aparece depois de consultar o Itaú. A consulta grava a situação no lote — não dá baixa em OP/Conta a Pagar (isso continua em Lotes de Pagamento).</p>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Grid de pagamentos */}
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">
                Pagamentos do lote {filtroFonte !== 'TODAS' && <span className="text-[#336699]">· {filtroFonte}</span>}
              </h3>
              <div className="flex gap-2 items-center">
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔍 Buscar favorecido ou OP..."
                  className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC] w-full sm:w-64" />
                {(busca || filtroFonte !== 'TODAS') && (
                  <button onClick={() => { setBusca(''); setFiltroFonte('TODAS'); }} className="text-[10px] font-black text-red-500 uppercase shrink-0">✕ Limpar</button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                    {['#', 'Favorecido', 'Fonte', 'Método / destino', 'Valor', 'Envio', 'No banco', 'Observação'].map((h, i) => (
                      <th key={h} className={`p-3 font-black text-[#0C1D4D] uppercase text-[10px] ${i === 4 ? 'text-right' : i >= 5 && i <= 6 ? 'text-center' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itensFiltrados.length === 0 ? (
                    <tr><td colSpan={8} className="p-10 text-center text-gray-400 font-bold text-xs uppercase">Nenhum pagamento neste filtro.</td></tr>
                  ) : itensFiltrados.map((i, idx) => (
                    <tr key={i.seq} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                      <td className="p-3 text-[11px] font-bold text-gray-400 tabular-nums">{i.seq}</td>
                      <td className="p-3 font-black text-[#0C1D4D]">{i.favorecido}</td>
                      <td className="p-3 text-[11px] font-bold text-gray-600 uppercase whitespace-nowrap">
                        {i.fonte}{i.referencia && <span className="block text-[10px] text-[#336699] normal-case">{i.referencia}</span>}
                      </td>
                      <td className="p-3 text-[11px] text-gray-600 whitespace-nowrap"><span className="font-black">{i.metodo}</span><span className="block text-[10px] text-gray-400">{i.destino}</span></td>
                      <td className="p-3 text-right font-black tabular-nums whitespace-nowrap">{BRL(i.valor)}</td>
                      <td className="p-3 text-center"><ChipEnvio item={i} /></td>
                      <td className="p-3 text-center whitespace-nowrap"><ChipBanco item={i} /></td>
                      <td className="p-3 text-[10px] text-gray-500 max-w-[220px]">{i.envio === 'Erro' && i.envioErro ? <span className="text-red-600 font-bold">{i.envioErro}</span> : (i.observacao || '')}</td>
                    </tr>
                  ))}
                </tbody>
                {itensFiltrados.length > 0 && (
                  <tfoot>
                    <tr className="bg-[#F8FAFC] border-t-2 border-[#0C1D4D]">
                      <td colSpan={4} className="p-3 font-black text-[#0C1D4D] uppercase text-[11px]">
                        Total {itensFiltrados.length !== detalhe.itens.length ? `(${itensFiltrados.length} de ${detalhe.itens.length})` : `(${itensFiltrados.length})`}
                      </td>
                      <td className="p-3 text-right font-black text-[#0C1D4D] tabular-nums whitespace-nowrap">{BRL(totalFiltrado)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
