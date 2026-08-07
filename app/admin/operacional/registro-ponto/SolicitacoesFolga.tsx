"use client";

// Aba "Solicitação Folga": lista única (pendentes + já decididas, com coluna
// Status) das solicitações de folga feitas pelo funcionário via WhatsApp.
// Componente compartilhado — usado tanto em /admin/rh/ponto quanto em
// /admin/operacional/registro-ponto, já que os dois grupos podem aprovar.
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listarSolicitacoesFolgaAction, aprovarSolicitacaoAction, rejeitarSolicitacaoAction,
  type SolicitacaoHistorico
} from '../../rh/actions/actions-ponto-whatsapp';

function formatarPeriodo(s: SolicitacaoHistorico): string {
  const inicio = s.data_referencia.split('-').reverse().join('/');
  if (!s.data_referencia_fim || s.data_referencia_fim === s.data_referencia) return inicio;
  return `${inicio} a ${s.data_referencia_fim.split('-').reverse().join('/')}`;
}

export default function SolicitacoesFolga({ usuarioAtual, onCountChange }: { usuarioAtual: string; onCountChange?: (pendentes: number) => void }) {
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
    const res = await listarSolicitacoesFolgaAction();
    const lista = res.ok ? (res.info || []) : [];
    setSolicitacoes(lista);
    onCountChangeRef.current?.(lista.filter(s => s.status === 'PENDENTE').length);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const aprovar = async (id: number) => {
    if (!confirm('Aprovar esta folga? Isso abona os dias úteis do período em folha_ponto_abono e avisa o funcionário pelo WhatsApp.')) return;
    setProcessandoId(id);
    const res = await aprovarSolicitacaoAction({ id, aprovadorNome: usuarioAtual });
    setProcessandoId(null);
    if (!res.ok) { alert(res.erro); return; }
    await carregar();
  };

  const rejeitar = async (id: number) => {
    const motivo = prompt('Motivo da rejeição (o funcionário verá esta mensagem):');
    if (!motivo?.trim()) return;
    setProcessandoId(id);
    const res = await rejeitarSolicitacaoAction({ id, aprovadorNome: usuarioAtual, motivoRejeicao: motivo.trim() });
    setProcessandoId(null);
    if (!res.ok) { alert(res.erro); return; }
    await carregar();
  };

  return (
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
  );
}
