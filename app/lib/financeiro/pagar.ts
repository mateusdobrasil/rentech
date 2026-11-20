// app/lib/financeiro/pagar.ts
// CONTAS A PAGAR PRÓPRIO + RECORRENTES + OP (Financeiro completo, 2026-11-20).
// Só servidor, sem checagem de acesso.
//
//   * Título a pagar (financeiro_titulos_pagar): lançamento direto (boleto,
//     imposto, fornecedor), gerado por RECORRÊNCIA (aluguel, luz…) ou por OP.
//   * Baixa: com fonte SISTEMA gera o movimento de saída na conta (caixa);
//     com fonte P2S (transição, P2S oficial) a baixa fica registrada aqui mas
//     NÃO movimenta o caixa — o pagamento real entra pelo espelho do P2S.
//   * Recorrência: gera os títulos dos próximos 45 dias (um por vencimento —
//     índice único recorrencia+vencimento), valor base editável antes de pagar.
//   * OP: cada OP (desde DATA_INICIO_OPS, ou pendente) tem um título; OP PAGA
//     baixa o título, REPROVADA cancela.
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { hojeISO, somarDias, dataValida } from '../locacao/datas';
import { fontesDasEmpresas } from './caixa';
import { randomUUID } from 'crypto';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
const limpo = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const DATA_INICIO_OPS = '2026-11-01';
const HORIZONTE_RECORRENCIA = 45;

// ============================================================================
// TÍTULOS
// ============================================================================
export interface DadosTitulo {
  empresa_id: number;
  fornecedor_id?: number | null;
  fornecedor_nome: string;
  descricao: string;
  documento?: string | null;
  subcentro_id?: number | null;
  competencia?: string | null;
  vencimento: string;
  valor: number;
  parcelas?: number;              // só na criação: divide o valor em N parcelas mensais
  forma_pagamento?: string | null;
  boleto_linha?: string | null;
  pix_chave?: string | null;
  conta_prevista_id?: number | null;
  observacoes?: string | null;
}

function validar(d: DadosTitulo): string | null {
  if (!d.empresa_id) return 'Escolha a empresa.';
  if (!limpo(d.fornecedor_nome)) return 'Informe o fornecedor.';
  if (!limpo(d.descricao)) return 'Descreva a conta.';
  if (!dataValida(d.vencimento)) return 'Informe o vencimento.';
  if (d.competencia && !dataValida(d.competencia)) return 'Competência inválida.';
  if (!(n(d.valor) > 0)) return 'Valor inválido.';
  return null;
}
const mesmoDiaMesSeguinte = (iso: string, k: number) => {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + k, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
};

export async function criarTitulo(db: Db, d: DadosTitulo, usuario: string): Promise<number[]> {
  const erro = validar(d);
  if (erro) throw new Error(erro);
  const parcelas = Math.max(1, Math.min(60, Math.floor(n(d.parcelas) || 1)));
  const total = arred(n(d.valor));
  const base = Math.floor((total / parcelas) * 100) / 100;
  const grupo = parcelas > 1 ? randomUUID() : null;
  const linhas = Array.from({ length: parcelas }, (_, i) => ({
    empresa_id: d.empresa_id, origem: 'MANUAL', fornecedor_id: d.fornecedor_id || null, fornecedor_nome: limpo(d.fornecedor_nome).toUpperCase(),
    descricao: limpo(d.descricao) + (parcelas > 1 ? ` (${i + 1}/${parcelas})` : ''), documento: limpo(d.documento) || null,
    subcentro_id: d.subcentro_id || null, competencia: d.competencia || null, vencimento: mesmoDiaMesSeguinte(d.vencimento, i),
    valor: i === parcelas - 1 ? arred(total - base * (parcelas - 1)) : base, parcela: i + 1, total_parcelas: parcelas, grupo_parcelas: grupo,
    forma_pagamento: d.forma_pagamento || null, boleto_linha: limpo(d.boleto_linha) || null, pix_chave: limpo(d.pix_chave) || null,
    conta_prevista_id: d.conta_prevista_id || null, observacoes: limpo(d.observacoes) || null, criado_por: usuario,
  }));
  const { data, error } = await db.from('financeiro_titulos_pagar').insert(linhas).select('id');
  if (error) throw error;
  return ((data || []) as any[]).map(x => x.id);
}

