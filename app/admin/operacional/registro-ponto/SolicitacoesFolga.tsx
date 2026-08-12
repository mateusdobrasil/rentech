"use client";

// Aba "Solicitação Folga": lista única (pendentes + já decididas, com coluna
// Status) das solicitações de folga feitas pelo funcionário via WhatsApp.
// Componente compartilhado — usado tanto em /admin/rh/ponto quanto em
// /admin/operacional/registro-ponto, já que os dois grupos podem aprovar.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  listarSolicitacoesFolgaAction, aprovarSolicitacaoAction, rejeitarSolicitacaoAction,
  type SolicitacaoHistorico
} from '../../rh/actions/actions-ponto-whatsapp';

const DIAS_SEMANA_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function formatarPeriodo(s: SolicitacaoHistorico): string {
  const inicio = s.data_referencia.split('-').reverse().join('/');
  if (!s.data_referencia_fim || s.data_referencia_fim === s.data_referencia) return inicio;
  return `${inicio} a ${s.data_referencia_fim.split('-').reverse().join('/')}`;
}

function diaSeguinte(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

// Grade de semanas (domingo a sábado) do mês, com null nas células vazias
// antes do dia 1 / depois do último dia.
function semanasDoMes(mesAno: string): (string | null)[][] {
  const [ano, mes] = mesAno.split('-').map(Number);
  const offset = new Date(ano, mes - 1, 1).getDay();
  const numDias = new Date(ano, mes, 0).getDate();

  const celulas: (string | null)[] = Array(offset).fill(null);
  for (let dia = 1; dia <= numDias; dia++) {
    celulas.push(`${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
  }
  while (celulas.length % 7 !== 0) celulas.push(null);

  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

function CalendarioFolgas({ solicitacoes }: { solicitacoes: SolicitacaoHistorico[] }) {
  const [mesAno, setMesAno] = useState(() => new Date().toLocaleDateString('en-CA').slice(0, 7));

  // Só folgas já APROVADAS viram dia marcado no calendário — pendente ainda
  // não é folga de verdade, e rejeitada nunca foi.
  const diasComFolga = useMemo(() => {
    const mapa: Record<string, string[]> = {};
    solicitacoes.filter(s => s.status === 'APROVADA').forEach(s => {
      const fim = s.data_referencia_fim || s.data_referencia;
      let cursor = s.data_referencia;
      while (cursor <= fim) {
        (mapa[cursor] ||= []).push(s.funcionario_nome);
        cursor = diaSeguinte(cursor);
      }
    });
    return mapa;
  }, [solicitacoes]);

  const semanas = useMemo(() => semanasDoMes(mesAno), [mesAno]);
  const hojeIso = new Date().toLocaleDateString('en-CA');

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
      <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-col sm:flex-row justify-between sm:items-center gap-2">
        <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">📅 Calendário de Folgas Aprovadas</h2>
        <input
          type="month"
          value={mesAno}
          onChange={(e) => setMesAno(e.target.value)}
          className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-white"
        />
      </div>

      <div className="grid grid-cols-7 bg-[#0C1D4D] text-white">
        {DIAS_SEMANA_ABREV.map(dia => (
          <div key={dia} className="p-2 text-center text-[9px] font-black uppercase tracking-wider">{dia}</div>
        ))}
      </div>

      {semanas.map((semana, wi) => (
        <div key={wi} className="grid grid-cols-7 border-t border-[#E2E8F0]">
          {semana.map((iso, di) => {
            const nomes = iso ? (diasComFolga[iso] || []) : [];
            const ehHoje = iso === hojeIso;
            return (
              <div key={di} className={`min-h-[64px] p-1.5 border-r border-[#E2E8F0] last:border-r-0 ${!iso ? 'bg-[#F8FAFC]' : ehHoje ? 'bg-cyan-50' : ''}`}>
                {iso && (
                  <>
                    <span className={`block text-[10px] font-black mb-1 ${ehHoje ? 'text-cyan-700' : 'text-[#94A3B8]'}`}>{iso.split('-')[2]}</span>
                    <div className="space-y-0.5">
                      {nomes.map((nome, ni) => (
                        <span key={ni} className="block text-[9px] font-bold text-cyan-800 bg-cyan-50 border border-cyan-200 rounded px-1 py-0.5 truncate" title={nome}>
                          {nome.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function SolicitacoesFolga({ usuarioAtual, accessToken, onCountChange, mostrarCalendario }: { usuarioAtual: string; accessToken: string; onCountChange?: (pendentes: number) => void; mostrarCalendario?: boolean }) {
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoHistorico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [processandoId, setProcessandoId] = useState<number | null>(null);

  // onCountChange fica numa ref (não numa dependência do useCallback abaixo)
  // de propósito: se o chamador passar uma função nova a cada render (como
  // acontecia em /admin/rh/ponto), isso recriaria `carregar` e o useEffect
  // de busca reiniciaria em loop infinito — carregando sem nunca parar.
  const onCountChangeRef = useRef(onCountChange);
  useEffect(() => { onCountChangeRef.current = onCountChange; }, [onCountChange]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const res = await listarSolicitacoesFolgaAction(accessToken);
    const lista = res.ok ? (res.info || []) : [];
    setSolicitacoes(lista);
    onCountChangeRef.current?.(lista.filter(s => s.status === 'PENDENTE').length);
    setCarregando(false);
  }, [accessToken]);

  useEffect(() => { carregar(); }, [carregar]);

  const aprovar = async (id: number) => {
    if (!confirm('Aprovar esta folga? Isso abona os dias úteis do período em folha_ponto_abono e avisa o funcionário pelo WhatsApp.')) return;
    setProcessandoId(id);
    const res = await aprovarSolicitacaoAction({ id, aprovadorNome: usuarioAtual }, accessToken);
    setProcessandoId(null);
    if (!res.ok) { alert(res.erro); return; }
    await carregar();
  };

  const rejeitar = async (id: number) => {
    const motivo = prompt('Motivo da rejeição (o funcionário verá esta mensagem):');
    if (!motivo?.trim()) return;
    setProcessandoId(id);
    const res = await rejeitarSolicitacaoAction({ id, aprovadorNome: usuarioAtual, motivoRejeicao: motivo.trim() }, accessToken);
    setProcessandoId(null);
    if (!res.ok) { alert(res.erro); return; }
    await carregar();
  };

  return (
    <div className="flex flex-col gap-4">
      {mostrarCalendario && <CalendarioFolgas solicitacoes={solicitacoes} />}

      <main className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
          <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Solicitação Folga</h2>
          <p className="text-sm text-[#64748B]">Pedidos de folga feitos pelo funcionário via WhatsApp. Aprovar abona os dias úteis do período; rejeitar só registra o status, sem mexer no ponto.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-white border-b-2 border-[#E2E8F0]">
              <tr className="text-[9px] xl:text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                <th className="p-4">Colaborador</th>
                <th className="p-4">Período</th>
                <th className="p-4">Motivo</th>
                <th className="p-4">Status</th>
                <th className="p-4">Analisado por</th>
                <th className="p-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {carregando ? (
                <tr><td colSpan={6} className="p-8 text-center text-[#94A3B8] font-bold">Carregando solicitações...</td></tr>
              ) : solicitacoes.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-[#94A3B8] font-bold">Nenhuma solicitação de folga registrada ainda.</td></tr>
              ) : (
                solicitacoes.map((s) => (
                  <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="p-4 font-black text-[#0C1D4D]">{s.funcionario_nome}</td>
                    <td className="p-4 font-bold">{formatarPeriodo(s)}</td>
                    <td className="p-4 text-xs text-gray-600">{s.motivo}</td>
                    <td className="p-4">
                      {s.status === 'PENDENTE' && <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black uppercase">Pendente</span>}
                      {s.status === 'APROVADA' && <span className="text-[9px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-black uppercase">Aprovada</span>}
                      {s.status === 'REJEITADA' && (
                        <span className="text-[9px] bg-red-100 text-red-600 px-2 py-0.5 rounded font-black uppercase" title={s.motivo_rejeicao || ''}>Rejeitada</span>
                      )}
                    </td>
                    <td className="p-4 text-xs text-gray-500">{s.resolvido_por || '—'}</td>
                    <td className="p-4 text-right">
                      {s.status === 'PENDENTE' ? (
                        <div className="flex gap-2 justify-end">
                          <button disabled={processandoId === s.id} onClick={() => aprovar(s.id)} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors">✓ Aprovar</button>
                          <button disabled={processandoId === s.id} onClick={() => rejeitar(s.id)} className="bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors">✕ Rejeitar</button>
                        </div>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
