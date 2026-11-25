// app/lib/ajuda/assistente.ts
// Assistente dos Manuais (2026-11-24) — o "💬 Pergunte" de /admin/manuais.
// Mesmo motor do Diretor (Claude Haiku 5.5, loop manual com ferramentas, histórico
// só de acréscimo — ver app/lib/diretoria/chat.ts), mas para tirar dúvidas de
// USO do sistema: onde fica uma tela, um botão, um relatório, como fazer algo.
// NÃO consulta dados da empresa: só o mapa de telas (que a pessoa pode abrir)
// e os manuais que ela pode ler. Só servidor.
import Anthropic from '@anthropic-ai/sdk';
import { segredo } from '../cofre/segredos';
import { supabaseAdmin } from '../supabase';
import { MODELO_DIRETORIA, custoTokens } from '../diretoria/ia';
import { MAPA_TELAS } from './mapaTelas';
import { secoesManuais, manuaisVisiveis, termos, pontuar, trecho, normalizar } from './indiceManuais';

type DB = ReturnType<typeof supabaseAdmin>;
type Mensagem = Anthropic.Beta.BetaMessageParam;
type Bloco = Anthropic.Beta.BetaContentBlock;

export interface LinkAjuda { rotulo: string; href: string }
export interface ItemAjuda { papel: 'user' | 'assistant'; texto: string; em: string; links?: LinkAjuda[]; custo_usd?: number }

// Muda quando as ferramentas ou as instruções mudam: conversa antiga não continua.
export const VERSAO_AJUDA = '2026-11-24';
const MAX_ITERACOES = 8;
const MAX_PERGUNTAS = 30;

const INSTRUCOES = `Você é o assistente de ajuda do Rentech WEB, o sistema de gestão de uma locadora de equipamentos para eventos e feiras no Brasil. Você ajuda quem usa o sistema a encontrar telas, botões, abas, relatórios e funções, e explica como fazer as tarefas do dia a dia.

Como trabalhar:
- Cada pergunta começa com um bloco [Contexto] com a permissão do usuário e, se houver, o manual que ele está lendo agora.
- Consulte antes de responder. Use mapa_telas para saber ONDE fica uma tela (o caminho de menu e o endereço) e buscar_manuais / ler_secao para saber COMO se faz algo e o nome exato de botões, abas e campos.
- Nunca invente caminho de menu, nome de tela, botão, aba ou campo: tudo o que você afirmar tem que ter vindo das ferramentas nesta conversa. Se não achar, diga com clareza que não encontrou e sugira abrir um chamado em Painel → Suporte e Chamados.
- mapa_telas só lista as telas que este usuário pode abrir. Se o que ele procura não está lá, diga que a tela existe só se um manual mostrar isso, e que ele precisa pedir acesso ao administrador.
- Você não consulta dados da empresa (valores, clientes, fichas, funcionários) e não faz nada no sistema. Se pedirem um número ou uma ação, explique em que tela a pessoa vê ou faz isso.

Como responder:
- Português do Brasil, direto e curto. Comece pelo caminho ou pela resposta; depois os passos.
- Caminho de menu com setas, como "Painel → RH → Controle de Ponto", e o endereço da tela entre parênteses, como (/admin/rh/ponto), para virar link.
- Passos numerados quando houver mais de um.
- Texto simples: sem tabelas, sem títulos com #, sem negrito com asteriscos.
- No fim, quando usou um manual, diga em qual: "Mais detalhes: manual Ponto via WhatsApp, seção Painel do RH."`;

