// app/lib/financeiro/conciliacao.ts
// CONCILIAÇÃO BANCÁRIA por OFX (Financeiro completo, 2026-11-20). Só servidor,
// sem checagem de acesso.
//
//   1. importar: lê o OFX, grava o extrato e as linhas (sem repetir: FITID por conta);
//   2. automática: cada linha pendente casa com UM movimento da mesma conta,
//      mesmo sentido e mesmo valor, até 3 dias de diferença (o mais próximo);
//   3. manual: uma linha com VÁRIOS movimentos (ex.: débito único de um lote
//      SISPAG) quando a soma bate; criar movimento a partir da linha (tarifa,
//      rendimento) já classificado; ignorar;
//   4. resumo: saldo do banco (LEDGERBAL) × saldo do sistema na mesma data.
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { somarDias } from '../locacao/datas';
import { lerOfx, decodificarOfx } from './ofx';
import { contasComSaldo } from './caixa';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
const dias = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000));
const digitos = (s: string | null | undefined) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
const JANELA_AUTO = 3;

/** Lê o OFX e diz a qual conta ele pertence (pelo nº da conta), sem gravar. */
export async function previaOfx(db: Db, bytes: Uint8Array, empresaIds: number[]) {
  const ofx = lerOfx(decodificarOfx(bytes));
  if (!ofx.lancamentos.length) throw new Error('Nenhum lançamento encontrado no arquivo — confira se é um extrato OFX.');
  const { data: contas } = await db.from('financeiro_contas').select('id, nome, empresa_id, numero_conta, agencia, banco_codigo').in('empresa_id', empresaIds.length ? empresaIds : [0]).eq('ativa', true);
  const alvo = digitos(ofx.conta);
  const sugerida = ((contas || []) as any[]).find(c => alvo && digitos(c.numero_conta) && (alvo.endsWith(digitos(c.numero_conta)) || digitos(c.numero_conta).endsWith(alvo)));
  return {
    banco: ofx.banco, agencia: ofx.agencia, conta: ofx.conta, inicio: ofx.inicio, fim: ofx.fim, saldo: ofx.saldo, saldoData: ofx.saldoData,
    lancamentos: ofx.lancamentos.length, creditos: arred(ofx.lancamentos.filter(l => l.valor > 0).reduce((a, l) => a + l.valor, 0)),
    debitos: arred(-ofx.lancamentos.filter(l => l.valor < 0).reduce((a, l) => a + l.valor, 0)), contaSugeridaId: sugerida?.id ?? null,
  };
}

export async function importarOfx(db: Db, contaId: number, bytes: Uint8Array, arquivoNome: string, usuario: string) {
  const ofx = lerOfx(decodificarOfx(bytes));
  if (!ofx.lancamentos.length) throw new Error('Nenhum lançamento encontrado no arquivo.');
  const { data: conta } = await db.from('financeiro_contas').select('id, data_saldo_inicial').eq('id', contaId).single();
  const { data: ext, error } = await db.from('financeiro_extratos').insert({
    conta_id: contaId, arquivo_nome: arquivoNome.slice(0, 200), inicio: ofx.inicio, fim: ofx.fim, saldo_final: ofx.saldo, saldo_final_data: ofx.saldoData,
    linhas: ofx.lancamentos.length, importado_por: usuario,
  }).select('id').single();
  if (error) throw error;
  // já importadas (mesmo FITID nesta conta) ficam como estão
  const fitids = ofx.lancamentos.map(l => l.fitid);
  const existentes = new Set<string>();
  for (let i = 0; i < fitids.length; i += 300) {
    const { data } = await db.from('financeiro_extrato_linhas').select('fitid').eq('conta_id', contaId).in('fitid', fitids.slice(i, i + 300));
    for (const r of (data || []) as any[]) existentes.add(r.fitid);
  }
  const novas = ofx.lancamentos.filter(l => !existentes.has(l.fitid)).map(l => ({
    extrato_id: ext.id, conta_id: contaId, data: l.data, valor: l.valor, tipo_ofx: l.tipo || null, fitid: l.fitid,
    descricao: l.descricao.slice(0, 300), documento: l.documento, status: 'PENDENTE',
  }));
  for (let i = 0; i < novas.length; i += 500) {
    const { error: e } = await db.from('financeiro_extrato_linhas').insert(novas.slice(i, i + 500));
    if (e) throw e;
  }
  await db.from('financeiro_extratos').update({ linhas: novas.length }).eq('id', ext.id);
  const auto = await conciliarAutomatico(db, contaId, usuario);
  const antesDoSaldo = conta && ofx.inicio && ofx.inicio <= conta.data_saldo_inicial;
  return { extratoId: ext.id, lidas: ofx.lancamentos.length, novas: novas.length, repetidas: ofx.lancamentos.length - novas.length, conciliadas: auto.conciliadas, antesDoSaldo: !!antesDoSaldo };
}

