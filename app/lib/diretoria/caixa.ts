// app/lib/diretoria/caixa.ts
// Projeção de caixa de 30/60/90 dias por empresa (Fase 4, 2026-11-15) — aba
// Caixa de /admin/diretoria e resumo nos relatórios semanal/mensal/anual.
//
//   Entradas previstas = contas a receber em aberto por vencimento (só fonte P2S)
//   Saídas previstas   = contas a pagar do P2S em aberto por vencimento
//                        + OPs pendentes que ainda não foram para o P2S
//                          (OP enviada vira conta a pagar lá — não conta duas vezes)
//
// O que a projeção NÃO tem (vai em `limitacoes`): saldo em banco (o sistema
// não tem), despesas ainda não lançadas no P2S (folha, impostos, contas
// recorrentes do mês seguinte) e vendas ainda não faturadas. O saldo
// projetado é, portanto, a VARIAÇÃO prevista a partir de hoje, não o saldo.
// Vencidos a receber ficam à parte ("pode entrar"), fora da projeção.
import { supabaseAdmin } from '../supabase';
import { hojeISO, somarDias, type FonteRecebimentos } from './indicadoresDiarios';
import { fonteDoDiretor, lerReceber, lerPagar } from './fontes';

type DB = ReturnType<typeof supabaseAdmin>;

const num = (v: unknown) => Number(v) || 0;
const arred = (n: number) => Math.round(n * 100) / 100;

export interface SemanaCaixa { inicio: string; fim: string; entradas: number; saidas: number; saldo_semana: number; saldo_acumulado: number }
export interface ItemCaixa { nome: string; valor: number; data: string; origem: string }

export interface ProjecaoCaixa {
  empresa: { id: number; nome: string };
  fonte_recebimentos: FonteRecebimentos;
  hoje: string;
  horizontes: { dias: number; ate: string; entradas: number; saidas: number; saldo: number }[];
  semanas: SemanaCaixa[];
  maiores_entradas_30d: ItemCaixa[];
  maiores_saidas_30d: ItemCaixa[];
  saidas_por_centro_30d: { nome: string; valor: number }[];
  vencidos_a_receber_ate_90_dias: { valor: number; qtd: number };
  limitacoes: string[];
}

