'use server';

// app/admin/op/actions-naturezas.ts
// Catálogo de "Natureza do Pagamento" da OP + Classificação Financeira
// (Centro de Custo/Receita + Sub-Centro) enviada ao PrimeStart ao lançar a
// Conta a Pagar (ver criarContaPagarParaOP em
// app/admin/financeiro/ops/enviarOpP2sCore.ts). Tabela: op_naturezas_pagamento
// (ver .sql/op_naturezas_pagamento.sql).
//
// Validação de sessão/permissão (+ 2FA da rota, se ela exigir) pelo
// serverAuth central — o mesmo do resto do sistema.
import { revalidatePath } from 'next/cache';
import { registrarLogAuditoria } from '../../actions';
import { supabaseAdmin } from '../../lib/supabase';
import { validarAcesso, validarAcessoAlgumaRota } from '../../lib/serverAuth';
import { consultarObjetos, criterioRef, type AmbienteP2s } from '../../lib/p2s';
import { importarPlanoContasP2s, criarCentroLocal, criarSubcentroLocal } from '../../lib/financeiro/planoContas';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/op/naturezas';

async function validarAcessoGestao(accessToken: string) {
  return validarAcesso(accessToken, ROTA);
}

export interface NaturezaPagamento {
  id: number;
  natureza: string;
  tipo_classificacao: 'CUSTO' | 'RECEITA';
  centro_financeiro_oid: string | null;
  centro_financeiro_nome: string | null;
  subcentro_financeiro_oid: string | null;
  subcentro_financeiro_nome: string | null;
  ordem: number;
}

// Listagem completa, com a classificação — usada pela tela de gestão
// (/admin/op/naturezas).
export async function listarNaturezasPagamentoAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { data, error } = await db.from('op_naturezas_pagamento').select('*').order('natureza');
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: { naturezas: data || [] } };
}

// Listagem enxuta (só o nome), usada pelo <select> de Natureza do Pagamento
// em /admin/op/nova e na edição de /admin/op/responsavel — validada contra
// QUALQUER uma dessas duas rotas (quem tem acesso a essas telas precisa ver
// a lista pra preencher o formulário, não só quem administra a tabela).
export async function listarNaturezasPagamentoParaSelectAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ['/admin/op/nova', '/admin/op/responsavel']);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { data, error } = await db.from('op_naturezas_pagamento').select('natureza, centro_financeiro_nome').order('natureza');
  if (error) return { ok: false, erro: error.message };
  // grupos por centro financeiro (plano de contas do P2S, 2026-11-20) — a lista passou de 19 para ~230
  const porCentro = new Map<string, string[]>();
  for (const n of (data || []) as any[]) {
    const g = String(n.centro_financeiro_nome || 'SEM CLASSIFICAÇÃO');
    porCentro.set(g, [...(porCentro.get(g) || []), String(n.natureza)]);
  }
  const grupos = [...porCentro.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }))
    .map(([centro, naturezas]) => ({ centro, naturezas: naturezas.sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true })) }));
  return { ok: true, info: { naturezas: (data || []).map(n => n.natureza as string), grupos } };
}

/** Importa o plano de contas do P2S e cria uma natureza por sub-centro (2026-11-20). */
export async function importarPlanoContasP2sAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const r = await importarPlanoContasP2s(supabaseAdmin());
    registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `IMPORTOU PLANO DE CONTAS DO P2S: ${r.centros} centros, ${r.subcentros} sub-centros, ${r.naturezasCriadas} naturezas novas`, setor: 'OP' });
    revalidatePath('/admin');
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarNaturezaPagamentoAction(payload: { natureza: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const natureza = (payload.natureza || '').trim().toUpperCase();
  if (!natureza) return { ok: false, erro: 'Informe o nome da natureza.' };

  const db = supabaseAdmin();
  const { error } = await db.from('op_naturezas_pagamento').insert({ natureza });
  if (error) return { ok: false, erro: error.code === '23505' ? 'Essa natureza já existe.' : error.message };

  registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `CRIOU NATUREZA DE PAGAMENTO DA OP: ${natureza}`, setor: 'OP' });
  revalidatePath('/admin');
  return { ok: true };
}

export async function excluirNaturezaPagamentoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { data: linha } = await db.from('op_naturezas_pagamento').select('natureza').eq('id', payload.id).maybeSingle();
  const { error } = await db.from('op_naturezas_pagamento').delete().eq('id', payload.id);
  if (error) return { ok: false, erro: error.message };

  registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `EXCLUIU NATUREZA DE PAGAMENTO DA OP: ${linha?.natureza || payload.id}`, setor: 'OP' });
  revalidatePath('/admin');
  return { ok: true };
}

