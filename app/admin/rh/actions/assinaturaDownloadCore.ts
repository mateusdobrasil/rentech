// Lógica de baixar/arquivar o PDF assinado da Autentique, SEM "use server" —
// reaproveitada tanto por actions-assinatura.ts (versão protegida por
// accessToken, exportada como baixarAssinadoAction, usada pela tela do RH)
// quanto por app/portal/actions/actions-documentos.ts (urlMeuHoleriteAction),
// que já resolve e confere a posse do holerite pelo funcionário logado no
// Portal ANTES de chamar esta função — funcionário não tem permissão de rota
// admin, então não faz sentido (nem seria possível) exigir accessToken aqui.
// Ficar fora de um arquivo "use server" impede que esta função vire um
// endpoint de Server Action alcançável direto por RPC sem nenhuma das duas
// checagens acima.
import { supabaseAdmin } from '../../../lib/supabase';
import { autentiqueConsultarDocumento } from '../../../lib/autentique';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET_DOCS = 'documentos-folha';

function slug(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

export async function baixarAssinado(payload: {
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
