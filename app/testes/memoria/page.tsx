"use client";

import { useState, useRef, useEffect } from 'react';
import BackButton from '../BackButton';
import Confetti from '../Confetti';
import { useSom } from '../useSom';

type Fase = 'config' | 'jogo';
type Dificuldade = 'facil' | 'normal' | 'dificil';

interface Carta {
  id: number;
  simbolo: string;
  virada: boolean;
  encontrada: boolean;
}

const SIMBOLOS = ['🎬', '📺', '💡', '🔊', '🎮', '🎯', '🎨', '🎵', '⭐', '🚀'];

const CONFIG_DIFICULDADE: Record<Dificuldade, { pares: number; cols: string; label: string }> = {
  facil: { pares: 6, cols: 'grid-cols-4', label: 'Fácil · 12 cartas' },
  normal: { pares: 8, cols: 'grid-cols-4', label: 'Normal · 16 cartas' },
  dificil: { pares: 10, cols: 'grid-cols-5', label: 'Difícil · 20 cartas' },
};

function embaralhar<T>(array: T[]): T[] {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function gerarCartas(pares: number): Carta[] {
  const escolhidos = SIMBOLOS.slice(0, pares);
  const dobrado = embaralhar([...escolhidos, ...escolhidos]);
  return dobrado.map((simbolo, id) => ({ id, simbolo, virada: false, encontrada: false }));
}

export default function JogoDaMemoria() {
  const { iniciar: iniciarAudio, tocar } = useSom();

  const [fase, setFase] = useState<Fase>('config');
  const [dificuldade, setDificuldade] = useState<Dificuldade>('normal');
  const [cartas, setCartas] = useState<Carta[]>([]);
  const [selecionadas, setSelecionadas] = useState<number[]>([]);
  const [bloqueado, setBloqueado] = useState(false);
  const [movimentos, setMovimentos] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const [venceu, setVenceu] = useState(false);
  const [confettiTrigger, setConfettiTrigger] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const compararTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (compararTimeoutRef.current) clearTimeout(compararTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (fase !== 'jogo' || venceu) return;
    timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fase, venceu]);

  const iniciarJogo = (dif: Dificuldade) => {
    iniciarAudio();
    if (compararTimeoutRef.current) clearTimeout(compararTimeoutRef.current);
    setDificuldade(dif);
    setCartas(gerarCartas(CONFIG_DIFICULDADE[dif].pares));
    setSelecionadas([]);
    setBloqueado(false);
    setMovimentos(0);
    setSegundos(0);
    setVenceu(false);
    setFase('jogo');
  };

  const voltarConfig = () => {
    if (compararTimeoutRef.current) clearTimeout(compararTimeoutRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setFase('config');
  };

  const virarCarta = (id: number) => {
    if (bloqueado || venceu) return;
    const carta = cartas.find((c) => c.id === id);
    if (!carta || carta.virada || carta.encontrada) return;

    iniciarAudio();
    tocar('clique', 650);

    const novaSelecionadas = [...selecionadas, id];
    const novasCartas = cartas.map((c) => (c.id === id ? { ...c, virada: true } : c));
    setCartas(novasCartas);
    setSelecionadas(novaSelecionadas);

    if (novaSelecionadas.length === 2) {
      setMovimentos((m) => m + 1);
      const [idA, idB] = novaSelecionadas;
      const cartaA = novasCartas.find((c) => c.id === idA)!;
      const cartaB = novasCartas.find((c) => c.id === idB)!;

      if (cartaA.simbolo === cartaB.simbolo) {
        const comMatch = novasCartas.map((c) => (c.id === idA || c.id === idB ? { ...c, encontrada: true } : c));
        setCartas(comMatch);
        setSelecionadas([]);
        tocar('sucesso', 750);

        if (comMatch.every((c) => c.encontrada)) {
          setVenceu(true);
          tocar('vitoria');
          setConfettiTrigger((t) => t + 1);
        }
      } else {
        setBloqueado(true);
        compararTimeoutRef.current = setTimeout(() => {
          setCartas((prev) => prev.map((c) => (c.id === idA || c.id === idB ? { ...c, virada: false } : c)));
          setSelecionadas([]);
          setBloqueado(false);
        }, 800);
      }
    }
  };

  const tempoFormatado = `${Math.floor(segundos / 60).toString().padStart(2, '0')}:${(segundos % 60).toString().padStart(2, '0')}`;

  return (
    <>
      <Confetti trigger={confettiTrigger} />

      <div className="relative w-full min-h-[calc(100vh-5rem)] bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.4)_0%,_transparent_45%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.2)_0%,_transparent_45%)] text-white overflow-y-auto select-none">
        <BackButton />
        <div className="min-h-full flex flex-col items-center justify-center gap-6 px-6 py-16">

          <div className="text-[10px] font-black uppercase text-[#336699] tracking-widest">Touchscreen • Jogo da Memória</div>

          {fase === 'config' && (
            <div className="w-full max-w-sm bg-[#0C1D4D]/40 border border-[#284B8C]/40 rounded-2xl p-6 backdrop-blur-md flex flex-col gap-5">
              <h1 className="text-xl font-black uppercase text-center text-white">Escolha a Dificuldade</h1>
              <div className="flex flex-col gap-2.5">
                {(Object.keys(CONFIG_DIFICULDADE) as Dificuldade[]).map((dif) => (
                  <button
                    key={dif}
                    onClick={() => iniciarJogo(dif)}
                    className="bg-black/30 hover:bg-[#336699] border border-white/10 hover:border-[#336699] text-white py-4 rounded-xl font-black uppercase tracking-widest text-sm transition-all"
                  >
                    {CONFIG_DIFICULDADE[dif].label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {fase === 'jogo' && (
            <div className="w-full max-w-lg flex flex-col items-center gap-5">
              <div className="w-full flex items-center justify-between bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-xs font-black uppercase">
                <span className="text-[#336699]">Movimentos: {movimentos}</span>
                <span className="text-white/70">{tempoFormatado}</span>
              </div>

              {venceu && (
                <p className="text-lg md:text-xl font-black uppercase tracking-wide text-center text-[#16A34A]">
                  Você venceu em {movimentos} movimentos!
                </p>
              )}

              <div className={`grid ${CONFIG_DIFICULDADE[dificuldade].cols} gap-2.5 w-full`}>
                {cartas.map((carta) => (
                  <button
                    key={carta.id}
                    onClick={() => virarCarta(carta.id)}
                    className={`aspect-square rounded-xl flex items-center justify-center text-2xl md:text-4xl font-black transition-all active:scale-95 ${
                      carta.virada || carta.encontrada
                        ? carta.encontrada
                          ? 'bg-[#16A34A]/30 border-2 border-[#16A34A]'
                          : 'bg-white/95 border-2 border-white'
                        : 'bg-[#284B8C] border-2 border-[#336699] hover:bg-[#336699]'
                    }`}
                  >
                    {(carta.virada || carta.encontrada) ? carta.simbolo : ''}
                  </button>
                ))}
              </div>

              <div className="w-full flex flex-col gap-2.5">
                <button onClick={() => iniciarJogo(dificuldade)} className="w-full bg-[#16A34A] hover:bg-[#15803d] text-white py-3.5 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-all">
                  {venceu ? 'Jogar Novamente' : 'Reiniciar'}
                </button>
                <button onClick={voltarConfig} className="w-full bg-white/10 hover:bg-white/20 text-white py-3.5 rounded-xl font-black uppercase tracking-widest text-xs transition-all">
                  Trocar Dificuldade
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
