import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { familiaAtiva } from '../../../lib/diretoria/envioDiretoria';
import { processarAlertas, CHAVE_CARD_ALERTAS } from '../../../lib/diretoria/alertas';

// Alertas do Diretor — detecta e manda AGRUPADO por empresa. Agenda
// (vercel.json): 15h e 21h UTC = 12h e 18h em Brasília, uma hora depois dos
// syncs com o P2S das 11h e 17h. Liga/desliga e destinatários: card
// "diretoria-alertas" em Agendamentos e Disparos.
export const maxDuration = 120;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  // Original ou cópia (um card por empresa) — basta um ligado
  if (!(await familiaAtiva(db, CHAVE_CARD_ALERTAS))) return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada (ou card ainda não criado) em Agendamentos e Disparos.' });

  const { data: empresas } = await db.from('empresas').select('*').eq('ativo', true).order('id');
  const resultados = [];
  // Sequencial: um e-mail por empresa, sem rajada no SMTP.
  for (const e of (empresas || []) as { id: number; nome: string; nome_curto?: string | null }[]) {
    try {
      resultados.push(await processarAlertas(db, { id: e.id, nome: (e.nome_curto || e.nome).trim() }, { enviarEmail: true }));
    } catch (err: any) {
      resultados.push({ empresa: e.nome, erro: err?.message || String(err) });
    }
  }
  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_ALERTAS);
  return NextResponse.json({ success: true, resultados });
}
