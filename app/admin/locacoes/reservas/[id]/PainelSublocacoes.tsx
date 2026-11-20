"use client";

// Painel "Sublocação" do editor da OS (2026-11-20): o que esta OS pegou com
// parceiros, o custo e a margem (preço da OS dos itens sublocados × custo).
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { margemOsAction } from '../../sublocacoes/actions';
import { formatarMoeda } from '../../../../lib/formatadores';

const STATUS: Record<string, string> = { SOLICITADO: 'bg-amber-100 text-amber-700', CONFIRMADO: 'bg-blue-100 text-blue-700', ENCERRADO: 'bg-gray-200 text-gray-600' };
const ROTULO: Record<string, string> = { SOLICITADO: 'solicitada', CONFIRMADO: 'confirmada', ENCERRADO: 'encerrada' };

export default function PainelSublocacoes({ fichaId, accessToken, versao, podeSublocar, onSublocar }: {
  fichaId: number; accessToken: string; versao: number; podeSublocar: boolean; onSublocar: () => void;
}) {
  const router = useRouter();
  const [m, setM] = useState<any>(null);

  useEffect(() => {
    let vivo = true;
    margemOsAction(fichaId, accessToken).then(r => { if (vivo) setM(r.ok ? r.info : { sublocacoes: [] }); });
    return () => { vivo = false; };
  }, [fichaId, accessToken, versao]);

  if (!m || (!m.sublocacoes.length && !podeSublocar)) return null;
  return (
    <div className="bg-white p-6 rounded-2xl border border-[#E2E8F0] shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">🤝 Sublocação</h2>
          <p className="text-xs text-gray-500 mt-1">Equipamento pego com parceiros para esta OS. Confirmada, a quantidade deixa de pesar no nosso estoque.</p>
        </div>
        {podeSublocar && <button onClick={onSublocar} className="text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg bg-white border border-[#E2E8F0] text-[#0C1D4D] hover:bg-gray-50">+ Sublocar</button>}
      </div>
      {m.sublocacoes.length > 0 && (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
              <th className="p-2">Sublocação</th><th className="p-2">Parceiro / itens</th><th className="p-2 text-right">Receita na OS</th><th className="p-2 text-right">Custo</th><th className="p-2 text-right">Margem</th>
            </tr></thead>
            <tbody>
              {m.sublocacoes.map((s: any) => (
                <tr key={s.id} onClick={() => router.push(`/admin/locacoes/sublocacoes/${s.id}`)} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer">
                  <td className="p-2 whitespace-nowrap"><strong>{s.numero}</strong> <span className={`ml-1 text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS[s.status] || ''}`}>{ROTULO[s.status] || s.status}</span></td>
                  <td className="p-2"><p className="font-bold">{s.fornecedor}</p><p className="text-[10px] text-gray-500">{s.itens}</p></td>
                  <td className="p-2 text-right">{formatarMoeda(s.receita)}</td>
                  <td className="p-2 text-right">{formatarMoeda(s.custo)}</td>
                  <td className={`p-2 text-right font-black ${s.margem < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatarMoeda(s.margem)}</td>
                </tr>
              ))}
              <tr className="font-black">
                <td className="p-2" colSpan={2}>Total</td><td className="p-2 text-right">{formatarMoeda(m.receita)}</td><td className="p-2 text-right">{formatarMoeda(m.custo)}</td>
                <td className={`p-2 text-right ${m.margem < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatarMoeda(m.margem)}{m.receita > 0 ? ` (${Math.round((m.margem / m.receita) * 100)}%)` : ''}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-[10px] text-gray-400 mt-2">Receita = preço unitário do equipamento nesta OS × quantidade sublocada. Custo = equipamentos + frete + avarias cobradas pelo parceiro.</p>
        </div>
      )}
    </div>
  );
}
