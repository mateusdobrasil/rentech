"use client";

// Painel "Sublocação" da Expedição (2026-11-20): equipamento de parceiros a
// RECEBER (sublocação confirmada) e a DEVOLVER (está com a gente). A operação
// registra a entrada/devolução por quantidade aqui mesmo — não precisa de
// acesso às telas de Locação. Some quando não há nada pendente.
import { useState, useEffect, useCallback } from 'react';
import { pendenciasExpedicaoSublocacaoAction } from '../../locacoes/sublocacoes/actions';
import ModalMovimentoSublocacao from '../../locacoes/sublocacoes/ModalMovimentoSublocacao';
import { hojeISO } from '../../../lib/locacao/datas';

const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const q3 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default function PainelSublocacaoExpedicao({ accessToken }: { accessToken: string }) {
  const [lista, setLista] = useState<any[]>([]);
  const [mov, setMov] = useState<{ s: any; tipo: 'ENTRADA' | 'DEVOLUCAO' } | null>(null);

  const carregar = useCallback(async () => {
    const r = await pendenciasExpedicaoSublocacaoAction(accessToken);
    if (r.ok) setLista(r.info);
  }, [accessToken]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!lista.length) return null;
  const hoje = hojeISO();
  return (
    <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-4 mb-4">
      <h2 className="text-xs font-black text-indigo-700 uppercase tracking-wider mb-3">🤝 Sublocação — equipamento de parceiros ({lista.length})</h2>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {lista.map(s => {
          const atrasadoReceber = s.aReceber > 0 && s.retirada < hoje;
          const atrasadoDevolver = s.comAgente > 0 && s.devolucao < hoje;
          return (
            <div key={s.id} className={`rounded-xl border p-3 text-xs ${atrasadoReceber || atrasadoDevolver ? 'border-red-200 bg-red-50/40' : 'border-[#E2E8F0]'}`}>
              <p className="font-black text-[#0C1D4D]">{s.numero} · {s.fornecedor}</p>
              <p className="text-gray-500">{[s.os, s.cliente, s.evento].filter(Boolean).join(' · ') || 'avulsa'}</p>
              <p className="mt-1">{s.itens.map((i: any) => `${q3(i.quantidade)}× ${i.descricao}`).join(', ')}</p>
              <p className="mt-1 text-gray-600">
                {s.aReceber > 0 && <span className={atrasadoReceber ? 'text-red-600 font-bold' : ''}>receber {q3(s.aReceber)} em {dataBR(s.retirada)}</span>}
                {s.aReceber > 0 && s.comAgente > 0 && ' · '}
                {s.comAgente > 0 && <span className={atrasadoDevolver ? 'text-red-600 font-bold' : ''}>devolver {q3(s.comAgente)} até {dataBR(s.devolucao)}</span>}
              </p>
              <div className="flex gap-2 mt-2">
                {s.aReceber > 0 && <button onClick={() => setMov({ s, tipo: 'ENTRADA' })} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg bg-[#0C1D4D] text-white">📥 Chegou</button>}
                {s.comAgente > 0 && <button onClick={() => setMov({ s, tipo: 'DEVOLUCAO' })} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg bg-orange-600 text-white">📤 Devolvido</button>}
              </div>
            </div>
          );
        })}
      </div>
      {mov && (
        <ModalMovimentoSublocacao sublocacaoId={mov.s.id} numero={mov.s.numero} fornecedor={mov.s.fornecedor} tipo={mov.tipo} itens={mov.s.itens} accessToken={accessToken}
          onClose={() => setMov(null)} onFeito={() => { setMov(null); carregar(); }} />
      )}
    </div>
  );
}
