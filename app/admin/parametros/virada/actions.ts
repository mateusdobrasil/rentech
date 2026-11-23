'use server';

// app/admin/parametros/virada/actions.ts
// Virada da chave (2026-11-21) — só o Administrador. Regras em app/lib/virada/virada.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { ehAdministradorGlobal } from '../../../lib/permissoes';
import { registrarLogAuditoria } from '../../../actions';
import { dataValida, hojeISO, somarDias } from '../../../lib/locacao/datas';
import { importarFichasP2sCore } from '../../../lib/locacao/importarFichasP2s';
import { importarFichasLocacaoP2s } from '../../../lib/locacao/importarFichasLocacaoP2s';
import { sincronizarContasReceberCore } from '../../financeiro/contas-receber/contasReceberCore';
import { sincronizarContasPagarCore } from '../../financeiro/contas-pagar/contasPagarCore';
import { fontesDasEmpresas } from '../../../lib/financeiro/caixa';
import {
  estadoVirada, checklistVirada, salvarConfirmacoes, migrarOs, finalizadasDesdePadrao, migrarContasReceber, migrarContasPagar, congelar, descongelar, concluir,
} from '../../../lib/virada/virada';
import { previaEnsaio, limparEnsaio, CATEGORIAS_ENSAIO, type CategoriaEnsaio } from '../../../lib/virada/ensaio';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/parametros/virada';

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  if (!ehAdministradorGlobal(v.perfil.permissaoBruta)) return { erro: 'Só o Administrador conduz a virada da chave.' } as const;
  return { perfil: v.perfil, db: supabaseAdmin() } as const;
}
const falha = (e: any): Resultado => ({ ok: false, erro: e?.message || String(e) });
function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'PARAMETROS', equipamento_nome: detalhe });
}

export async function painelViradaAction(empresaId: number | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const { data: emps } = await ctx.db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
    const empresas = ((emps || []) as any[]).map(e => ({ id: e.id as number, nome: String(e.nome_curto || e.nome).trim() }));
    const fontes = await fontesDasEmpresas(ctx.db, empresas.map(e => e.id));
    const estados = await Promise.all(empresas.map(async e => {
      const s = await estadoVirada(ctx.db, e.id);
      return { ...e, etapa: s.etapa, fonte: fontes.get(e.id) || 'P2S', congelada_em: s.congelada_em, concluida_em: s.concluida_em };
    }));
    const id = empresaId && empresas.some(e => e.id === empresaId) ? empresaId : empresas[0]?.id;
    if (!id) return { ok: true, info: { empresas: estados } };
    const [estado, checklist, fiscal] = await Promise.all([
      estadoVirada(ctx.db, id), checklistVirada(ctx.db, id),
      ctx.db.from('fiscal_parametros').select('ativo, ambiente, regime, lucro_presumido_desde').eq('empresa_id', id).maybeSingle(),
    ]);
    return { ok: true, info: { empresas: estados, empresaId: id, estado, checklist, fiscal: fiscal.data || null, contasDesdePadrao: estado.contas_desde || somarDias(hojeISO(), -90), finalizadasDesdePadrao: finalizadasDesdePadrao() } };
  } catch (e) { return falha(e); }
}

export async function salvarConferenciaAction(empresaId: number, confirmacoes: Record<string, boolean>, contasDesde: string | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (contasDesde && !dataValida(contasDesde)) return { ok: false, erro: 'Data de corte inválida.' };
  try { await salvarConfirmacoes(ctx.db, empresaId, confirmacoes, contasDesde, ctx.perfil.nome); return { ok: true }; } catch (e) { return falha(e); }
}

