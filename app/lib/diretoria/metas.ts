// app/lib/diretoria/metas.ts
// Metas mensais por empresa (Fase 4, 2026-11-15) — cadastradas em
// /admin/diretoria → Parâmetros (tabela diretoria_metas) e medidas aqui, por
// código, para todos os relatórios e alertas:
//   FATURAMENTO        fichas de reserva emitidas no mês (sem canceladas)
//   RECEBIMENTO        contas a receber quitadas no mês (só fonte P2S)
//   TETO_OPS           OPs criadas no mês (sem reprovadas) — teto, menor é melhor
//   TETO_INADIMPLENCIA vencido a receber até 1 ano, na data — teto (só fonte P2S)
// "Ritmo esperado" = meta × dias corridos ÷ dias do mês (só para as metas de
// mês inteiro; o teto de inadimplência é uma foto do dia).
import { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
// Só o tipo: indicadoresDiarios.ts importa este arquivo (sem ciclo em runtime).
import type { FonteRecebimentos } from './indicadoresDiarios';
import { fonteDoDiretor, lerReceber, lerFichas } from './fontes';

function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

type DB = ReturnType<typeof supabaseAdmin>;

export const TIPOS_META = ['FATURAMENTO', 'RECEBIMENTO', 'TETO_OPS', 'TETO_INADIMPLENCIA'] as const;
export type TipoMeta = typeof TIPOS_META[number];
export const ROTULO_META: Record<TipoMeta, string> = {
  FATURAMENTO: 'Faturamento (fichas emitidas)',
  RECEBIMENTO: 'Recebimento',
  TETO_OPS: 'Teto de gastos com OPs',
  TETO_INADIMPLENCIA: 'Teto de inadimplência (vencido até 1 ano)',
};
const EH_TETO: Record<TipoMeta, boolean> = { FATURAMENTO: false, RECEBIMENTO: false, TETO_OPS: true, TETO_INADIMPLENCIA: true };

export interface ProgressoMeta {
  tipo: TipoMeta;
  rotulo: string;
  eh_teto: boolean;
  meta: number | null;          // null = sem meta cadastrada
  realizado: number | null;     // null = sem dado (ex.: recebimentos de fonte externa)
  pct_da_meta: number | null;
  esperado_ate_agora: number | null;
  faltam: number | null;        // metas: quanto falta; tetos: quanto ainda cabe (negativo = estourou)
  situacao: 'SEM_META' | 'SEM_DADO' | 'ATINGIDA' | 'NO_RITMO' | 'ABAIXO_DO_RITMO' | 'DENTRO_DO_TETO' | 'PERTO_DO_TETO' | 'ESTOUROU';
}

const num = (v: unknown) => Number(v) || 0;
const arred = (n: number) => Math.round(n * 100) / 100;
const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

export async function carregarMetas(db: DB, empresaId: number, ano: number, mes?: number): Promise<Map<string, number>> {
  let q = db.from('diretoria_metas').select('mes, tipo, valor').eq('empresa_id', empresaId).eq('ano', ano);
  if (mes) q = q.eq('mes', mes);
  const { data } = await q;
  return new Map(((data || []) as any[]).map(m => [`${m.mes}:${m.tipo}`, num(m.valor)]));
}

// Realizado de cada meta no mês (ano/mes) até a data `ate` (inclusive).
async function realizadosDoMes(db: DB, empresaId: number, fonte: FonteRecebimentos, ano: number, mes: number, ate: string) {
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(diasNoMes(ano, mes)).padStart(2, '0')}`;
  const fim = ate < fimMes ? ate : fimMes;
  // Antes ou depois da virada da chave (fontes.ts): de onde vêm contas e fichas.
  const origem = await fonteDoDiretor(db, empresaId);
  const [fichas, ops, receb, abertos] = await Promise.all([
    lerFichas(db, origem, { emissaoDe: inicio, emissaoAte: fim }),
    buscarTodasPaginas((de, a) => db.from('op_ordens_pagamento').select('id, total_geral').eq('empresa_id', empresaId).neq('status', 'REPROVADA')
      .gte('data_criacao', `${inicio}T00:00:00-03:00`).lt('data_criacao', `${somarDias(fim, 1)}T00:00:00-03:00`).order('id').range(de, a)),
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: true, quitacaoDe: inicio, quitacaoAte: fim }) : Promise.resolve({ data: [] as any[], error: null }),
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: false, vencAntes: somarDias(fim, 1), vencDe: somarDias(fim, -364) }) : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const soma = (l: any[], f: (x: any) => number) => arred(l.reduce((s, x) => s + f(x), 0));
  return {
    FATURAMENTO: soma(fichas.data, x => num(x.valor_final)),
    RECEBIMENTO: fonte === 'P2S' ? soma(receb.data, x => num(x.valor_pago) || num(x.valor_final)) : null,
    TETO_OPS: soma(ops.data, x => num(x.total_geral)),
    // Foto: só faz sentido "hoje" — num mês já fechado é o que está vencido agora daquele recorte.
    TETO_INADIMPLENCIA: fonte === 'P2S' ? soma(abertos.data, x => num(x.valor_final)) : null,
    diasCorridos: Math.max(1, Math.round((new Date(`${fim}T12:00:00Z`).getTime() - new Date(`${inicio}T12:00:00Z`).getTime()) / 86_400_000) + 1),
    diasMes: diasNoMes(ano, mes),
  } as Record<TipoMeta, number | null> & { diasCorridos: number; diasMes: number };
}

function avaliar(tipo: TipoMeta, meta: number | null, realizado: number | null, diasCorridos: number, diasMes: number): ProgressoMeta {
  const base = { tipo, rotulo: ROTULO_META[tipo], eh_teto: EH_TETO[tipo], meta, realizado };
  if (meta == null || meta <= 0) return { ...base, pct_da_meta: null, esperado_ate_agora: null, faltam: null, situacao: 'SEM_META' };
  if (realizado == null) return { ...base, pct_da_meta: null, esperado_ate_agora: null, faltam: null, situacao: 'SEM_DADO' };
  const pct = Math.round((realizado / meta) * 1000) / 10;
  const proporcional = tipo !== 'TETO_INADIMPLENCIA';
  const esperado = proporcional ? arred(meta * Math.min(1, diasCorridos / diasMes)) : null;
  const faltam = arred(meta - realizado);
  let situacao: ProgressoMeta['situacao'];
  if (EH_TETO[tipo]) situacao = realizado > meta ? 'ESTOUROU' : realizado >= meta * 0.8 ? 'PERTO_DO_TETO' : 'DENTRO_DO_TETO';
  else situacao = realizado >= meta ? 'ATINGIDA' : esperado != null && realizado >= esperado * 0.95 ? 'NO_RITMO' : 'ABAIXO_DO_RITMO';
  return { ...base, pct_da_meta: pct, esperado_ate_agora: esperado, faltam, situacao };
}

// Progresso das 4 metas do mês de `ate` (até essa data).
export async function progressoMetasDoMes(db: DB, empresaId: number, fonte: FonteRecebimentos, ate: string): Promise<{ mes: string; metas: ProgressoMeta[] }> {
  const [ano, mes] = ate.split('-').map(Number);
  const [metas, real] = await Promise.all([carregarMetas(db, empresaId, ano, mes), realizadosDoMes(db, empresaId, fonte, ano, mes, ate)]);
  return {
    mes: `${ano}-${String(mes).padStart(2, '0')}`,
    metas: TIPOS_META.map(t => avaliar(t, metas.has(`${mes}:${t}`) ? metas.get(`${mes}:${t}`)! : null, real[t], real.diasCorridos, real.diasMes)),
  };
}

// Mês a mês de um ano (para o relatório anual), até `ate`.
export async function metasDoAno(db: DB, empresaId: number, fonte: FonteRecebimentos, ano: number, ate: string) {
  const metas = await carregarMetas(db, empresaId, ano);
  const meses = [];
  for (let m = 1; m <= 12; m++) {
    const inicio = `${ano}-${String(m).padStart(2, '0')}-01`;
    if (inicio > ate) break;
    const real = await realizadosDoMes(db, empresaId, fonte, ano, m, ate);
    meses.push({
      mes: `${ano}-${String(m).padStart(2, '0')}`,
      // Inadimplência de um mês passado não é reconstituível (é foto) — só o mês corrente/último tem sentido.
      metas: TIPOS_META.filter(t => t !== 'TETO_INADIMPLENCIA').map(t => avaliar(t, metas.has(`${m}:${t}`) ? metas.get(`${m}:${t}`)! : null, real[t], real.diasCorridos, real.diasMes)),
    });
  }
  return meses;
}
