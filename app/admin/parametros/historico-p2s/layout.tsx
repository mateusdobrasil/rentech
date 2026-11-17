// "Avançar agora" importa meses do histórico do P2S (até ~4 min) — as Server
// Actions desta página herdam este limite.
export const maxDuration = 300;

export default function HistoricoP2sLayout({ children }: { children: React.ReactNode }) {
  return children;
}
