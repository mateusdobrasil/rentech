'use server';

// app/admin/financeiro/titulos-pagar/actions.ts
// Contas a Pagar próprio + Recorrentes + OP (Financeiro completo, 2026-11-20)
// — regras em app/lib/financeiro/pagar.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { ehAdministradorGlobal } from '../../../lib/permissoes';
import {
  listarTitulosPagar, criarTitulo, editarTitulo, baixarTitulo, estornarBaixa, cancelarTitulo, salvarRecorrencia, gerarRecorrencias,
  sincronizarOpsTitulos, type DadosTitulo, type DadosRecorrencia,
} from '../../../lib/financeiro/pagar';
import { fontesDasEmpresas } from '../../../lib/financeiro/caixa';
import { dataValida, hojeISO } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/titulos-pagar';

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
async function tituloVisivel(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from('financeiro_titulos_pagar').select('id, empresa_id, descricao, valor').eq('id', id).maybeSingle();
  return data && empresaPermitida(ctx.permitidas, data.empresa_id) ? data : null;
}
function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'FINANCEIRO', equipamento_nome: detalhe });
}

export async function painelPagarAction(f: { empresaId: number | null; de: string; ate: string; status: string }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(f.de) || !dataValida(f.ate)) return { ok: false, erro: 'Período inválido.' };
  try {
    // mantém em dia: títulos das recorrências e das OPs
    await Promise.all([gerarRecorrencias(ctx.db), sincronizarOpsTitulos(ctx.db)]);
    const ids = f.empresaId ? ctx.empresas.filter(e => e.id === f.empresaId).map(e => e.id) : ctx.empresas.map(e => e.id);
    const [lista, fontes, contas, subs, recs] = await Promise.all([
      listarTitulosPagar(ctx.db, ids, f),
      fontesDasEmpresas(ctx.db, ctx.empresas.map(e => e.id)),
      ctx.db.from('financeiro_contas').select('id, nome, empresa_id').eq('ativa', true).in('empresa_id', ctx.empresas.map(e => e.id).concat([0])).order('ordem'),
      ctx.db.from('financeiro_subcentros').select('id, nome_p2s, centro:financeiro_centros(nome)').eq('em_desuso', false),
      ctx.db.from('financeiro_recorrencias').select('*, subcentro:financeiro_subcentros(nome_p2s)').in('empresa_id', ids.concat([0])).order('descricao'),
    ]);
    // próximo título em aberto de cada recorrência
    const recIds = ((recs.data || []) as any[]).map(r => r.id);
    const { data: prox } = recIds.length
      ? await ctx.db.from('financeiro_titulos_pagar').select('recorrencia_id, vencimento, valor, status').in('recorrencia_id', recIds).eq('status', 'ABERTO').order('vencimento')
      : { data: [] };
    const proximo = new Map<number, any>();
    for (const t of (prox || []) as any[]) if (!proximo.has(t.recorrencia_id)) proximo.set(t.recorrencia_id, t);
    return {
      ok: true,
      info: {
        ...lista, hoje: hojeISO(),
        empresas: ctx.empresas.map(e => ({ ...e, fonte: fontes.get(e.id) || 'P2S' })),
        contas: contas.data || [],
        subcentros: ((subs.data || []) as any[]).map(s => ({ id: s.id, nome: `${s.centro?.nome || ''} — ${s.nome_p2s}` })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })),
        recorrencias: ((recs.data || []) as any[]).map(r => ({ ...r, valor: Number(r.valor), subcentro_nome: r.subcentro?.nome_p2s || null, proximo: proximo.get(r.id) || null })),
        podeVirarChave: ehAdministradorGlobal(ctx.perfil.permissaoBruta),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarFornecedoresPagarAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = (texto || '').trim().replace(/[%,()]/g, ' ');
  if (t.length < 2) return { ok: true, info: [] };
  const dig = t.replace(/\D/g, '');
  const filtros = [`nome_exibicao.ilike.%${t}%`, `nome_completo.ilike.%${t}%`];
  if (dig.length >= 5) filtros.push(`cnpj_digitos.ilike.%${dig}%`, `cpf_digitos.ilike.%${dig}%`);
  const { data } = await ctx.db.from('parceiros').select('id, nome_exibicao, nome_completo, cnpj, cpf, flag_fornecedor').or(filtros.join(',')).order('flag_fornecedor', { ascending: false }).limit(25);
  return { ok: true, info: ((data || []) as any[]).map(p => ({ id: p.id, nome: p.nome_exibicao || p.nome_completo, detalhe: [p.cnpj || p.cpf, p.flag_fornecedor ? 'fornecedor' : null].filter(Boolean).join(' · ') })) };
}

