import { NextResponse } from 'next/server';
import { resolverFuncionarioPortal } from '../../../portal/actions/actions-acesso';
import { supabaseAdmin } from '../../../lib/supabase';

// GET /api/portal/perfil
// Authorization: Bearer <access_token>
//
// Resolve o perfil de uma conta do Portal do Funcionário (portal_funcionarios_auth)
// pro app mobile — usada quando o login não bate com nenhuma linha de
// perfis_usuarios (contas de equipe), ver AuthContext.tsx no mobile/. Mesmo
// padrão de validação server-side via service role de resolverFuncionarioPortal;
// não abre RLS nova em portal_funcionarios_auth/folha_funcionarios.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: folha } = await db
    .from('folha_funcionarios')
    .select('cargo, matricula_esocial, pode_dirigir')
    .eq('nome_completo', func.funcionarioNome)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    info: {
      funcionarioNome: func.funcionarioNome,
      cargo: folha?.cargo || null,
      matriculaEsocial: folha?.matricula_esocial || null,
      // Mesma flag que já libera o Checklist de Veículo no Portal web
      // (ver exigirPermissaoDirigir em app/portal/lib/checklistVeiculo.ts) —
      // libera a aba Frota no app pra quem tem isso marcado na ficha.
      podeDirigir: !!folha?.pode_dirigir,
    },
  });
}
