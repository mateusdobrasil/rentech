// app/lib/locacao/disponibilidade.ts
// Disponibilidade e reserva de equipamentos (Fase 1 da substituição do P2S,
// 2026-11-16). Só servidor (usa o client service_role passado por quem chama).
//
// CAPACIDADE por empresa:
//   INDIVIDUAL → patrimônios ATIVO do produto;
//   QUANTIDADE → soma de (total − manutenção) dos saldos do produto.
// OCUPAÇÃO: alocações RESERVADO/LOCADO que cruzam o período do item; vale o
//   PICO diário (duas reservas que não se cruzam no mesmo dia não somam).
// KITS: item de kit vira demanda dos componentes (qtd × qtd por kit,
//   recursivo até 3 níveis); componentes "opcionais" não são reservados.
// PERÍODO: datas da ficha ± dias de preparo/retorno de CADA produto
//   (app/lib/locacao/datas.ts → periodoAlocacao).
//
// Concorrência: patrimônio tem garantia no banco (EXCLUDE gist em
// locacao_alocacoes). Quantidade não — duas reservas simultâneas do último
// saldo podem passar; aceitável pelo volume atual (reavaliar com a agenda).
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { periodoAlocacao, lerDaterange, daterangeInclusivo, somarDias, type DatasFicha } from './datas';

type Db = ReturnType<typeof supabaseAdmin>;

export interface ItemDemanda { ficha_item_id?: number | null; produto_id: number; quantidade: number }

interface Parte { ficha_item_id: number | null; quantidade: number; kit_produto_id: number | null }
interface InfoProduto { id: number; nome: string; codigo: string | null; controle: 'INDIVIDUAL' | 'QUANTIDADE'; dias_preparo: number; dias_retorno: number }

export interface LinhaDisponibilidade {
  produto_id: number;
  nome: string;
  codigo: string | null;
  controle: 'INDIVIDUAL' | 'QUANTIDADE';
  periodo: { inicio: string; fim: string };
  demanda: number;
  capacidade: number;
  ocupado: number;
  disponivel: number;
  falta: number;
  viaKits: string[];
}

// DEVOLVIDO ocupa só até o fim do período, que na devolução vira data da
// devolução + dias de retorno (limpeza/teste) — ficha de locação própria.
const STATUS_ATIVOS = ['RESERVADO', 'LOCADO', 'DEVOLVIDO'];
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function carregarInfoProdutos(db: Db, ids: number[]): Promise<Map<number, InfoProduto>> {
  const mapa = new Map<number, InfoProduto>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('produtos')
      .select('id, nome_item, codigo_formatado, controle_locacao, dias_preparo, dias_retorno').in('id', ids.slice(i, i + 200));
    if (error) throw error;
    for (const p of data || []) mapa.set(p.id, {
      id: p.id, nome: p.nome_item, codigo: p.codigo_formatado,
      controle: p.controle_locacao === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'QUANTIDADE',
      dias_preparo: n(p.dias_preparo), dias_retorno: n(p.dias_retorno),
    });
  }
  return mapa;
}

