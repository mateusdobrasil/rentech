// app/lib/diretoria/ia.ts
// Peças comuns aos relatórios do Diretor (diário, semanal…): a chamada ao
// Claude com saída estruturada e os pedaços de esquema que todo relatório
// usa (pontos de atenção, seções por área, pendências).
//
// Variável de ambiente: ANTHROPIC_API_KEY. Só roda no servidor.
import Anthropic from '@anthropic-ai/sdk';
import { segredo } from '../cofre/segredos';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

// Haiku 5.5 desde 2026-11-22 (era Opus 5.5): o Diretor só interpreta números
// já calculados por código e consulta ferramentas prontas — pedido do usuário
// para baratear (~40x). O Haiku não tem fallback de recusa no servidor: recusa
// vira erro tratado na tela, como antes.
export const MODELO_DIRETORIA = 'claude-haiku-5-5';

// Preço do Haiku 5.5 por milhão de tokens (US$): duas tabelas pelo tamanho do
// prompt — até 100 mil tokens 0,10 entrada / 0,50 saída; acima, 0,50 / 2,50.
// Cache: leitura 0,1x e escrita (5 min) 1,25x o preço de entrada.
export function custoTokens(u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }) {
  const lidoCache = u.cache_read_input_tokens || 0, escritoCache = u.cache_creation_input_tokens || 0;
  const prompt = u.input_tokens + lidoCache + escritoCache;
  const [entrada, saida] = prompt > 100_000 ? [0.5, 2.5] : [0.1, 0.5];
  return (u.input_tokens * entrada + escritoCache * entrada * 1.25 + lidoCache * entrada * 0.1 + u.output_tokens * saida) / 1e6;
}
export const custoUsd = (entrada: number, saida: number) => Math.round(custoTokens({ input_tokens: entrada, output_tokens: saida }) * 10000) / 10000;

export const AREAS = ['FINANCEIRO', 'COMERCIAL', 'LOCACAO', 'EXPEDICAO', 'FROTA', 'RH', 'DADOS'] as const;

export const SituacaoSchema = z.enum(['NORMAL', 'ATENCAO', 'CRITICO'])
  .describe('NORMAL = nada fora do comum; ATENCAO = algo pede ação nos próximos dias; CRITICO = risco imediato de caixa, operação parada ou prazo legal estourando.');

export const PontoAtencaoSchema = z.object({
  area: z.enum(AREAS),
  gravidade: z.enum(['ALTA', 'MEDIA', 'BAIXA']),
  titulo: z.string().describe('Curto, até ~70 caracteres.'),
  detalhe: z.string().describe('1 a 3 frases com os números do JSON que sustentam o ponto.'),
  acao_sugerida: z.string().nullable().describe('O que fazer e, se der, quem deveria fazer. Null se não houver ação clara.'),
});

export const SecaoSchema = z.object({
  area: z.enum(AREAS),
  resumo: z.string().describe('1 a 2 frases sobre a área no período.'),
  itens: z.array(z.string()).describe('Até 5 fatos curtos com números. Pode ser vazio.'),
});

export const PendenciaSchema = z.object({
  id: z.string().describe('Identificador estável em minúsculas com hífen (ex.: "op-622-pendente", "retorno-checklist-188"). Reuse o id da pendência anterior quando for o mesmo assunto.'),
  area: z.enum(AREAS),
  descricao: z.string(),
  desde: z.string().describe('AAAA-MM-DD do primeiro dia em que a pendência apareceu (mantenha o da pendência anterior).'),
  situacao: z.enum(['ABERTA', 'RESOLVIDA']),
});
export type PendenciaDiretoria = z.infer<typeof PendenciaSchema>;

