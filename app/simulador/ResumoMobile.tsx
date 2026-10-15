"use client";

// Barra fixa no rodapé, só no celular/tablet (some a partir de lg e na
// impressão): no celular os controles ficam empilhados ACIMA dos resultados,
// então quem altera um valor não via o efeito sem rolar a página inteira.
// Aqui os números principais ficam sempre visíveis enquanto se edita.
export interface ItemResumo {
  label: string;
  valor: string;
}

export const ID_RESULTADO = 'resultado-simulador';

export default function ResumoMobile({ itens }: { itens: ItemResumo[] }) {
  if (itens.length === 0) return null;
  const visiveis = itens.slice(0, 4);

  return (
    <div className="lg:hidden print:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0C1D4D] text-white shadow-[0_-8px_24px_rgba(0,0,0,0.25)] px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${visiveis.length}, minmax(0, 1fr))` }}>
        {visiveis.map(item => (
          <div key={item.label} className="min-w-0">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-blue-200 truncate">{item.label}</span>
            <strong className="block text-sm font-black leading-tight truncate">{item.valor}</strong>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => document.getElementById(ID_RESULTADO)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="mt-2 w-full text-[10px] font-black uppercase tracking-widest bg-white/10 active:bg-white/20 rounded-lg py-2"
      >
        Ver resultado completo ↓
      </button>
    </div>
  );
}
