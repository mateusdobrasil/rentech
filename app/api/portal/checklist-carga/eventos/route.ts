import { NextResponse } from 'next/server';
import { resolverStaffMobile } from '../../../../portal/lib/resolverStaffMobile';
import { supabaseAdmin } from '../../../../lib/supabase';

// GET /api/portal/checklist-carga/eventos?q=<termo>
// Authorization: Bearer <access_token>
//
// Mesma fonte que o /admin/estoque/expedicao usa pra vincular um checklist a
// um evento real (eventos_feiras, sincronizada do PrimeStart) — nunca texto
// livre digitado às cegas. Isso importa porque "Importar Itens das OS's" no
// desktop casa fichas_reserva.evento_feira com o nome do checklist via
// ilike exato; se o nome digitado no app divergir do nome real do evento,
// a importação das OS's não encontra nada depois. Oferecer a busca aqui evita
// esse descasamento — o campo continua editável em texto livre pra eventos
// que ainda não existem em eventos_feiras.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const staff = await resolverStaffMobile(accessToken, '/mobile/carga');
  if (!staff) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para acessar checklists de carga.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const termo = (searchParams.get('q') || '').trim();

  const db = supabaseAdmin();
  const hojeISO = new Date().toISOString().slice(0, 10);
  let query = db
    .from('eventos_feiras')
    .select('nome, local, data_inicial, data_final')
    .gte('data_inicial', hojeISO)
    .order('data_inicial', { ascending: true, nullsFirst: false })
    .limit(20);
  if (termo.length >= 2) query = query.ilike('nome', `%${termo}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, info: data || [] });
}
