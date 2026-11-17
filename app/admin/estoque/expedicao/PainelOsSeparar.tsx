"use client";

// Painel "OS para separar" do topo da Expedição (2026-11-17): fichas
// aprovadas/reservadas que ainda não estão em nenhum checklist. A ficha entra
// aqui sozinha quando é aprovada (e a equipe recebe aviso no app). Some quando
// um checklist importa os itens dela ("Importar das OS's") ou cita o nº.
import { useState, useEffect, useCallback } from 'react';
import { osParaSepararAction } from './actions-fichas';

export interface OsSeparar {
  ficha_id: number; numero: string; origem: 'SISTEMA' | 'P2S'; status: string; empresa_id: number;
  cliente: string; evento: { nome: string; local: string | null; data_inicial: string | null; data_final: string | null; p2s_oid: string | null } | null;
  local: string | null; vendedor: string | null; saida: string; inicio: string; fim: string; dias_ate_saida: number;
  aprovado_em: string | null; novo: boolean; qtd_itens: number;
}

const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const quando = (d: number) => (d < 0 ? `atrasada ${-d} dia${d === -1 ? '' : 's'}` : d === 0 ? 'sai hoje' : d === 1 ? 'sai amanhã' : `sai em ${d} dias`);
const corPrazo = (d: number) => (d < 0 ? 'bg-red-100 text-red-700' : d <= 2 ? 'bg-orange-100 text-orange-700' : d <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600');

export default function PainelOsSeparar({ accessToken, onCriarChecklist }: { accessToken: string; onCriarChecklist: (os: OsSeparar) => void }) {
  const [os, setOs] = useState<OsSeparar[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [verTodas, setVerTodas] = useState(false);

  const carregar = useCallback(async () => {
    const r = await osParaSepararAction(accessToken);
    if (r.ok) { setOs(r.info.os); setErro(null); } else setErro(r.erro || 'Erro ao carregar as OS.');
    setCarregando(false);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    carregar();
    const t = setInterval(carregar, 120_000); // atualiza sozinho a cada 2 min
    return () => clearInterval(t);
  }, [accessToken, carregar]);

  if (carregando) return null;
  if (erro) return <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-xs no-print">OS para separar: {erro}</div>;
  if (!os.length) {
    return <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 text-xs font-bold no-print">✔ Nenhuma OS aprovada aguardando separação — todas já estão em checklist.</div>;
  }

  const urgentes = os.filter(o => o.dias_ate_saida <= 7);
  const novas = os.filter(o => o.novo).length;
  const lista = verTodas ? os : (urgentes.length ? urgentes : os.slice(0, 5));

  return (
    <div className="bg-white rounded-2xl border-2 border-orange-300 shadow-sm p-4 md:p-6 no-print">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-3">
        <div>
          <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">📦 OS para separar
            <span className="ml-2 text-xs font-black px-2 py-0.5 rounded-full bg-orange-500 text-white align-middle">{os.length}</span>
            {novas > 0 && <span className="ml-1 text-xs font-black px-2 py-0.5 rounded-full bg-emerald-600 text-white align-middle">{novas} nova{novas > 1 ? 's' : ''}</span>}
          </h2>
          <p className="text-[11px] text-gray-500">Fichas aprovadas que ainda não estão em nenhum checklist. {urgentes.length ? `${urgentes.length} saem nos próximos 7 dias (ou estão atrasadas).` : 'Nenhuma sai nos próximos 7 dias.'}</p>
        </div>
        <button onClick={() => setVerTodas(v => !v)} className="text-[10px] font-black uppercase text-[#336699] hover:underline">{verTodas ? 'Mostrar só as próximas' : `Ver todas (${os.length})`}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
              <th className="p-2">OS</th><th className="p-2">Cliente / Evento</th><th className="p-2">Saída</th><th className="p-2">Evento</th><th className="p-2 text-right">Equip.</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {lista.map(o => (
              <tr key={o.ficha_id} className={`border-b border-[#F1F5F9] ${o.novo ? 'bg-emerald-50/50' : ''}`}>
                <td className="p-2 whitespace-nowrap">
                  <span className="font-black text-[#0C1D4D]">{o.numero}</span>
                  {o.origem === 'P2S' && <span className="ml-1 text-[8px] font-black px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">P2S</span>}
                  {o.novo && <span className="ml-1 text-[8px] font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white">NOVA</span>}
                </td>
                <td className="p-2 min-w-[200px]">
                  <p className="font-bold text-[#0C1D4D]">{o.cliente}</p>
                  <p className="text-[10px] text-gray-500">{[o.evento?.nome, o.local].filter(Boolean).join(' · ') || '—'}{o.vendedor ? ` · vend. ${o.vendedor}` : ''}</p>
                </td>
                <td className="p-2 whitespace-nowrap">
                  <p className="font-bold">{dataBR(o.saida)}</p>
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${corPrazo(o.dias_ate_saida)}`}>{quando(o.dias_ate_saida)}</span>
                </td>
                <td className="p-2 whitespace-nowrap text-gray-500">{dataBR(o.inicio)} a {dataBR(o.fim)}</td>
                <td className="p-2 text-right font-bold">{o.qtd_itens.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button onClick={() => onCriarChecklist(o)} className="bg-[#336699] hover:bg-[#284B8C] text-white px-3 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-wider">➕ Criar checklist</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!verTodas && lista.length < os.length && <p className="text-[10px] text-gray-400 mt-2">+ {os.length - lista.length} OS com saída mais adiante — “Ver todas”.</p>}
    </div>
  );
}
