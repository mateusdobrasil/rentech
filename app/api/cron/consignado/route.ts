import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { listarConsignadosAction } from '../../../admin/rh/actions/actions-consignado';

// Chave do card "Consulta Mensal Consignado" em /admin/agendamentos — criado
// pelo usuário com esse nome exato, gerando essa chave via slugify. Esse card
// não dispara mensagem nenhuma (canais/destinatarios/mensagem são ignorados
// aqui): serve só de liga/desliga visível na tela, lido pelo `ativo` abaixo.
// A notificação de "novo empréstimo" (WhatsApp + e-mail) é outro card
// ('novo-emprestimo-consignado'), disparado de dentro de
// listarConsignadosAction -> persistirConsignacoesEDetectarNovos, quando
// aparece consignação nova.
const CHAVE_CARD_CONTROLE = 'consulta-mensal-consignado';

// Brasil não observa mais horário de verão desde 2019 — America/Sao_Paulo é
// sempre UTC-3 fixo (mesmo cálculo usado em app/api/cron/motor/route.ts).
function competenciaAtualBR(): string {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

// Rotina diária (ver vercel.json, agendada para as 11h UTC / 8h BR) que chama
// a mesma consulta ao vivo da API do GOV.BR usada pelo botão "Consultar API"
// da tela /admin/financeiro/consignado, para a competência do mês corrente.
// Persiste os resultados e dispara a notificação de novo empréstimo
// automaticamente, exatamente como uma consulta manual faria. Rodar todo dia
// (em vez de só no dia 28) pega consignações que a Dataprev libera pra
// consulta em outros dias do mês, não só no fechamento da competência.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }

  const db = supabaseAdmin();

  try {
    const { data: card } = await db
      .from('folha_automacoes')
      .select('ativo')
      .eq('chave', CHAVE_CARD_CONTROLE)
      .maybeSingle();

    if (!card || card.ativo === false) {
      return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada (ou card ainda não criado) em /admin/agendamentos.' });
    }

    const competencia = competenciaAtualBR();
    const resultado = await listarConsignadosAction(competencia);

    await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_CONTROLE);

    if (!resultado.ok) {
      return NextResponse.json({ success: false, competencia, erro: resultado.erro }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      executado: true,
      competencia,
      novosDetectados: resultado.info.novosDetectados ?? 0,
    });
  } catch (error: any) {
    console.error('Erro na rotina mensal de consignado:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
