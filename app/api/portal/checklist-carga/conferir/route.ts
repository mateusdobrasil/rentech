import { NextResponse } from 'next/server';
import { resolverStaffMobile } from '../../../../portal/lib/resolverStaffMobile';
import { salvarConferenciaCore, type EtapaCarga } from '../../../../portal/lib/checklistCarga';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/checklist-carga/conferir
// Authorization: Bearer <access_token>
// Body: { checklistId, tipo: 'SAIDA'|'RETORNO', itens: [{ id, ok, qtd }] }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const staff = await resolverStaffMobile(accessToken, '/mobile/carga');
  if (!staff) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para acessar checklists de carga.' }, { status: 401 });
  }

  let body: {
    checklistId: string;
    tipo: EtapaCarga;
    itens: { id: string; ok: boolean; qtd: number | null }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    await salvarConferenciaCore(db, {
      checklistId: body.checklistId,
      tipo: body.tipo,
      usuarioNome: staff.nome,
      itens: body.itens || [],
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao salvar a conferência.';
    console.error('[checklist-carga/conferir]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
