// app/lib/relatorios/consultasExtras.ts
// Relatórios diversos (2026-11-21) — mesmo padrão de consultas.ts: agregam no
// servidor, SEM checagem de acesso (as actions validam a rota e passam as
// empresas permitidas / o vendedor da carteira).
//   Clientes (ABC)  → fichas confirmadas pela data do evento (= Vendas)
//   Eventos         → idem, agrupadas por evento; edição anterior pelo nome sem o ano
//   Comissão        → módulo oficial (lançamentos fechados + cálculo em aberto) × faturado
//   Faturamento     → Notas de Débito do P2S + Notas OFICIAIS daqui; a faturar
//   Ocupação        → agenda (locacao_alocacoes) × estoque; receita × valor do bem
//   Sublocação      → locacao_sublocacoes (custo, margem, avarias do parceiro)
//   Avarias         → locacao_avarias + extravios + cobranças de reposição (P2S e daqui)
//   Notas fiscais   → fiscal_notas
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { agendaOcupacao } from '../locacao/disponibilidade';
import { margemDaOs } from '../locacao/sublocacao';
import { filaAFaturar } from '../financeiro/faturamento';
import { calcularComissoesAbertas, inicioComissoes, regrasVendedores } from '../comercial/comissoes';
import { CONFIRMADAS, fichasPorData, nomeParceiro, anoAnterior, mesesDoIntervalo, hojeISO, type FiltrosRelatorio } from './consultas';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const pctDe = (a: number, b: number) => (b ? r2((a / b) * 100) : null);
const mesDe = (iso: string) => String(iso || '').slice(0, 7);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const categoriaLimpa = (c: string | null | undefined) => (c || '—').replace(/^\s*\d+\s*-\s*/, '');
const valorDoBem = (p: any) => (n(p?.valor_indenizacao) > 0 ? n(p.valor_indenizacao) : n(p?.custo_reposicao));

