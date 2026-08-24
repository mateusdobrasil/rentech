// app/portal/lib/resolverMotorista.ts
// Resolve a identidade de quem está abrindo/fechando um checklist de veículo
// pelo app mobile — usado só pelas Route Handlers novas
// (app/api/portal/checklist-veiculo/*), não pela Server Action do Portal web
// (que continua só PORTAL via resolverFuncionarioPortal, comportamento
// inalterado).
//
// O app mobile tem duas identidades possíveis (ver mobile/context/AuthContext.tsx):
// conta de equipe (perfis_usuarios, cargo normalizado) ou conta de colaborador
// via Portal (portal_funcionarios_auth, CPF). Quem de STAFF pode usar a aba
// Frota é decidido em folha_paginas_permissoes (rota virtual '/mobile/frota',
// gerida em /admin/parametros/permissoes → Páginas — mesma tabela que já
// controla acesso de rota no /admin, ver possuiAcessoRota em serverAuth.ts),
// não um array fixo aqui. Isso é só UI/servidor mobile — não existe RLS nesta
// fase, então é ESTA função que reautoriza no servidor: reconfirma contra a
// tabela antes de aceitar a identidade STAFF, nunca confia no gate client-side.
//
// Diferença chave em relação ao Portal: contas STAFF não têm (nem precisam
// de) uma linha em folha_funcionarios — motoristaNome vira o próprio
// perfis_usuarios.nome, sem checar pode_dirigir (a permissão de rota já
// autoriza). Contas PORTAL seguem exatamente a regra de sempre
// (exigirPermissaoDirigir).
import { supabaseAdmin } from '../../lib/supabase';
import { normalizarPermissao } from '../../lib/permissoes';
import { possuiAcessoRota } from '../../lib/serverAuth';
import { resolverFuncionarioPortal } from '../actions/actions-acesso';
import { exigirPermissaoDirigir } from './checklistVeiculo';

const ROTA_MOBILE_FROTA = '/mobile/frota';

export interface MotoristaResolvido {
  motoristaNome: string;
  empresaId: string | null;
  via: 'STAFF' | 'PORTAL';
}

export async function resolverMotorista(accessToken: string): Promise<MotoristaResolvido | null> {
  if (!accessToken) return null;
  const db = supabaseAdmin();

  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  // select(*) de propósito: perfis_usuarios não tem coluna "nivel" (só
  // "permissao") — um select() explícito listando "nivel" faz o Postgrest
  // dar erro 400 (coluna inexistente), e como esse erro não era checado
  // aqui, toda conta STAFF caía silenciosamente pro fallback PORTAL e
  // resultava em 401 pra qualquer um. Mesmo padrão de buscarPerfilStaff em
  // mobile/context/AuthContext.tsx.
  const { data: staff } = await db
    .from('perfis_usuarios')
    .select('*')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (staff?.nome) {
    const normalizada = normalizarPermissao(staff.permissao || '');
    if (!(await possuiAcessoRota(normalizada, ROTA_MOBILE_FROTA))) return null; // conta de equipe existe, mas não autorizada — rejeita, não cai pra tentar Portal
    return { motoristaNome: staff.nome, empresaId: null, via: 'STAFF' };
  }

  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return null;
  if (!(await exigirPermissaoDirigir(db, func.funcionarioNome))) return null;

  const { data: funcRow } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', func.funcionarioNome).maybeSingle();
  return { motoristaNome: func.funcionarioNome, empresaId: funcRow?.empresa_id ?? null, via: 'PORTAL' };
}
