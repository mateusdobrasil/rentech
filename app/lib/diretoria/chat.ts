// app/lib/diretoria/chat.ts
// Chat "pergunte ao diretor" (Fase 3, 2026-11-15) — aba Perguntar de
// /admin/diretoria. Claude com ferramentas só de leitura (ferramentasChat.ts),
// em loop manual: cada pergunta pode virar várias consultas antes da resposta.
//
// O histórico é SÓ DE ACRÉSCIMO e reenviado exatamente como saiu da API
// (raciocínio e chamadas de ferramenta inclusos): o modelo (Haiku 5.5) confere que
// system, ferramentas e mensagens anteriores não mudaram (preserved
// thinking). Por isso:
// - INSTRUCOES e DEFINICOES_FERRAMENTAS são fixos — o que muda a cada
//   pergunta (data de hoje, empresas que o usuário pode ver, empresa aberta
//   na tela) vai no texto da própria pergunta;
// - pergunta que falha (erro da API, recusa) não é gravada — o histórico
//   volta ao estado anterior, como se ela não tivesse existido.
//
// Variável de ambiente: ANTHROPIC_API_KEY. Só roda no servidor.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../supabase';
import { hojeISO } from './indicadoresDiarios';
import { MODELO_DIRETORIA, custoTokens } from './ia';
import { DEFINICOES_FERRAMENTAS, VERSAO_FERRAMENTAS, executarFerramenta, rotuloFerramenta, type EmpresaChat } from './ferramentasChat';
import { erroColunaInexistente } from '../../admin/financeiro/contas-pagar/contasPagarCore';

type DB = ReturnType<typeof supabaseAdmin>;
type Mensagem = Anthropic.Beta.BetaMessageParam;
type Bloco = Anthropic.Beta.BetaContentBlock;

export interface ItemExibicao {
  papel: 'user' | 'assistant';
  texto: string;
  em: string;
  consultas?: string[];
  custo_usd?: number;
}

const MAX_ITERACOES = 10;
const MAX_PERGUNTAS = 25;

const custo = custoTokens;

const INSTRUCOES = `Você é o Diretor (IA) de uma locadora de equipamentos para eventos e feiras no Brasil (o sistema se chama Rentech WEB). Responde perguntas do dono e da diretoria sobre a empresa consultando os dados do sistema com as ferramentas disponíveis.

Como trabalhar:
- Cada pergunta começa com um bloco [Contexto] com a data de hoje, as empresas que este usuário pode consultar (com o id de cada uma) e a empresa aberta na tela. Se a pergunta não disser a empresa, use a da tela; se fizer sentido comparar, consulte as duas.
- Consulte antes de responder. Nunca invente números, nomes ou datas: tudo o que você afirmar tem que ter vindo de uma ferramenta nesta conversa. Se os dados não respondem a pergunta, diga isso claramente e diga o que daria para consultar.
- Para totais de listas, use os totais e agrupamentos que as ferramentas já devolvem — não some linhas por conta própria; se precisar de um total que nenhuma ferramenta dá, faça uma consulta mais específica. Conta simples entre dois ou três números que vieram das ferramentas (diferença, participação em %, variação) pode, conferindo o resultado. Se a lista veio cortada (mostrando < total_de_linhas), diga isso.
- Você só lê. Não aprova, paga, altera nem envia nada; se pedirem, explique onde no sistema a pessoa faz isso.
- CPF, salário, dados bancários e chaves Pix estão fora do seu alcance; não tente obter nem estimar.

O que você precisa saber sobre os dados:
- Antes da virada da chave, contas a receber, contas a pagar e fichas de reserva vêm do ERP PrimeStart (P2S), sincronizado às 9h30, 11h e 17h (contas a pagar vencidas em aberto não são sincronizadas). Depois da virada de uma empresa, as ferramentas passam a ler os dados do próprio sistema, sem mudar o formato; o histórico anterior ao corte continua sendo o do P2S.
- A ferramenta locacao mostra a operação de locação do sistema; com ativo = false a empresa ainda está na fase paralela e só o fiscal de produção vale. A ferramenta disponibilidade responde se há equipamento livre num período — antes da virada, avise que a referência oficial ainda é o P2S.
- Empresa com recebimentos de "fonte externa" não tem contas a receber no sistema.
- Títulos a receber vencidos há mais de 365 dias costumam ser baixa pendente no P2S, não dívida real.
- Status das fichas vêm por extenso nas linhas; o filtro de status da ferramenta de fichas usa o código do P2S.
- A Alfa Light ainda não usa o RH do sistema em 2026.

Como responder:
- Português do Brasil, direto, de executivo para executivo. Comece pela resposta; depois os detalhes que sustentam.
- Valores como R$ 12.345,67; datas como dd/mm (com o ano se não for o atual).
- Texto simples: parágrafos curtos e listas com "•". Sem tabelas, sem títulos com #, sem negrito com asteriscos.
- Diga de onde veio e qual período considerou quando isso mudar a leitura do número.`;

