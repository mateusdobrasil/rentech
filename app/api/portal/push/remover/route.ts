import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/push/remover
// Authorization: Bearer <access_token>
// Body: { token: string }
//
// Só remove o token se ele pertencer ao próprio usuário do access_token —
// nunca confia em qualquer id vindo do corpo da requisição.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const db = supabaseAdmin();
  const { data: userData, error } = await db.auth.getUser(accessToken);
  if (error || !userData?.user) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  if (!body.token) {
    return NextResponse.json({ ok: false, erro: 'Token de push é obrigatório.' }, { status: 400 });
  }

  const { error: deleteError } = await db
    .from('folha_mobile_push_tokens')
    .delete()
    .eq('expo_push_token', body.token)
    .eq('auth_user_id', userData.user.id);

  if (deleteError) return NextResponse.json({ ok: false, erro: deleteError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