/** Casa linha × movimento 1:1 (mesma conta, sentido e valor; até 3 dias; o mais próximo). */
export async function conciliarAutomatico(db: Db, contaId: number, usuario: string) {
  const { data: linhas } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_extrato_linhas').select('id, data, valor')
    .eq('conta_id', contaId).eq('status', 'PENDENTE').order('data').range(d, a), 1000, 50000);
  if (!linhas.length) return { conciliadas: 0 };
  const datas = linhas.map((l: any) => l.data).sort();
  const { data: movs } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_movimentos').select('id, data, tipo, valor')
    .eq('conta_id', contaId).is('extrato_linha_id', null).gte('data', somarDias(datas[0], -JANELA_AUTO)).lte('data', somarDias(datas[datas.length - 1], JANELA_AUTO))
    .order('data').range(d, a), 1000, 100000);
  const livres = new Map<number, any>((movs || []).map((m: any) => [m.id, m]));
  const agora = new Date().toISOString();
  let conciliadas = 0;
  // exatas no mesmo dia primeiro, depois as mais distantes
  const pares: { linha: any; mov: any; dist: number }[] = [];
  for (const l of linhas) {
    const tipo = n(l.valor) >= 0 ? 'ENTRADA' : 'SAIDA';
    const v = arred(Math.abs(n(l.valor)));
    for (const m of livres.values()) {
      if (m.tipo !== tipo || arred(n(m.valor)) !== v) continue;
      const dist = dias(l.data, m.data);
      if (dist <= JANELA_AUTO) pares.push({ linha: l, mov: m, dist });
    }
  }
  pares.sort((a, b) => a.dist - b.dist);
  const linhaUsada = new Set<number>(), movUsado = new Set<number>();
  for (const p of pares) {
    if (linhaUsada.has(p.linha.id) || movUsado.has(p.mov.id)) continue;
    linhaUsada.add(p.linha.id); movUsado.add(p.mov.id);
    await db.from('financeiro_extrato_linhas').update({ status: 'CONCILIADO', movimento_id: p.mov.id, conciliado_por: `${usuario} (automático)`, conciliado_em: agora }).eq('id', p.linha.id);
    await db.from('financeiro_movimentos').update({ extrato_linha_id: p.linha.id }).eq('id', p.mov.id);
    conciliadas++;
  }
  return { conciliadas };
}

