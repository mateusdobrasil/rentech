import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/notificacoes/excluir
// Authorization: Bearer <access_token>
// Body: { id: string }
// Remove uma notificação do inbox (swipe pra descartar no app) — só apaga a
// linha de folha_mobile_notificacoes, não desfaz nada do evento original.
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const db = supabaseAdmin();
  const { data: userData, error } = await db.auth.getUser(accessToken);
  if (error || !userData?.user) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ ok: false, erro: 'Informe id.' }, { status: 400 });

  const { error: deleteError } = await db
    .from('folha_mobile_notificacoes')
    .delete()
    .eq('id', body.id)
    .eq('auth_user_id', userData.user.id);
  if (deleteError) return NextResponse.json({ ok: false, erro: deleteError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