async function emLotes<T>(ids: (number | string)[], tam: number, fn: (lote: any[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += tam) out.push(...(await fn(ids.slice(i, i + tam))));
  return out;
}

// ============================================================================
// CLIENTES — CURVA ABC
// ============================================================================
export async function relatorioClientes(db: Db, f: FiltrosRelatorio) {
  const col = 'id, data_inicio, valor_total, parceiro_id, parceiro:parceiros(nome_exibicao, nome_completo, cidade1, estado1)';
  const [atual, anterior] = await Promise.all([
    fichasPorData(db, f, 'data_inicio', CONFIRMADAS, col),
    fichasPorData(db, anoAnterior(f), 'data_inicio', CONFIRMADAS, col),
  ]);
  type G = { id: number; cliente: string; cidade: string; locacoes: number; receita: number; ultima: string; receitaAnterior: number };
  const mapa = new Map<number, G>();
  const pegar = (x: any) => {
    const g = mapa.get(x.parceiro_id) || { id: x.parceiro_id, cliente: nomeParceiro(x.parceiro), cidade: [x.parceiro?.cidade1, x.parceiro?.estado1].filter(Boolean).join('/'), locacoes: 0, receita: 0, ultima: '', receitaAnterior: 0 };
    mapa.set(x.parceiro_id, g); return g;
  };
  for (const x of atual) { if (!x.parceiro_id) continue; const g = pegar(x); g.locacoes++; g.receita += n(x.valor_total); if (x.data_inicio > g.ultima) g.ultima = x.data_inicio; }
  const antPorCliente = new Map<number, { receita: number; locacoes: number; ultima: string; cliente: string; cidade: string }>();
  for (const x of anterior) {
    if (!x.parceiro_id) continue;
    const a = antPorCliente.get(x.parceiro_id) || { receita: 0, locacoes: 0, ultima: '', cliente: nomeParceiro(x.parceiro), cidade: [x.parceiro?.cidade1, x.parceiro?.estado1].filter(Boolean).join('/') };
    a.receita += n(x.valor_total); a.locacoes++; if (x.data_inicio > a.ultima) a.ultima = x.data_inicio;
    antPorCliente.set(x.parceiro_id, a);
    if (mapa.has(x.parceiro_id)) mapa.get(x.parceiro_id)!.receitaAnterior += n(x.valor_total);
  }
  const total = r2(atual.reduce((s, x) => s + n(x.valor_total), 0));
  const totalAnt = r2(anterior.reduce((s, x) => s + n(x.valor_total), 0));
  // clientes novos: nenhuma locação confirmada antes do período
  const ids = [...mapa.keys()];
  const antigos = new Set<number>(await emLotes<number>(ids, 300, async lote => {
    const { data } = await db.from('locacao_fichas_reserva').select('parceiro_id').in('parceiro_id', lote).in('status', CONFIRMADAS).in('empresa_id', f.empresaIds.length ? f.empresaIds : [0]).lt('data_inicio', f.de).limit(20000);
    return ((data || []) as any[]).map(d => d.parceiro_id);
  }));
  let acum = 0;
  const lista = [...mapa.values()].sort((a, b) => b.receita - a.receita).map(g => {
    const antes = acum; acum += g.receita;
    const classe = total && antes / total < 0.8 ? 'A' : total && antes / total < 0.95 ? 'B' : 'C';
    return {
      cliente: g.cliente, cidade: g.cidade || '—', classe, locacoes: g.locacoes, receita: r2(g.receita), ticket: r2(g.receita / g.locacoes),
      participacao: pctDe(g.receita, total) ?? 0, acumulado: pctDe(acum, total) ?? 0, ultima: g.ultima, receitaAnterior: r2(g.receitaAnterior),
      variacao: g.receitaAnterior ? r2(((g.receita - g.receitaAnterior) / g.receitaAnterior) * 100) : null, novo: !antigos.has(g.id) ? 'sim' : '',
    };
  });
  const classes = ['A', 'B', 'C'].map(c => {
    const xs = lista.filter(l => l.classe === c);
    const rec = xs.reduce((s, x) => s + x.receita, 0);
    return { classe: c, clientes: xs.length, receita: r2(rec), participacao: pctDe(rec, total) ?? 0, ticket: xs.length ? r2(rec / xs.length) : 0 };
  });
  const perdidos = [...antPorCliente.entries()].filter(([id]) => !mapa.has(id)).map(([, a]) => ({ cliente: a.cliente, cidade: a.cidade || '—', locacoes: a.locacoes, receitaAnterior: r2(a.receita), ultima: a.ultima }))
    .sort((a, b) => b.receitaAnterior - a.receitaAnterior);
  return {
    kpis: {
      clientes: lista.length, receita: total, receitaAnterior: totalAnt, variacao: totalAnt ? r2(((total - totalAnt) / totalAnt) * 100) : null,
      ticketCliente: lista.length ? r2(total / lista.length) : 0, classeA: classes[0].clientes, classeAPct: classes[0].participacao,
      novos: lista.filter(l => l.novo).length, recompra: lista.filter(l => l.locacoes >= 2).length,
      perdidos: perdidos.length, receitaPerdida: r2(perdidos.reduce((s, p) => s + p.receitaAnterior, 0)),
    },
    classes, clientes: lista.slice(0, 1000), perdidos: perdidos.slice(0, 300),
  };
}

// ============================================================================
// EVENTOS E FEIRAS
// ============================================================================
/** Nome do evento sem o ano/edição — junta "EXPOMAFE 2026" com "EXPOMAFE 2027". */
export const baseEvento = (nome: string) => semAcento(String(nome || '')).toUpperCase()
  .replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b\d+\s*[ªAºO]?\s*EDI[CÇ]AO\b/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export async function relatorioEventos(db: Db, f: FiltrosRelatorio) {
  const col = 'id, data_inicio, valor_total, parceiro_id, evento_id, evento:eventos_feiras(nome, local, data_inicial)';
  const [atual, anterior] = await Promise.all([
    fichasPorData(db, f, 'data_inicio', CONFIRMADAS, col),
    fichasPorData(db, anoAnterior(f), 'data_inicio', CONFIRMADAS, col),
  ]);
  const ant = new Map<string, { receita: number; os: number; nome: string }>();
  for (const x of anterior) {
    if (!x.evento_id) continue;
    const k = baseEvento(x.evento?.nome);
    const a = ant.get(k) || { receita: 0, os: 0, nome: x.evento?.nome || '' };
    a.receita += n(x.valor_total); a.os++; ant.set(k, a);
  }
  type G = { evento: string; local: string; data: string; os: number; clientes: Set<number>; receita: number };
  const ev = new Map<string, G>();
  let semEvento = 0, semEventoOs = 0;
  for (const x of atual) {
    if (!x.evento_id) { semEvento += n(x.valor_total); semEventoOs++; continue; }
    const g = ev.get(x.evento_id) || { evento: x.evento?.nome || '—', local: x.evento?.local || '—', data: x.evento?.data_inicial || x.data_inicio, os: 0, clientes: new Set<number>(), receita: 0 };
    g.os++; g.receita += n(x.valor_total); if (x.parceiro_id) g.clientes.add(x.parceiro_id);
    if (x.data_inicio < g.data) g.data = x.data_inicio;
    ev.set(x.evento_id, g);
  }
  const total = r2(atual.reduce((s, x) => s + n(x.valor_total), 0));
  const totalEventos = r2(total - semEvento);
  const usadosAnt = new Set<string>();
  const eventos = [...ev.values()].map(g => {
    const k = baseEvento(g.evento);
    const a = k ? ant.get(k) : undefined;
    if (a) usadosAnt.add(k);
    return {
      evento: g.evento, local: g.local, data: g.data, os: g.os, clientes: g.clientes.size, receita: r2(g.receita), ticket: r2(g.receita / g.os),
      participacao: pctDe(g.receita, totalEventos) ?? 0, edicaoAnterior: a ? r2(a.receita) : null, variacao: a && a.receita ? r2(((g.receita - a.receita) / a.receita) * 100) : null,
    };
  }).sort((a, b) => b.receita - a.receita);
  const naoRepetidos = [...ant.entries()].filter(([k]) => !usadosAnt.has(k)).map(([, a]) => ({ evento: a.nome, os: a.os, receitaAnterior: r2(a.receita) }))
    .sort((a, b) => b.receitaAnterior - a.receitaAnterior);
  const porMes = mesesDoIntervalo(f.de, f.ate).map(m => {
    const mAnt = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
    return {
      mes: m,
      atual: r2(atual.filter(x => x.evento_id && mesDe(x.data_inicio) === m).reduce((s, x) => s + n(x.valor_total), 0)),
      anterior: r2(anterior.filter(x => x.evento_id && mesDe(x.data_inicio) === mAnt).reduce((s, x) => s + n(x.valor_total), 0)),
    };
  });
  const comparaveis = eventos.filter(e => e.edicaoAnterior !== null);
  return {
    kpis: {
      eventos: eventos.length, receitaEventos: totalEventos, participacaoEventos: pctDe(totalEventos, total), receitaSemEvento: r2(semEvento), osSemEvento: semEventoOs,
      ticketEvento: eventos.length ? r2(totalEventos / eventos.length) : 0, maior: eventos[0]?.evento || '—', maiorValor: eventos[0]?.receita || 0,
      repetidos: comparaveis.length, crescimentoRepetidos: (() => { const a = comparaveis.reduce((s, e) => s + (e.edicaoAnterior || 0), 0); const b = comparaveis.reduce((s, e) => s + e.receita, 0); return a ? r2(((b - a) / a) * 100) : null; })(),
    },
    porMes, eventos: eventos.slice(0, 1000), naoRepetidos: naoRepetidos.slice(0, 300),
  };
}

// ============================================================================
// COMISSÃO DE VENDEDORES — usa o módulo oficial (Comercial › Comissões):
// regra por vendedor, liberada conforme o cliente paga; fechadas = lançamentos
// gravados no fechamento; em aberto = calculadas na hora (calcularComissoesAbertas).
// ============================================================================
const RE_FICHA_LOC = /Ficha\s+Loc\.?\s*(\d+\s*\/\s*[A-Z]+)/i;

export async function relatorioComissao(db: Db, f: FiltrosRelatorio) {
  const colF = 'id, data_inicio, valor_total, vendedor_id, vendedor_nome';
  const [fichas, inicio, fechadasRaw, abertas] = await Promise.all([
    fichasPorData(db, f, 'data_inicio', CONFIRMADAS, colF),
    inicioComissoes(db),
    buscarTodasPaginas<any>((d, a) => {
      let q = db.from('comercial_comissao_lancamentos').select('vendedor_id, fonte, ficha_id, ficha_numero, cliente, recebido_em, valor_recebido, pct_efetivo, valor_comissao')
        .gte('recebido_em', f.de).lte('recebido_em', f.ate);
      if (f.vendedorId) q = q.eq('vendedor_id', f.vendedorId);
      return q.order('id').range(d, a);
    }, 1000, 100000),
    calcularComissoesAbertas(db, f.ate, f.vendedorId || null),
  ]);
  if (fechadasRaw.error) throw fechadasRaw.error;
  const linhas = [
    ...((fechadasRaw.data || []) as any[]).map(l => ({ ...l, situacao: 'fechada' })),
    ...abertas.linhas.filter(l => l.recebido_em >= f.de).map(l => ({ ...l, situacao: 'em aberto' })),
  ];
  // empresa de cada linha pela ficha (linhas sem ficha ligada ficam)
  const fichaIds = [...new Set(linhas.map(l => l.ficha_id).filter(Boolean))] as number[];
  const empresaDaFicha = new Map<number, number>();
  for (const x of await emLotes<any>(fichaIds, 300, async lote => ((await db.from('locacao_fichas_reserva').select('id, empresa_id').in('id', lote)).data || []) as any[])) empresaDaFicha.set(x.id, x.empresa_id);
  const validas = linhas.filter(l => !l.ficha_id || !empresaDaFicha.has(l.ficha_id) || f.empresaIds.includes(empresaDaFicha.get(l.ficha_id)!));

  const vendIds = [...new Set([...fichas.map(x => x.vendedor_id), ...validas.map(l => l.vendedor_id)].filter(Boolean))];
  const { data: vends } = vendIds.length ? await db.from('colaboradores').select('id, nome_exibicao').in('id', vendIds) : { data: [] as any[] };
  const nomeVend = new Map<number, string>(((vends || []) as any[]).map(v => [v.id, String(v.nome_exibicao || '').trim()]));
  const regras = await regrasVendedores(db);

  type G = { vendedorId: number | null; vendedor: string; fichas: number; faturado: number; recebido: number; fechada: number; aberta: number };
  const mapa = new Map<string, G>();
  const pegar = (id: number | null, nome?: string | null) => {
    const k = String(id || nome || '—');
    const g = mapa.get(k) || { vendedorId: id || null, vendedor: (id && nomeVend.get(id)) || nome || '— sem vendedor —', fichas: 0, faturado: 0, recebido: 0, fechada: 0, aberta: 0 };
    mapa.set(k, g); return g;
  };
  for (const x of fichas) { const g = pegar(x.vendedor_id, x.vendedor_nome); g.fichas++; g.faturado += n(x.valor_total); }
  for (const l of validas) { const g = pegar(l.vendedor_id); g.recebido += n(l.valor_recebido); if (l.situacao === 'fechada') g.fechada += n(l.valor_comissao); else g.aberta += n(l.valor_comissao); }
  const porVendedor = [...mapa.values()].map(g => {
    const r = g.vendedorId ? regras.get(g.vendedorId) : undefined;
    const total = g.fechada + g.aberta;
    return {
      vendedor: g.vendedor, fichas: g.fichas, faturado: r2(g.faturado), recebido: r2(g.recebido), comissaoFechada: r2(g.fechada), comissaoAberta: r2(g.aberta), comissao: r2(total),
      pctEfetivo: g.recebido ? r2((total / g.recebido) * 100) : null, regra: r ? `${r.pct_locacao}% loc · ${r.pct_servicos}% serv${r.ativo ? '' : ' (inativa)'}` : 'sem regra',
    };
  }).sort((a, b) => b.comissao - a.comissao || b.faturado - a.faturado);
  const soma = (k: 'faturado' | 'recebido' | 'comissaoFechada' | 'comissaoAberta' | 'comissao') => r2(porVendedor.reduce((s, v) => s + v[k], 0));
  const pend = f.vendedorId ? [] : abertas.pendencias.filter(p => p.recebido_em >= f.de);
  return {
    kpis: {
      faturado: soma('faturado'), recebido: soma('recebido'), comissao: soma('comissao'), fechada: soma('comissaoFechada'), aberta: soma('comissaoAberta'),
      vendedores: porVendedor.filter(v => v.comissao > 0 || v.fichas > 0).length, pendencias: pend.length, pendenciasValor: r2(pend.reduce((s, p) => s + n(p.valor), 0)),
      inicio, antesDoInicio: f.ate < inicio,
    },
    porVendedor,
    linhas: validas.sort((a, b) => String(b.recebido_em).localeCompare(String(a.recebido_em))).slice(0, 3000).map(l => ({
      vendedor: nomeVend.get(l.vendedor_id) || '—', recebido_em: l.recebido_em, ficha: l.ficha_numero || '—', cliente: l.cliente || '—', origem: l.fonte,
      valor: r2(n(l.valor_recebido)), pct: n(l.pct_efetivo), comissao: r2(n(l.valor_comissao)), situacao: l.situacao,
    })),
    pendencias: pend.slice(0, 1000).map(p => ({ recebido_em: p.recebido_em, cliente: p.cliente || '—', descricao: p.descricao, valor: r2(n(p.valor)), motivo: p.motivo })),
  };
}

// ============================================================================
// FATURAMENTO (Notas de Débito)
// ============================================================================
async function notasDebitoP2s(db: Db, empresaIds: number[], de: string, ate: string, colunas: string) {
  if (!empresaIds.length) return [];
  const { data, error } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_contas_receber').select(colunas)
    .in('empresa_id', empresaIds).ilike('documento', 'Nota de D%').gte('data_emissao', de).lte('data_emissao', ate).order('id').range(d, a), 1000, 200000);
  if (error) throw error;
  return data;
}

