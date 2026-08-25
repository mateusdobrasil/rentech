import { NextResponse } from 'next/server';
import { obterPerfilValidado, possuiAcessoRota } from '../../../lib/serverAuth';
import { listarOPs } from '../../../admin/op/actions';

// GET /api/portal/op
// Authorization: Bearer <access_token>
//
// Resolve sozinha qual das duas rotas admin usar: quem tem acesso a
// /admin/financeiro/ops vê tudo (mesma regra de listarOPs); os demais só
// veem as próprias OPs, via /admin/op/responsavel — mesma dualidade que já
// existe entre as duas páginas admin.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  const temFinanceiro = await possuiAcessoRota(perfil.permissaoNormalizada, '/admin/financeiro/ops');
  const rota = temFinanceiro ? '/admin/financeiro/ops' : '/admin/op/responsavel';

  const resultado = await listarOPs(accessToken, rota);
  if (!resultado.success) return NextResponse.json({ ok: false, erro: resultado.message }, { status: 401 });
  return NextResponse.json({ ok: true, info: resultado.data });
}
