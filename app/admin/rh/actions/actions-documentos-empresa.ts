'use server';

// app/admin/rh/actions/actions-documentos-empresa.ts
// Gestão de documentos da EMPRESA (Rentech): certidões, cartão CNPJ, contrato
// social, etc. Mesmo desenho de actions-documentos-func.ts (funcionários),
// mas sem a dimensão "por colaborador" — é um único acervo.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET = 'documentos-empresa';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const ROTAS_PERMITIDAS = ['/admin/comercial/documentos', '/admin/rh/documentos'];

async function validarAcessoQualquerRota(accessToken: string) {
  for (const rota of ROTAS_PERMITIDAS) {
    const acesso = await validarAcesso(accessToken, rota);
    if (acesso.ok) return acesso;
  }
  return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
}

// ============================================================================
// CATÁLOGO DE CATEGORIAS
// ============================================================================
export async function listarCategoriasDocEmpresaAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('empresa_documento_categorias')
      .select('*').eq('ativo', true).order('nome');
    if (error) throw new Error(error.message);
    return { ok: true, info: { categorias: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarCategoriaDocEmpresaAction(payload: { nome: string; exigeValidade: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome para a categoria.' };
  try {
    const { error } = await db.from('empresa_documento_categorias').insert({ nome, exige_validade: payload.exigeValidade });
    if (error) {
      if (error.code === '23505') return { ok: false, erro: `"${nome}" já existe.` };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// UPLOAD de documento
// ============================================================================
export async function uploadDocumentoEmpresaAction(payload: {
  categoriaId: number;
  empresaId: number;
  titulo?: string | null;
  arquivoBase64: string;
  nomeArquivo: string;
  tipoMime: string;
  dataValidade?: string | null;
  observacao?: string | null;
  enviadoPor: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { categoriaId, empresaId, titulo, arquivoBase64, nomeArquivo, tipoMime, dataValidade, observacao, enviadoPor } = payload;

  if (!categoriaId || !arquivoBase64) {
    return { ok: false, erro: 'Categoria e arquivo são obrigatórios.' };
  }
  if (!empresaId) {
    return { ok: false, erro: 'Selecione a empresa (CNPJ) deste documento.' };
  }

  try {
    const { data: cat } = await db.from('empresa_documento_categorias').select('nome').eq('id', categoriaId).maybeSingle();
    const catSlug = slug(cat?.nome || 'outros');

    const bytes = Buffer.from(arquivoBase64, 'base64');
    const path = `${catSlug}/${Date.now()}-${slug(nomeArquivo.replace(/\.[^.]+$/, ''))}.${(nomeArquivo.split('.').pop() || 'bin').toLowerCase()}`;

    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: tipoMime || 'application/octet-stream', upsert: false
    });
    if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

    const { error: dbErr } = await db.from('empresa_documentos').insert({
      categoria_id: categoriaId,
      empresa_id: empresaId,
      titulo: titulo || null,
      storage_path: path,
      nome_arquivo: nomeArquivo,
      tipo_mime: tipoMime || null,
      tamanho_bytes: bytes.length,
      data_validade: dataValidade || null,
      observacao: observacao || null,
      enviado_por: enviadoPor || null
    });
    if (dbErr) {
      // rollback do arquivo se o registro falhar
      await db.storage.from(BUCKET).remove([path]);
      throw new Error(dbErr.message);
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LISTAR documentos (com filtro opcional por categoria)
// Anexa o status de validade calculado (OK / VENCENDO / VENCIDO).
// ============================================================================
export async function listarDocumentosEmpresaAction(payload: {
  categoriaId?: number | null;
  empresaIds?: number[] | null;
} | undefined, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    let q = db.from('empresa_documentos')
      .select('id, categoria_id, empresa_id, titulo, storage_path, nome_arquivo, tipo_mime, tamanho_bytes, data_validade, observacao, criado_em')
      .order('criado_em', { ascending: false });
    if (payload?.categoriaId) q = q.eq('categoria_id', payload.categoriaId);
    // empresaIds null/undefined = sem restrição (ex: setor ADMINISTRADOR);
    // array = só documentos dessas empresas (ver /admin/parametros/permissoes).
    if (payload?.empresaIds) q = q.in('empresa_id', payload.empresaIds);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const { data: cats } = await db.from('empresa_documento_categorias').select('id, nome');
    const nomeCat = (id: number) => cats?.find(c => c.id === id)?.nome || '—';

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const em30 = new Date(hoje); em30.setDate(em30.getDate() + 30);

    const documentos = (data || []).map(d => {
      let statusValidade: 'SEM' | 'OK' | 'VENCENDO' | 'VENCIDO' = 'SEM';
      if (d.data_validade) {
        const val = new Date(d.data_validade + 'T00:00:00');
        statusValidade = val < hoje ? 'VENCIDO' : (val <= em30 ? 'VENCENDO' : 'OK');
      }
      return { ...d, categoria: nomeCat(d.categoria_id), statusValidade };
    });

    return { ok: true, info: { documentos } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// URL de preview/download (signed URL de 10 min)
// ============================================================================
export async function urlDocumentoEmpresaAction(payload: { id: number; download?: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: doc } = await db.from('empresa_documentos')
      .select('storage_path, nome_arquivo').eq('id', payload.id).maybeSingle();
    if (!doc?.storage_path) return { ok: false, erro: 'Documento não encontrado.' };

    const opts = payload.download ? { download: doc.nome_arquivo } : undefined;
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60 * 10, opts);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Falha ao gerar link.');
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// EXCLUIR documento (remove do Storage e do banco)
// ============================================================================
export async function excluirDocumentoEmpresaAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: doc } = await db.from('empresa_documentos')
      .select('storage_path').eq('id', payload.id).maybeSingle();
    if (!doc) return { ok: false, erro: 'Documento não encontrado.' };

    await db.storage.from(BUCKET).remove([doc.storage_path]);
    const { error } = await db.from('empresa_documentos').delete().eq('id', payload.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
