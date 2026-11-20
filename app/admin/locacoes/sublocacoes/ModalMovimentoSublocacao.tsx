"use client";

// Entrada (veio do parceiro) / devolução ao parceiro, por quantidade
// (2026-11-20). Usado na tela da sublocação e no painel da Expedição.
import { useState, useEffect } from 'react';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/NotificationProvider';
import { hojeISO } from '../../../lib/locacao/datas';
import { registrarMovimentoSublocacaoAction } from './actions';

export interface ItemMovSub { id: number; descricao: string; quantidade: number; aReceber: number; comAgente: number }
const q3 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const num = (s: string) => { const x = Number(String(s || '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };

export default function ModalMovimentoSublocacao({ sublocacaoId, numero, fornecedor, tipo, itens, accessToken, onClose, onFeito }: {
  sublocacaoId: number; numero: string; fornecedor: string; tipo: 'ENTRADA' | 'DEVOLUCAO' | null; itens: ItemMovSub[];
  accessToken: string; onClose: () => void; onFeito: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState(hojeISO());
  const [qtd, setQtd] = useState<Record<number, string>>({});
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!tipo) return;
    setData(hojeISO()); setObs('');
    setQtd(Object.fromEntries(itens.map(i => [i.id, ''])));
  }, [tipo, itens]);

  if (!tipo) return null;
  const limite = (i: ItemMovSub) => (tipo === 'ENTRADA' ? i.aReceber : i.comAgente);
  const enviar = async () => {
    const linhas = itens.map(i => ({ item_id: i.id, quantidade: num(qtd[i.id] || '0') })).filter(l => l.quantidade > 0);
    if (!linhas.length) { toast('Informe as quantidades.', 'error'); return; }
    setOcupado(true);
    const r = await registrarMovimentoSublocacaoAction(sublocacaoId, { tipo, data, linhas, observacoes: obs || null }, accessToken);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao registrar.', 'error'); return; }
    toast(tipo === 'ENTRADA' ? 'Entrada do parceiro registrada.' : 'Devolução ao parceiro registrada.', 'success');
    onFeito();
  };
  const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40';

  return (
    <Modal open onClose={onClose} title={`${tipo === 'ENTRADA' ? '📥 Entrada do parceiro' : '📤 Devolução ao parceiro'} · ${numero}`} headerColor={tipo === 'ENTRADA' ? '#0C1D4D' : '#EA580C'}
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={enviar} className={`${btn} ${tipo === 'ENTRADA' ? 'bg-[#0C1D4D]' : 'bg-orange-600'} text-white`}>{ocupado ? 'Gravando…' : 'Registrar'}</button></div>}>
      <p className="text-xs text-gray-600">{tipo === 'ENTRADA' ? `Equipamento que chegou de ${fornecedor}. Não entra no nosso saldo — fica controlado só nesta sublocação.` : `Equipamento que voltou para ${fornecedor}. Tudo devolvido encerra a sublocação.`}</p>
      <div className="grid md:grid-cols-[180px_1fr] gap-3 items-end">
        <label className="text-xs font-bold">Data<input type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        <div className="flex justify-end"><button onClick={() => setQtd(Object.fromEntries(itens.map(i => [i.id, limite(i) > 0 ? String(limite(i)) : ''])))} className="text-[10px] font-black uppercase tracking-wider text-[#336699] hover:underline">Preencher tudo</button></div>
      </div>
      <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
        {itens.filter(i => limite(i) > 0).map(i => (
          <div key={i.id} className="p-3 flex items-center gap-3">
            <div className="flex-1"><p className="text-sm font-bold">{i.descricao}</p><p className="text-[10px] text-gray-500">{tipo === 'ENTRADA' ? `${q3(i.aReceber)} a receber de ${q3(i.quantidade)}` : `${q3(i.comAgente)} com a gente`}</p></div>
            <input inputMode="decimal" value={qtd[i.id] || ''} onChange={e => setQtd(prev => ({ ...prev, [i.id]: e.target.value }))} placeholder="0" className="w-24 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-right font-bold" />
          </div>
        ))}
        {!itens.some(i => limite(i) > 0) && <p className="p-3 text-xs text-gray-400">Nada {tipo === 'ENTRADA' ? 'a receber' : 'com a gente'}.</p>}
      </div>
      <label className="block text-xs font-bold">Observações<input value={obs} onChange={e => setObs(e.target.value)} placeholder="ex.: conferido por fulano, 1 caixa amassada" className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
    </Modal>
  );
}
