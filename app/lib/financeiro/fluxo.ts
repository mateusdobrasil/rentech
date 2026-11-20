// app/lib/financeiro/fluxo.ts
// FLUXO DE CAIXA e DRE (Financeiro completo, 2026-11-20). Só servidor, sem
// checagem de acesso.
//
// Fluxo: saldo das contas no dia anterior ao período + REALIZADO (movimentos,
//   sem transferências entre contas) até hoje + PREVISTO a partir de amanhã
//   (a pagar / a receber em aberto pelo vencimento). Vencidos em aberto ficam
//   à parte. A fonte do previsto segue a empresa (P2S até a virada).
// DRE: receitas − despesas pelo plano de contas, mês a mês, regime de CAIXA
//   (pela data do pagamento) ou de COMPETÊNCIA (emissão/competência). Centros
//   de movimentação financeira (empréstimo, resgate, aplicação, devolução,
//   conta garantida, sócios, investimento) ficam fora do resultado operacional.
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { hojeISO, somarDias } from '../locacao/datas';
import { contasComSaldo, fontesDasEmpresas } from './caixa';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
const limpo = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export type Agrupamento = 'DIA' | 'SEMANA' | 'MES';

function chavePeriodo(iso: string, g: Agrupamento): string {
  if (g === 'DIA') return iso;
  if (g === 'MES') return iso.slice(0, 7);
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  return somarDias(iso, -dow);
}
function periodos(de: string, ate: string, g: Agrupamento): string[] {
  const out: string[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) { const k = chavePeriodo(d, g); if (out[out.length - 1] !== k) out.push(k); }
  return out;
}

export interface LinhaFluxo { periodo: string; entradas_realizadas: number; saidas_realizadas: number; entradas_previstas: number; saidas_previstas: number; saldo: number }
export interface ItemPrevisto { data: string; tipo: 'ENTRADA' | 'SAIDA'; nome: string; descricao: string; valor: number; origem: string }

/** Previstos em aberto (a pagar/receber) por vencimento — pela fonte de cada empresa. */
async function previstos(db: Db, empresaIds: number[], de: string, ate: string): Promise<ItemPrevisto[]> {
  const fontes = await fontesDasEmpresas(db, empresaIds);
  const p2s = empresaIds.filter(id => fontes.get(id) === 'P2S');
  const sis = empresaIds.filter(id => fontes.get(id) === 'SISTEMA');
  const out: ItemPrevisto[] = [];
  const pag = <T,>(fn: (d: number, a: number) => any) => buscarTodasPaginas<T>(fn, 1000, 100000);
  if (p2s.length) {
    const [rc, pg, ops] = await Promise.all([
      pag<any>((d, a) => db.from('financeiro_contas_receber').select('cliente, descricao, valor_final, data_vencimento').in('empresa_id', p2s).eq('quitado', false).gte('data_vencimento', de).lte('data_vencimento', ate).order('id').range(d, a)),
      pag<any>((d, a) => db.from('financeiro_contas_pagar').select('fornecedor, descricao, valor, data_vencimento').in('empresa_id', p2s).eq('quitado', false).gte('data_vencimento', de).lte('data_vencimento', ate).order('id').range(d, a)),
      db.from('op_ordens_pagamento').select('numero_op, empresa_recebedora, natureza_pagamento, total_geral, data_vencimento').in('empresa_id', p2s).eq('status', 'PENDENTE').is('p2s_conta_pagar_oid', null).lte('data_vencimento', ate),
    ]);
    for (const r of rc.data || []) out.push({ data: r.data_vencimento, tipo: 'ENTRADA', nome: limpo(r.cliente) || '(sem cliente)', descricao: limpo(r.descricao), valor: n(r.valor_final), origem: 'A receber (P2S)' });
    for (const p of pg.data || []) out.push({ data: p.data_vencimento, tipo: 'SAIDA', nome: limpo(p.fornecedor) || '(sem fornecedor)', descricao: limpo(p.descricao), valor: n(p.valor), origem: 'A pagar (P2S)' });
    // OP ainda não lançada no P2S (não conta duas vezes); vencida entra no 1º dia
    for (const o of (ops.data || []) as any[]) out.push({ data: o.data_vencimento && o.data_vencimento >= de ? o.data_vencimento : de, tipo: 'SAIDA', nome: `OP ${o.numero_op} · ${limpo(o.empresa_recebedora)}`, descricao: limpo(o.natureza_pagamento), valor: n(o.total_geral), origem: 'OP pendente' });
  }
  if (sis.length) {
    const [rc, pg] = await Promise.all([
      pag<any>((d, a) => db.from('financeiro_titulos_receber').select('descricao, valor, vencimento, parceiro:parceiros(nome_exibicao, nome_completo)').in('empresa_id', sis).eq('status', 'ABERTO').gte('vencimento', de).lte('vencimento', ate).order('id').range(d, a)),
      pag<any>((d, a) => db.from('financeiro_titulos_pagar').select('fornecedor_nome, descricao, valor, vencimento').in('empresa_id', sis).eq('status', 'ABERTO').gte('vencimento', de).lte('vencimento', ate).order('id').range(d, a)),
    ]);
    for (const r of rc.data || []) out.push({ data: r.vencimento, tipo: 'ENTRADA', nome: limpo(r.parceiro?.nome_exibicao || r.parceiro?.nome_completo) || '—', descricao: limpo(r.descricao), valor: n(r.valor), origem: 'Título a receber' });
    for (const p of pg.data || []) out.push({ data: p.vencimento, tipo: 'SAIDA', nome: limpo(p.fornecedor_nome), descricao: limpo(p.descricao), valor: n(p.valor), origem: 'Conta a pagar' });
  }
  return out;
}

