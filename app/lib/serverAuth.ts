// Validação de sessão+permissão para Server Actions. Mesma tabela/lógica que já
// gateia a UI (parametros_paginas_permissoes + normalizarPermissao) — a UI escondia o
// botão, mas a Server Action por trás dele aceitava a chamada de qualquer sessão
// válida. Isso fecha esse buraco no lado que realmente importa: o servidor.
import { AsyncLocalStorage } from 'node:async_hooks';
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
    .from('parametros_paginas_permissoes')
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
    .from('parametros_paginas_permissoes')
    .select('permissoes_permitidas')
    .eq('endereco_route', rota)
    .maybeSingle();
  const permitidas = (permissaoRow?.permissoes_permitidas as string[]) || [];
  if (permitidas.length === 0) return [];

  const { data: perfis } = await admin.from('perfis_usuarios').select('id, nome, permissao').eq('ativo', true);
  return ((perfis || []) as { id: string; nome: string; permissao: string | null }[])
    .filter(p => permitidas.includes(normalizarPermissao(p.permissao || '')))
    .map(p => ({ id: p.id, nome: p.nome }));
}

export type ResultadoAcesso =
  | { ok: true; perfil: PerfilValidado }
  | { ok: false; message: string };

// Mensagem final de quem testa várias rotas (validarAcessoQualquerRota e
// afins): antes era sempre "sem permissão", mesmo quando o motivo real era a
// sessão vencida — escondia o problema (caso Benefícios por Mês, 2026-11-09).
export async function mensagemAcessoNegado(accessToken: string): Promise<string> {
  return (await obterPerfilValidado(accessToken))
    ? MSG_SEM_PERMISSAO
    : 'Sua sessão expirou. Recarregue a página (F5) e tente de novo.';
}

// ---------------------------------------------------------------------------
// 2FA NO SERVIDOR (tour de melhorias 2026-11-11, item 3)
// Antes o 2FA só era cobrado na tela (app/admin/ExigirMFA.tsx): a página
// ficava atrás do código, mas a Server Action por trás dela aceitava qualquer
// sessão logada — bastava chamar a action direto. Agora, quando a rota tem
// requer_2fa (aba "Permissão 2FA" em /admin/parametros/permissoes), a sessão
// também precisa ter passado pelo 2FA:
//   - código do aplicativo autenticador → o Supabase sobe o token pra aal2; ou
//   - plano B "Não estou com meu celular" → liberação da sessão atual em
//     acesso_mfa_codigos_email (ver app/admin/actions-mfa.ts).
// O app mobile/portal não passa por aqui (resolverStaffMobile/possuiAcessoRota).
// ---------------------------------------------------------------------------
const MSG_SESSAO_INVALIDA = 'Sessão inválida ou expirada. Faça login novamente.';
const MSG_SEM_PERMISSAO = 'Você não tem permissão para executar esta ação.';
const MSG_EXIGE_2FA = 'Esta ação exige a verificação em duas etapas. Recarregue a página (F5) e confirme o código.';

// Claims do JWT. Só usar depois do getUser (obterPerfilValidado), que é quem
// valida a assinatura/validade do token no Supabase.
function claimsDoToken(accessToken: string): { aal?: string; session_id?: string } {
  try {
    return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) || {};
  } catch {
    return {};
  }
}

export async function sessaoCumpre2fa(accessToken: string, userId: string): Promise<boolean> {
  const claims = claimsDoToken(accessToken);
  if (claims.aal === 'aal2') return true;
  if (!claims.session_id) return false;
  try {
    const { data } = await supabaseAdmin().from('acesso_mfa_codigos_email')
      .select('id').eq('user_id', userId).eq('sessao_id', claims.session_id)
      .gt('liberado_ate', new Date().toISOString()).limit(1);
    return !!(data && data.length > 0);
  } catch {
    return false;
  }
}

// CANAL DO APP MOBILE: o app (mobile/) não tem tela de 2FA, e as rotas
// /api/portal/op* e /api/portal/aprovacoes-ponto* reaproveitam as mesmas
// actions do admin (aprovar OP, aprovar ponto). Essas Route Handlers rodam a
// chamada dentro de executarPeloApp('/mobile/xxx', ...): aí o 2FA da rota do
// admin é dispensado SÓ pra quem tem a permissão da rota do app em
// parametros_paginas_permissoes (a permissão da rota do admin continua
// valendo). AsyncLocalStorage só é preenchido por código de servidor — um
// navegador chamando a Server Action direto não tem como entrar nesse canal.
const canalApp = new AsyncLocalStorage<{ rotaApp: string }>();
export function executarPeloApp<T>(rotaApp: string, fn: () => Promise<T>): Promise<T> {
  return canalApp.run({ rotaApp }, fn);
}

type FalhaAcesso = { ok: false; message: string; motivo: 'SESSAO' | 'PERMISSAO' | '2FA' };

async function checarAcesso(accessToken: string, rota: string, perfilJa?: PerfilValidado | null): Promise<{ ok: true; perfil: PerfilValidado } | FalhaAcesso> {
  const perfil = perfilJa === undefined ? await obterPerfilValidado(accessToken) : perfilJa;
  if (!perfil) return { ok: false, message: MSG_SESSAO_INVALIDA, motivo: 'SESSAO' };

  const { data } = await supabaseAdmin()
    .from('parametros_paginas_permissoes')
    .select('permissoes_permitidas, requer_2fa')
    .eq('endereco_route', rota)
    .maybeSingle();
  const autorizado = ((data?.permissoes_permitidas as string[]) || []).includes(perfil.permissaoNormalizada);
  if (!autorizado) return { ok: false, message: MSG_SEM_PERMISSAO, motivo: 'PERMISSAO' };

  if (data?.requer_2fa && !(await sessaoCumpre2fa(accessToken, perfil.id))) {
    const app = canalApp.getStore();
    const liberadoPeloApp = !!app && await possuiAcessoRota(perfil.permissaoNormalizada, app.rotaApp);
    if (!liberadoPeloApp) return { ok: false, message: MSG_EXIGE_2FA, motivo: '2FA' };
  }
  return { ok: true, perfil };
}

export async function validarAcesso(accessToken: string, rota: string): Promise<ResultadoAcesso> {
  const r = await checarAcesso(accessToken, rota);
  return r.ok ? r : { ok: false, message: r.message };
}

// Action reaproveitada por mais de uma tela: passa se QUALQUER uma das rotas
// liberar (permissão + 2FA da rota, se ela exigir). Substitui as cópias locais
// de "validarAcessoQualquerRota" que existiam em cada arquivo de actions.
// Na recusa, a mensagem diz o motivo real: 2FA pendente numa rota que o
// usuário tem permissão vence "sem permissão".
export async function validarAcessoAlgumaRota(accessToken: string, rotas: string[]): Promise<ResultadoAcesso> {
  const perfil = await obterPerfilValidado(accessToken);
  // mesma frase do mensagemAcessoNegado (token vencido com a página aberta)
  if (!perfil) return { ok: false, message: 'Sua sessão expirou. Recarregue a página (F5) e tente de novo.' };
  let faltou2fa = false;
  for (const rota of rotas) {
    const r = await checarAcesso(accessToken, rota, perfil);
    if (r.ok) return r;
    if (r.motivo === '2FA') faltou2fa = true;
  }
  return { ok: false, message: faltou2fa ? MSG_EXIGE_2FA : MSG_SEM_PERMISSAO };
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
