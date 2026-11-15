// "Sincronizar agora" lê ~3.000 títulos do PrimeStart (~1 min) — as Server
// Actions desta página herdam este limite (ver
// node_modules/next/dist/docs/.../route-segment-config/maxDuration.md).
export const maxDuration = 300;

export default function ContasReceberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
