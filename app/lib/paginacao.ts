// Busca paginada no Supabase. A Data API devolve no máximo 1.000 linhas por
// chamada e CORTA O RESTO SEM AVISAR — já escondeu batidas no registro legal
// do ponto (ago/set-2026 tiveram ~1.200 batidas no mês) e OPs no relatório
// financeiro. Use em toda leitura que pode passar de 1.000 linhas.
//
// `montar(de, ate)` precisa criar a consulta do zero a cada página (o builder
// do Supabase só executa uma vez) e terminar com `.order(<coluna única>)` +
// `.range(de, ate)` — sem ordem estável, a paginação pode pular ou repetir linha.
// Serve no servidor (supabaseAdmin) e no navegador (supabase).
export async function buscarTodasPaginas<T = any>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: any }>,
  tamanhoPagina = 1000,
  limite = 50000
): Promise<{ data: T[]; error: any }> {
  const todas: T[] = [];
  for (let de = 0; de < limite; de += tamanhoPagina) {
    const { data, error } = await montar(de, de + tamanhoPagina - 1);
    if (error) return { data: todas, error };
    todas.push(...(data || []));
    if (!data || data.length < tamanhoPagina) break;
  }
  return { data: todas, error: null };
}
