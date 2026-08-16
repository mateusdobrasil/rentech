// ============================================================================
// Metadados compartilhados do modo Montagem Livre (cores/rótulos das peças de nó).
// Extraído para módulo próprio para poder ser importado tanto por page.tsx
// quanto pelo visualizador 3D (Truss3D.tsx) sem criar dependência circular.
// ============================================================================
export type NoAcessorio = 'sapata' | 'talha' | 'pauCarga';

export const NODE_META: Record<NoAcessorio, { cor: string; letra: string; nome: string }> = {
  sapata: { cor: '#94A3B8', letra: 'B', nome: 'Sapata' },
  talha: { cor: '#D97706', letra: 'T', nome: 'Talha' },
  pauCarga: { cor: '#7C3AED', letra: 'P', nome: 'Pau de Carga' },
};

// Cubo (canto/junção) e Sleeve (emenda em linha reta) não são posicionados manualmente:
// são inferidos a partir da geometria das retas desenhadas em cada nó do grid.
export const AUTO_CONEXAO_META: Record<'cubo' | 'sleeve', { cor: string; letra: string; nome: string }> = {
  cubo: { cor: '#0C1D4D', letra: 'C', nome: 'Cubo (peça de canto)' },
  sleeve: { cor: '#336699', letra: 'S', nome: 'Sleeve (luva de emenda)' },
};
