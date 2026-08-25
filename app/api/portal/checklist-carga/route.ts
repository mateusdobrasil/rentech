import { NextResponse } from 'next/server';
import { resolverStaffMobile } from '../../../portal/lib/resolverStaffMobile';
import { carregarChecklistsCargaCore } from '../../../portal/lib/checklistCarga';
import { supabaseAdmin } from '../../../lib/supabase';

// GET /api/portal/checklist-carga
// Authorization: Bearer <access_token>
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const staff = await resolverStaffMobile(accessToken, '/mobile/carga');
  if (!staff) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para acessar checklists de carga.' }, { status: 401 });
  }

  try {
    const db = supabaseAdmin();
    const info = await carregarChecklistsCargaCore(db, staff.empresasPermitidas);
    return NextResponse.json({ ok: true, info });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao carregar os checklists de carga.';
    console.error('[checklist-carga/GET]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
