// ============================================================================
// CALL TIME — içamento, compartilhado entre os postos
//
// Talha é talha: o catálogo e a régua de escolha valem para o portal do LED e
// para o grid de luz. O que muda é o que está pendurado, e isso fica no motor
// de cada posto.
// ============================================================================

/** Catálogo de talhas — app/simulador/boxtruss/page.tsx (TALHA_OPTIONS) */
export const TALHAS_KG = [500, 1000, 2000, 3000] as const;

/** Pontos de içamento de uma estrutura de palco: as duas pontas. */
export const PONTOS_ICAMENTO = 2;

/** Q30, quatro tubos de 5,5 kg/m — app/simulador/boxtruss/page.tsx (Q_INFO) */
export const TRUSS_Q30_KG_POR_M = 22;

/** Mesma lógica do recomendarTalha() do simulador de boxtruss. */
export function talhaRecomendada(cargaKg: number): number {
  return TALHAS_KG.find((t) => t >= cargaKg) ?? TALHAS_KG[TALHAS_KG.length - 1];
}

/** Talha maior que o necessário: peso e gente a mais pra subir. */
export const CUSTO_TALHA_FOLGADA: Record<number, number> = {
  500: 0,
  1000: 0,
  2000: 5,
  3000: 10,
};
