// "Carga de saldos do P2S" consulta as movimentações de ~370 produtos (~10 s,
// mas depende do P2S) — as Server Actions desta página herdam este limite
// (ver node_modules/next/dist/docs/.../route-segment-config/maxDuration.md).
export const maxDuration = 300;

export default function EquipamentosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
