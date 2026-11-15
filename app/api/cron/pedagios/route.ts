import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { atualizarPedagios } from '../../../lib/multasCore';
import { notificarPush } from '../../../lib/push';

// Pedágios Free Flow (SENATRAN) — consulta automática da frota inteira pelo
// CNPJ do certificado A1. Agenda (vercel.json): segunda e quinta, 13h UTC
// (10h em Brasília). Liga/desliga: card "consulta-pedagios-free-flow".
// O aviso diário de prazo é outra automação (fonte PEDAGIOS_A_PAGAR no motor),
// que lê da tabela sem custo de consulta.
export const maxDuration = 300;

const CHAVE_CARD_CONTROLE = 'consulta-pedagios-free-flow';

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data: card } = await db.from('parametros_automacoes').select('ativo').eq('chave', CHAVE_CARD_CONTROLE).maybeSingle();
  if (!card || card.ativo === false) return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada em Agendamentos e Disparos.' });

  const r = await atualizarPedagios(db, 'CONSULTA AUTOMÁTICA');
  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_CONTROLE);
  if (!r.ok) {
    try { await notificarPush('/admin/operacional/multas', 'Consulta de pedágios falhou', r.erro || 'Erro na consulta de pedágios Free Flow.'); } catch { /* push nunca derruba o cron */ }
    return NextResponse.json({ success: false, erro: r.erro });
  }
  if (r.novos > 0) {
    try {
      await notificarPush('/admin/operacional/multas', 'Pedágios Free Flow a pagar', `${r.novos} passagem(ns) nova(s) em pórtico Free Flow. Pague no prazo para não virar multa de evasão.`);
    } catch (e) { console.error('Push de pedágios falhou:', e); }
  }
  return NextResponse.json({ success: true, ...r });
}