export async function relatorioFaturamento(db: Db, f: FiltrosRelatorio) {
  const col = 'empresa_id, num_documento, cliente, descricao, valor_final, valor_pago, quitado, data_emissao, data_vencimento';
  const fa = anoAnterior(f);
  const [parcelas, parcelasAnt, fatsSis, fatsSisAnt] = await Promise.all([
    notasDebitoP2s(db, f.empresaIds, f.de, f.ate, col),
    notasDebitoP2s(db, f.empresaIds, fa.de, fa.ate, 'empresa_id, num_documento, valor_final, data_emissao'),
    f.empresaIds.length ? db.from('financeiro_faturas').select('id, empresa_id, numero, data_emissao, valor_total, parceiro:parceiros(nome_exibicao, nome_completo)').in('empresa_id', f.empresaIds).eq('serie', 'OFICIAL').eq('status', 'EMITIDA').gte('data_emissao', f.de).lte('data_emissao', f.ate).limit(20000) : Promise.resolve({ data: [] as any[] }),
    f.empresaIds.length ? db.from('financeiro_faturas').select('empresa_id, numero, data_emissao, valor_total').in('empresa_id', f.empresaIds).eq('serie', 'OFICIAL').eq('status', 'EMITIDA').gte('data_emissao', fa.de).lte('data_emissao', fa.ate).limit(20000) : Promise.resolve({ data: [] as any[] }),
  ]);
  // uma nota = várias parcelas com o mesmo nº na mesma empresa
  type Nota = { chave: string; numero: string; cliente: string; emissao: string; valor: number; recebido: number; fl: string | null; origem: string };
  const agrupar = (ps: any[]) => {
    const m = new Map<string, Nota>();
    for (const p of ps) {
      const k = `${p.empresa_id}:${p.num_documento}`;
      const g = m.get(k) || { chave: k, numero: String(p.num_documento || '—'), cliente: String(p.cliente || '—').trim(), emissao: p.data_emissao, valor: 0, recebido: 0, fl: (String(p.descricao || '').match(RE_FICHA_LOC)?.[1] || '').replace(/\s/g, '') || null, origem: 'P2S' };
      g.valor += n(p.valor_final); g.recebido += p.quitado ? (n(p.valor_pago) || n(p.valor_final)) : n(p.valor_pago);
      m.set(k, g);
    }
    return [...m.values()];
  };
  const notas: Nota[] = [
    ...agrupar(parcelas),
    ...(((fatsSis as any).data || []) as any[]).map(x => ({ chave: `S${x.id}`, numero: String(x.numero), cliente: nomeParceiro(x.parceiro), emissao: x.data_emissao, valor: n(x.valor_total), recebido: 0, fl: null, origem: 'Sistema' })),
  ];
  const notasAnt = [
    ...agrupar(parcelasAnt),
    ...(((fatsSisAnt as any).data || []) as any[]).map(x => ({ emissao: x.data_emissao, valor: n(x.valor_total) })),
  ] as { emissao: string; valor: number }[];
  const total = r2(notas.reduce((s, x) => s + x.valor, 0));
  const totalAnt = r2(notasAnt.reduce((s, x) => s + x.valor, 0));
  const porMes = mesesDoIntervalo(f.de, f.ate).map(m => {
    const mAnt = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
    return { mes: m, atual: r2(notas.filter(x => mesDe(x.emissao) === m).reduce((s, x) => s + x.valor, 0)), anterior: r2(notasAnt.filter(x => mesDe(x.emissao) === mAnt).reduce((s, x) => s + x.valor, 0)), notas: notas.filter(x => mesDe(x.emissao) === m).length };
  });
  const cli = new Map<string, { cliente: string; notas: number; valor: number; recebido: number }>();
  for (const x of notas) { const g = cli.get(x.cliente) || { cliente: x.cliente, notas: 0, valor: 0, recebido: 0 }; g.notas++; g.valor += x.valor; g.recebido += x.recebido; cli.set(x.cliente, g); }
  // prazo devolução → faturamento (pela Ficha de Locação citada na nota)
  const fls = [...new Set(notas.map(x => x.fl).filter(Boolean))] as string[];
  const devolucao = new Map<string, string>();
  for (const x of await emLotes<any>(fls, 300, async lote => ((await db.from('locacao_fichas_locacao').select('numero, data_devolucao').in('numero', lote).not('data_devolucao', 'is', null)).data || []) as any[]))
    devolucao.set(x.numero, x.data_devolucao);
  const prazos = notas.filter(x => x.fl && devolucao.has(x.fl)).map(x => diasEntre(devolucao.get(x.fl!)!, x.emissao)).filter(d => d >= 0 && d <= 365).sort((a, b) => a - b);
  const faixas = [['até 2 dias', 0, 2], ['3 a 7 dias', 3, 7], ['8 a 15 dias', 8, 15], ['16 a 30 dias', 16, 30], ['mais de 30 dias', 31, 1e9]] as const;
  const distribuicao = faixas.map(([rot, a, b]) => { const q = prazos.filter(d => d >= a && d <= b).length; return { faixa: rot, notas: q, participacao: pctDe(q, prazos.length) ?? 0 }; });
  // a faturar: fichas de locação do P2S devolvidas no período e "Não faturado" + OS daqui finalizadas com saldo
  const { data: flAberto } = f.empresaIds.length ? await buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_locacao')
    .select('numero, data_saida, data_devolucao, ficha_reserva_id, parceiro:parceiros(nome_exibicao, nome_completo), reserva:locacao_fichas_reserva(valor_total)')
    .in('empresa_id', f.empresaIds).eq('origem', 'P2S').eq('status_ultimo_faturamento', 'N').not('data_devolucao', 'is', null).gte('data_devolucao', f.de).lte('data_devolucao', f.ate).order('id').range(d, a), 1000, 50000) : { data: [] as any[] };
  const hoje = hojeISO();
  const aFaturar = [
    ...((flAberto || []) as any[]).map(x => ({ os: `R${x.ficha_reserva_id || x.numero}`, referencia: `FL ${x.numero}`, origem: 'P2S', cliente: nomeParceiro(x.parceiro), devolucao: x.data_devolucao, diasParado: diasEntre(x.data_devolucao, hoje), valorOs: r2(n(x.reserva?.valor_total)) })),
    ...(await filaAFaturar(db, f.empresaIds, false).catch(() => [] as any[])).map((o: any) => ({ os: `S${o.id}`, referencia: o.numero, origem: 'Sistema', cliente: o.cliente, devolucao: o.devolucao || o.fim, diasParado: diasEntre(o.devolucao || o.fim, hoje), valorOs: o.saldo })),
  ].sort((a, b) => b.diasParado - a.diasParado);
  const mediana = prazos.length ? prazos[Math.floor(prazos.length / 2)] : null;
  return {
    kpis: {
      notas: notas.length, total, totalAnterior: totalAnt, variacao: totalAnt ? r2(((total - totalAnt) / totalAnt) * 100) : null, ticket: notas.length ? r2(total / notas.length) : 0,
      recebido: r2(notas.reduce((s, x) => s + x.recebido, 0)), prazoMedio: prazos.length ? r2(prazos.reduce((s, d) => s + d, 0) / prazos.length) : null, prazoMediana: mediana, prazosBase: prazos.length,
      aFaturar: aFaturar.length, aFaturarValor: r2([...new Map(aFaturar.map(x => [x.os, x.valorOs])).values()].reduce((s, v) => s + v, 0)), notasSistema: notas.filter(x => x.origem === 'Sistema').length,
    },
    porMes, distribuicao,
    porCliente: [...cli.values()].map(c => ({ ...c, valor: r2(c.valor), recebido: r2(c.recebido), participacao: pctDe(c.valor, total) ?? 0 })).sort((a, b) => b.valor - a.valor).slice(0, 500),
    notas: notas.sort((a, b) => b.emissao.localeCompare(a.emissao)).slice(0, 2000).map(x => ({ numero: x.numero, origem: x.origem, cliente: x.cliente, emissao: x.emissao, fl: x.fl || '—', valor: r2(x.valor), recebido: r2(x.recebido) })),
    aFaturar: aFaturar.slice(0, 1000).map(({ os: _os, ...x }) => { void _os; return x; }),
  };
}

