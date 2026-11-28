// app/lib/feriados/buscarFeriados.ts
// Busca dos feriados de um ano para o botão "Buscar feriados do ano" de
// RH → Parâmetros → Feriados (2026-11-28). Só roda no servidor.
//
// - Nacionais: BrasilAPI (https://brasilapi.com.br/api/feriados/v1/{ano}),
//   gratuita e sem chave — fonte oficial dos feriados nacionais, inclusive os
//   móveis (Carnaval, Sexta-feira Santa, Corpus Christi).
// - Estaduais e municipais: não há API pública confiável, então o Claude
//   pesquisa na web (ferramenta web_search) e devolve a lista pela ferramenta
//   registrar_feriados, com a lei e o link da fonte de cada data. Nada é
//   gravado aqui: a tela mostra tudo numa prévia e o usuário escolhe o que
//   cadastrar.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { segredo } from '../cofre/segredos';

export interface FeriadoNacional { data: string; nome: string }

export async function feriadosNacionais(ano: number): Promise<FeriadoNacional[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`BrasilAPI respondeu ${r.status}`);
    const dados = (await r.json()) as { date: string; name: string; type: string }[];
    return dados.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.date)).map(d => ({ data: d.date, nome: d.name }));
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Estaduais e municipais (IA + pesquisa na web)
// ---------------------------------------------------------------------------
export const MODELO_FERIADOS = 'claude-opus-5-5';

export interface LocalBusca { uf: string; cidade: string }

const FeriadoLocalSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nome: z.string().min(2),
  esfera: z.enum(['ESTADUAL', 'MUNICIPAL']),
  uf: z.string().length(2),
  cidade: z.string().nullable(),
  base_legal: z.string(),
  fonte_url: z.string(),
  confianca: z.enum(['ALTA', 'MEDIA', 'BAIXA']),
  observacao: z.string().nullable(),
});
const RegistroSchema = z.object({ feriados: z.array(FeriadoLocalSchema), avisos: z.array(z.string()) });
export type FeriadoLocal = z.infer<typeof FeriadoLocalSchema>;

const FERRAMENTA_REGISTRAR = {
  name: 'registrar_feriados',
  description: 'Registra a lista final de feriados estaduais e municipais encontrados. Chame uma única vez, no fim da pesquisa.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      feriados: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'AAAA-MM-DD, já calculada para o ano pedido (datas móveis inclusive).' },
            nome: { type: 'string', description: 'Nome do feriado, ex.: "Aniversário de São Paulo".' },
            esfera: { type: 'string', enum: ['ESTADUAL', 'MUNICIPAL'] },
            uf: { type: 'string', description: 'Sigla do estado, ex.: SP.' },
            cidade: { type: ['string', 'null'], description: 'Município (null para feriado estadual).' },
            base_legal: { type: 'string', description: 'Lei ou decreto que cria o feriado, ex.: "Lei Municipal 14.485/2007".' },
            fonte_url: { type: 'string', description: 'Link da página consultada que confirma a data.' },
            confianca: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAIXA'], description: 'ALTA = confirmado em fonte oficial (prefeitura, Assembleia, Diário Oficial); MEDIA = fonte secundária confiável; BAIXA = não confirmado.' },
            observacao: { type: ['string', 'null'], description: 'Algo que o RH precisa saber (ex.: ponto facultativo, data transferida). Null se nada.' },
          },
          required: ['data', 'nome', 'esfera', 'uf', 'cidade', 'base_legal', 'fonte_url', 'confianca', 'observacao'],
          additionalProperties: false,
        },
      },
      avisos: { type: 'array', items: { type: 'string' }, description: 'Dúvidas ou limitações da pesquisa (ex.: lei não encontrada).' },
    },
    required: ['feriados', 'avisos'],
    additionalProperties: false,
  },
};

const SISTEMA = `Você pesquisa feriados para o RH de uma locadora de equipamentos no Brasil. O resultado alimenta o cálculo de ponto e folha, então errar uma data custa dinheiro: prefira fontes oficiais (site da prefeitura, câmara municipal, Assembleia Legislativa, Diário Oficial, leis municipais e estaduais) e diga a base legal de cada feriado.

Regras:
- Liste só feriados ESTADUAIS e MUNICIPAIS criados por lei. Os nacionais (federais) já vêm de outra fonte: não os repita, mesmo que a cidade também os declare.
- Exceção: se a lei municipal transforma em feriado municipal uma data que nacionalmente é só ponto facultativo (ex.: Corpus Christi), inclua-a como MUNICIPAL e explique em observacao.
- Pontos facultativos que não são feriado por lei NÃO entram (no máximo uma menção em avisos).
- Calcule as datas para o ano pedido. Para datas móveis, faça a conta para aquele ano.
- Se não conseguir confirmar, use confianca BAIXA e explique em observacao — não invente.
- Termine chamando a ferramenta registrar_feriados uma única vez com a lista completa (pode ser vazia) e os avisos.`;

