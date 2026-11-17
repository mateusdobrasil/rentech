// app/lib/relatorios/consultas.ts
// Consultas do HUB Relatórios (2026-11-17). Agregam no servidor a partir dos
// espelhos do P2S + dados daqui (o histórico completo do P2S chega pela carga
// de Parâmetros → Histórico do P2S). SEM checagem de acesso: as actions
// validam a rota e passam as empresas permitidas.
//   Vendas        → fichas confirmadas (aprovada/reservada/em locação/finalizada), pela data do evento
//   Orçamentos    → todas as fichas pela data de emissão (sem emissão: data do evento)
//   Financeiro    → financeiro_contas_receber / financeiro_contas_pagar (P2S)
//   Equipamentos  → itens das fichas confirmadas + fichas de locação (saídas/devoluções)
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { numeroFicha } from '../locacao/fichaNumero';

type Db = ReturnType<typeof supabaseAdmin>;
export interface FiltrosRelatorio { de: string; ate: string; empresaIds: number[]; vendedorId?: number | null }

const CONFIRMADAS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const mesDe = (iso: string) => iso.slice(0, 7);
const nomeParceiro = (p: any) => (p ? (p.nome_exibicao || p.nome_completo || '—') : '—');
export const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** O mesmo intervalo, um ano antes. */
export function anoAnterior(f: FiltrosRelatorio): FiltrosRelatorio {
  const menos = (iso: string) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`.replace(/-02-29$/, '-02-28');
  return { ...f, de: menos(f.de), ate: menos(f.ate) };
}
/** Meses (AAAA-MM) do intervalo. */
export function mesesDoIntervalo(de: string, ate: string): string[] {
  const out: string[] = [];
  let a = Number(de.slice(0, 4)), m = Number(de.slice(5, 7));
  const fa = Number(ate.slice(0, 4)), fm = Number(ate.slice(5, 7));
  while (a < fa || (a === fa && m <= fm)) { out.push(`${a}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; a++; } if (out.length > 120) break; }
  return out;
}

async function fichasPorData(db: Db, f: FiltrosRelatorio, campo: 'data_inicio' | 'data_emissao', status: string[] | null, colunas: string) {
  if (!f.empresaIds.length) return [];
  const { data, error } = await buscarTodasPaginas<any>((de, ate) => {
    let q = db.from('locacao_fichas_reserva').select(colunas).in('empresa_id', f.empresaIds).gte(campo, f.de).lte(campo, f.ate);
    if (status) q = q.in('status', status);
    if (f.vendedorId) q = q.eq('vendedor_id', f.vendedorId);
    return q.order('id').range(de, ate);
  }, 1000, 100000);
  if (error) throw error;
  return data;
}

