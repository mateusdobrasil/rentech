"use client";

import { useState, useRef, useEffect } from 'react';
import BackButton from '../BackButton';
import Confetti from '../Confetti';
import { useSom } from '../useSom';

type Simbolo = 'X' | 'O';
type Fase = 'config' | 'jogo';
type Tabuleiro = (Simbolo | null)[];

const CONDICOES_VITORIA = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function melhorMovimento(tab: Tabuleiro, simbolo: Simbolo): number | null {
  for (const [a, b, c] of CONDICOES_VITORIA) {
    const valores = [tab[a], tab[b], tab[c]];
    if (valores.filter((v) => v === simbolo).length === 2 && valores.filter((v) => v === null).length === 1) {
      if (tab[a] === null) return a;
      if (tab[b] === null) return b;
      return c;
    }
  }
  return null;
}

export default function JogoDaVelha() {
  const { iniciar: iniciarAudio, tocar } = useSom();

  const [fase, setFase] = useState<Fase>('config');
  const [modo, setModo] = useState<'pvp' | 'pve'>('pvp');
  const [inputNomeX, setInputNomeX] = useState('');
  const [inputNomeO, setInputNomeO] = useState('');
  const [nomeX, setNomeX] = useState('Jogador 1');
  const [nomeO, setNomeO] = useState('Jogador 2');

  const [tabuleiro, setTabuleiro] = useState<Tabuleiro>(Array(9).fill(null));
  const [jogadorAtual, setJogadorAtual] = useState<Simbolo>('X');
  const [jogoAtivo, setJogoAtivo] = useState(false);
  const [vencedor, setVencedor] = useState<Simbolo | 'empate' | null>(null);

  const [pontosX, setPontosX] = useState(0);
  const [pontosO, setPontosO] = useState(0);
  const [pontosEmpates, setPontosEmpates] = useState(0);
  const [confettiTrigger, setConfettiTrigger] = useState(0);

  const iaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (iaTimeoutRef.current) clearTimeout(iaTimeoutRef.current); }, []);

  const nomeAtual = jogadorAtual === 'X' ? nomeX : nomeO;

  const jogadaDaMaquina = (tabAtual: Tabuleiro) => {
    let jogada = melhorMovimento(tabAtual, 'O');
    if (jogada === null) jogada = melhorMovimento(tabAtual, 'X');
    if (jogada === null && tabAtual[4] === null) jogada = 4;
    if (jogada === null) {
      const cantos = [0, 2, 6, 8].filter((i) => tabAtual[i] === null);
      if (cantos.length > 0) jogada = cantos[Math.floor(Math.random() * cantos.length)];
    }
    if (jogada === null) {
      const vazios = tabAtual.map((v, i) => (v === null ? i : -1)).filter((i) => i !== -1);
      jogada = vazios[Math.floor(Math.random() * vazios.length)];
    }
    if (jogada !== null && jogada !== undefined) realizarJogada(jogada, tabAtual, 'O');
  };

  const realizarJogada = (indice: number, tabBase?: Tabuleiro, jogadorForcado?: Simbolo) => {
    const tab = tabBase ?? tabuleiro;
    const jogador = jogadorForcado ?? jogadorAtual;
    if (tab[indice] !== null) return;

    iniciarAudio();
    tocar('clique', jogador === 'X' ? 600 : 800);

    const novoTab = [...tab];
    novoTab[indice] = jogador;
    setTabuleiro(novoTab);

    for (const [a, b, c] of CONDICOES_VITORIA) {
      if (novoTab[a] && novoTab[a] === novoTab[b] && novoTab[a] === novoTab[c]) {
        setJogoAtivo(false);
        setVencedor(jogador);
        tocar('vitoria');
        setConfettiTrigger((t) => t + 1);
        if (jogador === 'X') setPontosX((p) => p + 1); else setPontosO((p) => p + 1);
        return;
      }
    }

    if (!novoTab.includes(null)) {
      setJogoAtivo(false);
      setVencedor('empate');
      tocar('erro');
      setPontosEmpates((p) => p + 1);
      return;
    }

    const proximo: Simbolo = jogador === 'X' ? 'O' : 'X';
    setJogadorAtual(proximo);

    if (modo === 'pve' && proximo === 'O') {
      iaTimeoutRef.current = setTimeout(() => jogadaDaMaquina(novoTab), 600);
    }
  };

  const novaPartida = (primeiroJogador: Simbolo) => {
    if (iaTimeoutRef.current) clearTimeout(iaTimeoutRef.current);
    const tabVazio = Array(9).fill(null);
    setTabuleiro(tabVazio);
    setVencedor(null);
    setJogadorAtual(primeiroJogador);
    setJogoAtivo(true);

    if (modo === 'pve' && primeiroJogador === 'O') {
      iaTimeoutRef.current = setTimeout(() => jogadaDaMaquina(tabVazio), 600);
    }
  };

  const iniciarJogo = () => {
    iniciarAudio();
    setNomeX(inputNomeX.trim() || 'Jogador 1');
    setNomeO(modo === 'pve' ? 'IA da Rentech' : (inputNomeO.trim() || 'Jogador 2'));
    setPontosX(0);
    setPontosO(0);
    setPontosEmpates(0);
    setFase('jogo');
    novaPartida('X');
  };

  const voltarConfig = () => {
    if (iaTimeoutRef.current) clearTimeout(iaTimeoutRef.current);
    setJogoAtivo(false);
    setFase('config');
  };

  const proximaPartida = () => {
    const proximoInicial: Simbolo = vencedor && vencedor !== 'empate' ? (vencedor === 'X' ? 'O' : 'X') : jogadorAtual;
    novaPartida(proximoInicial);
  };

  const handleClickCelula = (indice: number) => {
    if (!jogoAtivo) return;
    if (modo === 'pve' && jogadorAtual === 'O') return;
    realizarJogada(indice);
  };

  const statusTexto = !jogoAtivo && vencedor
    ? (vencedor === 'empate' ? 'Deu velha!' : `${vencedor === 'X' ? nomeX : nomeO} venceu!`)
    : (modo === 'pve' && jogadorAtual === 'O' ? 'IA pensando...' : `Vez de ${nomeAtual}`);

  return (
    <>
      <BackButton />
      <Confetti trigger={confettiTrigger} />

      <div className="relative w-full min-h-[calc(100vh-5rem)] bg-[#000000] bg-[radial-gradient(circle_at_20%_30%,_rgba(12,29,77,0.4)_0%,_transparent_45%),radial-gradient(circle_at_80%_70%,_rgba(51,102,153,0.2)_0%,_transparent_45%)] text-white overflow-y-auto select-none">
        <div className="min-h-full flex flex-col items-center justify-center gap-6 px-6 py-16">

          <div className="text-[10px] font-black uppercase text-[#336699] tracking-widest">Touchscreen • Jogo da Velha</div>

          {fase === 'config' && (
            <div className="w-full max-w-sm bg-[#0C1D4D]/40 border border-[#284B8C]/40 rounded-2xl p-6 backdrop-blur-md flex flex-col gap-5">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-white/60 block mb-2">Modo de Jogo</label>
                <div className="grid grid-cols-2 gap-2 bg-black/30 p-1.5 rounded-xl">
                  <button onClick={() => setModo('pvp')} className={`py-3 rounded-lg text-xs font-black uppercase transition-colors ${modo === 'pvp' ? 'bg-[#336699] text-white' : 'text-white/60 hover:bg-white/5'}`}>2 Jogadores</button>
                  <button onClick={() => setModo('pve')} className={`py-3 rounded-lg text-xs font-black uppercase transition-colors ${modo === 'pve' ? 'bg-[#336699] text-white' : 'text-white/60 hover:bg-white/5'}`}>Contra a Máquina</button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-white/60 block mb-2">Jogador 1 (X)</label>
                <input type="text" value={inputNomeX} onChange={(e) => setInputNomeX(e.target.value)} placeholder="Ex: Jogador 1" className="w-full p-3 bg-black/30 border border-white/10 rounded-xl text-sm font-bold outline-none focus:border-[#336699]" />
              </div>

              {modo === 'pvp' && (
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/60 block mb-2">Jogador 2 (O)</label>
                  <input type="text" value={inputNomeO} onChange={(e) => setInputNomeO(e.target.value)} placeholder="Ex: Jogador 2" className="w-full p-3 bg-black/30 border border-white/10 rounded-xl text-sm font-bold outline-none focus:border-[#336699]" />
                </div>
              )}

              <button onClick={iniciarJogo} className="bg-[#284B8C] hover:bg-[#336699] text-white py-4 rounded-xl font-black uppercase tracking-widest text-sm shadow-lg transition-all">
                Começar Jogo
              </button>
            </div>
          )}

          {fase === 'jogo' && (
            <div className="w-full max-w-sm flex flex-col items-center gap-5">
              <div className="w-full flex items-center justify-between bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-xs font-black uppercase">
                <span className="text-red-400 truncate max-w-[30%]">{nomeX}: {pontosX}</span>
                <span className="text-white/40">Empates: {pontosEmpates}</span>
                <span className="text-blue-400 truncate max-w-[30%]">{nomeO}: {pontosO}</span>
              </div>

              <p className="text-lg md:text-xl font-black uppercase tracking-wide text-center min-h-[28px]">{statusTexto}</p>

              <div className="grid grid-cols-3 gap-2.5 bg-[#0C1D4D]/60 p-2.5 rounded-2xl w-full">
                {tabuleiro.map((valor, i) => (
                  <button
                    key={i}
                    onClick={() => handleClickCelula(i)}
                    className={`aspect-square rounded-xl bg-white/95 flex items-center justify-center text-4xl md:text-5xl font-black transition-transform active:scale-95 ${valor === 'X' ? 'text-red-500' : valor === 'O' ? 'text-blue-500' : ''}`}
                  >
                    {valor}
                  </button>
                ))}
              </div>

              <div className="w-full flex flex-col gap-2.5">
                <button onClick={proximaPartida} className="w-full bg-[#16A34A] hover:bg-[#15803d] text-white py-3.5 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-all">
                  {jogoAtivo ? 'Reiniciar Partida' : 'Próxima Partida'}
                </button>
                <button onClick={voltarConfig} className="w-full bg-white/10 hover:bg-white/20 text-white py-3.5 rounded-xl font-black uppercase tracking-widest text-xs transition-all">
                  Trocar Jogadores
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
