// app/lib/locacao/precificacao.ts
// Preço sugerido dos itens de uma ficha (servidor). Escolhe as tabelas
// aplicáveis (evento > cliente > padrão, vigentes na data de início — ver
// ordenarTabelasAplicaveis) e, para cada produto, usa a PRIMEIRA tabela que
// consegue precificá-lo; se o produto não está nela (ou não tem faixa até N
// dias / valor mensal), cai na próxima.
//   DIARIA e PERIODO → faixas de dias (calcularPrecoPorFaixas)
//   MENSAL          → valor mensal × meses (cada 30 dias ou fração)
// O valor devolvido é o UNITÁRIO para o período inteiro (total do item =
// quantidade × unitário − desconto).
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { calcularPrecoPorFaixas, ordenarTabelasAplicaveis, type TabelaPrecoResumo } from './preco';
import { mesesCobrados } from './datas';

type Db = ReturnType<typeof supabaseAdmin>;
export type Modalidade = 'DIARIA' | 'PERIODO' | 'MENSAL';

export interface OrigemPreco {
  tabela_id: number;
  tabela_nome: string;
  tabela_tipo: string;
  modalidade: Modalidade;
  dias: number;
  faixa_dias?: number;
  valor_diaria_faixa?: number;
  dias_extra?: number;
  valor_diaria_extra?: number;
  extra_pela_faixa?: boolean;
  meses?: number;
  valor_mensal?: number;
  /** valor do período pela tabela — referência do limite de desconto quando o vendedor muda o preço */
  valor_tabela?: number;
}

export interface PrecoSugerido { valor_unitario: number | null; origem: OrigemPreco | null; motivo?: string }

type TabelaOrdenada = TabelaPrecoResumo & { nome: string };
type DadosProduto = { faixas: { dias: number; valor_diaria: number }[]; extra: number | null; mensal: number | null };
/** tabela → produto → { faixas, extra, mensal } */
type DadosTabelas = Map<number, Map<number, DadosProduto>>;

const COLUNAS_TABELA = 'id, nome, tipo, empresa_id, parceiro_id, evento_id, vigencia_inicio, vigencia_fim, ativa';

async function carregarDadosTabelas(db: Db, tabelaIds: number[], produtoIds: number[]): Promise<DadosTabelas> {
  const dados: DadosTabelas = new Map();
  if (!tabelaIds.length || !produtoIds.length) return dados;
  for (let i = 0; i < produtoIds.length; i += 150) {
    const { data, error } = await buscarTodasPaginas<any>((de, ate) => db.from('locacao_tabela_produtos')
      .select('tabela_id, produto_id, valor_diaria_extra, valor_mensal, faixas:locacao_tabela_faixas(dias, valor_diaria)')
      .in('tabela_id', tabelaIds).in('produto_id', produtoIds.slice(i, i + 150)).order('id').range(de, ate));
    if (error) throw error;
    for (const r of data) {
      const porProd = dados.get(r.tabela_id) || new Map();
      porProd.set(r.produto_id, {
        faixas: (r.faixas || []).map((f: any) => ({ dias: Number(f.dias), valor_diaria: Number(f.valor_diaria) })),
        extra: r.valor_diaria_extra === null ? null : Number(r.valor_diaria_extra),
        mensal: r.valor_mensal === null ? null : Number(r.valor_mensal),
      });
      dados.set(r.tabela_id, porProd);
    }
  }
  return dados;
}

