import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';

// GET /api/portal/notificacoes?filtro=nao-lidas
// Authorization: Bearer <access_token>
// Lista as 50 notificações mais recentes do próprio usuário (inbox da tela
// "Ver notificações" no Perfil).
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const { searchParams } = new URL(request.url);
  const soNaoLidas = searchParams.get('filtro') === 'nao-lidas';

  const db = supabaseAdmin();
  const { data: userData, error } = await db.auth.getUser(accessToken);
  if (error || !userData?.user) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  let query = db
    .from('folha_mobile_notificacoes')
    .select('id, titulo, corpo, dados, lida, criado_em')
    .eq('auth_user_id', userData.user.id)
    .order('criado_em', { ascending: false })
    .limit(50);
  if (soNaoLidas) query = query.eq('lida', false);

  const { data, error: listError } = await query;
  if (listError) return NextResponse.json({ ok: false, erro: listError.message }, { status: 500 });
  return NextResponse.json({ ok: true, info: data || [] });
}
