'use server';

// app/admin/financeiro/conciliacao/actions.ts
// Conciliação bancária por OFX (Financeiro completo, 2026-11-20) — regras em
// app/lib/financeiro/conciliacao.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import {
  previaOfx, importarOfx, conciliarAutomatico, conciliarManual, lancarDoExtrato, ignorarLinha, desfazerLinha, painelConciliacao,
} from '../../../lib/financeiro/conciliacao';
import { contasComSaldo } from '../../../lib/financeiro/caixa';
import { dataValida } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/conciliacao';
const MAX_BYTES = 5_000_000;

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const permitidas = await obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada);
  const db = supabaseAdmin();
  const { data } = await db.from('empresas').select('id').eq('ativo', true);
  const empresas = ((data || []) as any[]).map(e => e.id as number).filter(id => empresaPermitida(permitidas, id));
  return { perfil: v.perfil, permitidas, empresas, db } as const;
}
type Ctx = { permitidas: number[] | null; db: ReturnType<typeof supabaseAdmin> };
async function contaVisivel(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from('financeiro_contas').select('id, empresa_id, nome').eq('id', id).maybeSingle();
  if (!data || !empresaPermitida(ctx.permitidas, data.empresa_id)) return null;
  return data;
}
async function linhaVisivel(ctx: Ctx, linhaId: number) {
  const { data } = await ctx.db.from('financeiro_extrato_linhas').select('id, conta_id').eq('id', linhaId).maybeSingle();
  return data && (await contaVisivel(ctx, data.conta_id)) ? data : null;
}
const bytesDe = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'));
function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'FINANCEIRO', equipamento_nome: detalhe });
}

export async function contasConciliacaoAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const contas = (await contasComSaldo(ctx.db, ctx.empresas)).filter(c => c.ativa);
    const { data: subs } = await ctx.db.from('financeiro_subcentros').select('id, nome_p2s, centro:financeiro_centros(nome)').eq('em_desuso', false);
    return {
      ok: true,
      info: {
        contas: contas.map(c => ({ id: c.id, nome: c.nome, empresa_id: c.empresa_id, saldo: c.saldo, pendentes: c.pendentes_conciliar, data_saldo_inicial: c.data_saldo_inicial })),
        subcentros: ((subs || []) as any[]).map(s => ({ id: s.id, nome: `${s.centro?.nome || ''} — ${s.nome_p2s}` })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function previaOfxAction(base64: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!base64 || base64.length > MAX_BYTES * 1.4) return { ok: false, erro: 'Arquivo vazio ou grande demais (máx. 5 MB).' };
  try {
    return { ok: true, info: await previaOfx(ctx.db, bytesDe(base64), ctx.empresas) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function importarOfxAction(contaId: number, base64: string, arquivoNome: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!base64 || base64.length > MAX_BYTES * 1.4) return { ok: false, erro: 'Arquivo vazio ou grande demais (máx. 5 MB).' };
  try {
    const c = await contaVisivel(ctx, contaId);
    if (!c) return { ok: false, erro: 'Conta não encontrada.' };
    const r = await importarOfx(ctx.db, contaId, bytesDe(base64), arquivoNome || 'extrato.ofx', ctx.perfil.nome);
    log(ctx.perfil.nome, 'IMPORTOU EXTRATO OFX', `${c.nome}: ${r.novas} novo(s), ${r.repetidas} repetido(s), ${r.conciliadas} conciliado(s)`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function painelConciliacaoAction(contaId: number, de: string, ate: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(de) || !dataValida(ate)) return { ok: false, erro: 'Período inválido.' };
  try {
    if (!(await contaVisivel(ctx, contaId))) return { ok: false, erro: 'Conta não encontrada.' };
    return { ok: true, info: await painelConciliacao(ctx.db, contaId, de, ate) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function conciliarAutomaticoAction(contaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await contaVisivel(ctx, contaId))) return { ok: false, erro: 'Conta não encontrada.' };
    return { ok: true, info: await conciliarAutomatico(ctx.db, contaId, ctx.perfil.nome) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function conciliarManualAction(linhaId: number, movimentoIds: number[], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await linhaVisivel(ctx, linhaId))) return { ok: false, erro: 'Lançamento não encontrado.' };
    await conciliarManual(ctx.db, linhaId, movimentoIds, ctx.perfil.nome);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function lancarDoExtratoAction(linhaId: number, dados: { descricao: string; subcentro_id?: number | null; parceiro_nome?: string | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await linhaVisivel(ctx, linhaId))) return { ok: false, erro: 'Lançamento não encontrado.' };
    const id = await lancarDoExtrato(ctx.db, linhaId, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'LANÇOU MOVIMENTO A PARTIR DO EXTRATO', dados.descricao);
    return { ok: true, info: { id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function ignorarLinhaAction(linhaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await linhaVisivel(ctx, linhaId))) return { ok: false, erro: 'Lançamento não encontrado.' };
    await ignorarLinha(ctx.db, linhaId, ctx.perfil.nome);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function desfazerLinhaAction(linhaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await linhaVisivel(ctx, linhaId))) return { ok: false, erro: 'Lançamento não encontrado.' };
    await desfazerLinha(ctx.db, linhaId);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
