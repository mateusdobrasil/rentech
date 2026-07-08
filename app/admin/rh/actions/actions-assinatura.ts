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
  mesReferencia: string;        // mês selecionado na página de assinaturas
  enviadoPor: string;
  sandbox: boolean;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { funcionarioNome, tituloDocumento, pdfBase64, mesReferencia, enviadoPor, sandbox } = payload;

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

    // Registra como avulso vinculado ao mês selecionado: o marcador inclui o
    // mês (para o avulso aparecer naquele mês) + timestamp (para não colidir
    // com o holerite nem com outros avulsos, dada a unique func+mes).
    const marcadorAvulso = `AVULSO-${mesReferencia}-${Date.now()}`;
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
    // 1) Funcionários com folha FECHADA no mês (contratos com cálculo)
    const { data: fechados } = await db
      .from('folha_holerites')
      .select('funcionario_nome')
      .eq('mes_referencia', mesReferencia);

    // 2) Funcionários de contrato SÓ DOCUMENTAL (sem folha), que têm anexos da
    //    contabilidade neste mês — também vão para assinatura.
    const { data: regras } = await db
      .from('folha_parametros')
      .select('nome_regra, so_documental');
    const contratosDocumentais = new Set(
      (regras || []).filter(r => r.so_documental === true).map(r => r.nome_regra)
    );

    let documentais: string[] = [];
    if (contratosDocumentais.size > 0) {
      const { data: funcsDoc } = await db
        .from('folha_funcionarios')
        .select('nome_completo, tipo_contrato')
        .eq('ativo', true);
      const candidatos = (funcsDoc || [])
        .filter(f => contratosDocumentais.has(f.tipo_contrato))
        .map(f => f.nome_completo);

      // Só inclui documentais que realmente têm algum documento da contabilidade
      if (candidatos.length > 0) {
        const { data: comDocs } = await db
          .from('folha_documentos_contabeis')
          .select('funcionario_nome')
          .eq('mes_referencia', mesReferencia)
          .in('funcionario_nome', candidatos);
        documentais = Array.from(new Set((comDocs || []).map(d => d.funcionario_nome)));
      }
    }

    // Marca quem é documental para o envio saber pular o resumo
    const nomeDocumentais = new Set(documentais);
    const todosNomes = Array.from(new Set([
      ...(fechados || []).map(f => f.funcionario_nome),
      ...documentais
    ]));

    if (todosNomes.length === 0) {
      return { ok: false, erro: 'Nenhuma folha fechada nem documento documental neste mês. Feche a folha ou separe os holerites da contabilidade antes de enviar.' };
    }

    // Já assinados/enviados: não reenviar
    const { data: jaEnviados } = await db
      .from('folha_holerite_assinaturas')
      .select('funcionario_nome, status')
      .eq('mes_referencia', mesReferencia);
    const bloqueados = new Set((jaEnviados || [])
      .filter(a => a.status === 'ASSINADO' || a.status === 'ENVIADO' || a.status === 'VISUALIZADO')
      .map(a => a.funcionario_nome));

    const alvos = todosNomes.filter(n => !bloqueados.has(n));
    if (alvos.length === 0) {
      return { ok: false, erro: 'Todos os documentos deste mês já foram enviados ou assinados.' };
    }

    const resultados: { nome: string; ok: boolean; erro?: string }[] = [];
    for (const nome of alvos) {
      const r = await enviarHoleriteAssinaturaAction({
        funcionarioNome: nome, mesReferencia, enviadoPor, sandbox,
        soDocumental: nomeDocumentais.has(nome)
      });
      resultados.push({ nome, ok: r.ok, erro: r.erro });
    }

    const enviados = resultados.filter(r => r.ok).length;
    const falhas = resultados.filter(r => !r.ok);

    return {
      ok: enviados > 0,
      info: { enviados, total: alvos.length, documentais: documentais.length, falhas: falhas.map(f => `${f.nome}: ${f.erro}`) }
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
    // Traz as assinaturas do mês + os avulsos DAQUELE mês (AVULSO-{mes}-...)
    const { data, error } = await db
      .from('folha_holerite_assinaturas')
      .select('*')
      .or(`mes_referencia.eq.${payload.mesReferencia},mes_referencia.like.AVULSO-${payload.mesReferencia}-%`)
      .order('funcionario_nome');
    if (error) throw new Error(error.message);
    return { ok: true, info: { assinaturas: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PRÉVIA DO DOCUMENTO DE ASSINATURA (para testes/conferência)
// Gera EXATAMENTE o mesmo PDF que seria enviado à Autentique (resumo + anexos
// da contabilidade, com merge), mas devolve em base64 para abrir no navegador.
// Não cria nada na Autentique nem gasta documentos do plano.
// ============================================================================
export async function previaDocumentoAssinaturaAction(payload: {
  funcionarioNome: string;
  mesReferencia: string;
  soDocumental?: boolean;
  dadosAoVivo?: any; // se a folha não está fechada, a tela pode mandar o cálculo ao vivo
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { funcionarioNome, mesReferencia, soDocumental, dadosAoVivo } = payload;

  try {
    // Snapshot congelado (se fechado) ou dados ao vivo (prévia de folha aberta)
    const { data: fechamento } = await db
      .from('folha_holerites')
      .select('dados, fechado_em')
      .eq('funcionario_nome', funcionarioNome)
      .eq('mes_referencia', mesReferencia)
      .maybeSingle();

    const dados = fechamento?.dados || dadosAoVivo;
    if (!soDocumental && !dados) {
      return { ok: false, erro: 'Sem dados para gerar a prévia: feche a folha ou envie o cálculo ao vivo.' };
    }

    const { data: func } = await db
      .from('folha_funcionarios')
      .select('cpf')
      .eq('nome_completo', funcionarioNome)
      .maybeSingle();

    const resumoBytes = (!soDocumental && dados) ? await gerarHoleritePdf({
      nome: funcionarioNome,
      cpf: func?.cpf || null,
      mesReferencia,
      dados,
      fechadoEm: fechamento?.fechado_em,
      empresaNome: 'RENTECH'
    }) : null;

    const adiantamento = await baixarAnexoContabil(db, mesReferencia, 'ADIANTAMENTO', funcionarioNome);
    const holeriteMensal = await baixarAnexoContabil(db, mesReferencia, 'HOLERITE_MENSAL', funcionarioNome);

    const partes = [resumoBytes, adiantamento, holeriteMensal].filter((p): p is Uint8Array => !!p);
    if (partes.length === 0) return { ok: false, erro: 'Nenhum documento disponível para a prévia.' };
    const pdfBytes = partes.length > 1 ? await mergePdfs(partes) : partes[0];

    const anexados = [
      resumoBytes ? 'resumo' : null,
      adiantamento ? 'adiantamento' : null,
      holeriteMensal ? 'holerite' : null
    ].filter(Boolean);

    return {
      ok: true,
      info: {
        pdfBase64: Buffer.from(pdfBytes).toString('base64'),
        anexados,
        fonte: fechamento?.dados ? 'FOLHA FECHADA (snapshot)' : 'CÁLCULO AO VIVO (folha aberta)'
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ATUALIZAR TODAS AS ASSINATURAS NÃO FINALIZADAS (de um mês + avulsos)
// Consulta a Autentique para cada uma que ainda não está ASSINADA/REJEITADA.
// ============================================================================
export async function atualizarTodasAssinaturasAction(payload: {
  mesReferencia: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: pendentes } = await db
      .from('folha_holerite_assinaturas')
      .select('funcionario_nome, mes_referencia, status')
      .or(`mes_referencia.eq.${payload.mesReferencia},mes_referencia.like.AVULSO-${payload.mesReferencia}-%`)
      .not('status', 'in', '("ASSINADO","REJEITADO")');

    if (!pendentes?.length) {
      return { ok: true, info: { atualizados: 0, total: 0, mudancas: [] } };
    }

    const mudancas: string[] = [];
    let atualizados = 0;

    for (const p of pendentes) {
      const antes = p.status;
      const r = await consultarAssinaturaAction({ funcionarioNome: p.funcionario_nome, mesReferencia: p.mes_referencia });
      if (r.ok) {
        atualizados++;
        if (r.info?.status && r.info.status !== antes) {
          mudancas.push(`${p.funcionario_nome}: ${antes} → ${r.info.status}`);
        }
      }
    }

    return { ok: true, info: { atualizados, total: pendentes.length, mudancas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// BAIXAR DOCUMENTO ASSINADO
// Os links files.signed/pades da Autentique exigem o token (Authorization),
// então clicar direto no navegador retorna "não existe". Aqui baixamos com o
// token no servidor, arquivamos no nosso Storage (cópia permanente) e
// devolvemos uma signed URL para o usuário abrir.
// ============================================================================
export async function baixarAssinadoAction(payload: {
  funcionarioNome: string; mesReferencia: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: ctrl } = await db
      .from('folha_holerite_assinaturas')
      .select('autentique_doc_id, arquivo_assinado, status')
      .eq('funcionario_nome', payload.funcionarioNome)
      .eq('mes_referencia', payload.mesReferencia)
      .maybeSingle();
    if (!ctrl?.autentique_doc_id) return { ok: false, erro: 'Nenhum envio encontrado para este documento.' };
    if (ctrl.status !== 'ASSINADO') return { ok: false, erro: 'O documento ainda não foi assinado.' };

    const pathArquivado = `${payload.mesReferencia}/assinados/${slug(payload.funcionarioNome)}.pdf`;

    // 1) Se já arquivamos antes, só gera a URL
    const { data: existente } = await db.storage.from(BUCKET_DOCS).createSignedUrl(pathArquivado, 60 * 10);
    if (existente?.signedUrl) {
      return { ok: true, info: { url: existente.signedUrl } };
    }

    // Busca a URL do assinado na Autentique. Prioriza 'signed' (assinado.pdf),
    // que é o que fica disponível; 'pades' pode retornar 404 se não gerado.
    const doc = await autentiqueConsultarDocumento(ctrl.autentique_doc_id);
    const urlAssinado = doc?.files?.signed || doc?.files?.pades;
    if (!urlAssinado) return { ok: false, erro: 'A Autentique ainda não disponibilizou o arquivo assinado.' };

    const token = process.env.AUTENTIQUE_API_TOKEN;
    if (!token) return { ok: false, erro: 'AUTENTIQUE_API_TOKEN não configurado no servidor.' };

    const resp = await fetch(urlAssinado, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      return { ok: false, erro: `Falha ao baixar o assinado da Autentique (HTTP ${resp.status}).` };
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());

    // 3) Arquiva no nosso Storage (cópia permanente) e devolve a URL
    const { error: upErr } = await db.storage.from(BUCKET_DOCS).upload(pathArquivado, bytes, {
      contentType: 'application/pdf', upsert: true
    });
    if (upErr) return { ok: false, erro: `Falha ao arquivar: ${upErr.message}` };

    const { data: urlData, error: urlErr } = await db.storage.from(BUCKET_DOCS).createSignedUrl(pathArquivado, 60 * 10);
    if (urlErr || !urlData?.signedUrl) return { ok: false, erro: 'Falha ao gerar o link do arquivo.' };

    return { ok: true, info: { url: urlData.signedUrl } };
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
    // A primeira signature é o AUTOR (a Rentech, action: null), que nunca assina.
    // O signatário de verdade é o que tem action.name === 'SIGN'.
    const assinatura = (doc?.signatures || []).find((s: any) => s?.action?.name === 'SIGN')
      || (doc?.signatures || [])[0];

    const assinou = !!assinatura?.signed?.created_at;
    const visualizou = !!assinatura?.viewed?.created_at;
    const rejeitou = !!assinatura?.rejected?.created_at;

    const novoStatus = rejeitou ? 'REJEITADO' : assinou ? 'ASSINADO' : visualizou ? 'VISUALIZADO' : 'ENVIADO';

    await db.from('folha_holerite_assinaturas').update({
      status: novoStatus,
      arquivo_assinado: doc?.files?.signed || doc?.files?.pades || null,
      visualizado_em: assinatura?.viewed?.created_at || null,
      assinado_em: assinatura?.signed?.created_at || null,
      atualizado_em: new Date().toISOString()
    }).eq('autentique_doc_id', ctrl.autentique_doc_id);

    return { ok: true, info: { status: novoStatus } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}