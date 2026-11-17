'use server';

// app/admin/suporte/actions.ts
// Módulo Suporte e Chamados (2026-11-17). Quem pode o quê:
//   - qualquer usuário com /admin/suporte abre chamado e acompanha os SEUS;
//   - atendente (membro da área em suporte_areas_membros) vê e trata a fila da
//     área: assumir, atribuir, responder, nota interna, transferir, status;
//   - quem tem /admin/suporte/areas (gestão) enxerga e trata TODOS, e
//     configura áreas, atendentes e prazos.
// Avisos (push + WhatsApp + e-mail conforme os cards) vão por after(), sem
// segurar a resposta da tela — ver app/lib/suporte/avisos.ts.
import { after } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso, possuiAcessoRota, obterEmpresasPermitidas, type PerfilValidado } from '../../lib/serverAuth';
import { registrarLogAuditoria } from '../../actions';
import { avisarChamado } from '../../lib/suporte/avisos';
import {
  ROTA_SUPORTE, ROTA_SUPORTE_AREAS, BUCKET_SUPORTE, CARD_AVISO_AREA, CARD_AVISO_SOLICITANTE,
  LIMITE_ANEXO_MB, MAX_ANEXOS, SLA_PADRAO, STATUS_EM_ABERTO, rotuloPrioridade, rotuloStatus,
  type Anexo, type Prioridade, type StatusChamado,
} from '../../lib/suporte/constantes';

type Resultado = { ok: boolean; erro?: string; info?: any };
type DB = ReturnType<typeof supabaseAdmin>;

const PRIORIDADES_OK: Prioridade[] = ['URGENTE', 'ALTA', 'MEDIA', 'BAIXA'];
const DIAS_AUTO_FECHAR = 7;
const txt = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);

interface Ctx { db: DB; perfil: PerfilValidado; gestor: boolean; minhasAreas: number[] }

async function contexto(accessToken: string): Promise<Ctx | { erro: string }> {
  const v = await validarAcesso(accessToken, ROTA_SUPORTE);
  if (!v.ok) return { erro: v.message };
  const db = supabaseAdmin();
  const [gestor, { data: membros }] = await Promise.all([
    possuiAcessoRota(v.perfil.permissaoNormalizada, ROTA_SUPORTE_AREAS),
    db.from('suporte_areas_membros').select('area_id').eq('perfil_id', v.perfil.id),
  ]);
  return { db, perfil: v.perfil, gestor, minhasAreas: ((membros || []) as { area_id: number }[]).map(m => m.area_id) };
}

const log = (nome: string, acao: string, detalhe: string, id?: number) =>
  registrarLogAuditoria({ usuario_nome: nome, acao, setor: 'SUPORTE', equipamento_id: id ? String(id) : null, equipamento_nome: detalhe });

function prazoPara(criadoEm: string | Date, slaHoras: Record<string, number> | null, prioridade: Prioridade): string {
  const horas = Number(slaHoras?.[prioridade]) > 0 ? Number(slaHoras![prioridade]) : SLA_PADRAO[prioridade];
  return new Date(new Date(criadoEm).getTime() + horas * 3600_000).toISOString();
}

function validarAnexos(lista: unknown, perfilId: string): Anexo[] {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, MAX_ANEXOS)
    .filter((a: any) => a && typeof a.path === 'string' && a.path.startsWith(`${perfilId}/`) && !a.path.includes('..'))
    .map((a: any) => ({ path: a.path, nome: txt(a.nome, 200) || 'arquivo', tamanho: Number(a.tamanho) || 0, tipo: txt(a.tipo, 100) }));
}

async function membrosDaArea(db: DB, areaId: number, soQuemRecebe = true): Promise<string[]> {
  let q = db.from('suporte_areas_membros').select('perfil_id').eq('area_id', areaId);
  if (soQuemRecebe) q = q.eq('receber_avisos', true);
  const { data } = await q;
  return ((data || []) as { perfil_id: string }[]).map(m => m.perfil_id);
}

async function marcarLido(db: DB, chamadoId: number, perfilId: string) {
  await db.from('suporte_leituras').upsert({ chamado_id: chamadoId, perfil_id: perfilId, lido_em: new Date().toISOString() });
}

async function evento(db: DB, chamadoId: number, autor: PerfilValidado, texto: string) {
  await db.from('suporte_mensagens').insert({ chamado_id: chamadoId, tipo: 'EVENTO', autor_id: autor.id, autor_nome: autor.nome, texto });
}

