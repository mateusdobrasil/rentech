import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { dispararAutomacaoWhatsApp } from '../../../lib/automacoes';
import { montarContextoFrotaVencida } from '../../../lib/frota';
import { montarContextoDocumentosVencidos } from '../../../lib/documentos';
import { montarContextoAniversariantesSemana } from '../../../lib/aniversarios';

// Automações cujo disparo depende de um contexto calculado em código (ex: uma
// lista dinâmica), em vez de só {{primeiro_nome}}/{{nome_completo}}. Se a
// função devolver null, o motor pula essa automação sem disparar nada.
const CONTEXTOS_ESPECIAIS: Record<string, () => Promise<Record<string, string | number> | null>> = {
  'frota-vencimentos': async () => {
    const resultado = await montarContextoFrotaVencida();
    if (!resultado) return null;
    return { lista: resultado.lista, quantidade: resultado.quantidade };
  },
  'documentos-vencidos': async () => {
    const resultado = await montarContextoDocumentosVencidos();
    if (!resultado) return null;
    return { lista: resultado.lista, quantidade: resultado.quantidade };
  },
  'aniversariantes-da-semana': async () => {
    const resultado = await montarContextoAniversariantesSemana();
    if (!resultado) return null;
    return { lista: resultado.lista, quantidade: resultado.quantidade };
  }
};

// Motor único de agendamentos: roda a cada 5 minutos (ver vercel.json) e
// dispara qualquer automação do tipo CRON cujo horário/dias da semana,
// configurados na tela Agendamentos e Disparos, batam com o momento atual.
// Criar um novo lembrete agendado não exige mais rota nova nem deploy —
// só um card novo com tipo "Agendamento (Cron)".

// Brasil não observa mais horário de verão (abolido em 2019), então
// America/Sao_Paulo é sempre UTC-3 fixo — sem pegadinha de DST aqui.
function agoraNoBrasil(): Date {
  const agora = new Date();
  return new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function mesmaDataBR(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }

  const db = supabaseAdmin();
  const brt = agoraNoBrasil();
  const diaSemanaAtual = brt.getDay(); // 0=Dom..6=Sáb
  const minutosArredondados = Math.floor(brt.getMinutes() / 5) * 5;
  const horarioAtual = `${String(brt.getHours()).padStart(2, '0')}:${String(minutosArredondados).padStart(2, '0')}`;

  try {
    const { data: automacoes, error } = await db
      .from('folha_automacoes')
      .select('chave, nome, horario, dias_semana, ultima_execucao')
      .eq('tipo', 'CRON')
      .eq('ativo', true)
      .eq('horario', horarioAtual);

    if (error) throw error;

    const executadas: { chave: string; disparos: number; erros: string[] }[] = [];

    for (const automacao of automacoes || []) {
      const diasConfigurados: number[] = automacao.dias_semana || [];
      if (!diasConfigurados.includes(diaSemanaAtual)) continue;

      // Evita disparo duplicado se o motor rodar mais de uma vez na mesma janela
      if (automacao.ultima_execucao) {
        const ultima = new Date(new Date(automacao.ultima_execucao).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        if (mesmaDataBR(ultima, brt) && ultima.getHours() === brt.getHours() && Math.floor(ultima.getMinutes() / 5) === Math.floor(brt.getMinutes() / 5)) {
          continue;
        }
      }

      let contexto: Record<string, string | number> = {};
      const montarContexto = CONTEXTOS_ESPECIAIS[automacao.chave];
      if (montarContexto) {
        const contextoEspecial = await montarContexto();
        if (!contextoEspecial) continue; // nada a reportar hoje, não dispara
        contexto = contextoEspecial;
      }

      const resultado = await dispararAutomacaoWhatsApp(automacao.chave, contexto);
      if (resultado.disparado) {
        executadas.push({ chave: automacao.chave, disparos: resultado.disparos, erros: resultado.erros });
        await db.from('logs_auditoria').insert([{
          usuario_nome: 'SISTEMA (CRON)',
          acao: `DISPARO AUTOMÁTICO — ${automacao.nome}`,
          setor: 'OP',
          equipamento_nome: `Enviado para ${resultado.disparos}. Falhas: ${resultado.erros.length}`
        }]);
      }
    }

    return NextResponse.json({ success: true, horario_verificado: horarioAtual, dia_semana: diaSemanaAtual, executadas });
  } catch (error: any) {
    console.error('Erro na execução do motor de Cron:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
