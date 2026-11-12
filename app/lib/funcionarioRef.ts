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

// SERVIDOR: acha a ficha UMA vez — pelo ID quando a tela mandou, senão pelo
// nome — e devolve a referência com ID (e o nome ATUAL da ficha) pra action
// usar em todas as consultas/gravações seguintes. `colunas` = campos extras da
// ficha (ex.: 'empresa_id'). Ficha não encontrada → ref só com o nome recebido
// e ficha null (mesmo comportamento de antes, quando tudo era pelo nome).
export async function resolverFicha<T extends Record<string, any> = Record<string, any>>(
  db: any,
  quem: { funcionarioId?: string | null; funcionarioNome?: string | null },
  colunas = 'empresa_id'
): Promise<{ ref: RefFuncionario; ficha: (T & { id: string; nome_completo: string }) | null }> {
  const sel = `id, nome_completo${colunas ? ', ' + colunas : ''}`;
  let q = db.from('folha_funcionarios').select(sel);
  q = quem.funcionarioId ? q.eq('id', quem.funcionarioId) : q.eq('nome_completo', quem.funcionarioNome || '');
  const { data } = await q.maybeSingle();
  if (!data) return { ref: { funcionarioId: null, funcionarioNome: quem.funcionarioNome || '' }, ficha: null };
  return { ref: { funcionarioId: data.id, funcionarioNome: data.nome_completo }, ficha: data };
}

// Campos de vínculo pra gravar num registro novo (nome atual + ID quando houver)
export const camposVinculo = (r: RefFuncionario) => ({
  funcionario_nome: r.funcionarioNome,
  ...(r.funcionarioId ? { funcionario_id: r.funcionarioId } : {}),
});

// O registro (com funcionario_id/funcionario_nome) é deste funcionário?
export function pertenceAo(linha: { funcionario_id?: string | null; funcionario_nome?: string | null }, r: RefOuNome): boolean {
  const ref = comoRef(r);
  if (ref.funcionarioId && linha.funcionario_id) return linha.funcionario_id === ref.funcionarioId;
  return linha.funcionario_nome === ref.funcionarioNome;
}