/** Última leitura do P2S antes de congelar (cada parte separada, para caber no tempo do servidor). */
export async function lerP2sAgoraAction(empresaId: number, qual: 'fichas' | 'locacao' | 'receber' | 'pagar', accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const est = await estadoVirada(ctx.db, empresaId);
    if (est.etapa !== 'PREPARACAO') return { ok: false, erro: 'A empresa já está congelada — o P2S não é mais lido.' };
    const hoje = hojeISO();
    let info: any;
    if (qual === 'fichas') info = await importarFichasP2sCore(ctx.db, { diasPassados: 120 });
    else if (qual === 'locacao') info = await importarFichasLocacaoP2s(ctx.db, { de: somarDias(hoje, -150), ate: hoje });
    else if (qual === 'receber') info = await sincronizarContasReceberCore();
    else info = await sincronizarContasPagarCore();
    log(ctx.perfil.nome, 'VIRADA: LEU O P2S', `${qual} · empresa ${empresaId}`);
    return { ok: true, info };
  } catch (e) { return falha(e); }
}

/** `desde`: data de corte das contas (receber/pagar) ou, para as OS, desde quando entram as finalizadas ainda não faturadas. */
export async function simularViradaAction(empresaId: number, parte: 'os' | 'receber' | 'pagar', desde: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(desde)) return { ok: false, erro: parte === 'os' ? 'Informe desde quando entram as finalizadas.' : 'Informe a data de corte das contas.' };
  try {
    const u = ctx.perfil.nome;
    const info = parte === 'os' ? await migrarOs(ctx.db, empresaId, desde, u, true)
      : parte === 'receber' ? await migrarContasReceber(ctx.db, empresaId, desde, u, true)
      : await migrarContasPagar(ctx.db, empresaId, desde, u, true);
    return { ok: true, info };
  } catch (e) { return falha(e); }
}

export async function executarViradaAction(empresaId: number, passo: 'congelar' | 'descongelar' | 'os' | 'receber' | 'pagar' | 'concluir', desde: string | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const u = ctx.perfil.nome;
  try {
    let info: any = null;
    if (passo === 'congelar') await congelar(ctx.db, empresaId, u);
    else if (passo === 'descongelar') await descongelar(ctx.db, empresaId, u);
    else if (passo === 'os') {
      if (!desde || !dataValida(desde)) return { ok: false, erro: 'Informe desde quando entram as finalizadas.' };
      info = await migrarOs(ctx.db, empresaId, desde, u, false);
    }
    else if (passo === 'receber' || passo === 'pagar') {
      if (!desde || !dataValida(desde)) return { ok: false, erro: 'Informe a data de corte das contas.' };
      info = passo === 'receber' ? await migrarContasReceber(ctx.db, empresaId, desde, u, false) : await migrarContasPagar(ctx.db, empresaId, desde, u, false);
    } else if (passo === 'concluir') await concluir(ctx.db, empresaId, u);
    else return { ok: false, erro: 'Passo inválido.' };
    log(u, `VIRADA DA CHAVE: ${passo.toUpperCase()}`, `empresa ${empresaId}`);
    return { ok: true, info };
  } catch (e) { return falha(e); }
}

// ============================================================================
// LIMPAR O ENSAIO (2026-11-22) — antes de congelar; regras em app/lib/virada/ensaio.ts
// ============================================================================
export async function previaEnsaioAction(empresaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const previa = await previaEnsaio(ctx.db, empresaId);
    return { ok: true, info: { previa, categorias: CATEGORIAS_ENSAIO } };
  } catch (e) { return falha(e); }
}

export async function limparEnsaioAction(empresaId: number, categorias: CategoriaEnsaio[], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const validas = new Set(CATEGORIAS_ENSAIO.map(c => c.chave));
  const escolhidas = (categorias || []).filter(c => validas.has(c));
  if (!escolhidas.length) return { ok: false, erro: 'Marque o que limpar.' };
  try {
    const r = await limparEnsaio(ctx.db, empresaId, escolhidas, ctx.perfil.nome);
    log(ctx.perfil.nome, 'VIRADA DA CHAVE: LIMPOU O ENSAIO', `empresa ${empresaId}: ${Object.entries(r.feito).map(([k, q]) => `${k} ${q}`).join(', ')}`);
    return { ok: true, info: r };
  } catch (e) { return falha(e); }
}
