"use client";

// Campo de busca com lista de resultados (cliente / evento / produto), usado
// nas telas do hub Locações. `buscar` precisa ser estável (useMemo/useCallback)
// porque dispara a busca no efeito; resultados fora de ordem são descartados.
import { useState, useEffect, useRef } from 'react';

export interface OpcaoBusca { id: number | string; nome: string; detalhe?: string; extra?: Record<string, unknown> }

export default function CampoBusca({ placeholder, buscar, onEscolher, valor, onLimpar, desabilitado }: {
  placeholder: string;
  buscar: (texto: string) => Promise<OpcaoBusca[]>;
  onEscolher: (o: OpcaoBusca) => void;
  valor?: OpcaoBusca | null;
  onLimpar?: () => void;
  desabilitado?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [opcoes, setOpcoes] = useState<OpcaoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (texto.trim().length < 2) { setOpcoes([]); return; }
    const meu = ++seq.current;
    const t = setTimeout(async () => {
      setCarregando(true);
      const r = await buscar(texto.trim());
      if (meu === seq.current) { setOpcoes(r); setCarregando(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [texto, buscar]);

  if (valor) {
    return (
      <div className="flex items-center justify-between gap-2 border border-[#CBD5E1] rounded-lg px-3 py-2 bg-[#F8FAFC]">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#0C1D4D] truncate">{valor.nome}</p>
          {valor.detalhe && <p className="text-[10px] text-gray-500 truncate">{valor.detalhe}</p>}
        </div>
        {onLimpar && !desabilitado && <button type="button" onClick={onLimpar} className="text-xs font-bold text-red-500 hover:text-red-700 flex-shrink-0">Trocar</button>}
      </div>
    );
  }

  return (
    <div className="relative">
      <input value={texto} onChange={e => setTexto(e.target.value)} placeholder={placeholder} disabled={desabilitado}
        className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]" />
      {(carregando || opcoes.length > 0 || texto.trim().length >= 2) && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-[#E2E8F0] rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {carregando && <p className="p-3 text-xs text-gray-400">Buscando...</p>}
          {!carregando && opcoes.length === 0 && <p className="p-3 text-xs text-gray-400">Nada encontrado.</p>}
          {!carregando && opcoes.map(o => (
            <button key={String(o.id)} type="button" onClick={() => { onEscolher(o); setTexto(''); setOpcoes([]); }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-[#F1F5F9] last:border-0">
              <p className="text-sm font-bold text-[#0C1D4D]">{o.nome}</p>
              {o.detalhe && <p className="text-[10px] text-gray-500">{o.detalhe}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
