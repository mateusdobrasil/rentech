'use server';

// app/admin/locacoes/reservas/actions-proposta.ts
// Proposta de locação (PDF) e assinatura do cliente via Autentique
// (2026-11-16). Núcleo (montagem do PDF, eventos da Autentique) em
// propostaCore.ts — também usado pelo webhook.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { autentiqueCriarDocumento, autentiqueCancelarDocumento } from '../../../lib/autentique';
import { gerarPropostaPdf } from '../../../lib/locacao/gerarPropostaPdf';
import { montarDadosProposta, atualizarPropostaPelaAutentique, numeroFichaTexto, BUCKET_PROPOSTAS } from './propostaCore';
import { acessoLocacao, podeVerCliente, MSG_FICHA_FORA_CARTEIRA } from '../../../lib/locacao/acessoFichas';
import { descontoPendente } from '../../../lib/locacao/descontoFicha';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/locacoes/reservas';

async function contextoFicha(accessToken: string, fichaId: number) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const db = supabaseAdmin();
  const [permitidas, acesso] = await Promise.all([
    obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada),
    acessoLocacao(db, v.perfil),
  ]);
  const { data: ficha } = await db.from('locacao_fichas_reserva').select('*').eq('id', fichaId).maybeSingle();
  if (!ficha) return { erro: 'Ficha não encontrada.' } as const;
  if (!empresaPermitida(permitidas, ficha.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  if (!(await podeVerCliente(db, acesso, ficha.parceiro_id))) return { erro: MSG_FICHA_FORA_CARTEIRA } as const;
  return { perfil: v.perfil, ficha, acesso } as const;
}

async function contextoProposta(accessToken: string, propostaId: number) {
  const { data: prop } = await supabaseAdmin().from('locacao_propostas').select('*').eq('id', propostaId).maybeSingle();
  if (!prop) return { erro: 'Proposta não encontrada.' } as const;
  const ctx = await contextoFicha(accessToken, prop.ficha_id);
  if ('erro' in ctx) return { erro: ctx.erro as string } as const;
  return { perfil: ctx.perfil, ficha: ctx.ficha, acesso: ctx.acesso, prop } as const;
}

const SEM_EDITAR = 'Seu usuário não pode alterar fichas de locação.';

// "(11) 99999-0000" → "+5511999990000"; já com 55 → só põe o "+".
function celularE164(t?: string | null): string | null {
  const d = (t || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return `+${d}`;
  return null;
}

const bytesParaBase64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

export async function listarPropostasAction(fichaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contextoFicha(accessToken, fichaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const { data, error } = await supabaseAdmin().from('locacao_propostas')
      .select('id, versao, status, link_assinatura, sandbox, signatario_nome, signatario_celular, signatario_email, mostrar_valores_itens, valor_total, conteudo_versao, pdf_original_path, pdf_assinado_path, enviado_por, enviado_em, visualizado_em, assinado_em, rejeitado_em, motivo_cancelamento')
      .eq('ficha_id', fichaId).order('versao', { ascending: false });
    if (error) throw error;
    return { ok: true, info: { propostas: data || [], conteudoAtual: ctx.ficha.conteudo_alterado_em } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** PDF da ficha como está agora (não envia, não guarda). */
export async function previaPropostaAction(fichaId: number, mostrarValoresItens: boolean, accessToken: string): Promise<Resultado> {
  const ctx = await contextoFicha(accessToken, fichaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const bytes = await gerarPropostaPdf(await montarDadosProposta(supabaseAdmin(), fichaId, mostrarValoresItens));
    return { ok: true, info: { base64: bytesParaBase64(bytes), nome: `proposta-${numeroFichaTexto(fichaId)}.pdf` } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function enviarPropostaAction(
  fichaId: number,
  dados: { signatario_nome: string; celular?: string | null; email?: string | null; mostrar_valores_itens: boolean; sandbox: boolean },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contextoFicha(accessToken, fichaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const f = ctx.ficha;
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_EDITAR };
  if (descontoPendente(f)) return { ok: false, erro: `Desconto de ${Number(f.desconto_pct).toLocaleString('pt-BR')}% aguardando aprovação — a proposta só sai depois de aprovado.` };
  if (f.origem === 'P2S') return { ok: false, erro: 'Ficha importada do P2S — a proposta sai pelo PrimeStart.' };
  if (!['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA'].includes(f.status)) return { ok: false, erro: 'Esta ficha não está em fase de proposta.' };
  const nome = (dados.signatario_nome || '').trim();
  if (!nome) return { ok: false, erro: 'Informe o nome de quem vai assinar.' };
  const celular = dados.celular ? celularE164(dados.celular) : null;
  if (dados.celular && !celular) return { ok: false, erro: 'Celular inválido — use DDD + número.' };
  const email = (dados.email || '').trim() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, erro: 'E-mail inválido.' };
  if (!celular && !email) return { ok: false, erro: 'Informe o celular (WhatsApp) ou o e-mail de quem vai assinar.' };

  const db = supabaseAdmin();
  try {
    const { count: qtdItens } = await db.from('locacao_fichas_reserva_itens').select('id', { count: 'exact', head: true }).eq('ficha_id', fichaId);
    if (!qtdItens) return { ok: false, erro: 'A ficha não tem itens.' };

    const { data: ultima } = await db.from('locacao_propostas').select('versao').eq('ficha_id', fichaId).order('versao', { ascending: false }).limit(1).maybeSingle();
    const versao = (ultima?.versao || 0) + 1;
    const numero = numeroFichaTexto(fichaId);

    const pdf = await gerarPropostaPdf(await montarDadosProposta(db, fichaId, dados.mostrar_valores_itens));
    const caminho = `ficha-${fichaId}/proposta-v${versao}.pdf`;
    const { error: eUp } = await db.storage.from(BUCKET_PROPOSTAS).upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });
    if (eUp) throw new Error(`Falha ao guardar o PDF: ${eUp.message}`);

    const { data: cli } = await db.from('parceiros').select('nome_exibicao, nome_completo').eq('id', f.parceiro_id).maybeSingle();
    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `Proposta de Locação ${numero}${versao > 1 ? ` v${versao}` : ''} — ${cli?.nome_exibicao || cli?.nome_completo || nome}`,
      signatarioNome: nome,
      signatarioCelular: celular || undefined,
      signatarioEmail: celular ? undefined : email || undefined,
      pdfBuffer: pdf,
      pdfNomeArquivo: `proposta-${numero}-v${versao}.pdf`,
      sandbox: !!dados.sandbox,
    });

    const agora = new Date().toISOString();
    const { error: eIns } = await db.from('locacao_propostas').insert({
      ficha_id: fichaId, versao, status: 'ENVIADO', autentique_doc_id: doc.docId, public_id: doc.publicId, link_assinatura: doc.linkAssinatura,
      sandbox: !!dados.sandbox, signatario_nome: nome, signatario_celular: celular, signatario_email: email,
      mostrar_valores_itens: !!dados.mostrar_valores_itens, valor_total: f.valor_total, conteudo_versao: f.conteudo_alterado_em,
      pdf_original_path: caminho, enviado_por: ctx.perfil.nome, enviado_em: agora, atualizado_em: agora,
    });
    if (eIns) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${eIns.message}`);

    // Versões anteriores ainda abertas deixam de valer.
    const { data: abertas } = await db.from('locacao_propostas').select('id, versao, autentique_doc_id')
      .eq('ficha_id', fichaId).in('status', ['ENVIADO', 'VISUALIZADO']).lt('versao', versao);
    for (const a of abertas || []) {
      try { if (a.autentique_doc_id) await autentiqueCancelarDocumento(a.autentique_doc_id); } catch { /* segue: marca cancelada mesmo assim */ }
      await db.from('locacao_propostas').update({ status: 'CANCELADO', motivo_cancelamento: `Substituída pela versão ${versao}`, atualizado_em: agora }).eq('id', a.id);
    }

    const destino = celular ? `WhatsApp ${celular}` : `e-mail ${email}`;
    if (f.status === 'ORCAMENTO') {
      await db.from('locacao_fichas_reserva').update({ status: 'ENVIADO', updated_at: agora }).eq('id', fichaId);
    }
    await db.from('locacao_fichas_reserva_historico').insert({
      ficha_id: fichaId, usuario: ctx.perfil.nome, acao: 'PROPOSTA_ENVIADA',
      detalhe: `Proposta v${versao} enviada para assinatura de ${nome} (${destino})${dados.sandbox ? ' — TESTE (sandbox)' : ''}`,
      status_de: f.status, status_para: f.status === 'ORCAMENTO' ? 'ENVIADO' : f.status,
    });
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'ENVIOU PROPOSTA DE LOCAÇÃO (AUTENTIQUE)', setor: 'LOCACOES', equipamento_nome: `${numero} v${versao} → ${nome}` });
    return { ok: true, info: { versao, link: doc.linkAssinatura, destino } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function atualizarStatusPropostaAction(propostaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contextoProposta(accessToken, propostaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const status = await atualizarPropostaPelaAutentique(supabaseAdmin(), propostaId);
    return { ok: true, info: { status } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarPropostaAction(propostaId: number, qual: 'ORIGINAL' | 'ASSINADO', accessToken: string): Promise<Resultado> {
  const ctx = await contextoProposta(accessToken, propostaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const caminho = qual === 'ASSINADO' ? ctx.prop.pdf_assinado_path : ctx.prop.pdf_original_path;
  if (!caminho) return { ok: false, erro: qual === 'ASSINADO' ? 'O PDF assinado ainda não chegou — use "Atualizar status".' : 'PDF não encontrado.' };
  try {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET_PROPOSTAS).createSignedUrl(caminho, 60 * 10, { download: caminho.split('/').pop() });
    if (error) throw error;
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function cancelarPropostaAction(propostaId: number, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contextoProposta(accessToken, propostaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_EDITAR };
  if (!['ENVIADO', 'VISUALIZADO'].includes(ctx.prop.status)) return { ok: false, erro: 'Só dá para cancelar proposta ainda não assinada.' };
  try {
    if (ctx.prop.autentique_doc_id) await autentiqueCancelarDocumento(ctx.prop.autentique_doc_id);
    const agora = new Date().toISOString();
    await supabaseAdmin().from('locacao_propostas').update({ status: 'CANCELADO', motivo_cancelamento: motivo?.trim() || 'Cancelada', atualizado_em: agora }).eq('id', propostaId);
    await supabaseAdmin().from('locacao_fichas_reserva_historico').insert({
      ficha_id: ctx.prop.ficha_id, usuario: ctx.perfil.nome, acao: 'PROPOSTA_CANCELADA', detalhe: `Proposta v${ctx.prop.versao} cancelada${motivo ? `: ${motivo}` : ''}`,
    });
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'CANCELOU PROPOSTA DE LOCAÇÃO', setor: 'LOCACOES', equipamento_nome: `${numeroFichaTexto(ctx.prop.ficha_id)} v${ctx.prop.versao}` });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