export async function editarTitulo(db: Db, id: number, d: Omit<DadosTitulo, 'parcelas'>) {
  const { data: t } = await db.from('financeiro_titulos_pagar').select('status, origem').eq('id', id).maybeSingle();
  if (!t) throw new Error('Conta não encontrada.');
  if (t.status !== 'ABERTO') throw new Error('Só conta em aberto pode ser editada.');
  const erro = validar(d);
  if (erro) throw new Error(erro);
  const { error } = await db.from('financeiro_titulos_pagar').update({
    fornecedor_id: d.fornecedor_id || null, fornecedor_nome: limpo(d.fornecedor_nome).toUpperCase(), descricao: limpo(d.descricao), documento: limpo(d.documento) || null,
    subcentro_id: d.subcentro_id || null, competencia: d.competencia || null, vencimento: d.vencimento, valor: arred(n(d.valor)),
    forma_pagamento: d.forma_pagamento || null, boleto_linha: limpo(d.boleto_linha) || null, pix_chave: limpo(d.pix_chave) || null,
    conta_prevista_id: d.conta_prevista_id || null, observacoes: limpo(d.observacoes) || null, atualizado_em: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

/** Baixa: com fonte SISTEMA gera a saída na conta; com fonte P2S só registra (o P2S é oficial). */
export async function baixarTitulo(db: Db, id: number, b: { data_pagamento: string; conta_id: number | null; juros_multa?: number; desconto?: number; valor_pago?: number | null }, usuario: string) {
  const { data: t } = await db.from('financeiro_titulos_pagar').select('*, subcentro:financeiro_subcentros(centro_id)').eq('id', id).maybeSingle();
  if (!t) throw new Error('Conta não encontrada.');
  if (t.status !== 'ABERTO') throw new Error('Esta conta não está em aberto.');
  if (!dataValida(b.data_pagamento)) throw new Error('Data do pagamento inválida.');
  const juros = arred(n(b.juros_multa)), desc = arred(n(b.desconto));
  const pago = arred(b.valor_pago != null ? n(b.valor_pago) : n(t.valor) + juros - desc);
  if (!(pago > 0)) throw new Error('Valor pago inválido.');
  const fonte = (await fontesDasEmpresas(db, [t.empresa_id])).get(t.empresa_id) || 'P2S';
  let movimentoId: number | null = null;
  if (fonte === 'SISTEMA') {
    if (!b.conta_id) throw new Error('Escolha a conta de onde saiu o pagamento.');
    const { data: c } = await db.from('financeiro_contas').select('id, empresa_id, ativa, data_saldo_inicial').eq('id', b.conta_id).maybeSingle();
    if (!c || !c.ativa) throw new Error('Conta financeira inválida.');
    if (b.data_pagamento <= c.data_saldo_inicial) throw new Error('A data do pagamento é anterior ao saldo inicial da conta.');
    const { data: m, error } = await db.from('financeiro_movimentos').insert({
      empresa_id: c.empresa_id, conta_id: c.id, data: b.data_pagamento, tipo: 'SAIDA', valor: pago, descricao: t.descricao, parceiro_nome: t.fornecedor_nome,
      parceiro_id: t.fornecedor_id, subcentro_id: t.subcentro_id, centro_id: t.subcentro?.centro_id ?? null, documento: t.documento,
      origem: 'TITULO_PAGAR', ref_id: String(t.id), criado_por: usuario,
    }).select('id').single();
    if (error) throw error;
    movimentoId = m.id;
  }
  const { error } = await db.from('financeiro_titulos_pagar').update({
    status: 'PAGO', data_pagamento: b.data_pagamento, valor_pago: pago, juros_multa: juros, desconto: desc, conta_pagamento_id: b.conta_id || null,
    movimento_id: movimentoId, baixado_por: usuario, atualizado_em: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
  return { movimentou: !!movimentoId, fonte };
}

export async function estornarBaixa(db: Db, id: number) {
  const { data: t } = await db.from('financeiro_titulos_pagar').select('status, movimento_id, origem').eq('id', id).maybeSingle();
  if (!t || t.status !== 'PAGO') throw new Error('Esta conta não está paga.');
  if (t.origem === 'OP') throw new Error('Conta de OP: o pagamento vem da OP — estorne a OP.');
  await db.from('financeiro_titulos_pagar').update({ status: 'ABERTO', data_pagamento: null, valor_pago: null, juros_multa: 0, desconto: 0, conta_pagamento_id: null, movimento_id: null, baixado_por: null, atualizado_em: new Date().toISOString() }).eq('id', id);
  if (t.movimento_id) {
    await db.from('financeiro_extrato_linhas').update({ status: 'PENDENTE', movimento_id: null, conciliado_por: null, conciliado_em: null }).eq('movimento_id', t.movimento_id);
    await db.from('financeiro_movimentos').delete().eq('id', t.movimento_id);
  }
}

export async function cancelarTitulo(db: Db, id: number, motivo: string) {
  if (!limpo(motivo)) throw new Error('Informe o motivo.');
  const { data: t } = await db.from('financeiro_titulos_pagar').select('status, origem').eq('id', id).maybeSingle();
  if (!t || t.status !== 'ABERTO') throw new Error('Só conta em aberto pode ser cancelada.');
  if (t.origem === 'OP') throw new Error('Conta de OP: reprove a OP para cancelar.');
  await db.from('financeiro_titulos_pagar').update({ status: 'CANCELADO', motivo_cancelamento: limpo(motivo), atualizado_em: new Date().toISOString() }).eq('id', id);
}

// ============================================================================
// RECORRÊNCIAS
// ============================================================================
export interface DadosRecorrencia {
  empresa_id: number; fornecedor_id?: number | null; fornecedor_nome?: string | null; descricao: string; subcentro_id?: number | null;
  valor: number; dia_vencimento: number; periodicidade: 'MENSAL' | 'BIMESTRAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
  inicio: string; fim?: string | null; forma_pagamento?: string | null; conta_id?: number | null; ativa?: boolean;
}
const PASSO: Record<string, number> = { MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };

export async function salvarRecorrencia(db: Db, id: number | null, d: DadosRecorrencia, usuario: string) {
  if (!limpo(d.descricao)) throw new Error('Descreva a conta recorrente.');
  if (!(n(d.valor) > 0)) throw new Error('Valor inválido.');
  const dia = Math.floor(n(d.dia_vencimento));
  if (dia < 1 || dia > 31) throw new Error('Dia de vencimento entre 1 e 31.');
  if (!dataValida(d.inicio)) throw new Error('Informe o início.');
  if (d.fim && (!dataValida(d.fim) || d.fim < d.inicio)) throw new Error('Fim inválido.');
  if (!PASSO[d.periodicidade]) throw new Error('Periodicidade inválida.');
  const campos = {
    empresa_id: d.empresa_id, fornecedor_id: d.fornecedor_id || null, fornecedor_nome: limpo(d.fornecedor_nome).toUpperCase() || null, descricao: limpo(d.descricao),
    subcentro_id: d.subcentro_id || null, valor: arred(n(d.valor)), dia_vencimento: dia, periodicidade: d.periodicidade, inicio: d.inicio, fim: d.fim || null,
    forma_pagamento: d.forma_pagamento || null, conta_id: d.conta_id || null, ativa: d.ativa ?? true,
  };
  let rid = id;
  if (id) {
    const { error } = await db.from('financeiro_recorrencias').update(campos).eq('id', id);
    if (error) throw error;
    // títulos em aberto ainda não vencidos acompanham o novo valor/descrição
    await db.from('financeiro_titulos_pagar').update({ valor: campos.valor, descricao: campos.descricao, subcentro_id: campos.subcentro_id, fornecedor_nome: campos.fornecedor_nome || campos.descricao, atualizado_em: new Date().toISOString() })
      .eq('recorrencia_id', id).eq('status', 'ABERTO').gte('vencimento', hojeISO());
  } else {
    const { data, error } = await db.from('financeiro_recorrencias').insert({ ...campos, criado_por: usuario }).select('id').single();
    if (error) throw error;
    rid = data.id;
  }
  await gerarRecorrencias(db, rid);
  return rid!;
}

function vencimentosDa(r: any, ate: string): string[] {
  const passo = PASSO[r.periodicidade] || 1;
  const [a, m] = r.inicio.split('-').map(Number);
  const out: string[] = [];
  for (let k = 0; k < 600; k += passo) {
    const alvo = new Date(Date.UTC(a, m - 1 + k, 1));
    const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    const v = `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(r.dia_vencimento, ultimo)).padStart(2, '0')}`;
    if (v > ate || (r.fim && v > r.fim)) break;
    if (v >= r.inicio) out.push(v);
  }
  return out;
}

/** Gera os títulos das recorrências ativas até hoje + 45 dias (sem repetir). */
export async function gerarRecorrencias(db: Db, somenteId?: number | null) {
  let q = db.from('financeiro_recorrencias').select('*').eq('ativa', true);
  if (somenteId) q = q.eq('id', somenteId);
  const { data: recs, error } = await q;
  if (error) throw error;
  const ate = somarDias(hojeISO(), HORIZONTE_RECORRENCIA);
  let criados = 0;
  for (const r of (recs || []) as any[]) {
    const desde = r.gerado_ate && r.gerado_ate >= r.inicio ? r.gerado_ate : null;
    const vencs = vencimentosDa(r, ate).filter(v => !desde || v > desde);
    if (!vencs.length) continue;
    const { data: ja } = await db.from('financeiro_titulos_pagar').select('vencimento').eq('recorrencia_id', r.id).in('vencimento', vencs);
    const existentes = new Set(((ja || []) as any[]).map(x => x.vencimento));
    const novos = vencs.filter(v => !existentes.has(v)).map(v => ({
      empresa_id: r.empresa_id, origem: 'RECORRENCIA', recorrencia_id: r.id, fornecedor_id: r.fornecedor_id, fornecedor_nome: r.fornecedor_nome || r.descricao.toUpperCase(),
      descricao: `${r.descricao} — ${v.slice(5, 7)}/${v.slice(0, 4)}`, subcentro_id: r.subcentro_id, competencia: `${v.slice(0, 7)}-01`, vencimento: v, valor: n(r.valor),
      forma_pagamento: r.forma_pagamento, conta_prevista_id: r.conta_id, criado_por: 'Recorrência',
    }));
    if (novos.length) {
      const { error: e } = await db.from('financeiro_titulos_pagar').insert(novos);
      if (e) throw e;
      criados += novos.length;
    }
    await db.from('financeiro_recorrencias').update({ gerado_ate: vencs[vencs.length - 1] }).eq('id', r.id);
  }
  return { criados };
}

// ============================================================================
// OP → TÍTULO A PAGAR
// ============================================================================
/**
 * Cada OP (criada desde DATA_INICIO_OPS, ou ainda pendente) tem um título a
 * pagar: classificado pela natureza (sub-centro), PAGA baixa, REPROVADA cancela.
 */
export async function sincronizarOpsTitulos(db: Db) {
  const { data: ops, error } = await buscarTodasPaginas<any>((d, a) => db.from('op_ordens_pagamento')
    .select('id, numero_op, status, empresa_id, empresa_recebedora, natureza_pagamento, total_geral, data_vencimento, data_criacao, pago_em, tipo_pagamento, chave_pix, dados_pagamento, os_numero, observacao')
    .or(`data_criacao.gte.${DATA_INICIO_OPS},status.eq.PENDENTE`).order('data_criacao').range(d, a), 1000, 20000);
  if (error) throw error;
  if (!ops.length) return { criados: 0, pagos: 0, cancelados: 0 };
  const [{ data: nats }, { data: subs }, { data: titulos }] = await Promise.all([
    db.from('op_naturezas_pagamento').select('natureza, subcentro_financeiro_oid'),
    db.from('financeiro_subcentros').select('id, p2s_oid'),
    db.from('financeiro_titulos_pagar').select('id, op_id, status, valor').not('op_id', 'is', null).neq('status', 'CANCELADO'),
  ]);
  const subPorOid = new Map(((subs || []) as any[]).map(s => [s.p2s_oid, s.id]));
  const subPorNatureza = new Map(((nats || []) as any[]).map(x => [String(x.natureza).toUpperCase(), subPorOid.get(x.subcentro_financeiro_oid) ?? null]));
  const porOp = new Map(((titulos || []) as any[]).map(t => [t.op_id, t]));
  let criados = 0, pagos = 0, cancelados = 0;
  const novos: any[] = [];
  for (const o of ops) {
    if (!o.empresa_id || !(n(o.total_geral) > 0)) continue;
    const t = porOp.get(o.id);
    if (o.status === 'REPROVADA') {
      if (t && t.status === 'ABERTO') { await db.from('financeiro_titulos_pagar').update({ status: 'CANCELADO', motivo_cancelamento: `OP #${o.numero_op} reprovada`, atualizado_em: new Date().toISOString() }).eq('id', t.id); cancelados++; }
      continue;
    }
    if (!t) {
      novos.push({
        empresa_id: o.empresa_id, origem: 'OP', op_id: o.id, fornecedor_nome: limpo(o.empresa_recebedora).toUpperCase() || `OP ${o.numero_op}`,
        descricao: `OP #${o.numero_op} · ${limpo(o.natureza_pagamento) || 'sem natureza'}${o.os_numero ? ` · OS ${o.os_numero}` : ''}`.slice(0, 200),
        documento: `OP ${o.numero_op}`, subcentro_id: subPorNatureza.get(String(o.natureza_pagamento || '').toUpperCase()) ?? null,
        competencia: String(o.data_criacao).slice(0, 10), vencimento: o.data_vencimento || String(o.data_criacao).slice(0, 10), valor: arred(n(o.total_geral)),
        forma_pagamento: o.tipo_pagamento || null, pix_chave: o.tipo_pagamento === 'PIX' ? limpo(o.dados_pagamento) || null : null,
        boleto_linha: o.tipo_pagamento === 'BOLETO' ? limpo(o.dados_pagamento) || null : null,
        status: o.status === 'PAGO' ? 'PAGO' : 'ABERTO', data_pagamento: o.status === 'PAGO' ? String(o.pago_em || o.data_vencimento || o.data_criacao).slice(0, 10) : null,
        valor_pago: o.status === 'PAGO' ? arred(n(o.total_geral)) : null, baixado_por: o.status === 'PAGO' ? 'OP paga' : null, criado_por: 'OP',
      });
      continue;
    }
    if (o.status === 'PAGO' && t.status === 'ABERTO') {
      await db.from('financeiro_titulos_pagar').update({ status: 'PAGO', data_pagamento: String(o.pago_em || hojeISO()).slice(0, 10), valor_pago: n(o.total_geral), baixado_por: 'OP paga', atualizado_em: new Date().toISOString() }).eq('id', t.id);
      pagos++;
    } else if (o.status === 'PENDENTE' && t.status === 'ABERTO' && n(t.valor) !== arred(n(o.total_geral))) {
      await db.from('financeiro_titulos_pagar').update({ valor: arred(n(o.total_geral)), vencimento: o.data_vencimento, atualizado_em: new Date().toISOString() }).eq('id', t.id);
    }
  }
  for (let i = 0; i < novos.length; i += 300) {
    const { error: e } = await db.from('financeiro_titulos_pagar').insert(novos.slice(i, i + 300));
    if (e) throw e;
    criados += Math.min(300, novos.length - i);
  }
  return { criados, pagos, cancelados };
}

// ============================================================================
// LISTA
// ============================================================================
export async function listarTitulosPagar(db: Db, empresaIds: number[], f: { de: string; ate: string; status: string }) {
  // a consulta é montada de novo a cada página (o construtor do supabase é mutável)
  const consulta = () => {
    let q = db.from('financeiro_titulos_pagar')
      .select('*, subcentro:financeiro_subcentros(nome_p2s, centro:financeiro_centros(nome)), conta:financeiro_contas!financeiro_titulos_pagar_conta_pagamento_id_fkey(nome)')
      .in('empresa_id', empresaIds.length ? empresaIds : [0]).gte('vencimento', f.de).lte('vencimento', f.ate);
    if (f.status === 'VENCIDO') q = q.eq('status', 'ABERTO').lt('vencimento', hojeISO());
    else if (f.status) q = q.eq('status', f.status);
    return q;
  };
  const { data, error } = await buscarTodasPaginas<any>((d, a) => consulta().order('vencimento').order('id').range(d, a), 1000, 20000);
  if (error) throw error;
  const hoje = hojeISO();
  const [abertos] = await Promise.all([
    buscarTodasPaginas<any>((d, a) => db.from('financeiro_titulos_pagar').select('valor, vencimento, status, valor_pago, data_pagamento').in('empresa_id', empresaIds.length ? empresaIds : [0])
      .or(`status.eq.ABERTO,and(status.eq.PAGO,data_pagamento.gte.${hoje.slice(0, 8)}01)`).order('id').range(d, a), 1000, 50000),
  ]);
  const ab = (abertos.data || []) as any[];
  const soma = (l: any[], c: string) => arred(l.reduce((s, x) => s + n(x[c]), 0));
  const vencidos = ab.filter(x => x.status === 'ABERTO' && x.vencimento < hoje);
  const prox7 = ab.filter(x => x.status === 'ABERTO' && x.vencimento >= hoje && x.vencimento <= somarDias(hoje, 7));
  const pagosMes = ab.filter(x => x.status === 'PAGO');
  return {
    titulos: data.map((t: any) => ({ ...t, valor: n(t.valor), valor_pago: t.valor_pago != null ? n(t.valor_pago) : null, classificacao: t.subcentro ? `${t.subcentro.centro?.nome || ''} — ${t.subcentro.nome_p2s}` : null, conta_pagamento: t.conta?.nome || null })),
    kpis: { vencidos: { qtd: vencidos.length, valor: soma(vencidos, 'valor') }, proximos7: { qtd: prox7.length, valor: soma(prox7, 'valor') }, pagosMes: { qtd: pagosMes.length, valor: soma(pagosMes, 'valor_pago') } },
  };
}
