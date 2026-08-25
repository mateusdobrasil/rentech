import { NextResponse } from 'next/server';
import { resolverStaffMobile } from '../../../../portal/lib/resolverStaffMobile';
import { abrirChecklistCargaCore } from '../../../../portal/lib/checklistCarga';
import { supabaseAdmin } from '../../../../lib/supabase';
import { empresaPermitida } from '../../../../lib/serverAuth';

// POST /api/portal/checklist-carga/abrir
// Authorization: Bearer <access_token>
// Body: { empresaId, eventoFeira, cliente, local, periodoInicio?, periodoFim? }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const staff = await resolverStaffMobile(accessToken, '/mobile/carga');
  if (!staff) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para acessar checklists de carga.' }, { status: 401 });
  }

  let body: {
    empresaId: number;
    eventoFeira: string;
    cliente: string;
    local: string;
    periodoInicio?: string | null;
    periodoFim?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  if (!body.empresaId) {
    return NextResponse.json({ ok: false, erro: 'Selecione a empresa.' }, { status: 400 });
  }
  // Nunca confia na empresa que o cliente mandou — revalida contra o que o
  // usuário realmente pode enxergar (mesma defesa que criarOP já faz).
  if (!empresaPermitida(staff.empresasPermitidas, body.empresaId)) {
    return NextResponse.json({ ok: false, erro: 'Você não tem permissão para criar um checklist para esta empresa.' }, { status: 403 });
  }

  try {
    const db = supabaseAdmin();
    const info = await abrirChecklistCargaCore(db, {
      criadoPor: staff.nome,
      empresaId: body.empresaId,
      eventoFeira: body.eventoFeira,
      cliente: body.cliente,
      local: body.local,
      periodoInicio: body.periodoInicio || null,
      periodoFim: body.periodoFim || null,
    });
    return NextResponse.json({ ok: true, info });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao criar o checklist de carga.';
    console.error('[checklist-carga/abrir]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
