// app/lib/cofre/segredos.ts
// Cofre de credenciais — SÓ SERVIDOR (usa a chave do service role e a chave
// mestra). Ninguém fora deste arquivo vê o valor cifrado nem a chave.
//
// Leitura: segredo(nome, empresaId?) procura, nesta ordem:
//   1. o cofre da empresa (quando empresaId vem);
//   2. o cofre Sistema (todas as empresas);
//   3. sem empresaId: o cofre da ÚNICA empresa que tem esse nome (ex.: a conta
//      do Itaú é só da Rentech) — com duas empresas, quem chama passa o id;
//   4. a variável de ambiente (Vercel) com o mesmo nome, ou uma das alternativas.
// Cache de 60 s por instância: trocar um valor na tela vale em até 1 minuto
// em todas as instâncias (e na hora nesta, que limpa o próprio cache).
//
// Cifra: AES-256-GCM, IV aleatório de 12 bytes, e o texto cifrado amarrado ao
// escopo + nome (AAD): copiar o valor de uma linha para outra não decifra.
// Chave: COFRE_CHAVE_MESTRA (32 bytes em base64), igual em TODO ambiente que
// usa este banco — se mudar, os valores gravados deixam de abrir.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../supabase';
import { CAMPOS_COFRE } from './catalogo';

type Db = ReturnType<typeof supabaseAdmin>;
const VERSAO = 'v1';
const TTL_MS = 60_000;

function chaveMestra(): Buffer | null {
  const b64 = (process.env.COFRE_CHAVE_MESTRA || '').trim();
  if (!b64) return null;
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('COFRE_CHAVE_MESTRA inválida: precisa ter 32 bytes em base64.');
  return k;
}
export const cofreDisponivel = () => { try { return !!chaveMestra(); } catch { return false; } };

const aad = (empresaId: number | null, nome: string) => Buffer.from(`${empresaId ?? 'SISTEMA'}|${nome}`, 'utf8');

export function cifrar(valor: string, empresaId: number | null, nome: string): string {
  const k = chaveMestra();
  if (!k) throw new Error('O cofre ainda não foi ativado: falta a variável COFRE_CHAVE_MESTRA na Vercel.');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(aad(empresaId, nome));
  const corpo = Buffer.concat([c.update(valor, 'utf8'), c.final()]);
  return `${VERSAO}:${Buffer.concat([iv, c.getAuthTag(), corpo]).toString('base64')}`;
}

