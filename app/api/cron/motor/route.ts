import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { dispararAutomacaoWhatsApp } from '../../../lib/automacoes';
import { notificarPush } from '../../../lib/push';
import { montarContextoFrotaVencida } from '../../../lib/frota';
import { montarContextoDocumentosVencidos } from '../../../lib/documentos';
import { montarContextoAniversariantesSemana } from '../../../lib/aniversarios';

// Automações cujo disparo depende de um contexto calculado em código (ex: uma
// lista dinâmica), em vez de só {{primeiro_nome}}/{{nome_completo}}. Casadas
// por `fonte_dados` — um catálogo fixo, escolhido por dropdown na tela de
// Agendamentos e Disparos — em vez de pela `chave` (que é só um slug gerado
// do nome digitado na criação, e não deveria carregar significado funcional).
// Se a função devolver null, o motor pula essa automação sem disparar nada.
//
// `empresaId` é a empresa escolhida no card da automação (null = todas). Toda
// fonte precisa respeitá-la, senão o conteúdo enviado mistura empresas mesmo
// com o card preso a uma.
const FONTES_DADOS: Record<string, (empresaId: number | null) => Promise<Record<string, string | number> | null>> = {
  FROTA_VENCIMENTOS: async (empresaId) => {
    const resultado = await montarContextoFrotaVencida(empresaId);
    if (!resultado) return null;
    return { lista: resultado.lista, quantidade: resultado.quantidade };
  },
  DOCUMENTOS_VENCIDOS: async (empresaId) => {
    const resultado = await montarContextoDocumentosVencidos(empresaId);
    if (!resultado) return null;
    return { lista: resultado.lista, quantidade: resultado.quantidade };
  },
  ANIVERSARIANTES_SEMANA: async (empresaId) => {
    const resultado = await montarContextoAniversariantesSemana(empresaId);
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
      .from('parametros_automacoes')
      .select('chave, nome, horario, dias_semana, ultima_execucao, fonte_dados, empresa_id')
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
      const montarContexto = automacao.fonte_dados ? FONTES_DADOS[automacao.fonte_dados] : null;
      if (montarContexto) {
        const contextoEspecial = await montarContexto(automacao.empresa_id ?? null);
        if (!contextoEspecial) continue; // nada a reportar hoje, não dispara
        contexto = contextoEspecial;
      }

      // Push espelha qualquer automação que use a fonte de dados de frota
      // (README do app mobile) — canal a mais pra quem tem a aba Frota no
      // app, não substitui o WhatsApp configurado na automação. Nunca
      // derruba o disparo principal.
      if (automacao.fonte_dados === 'FROTA_VENCIMENTOS') {
        try {
          await notificarPush('/mobile/frota', 'Veículos com pendência de vencimento', `${contexto.quantidade} veículo(s) com CRLV ou seguro vencido.`, { tipo: 'frota' });
        } catch (e) {
          console.error('Falha ao notificar push sobre frota-vencimentos:', e);
        }
      }

      // O log de auditoria deste disparo agora é gravado dentro de
      // executarDisparoWhatsApp (app/lib/automacoes.ts) — cobre também o
      // disparo por evento (Nova OP, Folga, Consignado), que antes não
      // tinha log nenhum. Gravar aqui de novo duplicaria a mesma execução.
      const resultado = await dispararAutomacaoWhatsApp(automacao.chave, contexto);
      if (resultado.disparado) {
        executadas.push({ chave: automacao.chave, disparos: resultado.disparos, erros: resultado.erros });
      }
    }

    return NextResponse.json({ success: true, horario_verificado: horarioAtual, dia_semana: diaSemanaAtual, executadas });
  } catch (error: any) {
    console.error('Erro na execução do motor de Cron:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
