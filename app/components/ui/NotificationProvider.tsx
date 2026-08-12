"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface NotificationContextValue {
  toast: (message: string, type?: ToastType) => void;
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  prompt: (options: PromptOptions | string) => Promise<string | null>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification/useToast/useConfirm/usePrompt precisam estar dentro de <NotificationProvider>.');
  return ctx;
}

export function useToast() { return useNotification().toast; }
export function useConfirm() { return useNotification().confirm; }
export function usePrompt() { return useNotification().prompt; }

const TOAST_STYLES: Record<ToastType, { bg: string; text: string; border: string; icon: string }> = {
  success: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300', icon: '✅' },
  error: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-300', icon: '❌' },
  info: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', icon: 'ℹ️' },
};

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (value: boolean) => void;
}

interface PromptState extends PromptOptions {
  open: boolean;
  value: string;
  resolve?: (value: string | null) => void;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => dismissToast(id), type === 'error' ? 6000 : 4000);
  }, [dismissToast]);

  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false, message: '' });

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...opts, open: true, resolve });
    });
  }, []);

  const respondConfirm = (value: boolean) => {
    confirmState.resolve?.(value);
    setConfirmState(prev => ({ ...prev, open: false }));
  };

  const [promptState, setPromptState] = useState<PromptState>({ open: false, message: '', value: '' });

  const prompt = useCallback((options: PromptOptions | string) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    return new Promise<string | null>((resolve) => {
      setPromptState({ ...opts, open: true, value: opts.defaultValue || '', resolve });
    });
  }, []);

  const respondPrompt = (value: string | null) => {
    promptState.resolve?.(value);
    setPromptState(prev => ({ ...prev, open: false }));
  };

  return (
    <NotificationContext.Provider value={{ toast, confirm, prompt }}>
      {children}

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => {
          const s = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto ${s.bg} ${s.text} border ${s.border} rounded-xl shadow-lg px-4 py-3 flex items-start gap-3 text-sm font-medium animate-[fadeIn_0.15s_ease-out]`}
            >
              <span className="text-base leading-none">{s.icon}</span>
              <p className="flex-1 whitespace-pre-line">{t.message}</p>
              <button onClick={() => dismissToast(t.id)} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
            </div>
          );
        })}
      </div>

      {/* Confirm dialog */}
      {confirmState.open && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4">
            <h3 className="text-xl font-black uppercase tracking-wider mb-2 text-[#0C1D4D]">
              {confirmState.title || (confirmState.danger ? 'Atenção' : 'Confirmar ação')}
            </h3>
            <p className="text-sm text-[#64748B] font-medium mb-6 whitespace-pre-line">{confirmState.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => respondConfirm(false)}
                className="flex-1 py-3 bg-[#F1F5F9] text-[#334155] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#E2E8F0] transition-colors"
              >
                {confirmState.cancelLabel || 'Cancelar'}
              </button>
              <button
                onClick={() => respondConfirm(true)}
                className={`flex-1 py-3 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg transition-colors ${confirmState.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0C1D4D] hover:bg-[#284B8C]'}`}
              >
                {confirmState.confirmLabel || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt dialog */}
      {promptState.open && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4">
            <h3 className="text-xl font-black uppercase tracking-wider mb-2 text-[#0C1D4D]">
              {promptState.title || 'Informe um valor'}
            </h3>
            <p className="text-sm text-[#64748B] font-medium mb-4 whitespace-pre-line">{promptState.message}</p>
            <input
              autoFocus
              value={promptState.value}
              onChange={e => setPromptState(prev => ({ ...prev, value: e.target.value }))}
              placeholder={promptState.placeholder}
              onKeyDown={e => { if (e.key === 'Enter') respondPrompt(promptState.value); }}
              className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm text-[#0C1D4D] mb-6 focus:outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]"
            />
            <div className="flex gap-3">
              <button
                onClick={() => respondPrompt(null)}
                className="flex-1 py-3 bg-[#F1F5F9] text-[#334155] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#E2E8F0] transition-colors"
              >
                {promptState.cancelLabel || 'Cancelar'}
              </button>
              <button
                onClick={() => respondPrompt(promptState.value)}
                className="flex-1 py-3 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg transition-colors"
              >
                {promptState.confirmLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}
