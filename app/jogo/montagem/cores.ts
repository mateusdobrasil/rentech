// ============================================================================
// Paleta compartilhada entre a planta 2D e o palco 3D. Só hex: o Three.js não
// aceita as cores em rgba() que o CSS aceita.
// ============================================================================

export const CORES_CIRCUITO = [
  '#E0912F', '#3E9E8F', '#8B72D0', '#D45D79', '#4E93D8',
  '#B8A03E', '#5FB35F', '#C0704F', '#7E8FD0', '#A65FA6',
  '#4FA3B8', '#D08A3E', '#6FA34F', '#B85F7E', '#5F7EB8',
];

export const CORES_PORTA = ['#4E93D8', '#E0912F', '#3E9E8F', '#8B72D0'];

/** Gabinete instalado na ordem certa, com a estrutura ainda no chão. */
export const COR_GABINETE = '#336699';
/** Gabinete instalado depois do içamento — o âmbar marca o retrabalho. */
export const COR_GABINETE_AR = '#8A5A22';
/** Instalado, mas sem circuito ou sem porta atribuída. */
export const COR_SEM_ATRIBUICAO = '#1E2A40';
/** Vão onde ainda falta gabinete. */
export const COR_VAZIO = '#0E1626';

export const COR_TRUSS = '#0C1D4D';
export const COR_DIAGONAL = '#336699';
export const COR_CABO = '#2A3550';

export const corCircuito = (n: number) => CORES_CIRCUITO[(n - 1) % CORES_CIRCUITO.length];
export const corPorta = (n: number) => CORES_PORTA[(n - 1) % CORES_PORTA.length];
