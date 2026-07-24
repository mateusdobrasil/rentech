"use server";

// app/admin/op/actions-assinatura.ts
// Orquestra o envio de recibos de OP para assinatura na Autentique — mirror de
// app/admin/rh/actions/actions-assinatura.ts, mas chaveado por OP (op_id),
// não por funcionário+mês: cada OP tem no máximo um registro de controle.
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';
import { autentiqueCriarDocumento, autentiqueConsultarDocumento } from '../../lib/autentique';
import { gerarReciboOpPdf } from '../../lib/gerarReciboOpPdf';
import { normalizarItensOP } from './utils';
import { obterPerfilValidado, possuiAcessoRota } from './actions';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA_ASSINATURAS = '/admin/op/assinaturas';
const BUCKET_RECIBOS = 'recibos_assinados';

function normalizarCelularBR(celular?: string | null): string | null {
  if (!celular) return null;
  const digits = celular.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const comPais = digits.startsWith('55') ? digits : `55${digits}`;
  return `+${comPais}`;
}

async function validarAcesso(accessToken: string) {
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { ok: false as const, message: 'Sessão inválida ou expirada. Faça login novamente.' };

  const autorizado = await possuiAcessoRota(perfil.permissaoNormalizada, ROTA_ASSINATURAS);
  if (!autorizado) return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };

  return { ok: true as const, perfil };
}

