// app/lib/diretoria/whatsappDiretoria.ts
// Envio dos avisos do Diretor (relatório diário, semanal, alertas) pelo card
// de Agendamentos e Disparos de cada um. Diferente dos outros cards, lista de
// destinatários VAZIA aqui não manda pra todo mundo — é barrada.
import { supabaseAdmin } from '../supabase';
import { dispararAutomacaoWhatsApp } from '../automacoes';

type DB = ReturnType<typeof supabaseAdmin>;

export interface ResultadoEnvioDiretoria { texto: string; enviados: number }

export async function avisarPeloCard(db: DB, chaveCard: string, hojeISO: string, contexto: Record<string, string | number>): Promise<ResultadoEnvioDiretoria> {
  const nao = (texto: string) => ({ texto, enviados: 0 });
  const { data: card } = await db.from('parametros_automacoes').select('ativo, destinatarios, dias_semana').eq('chave', chaveCard).maybeSingle();
  if (!card || card.ativo === false) return nao('Não enviado: card desligado em Agendamentos e Disparos.');
  if (!((card.destinatarios as string[]) || []).length) return nao('Não enviado: card sem destinatários.');
  const diaSemana = new Date(`${hojeISO}T12:00:00Z`).getUTCDay();
  const dias = (card.dias_semana as number[] | null) || [0, 1, 2, 3, 4, 5, 6];
  if (!dias.includes(diaSemana)) return nao('Não enviado: hoje não está nos dias do card.');

  const r = await dispararAutomacaoWhatsApp(chaveCard, contexto);
  if (!r.disparado) return nao(`Não enviado${r.erros.length ? `: ${r.erros.join('; ')}` : '.'}`);
  const texto = r.disparos === 0 ? `Nenhum envio (${r.erros.join(', ') || 'destinatário sem celular cadastrado'}).`
    : r.erros.length ? `Enviado para ${r.disparos}; falhou: ${r.erros.join(', ')}` : `Enviado para ${r.disparos}.`;
  return { texto, enviados: r.disparos };
}

export const baseUrlSistema = () => process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
