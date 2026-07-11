import { NextResponse } from 'next/server';
import { dispararAutomacaoWhatsApp } from '../../../lib/automacoes';
import { supabaseAdmin } from '../../../lib/supabase';

// Lembrete de saída: avisa a equipe às 19h para não esquecer de bater o
// ponto de fim de turno. Respeita o disjuntor e os destinatários
// configurados na automação 'lembrete-ponto2' (tela Agendamentos e Disparos).
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }

  try {
    const resultado = await dispararAutomacaoWhatsApp('lembrete-ponto2', (func) => {
      const primeiroNome = func.nome_completo.split(' ')[0];
      return `Olá, *${primeiroNome}*! 🌙\n\nEste é o lembrete de encerramento de turno do RH da Rentech.\nNão se esqueça de registrar a saída no nosso portal antes de ir embora.\n\nAté amanhã! 👋`;
    });

    if (!resultado.disparado) {
      return NextResponse.json({ success: true, skipped: true, message: 'Automação desativada em Agendamentos e Disparos. Nenhuma mensagem enviada.' });
    }

    await supabaseAdmin().from('logs_auditoria').insert([{
      usuario_nome: 'SISTEMA (CRON)',
      acao: 'DISPARO DE LEMBRETE DE SAÍDA',
      setor: 'OP',
      equipamento_nome: `Enviado para ${resultado.disparos} técnicos. Falhas: ${resultado.erros.length}`
    }]);

    return NextResponse.json({
      success: true,
      message: 'Rotina executada com sucesso.',
      disparos: resultado.disparos,
      erros: resultado.erros
    });
  } catch (error: any) {
    console.error('Erro na execução do Cron:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