// ============================================================================
// OCUPAÇÃO E RETORNO
// ============================================================================
export async function relatorioOcupacao(db: Db, f: FiltrosRelatorio) {
  let ate = f.ate;
  const limite = (() => { const d = new Date(`${f.de}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 365); return d.toISOString().slice(0, 10); })();
  const cortado = ate > limite;
  if (cortado) ate = limite;
  const dias = diasEntre(f.de, ate) + 1;
  type P = { produto_id: number; capacidade: number; unidadesDia: number; diasComUso: number; pico: number };
  const prod = new Map<number, P>();
  const novo = (id: number) => { const g = prod.get(id) || { produto_id: id, capacidade: 0, unidadesDia: 0, diasComUso: 0, pico: 0 }; prod.set(id, g); return g; };
  // estoque de cada produto (saldo/patrimônio) — a agenda de 1 dia já traz a capacidade
  for (const emp of f.empresaIds) {
    const a = await agendaOcupacao(db, emp, ate, ate);
    for (const p of a.produtos) novo(p.produto_id).capacidade += n(p.capacidade);
  }
  // uso: fichas confirmadas que se sobrepõem ao período, da saída ao retorno
  // (a agenda só tem as reservas recentes; as fichas trazem também o histórico do P2S)
  const indice = (iso: string) => diasEntre(f.de, iso);
  const { data: fichasUso, error: eU } = f.empresaIds.length ? await buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_reserva')
    .select('id, data_saida, data_montagem, data_inicio, data_fim, data_desmontagem, data_retorno')
    .in('empresa_id', f.empresaIds).in('status', CONFIRMADAS).lte('data_inicio', ate).gte('data_fim', (() => { const x = new Date(`${f.de}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 45); return x.toISOString().slice(0, 10); })())
    .order('id').range(d, a), 1000, 100000) : { data: [] as any[], error: null };
  if (eU) throw eU;
  const janela = new Map<number, [number, number]>();
  for (const x of (fichasUso || []) as any[]) {
    const ini = String(x.data_saida || x.data_montagem || x.data_inicio).slice(0, 10), fim = String(x.data_retorno || x.data_desmontagem || x.data_fim || x.data_inicio).slice(0, 10);
    const a = Math.max(0, indice(ini)), b = Math.min(dias - 1, indice(fim < ini ? ini : fim));
    if (b >= a) janela.set(x.id, [a, b]);
  }
  // kits viram os componentes (o kit ocupa as peças, não "um kit")
  const { data: kitItens } = await buscarTodasPaginas<any>((d, a) => db.from('locacao_kit_itens').select('kit_produto_id, componente_produto_id, quantidade, opcional').order('kit_produto_id').range(d, a), 1000, 50000);
  const comps = new Map<number, { id: number; q: number }[]>();
  for (const k of (kitItens || []) as any[]) if (!k.opcional) comps.set(k.kit_produto_id, [...(comps.get(k.kit_produto_id) || []), { id: k.componente_produto_id, q: n(k.quantidade) }]);
  const explodir = (id: number, q: number, nivel = 0): { id: number; q: number }[] =>
    comps.has(id) && nivel < 4 ? comps.get(id)!.flatMap(c => explodir(c.id, q * c.q, nivel + 1)) : [{ id, q }];
  const diario = new Map<number, Float64Array>();
  for (const it of await emLotes<any>([...janela.keys()], 300, async lote => ((await db.from('locacao_fichas_reserva_itens').select('ficha_id, produto_id, quantidade').in('ficha_id', lote).in('tipo', ['EQUIPAMENTO', 'KIT']).not('produto_id', 'is', null)).data || []) as any[])) {
    const [a, b] = janela.get(it.ficha_id)!;
    if (n(it.quantidade) <= 0) continue;
    for (const p of explodir(it.produto_id, n(it.quantidade))) {
      const arr = diario.get(p.id) || new Float64Array(dias);
      for (let i = a; i <= b; i++) arr[i] += p.q;
      diario.set(p.id, arr);
    }
  }
  for (const [id, arr] of diario) {
    const g = novo(id);
    let usados = 0, soma = 0, pico = 0;
    for (const v of arr) { if (v > 0) usados++; soma += v; if (v > pico) pico = v; }
    g.unidadesDia = soma; g.diasComUso = usados; g.pico = pico;
  }
  // receita do período por produto (itens das fichas confirmadas, como em Equipamentos)
  const fichas = await fichasPorData(db, { ...f, ate }, 'data_inicio', CONFIRMADAS, 'id');
  const receita = new Map<number, number>();
  for (const it of await emLotes<any>(fichas.map(x => x.id), 300, async lote => ((await db.from('locacao_fichas_reserva_itens').select('produto_id, valor_total').in('ficha_id', lote).not('produto_id', 'is', null)).data || []) as any[]))
    receita.set(it.produto_id, (receita.get(it.produto_id) || 0) + n(it.valor_total));
  const ids = [...new Set([...prod.keys(), ...receita.keys()])];
  const info = new Map<number, any>();
  for (const p of await emLotes<any>(ids, 300, async lote => ((await db.from('produtos').select('id, nome_item, codigo_formatado, categoria_nome, valor_indenizacao, custo_reposicao').in('id', lote)).data || []) as any[])) info.set(p.id, p);
  const linhas = ids.map(id => {
    const g = prod.get(id) || { capacidade: 0, unidadesDia: 0, diasComUso: 0, pico: 0 };
    const p = info.get(id);
    const vb = valorDoBem(p);
    const patrimonio = r2(vb * g.capacidade);
    const rec = r2(receita.get(id) || 0);
    return {
      produto: p?.nome_item || `#${id}`, codigo: p?.codigo_formatado || '', categoria: categoriaLimpa(p?.categoria_nome), estoque: r2(g.capacidade),
      ocupacao: g.capacidade > 0 ? Math.min(100, r2((g.unidadesDia / (g.capacidade * dias)) * 100)) : null, diasComUso: g.diasComUso, pico: r2(g.pico),
      sublocou: g.capacidade > 0 && g.pico > g.capacidade ? 'sim' : '', receita: rec, valorBem: r2(vb), patrimonio, retorno: patrimonio > 0 ? r2((rec / patrimonio) * 100) : null,
      _ud: g.unidadesDia, _cap: g.capacidade,
    };
  });
  const comEstoque = linhas.filter(l => l.estoque > 0);
  const cat = new Map<string, { categoria: string; produtos: number; estoque: number; ud: number; capDias: number; receita: number; patrimonio: number }>();
  for (const l of comEstoque) {
    const g = cat.get(l.categoria) || { categoria: l.categoria, produtos: 0, estoque: 0, ud: 0, capDias: 0, receita: 0, patrimonio: 0 };
    g.produtos++; g.estoque += l.estoque; g.ud += l._ud; g.capDias += l._cap * dias; g.receita += l.receita; g.patrimonio += l.patrimonio;
    cat.set(l.categoria, g);
  }
  const udTot = comEstoque.reduce((s, l) => s + l._ud, 0), capTot = comEstoque.reduce((s, l) => s + l._cap * dias, 0);
  const recTot = r2(linhas.reduce((s, l) => s + l.receita, 0)), patTot = r2(comEstoque.reduce((s, l) => s + l.patrimonio, 0));
  const limpar = ({ _ud, _cap, ...l }: any) => { void _ud; void _cap; return l; };
  return {
    kpis: {
      ocupacaoMedia: capTot ? Math.min(100, r2((udTot / capTot) * 100)) : null, produtos: comEstoque.length, parados: comEstoque.filter(l => !l._ud).length,
      acima70: comEstoque.filter(l => (l.ocupacao || 0) >= 70).length, receita: recTot, patrimonio: patTot, retorno: patTot ? r2((recTot / patTot) * 100) : null,
      semValorBem: comEstoque.filter(l => !l.valorBem).length, dias, cortado, ateUsado: ate,
    },
    porCategoria: [...cat.values()].map(c => ({ categoria: c.categoria, produtos: c.produtos, estoque: r2(c.estoque), ocupacao: c.capDias ? Math.min(100, r2((c.ud / c.capDias) * 100)) : null, receita: r2(c.receita), patrimonio: r2(c.patrimonio), retorno: c.patrimonio ? r2((c.receita / c.patrimonio) * 100) : null }))
      .sort((a, b) => (b.ocupacao || 0) - (a.ocupacao || 0)),
    porProduto: comEstoque.map(limpar).sort((a: any, b: any) => (b.ocupacao || 0) - (a.ocupacao || 0)).slice(0, 1000),
    parados: comEstoque.filter(l => !l._ud).map(limpar).sort((a: any, b: any) => b.patrimonio - a.patrimonio).slice(0, 500),
    semEstoque: linhas.filter(l => !l.estoque && l.receita > 0).map(limpar).sort((a: any, b: any) => b.receita - a.receita).slice(0, 200),
  };
}

