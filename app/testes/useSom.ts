"use client";

import { useRef, useCallback } from 'react';

type TipoSom = 'clique' | 'vitoria' | 'erro' | 'sucesso' | 'passagem';

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

    // Passagem de som: o acorde que se joga no PA quando o sistema sobe
    // inteiro. Três vozes com ataque macio, que é o oposto do estouro.
    if (tipo === 'passagem') {
      const agora = ctx.currentTime;
      const mestre = ctx.createGain();
      const filtro = ctx.createBiquadFilter();
      filtro.type = 'lowpass';
      filtro.frequency.setValueAtTime(700, agora);
      filtro.frequency.exponentialRampToValueAtTime(4200, agora + 1.1);
      mestre.gain.setValueAtTime(0.0001, agora);
      mestre.gain.exponentialRampToValueAtTime(0.16, agora + 0.18);
      mestre.gain.exponentialRampToValueAtTime(0.0001, agora + 1.9);
      filtro.connect(mestre);
      mestre.connect(ctx.destination);

      [freqBase * 0.5, freqBase * 0.75, freqBase, freqBase * 1.5].forEach((hz, k) => {
        const voz = ctx.createOscillator();
        const ganho = ctx.createGain();
        voz.type = k === 0 ? 'sine' : 'triangle';
        voz.frequency.setValueAtTime(hz, agora);
        ganho.gain.setValueAtTime(1 / (k + 1.4), agora);
        voz.connect(ganho);
        ganho.connect(filtro);
        voz.start(agora + k * 0.07);
        voz.stop(agora + 2);
      });
      return;
    }

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
