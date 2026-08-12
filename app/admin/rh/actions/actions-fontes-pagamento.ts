'use server';

// app/admin/rh/actions/actions-fontes-pagamento.ts
// Resolve o que cada funcionário recebe (fechamento e/ou holerite) aplicando a
// hierarquia: Contrato (base) → Cargo (sobrescreve) → Ficha (sobrescreve tudo).
// Cada nível usa 3 estados: true (recebe), false (não), null (herda de cima).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

export interface FontesResolvidas {
  recebeFechamento: boolean;
  recebeHolerite: boolean;
  // De onde veio cada decisão (para exibir/depurar): CONTRATO | CARGO | FICHA
  origemFechamento: string;
  origemHolerite: string;
}

// Aplica a hierarquia para um único interruptor (ex: recebe_fechamento).
// Percorre do mais específico ao mais geral e usa o primeiro valor não-nulo.
function resolverInterruptor(
  ficha: boolean | null | undefined,
  cargo: boolean | null | undefined,
  contrato: boolean | null | undefined
): { valor: boolean; origem: string } {
  if (ficha !== null && ficha !== undefined) return { valor: ficha, origem: 'FICHA' };
  if (cargo !== null && cargo !== undefined) return { valor: cargo, origem: 'CARGO' };
  if (contrato !== null && contrato !== undefined) return { valor: contrato, origem: 'CONTRATO' };
  return { valor: true, origem: 'PADRÃO' }; // nada definido → padrão recebe
}

// Resolve as fontes para um conjunto de funcionários de uma vez.
// Retorna um mapa { nome: FontesResolvidas }.
export async function resolverFontesPagamento(
  db: ReturnType<typeof supabaseAdmin>,
  nomes: string[]
): Promise<Record<string, FontesResolvidas>> {
  if (nomes.length === 0) return {};

  // Helper: tenta a query com as colunas da hierarquia; se elas ainda não
  // existirem no banco, refaz sem elas (as regras caem no padrão "recebe tudo").
  const buscarComFallback = async (
    tabela: string, colBase: string, extras: string
  ): Promise<any[]> => {
    const full = await db.from(tabela).select(`${colBase}, ${extras}`);
    if (!full.error) return full.data || [];
    const basic = await db.from(tabela).select(colBase);
    return basic.data || [];
  };

  // Fichas dos funcionários (com cargo, contrato e overrides da ficha)
  const funcsRes = await db.from('folha_funcionarios')
    .select('nome_completo, cargo, tipo_contrato, recebe_fechamento, recebe_holerite')
    .in('nome_completo', nomes);
  const funcs: any[] = funcsRes.error
    ? ((await db.from('folha_funcionarios').select('nome_completo, cargo, tipo_contrato').in('nome_completo', nomes)).data || [])
    : (funcsRes.data || []);

  // Cargos (catálogo folha_cargo) e contratos (folha_parametros)
  const cargos = await buscarComFallback('folha_cargo', 'nome', 'recebe_fechamento, recebe_holerite');
  const contratos = await buscarComFallback('folha_parametros', 'nome_regra', 'recebe_fechamento, recebe_holerite');

  const cargoPorNome: Record<string, any> = {};
  (cargos || []).forEach((c: any) => { cargoPorNome[c.nome] = c; });
  const contratoPorNome: Record<string, any> = {};
  (contratos || []).forEach((c: any) => { contratoPorNome[c.nome_regra] = c; });

  const resultado: Record<string, FontesResolvidas> = {};
  (funcs || []).forEach((f: any) => {
    const cargo = cargoPorNome[f.cargo] || {};
    const contrato = contratoPorNome[f.tipo_contrato] || {};

    // Colunas da hierarquia podem não existir (fallback) → tratadas como null
    const fFech = f.recebe_fechamento ?? null;
    const fHol = f.recebe_holerite ?? null;
    const fech = resolverInterruptor(fFech, cargo.recebe_fechamento, contrato.recebe_fechamento);
    const hol = resolverInterruptor(fHol, cargo.recebe_holerite, contrato.recebe_holerite);

    resultado[f.nome_completo] = {
      recebeFechamento: fech.valor,
      recebeHolerite: hol.valor,
      origemFechamento: fech.origem,
      origemHolerite: hol.origem
    };
  });

  return resultado;
}

// Versão action (para chamar da tela e conferir a resolução de todos os ativos)
export async function listarResolucaoFontesAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/rh/parametros');
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: funcs } = await db.from('folha_funcionarios')
      .select('nome_completo, cargo, tipo_contrato').eq('ativo', true).order('nome_completo');
    const nomes = (funcs || []).map((f: any) => f.nome_completo);
    const resolucao = await resolverFontesPagamento(db, nomes);

    const linhas = (funcs || []).map((f: any) => ({
      nome: f.nome_completo, cargo: f.cargo, contrato: f.tipo_contrato,
      ...resolucao[f.nome_completo]
    }));
    return { ok: true, info: { linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}