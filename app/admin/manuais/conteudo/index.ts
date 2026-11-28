// GERADO por scripts/gerar-manuais.mts — não editar à mão.
export type ConteudoManual = { html: string | null; sumario: { id: string; texto: string }[]; pdf: string | null };
export const CONTEUDO: Record<string, () => Promise<ConteudoManual>> = {
  "locacao": () => import("./locacao"),
  "cadastros": () => import("./cadastros"),
  "parceiros": () => import("./parceiros"),
  "relatorios": () => import("./relatorios"),
  "inventario-estoque": () => import("./inventario-estoque"),
  "inventario-virada": () => import("./inventario-virada"),
  "suporte-chamados": () => import("./suporte-chamados"),
  "diretor-ia": () => import("./diretor-ia"),
  "ponto-whatsapp": () => import("./ponto-whatsapp"),
  "feriados": () => import("./feriados"),
  "decimo-terceiro": () => import("./decimo-terceiro"),
  "roteiro-testes-locacao": () => import("./roteiro-testes-locacao"),
  "integracao-p2s": () => import("./integracao-p2s"),
  "emissor-fiscal": () => import("./emissor-fiscal"),
  "ponto-whatsapp-2026-07": () => import("./ponto-whatsapp-2026-07"),
  "rentech-web-2026-07": () => import("./rentech-web-2026-07"),
};