const DEFINICOES: Anthropic.Beta.BetaTool[] = [
  {
    name: 'mapa_telas',
    description: 'Telas do sistema que ESTE usuário pode abrir, com o caminho de menu ("Painel → Hub → Tela"), a descrição do card e o endereço. Sem busca, devolve todas; com busca, as que combinam com as palavras.',
    input_schema: { type: 'object', properties: { busca: { type: 'string', description: 'Palavras do que a pessoa procura (ex.: "ponto folga", "nota fiscal"). Opcional.' } } },
  },
  {
    name: 'buscar_manuais',
    description: 'Procura nos manuais que este usuário pode ler e devolve as seções que mais combinam, com um trecho. Use antes de ler_secao.',
    input_schema: { type: 'object', properties: { consulta: { type: 'string', description: 'Palavras-chave da dúvida.' } }, required: ['consulta'] },
  },
  {
    name: 'ler_secao',
    description: 'Texto completo de uma seção de manual (manual e secao vêm de buscar_manuais).',
    input_schema: { type: 'object', properties: { manual: { type: 'string', description: 'slug do manual' }, secao: { type: 'string', description: 'id da seção' } }, required: ['manual', 'secao'] },
  },
];

interface Ctx { permissao: string; podeRota: (rota: string) => boolean; links: Map<string, LinkAjuda> }

async function executar(nome: string, entrada: Record<string, unknown>, ctx: Ctx): Promise<{ conteudo: string; erro?: boolean }> {
  if (nome === 'mapa_telas') {
    const visiveis = MAPA_TELAS.filter(t => ctx.podeRota(t.rota));
    const busca = termos(String(entrada.busca || ''));
    const lista = busca.length
      ? visiveis.map(t => ({ t, p: pontuar(t.caminho, `${t.descricao} ${t.rota}`, busca) })).filter(x => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 15).map(x => x.t)
      : visiveis;
    if (!lista.length) return { conteudo: busca.length ? 'Nenhuma tela deste usuário combina com essas palavras. Tente outras palavras, ou mapa_telas sem busca para ver todas.' : 'Este usuário não tem acesso a nenhuma tela do mapa.' };
    return { conteudo: JSON.stringify(lista.map(t => ({ caminho: t.caminho, endereco: t.rota, descricao: t.descricao }))) };
  }
  if (nome === 'buscar_manuais') {
    const consulta = termos(String(entrada.consulta || ''));
    if (!consulta.length) return { conteudo: 'Informe palavras-chave.', erro: true };
    const permitidos = new Set(manuaisVisiveis(ctx.permissao).map(m => m.slug));
    const achados = (await secoesManuais()).filter(s => permitidos.has(s.slug))
      .map(s => ({ s, p: pontuar(`${s.manual} ${s.titulo}`, s.texto, consulta) }))
      .filter(x => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 8);
    if (!achados.length) return { conteudo: 'Nada nos manuais combina com essas palavras. Tente sinônimos (ex.: "lançar" × "cadastrar", "OS" × "ordem de serviço").' };
    return { conteudo: JSON.stringify(achados.map(({ s }) => ({ manual: s.slug, titulo_manual: s.manual, secao: s.secaoId, titulo_secao: s.titulo, trecho: trecho(s.texto, consulta) }))) };
  }
  if (nome === 'ler_secao') {
    const slug = String(entrada.manual || ''), id = String(entrada.secao || '');
    if (!manuaisVisiveis(ctx.permissao).some(m => m.slug === slug)) return { conteudo: 'Manual inexistente ou restrito para este usuário.', erro: true };
    const s = (await secoesManuais()).find(x => x.slug === slug && (x.secaoId === id || normalizar(x.secaoId) === normalizar(id)));
    if (!s) return { conteudo: 'Seção não encontrada. Use buscar_manuais para achar o id certo.', erro: true };
    const href = `/admin/manuais/${s.slug}${s.secaoId ? `#${encodeURIComponent(s.secaoId)}` : ''}`;
    ctx.links.set(href, { rotulo: `${s.manual} · ${s.titulo}`, href });
    return { conteudo: JSON.stringify({ manual: s.manual, secao: s.titulo, texto: s.texto.length > 9000 ? `${s.texto.slice(0, 9000)}… (seção longa, cortada)` : s.texto }) };
  }
  return { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true };
}

function paraHistorico(conteudo: Bloco[]): Bloco[] {
  const ultimoFallback = conteudo.map(b => b.type as string).lastIndexOf('fallback');
  if (ultimoFallback < 0) return conteudo;
  return conteudo.filter((b, i) => i > ultimoFallback || b.type === 'fallback' || !['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'].includes(b.type as string));
}

