"use client";

// ============================================================================
// CALL TIME — a equipe no palco do LED
//
// Os bonecos não são enfeite: cada coisa que eles fazem é uma regra do jogo
// que a pessoa passa a enxergar.
//
//   · Gabinete instalado com o painel no chão: um montador busca na pilha de
//     cases, leva até o encaixe e trava. Lote grande vira trabalho de dupla.
//   · Içar: a dupla vai para as torres e puxa a corrente da talha.
//   · Gabinete instalado com o painel no ar: aparece a escada. É por isso que
//     montar no ar custa mais que o dobro — e agora dá para ver o porquê.
//   · Vistoria: a equipe sai do palco e espera na lateral.
//
// Num turno, quantos bonecos aparecem é quantos montadores o encarregado pôs
// neste posto. A decisão de quem faz o quê mora em planoDaEquipe.ts.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Montador, PilhaDeCases, criarRoteiro, mandar, mudarBase, ocupacao, type Roteiro } from '../Montador';
import { baseDeEspera, planejar, type Foto, type Ponto } from './planoDaEquipe';
import type { Estado } from './motor';

const MAX_MONTADORES = 6;

const fotografar = (e: Estado, vistoriando: boolean): Foto => {
  const instalados = new Set<number>();
  e.celulas.forEach((c, i) => { if (c.instalado) instalados.add(i); });
  return { instalados, icado: e.icado, vistoriando };
};

export default function EquipeLED({
  estado, montadores, vistoriando, reduzirMovimento, ondeNoChao, ondeNoAr, xTorres, pilhas, duracaoIcamento,
}: {
  estado: Estado;
  montadores: number;
  vistoriando: boolean;
  reduzirMovimento: boolean;
  /** Onde o encaixe fica com o painel deitado no chão. */
  ondeNoChao: (i: number) => Ponto;
  /** Onde o encaixe fica com o painel pendurado no portal. */
  ondeNoAr: (i: number) => Ponto;
  xTorres: [number, number];
  pilhas: [Ponto, Ponto];
  duracaoIcamento: number;
}) {
  const n = Math.max(1, Math.min(MAX_MONTADORES, Math.round(montadores)));

  // Os roteiros são objetos mutáveis que o boneco lê a cada quadro: criados
  // uma vez, e mexidos só por mandar() e mudarBase().
  const [equipe] = useState<Roteiro[]>(() =>
    Array.from({ length: MAX_MONTADORES }, (_, k) => criarRoteiro(baseDeEspera(xTorres, k))),
  );

  // Obra nova muda o vão do portal, e com ele o pé das torres: a equipe
  // reposiciona a espera e vai andando para lá quando estiver livre.
  useEffect(() => {
    if (vistoriando) return;
    equipe.forEach((r, k) => mudarBase(r, baseDeEspera(xTorres, k)));
  }, [xTorres, equipe, vistoriando]);

  const anterior = useRef<Foto | null>(null);
  const vez = useRef(0);

  useEffect(() => {
    const agora = fotografar(estado, vistoriando);
    const antes = anterior.current;
    anterior.current = agora;
    if (!antes) return; // primeira montagem da cena: só registra como está

    const plano = planejar(antes, agora, {
      montadores: n,
      pilhas,
      xTorres,
      duracaoIcamento,
      ondeNoChao,
      ondeNoAr,
      ocupacao: equipe.slice(0, n).map(ocupacao),
      vez: vez.current,
    });
    vez.current = plano.vez;

    for (const ordem of plano.ordens) {
      const r = equipe[ordem.montador];
      if (ordem.base) mudarBase(r, ordem.base);
      mandar(r, ordem.passos, ordem.urgente);
    }
  }, [estado, vistoriando, n, equipe, pilhas, xTorres, duracaoIcamento, ondeNoChao, ondeNoAr]);

  return (
    <>
      <PilhaDeCases posicao={pilhas[0]} />
      <PilhaDeCases posicao={pilhas[1]} />
      {equipe.slice(0, n).map((r, k) => (
        <Montador key={k} roteiro={r} reduzirMovimento={reduzirMovimento} />
      ))}
    </>
  );
}
