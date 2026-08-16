"use client";

import { useEffect, useState } from 'react';

interface Particula {
  id: number;
  dx: number;
  dy: number;
  rot: number;
  cor: string;
  delay: number;
}

const CORES = ['#336699', '#F59E0B', '#16A34A', '#DC2626', '#7C3AED', '#0EA5E9', '#ffffff'];

// Incremente `trigger` (ex: setTrigger(t => t + 1)) para disparar uma nova explosão de confete.
export default function Confetti({ trigger }: { trigger: number }) {
  const [particulas, setParticulas] = useState<Particula[]>([]);
  const [lancado, setLancado] = useState(false);

  useEffect(() => {
    if (trigger === 0) return;

    const novas: Particula[] = Array.from({ length: 60 }, (_, i) => {
      const angulo = Math.random() * Math.PI * 2;
      const distancia = 120 + Math.random() * 260;
      return {
        id: i,
        dx: Math.cos(angulo) * distancia,
        dy: Math.sin(angulo) * distancia - 80,
        rot: Math.random() * 720 - 360,
        cor: CORES[Math.floor(Math.random() * CORES.length)],
        delay: Math.random() * 120,
      };
    });

    setLancado(false);
    setParticulas(novas);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setLancado(true)));
    const limpar = setTimeout(() => setParticulas([]), 1600);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(limpar);
    };
  }, [trigger]);

  if (particulas.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[90] pointer-events-none overflow-hidden">
      {particulas.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 8,
            height: 8,
            borderRadius: 2,
            backgroundColor: p.cor,
            transitionDelay: `${p.delay}ms`,
            transform: lancado ? `translate(${p.dx}px, ${p.dy}px) rotate(${p.rot}deg)` : 'translate(0, 0) rotate(0deg)',
            opacity: lancado ? 0 : 1,
            transition: 'transform 1200ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 1200ms ease-out',
          }}
        />
      ))}
    </div>
  );
}