export async function fluxoCaixa(db: Db, empresaIds: number[], de: string, ate: string, g: Agrupamento) {
  const hoje = hojeISO();
  const contas = (await contasComSaldo(db, empresaIds, somarDias(de, -1))).filter(c => c.ativa);
  const saldoInicial = arred(contas.reduce((a, c) => a + c.saldo, 0));
  const ps = periodos(de, ate, g);
  const linhas = new Map<string, LinhaFluxo>(ps.map(p => [p, { periodo: p, entradas_realizadas: 0, saidas_realizadas: 0, entradas_previstas: 0, saidas_previstas: 0, saldo: 0 }]));

  // realizado (até hoje), sem transferências internas
  const fimReal = ate < hoje ? ate : hoje;
  if (de <= fimReal && contas.length) {
    const { data: movs, error } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_movimentos').select('data, tipo, valor, origem, conta_id')
      .in('conta_id', contas.map(c => c.id)).gte('data', de).lte('data', fimReal).neq('origem', 'TRANSFERENCIA').order('id').range(d, a), 1000, 300000);
    if (error) throw error;
    const inicioConta = new Map(contas.map(c => [c.id, c.data_saldo_inicial]));
    for (const m of movs) {
      if (m.data <= (inicioConta.get(m.conta_id) || '')) continue;
      const l = linhas.get(chavePeriodo(m.data, g));
      if (!l) continue;
      if (m.tipo === 'ENTRADA') l.entradas_realizadas += n(m.valor); else l.saidas_realizadas += n(m.valor);
    }
  }
  // previsto (a partir de amanhã)
  const inicioPrev = somarDias(hoje, 1) > de ? somarDias(hoje, 1) : de;
  const prev = inicioPrev <= ate ? await previstos(db, empresaIds, inicioPrev, ate) : [];
  for (const p of prev) {
    const l = linhas.get(chavePeriodo(p.data, g));
    if (!l) continue;
    if (p.tipo === 'ENTRADA') l.entradas_previstas += p.valor; else l.saidas_previstas += p.valor;
  }
  let saldo = saldoInicial;
  const lista = [...linhas.values()].map(l => {
    saldo += l.entradas_realizadas - l.saidas_realizadas + l.entradas_previstas - l.saidas_previstas;
    return { ...l, entradas_realizadas: arred(l.entradas_realizadas), saidas_realizadas: arred(l.saidas_realizadas), entradas_previstas: arred(l.entradas_previstas), saidas_previstas: arred(l.saidas_previstas), saldo: arred(saldo) };
  });
  // vencidos em aberto (até 90 dias) — fora da projeção
  const venc = await previstos(db, empresaIds, somarDias(hoje, -90), somarDias(hoje, -1));
  const top = (t: 'ENTRADA' | 'SAIDA') => prev.filter(p => p.tipo === t).sort((a, b) => b.valor - a.valor).slice(0, 15);
  return {
    de, ate, agrupamento: g, hoje, saldo_inicial: saldoInicial, saldo_final: arred(saldo), linhas: lista,
    contas_sem_saldo: contas.length === 0,
    vencidos: {
      receber: arred(venc.filter(v => v.tipo === 'ENTRADA').reduce((a, v) => a + v.valor, 0)),
      pagar: arred(venc.filter(v => v.tipo === 'SAIDA' && v.origem !== 'OP pendente').reduce((a, v) => a + v.valor, 0)),
    },
    maiores_entradas: top('ENTRADA'), maiores_saidas: top('SAIDA'),
  };
}

