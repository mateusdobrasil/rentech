'use server';

// Assistente dos Manuais (2026-11-24): quem acessa /admin/manuais pode
// perguntar. Cada conversa é só de quem a criou. O assistente não lê dados da
// empresa — ver app/lib/ajuda/assistente.ts.
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso } from '../../lib/serverAuth';
import { perguntarAjuda, type ItemAjuda } from '../../lib/ajuda/assistente';

const ROTA = '/admin/manuais';
type Resultado<T> = { ok: boolean; erro?: string; info?: T };
const semSql = (m: string) => (/manuais_conversas/.test(m) ? 'Falta rodar o SQL do assistente (.sql/Pendentes/manuais_assistente.sql).' : m);

export interface ConversaAjudaResumo { id: string; titulo: string; atualizado_em: string }

export async function listarConversasAjudaAction(accessToken: string): Promise<Resultado<ConversaAjudaResumo[]>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { data, error } = await supabaseAdmin().from('manuais_conversas').select('id, titulo, atualizado_em')
    .eq('perfil_id', acesso.perfil.id).order('atualizado_em', { ascending: false }).limit(30);
  if (error) return { ok: false, erro: semSql(error.message) };
  return { ok: true, info: (data || []) as ConversaAjudaResumo[] };
}

export async function obterConversaAjudaAction(id: string, accessToken: string): Promise<Resultado<{ id: string; titulo: string; exibicao: ItemAjuda[] }>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { data, error } = await supabaseAdmin().from('manuais_conversas').select('id, titulo, exibicao').eq('id', id).eq('perfil_id', acesso.perfil.id).maybeSingle();
  if (error) return { ok: false, erro: semSql(error.message) };
  if (!data) return { ok: false, erro: 'Conversa não encontrada.' };
  return { ok: true, info: data as { id: string; titulo: string; exibicao: ItemAjuda[] } };
}

export async function perguntarAjudaAction(payload: { conversaId: string | null; pergunta: string; manualAberto: string | null }, accessToken: string): Promise<Resultado<{ conversaId: string; resposta: ItemAjuda }>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const r = await perguntarAjuda(supabaseAdmin(), { id: acesso.perfil.id, nome: acesso.perfil.nome, permissao: acesso.perfil.permissaoNormalizada }, {
    conversaId: payload.conversaId || null,
    pergunta: String(payload.pergunta || ''),
    manualAberto: payload.manualAberto ? String(payload.manualAberto).slice(0, 80) : null,
  });
  return r.ok && r.conversaId && r.resposta ? { ok: true, info: { conversaId: r.conversaId, resposta: r.resposta } } : { ok: false, erro: r.erro };
}

export async function excluirConversaAjudaAction(id: string, accessToken: string): Promise<Resultado<null>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { error } = await supabaseAdmin().from('manuais_conversas').delete().eq('id', id).eq('perfil_id', acesso.perfil.id);
  if (error) return { ok: false, erro: semSql(error.message) };
  return { ok: true, info: null };
}
