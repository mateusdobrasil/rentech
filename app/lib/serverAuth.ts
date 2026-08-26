// Validação de sessão+permissão para Server Actions. Mesma tabela/lógica que já
// gateia a UI (folha_paginas_permissoes + normalizarPermissao) — a UI escondia o
// botão, mas a Server Action por trás dele aceitava a chamada de qualquer sessão
// válida. Isso fecha esse buraco no lado que realmente importa: o servidor.
import { supabaseAdmin } from './supabase';
import { normalizarPermissao, ehAdministradorGlobal } from './permissoes';

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

// Inverso de possuiAcessoRota: em vez de validar 1 usuário já conhecido,
// lista todo mundo que acessa uma rota — usado pra decidir quem recebe uma
// notificação push quando um evento acontece (ver app/lib/push.ts). Não
// cruza com perfis_usuarios_empresas (empresa_id): o pior caso de não
// filtrar por empresa aqui é alguém receber um push que não era bem pra ele,
// não um vazamento de dado sensível — ver justificativa no plano da Fase de
// Push.
export async function listarPerfisComAcessoRota(rota: string): Promise<{ id: string; nome: string }[]> {
  const admin = supabaseAdmin();

  const { data: permissaoRow } = await admin
    .from('folha_paginas_permissoes')
    .select('permissoes_permitidas')
    .eq('endereco_route', rota)
    .maybeSingle();
  const permitidas = (permissaoRow?.permissoes_permitidas as string[]) || [];
  if (permitidas.length === 0) return [];

  const { data: perfis } = await admin.from('perfis_usuarios').select('id, nome, permissao, nivel');
  return ((perfis || []) as { id: string; nome: string; permissao: string | null; nivel: string | null }[])
    .filter(p => permitidas.includes(normalizarPermissao(p.permissao || p.nivel || '')))
    .map(p => ({ id: p.id, nome: p.nome }));
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

// Empresas que o usuário do perfil pode enxergar: `null` = sem restrição.
// Sempre resolvido no servidor a partir de perfis_usuarios_empresas — nunca
// aceitar essa lista vinda do cliente, senão qualquer chamador pode pedir
// dados de qualquer empresa só informando o ID dela no payload.
//
// O balde ADMINISTRADOR (normalizarPermissao) junta Admin/Diretoria/Gerência
// só pra fins de ACESSO DE ROTA — pra fins de EMPRESA, só quem é
// literalmente "Administrador" (ehAdministradorGlobal) fica sem restrição.
// Diretoria/Gerência ficam escopadas como qualquer outro usuário, porque
// diretorias diferentes tocam empresas diferentes (Rentech × AlfaLight).
export async function obterEmpresasPermitidas(perfilId: string, permissaoNormalizada: string): Promise<number[] | null> {
  const admin = supabaseAdmin();

  if (permissaoNormalizada === 'ADMINISTRADOR') {
    const { data: perfil } = await admin.from('perfis_usuarios').select('permissao').eq('id', perfilId).maybeSingle();
    if (ehAdministradorGlobal(perfil?.permissao || '')) return null;
  }

  const { data } = await admin
    .from('perfis_usuarios_empresas')
    .select('empresa_id')
    .eq('perfil_id', perfilId);

  return ((data || []) as { empresa_id: number }[]).map(v => v.empresa_id);
}

// Confere se uma linha (pelo empresa_id dela) está dentro do que o usuário
// pode ver: null (ADMINISTRADOR) sempre permite; empresa_id null (linha
// legada/funcionário sem empresa definida) também passa — mesmo critério
// usado nas políticas de RLS (sql/multiempresa_isolamento_rls.sql), pra não
// haver divergência entre o que a Server Action deixa passar e o que o banco
// deixaria passar num acesso direto.
export function empresaPermitida(empresasPermitidas: number[] | null, empresaId: number | null | undefined): boolean {
  if (empresasPermitidas === null) return true;
  if (empresaId === null || empresaId === undefined) return true;
  return empresasPermitidas.includes(empresaId);
}
