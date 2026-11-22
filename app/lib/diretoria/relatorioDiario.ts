// app/lib/diretoria/relatorioDiario.ts
// Relatório Diário do Diretor (IA) — um por empresa, todo dia às 10h
// (app/api/cron/diretoria) ou pelo botão "Gerar agora" em /admin/diretoria.
//
// Divisão de trabalho (combinada com o usuário em 2026-11-15):
// - indicadoresDiarios.ts calcula TODOS os números (fonte da verdade);
// - o Claude só interpreta: compara com os dias anteriores, aponta o que
//   fugiu do normal, cobra pendências que continuam abertas e escreve.
// O relatório é gravado mesmo se a IA falhar (status ERRO), pra tela
// continuar mostrando os números do dia.
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { calcularIndicadoresDiarios, somarDias, type IndicadoresDiarios } from './indicadoresDiarios';
import { escreverComIA, custoUsd, SituacaoSchema, PontoAtencaoSchema, SecaoSchema, PendenciaSchema, CONTEXTO_DADOS, REGRAS_ESCRITA, type PendenciaDiretoria } from './ia';
import { enviarPeloCard, montarEmailRelatorio, baseUrlSistema, dataBR } from './envioDiretoria';

type DB = ReturnType<typeof supabaseAdmin>;

export type { PendenciaDiretoria };
export const CHAVE_CARD_DIRETORIA = 'diretoria-relatorio-diario';

export const RelatorioDiarioSchema = z.object({
  situacao: SituacaoSchema,
  manchete: z.string().describe('Uma frase só (até ~180 caracteres), sem quebra de linha: o resumo do dia que o dono leria se lesse só isto.'),
  pontos_de_atencao: z.array(PontoAtencaoSchema).describe('No máximo 6, do mais grave ao menos grave. Lista vazia se o dia foi normal.'),
  secoes: z.array(SecaoSchema).describe('Uma por área com movimento relevante, na ordem FINANCEIRO, COMERCIAL, EXPEDICAO, FROTA, RH. Omita a área sem nada a dizer.'),
  pendencias: z.array(PendenciaSchema).describe('Pendências que o diretor acompanha: as anteriores (ABERTA se os números de hoje mostram que continua, RESOLVIDA se sumiu) + as novas de hoje. Não repita uma RESOLVIDA de relatórios anteriores.'),
  observacoes_dados: z.string().nullable().describe('Limitações dos dados de hoje que o leitor precisa saber (sync atrasado, área sem dado). Null se não houver.'),
});
export type ConteudoRelatorioDiario = z.infer<typeof RelatorioDiarioSchema>;

export const INSTRUCOES = `Você é o Diretor de uma locadora de equipamentos para eventos e feiras no Brasil (o sistema se chama Rentech WEB). Todo dia você lê os números do dia anterior de UMA empresa do grupo e escreve o relatório diário para o dono.

${REGRAS_ESCRITA}
- Destaque o que FOGE do normal ou pede ação: inadimplência nova ou crescendo, cliente grande atrasando, OP pendente há muitos dias ou vencida, material que deveria ter voltado e não voltou, divergência de expedição, veículo fora há muitos dias, prazo de multa/pedágio/documento vencendo, ponto incompleto, rescisão a pagar.
- Compare com o histórico dos dias anteriores quando ajudar ("terceiro dia seguido sem recebimento").

${CONTEXTO_DADOS}

Pendências: você recebe a lista do relatório anterior. Para cada uma, decida pelos números de hoje se continua ABERTA ou foi RESOLVIDA, mantendo id e data "desde". Acrescente as novas que merecem acompanhamento (não transforme todo fato do dia em pendência — só o que precisa ser cobrado até resolver).`;

