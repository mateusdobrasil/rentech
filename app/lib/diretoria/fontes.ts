// app/lib/diretoria/fontes.ts
// De onde o Diretor (IA) lê contas e fichas — antes e depois da virada da
// chave (2026-11-22).
//
// Antes da virada tudo vem dos espelhos do P2S (financeiro_contas_receber,
// financeiro_contas_pagar, fichas_reserva), exatamente como sempre. Quando a
// empresa vira a chave, esses espelhos param de ser atualizados — sem esta
// camada o relatório seguiria saindo com números congelados, com cara de certo.
//
// Regras depois da virada (as mesmas do DRE e do fluxo de caixa):
// - FINANCEIRO (financeiro_parametros.fonte = SISTEMA, ligado ao concluir):
//   realizado (recebido/pago) = espelho do P2S até a véspera da data de corte
//   + títulos do sistema a partir dela; em aberto = só os títulos do sistema
//   (o que não migrou ficou de propósito no histórico do P2S).
// - FICHAS (empresa CONGELADA ou CONCLUIDA): locacao_fichas_reserva.
// - DADO DE ENSAIO: o que foi criado no sistema durante a fase paralela é teste
//   e NÃO conta. Vale só o que veio do P2S (origem P2S / migrado) ou foi
//   criado a partir do congelamento. Títulos a pagar de OP contam sempre (OP é
//   real desde antes da virada).
//
// As linhas saem no formato do espelho do P2S (mesmos nomes de campo), para
// os indicadores não precisarem saber de onde vieram.
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { rotuloStatusP2s } from '../locacao/statusP2s';
import { numeroFicha } from '../locacao/fichaNumero';

type DB = ReturnType<typeof supabaseAdmin>;
type Resultado<T> = { data: T[]; error: { message: string } | null };

