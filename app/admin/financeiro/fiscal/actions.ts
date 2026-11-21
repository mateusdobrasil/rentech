'use server';

// app/admin/financeiro/fiscal/actions.ts
// Fiscal — NF-e / NFS-e pela Focus NFe (2026-11-21). Regras em app/lib/fiscal/notas.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { ehAdministradorGlobal } from '../../../lib/permissoes';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { dataValida } from '../../../lib/locacao/datas';
import { numeroFicha } from '../../../lib/locacao/fichaNumero';
import { numeroExibicao } from '../../../lib/financeiro/faturamento';
import {
  emitirNfse, emitirNfe, consultarNota, cancelarNota, cartaCorrecao, arquivoNota, atualizarProcessando, operacoesNfe,
  itensRemessaDaFicha, itensRetornoDaRemessa, itemDoProduto, dadosParceiro, type ItemNfe, type VolumeNfe,
} from '../../../lib/fiscal/notas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/fiscal';
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const limpo = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const permitidas = await obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada);
  const db = supabaseAdmin();
  const { data } = await db.from('fiscal_parametros').select('*, empresa:empresas(nome, nome_curto)').eq('ativo', true).order('empresa_id');
  const emissoras = ((data || []) as any[]).filter(p => empresaPermitida(permitidas, p.empresa_id))
    .map(p => ({ id: p.empresa_id as number, nome: limpo(p.empresa?.nome_curto || p.empresa?.nome), ambiente: p.ambiente as string, parametros: p }));
  return { perfil: v.perfil, permitidas, emissoras, db, admin: ehAdministradorGlobal(v.perfil.permissaoBruta) } as const;
}
type Ctx = Exclude<Awaited<ReturnType<typeof contexto>>, { erro: string }>;
const podeEmpresa = (ctx: Ctx, id: number) => ctx.emissoras.some(e => e.id === id);
async function notaVisivel(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from('fiscal_notas').select('id, empresa_id, tipo, numero, operacao, ambiente').eq('id', id).maybeSingle();
  return data && empresaPermitida(ctx.permitidas, data.empresa_id) ? data : null;
}
function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'FINANCEIRO', equipamento_nome: detalhe });
}
const falha = (e: any): Resultado => ({ ok: false, erro: e?.message || String(e) });

// ============================================================================
// PAINEL
// ============================================================================
export async function painelFiscalAction(f: { de: string; ate: string }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(f.de) || !dataValida(f.ate)) return { ok: false, erro: 'Período inválido.' };
  try {
    await atualizarProcessando(ctx.db, 20).catch(() => 0);
    const ids = ctx.emissoras.map(e => e.id);
    const { data: notas, error } = await buscarTodasPaginas<any>((d, a) => ctx.db.from('fiscal_notas')
      .select('id, empresa_id, tipo, operacao, ambiente, status, numero, serie, chave, valor_total, mensagem, criado_em, criado_por, data_emissao, ficha_reserva_id, ficha_locacao_id, fatura_id, nota_referenciada_id, caminho_pdf, caminho_xml, url_consulta, cartas_correcao, motivo_cancelamento, parceiro:parceiros(nome_exibicao, nome_completo), os:locacao_fichas_reserva(id, origem, p2s_numero), fl:locacao_fichas_locacao(numero), fatura:financeiro_faturas(serie, numero)')
      .in('empresa_id', ids.length ? ids : [0]).gte('criado_em', `${f.de}T00:00:00-03:00`).lte('criado_em', `${f.ate}T23:59:59-03:00`)
      .order('id', { ascending: false }).range(d, a), 1000, 20000);
    if (error) throw error;
    const ops = await operacoesNfe(ctx.db);
    return {
      ok: true, info: {
        admin: ctx.admin, emissoras: ctx.emissoras.map(e => ({ id: e.id, nome: e.nome, ambiente: e.ambiente })),
        parametros: ctx.admin ? ctx.emissoras.map(e => e.parametros) : [], operacoes: ops,
        notas: (notas || []).map((x: any) => ({
          ...x, cliente: x.parceiro ? limpo(x.parceiro.nome_exibicao || x.parceiro.nome_completo) : '—', parceiro: undefined,
          os: x.os ? numeroFicha(x.os) : null, fl: x.fl?.numero || null, fatura: x.fatura ? numeroExibicao(x.fatura) : null,
          tem_pdf: !!x.caminho_pdf, tem_xml: !!x.caminho_xml, caminho_pdf: undefined, caminho_xml: undefined,
          cce: ((x.cartas_correcao || []) as any[]).length, cartas_correcao: undefined,
        })),
      },
    };
  } catch (e) { return falha(e); }
}