export function decifrar(texto: string, empresaId: number | null, nome: string): string {
  const k = chaveMestra();
  if (!k) throw new Error('Falta a variável COFRE_CHAVE_MESTRA no servidor.');
  const [versao, b64] = texto.split(':');
  if (versao !== VERSAO || !b64) throw new Error('Formato do cofre desconhecido.');
  const bruto = Buffer.from(b64, 'base64');
  const d = createDecipheriv('aes-256-gcm', k, bruto.subarray(0, 12));
  d.setAAD(aad(empresaId, nome));
  d.setAuthTag(bruto.subarray(12, 28));
  return Buffer.concat([d.update(bruto.subarray(28)), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Leitura com cache
// ---------------------------------------------------------------------------
interface LinhaCofre { id: number; empresa_id: number | null; nome: string; valor_cifrado: string; dica: string | null; metadados: Record<string, unknown>; atualizado_em: string; atualizado_por: string | null }
let cache: { em: number; linhas: LinhaCofre[] } | null = null;
const decifrados = new Map<number, string>();

export function limparCacheCofre() { cache = null; decifrados.clear(); }

async function linhasCofre(db?: Db): Promise<LinhaCofre[]> {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.linhas;
  const { data, error } = await (db || supabaseAdmin()).from('parametros_cofre')
    .select('id, empresa_id, nome, valor_cifrado, dica, metadados, atualizado_em, atualizado_por');
  // sem o SQL ainda (ou falha pontual): segue só com a Vercel, sem derrubar ninguém
  const linhas = error ? [] : ((data || []) as LinhaCofre[]);
  cache = { em: Date.now(), linhas };
  decifrados.clear();
  return linhas;
}

function abrir(l: LinhaCofre): string | undefined {
  if (decifrados.has(l.id)) return decifrados.get(l.id);
  try {
    const v = decifrar(l.valor_cifrado, l.empresa_id, l.nome);
    decifrados.set(l.id, v);
    return v;
  } catch (e) {
    console.error(`[cofre] não abriu ${l.nome} (${l.empresa_id ?? 'SISTEMA'}):`, (e as Error).message);
    return undefined;
  }
}

export type OrigemSegredo = 'EMPRESA' | 'SISTEMA' | 'OUTRA_EMPRESA' | 'VERCEL' | null;

/** Onde está o valor e qual é ele (não exportar o valor para fora do servidor). */
export async function resolverSegredo(nome: string, empresaId?: number | null): Promise<{ valor: string | undefined; origem: OrigemSegredo }> {
  const linhas = await linhasCofre();
  const doNome = linhas.filter(l => l.nome === nome);
  if (empresaId != null) {
    const l = doNome.find(x => x.empresa_id === empresaId);
    const v = l && abrir(l);
    if (v) return { valor: v, origem: 'EMPRESA' };
  }
  const sis = doNome.find(x => x.empresa_id === null);
  const vs = sis && abrir(sis);
  if (vs) return { valor: vs, origem: 'SISTEMA' };
  if (empresaId == null) {
    const deEmpresas = doNome.filter(x => x.empresa_id !== null);
    if (deEmpresas.length === 1) {
      const v = abrir(deEmpresas[0]);
      if (v) return { valor: v, origem: 'OUTRA_EMPRESA' };
    }
  }
  for (const n of [nome, ...(CAMPOS_COFRE.get(nome)?.campo.alternativas || [])]) {
    const v = process.env[n];
    if (v) return { valor: v, origem: 'VERCEL' };
  }
  return { valor: undefined, origem: null };
}

/** Valor do segredo (cofre → Vercel). undefined = não configurado. */
export async function segredo(nome: string, empresaId?: number | null): Promise<string | undefined> {
  return (await resolverSegredo(nome, empresaId)).valor;
}

/** Vários de uma vez: { NOME: valor }. */
export async function segredos<T extends string>(nomes: readonly T[], empresaId?: number | null): Promise<Record<T, string | undefined>> {
  const saida = {} as Record<T, string | undefined>;
  for (const n of nomes) saida[n] = await segredo(n, empresaId);
  return saida;
}

/** Linhas do cofre de um escopo, SEM o valor (para a tela). */
export async function situacaoCofre(db: Db, empresaId: number | null) {
  limparCacheCofre();
  const linhas = await linhasCofre(db);
  return linhas.filter(l => l.empresa_id === empresaId).map(l => ({ nome: l.nome, dica: l.dica, metadados: l.metadados, atualizado_em: l.atualizado_em, atualizado_por: l.atualizado_por }));
}

/** Grava (ou troca) um valor no cofre. `dica` e `metadados` ficam legíveis na tela. */
export async function gravarNoCofre(db: Db, p: { empresaId: number | null; nome: string; valor: string; dica: string | null; metadados?: Record<string, unknown>; usuario: string }) {
  if (!CAMPOS_COFRE.has(p.nome)) throw new Error('Campo do cofre desconhecido.');
  const valor_cifrado = cifrar(p.valor, p.empresaId, p.nome);
  const sel = db.from('parametros_cofre').select('id').eq('nome', p.nome);
  const { data: existe, error: eSel } = await (p.empresaId === null ? sel.is('empresa_id', null) : sel.eq('empresa_id', p.empresaId)).maybeSingle();
  if (eSel) throw new Error(/parametros_cofre/.test(eSel.message) ? 'Falta rodar o SQL do cofre (.sql/Pendentes/empresas_cadastro_completo_e_cofre.sql).' : eSel.message);
  const linha = { empresa_id: p.empresaId, nome: p.nome, valor_cifrado, dica: p.dica, metadados: p.metadados || {}, atualizado_em: new Date().toISOString(), atualizado_por: p.usuario };
  const { error } = existe
    ? await db.from('parametros_cofre').update(linha).eq('id', existe.id)
    : await db.from('parametros_cofre').insert(linha);
  if (error) throw new Error(error.message);
  limparCacheCofre();
}

export async function removerDoCofre(db: Db, empresaId: number | null, nome: string) {
  const q = db.from('parametros_cofre').delete().eq('nome', nome);
  const { error } = await (empresaId === null ? q.is('empresa_id', null) : q.eq('empresa_id', empresaId));
  if (error) throw new Error(error.message);
  limparCacheCofre();
}
