import { NextResponse } from 'next/server';
import { urlAnexoSolicitacaoAction } from '../../../../admin/rh/actions/actions-ponto-whatsapp';

// GET /api/portal/aprovacoes-ponto/anexo?id=123
// Authorization: Bearer <access_token>
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get('id'));

  if (!id) {
    return NextResponse.json({ ok: false, erro: 'Parâmetro "id" inválido.' }, { status: 400 });
  }

  const resultado = await urlAnexoSolicitacaoAction({ id }, accessToken);
  if (!resultado.ok) return NextResponse.json(resultado, { status: 400 });
  return NextResponse.json({ ok: true, info: resultado.info });
}
