import { NextResponse } from 'next/server';
import { resolverFuncionarioPortal } from '../../../portal/actions/actions-acesso';
import { montarEspelhoDoMes } from '../../../portal/lib/espelhoPonto';
import { supabaseAdmin } from '../../../lib/supabase';

// GET /api/portal/espelho-ponto?mes=YYYY-MM
// Authorization: Bearer <access_token>
//
// Equivalente do buscarMeuEspelhoPontoAction (app/portal/actions/actions-ponto.ts),
// mas como endpoint HTTP simples em vez de Server Action — o protocolo de
// Server Actions do Next (RSC over POST) não é feito para ser chamado de fora
// do próprio app web, então o app mobile (React Native) precisa desta rota.
// Mesma validação server-side via service role que o Portal web já usa —
// não abre RLS nova em folha_ponto_diaria/folha_ponto_abono/folha_feriados.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mes = searchParams.get('mes') || '';
  const authHeader = request.headers.get('authorization') || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');

  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ ok: false, erro: 'Parâmetro "mes" inválido, use YYYY-MM.' }, { status: 400 });
  }

  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) {
    return NextResponse.json({ ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' }, { status: 401 });
  }

  try {
    const db = supabaseAdmin();
    const espelho = await montarEspelhoDoMes(db, func.funcionarioNome, mes);
    return NextResponse.json({ ok: true, info: espelho });
  } catch (e) {
    const erro = e instanceof Error ? e.message : 'Erro ao montar o espelho de ponto.';
    return NextResponse.json({ ok: false, erro }, { status: 500 });
  }
}
