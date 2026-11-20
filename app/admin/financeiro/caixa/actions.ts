'use server';

// app/admin/financeiro/caixa/actions.ts
// Caixa e Bancos (Financeiro completo, 2026-11-20) — regras em app/lib/financeiro/caixa.ts.
// Rota /admin/financeiro/caixa (mesmas permissões/2FA de Títulos a Receber).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import {
  contasComSaldo, salvarConta, criarContasDoP2s, sincronizarMovimentosP2s, extratoConta, transferir, lancarAvulso, excluirMovimento,
  fontesDasEmpresas, type DadosConta,
} from '../../../lib/financeiro/caixa';
import { hojeISO } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/caixa';

async function contexto(accessToken: string, rotas: string[] = [ROTA]) {
  const v = rotas.length === 1 ? await validarAcesso(accessToken, rotas[0]) : await validarAcessoAlgumaRota(accessToken, rotas);
  if (!v.ok) return { erro: v.message } as const;
  const permitidas = await obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada);
  return { perfil: v.perfil, permitidas, db: supabaseAdmin() } as const;
}
type Ctx = { permitidas: number[] | null; db: ReturnType<typeof supabaseAdmin> };

async function empresasVisiveis(ctx: Ctx) {
  const { data } = await ctx.db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
  return ((data || []) as any[]).filter(e => empresaPermitida(ctx.permitidas, e.id)).map(e => ({ id: e.id as number, nome: String(e.nome_curto || e.nome).trim() }));
}
async function contaVisivel(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from('financeiro_contas').select('id, empresa_id').eq('id', id).maybeSingle();
  if (!data) return { erro: 'Conta não encontrada.' } as const;
  if (!empresaPermitida(ctx.permitidas, data.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  return { conta: data } as const;
}
function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'FINANCEIRO', equipamento_nome: detalhe });
}

export async function painelCaixaAction(ate: string | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const empresas = await empresasVisiveis(ctx);
    const ids = empresas.map(e => e.id);
    const [contas, fontes] = await Promise.all([contasComSaldo(ctx.db, ids, ate || hojeISO()), fontesDasEmpresas(ctx.db, ids)]);
    const { data: subs } = await ctx.db.from('financeiro_subcentros').select('id, nome_p2s, em_desuso, centro:financeiro_centros(nome)').eq('em_desuso', false);
    return {
      ok: true,
      info: {
        empresas: empresas.map(e => ({ ...e, fonte: fontes.get(e.id) || 'P2S' })), contas, hoje: hojeISO(),
        subcentros: ((subs || []) as any[]).map(s => ({ id: s.id, nome: `${s.centro?.nome || ''} — ${s.nome_p2s}` })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function salvarContaAction(id: number | null, dados: DadosConta, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    if (id) { const v = await contaVisivel(ctx, id); if ('erro' in v) return { ok: false, erro: v.erro }; }
    const novoId = await salvarConta(ctx.db, id, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, id ? 'EDITOU CONTA FINANCEIRA' : 'CRIOU CONTA FINANCEIRA', `${dados.nome} · saldo ${dados.saldo_inicial} em ${dados.data_saldo_inicial}`);
    // saldo inicial/nome do P2S mudou: refaz os movimentos espelhados desta conta
    await sincronizarMovimentosP2s(ctx.db, [dados.empresa_id]);
    return { ok: true, info: { id: novoId } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarContasDoP2sAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const ids = (await empresasVisiveis(ctx)).map(e => e.id);
    const r = await criarContasDoP2s(ctx.db, ids, ctx.perfil.nome);
    if (r.criadas) await sincronizarMovimentosP2s(ctx.db, ids);
    log(ctx.perfil.nome, 'CRIOU CONTAS FINANCEIRAS A PARTIR DO P2S', r.contas.join(', ') || 'nenhuma nova');
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function sincronizarP2sAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const ids = (await empresasVisiveis(ctx)).map(e => e.id);
    return { ok: true, info: await sincronizarMovimentosP2s(ctx.db, ids) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function extratoContaAction(contaId: number, de: string, ate: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA, '/admin/financeiro/conciliacao', '/admin/financeiro/fluxo']);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await contaVisivel(ctx, contaId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    return { ok: true, info: await extratoConta(ctx.db, contaId, de, ate) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function transferirAction(dados: { de_conta_id: number; para_conta_id: number; data: string; valor: number; descricao?: string | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    for (const id of [dados.de_conta_id, dados.para_conta_id]) { const v = await contaVisivel(ctx, id); if ('erro' in v) return { ok: false, erro: v.erro }; }
    const r = await transferir(ctx.db, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'TRANSFERÊNCIA ENTRE CONTAS', `R$ ${dados.valor} em ${dados.data}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function lancarAvulsoAction(dados: Parameters<typeof lancarAvulso>[1], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA, '/admin/financeiro/conciliacao']);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await contaVisivel(ctx, dados.conta_id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const id = await lancarAvulso(ctx.db, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, dados.ajuste ? 'AJUSTE DE SALDO' : 'LANÇAMENTO AVULSO NO CAIXA', `${dados.tipo} R$ ${dados.valor} · ${dados.descricao}`);
    return { ok: true, info: { id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function excluirMovimentoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const { data: m } = await ctx.db.from('financeiro_movimentos').select('empresa_id, descricao, valor').eq('id', id).maybeSingle();
    if (!m || !empresaPermitida(ctx.permitidas, m.empresa_id)) return { ok: false, erro: 'Movimento não encontrado.' };
    await excluirMovimento(ctx.db, id);
    log(ctx.perfil.nome, 'EXCLUIU MOVIMENTO DO CAIXA', `${m.descricao} R$ ${m.valor}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
