'use server';

// app/admin/rh/actions-documentos.ts
// Grava no Supabase Storage os PDFs separados por funcionário (adiantamento /
// holerite mensal) e registra o ponteiro em folha_documentos_contabeis.
// A separação por página é feita no CLIENTE (pdf-lib); aqui recebemos cada
// pedaço já em base64 e persistimos.
import { supabaseAdmin } from '../../../lib/supabase';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET = 'documentos-folha';

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

// ============================================================================
// SALVAR DOCUMENTOS SEPARADOS (lote de uma importação)
// Cada item: { funcionarioNome, pdfBase64, paginaOrigem }
// ============================================================================
export async function salvarDocumentosContabeisAction(payload: {
  mesReferencia: string;
  tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL';
  nomeArquivoOrigem: string;
  importadoPor: string;
  itens: { funcionarioNome: string; pdfBase64: string; paginaOrigem: number }[];
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { mesReferencia, tipo, nomeArquivoOrigem, importadoPor, itens } = payload;

  if (!itens.length) return { ok: false, erro: 'Nenhuma página para salvar.' };

  const salvos: string[] = [];
  const falhas: string[] = [];

  try {
    for (const item of itens) {
      const bytes = Buffer.from(item.pdfBase64, 'base64');
      const path = `${mesReferencia}/${tipo.toLowerCase()}/${slug(item.funcionarioNome)}.pdf`;

      // Sobe (upsert) o PDF no Storage
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
        contentType: 'application/pdf', upsert: true
      });
      if (upErr) { falhas.push(`${item.funcionarioNome}: ${upErr.message}`); continue; }

      // Registra o ponteiro (upsert por funcionário+mês+tipo)
      const { error: dbErr } = await db.from('folha_documentos_contabeis').upsert({
        funcionario_nome: item.funcionarioNome,
        mes_referencia: mesReferencia,
        tipo,
        storage_path: path,
        pagina_origem: item.paginaOrigem,
        nome_arquivo_origem: nomeArquivoOrigem,
        confianca_match: 'MANUAL',
        importado_por: importadoPor || null,
        importado_em: new Date().toISOString()
      }, { onConflict: 'funcionario_nome,mes_referencia,tipo' });
      if (dbErr) { falhas.push(`${item.funcionarioNome}: ${dbErr.message}`); continue; }

      salvos.push(item.funcionarioNome);
    }

    return { ok: salvos.length > 0, info: { salvos: salvos.length, total: itens.length, falhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LISTAR DOCUMENTOS de um mês (para conferência / status)
// ============================================================================
export async function listarDocumentosContabeisAction(payload: {
  mesReferencia: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_documentos_contabeis')
      .select('funcionario_nome, tipo, storage_path, pagina_origem, importado_em')
      .eq('mes_referencia', payload.mesReferencia)
      .order('funcionario_nome');
    if (error) throw new Error(error.message);
    return { ok: true, info: { documentos: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// GERAR SIGNED URL para baixar/visualizar um documento
// ============================================================================
export async function urlDocumentoContabilAction(payload: {
  funcionarioNome: string; mesReferencia: string; tipo: 'ADIANTAMENTO' | 'HOLERITE_MENSAL';
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const path = `${payload.mesReferencia}/${payload.tipo.toLowerCase()}/${slug(payload.funcionarioNome)}.pdf`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    if (error) throw new Error(error.message);
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}