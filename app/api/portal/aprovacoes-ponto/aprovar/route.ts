import { NextResponse } from 'next/server';
import { obterPerfilValidado } from '../../../../lib/serverAuth';
import { aprovarSolicitacaoAction } from '../../../../admin/rh/actions/actions-ponto-whatsapp';

// POST /api/portal/aprovacoes-ponto/aprovar
// Authorization: Bearer <access_token>
// Body: { id }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  // aprovarSolicitacaoAction confia no campo aprovadorNome tal como recebido
  // (não resolve identidade sozinha) — quem garante que não vem manipulado
  // pelo cliente é esta rota, resolvendo o nome aqui a partir do token.
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  let body: { id: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const resultado = await aprovarSolicitacaoAction({ id: body.id, aprovadorNome: perfil.nome }, accessToken);
  if (!resultado.ok) return NextResponse.json(resultado, { status: 400 });
  return NextResponse.json({ ok: true });
}