// ============================================================================
// VENDAS
// ============================================================================
export async function relatorioVendas(db: Db, f: FiltrosRelatorio) {
  const col = 'id, origem, p2s_numero, empresa_id, data_inicio, valor_total, vendedor_id, vendedor_nome, parceiro_id, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)';
  const [atual, anterior] = await Promise.all([
    fichasPorData(db, f, 'data_inicio', CONFIRMADAS, col),
    fichasPorData(db, anoAnterior(f), 'data_inicio', CONFIRMADAS, 'data_inicio, valor_total, parceiro_id'),
  ]);
  const total = r2(atual.reduce((s, x) => s + n(x.valor_total), 0));
  const totalAnt = r2(anterior.reduce((s, x) => s + n(x.valor_total), 0));
  const meses = mesesDoIntervalo(f.de, f.ate);
  const porMes = meses.map(m => {
    const mAnt = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
    return {
      mes: m,
      atual: r2(atual.filter(x => mesDe(x.data_inicio) === m).reduce((s, x) => s + n(x.valor_total), 0)),
      anterior: r2(anterior.filter(x => mesDe(x.data_inicio) === mAnt).reduce((s, x) => s + n(x.valor_total), 0)),
    };
  });
  const agrupar = (chave: (x: any) => string, rotulo: (x: any) => string) => {
    const m = new Map<string, { nome: string; fichas: number; total: number; clientes: Set<number> }>();
    for (const x of atual) {
      const k = chave(x);
      const g = m.get(k) || { nome: rotulo(x), fichas: 0, total: 0, clientes: new Set<number>() };
      g.fichas++; g.total += n(x.valor_total); if (x.parceiro_id) g.clientes.add(x.parceiro_id);
      m.set(k, g);
    }
    return [...m.values()].map(g => ({ nome: g.nome, fichas: g.fichas, clientes: g.clientes.size, total: r2(g.total), ticket: r2(g.total / g.fichas), participacao: total ? r2((g.total / total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  };
  return {
    kpis: {
      total, totalAnterior: totalAnt, variacao: totalAnt ? r2(((total - totalAnt) / totalAnt) * 100) : null,
      fichas: atual.length, ticket: atual.length ? r2(total / atual.length) : 0,
      clientes: new Set(atual.map(x => x.parceiro_id)).size,
    },
    porMes,
    porVendedor: agrupar(x => String(x.vendedor_id || x.vendedor_nome || '—'), x => x.vendedor_nome || '— sem vendedor —'),
    porCliente: agrupar(x => String(x.parceiro_id), x => nomeParceiro(x.parceiro)).slice(0, 50),
    porEvento: agrupar(x => x.evento?.nome || '— sem evento —', x => x.evento?.nome || '— sem evento —').slice(0, 50),
  };
}

// ============================================================================
// ORÇAMENTOS E CONVERSÃO
// ============================================================================
export async function relatorioOrcamentos(db: Db, f: FiltrosRelatorio) {
  const col = 'id, origem, p2s_numero, status, data_emissao, data_inicio, validade_orcamento, aprovado_em, valor_total, vendedor_id, vendedor_nome, motivo_perda, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)';
  // emissão no período; fichas sem emissão (P2S ainda não reimportadas) entram pela data do evento
  const [comEmissao, semEmissao] = await Promise.all([
    fichasPorData(db, f, 'data_emissao', null, col),
    (async () => (await fichasPorData(db, f, 'data_inicio', null, col)).filter(x => !x.data_emissao))(),
  ]);
  const lista = [...comEmissao, ...semEmissao];
  const grupo = (s: string) => (CONFIRMADAS.includes(s) ? 'APROVADO' : s === 'PERDIDO' ? 'PERDIDO' : s === 'CANCELADA' ? 'CANCELADO' : 'ABERTO');
  const soma = (xs: any[]) => r2(xs.reduce((s, x) => s + n(x.valor_total), 0));
  const aprovados = lista.filter(x => grupo(x.status) === 'APROVADO');
  const perdidos = lista.filter(x => grupo(x.status) === 'PERDIDO');
  const abertos = lista.filter(x => grupo(x.status) === 'ABERTO');
  const decididos = aprovados.length + perdidos.length;
  const prazos = aprovados.filter(x => x.aprovado_em && (x.data_emissao || x.data_inicio))
    .map(x => (Date.parse(x.aprovado_em) - Date.parse(`${x.data_emissao || x.data_inicio}T12:00:00Z`)) / 86_400_000).filter(d => d >= 0 && d < 400);
  const dataRef = (x: any) => x.data_emissao || x.data_inicio;
  const porMes = mesesDoIntervalo(f.de, f.ate).map(m => {
    const doMes = lista.filter(x => mesDe(dataRef(x)) === m);
    return { mes: m, emitidos: doMes.length, aprovados: doMes.filter(x => grupo(x.status) === 'APROVADO').length };
  });
  const vend = new Map<string, any>();
  for (const x of lista) {
    const k = String(x.vendedor_id || x.vendedor_nome || '—');
    const g = vend.get(k) || { nome: x.vendedor_nome || '— sem vendedor —', emitidos: 0, aprovados: 0, perdidos: 0, abertos: 0, valorEmitido: 0, valorAprovado: 0 };
    g.emitidos++; g.valorEmitido += n(x.valor_total);
    const gr = grupo(x.status);
    if (gr === 'APROVADO') { g.aprovados++; g.valorAprovado += n(x.valor_total); } else if (gr === 'PERDIDO') g.perdidos++; else if (gr === 'ABERTO') g.abertos++;
    vend.set(k, g);
  }
  const motivos = new Map<string, { motivo: string; qtd: number; valor: number }>();
  for (const x of perdidos) {
    const k = (x.motivo_perda || '— sem motivo informado —').trim().toUpperCase().slice(0, 80);
    const g = motivos.get(k) || { motivo: k, qtd: 0, valor: 0 };
    g.qtd++; g.valor += n(x.valor_total); motivos.set(k, g);
  }
  return {
    kpis: {
      emitidos: lista.length, valorEmitido: soma(lista),
      aprovados: aprovados.length, valorAprovado: soma(aprovados),
      perdidos: perdidos.length, valorPerdido: soma(perdidos),
      abertos: abertos.length, valorAberto: soma(abertos),
      taxa: decididos ? r2((aprovados.length / decididos) * 100) : null,
      prazoMedioDias: prazos.length ? Math.round(prazos.reduce((s, d) => s + d, 0) / prazos.length) : null,
      semEmissao: semEmissao.length,
    },
    porMes,
    porVendedor: [...vend.values()].map(g => ({ ...g, valorEmitido: r2(g.valorEmitido), valorAprovado: r2(g.valorAprovado), taxa: g.aprovados + g.perdidos ? r2((g.aprovados / (g.aprovados + g.perdidos)) * 100) : null }))
      .sort((a, b) => b.valorAprovado - a.valorAprovado),
    motivosPerda: [...motivos.values()].map(m => ({ ...m, valor: r2(m.valor) })).sort((a, b) => b.qtd - a.qtd),
    emAberto: abertos.sort((a, b) => String(a.validade_orcamento || '9').localeCompare(String(b.validade_orcamento || '9'))).slice(0, 200).map(x => ({
      ficha: numeroFicha(x), cliente: nomeParceiro(x.parceiro), evento: x.evento?.nome || '—', vendedor: x.vendedor_nome || '—',
      emissao: x.data_emissao, validade: x.validade_orcamento, inicio: x.data_inicio, valor: r2(n(x.valor_total)), status: x.status,
    })),
  };
}

// ============================================================================
// FINANCEIRO
// ============================================================================
async function titulos(db: Db, tabela: 'financeiro_contas_receber' | 'financeiro_contas_pagar', colunas: string, montar: (q: any) => any, empresaIds: number[]) {
  const { data, error } = await buscarTodasPaginas<any>((de, ate) => montar(db.from(tabela).select(colunas).in('empresa_id', empresaIds)).order('id').range(de, ate), 1000, 200000);
  if (error) throw error;
  return data;
}

export async function relatorioFinanceiro(db: Db, f: FiltrosRelatorio) {
  if (!f.empresaIds.length) return null;
  const hoje = hojeISO();
  const colR = 'id, cliente, descricao, valor_final, valor_pago, data_vencimento, data_quitacao, quitado, centro_financeiro';
  const colP = 'id, fornecedor, descricao, valor, valor_pago, data_vencimento, data_quitacao, quitado, centro, sub_centro';
  const [recebidos, aReceber, vencidos, pagos, aPagar] = await Promise.all([
    titulos(db, 'financeiro_contas_receber', colR, q => q.eq('quitado', true).gte('data_quitacao', f.de).lte('data_quitacao', f.ate), f.empresaIds),
    titulos(db, 'financeiro_contas_receber', colR, q => q.eq('quitado', false).gte('data_vencimento', f.de).lte('data_vencimento', f.ate), f.empresaIds),
    titulos(db, 'financeiro_contas_receber', colR, q => q.eq('quitado', false).lt('data_vencimento', hoje), f.empresaIds),
    titulos(db, 'financeiro_contas_pagar', colP, q => q.eq('quitado', true).gte('data_quitacao', f.de).lte('data_quitacao', f.ate), f.empresaIds),
    titulos(db, 'financeiro_contas_pagar', colP, q => q.eq('quitado', false).gte('data_vencimento', f.de).lte('data_vencimento', f.ate), f.empresaIds),
  ]);
  const vR = (x: any) => n(x.valor_pago) || n(x.valor_final);
  const vRab = (x: any) => n(x.valor_final) - n(x.valor_pago);
  const vP = (x: any) => n(x.valor_pago) || n(x.valor);
  const vPab = (x: any) => n(x.valor) - n(x.valor_pago);
  const soma = (xs: any[], fn: (x: any) => number) => r2(xs.reduce((s, x) => s + fn(x), 0));
  const totalRecebido = soma(recebidos, vR), totalPago = soma(pagos, vP);

  const porMes = mesesDoIntervalo(f.de, f.ate).map(m => ({
    mes: m,
    recebido: soma(recebidos.filter(x => mesDe(x.data_quitacao || '') === m), vR),
    pago: soma(pagos.filter(x => mesDe(x.data_quitacao || '') === m), vP),
  }));
  const dias = (iso: string) => Math.floor((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86_400_000);
  const faixas = [['1 a 30 dias', 1, 30], ['31 a 60 dias', 31, 60], ['61 a 90 dias', 61, 90], ['91 a 365 dias', 91, 365], ['mais de 1 ano', 366, 1e9]] as const;
  const aging = faixas.map(([rot, a, b]) => {
    const xs = vencidos.filter(x => { const d = dias(x.data_vencimento); return d >= a && d <= b; });
    return { faixa: rot, titulos: xs.length, valor: soma(xs, vRab) };
  });
  const dev = new Map<string, { cliente: string; titulos: number; valor: number; maisAntigo: string }>();
  for (const x of vencidos) {
    const k = (x.cliente || '—').trim();
    const g = dev.get(k) || { cliente: k, titulos: 0, valor: 0, maisAntigo: x.data_vencimento };
    g.titulos++; g.valor += vRab(x); if (x.data_vencimento < g.maisAntigo) g.maisAntigo = x.data_vencimento;
    dev.set(k, g);
  }
  const cat = new Map<string, { categoria: string; titulos: number; valor: number }>();
  for (const x of pagos) {
    const k = [x.centro, x.sub_centro].filter(Boolean).join(' / ') || '— sem categoria —';
    const g = cat.get(k) || { categoria: k, titulos: 0, valor: 0 };
    g.titulos++; g.valor += vP(x); cat.set(k, g);
  }
  return {
    kpis: {
      recebido: totalRecebido, aReceber: soma(aReceber, vRab), pago: totalPago, aPagar: soma(aPagar, vPab),
      saldo: r2(totalRecebido - totalPago), vencido: soma(vencidos, vRab), vencidoTitulos: vencidos.length,
      vencidoAteUmAno: soma(vencidos.filter(x => dias(x.data_vencimento) <= 365), vRab),
    },
    porMes,
    aging,
    devedores: [...dev.values()].map(d => ({ ...d, valor: r2(d.valor) })).sort((a, b) => b.valor - a.valor).slice(0, 50),
    pagosPorCategoria: [...cat.values()].map(c => ({ ...c, valor: r2(c.valor), participacao: totalPago ? r2((c.valor / totalPago) * 100) : 0 })).sort((a, b) => b.valor - a.valor),
  };
}

// ============================================================================
// EQUIPAMENTOS / OPERAÇÃO
// ============================================================================
export async function relatorioEquipamentos(db: Db, f: FiltrosRelatorio) {
  const fichas = await fichasPorData(db, f, 'data_inicio', CONFIRMADAS, 'id');
  const ids = fichas.map(x => x.id);
  const itens: any[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db.from('locacao_fichas_reserva_itens')
      .select('ficha_id, produto_id, quantidade, dias, valor_total, produto:produtos(nome_item, codigo_formatado, categoria_nome)')
      .in('ficha_id', ids.slice(i, i + 300)).not('produto_id', 'is', null);
    if (error) throw error;
    itens.push(...(data || []));
  }
  const prod = new Map<number, any>();
  for (const it of itens) {
    const g = prod.get(it.produto_id) || { produto: it.produto?.nome_item || `#${it.produto_id}`, codigo: it.produto?.codigo_formatado || '', categoria: (it.produto?.categoria_nome || '—').replace(/^\s*\d+\s*-\s*/, ''), locacoes: new Set<number>(), quantidade: 0, diarias: 0, receita: 0 };
    g.locacoes.add(it.ficha_id); g.quantidade += n(it.quantidade); g.diarias += n(it.quantidade) * (n(it.dias) || 1); g.receita += n(it.valor_total);
    prod.set(it.produto_id, g);
  }
  const porProduto = [...prod.entries()].map(([id, g]) => ({ produto_id: id, produto: g.produto, codigo: g.codigo, categoria: g.categoria, locacoes: g.locacoes.size, quantidade: r2(g.quantidade), diarias: r2(g.diarias), receita: r2(g.receita) }))
    .sort((a, b) => b.receita - a.receita);
  const cat = new Map<string, { categoria: string; produtos: number; locacoes: number; receita: number }>();
  for (const p of porProduto) {
    const g = cat.get(p.categoria) || { categoria: p.categoria, produtos: 0, locacoes: 0, receita: 0 };
    g.produtos++; g.locacoes += p.locacoes; g.receita += p.receita; cat.set(p.categoria, g);
  }
  // nunca alugados no período (habilitados para locação)
  const { data: habilitados } = await buscarTodasPaginas<any>((de, ate) => db.from('produtos').select('id, nome_item, codigo_formatado, categoria_nome')
    .eq('habilitado_para_locacao', true).eq('flag_em_desuso', false).order('id').range(de, ate), 1000, 20000);
  const parados = (habilitados || []).filter((p: any) => !prod.has(p.id)).map((p: any) => ({ produto: p.nome_item, codigo: p.codigo_formatado || '', categoria: (p.categoria_nome || '—').replace(/^\s*\d+\s*-\s*/, '') }))
    .sort((a: any, b: any) => a.categoria.localeCompare(b.categoria) || a.produto.localeCompare(b.produto));

  // operação: fichas de locação (saídas / devoluções) — chegam pela carga do histórico do P2S
  const hoje = hojeISO();
  const { data: fl } = await buscarTodasPaginas<any>((de, ate) => db.from('locacao_fichas_locacao')
    .select('id, numero, data_saida, data_devolucao, status, parceiro:parceiros(nome_exibicao, nome_completo), reserva:locacao_fichas_reserva(data_fim, data_retorno)')
    .in('empresa_id', f.empresaIds.length ? f.empresaIds : [0]).gte('data_saida', f.de).lte('data_saida', f.ate).order('id').range(de, ate), 1000, 50000);
  const saidas = (fl || []) as any[];
  const atrasadas = saidas.filter(x => !x.data_devolucao && (x.reserva?.data_retorno || x.reserva?.data_fim) && (x.reserva.data_retorno || x.reserva.data_fim) < hoje)
    .map(x => ({ ficha: x.numero, cliente: nomeParceiro(x.parceiro), saida: x.data_saida, retornoPrevisto: x.reserva.data_retorno || x.reserva.data_fim, diasAtraso: Math.floor((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${x.reserva.data_retorno || x.reserva.data_fim}T12:00:00Z`)) / 86_400_000) }))
    .sort((a, b) => b.diasAtraso - a.diasAtraso);
  return {
    kpis: {
      receita: r2(porProduto.reduce((s, p) => s + p.receita, 0)), produtosLocados: porProduto.length,
      unidades: r2(porProduto.reduce((s, p) => s + p.quantidade, 0)), fichas: ids.length, parados: parados.length,
      saidas: saidas.length, devolvidas: saidas.filter(x => x.data_devolucao).length, atrasadas: atrasadas.length,
    },
    porProduto: porProduto.slice(0, 300),
    porCategoria: [...cat.values()].map(c => ({ ...c, receita: r2(c.receita) })).sort((a, b) => b.receita - a.receita),
    parados: parados.slice(0, 500),
    atrasadas: atrasadas.slice(0, 200),
  };
}