// ============================================================================
// SUBLOCAÇÃO
// ============================================================================
export async function relatorioSublocacao(db: Db, f: FiltrosRelatorio) {
  if (!f.empresaIds.length) return null;
  const { data: subs, error } = await db.from('locacao_sublocacoes')
    .select('id, ficha_reserva_id, status, data_retirada, valor_frete, fornecedor_id, fornecedor:parceiros(nome_exibicao, nome_completo), itens:locacao_sublocacao_itens(produto_id, descricao, quantidade, valor_total)')
    .in('empresa_id', f.empresaIds).neq('status', 'CANCELADO').gte('data_retirada', f.de).lte('data_retirada', f.ate).order('data_retirada').limit(5000);
  if (error) throw error;
  const lista = (subs || []) as any[];
  // margem por OS (preço da OS × quantidade sublocada − custo − avarias do parceiro)
  const margem = new Map<number, { receita: number; custo: number; porSub: Map<number, { receita: number; custo: number }> }>();
  for (const osId of [...new Set(lista.map(s => s.ficha_reserva_id).filter(Boolean))]) {
    const m = await margemDaOs(db, osId);
    margem.set(osId, { receita: m.receita, custo: m.custo, porSub: new Map(m.sublocacoes.map((s: any) => [s.id, { receita: s.receita, custo: s.custo }])) });
  }
  const { data: avs } = lista.length ? await db.from('locacao_avarias').select('sublocacao_id, valor_parceiro').in('sublocacao_id', lista.map(s => s.id)) : { data: [] as any[] };
  const avPorSub = new Map<number, number>();
  for (const a of (avs || []) as any[]) avPorSub.set(a.sublocacao_id, (avPorSub.get(a.sublocacao_id) || 0) + n(a.valor_parceiro));
  type F = { fornecedor: string; sublocacoes: number; unidades: number; custo: number; frete: number; avarias: number; receita: number };
  const forn = new Map<number, F>();
  const prod = new Map<number, { produto: string; vezes: number; unidades: number; custo: number }>();
  const detalhe = lista.map(s => {
    const custoItens = (s.itens || []).reduce((a: number, i: any) => a + n(i.valor_total), 0);
    const m = s.ficha_reserva_id ? margem.get(s.ficha_reserva_id)?.porSub.get(s.id) : undefined;
    const g = forn.get(s.fornecedor_id) || { fornecedor: nomeParceiro(s.fornecedor), sublocacoes: 0, unidades: 0, custo: 0, frete: 0, avarias: 0, receita: 0 };
    g.sublocacoes++; g.custo += custoItens; g.frete += n(s.valor_frete); g.avarias += avPorSub.get(s.id) || 0; g.receita += m?.receita || 0;
    g.unidades += (s.itens || []).reduce((a: number, i: any) => a + n(i.quantidade), 0);
    forn.set(s.fornecedor_id, g);
    for (const i of s.itens || []) {
      const p = prod.get(i.produto_id) || { produto: i.descricao, vezes: 0, unidades: 0, custo: 0 };
      p.vezes++; p.unidades += n(i.quantidade); p.custo += n(i.valor_total); prod.set(i.produto_id, p);
    }
    const custo = r2(custoItens + n(s.valor_frete) + (avPorSub.get(s.id) || 0));
    return { numero: `SUB-${String(s.id).padStart(5, '0')}`, data: s.data_retirada, fornecedor: nomeParceiro(s.fornecedor), os: s.ficha_reserva_id ? `FR-${String(s.ficha_reserva_id).padStart(5, '0')}` : '—', status: s.status, itens: (s.itens || []).map((i: any) => `${n(i.quantidade)}× ${i.descricao}`).join(', '), custo, receita: r2(m?.receita || 0), margem: r2((m?.receita || 0) - custo) };
  });
  const porFornecedor = [...forn.values()].map(g => {
    const custoTotal = g.custo + g.frete + g.avarias;
    return { fornecedor: g.fornecedor, sublocacoes: g.sublocacoes, unidades: r2(g.unidades), custo: r2(g.custo), frete: r2(g.frete), avarias: r2(g.avarias), custoTotal: r2(custoTotal), receita: r2(g.receita), margem: r2(g.receita - custoTotal), margemPct: pctDe(g.receita - custoTotal, g.receita) };
  }).sort((a, b) => b.custoTotal - a.custoTotal);
  const custoTot = r2(porFornecedor.reduce((s, x) => s + x.custoTotal, 0)), recTot = r2(porFornecedor.reduce((s, x) => s + x.receita, 0));
  return {
    kpis: {
      sublocacoes: lista.length, custo: custoTot, receita: recTot, margem: r2(recTot - custoTot), margemPct: pctDe(recTot - custoTot, recTot),
      fornecedores: porFornecedor.length, avarias: r2(porFornecedor.reduce((s, x) => s + x.avarias, 0)), os: margem.size,
    },
    porFornecedor,
    porProduto: [...prod.values()].map(p => ({ ...p, unidades: r2(p.unidades), custo: r2(p.custo) })).sort((a, b) => b.unidades - a.unidades),
    sublocacoes: detalhe,
  };
}