// ============================================================================
// BUSCAS (cliente, produto, ficha de locação, fatura)
// ============================================================================
export async function buscarClientesAction(termo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = limpo(termo).replace(/[%,()]/g, ' ').trim();
  if (t.length < 2) return { ok: true, info: [] };
  const d = t.replace(/\D/g, '');
  let q = ctx.db.from('parceiros').select('id, nome_exibicao, nome_completo, cnpj, cpf, cidade1, estado1').limit(20);
  q = d.length >= 5 ? q.or(`cnpj_digitos.ilike.%${d}%,cpf_digitos.ilike.%${d}%`) : q.or(`nome_exibicao.ilike.%${t}%,nome_completo.ilike.%${t}%`);
  const { data, error } = await q;
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: ((data || []) as any[]).map(p => ({ id: p.id, nome: limpo(p.nome_exibicao || p.nome_completo), doc: p.cnpj || p.cpf || '', cidade: [p.cidade1, p.estado1].filter(Boolean).join('/') })) };
}

export async function dadosClienteAction(parceiroId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const d = await dadosParceiro(ctx.db, parceiroId);
    return { ok: true, info: { id: d.id, nome: d.nome, doc: d.cnpj || d.cpf, ie: d.ie, cidade: d.cidade, uf: d.uf, email: d.email, faltas: d.faltas } };
  } catch (e) { return falha(e); }
}

export async function buscarProdutosAction(termo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = limpo(termo).replace(/[%,()]/g, ' ').trim();
  if (t.length < 2) return { ok: true, info: [] };
  const { data, error } = await ctx.db.from('produtos').select('id, nome_item, codigo_formatado').or(`nome_item.ilike.%${t}%,codigo_formatado.ilike.%${t}%`).limit(20);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: ((data || []) as any[]).map(p => ({ id: p.id, nome: limpo(p.nome_item), codigo: p.codigo_formatado })) };
}

export async function itemProdutoAction(produtoId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: await itemDoProduto(ctx.db, produtoId) }; } catch (e) { return falha(e); }
}

export async function buscarFichasLocacaoAction(termo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = limpo(termo).replace(/[%,()]/g, '');
  if (t.length < 2) return { ok: true, info: [] };
  const ids = ctx.emissoras.map(e => e.id);
  const { data, error } = await ctx.db.from('locacao_fichas_locacao').select('id, numero, origem, data_saida, parceiro:parceiros(nome_exibicao, nome_completo)')
    .in('empresa_id', ids.length ? ids : [0]).ilike('numero', `%${t}%`).order('id', { ascending: false }).limit(15);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: ((data || []) as any[]).map(f => ({ id: f.id, numero: f.numero, origem: f.origem, saida: f.data_saida, cliente: f.parceiro ? limpo(f.parceiro.nome_exibicao || f.parceiro.nome_completo) : '—' })) };
}

/** Remessa: itens (com o cliente ou previstos) + cliente + avisos. */
export async function prepararRemessaAction(fichaLocacaoId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const r = await itensRemessaDaFicha(ctx.db, fichaLocacaoId);
    if (!podeEmpresa(ctx, r.ficha.empresa_id)) return { ok: false, erro: 'Esta empresa não emite nota fiscal pelo sistema (só a Rentech).' };
    const { data: ja } = await ctx.db.from('fiscal_notas').select('id, numero, status').eq('ficha_locacao_id', fichaLocacaoId).eq('operacao', 'REMESSA_LOCACAO').in('status', ['AUTORIZADA', 'PROCESSANDO']);
    return { ok: true, info: { ...r, remessasExistentes: ja || [] } };
  } catch (e) { return falha(e); }
}

export async function prepararRetornoAction(remessaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const v = await notaVisivel(ctx, remessaId);
  if (!v) return { ok: false, erro: 'Nota não encontrada.' };
  try { return { ok: true, info: await itensRetornoDaRemessa(ctx.db, remessaId) }; } catch (e) { return falha(e); }
}

