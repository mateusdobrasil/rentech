// app/lib/leituraNotificacaoMulta.ts
// Lê a foto/PDF de uma notificação de multa de trânsito (Notificação de
// Autuação ou de Penalidade — DER, CET/Prefeitura, PRF, Detran…) com o Claude
// e devolve os campos estruturados para pré-preencher o "Lançamento manual"
// em /admin/operacional/multas. O usuário sempre confere antes de salvar.
//
// Variável de ambiente: ANTHROPIC_API_KEY. Só roda no servidor.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MODELO = 'claude-opus-5-5';

export const NotificacaoMultaSchema = z.object({
  tipo_documento: z.enum(['NOTIFICACAO_AUTUACAO', 'NOTIFICACAO_PENALIDADE', 'OUTRO'])
    .describe('Autuação = 1ª notificação (traz prazo para indicar condutor/defesa prévia). Penalidade = 2ª (traz valor a pagar e vencimento).'),
  placa: z.string().nullable().describe('Placa do veículo, só letras e números, maiúsculas (ex.: UEI2D36).'),
  auto_infracao: z.string().nullable().describe('Número do Auto de Infração (AIT), exatamente como impresso, sem espaços.'),
  orgao_autuador: z.string().nullable().describe('Nome curto do órgão autuador (ex.: D.E.R., CET, DETRAN-SP, PRF, Prefeitura de Osasco).'),
  codigo_infracao: z.string().nullable().describe('Código da infração com desdobramento, se houver (ex.: 7455-0).'),
  descricao_infracao: z.string().nullable().describe('Descrição/enquadramento da infração como impresso.'),
  data_infracao: z.string().nullable().describe('Data da infração no formato AAAA-MM-DD.'),
  hora_infracao: z.string().nullable().describe('Hora da infração no formato HH:MM (24h).'),
  local_infracao: z.string().nullable().describe('Local da infração (rodovia/km ou endereço).'),
  municipio: z.string().nullable().describe('Município/UF da infração.'),
  valor: z.number().nullable().describe('Valor integral da multa em reais (número, ex.: 195.23).'),
  valor_com_desconto: z.number().nullable().describe('Valor com desconto (20% ou 40% SNE), se impresso.'),
  data_vencimento: z.string().nullable().describe('Vencimento para pagamento, AAAA-MM-DD.'),
  prazo_indicacao_condutor: z.string().nullable().describe('Data-limite para identificação/indicação do condutor infrator (FICI) ou para defesa prévia, AAAA-MM-DD.'),
  pontos: z.number().nullable().describe('Pontos na CNH, se impresso.'),
  observacoes: z.string().nullable().describe('Em português, curto: campos ilegíveis, dúvidas de leitura ou avisos importantes. Null se tudo legível.'),
});
export type NotificacaoMulta = z.infer<typeof NotificacaoMultaSchema>;

const INSTRUCOES = `Você extrai dados de notificações brasileiras de multa de trânsito (Notificação de Autuação ou Notificação de Penalidade) emitidas por órgãos como DER, CET, prefeituras, PRF e Detrans.

Regras:
- Transcreva só o que está impresso no documento. Se um campo não aparece ou está ilegível, devolva null — nunca invente nem deduza valores.
- Datas sempre no formato AAAA-MM-DD; hora no formato HH:MM.
- Valores em reais como número (195.23), sem "R$".
- Placa e número do auto de infração sem espaços, pontos ou traços extras além dos impressos.
- Se o documento não for uma notificação de multa de trânsito, use tipo_documento "OUTRO" e explique em observacoes.
- Se houver mais de uma infração no mesmo documento, extraia a primeira e avise em observacoes.`;

export type ResultadoLeitura =
  | { ok: true; dados: NotificacaoMulta; modelo: string; tokensEntrada: number; tokensSaida: number }
  | { ok: false; erro: string };

const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export function leituraConfigurada(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function lerNotificacaoMulta(arquivo: Buffer, mimeType: string): Promise<ResultadoLeitura> {
  if (!leituraConfigurada()) return { ok: false, erro: 'Leitura automática não configurada: falta a variável ANTHROPIC_API_KEY no servidor.' };

  const dados = arquivo.toString('base64');
  let blocoArquivo: Anthropic.Beta.BetaContentBlockParam;
  if (mimeType === 'application/pdf') {
    blocoArquivo = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dados } };
  } else if ((TIPOS_IMAGEM as readonly string[]).includes(mimeType)) {
    blocoArquivo = { type: 'image', source: { type: 'base64', media_type: mimeType as (typeof TIPOS_IMAGEM)[number], data: dados } };
  } else {
    return { ok: false, erro: `Formato não suportado (${mimeType}). Envie foto (JPG/PNG) ou PDF.` };
  }

  const client = new Anthropic();
  try {
    const resposta = await client.beta.messages.parse({
      model: MODELO,
      max_tokens: 16000,
      // Recusa por classificador de segurança: a API refaz no modelo de
      // fallback dentro da mesma chamada (default roteia pela categoria).
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(NotificacaoMultaSchema) },
      system: INSTRUCOES,
      messages: [{
        role: 'user',
        content: [blocoArquivo, { type: 'text', text: 'Extraia os dados desta notificação de multa de trânsito.' }],
      }],
    });

    if (resposta.stop_reason === 'refusal') return { ok: false, erro: 'A IA não conseguiu ler este documento. Preencha manualmente.' };
    if (resposta.stop_reason === 'max_tokens') return { ok: false, erro: 'A leitura foi interrompida (resposta longa demais). Tente uma foto só da página principal.' };
    if (!resposta.parsed_output) return { ok: false, erro: 'Não foi possível interpretar a resposta da leitura. Preencha manualmente.' };

    return {
      ok: true,
      dados: resposta.parsed_output,
      modelo: resposta.model,
      tokensEntrada: resposta.usage.input_tokens,
      tokensSaida: resposta.usage.output_tokens,
    };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, erro: 'Chave da API da Anthropic inválida (ANTHROPIC_API_KEY).' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, erro: 'Limite de uso da IA atingido. Tente de novo em alguns minutos.' };
    if (e instanceof Anthropic.BadRequestError) {
      if (/credit balance/i.test(e.message)) return { ok: false, erro: 'A conta da Anthropic está sem créditos. Recarregue em platform.claude.com → Plans & Billing e tente de novo.' };
      return { ok: false, erro: `A IA recusou o arquivo: ${e.message}` };
    }
    if (e instanceof Anthropic.APIError) return { ok: false, erro: `Erro na IA (${e.status}): ${e.message}` };
    return { ok: false, erro: `Falha ao ler a notificação: ${e instanceof Error ? e.message : String(e)}` };
  }
}
