"use client";

// Cadastro de evento/feira (2026-11-23): novo e edição. Evento do P2S abre só
// leitura enquanto o P2S for oficial. Regras em app/lib/cadastros/eventos.ts.
import { useEffect, useRef, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/NotificationProvider';
import { carregarEventoAction, salvarEventoAction } from './actions';

interface Form { nome: string; data_inicial: string; data_final: string; local: string; montadora: string; promotor: string; tipo_evento: string; colaborador_responsavel: string; observacoes: string }
const VAZIO: Form = { nome: '', data_inicial: '', data_final: '', local: '', montadora: '', promotor: '', tipo_evento: '', colaborador_responsavel: '', observacoes: '' };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

interface Props { eventoId: string | null; accessToken: string; onClose: () => void; onSalvo: () => void }

export default function FormEvento({ eventoId, accessToken, onClose, onSalvo }: Props) {
  const toast = useToast();
  const [f, setF] = useState<Form>(VAZIO);
  // montado só quando abre (key = evento): para "novo" o estado já nasce certo
  const [carregando, setCarregando] = useState(!!eventoId);
  const [salvando, setSalvando] = useState(false);
  const [editavel, setEditavel] = useState(true);
  const [motivo, setMotivo] = useState<string | null>(null);
  const fecharRef = useRef(onClose);
  useEffect(() => { fecharRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!eventoId) return;
    let vivo = true;
    carregarEventoAction(eventoId, accessToken).then(r => {
      if (!vivo) return;
      setCarregando(false);
      if (!r.ok) { toast(r.erro || 'Falha ao abrir o evento.', 'error'); fecharRef.current(); return; }
      const e = r.info.evento;
      setF({ nome: s(e.nome), data_inicial: s(e.data_inicial).slice(0, 10), data_final: s(e.data_final).slice(0, 10), local: s(e.local), montadora: s(e.montadora), promotor: s(e.promotor), tipo_evento: s(e.tipo_evento), colaborador_responsavel: s(e.colaborador_responsavel), observacoes: s(e.observacoes) });
      setEditavel(!!r.info.editavel); setMotivo(r.info.motivo || null);
    });
    return () => { vivo = false; };
  }, [eventoId, accessToken, toast]);

  const muda = (p: Partial<Form>) => setF(a => ({ ...a, ...p }));
  const ro = !editavel;
  const salvar = async () => {
    setSalvando(true);
    const r = await salvarEventoAction({ id: eventoId, ...f, data_final: f.data_final || null }, accessToken);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Falha ao salvar.', 'error'); return; }
    toast(eventoId ? 'Evento salvo.' : 'Evento cadastrado.', 'success');
    onSalvo();
  };

  const inp = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm disabled:bg-[#F8FAFC] disabled:text-gray-600';
  const lab = 'block text-[10px] font-black uppercase tracking-wider text-gray-500 mb-1';
  return (
    <Modal open onClose={onClose} title={eventoId ? (f.nome || 'Evento') : 'Novo evento / feira'} maxWidthClassName="max-w-2xl"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-black uppercase border border-[#E2E8F0]">{ro ? 'Fechar' : 'Cancelar'}</button>
        {!ro && <button onClick={salvar} disabled={salvando || carregando} className="px-4 py-2 rounded-lg text-xs font-black uppercase bg-[#0C1D4D] text-white disabled:opacity-50">{salvando ? 'Salvando…' : 'Salvar'}</button>}
      </div>}>
      {carregando ? <p className="text-sm text-gray-500">Carregando…</p> : (
        <div className="space-y-4">
          {motivo && <p className="text-xs rounded-xl border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3">{motivo}</p>}
          <div><label className={lab}>Nome do evento *</label><input value={f.nome} disabled={ro} onChange={e => muda({ nome: e.target.value })} placeholder="Ex.: FEICON 2027" className={inp} /></div>
          <div className="grid md:grid-cols-2 gap-3">
            <div><label className={lab}>Data inicial *</label><input type="date" value={f.data_inicial} disabled={ro} onChange={e => muda({ data_inicial: e.target.value })} className={inp} /></div>
            <div><label className={lab}>Data final</label><input type="date" value={f.data_final} disabled={ro} onChange={e => muda({ data_final: e.target.value })} className={inp} /></div>
            <div className="md:col-span-2"><label className={lab}>Local</label><input value={f.local} disabled={ro} onChange={e => muda({ local: e.target.value })} placeholder="Pavilhão, centro de convenções…" className={inp} /></div>
            <div><label className={lab}>Montadora</label><input value={f.montadora} disabled={ro} onChange={e => muda({ montadora: e.target.value })} className={inp} /></div>
            <div><label className={lab}>Promotor</label><input value={f.promotor} disabled={ro} onChange={e => muda({ promotor: e.target.value })} className={inp} /></div>
            <div><label className={lab}>Tipo</label><input value={f.tipo_evento} disabled={ro} onChange={e => muda({ tipo_evento: e.target.value })} placeholder="Feira, congresso, show…" className={inp} /></div>
            <div><label className={lab}>Responsável</label><input value={f.colaborador_responsavel} disabled={ro} onChange={e => muda({ colaborador_responsavel: e.target.value })} className={inp} /></div>
          </div>
          <div><label className={lab}>Observações</label><textarea value={f.observacoes} disabled={ro} onChange={e => muda({ observacoes: e.target.value })} rows={3} className={inp} /></div>
          <p className="text-[11px] text-gray-400">O status (Futuro, Em Execução, Finalizado) segue as datas sozinho.</p>
        </div>
      )}
    </Modal>
  );
}