/** Uma linha do extrato com um ou mais movimentos (a soma tem de bater). */
export async function conciliarManual(db: Db, linhaId: number, movimentoIds: number[], usuario: string) {
  const { data: l } = await db.from('financeiro_extrato_linhas').select('id, conta_id, valor, status').eq('id', linhaId).maybeSingle();
  if (!l) throw new Error('Lançamento do extrato não encontrado.');
  if (l.status !== 'PENDENTE') throw new Error('Este lançamento já foi conciliado ou ignorado.');
  if (!movimentoIds.length) throw new Error('Escolha ao menos um movimento.');
  const { data: ms } = await db.from('financeiro_movimentos').select('id, conta_id, tipo, valor, extrato_linha_id').in('id', movimentoIds);
  const lista = (ms || []) as any[];
  if (lista.length !== movimentoIds.length) throw new Error('Movimento não encontrado.');
  const tipo = n(l.valor) >= 0 ? 'ENTRADA' : 'SAIDA';
  if (lista.some(m => m.conta_id !== l.conta_id)) throw new Error('Os movimentos precisam ser da mesma conta.');
  if (lista.some(m => m.tipo !== tipo)) throw new Error(`O lançamento do banco é ${tipo === 'ENTRADA' ? 'crédito' : 'débito'} — escolha só ${tipo === 'ENTRADA' ? 'entradas' : 'saídas'}.`);
  if (lista.some(m => m.extrato_linha_id)) throw new Error('Algum movimento já está conciliado com outro lançamento.');
  const soma = arred(lista.reduce((a, m) => a + n(m.valor), 0));
  if (Math.abs(soma - Math.abs(n(l.valor))) > 0.009) throw new Error(`A soma dos movimentos (${soma.toFixed(2)}) não bate com o banco (${Math.abs(n(l.valor)).toFixed(2)}).`);
  await db.from('financeiro_extrato_linhas').update({ status: 'CONCILIADO', movimento_id: lista[0].id, conciliado_por: usuario, conciliado_em: new Date().toISOString() }).eq('id', linhaId);
  await db.from('financeiro_movimentos').update({ extrato_linha_id: linhaId }).in('id', movimentoIds);
}

/** Cria o movimento a partir da linha (tarifa, rendimento, algo não lançado) e já concilia. */
export async function lancarDoExtrato(db: Db, linhaId: number, a: { descricao: string; subcentro_id?: number | null; parceiro_nome?: string | null }, usuario: string) {
  const { data: l } = await db.from('financeiro_extrato_linhas').select('id, conta_id, data, valor, status, documento, descricao').eq('id', linhaId).maybeSingle();
  if (!l) throw new Error('Lançamento do extrato não encontrado.');
  if (l.status !== 'PENDENTE') throw new Error('Este lançamento já foi conciliado ou ignorado.');
  const { data: c } = await db.from('financeiro_contas').select('id, empresa_id, data_saldo_inicial').eq('id', l.conta_id).single();
  if (!c) throw new Error('Conta não encontrada.');
  if (l.data <= c.data_saldo_inicial) throw new Error('Lançamento anterior ao saldo inicial da conta — não entra no caixa (ignore-o).');
  let centroId: number | null = null;
  if (a.subcentro_id) {
    const { data: s } = await db.from('financeiro_subcentros').select('centro_id').eq('id', a.subcentro_id).maybeSingle();
    centroId = s?.centro_id ?? null;
  }
  const { data: m, error } = await db.from('financeiro_movimentos').insert({
    empresa_id: c.empresa_id, conta_id: c.id, data: l.data, tipo: n(l.valor) >= 0 ? 'ENTRADA' : 'SAIDA', valor: arred(Math.abs(n(l.valor))),
    descricao: (a.descricao || l.descricao || 'Lançamento do extrato').trim().slice(0, 300), subcentro_id: a.subcentro_id || null, centro_id: centroId,
    parceiro_nome: a.parceiro_nome?.trim() || null, documento: l.documento, origem: 'EXTRATO', ref_id: `L${l.id}`, extrato_linha_id: l.id, criado_por: usuario,
  }).select('id').single();
  if (error) throw error;
  await db.from('financeiro_extrato_linhas').update({ status: 'CONCILIADO', movimento_id: m.id, conciliado_por: usuario, conciliado_em: new Date().toISOString() }).eq('id', l.id);
  return m.id as number;
}

export async function ignorarLinha(db: Db, linhaId: number, usuario: string) {
  const { data: l } = await db.from('financeiro_extrato_linhas').select('status').eq('id', linhaId).maybeSingle();
  if (!l || l.status !== 'PENDENTE') throw new Error('Só lançamento pendente pode ser ignorado.');
  await db.from('financeiro_extrato_linhas').update({ status: 'IGNORADO', conciliado_por: usuario, conciliado_em: new Date().toISOString() }).eq('id', linhaId);
}