/** Preço de UM item: a primeira tabela (na ordem de prioridade) que consegue precificá-lo. */
function precoDoItem(ordenadas: TabelaOrdenada[], dados: DadosTabelas, produtoId: number, diasItem: number, modalidade: Modalidade): PrecoSugerido {
  const dias = Math.max(1, Math.floor(diasItem || 1));
  let estavaEmAlguma = false;
  for (const t of ordenadas) {
    const d = dados.get(t.id)?.get(produtoId);
    if (!d) continue;
    estavaEmAlguma = true;
    const base = { tabela_id: t.id, tabela_nome: t.nome, tabela_tipo: t.tipo, modalidade, dias };
    if (modalidade === 'MENSAL') {
      if (d.mensal === null) continue;
      const meses = mesesCobrados(dias);
      const v = Math.round(d.mensal * meses * 100) / 100;
      return { valor_unitario: v, origem: { ...base, meses, valor_mensal: d.mensal, valor_tabela: v } };
    }
    const c = calcularPrecoPorFaixas(d.faixas, d.extra, dias);
    if (!c) continue;
    return {
      valor_unitario: c.total,
      origem: { ...base, faixa_dias: c.faixaDias, valor_diaria_faixa: c.valorDiariaFaixa, dias_extra: c.diasExtra, valor_diaria_extra: c.valorDiariaExtra, extra_pela_faixa: c.extraPelaFaixa, valor_tabela: c.total },
    };
  }
  return {
    valor_unitario: null, origem: null,
    motivo: !estavaEmAlguma ? 'Produto fora das tabelas de preço aplicáveis.'
      : modalidade === 'MENSAL' ? 'Sem valor mensal cadastrado.' : `Sem faixa de até ${dias} dia(s) nas tabelas.`,
  };
}

export async function precificarItens(
  db: Db,
  args: { empresaId: number; parceiroId?: number | null; eventoId?: string | null; dataRef: string; modalidade: Modalidade; itens: { chave: string; produto_id: number; dias: number }[] }
): Promise<{ tabelas: { id: number; nome: string; tipo: string }[]; precos: Record<string, PrecoSugerido> }> {
  const { data: tabs, error } = await db.from('locacao_tabelas_preco').select(COLUNAS_TABELA).eq('empresa_id', args.empresaId).eq('ativa', true);
  if (error) throw error;
  const ordenadas = ordenarTabelasAplicaveis((tabs || []) as TabelaOrdenada[], {
    empresaId: args.empresaId, parceiroId: args.parceiroId, eventoId: args.eventoId, dataISO: args.dataRef,
  });

  const precos: Record<string, PrecoSugerido> = {};
  const produtoIds = [...new Set(args.itens.map(i => i.produto_id))];
  if (!ordenadas.length || !produtoIds.length) {
    for (const i of args.itens) precos[i.chave] = { valor_unitario: null, origem: null, motivo: 'Nenhuma tabela de preço ativa e vigente para esta empresa.' };
    return { tabelas: [], precos };
  }
  const dados = await carregarDadosTabelas(db, ordenadas.map(t => t.id), produtoIds);
  for (const item of args.itens) precos[item.chave] = precoDoItem(ordenadas, dados, item.produto_id, item.dias, args.modalidade);
  return { tabelas: ordenadas.map(t => ({ id: t.id, nome: t.nome, tipo: t.tipo })), precos };
}

/**
 * Valor de tabela de vários itens de VÁRIAS fichas com poucas consultas
 * (todas as tabelas ativas + preços dos produtos envolvidos de uma vez).
 * Usado no cálculo de comissão das fichas importadas do P2S.
 * Resultado: chave da ficha → valor unitário de tabela por índice do item (null = sem preço).
 */
export async function valoresTabelaLote(
  db: Db,
  fichas: { chave: string; empresaId: number; parceiroId?: number | null; eventoId?: string | null; dataRef: string; modalidade: Modalidade; itens: { produto_id: number; dias: number }[] }[]
): Promise<Map<string, (number | null)[]>> {
  const out = new Map<string, (number | null)[]>();
  if (!fichas.length) return out;
  const { data: tabs, error } = await db.from('locacao_tabelas_preco').select(COLUNAS_TABELA).eq('ativa', true);
  if (error) throw error;
  const todas = (tabs || []) as TabelaOrdenada[];
  const ordenadasPorFicha = new Map(fichas.map(f => [f.chave, ordenarTabelasAplicaveis(todas, { empresaId: f.empresaId, parceiroId: f.parceiroId, eventoId: f.eventoId, dataISO: f.dataRef })]));
  const tabelaIds = [...new Set([...ordenadasPorFicha.values()].flatMap(o => o.map(t => t.id)))];
  const produtoIds = [...new Set(fichas.flatMap(f => f.itens.map(i => i.produto_id)))];
  const dados = await carregarDadosTabelas(db, tabelaIds, produtoIds);
  for (const f of fichas) {
    const ordenadas = ordenadasPorFicha.get(f.chave) || [];
    out.set(f.chave, f.itens.map(i => precoDoItem(ordenadas, dados, i.produto_id, i.dias, f.modalidade).valor_unitario));
  }
  return out;
}
