"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../lib/supabase';
import { CATEGORIAS, type Artigo, type CategoriaId } from './categorias';

const NIVEL_COR: Record<string, string> = {
  'Básico': 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  'Intermediário': 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  'Avançado': 'text-rose-400 border-rose-400/30 bg-rose-400/10',
};

export default function RentechAcademy() {
  const [artigos, setArtigos] = useState<Artigo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<CategoriaId | 'todos'>('todos');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('academy_artigos')
        .select('*')
        .eq('ativo', true)
        .order('categoria', { ascending: true })
        .order('ordem', { ascending: true });
      if (data) setArtigos(data);
      setLoading(false);
    })();
  }, []);

  const artigosFiltrados = useMemo(() => {
    if (filtro === 'todos') return artigos;
    return artigos.filter((a) => a.categoria === filtro);
  }, [artigos, filtro]);

  return (
    <div className="min-h-screen bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.3)_0%,_transparent_40%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.15)_0%,_transparent_40%)] text-[#B3B3B3] font-sans flex flex-col items-center overflow-x-hidden">
      <Analytics />

      <div className="container mx-auto px-6 py-12 max-w-5xl flex-col flex flex-grow">

        {/* Cabeçalho */}
        <header className="text-center mb-12 flex flex-col items-center">
          <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-[#336699] mb-3">
            🎓 Time Técnico &amp; Comercial
          </span>
          <h1 className="uppercase tracking-widest font-light text-sm md:text-base text-white border-t border-white/10 inline-block pt-6 leading-relaxed max-w-[90%]">
            Rentech <span className="text-[#336699] font-black">Academy</span>
          </h1>
          <p className="mt-4 text-sm text-[#999999] max-w-xl font-medium">
            Dicas práticas de instalação de TVs, painéis de LED, som e luz — para quem monta, vende e representa a Rentech em campo.
          </p>
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#284B8C]/40 border-t-[#336699] rounded-full animate-spin"></div>
          </div>
        ) : artigos.length === 0 ? (
          <div className="text-center py-20 bg-[#0C1D4D]/20 border border-dashed border-[#284B8C]/40 rounded-2xl">
            <p className="text-[#999999] font-medium text-sm">Nenhum artigo publicado ainda.</p>
          </div>
        ) : (
          <>
            {/* Filtro de categorias */}
            <div className="flex flex-wrap justify-center gap-2 mb-12">
              <button
                onClick={() => setFiltro('todos')}
                className={`px-4 py-2 rounded-full text-xs font-black uppercase tracking-wide border transition-colors ${
                  filtro === 'todos'
                    ? 'bg-[#336699] text-white border-[#336699]'
                    : 'bg-[#0C1D4D]/20 text-[#B3B3B3] border-[#284B8C]/30 hover:border-[#336699] hover:text-white'
                }`}
              >
                Todos ({artigos.length})
              </button>
              {CATEGORIAS.map((cat) => {
                const count = artigos.filter((a) => a.categoria === cat.id).length;
                if (count === 0) return null;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setFiltro(cat.id)}
                    className={`px-4 py-2 rounded-full text-xs font-black uppercase tracking-wide border transition-colors flex items-center gap-1.5 ${
                      filtro === cat.id
                        ? 'bg-[#336699] text-white border-[#336699]'
                        : 'bg-[#0C1D4D]/20 text-[#B3B3B3] border-[#284B8C]/30 hover:border-[#336699] hover:text-white'
                    }`}
                  >
                    <span>{cat.icone}</span> {cat.label} ({count})
                  </button>
                );
              })}
            </div>

            {/* Grid de Artigos */}
            <main className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full flex-grow">
              {artigosFiltrados.map((artigo) => {
                const cat = CATEGORIAS.find((c) => c.id === artigo.categoria);
                return (
                  <Link
                    key={artigo.slug}
                    href={`/academy/${artigo.slug}`}
                    className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-8 backdrop-blur-md hover:-translate-y-2 hover:border-[#336699] hover:shadow-[0_15px_35px_rgba(0,0,0,0.5),_0_0_15px_rgba(51,102,153,0.2)] transition-all duration-300 relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] md:text-xs font-black uppercase text-[#336699] tracking-widest">
                        {cat?.icone} {cat?.label}
                      </span>
                      <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-full border ${NIVEL_COR[artigo.nivel]}`}>
                        {artigo.nivel}
                      </span>
                    </div>
                    <h2 className="text-lg md:text-xl font-black text-white mb-3 tracking-tight">
                      {artigo.titulo}
                    </h2>
                    <p className="text-sm text-[#999999] mb-6 leading-relaxed flex-grow font-medium">
                      {artigo.resumo}
                    </p>
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#666666] uppercase tracking-wide">
                      <span>{artigo.publico}</span>
                      <span className="flex items-center gap-2">
                        {artigo.video_url && <span title="Contém vídeo">🎥</span>}
                        {artigo.tempo_leitura} de leitura
                      </span>
                    </div>
                    <div className="h-1 w-10 bg-[#336699] rounded-sm group-hover:w-full transition-all duration-500 mt-4"></div>
                  </Link>
                );
              })}
            </main>
          </>
        )}
      </div>

      <footer className="w-full px-6 py-10 mt-auto bg-gradient-to-t from-[#000000] to-transparent border-t border-[#0C1D4D]/50 text-center">
        <p className="text-xs text-[#666666] tracking-widest uppercase font-bold">
          LOCADORA RENTECH &copy; {new Date().getFullYear()} | Rentech Academy
        </p>
      </footer>

    </div>
  );
}