// ============================================================================
// DRE
// ============================================================================
// investimento (compra de equipamento) também fica fora do resultado operacional
const NAO_OPERACIONAL = /EMPR[EÉ]STIMO|RESGATE|APLICA[ÇC][ÃA]O|CONTA GARANTIDA|DEVOLU[ÇC][ÃA]O|TRANSFER[EÊ]NCIA|S[ÓO]CIOS|INVESTIMENTO/i;
const semCodigo = (s: string) => limpo(s).replace(/^\d+(\.\d+)*\s*-?\s*/, '').trim() || limpo(s);

export interface LinhaDre { grupo: string; centro: string; sub: string; meses: Record<string, number>; total: number }

export async function dre(db: Db, empresaIds: number[], de: string, ate: string, regime: 'CAIXA' | 'COMPETENCIA') {
  const fontes = await fontesDasEmpresas(db, empresaIds);
  const p2s = empresaIds.filter(id => fontes.get(id) === 'P2S');
  const sis = empresaIds.filter(id => fontes.get(id) === 'SISTEMA');
  const meses: string[] = [];
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7); ) { meses.push(m); const [y, mm] = m.split('-').map(Number); m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`; }
  const acc = new Map<string, LinhaDre>();
  const somar = (tipo: 'RECEITA' | 'DESPESA', centro: string, sub: string, data: string | null, valor: number) => {
    if (!data || data < de || data > ate || !(valor > 0)) return;
    const c = semCodigo(centro || 'SEM CLASSIFICAÇÃO').toUpperCase();
    const grupo = NAO_OPERACIONAL.test(c) ? (tipo === 'RECEITA' ? 'ENTRADA_FINANCEIRA' : 'SAIDA_FINANCEIRA') : tipo;
    const k = `${grupo}|${c}|${limpo(sub)}`;
    const l = acc.get(k) || { grupo, centro: c, sub: limpo(sub) || '—', meses: {}, total: 0 };
    const mes = data.slice(0, 7);
    l.meses[mes] = (l.meses[mes] || 0) + valor;
    l.total += valor;
    acc.set(k, l);
  };
  const pag = <T,>(fn: (d: number, a: number) => any) => buscarTodasPaginas<T>(fn, 1000, 200000);
  const caixa = regime === 'CAIXA';

  if (p2s.length) {
    const [rc, pg] = await Promise.all([
      caixa
        ? pag<any>((d, a) => db.from('financeiro_contas_receber').select('centro_financeiro, sub_centro, valor_pago, valor_final, data_quitacao').in('empresa_id', p2s).eq('quitado', true).gte('data_quitacao', de).lte('data_quitacao', ate).order('id').range(d, a))
        : pag<any>((d, a) => db.from('financeiro_contas_receber').select('centro_financeiro, sub_centro, valor_final, data_competencia, data_emissao, data_vencimento').in('empresa_id', p2s).gte('data_vencimento', somarDias(de, -120)).lte('data_vencimento', somarDias(ate, 120)).order('id').range(d, a)),
      caixa
        ? pag<any>((d, a) => db.from('financeiro_contas_pagar').select('centro, sub_centro, valor_pago, valor, data_quitacao').in('empresa_id', p2s).eq('quitado', true).gte('data_quitacao', de).lte('data_quitacao', ate).order('id').range(d, a))
        : pag<any>((d, a) => db.from('financeiro_contas_pagar').select('centro, sub_centro, valor, data_emissao, data_vencimento').in('empresa_id', p2s).gte('data_vencimento', somarDias(de, -120)).lte('data_vencimento', somarDias(ate, 120)).order('id').range(d, a)),
    ]);
    if (rc.error) throw rc.error;
    if (pg.error) throw pg.error;
    for (const r of rc.data) {
      const centro = limpo(String(r.centro_financeiro || '').split(/\r?\n/)[0]), sub = limpo(String(r.sub_centro || '').split(/\r?\n/)[0]);
      somar('RECEITA', centro, sub, caixa ? r.data_quitacao : (r.data_competencia || r.data_emissao || r.data_vencimento), caixa ? (n(r.valor_pago) || n(r.valor_final)) : n(r.valor_final));
    }
    for (const p of pg.data) somar('DESPESA', p.centro, p.sub_centro, caixa ? p.data_quitacao : (p.data_emissao || p.data_vencimento), caixa ? (n(p.valor_pago) || n(p.valor)) : n(p.valor));
  }
  if (sis.length) {
    const ORIGEM_RECEITA: Record<string, string> = { FICHA: 'LOCAÇÃO', AVARIA: 'REPOSIÇÃO', REPOSICAO: 'REPOSIÇÃO', AVULSO: 'OUTRAS RECEITAS' };
    const [rc, pg] = await Promise.all([
      pag<any>((d, a) => db.from('financeiro_titulos_receber').select('origem, valor, valor_pago, status, data_pagamento, data_emissao').in('empresa_id', sis).neq('status', 'CANCELADO').order('id').range(d, a)),
      pag<any>((d, a) => db.from('financeiro_titulos_pagar').select('valor, valor_pago, status, data_pagamento, competencia, vencimento, subcentro:financeiro_subcentros(nome_p2s, centro:financeiro_centros(nome))').in('empresa_id', sis).neq('status', 'CANCELADO').order('id').range(d, a)),
    ]);
    for (const r of rc.data || []) {
      if (caixa && r.status !== 'PAGO') continue;
      somar('RECEITA', ORIGEM_RECEITA[r.origem] || 'OUTRAS RECEITAS', '', caixa ? r.data_pagamento : r.data_emissao, caixa ? (n(r.valor_pago) || n(r.valor)) : n(r.valor));
    }
    for (const p of pg.data || []) {
      if (caixa && p.status !== 'PAGO') continue;
      somar('DESPESA', p.subcentro?.centro?.nome || 'SEM CLASSIFICAÇÃO', p.subcentro?.nome_p2s || '', caixa ? p.data_pagamento : (p.competencia || p.vencimento), caixa ? (n(p.valor_pago) || n(p.valor)) : n(p.valor));
    }
  }
  // lançamentos avulsos classificados (tarifa, rendimento…) — regime de caixa nos dois casos
  const { data: contas } = await db.from('financeiro_contas').select('id').in('empresa_id', empresaIds.length ? empresaIds : [0]);
  if (contas?.length) {
    const { data: av } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_movimentos').select('tipo, valor, data, categoria, subcentro:financeiro_subcentros(nome_p2s), centro:financeiro_centros(nome)')
      .in('conta_id', (contas as any[]).map(c => c.id)).in('origem', ['MANUAL', 'AJUSTE', 'EXTRATO']).gte('data', de).lte('data', ate).order('id').range(d, a), 1000, 100000);
    for (const m of av || []) somar(m.tipo === 'ENTRADA' ? 'RECEITA' : 'DESPESA', m.centro?.nome || m.categoria || 'AVULSOS', m.subcentro?.nome_p2s || '', m.data, n(m.valor));
  }

  const linhas = [...acc.values()].map(l => ({ ...l, total: arred(l.total), meses: Object.fromEntries(Object.entries(l.meses).map(([k, v]) => [k, arred(v)])) }))
    .sort((a, b) => a.grupo.localeCompare(b.grupo) || b.total - a.total);
  const totalGrupo = (g: string) => {
    const meses_: Record<string, number> = {};
    let t = 0;
    for (const l of linhas.filter(x => x.grupo === g)) { t += l.total; for (const [m, v] of Object.entries(l.meses)) meses_[m] = (meses_[m] || 0) + v; }
    return { meses: Object.fromEntries(Object.entries(meses_).map(([k, v]) => [k, arred(v)])), total: arred(t) };
  };
  const rec = totalGrupo('RECEITA'), desp = totalGrupo('DESPESA'), entF = totalGrupo('ENTRADA_FINANCEIRA'), saiF = totalGrupo('SAIDA_FINANCEIRA');
  const sub = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(meses.map(m => [m, arred((a[m] || 0) - (b[m] || 0))]));
  const resultadoOp = { meses: sub(rec.meses, desp.meses), total: arred(rec.total - desp.total) };
  const liquido = { meses: Object.fromEntries(meses.map(m => [m, arred(resultadoOp.meses[m] + (entF.meses[m] || 0) - (saiF.meses[m] || 0))])), total: arred(resultadoOp.total + entF.total - saiF.total) };
  return { de, ate, regime, meses, linhas, totais: { receitas: rec, despesas: desp, resultado_operacional: resultadoOp, entradas_financeiras: entF, saidas_financeiras: saiF, resultado_liquido: liquido }, fontes: Object.fromEntries(fontes) };
}
