"use client";

import { copiarLinkAssinatura } from './utils';

// Modal de feedback (loading/success/error/confirm) usado pelos painéis
// "Minhas OPs" e "Financeiro" — antes era o mesmo bloco de JSX duplicado
// (com pequenas divergências de estilo) em ambas as páginas.
export interface DialogOPState {
  open: boolean;
  type: 'loading' | 'confirm' | 'success' | 'error';
  title: string;
  msg: string;
  onConfirm?: () => void;
}

interface DialogOPProps {
  dialog: DialogOPState;
  onClose: () => void;
}

export function DialogOP({ dialog, onClose }: DialogOPProps) {
  if (!dialog.open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4 transform transition-all">
        <div className="text-5xl mb-4">
          {dialog.type === 'loading' ? '⏳' : dialog.type === 'success' ? '✅' : dialog.type === 'error' ? '❌' : '❓'}
        </div>
        <h3 className={`text-xl font-black uppercase tracking-wider mb-2 ${dialog.type === 'error' ? 'text-red-600' : 'text-[#0C1D4D]'}`}>
          {dialog.title}
        </h3>
        <p className="text-sm text-[#64748B] mb-8 font-medium">{dialog.msg}</p>
        <div className="flex gap-3 justify-center">
          {dialog.type === 'confirm' ? (
            <>
              <button onClick={onClose} className="flex-1 py-3 bg-[#F0F4F8] text-[#64748B] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#E2E8F0]">Voltar</button>
              <button onClick={dialog.onConfirm} className="flex-1 py-3 bg-[#0C1D4D] text-white font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#284B8C] shadow-lg">Sim, Confirmar</button>
            </>
          ) : dialog.type !== 'loading' ? (
            <button onClick={onClose} className={`w-full py-3 text-white font-bold text-xs uppercase tracking-wider rounded-lg ${dialog.type === 'error' ? 'bg-red-600' : 'bg-[#0C1D4D]'}`}>OK, Entendido</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Botão "Link Assinatura" das tabelas de OP — antes era o mesmo bloco
// (JSX + handler de clipboard) duplicado em "responsavel" e "financeiro".
export function BotaoLinkAssinatura({ opId }: { opId: string }) {
  return (
    <button
      onClick={() => copiarLinkAssinatura(opId)}
      className="w-full bg-[#E0F2FE] hover:bg-[#BAE6FD] border border-[#7DD3FC] text-[#0369A1] font-bold text-[9px] uppercase tracking-wider py-1.5 rounded transition-colors shadow-sm"
    >
      🔗 Link Assinatura
    </button>
  );
}
