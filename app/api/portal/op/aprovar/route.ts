import { NextResponse } from 'next/server';
import { atualizarStatus } from '../../../../admin/op/actions';

// POST /api/portal/op/aprovar
// Authorization: Bearer <access_token>
// Body: { opId }
//
// "Aprovar pagamento" no app é literalmente a mesma transição PENDENTE→PAGO
// que o Financeiro já faz manualmente hoje (atualizarStatus, exclusivo de
// /admin/financeiro/ops) — decisão do usuário: não existe status "Aprovada"
// separado, e assinatura/e-mail continuam 100% manuais no /admin.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  let body: { opId: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  if (!body.opId) {
    return NextResponse.json({ ok: false, erro: 'OP não informada.' }, { status: 400 });
  }

  const resultado = await atualizarStatus(body.opId, 'PAGO', accessToken);
  if (!resultado.success) return NextResponse.json({ ok: false, erro: resultado.message }, { status: 401 });
  return NextResponse.json({ ok: true });
}
