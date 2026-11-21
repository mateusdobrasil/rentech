'use server';

// app/admin/financeiro/faturamento/actions.ts
// Faturamento — Nota de Débito (2026-11-20). Regras em app/lib/financeiro/faturamento.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import {
  filaAFaturar, composicaoOs, emitirFatura, cancelarFatura, dadosFatura, enviarFaturaEmail, mensagemWhatsapp, parcelasPadrao,
  numeroExibicao, linkFatura, VENCIMENTO_PADRAO_DIAS, type ParcelaFatura,
} from '../../../lib/financeiro/faturamento';
import { gerarFaturaPdf } from '../../../lib/financeiro/gerarFaturaPdf';
import { fontesDasEmpresas } from '../../../lib/financeiro/caixa';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { hojeISO, somarDias, dataValida } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/faturamento';
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const permitidas = await obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada);
  const db = supabaseAdmin();
  const { data } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
  const empresas = ((data || []) as any[]).filter(e => empresaPermitida(permitidas, e.id)).map(e => ({ id: e.id as number, nome: String(e.nome_curto || e.nome).trim() }));
  return { perfil: v.perfil, permitidas, empresas, db } as const;
}
type Ctx = { permitidas: number[] | null; db: ReturnType<typeof supabaseAdmin> };
async function osVisivel(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from('locacao_fichas_reserva').select('id, empresa_id').eq('id', id).maybeSingle();
  return data && empresaPermitida(ctx.permitidas, data.empresa_id) ? data : null;
}
async function faturaVisivel(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from('financeiro_faturas').select('id, empresa_id, serie, numero').eq('id', id).maybeSingle();
  return data && empresaPermitida(ctx.permitidas, data.empresa_id) ? data : null;
}
function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'FINANCEIRO', equipamento_nome: detalhe });
}

