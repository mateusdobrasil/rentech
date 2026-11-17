import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { gerarRelatorioPeriodo, CHAVE_CARD_MENSAL, CHAVE_CARD_ANUAL } from '../../../lib/diretoria/relatorioPeriodo';
import { hojeISO } from '../../../lib/diretoria/indicadoresDiarios';
import { mesFechado } from '../../../lib/diretoria/indicadoresPeriodo';
import { notificarPush } from '../../../lib/push';

// Relatórios Mensal e Anual do Diretor (IA) — Fase 4. Agenda (vercel.json):
// dia 1 de cada mês, 11h UTC = 8h em Brasília. Fecha o mês anterior de cada
// empresa ativa e, em 1º de janeiro, também o ano anterior. Liga/desliga e
// destinatários: cards "diretoria-relatorio-mensal" e "diretoria-relatorio-anual".
export const maxDuration = 300;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  const hoje = hojeISO();
  const { data: cards } = await db.from('parametros_automacoes').select('chave, ativo').in('chave', [CHAVE_CARD_MENSAL, CHAVE_CARD_ANUAL]);
  const ligado = (chave: string) => ((cards || []) as { chave: string; ativo: boolean }[]).some(c => c.chave === chave && c.ativo !== false);
  const tipos: ('MENSAL' | 'ANUAL')[] = [];
  if (ligado(CHAVE_CARD_MENSAL)) tipos.push('MENSAL');
  if (hoje.slice(5) === '01-01' && ligado(CHAVE_CARD_ANUAL)) tipos.push('ANUAL');
  if (!tipos.length) return NextResponse.json({ success: true, executado: false, motivo: 'Nada a gerar hoje (cards desligados ou não é 1º de janeiro para o anual).' });

  const { ano, mes } = mesFechado(hoje);
  const referencia = { MENSAL: `${ano}-${String(mes).padStart(2, '0')}-01`, ANUAL: `${Number(hoje.slice(0, 4)) - 1}-01-01` };
  const { data: empresas } = await db.from('empresas').select('*').eq('ativo', true).order('id');
  const { data: jaFeitos } = await db.from('diretoria_relatorios').select('empresa_id, tipo, data_referencia')
    .in('tipo', tipos).in('data_referencia', tipos.map(t => referencia[t])).eq('status', 'GERADO').eq('gerado_por', 'CRON');
  const feito = (empresaId: number, tipo: 'MENSAL' | 'ANUAL') => ((jaFeitos || []) as any[]).some(r => r.empresa_id === empresaId && r.tipo === tipo && r.data_referencia === referencia[tipo]);

  const tarefas = ((empresas || []) as { id: number; nome: string; nome_curto?: string | null }[])
    .flatMap(e => tipos.filter(t => !feito(e.id, t)).map(t => ({ empresa: { id: e.id, nome: (e.nome_curto || e.nome).trim() }, tipo: t })));
  const resultados = await Promise.all(tarefas.map(async ({ empresa, tipo }) => {
    try {
      return { empresa: empresa.nome, tipo, ...(await gerarRelatorioPeriodo(db, empresa, tipo, { hoje, geradoPor: 'CRON', enviarEmail: true })) };
    } catch (err: any) {
      return { empresa: empresa.nome, tipo, ok: false, erro: err?.message || String(err) };
    }
  }));

  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).in('chave', tipos.map(t => (t === 'MENSAL' ? CHAVE_CARD_MENSAL : CHAVE_CARD_ANUAL)));
  const falhas = resultados.filter(r => !r.ok);
  if (falhas.length) {
    try { await notificarPush('/admin/diretoria', 'Relatório mensal/anual do Diretor falhou', falhas.map(f => `${f.empresa} (${f.tipo}): ${f.erro}`).join(' | ').slice(0, 300)); } catch { /* push nunca derruba o cron */ }
  }
  return NextResponse.json({ success: falhas.length === 0, hoje, resultados });
}
