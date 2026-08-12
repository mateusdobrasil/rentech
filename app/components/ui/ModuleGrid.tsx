"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

export interface ModuloCard {
  titulo: string;
  descricao: string;
  icone: string;
  link: string;
  cor: string;
  hover?: string;
  bgIcon?: string;
}

type Variant = 'link-icon' | 'button-icon' | 'button-plain';

interface ModuleGridProps {
  modulos: ModuloCard[];
  variant: Variant;
  emptyState?: ReactNode;
  /** true (padrão): estado vazio fica dentro do grid (col-span-full). false: estado vazio substitui o grid inteiro. */
  emptyWrapsGrid?: boolean;
}

const DEFAULT_EMPTY = (
  <div className="col-span-full p-8 text-center text-gray-500 font-bold uppercase border-2 border-dashed border-gray-300 rounded-xl">
    Você não tem permissão para aceder a nenhum módulo desta área.
  </div>
);

export default function ModuleGrid({ modulos, variant, emptyState = DEFAULT_EMPTY, emptyWrapsGrid = true }: ModuleGridProps) {
  const router = useRouter();

  if (modulos.length === 0) {
    return emptyWrapsGrid
      ? <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{emptyState}</div>
      : <>{emptyState}</>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {modulos.map((m, index) => {
        if (variant === 'link-icon') {
          return (
            <Link
              href={m.link}
              key={index}
              className={`bg-white p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 border-2 border-transparent ${m.cor} group relative overflow-hidden`}
            >
              <div className="absolute top-0 right-0 -mt-6 -mr-6 w-32 h-32 bg-gradient-to-bl from-current to-transparent opacity-[0.03] rounded-full group-hover:scale-150 transition-transform duration-500 pointer-events-none"></div>
              <div className={`w-14 h-14 ${m.bgIcon} rounded-xl flex items-center justify-center text-3xl mb-6 shadow-sm`}>
                {m.icone}
              </div>
              <h3 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-3">
                {m.titulo}
              </h3>
              <p className="text-[#64748B] text-sm font-medium leading-relaxed mb-8 h-10">
                {m.descricao}
              </p>
              <div className="flex items-center text-[11px] font-black uppercase tracking-widest text-[#336699] group-hover:text-[#0C1D4D] transition-colors pt-4 border-t border-[#F1F5F9]">
                Acessar Módulo <span className="ml-2 group-hover:translate-x-2 transition-transform">➔</span>
              </div>
            </Link>
          );
        }

        if (variant === 'button-icon') {
          return (
            <button
              key={m.titulo}
              onClick={() => router.push(m.link)}
              className={`text-left bg-white p-6 rounded-2xl border-2 transition-all shadow-sm ${m.cor} group`}
            >
              <div className={`w-14 h-14 ${m.bgIcon} rounded-xl flex items-center justify-center text-3xl mb-4 shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                {m.icone}
              </div>
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-2">{m.titulo}</h2>
              <p className="text-xs font-medium text-[#64748B]">{m.descricao}</p>
            </button>
          );
        }

        return (
          <button
            key={m.titulo}
            onClick={() => router.push(m.link)}
            className={`text-left p-6 rounded-2xl border-2 transition-all shadow-sm ${m.cor} ${m.hover} group`}
          >
            <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">{m.icone}</div>
            <h2 className="text-lg font-black uppercase tracking-wider mb-2">{m.titulo}</h2>
            <p className="text-xs font-medium opacity-80">{m.descricao}</p>
          </button>
        );
      })}
    </div>
  );
}