export async function salvarClassificacaoNaturezaAction(payload: {
  id: number;
  tipoClassificacao: 'CUSTO' | 'RECEITA';
  centroFinanceiroOid: string | null;
  centroFinanceiroNome: string | null;
  subcentroFinanceiroOid: string | null;
  subcentroFinanceiroNome: string | null;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { error } = await db.from('op_naturezas_pagamento').update({
    tipo_classificacao: payload.tipoClassificacao,
    centro_financeiro_oid: payload.centroFinanceiroOid,
    centro_financeiro_nome: payload.centroFinanceiroNome,
    subcentro_financeiro_oid: payload.subcentroFinanceiroOid,
    subcentro_financeiro_nome: payload.subcentroFinanceiroNome,
    atualizado_em: new Date().toISOString(),
  }).eq('id', payload.id);
  if (error) return { ok: false, erro: error.message };

  registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: 'ATUALIZOU CLASSIFICAÇÃO FINANCEIRA DE NATUREZA DE PAGAMENTO DA OP', setor: 'OP', equipamento_id: String(payload.id) });
  revalidatePath('/admin');
  return { ok: true };
}

// ============================================================================
// CATÁLOGO DE CENTRO FINANCEIRO / SUB-CENTRO FINANCEIRO — direto do
// PrimeStart (TCustomCentroCusto / TCustomSubCentroCusto). A mesma classe
// serve tanto pra "Centro de Custo" quanto "Centro de Receita" — o que muda
// é só o campo Tipo (P/R) gravado na classificação em si, não a classe do
// Centro (confirmado consultando a API em produção, 2026-09-16).
// ============================================================================
export async function listarCentrosFinanceirosP2sAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    // plano de contas importado (financeiro_centros); sem importação ainda, consulta o P2S ao vivo
    const { data: locais } = await supabaseAdmin().from('financeiro_centros').select('p2s_oid, nome_p2s').eq('em_desuso', false);
    if (locais?.length) {
      return { ok: true, info: { centros: (locais as any[]).map(c => ({ oid: c.p2s_oid as string, nome: c.nome_p2s as string })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })) } };
    }
    const ambiente: AmbienteP2s = 'PRODUCAO';
    const resultado = await consultarObjetos(ambiente, 'TCustomCentroCusto', [], { proxy: true });
    const centros = resultado.objectlist
      .map(o => ({ oid: o.oid as string, nome: String(o.Nome || '').trim() }))
      .filter(c => c.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return { ok: true, info: { centros } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function listarSubCentrosFinanceirosP2sAction(payload: { centroOid: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const { data: centro } = await supabaseAdmin().from('financeiro_centros').select('id').eq('p2s_oid', payload.centroOid).maybeSingle();
    if (centro) {
      const { data: subs } = await supabaseAdmin().from('financeiro_subcentros').select('p2s_oid, nome_p2s').eq('centro_id', centro.id).eq('em_desuso', false);
      if (subs?.length) return { ok: true, info: { subcentros: (subs as any[]).map(s => ({ oid: s.p2s_oid as string, nome: s.nome_p2s as string })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true })) } };
    }
    const ambiente: AmbienteP2s = 'PRODUCAO';
    const resultado = await consultarObjetos(ambiente, 'TCustomSubCentroCusto', [criterioRef('CentroFinanceiro', payload.centroOid)], { proxy: true });
    const subcentros = resultado.objectlist
      .map(o => ({ oid: o.oid as string, nome: String(o.Nome || '').trim() }))
      .filter(c => c.nome)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return { ok: true, info: { subcentros } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PLANO DE CONTAS PRÓPRIO (2026-11-23) — centro/sub-centro criados aqui
// (app/lib/financeiro/planoContas.ts). Depois da virada é o único caminho.
// ============================================================================
export async function criarCentroFinanceiroAction(payload: { codigo: string; nome: string; tipo: 'P' | 'R' }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const c = await criarCentroLocal(supabaseAdmin(), payload);
    registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: 'CRIOU CENTRO FINANCEIRO', setor: 'OP', equipamento_nome: c.nome_p2s });
    return { ok: true, info: c };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : 'Erro.' }; }
}

export async function criarSubcentroFinanceiroAction(payload: { centroOid: string; codigo: string; nome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoGestao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const s = await criarSubcentroLocal(supabaseAdmin(), payload);
    registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: 'CRIOU SUB-CENTRO FINANCEIRO', setor: 'OP', equipamento_nome: `${s.nome_p2s} → natureza ${s.natureza}` });
    revalidatePath('/admin');
    return { ok: true, info: s };
  } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : 'Erro.' }; }
}
