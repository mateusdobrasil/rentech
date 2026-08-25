import { NextResponse } from 'next/server';
import { obterPerfilValidado } from '../../../../lib/serverAuth';
import { rejeitarSolicitacaoAction } from '../../../../admin/rh/actions/actions-ponto-whatsapp';

// POST /api/portal/aprovacoes-ponto/rejeitar
// Authorization: Bearer <access_token>
// Body: { id, motivoRejeicao }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  let body: { id: number; motivoRejeicao: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  if (!body.motivoRejeicao?.trim()) {
    return NextResponse.json({ ok: false, erro: 'Informe o motivo da rejeição.' }, { status: 400 });
  }

  const resultado = await rejeitarSolicitacaoAction({ id: body.id, aprovadorNome: perfil.nome, motivoRejeicao: body.motivoRejeicao }, accessToken);
  if (!resultado.ok) return NextResponse.json(resultado, { status: 400 });
  return NextResponse.json({ ok: true });
}