/** Itens → demanda por produto físico (kits explodidos em componentes). */
export async function expandirKits(db: Db, itens: ItemDemanda[]): Promise<Map<number, Parte[]>> {
  const demanda = new Map<number, Parte[]>();
  const add = (produtoId: number, p: Parte) => demanda.set(produtoId, [...(demanda.get(produtoId) || []), p]);

  let pendentes = itens.filter(i => i.quantidade > 0).map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, ficha_item_id: i.ficha_item_id ?? null, kit: null as number | null }));
  for (let nivel = 0; nivel < 4 && pendentes.length; nivel++) {
    const ids = [...new Set(pendentes.map(p => p.produto_id))];
    const { data, error } = await db.from('locacao_kit_itens').select('kit_produto_id, componente_produto_id, quantidade, opcional').in('kit_produto_id', ids);
    if (error) throw error;
    const comps = new Map<number, { componente_produto_id: number; quantidade: number; opcional: boolean }[]>();
    for (const k of data || []) comps.set(k.kit_produto_id, [...(comps.get(k.kit_produto_id) || []), k]);

    const proximos: typeof pendentes = [];
    for (const p of pendentes) {
      const cs = comps.get(p.produto_id);
      if (!cs || nivel === 3) { add(p.produto_id, { ficha_item_id: p.ficha_item_id, quantidade: p.quantidade, kit_produto_id: p.kit }); continue; }
      for (const c of cs) {
        if (c.opcional) continue;
        proximos.push({ produto_id: c.componente_produto_id, quantidade: p.quantidade * n(c.quantidade), ficha_item_id: p.ficha_item_id, kit: p.kit ?? p.produto_id });
      }
    }
    pendentes = proximos;
  }
  return demanda;
}

async function capacidades(db: Db, empresaId: number, info: Map<number, InfoProduto>): Promise<Map<number, number>> {
  const cap = new Map<number, number>();
  const individuais = [...info.values()].filter(p => p.controle === 'INDIVIDUAL').map(p => p.id);
  const quantidade = [...info.values()].filter(p => p.controle === 'QUANTIDADE').map(p => p.id);
  for (let i = 0; i < individuais.length; i += 200) {
    const { data, error } = await db.from('locacao_patrimonios').select('produto_id')
      .eq('empresa_id', empresaId).eq('situacao', 'ATIVO').in('produto_id', individuais.slice(i, i + 200));
    if (error) throw error;
    for (const r of data || []) cap.set(r.produto_id, (cap.get(r.produto_id) || 0) + 1);
  }
  for (let i = 0; i < quantidade.length; i += 200) {
    const { data, error } = await db.from('locacao_saldos').select('produto_id, quantidade_total, quantidade_manutencao')
      .eq('empresa_id', empresaId).in('produto_id', quantidade.slice(i, i + 200));
    if (error) throw error;
    for (const r of data || []) cap.set(r.produto_id, (cap.get(r.produto_id) || 0) + Math.max(0, n(r.quantidade_total) - n(r.quantidade_manutencao)));
  }
  return cap;
}

interface AlocacaoAtiva { id: number; ficha_id: number; produto_id: number; patrimonio_id: number | null; quantidade: number; inicio: string; fim: string }

async function alocacoesAtivas(db: Db, empresaId: number, produtoIds: number[], inicio: string, fim: string, ignorarFichaId?: number | null): Promise<AlocacaoAtiva[]> {
  const out: AlocacaoAtiva[] = [];
  for (let i = 0; i < produtoIds.length; i += 200) {
    const lote = produtoIds.slice(i, i + 200);
    const { data, error } = await buscarTodasPaginas<any>((de, ate) => {
      let q = db.from('locacao_alocacoes').select('id, ficha_id, produto_id, patrimonio_id, quantidade, periodo')
        .eq('empresa_id', empresaId).in('status', STATUS_ATIVOS).in('produto_id', lote)
        .overlaps('periodo', daterangeInclusivo(inicio, fim));
      if (ignorarFichaId) q = q.neq('ficha_id', ignorarFichaId);
      return q.order('id').range(de, ate);
    });
    if (error) throw error;
    for (const a of data) {
      const p = lerDaterange(a.periodo);
      if (p) out.push({ id: a.id, ficha_id: a.ficha_id, produto_id: a.produto_id, patrimonio_id: a.patrimonio_id, quantidade: n(a.quantidade), inicio: p.inicio, fim: p.fim });
    }
  }
  return out;
}