// Depois de uma recusa no meio da resposta com troca de modelo (bloco
// `fallback`), a API pede que raciocínio e chamadas de ferramenta ANTERIORES
// ao último bloco fallback não sejam reenviados (ver docs de refusal fallbacks).
function paraHistorico(conteudo: Bloco[]): Bloco[] {
  const ultimoFallback = conteudo.map(b => b.type as string).lastIndexOf('fallback');
  if (ultimoFallback < 0) return conteudo;
  return conteudo.filter((b, i) => i > ultimoFallback || b.type === 'fallback' || !['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'].includes(b.type as string));
}

export interface ResultadoPergunta {
  ok: boolean;
  erro?: string;
  conversaId?: string;
  resposta?: ItemExibicao;
}

export async function perguntarAoDiretor(
  db: DB,
  usuario: { id: string; nome: string },
  entrada: { conversaId: string | null; pergunta: string; empresas: EmpresaChat[]; empresaTelaId: number | null },
): Promise<ResultadoPergunta> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, erro: 'Falta a variável ANTHROPIC_API_KEY no servidor.' };
  const pergunta = entrada.pergunta.trim();
  if (!pergunta) return { ok: false, erro: 'Escreva uma pergunta.' };
  if (pergunta.length > 2000) return { ok: false, erro: 'Pergunta longa demais (máximo 2.000 caracteres).' };
  if (!entrada.empresas.length) return { ok: false, erro: 'Seu usuário não está vinculado a nenhuma empresa.' };

  let conversa: { id: string; historico: Mensagem[]; exibicao: ItemExibicao[]; tokens_entrada: number; tokens_saida: number; custo_usd: number } | null = null;
  if (entrada.conversaId) {
    const { data } = await db.from('diretoria_conversas').select('*').eq('id', entrada.conversaId).maybeSingle();
    if (!data || data.perfil_id !== usuario.id) return { ok: false, erro: 'Conversa não encontrada.' };
    // Conversa feita com outro conjunto de ferramentas não pode continuar (ver VERSAO_FERRAMENTAS).
    // (coluna ausente = SQL da Fase 4 ainda não rodou: não dá pra saber, deixa seguir)
    if (data.versao_ferramentas !== undefined && data.versao_ferramentas !== VERSAO_FERRAMENTAS) return { ok: false, erro: 'O Diretor ganhou consultas novas desde esta conversa, e ela não pode continuar. Comece uma nova conversa (esta continua salva para leitura).' };
    conversa = { id: data.id, historico: data.historico || [], exibicao: data.exibicao || [], tokens_entrada: Number(data.tokens_entrada) || 0, tokens_saida: Number(data.tokens_saida) || 0, custo_usd: Number(data.custo_usd) || 0 };
    if (conversa.exibicao.filter(i => i.papel === 'user').length >= MAX_PERGUNTAS) return { ok: false, erro: `Esta conversa chegou a ${MAX_PERGUNTAS} perguntas. Comece uma nova conversa.` };
  }

  const hoje = hojeISO();
  const diaSemana = new Date(`${hoje}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
  const tela = entrada.empresas.find(e => e.id === entrada.empresaTelaId) || entrada.empresas[0];
  const contexto = `[Contexto: hoje é ${hoje} (${diaSemana}). Empresas que você pode consultar: ${entrada.empresas.map(e => `${e.nome} (empresa_id ${e.id}, recebimentos ${e.fonte_recebimentos === 'EXTERNA' ? 'de fonte externa' : 'no P2S'})`).join('; ')}. Empresa aberta na tela: ${tela.nome} (empresa_id ${tela.id}).]`;

  const mensagens: Mensagem[] = [...(conversa?.historico || []), { role: 'user', content: [{ type: 'text', text: `${contexto}\n\n${pergunta}` }] }];
  const ctx = { db, empresas: entrada.empresas, hoje };
  const client = new Anthropic();
  const consultas: string[] = [];
  let tokensEntrada = 0, tokensSaida = 0, custoTurno = 0;
  let resposta = '';

  try {
    for (let i = 0; i < MAX_ITERACOES; i++) {
      const ultima = i === MAX_ITERACOES - 1;
      const r = await client.beta.messages.create({
        model: MODELO_DIRETORIA,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        system: INSTRUCOES,
        tools: DEFINICOES_FERRAMENTAS,
        messages: mensagens,
      });
      tokensEntrada += r.usage.input_tokens + (r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0);
      tokensSaida += r.usage.output_tokens;
      custoTurno += custo(r.usage);

      if (r.stop_reason === 'refusal') return { ok: false, erro: 'O diretor não pôde responder a esta pergunta. Tente reformular.' };
      const conteudo = paraHistorico(r.content);
      if (!conteudo.length) return { ok: false, erro: 'A IA devolveu uma resposta vazia. Tente de novo.' };
      mensagens.push({ role: 'assistant', content: conteudo as Anthropic.Beta.BetaContentBlockParam[] });

      if (r.stop_reason === 'pause_turn') continue;
      const chamadas = conteudo.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !chamadas.length) {
        resposta = conteudo.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
        // A tela mostra texto puro: o Haiku às vezes usa **negrito** apesar da instrução.
        resposta = resposta.replace(/\*\*(.+?)\*\*/g, '$1');
        if (r.stop_reason === 'max_tokens') resposta += '\n\n(Resposta cortada por ser longa demais.)';
        break;
      }

      // Todas as chamadas da rodada em paralelo, todos os resultados numa mensagem só.
      const resultados = await Promise.all(chamadas.map(async c => {
        consultas.push(rotuloFerramenta(c.name, c.input, entrada.empresas));
        if (ultima) return { type: 'tool_result' as const, tool_use_id: c.id, is_error: true, content: 'Limite de consultas desta pergunta atingido. Não consulte mais; responda com o que já tem.' };
        const res = await executarFerramenta(c.name, c.input, ctx);
        return { type: 'tool_result' as const, tool_use_id: c.id, is_error: res.erro || undefined, content: res.conteudo };
      }));
      mensagens.push({ role: 'user', content: resultados });
      if (ultima) resposta = 'Não consegui concluir esta análise dentro do limite de consultas. Tente uma pergunta mais específica (empresa, período ou cliente).';
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, erro: 'Chave da API da Anthropic inválida (ANTHROPIC_API_KEY).' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, erro: 'Limite de uso da IA atingido. Tente de novo em alguns minutos.' };
    if (e instanceof Anthropic.BadRequestError) {
      if (/credit balance/i.test(e.message)) return { ok: false, erro: 'A conta da Anthropic está sem créditos (platform.claude.com → Plans & Billing).' };
      return { ok: false, erro: `A IA recusou o pedido: ${e.message}` };
    }
    if (e instanceof Anthropic.APIError) return { ok: false, erro: `Erro na IA (${e.status}): ${e.message}` };
    return { ok: false, erro: `Falha ao responder: ${e instanceof Error ? e.message : String(e)}` };
  }

  const agora = new Date().toISOString();
  const itemResposta: ItemExibicao = { papel: 'assistant', texto: resposta || '(sem resposta)', em: agora, consultas, custo_usd: Math.round(custoTurno * 10000) / 10000 };
  const exibicao = [...(conversa?.exibicao || []), { papel: 'user' as const, texto: pergunta, em: agora }, itemResposta];
  const linha = {
    historico: mensagens,
    exibicao,
    tokens_entrada: (conversa?.tokens_entrada || 0) + tokensEntrada,
    tokens_saida: (conversa?.tokens_saida || 0) + tokensSaida,
    custo_usd: Math.round(((conversa?.custo_usd || 0) + custoTurno) * 10000) / 10000,
    atualizado_em: agora,
  };

  if (conversa) {
    const { error } = await db.from('diretoria_conversas').update(linha).eq('id', conversa.id).eq('perfil_id', usuario.id);
    if (error) return { ok: false, erro: `Resposta não foi gravada: ${error.message}` };
    return { ok: true, conversaId: conversa.id, resposta: itemResposta };
  }
  const nova = { ...linha, perfil_id: usuario.id, usuario_nome: usuario.nome, titulo: pergunta.length > 60 ? `${pergunta.slice(0, 57)}…` : pergunta };
  let { data: criada, error } = await db.from('diretoria_conversas').insert({ ...nova, versao_ferramentas: VERSAO_FERRAMENTAS }).select('id').single();
  // versao_ferramentas entra por diretoria_fase4.sql — antes dele, grava sem.
  if (error && erroColunaInexistente(error, 'versao_ferramentas')) ({ data: criada, error } = await db.from('diretoria_conversas').insert(nova).select('id').single());
  if (error || !criada) return { ok: false, erro: `Conversa não foi gravada: ${error?.message}` };
  return { ok: true, conversaId: criada.id, resposta: itemResposta };
}