/** NFS-e a partir de uma Nota de Débito: cliente, valores de serviço/locação e texto. */
export async function prepararNfseFaturaAction(faturaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { data: f } = await ctx.db.from('financeiro_faturas').select('id, empresa_id, serie, numero, parceiro_id, ficha_reserva_id, itens, valor_total, status, evento:locacao_fichas_reserva(evento:eventos_feiras(nome))').eq('id', faturaId).maybeSingle();
  if (!f || !empresaPermitida(ctx.permitidas, f.empresa_id)) return { ok: false, erro: 'Fatura não encontrada.' };
  if (!podeEmpresa(ctx, f.empresa_id)) return { ok: false, erro: 'Esta empresa não emite nota fiscal pelo sistema (só a Rentech).' };
  const itens = (f.itens || []) as any[];
  const servicos = itens.filter(i => i.tipo === 'SERVICO' && n(i.valor_total) > 0);
  const valorServ = Math.round(servicos.reduce((a, i) => a + n(i.valor_total), 0) * 100) / 100;
  const nd = numeroExibicao(f as any);
  const evento = (f as any).evento?.evento?.nome;
  return {
    ok: true, info: {
      faturaId: f.id, empresaId: f.empresa_id, parceiroId: f.parceiro_id, fichaReservaId: f.ficha_reserva_id, numero: nd, total: n(f.valor_total), valorServicos: valorServ,
      discServicos: `Serviços referentes à Nota de Débito ${nd}${evento ? ` — ${evento}` : ''}: ${servicos.map(i => limpo(i.descricao)).join('; ')}.`,
      discLocacao: `Locação de bens móveis referente à Nota de Débito ${nd}${evento ? ` — ${evento}` : ''}.`,
    },
  };
}

// ============================================================================
// EMISSÃO
// ============================================================================
export async function emitirNfseAction(a: { empresaId: number; operacao: 'SERVICO' | 'LOCACAO'; parceiroId: number; valor: number; discriminacao: string; issRetido?: boolean; fichaReservaId?: number | null; faturaId?: number | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!podeEmpresa(ctx, a.empresaId)) return { ok: false, erro: 'Esta empresa não emite nota fiscal pelo sistema.' };
  if (!['SERVICO', 'LOCACAO'].includes(a.operacao)) return { ok: false, erro: 'Operação inválida.' };
  try {
    const r = await emitirNfse(ctx.db, a, ctx.perfil.nome);
    log(ctx.perfil.nome, 'EMITIU NFS-e', `nota #${r.id} · ${a.operacao} · R$ ${n(a.valor).toFixed(2)} → ${r.status}`);
    return { ok: true, info: r };
  } catch (e) { return falha(e); }
}

export async function emitirNfeAction(a: {
  empresaId: number; operacao: string; parceiroId: number; itens: ItemNfe[]; informacoes?: string | null; volumes?: VolumeNfe | null; modalidadeFrete?: number; formaPagamento?: string | null;
  fichaReservaId?: number | null; fichaLocacaoId?: number | null; notaReferenciadaId?: number | null;
}, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!podeEmpresa(ctx, a.empresaId)) return { ok: false, erro: 'Esta empresa não emite nota fiscal pelo sistema.' };
  try {
    if (a.fichaLocacaoId && !a.fichaReservaId) {
      const { data } = await ctx.db.from('locacao_fichas_locacao').select('ficha_reserva_id').eq('id', a.fichaLocacaoId).maybeSingle();
      a.fichaReservaId = data?.ficha_reserva_id || null;
    }
    const r = await emitirNfe(ctx.db, a, ctx.perfil.nome);
    log(ctx.perfil.nome, 'EMITIU NF-e', `nota #${r.id} · ${a.operacao} · ${a.itens.length} item(ns) → ${r.status}`);
    return { ok: true, info: r };
  } catch (e) { return falha(e); }
}

// ============================================================================
// AÇÕES SOBRE A NOTA
// ============================================================================
export async function consultarNotaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!(await notaVisivel(ctx, id))) return { ok: false, erro: 'Nota não encontrada.' };
  try { return { ok: true, info: await consultarNota(ctx.db, id) }; } catch (e) { return falha(e); }
}

export async function cancelarNotaAction(id: number, justificativa: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const v = await notaVisivel(ctx, id);
  if (!v) return { ok: false, erro: 'Nota não encontrada.' };
  try {
    await cancelarNota(ctx.db, id, justificativa, ctx.perfil.nome);
    log(ctx.perfil.nome, `CANCELOU ${v.tipo === 'NFE' ? 'NF-e' : 'NFS-e'}`, `nº ${v.numero || '#' + id}: ${limpo(justificativa)}`);
    return { ok: true };
  } catch (e) { return falha(e); }
}

export async function cartaCorrecaoAction(id: number, correcao: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const v = await notaVisivel(ctx, id);
  if (!v) return { ok: false, erro: 'Nota não encontrada.' };
  try {
    await cartaCorrecao(ctx.db, id, correcao, ctx.perfil.nome);
    log(ctx.perfil.nome, 'CARTA DE CORREÇÃO NF-e', `nº ${v.numero || '#' + id}`);
    return { ok: true };
  } catch (e) { return falha(e); }
}

export async function arquivoNotaAction(id: number, qual: 'pdf' | 'xml' | 'cce', accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!(await notaVisivel(ctx, id))) return { ok: false, erro: 'Nota não encontrada.' };
  try {
    const a = await arquivoNota(ctx.db, id, qual);
    return { ok: true, info: { base64: a.bytes.toString('base64'), nome: a.nome, tipo: a.tipo } };
  } catch (e) { return falha(e); }
}

