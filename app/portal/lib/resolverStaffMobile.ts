// app/portal/lib/resolverStaffMobile.ts
// Resolvedor genérico STAFF-only pro app mobile — mais simples que
// resolverMotorista.ts (checklist de veículo): sem ramo PORTAL, porque
// Checklist de Carga não tem equivalente a folha_funcionarios.pode_dirigir,
// é sempre "equipe" (Frota/OPERACIONAL, mesma população que já usa o
// Checklist de Veículo). Autoriza contra folha_paginas_permissoes (mesma
// tabela que já controla acesso de rota no /admin) — nunca confia no gate
// client-side (a aba escondida no app é só UI).
import { supabaseAdmin } from '../../lib/supabase';
import { normalizarPermissao } from '../../lib/permissoes';
import { possuiAcessoRota, obterEmpresasPermitidas } from '../../lib/serverAuth';

export interface StaffMobileResolvido {
  perfilId: string;
  nome: string;
  permissaoNormalizada: string;
  empresasPermitidas: number[] | null;
}

export async function resolverStaffMobile(accessToken: string, rota: string): Promise<StaffMobileResolvido | null> {
  if (!accessToken) return null;
  const db = supabaseAdmin();

  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  const { data: staff } = await db
    .from('perfis_usuarios')
    .select('*')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (!staff?.nome) return null;

  const permissaoNormalizada = normalizarPermissao(staff.permissao || '');
  if (!(await possuiAcessoRota(permissaoNormalizada, rota))) return null;

  const empresasPermitidas = await obterEmpresasPermitidas(userData.user.id, permissaoNormalizada);
  return { perfilId: userData.user.id, nome: staff.nome, permissaoNormalizada, empresasPermitidas };
}
