// app/lib/diretoria/indicadoresSemanais.ts
// Números do Relatório Semanal do Diretor — semana fechada de segunda a
// domingo, comparada com as 4 semanas anteriores (séries por semana prontas,
// a IA não soma nada) + a agenda da semana que começa. Mesmo princípio do
// diário: tudo calculado aqui, por código.
import { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { hojeISO, somarDias, type FonteRecebimentos, type ValorQtd } from './indicadoresDiarios';
import { progressoMetasDoMes } from './metas';
import { projetarCaixa, resumoCaixa } from './caixa';
import { somarKm } from './km';
import { fonteDoDiretor, descreverFonte, lerReceber, lerPagar, lerFichas } from './fontes';
import { blocoLocacao } from './locacao';

type DB = ReturnType<typeof supabaseAdmin>;

const FUSO = 'America/Sao_Paulo';
const num = (v: unknown) => Number(v) || 0;
const arred = (n: number) => Math.round(n * 100) / 100;
const inicioDia = (iso: string) => `${iso}T00:00:00-03:00`;
const fimDia = (iso: string) => `${somarDias(iso, 1)}T00:00:00-03:00`;
const diasEntre = (de: string, ate: string) => Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000);

// Última semana completa (seg–dom) antes de `hoje`. Numa segunda, é a semana
// que terminou ontem.
export function semanaFechada(hoje = hojeISO()): { inicio: string; fim: string } {
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const inicioSemanaAtual = somarDias(hoje, -((dow + 6) % 7));
  const inicio = somarDias(inicioSemanaAtual, -7);
  return { inicio, fim: somarDias(inicio, 6) };
}

// 5 semanas: índice 0 = semana analisada, 1..4 = as anteriores.
function semanas(inicio: string) {
  return [0, 1, 2, 3, 4].map(i => {
    const ini = somarDias(inicio, -7 * i);
    return { inicio: ini, fim: somarDias(ini, 6) };
  });
}

function serie<T>(linhas: T[], data: (l: T) => string | null | undefined, valor: (l: T) => number, sems: { inicio: string; fim: string }[]) {
  return sems.map(s => {
    const da = linhas.filter(l => { const d = (data(l) || '').slice(0, 10); return d >= s.inicio && d <= s.fim; });
    return { semana: `${s.inicio.slice(8, 10)}/${s.inicio.slice(5, 7)} a ${s.fim.slice(8, 10)}/${s.fim.slice(5, 7)}`, valor: arred(da.reduce((t, l) => t + valor(l), 0)), qtd: da.length };
  });
}

// Data local (Brasília) de um timestamptz, pra cair na semana certa.
const dataLocal = (ts: string | null | undefined) => (ts ? new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(ts)) : null);

function mediaAnteriores(s: { valor: number; qtd: number }[]) {
  const ant = s.slice(1);
  return { valor: arred(ant.reduce((t, x) => t + x.valor, 0) / ant.length), qtd: Math.round((ant.reduce((t, x) => t + x.qtd, 0) / ant.length) * 10) / 10 };
}
const variacao = (atual: number, base: number) => (base > 0 ? Math.round(((atual - base) / base) * 1000) / 10 : null);

export interface IndicadoresSemanais {
  versao: 1;
  empresa: { id: number; nome: string };
  semana: { inicio: string; fim: string };
  proxima_semana: { inicio: string; fim: string };
  gerado_em: string;
  avisos: string[];
  financeiro: Record<string, any>;
  comercial: Record<string, any>;
  expedicao: Record<string, any>;
  frota: Record<string, any>;
  rh: Record<string, any>;
  relatorios_diarios_da_semana: { data: string; situacao: string | null; manchete: string | null }[];
  alertas_da_semana: { tipo: string; titulo: string }[];
  metas?: unknown;
  caixa?: unknown;
  /** Situação da locação hoje (locacao.ts) — só depois da virada; antes, só o fiscal de produção. */
  locacao?: unknown;
}