export type ResultadoIAFeriados =
  | { ok: true; feriados: FeriadoLocal[]; avisos: string[]; buscas: number; tokensEntrada: number; tokensSaida: number }
  | { ok: false; erro: string };

export async function feriadosLocaisIA(ano: number, locais: LocalBusca[], nacionais: FeriadoNacional[]): Promise<ResultadoIAFeriados> {
  const apiKey = await segredo('ANTHROPIC_API_KEY');
  if (!apiKey) return { ok: false, erro: 'Chave do Claude não configurada (Parâmetros → Empresas → Sistema → Credenciais).' };
  const client = new Anthropic({ apiKey });

  const estados = [...new Set(locais.map(l => l.uf.toUpperCase()))];
  const pedido = `Ano: ${ano}.
Estados: ${estados.join(', ')}.
Municípios: ${locais.map(l => `${l.cidade}/${l.uf}`).join('; ')}.
Feriados nacionais de ${ano} que já temos (não repita): ${nacionais.map(n => `${n.data} ${n.nome}`).join('; ')}.

Pesquise os feriados estaduais de cada estado e os municipais de cada município para ${ano} e registre-os com a ferramenta registrar_feriados.`;

  const tools = [
    { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 15,
      user_location: { type: 'approximate' as const, country: 'BR', region: estados[0] || 'SP', timezone: 'America/Sao_Paulo' } },
    FERRAMENTA_REGISTRAR,
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: pedido }];
  let tokensEntrada = 0, tokensSaida = 0, buscas = 0;

  try {
    // A pesquisa na web roda num laço no servidor da Anthropic; se ele pausar
    // (pause_turn), reenviamos a conversa para continuar — no máximo 4 vezes.
    for (let rodada = 0; rodada < 5; rodada++) {
      const resposta = await client.beta.messages.stream({
        model: MODELO_FERIADOS,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high' },
        system: SISTEMA,
        tools,
        messages,
      }).finalMessage();
      tokensEntrada += resposta.usage.input_tokens;
      tokensSaida += resposta.usage.output_tokens;
      buscas += resposta.usage.server_tool_use?.web_search_requests || 0;

      if (resposta.stop_reason === 'refusal') return { ok: false, erro: 'A IA recusou a pesquisa de feriados.' };

      const chamada = resposta.content.find(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'registrar_feriados',
      );
      if (chamada) {
        const lido = RegistroSchema.safeParse(chamada.input);
        if (!lido.success) return { ok: false, erro: 'A IA devolveu a lista num formato inesperado. Tente de novo.' };
        const ufs = new Set(estados);
        const cidades = new Set(locais.map(l => `${normalizar(l.cidade)}|${l.uf.toUpperCase()}`));
        // só o que foi pedido, e só datas do ano pedido
        const feriados = lido.data.feriados.filter(f =>
          f.data.startsWith(`${ano}-`) && ufs.has(f.uf.toUpperCase()) &&
          (f.esfera === 'ESTADUAL' || (f.cidade && cidades.has(`${normalizar(f.cidade)}|${f.uf.toUpperCase()}`))));
        return { ok: true, feriados, avisos: lido.data.avisos, buscas, tokensEntrada, tokensSaida };
      }
      if (resposta.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: resposta.content });
        continue;
      }
      if (resposta.stop_reason === 'max_tokens') return { ok: false, erro: 'A resposta da IA foi cortada. Tente de novo.' };
      return { ok: false, erro: 'A IA terminou sem registrar a lista de feriados. Tente de novo.' };
    }
    return { ok: false, erro: 'A pesquisa demorou demais (muitas pausas). Tente de novo.' };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, erro: 'Chave da API da Anthropic inválida (ANTHROPIC_API_KEY).' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, erro: 'Limite de uso da IA atingido. Tente de novo em alguns minutos.' };
    if (e instanceof Anthropic.BadRequestError) {
      if (/credit balance/i.test(e.message)) return { ok: false, erro: 'A conta da Anthropic está sem créditos (platform.claude.com → Plans & Billing).' };
      return { ok: false, erro: `A IA recusou o pedido: ${e.message}` };
    }
    if (e instanceof Anthropic.APIError) return { ok: false, erro: `Erro na IA (${e.status}): ${e.message}` };
    return { ok: false, erro: `Falha na pesquisa: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
