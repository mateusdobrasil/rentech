// app/lib/locacao/acessoFichas.ts
// Acesso de cada usuário às fichas de locação (2026-11-17):
//   - escopo TODAS (gestão) ou CARTEIRA (vendedor padrão: só as fichas dos
//     clientes da própria carteira — comercial_carteira_clientes);
//   - criar / editar / excluir (cancelar, perder, apagar orçamento);
//   - desconto máximo e quem aprova acima dele.
// Gravado em locacao_acesso_usuarios (Permissões → editar usuário → Locação).
// Administrador global sempre tem tudo. Usuário sem linha = vendedor padrão
// sem vendedor vinculado (não vê ficha nenhuma até o Administrador configurar).
// SEM validação de sessão — quem chama já validou a rota.
import type { supabaseAdmin } from '../supabase';
import type { PerfilValidado } from '../serverAuth';
import { ehAdministradorGlobal } from '../permissoes';

type Db = ReturnType<typeof supabaseAdmin>;

export interface AcessoLocacao {
  admin: boolean;
  vendedorId: number | null;
  vendedorNome: string | null;
  escopo: 'TODAS' | 'CARTEIRA';
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  descontoMaxPct: number;
  podeAprovarDesconto: boolean;
}

export const ACESSO_PADRAO_VENDEDOR: Omit<AcessoLocacao, 'admin' | 'vendedorId' | 'vendedorNome'> = {
  escopo: 'CARTEIRA', podeCriar: true, podeEditar: true, podeExcluir: false, descontoMaxPct: 0, podeAprovarDesconto: false,
};

export async function acessoLocacao(db: Db, perfil: PerfilValidado): Promise<AcessoLocacao> {
  const admin = ehAdministradorGlobal(perfil.permissaoBruta);
  const { data } = await db.from('locacao_acesso_usuarios')
    .select('*, vendedor:colaboradores(nome_exibicao, nome_completo)').eq('perfil_id', perfil.id).maybeSingle();
  const r = data as any;
  const vendedorId = r?.vendedor_id ?? null;
  const vendedorNome = r?.vendedor ? (r.vendedor.nome_exibicao || r.vendedor.nome_completo || '').trim() : null;
  if (admin) {
    return { admin, vendedorId, vendedorNome, escopo: 'TODAS', podeCriar: true, podeEditar: true, podeExcluir: true, descontoMaxPct: 100, podeAprovarDesconto: true };
  }
  if (!r) return { admin, vendedorId: null, vendedorNome: null, ...ACESSO_PADRAO_VENDEDOR };
  return {
    admin, vendedorId, vendedorNome,
    escopo: r.escopo_fichas === 'TODAS' ? 'TODAS' : 'CARTEIRA',
    podeCriar: !!r.pode_criar, podeEditar: !!r.pode_editar, podeExcluir: !!r.pode_excluir,
    descontoMaxPct: Number(r.desconto_max_pct) || 0, podeAprovarDesconto: !!r.pode_aprovar_desconto,
  };
}

/** Vendedor responsável (carteira) de cada cliente. */
export async function donosCarteira(db: Db, parceiroIds: number[]): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  const unicos = [...new Set(parceiroIds.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 300) {
    const { data, error } = await db.from('comercial_carteira_clientes').select('parceiro_id, vendedor_id').in('parceiro_id', unicos.slice(i, i + 300));
    if (error) throw error;
    for (const r of (data || []) as any[]) mapa.set(r.parceiro_id, r.vendedor_id);
  }
  return mapa;
}

/** Clientes da carteira de um vendedor (lista completa). */
export async function clientesDaCarteira(db: Db, vendedorId: number | null): Promise<number[]> {
  if (!vendedorId) return [];
  const ids: number[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from('comercial_carteira_clientes').select('parceiro_id').eq('vendedor_id', vendedorId).order('parceiro_id').range(de, de + 999);
    if (error) throw error;
    ids.push(...((data || []) as any[]).map(r => r.parceiro_id as number));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

/** O usuário enxerga as fichas deste cliente? (TODAS: sempre; CARTEIRA: cliente da carteira dele) */
export async function podeVerCliente(db: Db, acesso: AcessoLocacao, parceiroId: number): Promise<boolean> {
  if (acesso.escopo === 'TODAS') return true;
  if (!acesso.vendedorId) return false;
  const dono = (await donosCarteira(db, [parceiroId])).get(parceiroId);
  return dono === acesso.vendedorId;
}

/**
 * Pode fazer ficha para este cliente? CARTEIRA: cliente dele ou sem carteira
 * (aí o cliente entra na carteira dele ao salvar). Devolve o motivo quando não.
 */
export async function podeAtenderCliente(db: Db, acesso: AcessoLocacao, parceiroId: number): Promise<{ ok: true; dono: number | null } | { ok: false; erro: string }> {
  const dono = (await donosCarteira(db, [parceiroId])).get(parceiroId) ?? null;
  if (acesso.escopo === 'TODAS') return { ok: true, dono };
  if (!acesso.vendedorId) return { ok: false, erro: MSG_SEM_VENDEDOR };
  if (dono !== null && dono !== acesso.vendedorId) return { ok: false, erro: 'Este cliente é da carteira de outro vendedor.' };
  return { ok: true, dono };
}

export const MSG_SEM_VENDEDOR = 'Seu usuário não está ligado a um vendedor. Peça ao Administrador (Parâmetros → Permissões → seu usuário → Locação).';

/** Desconto que já nasce aprovado: dentro do limite do usuário, ou quem salva pode aprovar. */
export const descontoAutoAprovado = (acesso: AcessoLocacao, pct: number) =>
  pct <= acesso.descontoMaxPct + 0.005 || acesso.podeAprovarDesconto;

/** Vendedores ativos (colaboradores do P2S marcados como vendedor). */
export async function vendedoresAtivos(db: Db): Promise<{ id: number; nome: string }[]> {
  const { data, error } = await db.from('colaboradores').select('id, nome_exibicao, nome_completo')
    .eq('flag_vendedor_rep', true).eq('status_colaborador', 'A').order('nome_exibicao');
  if (error) throw error;
  return ((data || []) as any[]).map(v => ({ id: v.id as number, nome: String(v.nome_exibicao || v.nome_completo || '').trim() }));
}

/** O que a tela precisa saber das permissões (sem dados internos). */
export const acessoParaTela = (a: AcessoLocacao) => ({
  escopo: a.escopo, vendedorId: a.vendedorId, vendedorNome: a.vendedorNome,
  podeCriar: a.podeCriar, podeEditar: a.podeEditar, podeExcluir: a.podeExcluir,
  descontoMaxPct: a.descontoMaxPct, podeAprovarDesconto: a.podeAprovarDesconto,
});
export type AcessoTela = ReturnType<typeof acessoParaTela>;

/** Põe o cliente na carteira do vendedor se ainda não tiver dono (não troca dono existente). */
export async function assumirClienteSemCarteira(db: Db, parceiroId: number, vendedorId: number | null, quem: string, origem: 'PRIMEIRA_FICHA' | 'MANUAL' = 'PRIMEIRA_FICHA') {
  if (!vendedorId) return;
  await db.from('comercial_carteira_clientes')
    .upsert({ parceiro_id: parceiroId, vendedor_id: vendedorId, origem, definido_por: quem }, { onConflict: 'parceiro_id', ignoreDuplicates: true });
}

export const MSG_FICHA_FORA_CARTEIRA = 'Esta ficha é de um cliente de outro vendedor.';
