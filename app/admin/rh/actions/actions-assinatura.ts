'use server';

// app/admin/rh/actions-assinatura.ts
// Orquestra o envio de holerites para assinatura na Autentique.
// - exige folha FECHADA (usa o snapshot congelado como fonte da verdade)
// - gera o PDF no servidor (lib/gerarHoleritePdf)
// - grava o controle em folha_holerite_assinaturas (service role)
// - chama o cliente da Autentique (lib/autentique)
import { supabaseAdmin } from '../../../lib/supabase';
import { autentiqueCriarDocumento, autentiqueConsultarDocumento } from '../../../lib/autentique';
import { gerarHoleritePdf } from '../../../lib/gerarHoleritePdf';
import { mergePdfs } from '../../../lib/mergePdf';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET_DOCS = 'documentos-folha';

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

// Lista funcionários ativos (para o seletor do envio avulso)
export async function listarFuncionariosAtivosAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_funcionarios')
      .select('nome_completo, cpf, celular, email')
      .eq('ativo', true)
      .order('nome_completo');
    if (error) throw new Error(error.message);
    return { ok: true, info: { funcionarios: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Busca um anexo da contabilidade no Storage; retorna null se não existir.
async function baixarAnexoContabil(
  db: ReturnType<typeof supabaseAdmin>,
  mesReferencia: string,
  tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL',
  funcionarioNome: string
): Promise<Uint8Array | null> {
  // Confirma no banco que há registro (evita chamada de Storage à toa)
  const { data: reg } = await db
    .from('folha_documentos_contabeis')
    .select('storage_path')
    .eq('funcionario_nome', funcionarioNome)
    .eq('mes_referencia', mesReferencia)
    .eq('tipo', tipo)
    .maybeSingle();
  if (!reg?.storage_path) return null;

  const { data, error } = await db.storage.from(BUCKET_DOCS).download(reg.storage_path);
  if (error || !data) return null;
  const buf = await data.arrayBuffer();
  return new Uint8Array(buf);
}

function normalizarCelularBR(celular?: string | null): string | null {
  if (!celular) return null;
  const digits = celular.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const comPais = digits.startsWith('55') ? digits : `55${digits}`;
  return `+${comPais}`;
}

// ============================================================================
// ENVIO DE DOCUMENTO AVULSO (advertência, aviso, etc.)
// Não depende de folha nem de mês — sobe um PDF qualquer para um funcionário.
// ============================================================================
export async function enviarDocumentoAvulsoAction(payload: {
  funcionarioNome: string;
  tituloDocumento: string;      // ex: "Advertência - atraso"
  pdfBase64: string;
  enviadoPor: string;
  sandbox: boolean;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { funcionarioNome, tituloDocumento, pdfBase64, enviadoPor, sandbox } = payload;

  if (!tituloDocumento?.trim()) return { ok: false, erro: 'Informe um título para o documento.' };
  if (!pdfBase64) return { ok: false, erro: 'Nenhum arquivo enviado.' };

  try {
    const { data: func } = await db
      .from('folha_funcionarios')
      .select('cpf, celular, email')
      .eq('nome_completo', funcionarioNome)
      .maybeSingle();

    const cpfLimpo = (func?.cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return { ok: false, erro: `CPF de ${funcionarioNome} ausente ou inválido. Preencha o CPF na ficha antes de enviar.` };
    }
    const celularE164 = normalizarCelularBR(func?.celular);
    if (!celularE164 && !func?.email) {
      return { ok: false, erro: `Informe celular ou e-mail de ${funcionarioNome} na ficha para enviar o link de assinatura.` };
    }

    const pdfBytes = new Uint8Array(Buffer.from(pdfBase64, 'base64'));
    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `${tituloDocumento} — ${funcionarioNome}`,
      signatarioNome: funcionarioNome,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164 || undefined,
      signatarioEmail: func?.email || undefined,
      pdfBuffer: pdfBytes,
      pdfNomeArquivo: `${slug(tituloDocumento)}-${slug(funcionarioNome)}.pdf`,
      sandbox
    });

    // Registra como avulso: mes_referencia recebe um marcador com timestamp
    // para não colidir com o holerite mensal (que usa 'AAAA-MM').
    const marcadorAvulso = `AVULSO-${Date.now()}`;
    const { error } = await db.from('folha_holerite_assinaturas').upsert({
      funcionario_nome: funcionarioNome,
      mes_referencia: marcadorAvulso,
      cpf: cpfLimpo,
      autentique_doc_id: doc.docId,
      public_id: doc.publicId,
      link_assinatura: doc.linkAssinatura,
      status: 'ENVIADO',
      sandbox,
      titulo_avulso: tituloDocumento,
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
// ENVIAR HOLERITE PARA ASSINATURA (somente folha FECHADA)
// ============================================================================
export async function enviarHoleriteAssinaturaAction(payload: {
  funcionarioNome: string;
  mesReferencia: string;
  enviadoPor: string;
  sandbox: boolean;
  soDocumental?: boolean;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { funcionarioNome, mesReferencia, enviadoPor, sandbox, soDocumental } = payload;

  try {
    // 1) Folha fechada: obrigatória para contratos com cálculo. Para contratos
    // "só documentais", não há folha — envia apenas os anexos da contabilidade.
    const { data: fechamento } = await db
      .from('folha_holerites')
      .select('dados, fechado_em')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();
    if (!soDocumental && !fechamento?.dados) {
      return { ok: false, erro: 'A folha deste mês não está fechada para este funcionário. Feche a folha antes de enviar para assinatura.' };
    }

    // 2) Busca dados pessoais (CPF, celular, e-mail) da ficha
    const { data: func } = await db
      .from('folha_funcionarios')
      .select('cpf, celular, email')
      .eq('nome_completo', funcionarioNome)
      .maybeSingle();

    const cpfLimpo = (func?.cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return { ok: false, erro: `CPF de ${funcionarioNome} ausente ou inválido. Preencha o CPF na ficha antes de enviar.` };
    }
    const celularE164 = normalizarCelularBR(func?.celular);
    if (!celularE164 && !func?.email) {
      return { ok: false, erro: `Informe celular ou e-mail de ${funcionarioNome} na ficha para enviar o link de assinatura.` };
    }

    // 3) Impede reenvio se já assinado
    const { data: existente } = await db
      .from('folha_holerite_assinaturas')
      .select('status')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();
    if (existente?.status === 'ASSINADO') {
      return { ok: false, erro: 'Este holerite já foi assinado. Não é possível reenviar.' };
    }

    // 4) Nosso resumo — só para contratos com cálculo (folha fechada).
    const resumoBytes = (!soDocumental && fechamento?.dados) ? await gerarHoleritePdf({
      nome: funcionarioNome,
      cpf: func?.cpf || null,
      mesReferencia,
      dados: fechamento.dados,
      fechadoEm: fechamento?.fechado_em,
      empresaNome: 'RENTECH'
    }) : null;

    // 4b) Anexa os documentos da contabilidade que existirem no Storage.
    // Ordem: nosso resumo (se houver) → adiantamento → holerite mensal.
    const adiantamento = await baixarAnexoContabil(db, mesReferencia, 'ADIANTAMENTO', funcionarioNome);
    const holeriteMensal = await baixarAnexoContabil(db, mesReferencia, 'HOLERITE_MENSAL', funcionarioNome);

    const partes = [resumoBytes, adiantamento, holeriteMensal].filter((p): p is Uint8Array => !!p);
    if (partes.length === 0) {
      return { ok: false, erro: soDocumental
        ? `Nenhum holerite da contabilidade encontrado para ${funcionarioNome} neste mês. Importe e separe os PDFs antes de enviar.`
        : 'Nenhum documento disponível para envio.' };
    }
    const pdfBytes = partes.length > 1 ? await mergePdfs(partes) : partes[0];
    const anexados = [
      adiantamento ? 'adiantamento' : null,
      holeriteMensal ? 'holerite' : null
    ].filter(Boolean);

    // 5) Cria o documento na Autentique (com validação por CPF + WhatsApp)
    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `Holerite ${mesReferencia.split('-').reverse().join('/')} — ${funcionarioNome}`,
      signatarioNome: funcionarioNome,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164 || undefined,
      signatarioEmail: func?.email || undefined,
      pdfBuffer: pdfBytes,
      pdfNomeArquivo: `${funcionarioNome.replace(/\s+/g, '-').toLowerCase()}-${mesReferencia}.pdf`,
      sandbox
    });

    // 6) Grava/atualiza o controle
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

    return { ok: true, info: { docId: doc.docId, link: doc.linkAssinatura, sandbox, anexados } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIO EM LOTE: todos os holerites FECHADOS do mês ainda não assinados
// ============================================================================
export async function enviarHoleritesLoteAction(payload: {
  mesReferencia: string;
  enviadoPor: string;
  sandbox: boolean;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { mesReferencia, enviadoPor, sandbox } = payload;

  try {
    // Todos os funcionários com folha fechada no mês
    const { data: fechados } = await db
      .from('folha_holerites')
      .select('funcionario_nome')
      .eq('mes_referencia', mesReferencia);
    if (!fechados?.length) {
      return { ok: false, erro: 'Nenhuma folha fechada neste mês. Feche a folha antes de enviar para assinatura.' };
    }

    // Já assinados/enviados: não reenviar
    const { data: jaEnviados } = await db
      .from('folha_holerite_assinaturas')
      .select('funcionario_nome, status')
      .eq('mes_referencia', mesReferencia);
    const bloqueados = new Set((jaEnviados || [])
      .filter(a => a.status === 'ASSINADO' || a.status === 'ENVIADO' || a.status === 'VISUALIZADO')
      .map(a => a.funcionario_nome));

    const alvos = fechados.map(f => f.funcionario_nome).filter(n => !bloqueados.has(n));
    if (alvos.length === 0) {
      return { ok: false, erro: 'Todos os holerites fechados deste mês já foram enviados ou assinados.' };
    }

    const resultados: { nome: string; ok: boolean; erro?: string }[] = [];
    for (const nome of alvos) {
      const r = await enviarHoleriteAssinaturaAction({ funcionarioNome: nome, mesReferencia, enviadoPor, sandbox });
      resultados.push({ nome, ok: r.ok, erro: r.erro });
    }

    const enviados = resultados.filter(r => r.ok).length;
    const falhas = resultados.filter(r => !r.ok);

    return {
      ok: enviados > 0,
      info: { enviados, total: alvos.length, falhas: falhas.map(f => `${f.nome}: ${f.erro}`) }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LISTAR ASSINATURAS DE UM MÊS (para a página de acompanhamento)
// ============================================================================
export async function listarAssinaturasAction(payload: { mesReferencia: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    // Traz as assinaturas do mês + os documentos avulsos (mes_referencia começa com 'AVULSO-')
    const { data, error } = await db
      .from('folha_holerite_assinaturas')
      .select('*')
      .or(`mes_referencia.eq.${payload.mesReferencia},mes_referencia.like.AVULSO-%`)
      .order('funcionario_nome');
    if (error) throw new Error(error.message);
    return { ok: true, info: { assinaturas: data || [] } };
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

    const assinou = !!assinatura?.signed?.created_at;
    const visualizou = !!assinatura?.viewed?.created_at;
    const rejeitou = !!assinatura?.rejected?.created_at;

    const novoStatus = rejeitou ? 'REJEITADO' : assinou ? 'ASSINADO' : visualizou ? 'VISUALIZADO' : 'ENVIADO';

    await db.from('folha_holerite_assinaturas').update({
      status: novoStatus,
      arquivo_assinado: doc?.files?.pades || doc?.files?.signed || null,
      visualizado_em: assinatura?.viewed?.created_at || null,
      assinado_em: assinatura?.signed?.created_at || null,
      atualizado_em: new Date().toISOString()
    }).eq('autentique_doc_id', ctrl.autentique_doc_id);

    // DEBUG TEMPORÁRIO: retorna o objeto signature BRUTO completo que a
    // Autentique devolveu, para ver todos os campos preenchidos. Remover depois.
    return {
      ok: true,
      info: {
        status: novoStatus,
        debug: {
          signatureBruto: assinatura ?? null,
          totalSignatures: doc?.signatures?.length ?? 0,
          files: doc?.files ?? null
        }
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}