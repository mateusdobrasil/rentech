// app/lib/financeiro/caixa.ts
// CAIXA E BANCOS (Financeiro completo, 2026-11-20). Só servidor, SEM checagem
// de acesso (quem chama valida rota/empresa).
//
//   * Contas financeiras (financeiro_contas) com saldo inicial numa data: o
//     saldo de um dia = saldo inicial + entradas − saídas DEPOIS da data do
//     saldo inicial até aquele dia.
//   * Movimentos (financeiro_movimentos) = extrato próprio. Na transição
//     (fonte P2S, decisão do usuário: paralelo com espelho) eles nascem das
//     contas pagas/recebidas do P2S (financeiro_contas_pagar/receber
//     quitadas), casadas pela conta financeira do P2S (nomes_p2s). Com fonte
//     SISTEMA, nascem das baixas dos títulos próprios.
//   * Transferência entre contas = 2 movimentos com o mesmo grupo.
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { hojeISO, somarDias } from '../locacao/datas';
import { randomUUID } from 'crypto';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
const limpo = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export type Fonte = 'P2S' | 'SISTEMA';

export async function fontesDasEmpresas(db: Db, empresaIds: number[]): Promise<Map<number, Fonte>> {
  const { data } = await db.from('financeiro_parametros').select('empresa_id, fonte').in('empresa_id', empresaIds.length ? empresaIds : [0]);
  const m = new Map<number, Fonte>(empresaIds.map(id => [id, 'P2S' as Fonte]));
  for (const r of (data || []) as any[]) m.set(r.empresa_id, r.fonte === 'SISTEMA' ? 'SISTEMA' : 'P2S');
  return m;
}

// ============================================================================
// CONTAS E SALDOS
// ============================================================================
export interface ContaComSaldo {
  id: number; empresa_id: number; nome: string; tipo: string; banco_codigo: string | null; agencia: string | null; numero_conta: string | null;
  nomes_p2s: string[]; saldo_inicial: number; data_saldo_inicial: string; ativa: boolean; ordem: number; observacoes: string | null;
  saldo: number; entradas: number; saidas: number; ultimo_movimento: string | null; pendentes_conciliar: number;
}

/** Soma de movimentos por conta até `ate` (inclusive), depois da data do saldo inicial. */
async function somasPorConta(db: Db, contas: { id: number; data_saldo_inicial: string }[], ate: string) {
  const out = new Map<number, { entradas: number; saidas: number; ultimo: string | null }>();
  for (const c of contas) {
    const { data, error } = await buscarTodasPaginas<any>((de, a) => db.from('financeiro_movimentos').select('tipo, valor, data')
      .eq('conta_id', c.id).gt('data', c.data_saldo_inicial).lte('data', ate).order('id').range(de, a), 1000, 200000);
    if (error) throw error;
    let e = 0, s = 0, ult: string | null = null;
    for (const m of data) { if (m.tipo === 'ENTRADA') e += n(m.valor); else s += n(m.valor); if (!ult || m.data > ult) ult = m.data; }
    out.set(c.id, { entradas: arred(e), saidas: arred(s), ultimo: ult });
  }
  return out;
}

export async function contasComSaldo(db: Db, empresaIds: number[], ate = hojeISO()): Promise<ContaComSaldo[]> {
  const { data, error } = await db.from('financeiro_contas').select('*').in('empresa_id', empresaIds.length ? empresaIds : [0]).order('ordem').order('nome');
  if (error) throw error;
  const contas = (data || []) as any[];
  const somas = await somasPorConta(db, contas, ate);
  const pend = new Map<number, number>();
  if (contas.length) {
    const { data: ls } = await db.from('financeiro_extrato_linhas').select('conta_id').eq('status', 'PENDENTE').in('conta_id', contas.map(c => c.id));
    for (const l of (ls || []) as any[]) pend.set(l.conta_id, (pend.get(l.conta_id) || 0) + 1);
  }
  return contas.map(c => {
    const s = somas.get(c.id) || { entradas: 0, saidas: 0, ultimo: null };
    return {
      ...c, saldo_inicial: n(c.saldo_inicial), nomes_p2s: c.nomes_p2s || [],
      saldo: ate < c.data_saldo_inicial ? n(c.saldo_inicial) : arred(n(c.saldo_inicial) + s.entradas - s.saidas),
      entradas: s.entradas, saidas: s.saidas, ultimo_movimento: s.ultimo, pendentes_conciliar: pend.get(c.id) || 0,
    };
  });
}