// Resumo compacto de um relatório anterior, pra dar histórico sem mandar o JSON inteiro de cada dia.
export function resumoHistorico(r: { data_referencia: string; indicadores: IndicadoresDiarios; conteudo: ConteudoRelatorioDiario | null }) {
  const f = r.indicadores?.financeiro || {};
  const c = r.indicadores?.comercial || {};
  const e = r.indicadores?.expedicao || {};
  return {
    data: r.data_referencia,
    situacao: r.conteudo?.situacao ?? null,
    manchete: r.conteudo?.manchete ?? null,
    recebido: f.recebido_ontem?.valor ?? null,
    receber_vencidos: f.receber_vencidos ? { valor: f.receber_vencidos.valor, qtd: f.receber_vencidos.qtd } : null,
    pago_p2s: f.pago_ontem_p2s?.valor ?? null,
    ops_pendentes: f.ops?.pendentes_aprovacao ? { valor: f.ops.pendentes_aprovacao.valor, qtd: f.ops.pendentes_aprovacao.qtd } : null,
    fichas_emitidas: c.fichas_emitidas_ontem ? { valor: c.fichas_emitidas_ontem.valor, qtd: c.fichas_emitidas_ontem.qtd } : null,
    material_fora: e.material_fora?.qtd ?? null,
  };
}

export interface ResultadoRelatorio {
  ok: boolean;
  erro?: string;
  relatorioId?: number;
  envio?: string; // resultado do e-mail ("E-mail enviado para 1.")
}

// Pendências abertas do último relatório diário bem-sucedido antes de `ate`.
export async function pendenciasAbertasAte(db: DB, empresaId: number, ate: string): Promise<PendenciaDiretoria[]> {
  const { data } = await db.from('diretoria_relatorios').select('pendencias')
    .eq('empresa_id', empresaId).eq('tipo', 'DIARIO').eq('status', 'GERADO').lte('data_referencia', ate)
    .order('data_referencia', { ascending: false }).limit(1).maybeSingle();
  return ((data?.pendencias || []) as PendenciaDiretoria[]).filter(p => p.situacao === 'ABERTA');
}

// Gera (ou regera) o relatório diário de uma empresa e, se pedido, avisa por
// e-mail os destinatários do card diretoria-relatorio-diario.
export async function gerarRelatorioDiario(
  db: DB,
  empresa: { id: number; nome: string },
  opcoes: { dataReferencia?: string; geradoPor: string; enviarEmail: boolean },
): Promise<ResultadoRelatorio> {
  const indicadores = await calcularIndicadoresDiarios(db, empresa, opcoes.dataReferencia);
  const D = indicadores.data_referencia;

  const { data: anteriores } = await db
    .from('diretoria_relatorios')
    .select('data_referencia, indicadores, conteudo, status')
    .eq('empresa_id', empresa.id).eq('tipo', 'DIARIO')
    .lt('data_referencia', D).gte('data_referencia', somarDias(D, -7))
    .order('data_referencia', { ascending: false });
  const pendenciasAnteriores = await pendenciasAbertasAte(db, empresa.id, somarDias(D, -1));

  const entrada = {
    empresa: empresa.nome,
    dia_analisado: D,
    hoje: indicadores.hoje,
    indicadores,
    historico_dias_anteriores: ((anteriores || []) as any[]).map(resumoHistorico),
    pendencias_do_relatorio_anterior: pendenciasAnteriores,
  };
  const ia = await escreverComIA(RelatorioDiarioSchema, INSTRUCOES,
    `Escreva o relatório diário da empresa ${empresa.nome} sobre o dia ${D}.\n\n${JSON.stringify(entrada)}`);

  const linha = {
    empresa_id: empresa.id,
    tipo: 'DIARIO',
    data_referencia: D,
    indicadores,
    conteudo: ia.ok ? ia.conteudo : null,
    // IA falhou: as pendências abertas continuam valendo pro próximo dia.
    pendencias: ia.ok ? ia.conteudo.pendencias : pendenciasAnteriores,
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
    const envio = await enviarPeloCard(db, CHAVE_CARD_DIRETORIA, indicadores.hoje, montarEmailRelatorio({
      tipoRotulo: 'Relatório diário',
      empresa: empresa.nome,
      periodo: `${indicadores.dia_semana_referencia}, ${dataBR(D)}`,
      conteudo: ia.conteudo,
      link: `${baseUrlSistema()}/admin/diretoria?empresa=${empresa.id}&tipo=DIARIO&data=${D}`,
    }), empresa.id);
    envioTexto = envio.texto;
    await db.from('diretoria_relatorios').update({ whatsapp_enviado_em: envio.enviados > 0 ? new Date().toISOString() : null, whatsapp_resultado: envio.texto }).eq('id', salvo.id);
  }

  return ia.ok ? { ok: true, relatorioId: salvo.id, envio: envioTexto } : { ok: false, erro: ia.erro, relatorioId: salvo.id };
}