// ============================================================================
// AVARIAS E EXTRAVIOS
// ============================================================================
export async function relatorioAvarias(db: Db, f: FiltrosRelatorio) {
  if (!f.empresaIds.length) return null;
  const [av, ext, titSis, repP2s] = await Promise.all([
    db.from('locacao_avarias').select('id, produto_id, quantidade, gravidade, descricao, status_cobranca, valor_cobranca, registrada_em, sublocacao_id, produto:produtos(nome_item, valor_indenizacao, custo_reposicao), parceiro:parceiros(nome_exibicao, nome_completo), ficha_id')
      .in('empresa_id', f.empresaIds).gte('registrada_em', `${f.de}T00:00:00-03:00`).lte('registrada_em', `${f.ate}T23:59:59-03:00`).limit(10000),
    db.from('locacao_fichas_locacao_movimentos').select('quantidade, valor_indenizacao, data_movimentacao, produto_id, produto:produtos(nome_item, valor_indenizacao, custo_reposicao), fl:locacao_fichas_locacao!inner(numero, empresa_id, parceiro:parceiros(nome_exibicao, nome_completo))')
      .eq('tipo', 'EXTRAVIO').in('fl.empresa_id', f.empresaIds).gte('data_movimentacao', f.de).lte('data_movimentacao', `${f.ate}T23:59:59`).limit(10000),
    db.from('financeiro_titulos_receber').select('valor, valor_pago, status, data_emissao, descricao, parceiro:parceiros(nome_exibicao, nome_completo)')
      .in('empresa_id', f.empresaIds).eq('origem', 'REPOSICAO').gte('data_emissao', f.de).lte('data_emissao', f.ate).limit(10000),
    db.from('financeiro_contas_receber').select('cliente, descricao, sub_centro, valor_final, valor_pago, quitado, data_emissao')
      .in('empresa_id', f.empresaIds).ilike('centro_financeiro', 'REPOSI%').gte('data_emissao', f.de).lte('data_emissao', f.ate).limit(10000),
  ]);
  for (const r of [av, ext, titSis, repP2s]) if (r.error) throw r.error;
  const ocorrencias = [
    ...((av.data || []) as any[]).filter(a => !a.sublocacao_id).map(a => ({
      tipo: a.gravidade === 'PERDA_TOTAL' ? 'Perda total' : `Avaria ${String(a.gravidade || '').toLowerCase()}`, data: String(a.registrada_em).slice(0, 10), produto: a.produto?.nome_item || `#${a.produto_id}`,
      cliente: nomeParceiro(a.parceiro), quantidade: n(a.quantidade), custo: r2(valorDoBem(a.produto) * n(a.quantidade)),
      cobranca: ({ A_DEFINIR: 'a definir', COBRAR: 'a cobrar', NAO_COBRAR: 'não cobrar', COBRADO: 'cobrado', PAGO: 'pago' } as Record<string, string>)[a.status_cobranca] || a.status_cobranca,
      valorCobrado: r2(n(a.valor_cobranca)), descricao: a.descricao,
    })),
    ...((ext.data || []) as any[]).map(m => ({
      tipo: 'Extravio', data: String(m.data_movimentacao).slice(0, 10), produto: m.produto?.nome_item || `#${m.produto_id}`, cliente: nomeParceiro(m.fl?.parceiro), quantidade: n(m.quantidade),
      custo: r2(n(m.valor_indenizacao) > 0 ? n(m.valor_indenizacao) * n(m.quantidade) : valorDoBem(m.produto) * n(m.quantidade)), cobranca: 'reposição gerada', valorCobrado: 0, descricao: `FL ${m.fl?.numero || ''}`,
    })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  const cobrancas = [
    ...((titSis.data || []) as any[]).map(t => ({ origem: 'Sistema', data: t.data_emissao, cliente: nomeParceiro(t.parceiro), descricao: t.descricao, valor: r2(n(t.valor)), recebido: r2(t.status === 'PAGO' ? (n(t.valor_pago) || n(t.valor)) : n(t.valor_pago)), situacao: t.status === 'CANCELADO' ? 'perdoada' : t.status === 'PAGO' ? 'recebida' : 'em aberto' })),
    ...((repP2s.data || []) as any[]).map(t => ({ origem: 'P2S', data: t.data_emissao, cliente: String(t.cliente || '—').trim(), descricao: [t.sub_centro, t.descricao].filter(Boolean).join(' · '), valor: r2(n(t.valor_final)), recebido: r2(t.quitado ? (n(t.valor_pago) || n(t.valor_final)) : n(t.valor_pago)), situacao: t.quitado ? 'recebida' : 'em aberto' })),
  ].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const validas = cobrancas.filter(c => c.situacao !== 'perdoada');
  const cli = new Map<string, { cliente: string; ocorrencias: number; custo: number; cobrado: number; recebido: number }>();
  for (const o of ocorrencias) { const g = cli.get(o.cliente) || { cliente: o.cliente, ocorrencias: 0, custo: 0, cobrado: 0, recebido: 0 }; g.ocorrencias++; g.custo += o.custo; cli.set(o.cliente, g); }
  for (const c of validas) { const g = cli.get(c.cliente) || { cliente: c.cliente, ocorrencias: 0, custo: 0, cobrado: 0, recebido: 0 }; g.cobrado += c.valor; g.recebido += c.recebido; cli.set(c.cliente, g); }
  const prod = new Map<string, { produto: string; ocorrencias: number; quantidade: number; custo: number }>();
  for (const o of ocorrencias) { const g = prod.get(o.produto) || { produto: o.produto, ocorrencias: 0, quantidade: 0, custo: 0 }; g.ocorrencias++; g.quantidade += o.quantidade; g.custo += o.custo; prod.set(o.produto, g); }
  const soma = (xs: any[], k: string) => r2(xs.reduce((s, x) => s + n(x[k]), 0));
  return {
    kpis: {
      ocorrencias: ocorrencias.length, avarias: ocorrencias.filter(o => o.tipo !== 'Extravio').length, extravios: ocorrencias.filter(o => o.tipo === 'Extravio').length,
      custo: soma(ocorrencias, 'custo'), cobrado: soma(validas, 'valor'), recebido: soma(validas, 'recebido'), emAberto: r2(soma(validas, 'valor') - soma(validas, 'recebido')),
      perdoado: r2(soma(cobrancas.filter(c => c.situacao === 'perdoada'), 'valor') + ocorrencias.filter(o => o.cobranca === 'não cobrar').reduce((s, o) => s + o.custo, 0)),
    },
    porCliente: [...cli.values()].map(c => ({ ...c, custo: r2(c.custo), cobrado: r2(c.cobrado), recebido: r2(c.recebido) })).sort((a, b) => b.cobrado + b.custo - (a.cobrado + a.custo)),
    porProduto: [...prod.values()].map(p => ({ ...p, quantidade: r2(p.quantidade), custo: r2(p.custo) })).sort((a, b) => b.custo - a.custo),
    ocorrencias: ocorrencias.slice(0, 2000), cobrancas: cobrancas.slice(0, 2000),
  };
}

// ============================================================================
// NOTAS FISCAIS
// ============================================================================
const OPERACAO_FISCAL: Record<string, string> = {
  SERVICO: 'NFS-e · serviço', LOCACAO: 'NFS-e · locação', REMESSA_LOCACAO: 'NF-e · remessa', RETORNO_LOCACAO: 'NF-e · retorno', VENDA_ATIVO: 'NF-e · venda de ativo', VENDA_MERCADORIA: 'NF-e · venda',
};
export async function relatorioNotasFiscais(db: Db, f: FiltrosRelatorio) {
  if (!f.empresaIds.length) return null;
  const { data, error } = await buscarTodasPaginas<any>((d, a) => db.from('fiscal_notas')
    .select('id, tipo, operacao, ambiente, status, numero, serie, valor_total, criado_em, mensagem, motivo_cancelamento, parceiro:parceiros(nome_exibicao, nome_completo)')
    .in('empresa_id', f.empresaIds).gte('criado_em', `${f.de}T00:00:00-03:00`).lte('criado_em', `${f.ate}T23:59:59-03:00`).order('id').range(d, a), 1000, 50000);
  if (error) throw error;
  const todas = (data || []) as any[];
  const prod = todas.filter(x => x.ambiente === 'PRODUCAO');
  const ops = new Map<string, { operacao: string; emitidas: number; autorizadas: number; canceladas: number; erro: number; valor: number }>();
  for (const x of prod) {
    const k = OPERACAO_FISCAL[x.operacao] || x.operacao;
    const g = ops.get(k) || { operacao: k, emitidas: 0, autorizadas: 0, canceladas: 0, erro: 0, valor: 0 };
    g.emitidas++; if (x.status === 'AUTORIZADA') { g.autorizadas++; g.valor += n(x.valor_total); } else if (x.status === 'CANCELADA') g.canceladas++; else if (x.status === 'ERRO') g.erro++;
    ops.set(k, g);
  }
  const autorizadas = prod.filter(x => x.status === 'AUTORIZADA');
  return {
    kpis: {
      autorizadas: autorizadas.length, valor: r2(autorizadas.reduce((s, x) => s + n(x.valor_total), 0)),
      nfe: autorizadas.filter(x => x.tipo === 'NFE').length, nfse: autorizadas.filter(x => x.tipo === 'NFSE').length,
      canceladas: prod.filter(x => x.status === 'CANCELADA').length, erro: prod.filter(x => x.status === 'ERRO').length,
      homologacao: todas.length - prod.length,
    },
    porMes: mesesDoIntervalo(f.de, f.ate).map(m => ({ mes: m, nfe: r2(autorizadas.filter(x => x.tipo === 'NFE' && mesDe(x.criado_em) === m).reduce((s, x) => s + n(x.valor_total), 0)), nfse: r2(autorizadas.filter(x => x.tipo === 'NFSE' && mesDe(x.criado_em) === m).reduce((s, x) => s + n(x.valor_total), 0)) })),
    porOperacao: [...ops.values()].map(o => ({ ...o, valor: r2(o.valor) })).sort((a, b) => b.valor - a.valor),
    notas: todas.sort((a, b) => b.id - a.id).slice(0, 3000).map(x => ({
      data: String(x.criado_em).slice(0, 10), operacao: OPERACAO_FISCAL[x.operacao] || x.operacao, numero: x.numero ? `${x.numero}${x.serie ? `/${x.serie}` : ''}` : '—', cliente: nomeParceiro(x.parceiro),
      valor: r2(n(x.valor_total)), situacao: ({ AUTORIZADA: 'autorizada', CANCELADA: 'cancelada', ERRO: 'erro', PROCESSANDO: 'processando' } as Record<string, string>)[x.status] || x.status,
      ambiente: x.ambiente === 'PRODUCAO' ? 'produção' : 'homologação', observacao: x.status === 'ERRO' ? x.mensagem || '' : x.motivo_cancelamento || '',
    })),
  };
}