/** Desfaz conciliação/ignorado (movimento criado do extrato é apagado). */
export async function desfazerLinha(db: Db, linhaId: number) {
  const { data: l } = await db.from('financeiro_extrato_linhas').select('id, status').eq('id', linhaId).maybeSingle();
  if (!l) throw new Error('Lançamento não encontrado.');
  const { data: ms } = await db.from('financeiro_movimentos').select('id, origem').eq('extrato_linha_id', linhaId);
  const doExtrato = ((ms || []) as any[]).filter(m => m.origem === 'EXTRATO').map(m => m.id);
  const outros = ((ms || []) as any[]).filter(m => m.origem !== 'EXTRATO').map(m => m.id);
  if (outros.length) await db.from('financeiro_movimentos').update({ extrato_linha_id: null }).in('id', outros);
  await db.from('financeiro_extrato_linhas').update({ status: 'PENDENTE', movimento_id: null, conciliado_por: null, conciliado_em: null }).eq('id', linhaId);
  if (doExtrato.length) await db.from('financeiro_movimentos').delete().in('id', doExtrato);
}

/** Painel de uma conta: linhas do extrato, movimentos sem conciliar e saldo banco × sistema. */
export async function painelConciliacao(db: Db, contaId: number, de: string, ate: string) {
  const { data: c } = await db.from('financeiro_contas').select('*').eq('id', contaId).single();
  const [rl, rm, re] = await Promise.all([
    buscarTodasPaginas<any>((d, a) => db.from('financeiro_extrato_linhas').select('id, data, valor, descricao, documento, status, movimento_id, conciliado_por')
      .eq('conta_id', contaId).gte('data', de).lte('data', ate).order('data').order('id').range(d, a), 1000, 50000),
    buscarTodasPaginas<any>((d, a) => db.from('financeiro_movimentos').select('id, data, tipo, valor, descricao, parceiro_nome, origem, documento, extrato_linha_id')
      .eq('conta_id', contaId).gte('data', somarDias(de, -10)).lte('data', somarDias(ate, 10)).order('data').order('id').range(d, a), 1000, 100000),
    db.from('financeiro_extratos').select('id, arquivo_nome, inicio, fim, saldo_final, saldo_final_data, linhas, importado_por, importado_em').eq('conta_id', contaId).order('importado_em', { ascending: false }).limit(20),
  ]);
  const linhas = rl.data || [];
  const movimentos = (rm.data || []) as any[];
  const descMov = new Map(movimentos.map(m => [m.id, m]));
  // saldo do banco: o último extrato com saldo × saldo do sistema na mesma data
  const ultimo = ((re.data || []) as any[]).find(e => e.saldo_final != null && e.saldo_final_data);
  let comparacao: { data: string; banco: number; sistema: number; diferenca: number } | null = null;
  if (ultimo && c && ultimo.saldo_final_data > c.data_saldo_inicial) {
    const [s] = (await contasComSaldo(db, [c.empresa_id], ultimo.saldo_final_data)).filter(x => x.id === contaId);
    if (s) comparacao = { data: ultimo.saldo_final_data, banco: n(ultimo.saldo_final), sistema: s.saldo, diferenca: arred(n(ultimo.saldo_final) - s.saldo) };
  }
  return {
    conta: { id: c.id, nome: c.nome, data_saldo_inicial: c.data_saldo_inicial },
    linhas: linhas.map((l: any) => ({ ...l, valor: n(l.valor), movimento: l.movimento_id ? descMov.get(l.movimento_id)?.descricao || null : null })),
    // movimentos do período que o banco ainda não mostrou (ou que não casaram)
    soNoSistema: movimentos.filter(m => !m.extrato_linha_id && m.data >= de && m.data <= ate).map(m => ({ ...m, valor: n(m.valor) })),
    candidatos: movimentos.filter(m => !m.extrato_linha_id).map(m => ({ ...m, valor: n(m.valor) })),
    resumo: {
      pendentes: linhas.filter((l: any) => l.status === 'PENDENTE').length,
      conciliadas: linhas.filter((l: any) => l.status === 'CONCILIADO').length,
      ignoradas: linhas.filter((l: any) => l.status === 'IGNORADO').length,
    },
    comparacao, extratos: re.data || [],
  };
}
