"use client";

// "Conferência Montagem/Desmontagem" (2026-11-17): escolhe o evento e gera o
// PDF com uma folha por OS que está nos checklists dele (itens e serviços com
// check de montagem e desmontagem). Substitui o botão "Modelo Padrão".
import { useState, useEffect, useMemo } from 'react';
import Modal from '../../../components/ui/Modal';
import { eventosComChecklistAction, conferenciaMontagemAction } from './actions-fichas';

interface EventoCk { nome: string; checklists: number; status: string[]; periodo_inicio: string | null; periodo_fim: string | null; atualizado: string }
const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const ROTULO_STATUS: Record<string, string> = { RASCUNHO: 'rascunho', SAIDA_CONFERIDA: 'saída conferida', FINALIZADO: 'finalizado' };

function abrirBase64(base64: string, nome: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new File([bytes], nome, { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function ModalConferenciaMontagem({ aberto, onFechar, accessToken, avisar }: {
  aberto: boolean; onFechar: () => void; accessToken: string;
  avisar: (msg: string, tipo: 'success' | 'error' | 'info') => void;
}) {
  const [eventos, setEventos] = useState<EventoCk[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setEscolhido(null); setBusca(''); setCarregando(true);
    eventosComChecklistAction(accessToken).then(r => {
      setCarregando(false);
      if (r.ok) setEventos(r.info); else avisar(r.erro || 'Erro ao carregar os eventos.', 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return eventos.filter(e => !t || e.nome.toLowerCase().includes(t)).slice(0, 60);
  }, [eventos, busca]);

  const gerar = async () => {
    if (!escolhido) return avisar('Escolha o evento.', 'info');
    setGerando(true);
    const r = await conferenciaMontagemAction(escolhido, accessToken);
    setGerando(false);
    if (!r.ok) return avisar(r.erro || 'Erro ao gerar o relatório.', 'error');
    abrirBase64(r.info.base64, r.info.nome);
    avisar(`${r.info.qtdOs} OS no relatório${r.info.foraDoSistema ? ` (${r.info.foraDoSistema} com itens tirados do checklist)` : ''}.`, 'success');
  };

  return (
    <Modal open={aberto} onClose={onFechar} title="📋 Conferência Montagem / Desmontagem"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onFechar} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Fechar</button>
          <button onClick={gerar} disabled={gerando || !escolhido} className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">{gerando ? 'Gerando...' : '🖨 Gerar PDF'}</button>
        </div>
      }>
      <p className="text-xs text-[#64748B]">Escolha o evento: sai uma folha por OS que está nos checklists dele, com os equipamentos e os serviços/extras e as colunas para conferir na montagem e na desmontagem.</p>
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar evento..." className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]" />
      <div className="max-h-80 overflow-y-auto border border-[#E2E8F0] rounded-lg divide-y divide-[#F1F5F9]">
        {carregando && <p className="p-4 text-center text-xs text-gray-400">Carregando...</p>}
        {!carregando && filtrados.length === 0 && <p className="p-4 text-center text-xs text-gray-400">Nenhum evento com checklist.</p>}
        {filtrados.map(e => (
          <button key={e.nome} type="button" onClick={() => setEscolhido(e.nome)}
            className={`w-full text-left px-3 py-2 ${escolhido === e.nome ? 'bg-blue-50 ring-1 ring-[#336699]' : 'hover:bg-[#F8FAFC]'}`}>
            <p className="text-sm font-bold text-[#0C1D4D]">{e.nome}</p>
            <p className="text-[10px] text-gray-500">
              {e.periodo_inicio ? `${dataBR(e.periodo_inicio)}${e.periodo_fim && e.periodo_fim !== e.periodo_inicio ? ` a ${dataBR(e.periodo_fim)}` : ''} · ` : ''}
              {e.checklists} checklist{e.checklists > 1 ? 's' : ''} · {e.status.map(st => ROTULO_STATUS[st] || st.toLowerCase()).join(', ')}
            </p>
          </button>
        ))}
      </div>
    </Modal>
  );
}
