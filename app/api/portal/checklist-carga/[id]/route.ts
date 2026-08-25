import { NextResponse } from 'next/server';
import { resolverStaffMobile } from '../../../../portal/lib/resolverStaffMobile';
import { carregarChecklistCargaCore } from '../../../../portal/lib/checklistCarga';
import { supabaseAdmin } from '../../../../lib/supabase';

// GET /api/portal/checklist-carga/[id]
// Authorization: Bearer <access_token>
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const staff = await resolverStaffMobile(accessToken, '/mobile/carga');
  if (!staff) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para acessar checklists de carga.' }, { status: 401 });
  }

  try {
    const db = supabaseAdmin();
    const info = await carregarChecklistCargaCore(db, id, staff.empresasPermitidas);
    return NextResponse.json({ ok: true, info });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao carregar o checklist de carga.';
    console.error('[checklist-carga/GET id]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 404 });
  }
}
