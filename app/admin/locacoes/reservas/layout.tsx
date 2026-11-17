// "Importar do P2S" lê as fichas da janela (consulta única, mas o P2S é
// on-premise e pode demorar) — as Server Actions desta rota herdam o limite.
export const maxDuration = 300;

export default function ReservasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
