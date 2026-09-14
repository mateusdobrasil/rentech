"use client";

// ============================================================================
// CALL TIME — a porta de entrada
//
// Três postos, um relógio. Esta tela existe porque, numa feira, ninguém lê
// texto: a pessoa chega, vê o que cada posto cobra dela em uma linha, e toca.
// O quadro do dia fica aqui embaixo, um por posto, porque pontuação de LED
// não se compara com pontuação de som.
// ============================================================================

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import BackButton from '../BackButton';
import { lerRanking, type Jogo } from '../../jogo/ranking';

type Posto = {
  jogo: Jogo;
  href: string;
  numero: string;
  titulo: string;
  chamada: string;
  oficio: string;
  contas: string[];
  regra: string;
  cor: string;
};

const POSTOS: Posto[] = [
  {
    jogo: 'montagem',
    href: '/testes/montagem',
    numero: '01',
    titulo: 'Painel de LED',
    chamada: 'Monte o painel que a OS pediu e faça ele acender inteiro.',
    oficio: 'Pitch, resolução, processadora, energia e sinal.',
    contas: [
      'Gabinete de 0,5 m: quantos fecham a medida da OS',
      '640.000 px por porta — quantos gabinetes cabem depende do pitch',
      'Painel a 400 W/m², tomada de 10 ou 20 A',
    ],
    regra: 'Painel menor que a OS é serviço não prestado.',
    cor: '#4E93D8',
  },
  {
    jogo: 'luz',
    href: '/testes/luz',
    numero: '02',
    titulo: 'Grid de luz',
    chamada: 'Pendure o grid, enderece tudo e suba antes da casa abrir.',
    oficio: 'DMX, cabo de aço, circuitos e içamento.',
    contas: [
      'Moving come 16 canais, par LED come 10',
      'Universo de 512 canais — e 32 aparelhos por linha',
      'Moving de 400 W e par de 200 W por circuito',
    ],
    regra: 'Peça pendurada sem cabo de aço reprova a partida.',
    cor: '#8B72D0',
  },
  {
    jogo: 'som',
    href: '/testes/som',
    numero: '03',
    titulo: 'PA e line array',
    chamada: 'Voe o PA, feche a cobertura e ligue na ordem certa.',
    oficio: 'Impedância, ângulo, delay e energização.',
    contas: [
      'Caixa de 8 Ω: duas por canal fecham os 4 Ω do amplificador',
      'A soma dos ângulos fecha a cobertura que a plateia pede',
      'Som a 343 m/s: a torre de delay pede a conta em ms',
    ],
    regra: 'Amplificador antes da mesa é estouro no PA.',
    cor: '#3E9E8F',
  },
];

// O quadro do dia sai do localStorage, que não existe no servidor.
const assinarNada = () => () => {};
const noNavegador = () => true;
const noServidor = () => false;

export default function CallTimeAbertura() {
  const montadoNoCliente = useSyncExternalStore(assinarNada, noNavegador, noServidor);

  return (
    <>
      <BackButton />

      <div className="min-h-[calc(100vh-5rem)] bg-black text-white">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14 flex flex-col gap-10">

          {/* ---------------- capa ---------------- */}
          <header className="flex flex-col gap-4">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#336699]">
              Locadora Rentech · jogo de montagem
            </span>
            <h1 className="text-5xl sm:text-7xl font-black uppercase tracking-tight leading-[0.9]">
              Call Time
            </h1>
            <p className="text-base sm:text-lg text-white/60 leading-relaxed max-w-[52ch]">
              O caminhão chegou às 14h e a porta abre às 19h. Errar não dá
              &ldquo;errado&rdquo;: dá retrabalho — e retrabalho custa relógio.
              Escolha o posto.
            </p>

            {/* a janela de montagem, que é a mesma nos três postos */}
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex h-2 rounded-full overflow-hidden">
                <div className="flex-[3] bg-[#4E93D8]" />
                <div className="flex-[3] bg-[#8B72D0]" />
                <div className="flex-[2] bg-[#3E9E8F]" />
                <div className="flex-1 bg-[#253451]" />
              </div>
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/35 tabular-nums">
                <span>14:00 · caminhão</span>
                <span className="hidden sm:inline">montagem</span>
                <span className="text-red-400/80">19:00 · porta abre</span>
              </div>
            </div>
          </header>

          {/* ---------------- os postos ---------------- */}
          <div className="grid gap-4 md:grid-cols-3">
            {POSTOS.map((posto) => (
              <Link
                key={posto.jogo}
                href={posto.href}
                className="group flex flex-col gap-4 rounded-2xl border border-[#284B8C]/30 bg-[#0C1D4D]/20 p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-[#336699] hover:bg-[#0C1D4D]/35"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="text-[10px] font-black uppercase tracking-widest"
                    style={{ color: posto.cor }}
                  >
                    Posto {posto.numero}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">
                    {posto.oficio}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <h2 className="text-2xl font-black tracking-tight leading-none">{posto.titulo}</h2>
                  <p className="text-sm text-white/60 leading-relaxed">{posto.chamada}</p>
                </div>

                <ul className="flex flex-col gap-1.5 flex-grow">
                  {posto.contas.map((conta) => (
                    <li key={conta} className="flex gap-2 text-[11px] leading-snug text-white/45">
                      <span style={{ color: posto.cor }}>—</span>
                      <span>{conta}</span>
                    </li>
                  ))}
                </ul>

                <p className="text-[11px] font-bold leading-snug text-red-300/80 border-l-2 border-red-500/40 pl-3">
                  {posto.regra}
                </p>

                <div className="flex items-center justify-between pt-1">
                  <span
                    className="text-[11px] font-black uppercase tracking-widest"
                    style={{ color: posto.cor }}
                  >
                    Montar
                  </span>
                  <span className="text-white/25 group-hover:text-white/60 transition-colors">→</span>
                </div>

                <div
                  className="h-1 w-10 rounded-sm transition-all duration-500 group-hover:w-full"
                  style={{ background: posto.cor }}
                />
              </Link>
            ))}
          </div>

          {/* ---------------- quadro do dia ---------------- */}
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3 border-b border-[#284B8C]/25 pb-2">
              <h2 className="text-sm font-black uppercase tracking-widest text-white/70">Melhores de hoje</h2>
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">
                o quadro zera na virada do dia
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {POSTOS.map((posto) => {
                const marcas = montadoNoCliente ? lerRanking(posto.jogo) : [];
                return (
                  <div key={posto.jogo} className="flex flex-col gap-1.5">
                    <span
                      className="text-[10px] font-black uppercase tracking-widest"
                      style={{ color: posto.cor }}
                    >
                      {posto.titulo}
                    </span>
                    {marcas.length === 0 ? (
                      <span className="text-[11px] text-white/25">Ninguém montou hoje.</span>
                    ) : (
                      marcas.slice(0, 5).map((m, k) => (
                        <div
                          key={`${m.apelido}-${m.quando}`}
                          className="flex items-baseline justify-between text-xs font-bold tabular-nums text-white/70"
                        >
                          <span>{k + 1}. {m.apelido}</span>
                          <span>{m.pontos}</span>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------------- rodapé ---------------- */}
          <p className="text-[11px] text-white/30 leading-relaxed max-w-[60ch]">
            Os números são os da operação: gabinete de 0,5 m, 640.000 px por porta,
            512 canais por universo DMX, 4 Ω de mínimo no canal do amplificador.
            Quem joga bem aqui está fazendo as mesmas contas que faria na obra.
          </p>
        </div>
      </div>
    </>
  );
}
