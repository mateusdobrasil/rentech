'use server';

// app/admin/financeiro/fluxo/actions.ts
// Fluxo de Caixa e DRE (Financeiro completo, 2026-11-20) — regras em app/lib/financeiro/fluxo.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { fluxoCaixa, dre, type Agrupamento } from '../../../lib/financeiro/fluxo';
import { dataValida } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/fluxo';

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const permitidas = await obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada);
  const db = supabaseAdmin();
  const { data } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
  const empresas = ((data || []) as any[]).filter(e => empresaPermitida(permitidas, e.id)).map(e => ({ id: e.id as number, nome: String(e.nome_curto || e.nome).trim() }));
  return { perfil: v.perfil, empresas, db } as const;
}
const escolhidas = (ctx: { empresas: { id: number }[] }, empresaId: number | null) =>
  empresaId ? ctx.empresas.filter(e => e.id === empresaId).map(e => e.id) : ctx.empresas.map(e => e.id);

export async function fluxoCaixaAction(f: { empresaId: number | null; de: string; ate: string; agrupamento: Agrupamento }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(f.de) || !dataValida(f.ate) || f.ate < f.de) return { ok: false, erro: 'Período inválido.' };
  const ids = escolhidas(ctx, f.empresaId);
  if (!ids.length) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    return { ok: true, info: { empresas: ctx.empresas, dados: await fluxoCaixa(ctx.db, ids, f.de, f.ate, ['DIA', 'SEMANA', 'MES'].includes(f.agrupamento) ? f.agrupamento : 'SEMANA') } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function dreAction(f: { empresaId: number | null; de: string; ate: string; regime: 'CAIXA' | 'COMPETENCIA' }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(f.de) || !dataValida(f.ate) || f.ate < f.de) return { ok: false, erro: 'Período inválido.' };
  const ids = escolhidas(ctx, f.empresaId);
  if (!ids.length) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    return { ok: true, info: { empresas: ctx.empresas, dados: await dre(ctx.db, ids, f.de, f.ate, f.regime === 'COMPETENCIA' ? 'COMPETENCIA' : 'CAIXA') } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
