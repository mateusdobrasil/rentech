"use server";

// app/portal/actions/actions-documentos.ts
// Documentos pessoais, carteirinha e holerites do PRÓPRIO funcionário logado.
// A identidade nunca vem de parâmetro do cliente — sempre resolvida no
// servidor a partir do access_token da sessão (resolverFuncionarioPortal),
// exatamente para impedir que um funcionário troque o parâmetro e veja
// documentos de outra pessoa.
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';
import { baixarAssinadoAction } from '../../admin/rh/actions/actions-assinatura';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET_DOCUMENTOS = 'documentos-funcionarios';
const SIGNED_URL_SEGUNDOS = 60 * 10;

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';

// ============================================================================
// DOCUMENTOS PESSOAIS / CARTEIRINHA
// Só retorna linhas de folha_documentos com visivel_portal = true — o RH
// decide explicitamente o que o funcionário pode ver (mesmo padrão de
// frota_documentos.visivel_frota).
// ============================================================================
// Consulta pura (sem resolver sessão) — usada tanto pelo action isolado
// abaixo quanto pela carga combinada da home do Portal (actions-home.ts).
export async function carregarDocumentosPorNome(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string) {
  const { data, error } = await db
    .from('folha_documentos')
    .select('id, categoria_id, titulo, nome_arquivo, tipo_mime, tamanho_bytes, data_validade, criado_em')
    .eq('funcionario_nome', funcionarioNome)
    .eq('visivel_portal', true)
    .order('criado_em', { ascending: false });
  if (error) throw new Error(error.message);

  const { data: cats } = await db.from('folha_documento_categorias').select('id, nome');
  const nomeCat = (id: number) => cats?.find(c => c.id === id)?.nome || '—';

  return (data || []).map(d => ({ ...d, categoria: nomeCat(d.categoria_id) }));
}

export async function listarMeusDocumentosAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const documentos = await carregarDocumentosPorNome(db, func.funcionarioNome);
    return { ok: true, info: { documentos } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function urlMeuDocumentoAction(accessToken: string, payload: { id: number; download?: boolean }): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const { data: doc } = await db
      .from('folha_documentos')
      .select('storage_path, nome_arquivo, funcionario_nome, visivel_portal')
      .eq('id', payload.id)
      .maybeSingle();

    // Confere posse do documento no servidor — nunca confia que o ID
    // pedido pelo cliente já "é" do funcionário certo.
    if (!doc || doc.funcionario_nome !== func.funcionarioNome || !doc.visivel_portal) {
      return { ok: false, erro: 'Documento não encontrado.' };
    }

    const opts = payload.download ? { download: doc.nome_arquivo } : undefined;
    const { data, error } = await db.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(doc.storage_path, SIGNED_URL_SEGUNDOS, opts);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Falha ao gerar link.');
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// HOLERITES ASSINADOS
// Reaproveita baixarAssinadoAction (app/admin/rh/actions/actions-assinatura.ts):
// mesma função que a tela do RH usa pra baixar o PDF assinado — ela já baixa
// da Autentique e arquiva em "documentos-folha" na primeira chamada, e nas
// seguintes só gera uma nova signed URL do que já está arquivado.
// ============================================================================
// Consulta pura (sem resolver sessão) — usada tanto pelo action isolado
// abaixo quanto pela carga combinada da home do Portal (actions-home.ts).
export async function carregarHoleritesPorNome(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string) {
  const { data, error } = await db
    .from('folha_holerite_assinaturas')
    .select('id, mes_referencia, status, assinado_em')
    .eq('funcionario_nome', funcionarioNome)
    .eq('status', 'ASSINADO')
    // Exclui avulsos (marcador "AVULSO-<mes>-<timestamp>", ver actions-assinatura.ts)
    // — o Portal só lista holerites mensais de verdade nesta aba.
    .not('mes_referencia', 'ilike', 'AVULSO-%')
    .order('mes_referencia', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function listarMeusHoleritesAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const holerites = await carregarHoleritesPorNome(db, func.funcionarioNome);
    return { ok: true, info: { holerites } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function urlMeuHoleriteAction(accessToken: string, payload: { id: number }): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const { data: holerite } = await db
      .from('folha_holerite_assinaturas')
      .select('funcionario_nome, mes_referencia, status')
      .eq('id', payload.id)
      .maybeSingle();

    if (!holerite || holerite.funcionario_nome !== func.funcionarioNome || holerite.status !== 'ASSINADO') {
      return { ok: false, erro: 'Holerite não encontrado.' };
    }

    return baixarAssinadoAction({ funcionarioNome: holerite.funcionario_nome, mesReferencia: holerite.mes_referencia });
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