/** Maior soma diária de quantidade das alocações dentro de [inicio, fim]. */
export function picoDiario(alocs: AlocacaoAtiva[], inicio: string, fim: string): number {
  if (!alocs.length) return 0;
  // varredura por eventos: +q no início, −q no dia seguinte ao fim
  const delta = new Map<string, number>();
  for (const a of alocs) {
    const ini = a.inicio > inicio ? a.inicio : inicio;
    const fimEf = a.fim < fim ? a.fim : fim;
    if (ini > fimEf) continue;
    delta.set(ini, (delta.get(ini) || 0) + a.quantidade);
    const depois = somarDias(fimEf, 1);
    delta.set(depois, (delta.get(depois) || 0) - a.quantidade);
  }
  let atual = 0, pico = 0;
  for (const d of [...delta.keys()].sort()) { atual += delta.get(d)!; if (atual > pico) pico = atual; }
  return pico;
}

export async function verificarDisponibilidade(
  db: Db,
  args: { empresaId: number; datas: DatasFicha; itens: ItemDemanda[]; ignorarFichaId?: number | null }
): Promise<{ linhas: LinhaDisponibilidade[]; temFalta: boolean; demanda: Map<number, Parte[]>; info: Map<number, InfoProduto> }> {
  const demanda = await expandirKits(db, args.itens);
  const ids = [...demanda.keys()];
  if (!ids.length) return { linhas: [], temFalta: false, demanda, info: new Map() };

  const kitIds = [...new Set([...demanda.values()].flat().map(p => p.kit_produto_id).filter((x): x is number => !!x))];
  const info = await carregarInfoProdutos(db, [...new Set([...ids, ...kitIds])]);
  const cap = await capacidades(db, args.empresaId, new Map(ids.filter(id => info.has(id)).map(id => [id, info.get(id)!])));

  const periodos = new Map(ids.map(id => {
    const p = info.get(id);
    return [id, periodoAlocacao(args.datas, p?.dias_preparo || 0, p?.dias_retorno || 0)];
  }));
  const minIni = [...periodos.values()].map(p => p.inicio).sort()[0];
  const maxFim = [...periodos.values()].map(p => p.fim).sort().reverse()[0];
  const alocs = await alocacoesAtivas(db, args.empresaId, ids, minIni, maxFim, args.ignorarFichaId);

  const linhas: LinhaDisponibilidade[] = ids.map(id => {
    const p = info.get(id);
    const periodo = periodos.get(id)!;
    const dem = demanda.get(id)!.reduce((s, x) => s + x.quantidade, 0);
    const capacidade = cap.get(id) || 0;
    const ocupado = picoDiario(alocs.filter(a => a.produto_id === id), periodo.inicio, periodo.fim);
    const disponivel = Math.max(0, capacidade - ocupado);
    const viaKits = [...new Set(demanda.get(id)!.map(x => x.kit_produto_id).filter((k): k is number => !!k))].map(k => info.get(k)?.nome || `Kit #${k}`);
    return {
      produto_id: id, nome: p?.nome || `Produto #${id}`, codigo: p?.codigo || null, controle: p?.controle || 'QUANTIDADE',
      periodo, demanda: dem, capacidade, ocupado, disponivel, falta: Math.max(0, dem - disponivel), viaKits,
    };
  }).sort((a, b) => (a.codigo || a.nome).localeCompare(b.codigo || b.nome, 'pt-BR', { numeric: true }));

  return { linhas, temFalta: linhas.some(l => l.falta > 0), demanda, info };
}

/**
 * Reserva (ou refaz a reserva de) uma ficha: confere a disponibilidade sem
 * contar a própria ficha e grava as alocações. Patrimônios são escolhidos
 * automaticamente entre os livres (os que já estavam nesta ficha primeiro,
 * depois por número). Se faltar algo, nada muda e a lista de faltas volta.
 */