// Regras sobre os dados que valem para qualquer relatório do Diretor.
export const CONTEXTO_DADOS = `O que você precisa saber sobre os dados:
- Antes da virada da chave, contas a receber e a pagar e as fichas de reserva vêm do ERP PrimeStart (P2S), sincronizado às 9h30, 11h e 17h (horário de Brasília; frescor_dados já vem nesse horário). Depois da virada, um aviso diz que a empresa já virou: aí as fichas e as contas vêm do próprio sistema (campos com "p2s" no nome passam a trazer os dados do sistema) e o histórico antes do corte continua sendo o do P2S. Não estranhe a mudança de fonte nem a compare como queda ou alta.
- "locacao" é a operação de locação do sistema: orçamentos, conversão, faltas na agenda (equipamento com mais reserva que estoque), devoluções atrasadas, a faturar, avarias, manutenção, sublocações e fiscal. Com locacao.ativo = false a empresa ainda está na fase paralela: não comente os itens de locação (são ensaio), só o fiscal, se houver algo. Use a área LOCACAO para esses pontos. Falta na agenda e NF-e para fora de SP sem MDF-e (obrigatório na viagem interestadual) são pontos de atenção de prioridade alta.
- Contas a pagar do P2S só trazem títulos em aberto a vencer (de hoje em diante) e os já quitados — "contas a pagar vencidas" não existem neste JSON. Não diga que não há contas vencidas.
- financeiro.fonte_recebimentos = "EXTERNA" significa que os recebimentos dessa empresa vêm de outra fonte, ainda não integrada: não comente recebido, a receber nem inadimplência dela (os campos vêm zerados de propósito), e descarte — sem listar, nem como RESOLVIDA — pendências anteriores sobre contas a receber.
- Títulos a receber vencidos há mais de 365 dias são quase sempre baixa pendente no P2S, não dívida real: cite o total uma vez, como pendência de limpeza do financeiro, sem tratar como inadimplência.
- Status das fichas já vêm por extenso; canceladas já vêm excluídas.
- A Alfa Light ainda não usa o RH do sistema em 2026 (só a partir de 2027): zeros de RH na Alfa Light são esperados, não comente.
- "material_fora" são checklists de expedição com saída conferida e sem retorno; "retorno_atrasado" é o que já passou da data final do evento.
- Fim de semana e feriado costumam ter zero recebimento, pagamento e emissão — isso não é problema.
- "avisos" no JSON são limitações dos dados: leve-as em conta e repita em observacoes_dados o que for relevante.
- "metas" traz, para cada meta do mês, meta, realizado, pct_da_meta, esperado_ate_agora (ritmo proporcional aos dias corridos), faltam e situacao já calculados. Tetos (TETO_OPS, TETO_INADIMPLENCIA): menor é melhor; "faltam" é quanto ainda cabe (negativo = estourou). SEM_META = não cadastrada: não comente além de uma menção curta, se tanto.
- Km rodados já vêm sem as viagens com km suspeito (mais de 3.000 km entre saída e retorno — quase sempre km digitado errado); "viagens_com_km_suspeito" > 0 é registro de frota a corrigir, cite como pendência de dado, não como uso do veículo.
- "caixa" é a projeção de 30/60/90 dias: entradas (contas a receber em aberto) menos saídas (contas a pagar do P2S + OPs pendentes). Não tem saldo em banco nem despesas ainda não lançadas, então os horizontes distantes parecem mais folgados do que serão.`;

export const REGRAS_ESCRITA = `Regras de ouro:
- Use SOMENTE números que estão no JSON. Não some, não estime, não projete e não calcule porcentagens novas — as variações que importam já vêm prontas (campos variacao_pct_* ou séries por semana). Se um número não está no JSON, ele não existe para você.
- Valores em reais no formato brasileiro (R$ 12.345,67); datas como dd/mm.
- Português direto, de executivo para executivo. Nada de enrolação, elogio ou frase motivacional. Período normal é período normal: diga isso e pronto.
- Nomes de clientes, fornecedores e funcionários podem aparecer; não exponha salário nem dado pessoal além do nome.`;

export type ResultadoIA<T> =
  | { ok: true; conteudo: T; modelo: string; tokensEntrada: number; tokensSaida: number }
  | { ok: false; erro: string };

export async function escreverComIA<S extends z.ZodType>(schema: S, system: string, pedido: string): Promise<ResultadoIA<z.infer<S>>> {
  const apiKey = await segredo('ANTHROPIC_API_KEY');
  if (!apiKey) return { ok: false, erro: 'Chave do Claude não configurada (Parâmetros → Empresas → Sistema → Credenciais).' };
  const client = new Anthropic({ apiKey });
  try {
    // Haiku: o raciocínio conta dentro de max_tokens. No teste de 2026-11-22 o
    // diário usou ~15 mil tokens de saída em esforço médio (o padrão do Haiku) e,
    // em esforço alto, passou de 16 mil e saiu cortado. Streaming libera um teto
    // folgado sem esbarrar no limite de tempo do SDK; o resultado final vem
    // validado pelo esquema do mesmo jeito (parsed_output).
    const resposta = await client.beta.messages.stream({
      model: MODELO_DIRETORIA,
      max_tokens: 64000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: pedido }],
    }).finalMessage();
    if (resposta.stop_reason === 'refusal') return { ok: false, erro: 'A IA recusou escrever o relatório deste período.' };
    if (resposta.stop_reason === 'max_tokens') return { ok: false, erro: 'A resposta da IA foi cortada (longa demais).' };
    if (!resposta.parsed_output) return { ok: false, erro: 'Não foi possível interpretar a resposta da IA.' };
    return { ok: true, conteudo: resposta.parsed_output as z.infer<S>, modelo: resposta.model, tokensEntrada: resposta.usage.input_tokens, tokensSaida: resposta.usage.output_tokens };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, erro: 'Chave da API da Anthropic inválida (ANTHROPIC_API_KEY).' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, erro: 'Limite de uso da IA atingido. Tente de novo em alguns minutos.' };
    if (e instanceof Anthropic.BadRequestError) {
      if (/credit balance/i.test(e.message)) return { ok: false, erro: 'A conta da Anthropic está sem créditos (platform.claude.com → Plans & Billing).' };
      return { ok: false, erro: `A IA recusou o pedido: ${e.message}` };
    }
    if (e instanceof Anthropic.APIError) return { ok: false, erro: `Erro na IA (${e.status}): ${e.message}` };
    return { ok: false, erro: `Falha ao gerar o relatório: ${e instanceof Error ? e.message : String(e)}` };
  }
}
