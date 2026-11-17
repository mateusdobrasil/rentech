"use client";

// Painel "Faturamento" da Ficha de Reserva (2026-11-17, Fase 3a): títulos a
// receber já gerados e geração das parcelas a partir da condição de
// pagamento (sugestão editável). Gerar exige acesso a Financeiro → Títulos a
// Receber (2FA); quem só vê a ficha enxerga a lista.
import { useState, useEffect, useCallback } from 'react';
import { titulosDaFichaAction, gerarTitulosFichaAction } from '../../../financeiro/titulos-receber/actions';
import { useToast } from '../../../../components/ui/NotificationProvider';
import { formatarMoeda, formatarDataBR } from '../../../../lib/formatadores';
import { somarDias, hojeISO } from '../../../../lib/locacao/datas';

interface Parcela { valor: string; vencimento: string; descricao: string }
const lerValor = (s: string) => { const t = (s || '').replace(/\s|R\$/g, ''); if (!t) return 0; const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(v) ? v : NaN; };
const mostrar = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PainelTitulos({ fichaId, accessToken, statusFicha, alterado, condicao }: {
  fichaId: number; accessToken: string; statusFicha: string; alterado: boolean; condicao: string;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<any>(null);
  const [editando, setEditando] = useState<Parcela[] | null>(null);
  const [gerando, setGerando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await titulosDaFichaAction(fichaId, accessToken);
    if (r.ok) setInfo(r.info);
  }, [fichaId, accessToken]);
  useEffect(() => { carregar(); }, [carregar, statusFicha]);

  if (!info) return null;
  if (!info.faturavel && !info.titulos.length) return null;

  const hoje = hojeISO();
  const totalEdit = editando ? editando.reduce((s, p) => s + (Number.isNaN(lerValor(p.valor)) ? 0 : lerValor(p.valor)), 0) : 0;

  const abrirGeracao = () => {
    if (alterado) return toast('Salve a ficha antes de gerar os títulos.', 'info');
    setEditando((info.sugestao as any[]).map(p => ({ valor: mostrar(p.valor), vencimento: p.vencimento, descricao: p.descricao })));
  };
  const gerar = async () => {
    if (!editando) return;
    if (editando.some(p => Number.isNaN(lerValor(p.valor)) || !(lerValor(p.valor) > 0) || !p.vencimento)) return toast('Confira valores e vencimentos.', 'error');
    if (totalEdit > info.saldo + 0.01) return toast(`O total das parcelas passa do saldo a faturar (${formatarMoeda(info.saldo)}).`, 'error');
    setGerando(true);
    const r = await gerarTitulosFichaAction(fichaId, editando.map(p => ({ valor: lerValor(p.valor), vencimento: p.vencimento, descricao: p.descricao })), accessToken);
    setGerando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao gerar.', 'error');
    toast(`${r.info.gerados} título(s) a receber gerado(s).`, 'success');
    setEditando(null);
    carregar();
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-3">
        <div>
          <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Faturamento</h2>
          <p className="text-[10px] text-gray-500">Gerado {formatarMoeda(info.gerado)} · saldo a faturar <strong>{formatarMoeda(info.saldo)}</strong>{condicao ? ` · condição: ${condicao}` : ''} · ensaio enquanto o P2S for oficial</p>
        </div>
        {info.faturavel && info.saldo > 0.009 && !editando && (
          info.podeGerar
            ? <button onClick={abrirGeracao} className="bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-4 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider">💵 Gerar títulos a receber</button>
            : <p className="text-[10px] text-gray-400">Gerar títulos exige acesso a Financeiro → Títulos a Receber.</p>
        )}
      </div>

      {info.titulos.length > 0 && (
        <table className="w-full text-xs mb-3">
          <thead><tr className="text-left text-[10px] font-black text-gray-500 uppercase border-b border-[#E2E8F0]">
            <th className="p-2">Parcela</th><th className="p-2">Vencimento</th><th className="p-2 text-right">Valor</th><th className="p-2">Situação</th>
          </tr></thead>
          <tbody>
            {info.titulos.map((t: any) => {
              const vencido = t.status === 'ABERTO' && t.vencimento < hoje;
              return (
                <tr key={t.id} className="border-b border-[#F1F5F9]">
                  <td className="p-2">{t.parcela}/{t.total_parcelas} <span className="text-gray-400">#{t.id}</span></td>
                  <td className={`p-2 ${vencido ? 'text-red-600 font-bold' : ''}`}>{formatarDataBR(t.vencimento)}</td>
                  <td className="p-2 text-right font-bold">{formatarMoeda(Number(t.valor))}</td>
                  <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${t.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : t.status === 'CANCELADO' ? 'bg-gray-100 text-gray-500' : vencido ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>
                    {t.status === 'PAGO' ? `Pago ${formatarDataBR(t.data_pagamento)}` : t.status === 'CANCELADO' ? 'Cancelado' : vencido ? 'Vencido' : 'Em aberto'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {editando && (
        <div className="border border-[#336699]/30 bg-[#F8FAFC] rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-black text-gray-500 uppercase">Parcelas sugeridas pela condição de pagamento — ajuste se precisar</p>
          {editando.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black w-10">{i + 1}ª</span>
              <input value={p.valor} onChange={e => setEditando(l => l!.map((x, j) => j === i ? { ...x, valor: e.target.value } : x))} inputMode="decimal" className="w-32 border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-sm text-right" />
              <input type="date" value={p.vencimento} onChange={e => setEditando(l => l!.map((x, j) => j === i ? { ...x, vencimento: e.target.value } : x))} className="border border-[#CBD5E1] rounded-lg px-2 py-1.5 text-sm" />
              <span className="text-[10px] text-gray-400">{p.descricao}</span>
              {editando.length > 1 && <button onClick={() => setEditando(l => l!.filter((_, j) => j !== i))} className="text-red-400 font-bold text-lg leading-none">×</button>}
            </div>
          ))}
          <div className="flex flex-wrap justify-between items-center gap-2 pt-1">
            <button onClick={() => setEditando(l => [...l!, { valor: '', vencimento: somarDias(l![l!.length - 1]?.vencimento || hoje, 30), descricao: '' }])} className="text-[10px] font-black uppercase text-[#336699]">+ parcela</button>
            <span className={`text-xs font-black ${Math.abs(totalEdit - info.saldo) < 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>Total {formatarMoeda(totalEdit)} de {formatarMoeda(info.saldo)}</span>
            <div className="flex gap-2">
              <button onClick={() => setEditando(null)} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
              <button onClick={gerar} disabled={gerando} className="bg-emerald-600 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-[10px] font-black uppercase">{gerando ? 'Gerando...' : 'Gerar títulos'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
