import { NextResponse } from 'next/server';
import { resolverStaffMobile } from '../../../../portal/lib/resolverStaffMobile';
import { supabaseAdmin } from '../../../../lib/supabase';

// GET /api/portal/checklist-carga/empresas
// Authorization: Bearer <access_token>
// Lista de empresas pro seletor da tela "novo checklist" — já filtrada pelas
// empresasPermitidas do usuário (trava sozinho em 1 opção quando só tem
// acesso a uma), mesma fonte de verdade que abrir/route.ts revalida no envio.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const staff = await resolverStaffMobile(accessToken, '/mobile/carga');
  if (!staff) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para acessar checklists de carga.' }, { status: 401 });
  }

  const db = supabaseAdmin();
  let query = db.from('empresas').select('id, nome').eq('ativo', true).order('nome');
  if (staff.empresasPermitidas) query = query.in('id', staff.empresasPermitidas.length ? staff.empresasPermitidas : [-1]);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, info: data || [] });
}
