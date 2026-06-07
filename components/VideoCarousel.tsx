'use client';

import { useState, useRef, useEffect } from 'react';

type Video = { src: string; title: string };

export default function VideoCarousel() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [current, setCurrent] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch('/api/videos')
      .then((r) => r.json())
      .then(setVideos);
  }, []);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || videos.length === 0) return;
    vid.load();
    vid.play().catch(() => {});
    setIsPlaying(true);
  }, [current, videos]);

  if (videos.length === 0) return null;

  const prev = () => setCurrent((c) => (c - 1 + videos.length) % videos.length);
  const next = () => setCurrent((c) => (c + 1) % videos.length);

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play();
      setIsPlaying(true);
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  return (
    <section className="py-24 bg-[#000000] border-t border-[#0C1D4D] relative overflow-hidden">
      <div className="container mx-auto px-6 relative z-10">

        {/* Cabeçalho */}
        <div className="text-center mb-12">
          <div className="inline-block px-4 py-1 mb-6 border border-[#284B8C]/50 rounded-full bg-[#284B8C]/10 text-[#336699] text-xs font-black tracking-widest uppercase">
            Vídeos
          </div>
          <h2 className="text-3xl md:text-4xl font-black mb-4">Veja na Prática</h2>
          <p className="text-[#999999] max-w-2xl mx-auto font-medium">
            Registros reais dos nossos projetos em ação.
          </p>
        </div>

        {/* Player principal */}
        <div className="relative max-w-4xl mx-auto rounded-2xl overflow-hidden border border-[#284B8C]/40 bg-black shadow-2xl shadow-[#284B8C]/20">

          <video
            ref={videoRef}
            src={videos[current].src}
            className="w-full aspect-video object-cover"
            playsInline
            muted
            loop
            autoPlay
          />

          {/* Título sobre o vídeo */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-8 py-6 pointer-events-none">
            <p className="text-white text-xl font-black mt-2 capitalize">
              {videos[current].title}
            </p>
          </div>

          {/* Botão play/pause */}
          <button
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
            className="absolute top-4 right-4 flex items-center justify-center w-10 h-10 rounded-full bg-black/50 border border-white/20 text-white hover:bg-[#284B8C] transition-colors"
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Seta esquerda */}
          <button
            onClick={prev}
            aria-label="Anterior"
            className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-black/50 border border-white/20 text-white hover:bg-[#284B8C] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Seta direita */}
          <button
            onClick={next}
            aria-label="Próximo"
            className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 rounded-full bg-black/50 border border-white/20 text-white hover:bg-[#284B8C] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Dots indicadores */}
        <div className="flex justify-center gap-2 mt-6">
          {videos.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Ir para vídeo ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current
                  ? 'w-8 bg-[#336699]'
                  : 'w-2 bg-[#284B8C]/40 hover:bg-[#284B8C]'
              }`}
            />
          ))}
        </div>

        {/* Miniaturas */}
        <div className="flex gap-4 justify-center mt-6 overflow-x-auto pb-2">
          {videos.map((v, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`relative shrink-0 w-32 aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                i === current
                  ? 'border-[#336699] scale-105 shadow-lg shadow-[#284B8C]/30'
                  : 'border-[#284B8C]/30 opacity-50 hover:opacity-80'
              }`}
            >
              <video
                src={v.src}
                className="w-full h-full object-cover pointer-events-none"
                muted
                playsInline
                preload="metadata"
              />
              <div className="absolute inset-0 bg-black/30" />
              <p className="absolute bottom-1 left-0 right-0 text-center text-[9px] font-black text-white uppercase tracking-wide truncate px-1 capitalize">
                {v.title}
              </p>
            </button>
          ))}
        </div>

      </div>
    </section>
  );
}