export async function reservarFicha(db: Db, fichaId: number): Promise<{ ok: boolean; erro?: string; faltas?: LinhaDisponibilidade[] }> {
  const { data: ficha, error: eF } = await db.from('locacao_fichas_reserva')
    .select('id, empresa_id, data_saida, data_montagem, data_inicio, data_fim, data_desmontagem, data_retorno').eq('id', fichaId).single();
  if (eF) throw eF;
  const { data: itens, error: eI } = await db.from('locacao_fichas_reserva_itens')
    .select('id, tipo, produto_id, quantidade').eq('ficha_id', fichaId).in('tipo', ['EQUIPAMENTO', 'KIT']);
  if (eI) throw eI;

  const verif = await verificarDisponibilidade(db, {
    empresaId: ficha.empresa_id, datas: ficha, ignorarFichaId: fichaId,
    itens: (itens || []).filter(i => i.produto_id).map(i => ({ ficha_item_id: i.id, produto_id: i.produto_id, quantidade: n(i.quantidade) })),
  });
  if (verif.temFalta) return { ok: false, faltas: verif.linhas.filter(l => l.falta > 0) };

  for (const l of verif.linhas) {
    if (l.controle === 'INDIVIDUAL' && !Number.isInteger(l.demanda)) {
      return { ok: false, erro: `"${l.nome}" é controlado por patrimônio — a quantidade precisa ser um número inteiro.` };
    }
  }

  // Peças já reservadas por esta ficha têm preferência (estabilidade ao refazer)
  const { data: antigas, error: eA } = await db.from('locacao_alocacoes').select('patrimonio_id')
    .eq('ficha_id', fichaId).eq('status', 'RESERVADO');
  if (eA) throw eA;
  const patrimoniosAntigos = new Set((antigas || []).map(a => a.patrimonio_id).filter(Boolean));

  try {
    const m = await montarLinhas(db, ficha, verif, patrimoniosAntigos, fichaId);
    if ('erro' in m) return { ok: false, erro: m.erro };
    // Troca as alocações RESERVADO da ficha pelas novas numa TRANSAÇÃO só
    // (função SQL locacao_trocar_reserva): se a trava de patrimônio (EXCLUDE)
    // recusar alguma linha, nada muda e a reserva anterior continua valendo.
    const { error } = await db.rpc('locacao_trocar_reserva', { p_ficha_id: fichaId, p_novas: m.linhas });
    if (error) throw error;
    return { ok: true };
  } catch (e: any) {
    const msg = String(e.message || e);
    if (msg.includes('locacao_alocacoes_patrimonio_sem_conflito')) return { ok: false, erro: 'Outra reserva pegou uma das peças agora há pouco — a reserva anterior foi mantida. Tente de novo.' };
    return { ok: false, erro: msg };
  }
}

/**
 * Reserva SÓ os itens indicados, somando às alocações que a ficha já tem
 * (complemento /B de uma ficha em locação). As alocações atuais da própria
 * ficha contam como ocupadas — não são refeitas.
 */
export async function reservarItensAdicionais(db: Db, fichaId: number, itemIds: number[]): Promise<{ ok: boolean; erro?: string; faltas?: LinhaDisponibilidade[] }> {
  if (!itemIds.length) return { ok: true };
  const { data: ficha, error: eF } = await db.from('locacao_fichas_reserva')
    .select('id, empresa_id, data_saida, data_montagem, data_inicio, data_fim, data_desmontagem, data_retorno').eq('id', fichaId).single();
  if (eF) throw eF;
  const { data: itens, error: eI } = await db.from('locacao_fichas_reserva_itens')
    .select('id, tipo, produto_id, quantidade').eq('ficha_id', fichaId).in('id', itemIds).in('tipo', ['EQUIPAMENTO', 'KIT']);
  if (eI) throw eI;
  const verif = await verificarDisponibilidade(db, {
    empresaId: ficha.empresa_id, datas: ficha, ignorarFichaId: null,
    itens: (itens || []).filter(i => i.produto_id).map(i => ({ ficha_item_id: i.id, produto_id: i.produto_id, quantidade: n(i.quantidade) })),
  });
  if (verif.temFalta) return { ok: false, faltas: verif.linhas.filter(l => l.falta > 0) };
  try {
    const m = await montarLinhas(db, ficha, verif, new Set(), null);
    if ('erro' in m) return { ok: false, erro: m.erro };
    if (m.linhas.length) {
      const { error } = await db.from('locacao_alocacoes').insert(m.linhas.map(l => ({ ...l, ficha_id: fichaId, status: 'RESERVADO' })));
      if (error) throw error;
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e.message || e);
    if (msg.includes('locacao_alocacoes_patrimonio_sem_conflito')) return { ok: false, erro: 'Outra reserva pegou uma das peças agora há pouco. Tente de novo.' };
    return { ok: false, erro: msg };
  }
}

