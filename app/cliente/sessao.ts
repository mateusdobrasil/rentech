// app/cliente/sessao.ts
// Sessão do Portal do Cliente (2026-11-17) — SEM "use server" (helpers
// internos, importados só pelas actions). Identidade separada do admin:
// cookie httpOnly com token aleatório; no banco só o hash (sha256 + segredo).
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { supabaseAdmin } from '../lib/supabase';

export const COOKIE = 'rt_cliente';
export const DIAS_SESSAO = 7;
// Chaves da fase paralela (P2S oficial) — ligar na virada: "1" mostra.
export const MOSTRAR_P2S = process.env.PORTAL_CLIENTE_MOSTRAR_P2S === '1';
export const MOSTRAR_TITULOS = process.env.PORTAL_CLIENTE_MOSTRAR_TITULOS === '1';

const segredo = () => process.env.PORTAL_CLIENTE_SEGREDO || process.env.SUPABASE_SERVICE_ROLE_KEY || 'rentech-portal-cliente';
export const hash = (s: string) => createHash('sha256').update(`${s}|${segredo()}`).digest('hex');
export const novoToken = () => randomBytes(32).toString('base64url');
export const novoCodigo = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const normalizarEmail = (e: string) => (e || '').trim().toLowerCase();
export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

export async function ipDaRequisicao(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim() || 'desconhecido';
}

export async function parceirosDoEmail(email: string): Promise<number[]> {
  const { data, error } = await supabaseAdmin().rpc('portal_cliente_parceiros', { p_email: email });
  if (error) throw error;
  return [...new Set(((data || []) as any[]).map(r => Number(r.parceiro_id)).filter(Boolean))];
}

export async function criarSessao(email: string): Promise<void> {
  const token = novoToken();
  const h = await headers();
  const expira = new Date(Date.now() + DIAS_SESSAO * 86400_000);
  const { error } = await supabaseAdmin().from('cliente_portal_sessoes').insert({
    token_hash: hash(token), email, expira_em: expira.toISOString(), ip: await ipDaRequisicao(), user_agent: (h.get('user-agent') || '').slice(0, 300),
  });
  if (error) throw error;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: DIAS_SESSAO * 86400,
  });
}

/** Sessão válida → e-mail + clientes (parceiros) que ele enxerga; senão null. */
export async function sessaoAtual(): Promise<{ email: string; parceiros: number[] } | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = supabaseAdmin();
  const { data: s } = await db.from('cliente_portal_sessoes').select('id, email, expira_em').eq('token_hash', hash(token)).maybeSingle();
  if (!s || new Date(s.expira_em).getTime() < Date.now()) return null;
  await db.from('cliente_portal_sessoes').update({ ultimo_acesso: new Date().toISOString() }).eq('id', s.id);
  const parceiros = await parceirosDoEmail(s.email);
  if (!parceiros.length) return null;
  return { email: s.email, parceiros };
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await supabaseAdmin().from('cliente_portal_sessoes').delete().eq('token_hash', hash(token));
  jar.delete(COOKIE);
}
