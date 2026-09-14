// ============================================================================
// CALL TIME — motor do turno (Fase 5: a camada do salão)
//
// Os três postos já existem e cada um tem o seu relógio. O que falta é o que
// acontece ENTRE eles, que é onde mora a decisão de encarregado:
//
//   1. Equipe. São 6 montadores para três postos. Empilhar gente num posto
//      não dobra a produção — passa de três numa vara e um atrapalha o outro.
//   2. Ordem. O truss de luz cruza por cima do palco. Se o painel de LED subir
//      antes, o grid não passa mais e alguém vai ter que descer o painel.
//   3. Gerador. 75 kVA para o salão inteiro. LED, luz e som somados podem
//      estourar, e aí não é apontamento: é o geral caindo no meio do show.
//
// Sem React de propósito: é função pura sobre um estado, para dar pra simular
// o turno inteiro antes de desenhar tela.
// ============================================================================

import {
  sortearBriefing as sortearObraVideo,
  APLICACOES as APLICACOES_VIDEO,
  type Briefing as ObraVideo,
} from '../video/motor';
import {
  sortearBriefing as sortearObraLuz,
  APLICACOES as APLICACOES_LUZ,
  type BriefingLuz as ObraLuz,
} from '../luz/motor';
import {
  sortearBriefing as sortearObraSom,
  APLICACOES as APLICACOES_SOM,
  type BriefingSom as ObraSom,
} from '../som/motor';

export type { ObraVideo, ObraLuz, ObraSom };

export type PostoId = 'video' | 'luz' | 'som';

export const POSTOS: { id: PostoId; rotulo: string; rota: string; cor: string; oficio: string }[] = [
  { id: 'video', rotulo: 'Palco LED', rota: '/testes/calltime/video', cor: '#4E93D8', oficio: 'Painel, energia e sinal' },
  { id: 'luz', rotulo: 'Grid de luz', rota: '/testes/calltime/luz', cor: '#8B72D0', oficio: 'DMX, cabo de aço e circuitos' },
  { id: 'som', rotulo: 'PA e line array', rota: '/testes/calltime/som', cor: '#3E9E8F', oficio: 'Impedância, ângulo e delay' },
];

export const acharPosto = (id: PostoId) => POSTOS.find((p) => p.id === id)!;

// ---------------------------------------------------------------------------
// A equipe
// ---------------------------------------------------------------------------

export const EQUIPE_TOTAL = 6;

/**
 * Quanto o trabalho de um posto rende com N montadores, contra a DUPLA, que é
 * como se monta e é a régua com que a janela de cada posto foi calibrada.
 *
 * Não é proporcional de propósito: o terceiro montador ainda ajuda bastante, o
 * quarto ajuda menos e o quinto e o sexto quase só atrapalham na mesma vara.
 * Sozinho é pior que metade de uma dupla — não há quem segure a peça enquanto
 * o outro aperta a garra.
 */
export const FATOR_EQUIPE: Record<number, number> = {
  0: Infinity,
  1: 1.8,
  2: 1.0,
  3: 0.82,
  4: 0.72,
  5: 0.66,
  6: 0.62,
};

export const fatorEquipe = (montadores: number) =>
  FATOR_EQUIPE[Math.max(0, Math.min(EQUIPE_TOTAL, Math.round(montadores)))] ?? Infinity;

// ---------------------------------------------------------------------------
// O salão
// ---------------------------------------------------------------------------

/** 14:00 às 19:00. */
export const JANELA_TURNO = 300;
export const HORA_INICIAL = 14 * 60;

/** Gerador do salão. */
export const GERADOR_KVA = 75;
/** Equipamento de palco com fonte chaveada e PFC. */
export const FATOR_POTENCIA = 0.9;

/** Buscar e ligar um segundo gerador no meio do turno. */
export const CUSTO_GERADOR_EXTRA = 40;

/**
 * Içar o painel de LED antes do grid de luz: o truss de luz cruza por cima do
 * palco e não passa mais. Alguém vai ter que descer o painel, passar o grid e
 * subir de novo.
 */
export const CUSTO_ORDEM_INVERTIDA = 20;

/** Montar o rack de controle: régie, cabo de sinal e multicabo até o palco. */
export const CUSTO_RACK = 25;

// ---------------------------------------------------------------------------
// O que cada posto devolve quando o técnico fecha a partida
// ---------------------------------------------------------------------------

