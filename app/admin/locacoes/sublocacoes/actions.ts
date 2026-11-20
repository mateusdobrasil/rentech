'use server';

// app/admin/locacoes/sublocacoes/actions.ts
// Sublocação (2026-11-20) — regras em app/lib/locacao/sublocacao.ts.
// Acesso:
//   * gestão (criar/editar/confirmar/cancelar, avaria, ranking): tela de
//     Sublocação OU a OS (Orçamentos e Reservas) — Locação é só do
//     Administrador por enquanto; criar/alterar exige permissão de editar fichas;
//   * entrada/devolução ao parceiro: também pela Expedição (operação);
//   * dados para a OP: também pela tela de nova OP.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { acessoLocacao, podeVerCliente, MSG_FICHA_FORA_CARTEIRA } from '../../../lib/locacao/acessoFichas';
import {
  carregarSublocacao, criarSublocacao, editarSublocacao, confirmarSublocacao, cancelarSublocacao, registrarMovimentoSublocacao,
  registrarAvariaSublocacao, dadosOpSublocacao, margemDaOs, rankingSublocacao, pendenciasExpedicaoSublocacao, numeroSublocacao,
  type DadosSublocacao,
} from '../../../lib/locacao/sublocacao';
import { buscarProdutosLocaveis } from '../../../lib/locacao/buscas';
import { numeroFichaPorId } from '../../../lib/locacao/fichaNumero';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/locacoes/sublocacoes';
const ROTA_OS = '/admin/locacoes/reservas';
const ROTA_EXPEDICAO = '/admin/estoque/expedicao';
const ROTA_OP = '/admin/op/nova';
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nomeParceiro = (p: any) => (p ? (p.nome_exibicao || p.nome_completo || '—') : '—');
const SEM_PERMISSAO = 'Seu usuário não pode alterar fichas de locação (sublocação é do Comercial).';

async function contexto(accessToken: string, rotas: string[] = [ROTA, ROTA_OS]) {
  const v = await validarAcessoAlgumaRota(accessToken, rotas);
  if (!v.ok) return { erro: v.message } as const;
  const db = supabaseAdmin();
  const [permitidas, acesso] = await Promise.all([obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada), acessoLocacao(db, v.perfil)]);
  return { perfil: v.perfil, permitidas, acesso, db } as const;
}

async function sublocacaoVisivel(ctx: { permitidas: number[] | null; db: ReturnType<typeof supabaseAdmin> }, id: number) {
  const { data } = await ctx.db.from('locacao_sublocacoes').select('id, empresa_id, ficha_reserva_id, status').eq('id', id).maybeSingle();
  if (!data) return { erro: 'Sublocação não encontrada.' } as const;
  if (!empresaPermitida(ctx.permitidas, data.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  return { s: data as any } as const;
}

function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'LOCACOES', equipamento_nome: detalhe });
}

