"use client";

import { useRef, useCallback } from 'react';

type TipoSom = 'clique' | 'vitoria' | 'erro' | 'sucesso';

export function useSom() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const iniciar = useCallback(() => {
    if (!audioCtxRef.current) {
      const win = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AudioContextClass = win.AudioContext || win.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtxRef.current = new AudioContextClass();
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
  }, []);

  const tocar = useCallback((tipo: TipoSom, freqBase = 600) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (tipo === 'clique') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqBase, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (tipo === 'vitoria') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } else if (tipo === 'erro') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (tipo === 'sucesso') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqBase, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    }
  }, []);

  return { iniciar, tocar };
}