export type ResultadoPosto = {
  posto: PostoId;
  /** Minutos de trabalho gastos na partida daquele posto. */
  minutos: number;
  pontos: number;
  qualidade: number;
  reprovado: boolean;
  /** Etiquetas curtas dos apontamentos, para o relatório do turno. */
  problemas: string[];
  /** Carga elétrica que aquele posto entregou ligada, em watts. */
  watts: number;
  /** Se o posto usou a talha. A ordem disso é o que trava o palco. */
  icou: boolean;
  /** Quantos montadores estavam nele. Fica gravado: é o que fez o tempo. */
  montadores: number;
};

/**
 * As três obras do salão saem juntas, no começo do turno. É isso que faz a
 * alocação de equipe virar decisão: o encarregado vê que a plenária de 98
 * gabinetes é maior que o estande e põe gente onde o trabalho está.
 */
export type ObrasDoTurno = { video: ObraVideo; luz: ObraLuz; som: ObraSom };

export const sortearObras = (): ObrasDoTurno => ({
  video: sortearObraVideo(),
  luz: sortearObraLuz(),
  som: sortearObraSom(),
});

export type Turno = {
  obras: ObrasDoTurno;
  /** Quantos montadores em cada posto. */
  equipe: Record<PostoId, number>;
  /** A ordem em que os postos içaram, preenchida conforme o turno anda. */
  ordemIcamento: PostoId[];
  resultados: Partial<Record<PostoId, ResultadoPosto>>;
  /** O encarregado decidiu buscar o segundo gerador. */
  geradorExtra: boolean;
  /** Rack de controle montado. */
  rackMontado: boolean;
  fechado: boolean;
};

export function criarTurno(obras: ObrasDoTurno = sortearObras()): Turno {
  return {
    obras,
    equipe: { video: 2, luz: 2, som: 2 },
    ordemIcamento: [],
    resultados: {},
    geradorExtra: false,
    rackMontado: false,
    fechado: false,
  };
}

// ---------------------------------------------------------------------------
// O porte de cada obra, que é o que o encarregado enxerga do salão
// ---------------------------------------------------------------------------

export type ResumoDaObra = {
  titulo: string;
  detalhe: string;
  /** Janela que a produção deu para aquela obra, com uma dupla nela. */
  previsto: number;
};

export function resumoDaObra(t: Turno, id: PostoId): ResumoDaObra {
  if (id === 'video') {
    const b = t.obras.video;
    return {
      titulo: APLICACOES_VIDEO[b.aplicacao].rotulo,
      detalhe: `${b.colunas} × ${b.linhas} gabinetes · ${b.pitch}`,
      previsto: b.janelaMin,
    };
  }
  if (id === 'luz') {
    const b = t.obras.luz;
    return {
      titulo: APLICACOES_LUZ[b.aplicacao].rotulo,
      detalhe: `${b.movings} movings · ${b.pars} pars`,
      previsto: b.janelaMin,
    };
  }
  const b = t.obras.som;
  return {
    titulo: APLICACOES_SOM[b.aplicacao].rotulo,
    detalhe: `${b.caixasPorLado} caixas por lado · ${b.subs} subs`,
    previsto: b.janelaMin,
  };
}

/** Quanto aquele posto deve custar ao salão com a equipe que está nele. */
export function previsaoDoPosto(t: Turno, id: PostoId): number {
  const entregue = t.resultados[id];
  if (entregue) return minutosDoPosto(t, id);
  const fator = fatorEquipe(t.equipe[id]);
  const previsto = resumoDaObra(t, id).previsto;
  return Number.isFinite(fator) ? Math.round(previsto * fator) : Infinity;
}

/** A previsão do turno inteiro, antes de jogar: o posto mais demorado manda. */
export function previsaoDoTurno(t: Turno): number {
  const maior = Math.max(...POSTOS.map((p) => previsaoDoPosto(t, p.id)));
  return Number.isFinite(maior) ? maior + CUSTO_RACK : Infinity;
}

// ---------------------------------------------------------------------------
// Leitura do turno
// ---------------------------------------------------------------------------

/**
 * Montador em posto entregue já desceu do palco: ele volta para o pátio e
 * precisa ser realocado. É por isso que a ordem de atacar os postos importa —
 * entregar o menor primeiro devolve a dupla para o maior.
 */
export const equipeAlocada = (t: Turno) =>
  POSTOS.reduce((n, p) => n + (postoJogado(t, p.id) ? 0 : t.equipe[p.id]), 0);

export const equipeDeSobra = (t: Turno) => EQUIPE_TOTAL - equipeAlocada(t);

export const postoJogado = (t: Turno, id: PostoId) => t.resultados[id] !== undefined;
export const postosEntregues = (t: Turno) => POSTOS.filter((p) => postoJogado(t, p.id)).length;
export const turnoCompleto = (t: Turno) => postosEntregues(t) === POSTOS.length && t.rackMontado;