// ============================================================================
// PARÂMETROS (só Administrador)
// ============================================================================
const CAMPOS_PARAM = ['ambiente', 'regime', 'lucro_presumido_desde', 'nfse_codigo_nbs', 'nfse_codigo_indicador_operacao', 'nfse_ibs_cbs_situacao_tributaria', 'nfse_ibs_cbs_classificacao_tributaria', 'nfse_item_lista_servico', 'nfse_codigo_tributario_municipio', 'nfse_codigo_cnae', 'nfse_aliquota', 'nfse_natureza_operacao', 'nfse_discriminacao_padrao',
  'nfse_locacao_item_lista_servico', 'nfse_locacao_aliquota', 'nfse_locacao_discriminacao_padrao', 'enviar_ibs_cbs'] as const;
export async function salvarParametrosFiscaisAction(empresaId: number, p: Record<string, any>, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.admin) return { ok: false, erro: 'Só o Administrador altera os parâmetros fiscais.' };
  if (!podeEmpresa(ctx, empresaId)) return { ok: false, erro: 'Empresa sem emissão fiscal.' };
  if (p.ambiente && !['HOMOLOGACAO', 'PRODUCAO'].includes(p.ambiente)) return { ok: false, erro: 'Ambiente inválido.' };
  if (p.regime && !['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO'].includes(p.regime)) return { ok: false, erro: 'Regime inválido.' };
  if (p.lucro_presumido_desde && !dataValida(String(p.lucro_presumido_desde))) return { ok: false, erro: 'Data do Lucro Presumido inválida.' };
  const upd: any = { atualizado_em: new Date().toISOString(), atualizado_por: ctx.perfil.nome };
  for (const k of CAMPOS_PARAM) if (k in p) {
    const v = p[k];
    upd[k] = k === 'enviar_ibs_cbs' ? !!v : /aliquota/.test(k) ? (v === '' || v === null ? null : n(String(v).replace(',', '.'))) : (limpo(v) || null);
  }
  if (upd.nfse_natureza_operacao === null) delete upd.nfse_natureza_operacao;
  if (upd.ambiente === null) delete upd.ambiente;
  if (upd.regime === null) delete upd.regime;
  const { error } = await ctx.db.from('fiscal_parametros').update(upd).eq('empresa_id', empresaId);
  if (error) return { ok: false, erro: error.message };
  log(ctx.perfil.nome, 'PARÂMETROS FISCAIS', `empresa ${empresaId}${p.ambiente ? ` · ambiente ${p.ambiente}` : ''}${p.regime ? ` · regime ${p.regime}` : ''}`);
  return { ok: true };
}

const CAMPOS_OP = ['nome', 'natureza_operacao', 'cfop_interno', 'cfop_interestadual', 'icms_situacao_tributaria', 'icms_aliquota_interna', 'icms_aliquota_interestadual',
  'pis_situacao_tributaria', 'pis_aliquota', 'cofins_situacao_tributaria', 'cofins_aliquota', 'ibs_cbs_situacao_tributaria', 'ibs_cbs_classificacao_tributaria', 'informacoes_padrao', 'icms_csosn', 'pis_cst_simples', 'cofins_cst_simples'] as const;
export async function salvarOperacaoFiscalAction(codigo: string, p: Record<string, any>, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.admin) return { ok: false, erro: 'Só o Administrador altera os parâmetros fiscais.' };
  const upd: any = { atualizado_em: new Date().toISOString(), atualizado_por: ctx.perfil.nome };
  for (const k of CAMPOS_OP) if (k in p) {
    const v = p[k];
    upd[k] = /aliquota/.test(k) ? (v === '' || v === null ? null : n(String(v).replace(',', '.'))) : (limpo(v) || null);
  }
  for (const k of ['nome', 'natureza_operacao', 'cfop_interno', 'cfop_interestadual', 'icms_situacao_tributaria', 'pis_situacao_tributaria', 'cofins_situacao_tributaria'])
    if (k in upd && !upd[k]) return { ok: false, erro: `Campo obrigatório: ${k}.` };
  for (const k of ['cfop_interno', 'cfop_interestadual']) if (upd[k] && !/^\d{4}$/.test(upd[k])) return { ok: false, erro: 'CFOP tem 4 dígitos.' };
  const { error } = await ctx.db.from('fiscal_operacoes').update(upd).eq('codigo', codigo);
  if (error) return { ok: false, erro: error.message };
  log(ctx.perfil.nome, 'OPERAÇÃO FISCAL', codigo);
  return { ok: true };
}