/** Linhas de alocação para a demanda verificada (peças livres escolhidas automaticamente). */
async function montarLinhas(
  db: Db, ficha: { empresa_id: number }, verif: Awaited<ReturnType<typeof verificarDisponibilidade>>,
  patrimoniosAntigos: Set<number>, ignorarFichaId: number | null,
): Promise<{ linhas: any[] } | { erro: string }> {
    const linhasNovas: any[] = [];
    for (const l of verif.linhas) {
      const partes = verif.demanda.get(l.produto_id) || [];
      const periodo = daterangeInclusivo(l.periodo.inicio, l.periodo.fim);
      if (l.controle === 'QUANTIDADE') {
        for (const p of partes) linhasNovas.push({ ficha_item_id: p.ficha_item_id, empresa_id: ficha.empresa_id, produto_id: l.produto_id, quantidade: p.quantidade, periodo });
        continue;
      }
      // INDIVIDUAL: peças ATIVO livres no período (as desta ficha contam como livres)
      const { data: pats, error: eP } = await db.from('locacao_patrimonios').select('id, numero_patrimonio')
        .eq('empresa_id', ficha.empresa_id).eq('produto_id', l.produto_id).eq('situacao', 'ATIVO');
      if (eP) throw eP;
      const ocupadas = new Set((await alocacoesAtivas(db, ficha.empresa_id, [l.produto_id], l.periodo.inicio, l.periodo.fim, ignorarFichaId)).map(a => a.patrimonio_id));
      const livres = (pats || []).filter(p => !ocupadas.has(p.id))
        .sort((a, b) => Number(patrimoniosAntigos.has(b.id)) - Number(patrimoniosAntigos.has(a.id)) || a.numero_patrimonio.localeCompare(b.numero_patrimonio, 'pt-BR', { numeric: true }));
      let idx = 0;
      for (const p of partes) {
        for (let k = 0; k < p.quantidade; k++) {
          const peca = livres[idx++];
          if (!peca) return { erro: `Faltou peça livre de "${l.nome}" ao reservar.` };
          linhasNovas.push({ ficha_item_id: p.ficha_item_id, empresa_id: ficha.empresa_id, produto_id: l.produto_id, patrimonio_id: peca.id, quantidade: 1, periodo });
        }
      }
    }
    return { linhas: linhasNovas };
}

/** Solta as peças/quantidades reservadas da ficha (cancelar, voltar a orçamento). */
export async function liberarReservaFicha(db: Db, fichaId: number): Promise<void> {
  const { error } = await db.from('locacao_alocacoes').update({ status: 'CANCELADO', updated_at: new Date().toISOString() })
    .eq('ficha_id', fichaId).eq('status', 'RESERVADO');
  if (error) throw error;
}

// ============================================================================
// AGENDA (ocupação dia a dia por produto) — tela /admin/locacoes/agenda
// ============================================================================
export interface AgendaProduto {
  produto_id: number;
  nome: string;
  codigo: string | null;
  controle: 'INDIVIDUAL' | 'QUANTIDADE';
  capacidade: number;
  ocupacao: number[];          // um valor por dia do período
  alocacoes: { ficha_id: number; quantidade: number; inicio: string; fim: string }[];
}

