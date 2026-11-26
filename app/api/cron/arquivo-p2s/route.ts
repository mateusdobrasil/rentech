// app/api/cron/arquivo-p2s/route.ts
// Cópia completa do banco do P2S, de madrugada (vercel.json), retomável.
// Lógica em app/lib/arquivoP2s.ts; acompanhamento em Parâmetros → Histórico do P2S.
// NÃO para com o P2S desligado: a última passada é justamente depois da virada
// (só leitura). Sem classe pendente, não chama o P2S.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { avancarArquivoP2s } from '../../../lib/arquivoP2s';

export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  // Plano B (2026-11-25): enquanto .sql/Pendentes/p2s_arquivo.sql não for rodado, não faz nada.
  const { error: semTabela } = await supabaseAdmin().from('p2s_arquivo_classes').select('grupo', { head: true, count: 'exact' });
  if (semTabela) return NextResponse.json({ ok: true, executado: false, motivo: 'Cópia completa do P2S ainda não ativada (rode p2s_arquivo.sql).' });
  try {
    // não começa faixa nova depois de 3,5 min (uma faixa pesada ainda cabe nos 5 min)
    const r = await avancarArquivoP2s(supabaseAdmin(), 210_000);
    const lidos = r.passos.reduce((s, p) => s + p.lidos, 0);
    return NextResponse.json({ ok: true, faixas: r.passos.length, lidos, pendentes: r.pendentes, erros: r.passos.filter(p => p.erro).slice(0, 10) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: e.message }, { status: 200 });
  }
}
