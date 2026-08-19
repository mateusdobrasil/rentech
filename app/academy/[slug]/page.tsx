"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../lib/supabase';
import { CATEGORIAS, type Artigo } from '../categorias';
import { getYoutubeEmbedUrl } from '../youtube';

const NIVEL_COR: Record<string, string> = {
  'Básico': 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  'Intermediário': 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  'Avançado': 'text-rose-400 border-rose-400/30 bg-rose-400/10',
};

export default function ArtigoAcademy() {
  const params = useParams<{ slug: string }>();
  const [artigo, setArtigo] = useState<Artigo | null | undefined>(undefined);
  const [relacionados, setRelacionados] = useState<Artigo[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('academy_artigos')
        .select('*')
        .eq('slug', params.slug)
        .eq('ativo', true)
        .maybeSingle();

      setArtigo(data ?? null);

      if (data) {
        const { data: outros } = await supabase
          .from('academy_artigos')
          .select('*')
          .eq('categoria', data.categoria)
          .eq('ativo', true)
          .neq('slug', data.slug)
          .order('ordem', { ascending: true });
        if (outros) setRelacionados(outros);
      }
    })();
  }, [params.slug]);

  if (artigo === undefined) {
    return (
      <div className="min-h-screen bg-[#000000] flex items-center justify-center">
        <Analytics />
        <div className="w-8 h-8 border-4 border-[#284B8C]/40 border-t-[#336699] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (artigo === null) {
    return (
      <div className="min-h-screen bg-[#000000] text-[#B3B3B3] flex flex-col items-center justify-center px-6 text-center">
        <Analytics />
        <p className="text-sm uppercase tracking-widest text-[#666666] font-bold mb-4">Artigo não encontrado</p>
        <Link href="/academy" className="text-[#336699] font-black uppercase tracking-wide text-sm hover:text-white transition-colors">
          &larr; Voltar para a Rentech Academy
        </Link>
      </div>
    );
  }

  const cat = CATEGORIAS.find((c) => c.id === artigo.categoria);
  const embedUrl = artigo.video_url ? getYoutubeEmbedUrl(artigo.video_url) : null;

  return (
    <div className="min-h-screen bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.3)_0%,_transparent_40%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.15)_0%,_transparent_40%)] text-[#B3B3B3] font-sans flex flex-col items-center overflow-x-hidden">
      <Analytics />

      <div className="container mx-auto px-6 py-12 max-w-3xl flex-col flex flex-grow">

        <Link href="/academy" className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#666666] hover:text-[#336699] transition-colors mb-10 w-fit">
          &larr; Rentech Academy
        </Link>

        <header className="mb-12">
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="text-[10px] md:text-xs font-black uppercase text-[#336699] tracking-widest bg-[#284B8C]/20 border border-[#284B8C]/30 px-3 py-1 rounded-full">
              {cat?.icone} {cat?.label}
            </span>
            <span className={`text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-full border ${NIVEL_COR[artigo.nivel]}`}>
              {artigo.nivel}
            </span>
            <span className="text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-full border border-[#284B8C]/30 text-[#999999]">
              {artigo.publico}
            </span>
          </div>
          <h1 className="text-2xl md:text-4xl font-black text-white tracking-tight leading-tight mb-4">
            {artigo.titulo}
          </h1>
          <p className="text-sm md:text-base text-[#999999] font-medium leading-relaxed">
            {artigo.resumo}
          </p>
          <p className="mt-4 text-[10px] font-bold text-[#666666] uppercase tracking-wide">
            {artigo.tempo_leitura} de leitura
          </p>
        </header>

        {embedUrl && (
          <div className="mb-12 rounded-2xl overflow-hidden border border-[#284B8C]/30 bg-black aspect-video shadow-[0_15px_35px_rgba(0,0,0,0.5)]">
            <iframe
              src={embedUrl}
              title={artigo.titulo}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        )}

        <main className="flex flex-col gap-10 flex-grow">
          {artigo.secoes.map((secao, i) => (
            <section key={i} className="bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-2xl p-6 md:p-8 backdrop-blur-md">
              <h2 className="text-lg md:text-xl font-black text-white mb-4 tracking-tight flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[#336699] shrink-0"></span>
                {secao.titulo}
              </h2>
              {secao.texto && (
                <p className="text-sm text-[#B3B3B3] leading-relaxed font-medium mb-4 last:mb-0">
                  {secao.texto}
                </p>
              )}
              {secao.lista && (
                <ul className="flex flex-col gap-3">
                  {secao.lista.map((item, j) => (
                    <li key={j} className="flex items-start gap-3 text-sm text-[#B3B3B3] leading-relaxed font-medium">
                      <span className="text-[#336699] font-black mt-0.5">›</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          {artigo.checklist && artigo.checklist.length > 0 && (
            <section className="bg-[#284B8C]/10 border border-[#336699]/40 rounded-2xl p-6 md:p-8">
              <h2 className="text-lg md:text-xl font-black text-white mb-4 tracking-tight flex items-center gap-2">
                ✅ Checklist rápido
              </h2>
              <ul className="flex flex-col gap-3">
                {artigo.checklist.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm text-[#B3B3B3] leading-relaxed font-medium">
                    <span className="mt-0.5 h-4 w-4 rounded border border-[#336699]/50 shrink-0"></span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>

        {relacionados.length > 0 && (
          <div className="mt-16">
            <h3 className="text-xs font-black uppercase tracking-widest text-[#666666] mb-5">
              Mais de {cat?.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {relacionados.map((r) => (
                <Link
                  key={r.slug}
                  href={`/academy/${r.slug}`}
                  className="group flex flex-col bg-[#0C1D4D]/20 border border-[#284B8C]/30 rounded-xl p-5 hover:border-[#336699] transition-all duration-300"
                >
                  <h4 className="text-sm font-black text-white mb-1 tracking-tight group-hover:text-[#336699] transition-colors">
                    {r.titulo}
                  </h4>
                  <p className="text-xs text-[#999999] font-medium">{r.tempo_leitura} de leitura</p>
                </Link>
              ))}
            </div>
          </div>
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
