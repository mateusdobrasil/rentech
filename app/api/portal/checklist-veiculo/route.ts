import { NextResponse } from 'next/server';
import { resolverMotorista } from '../../../portal/lib/resolverMotorista';
import { carregarChecklistVeiculoCore } from '../../../portal/lib/checklistVeiculo';
import { supabaseAdmin } from '../../../lib/supabase';

// GET /api/portal/checklist-veiculo
// Authorization: Bearer <access_token>
//
// Carga combinada pra tela "Frota" do app mobile: veículos disponíveis,
// checklist em andamento (se houver, com as avarias já registradas) e o
// modelo de itens da etapa certa. Aceita conta de equipe (OPERACIONAL) ou de
// colaborador via Portal — ver resolverMotorista.ts.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const motorista = await resolverMotorista(accessToken);
  if (!motorista) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para dirigir veículos da frota.' }, { status: 401 });
  }

  try {
    const db = supabaseAdmin();
    const info = await carregarChecklistVeiculoCore(db, motorista.motoristaNome);
    return NextResponse.json({ ok: true, info });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao carregar o checklist de veículo.';
    console.error('[checklist-veiculo/GET]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
