// app/lib/diretoria/km.ts
// Km rodados de um checklist de frota (km final − km inicial), com limite de
// sanidade: viagem com mais de 3.000 km entre saída e retorno é quase sempre
// km digitado errado (caso real 2026-11-15: outubro somou 975.209 km por causa
// de um checklist assim). Essas viagens ficam de fora da soma e são contadas
// à parte, pra o relatório dizer que há registro a corrigir.
export const KM_MAXIMO_POR_VIAGEM = 3000;

export function kmDaViagem(c: { km_inicial?: unknown; km_final?: unknown }): number | null {
  const ini = Number(c.km_inicial) || 0, fim = Number(c.km_final) || 0;
  if (!fim || fim <= ini) return 0;
  const km = fim - ini;
  return km > KM_MAXIMO_POR_VIAGEM ? null : km;
}

export function somarKm(checklists: { km_inicial?: unknown; km_final?: unknown }[]): { km: number; viagens_com_km_suspeito: number } {
  let km = 0, suspeitos = 0;
  for (const c of checklists) {
    const v = kmDaViagem(c);
    if (v == null) suspeitos++; else km += v;
  }
  return { km: Math.round(km), viagens_com_km_suspeito: suspeitos };
}
