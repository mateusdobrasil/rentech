// Validação de sessão+permissão para Server Actions. Mesma tabela/lógica que já
// gateia a UI (folha_paginas_permissoes + normalizarPermissao) — a UI escondia o
// botão, mas a Server Action por trás dele aceitava a chamada de qualquer sessão
// válida. Isso fecha esse buraco no lado que realmente importa: o servidor.
import { supabaseAdmin } from './supabase';
import { normalizarPermissao } from './permissoes';

export interface PerfilValidado {
  id: string;
  nome: string;
  email: string;
  permissaoBruta: string;
  permissaoNormalizada: string;
}

export async function obterPerfilValidado(accessToken: string): Promise<PerfilValidado | null> {
  if (!accessToken) return null;

  const admin = supabaseAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  const { data: perfil, error: perfilError } = await admin
    .from('perfis_usuarios')
    .select('*')
    .eq('id', userData.user.id)
    .single();

  if (perfilError || !perfil) return null;

  const permissaoBruta = perfil.permissao || perfil.nivel || '';
  return {
    id: userData.user.id,
    nome: (perfil.nome || userData.user.email || 'Usuário') as string,
    email: (perfil.email || userData.user.email || '') as string,
    permissaoBruta,
    permissaoNormalizada: normalizarPermissao(permissaoBruta),
  };
}

export async function possuiAcessoRota(permissaoNormalizada: string, rota: string): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('folha_paginas_permissoes')
    .select('permissoes_permitidas')
    .eq('endereco_route', rota)
    .single();

  return ((data?.permissoes_permitidas as string[]) || []).includes(permissaoNormalizada);
}

export type ResultadoAcesso =
  | { ok: true; perfil: PerfilValidado }
  | { ok: false; message: string };

export async function validarAcesso(accessToken: string, rota: string): Promise<ResultadoAcesso> {
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { ok: false, message: 'Sessão inválida ou expirada. Faça login novamente.' };

  const autorizado = await possuiAcessoRota(perfil.permissaoNormalizada, rota);
  if (!autorizado) return { ok: false, message: 'Você não tem permissão para executar esta ação.' };

  return { ok: true, perfil };
}
