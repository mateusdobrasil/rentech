// "Importar histórico" traz as fichas do P2S mês a mês (uma chamada por mês,
// cada uma pode levar mais de um minuto) — as actions herdam este limite.
export const maxDuration = 300;

export default function IndicadoresLayout({ children }: { children: React.ReactNode }) {
  return children;
}
