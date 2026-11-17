import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { gerarRelatorioDiario, CHAVE_CARD_DIRETORIA } from '../../../lib/diretoria/relatorioDiario';
import { hojeISO, somarDias } from '../../../lib/diretoria/indicadoresDiarios';
import { notificarPush } from '../../../lib/push';

// Relatório Diário do Diretor (IA) — um por empresa ativa. Agenda
// (vercel.json): todo dia 13h UTC = 10h em Brasília, meia hora depois da
// rodada extra do sync com o P2S (12h30 UTC). Liga/desliga e destinatários
// do e-mail: card "diretoria-relatorio-diario" em Agendamentos e Disparos.
// As empresas rodam em paralelo — cada relatório leva ~1–2 min na IA.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data: card } = await db.from('parametros_automacoes').select('ativo').eq('chave', CHAVE_CARD_DIRETORIA).maybeSingle();
  if (!card || card.ativo === false) return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada (ou card ainda não criado) em Agendamentos e Disparos.' });

  const D = somarDias(hojeISO(), -1);
  const { data: empresas } = await db.from('empresas').select('*').eq('ativo', true).order('id');

  // Retentativa da Vercel no mesmo dia não gera nem manda de novo.
  const { data: jaFeitos } = await db.from('diretoria_relatorios').select('empresa_id')
    .eq('tipo', 'DIARIO').eq('data_referencia', D).eq('status', 'GERADO').eq('gerado_por', 'CRON');
  const feitos = new Set(((jaFeitos || []) as { empresa_id: number }[]).map(r => r.empresa_id));

  const pendentes = ((empresas || []) as { id: number; nome: string; nome_curto?: string | null }[]).filter(e => !feitos.has(e.id));
  const resultados = await Promise.all(pendentes.map(async e => {
    const empresa = { id: e.id, nome: (e.nome_curto || e.nome).trim() };
    try {
      return { empresa: empresa.nome, ...(await gerarRelatorioDiario(db, empresa, { dataReferencia: D, geradoPor: 'CRON', enviarEmail: true })) };
    } catch (err: any) {
      return { empresa: empresa.nome, ok: false, erro: err?.message || String(err) };
    }
  }));

  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_DIRETORIA);

  const falhas = resultados.filter(r => !r.ok);
  if (falhas.length) {
    try {
      await notificarPush('/admin/diretoria', 'Relatório do Diretor falhou', falhas.map(f => `${f.empresa}: ${f.erro}`).join(' | ').slice(0, 300));
    } catch { /* push nunca derruba o cron */ }
  }
  return NextResponse.json({ success: falhas.length === 0, data_referencia: D, resultados, ja_gerados: [...feitos] });
}
