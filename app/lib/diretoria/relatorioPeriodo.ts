// app/lib/diretoria/relatorioPeriodo.ts
// Relatórios MENSAL e ANUAL do Diretor (IA) — Fase 4, 2026-11-15. Rotina do
// dia 1 às 8h (app/api/cron/diretoria-mensal): fecha o mês anterior e, em 1º
// de janeiro, também o ano anterior. data_referencia = primeiro dia do período.
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { hojeISO } from './indicadoresDiarios';
import { calcularIndicadoresPeriodo, periodosMensal, periodosAnual, mesFechado } from './indicadoresPeriodo';
import { escreverComIA, custoUsd, SituacaoSchema, PontoAtencaoSchema, SecaoSchema, PendenciaSchema, CONTEXTO_DADOS, REGRAS_ESCRITA } from './ia';
import { pendenciasAbertasAte, type ResultadoRelatorio } from './relatorioDiario';
import { avisarPeloCard, baseUrlSistema } from './whatsappDiretoria';

type DB = ReturnType<typeof supabaseAdmin>;

export const CHAVE_CARD_MENSAL = 'diretoria-relatorio-mensal';
export const CHAVE_CARD_ANUAL = 'diretoria-relatorio-anual';
const MESES_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const RelatorioPeriodoSchema = z.object({
  situacao: SituacaoSchema,
  manchete: z.string().describe('Uma frase só (até ~180 caracteres), sem quebra de linha: como foi o período.'),
  destaques_whatsapp: z.string().describe('Até 3 destaques curtíssimos numa linha só, separados por " · ". Sem quebra de linha.'),
  resumo: z.string().describe('4 a 6 frases: o que marcou o período, comparando com o período anterior e (no mensal) com o mesmo mês do ano anterior.'),
  metas: z.array(z.object({
    meta: z.string().describe('Nome da meta, como no JSON.'),
    avaliacao: z.string().describe('1 a 2 frases: realizado × meta, % e o que explica. Se não havia meta cadastrada, diga em poucas palavras.'),
  })).describe('Uma linha por meta do JSON (metas.metas no mensal; consolidado do ano no anual).'),
  tendencias: z.array(z.string()).describe('Até 6 tendências das séries por período, sempre com os números.'),
  pontos_de_atencao: z.array(PontoAtencaoSchema).describe('No máximo 6, do mais grave ao menos grave.'),
  secoes: z.array(SecaoSchema).describe('Uma por área com algo relevante, na ordem FINANCEIRO, COMERCIAL, EXPEDICAO, FROTA, RH.'),
  caixa: z.string().describe('2 a 4 frases sobre a projeção de caixa de 30/60/90 dias (campo caixa), com as limitações que importam.'),
  recomendacoes: z.array(z.string()).describe('Mensal: até 3 decisões/cobranças para o mês que começa. Anual: até 6 recomendações para o orçamento e as metas do ano que começa.'),
  pendencias: z.array(PendenciaSchema).describe('Pendências que continuam abertas no fim do período + as novas que o período revelou.'),
  observacoes_dados: z.string().nullable().describe('Limitações dos dados do período que o leitor precisa saber. Null se não houver.'),
});
export type ConteudoRelatorioPeriodo = z.infer<typeof RelatorioPeriodoSchema>;

const INSTRUCOES = `Você é o Diretor de uma locadora de equipamentos para eventos e feiras no Brasil (o sistema se chama Rentech WEB). Você fecha um MÊS ou um ANO de UMA empresa do grupo e escreve o relatório para o dono.

${REGRAS_ESCRITA}
- As séries "*_por_periodo" trazem os períodos na ordem de "periodo" + "periodos_comparacao". No mensal: mês analisado, os 5 meses anteriores (do mais recente ao mais antigo) e o mesmo mês do ano anterior. No anual: o ano analisado, o ano anterior e os 12 meses do ano analisado.
- Metas: cada uma vem com meta, realizado, pct_da_meta e situacao prontos (tetos: menor é melhor). Avalie todas; meta sem cadastro (SEM_META) só se menciona em poucas palavras.
- Caixa: a projeção não tem saldo em banco nem despesas ainda não lançadas no P2S — os meses distantes parecem mais folgados do que serão. Diga isso ao interpretar.
- O relatório do período não repete os semanais: olhe o conjunto, separe tendência de evento pontual e diga o que muda para o próximo período.
- No anual, as recomendações são para o orçamento e as metas do ano que começa, apoiadas nos números do ano (sazonalidade por mês, maiores clientes, peso de cada centro de custo).

${CONTEXTO_DADOS}`;

export async function gerarRelatorioPeriodo(
  db: DB,
  empresa: { id: number; nome: string },
  tipo: 'MENSAL' | 'ANUAL',
  opcoes: { hoje?: string; geradoPor: string; enviarWhatsapp: boolean },
): Promise<ResultadoRelatorio> {
  const hoje = opcoes.hoje || hojeISO();
  const { ano, mes } = mesFechado(hoje);
  const anoFechado = Number(hoje.slice(0, 4)) - 1;
  const periodos = tipo === 'MENSAL' ? periodosMensal(ano, mes) : periodosAnual(anoFechado);
  const indicadores = await calcularIndicadoresPeriodo(db, empresa, tipo, periodos);
  const P = indicadores.periodo;
  const pendencias = await pendenciasAbertasAte(db, empresa.id, P.fim);
  const nomePeriodo = tipo === 'MENSAL' ? `${MESES_EXTENSO[mes - 1]} de ${ano}` : `o ano de ${anoFechado}`;

  const ia = await escreverComIA(RelatorioPeriodoSchema, INSTRUCOES,
    `Escreva o relatório ${tipo === 'MENSAL' ? 'mensal' : 'anual'} da empresa ${empresa.nome} sobre ${nomePeriodo} (${P.inicio} a ${P.fim}).\n\n${JSON.stringify({ empresa: empresa.nome, indicadores, pendencias_abertas_no_ultimo_relatorio_diario: pendencias })}`);

  const linha = {
    empresa_id: empresa.id,
    tipo,
    data_referencia: P.inicio,
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

  let whatsapp: string | undefined;
  if (opcoes.enviarWhatsapp && ia.ok) {
    const envio = await avisarPeloCard(db, tipo === 'MENSAL' ? CHAVE_CARD_MENSAL : CHAVE_CARD_ANUAL, hoje, {
      tipo_relatorio: tipo === 'MENSAL' ? 'Fechamento do mês' : 'Fechamento do ano',
      empresa_relatorio: empresa.nome,
      data: tipo === 'MENSAL' ? `${MESES_EXTENSO[mes - 1]}/${ano}` : String(anoFechado),
      manchete: ia.conteudo.manchete,
      destaques: ia.conteudo.destaques_whatsapp,
      link: `${baseUrlSistema()}/admin/diretoria?empresa=${empresa.id}&tipo=${tipo}&data=${P.inicio}`,
    });
    whatsapp = envio.texto;
    await db.from('diretoria_relatorios').update({ whatsapp_enviado_em: envio.enviados > 0 ? new Date().toISOString() : null, whatsapp_resultado: envio.texto }).eq('id', salvo.id);
  }
  return ia.ok ? { ok: true, relatorioId: salvo.id, whatsapp } : { ok: false, erro: ia.erro, relatorioId: salvo.id };
}
