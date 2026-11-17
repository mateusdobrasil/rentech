"use client";

// Histórico do P2S (2026-11-17): progresso da carga completa (fichas de
// reserva, fichas de locação, contas a receber e a pagar, mês a mês) e botão
// para adiantar. A carga roda sozinha de madrugada (/api/cron/historico-p2s).
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { statusHistoricoAction, avancarHistoricoAgoraAction } from './actions';

const ROTA = '/admin/parametros/historico-p2s';
const INICIO = 201001;
const mesTxt = (c: number) => `${String(c % 100).padStart(2, '0')}/${Math.floor(c / 100)}`;
const mesesEntre = (a: number, b: number) => (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100);
const limite = (mesesAFrente: number) => { const h = new Date(); const base = h.getFullYear() * 100 + h.getMonth() + 1; let c = base; for (let i = 0; i < mesesAFrente; i++) c = c % 100 === 12 ? c + 89 : c + 1; return c; };

export default function HistoricoP2sPage() {
  const toast = useToast();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota: ROTA });
  const [info, setInfo] = useState<any>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [ultimo, setUltimo] = useState<any>(null);

  const carregar = useCallback(async () => {
    const r = await statusHistoricoAction(accessToken);
    if (r.ok) { setInfo(r.info); setFalha(null); } else setFalha(r.erro || 'Erro ao carregar.');
  }, [accessToken]);

  useEffect(() => { if (!authLoading && !acessoNegado && accessToken) carregar(); }, [authLoading, acessoNegado, accessToken, carregar]);

  const avancar = async () => {
    setRodando(true);
    const r = await avancarHistoricoAgoraAction(accessToken);
    setRodando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao avançar.', 'error');
    setUltimo(r.info);
    const gravados = r.info.passos.reduce((s: number, p: any) => s + p.gravados, 0);
    toast(`${r.info.passos.length} mês(es) importado(s), ${gravados.toLocaleString('pt-BR')} registro(s).`, 'success');
    carregar();
  };

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><p className="text-sm text-red-600 font-bold">Acesso restrito ao Histórico do P2S.</p></div>;

  const card = 'bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6';
  const tudoConcluido = info?.trabalhos?.every((t: any) => t.estado?.concluido);

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />
      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Histórico do P2S</h1>
          <p className="text-sm text-gray-500">Importação de todo o histórico de locações e financeiro do PrimeStart, mês a mês.</p>
        </div>
        <Link href="/admin/parametros" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-6 py-3 rounded-lg uppercase tracking-wider shadow-sm">⬅ Voltar ao Hub</Link>
      </div>

      <div className="px-4 md:px-8 pb-8 space-y-6 max-w-6xl w-full">
        {falha && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm">{falha} — rode .sql/Pendentes/historico_p2s.sql se ainda não rodou.</div>}

        <div className={card}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
            <p className="text-xs text-gray-500 max-w-2xl">
              A carga roda sozinha toda madrugada (0h–6h) e retoma de onde parou. Cada mês é gravado por cima (sem duplicar), então dá para rodar quantas vezes quiser.
              “Avançar agora” importa por até ~3 min — use fora do horário de pico do P2S.
            </p>
            <button onClick={avancar} disabled={rodando || !info || tudoConcluido} className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-black text-xs uppercase tracking-wider whitespace-nowrap">
              {rodando ? '⏳ Importando...' : tudoConcluido ? '✔ Concluído' : '▶ Avançar agora'}
            </button>
          </div>
          <div className="space-y-3">
            {(info?.trabalhos || []).map((t: any) => {
              const e = t.estado;
              const cursor = Number(e?.cursor) || INICIO;
              const fim = limite(t.mesesAFrente);
              const total = Math.max(1, mesesEntre(INICIO, fim) + 1);
              const feitos = Math.min(total, Math.max(0, mesesEntre(INICIO, cursor)));
              const pct = e?.concluido ? 100 : Math.round((feitos / total) * 100);
              return (
                <div key={t.chave} className="border border-[#E2E8F0] rounded-xl p-3">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <span className="font-black text-[#0C1D4D]">{t.rotulo}</span>
                    <span className="text-xs text-gray-500">
                      {!e ? 'não iniciado' : e.concluido ? '✔ concluído' : `próximo mês: ${mesTxt(cursor)}`} · {(Number(e?.processados) || 0).toLocaleString('pt-BR')} gravado(s)
                    </span>
                  </div>
                  <div className="h-2 bg-[#F1F5F9] rounded-full mt-2 overflow-hidden"><div className={`h-full ${e?.concluido ? 'bg-emerald-500' : 'bg-[#336699]'}`} style={{ width: `${pct}%` }}></div></div>
                  {e?.ultimo_erro && <p className="text-[11px] text-red-600 mt-1">Último erro: {e.ultimo_erro}</p>}
                </div>
              );
            })}
          </div>
        </div>

        {info?.totais && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {([['Fichas de reserva', info.totais.reservas], ['Fichas de locação', info.totais.locacoes], ['Movimentos (saída/devolução)', info.totais.movimentos], ['Contas a receber', info.totais.receber], ['Contas a pagar', info.totais.pagar]] as [string, number][]).map(([r, v]) => (
              <div key={r} className={card}><p className="text-2xl font-black text-[#0C1D4D]">{v.toLocaleString('pt-BR')}</p><p className="text-[10px] font-black text-gray-500 uppercase mt-1">{r}</p></div>
            ))}
          </div>
        )}

        {ultimo?.passos?.length > 0 && (
          <div className={card}>
            <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Última rodada</h2>
            <div className="text-xs text-gray-600 grid md:grid-cols-2 gap-x-6">
              {ultimo.passos.map((p: any, i: number) => (
                <p key={i} className={p.erro ? 'text-red-600' : ''}>{info?.trabalhos?.find((t: any) => t.chave === p.trabalho)?.rotulo} · {p.mes}: {p.erro ? `erro — ${p.erro}` : `${p.gravados} gravado(s)`}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