export async function painelFaturamentoAction(f: { empresaId: number | null; emAndamento: boolean; de: string; ate: string }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(f.de) || !dataValida(f.ate)) return { ok: false, erro: 'Período inválido.' };
  try {
    const ids = f.empresaId ? ctx.empresas.filter(e => e.id === f.empresaId).map(e => e.id) : ctx.empresas.map(e => e.id);
    const [fila, fontes, fats] = await Promise.all([
      filaAFaturar(ctx.db, ids, f.emAndamento),
      fontesDasEmpresas(ctx.db, ctx.empresas.map(e => e.id)),
      buscarTodasPaginas<any>((d, a) => ctx.db.from('financeiro_faturas')
        .select('id, empresa_id, serie, numero, status, data_emissao, valor_total, antecipada, ficha_reserva_id, enviada_email_em, enviada_email_para, enviada_whatsapp_em, token_publico, parceiro:parceiros(nome_exibicao, nome_completo)')
        .in('empresa_id', ids.length ? ids : [0]).gte('data_emissao', f.de).lte('data_emissao', f.ate).order('data_emissao', { ascending: false }).order('id', { ascending: false }).range(d, a), 1000, 20000),
    ]);
    const fatIds = (fats.data || []).map((x: any) => x.id);
    const tits: any[] = [];
    for (let i = 0; i < fatIds.length; i += 300) {
      const { data } = await ctx.db.from('financeiro_titulos_receber').select('fatura_id, valor, status, vencimento').in('fatura_id', fatIds.slice(i, i + 300)).neq('status', 'CANCELADO');
      tits.push(...(data || []));
    }
    const hoje = hojeISO();
    const faturas = (fats.data || []).map((x: any) => {
      const t = tits.filter(y => y.fatura_id === x.id);
      const pago = t.filter(y => y.status === 'PAGO').reduce((a, y) => a + n(y.valor), 0);
      const vencido = t.some(y => y.status === 'ABERTO' && y.vencimento < hoje);
      return {
        id: x.id, empresa_id: x.empresa_id, serie: x.serie, numero: numeroExibicao(x), status: x.status, emissao: x.data_emissao, valor: n(x.valor_total), antecipada: x.antecipada,
        os_id: x.ficha_reserva_id, os: x.ficha_reserva_id ? `FR-${String(x.ficha_reserva_id).padStart(5, '0')}` : null, cliente: x.parceiro ? (x.parceiro.nome_exibicao || x.parceiro.nome_completo) : '—',
        email_em: x.enviada_email_em, email_para: x.enviada_email_para, whatsapp_em: x.enviada_whatsapp_em, link: linkFatura(x.token_publico),
        situacao: x.status === 'CANCELADA' ? 'CANCELADA' : pago + 0.01 >= n(x.valor_total) ? 'PAGA' : vencido ? 'VENCIDA' : pago > 0 ? 'PARCIAL' : 'EM_ABERTO',
      };
    });
    const validas = faturas.filter(x => x.status !== 'CANCELADA');
    return {
      ok: true,
      info: {
        empresas: ctx.empresas.map(e => ({ ...e, fonte: fontes.get(e.id) || 'P2S' })), fila, faturas, hoje,
        kpis: {
          aFaturar: { qtd: fila.length, valor: Math.round(fila.reduce((a: number, o: any) => a + o.saldo, 0) * 100) / 100 },
          faturado: { qtd: validas.length, valor: Math.round(validas.reduce((a, x) => a + x.valor, 0) * 100) / 100 },
          vencidas: validas.filter(x => x.situacao === 'VENCIDA').length,
        },
        usuarioEmail: ctx.perfil.email,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function composicaoOsAction(reservaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await osVisivel(ctx, reservaId))) return { ok: false, erro: 'OS não encontrada.' };
    const c = await composicaoOs(ctx.db, reservaId);
    const fonte = (await fontesDasEmpresas(ctx.db, [c.reserva.empresa_id])).get(c.reserva.empresa_id) || 'P2S';
    const primeiro = somarDias(hojeISO(), VENCIMENTO_PADRAO_DIAS);
    return {
      ok: true,
      info: {
        os: { id: c.reserva.id, numero: c.numeroOs, status: c.reserva.status, cliente: c.reserva.parceiro ? (c.reserva.parceiro.nome_exibicao || c.reserva.parceiro.nome_completo) : '—', evento: c.reserva.evento?.nome || null, inicio: c.reserva.data_inicio, fim: c.reserva.data_fim, condicao: c.reserva.condicao_pagamento, forma: c.reserva.forma_pagamento },
        itens: c.itensOs, prorrogacoes: c.prorrogacoes, totalOs: c.totalOs, descontoOs: c.descontoOs, totalProrr: c.totalProrr, jaGerado: c.jaGerado, saldo: c.saldo,
        faturas: c.faturas.map((f: any) => ({ id: f.id, numero: f.numero_exibicao, status: f.status, valor: f.valor_total, emissao: f.data_emissao })),
        serie: fonte === 'SISTEMA' ? 'OFICIAL' : 'ENSAIO', parcelasSugeridas: parcelasPadrao(c.saldo, 1, primeiro),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function emitirFaturaAction(reservaId: number, dados: { parcelas: ParcelaFatura[]; forma_pagamento?: string | null; observacoes?: string | null; desconto_extra?: number }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await osVisivel(ctx, reservaId))) return { ok: false, erro: 'OS não encontrada.' };
    const r = await emitirFatura(ctx.db, reservaId, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'EMITIU NOTA DE DÉBITO', `${r.numero}${r.serie === 'ENSAIO' ? ' (ensaio)' : ''} · OS FR-${String(reservaId).padStart(5, '0')} · R$ ${r.total}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Lote: uma Nota de Débito por OS, parcela única vencendo em N dias. */
export async function emitirLoteAction(reservaIds: number[], diasVencimento: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const venc = somarDias(hojeISO(), Math.max(0, Math.min(120, Math.floor(n(diasVencimento) || VENCIMENTO_PADRAO_DIAS))));
  const ok: string[] = [], falhas: string[] = [];
  for (const id of reservaIds.slice(0, 200)) {
    try {
      if (!(await osVisivel(ctx, id))) { falhas.push(`FR-${id}: sem acesso`); continue; }
      const c = await composicaoOs(ctx.db, id);
      if (c.saldo <= 0.009) continue;
      const r = await emitirFatura(ctx.db, id, { parcelas: [{ valor: c.saldo, vencimento: venc }] }, ctx.perfil.nome);
      ok.push(r.numero);
    } catch (e: any) {
      falhas.push(`FR-${String(id).padStart(5, '0')}: ${e.message}`);
    }
  }
  if (ok.length) log(ctx.perfil.nome, 'EMITIU NOTAS DE DÉBITO EM LOTE', `${ok.length}: ${ok.join(', ')}`);
  return { ok: true, info: { emitidas: ok, falhas } };
}

export async function cancelarFaturaAction(id: number, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const f = await faturaVisivel(ctx, id);
    if (!f) return { ok: false, erro: 'Fatura não encontrada.' };
    await cancelarFatura(ctx.db, id, motivo, ctx.perfil.nome);
    log(ctx.perfil.nome, 'CANCELOU NOTA DE DÉBITO', `${numeroExibicao(f as any)}: ${motivo}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function pdfFaturaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await faturaVisivel(ctx, id))) return { ok: false, erro: 'Fatura não encontrada.' };
    const d = await dadosFatura(ctx.db, id);
    const bytes = await gerarFaturaPdf(d);
    return { ok: true, info: { base64: Buffer.from(bytes).toString('base64'), nome: `nota-de-debito-${numeroExibicao(d.fatura)}.pdf` } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** E-mail com o PDF. Fatura de ENSAIO só pode ir para o e-mail do próprio usuário (teste). */
export async function enviarEmailFaturaAction(id: number, para: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const destino = (para || '').trim().toLowerCase();
  if (!emailValido(destino)) return { ok: false, erro: 'E-mail inválido.' };
  try {
    const f = await faturaVisivel(ctx, id);
    if (!f) return { ok: false, erro: 'Fatura não encontrada.' };
    if (f.serie === 'ENSAIO' && destino !== String(ctx.perfil.email || '').toLowerCase()) {
      return { ok: false, erro: 'Fatura de ENSAIO não vai para o cliente (o P2S ainda é oficial). Para testar, envie para o seu próprio e-mail.' };
    }
    const bytes = await gerarFaturaPdf(await dadosFatura(ctx.db, id));
    await enviarFaturaEmail(ctx.db, id, destino, bytes, ctx.perfil.nome);
    log(ctx.perfil.nome, 'ENVIOU NOTA DE DÉBITO POR E-MAIL', `${numeroExibicao(f as any)} → ${destino}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function whatsappFaturaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    if (!(await faturaVisivel(ctx, id))) return { ok: false, erro: 'Fatura não encontrada.' };
    return { ok: true, info: await mensagemWhatsapp(ctx.db, id) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function marcarWhatsappAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const f = await faturaVisivel(ctx, id);
  if (!f) return { ok: false, erro: 'Fatura não encontrada.' };
  if (f.serie === 'ENSAIO') return { ok: true };
  await ctx.db.from('financeiro_faturas').update({ enviada_whatsapp_em: new Date().toISOString() }).eq('id', id);
  log(ctx.perfil.nome, 'ENVIOU NOTA DE DÉBITO PELO WHATSAPP', numeroExibicao(f as any));
  return { ok: true };
}
