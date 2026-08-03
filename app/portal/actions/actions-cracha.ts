"use server";

// app/portal/actions/actions-cracha.ts
// Dados do crachá digital do PRÓPRIO funcionário logado (exibido em /portal).
// Mesma regra das demais actions do portal: a identidade nunca vem de
// parâmetro do cliente — sempre resolvida no servidor via access_token
// (resolverFuncionarioPortal).
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET_DOCUMENTOS = 'documentos-funcionarios';
const SIGNED_URL_SEGUNDOS = 60 * 15;

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';

// Consulta pura (sem resolver sessão) — usada tanto pelo action isolado
// abaixo quanto pela carga combinada da home do Portal (actions-home.ts),
// que já resolveu a sessão uma vez pra todas as seções da página.
export async function buscarCrachaDados(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string) {
  const { data, error } = await db
    .from('folha_funcionarios')
    .select('nome_completo, cargo, cpf, foto_path, data_nascimento')
    .eq('nome_completo', funcionarioNome)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  let fotoUrl: string | null = null;
  if (data.foto_path) {
    const { data: signed } = await db.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(data.foto_path, SIGNED_URL_SEGUNDOS);
    fotoUrl = signed?.signedUrl || null;
  }

  return {
    nome: data.nome_completo,
    cargo: data.cargo,
    cpf: data.cpf,
    dataNascimento: data.data_nascimento,
    fotoUrl,
  };
}

export async function buscarMeuCrachaAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const info = await buscarCrachaDados(db, func.funcionarioNome);
    if (!info) return { ok: false, erro: 'Cadastro não encontrado.' };
    return { ok: true, info };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
