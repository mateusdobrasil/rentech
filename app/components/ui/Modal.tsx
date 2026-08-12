"use client";

import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  headerColor?: string;
  maxWidthClassName?: string;
  zIndex?: number;
  footer?: ReactNode;
  children: ReactNode;
}

export default function Modal({
  open,
  onClose,
  title,
  headerColor = '#0C1D4D',
  maxWidthClassName = 'max-w-2xl',
  zIndex = 100,
  footer,
  children,
}: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      style={{ zIndex }}
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidthClassName} overflow-hidden flex flex-col max-h-[90vh]`}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 flex justify-between items-center text-white flex-shrink-0" style={{ background: headerColor }}>
          <h3 className="font-black uppercase tracking-wider text-sm">{title}</h3>
          <button onClick={onClose} className="text-white hover:text-red-300 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto space-y-5">{children}</div>
        {footer && <div className="p-5 border-t border-[#E2E8F0] bg-white flex-shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
