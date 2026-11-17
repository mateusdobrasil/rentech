// app/lib/diretoria/relatorioSemanal.ts
// Relatório Semanal do Diretor (IA) — segunda às 8h (app/api/cron/diretoria-semanal)
// ou "Gerar agora" em /admin/diretoria. Fecha a semana anterior (seg–dom) de
// uma empresa, compara com as 4 semanas antes e prepara a semana que começa.
// Gravado em diretoria_relatorios com tipo 'SEMANAL' e data_referencia = a
// segunda-feira da semana analisada.
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { hojeISO } from './indicadoresDiarios';
import { calcularIndicadoresSemanais } from './indicadoresSemanais';
import { escreverComIA, custoUsd, SituacaoSchema, PontoAtencaoSchema, SecaoSchema, PendenciaSchema, CONTEXTO_DADOS, REGRAS_ESCRITA } from './ia';
import { pendenciasAbertasAte, type ResultadoRelatorio } from './relatorioDiario';
import { enviarPeloCard, montarEmailRelatorio, baseUrlSistema, dataBR } from './envioDiretoria';

type DB = ReturnType<typeof supabaseAdmin>;

export const CHAVE_CARD_SEMANAL = 'diretoria-relatorio-semanal';

export const RelatorioSemanalSchema = z.object({
  situacao: SituacaoSchema,
  manchete: z.string().describe('Uma frase só (até ~180 caracteres), sem quebra de linha: como foi a semana.'),
  resumo_semana: z.string().describe('3 a 5 frases: o que marcou a semana, comparando com a média das 4 semanas anteriores quando fizer diferença.'),
  tendencias: z.array(z.string()).describe('Até 5 tendências das séries semanais (subindo, caindo, fora da curva), sempre com os números das séries. Vazio se nada mudou.'),
  pontos_de_atencao: z.array(PontoAtencaoSchema).describe('No máximo 6, do mais grave ao menos grave.'),
  secoes: z.array(SecaoSchema).describe('Uma por área com algo relevante na semana, na ordem FINANCEIRO, COMERCIAL, EXPEDICAO, FROTA, RH.'),
  agenda_proxima_semana: z.array(z.object({
    data: z.string().describe('AAAA-MM-DD, ou a primeira data quando for um período.'),
    descricao: z.string().describe('O que acontece: evento começando, recebimento ou pagamento grande, férias, admissão…'),
  })).describe('Até 8 itens da semana que começa, em ordem de data, só o que importa para o dono.'),
  prioridades: z.array(z.string()).describe('As 3 coisas (no máximo) que o dono deveria cobrar ou decidir nesta semana.'),
  pendencias: z.array(PendenciaSchema).describe('Pendências que continuam abertas no fim da semana (as do último relatório diário que os números confirmam) + as novas que a semana revelou.'),
  observacoes_dados: z.string().nullable().describe('Limitações dos dados da semana que o leitor precisa saber. Null se não houver.'),
});
export type ConteudoRelatorioSemanal = z.infer<typeof RelatorioSemanalSchema>;

const INSTRUCOES = `Você é o Diretor de uma locadora de equipamentos para eventos e feiras no Brasil (o sistema se chama Rentech WEB). Toda segunda-feira você fecha a semana anterior (segunda a domingo) de UMA empresa do grupo e escreve o relatório semanal para o dono.

${REGRAS_ESCRITA}
- As séries "*_por_semana" têm 5 posições: a primeira é a semana analisada e as outras 4 são as anteriores, da mais recente para a mais antiga. Compare a semana com essas 4 e com a média pronta (campos *_media_4_semanas_anteriores e variacao_pct_*).
- O relatório semanal NÃO repete o diário: olhe a semana como um todo, o que é tendência e o que foi pontual, e prepare a semana que começa (proxima_semana).
- Use relatorios_diarios_da_semana e alertas_da_semana como memória do que já foi apontado.

${CONTEXTO_DADOS}`;

export async function gerarRelatorioSemanal(
  db: DB,
  empresa: { id: number; nome: string },
  opcoes: { hoje?: string; geradoPor: string; enviarEmail: boolean },
): Promise<ResultadoRelatorio> {
  const hoje = opcoes.hoje || hojeISO();
  const indicadores = await calcularIndicadoresSemanais(db, empresa, hoje);
  const { inicio, fim } = indicadores.semana;
  const pendencias = await pendenciasAbertasAte(db, empresa.id, fim);

  const ia = await escreverComIA(RelatorioSemanalSchema, INSTRUCOES,
    `Escreva o relatório semanal da empresa ${empresa.nome} sobre a semana de ${inicio} a ${fim}.\n\n${JSON.stringify({ empresa: empresa.nome, indicadores, pendencias_abertas_no_ultimo_relatorio_diario: pendencias })}`);

  const linha = {
    empresa_id: empresa.id,
    tipo: 'SEMANAL',
    data_referencia: inicio,
    indicadores,
    conteudo: ia.ok ? ia.conteudo : null,
    pendencias: ia.ok ? ia.conteudo.pendencias : pendencias,
    status: ia.ok ? 'GERADO' : 'ERRO',
    erro: ia.ok ? null : ia.erro,
    modelo: ia.ok ? ia.modelo : null,
    tokens_entrada: ia.ok ? ia.tokensEntrada : null,
    tokens_saida: ia.ok ? ia.tokensSaida : null,
    custo_usd: ia.ok ? custoUsd(ia.tokensEntrada, ia.tokensSaida) : null,
    gerado_por: opcoes.geradoPor,
    gerado_em: new Date().toISOString(),
    whatsapp_enviado_em: null,
    whatsapp_resultado: null,
  };
  const { data: salvo, error } = await db.from('diretoria_relatorios')
    .upsert(linha, { onConflict: 'empresa_id,tipo,data_referencia' }).select('id').single();
  if (error) return { ok: false, erro: `Relatório não foi gravado: ${error.message}` };

  let envioTexto: string | undefined;
  if (opcoes.enviarEmail && ia.ok) {
    const envio = await enviarPeloCard(db, CHAVE_CARD_SEMANAL, hoje, montarEmailRelatorio({
      tipoRotulo: 'Relatório semanal',
      empresa: empresa.nome,
      periodo: `${dataBR(inicio).slice(0, 5)} a ${dataBR(fim)}`,
      conteudo: ia.conteudo,
      link: `${baseUrlSistema()}/admin/diretoria?empresa=${empresa.id}&tipo=SEMANAL&data=${inicio}`,
    }));
    envioTexto = envio.texto;
    await db.from('diretoria_relatorios').update({ whatsapp_enviado_em: envio.enviados > 0 ? new Date().toISOString() : null, whatsapp_resultado: envio.texto }).eq('id', salvo.id);
  }
  return ia.ok ? { ok: true, relatorioId: salvo.id, envio: envioTexto } : { ok: false, erro: ia.erro, relatorioId: salvo.id };
}