// Resolvido há mais de 7 dias sem o solicitante avaliar → fecha sozinho.
async function fecharResolvidosAntigos(db: DB) {
  const limite = new Date(Date.now() - DIAS_AUTO_FECHAR * 86400_000).toISOString();
  const { data } = await db.from('suporte_chamados').update({ status: 'FECHADO', fechado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('status', 'RESOLVIDO').lt('resolvido_em', limite).select('id');
  if (data?.length) {
    await db.from('suporte_mensagens').insert(data.map((c: any) => ({
      chamado_id: c.id, tipo: 'EVENTO', autor_id: null, autor_nome: 'SISTEMA',
      texto: `Fechado automaticamente (${DIAS_AUTO_FECHAR} dias resolvido sem avaliação).`,
    })));
  }
}

// ============================================================================
// PAINEL (lista + áreas + empresas)
// ============================================================================
export async function painelSuporteAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { db, perfil, gestor, minhasAreas } = ctx;
  try {
    await fecharResolvidosAntigos(db);

    const permitidas = await obterEmpresasPermitidas(perfil.id, perfil.permissaoNormalizada);
    const [{ data: areas }, { data: emps }, { data: contagemMembros }] = await Promise.all([
      db.from('suporte_areas').select('id, nome, descricao, icone, cor, categorias, sla_horas, ativo, ordem').order('ordem').order('nome'),
      db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id'),
      db.from('suporte_areas_membros').select('area_id'),
    ]);
    const empresas = ((emps || []) as any[])
      .filter(e => permitidas === null || permitidas.includes(e.id))
      .map(e => ({ id: e.id as number, nome: String(e.nome_curto || e.nome).trim() }));
    const qtdMembros = new Map<number, number>();
    for (const m of (contagemMembros || []) as { area_id: number }[]) qtdMembros.set(m.area_id, (qtdMembros.get(m.area_id) || 0) + 1);

    let q = db.from('suporte_chamados')
      .select('id, titulo, area_id, categoria, prioridade, status, empresa_id, solicitante_id, solicitante_nome, responsavel_id, responsavel_nome, prazo_em, primeira_resposta_em, resolvido_em, fechado_em, avaliacao, created_at, ultima_interacao_em, ultima_publica_em')
      .order('ultima_interacao_em', { ascending: false }).limit(1500);
    if (!gestor) {
      q = minhasAreas.length
        ? q.or(`solicitante_id.eq.${perfil.id},area_id.in.(${minhasAreas.join(',')})`)
        : q.eq('solicitante_id', perfil.id);
    }
    const { data: chamados, error } = await q;
    if (error) throw error;

    const ids = (chamados || []).map((c: any) => c.id);
    const lidos = new Map<number, string>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data: l } = await db.from('suporte_leituras').select('chamado_id, lido_em').eq('perfil_id', perfil.id).in('chamado_id', ids.slice(i, i + 300));
      for (const r of (l || []) as any[]) lidos.set(r.chamado_id, r.lido_em);
    }

    const lista = ((chamados || []) as any[]).map(c => {
      const souSolicitante = c.solicitante_id === perfil.id;
      const souAtendente = gestor || minhasAreas.includes(c.area_id);
      const ref = souSolicitante && !souAtendente ? c.ultima_publica_em : c.ultima_interacao_em;
      const lido = lidos.get(c.id);
      return { ...c, sou_solicitante: souSolicitante, sou_atendente: souAtendente, nao_lido: !lido || new Date(ref) > new Date(lido) };
    });

    return {
      ok: true,
      info: {
        eu: { id: perfil.id, nome: perfil.nome },
        gestor, minhasAreas, empresas,
        areas: ((areas || []) as any[]).map(a => ({ ...a, atendentes: qtdMembros.get(a.id) || 0 })),
        chamados: lista,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Badge do card no hub /admin — não lidos + fila sem responsável. Silencioso se não tiver acesso. */
export async function contadoresSuporteAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: true, info: { total: 0 } };
  const { db, perfil, minhasAreas } = ctx;
  try {
    let q = db.from('suporte_chamados').select('id, area_id, solicitante_id, responsavel_id, status, ultima_interacao_em, ultima_publica_em')
      .in('status', [...STATUS_EM_ABERTO, 'RESOLVIDO']).limit(1000);
    q = minhasAreas.length
      ? q.or(`solicitante_id.eq.${perfil.id},area_id.in.(${minhasAreas.join(',')})`)
      : q.eq('solicitante_id', perfil.id);
    const { data } = await q;
    const lista = (data || []) as any[];
    const { data: l } = lista.length
      ? await db.from('suporte_leituras').select('chamado_id, lido_em').eq('perfil_id', perfil.id).in('chamado_id', lista.map(c => c.id))
      : { data: [] as any[] };
    const lidos = new Map(((l || []) as any[]).map(r => [r.chamado_id, r.lido_em]));
    let naoLidos = 0, fila = 0;
    for (const c of lista) {
      const atendente = minhasAreas.includes(c.area_id);
      if (atendente && c.status === 'ABERTO' && !c.responsavel_id) { fila++; continue; }
      const ref = c.solicitante_id === perfil.id && !atendente ? c.ultima_publica_em : c.ultima_interacao_em;
      const lido = lidos.get(c.id);
      if (lido ? new Date(ref) > new Date(lido) : c.solicitante_id !== perfil.id) naoLidos++;
    }
    return { ok: true, info: { total: naoLidos + fila, naoLidos, fila } };
  } catch {
    return { ok: true, info: { total: 0 } };
  }
}

// ============================================================================
// ANEXOS (bucket privado; upload direto do navegador por URL assinada)
// ============================================================================
export async function urlUploadAnexoAction(nomeArquivo: string, tamanho: number, accessToken: string): Promise<Resultado> {
  const v = await validarAcesso(accessToken, ROTA_SUPORTE);
  if (!v.ok) return { ok: false, erro: v.message };
  if (Number(tamanho) > LIMITE_ANEXO_MB * 1024 * 1024) return { ok: false, erro: `Arquivo acima de ${LIMITE_ANEXO_MB} MB.` };
  const limpo = (nomeArquivo || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'arquivo';
  const caminho = `${v.perfil.id}/${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${limpo}`;
  const { data, error } = await supabaseAdmin().storage.from(BUCKET_SUPORTE).createSignedUploadUrl(caminho);
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: { caminho, token: data.token } };
}

// ============================================================================
// ABRIR
// ============================================================================
export interface NovoChamado {
  titulo: string; descricao: string; area_id: number; categoria: string | null;
  prioridade: Prioridade; empresa_id: number | null; anexos: Anexo[];
}

export async function abrirChamadoAction(dados: NovoChamado, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { db, perfil } = ctx;
  const titulo = txt(dados.titulo, 160);
  const descricao = txt(dados.descricao, 8000);
  if (titulo.length < 4) return { ok: false, erro: 'Escreva um título que resuma o pedido.' };
  if (descricao.length < 5) return { ok: false, erro: 'Descreva o que está acontecendo.' };
  const prioridade: Prioridade = PRIORIDADES_OK.includes(dados.prioridade) ? dados.prioridade : 'MEDIA';

  try {
    const { data: area } = await db.from('suporte_areas').select('id, nome, categorias, sla_horas, ativo').eq('id', Number(dados.area_id)).maybeSingle();
    if (!area || !area.ativo) return { ok: false, erro: 'Escolha uma área de atendimento válida.' };
    const categoria = dados.categoria && (area.categorias || []).includes(dados.categoria) ? dados.categoria : null;

    let empresaId: number | null = dados.empresa_id ? Number(dados.empresa_id) : null;
    const permitidas = await obterEmpresasPermitidas(perfil.id, perfil.permissaoNormalizada);
    if (empresaId && permitidas !== null && !permitidas.includes(empresaId)) empresaId = null;
    if (!empresaId && permitidas && permitidas.length === 1) empresaId = permitidas[0];

    const anexos = validarAnexos(dados.anexos, perfil.id);
    const agora = new Date().toISOString();
    const { data: novo, error } = await db.from('suporte_chamados').insert({
      titulo, descricao, area_id: area.id, categoria, prioridade, status: 'ABERTO', empresa_id: empresaId,
      solicitante_id: perfil.id, solicitante_nome: perfil.nome, anexos,
      prazo_em: prazoPara(agora, area.sla_horas, prioridade), ultima_interacao_em: agora, ultima_publica_em: agora,
    }).select('id').single();
    if (error) throw error;

    await Promise.all([
      evento(db, novo.id, perfil, `Chamado aberto para ${area.nome} · prioridade ${rotuloPrioridade(prioridade)}.`),
      marcarLido(db, novo.id, perfil.id),
    ]);
    log(perfil.nome, 'ABRIU CHAMADO', `#${novo.id} ${area.nome} — ${titulo}`, novo.id);

    const destinatarios = (await membrosDaArea(db, area.id)).filter(id => id !== perfil.id);
    after(() => avisarChamado({
      chave: CARD_AVISO_AREA, perfilIds: destinatarios,
      chamado: { id: novo.id, titulo, empresa_id: empresaId },
      evento: `Novo chamado de ${perfil.nome} · ${rotuloPrioridade(prioridade)}${categoria ? ` · ${categoria}` : ''}`,
      detalhe: descricao,
    }));
    return { ok: true, info: { id: novo.id, semAtendentes: destinatarios.length === 0 } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// DETALHE
// ============================================================================
async function carregarChamado(ctx: Ctx, id: number) {
  const { data: c } = await ctx.db.from('suporte_chamados').select('*').eq('id', Number(id)).maybeSingle();
  if (!c) return { erro: 'Chamado não encontrado.' } as const;
  const souSolicitante = c.solicitante_id === ctx.perfil.id;
  const souAtendente = ctx.gestor || ctx.minhasAreas.includes(c.area_id);
  if (!souSolicitante && !souAtendente) return { erro: 'Você não tem acesso a este chamado.' } as const;
  return { c, souSolicitante, souAtendente } as const;
}

export async function detalheChamadoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const r = await carregarChamado(ctx, id);
    if ('erro' in r) return { ok: false, erro: r.erro };
    const { c, souSolicitante, souAtendente } = r;
    const { db } = ctx;

    let qm = db.from('suporte_mensagens').select('id, tipo, autor_id, autor_nome, texto, anexos, created_at').eq('chamado_id', c.id).order('created_at');
    if (!souAtendente) qm = qm.neq('tipo', 'NOTA_INTERNA');
    const [{ data: mensagens }, { data: area }, membros] = await Promise.all([
      qm,
      db.from('suporte_areas').select('id, nome, icone, cor, categorias, sla_horas').eq('id', c.area_id).maybeSingle(),
      souAtendente ? db.from('suporte_areas_membros').select('perfil_id, perfil:perfis_usuarios(nome)').eq('area_id', c.area_id) : Promise.resolve({ data: [] as any[] }),
    ]);

    // URLs assinadas (30 min) de todos os anexos do chamado
    const caminhos = [
      ...((c.anexos || []) as Anexo[]).map(a => a.path),
      ...((mensagens || []) as any[]).flatMap(m => ((m.anexos || []) as Anexo[]).map(a => a.path)),
    ];
    let urls: Record<string, string> = {};
    if (caminhos.length) {
      const { data: assinadas } = await db.storage.from(BUCKET_SUPORTE).createSignedUrls(caminhos.slice(0, 200), 60 * 30);
      urls = Object.fromEntries(((assinadas || []) as any[]).filter(a => a.signedUrl).map(a => [a.path, a.signedUrl]));
    }

    await marcarLido(db, c.id, ctx.perfil.id);
    return {
      ok: true,
      info: {
        chamado: c, area, mensagens: mensagens || [], urls,
        sou_solicitante: souSolicitante, sou_atendente: souAtendente,
        atendentes: ((membros.data || []) as any[]).map(m => ({ id: m.perfil_id, nome: m.perfil?.nome || '—' })).sort((a, b) => a.nome.localeCompare(b.nome)),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// RESPONDER (mensagem pública ou nota interna)
// ============================================================================
export async function responderChamadoAction(p: { id: number; texto: string; anexos: Anexo[]; interna: boolean }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { db, perfil } = ctx;
  try {
    const r = await carregarChamado(ctx, p.id);
    if ('erro' in r) return { ok: false, erro: r.erro };
    const { c, souSolicitante, souAtendente } = r;
    const texto = txt(p.texto, 8000);
    const anexos = validarAnexos(p.anexos, perfil.id);
    if (!texto && !anexos.length) return { ok: false, erro: 'Escreva a mensagem ou anexe um arquivo.' };
    if (p.interna && !souAtendente) return { ok: false, erro: 'Só atendentes da área escrevem nota interna.' };
    if (['FECHADO', 'CANCELADO'].includes(c.status) && !p.interna) return { ok: false, erro: 'Chamado encerrado. Abra um novo se precisar.' };

    // Papel desta mensagem: quem abriu fala como solicitante (mesmo sendo atendente).
    const comoAtendente = souAtendente && !souSolicitante;
    const agora = new Date().toISOString();
    const upd: Record<string, any> = { ultima_interacao_em: agora, updated_at: agora };
    const eventos: string[] = [];

    if (!p.interna) {
      upd.ultima_publica_em = agora;
      if (comoAtendente) {
        if (!c.primeira_resposta_em) upd.primeira_resposta_em = agora;
        if (c.status === 'ABERTO') upd.status = 'EM_ATENDIMENTO';
        if (!c.responsavel_id) { upd.responsavel_id = perfil.id; upd.responsavel_nome = perfil.nome; eventos.push(`${perfil.nome} assumiu o chamado.`); }
      } else if (c.status === 'AGUARDANDO_SOLICITANTE') {
        upd.status = 'EM_ATENDIMENTO';
      }
    }

    const { error } = await db.from('suporte_mensagens').insert({
      chamado_id: c.id, tipo: p.interna ? 'NOTA_INTERNA' : 'MENSAGEM', autor_id: perfil.id, autor_nome: perfil.nome, texto: texto || '(anexo)', anexos,
    });
    if (error) throw error;
    for (const e of eventos) await evento(db, c.id, perfil, e);
    await db.from('suporte_chamados').update(upd).eq('id', c.id);
    await marcarLido(db, c.id, perfil.id);

    if (!p.interna) {
      const chamado = { id: c.id, titulo: c.titulo, empresa_id: c.empresa_id };
      if (comoAtendente) {
        after(() => avisarChamado({ chave: CARD_AVISO_SOLICITANTE, perfilIds: [c.solicitante_id], chamado, evento: `${perfil.nome} respondeu`, detalhe: texto }));
      } else {
        const alvo = c.responsavel_id ? [c.responsavel_id] : await membrosDaArea(db, c.area_id);
        after(() => avisarChamado({ chave: CARD_AVISO_AREA, perfilIds: alvo.filter(x => x !== perfil.id), chamado, evento: `${perfil.nome} respondeu`, detalhe: texto }));
      }
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// AÇÕES (assumir, atribuir, status, transferir, prioridade, cancelar, fechar, reabrir)
// ============================================================================
export type AcaoChamado =
  | { acao: 'ASSUMIR' }
  | { acao: 'ATRIBUIR'; responsavelId: string | null }
  | { acao: 'STATUS'; status: 'EM_ATENDIMENTO' | 'AGUARDANDO_SOLICITANTE' | 'RESOLVIDO'; texto?: string }
  | { acao: 'TRANSFERIR'; areaId: number; motivo: string }
  | { acao: 'PRIORIDADE'; prioridade: Prioridade }
  | { acao: 'CANCELAR'; motivo?: string }
  | { acao: 'FECHAR'; avaliacao: number; comentario?: string }
  | { acao: 'REABRIR'; motivo: string };

export async function acaoChamadoAction(id: number, a: AcaoChamado, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { db, perfil } = ctx;
  try {
    const r = await carregarChamado(ctx, id);
    if ('erro' in r) return { ok: false, erro: r.erro };
    const { c, souSolicitante, souAtendente } = r;
    const emAberto = STATUS_EM_ABERTO.includes(c.status as StatusChamado);
    const agora = new Date().toISOString();
    const upd: Record<string, any> = { updated_at: agora, ultima_interacao_em: agora };
    const chamado = { id: c.id, titulo: c.titulo, empresa_id: c.empresa_id };
    let linha = '';
    const avisos: { chave: string; perfilIds: string[]; evento: string; detalhe?: string }[] = [];
    const precisaAtendente = () => (souAtendente ? null : 'Só atendentes da área podem fazer isso.');

    switch (a.acao) {
      case 'ASSUMIR': {
        const neg = precisaAtendente(); if (neg) return { ok: false, erro: neg };
        if (!emAberto) return { ok: false, erro: 'Chamado já encerrado.' };
        Object.assign(upd, { responsavel_id: perfil.id, responsavel_nome: perfil.nome, status: c.status === 'ABERTO' ? 'EM_ATENDIMENTO' : c.status });
        linha = `${perfil.nome} assumiu o chamado.`;
        upd.ultima_publica_em = agora;
        if (c.solicitante_id !== perfil.id) avisos.push({ chave: CARD_AVISO_SOLICITANTE, perfilIds: [c.solicitante_id], evento: `${perfil.nome} assumiu seu chamado` });
        break;
      }
      case 'ATRIBUIR': {
        const neg = precisaAtendente(); if (neg) return { ok: false, erro: neg };
        if (!emAberto) return { ok: false, erro: 'Chamado já encerrado.' };
        if (a.responsavelId) {
          const membros = await membrosDaArea(db, c.area_id, false);
          if (!membros.includes(a.responsavelId)) return { ok: false, erro: 'Essa pessoa não é atendente da área.' };
          const { data: pf } = await db.from('perfis_usuarios').select('nome').eq('id', a.responsavelId).maybeSingle();
          Object.assign(upd, { responsavel_id: a.responsavelId, responsavel_nome: pf?.nome || '—', status: c.status === 'ABERTO' ? 'EM_ATENDIMENTO' : c.status });
          linha = `${perfil.nome} atribuiu o chamado a ${pf?.nome || '—'}.`;
          if (a.responsavelId !== perfil.id) avisos.push({ chave: CARD_AVISO_AREA, perfilIds: [a.responsavelId], evento: `${perfil.nome} atribuiu este chamado a você` });
        } else {
          Object.assign(upd, { responsavel_id: null, responsavel_nome: null, status: 'ABERTO' });
          linha = `${perfil.nome} devolveu o chamado para a fila.`;
        }
        break;
      }
      case 'STATUS': {
        const neg = precisaAtendente(); if (neg) return { ok: false, erro: neg };
        if (!['EM_ATENDIMENTO', 'AGUARDANDO_SOLICITANTE', 'RESOLVIDO'].includes(a.status)) return { ok: false, erro: 'Status inválido.' };
        if (!emAberto) return { ok: false, erro: 'Chamado já encerrado.' };
        upd.status = a.status;
        upd.ultima_publica_em = agora;
        if (!c.responsavel_id) { upd.responsavel_id = perfil.id; upd.responsavel_nome = perfil.nome; }
        if (!c.primeira_resposta_em) upd.primeira_resposta_em = agora;
        if (a.status === 'RESOLVIDO') upd.resolvido_em = agora;
        linha = `${perfil.nome} mudou o status para "${rotuloStatus(a.status)}".`;
        const texto = txt(a.texto, 8000);
        if (texto) await db.from('suporte_mensagens').insert({ chamado_id: c.id, tipo: 'MENSAGEM', autor_id: perfil.id, autor_nome: perfil.nome, texto });
        if (c.solicitante_id !== perfil.id) avisos.push({
          chave: CARD_AVISO_SOLICITANTE, perfilIds: [c.solicitante_id],
          evento: a.status === 'RESOLVIDO' ? 'Marcado como resolvido — confirme e avalie o atendimento'
            : a.status === 'AGUARDANDO_SOLICITANTE' ? 'A área está aguardando uma resposta sua' : 'Voltou para atendimento',
          detalhe: texto || undefined,
        });
        break;
      }
      case 'TRANSFERIR': {
        const neg = precisaAtendente(); if (neg) return { ok: false, erro: neg };
        if (!emAberto) return { ok: false, erro: 'Chamado já encerrado.' };
        const motivo = txt(a.motivo, 2000);
        if (!motivo) return { ok: false, erro: 'Diga o motivo da transferência.' };
        const { data: nova } = await db.from('suporte_areas').select('id, nome, sla_horas, ativo').eq('id', Number(a.areaId)).maybeSingle();
        if (!nova || !nova.ativo) return { ok: false, erro: 'Área de destino inválida.' };
        if (nova.id === c.area_id) return { ok: false, erro: 'O chamado já está nessa área.' };
        const { data: antiga } = await db.from('suporte_areas').select('nome').eq('id', c.area_id).maybeSingle();
        Object.assign(upd, {
          area_id: nova.id, categoria: null, responsavel_id: null, responsavel_nome: null, status: 'ABERTO',
          prazo_em: prazoPara(c.created_at, nova.sla_horas, c.prioridade), ultima_publica_em: agora,
        });
        linha = `${perfil.nome} transferiu de ${antiga?.nome || '—'} para ${nova.nome}. Motivo: ${motivo}`;
        const destino = (await membrosDaArea(db, nova.id)).filter(x => x !== perfil.id);
        avisos.push({ chave: CARD_AVISO_AREA, perfilIds: destino, evento: `Transferido de ${antiga?.nome || '—'} para ${nova.nome} por ${perfil.nome}`, detalhe: `Motivo: ${motivo}\n\n${c.descricao}` });
        if (c.solicitante_id !== perfil.id) avisos.push({ chave: CARD_AVISO_SOLICITANTE, perfilIds: [c.solicitante_id], evento: `Encaminhado para ${nova.nome}` });
        break;
      }
      case 'PRIORIDADE': {
        const neg = precisaAtendente(); if (neg) return { ok: false, erro: neg };
        if (!PRIORIDADES_OK.includes(a.prioridade)) return { ok: false, erro: 'Prioridade inválida.' };
        if (a.prioridade === c.prioridade) return { ok: true };
        const { data: area } = await db.from('suporte_areas').select('sla_horas').eq('id', c.area_id).maybeSingle();
        Object.assign(upd, { prioridade: a.prioridade, prazo_em: prazoPara(c.created_at, area?.sla_horas || null, a.prioridade) });
        linha = `${perfil.nome} mudou a prioridade de ${rotuloPrioridade(c.prioridade)} para ${rotuloPrioridade(a.prioridade)}.`;
        break;
      }
      case 'CANCELAR': {
        if (!souSolicitante && !ctx.gestor) return { ok: false, erro: 'Só quem abriu pode cancelar.' };
        if (!emAberto) return { ok: false, erro: 'Chamado já encerrado.' };
        Object.assign(upd, { status: 'CANCELADO', fechado_em: agora, ultima_publica_em: agora });
        const motivo = txt(a.motivo, 2000);
        linha = `${perfil.nome} cancelou o chamado.${motivo ? ` Motivo: ${motivo}` : ''}`;
        if (c.responsavel_id && c.responsavel_id !== perfil.id) avisos.push({ chave: CARD_AVISO_AREA, perfilIds: [c.responsavel_id], evento: `Cancelado por ${perfil.nome}`, detalhe: motivo || undefined });
        break;
      }
      case 'FECHAR': {
        if (!souSolicitante) return { ok: false, erro: 'Só quem abriu confirma a solução.' };
        if (c.status !== 'RESOLVIDO') return { ok: false, erro: 'O chamado ainda não foi marcado como resolvido.' };
        const nota = Math.round(Number(a.avaliacao));
        if (!(nota >= 1 && nota <= 5)) return { ok: false, erro: 'Dê uma nota de 1 a 5.' };
        const comentario = txt(a.comentario, 2000);
        Object.assign(upd, { status: 'FECHADO', fechado_em: agora, avaliacao: nota, avaliacao_comentario: comentario || null, ultima_publica_em: agora });
        linha = `${perfil.nome} confirmou a solução e avaliou com ${'★'.repeat(nota)}${'☆'.repeat(5 - nota)}.${comentario ? ` "${comentario}"` : ''}`;
        if (c.responsavel_id && c.responsavel_id !== perfil.id) avisos.push({ chave: CARD_AVISO_AREA, perfilIds: [c.responsavel_id], evento: `Fechado com avaliação ${nota}/5`, detalhe: comentario || undefined });
        break;
      }
      case 'REABRIR': {
        if (!souSolicitante) return { ok: false, erro: 'Só quem abriu pode reabrir.' };
        if (c.status !== 'RESOLVIDO') return { ok: false, erro: 'Só dá pra reabrir um chamado resolvido.' };
        const motivo = txt(a.motivo, 4000);
        if (!motivo) return { ok: false, erro: 'Conte o que ainda não ficou resolvido.' };
        Object.assign(upd, { status: c.responsavel_id ? 'EM_ATENDIMENTO' : 'ABERTO', resolvido_em: null, reaberturas: (c.reaberturas || 0) + 1, ultima_publica_em: agora });
        await db.from('suporte_mensagens').insert({ chamado_id: c.id, tipo: 'MENSAGEM', autor_id: perfil.id, autor_nome: perfil.nome, texto: motivo });
        linha = `${perfil.nome} reabriu o chamado.`;
        const alvo = c.responsavel_id ? [c.responsavel_id] : await membrosDaArea(db, c.area_id);
        avisos.push({ chave: CARD_AVISO_AREA, perfilIds: alvo.filter(x => x !== perfil.id), evento: `Reaberto por ${perfil.nome}`, detalhe: motivo });
        break;
      }
      default:
        return { ok: false, erro: 'Ação desconhecida.' };
    }

    const { error } = await db.from('suporte_chamados').update(upd).eq('id', c.id);
    if (error) throw error;
    if (linha) await evento(db, c.id, perfil, linha);
    await marcarLido(db, c.id, perfil.id);
    log(perfil.nome, `CHAMADO: ${a.acao}`, `#${c.id} — ${linha}`.slice(0, 300), c.id);
    const paraAvisar = avisos.filter(av => av.perfilIds.length);
    if (paraAvisar.length) after(async () => { for (const av of paraAvisar) await avisarChamado({ ...av, chamado }); });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// GESTÃO DAS ÁREAS (/admin/suporte/areas)
// ============================================================================
async function contextoGestao(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA_SUPORTE_AREAS);
  if (!v.ok) return { erro: v.message } as const;
  return { db: supabaseAdmin(), perfil: v.perfil } as const;
}

export async function gestaoAreasAction(accessToken: string): Promise<Resultado> {
  const ctx = await contextoGestao(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { db } = ctx;
  try {
    const desde = new Date(Date.now() - 90 * 86400_000).toISOString();
    const [{ data: areas }, { data: membros }, { data: usuarios }, { data: chamados }] = await Promise.all([
      db.from('suporte_areas').select('*').order('ordem').order('nome'),
      db.from('suporte_areas_membros').select('area_id, perfil_id, receber_avisos'),
      db.from('perfis_usuarios').select('id, nome, email, permissao, funcionario_id, ativo').eq('ativo', true).order('nome'),
      db.from('suporte_chamados').select('area_id, status, prazo_em, created_at, primeira_resposta_em, resolvido_em, avaliacao').gte('created_at', desde).limit(5000),
    ]);
    const fichaIds = ((usuarios || []) as any[]).map(u => u.funcionario_id).filter(Boolean);
    const { data: fichas } = fichaIds.length ? await db.from('folha_funcionarios').select('id, celular, email').in('id', fichaIds) : { data: [] as any[] };
    const fichaPor = new Map(((fichas || []) as any[]).map(f => [f.id, f]));

    const agora = Date.now();
    const stats = new Map<number, { abertos: number; atrasados: number; total: number; somaResp: number; nResp: number; somaSol: number; nSol: number; somaNota: number; nNota: number }>();
    for (const c of (chamados || []) as any[]) {
      const s = stats.get(c.area_id) || { abertos: 0, atrasados: 0, total: 0, somaResp: 0, nResp: 0, somaSol: 0, nSol: 0, somaNota: 0, nNota: 0 };
      s.total++;
      if (STATUS_EM_ABERTO.includes(c.status)) { s.abertos++; if (c.prazo_em && new Date(c.prazo_em).getTime() < agora) s.atrasados++; }
      if (c.primeira_resposta_em) { s.somaResp += new Date(c.primeira_resposta_em).getTime() - new Date(c.created_at).getTime(); s.nResp++; }
      if (c.resolvido_em) { s.somaSol += new Date(c.resolvido_em).getTime() - new Date(c.created_at).getTime(); s.nSol++; }
      if (c.avaliacao) { s.somaNota += c.avaliacao; s.nNota++; }
      stats.set(c.area_id, s);
    }

    return {
      ok: true,
      info: {
        areas: ((areas || []) as any[]).map(a => {
          const s = stats.get(a.id);
          return {
            ...a,
            membros: ((membros || []) as any[]).filter(m => m.area_id === a.id).map(m => ({ perfil_id: m.perfil_id, receber_avisos: m.receber_avisos })),
            indicadores: s ? {
              total: s.total, abertos: s.abertos, atrasados: s.atrasados,
              horasPrimeiraResposta: s.nResp ? s.somaResp / s.nResp / 3600_000 : null,
              horasSolucao: s.nSol ? s.somaSol / s.nSol / 3600_000 : null,
              nota: s.nNota ? s.somaNota / s.nNota : null, avaliacoes: s.nNota,
            } : null,
          };
        }),
        usuarios: ((usuarios || []) as any[]).map(u => {
          const f = u.funcionario_id ? fichaPor.get(u.funcionario_id) : null;
          return { id: u.id, nome: u.nome || u.email, email: u.email, permissao: u.permissao, tem_ficha: !!f, tem_celular: !!f?.celular, tem_email: !!(f?.email || u.email) };
        }),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface AreaForm {
  id: number | null; nome: string; descricao: string; icone: string; cor: string;
  categorias: string[]; sla_horas: Record<Prioridade, number>; ordem: number; ativo: boolean;
  membros: { perfil_id: string; receber_avisos: boolean }[];
}

export async function salvarAreaAction(f: AreaForm, accessToken: string): Promise<Resultado> {
  const ctx = await contextoGestao(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const { db, perfil } = ctx;
  const nome = txt(f.nome, 60);
  if (nome.length < 2) return { ok: false, erro: 'Dê um nome à área.' };
  const cor = /^#[0-9a-fA-F]{6}$/.test(f.cor || '') ? f.cor : '#336699';
  const categorias = [...new Set((f.categorias || []).map(c => txt(c, 60)).filter(Boolean))].slice(0, 40);
  const sla: Record<string, number> = {};
  for (const p of PRIORIDADES_OK) {
    const h = Number(f.sla_horas?.[p]);
    sla[p] = h > 0 && h <= 24 * 60 ? Math.round(h * 10) / 10 : SLA_PADRAO[p];
  }
  const linha = {
    nome, descricao: txt(f.descricao, 400) || null, icone: txt(f.icone, 8) || '🛟', cor, categorias,
    sla_horas: sla, ordem: Number(f.ordem) || 0, ativo: f.ativo !== false, updated_at: new Date().toISOString(),
  };
  try {
    let id = f.id;
    if (id) {
      const { error } = await db.from('suporte_areas').update(linha).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await db.from('suporte_areas').insert(linha).select('id').single();
      if (error) throw error;
      id = data.id;
    }
    // atendentes: substitui a lista inteira
    const membros = [...new Map((f.membros || []).filter(m => m.perfil_id).map(m => [m.perfil_id, { area_id: id, perfil_id: m.perfil_id, receber_avisos: m.receber_avisos !== false }])).values()];
    const { error: eDel } = await db.from('suporte_areas_membros').delete().eq('area_id', id);
    if (eDel) throw eDel;
    if (membros.length) {
      const { error: eIns } = await db.from('suporte_areas_membros').insert(membros);
      if (eIns) throw eIns;
    }
    log(perfil.nome, f.id ? 'EDITOU ÁREA DE SUPORTE' : 'CRIOU ÁREA DE SUPORTE', `${nome} · ${membros.length} atendente(s)`);
    return { ok: true, info: { id } };
  } catch (e: any) {
    const msg = String(e.message || '');
    return { ok: false, erro: msg.includes('suporte_areas_nome_unico') ? 'Já existe uma área com esse nome.' : msg };
  }
}
