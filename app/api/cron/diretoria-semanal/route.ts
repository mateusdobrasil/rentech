import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { familiaAtiva } from '../../../lib/diretoria/envioDiretoria';
import { gerarRelatorioSemanal, CHAVE_CARD_SEMANAL } from '../../../lib/diretoria/relatorioSemanal';
import { semanaFechada } from '../../../lib/diretoria/indicadoresSemanais';
import { notificarPush } from '../../../lib/push';

// Relatório Semanal do Diretor (IA) — um por empresa ativa. Agenda
// (vercel.json): segunda 11h UTC = 8h em Brasília. Liga/desliga e
// destinatários: card "diretoria-relatorio-semanal" em Agendamentos e Disparos.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  // Original ou cópia (um card por empresa) — basta um ligado
  if (!(await familiaAtiva(db, CHAVE_CARD_SEMANAL))) return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada (ou card ainda não criado) em Agendamentos e Disparos.' });

  const { inicio } = semanaFechada();
  const { data: empresas } = await db.from('empresas').select('*').eq('ativo', true).order('id');
  const { data: jaFeitos } = await db.from('diretoria_relatorios').select('empresa_id')
    .eq('tipo', 'SEMANAL').eq('data_referencia', inicio).eq('status', 'GERADO').eq('gerado_por', 'CRON');
  const feitos = new Set(((jaFeitos || []) as { empresa_id: number }[]).map(r => r.empresa_id));

  const pendentes = ((empresas || []) as { id: number; nome: string; nome_curto?: string | null }[]).filter(e => !feitos.has(e.id));
  const resultados = await Promise.all(pendentes.map(async e => {
    const empresa = { id: e.id, nome: (e.nome_curto || e.nome).trim() };
    try {
      return { empresa: empresa.nome, ...(await gerarRelatorioSemanal(db, empresa, { geradoPor: 'CRON', enviarEmail: true })) };
    } catch (err: any) {
      return { empresa: empresa.nome, ok: false, erro: err?.message || String(err) };
    }
  }));

  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_SEMANAL);
  const falhas = resultados.filter(r => !r.ok);
  if (falhas.length) {
    try { await notificarPush('/admin/diretoria', 'Relatório semanal do Diretor falhou', falhas.map(f => `${f.empresa}: ${f.erro}`).join(' | ').slice(0, 300)); } catch { /* push nunca derruba o cron */ }
  }
  return NextResponse.json({ success: falhas.length === 0, semana: inicio, resultados, ja_gerados: [...feitos] });
}
