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
}

export interface PrecoSugerido { valor_unitario: number | null; origem: OrigemPreco | null; motivo?: string }

export async function precificarItens(
  db: Db,
  args: { empresaId: number; parceiroId?: number | null; eventoId?: string | null; dataRef: string; modalidade: Modalidade; itens: { chave: string; produto_id: number; dias: number }[] }
): Promise<{ tabelas: { id: number; nome: string; tipo: string }[]; precos: Record<string, PrecoSugerido> }> {
  const { data: tabs, error } = await db.from('locacao_tabelas_preco')
    .select('id, nome, tipo, empresa_id, parceiro_id, evento_id, vigencia_inicio, vigencia_fim, ativa')
    .eq('empresa_id', args.empresaId).eq('ativa', true);
  if (error) throw error;
  const ordenadas = ordenarTabelasAplicaveis((tabs || []) as (TabelaPrecoResumo & { nome: string })[], {
    empresaId: args.empresaId, parceiroId: args.parceiroId, eventoId: args.eventoId, dataISO: args.dataRef,
  });

  const precos: Record<string, PrecoSugerido> = {};
  const produtoIds = [...new Set(args.itens.map(i => i.produto_id))];
  if (!ordenadas.length || !produtoIds.length) {
    for (const i of args.itens) precos[i.chave] = { valor_unitario: null, origem: null, motivo: 'Nenhuma tabela de preço ativa e vigente para esta empresa.' };
    return { tabelas: [], precos };
  }

  // tabela → produto → { faixas, extra, mensal }
  const dados = new Map<number, Map<number, { faixas: { dias: number; valor_diaria: number }[]; extra: number | null; mensal: number | null }>>();
  for (let i = 0; i < produtoIds.length; i += 150) {
    const { data, error: e2 } = await buscarTodasPaginas<any>((de, ate) => db.from('locacao_tabela_produtos')
      .select('tabela_id, produto_id, valor_diaria_extra, valor_mensal, faixas:locacao_tabela_faixas(dias, valor_diaria)')
      .in('tabela_id', ordenadas.map(t => t.id)).in('produto_id', produtoIds.slice(i, i + 150)).order('id').range(de, ate));
    if (e2) throw e2;
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

  for (const item of args.itens) {
    const dias = Math.max(1, Math.floor(item.dias || 1));
    let achou: PrecoSugerido | null = null;
    let estavaEmAlguma = false;
    for (const t of ordenadas) {
      const d = dados.get(t.id)?.get(item.produto_id);
      if (!d) continue;
      estavaEmAlguma = true;
      const base = { tabela_id: t.id, tabela_nome: t.nome, tabela_tipo: t.tipo, modalidade: args.modalidade, dias };
      if (args.modalidade === 'MENSAL') {
        if (d.mensal === null) continue;
        const meses = mesesCobrados(dias);
        achou = { valor_unitario: Math.round(d.mensal * meses * 100) / 100, origem: { ...base, meses, valor_mensal: d.mensal } };
        break;
      }
      const c = calcularPrecoPorFaixas(d.faixas, d.extra, dias);
      if (!c) continue;
      achou = {
        valor_unitario: c.total,
        origem: { ...base, faixa_dias: c.faixaDias, valor_diaria_faixa: c.valorDiariaFaixa, dias_extra: c.diasExtra, valor_diaria_extra: c.valorDiariaExtra, extra_pela_faixa: c.extraPelaFaixa },
      };
      break;
    }
    precos[item.chave] = achou || {
      valor_unitario: null, origem: null,
      motivo: !estavaEmAlguma ? 'Produto fora das tabelas de preço aplicáveis.'
        : args.modalidade === 'MENSAL' ? 'Sem valor mensal cadastrado.' : `Sem faixa de até ${dias} dia(s) nas tabelas.`,
    };
  }

  return { tabelas: ordenadas.map(t => ({ id: t.id, nome: t.nome, tipo: t.tipo })), precos };
}
