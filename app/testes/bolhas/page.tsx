"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import BackButton from '../BackButton';

type Fase = 'inicio' | 'jogando' | 'fim';

interface BolhaType {
  id: number;
  left: number;
  size: number;
  duracao: number;
  cor: string;
  estourada: boolean;
}

const DURACAO_JOGO = 30;
const INTERVALO_SPAWN = 550;
const CORES = ['#336699', '#F59E0B', '#16A34A', '#DC2626', '#7C3AED', '#0EA5E9'];

function Bolha({ bolha, onPop, onMiss }: { bolha: BolhaType; onPop: (id: number) => void; onMiss: (id: number) => void }) {
  const [subir, setSubir] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setSubir(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!bolha.estourada) onPop(bolha.id);
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === 'bottom' && !bolha.estourada) onMiss(bolha.id);
      }}
      style={{
        left: `${bolha.left}%`,
        width: bolha.size,
        height: bolha.size,
        backgroundColor: bolha.cor,
        bottom: subir ? '115%' : '-10%',
        transform: bolha.estourada ? 'scale(1.6)' : 'scale(1)',
        opacity: bolha.estourada ? 0 : 1,
        transition: bolha.estourada
          ? 'transform 200ms ease-out, opacity 200ms ease-out'
          : `bottom ${bolha.duracao}ms linear`,
        boxShadow: `0 0 25px ${bolha.cor}80`,
      }}
      className="absolute rounded-full cursor-pointer touch-none"
    />
  );
}

export default function JogoBolhas() {
  const [fase, setFase] = useState<Fase>('inicio');
  const [bolhas, setBolhas] = useState<BolhaType[]>([]);
  const [pontos, setPontos] = useState(0);
  const [perdidas, setPerdidas] = useState(0);
  const [tempoRestante, setTempoRestante] = useState(DURACAO_JOGO);
  const idRef = useRef(0);

  const iniciar = () => {
    setPontos(0);
    setPerdidas(0);
    setBolhas([]);
    setTempoRestante(DURACAO_JOGO);
    setFase('jogando');
  };

  useEffect(() => {
    if (fase !== 'jogando') return;

    const spawnInterval = setInterval(() => {
      idRef.current += 1;
      const nova: BolhaType = {
        id: idRef.current,
        left: 5 + Math.random() * 85,
        size: 50 + Math.random() * 55,
        duracao: 2500 + Math.random() * 2200,
        cor: CORES[Math.floor(Math.random() * CORES.length)],
        estourada: false,
      };
      setBolhas((prev) => [...prev, nova]);
    }, INTERVALO_SPAWN);

    const timerInterval = setInterval(() => {
      setTempoRestante((t) => Math.max(0, t - 1));
    }, 1000);

    return () => {
      clearInterval(spawnInterval);
      clearInterval(timerInterval);
    };
  }, [fase]);

  useEffect(() => {
    if (fase === 'jogando' && tempoRestante === 0) {
      setFase('fim');
      setBolhas([]);
    }
  }, [tempoRestante, fase]);

  const popar = useCallback((id: number) => {
    setPontos((p) => p + 1);
    setBolhas((prev) => prev.map((b) => (b.id === id ? { ...b, estourada: true } : b)));
    setTimeout(() => setBolhas((prev) => prev.filter((b) => b.id !== id)), 220);
  }, []);

  const perder = useCallback((id: number) => {
    setPerdidas((p) => p + 1);
    setBolhas((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <>
      <div className="relative w-full h-[calc(100vh-5rem)] bg-black overflow-hidden touch-none select-none">
        <BackButton />
        {fase === 'jogando' && bolhas.map((b) => <Bolha key={b.id} bolha={b} onPop={popar} onMiss={perder} />)}

        {fase === 'jogando' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-black/50 backdrop-blur border border-white/10 rounded-full px-6 py-2.5 pointer-events-none">
            <span className="text-white font-black text-sm uppercase tracking-widest">
              Pontos <span className="text-[#336699]">{pontos}</span>
            </span>
            <span className="text-white/40">|</span>
            <span className="text-white font-black text-sm uppercase tracking-widest">{tempoRestante}s</span>
          </div>
        )}

        {fase !== 'jogando' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center px-6">
            <div className="text-[10px] font-black uppercase text-[#336699] tracking-widest">Bolhas • Teste de Multitoque</div>

            {fase === 'inicio' && (
              <>
                <h1 className="text-2xl md:text-4xl font-black uppercase text-white tracking-tight">Toque nas bolhas</h1>
                <p className="text-sm text-white/60 max-w-md">
                  Estoure o máximo de bolhas possível em {DURACAO_JOGO} segundos. Use vários dedos ao mesmo tempo para testar o multitoque da tela.
                </p>
              </>
            )}

            {fase === 'fim' && (
              <>
                <h1 className="text-2xl md:text-4xl font-black uppercase text-white tracking-tight">Tempo esgotado!</h1>
                <div className="flex gap-6 my-2">
                  <div>
                    <p className="text-4xl font-black text-[#336699]">{pontos}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Estouradas</p>
                  </div>
                  <div>
                    <p className="text-4xl font-black text-red-400">{perdidas}</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Perdidas</p>
                  </div>
                </div>
              </>
            )}

            <button
              onClick={iniciar}
              className="mt-2 bg-[#284B8C] hover:bg-[#336699] text-white px-8 py-4 rounded-xl font-black uppercase tracking-widest text-sm shadow-lg transition-all"
            >
              {fase === 'inicio' ? 'Começar' : 'Jogar Novamente'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