export interface DadosConta {
  empresa_id: number; nome: string; tipo: 'BANCO' | 'CAIXA' | 'CARTAO' | 'APLICACAO';
  banco_codigo?: string | null; agencia?: string | null; numero_conta?: string | null;
  nomes_p2s?: string[]; saldo_inicial: number; data_saldo_inicial: string; ativa?: boolean; ordem?: number; observacoes?: string | null;
}

export async function salvarConta(db: Db, id: number | null, d: DadosConta, usuario: string): Promise<number> {
  if (!d.nome?.trim()) throw new Error('Informe o nome da conta.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.data_saldo_inicial || '')) throw new Error('Informe a data do saldo inicial.');
  const campos = {
    empresa_id: d.empresa_id, nome: d.nome.trim(), tipo: d.tipo, banco_codigo: d.banco_codigo?.trim() || null, agencia: d.agencia?.trim() || null,
    numero_conta: d.numero_conta?.trim() || null, nomes_p2s: (d.nomes_p2s || []).map(limpo).filter(Boolean), saldo_inicial: arred(n(d.saldo_inicial)),
    data_saldo_inicial: d.data_saldo_inicial, ativa: d.ativa ?? true, ordem: Math.floor(n(d.ordem)), observacoes: d.observacoes?.trim() || null,
  };
  if (id) {
    const { error } = await db.from('financeiro_contas').update(campos).eq('id', id);
    if (error) throw error;
    return id;
  }
  const { data, error } = await db.from('financeiro_contas').insert({ ...campos, criado_por: usuario }).select('id').single();
  if (error) throw error;
  return data.id;
}

/**
 * Cria uma conta para cada conta financeira usada no P2S que ainda não está
 * ligada a nenhuma conta daqui. A conta bancária é UMA só (no P2S a mesma
 * "Itaú - Rentech" aparece em títulos das duas empresas): agrupa pelo nome e
 * fica com a empresa que mais a usa. Saldo inicial 0 em ontem — o usuário
 * ajusta com o saldo do extrato.
 */
export async function criarContasDoP2s(db: Db, empresaIds: number[], usuario: string) {
  const usados = new Map<string, number>(); // "empresa|nome" → qtd
  for (const t of ['financeiro_contas_pagar', 'financeiro_contas_receber']) {
    const { data, error } = await buscarTodasPaginas<any>((de, a) => db.from(t).select('empresa_id, conta_financeira')
      .in('empresa_id', empresaIds.length ? empresaIds : [0]).gte('data_vencimento', somarDias(hojeISO(), -730)).not('conta_financeira', 'is', null).order('id').range(de, a), 1000, 100000);
    if (error) throw error;
    for (const r of data) { const k = `${r.empresa_id}|${limpo(r.conta_financeira)}`; usados.set(k, (usados.get(k) || 0) + 1); }
  }
  const { data: existentes } = await db.from('financeiro_contas').select('nomes_p2s');
  const ligados = new Set(((existentes || []) as any[]).flatMap(c => (c.nomes_p2s || []).map((nm: string) => limpo(nm).toUpperCase())));
  // nome → { empresa que mais usa, total }
  const porNome = new Map<string, { nome: string; empresa: number; qtdEmpresa: number; total: number }>();
  for (const [k, qtd] of usados) {
    const emp = Number(k.split('|')[0]), nome = k.slice(k.indexOf('|') + 1);
    const g = porNome.get(nome.toUpperCase()) || { nome, empresa: emp, qtdEmpresa: 0, total: 0 };
    g.total += qtd;
    if (qtd > g.qtdEmpresa) { g.empresa = emp; g.qtdEmpresa = qtd; }
    porNome.set(nome.toUpperCase(), g);
  }
  const ontem = somarDias(hojeISO(), -1);
  const novas = [...porNome.entries()].filter(([k]) => !ligados.has(k)).sort((a, b) => b[1].total - a[1].total).map(([, g], i) => {
    const tipo = /caixa|caixinha/i.test(g.nome) ? 'CAIXA' : 'BANCO';
    return { empresa_id: g.empresa, nome: g.nome, tipo, nomes_p2s: [g.nome], saldo_inicial: 0, data_saldo_inicial: ontem, ordem: i, criado_por: usuario };
  });
  if (novas.length) {
    const { error } = await db.from('financeiro_contas').insert(novas);
    if (error) throw error;
  }
  return { criadas: novas.length, contas: novas.map(c => c.nome) };
}

// ============================================================================
// SINCRONIZAÇÃO DOS MOVIMENTOS COM O P2S (fonte P2S)
// ============================================================================
/**
 * Contas pagas/recebidas do P2S → movimentos das contas daqui (pela conta
 * financeira do P2S), a partir da data do saldo inicial de cada conta.
 * Idempotente (origem + ref_id); remove o que deixou de estar quitado.
 */
export async function sincronizarMovimentosP2s(db: Db, empresaIds?: number[] | null) {
  let q = db.from('financeiro_contas').select('id, empresa_id, nomes_p2s, data_saldo_inicial').eq('ativa', true);
  if (empresaIds) q = q.in('empresa_id', empresaIds.length ? empresaIds : [0]);
  // a conta pertence a uma empresa, mas no P2S títulos das duas empresas usam
  // a mesma conta — casa pelo NOME da conta, qualquer que seja a empresa do título
  const { data: contas, error } = await q;
  if (error) throw error;
  const fontes = await fontesDasEmpresas(db, [...new Set(((contas || []) as any[]).map(c => c.empresa_id))]);
  const { data: subs } = await db.from('financeiro_subcentros').select('id, centro_id, nome_p2s');
  const subPorNome = new Map(((subs || []) as any[]).map(s => [limpo(s.nome_p2s).toUpperCase(), s]));
  const res = { contas: 0, criados: 0, atualizados: 0, removidos: 0 };

  for (const c of (contas || []) as any[]) {
    if (fontes.get(c.empresa_id) !== 'P2S' || !(c.nomes_p2s || []).length) continue;
    res.contas++;
    const nomes: string[] = c.nomes_p2s;
    const desde = somarDias(c.data_saldo_inicial, 1);
    const [pg, rc] = await Promise.all([
      buscarTodasPaginas<any>((de, a) => db.from('financeiro_contas_pagar').select('id, descricao, fornecedor, valor, valor_pago, data_quitacao, centro, sub_centro, num_documento, conta_financeira')
        .eq('quitado', true).gte('data_quitacao', desde).in('conta_financeira', nomes).order('id').range(de, a), 1000, 100000),
      buscarTodasPaginas<any>((de, a) => db.from('financeiro_contas_receber').select('id, descricao, cliente, valor_final, valor_pago, data_quitacao, centro_financeiro, sub_centro, num_documento, conta_financeira')
        .eq('quitado', true).gte('data_quitacao', desde).in('conta_financeira', nomes).order('id').range(de, a), 1000, 100000),
    ]);
    if (pg.error) throw pg.error;
    if (rc.error) throw rc.error;
    const linhas: any[] = [];
    const sub = (s: unknown) => subPorNome.get(limpo(s).toUpperCase()) || null;
    for (const p of pg.data) {
      const v = arred(n(p.valor_pago) || n(p.valor));
      if (!(v > 0)) continue;
      const sc = sub(p.sub_centro);
      linhas.push({
        empresa_id: c.empresa_id, conta_id: c.id, data: p.data_quitacao, tipo: 'SAIDA', valor: v,
        descricao: limpo(p.descricao) || limpo(p.fornecedor) || 'Conta paga (P2S)', parceiro_nome: limpo(p.fornecedor) || null,
        centro_id: sc?.centro_id ?? null, subcentro_id: sc?.id ?? null, categoria: [limpo(p.centro), limpo(p.sub_centro)].filter(Boolean).join(' / ') || null,
        origem: 'P2S_PAGAR', ref_id: String(p.id), documento: limpo(p.num_documento) || null, criado_por: 'Sincronização P2S',
      });
    }
    for (const r of rc.data) {
      const v = arred(n(r.valor_pago) || n(r.valor_final));
      if (!(v > 0)) continue;
      linhas.push({
        empresa_id: c.empresa_id, conta_id: c.id, data: r.data_quitacao, tipo: 'ENTRADA', valor: v,
        descricao: limpo(r.descricao) || limpo(r.cliente) || 'Conta recebida (P2S)', parceiro_nome: limpo(r.cliente) || null,
        categoria: [limpo(r.centro_financeiro), limpo(r.sub_centro)].filter(Boolean).join(' / ').replace(/\r?\n/g, ' ') || null,
        origem: 'P2S_RECEBER', ref_id: String(r.id), documento: limpo(r.num_documento) || null, criado_por: 'Sincronização P2S',
      });
    }
    // existentes desta conta (P2S_*), para atualizar/remover
    const { data: atuais } = await buscarTodasPaginas<any>((de, a) => db.from('financeiro_movimentos').select('id, origem, ref_id, data, valor, conta_id')
      .eq('conta_id', c.id).in('origem', ['P2S_PAGAR', 'P2S_RECEBER']).order('id').range(de, a), 1000, 200000);
    const chave = (o: string, r: string) => `${o}|${r}`;
    const porChave = new Map((atuais || []).map((m: any) => [chave(m.origem, m.ref_id), m]));
    const novos = linhas.filter(l => !porChave.has(chave(l.origem, l.ref_id)));
    const mudados = linhas.filter(l => { const m = porChave.get(chave(l.origem, l.ref_id)); return m && (m.data !== l.data || n(m.valor) !== l.valor); });
    const vigentes = new Set(linhas.map(l => chave(l.origem, l.ref_id)));
    const sumidos = (atuais || []).filter((m: any) => !vigentes.has(chave(m.origem, m.ref_id)));
    // o mesmo título pode ter mudado de conta no P2S: o movimento antigo (outra conta) é movido para esta
    const outraConta = new Map<string, number>();
    for (const orig of ['P2S_PAGAR', 'P2S_RECEBER']) {
      const refs = novos.filter(l => l.origem === orig).map(l => l.ref_id);
      for (let i = 0; i < refs.length; i += 300) {
        const { data: ja } = await db.from('financeiro_movimentos').select('id, ref_id').eq('origem', orig).in('ref_id', refs.slice(i, i + 300));
        for (const m of (ja || []) as any[]) outraConta.set(chave(orig, m.ref_id), m.id);
      }
    }
    const inserir = novos.filter(l => !outraConta.has(chave(l.origem, l.ref_id)));
    for (const l of novos.filter(x => outraConta.has(chave(x.origem, x.ref_id)))) {
      await db.from('financeiro_movimentos').update({ conta_id: l.conta_id, empresa_id: l.empresa_id, data: l.data, valor: l.valor, descricao: l.descricao }).eq('id', outraConta.get(chave(l.origem, l.ref_id))!);
    }
    for (let i = 0; i < inserir.length; i += 500) {
      const { error: e } = await db.from('financeiro_movimentos').insert(inserir.slice(i, i + 500));
      if (e) throw e;
    }
    for (const l of mudados) await db.from('financeiro_movimentos').update({ data: l.data, valor: l.valor, descricao: l.descricao }).eq('id', porChave.get(chave(l.origem, l.ref_id)).id);
    if (sumidos.length) await db.from('financeiro_movimentos').delete().in('id', sumidos.map((m: any) => m.id));
    res.criados += novos.length; res.atualizados += mudados.length; res.removidos += sumidos.length;
  }
  return res;
}

// ============================================================================
// EXTRATO, TRANSFERÊNCIA, LANÇAMENTO AVULSO
// ============================================================================
export async function extratoConta(db: Db, contaId: number, de: string, ate: string) {
  const { data: c, error } = await db.from('financeiro_contas').select('*').eq('id', contaId).single();
  if (error) throw error;
  const inicioEfetivo = de > c.data_saldo_inicial ? de : somarDias(c.data_saldo_inicial, 1);
  // saldo anterior = saldo inicial + movimentos entre o saldo inicial e o dia anterior ao período
  let anterior = n(c.saldo_inicial);
  if (inicioEfetivo > somarDias(c.data_saldo_inicial, 1)) {
    const { data: ant } = await buscarTodasPaginas<any>((d0, a) => db.from('financeiro_movimentos').select('tipo, valor')
      .eq('conta_id', contaId).gt('data', c.data_saldo_inicial).lt('data', inicioEfetivo).order('id').range(d0, a), 1000, 200000);
    for (const m of ant || []) anterior += m.tipo === 'ENTRADA' ? n(m.valor) : -n(m.valor);
  }
  const { data: movs, error: eM } = await buscarTodasPaginas<any>((d0, a) => db.from('financeiro_movimentos')
    .select('id, data, tipo, valor, descricao, parceiro_nome, categoria, origem, documento, transferencia_grupo, extrato_linha_id, criado_por, subcentro:financeiro_subcentros(nome_p2s), centro:financeiro_centros(nome)')
    .eq('conta_id', contaId).gte('data', inicioEfetivo).lte('data', ate).order('data').order('id').range(d0, a), 1000, 100000);
  if (eM) throw eM;
  let saldo = arred(anterior);
  const linhas = (movs || []).map((m: any) => {
    saldo = arred(saldo + (m.tipo === 'ENTRADA' ? n(m.valor) : -n(m.valor)));
    return {
      id: m.id, data: m.data, tipo: m.tipo, valor: n(m.valor), descricao: m.descricao, parceiro: m.parceiro_nome, documento: m.documento, origem: m.origem,
      categoria: m.subcentro?.nome_p2s ? `${m.centro?.nome || ''} / ${m.subcentro.nome_p2s}` : m.categoria, conciliado: !!m.extrato_linha_id,
      transferencia: !!m.transferencia_grupo, criado_por: m.criado_por, saldo,
    };
  });
  return {
    conta: { id: c.id, nome: c.nome, saldo_inicial: n(c.saldo_inicial), data_saldo_inicial: c.data_saldo_inicial },
    de: inicioEfetivo, ate, saldo_anterior: arred(anterior), saldo_final: saldo,
    entradas: arred(linhas.filter(l => l.tipo === 'ENTRADA').reduce((a, l) => a + l.valor, 0)),
    saidas: arred(linhas.filter(l => l.tipo === 'SAIDA').reduce((a, l) => a + l.valor, 0)),
    linhas,
  };
}

async function contaOk(db: Db, id: number) {
  const { data } = await db.from('financeiro_contas').select('id, empresa_id, nome, ativa, data_saldo_inicial').eq('id', id).maybeSingle();
  if (!data) throw new Error('Conta não encontrada.');
  if (!data.ativa) throw new Error(`A conta ${data.nome} está inativa.`);
  return data as any;
}

export async function transferir(db: Db, a: { de_conta_id: number; para_conta_id: number; data: string; valor: number; descricao?: string | null }, usuario: string) {
  if (a.de_conta_id === a.para_conta_id) throw new Error('Escolha contas diferentes.');
  if (!(n(a.valor) > 0)) throw new Error('Valor inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.data || '')) throw new Error('Data inválida.');
  const [de, para] = await Promise.all([contaOk(db, a.de_conta_id), contaOk(db, a.para_conta_id)]);
  if (a.data <= de.data_saldo_inicial || a.data <= para.data_saldo_inicial) throw new Error('A data é anterior ao saldo inicial de uma das contas.');
  const grupo = randomUUID();
  const desc = a.descricao?.trim() || `Transferência ${de.nome} → ${para.nome}`;
  const v = arred(n(a.valor));
  const { error } = await db.from('financeiro_movimentos').insert([
    { empresa_id: de.empresa_id, conta_id: de.id, data: a.data, tipo: 'SAIDA', valor: v, descricao: desc, origem: 'TRANSFERENCIA', transferencia_grupo: grupo, criado_por: usuario },
    { empresa_id: para.empresa_id, conta_id: para.id, data: a.data, tipo: 'ENTRADA', valor: v, descricao: desc, origem: 'TRANSFERENCIA', transferencia_grupo: grupo, criado_por: usuario },
  ]);
  if (error) throw error;
  return { grupo };
}

export async function lancarAvulso(db: Db, a: { conta_id: number; data: string; tipo: 'ENTRADA' | 'SAIDA'; valor: number; descricao: string; subcentro_id?: number | null; parceiro_nome?: string | null; documento?: string | null; ajuste?: boolean }, usuario: string) {
  if (!(n(a.valor) > 0)) throw new Error('Valor inválido.');
  if (!a.descricao?.trim()) throw new Error('Descreva o lançamento.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.data || '')) throw new Error('Data inválida.');
  const c = await contaOk(db, a.conta_id);
  if (a.data <= c.data_saldo_inicial) throw new Error('A data é anterior (ou igual) ao saldo inicial da conta.');
  let centroId: number | null = null;
  if (a.subcentro_id) {
    const { data: s } = await db.from('financeiro_subcentros').select('centro_id').eq('id', a.subcentro_id).maybeSingle();
    centroId = s?.centro_id ?? null;
  }
  const { data, error } = await db.from('financeiro_movimentos').insert({
    empresa_id: c.empresa_id, conta_id: c.id, data: a.data, tipo: a.tipo, valor: arred(n(a.valor)), descricao: a.descricao.trim(),
    subcentro_id: a.subcentro_id || null, centro_id: centroId, parceiro_nome: a.parceiro_nome?.trim() || null, documento: a.documento?.trim() || null,
    origem: a.ajuste ? 'AJUSTE' : 'MANUAL', criado_por: usuario,
  }).select('id').single();
  if (error) throw error;
  return data.id as number;
}

/** Só movimento manual/ajuste/transferência (a transferência sai inteira); os que vêm de título/P2S saem pela origem. */
export async function excluirMovimento(db: Db, id: number) {
  const { data: m } = await db.from('financeiro_movimentos').select('id, origem, transferencia_grupo, extrato_linha_id').eq('id', id).maybeSingle();
  if (!m) throw new Error('Movimento não encontrado.');
  if (!['MANUAL', 'AJUSTE', 'TRANSFERENCIA', 'EXTRATO'].includes(m.origem)) throw new Error('Este movimento vem de um título/P2S — estorne a baixa na origem.');
  const ids = m.transferencia_grupo
    ? (((await db.from('financeiro_movimentos').select('id').eq('transferencia_grupo', m.transferencia_grupo)).data || []) as any[]).map(x => x.id)
    : [m.id];
  await db.from('financeiro_extrato_linhas').update({ status: 'PENDENTE', movimento_id: null, conciliado_por: null, conciliado_em: null }).in('movimento_id', ids);
  const { error } = await db.from('financeiro_movimentos').delete().in('id', ids);
  if (error) throw error;
}