const num = (v: unknown) => Number(v) || 0;
const limpo = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const somarDias = (iso: string, dias: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const MUITO_DEPOIS = '9999-12-31';

export interface FonteDiretor {
  empresaId: number;
  /** SISTEMA = financeiro já virou (títulos do sistema). */
  financeiro: 'P2S' | 'SISTEMA';
  /** SISTEMA = P2S congelado: fichas vêm de locacao_fichas_reserva. */
  fichas: 'P2S' | 'SISTEMA';
  /** Dia da virada (data de corte do financeiro). */
  corte: string | null;
  /** Quando o P2S foi congelado — antes disso, o que nasceu no sistema é ensaio. */
  congeladaEm: string | null;
}

export async function fonteDoDiretor(db: DB, empresaId: number): Promise<FonteDiretor> {
  const [{ data: v }, { data: f }] = await Promise.all([
    db.from('parametros_virada').select('etapa, data_corte, congelada_em').eq('empresa_id', empresaId).maybeSingle(),
    db.from('financeiro_parametros').select('fonte').eq('empresa_id', empresaId).maybeSingle(),
  ]);
  const virou = !!v && v.etapa !== 'PREPARACAO';
  const congeladaEm = virou ? (v?.congelada_em as string) || null : null;
  return {
    empresaId,
    financeiro: f?.fonte === 'SISTEMA' ? 'SISTEMA' : 'P2S',
    fichas: virou ? 'SISTEMA' : 'P2S',
    corte: (v?.data_corte as string) || (congeladaEm ? congeladaEm.slice(0, 10) : null),
    congeladaEm,
  };
}

/** Rótulo curto da fonte, para avisos e para o contexto da IA. */
export function descreverFonte(f: FonteDiretor): string | null {
  if (f.fichas === 'P2S' && f.financeiro === 'P2S') return null;
  const partes = [];
  if (f.fichas === 'SISTEMA') partes.push('fichas do próprio sistema (P2S congelado)');
  if (f.financeiro === 'SISTEMA') partes.push(`contas a receber e a pagar do próprio sistema desde ${f.corte ? f.corte.split('-').reverse().join('/') : 'a virada'} (antes disso, histórico do P2S)`);
  return `Empresa já virou a chave: ${partes.join('; ')}.`;
}

// ============================================================================
// CONTAS A RECEBER
// ============================================================================
export interface LinhaReceber {
  id: string; cliente: string | null; valor_final: number; valor_pago: number | null;
  data_vencimento: string | null; data_quitacao: string | null; quitado: boolean;
  documento: string | null; num_documento: string | null; evento: string | null; prorrogado: boolean;
  /** Chave estável do título (oid do P2S ou T<id> do sistema) — dedupe de alertas. */
  chave: string;
}
export interface FiltroConta {
  quitado: boolean;
  /** Realizado: data de quitação/pagamento entre de e ate. */
  quitacaoDe?: string; quitacaoAte?: string; quitacaoEm?: string;
  /** Vencimento: >= vencDe, <= vencAte, < vencAntes. */
  vencDe?: string; vencAte?: string; vencAntes?: string;
  /** Nome do cliente/fornecedor contém (sem diferenciar maiúsculas). */
  nome?: string;
}

const intervaloRealizado = (f: FiltroConta) => ({ de: f.quitacaoEm || f.quitacaoDe || '0000-01-01', ate: f.quitacaoEm || f.quitacaoAte || MUITO_DEPOIS });

export async function lerReceber(db: DB, fonte: FonteDiretor, f: FiltroConta): Promise<Resultado<LinhaReceber>> {
  const E = fonte.empresaId;
  const espelho = async (ateRealizado: string | null): Promise<Resultado<LinhaReceber>> => {
    const r = await buscarTodasPaginas<any>((de, a) => {
      let q = db.from('financeiro_contas_receber').select('id, p2s_oid, cliente, valor_final, valor_pago, data_vencimento, data_quitacao, quitado, documento, num_documento, evento, prorrogado').eq('empresa_id', E).eq('quitado', f.quitado);
      if (f.quitado) {
        const { de: qde, ate: qate } = intervaloRealizado(f);
        q = q.gte('data_quitacao', qde).lte('data_quitacao', ateRealizado && ateRealizado < qate ? ateRealizado : qate);
      }
      if (f.vencDe) q = q.gte('data_vencimento', f.vencDe);
      if (f.vencAte) q = q.lte('data_vencimento', f.vencAte);
      if (f.vencAntes) q = q.lt('data_vencimento', f.vencAntes);
      if (f.nome) q = q.ilike('cliente', `%${f.nome}%`);
      return q.order('id').range(de, a);
    });
    return { data: (r.data || []).map((l: any) => ({ ...l, id: String(l.id), chave: String(l.p2s_oid || l.id), valor_final: num(l.valor_final), valor_pago: l.valor_pago === null ? null : num(l.valor_pago), prorrogado: !!l.prorrogado })), error: r.error };
  };
  if (fonte.financeiro === 'P2S') return espelho(null);

  // Depois da virada: espelho até a véspera do corte (só realizado) + títulos do sistema.
  const corte = fonte.corte || '0000-01-01';
  const partes: Resultado<LinhaReceber>[] = [];
  if (f.quitado && intervaloRealizado(f).de < corte) partes.push(await espelho(somarDias(corte, -1)));
  const t = await buscarTodasPaginas<any>((de, a) => {
    let q = db.from('financeiro_titulos_receber').select('id, descricao, valor, valor_pago, vencimento, data_pagamento, status, origem, criado_em, parcela, total_parcelas, parceiro:parceiros(nome_exibicao, nome_completo), ficha:locacao_fichas_reserva(id, origem, p2s_numero, evento:eventos_feiras(nome))')
      .eq('empresa_id', E).eq('status', f.quitado ? 'PAGO' : 'ABERTO');
    if (f.quitado) {
      const { de: qde, ate: qate } = intervaloRealizado(f);
      q = q.gte('data_pagamento', qde > corte ? qde : corte).lte('data_pagamento', qate);
    }
    if (f.vencDe) q = q.gte('vencimento', f.vencDe);
    if (f.vencAte) q = q.lte('vencimento', f.vencAte);
    if (f.vencAntes) q = q.lt('vencimento', f.vencAntes);
    if (fonte.congeladaEm) q = q.or(`origem.eq.MIGRADO,criado_em.gte."${fonte.congeladaEm}"`);
    return q.order('id').range(de, a);
  });
  const titulos = (t.data || []).map((l: any): LinhaReceber => ({
    id: `T${l.id}`, chave: `T${l.id}`, cliente: limpo(l.parceiro?.nome_exibicao || l.parceiro?.nome_completo) || null, valor_final: num(l.valor), valor_pago: l.valor_pago === null ? null : num(l.valor_pago),
    data_vencimento: l.vencimento, data_quitacao: l.data_pagamento, quitado: l.status === 'PAGO',
    documento: l.ficha ? numeroFicha(l.ficha) : 'Título', num_documento: l.total_parcelas > 1 ? `${l.parcela}/${l.total_parcelas}` : null,
    evento: l.ficha?.evento?.nome || null, prorrogado: false,
  })).filter(l => !f.nome || (l.cliente || '').toUpperCase().includes(f.nome.toUpperCase()));
  partes.push({ data: titulos, error: t.error });
  return { data: partes.flatMap(p => p.data), error: partes.find(p => p.error)?.error || null };
}

// ============================================================================
// CONTAS A PAGAR
// ============================================================================
export interface LinhaPagar {
  id: string; fornecedor: string | null; valor: number; valor_pago: number | null; centro: string | null; descricao: string | null;
  data_vencimento: string | null; data_quitacao: string | null; quitado: boolean;
}

export async function lerPagar(db: DB, fonte: FonteDiretor, f: FiltroConta): Promise<Resultado<LinhaPagar>> {
  const E = fonte.empresaId;
  const espelho = async (ateRealizado: string | null): Promise<Resultado<LinhaPagar>> => {
    const r = await buscarTodasPaginas<any>((de, a) => {
      let q = db.from('financeiro_contas_pagar').select('id, fornecedor, valor, valor_pago, centro, descricao, data_vencimento, data_quitacao, quitado').eq('empresa_id', E).eq('quitado', f.quitado);
      if (f.quitado) {
        const { de: qde, ate: qate } = intervaloRealizado(f);
        q = q.gte('data_quitacao', qde).lte('data_quitacao', ateRealizado && ateRealizado < qate ? ateRealizado : qate);
      }
      if (f.vencDe) q = q.gte('data_vencimento', f.vencDe);
      if (f.vencAte) q = q.lte('data_vencimento', f.vencAte);
      if (f.vencAntes) q = q.lt('data_vencimento', f.vencAntes);
      if (f.nome) q = q.ilike('fornecedor', `%${f.nome}%`);
      return q.order('id').range(de, a);
    });
    return { data: (r.data || []).map((l: any) => ({ ...l, id: String(l.id), valor: num(l.valor), valor_pago: l.valor_pago === null ? null : num(l.valor_pago) })), error: r.error };
  };
  if (fonte.financeiro === 'P2S') return espelho(null);

  const corte = fonte.corte || '0000-01-01';
  const partes: Resultado<LinhaPagar>[] = [];
  if (f.quitado && intervaloRealizado(f).de < corte) partes.push(await espelho(somarDias(corte, -1)));
  const t = await buscarTodasPaginas<any>((de, a) => {
    let q = db.from('financeiro_titulos_pagar').select('id, fornecedor_nome, descricao, valor, valor_pago, vencimento, data_pagamento, status, origem, criado_em, subcentro:financeiro_subcentros(nome_p2s, centro:financeiro_centros(nome))')
      .eq('empresa_id', E).eq('status', f.quitado ? 'PAGO' : 'ABERTO');
    if (f.quitado) {
      const { de: qde, ate: qate } = intervaloRealizado(f);
      q = q.gte('data_pagamento', qde > corte ? qde : corte).lte('data_pagamento', qate);
    }
    if (f.vencDe) q = q.gte('vencimento', f.vencDe);
    if (f.vencAte) q = q.lte('vencimento', f.vencAte);
    if (f.vencAntes) q = q.lt('vencimento', f.vencAntes);
    if (f.nome) q = q.ilike('fornecedor_nome', `%${f.nome}%`);
    if (fonte.congeladaEm) q = q.or(`origem.in.(OP,MIGRADO),criado_em.gte."${fonte.congeladaEm}"`);
    return q.order('id').range(de, a);
  });
  partes.push({
    data: (t.data || []).map((l: any): LinhaPagar => ({
      id: `T${l.id}`, fornecedor: limpo(l.fornecedor_nome) || null, valor: num(l.valor), valor_pago: l.valor_pago === null ? null : num(l.valor_pago),
      centro: l.subcentro?.centro?.nome || null, descricao: limpo(l.descricao) || null, data_vencimento: l.vencimento, data_quitacao: l.data_pagamento, quitado: l.status === 'PAGO',
    })),
    error: t.error,
  });
  return { data: partes.flatMap(p => p.data), error: partes.find(p => p.error)?.error || null };
}

// ============================================================================
// FICHAS (OS / reservas)
// ============================================================================
export interface LinhaFicha {
  id: string; numero: string; cliente: string | null; evento_feira: string | null; valor_final: number;
  data_emissao: string | null; data_inicial: string | null; data_final: string | null;
  /** Já por extenso (P2S: "Em locação"…; sistema: "Reservada"…). */
  status: string; cancelada: boolean; vendedor: string | null;
  faturamento_suspenso: boolean; justificativa_suspensao: string | null;
}
export interface FiltroFicha {
  emissaoDe?: string; emissaoAte?: string; emissaoEm?: string;
  inicioDe?: string; inicioAte?: string;
  fimDe?: string; fimAte?: string;
  /** Só P2S: faturamento suspenso (o sistema não tem esse conceito). */
  suspenso?: boolean;
  incluirCanceladas?: boolean;
  /** Parte do nome do cliente. */
  cliente?: string;
  ordem?: 'data_inicial' | 'data_final';
}

const STATUS_SISTEMA: Record<string, string> = {
  ORCAMENTO: 'Orçamento', ENVIADO: 'Enviado ao cliente', APROVADO: 'Aprovado', RESERVADA: 'Reservada', EM_LOCACAO: 'Em locação',
  FINALIZADA: 'Finalizada', PERDIDO: 'Perdido', CANCELADA: 'Cancelada',
};

export async function lerFichas(db: DB, fonte: FonteDiretor, f: FiltroFicha): Promise<Resultado<LinhaFicha>> {
  const E = fonte.empresaId;
  if (fonte.fichas === 'P2S') {
    const r = await buscarTodasPaginas<any>((de, a) => {
      let q = db.from('fichas_reserva').select('id, numero, cliente, evento_feira, valor_final, data_emissao, data_inicial, data_final, status, vendedor, faturamento_suspenso, justificativa_suspensao').eq('empresa_id', E);
      if (!f.incluirCanceladas) q = q.neq('status', 'CA');
      if (f.emissaoEm) q = q.eq('data_emissao', f.emissaoEm);
      if (f.emissaoDe) q = q.gte('data_emissao', f.emissaoDe);
      if (f.emissaoAte) q = q.lte('data_emissao', f.emissaoAte);
      if (f.inicioDe) q = q.gte('data_inicial', f.inicioDe);
      if (f.inicioAte) q = q.lte('data_inicial', f.inicioAte);
      if (f.fimDe) q = q.gte('data_final', f.fimDe);
      if (f.fimAte) q = q.lte('data_final', f.fimAte);
      if (f.suspenso) q = q.eq('faturamento_suspenso', true);
      if (f.cliente) q = q.ilike('cliente', `%${f.cliente}%`);
      return (f.ordem ? q.order(f.ordem).order('id') : q.order('id')).range(de, a);
    });
    return {
      data: (r.data || []).map((l: any): LinhaFicha => ({
        id: String(l.id), numero: l.numero, cliente: l.cliente, evento_feira: l.evento_feira, valor_final: num(l.valor_final),
        data_emissao: l.data_emissao, data_inicial: l.data_inicial, data_final: l.data_final, status: rotuloStatusP2s(l.status), cancelada: l.status === 'CA',
        vendedor: l.vendedor, faturamento_suspenso: !!l.faturamento_suspenso, justificativa_suspensao: l.justificativa_suspensao,
      })),
      error: r.error,
    };
  }

  // P2S congelado: fichas do sistema, sem as de ensaio.
  if (f.suspenso) return { data: [], error: null };
  const r = await buscarTodasPaginas<any>((de, a) => {
    let q = db.from('locacao_fichas_reserva').select('id, origem, p2s_numero, p2s_status, status, valor_total, data_emissao, created_at, data_inicio, data_fim, vendedor_nome, migrada_p2s_em, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)').eq('empresa_id', E);
    if (!f.incluirCanceladas) q = q.neq('status', 'CANCELADA');
    if (f.emissaoEm) q = q.eq('data_emissao', f.emissaoEm);
    if (f.emissaoDe) q = q.gte('data_emissao', f.emissaoDe);
    if (f.emissaoAte) q = q.lte('data_emissao', f.emissaoAte);
    if (f.inicioDe) q = q.gte('data_inicio', f.inicioDe);
    if (f.inicioAte) q = q.lte('data_inicio', f.inicioAte);
    if (f.fimDe) q = q.gte('data_fim', f.fimDe);
    if (f.fimAte) q = q.lte('data_fim', f.fimAte);
    q = q.or(`origem.eq.P2S,migrada_p2s_em.not.is.null,created_at.gte."${fonte.congeladaEm || '9999-12-31'}"`);
    const ordem = f.ordem === 'data_inicial' ? 'data_inicio' : f.ordem === 'data_final' ? 'data_fim' : null;
    return (ordem ? q.order(ordem).order('id') : q.order('id')).range(de, a);
  });
  const linhas = (r.data || []).map((l: any): LinhaFicha => ({
    id: String(l.id), numero: numeroFicha(l), cliente: limpo(l.parceiro?.nome_exibicao || l.parceiro?.nome_completo) || null, evento_feira: l.evento?.nome || null,
    valor_final: num(l.valor_total), data_emissao: l.data_emissao || String(l.created_at || '').slice(0, 10) || null, data_inicial: l.data_inicio, data_final: l.data_fim,
    status: l.origem === 'P2S' && l.p2s_status ? rotuloStatusP2s(l.p2s_status) : STATUS_SISTEMA[l.status] || l.status, cancelada: l.status === 'CANCELADA',
    vendedor: l.vendedor_nome || null, faturamento_suspenso: false, justificativa_suspensao: null,
  })).filter(l => !f.cliente || (l.cliente || '').toUpperCase().includes(f.cliente.toUpperCase()));
  return { data: linhas, error: r.error };
}
