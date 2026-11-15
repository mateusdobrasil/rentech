"use client";

import { useEffect, useState } from 'react';
import { listarMetasDiretoriaAction, salvarMetasDiretoriaAction } from './actions';
import { useToast } from '../../components/ui/NotificationProvider';
import { formatarMoeda } from '../../lib/formatadores';

// Editor das metas mensais por empresa (aba Parâmetros de /admin/diretoria) —
// tabela diretoria_metas, lida por app/lib/diretoria/metas.ts em todos os
// relatórios e nos alertas de teto. Campo vazio = sem meta naquele mês.

const TIPOS = [
  { tipo: 'FATURAMENTO', rotulo: 'Faturamento', ajuda: 'Fichas emitidas no mês' },
  { tipo: 'RECEBIMENTO', rotulo: 'Recebimento', ajuda: 'Recebido no mês (P2S)' },
  { tipo: 'TETO_OPS', rotulo: 'Teto de OPs', ajuda: 'Máximo em OPs criadas' },
  { tipo: 'TETO_INADIMPLENCIA', rotulo: 'Teto de inadimplência', ajuda: 'Máximo vencido até 1 ano' },
] as const;
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const paraTexto = (v: number | null | undefined) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const paraNumero = (s: string): number | null => {
  const limpo = s.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
};

export default function Metas({ accessToken, empresaId, empresaNome }: { accessToken: string; empresaId: number; empresaNome: string }) {
  const toast = useToast();
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [valores, setValores] = useState<Record<string, string> | null>(null);
  const [originais, setOriginais] = useState<Record<string, string>>({});
  const [progresso, setProgresso] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let ativo = true;
    listarMetasDiretoriaAction(empresaId, ano, accessToken).then(res => {
      if (!ativo) return;
      if (!res.ok) { toast(res.erro || 'Erro ao carregar metas.', 'error'); setValores({}); return; }
      const mapa: Record<string, string> = {};
      for (const m of res.info.metas as { mes: number; tipo: string; valor: number }[]) mapa[`${m.mes}:${m.tipo}`] = paraTexto(Number(m.valor));
      setValores(mapa); setOriginais(mapa); setProgresso(res.info.progresso);
    });
    return () => { ativo = false; };
  }, [empresaId, ano, accessToken, toast, recarga]);

  const alterados = valores ? Object.keys({ ...valores, ...originais }).filter(k => (valores[k] || '') !== (originais[k] || '')) : [];

  const copiarParaFrente = (mes: number) => {
    if (!valores) return;
    const novo = { ...valores };
    for (const t of TIPOS) for (let m = mes + 1; m <= 12; m++) if (valores[`${mes}:${t.tipo}`]) novo[`${m}:${t.tipo}`] = valores[`${mes}:${t.tipo}`];
    setValores(novo);
  };

  const salvar = async () => {
    if (!valores || !alterados.length) return;
    const itens = alterados.map(k => { const [mes, tipo] = k.split(':'); return { mes: Number(mes), tipo, valor: paraNumero(valores[k] || '') }; });
    if (itens.some(i => i.valor != null && Number.isNaN(i.valor))) { toast('Há valores que não são números.', 'error'); return; }
    setSalvando(true);
    const res = await salvarMetasDiretoriaAction(empresaId, ano, itens, accessToken);
    setSalvando(false);
    if (res.ok) { toast('Metas salvas.', 'success'); setRecarga(r => r + 1); } else toast(res.erro || 'Erro ao salvar metas.', 'error');
  };

  return (
    <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-black text-[#0C1D4D]">Metas mensais — {empresaNome}</p>
          <p className="text-xs text-gray-500">Em reais. Deixe em branco o que não tiver meta. Tetos: o Diretor avisa ao passar de 80% e de 100% (OPs) ou do teto (inadimplência).</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={ano} onChange={e => setAno(Number(e.target.value))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-gray-50 text-[#0C1D4D]">
            {[anoAtual - 1, anoAtual, anoAtual + 1].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={salvar} disabled={salvando || !alterados.length}
            className="bg-[#0C1D4D] text-white px-4 py-2 rounded-lg font-black uppercase text-[10px] tracking-wider hover:bg-[#284B8C] disabled:opacity-30">
            {salvando ? 'Salvando…' : alterados.length ? `Salvar (${alterados.length})` : 'Salvar'}
          </button>
        </div>
      </div>

      {progresso && (progresso.metas as any[]).some(m => m.meta) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {(progresso.metas as any[]).filter(m => m.meta).map(m => (
            <div key={m.tipo} className="bg-[#F0F4F8] rounded-xl p-3">
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider">{TIPOS.find(t => t.tipo === m.tipo)?.rotulo} · mês atual</p>
              <p className="text-sm font-black text-[#0C1D4D] mt-0.5">{m.realizado == null ? 'sem dado' : `${String(m.pct_da_meta).replace('.', ',')}%`}</p>
              <p className="text-[10px] text-gray-500">{m.realizado == null ? '' : `${formatarMoeda(m.realizado)} de ${formatarMoeda(m.meta)}`}</p>
            </div>
          ))}
        </div>
      )}

      {valores === null ? <p className="text-xs text-gray-400">Carregando…</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase">
                <th className="pb-2 pr-2">Mês</th>
                {TIPOS.map(t => <th key={t.tipo} className="pb-2 pr-2" title={t.ajuda}>{t.rotulo}<span className="block normal-case font-medium text-gray-400">{t.ajuda}</span></th>)}
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {MESES.map((nome, i) => {
                const mes = i + 1;
                return (
                  <tr key={mes} className="border-t border-gray-100">
                    <td className="py-1.5 pr-2 font-bold text-[#0C1D4D]">{nome}</td>
                    {TIPOS.map(t => {
                      const k = `${mes}:${t.tipo}`;
                      const mudou = (valores[k] || '') !== (originais[k] || '');
                      return (
                        <td key={t.tipo} className="py-1 pr-2">
                          <input type="text" inputMode="decimal" value={valores[k] || ''} placeholder="—"
                            onChange={e => setValores({ ...valores, [k]: e.target.value })}
                            className={`w-full p-1.5 border rounded-md text-right font-semibold outline-none focus:border-[#336699] ${mudou ? 'border-[#336699] bg-blue-50' : 'border-gray-200 bg-gray-50'} text-gray-700`} />
                        </td>
                      );
                    })}
                    <td className="py-1 text-right">
                      {mes < 12 && <button onClick={() => copiarParaFrente(mes)} title="Copiar as metas deste mês para os meses seguintes" className="text-[10px] font-bold text-[#336699] hover:underline whitespace-nowrap">copiar ↓</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
