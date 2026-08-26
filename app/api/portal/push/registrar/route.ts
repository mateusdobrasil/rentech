import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/push/registrar
// Authorization: Bearer <access_token>
// Body: { token: string; plataforma: 'ios' | 'android'; tipoConta: 'STAFF' | 'PORTAL' }
//
// Qualquer conta autenticada pode registrar o próprio token — não precisa
// resolverStaffMobile/possuiAcessoRota, é sempre sobre o próprio usuário
// (auth_user_id vem do access_token, nunca do corpo da requisição).
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const db = supabaseAdmin();
  const { data: userData, error } = await db.auth.getUser(accessToken);
  if (error || !userData?.user) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  let body: { token?: string; plataforma?: string; tipoConta?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }
  if (!body.token) {
    return NextResponse.json({ ok: false, erro: 'Token de push é obrigatório.' }, { status: 400 });
  }

  const { error: upsertError } = await db.from('folha_mobile_push_tokens').upsert({
    auth_user_id: userData.user.id,
    tipo_conta: body.tipoConta || 'STAFF',
    expo_push_token: body.token,
    plataforma: body.plataforma || null,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'expo_push_token' });

  if (upsertError) return NextResponse.json({ ok: false, erro: upsertError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
