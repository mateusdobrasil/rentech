import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/notificacoes/marcar-lida
// Authorization: Bearer <access_token>
// Body: { id: string } ou { todas: true }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const db = supabaseAdmin();
  const { data: userData, error } = await db.auth.getUser(accessToken);
  if (error || !userData?.user) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  let body: { id?: string; todas?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  let query = db.from('folha_mobile_notificacoes').update({ lida: true }).eq('auth_user_id', userData.user.id);
  if (!body.todas) {
    if (!body.id) return NextResponse.json({ ok: false, erro: 'Informe id ou todas.' }, { status: 400 });
    query = query.eq('id', body.id);
  }

  const { error: updateError } = await query;
  if (updateError) return NextResponse.json({ ok: false, erro: updateError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
