import { NextResponse } from 'next/server';
import { resolverMotorista } from '../../../../portal/lib/resolverMotorista';
import { finalizarChecklistCore, type ItemMarcado, type GpsCaptura } from '../../../../portal/lib/checklistVeiculo';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/checklist-veiculo/finalizar
// Authorization: Bearer <access_token>
// Body: { checklistId, kmFinal, combustivelRetorno, itens, gps?, observacoesRetorno? }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const motorista = await resolverMotorista(accessToken);
  if (!motorista) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para dirigir veículos da frota.' }, { status: 401 });
  }

  let body: {
    checklistId: string;
    kmFinal: number;
    combustivelRetorno: string;
    itens: ItemMarcado[];
    gps?: GpsCaptura;
    observacoesRetorno?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    await finalizarChecklistCore(db, { motoristaNome: motorista.motoristaNome, ...body });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao finalizar o checklist.';
    console.error('[checklist-veiculo/finalizar]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
