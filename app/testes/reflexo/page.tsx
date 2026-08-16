"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import BackButton from '../BackButton';

type Estado = 'idle' | 'esperando' | 'pronto' | 'cedo' | 'resultado';

export default function JogoReflexo() {
  const [estado, setEstado] = useState<Estado>('idle');
  const [pos, setPos] = useState({ top: 50, left: 50 });
  const [tempos, setTempos] = useState<number[]>([]);
  const inicioRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limparTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  useEffect(() => limparTimeout, []);

  const iniciarRodada = useCallback(() => {
    limparTimeout();
    setEstado('esperando');
    const atraso = 1000 + Math.random() * 3000;
    timeoutRef.current = setTimeout(() => {
      setPos({
        top: 15 + Math.random() * 60,
        left: 10 + Math.random() * 75,
      });
      inicioRef.current = performance.now();
      setEstado('pronto');
    }, atraso);
  }, []);

  const handleAreaPointerDown = () => {
    if (estado === 'esperando') {
      limparTimeout();
      setEstado('cedo');
    } else if (estado === 'idle' || estado === 'cedo' || estado === 'resultado') {
      iniciarRodada();
    }
  };

  const handleAlvoPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (estado !== 'pronto') return;
    const tempo = Math.round(performance.now() - inicioRef.current);
    setTempos((prev) => [tempo, ...prev].slice(0, 5));
    setEstado('resultado');
  };

  const media = tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null;

  return (
    <>
      <div
        onPointerDown={handleAreaPointerDown}
        className="relative w-full h-[calc(100vh-5rem)] bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.4)_0%,_transparent_45%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.2)_0%,_transparent_45%)] text-white select-none overflow-hidden touch-none"
      >
        <div onPointerDown={(e) => e.stopPropagation()}>
          <BackButton />
        </div>
        {/* Alvo */}
        {estado === 'pronto' && (
          <button
            onPointerDown={handleAlvoPointerDown}
            style={{ top: `${pos.top}%`, left: `${pos.left}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-24 h-24 md:w-32 md:h-32 rounded-full bg-[#336699] shadow-[0_0_60px_rgba(51,102,153,0.8)] border-4 border-white animate-pulse"
            aria-label="Alvo"
          />
        )}

        {/* Mensagem central */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center pointer-events-none">
          <div className="text-[10px] font-black uppercase text-[#336699] tracking-widest">Jogo do Reflexo</div>

          {estado === 'idle' && (
            <p className="text-lg md:text-2xl font-black uppercase tracking-wide text-white/90">
              Toque em qualquer lugar para começar
            </p>
          )}

          {estado === 'esperando' && (
            <p className="text-lg md:text-2xl font-black uppercase tracking-wide text-white/60">
              Prepare-se... aguarde o círculo aparecer
            </p>
          )}

          {estado === 'cedo' && (
            <p className="text-lg md:text-2xl font-black uppercase tracking-wide text-red-400">
              Muito cedo! Toque para tentar novamente
            </p>
          )}

          {estado === 'resultado' && (
            <>
              <p className="text-5xl md:text-7xl font-black text-[#336699]">{tempos[0]} ms</p>
              <p className="text-sm md:text-base font-bold uppercase tracking-widest text-white/60">
                Toque em qualquer lugar para jogar novamente
              </p>
            </>
          )}
        </div>

        {/* Histórico */}
        {tempos.length > 0 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none">
            <div className="flex gap-2 flex-wrap justify-center">
              {tempos.map((t, i) => (
                <span
                  key={i}
                  className={`px-3 py-1.5 rounded-full text-xs font-black border ${i === 0 ? 'bg-[#336699] border-[#336699] text-white' : 'bg-black/40 border-white/20 text-white/70'}`}
                >
                  {t} ms
                </span>
              ))}
            </div>
            {media !== null && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                Média das últimas {tempos.length}: {media} ms
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