export async function projetarCaixa(db: DB, empresa: { id: number; nome: string }, hoje = hojeISO()): Promise<ProjecaoCaixa> {
  const E = empresa.id;
  const fim = somarDias(hoje, 90);
  const { data: cadastro } = await db.from('empresas').select('*').eq('id', E).maybeSingle();
  const fonte: FonteRecebimentos = cadastro?.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S';
  const vazio = Promise.resolve({ data: [] as any[], error: null });
  // Antes ou depois da virada da chave (fontes.ts). Depois dela, cada OP já é um
  // título a pagar do sistema — somar as OPs pendentes de novo contaria em dobro.
  const origem = await fonteDoDiretor(db, E);
  const sistema = origem.financeiro === 'SISTEMA';

  const [receber, vencidos, pagar, ops] = await Promise.all([
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: false, vencDe: hoje, vencAte: fim }) : vazio,
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: false, vencAntes: hoje, vencDe: somarDias(hoje, -90) }) : vazio,
    lerPagar(db, origem, { quitado: false, vencDe: hoje, vencAte: fim }),
    sistema ? vazio : db.from('op_ordens_pagamento').select('numero_op, empresa_recebedora, natureza_pagamento, total_geral, data_vencimento').eq('empresa_id', E).eq('status', 'PENDENTE').is('p2s_conta_pagar_oid', null).lte('data_vencimento', fim),
  ]);

  const entradas: ItemCaixa[] = ((receber.data || []) as any[]).map(l => ({ nome: l.cliente || '(sem cliente)', valor: num(l.valor_final), data: l.data_vencimento, origem: l.evento ? `A receber · ${l.evento}` : 'A receber' }));
  // OP pendente já vencida entra na primeira semana (é saída a fazer agora).
  const saidas: (ItemCaixa & { centro: string })[] = [
    ...((pagar.data || []) as any[]).map(l => ({ nome: l.fornecedor || '(sem fornecedor)', valor: num(l.valor), data: l.data_vencimento, origem: sistema ? 'Conta a pagar' : 'Conta a pagar (P2S)', centro: l.centro || '(sem centro)' })),
    ...((ops.data || []) as any[]).map(l => ({ nome: `OP ${l.numero_op} · ${String(l.empresa_recebedora || '').trim()}`, valor: num(l.total_geral), data: l.data_vencimento && l.data_vencimento >= hoje ? l.data_vencimento : hoje, origem: 'OP pendente', centro: `OP · ${String(l.natureza_pagamento || 'sem natureza').trim().toUpperCase()}` })),
  ];

  const semanas: SemanaCaixa[] = [];
  let acumulado = 0;
  for (let i = 0; i < 13; i++) {
    const ini = somarDias(hoje, i * 7);
    const fimSem = i === 12 ? fim : somarDias(ini, 6);
    const e = arred(entradas.filter(x => x.data >= ini && x.data <= fimSem).reduce((s, x) => s + x.valor, 0));
    const s = arred(saidas.filter(x => x.data >= ini && x.data <= fimSem).reduce((t, x) => t + x.valor, 0));
    acumulado = arred(acumulado + e - s);
    semanas.push({ inicio: ini, fim: fimSem, entradas: e, saidas: s, saldo_semana: arred(e - s), saldo_acumulado: acumulado });
  }

  const horizonte = (dias: number) => {
    const ate = somarDias(hoje, dias);
    const e = arred(entradas.filter(x => x.data <= ate).reduce((s, x) => s + x.valor, 0));
    const s = arred(saidas.filter(x => x.data <= ate).reduce((t, x) => t + x.valor, 0));
    return { dias, ate, entradas: e, saidas: s, saldo: arred(e - s) };
  };
  const ate30 = somarDias(hoje, 30);
  const porCentro = new Map<string, number>();
  for (const s of saidas.filter(x => x.data <= ate30)) porCentro.set(s.centro, (porCentro.get(s.centro) || 0) + s.valor);
  const top = (l: ItemCaixa[]) => [...l].filter(x => x.data <= ate30).sort((a, b) => b.valor - a.valor).slice(0, 8).map(x => ({ nome: x.nome, valor: arred(x.valor), data: x.data, origem: x.origem }));

  const limitacoes = [
    'Não considera o saldo em banco — o saldo projetado é a variação prevista a partir de hoje.',
    'Só entra o que já está lançado: despesas ainda não lançadas no P2S (folha, impostos, contas recorrentes) e vendas ainda não faturadas não aparecem, por isso os meses mais distantes tendem a parecer mais folgados do que serão.',
  ];
  if (fonte === 'EXTERNA') limitacoes.unshift('Os recebimentos desta empresa vêm de uma fonte externa, ainda não integrada — a projeção mostra só as saídas.');

  return {
    empresa, fonte_recebimentos: fonte, hoje,
    horizontes: [horizonte(30), horizonte(60), horizonte(90)],
    semanas,
    maiores_entradas_30d: top(entradas),
    maiores_saidas_30d: top(saidas),
    saidas_por_centro_30d: [...porCentro.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nome, valor]) => ({ nome, valor: arred(valor) })),
    vencidos_a_receber_ate_90_dias: { valor: arred(((vencidos.data || []) as any[]).reduce((s, l) => s + num(l.valor_final), 0)), qtd: (vencidos.data || []).length },
    limitacoes,
  };
}

// Versão enxuta para mandar dentro dos relatórios.
export function resumoCaixa(p: ProjecaoCaixa) {
  return {
    horizontes: p.horizontes,
    semana_mais_negativa: [...p.semanas].sort((a, b) => a.saldo_semana - b.saldo_semana)[0] ?? null,
    maiores_saidas_30d: p.maiores_saidas_30d.slice(0, 5),
    maiores_entradas_30d: p.maiores_entradas_30d.slice(0, 5),
    vencidos_a_receber_ate_90_dias: p.vencidos_a_receber_ate_90_dias,
    limitacoes: p.limitacoes,
  };
}
