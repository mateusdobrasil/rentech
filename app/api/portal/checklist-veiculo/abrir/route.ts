import { NextResponse } from 'next/server';
import { resolverMotorista } from '../../../../portal/lib/resolverMotorista';
import { abrirChecklistCore, type ItemMarcado, type GpsCaptura } from '../../../../portal/lib/checklistVeiculo';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/checklist-veiculo/abrir
// Authorization: Bearer <access_token>
// Body: { veiculoId, kmInicial, combustivelSaida, destino, itens, gps?, observacoesSaida? }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const motorista = await resolverMotorista(accessToken);
  if (!motorista) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para dirigir veículos da frota.' }, { status: 401 });
  }

  let body: {
    veiculoId: string;
    kmInicial: number;
    combustivelSaida: string;
    destino: string;
    itens: ItemMarcado[];
    gps?: GpsCaptura;
    observacoesSaida?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    const info = await abrirChecklistCore(db, {
      motoristaNome: motorista.motoristaNome,
      empresaId: motorista.empresaId,
      origem: 'APP',
      ...body,
    });
    return NextResponse.json({ ok: true, info });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao abrir o checklist.';
    console.error('[checklist-veiculo/abrir]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
