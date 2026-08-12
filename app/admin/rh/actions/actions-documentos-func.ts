'use server';

// app/admin/rh/actions/actions-documentos-func.ts
// Gestão de documentos dos funcionários: upload no Storage, metadados no banco,
// controle de validade e painel de pendências.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET = 'documentos-funcionarios';

const ROTAS_PERMITIDAS = ['/admin/rh/documentos', '/admin/rh/funcionario', '/admin/rh/relatorios'];

async function validarAcessoQualquerRota(accessToken: string) {
  for (const rota of ROTAS_PERMITIDAS) {
    const acesso = await validarAcesso(accessToken, rota);
    if (acesso.ok) return acesso;
  }
  return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
}

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

// ============================================================================
// CATÁLOGO DE CATEGORIAS
// ============================================================================
export async function listarCategoriasDocAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('folha_documento_categorias')
      .select('*').eq('ativo', true).order('nome');
    if (error) throw new Error(error.message);
    return { ok: true, info: { categorias: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarCategoriaDocAction(payload: { nome: string; exigeValidade: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome para a categoria.' };
  try {
    const { error } = await db.from('folha_documento_categorias').insert({ nome, exige_validade: payload.exigeValidade });
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
export async function uploadDocumentoAction(payload: {
  funcionarioNome: string;
  categoriaId: number;
  titulo?: string | null;
  arquivoBase64: string;
  nomeArquivo: string;
  tipoMime: string;
  dataValidade?: string | null;
  observacao?: string | null;
  enviadoPor: string;
  visivelPortal?: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, categoriaId, titulo, arquivoBase64, nomeArquivo, tipoMime, dataValidade, observacao, enviadoPor, visivelPortal } = payload;

  if (!funcionarioNome || !categoriaId || !arquivoBase64) {
    return { ok: false, erro: 'Funcionário, categoria e arquivo são obrigatórios.' };
  }

  try {
    // Nome da categoria para compor o caminho
    const { data: cat } = await db.from('folha_documento_categorias').select('nome').eq('id', categoriaId).maybeSingle();
    const catSlug = slug(cat?.nome || 'outros');

    const bytes = Buffer.from(arquivoBase64, 'base64');
    const path = `${slug(funcionarioNome)}/${catSlug}/${Date.now()}-${slug(nomeArquivo.replace(/\.[^.]+$/, ''))}.${(nomeArquivo.split('.').pop() || 'bin').toLowerCase()}`;

    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: tipoMime || 'application/octet-stream', upsert: false
    });
    if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

    const { error: dbErr } = await db.from('folha_documentos').insert({
      funcionario_nome: funcionarioNome,
      categoria_id: categoriaId,
      titulo: titulo || null,
      storage_path: path,
      nome_arquivo: nomeArquivo,
      tipo_mime: tipoMime || null,
      tamanho_bytes: bytes.length,
      data_validade: dataValidade || null,
      observacao: observacao || null,
      enviado_por: enviadoPor || null,
      visivel_portal: visivelPortal || false
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
// FOTO DE PERFIL (usada no Crachá do Portal do Funcionário)
// Reaproveita o bucket de documentos com upsert: true, já que só existe uma
// foto vigente por funcionário (a antiga é sobrescrita no mesmo caminho).
// ============================================================================
export async function uploadFotoFuncionarioAction(payload: {
  funcionarioNome: string;
  arquivoBase64: string;
  nomeArquivo: string;
  tipoMime: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, arquivoBase64, nomeArquivo, tipoMime } = payload;

  if (!funcionarioNome || !arquivoBase64) {
    return { ok: false, erro: 'Funcionário e arquivo são obrigatórios.' };
  }

  try {
    const bytes = Buffer.from(arquivoBase64, 'base64');
    const ext = (nomeArquivo.split('.').pop() || 'jpg').toLowerCase();
    const path = `${slug(funcionarioNome)}/foto-perfil/foto.${ext}`;

    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: tipoMime || 'image/jpeg', upsert: true
    });
    if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

    const { error: dbErr } = await db.from('folha_funcionarios').update({ foto_path: path }).eq('nome_completo', funcionarioNome);
    if (dbErr) throw new Error(dbErr.message);

    return { ok: true, info: { path } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function urlFotoFuncionarioAction(payload: { fotoPath: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(payload.fotoPath, 60 * 10);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Falha ao gerar link.');
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LISTAR documentos (com filtro opcional por funcionário/categoria)
// Anexa o status de validade calculado (OK / VENCENDO / VENCIDO).
// ============================================================================
export async function listarDocumentosAction(payload: {
  funcionarioNome?: string | null;
  categoriaId?: number | null;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    let q = db.from('folha_documentos')
      .select('id, funcionario_nome, categoria_id, titulo, storage_path, nome_arquivo, tipo_mime, tamanho_bytes, data_validade, observacao, criado_em, visivel_portal')
      .order('criado_em', { ascending: false });
    if (payload.funcionarioNome) q = q.eq('funcionario_nome', payload.funcionarioNome);
    if (payload.categoriaId) q = q.eq('categoria_id', payload.categoriaId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const { data: cats } = await db.from('folha_documento_categorias').select('id, nome');
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
export async function urlDocumentoAction(payload: { id: number; download?: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: doc } = await db.from('folha_documentos')
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
// ALTERNAR VISIBILIDADE NO PORTAL DO FUNCIONÁRIO
// Controla folha_documentos.visivel_portal — só o que estiver marcado aqui
// aparece pro próprio funcionário em /portal (ver app/portal/actions/actions-documentos.ts).
// Default é sempre false: nada fica visível sem essa marcação explícita.
// ============================================================================
export async function alternarVisivelPortalAction(payload: { id: number; visivel: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_documentos').update({ visivel_portal: payload.visivel }).eq('id', payload.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// EXCLUIR documento (remove do Storage e do banco)
// ============================================================================
export async function excluirDocumentoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: doc } = await db.from('folha_documentos')
      .select('storage_path').eq('id', payload.id).maybeSingle();
    if (!doc) return { ok: false, erro: 'Documento não encontrado.' };

    await db.storage.from(BUCKET).remove([doc.storage_path]);
    const { error } = await db.from('folha_documentos').delete().eq('id', payload.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PAINEL: visão geral por funcionário + pendências + vencimentos
// ============================================================================
export async function painelDocumentosAction(empresaIds: number[] | null, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoQualquerRota(accessToken);
  if (!acesso.ok) {
    // Também usada pelo painel de pendências do hub /admin/rh — quem enxerga
    // o hub mas não tem uma das rotas específicas do módulo ainda assim
    // precisa ver a contagem agregada.
    const acessoHub = await validarAcesso(accessToken, '/admin/rh');
    if (!acessoHub.ok) return { ok: false, erro: acesso.message };
  }

  const db = supabaseAdmin();
  try {
    let qFuncs = db.from('folha_funcionarios')
      .select('nome_completo, cargo').eq('ativo', true).order('nome_completo');
    // empresaIds null/undefined = sem restrição (ex: setor ADMINISTRADOR);
    // array = só funcionários dessas empresas (ver /admin/parametros/permissoes).
    if (empresaIds) qFuncs = qFuncs.in('empresa_id', empresaIds);
    const { data: funcs } = await qFuncs;
    const { data: docs } = await db.from('folha_documentos')
      .select('funcionario_nome, categoria_id, data_validade');
    const { data: cats } = await db.from('folha_documento_categorias').select('id, nome');

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const em30 = new Date(hoje); em30.setDate(em30.getDate() + 30);

    // Contagem e vencimentos por funcionário
    const porFunc: Record<string, { total: number; vencidos: number; vencendo: number; categorias: Set<number> }> = {};
    (docs || []).forEach(d => {
      (porFunc[d.funcionario_nome] ||= { total: 0, vencidos: 0, vencendo: 0, categorias: new Set() });
      porFunc[d.funcionario_nome].total++;
      porFunc[d.funcionario_nome].categorias.add(d.categoria_id);
      if (d.data_validade) {
        const val = new Date(d.data_validade + 'T00:00:00');
        if (val < hoje) porFunc[d.funcionario_nome].vencidos++;
        else if (val <= em30) porFunc[d.funcionario_nome].vencendo++;
      }
    });

    const linhas = (funcs || []).map(f => {
      const p = porFunc[f.nome_completo] || { total: 0, vencidos: 0, vencendo: 0, categorias: new Set() };
      return {
        nome: f.nome_completo, cargo: f.cargo,
        totalDocs: p.total, vencidos: p.vencidos, vencendo: p.vencendo,
        semDocumentos: p.total === 0
      };
    });

    const totais = {
      funcionarios: linhas.length,
      semDocumentos: linhas.filter(l => l.semDocumentos).length,
      // Soma só dos funcionários visíveis (linhas), não de (docs || []).length
      // direto — senão vaza contagem de documentos de empresas que o usuário
      // logado não tem vínculo pra ver (ver empresaIds acima).
      totalDocs: linhas.reduce((s, l) => s + l.totalDocs, 0),
      vencidos: linhas.reduce((s, l) => s + l.vencidos, 0),
      vencendo: linhas.reduce((s, l) => s + l.vencendo, 0)
    };

    return { ok: true, info: { linhas, totais } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}