// ============================================================================
// LISTA / DETALHE
// ============================================================================
export async function listarSublocacoesAction(filtros: { status: string; busca: string }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    let q = ctx.db.from('locacao_sublocacoes')
      .select('id, empresa_id, status, data_retirada, data_devolucao, valor_frete, vencimento, ficha_reserva_id, criado_em, fornecedor:parceiros(nome_exibicao, nome_completo), os:locacao_fichas_reserva(id, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)), itens:locacao_sublocacao_itens(id, descricao, quantidade, valor_total)')
      .order('data_retirada', { ascending: false }).order('id', { ascending: false }).limit(500);
    if (filtros.status) q = q.eq('status', filtros.status);
    if (ctx.permitidas !== null) q = q.in('empresa_id', ctx.permitidas.length ? ctx.permitidas : [0]);
    const { data, error } = await q;
    if (error) throw error;
    const ids = ((data || []) as any[]).map(s => s.id);
    const [{ data: movs }, { data: ops }, { data: avs }] = ids.length ? await Promise.all([
      ctx.db.from('locacao_sublocacao_movimentos').select('sublocacao_id, tipo, quantidade').in('sublocacao_id', ids),
      ctx.db.from('op_ordens_pagamento').select('sublocacao_id, status, total_geral').in('sublocacao_id', ids),
      ctx.db.from('locacao_avarias').select('sublocacao_id, valor_parceiro').in('sublocacao_id', ids),
    ]) : [{ data: [] }, { data: [] }, { data: [] }];
    const t = (filtros.busca || '').trim().toLowerCase();
    const linhas = ((data || []) as any[]).map(s => {
      const qtd = (s.itens || []).reduce((a: number, i: any) => a + n(i.quantidade), 0);
      const soma = (tipo: string) => ((movs || []) as any[]).filter(m => m.sublocacao_id === s.id && m.tipo === tipo).reduce((a, m) => a + n(m.quantidade), 0);
      const recebido = soma('ENTRADA'), devolvido = soma('DEVOLUCAO');
      const custo = (s.itens || []).reduce((a: number, i: any) => a + n(i.valor_total), 0) + n(s.valor_frete)
        + ((avs || []) as any[]).filter(a => a.sublocacao_id === s.id).reduce((a, x) => a + n(x.valor_parceiro), 0);
      const opsS = ((ops || []) as any[]).filter(o => o.sublocacao_id === s.id);
      const emOp = opsS.filter(o => o.status !== 'REPROVADA').reduce((a, o) => a + n(o.total_geral), 0);
      const pago = opsS.filter(o => o.status === 'PAGO').reduce((a, o) => a + n(o.total_geral), 0);
      return {
        id: s.id, numero: numeroSublocacao(s.id), empresa_id: s.empresa_id, status: s.status, fornecedor: nomeParceiro(s.fornecedor),
        os: s.ficha_reserva_id ? numeroFichaPorId(s.ficha_reserva_id) : null, os_id: s.ficha_reserva_id, cliente: s.os ? nomeParceiro(s.os.parceiro) : null, evento: s.os?.evento?.nome || null,
        retirada: s.data_retirada, devolucao: s.data_devolucao, itens: (s.itens || []).map((i: any) => `${n(i.quantidade)}× ${i.descricao}`).join(', '),
        quantidade: qtd, recebido, devolvido, custo: Math.round(custo * 100) / 100, emOp, pago,
        pagamento: custo <= 0.009 ? 'SEM_CUSTO' : pago + 0.01 >= custo ? 'PAGO' : emOp + 0.01 >= custo ? 'EM_OP' : emOp > 0 ? 'PARCIAL' : 'SEM_OP',
      };
    }).filter(l => !t || [l.numero, l.fornecedor, l.os, l.cliente, l.evento, l.itens].some(x => (x || '').toLowerCase().includes(t)));
    const { data: emps } = await ctx.db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
    const empresas = ((emps || []) as any[]).filter(e => empresaPermitida(ctx.permitidas, e.id)).map(e => ({ id: e.id as number, nome: String(e.nome_curto || e.nome).trim() }));
    return { ok: true, info: { linhas, podeEditar: ctx.acesso.podeEditar, empresas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function carregarSublocacaoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA, ROTA_OS, ROTA_EXPEDICAO]);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await sublocacaoVisivel(ctx, id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const c = await carregarSublocacao(ctx.db, id);
    return { ok: true, info: { ...c, podeEditar: ctx.acesso.podeEditar, usuario: ctx.perfil.nome } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CRIAR / EDITAR / STATUS (Comercial)
// ============================================================================
export async function criarSublocacaoAction(dados: DadosSublocacao, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_PERMISSAO };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    if (dados.ficha_reserva_id) {
      const { data: f } = await ctx.db.from('locacao_fichas_reserva').select('parceiro_id').eq('id', dados.ficha_reserva_id).maybeSingle();
      if (f && !(await podeVerCliente(ctx.db, ctx.acesso, f.parceiro_id))) return { ok: false, erro: MSG_FICHA_FORA_CARTEIRA };
    }
    const r = await criarSublocacao(ctx.db, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'CRIOU SUBLOCAÇÃO', `${numeroSublocacao(r.id)}${dados.ficha_reserva_id ? ` · OS ${numeroFichaPorId(dados.ficha_reserva_id)}` : ''}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function editarSublocacaoAction(id: number, dados: Omit<DadosSublocacao, 'empresa_id' | 'ficha_reserva_id' | 'confirmar'>, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_PERMISSAO };
  try {
    const v = await sublocacaoVisivel(ctx, id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const r = await editarSublocacao(ctx.db, id, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'EDITOU SUBLOCAÇÃO', numeroSublocacao(id));
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function confirmarSublocacaoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_PERMISSAO };
  try {
    const v = await sublocacaoVisivel(ctx, id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const r = await confirmarSublocacao(ctx.db, id, ctx.perfil.nome);
    log(ctx.perfil.nome, 'CONFIRMOU SUBLOCAÇÃO', numeroSublocacao(id));
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function cancelarSublocacaoAction(id: number, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_PERMISSAO };
  try {
    const v = await sublocacaoVisivel(ctx, id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const r = await cancelarSublocacao(ctx.db, id, motivo, ctx.perfil.nome);
    log(ctx.perfil.nome, 'CANCELOU SUBLOCAÇÃO', `${numeroSublocacao(id)}: ${motivo}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ESTOQUE DO PARCEIRO (também pela Expedição) / AVARIA
// ============================================================================
export async function registrarMovimentoSublocacaoAction(id: number, dados: { tipo: 'ENTRADA' | 'DEVOLUCAO'; data: string; linhas: { item_id: number; quantidade: number }[]; observacoes?: string | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA, ROTA_OS, ROTA_EXPEDICAO]);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!['ENTRADA', 'DEVOLUCAO'].includes(dados.tipo)) return { ok: false, erro: 'Tipo inválido.' };
  try {
    const v = await sublocacaoVisivel(ctx, id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    await registrarMovimentoSublocacao(ctx.db, id, dados.tipo, dados.linhas || [], dados.data, ctx.perfil.nome, dados.observacoes);
    log(ctx.perfil.nome, dados.tipo === 'ENTRADA' ? 'SUBLOCAÇÃO: ENTRADA DO PARCEIRO' : 'SUBLOCAÇÃO: DEVOLUÇÃO AO PARCEIRO', numeroSublocacao(id));
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function registrarAvariaSublocacaoAction(id: number, dados: Parameters<typeof registrarAvariaSublocacao>[2], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA, ROTA_OS, ROTA_EXPEDICAO]);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await sublocacaoVisivel(ctx, id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    await registrarAvariaSublocacao(ctx.db, id, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'SUBLOCAÇÃO: AVARIA', `${numeroSublocacao(id)}: ${dados.descricao}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function pendenciasExpedicaoSublocacaoAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA_EXPEDICAO, ROTA]);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    return { ok: true, info: await pendenciasExpedicaoSublocacao(ctx.db, ctx.permitidas) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// OP / MARGEM / RANKING / BUSCAS
// ============================================================================
export async function dadosOpSublocacaoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA_OP, ROTA, ROTA_OS]);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await sublocacaoVisivel(ctx, id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    return { ok: true, info: await dadosOpSublocacao(ctx.db, id) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function margemOsAction(fichaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const { data: f } = await ctx.db.from('locacao_fichas_reserva').select('empresa_id, parceiro_id').eq('id', fichaId).maybeSingle();
    if (!f || !empresaPermitida(ctx.permitidas, f.empresa_id)) return { ok: false, erro: 'OS não encontrada.' };
    if (!(await podeVerCliente(ctx.db, ctx.acesso, f.parceiro_id))) return { ok: false, erro: MSG_FICHA_FORA_CARTEIRA };
    return { ok: true, info: await margemDaOs(ctx.db, fichaId) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function rankingSublocacaoAction(de: string, ate: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    return { ok: true, info: await rankingSublocacao(ctx.db, ctx.permitidas, de, ate) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarFornecedoresAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = (texto || '').trim().replace(/[%,()]/g, ' ');
  if (t.length < 2) return { ok: true, info: [] };
  try {
    const dig = t.replace(/\D/g, '');
    const filtros = [`nome_exibicao.ilike.%${t}%`, `nome_completo.ilike.%${t}%`];
    if (dig.length >= 5) filtros.push(`cnpj_digitos.ilike.%${dig}%`, `cpf_digitos.ilike.%${dig}%`);
    const { data, error } = await ctx.db.from('parceiros').select('id, nome_exibicao, nome_completo, cnpj, cpf, cidade1, estado1, flag_fornecedor')
      .or(filtros.join(',')).order('flag_fornecedor', { ascending: false }).limit(30);
    if (error) throw error;
    return { ok: true, info: ((data || []) as any[]).map(p => ({ id: p.id, nome: nomeParceiro(p), detalhe: [p.cnpj || p.cpf, [p.cidade1, p.estado1].filter(Boolean).join('/'), p.flag_fornecedor ? 'fornecedor' : null].filter(Boolean).join(' · ') })) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarProdutosSublocacaoAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    return { ok: true, info: await buscarProdutosLocaveis(ctx.db, texto) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** OSs do sistema para vincular uma sublocação avulsa (por nº FR-… ou cliente). */
export async function buscarOsSublocacaoAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = (texto || '').trim();
  if (t.length < 2) return { ok: true, info: [] };
  try {
    const num = Number(t.replace(/\D/g, ''));
    let q = ctx.db.from('locacao_fichas_reserva').select('id, empresa_id, status, data_inicio, data_fim, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)')
      .eq('origem', 'SISTEMA').in('status', ['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA', 'EM_LOCACAO']).order('id', { ascending: false }).limit(20);
    if (num > 0 && /^\s*(FR-?)?\d+\s*$/i.test(t)) q = q.eq('id', num);
    else {
      const { data: parc } = await ctx.db.from('parceiros').select('id').or(`nome_exibicao.ilike.%${t.replace(/[%,()]/g, ' ')}%,nome_completo.ilike.%${t.replace(/[%,()]/g, ' ')}%`).limit(100);
      q = q.in('parceiro_id', ((parc || []) as any[]).map(p => p.id).concat([0]));
    }
    if (ctx.permitidas !== null) q = q.in('empresa_id', ctx.permitidas.length ? ctx.permitidas : [0]);
    const { data, error } = await q;
    if (error) throw error;
    return { ok: true, info: ((data || []) as any[]).map(f => ({ id: f.id, empresa_id: f.empresa_id, nome: `${numeroFichaPorId(f.id)} — ${nomeParceiro(f.parceiro)}`, detalhe: [f.evento?.nome, `${f.data_inicio.split('-').reverse().join('/')} a ${f.data_fim.split('-').reverse().join('/')}`, f.status].filter(Boolean).join(' · '), inicio: f.data_inicio, fim: f.data_fim })) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
