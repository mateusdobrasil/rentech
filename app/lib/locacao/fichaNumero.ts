// app/lib/locacao/fichaNumero.ts
// Número de exibição da Ficha de Reserva — um lugar só (antes copiado em 6+
// arquivos). Ficha criada no sistema: "FR-00012"; importada do P2S:
// "P2S 027866". Exceção deliberada: a Expedição usa o nº do P2S SEM prefixo,
// para casar com os checklists antigos importados do texto de fichas_reserva.

export const numeroFichaPorId = (id: number) => `FR-${String(id).padStart(5, '0')}`;

export function numeroFicha(f: { id: number; origem?: string | null; p2s_numero?: string | null }): string {
  return f.origem === 'P2S' && f.p2s_numero ? `P2S ${f.p2s_numero}` : numeroFichaPorId(f.id);
}