/**
 * Ocupação diária de cada produto da empresa no período [inicio, fim].
 * Entra todo produto com estoque (saldo/patrimônio) OU com reserva no
 * período; `produtoIds` restringe a lista.
 */
export async function agendaOcupacao(
  db: Db, empresaId: number, inicio: string, fim: string, produtoIds?: number[] | null
): Promise<{ dias: string[]; produtos: AgendaProduto[] }> {
  const dias: string[] = [];
  for (let d = inicio; d <= fim && dias.length < 400; d = somarDias(d, 1)) dias.push(d);

  let ids: number[];
  if (produtoIds?.length) ids = [...new Set(produtoIds)];
  else {
    const [rS, rP, rA] = await Promise.all([
      buscarTodasPaginas<any>((de, ate) => db.from('locacao_saldos').select('produto_id').eq('empresa_id', empresaId).gt('quantidade_total', 0).order('id').range(de, ate)),
      buscarTodasPaginas<any>((de, ate) => db.from('locacao_patrimonios').select('produto_id').eq('empresa_id', empresaId).in('situacao', ['ATIVO', 'MANUTENCAO']).order('id').range(de, ate)),
      buscarTodasPaginas<any>((de, ate) => db.from('locacao_alocacoes').select('produto_id').eq('empresa_id', empresaId)
        .in('status', STATUS_ATIVOS).overlaps('periodo', daterangeInclusivo(inicio, fim)).order('id').range(de, ate)),
    ]);
    for (const r of [rS, rP, rA]) if (r.error) throw r.error;
    ids = [...new Set([...rS.data, ...rP.data, ...rA.data].map(x => x.produto_id))];
  }
  if (!ids.length) return { dias, produtos: [] };

  const info = await carregarInfoProdutos(db, ids);
  const cap = await capacidades(db, empresaId, info);
  const alocs = await alocacoesAtivas(db, empresaId, ids, inicio, fim, null);
  const idx = new Map(dias.map((d, i) => [d, i]));

  const produtos: AgendaProduto[] = ids.filter(id => info.has(id)).map(id => {
    const p = info.get(id)!;
    const ocupacao = new Array(dias.length).fill(0);
    const meus = alocs.filter(a => a.produto_id === id);
    for (const a of meus) {
      const ini = a.inicio > inicio ? a.inicio : inicio;
      const f = a.fim < fim ? a.fim : fim;
      for (let d = ini; d <= f; d = somarDias(d, 1)) { const i = idx.get(d); if (i !== undefined) ocupacao[i] += a.quantidade; }
    }
    // agrupa por ficha (um item de kit/vários itens viram uma linha por ficha)
    const porFicha = new Map<number, { ficha_id: number; quantidade: number; inicio: string; fim: string }>();
    for (const a of meus) {
      const x = porFicha.get(a.ficha_id);
      if (!x) porFicha.set(a.ficha_id, { ficha_id: a.ficha_id, quantidade: a.quantidade, inicio: a.inicio, fim: a.fim });
      else { x.quantidade += a.quantidade; if (a.inicio < x.inicio) x.inicio = a.inicio; if (a.fim > x.fim) x.fim = a.fim; }
    }
    return {
      produto_id: id, nome: p.nome, codigo: p.codigo, controle: p.controle, capacidade: cap.get(id) || 0,
      ocupacao, alocacoes: [...porFicha.values()].sort((a, b) => a.inicio.localeCompare(b.inicio)),
    };
  }).sort((a, b) => (a.codigo || a.nome).localeCompare(b.codigo || b.nome, 'pt-BR', { numeric: true }));

  return { dias, produtos };
}

/** Estoque atual (capacidade) por produto numa empresa — usado pelos indicadores. */
export async function capacidadePorProduto(db: Db, empresaId: number, produtoIds: number[]): Promise<Map<number, number>> {
  if (!produtoIds.length) return new Map();
  return capacidades(db, empresaId, await carregarInfoProdutos(db, [...new Set(produtoIds)]));
}
