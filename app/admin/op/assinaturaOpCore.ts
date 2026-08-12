// Lógica de finalizar/consultar assinatura de recibo de OP na Autentique, SEM
// "use server" — reaproveitada tanto pelas actions já protegidas em
// actions-assinatura.ts (accessToken validado) quanto pelo webhook
// app/api/webhooks/autentique/route.ts (sem sessão de usuário, é a própria
// Autentique chamando). Ficar fora de um arquivo "use server" é o que impede
// que finalizarAssinaturaOP vire um endpoint de Server Action alcançável
// direto por RPC sem accessToken — antes disso, qualquer um que soubesse um
// opId + autentiqueDocId válidos podia marcar a OP como paga/assinada.
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';
import { autentiqueConsultarDocumento } from '../../lib/autentique';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET_RECIBOS = 'recibos_assinados';

// Baixa o PDF assinado da Autentique, arquiva no Storage e atualiza a OP.
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

// Consulta status na Autentique e atualiza op_assinaturas — usada tanto pelo
// fallback manual (via actions-assinatura.ts, já protegido) quanto poderia
// ser pelo webhook no futuro.
export async function consultarEAtualizar(db: ReturnType<typeof supabaseAdmin>, opId: string): Promise<Resultado> {
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
