// Lembrete semanal de aniversariantes para o RH, usado pelo motor de Cron
// para alimentar a automação 'aniversariantes-da-semana' (tela Agendamentos
// e Disparos) com a lista de quem faz aniversário na semana corrente.
import { supabaseAdmin } from './supabase';

interface ContextoAniversariantesSemana {
  quantidade: number;
  lista: string;
}

function hojeNoBrasil(): Date {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  agora.setHours(0, 0, 0, 0);
  return agora;
}

// As 7 datas (Seg a Dom) da semana que contém `hoje` — não depende de a
// automação rodar exatamente na segunda-feira.
function diasDaSemana(hoje: Date): Date[] {
  const diaSemana = hoje.getDay(); // 0=Dom..6=Sáb
  const segunda = new Date(hoje);
  segunda.setDate(hoje.getDate() + (diaSemana === 0 ? -6 : 1 - diaSemana));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(segunda);
    d.setDate(segunda.getDate() + i);
    return d;
  });
}

// Chave só de mês/dia (ignora o ano), pra comparar a data de nascimento com
// os dias reais da semana — isso resolve de graça o caso de a semana cruzar
// virada de mês ou de ano (ex: semana de 29/dez a 04/jan).
const mesDia = (d: Date) => `${d.getMonth()}-${d.getDate()}`;
const fmtData = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// Retorna null se ninguém da equipe ativa faz aniversário na semana (Seg a
// Dom) que contém hoje — nesse caso o motor não deve disparar mensagem nenhuma.
export async function montarContextoAniversariantesSemana(): Promise<ContextoAniversariantesSemana | null> {
  const db = supabaseAdmin();
  const { data: funcionarios } = await db
    .from('folha_funcionarios')
    .select('nome_completo, data_nascimento')
    .eq('ativo', true)
    .not('data_nascimento', 'is', null);

  const semanaPorMesDia = new Map(diasDaSemana(hojeNoBrasil()).map(d => [mesDia(d), d]));

  const linhas = ((funcionarios || []) as { nome_completo: string; data_nascimento: string }[])
    .map(f => {
      const nascimento = new Date(`${f.data_nascimento}T00:00:00`);
      const diaNaSemana = semanaPorMesDia.get(mesDia(nascimento));
      return diaNaSemana ? { nome: f.nome_completo, data: diaNaSemana } : null;
    })
    .filter((x): x is { nome: string; data: Date } => x !== null)
    .sort((a, b) => a.data.getTime() - b.data.getTime())
    .map(x => `🎂 *${x.nome}* — ${fmtData(x.data)}`);

  if (linhas.length === 0) return null;
  return { quantidade: linhas.length, lista: linhas.join('\n') };
}