export async function calcularIndicadoresSemanais(db: DB, empresa: { id: number; nome: string }, hoje = hojeISO()): Promise<IndicadoresSemanais> {
  const E = empresa.id;
  const sem = semanaFechada(hoje);
  const sems = semanas(sem.inicio);
  const desde = sems[4].inicio;
  const prox = { inicio: somarDias(sem.fim, 1), fim: somarDias(sem.fim, 7) };
  const avisos: string[] = [];
  const falhou = (area: string, e: { message?: string } | null | undefined) => { if (e) avisos.push(`Falha ao ler ${area}: ${e.message || 'erro'} — números dessa área podem estar incompletos.`); };

  const { data: cadastro } = await db.from('empresas').select('*').eq('id', E).maybeSingle();
  const fonte: FonteRecebimentos = cadastro?.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S';
  if (fonte === 'EXTERNA') avisos.push('Os recebimentos desta empresa vêm de uma fonte externa, ainda não integrada ao sistema — recebido, a receber e inadimplência ficam fora deste relatório.');
  const vazio = Promise.resolve({ data: [] as any[], error: null });
  // Antes ou depois da virada da chave (fontes.ts): de onde vêm contas e fichas.
  const origem = await fonteDoDiretor(db, E);
  const avisoFonte = descreverFonte(origem);
  if (avisoFonte) avisos.push(avisoFonte);

  const [receb, receberProx, receberAbertos, pago, pagarProx, opsCriadas, opsPagas, fichas, fichasProx, checklists, divergencias, foraAgora, frotaChk, multas, ponto, func, ferias, afast, diarios, alertas] = await Promise.all([
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: true, quitacaoDe: desde, quitacaoAte: sem.fim }) : vazio,
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: false, vencDe: prox.inicio, vencAte: prox.fim }) : vazio,
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: false, vencAntes: prox.inicio }) : vazio,
    lerPagar(db, origem, { quitado: true, quitacaoDe: desde, quitacaoAte: sem.fim }),
    lerPagar(db, origem, { quitado: false, vencDe: prox.inicio, vencAte: prox.fim }),
    db.from('op_ordens_pagamento').select('numero_op, total_geral, data_criacao, natureza_pagamento').eq('empresa_id', E).gte('data_criacao', inicioDia(desde)).lt('data_criacao', fimDia(sem.fim)),
    db.from('op_ordens_pagamento').select('numero_op, total_geral, pago_em').eq('empresa_id', E).gte('pago_em', inicioDia(desde)).lt('pago_em', fimDia(sem.fim)),
    lerFichas(db, origem, { emissaoDe: desde, emissaoAte: sem.fim }),
    lerFichas(db, origem, { inicioDe: prox.inicio, inicioAte: prox.fim, ordem: 'data_inicial' }),
    db.from('checklists').select('id, created_at').eq('empresa_id', E).gte('created_at', inicioDia(desde)).lt('created_at', fimDia(sem.fim)),
    db.from('checklist_divergencias').select('checklist_id, checklist_numero, tipo, descricao, qtd_esperada, qtd_real, evento_feira, created_at').gte('created_at', inicioDia(sem.inicio)).lt('created_at', fimDia(sem.fim)),
    db.from('checklists').select('numero, evento_feira, cliente, periodo_fim').eq('empresa_id', E).eq('status', 'SAIDA_CONFERIDA'),
    db.from('frota_checklists').select('id, saida_em, retorno_em, km_inicial, km_final').eq('empresa_id', E).gte('saida_em', inicioDia(desde)).lt('saida_em', fimDia(sem.fim)),
    db.from('frota_multas_debitos').select('valor, created_at, status').eq('empresa_id', E).gte('created_at', inicioDia(desde)).lt('created_at', fimDia(sem.fim)),
    buscarTodasPaginas((de, ate) => db.from('folha_ponto_diaria').select('id, funcionario_nome, data_registro, entrada_1, saida_1, entrada_2, saida_2').eq('empresa_id', E).gte('data_registro', sem.inicio).lte('data_registro', sem.fim).order('id').range(de, ate)),
    db.from('folha_funcionarios').select('nome_completo, cargo, data_admissao, data_desligamento, ativo').eq('empresa_id', E).or(`and(data_admissao.gte.${sem.inicio},data_admissao.lte.${prox.fim}),and(data_desligamento.gte.${sem.inicio},data_desligamento.lte.${prox.fim})`),
    db.from('folha_ferias').select('funcionario_nome, data_inicio_gozo, data_fim_gozo').eq('empresa_id', E).eq('status', 'AGENDADA').gte('data_inicio_gozo', prox.inicio).lte('data_inicio_gozo', prox.fim),
    db.from('folha_afastamentos').select('funcionario_nome, data_inicio, data_fim').eq('empresa_id', E).eq('status', 'ATIVO'),
    db.from('diretoria_relatorios').select('data_referencia, conteudo, status').eq('empresa_id', E).eq('tipo', 'DIARIO').gte('data_referencia', sem.inicio).lte('data_referencia', sem.fim).order('data_referencia'),
    db.from('diretoria_alertas').select('tipo, titulo').eq('empresa_id', E).gte('detectado_em', inicioDia(sem.inicio)).lt('detectado_em', fimDia(sem.fim)).order('detectado_em'),
  ]);
  falhou('contas a receber', (receb as any).error);
  falhou('contas a pagar', (pago as any).error);
  falhou('fichas de reserva', (fichas as any).error);
  falhou('ponto', (ponto as any).error);

  // --- Financeiro ---
  const valorRecebido = (l: any) => num(l.valor_pago) || num(l.valor_final);
  const serieRecebido = serie((receb.data || []) as any[], l => l.data_quitacao, valorRecebido, sems);
  const seriePago = serie((pago.data || []) as any[], l => l.data_quitacao, l => num(l.valor_pago) || num(l.valor), sems);
  const serieOpsCriadas = serie((opsCriadas.data || []) as any[], l => dataLocal(l.data_criacao), l => num(l.total_geral), sems);
  const serieOpsPagas = serie((opsPagas.data || []) as any[], l => dataLocal(l.pago_em), l => num(l.total_geral), sems);
  const recebidosSemana = ((receb.data || []) as any[]).filter(l => l.data_quitacao >= sem.inicio && l.data_quitacao <= sem.fim);
  const porCliente = new Map<string, number>();
  for (const l of recebidosSemana) porCliente.set(l.cliente || '(sem cliente)', (porCliente.get(l.cliente || '(sem cliente)') || 0) + valorRecebido(l));
  const abertosAteFim = ((receberAbertos.data || []) as any[]);
  const vencidosNoFim = abertosAteFim.filter(l => l.data_vencimento <= sem.fim && diasEntre(l.data_vencimento, prox.inicio) <= 365);

  const financeiro = {
    fonte_recebimentos: fonte,
    recebido_por_semana: serieRecebido,
    recebido_media_4_semanas_anteriores: mediaAnteriores(serieRecebido),
    variacao_pct_recebido_vs_media: variacao(serieRecebido[0].valor, mediaAnteriores(serieRecebido).valor),
    maiores_pagadores_semana: [...porCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cliente, valor]) => ({ cliente, valor: arred(valor) })),
    receber_vencido_ate_1_ano_hoje: { valor: arred(vencidosNoFim.reduce((s, l) => s + num(l.valor_final), 0)), qtd: vencidosNoFim.length },
    pago_p2s_por_semana: seriePago,
    ops_criadas_por_semana: serieOpsCriadas,
    ops_pagas_por_semana: serieOpsPagas,
    proxima_semana: {
      a_receber: { valor: arred(((receberProx.data || []) as any[]).reduce((s, l) => s + num(l.valor_final), 0)), qtd: (receberProx.data || []).length,
        maiores: ((receberProx.data || []) as any[]).sort((a, b) => num(b.valor_final) - num(a.valor_final)).slice(0, 5).map(l => ({ cliente: l.cliente, valor: arred(num(l.valor_final)), vencimento: l.data_vencimento, evento: l.evento })) },
      a_pagar_p2s: { valor: arred(((pagarProx.data || []) as any[]).reduce((s, l) => s + num(l.valor), 0)), qtd: (pagarProx.data || []).length,
        maiores: ((pagarProx.data || []) as any[]).sort((a, b) => num(b.valor) - num(a.valor)).slice(0, 5).map(l => ({ fornecedor: l.fornecedor, valor: arred(num(l.valor)), vencimento: l.data_vencimento, centro: l.centro })) },
    },
  };

  // --- Comercial ---
  const serieFichas = serie((fichas.data || []) as any[], l => l.data_emissao, l => num(l.valor_final), sems);
  const fichasSemana = ((fichas.data || []) as any[]).filter(l => l.data_emissao >= sem.inicio && l.data_emissao <= sem.fim);
  const comercial = {
    fichas_emitidas_por_semana: serieFichas,
    fichas_media_4_semanas_anteriores: mediaAnteriores(serieFichas),
    variacao_pct_fichas_valor_vs_media: variacao(serieFichas[0].valor, mediaAnteriores(serieFichas).valor),
    maiores_fichas_semana: fichasSemana.sort((a, b) => num(b.valor_final) - num(a.valor_final)).slice(0, 5).map(l => ({ numero: l.numero, cliente: l.cliente, evento: l.evento_feira, valor: arred(num(l.valor_final)), status: l.status })),
    locacoes_iniciando_proxima_semana: {
      qtd: (fichasProx.data || []).length,
      valor: arred(((fichasProx.data || []) as any[]).reduce((s, l) => s + num(l.valor_final), 0)),
      maiores: ((fichasProx.data || []) as any[]).sort((a, b) => num(b.valor_final) - num(a.valor_final)).slice(0, 8).map(l => ({ numero: l.numero, cliente: l.cliente, evento: l.evento_feira, valor: arred(num(l.valor_final)), inicio: l.data_inicial, fim: l.data_final })),
    },
  };

  // --- Expedição ---
  const divs = (divergencias.data || []) as any[];
  let divsEmpresa: any[] = [];
  if (divs.length) {
    const { data: doEmpresa } = await db.from('checklists').select('id').eq('empresa_id', E).in('id', [...new Set(divs.map(d => d.checklist_id))]);
    const ids = new Set(((doEmpresa || []) as any[]).map(c => c.id));
    divsEmpresa = divs.filter(d => ids.has(d.checklist_id));
  }
  const fora = (foraAgora.data || []) as any[];
  const expedicao = {
    checklists_criados_por_semana: serie((checklists.data || []) as any[], l => dataLocal(l.created_at), () => 0, sems).map(s => ({ semana: s.semana, qtd: s.qtd })),
    divergencias_semana: { qtd: divsEmpresa.length, retorno: divsEmpresa.filter(d => d.tipo === 'RETORNO').length, saida: divsEmpresa.filter(d => d.tipo === 'SAIDA').length,
      lista: divsEmpresa.slice(0, 10).map(d => ({ checklist: d.checklist_numero, tipo: d.tipo, item: d.descricao, esperado: num(d.qtd_esperada), real: num(d.qtd_real), evento: d.evento_feira })) },
    material_fora_agora: { qtd: fora.length, com_retorno_atrasado: fora.filter(c => c.periodo_fim && c.periodo_fim < prox.inicio).length },
  };

  // --- Frota ---
  const chk = (frotaChk.data || []) as any[];
  const frota = {
    saidas_por_semana: serie(chk, l => dataLocal(l.saida_em), () => 0, sems).map(s => ({ semana: s.semana, qtd: s.qtd })),
    ...(() => {
      const r = somarKm(chk.filter(l => { const d = dataLocal(l.saida_em) || ''; return d >= sem.inicio && d <= sem.fim; }));
      return { km_rodados_semana: r.km, viagens_com_km_suspeito: r.viagens_com_km_suspeito };
    })(),
    multas_novas_por_semana: serie((multas.data || []) as any[], l => dataLocal(l.created_at), l => num(l.valor), sems),
  };

  // --- RH ---
  const regs = (ponto.data || []) as any[];
  const incompletos = regs.filter(r => [r.entrada_1, r.saida_1, r.entrada_2, r.saida_2].filter(Boolean).length % 2 === 1);
  const porPessoa = new Map<string, number>();
  for (const r of incompletos) porPessoa.set(r.funcionario_nome, (porPessoa.get(r.funcionario_nome) || 0) + 1);
  const funcionarios = (func.data || []) as any[];
  const rh = {
    ponto_semana: { registros: regs.length, incompletos: incompletos.length, quem_mais_esqueceu: [...porPessoa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nome, dias]) => ({ nome, dias })) },
    admissoes: funcionarios.filter(f => f.data_admissao && f.data_admissao >= sem.inicio && f.data_admissao <= prox.fim).map(f => ({ nome: f.nome_completo, cargo: f.cargo, data: f.data_admissao })),
    desligamentos: funcionarios.filter(f => f.data_desligamento && f.data_desligamento >= sem.inicio && f.data_desligamento <= prox.fim).map(f => ({ nome: f.nome_completo, cargo: f.cargo, data: f.data_desligamento })),
    ferias_comecando_proxima_semana: ((ferias.data || []) as any[]).map(f => ({ nome: f.funcionario_nome, inicio: f.data_inicio_gozo, fim: f.data_fim_gozo })),
    afastamentos_ativos: ((afast.data || []) as any[]).map(f => ({ nome: f.funcionario_nome, ate: f.data_fim })),
  };

  // Fase 4: metas do mês até o fim da semana e projeção de caixa a partir de hoje.
  const [metas, caixa, locacao] = await Promise.all([
    progressoMetasDoMes(db, E, fonte, sem.fim).catch(() => null),
    projetarCaixa(db, empresa, hoje).then(resumoCaixa).catch(() => null),
    blocoLocacao(db, origem, hoje, falhou).catch(() => null),
  ]);

  return {
    versao: 1,
    empresa,
    metas,
    caixa,
    locacao,
    semana: sem,
    proxima_semana: prox,
    gerado_em: new Date().toISOString(),
    avisos,
    financeiro, comercial, expedicao, frota, rh,
    relatorios_diarios_da_semana: ((diarios.data || []) as any[]).map(r => ({ data: r.data_referencia, situacao: r.conteudo?.situacao ?? null, manchete: r.conteudo?.manchete ?? null })),
    alertas_da_semana: ((alertas.data || []) as any[]).map(a => ({ tipo: a.tipo, titulo: a.titulo })),
  };
}

export type { ValorQtd };
