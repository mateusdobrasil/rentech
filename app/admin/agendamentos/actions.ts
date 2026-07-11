'use server';

// Server actions da tela de Agendamentos e Disparos, com service role.
// A tabela folha_automacoes é o "disjuntor": o Cron (app/api/cron/*) lê o
// campo `ativo` antes de disparar qualquer mensagem. Desligar aqui impede
// o envio sem precisar mexer em código ou na Vercel.
import { supabaseAdmin } from '../../lib/supabase';

export interface RotinaAutomacaoDB {
  id: number;
  chave: string;
  nome: string;
  descricao: string | null;
  tipo: 'CRON' | 'WEBHOOK';
  gatilho: string | null;
  canais: string[];
  publico_alvo: string | null;
  ativo: boolean;
  ultima_execucao: string | null;
  destinatarios: string[];
}

export interface FormAutomacao {
  nome: string;
  descricao: string;
  tipo: 'CRON' | 'WEBHOOK';
  gatilho: string;
  canais: string[];
  publico_alvo: string;
  destinatarios: string[]; // nome_completo dos funcionários; vazio = todos os ativos
}

export interface FuncionarioParaAutomacao {
  nome_completo: string;
  cargo: string | null;
}

type Resultado<T = undefined> = { ok: boolean; erro?: string; data?: T };

const slugify = (texto: string) =>
  texto
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export async function listarAutomacoesAction(): Promise<Resultado<RotinaAutomacaoDB[]>> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_automacoes')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return { ok: true, data: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Lista os funcionários ativos disponíveis para seleção como destinatários,
// agrupáveis por cargo (não há uma coluna de "departamento" na tabela).
export async function listarFuncionariosParaAutomacaoAction(): Promise<Resultado<FuncionarioParaAutomacao[]>> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_funcionarios')
      .select('nome_completo, cargo')
      .eq('ativo', true)
      .order('cargo', { ascending: true })
      .order('nome_completo', { ascending: true });
    if (error) throw new Error(error.message);
    return { ok: true, data: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function alternarStatusAutomacaoAction(id: number, ativo: boolean): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_automacoes').update({ ativo }).eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Gera uma `chave` (identificador técnico estável, lido pelo Cron) a partir do
// nome digitado, garantindo unicidade com um sufixo numérico se necessário.
async function gerarChaveUnica(db: ReturnType<typeof supabaseAdmin>, nome: string): Promise<string> {
  const base = slugify(nome) || 'automacao';
  let candidata = base;
  let sufixo = 2;
  while (true) {
    const { data } = await db.from('folha_automacoes').select('id').eq('chave', candidata).maybeSingle();
    if (!data) return candidata;
    candidata = `${base}-${sufixo}`;
    sufixo++;
  }
}

export async function criarAutomacaoAction(payload: FormAutomacao): Promise<Resultado<{ chave: string }>> {
  const db = supabaseAdmin();
  const nome = payload.nome.trim();
  if (!nome) return { ok: false, erro: 'Informe o nome da automação.' };
  if (!payload.canais || payload.canais.length === 0) return { ok: false, erro: 'Selecione ao menos um canal de disparo.' };

  try {
    const chave = await gerarChaveUnica(db, nome);
    const { error } = await db.from('folha_automacoes').insert({
      chave,
      nome,
      descricao: payload.descricao?.trim() || null,
      tipo: payload.tipo,
      gatilho: payload.gatilho?.trim() || null,
      canais: payload.canais,
      publico_alvo: payload.publico_alvo?.trim() || null,
      destinatarios: payload.destinatarios || [],
      ativo: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { chave } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Atualiza os dados descritivos da automação. A `chave` nunca é alterada aqui:
// ela é o vínculo estável usado pela rota de Cron correspondente.
export async function atualizarAutomacaoAction(id: number, payload: FormAutomacao): Promise<Resultado> {
  const db = supabaseAdmin();
  const nome = payload.nome.trim();
  if (!nome) return { ok: false, erro: 'Informe o nome da automação.' };
  if (!payload.canais || payload.canais.length === 0) return { ok: false, erro: 'Selecione ao menos um canal de disparo.' };

  try {
    const { error } = await db.from('folha_automacoes').update({
      nome,
      descricao: payload.descricao?.trim() || null,
      tipo: payload.tipo,
      gatilho: payload.gatilho?.trim() || null,
      canais: payload.canais,
      publico_alvo: payload.publico_alvo?.trim() || null,
      destinatarios: payload.destinatarios || [],
    }).eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function excluirAutomacaoAction(id: number): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_automacoes').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
