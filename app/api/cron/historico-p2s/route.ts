// app/api/cron/historico-p2s/route.ts
// Carga do histórico completo do P2S, de madrugada (vercel.json), retomável.
// Lógica em app/lib/historicoP2s.ts; acompanhamento em Parâmetros → Histórico do P2S.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { avancarHistoricoP2s } from '../../../lib/historicoP2s';
import { p2sDesligado } from '../../../lib/virada/estado';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  if (await p2sDesligado(supabaseAdmin())) return NextResponse.json({ ok: true, executado: false, motivo: 'P2S desligado (virada concluída).' });
  try {
    // não começa mês novo depois de 3,5 min (um mês pesado ainda cabe nos 5 min)
    const r = await avancarHistoricoP2s(supabaseAdmin(), 210_000);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e.message }, { status: 200 });
  }
}
