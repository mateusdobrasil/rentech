"use client";

interface PaginationFooterProps {
  pagina: number;
  totalRegistros: number;
  tamanhoPagina: number;
  loading?: boolean;
  onAnterior: () => void;
  onProxima: () => void;
}

export default function PaginationFooter({ pagina, totalRegistros, tamanhoPagina, loading = false, onAnterior, onProxima }: PaginationFooterProps) {
  return (
    <div className="flex flex-wrap justify-between items-center gap-2 mt-4">
      <button
        onClick={onAnterior}
        disabled={pagina === 0 || loading}
        className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
      >
        ⬅ Anterior
      </button>
      <span className="text-xs font-bold text-[#64748B]">
        Página {totalRegistros === 0 ? 0 : pagina + 1} de {Math.max(1, Math.ceil(totalRegistros / tamanhoPagina))}
      </span>
      <button
        onClick={onProxima}
        disabled={(pagina + 1) * tamanhoPagina >= totalRegistros || loading}
        className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
      >
        Próxima ➡
      </button>
    </div>
  );
}
