// app/lib/locacao/indicadores.ts
// Indicadores de utilização dos equipamentos (2026-11-17). Só servidor.
//
// Base: fichas CONFIRMADAS (aprovada, reservada, em locação, finalizada) que
// cruzam o período — as importadas do P2S e as criadas aqui. Por item de
// equipamento/kit (com produto):
//   dias-unidade locados = quantidade × dias da ficha dentro do período
//   receita              = valor do item × (dias no período ÷ dias da ficha)  (pró-rata)
// Utilização = dias-unidade locados ÷ (estoque × dias do período).
// O estoque é o ATUAL (saldo − manutenção, ou patrimônios ativos) — uma
// aproximação para períodos longos se o estoque mudou.
// Limite: itens do P2S têm datas próprias, mas aqui vale o período da ficha.
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { diasInclusivos } from './datas';
import { capacidadePorProduto } from './disponibilidade';

type Db = ReturnType<typeof supabaseAdmin>;
const CONFIRMADAS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];

export interface LinhaUtilizacao {
  produto_id: number;
  nome: string;
  codigo: string | null;
  categoria: string | null;
  estoque: number;
  locacoes: number;             // fichas distintas
  diasUnidade: number;
  utilizacao: number | null;    // 0..1+ (null sem estoque)
  receita: number;
  receitaPorUnidade: number | null;
  valorUnitario: number | null; // custo de reposição (ou indenização)
  retornoSobreEstoque: number | null; // receita ÷ (estoque × valor unitário)
}

export async function calcularUtilizacao(db: Db, empresaId: number, inicio: string, fim: string) {
  const diasPeriodo = diasInclusivos(inicio, fim);

  const { data: fichas, error } = await buscarTodasPaginas<any>((de, ate) => db.from('locacao_fichas_reserva')
    .select('id, data_inicio, data_fim').eq('empresa_id', empresaId).in('status', CONFIRMADAS)
    .lte('data_inicio', fim).gte('data_fim', inicio).order('id').range(de, ate));
  if (error) throw error;

  const porFicha = new Map<number, { dentro: number; total: number }>();
  for (const f of fichas) {
    const ini = f.data_inicio > inicio ? f.data_inicio : inicio;
    const fi = f.data_fim < fim ? f.data_fim : fim;
    porFicha.set(f.id, { dentro: Math.max(0, diasInclusivos(ini, fi)), total: Math.max(1, diasInclusivos(f.data_inicio, f.data_fim)) });
  }

  const uso = new Map<number, { fichas: Set<number>; diasUnidade: number; receita: number }>();
  const ids = [...porFicha.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: itens, error: eI } = await buscarTodasPaginas<any>((de, ate) => db.from('locacao_fichas_reserva_itens')
      .select('id, ficha_id, produto_id, quantidade, valor_total').in('ficha_id', ids.slice(i, i + 200))
      .in('tipo', ['EQUIPAMENTO', 'KIT']).not('produto_id', 'is', null).order('id').range(de, ate));
    if (eI) throw eI;
    for (const it of itens) {
      const pf = porFicha.get(it.ficha_id)!;
      const u = uso.get(it.produto_id) || { fichas: new Set<number>(), diasUnidade: 0, receita: 0 };
      u.fichas.add(it.ficha_id);
      u.diasUnidade += Number(it.quantidade) * pf.dentro;
      u.receita += Number(it.valor_total || 0) * (pf.dentro / pf.total);
      uso.set(it.produto_id, u);
    }
  }

  // produtos com estoque na empresa (entram mesmo sem uso — são os ociosos)
  const [rS, rP] = await Promise.all([
    buscarTodasPaginas<any>((de, ate) => db.from('locacao_saldos').select('produto_id').eq('empresa_id', empresaId).gt('quantidade_total', 0).order('id').range(de, ate)),
    buscarTodasPaginas<any>((de, ate) => db.from('locacao_patrimonios').select('produto_id').eq('empresa_id', empresaId).eq('situacao', 'ATIVO').order('id').range(de, ate)),
  ]);
  const todos = [...new Set([...uso.keys(), ...rS.data.map(x => x.produto_id), ...rP.data.map(x => x.produto_id)])];
  const cap = await capacidadePorProduto(db, empresaId, todos);

  const info = new Map<number, any>();
  for (let i = 0; i < todos.length; i += 300) {
    const { data } = await db.from('produtos').select('id, nome_item, codigo_formatado, categoria_nome, custo_reposicao, valor_indenizacao')
      .in('id', todos.slice(i, i + 300));
    for (const p of data || []) info.set(p.id, p);
  }

  const linhas: LinhaUtilizacao[] = todos.map(id => {
    const p = info.get(id) || {};
    const u = uso.get(id);
    const estoque = cap.get(id) || 0;
    const diasUnidade = u?.diasUnidade || 0;
    const receita = Math.round((u?.receita || 0) * 100) / 100;
    const valorUnit = Number(p.custo_reposicao) > 0 ? Number(p.custo_reposicao) : Number(p.valor_indenizacao) > 0 ? Number(p.valor_indenizacao) : null;
    return {
      produto_id: id, nome: p.nome_item || `Produto #${id}`, codigo: p.codigo_formatado || null, categoria: p.categoria_nome || null,
      estoque, locacoes: u?.fichas.size || 0, diasUnidade,
      utilizacao: estoque > 0 ? diasUnidade / (estoque * diasPeriodo) : null,
      receita, receitaPorUnidade: estoque > 0 ? receita / estoque : null,
      valorUnitario: valorUnit,
      retornoSobreEstoque: estoque > 0 && valorUnit ? receita / (estoque * valorUnit) : null,
    };
  });

  // cobertura do histórico importado (ficha confirmada mais antiga da empresa)
  const { data: maisAntiga } = await db.from('locacao_fichas_reserva').select('data_inicio')
    .eq('empresa_id', empresaId).in('status', CONFIRMADAS).order('data_inicio').limit(1).maybeSingle();

  return { diasPeriodo, fichasNoPeriodo: fichas.length, linhas, historicoDesde: maisAntiga?.data_inicio || null };
}
