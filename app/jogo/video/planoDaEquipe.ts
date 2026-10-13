// ============================================================================
// CALL TIME — o que a equipe do palco de LED faz a cada mudança do jogo
//
// Função pura: recebe como o palco estava e como ficou, e devolve as ordens
// para cada montador. Fica fora do componente para dar para testar em node,
// como o resto do jogo.
// ============================================================================

import type { Passo } from '../Montador';

export type Ponto = [number, number, number];

/** O que a equipe precisa saber do palco num instante. */
export type Foto = {
  instalados: Set<number>;
  icado: boolean;
  vistoriando: boolean;
};

export type Contexto = {
  montadores: number;
  /** Uma pilha de cases de cada lado do palco: esquerda e direita. */
  pilhas: [Ponto, Ponto];
  xTorres: [number, number];
  duracaoIcamento: number;
  ondeNoChao: (i: number) => Ponto;
  ondeNoAr: (i: number) => Ponto;
  /** Quantos passos cada montador ainda tem na fila. */
  ocupacao: number[];
  /** De quem é a vez quando todos estão livres. */
  vez: number;
};

export type Ordem = {
  montador: number;
  passos: Passo[];
  urgente: boolean;
  /** Novo lugar de espera, quando muda (vistoria). */
  base?: Passo;
};

/**
 * Onde cada montador espera: metade de cada lado do palco, ao pé da sua torre.
 * Esperar todo mundo junto da pilha fazia o da esquerda atravessar o palco
 * inteiro para chegar na talha — e o painel subia antes de ele puxar.
 */
export const baseDeEspera = (xTorres: [number, number], k: number): Passo => {
  const lado = k % 2 === 0 ? 0 : 1;
  const sinal = lado === 0 ? -1 : 1;
  const fila = Math.floor(k / 2);
  return {
    ate: [xTorres[lado] + sinal * (0.9 + fila * 0.6), 0, 2.0 + fila * 0.7],
    pose: 'parado',
    espera: 0,
    olha: [0, 1.5],
  };
};

export function planejar(antes: Foto, agora: Foto, ctx: Contexto): { ordens: Ordem[]; vez: number } {
  const n = ctx.montadores;
  const ordens: Ordem[] = [];
  let vez = ctx.vez;
  const ocupacao = [...ctx.ocupacao];

  // cada um busca o gabinete na pilha do seu lado do palco
  const pegarNaPilha = (k: number): Passo => {
    const lado = k % 2;
    const pilha = ctx.pilhas[lado];
    return {
      ate: [pilha[0] + (lado === 0 ? 0.7 : -0.7), 0, pilha[2] + 0.25],
      pose: 'trabalhando',
      espera: 0.35,
      olha: [pilha[0], pilha[2]],
    };
  };

  // --- a vistoria tira todo mundo do palco --------------------------------
  if (agora.vistoriando && !antes.vistoriando) {
    for (let k = 0; k < n; k++) {
      const lado = k % 2 === 0 ? -1 : 1;
      const espera: Passo = {
        ate: [lado * (ctx.xTorres[1] + 1.3 + Math.floor(k / 2) * 0.7), 0, 2.4],
        pose: 'parado',
        espera: 0,
        olha: [0, 0],
      };
      ordens.push({ montador: k, passos: [espera], urgente: true, base: espera });
    }
    return { ordens, vez };
  }
  if (!agora.vistoriando && antes.vistoriando) {
    for (let k = 0; k < n; k++) {
      ordens.push({ montador: k, passos: [], urgente: true, base: baseDeEspera(ctx.xTorres, k) });
    }
  }

  // --- içar: a dupla na corrente da talha, cada um na torre do seu lado ----
  if (agora.icado && !antes.icado) {
    // o montador 0 espera do lado esquerdo e o 1 do direito: cada um vai
    // para a torre que já está perto dele
    for (let k = 0; k < Math.min(2, n); k++) {
      const torre = ctx.xTorres[k];
      const sinal = k === 0 ? 1 : -1;
      const ponto: Ponto = [torre + sinal * 0.55, 0, 0.55];
      ordens.push({
        montador: k,
        urgente: true,
        passos: [{
          ate: ponto,
          pose: 'puxando',
          espera: ctx.duracaoIcamento + 0.4,
          olha: [torre, 0],
        }],
      });
      ocupacao[k] = 1;
    }
  }

  // --- gabinetes novos -----------------------------------------------------
  const novos = [...agora.instalados].filter((i) => !antes.instalados.has(i));
  if (novos.length === 0) return { ordens, vez };

  // Quem pega o trabalho: o mais livre; empatou, o que espera do mesmo lado
  // do palco; empatou de novo, vai na vez. Assim ninguém atravessa o palco
  // para buscar um gabinete que o colega do outro lado buscava em dois passos.
  const escolher = (x: number) => {
    const ladoDoTrabalho = x < 0 ? 0 : 1;
    const custo = (k: number) =>
      ocupacao[k] * 10 + (k % 2 === ladoDoTrabalho ? 0 : 3) + ((k - vez + n) % n) * 0.1;
    const k = Array.from({ length: n }, (_, i) => i).sort((a, b) => custo(a) - custo(b))[0];
    vez = (vez + 1) % n;
    ocupacao[k] += 2;
    return k;
  };

  if (!agora.icado) {
    // painel no chão: lote grande vira trabalho de dupla, cada um num lado
    const pontos = novos.map(ctx.ondeNoChao);
    const meioX = mediana(pontos.map((p) => p[0]));
    const partes = (pontos.length > 6 && n > 1
      ? [pontos.filter((p) => p[0] <= meioX), pontos.filter((p) => p[0] > meioX)]
      : [pontos]
    ).filter((parte) => parte.length > 0);

    partes.forEach((parte) => {
      const cx = parte.reduce((s, p) => s + p[0], 0) / parte.length;
      const zFrente = Math.max(...parte.map((p) => p[2]));
      const quem = escolher(cx);
      ordens.push({
        montador: quem,
        urgente: false,
        passos: [pegarNaPilha(quem), {
          ate: [cx, 0, zFrente + 0.55],
          pose: 'trabalhando',
          espera: 0.9,
          carrega: true,
          olha: [cx, zFrente - 1],
        }],
      });
    });
  } else {
    // painel no ar: escada. É o que faz a montagem no ar custar mais.
    const p = ctx.ondeNoAr(novos[0]);
    const pes = Math.max(0, p[1] - 1.35);
    const quem = escolher(p[0]);
    ordens.push({
      montador: quem,
      urgente: false,
      passos: [pegarNaPilha(quem), {
        ate: [p[0], pes, 0.7],
        pose: 'trabalhando',
        espera: 1.1,
        carrega: true,
        escada: true,
        olha: [p[0], -1],
      }],
    });
  }

  return { ordens, vez };
}

function mediana(v: number[]) {
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}