/** Rotas que esta permissão abre (parametros_paginas_permissoes). Administrador abre tudo. */
async function rotasPermitidas(db: DB, permissao: string): Promise<(rota: string) => boolean> {
  if (permissao === 'ADMINISTRADOR') return () => true;
  const { data } = await db.from('parametros_paginas_permissoes').select('endereco_route, permissoes_permitidas');
  const ok = new Set(((data || []) as { endereco_route: string; permissoes_permitidas: string[] | null }[])
    .filter(r => (r.permissoes_permitidas || []).includes(permissao)).map(r => r.endereco_route));
  return rota => ok.has(rota);
}

export interface ResultadoAjuda { ok: boolean; erro?: string; conversaId?: string; resposta?: ItemAjuda }

export async function perguntarAjuda(
  db: DB,
  usuario: { id: string; nome: string; permissao: string },
  entrada: { conversaId: string | null; pergunta: string; manualAberto: string | null },
): Promise<ResultadoAjuda> {
  const apiKey = await segredo('ANTHROPIC_API_KEY');
  if (!apiKey) return { ok: false, erro: 'O assistente está sem a chave do Claude (Parâmetros → Empresas → Sistema → Credenciais).' };
  const pergunta = entrada.pergunta.trim();
  if (!pergunta) return { ok: false, erro: 'Escreva uma pergunta.' };
  if (pergunta.length > 1500) return { ok: false, erro: 'Pergunta longa demais (máximo 1.500 caracteres).' };

  let conversa: { id: string; historico: Mensagem[]; exibicao: ItemAjuda[]; tokens_entrada: number; tokens_saida: number; custo_usd: number } | null = null;
  if (entrada.conversaId) {
    const { data, error } = await db.from('manuais_conversas').select('*').eq('id', entrada.conversaId).eq('perfil_id', usuario.id).maybeSingle();
    if (error) return { ok: false, erro: /manuais_conversas/.test(error.message) ? 'Falta rodar o SQL do assistente (.sql/Pendentes/manuais_assistente.sql).' : error.message };
    if (!data) return { ok: false, erro: 'Conversa não encontrada.' };
    if (data.versao_ferramentas !== VERSAO_AJUDA) return { ok: false, erro: 'O assistente foi atualizado desde esta conversa. Comece uma nova (esta continua salva para leitura).' };
    conversa = { id: data.id, historico: data.historico || [], exibicao: data.exibicao || [], tokens_entrada: Number(data.tokens_entrada) || 0, tokens_saida: Number(data.tokens_saida) || 0, custo_usd: Number(data.custo_usd) || 0 };
    if (conversa.exibicao.filter(i => i.papel === 'user').length >= MAX_PERGUNTAS) return { ok: false, erro: `Esta conversa chegou a ${MAX_PERGUNTAS} perguntas. Comece uma nova.` };
  }

  const manual = entrada.manualAberto ? manuaisVisiveis(usuario.permissao).find(m => m.slug === entrada.manualAberto) : null;
  const contexto = `[Contexto: permissão do usuário: ${usuario.permissao}. ${manual ? `Ele está lendo o manual "${manual.titulo}" (slug ${manual.slug}).` : 'Ele está na lista de manuais.'}]`;
  const mensagens: Mensagem[] = [...(conversa?.historico || []), { role: 'user', content: [{ type: 'text', text: `${contexto}\n\n${pergunta}` }] }];
  const ctx: Ctx = { permissao: usuario.permissao, podeRota: await rotasPermitidas(db, usuario.permissao), links: new Map() };
  const client = new Anthropic({ apiKey });
  let tokensEntrada = 0, tokensSaida = 0, custoTurno = 0;
  let resposta = '';

  try {
    for (let i = 0; i < MAX_ITERACOES; i++) {
      const ultima = i === MAX_ITERACOES - 1;
      const r = await client.beta.messages.create({
        model: MODELO_DIRETORIA,
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        system: INSTRUCOES,
        tools: DEFINICOES,
        messages: mensagens,
      });
      tokensEntrada += r.usage.input_tokens + (r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0);
      tokensSaida += r.usage.output_tokens;
      custoTurno += custoTokens(r.usage);

      if (r.stop_reason === 'refusal') return { ok: false, erro: 'O assistente não pôde responder a esta pergunta. Tente reformular.' };
      const conteudo = paraHistorico(r.content);
      if (!conteudo.length) return { ok: false, erro: 'Resposta vazia. Tente de novo.' };
      mensagens.push({ role: 'assistant', content: conteudo as Anthropic.Beta.BetaContentBlockParam[] });

      if (r.stop_reason === 'pause_turn') continue;
      const chamadas = conteudo.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !chamadas.length) {
        resposta = conteudo.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim().replace(/\*\*(.+?)\*\*/g, '$1');
        if (r.stop_reason === 'max_tokens') resposta += '\n\n(Resposta cortada por ser longa demais.)';
        break;
      }
      const resultados = await Promise.all(chamadas.map(async c => {
        if (ultima) return { type: 'tool_result' as const, tool_use_id: c.id, is_error: true, content: 'Limite de consultas atingido. Responda com o que já tem.' };
        const res = await executar(c.name, (c.input || {}) as Record<string, unknown>, ctx);
        return { type: 'tool_result' as const, tool_use_id: c.id, is_error: res.erro || undefined, content: res.conteudo };
      }));
      mensagens.push({ role: 'user', content: resultados });
      if (ultima) resposta = 'Não consegui concluir dentro do limite de consultas. Tente uma pergunta mais específica.';
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, erro: 'Chave do Claude inválida.' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, erro: 'Muitas perguntas ao mesmo tempo. Tente de novo em alguns minutos.' };
    if (e instanceof Anthropic.BadRequestError) {
      if (/credit balance/i.test(e.message)) return { ok: false, erro: 'A conta da Anthropic está sem créditos.' };
      return { ok: false, erro: `A IA recusou o pedido: ${e.message}` };
    }
    if (e instanceof Anthropic.APIError) return { ok: false, erro: `Erro na IA (${e.status}): ${e.message}` };
    return { ok: false, erro: `Falha ao responder: ${e instanceof Error ? e.message : String(e)}` };
  }

  const agora = new Date().toISOString();
  const item: ItemAjuda = { papel: 'assistant', texto: resposta || '(sem resposta)', em: agora, links: [...ctx.links.values()], custo_usd: Math.round(custoTurno * 10000) / 10000 };
  const exibicao = [...(conversa?.exibicao || []), { papel: 'user' as const, texto: pergunta, em: agora }, item];
  const linha = {
    historico: mensagens, exibicao,
    tokens_entrada: (conversa?.tokens_entrada || 0) + tokensEntrada,
    tokens_saida: (conversa?.tokens_saida || 0) + tokensSaida,
    custo_usd: Math.round(((conversa?.custo_usd || 0) + custoTurno) * 10000) / 10000,
    atualizado_em: agora,
  };
  if (conversa) {
    const { error } = await db.from('manuais_conversas').update(linha).eq('id', conversa.id).eq('perfil_id', usuario.id);
    if (error) return { ok: false, erro: `Resposta não foi gravada: ${error.message}` };
    return { ok: true, conversaId: conversa.id, resposta: item };
  }
  const { data: criada, error } = await db.from('manuais_conversas').insert({
    ...linha, perfil_id: usuario.id, usuario_nome: usuario.nome, versao_ferramentas: VERSAO_AJUDA,
    titulo: pergunta.length > 60 ? `${pergunta.slice(0, 57)}…` : pergunta,
  }).select('id').single();
  if (error || !criada) return { ok: false, erro: /manuais_conversas/.test(error?.message || '') ? 'Falta rodar o SQL do assistente (.sql/Pendentes/manuais_assistente.sql).' : `Conversa não foi gravada: ${error?.message}` };
  return { ok: true, conversaId: criada.id, resposta: item };
}