export async function salvarTituloAction(id: number | null, dados: DadosTitulo, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    if (id) {
      if (!(await tituloVisivel(ctx, id))) return { ok: false, erro: 'Conta não encontrada.' };
      await editarTitulo(ctx.db, id, dados);
      log(ctx.perfil.nome, 'EDITOU CONTA A PAGAR', `#${id} ${dados.descricao} R$ ${dados.valor}`);
      return { ok: true, info: { ids: [id] } };
    }
    const ids = await criarTitulo(ctx.db, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'LANÇOU CONTA A PAGAR', `${dados.fornecedor_nome} · ${dados.descricao} R$ ${dados.valor}${ids.length > 1 ? ` em ${ids.length}x` : ''}`);
    return { ok: true, info: { ids } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarTituloAction(id: number, dados: Parameters<typeof baixarTitulo>[2], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const t = await tituloVisivel(ctx, id);
    if (!t) return { ok: false, erro: 'Conta não encontrada.' };
    const r = await baixarTitulo(ctx.db, id, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, 'PAGOU CONTA A PAGAR', `#${id} ${t.descricao} em ${dados.data_pagamento}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function estornarTituloAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const t = await tituloVisivel(ctx, id);
    if (!t) return { ok: false, erro: 'Conta não encontrada.' };
    await estornarBaixa(ctx.db, id);
    log(ctx.perfil.nome, 'ESTORNOU PAGAMENTO DE CONTA A PAGAR', `#${id} ${t.descricao}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function cancelarTituloPagarAction(id: number, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const t = await tituloVisivel(ctx, id);
    if (!t) return { ok: false, erro: 'Conta não encontrada.' };
    await cancelarTitulo(ctx.db, id, motivo);
    log(ctx.perfil.nome, 'CANCELOU CONTA A PAGAR', `#${id} ${t.descricao}: ${motivo}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function salvarRecorrenciaAction(id: number | null, dados: DadosRecorrencia, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  try {
    if (id) {
      const { data } = await ctx.db.from('financeiro_recorrencias').select('empresa_id').eq('id', id).maybeSingle();
      if (!data || !empresaPermitida(ctx.permitidas, data.empresa_id)) return { ok: false, erro: 'Recorrência não encontrada.' };
    }
    const rid = await salvarRecorrencia(ctx.db, id, dados, ctx.perfil.nome);
    log(ctx.perfil.nome, id ? 'EDITOU CONTA RECORRENTE' : 'CRIOU CONTA RECORRENTE', `${dados.descricao} R$ ${dados.valor} dia ${dados.dia_vencimento} (${dados.periodicidade})`);
    return { ok: true, info: { id: rid } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Virada da chave: a empresa passa a usar o financeiro do sistema (ou volta ao P2S). Só administrador. */
export async function definirFonteAction(empresaId: number, fonte: 'P2S' | 'SISTEMA', accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ehAdministradorGlobal(ctx.perfil.permissaoBruta)) return { ok: false, erro: 'Só o Administrador pode virar a chave do financeiro.' };
  if (!empresaPermitida(ctx.permitidas, empresaId)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  if (!['P2S', 'SISTEMA'].includes(fonte)) return { ok: false, erro: 'Fonte inválida.' };
  const { error } = await ctx.db.from('financeiro_parametros').upsert({ empresa_id: empresaId, fonte, atualizado_em: new Date().toISOString(), atualizado_por: ctx.perfil.nome }, { onConflict: 'empresa_id' });
  if (error) return { ok: false, erro: error.message };
  log(ctx.perfil.nome, 'MUDOU A FONTE DO FINANCEIRO', `empresa ${empresaId} → ${fonte}`);
  return { ok: true };
}

// ============================================================================
// ANEXOS (2026-11-22) — boleto, nota, comprovante. Bucket privado
// financeiro-anexos (.sql/Executados/financeiro_anexos_contas_pagar.sql, rodado 2026-11-23);
// upload direto do navegador por URL assinada (sem 413 no servidor) e leitura
// por URL assinada de 30 min. Caminho: <empresa>/<título>/<arquivo>.
// Conta de OP mostra também os anexos da OP (só leitura).
// ============================================================================
const BUCKET_ANEXOS = 'financeiro-anexos';
const LIMITE_ANEXO_MB = 20;
const prefixoAnexo = (t: { empresa_id: number; id: number }) => `${t.empresa_id}/${t.id}/`;
const nomeDoCaminho = (c: string) => c.split('/').pop()!.replace(/^\d+-[a-z0-9]{6}-/, '');

async function tituloComAnexos(ctx: Ctx, id: number) {
  const { data } = await ctx.db.from('financeiro_titulos_pagar').select('id, empresa_id, anexos, op_id').eq('id', id).maybeSingle();
  return data && empresaPermitida(ctx.permitidas, data.empresa_id) ? data as { id: number; empresa_id: number; anexos: string[] | null; op_id: string | null } : null;
}

export async function urlUploadAnexoPagarAction(tituloId: number, nomeArquivo: string, tamanho: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = await tituloComAnexos(ctx, Number(tituloId));
  if (!t) return { ok: false, erro: 'Conta não encontrada.' };
  if (Number(tamanho) > LIMITE_ANEXO_MB * 1024 * 1024) return { ok: false, erro: `Arquivo acima de ${LIMITE_ANEXO_MB} MB.` };
  const nome = (nomeArquivo || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'arquivo';
  const caminho = `${prefixoAnexo(t)}${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nome}`;
  const { data, error } = await ctx.db.storage.from(BUCKET_ANEXOS).createSignedUploadUrl(caminho);
  if (error) return { ok: false, erro: /not found/i.test(error.message) ? 'Falta criar o bucket de anexos (.sql/Pendentes/financeiro_anexos_contas_pagar.sql).' : error.message };
  return { ok: true, info: { caminho, token: data.token, bucket: BUCKET_ANEXOS } };
}

export async function confirmarAnexoPagarAction(tituloId: number, caminho: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = await tituloComAnexos(ctx, Number(tituloId));
  if (!t) return { ok: false, erro: 'Conta não encontrada.' };
  if (!String(caminho).startsWith(prefixoAnexo(t)) || caminho.includes('..')) return { ok: false, erro: 'Anexo inválido.' };
  const anexos = [...new Set([...(t.anexos || []), caminho])];
  const { error } = await ctx.db.from('financeiro_titulos_pagar').update({ anexos, atualizado_em: new Date().toISOString() }).eq('id', t.id);
  if (error) return { ok: false, erro: error.message };
  log(ctx.perfil.nome, 'ANEXOU ARQUIVO NA CONTA A PAGAR', `#${t.id} ${nomeDoCaminho(caminho)}`);
  return { ok: true };
}

export async function anexosTituloPagarAction(tituloId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = await tituloComAnexos(ctx, Number(tituloId));
  if (!t) return { ok: false, erro: 'Conta não encontrada.' };
  const caminhos = t.anexos || [];
  let anexos: { caminho: string; nome: string; url: string | null }[] = [];
  if (caminhos.length) {
    const { data } = await ctx.db.storage.from(BUCKET_ANEXOS).createSignedUrls(caminhos, 1800);
    anexos = caminhos.map((c, i) => ({ caminho: c, nome: nomeDoCaminho(c), url: data?.[i]?.signedUrl || null }));
  }
  let daOp: { nome: string; url: string }[] = [];
  if (t.op_id) {
    const { data: op } = await ctx.db.from('op_ordens_pagamento').select('numero_op, file_url, file_urls').eq('id', t.op_id).maybeSingle();
    const urls = [...new Set([...(Array.isArray(op?.file_urls) ? op.file_urls : []), ...(op?.file_url ? [op.file_url] : [])])].filter(Boolean) as string[];
    daOp = urls.map((u, i) => ({ nome: `OP ${op?.numero_op ?? ''} · anexo ${i + 1}`, url: u }));
  }
  return { ok: true, info: { anexos, daOp } };
}

export async function removerAnexoPagarAction(tituloId: number, caminho: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const t = await tituloComAnexos(ctx, Number(tituloId));
  if (!t) return { ok: false, erro: 'Conta não encontrada.' };
  if (!(t.anexos || []).includes(caminho)) return { ok: false, erro: 'Anexo não encontrado.' };
  const { error } = await ctx.db.from('financeiro_titulos_pagar').update({ anexos: (t.anexos || []).filter(c => c !== caminho), atualizado_em: new Date().toISOString() }).eq('id', t.id);
  if (error) return { ok: false, erro: error.message };
  await ctx.db.storage.from(BUCKET_ANEXOS).remove([caminho]);
  log(ctx.perfil.nome, 'REMOVEU ANEXO DA CONTA A PAGAR', `#${t.id} ${nomeDoCaminho(caminho)}`);
  return { ok: true };
}
