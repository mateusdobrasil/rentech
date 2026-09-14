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
 * Régua de carga por circuito, sobre o nominal do disjuntor.
 *
 * O disjuntor conduz a corrente nominal continuamente — a NBR 5410 não manda
 * derrubar isso para 80% como o NEC americano. A folga aqui é de operação, e
 * tem três motivos concretos: disjuntor é calibrado a 30 °C e dentro de quadro
 * fechado ou rack os fabricantes publicam fator de 0,90 a 40 °C; o cabo de um
 * lance longo, ainda por cima enrolado no carretel, esquenta antes do
 * disjuntor desarmar; e a fonte chaveada dá pico ao ligar.
 *
 * 0,9 é a régua da operação da Rentech: 3.960 W num circuito de 20 A.
 */
export const MARGEM_DISJUNTOR = 0.9;

/** O que o disjuntor aguenta no limite — 20 A: 4.400 VA · 10 A: 2.200 VA */
export const wNominal = (a: Tomada) => TENSAO_V * a;
/** A régua de trabalho — 20 A: 3.960 W · 10 A: 1.980 W */
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
