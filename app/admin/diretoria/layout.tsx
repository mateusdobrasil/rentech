// "Gerar agora" calcula os indicadores e espera a IA escrever o relatório
// (~1–2 min) — as Server Actions desta página herdam este limite (ver
// node_modules/next/dist/docs/.../route-segment-config/maxDuration.md).
export const maxDuration = 300;

export default function DiretoriaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
