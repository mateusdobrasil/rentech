'use server';

// app/admin/rh/actions/actions-fontes-pagamento.ts
// Resolve o que cada funcionário recebe (fechamento e/ou holerite) aplicando a
// hierarquia: Contrato (base) → Cargo (sobrescreve) → Ficha (sobrescreve tudo).
// Cada nível usa 3 estados: true (recebe), false (não), null (herda de cima).
import { supabaseAdmin } from '../../../lib/supabase';

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

  // Fichas dos funcionários (com cargo, contrato e overrides da ficha)
  const { data: funcs } = await db.from('folha_funcionarios')
    .select('nome_completo, cargo, tipo_contrato, recebe_fechamento, recebe_holerite')
    .in('nome_completo', nomes);

  // Cargos (catálogo folha_cargo) e contratos (folha_parametros)
  const { data: cargos } = await db.from('folha_cargo')
    .select('nome, recebe_fechamento, recebe_holerite');
  const { data: contratos } = await db.from('folha_parametros')
    .select('nome_regra, recebe_fechamento, recebe_holerite');

  const cargoPorNome: Record<string, any> = {};
  (cargos || []).forEach(c => { cargoPorNome[c.nome] = c; });
  const contratoPorNome: Record<string, any> = {};
  (contratos || []).forEach(c => { contratoPorNome[c.nome_regra] = c; });

  const resultado: Record<string, FontesResolvidas> = {};
  (funcs || []).forEach(f => {
    const cargo = cargoPorNome[f.cargo] || {};
    const contrato = contratoPorNome[f.tipo_contrato] || {};

    const fech = resolverInterruptor(f.recebe_fechamento, cargo.recebe_fechamento, contrato.recebe_fechamento);
    const hol = resolverInterruptor(f.recebe_holerite, cargo.recebe_holerite, contrato.recebe_holerite);

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
export async function listarResolucaoFontesAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: funcs } = await db.from('folha_funcionarios')
      .select('nome_completo, cargo, tipo_contrato').eq('ativo', true).order('nome_completo');
    const nomes = (funcs || []).map(f => f.nome_completo);
    const resolucao = await resolverFontesPagamento(db, nomes);

    const linhas = (funcs || []).map(f => ({
      nome: f.nome_completo, cargo: f.cargo, contrato: f.tipo_contrato,
      ...resolucao[f.nome_completo]
    }));
    return { ok: true, info: { linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}