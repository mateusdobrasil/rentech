import { NextResponse } from 'next/server';
import { resolverMotorista } from '../../../../portal/lib/resolverMotorista';
import { registrarAvariaChecklistCore, type Etapa } from '../../../../portal/lib/checklistVeiculo';
import { supabaseAdmin } from '../../../../lib/supabase';

// POST /api/portal/checklist-veiculo/avaria
// Authorization: Bearer <access_token>
// Body: { checklistId, etapa, descricao, arquivoBase64?, nomeArquivo?, tipoMime? }
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  const motorista = await resolverMotorista(accessToken);
  if (!motorista) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou sem permissão para dirigir veículos da frota.' }, { status: 401 });
  }

  let body: {
    checklistId: string;
    etapa: Etapa;
    descricao: string;
    arquivoBase64?: string;
    nomeArquivo?: string;
    tipoMime?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    const info = await registrarAvariaChecklistCore(db, { motoristaNome: motorista.motoristaNome, ...body });
    return NextResponse.json({ ok: true, info });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao registrar a avaria.';
    console.error('[checklist-veiculo/avaria]', erro);
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
