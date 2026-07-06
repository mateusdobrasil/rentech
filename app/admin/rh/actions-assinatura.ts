'use server';

// app/admin/rh/actions-assinatura.ts
// Orquestra o envio de holerites para assinatura na Autentique.
// - grava o controle em folha_holerite_assinaturas (service role)
// - chama o cliente da Autentique (lib/autentique)
// O PDF é recebido como base64 (gerado na etapa anterior do fluxo).
import { supabaseAdmin } from '../../lib/supabase';
import { autentiqueCriarDocumento, autentiqueConsultarDocumento } from '../../lib/autentique';

type Resultado = { ok: boolean; erro?: string; info?: any };

// Normaliza celular BR para E.164 (+55DDDNUMERO). Retorna null se inválido.
function normalizarCelularBR(celular?: string | null): string | null {
  if (!celular) return null;
  const digits = celular.replace(/\D/g, '');
  if (digits.length < 10) return null;              // sem DDD+numero
  const comPais = digits.startsWith('55') ? digits : `55${digits}`;
  return `+${comPais}`;
}

// ============================================================================
// ENVIAR HOLERITE PARA ASSINATURA
// ============================================================================
export async function enviarHoleriteAssinaturaAction(payload: {
  funcionarioNome: string;
  mesReferencia: string;          // competência 'AAAA-MM'
  cpf: string;
  celular?: string | null;
  email?: string | null;
  pdfBase64: string;              // conteúdo do PDF do holerite
  nomeDocumento: string;          // ex: "Holerite 06/2026 — João da Silva"
  enviadoPor: string;
  sandbox: boolean;               // true = teste (não gasta créditos)
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const {
    funcionarioNome, mesReferencia, cpf, celular, email,
    pdfBase64, nomeDocumento, enviadoPor, sandbox
  } = payload;

  // Validações mínimas antes de gastar uma chamada de API
  const cpfLimpo = (cpf || '').replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    return { ok: false, erro: 'CPF do funcionário ausente ou inválido. Preencha o CPF na ficha antes de enviar para assinatura.' };
  }
  const celularE164 = normalizarCelularBR(celular);
  if (!celularE164 && !email) {
    return { ok: false, erro: 'Informe celular ou e-mail do funcionário na ficha para enviar o link de assinatura.' };
  }

  try {
    // Impede reenvio se já assinado
    const { data: existente } = await db
      .from('folha_holerite_assinaturas')
      .select('status')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();
    if (existente?.status === 'ASSINADO') {
      return { ok: false, erro: 'Este holerite já foi assinado. Não é possível reenviar.' };
    }

    // Chama a Autentique
    // Buffer.from devolve um Buffer (subclasse de Uint8Array); a lib aceita Uint8Array.
    const pdfBytes = new Uint8Array(Buffer.from(pdfBase64, 'base64'));
    const doc = await autentiqueCriarDocumento({
      nomeDocumento,
      signatarioNome: funcionarioNome,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164 || undefined,
      signatarioEmail: email || undefined,
      pdfBuffer: pdfBytes,
      pdfNomeArquivo: `${funcionarioNome.replace(/\s+/g, '-').toLowerCase()}-${mesReferencia}.pdf`,
      sandbox
    });

    // Grava/atualiza o controle
    const { error } = await db.from('folha_holerite_assinaturas').upsert({
      funcionario_nome: funcionarioNome,
      mes_referencia: mesReferencia,
      cpf: cpfLimpo,
      autentique_doc_id: doc.docId,
      public_id: doc.publicId,
      link_assinatura: doc.linkAssinatura,
      status: 'ENVIADO',
      sandbox,
      enviado_por: enviadoPor || null,
      enviado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    }, { onConflict: 'funcionario_nome,mes_referencia' });
    if (error) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${error.message}`);

    return { ok: true, info: { docId: doc.docId, link: doc.linkAssinatura, sandbox } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CONSULTAR STATUS (fallback do webhook — uso pontual)
// ============================================================================
export async function consultarAssinaturaAction(payload: {
  funcionarioNome: string; mesReferencia: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: ctrl } = await db
      .from('folha_holerite_assinaturas')
      .select('autentique_doc_id')
      .eq('funcionario_nome', payload.funcionarioNome)
      .eq('mes_referencia', payload.mesReferencia)
      .maybeSingle();
    if (!ctrl?.autentique_doc_id) return { ok: false, erro: 'Nenhum envio encontrado para este holerite.' };

    const doc = await autentiqueConsultarDocumento(ctrl.autentique_doc_id);
    const assinatura = (doc?.signatures || [])[0];

    const assinou = !!assinatura?.signed?.created;
    const visualizou = !!assinatura?.viewed?.created;
    const rejeitou = !!assinatura?.rejected?.created;

    const novoStatus = rejeitou ? 'REJEITADO' : assinou ? 'ASSINADO' : visualizou ? 'VISUALIZADO' : 'ENVIADO';

    await db.from('folha_holerite_assinaturas').update({
      status: novoStatus,
      arquivo_assinado: doc?.files?.pades || doc?.files?.signed || null,
      visualizado_em: assinatura?.viewed?.created || null,
      assinado_em: assinatura?.signed?.created || null,
      atualizado_em: new Date().toISOString()
    }).eq('autentique_doc_id', ctrl.autentique_doc_id);

    return { ok: true, info: { status: novoStatus } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}