// ============================================================================
// LISTAR — todas as OPs + o registro de controle de assinatura de cada uma
// (quando existir). A visibilidade é "ver todas": esta tela é restrita pela
// própria permissão de rota (folha_paginas_permissoes), como o painel
// equivalente do RH.
// ============================================================================
export async function listarAssinaturasOPAction(payload: { accessToken: string }): Promise<Resultado> {
  const acesso = await validarAcesso(payload.accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const [{ data: ops, error: opsError }, { data: assinaturas, error: assError }] = await Promise.all([
      db.from('op_ordens_pagamento').select('*').order('data_criacao', { ascending: false }),
      db.from('op_assinaturas').select('*'),
    ]);
    if (opsError) throw new Error(opsError.message);
    if (assError) throw new Error(assError.message);

    const porOp = new Map((assinaturas || []).map(a => [a.op_id, a]));
    const lista = (ops || []).map(op => ({ ...op, assinatura: porOp.get(op.id) || null }));

    return { ok: true, info: { ops: lista } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIAR (ou reenviar) O RECIBO DE UMA OP PARA ASSINATURA
// ============================================================================
export async function enviarAssinaturaOPAction(payload: {
  opId: string;
  sandbox: boolean;
  accessToken: string;
}): Promise<Resultado> {
  const acesso = await validarAcesso(payload.accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { perfil } = acesso;

  const db = supabaseAdmin();
  try {
    const { data: op, error: opError } = await db
      .from('op_ordens_pagamento')
      .select('*')
      .eq('id', payload.opId)
      .single();
    if (opError || !op) throw new Error(opError?.message || 'OP não encontrada.');

    const cpfLimpo = (op.cpf_signatario || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return { ok: false, erro: 'CPF do signatário ausente ou inválido nesta OP. Edite a OP e informe um CPF válido antes de enviar.' };
    }
    const celularE164 = normalizarCelularBR(op.telefone_recebedora);
    if (!celularE164) {
      return { ok: false, erro: 'Celular do signatário ausente ou inválido nesta OP. Edite a OP e informe um celular válido antes de enviar.' };
    }

    const { data: existente } = await db
      .from('op_assinaturas')
      .select('status')
      .eq('op_id', payload.opId)
      .maybeSingle();
    if (existente?.status === 'ASSINADO') {
      return { ok: false, erro: 'Este recibo já foi assinado. Não é possível reenviar.' };
    }

    const itens = normalizarItensOP(op.itens);
    const pdfBytes = await gerarReciboOpPdf({
      numero_op: op.numero_op,
      os_numero: op.os_numero,
      os_cliente: op.os_cliente,
      os_evento: op.os_evento,
      os_periodo: op.os_periodo,
      empresa_recebedora: op.empresa_recebedora,
      cnpj_cpf_recebedora: op.cnpj_cpf_recebedora,
      itens,
      total_geral: op.total_geral,
      data_vencimento: op.data_vencimento,
    });

    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `Recibo OP ${op.numero_op || op.id} — ${op.empresa_recebedora}`,
      signatarioNome: op.empresa_recebedora,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164,
      pdfBuffer: pdfBytes,
      pdfNomeArquivo: `recibo-op-${op.id}.pdf`,
      sandbox: payload.sandbox,
    });

    const agora = new Date().toISOString();
    const { error: upsertError } = await db.from('op_assinaturas').upsert({
      op_id: payload.opId,
      autentique_doc_id: doc.docId,
      public_id: doc.publicId,
      link_assinatura: doc.linkAssinatura,
      status: 'ENVIADO',
      sandbox: payload.sandbox,
      enviado_por: perfil.nome,
      enviado_em: agora,
      atualizado_em: agora,
    }, { onConflict: 'op_id' });
    if (upsertError) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${upsertError.message}`);

    registrarLogAuditoria({
      usuario_nome: perfil.nome,
      acao: 'ENVIOU OP PARA ASSINATURA (AUTENTIQUE)',
      setor: 'OP',
      equipamento_id: payload.opId,
      equipamento_nome: `OS ${op.os_numero || 'S/N'} — ${op.empresa_recebedora}`,
    });

    revalidatePath('/admin');
    return { ok: true, info: { docId: doc.docId, link: doc.linkAssinatura, sandbox: payload.sandbox } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// Baixa o PDF assinado da Autentique, arquiva no Storage e atualiza a OP.
// Reaproveitado pela consulta manual/lote abaixo e pelo webhook.
// ============================================================================
export async function finalizarAssinaturaOP(opId: string, autentiqueDocId: string): Promise<void> {
  const db = supabaseAdmin();
  const doc = await autentiqueConsultarDocumento(autentiqueDocId);
  const urlAssinado = doc?.files?.signed || doc?.files?.pades;
  if (!urlAssinado) return; // Autentique ainda não disponibilizou o arquivo — tenta de novo depois

  const token = process.env.AUTENTIQUE_API_TOKEN;
  if (!token) return;

  const resp = await fetch(urlAssinado, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return;
  const bytes = new Uint8Array(await resp.arrayBuffer());

  const pathArquivado = `op-${opId}-assinado.pdf`;
  const { error: upErr } = await db.storage.from(BUCKET_RECIBOS).upload(pathArquivado, bytes, {
    contentType: 'application/pdf', upsert: true
  });
  if (upErr) return;

  const { data: publicUrlData } = db.storage.from(BUCKET_RECIBOS).getPublicUrl(pathArquivado);
  const agora = new Date().toISOString();

  const { data: opAtualizada } = await db.from('op_ordens_pagamento').update({
    recibo_url: publicUrlData.publicUrl,
    data_assinatura: agora,
    status: 'PAGO E ASSINADO', // Muda o status automaticamente, como o canvas fazia antes
    updated_at: agora,
  }).eq('id', opId).select('os_numero, os_cliente, empresa_recebedora, total_geral').single();

  await db.from('op_assinaturas').update({ arquivo_assinado: publicUrlData.publicUrl, atualizado_em: agora }).eq('op_id', opId);

  const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(opAtualizada?.total_geral || 0);
  registrarLogAuditoria({
    usuario_nome: opAtualizada?.empresa_recebedora || 'DESCONHECIDO',
    acao: 'RECIBO ASSINADO DIGITALMENTE (AUTENTIQUE)',
    setor: 'OP',
    equipamento_id: opId,
    equipamento_nome: `OS ${opAtualizada?.os_numero || 'S/N'} — ${opAtualizada?.os_cliente || ''} | Valor: ${valorFormatado}`,
  });

  revalidatePath('/admin');
}

// ============================================================================
// CONSULTAR STATUS DE UMA OP (fallback do webhook — uso pontual)
// ============================================================================
async function consultarEAtualizar(db: ReturnType<typeof supabaseAdmin>, opId: string): Promise<Resultado> {
  const { data: ctrl } = await db
    .from('op_assinaturas')
    .select('autentique_doc_id')
    .eq('op_id', opId)
    .maybeSingle();
  if (!ctrl?.autentique_doc_id) return { ok: false, erro: 'Nenhum envio encontrado para esta OP.' };

  const doc = await autentiqueConsultarDocumento(ctrl.autentique_doc_id);
  // A primeira signature é o AUTOR (a Rentech, action: null); o signatário de
  // verdade é o que tem action.name === 'SIGN'.
  const assinatura = (doc?.signatures || []).find((s: any) => s?.action?.name === 'SIGN')
    || (doc?.signatures || [])[0];

  const assinou = !!assinatura?.signed?.created_at;
  const visualizou = !!assinatura?.viewed?.created_at;
  const rejeitou = !!assinatura?.rejected?.created_at;
  const novoStatus = rejeitou ? 'REJEITADO' : assinou ? 'ASSINADO' : visualizou ? 'VISUALIZADO' : 'ENVIADO';

  await db.from('op_assinaturas').update({
    status: novoStatus,
    visualizado_em: assinatura?.viewed?.created_at || null,
    assinado_em: assinatura?.signed?.created_at || null,
    atualizado_em: new Date().toISOString()
  }).eq('op_id', opId);

  if (novoStatus === 'ASSINADO') {
    await finalizarAssinaturaOP(opId, ctrl.autentique_doc_id);
  }

  return { ok: true, info: { status: novoStatus } };
}

export async function consultarAssinaturaOPAction(payload: { opId: string; accessToken: string }): Promise<Resultado> {
  const acesso = await validarAcesso(payload.accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    return await consultarEAtualizar(db, payload.opId);
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ATUALIZAR TODAS AS ASSINATURAS PENDENTES (não finalizadas)
// ============================================================================
export async function atualizarTodasAssinaturasOPAction(payload: { accessToken: string }): Promise<Resultado> {
  const acesso = await validarAcesso(payload.accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: pendentes } = await db
      .from('op_assinaturas')
      .select('op_id, status')
      .not('status', 'in', '("ASSINADO","REJEITADO")');

    if (!pendentes?.length) {
      return { ok: true, info: { atualizados: 0, total: 0, mudancas: [] } };
    }

    const mudancas: string[] = [];
    let atualizados = 0;
    for (const p of pendentes) {
      const antes = p.status;
      const r = await consultarEAtualizar(db, p.op_id);
      if (r.ok) {
        atualizados++;
        if (r.info?.status && r.info.status !== antes) mudancas.push(`OP ${p.op_id}: ${antes} → ${r.info.status}`);
      }
    }

    return { ok: true, info: { atualizados, total: pendentes.length, mudancas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ABRIR O PDF ASSINADO (já arquivado por finalizarAssinaturaOP)
// ============================================================================
export async function baixarAssinadoOPAction(payload: { opId: string; accessToken: string }): Promise<Resultado> {
  const acesso = await validarAcesso(payload.accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: op } = await db.from('op_ordens_pagamento').select('recibo_url').eq('id', payload.opId).maybeSingle();
    if (!op?.recibo_url) return { ok: false, erro: 'O documento assinado ainda não está disponível. Use "Consultar" para verificar o status.' };
    return { ok: true, info: { url: op.recibo_url } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