/** Minutos que aquele posto custou ao salão, com a equipe que trabalhou nele. */
export function minutosDoPosto(t: Turno, id: PostoId): number {
  const r = t.resultados[id];
  if (!r) return 0;
  const fator = fatorEquipe(r.montadores);
  return Number.isFinite(fator) ? Math.round(r.minutos * fator) : r.minutos * 3;
}

/**
 * O salão não monta em fila indiana: com equipe em postos diferentes, eles
 * andam ao mesmo tempo. O relógio do turno é o do posto mais demorado, não a
 * soma — e é por isso que deixar um posto com um montador só atrasa tudo.
 */
export function minutosDeMontagem(t: Turno): number {
  return Math.max(0, ...POSTOS.map((p) => minutosDoPosto(t, p.id)));
}

export function minutosExtras(t: Turno): number {
  return conflitos(t).reduce((n, c) => n + c.minutos, 0)
    + (t.geradorExtra ? CUSTO_GERADOR_EXTRA : 0)
    + (t.rackMontado ? CUSTO_RACK : 0);
}

export const minutosDoTurno = (t: Turno) => minutosDeMontagem(t) + minutosExtras(t);

export const folgaDoTurno = (t: Turno) => JANELA_TURNO - minutosDoTurno(t);

export function relogio(minutos: number): string {
  const total = HORA_INICIAL + Math.max(0, minutos);
  const h = Math.floor(total / 60) % 24;
  const m = Math.round(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Energia do salão
// ---------------------------------------------------------------------------

export const wattsDoSalao = (t: Turno) =>
  POSTOS.reduce((n, p) => n + (t.resultados[p.id]?.watts ?? 0), 0);

/** A conta que o gerador enxerga: watt vira VA dividido pelo fator de potência. */
export const kvaDoSalao = (t: Turno) => wattsDoSalao(t) / FATOR_POTENCIA / 1000;

export const geradorEstourado = (t: Turno) => kvaDoSalao(t) > GERADOR_KVA;

/** Quanto ainda cabe no gerador, em kVA. */
export const kvaDisponivel = (t: Turno) => Math.max(0, GERADOR_KVA - kvaDoSalao(t));

// ---------------------------------------------------------------------------
// Conflitos entre postos — é isso que a camada do salão cobra
// ---------------------------------------------------------------------------

export type Conflito = {
  tipo: 'ordem' | 'gerador' | 'equipe';
  texto: string;
  curto: string;
  minutos: number;
  /** Conflito que não se resolve com minutos: o turno não foi entregue. */
  reprova?: boolean;
};

export function conflitos(t: Turno): Conflito[] {
  const lista: Conflito[] = [];

  // --- a ordem do içamento ---
  const led = t.ordemIcamento.indexOf('video');
  const luz = t.ordemIcamento.indexOf('luz');
  if (led >= 0 && luz >= 0 && led < luz) {
    lista.push({
      tipo: 'ordem',
      texto: 'O painel de LED subiu antes do grid de luz. O truss de luz cruza por cima do palco e não passou mais: foi preciso descer o painel, passar o grid e subir tudo de novo.',
      curto: 'LED subiu antes da luz',
      minutos: CUSTO_ORDEM_INVERTIDA,
    });
  }

  // --- o gerador ---
  if (geradorEstourado(t) && !t.geradorExtra) {
    lista.push({
      tipo: 'gerador',
      texto: `O salão pediu ${kvaDoSalao(t).toFixed(1).replace('.', ',')} kVA de um gerador de ${GERADOR_KVA} kVA. O geral caiu com a casa cheia, e não tem apontamento que conserte isso.`,
      curto: 'Gerador estourado',
      minutos: 0,
      reprova: true,
    });
  }

  // --- gente parada com posto ainda por montar ---
  const pendentes = POSTOS.filter((p) => !postoJogado(t, p.id));
  const sobra = equipeDeSobra(t);
  if (sobra > 0 && pendentes.length > 0) {
    lista.push({
      tipo: 'equipe',
      texto: `${sobra} ${sobra === 1 ? 'montador está parado' : 'montadores estão parados'} no pátio com ${pendentes.length === 1 ? 'um posto' : `${pendentes.length} postos`} por montar. Distribua a equipe antes de entrar no próximo.`,
      curto: `${sobra} ${sobra === 1 ? 'montador parado' : 'montadores parados'}`,
      minutos: 0,
    });
  }

  return lista;
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

/** Posto já entregue não recebe mais gente; o resto se divide entre os pendentes. */
export function alocarEquipe(t: Turno, id: PostoId, montadores: number): Turno {
  if (postoJogado(t, id) || t.fechado) return t;
  const alvo = Math.max(0, Math.min(EQUIPE_TOTAL, Math.round(montadores)));
  const outros = POSTOS
    .filter((p) => p.id !== id && !postoJogado(t, p.id))
    .reduce((n, p) => n + t.equipe[p.id], 0);
  if (outros + alvo > EQUIPE_TOTAL) return t;
  return { ...t, equipe: { ...t.equipe, [id]: alvo } };
}

/**
 * O salão só deixa entrar num posto com a equipe inteira distribuída entre os
 * postos que ainda faltam. Montador parado no pátio é hora que a produção
 * pagou e não usou — e a cada entrega a conta é refeita.
 */
export const podeEntrarNoPosto = (t: Turno, id: PostoId) =>
  !postoJogado(t, id) && t.equipe[id] > 0 && equipeDeSobra(t) === 0 && !t.fechado;

export function registrarPosto(t: Turno, bruto: ResultadoPosto): Turno {
  // a equipe que estava no posto fica gravada com o resultado; ela volta ao
  // pátio no mesmo instante, para o encarregado decidir onde ela rende mais
  const r: ResultadoPosto = { ...bruto, montadores: bruto.montadores || t.equipe[bruto.posto] };
  const ordemIcamento = r.icou && !t.ordemIcamento.includes(r.posto)
    ? [...t.ordemIcamento, r.posto]
    : t.ordemIcamento;
  return { ...t, resultados: { ...t.resultados, [r.posto]: r }, ordemIcamento };
}

export const buscarGerador = (t: Turno): Turno => ({ ...t, geradorExtra: true });
export const montarRack = (t: Turno): Turno => ({ ...t, rackMontado: true });
export const fecharTurno = (t: Turno): Turno => ({ ...t, fechado: true });

// ---------------------------------------------------------------------------
// Placar do turno
// ---------------------------------------------------------------------------

export const BONUS_TURNO_COMPLETO = 500;

export type PlacarTurno = {
  dosPostos: number;
  daFolga: number;
  bonusCompleto: number;
  total: number;
  reprovado: boolean;
  folgaMin: number;
  motivo: string | null;
};

export function pontuarTurno(t: Turno): PlacarTurno {
  const dosPostos = POSTOS.reduce((n, p) => n + (t.resultados[p.id]?.pontos ?? 0), 0);
  const folgaMin = Math.max(0, folgaDoTurno(t));
  const daFolga = folgaMin * 20;
  const completo = turnoCompleto(t);
  const bonusCompleto = completo ? BONUS_TURNO_COMPLETO : 0;

  const postoReprovado = POSTOS.find((p) => t.resultados[p.id]?.reprovado);
  const conflitoQueReprova = conflitos(t).find((c) => c.reprova);
  const atrasou = minutosDoTurno(t) > JANELA_TURNO;

  const motivo = conflitoQueReprova ? conflitoQueReprova.texto
    : postoReprovado ? `${acharPosto(postoReprovado.id).rotulo} não foi entregue.`
    : atrasou ? `A porta abriu ${minutosDoTurno(t) - JANELA_TURNO} min antes de o salão ficar pronto.`
    : !completo ? 'O turno acabou com posto sem montar.'
    : null;

  const reprovado = motivo !== null;

  return {
    dosPostos,
    daFolga,
    bonusCompleto,
    total: reprovado ? 0 : dosPostos + daFolga + bonusCompleto,
    reprovado,
    folgaMin,
    motivo,
  };
}

// ---------------------------------------------------------------------------
// O relatório que a tela do salão mostra no fim
// ---------------------------------------------------------------------------

export function relatorio(t: Turno) {
  return {
    postos: POSTOS.map((p) => {
      const r = t.resultados[p.id];
      return {
        ...p,
        ...resumoDaObra(t, p.id),
        montadores: t.equipe[p.id],
        trabalho: r?.minutos ?? 0,
        calendario: minutosDoPosto(t, p.id),
        fator: fatorEquipe(t.equipe[p.id]),
        pontos: r?.pontos ?? 0,
        reprovado: r?.reprovado ?? false,
        problemas: r?.problemas ?? [],
        kw: (r?.watts ?? 0) / 1000,
        entregue: r !== undefined,
      };
    }),
    montagem: minutosDeMontagem(t),
    extras: minutosExtras(t),
    total: minutosDoTurno(t),
    kva: kvaDoSalao(t),
    conflitos: conflitos(t),
  };
}
