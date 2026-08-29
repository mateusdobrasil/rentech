// Opções do campo "Tipo" do contexto de local (escala_locais_dia.tipo) —
// compartilhado entre a página (select) e o gerador de imagem exportável,
// pra não duplicar os rótulos em dois lugares.
export const TIPO_OPCOES: { valor: string; rotulo: string }[] = [
  { valor: 'MONTAGEM', rotulo: '🔧 Montagem' },
  { valor: 'DESMONTAGEM', rotulo: '📤 Desmontagem' },
  { valor: 'VISITA_TECNICA', rotulo: '🔍 Visita Técnica' },
  { valor: 'PRE_MONTAGEM', rotulo: '🏗️ Pré-montagem' },
  { valor: 'DEVOLUCAO', rotulo: '↩️ Devolução' },
];

export const tipoRotulo = (valor: string | null | undefined): string =>
  TIPO_OPCOES.find(t => t.valor === valor)?.rotulo || valor || '';
