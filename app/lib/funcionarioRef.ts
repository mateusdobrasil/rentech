// app/lib/funcionarioRef.ts
// Fase 2 do vínculo por ID (ver .sql/.../funcionario_id_fase1.sql): quem tem o
// ID do funcionário passa a filtrar por ele; quem só tem o nome continua
// funcionando igual. As funções que recebem "o funcionário" aceitam as duas
// formas — RefFuncionario (com ID) ou só o nome (string) — pra migrar os
// chamadores aos poucos sem quebrar nenhum.
//
// Tabelas com funcionario_id: as 20 da fase 1. NÃO usar nas tabelas legais do
// ponto (folha_ponto_whatsapp_registros / _ajustes) — lá é sempre pelo nome.

export interface RefFuncionario {
  funcionarioId?: string | null;
  funcionarioNome: string;
}
export type RefOuNome = RefFuncionario | string;

export const comoRef = (r: RefOuNome): RefFuncionario =>
  typeof r === 'string' ? { funcionarioNome: r } : r;

// Filtro numa tabela com funcionario_id / funcionario_nome.
export function filtrarPorFuncionario<T>(consulta: T, r: RefOuNome): T {
  const ref = comoRef(r);
  return ref.funcionarioId
    ? (consulta as any).eq('funcionario_id', ref.funcionarioId)
    : (consulta as any).eq('funcionario_nome', ref.funcionarioNome);
}

// Filtro na própria ficha (folha_funcionarios).
export function filtrarFicha<T>(consulta: T, r: RefOuNome): T {
  const ref = comoRef(r);
  return ref.funcionarioId
    ? (consulta as any).eq('id', ref.funcionarioId)
    : (consulta as any).eq('nome_completo', ref.funcionarioNome);
}

// O registro (com funcionario_id/funcionario_nome) é deste funcionário?
export function pertenceAo(linha: { funcionario_id?: string | null; funcionario_nome?: string | null }, r: RefOuNome): boolean {
  const ref = comoRef(r);
  if (ref.funcionarioId && linha.funcionario_id) return linha.funcionario_id === ref.funcionarioId;
  return linha.funcionario_nome === ref.funcionarioNome;
}
