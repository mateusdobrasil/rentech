// A busca de feriados com IA (botão "Buscar feriados do ano", aba Feriados)
// pesquisa leis estaduais e municipais na internet e pode levar 1 a 2 minutos
// — as Server Actions desta página herdam este limite (mesmo padrão de
// app/admin/operacional/multas/layout.tsx).
export const maxDuration = 300;

export default function ParametrosRhLayout({ children }: { children: React.ReactNode }) {
  return children;
}
