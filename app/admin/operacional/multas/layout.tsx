// A consulta à Infosimples (DETRAN/SP) pode levar alguns minutos quando o
// site do Detran está lento — as Server Actions desta página herdam este
// limite (ver node_modules/next/dist/docs/.../route-segment-config/maxDuration.md).
export const maxDuration = 300;

export default function MultasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
