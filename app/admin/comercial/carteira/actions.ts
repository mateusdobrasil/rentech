'use server';

// app/admin/comercial/carteira/actions.ts
// Carteira de clientes (2026-11-17): cada cliente tem um vendedor responsável.
// O vendedor padrão (escopo CARTEIRA, em Permissões → Locação) só vê as fichas
// dos clientes dele. Carteira inicial: quem mais atendeu o cliente (SQL
// comercial_carteira_comissoes.sql); cliente novo entra na carteira de quem
// faz a primeira ficha (aqui ou importada do P2S).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { buscarTodasPaginas } from '../../../lib/paginacao';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/comercial/carteira';
const POR_PAGINA = 50;
const limpar = (s: string) => (s || '').replace(/[%_,()]/g, ' ').trim();

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  return { perfil: v.perfil } as const;
}

async function vendedores() {
  const { data, error } = await supabaseAdmin().from('colaboradores').select('id, nome_exibicao, nome_completo, status_colaborador').eq('flag_vendedor_rep', true).order('nome_exibicao');
  if (error) throw error;
  return ((data || []) as any[]).map(v => ({ id: v.id as number, nome: String(v.nome_exibicao || v.nome_completo || '').trim(), ativo: v.status_colaborador === 'A' }));
}

export async function resumoCarteiraAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const [vend, { data: linhas, error }, { count: totalClientes }] = await Promise.all([
      vendedores(),
      buscarTodasPaginas<any>((de, ate) => db.from('comercial_carteira_clientes').select('vendedor_id').order('parceiro_id').range(de, ate), 1000, 100000),
      db.from('parceiros').select('id', { count: 'exact', head: true }).eq('flag_cliente', true),
    ]);
    if (error) throw error;
    const porVendedor: Record<number, number> = {};
    for (const l of linhas) porVendedor[l.vendedor_id] = (porVendedor[l.vendedor_id] || 0) + 1;
    return { ok: true, info: { vendedores: vend, porVendedor, naCarteira: linhas.length, totalClientes: totalClientes || 0 } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function listarCarteiraAction(f: { busca: string; vendedor: number | 'SEM' | null; pagina: number }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const de = Math.max(0, f.pagina) * POR_PAGINA;
    const embed = typeof f.vendedor === 'number' ? 'carteira:comercial_carteira_clientes!inner(vendedor_id, origem, definido_por, definido_em)' : 'carteira:comercial_carteira_clientes(vendedor_id, origem, definido_por, definido_em)';
    let q = db.from('parceiros')
      .select(`id, nome_exibicao, nome_completo, cidade1, estado1, ${embed}`, { count: 'exact' })
      .eq('flag_cliente', true);
    if (typeof f.vendedor === 'number') q = q.eq('carteira.vendedor_id', f.vendedor);
    if (f.vendedor === 'SEM') q = q.is('carteira', null);
    const t = limpar(f.busca);
    if (t.length >= 2) q = q.or(`nome_exibicao.ilike.%${t}%,nome_completo.ilike.%${t}%`);
    const { data, error, count } = await q.order('nome_exibicao').range(de, de + POR_PAGINA - 1);
    if (error) throw error;
    const clientes = ((data || []) as any[]).map(p => {
      const c = Array.isArray(p.carteira) ? p.carteira[0] : p.carteira;
      return {
        id: p.id, nome: p.nome_exibicao || p.nome_completo, razao: p.nome_completo !== p.nome_exibicao ? p.nome_completo : null,
        cidade: [p.cidade1, p.estado1].filter(Boolean).join('/'),
        vendedor_id: c?.vendedor_id ?? null, origem: c?.origem ?? null, definido_por: c?.definido_por ?? null, definido_em: c?.definido_em ?? null,
      };
    });
    return { ok: true, info: { clientes, total: count || 0, porPagina: POR_PAGINA } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Põe os clientes na carteira do vendedor (null = tira da carteira). */
export async function definirVendedorClientesAction(parceiroIds: number[], vendedorId: number | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const ids = [...new Set(parceiroIds.filter(x => Number.isInteger(x) && x > 0))];
  if (!ids.length) return { ok: false, erro: 'Nenhum cliente selecionado.' };
  if (ids.length > 2000) return { ok: false, erro: 'Selecione até 2.000 clientes por vez.' };
  const db = supabaseAdmin();
  try {
    let nome = 'sem carteira';
    if (vendedorId) {
      const v = (await vendedores()).find(x => x.id === vendedorId);
      if (!v || !v.ativo) return { ok: false, erro: 'Vendedor inválido ou inativo.' };
      nome = v.nome;
      const linhas = ids.map(parceiro_id => ({ parceiro_id, vendedor_id: vendedorId, origem: 'MANUAL', definido_por: ctx.perfil.nome, definido_em: new Date().toISOString() }));
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await db.from('comercial_carteira_clientes').upsert(linhas.slice(i, i + 500), { onConflict: 'parceiro_id' });
        if (error) throw error;
      }
    } else {
      for (let i = 0; i < ids.length; i += 300) {
        const { error } = await db.from('comercial_carteira_clientes').delete().in('parceiro_id', ids.slice(i, i + 300));
        if (error) throw error;
      }
    }
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'ALTEROU CARTEIRA DE CLIENTES', setor: 'COMERCIAL', equipamento_nome: `${ids.length} cliente(s) → ${nome}` });
    return { ok: true, info: { qtd: ids.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Passa a carteira inteira de um vendedor para outro (ex.: vendedor saiu). */
export async function transferirCarteiraAction(deVendedorId: number, paraVendedorId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!deVendedorId || !paraVendedorId || deVendedorId === paraVendedorId) return { ok: false, erro: 'Escolha dois vendedores diferentes.' };
  const db = supabaseAdmin();
  try {
    const vend = await vendedores();
    const de = vend.find(v => v.id === deVendedorId), para = vend.find(v => v.id === paraVendedorId);
    if (!de || !para || !para.ativo) return { ok: false, erro: 'Vendedor inválido ou inativo.' };
    const { data, error } = await db.from('comercial_carteira_clientes')
      .update({ vendedor_id: paraVendedorId, origem: 'MANUAL', definido_por: ctx.perfil.nome, definido_em: new Date().toISOString() })
      .eq('vendedor_id', deVendedorId).select('parceiro_id');
    if (error) throw error;
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'TRANSFERIU CARTEIRA DE CLIENTES', setor: 'COMERCIAL', equipamento_nome: `${data?.length || 0} cliente(s): ${de.nome} → ${para.nome}` });
    return { ok: true, info: { qtd: data?.length || 0 } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
