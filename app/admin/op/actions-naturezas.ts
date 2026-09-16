'use server';

// app/admin/op/actions-naturezas.ts
// Catálogo de "Natureza do Pagamento" da OP + Classificação Financeira
// (Centro de Custo/Receita + Sub-Centro) enviada ao PrimeStart ao lançar a
// Conta a Pagar (ver criarContaPagarParaOP em
// app/admin/financeiro/ops/enviarOpP2sCore.ts). Tabela: op_naturezas_pagamento
// (ver .sql/op_naturezas_pagamento.sql).
//
// Reaproveita obterPerfilValidado/possuiAcessoRota de ./actions (mesmo
// padrão de validação de sessão/permissão do resto do módulo de OP) em vez
// de duplicar essa lógica aqui.
import { revalidatePath } from 'next/cache';
import { registrarLogAuditoria } from '../../actions';
import { supabaseAdmin } from '../../lib/supabase';
import { obterPerfilValidado, possuiAcessoRota } from './actions';
import { consultarObjetos, criterioRef, type AmbienteP2s } from '../../lib/p2s';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/op/naturezas';

async function validarAcessoGestao(accessToken: string) {
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { ok: false as const, message: 'Sessão inválida ou expirada. Faça login novamente.' };
  const autorizado = await possuiAcessoRota(perfil.permissaoNormalizada, ROTA);
  if (!autorizado) return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
  return { ok: true as const, perfil };
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
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' };

  const [temNova, temResponsavel] = await Promise.all([
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/op/nova'),
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/op/responsavel'),
  ]);
  if (!temNova && !temResponsavel) return { ok: false, erro: 'Você não tem permissão para executar esta ação.' };

  const db = supabaseAdmin();
  const { data, error } = await db.from('op_naturezas_pagamento').select('natureza').order('natureza');
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: { naturezas: (data || []).map(n => n.natureza as string) } };
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
