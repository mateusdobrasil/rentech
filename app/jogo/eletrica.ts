// ============================================================================
// CALL TIME — energia de palco, compartilhada entre os postos
//
// LED, luz e som puxam da mesma régua: as tomadas do local, a margem do
// disjuntor e o tempo de um lance de cabo não mudam porque o equipamento
// mudou. O que muda é o consumo de cada peça, e isso fica no motor de cada
// posto.
// ============================================================================

export const TENSAO_V = 220;

/** Tomadas do local: sempre 220 V; o disjuntor muda de obra para obra. */
export type Tomada = 10 | 20;
export const TOMADAS_A: readonly Tomada[] = [10, 20];

/**
 * Disjuntor não trabalha no limite: carga contínua fica em 80% do nominal.
 * Os 20% de folga cobrem o calor no quadro, a queda de tensão no fim do cabo
 * e o pico das fontes quando o equipamento liga.
 */
export const MARGEM_DISJUNTOR = 0.8;

/** 20 A: 4.400 W · 10 A: 2.200 W */
export const wNominal = (a: Tomada) => TENSAO_V * a;
/** 20 A: 3.520 W · 10 A: 1.760 W */
export const wUtil = (a: Tomada) => wNominal(a) * MARGEM_DISJUNTOR;

/**
 * Energia se paga por circuito puxado: cada um é um lance de cabo do quadro
 * até o palco, um disjuntor e um teste de tensão — use-se ou não.
 */
export const ENERGIA = {
  /** Montar o hub, aterramento e conferência de fase e neutro. */
  base: 6,
  porCircuito: 5,
} as const;

/** Quantos circuitos aquela carga pede naquela tomada. */
export const circuitosParaW = (watts: number, a: Tomada) => Math.ceil(watts / wUtil(a));

/** "3,5 kW" */
export const fmtKw = (w: number) => `${(w / 1000).toFixed(1).replace('.', ',')} kW`;
