// app/lib/diretoria/indicadoresDiarios.ts
// Números do Relatório Diário do Diretor — calculados AQUI, por código, a
// partir das tabelas do sistema. A IA (relatorioDiario.ts) só lê este objeto
// e escreve a análise; ela nunca soma nem conta nada sozinha. Isso é o que
// garante que o número do relatório é o mesmo número da tela de origem.
//
// "Ontem" (data de referência) é sempre no fuso de Brasília. O relatório das
// 10h de hoje analisa o dia de ontem fechado + a agenda de hoje em diante.
//
// Limitações conhecidas (vão como `avisos` pro relatório não fingir certeza):
// - Contas a pagar do P2S só traz em aberto com vencimento de hoje em diante
//   (ver contasPagarCore.ts) — "contas a pagar vencidas" não existe aqui.
// - Fichas e contas vêm do sync com o P2S (9h30, 11h e 17h) — o que mudou no
//   P2S depois das 9h30 de hoje não entra no relatório das 10h.
// - Os status das fichas são o código cru do P2S (RE, EN, EP, X, A, E, SB, CA).
import { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { progressoMetasDoMes } from './metas';
import { rotuloStatusP2s } from '../locacao/statusP2s';

type DB = ReturnType<typeof supabaseAdmin>;
export type ValorQtd = { valor: number; qtd: number };

const FUSO = 'America/Sao_Paulo';

export function hojeISO(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(deISO: string, ateISO: string): number {
  return Math.round((new Date(`${ateISO}T12:00:00Z`).getTime() - new Date(`${deISO}T12:00:00Z`).getTime()) / 86_400_000);
}

// Início/fim de um dia de Brasília em timestamptz (Brasil sem horário de verão desde 2019).
const inicioDia = (iso: string) => `${iso}T00:00:00-03:00`;
const fimDia = (iso: string) => `${somarDias(iso, 1)}T00:00:00-03:00`;

const arred = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v) || 0;
const vq = (linhas: unknown[], campo: (l: any) => number): ValorQtd => ({ valor: arred(linhas.reduce<number>((s, l) => s + campo(l), 0)), qtd: linhas.length });

function maiores<T>(linhas: T[], valor: (l: T) => number, mapa: (l: T) => Record<string, unknown>, n = 5) {
  return [...linhas].sort((a, b) => valor(b) - valor(a)).slice(0, n).map(mapa);
}

// Mês corrente até a data D e o mesmo recorte do mês anterior (dia 1 → mesmo
// dia, ou o último dia do mês anterior se ele for mais curto).
function periodosMes(d: string) {
  const [ano, mes, dia] = d.split('-').map(Number);
  const inicio = `${d.slice(0, 7)}-01`;
  const anterior = new Date(Date.UTC(ano, mes - 2, 1));
  const ultimoDiaAnterior = new Date(Date.UTC(ano, mes - 1, 0)).getUTCDate();
  const inicioAnt = anterior.toISOString().slice(0, 10);
  const fimAnt = `${inicioAnt.slice(0, 7)}-${String(Math.min(dia, ultimoDiaAnterior)).padStart(2, '0')}`;
  return { inicio, fim: d, inicioAnt, fimAnt };
}

async function ultimaSyncOk(db: DB, integracao: string): Promise<string | null> {
  const { data } = await db.from('integracoes_sync_log').select('finalizado_em').eq('integracao', integracao).eq('status', 'sucesso')
    .order('finalizado_em', { ascending: false }).limit(1).maybeSingle();
  return (data?.finalizado_em as string) || null;
}

export type FonteRecebimentos = 'P2S' | 'EXTERNA';

export interface IndicadoresDiarios {
  versao: 1;
  empresa: { id: number; nome: string };
  data_referencia: string;
  dia_semana_referencia: string;
  hoje: string;
  gerado_em: string;
  frescor_dados: Record<string, string | null>;
  avisos: string[];
  financeiro: Record<string, any>;
  comercial: Record<string, any>;
  expedicao: Record<string, any>;
  frota: Record<string, any>;
  rh: Record<string, any>;
  metas?: Awaited<ReturnType<typeof progressoMetasDoMes>> | null;
}

export async function calcularIndicadoresDiarios(db: DB, empresa: { id: number; nome: string }, dataReferencia?: string): Promise<IndicadoresDiarios> {
  const D = dataReferencia || somarDias(hojeISO(), -1);
  const T = somarDias(D, 1);
  const E = empresa.id;
  const avisos: string[] = [];
  const falhou = (area: string, e: { message?: string } | null | undefined) => {
    if (e) avisos.push(`Falha ao ler ${area}: ${e.message || 'erro desconhecido'} — números dessa área podem estar incompletos.`);
  };

  // Parâmetro da empresa (Parâmetros → Empresas do Grupo): recebimentos no
  // P2S ou de outra fonte ainda não integrada. select('*') pra não quebrar
  // se o código subir antes do SQL (empresas_fonte_recebimentos.sql).
  const { data: cadastro } = await db.from('empresas').select('*').eq('id', E).maybeSingle();
  const fonteRecebimentos: FonteRecebimentos = cadastro?.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S';
  if (fonteRecebimentos === 'EXTERNA') avisos.push('Os recebimentos desta empresa vêm de uma fonte externa, ainda não integrada ao sistema — recebido, a receber e inadimplência ficam fora deste relatório.');

  const [financeiro, comercial, expedicao, frota, rh, metas] = await Promise.all([
    blocoFinanceiro(db, E, D, T, falhou, fonteRecebimentos),
    blocoComercial(db, E, D, T, falhou),
    blocoExpedicao(db, E, D, T, falhou),
    blocoFrota(db, E, D, T, falhou),
    blocoRh(db, E, D, T, falhou),
    // Metas do mês até ontem (Fase 4) — sem tabela/metas cadastradas, vem tudo SEM_META.
    progressoMetasDoMes(db, E, fonteRecebimentos, D).catch(() => null),
  ]);

  // Variações prontas — a IA não faz conta, nem de porcentagem.
  const variacao = (atual: number, anterior: number) => (anterior > 0 ? Math.round(((atual - anterior) / anterior) * 1000) / 10 : null);
  const financeiroFinal = { ...financeiro, variacao_pct_recebido_mes: variacao(financeiro.recebido_mes_ate_ontem.valor, financeiro.recebido_mesmo_periodo_mes_anterior.valor) };
  const comercialFinal = { ...comercial, variacao_pct_fichas_valor_mes: variacao(comercial.fichas_emitidas_mes_ate_ontem.valor, comercial.fichas_emitidas_mesmo_periodo_mes_anterior.valor) };

  const [cr, cp, fichas] = await Promise.all([
    ultimaSyncOk(db, 'contas_receber'), ultimaSyncOk(db, 'contas_pagar'), ultimaSyncOk(db, 'fichas_reserva'),
  ]);
  if (!cr && fonteRecebimentos === 'P2S') avisos.push('Contas a Receber ainda não foram sincronizadas do P2S — recebimentos e inadimplência ficam zerados.');
  const fontes = [['contas a pagar', cp], ['fichas de reserva', fichas]] as [string, string | null][];
  if (fonteRecebimentos === 'P2S') fontes.unshift(['contas a receber', cr]);
  for (const [nome, quando] of fontes) {
    if (quando && Date.now() - new Date(quando).getTime() > 26 * 3_600_000) avisos.push(`A última sincronização bem-sucedida de ${nome} com o P2S foi em ${new Date(quando).toLocaleString('pt-BR', { timeZone: FUSO })} — os números dessa área podem estar desatualizados.`);
  }

  // Horário de Brasília por extenso — em ISO/UTC a IA leu "20h" onde era 17h.
  const quandoBR = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null);

  return {
    versao: 1,
    empresa,
    data_referencia: D,
    dia_semana_referencia: new Date(`${D}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }),
    hoje: T,
    gerado_em: new Date().toISOString(),
    frescor_dados: { contas_receber: quandoBR(cr), contas_pagar: quandoBR(cp), fichas_reserva: quandoBR(fichas) },
    avisos,
    financeiro: financeiroFinal, comercial: comercialFinal, expedicao, frota, rh,
    metas,
  };
}

type Falhou = (area: string, e: { message?: string } | null | undefined) => void;

async function blocoFinanceiro(db: DB, E: number, D: string, T: string, falhou: Falhou, fonteRecebimentos: FonteRecebimentos) {
  const mes = periodosMes(D);
  const vazio = Promise.resolve({ data: [] as any[], error: null });
  const doP2s = fonteRecebimentos === 'P2S';
  const [recebOntem, recebMes, recebMesAnt, abertos, pagoOntem, pagar7d, opsCriadas, opsPagas, opsPendentes, lotes] = await Promise.all([
    doP2s ? db.from('financeiro_contas_receber').select('cliente, valor_pago, valor_final, documento, num_documento, evento').eq('empresa_id', E).eq('quitado', true).eq('data_quitacao', D) : vazio,
    doP2s ? buscarTodasPaginas((de, ate) => db.from('financeiro_contas_receber').select('id, valor_pago, valor_final').eq('empresa_id', E).eq('quitado', true).gte('data_quitacao', mes.inicio).lte('data_quitacao', mes.fim).order('id').range(de, ate)) : vazio,
    doP2s ? buscarTodasPaginas((de, ate) => db.from('financeiro_contas_receber').select('id, valor_pago, valor_final').eq('empresa_id', E).eq('quitado', true).gte('data_quitacao', mes.inicioAnt).lte('data_quitacao', mes.fimAnt).order('id').range(de, ate)) : vazio,
    doP2s ? buscarTodasPaginas((de, ate) => db.from('financeiro_contas_receber').select('id, cliente, valor_final, data_vencimento, documento, num_documento, evento, prorrogado').eq('empresa_id', E).eq('quitado', false).order('id').range(de, ate)) : vazio,
    db.from('financeiro_contas_pagar').select('fornecedor, valor, valor_pago, centro, descricao').eq('empresa_id', E).eq('quitado', true).eq('data_quitacao', D),
    db.from('financeiro_contas_pagar').select('fornecedor, valor, centro, data_vencimento, descricao').eq('empresa_id', E).eq('quitado', false).gte('data_vencimento', T).lte('data_vencimento', somarDias(T, 7)),
    db.from('op_ordens_pagamento').select('numero_op, empresa_recebedora, natureza_pagamento, total_geral, data_vencimento, os_evento').eq('empresa_id', E).gte('data_criacao', inicioDia(D)).lt('data_criacao', fimDia(D)),
    db.from('op_ordens_pagamento').select('numero_op, total_geral').eq('empresa_id', E).gte('pago_em', inicioDia(D)).lt('pago_em', fimDia(D)),
    db.from('op_ordens_pagamento').select('numero_op, empresa_recebedora, natureza_pagamento, total_geral, data_vencimento, data_criacao').eq('empresa_id', E).eq('status', 'PENDENTE'),
    db.from('financeiro_lotes_pagamento').select('id, nome_lote, status, valor_total, criado_em').eq('empresa_id', E).eq('ativo', true).or(`status.eq.ERRO,and(criado_em.gte.${inicioDia(D)},criado_em.lt.${fimDia(D)})`),
  ]);
  falhou('contas a receber', recebOntem.error || abertos.error);
  falhou('contas a pagar', pagoOntem.error || pagar7d.error);
  falhou('ordens de pagamento', opsCriadas.error || opsPendentes.error);
  // Títulos de Centro sem empresa cadastrada (ex.: ELITE, 2026-11) são de
  // outra empresa do grupo — entram sozinhos no relatório dela quando ela
  // for cadastrada em Empresas do Grupo (o sync casa pelo nome do Centro).

  const valorRecebido = (l: any) => num(l.valor_pago) || num(l.valor_final);
  const recebidosOntem = (recebOntem.data || []) as any[];
  const listaAbertos = (abertos.data || []) as any[];
  const vencidos = listaAbertos.filter(l => l.data_vencimento && l.data_vencimento < T);
  const aVencer7d = listaAbertos.filter(l => l.data_vencimento && l.data_vencimento >= T && l.data_vencimento <= somarDias(T, 7));
  const atraso = (l: any) => diasEntre(l.data_vencimento, T);
  const faixa = (min: number, max: number) => vq(vencidos.filter(l => atraso(l) >= min && atraso(l) <= max), l => num(l.valor_final));

  // Maiores devedores (até 1 ano de atraso — acima disso é quase sempre baixa
  // pendente no P2S, vai separado na faixa "acima_365").
  const porCliente = new Map<string, { valor: number; qtd: number; dias_atraso_max: number }>();
  for (const l of vencidos.filter(l => atraso(l) <= 365)) {
    const c = l.cliente || '(sem cliente)';
    const atual = porCliente.get(c) || { valor: 0, qtd: 0, dias_atraso_max: 0 };
    atual.valor += num(l.valor_final); atual.qtd++; atual.dias_atraso_max = Math.max(atual.dias_atraso_max, atraso(l));
    porCliente.set(c, atual);
  }

  const pendentes = (opsPendentes.data || []) as any[];
  const lotesLista = (lotes.data || []) as any[];

  return {
    fonte_recebimentos: fonteRecebimentos,
    recebido_ontem: {
      ...vq(recebidosOntem, valorRecebido),
      maiores: maiores(recebidosOntem, valorRecebido, l => ({ cliente: l.cliente, valor: arred(valorRecebido(l)), documento: [l.documento, l.num_documento].filter(Boolean).join(' '), evento: l.evento })),
    },
    recebido_mes_ate_ontem: vq(recebMes.data, valorRecebido),
    recebido_mesmo_periodo_mes_anterior: vq(recebMesAnt.data, valorRecebido),
    periodo_mes: mes,
    receber_vencendo_7d: {
      ...vq(aVencer7d, l => num(l.valor_final)),
      maiores: maiores(aVencer7d, l => num(l.valor_final), l => ({ cliente: l.cliente, valor: arred(num(l.valor_final)), vencimento: l.data_vencimento, evento: l.evento })),
    },
    receber_vencidos: {
      ...vq(vencidos, l => num(l.valor_final)),
      faixas_atraso: { ate_30_dias: faixa(1, 30), de_31_a_90: faixa(31, 90), de_91_a_365: faixa(91, 365), acima_365: faixa(366, 1_000_000) },
      venceram_ontem: {
        ...vq(vencidos.filter(l => l.data_vencimento === D), l => num(l.valor_final)),
        lista: vencidos.filter(l => l.data_vencimento === D).slice(0, 10).map(l => ({ cliente: l.cliente, valor: arred(num(l.valor_final)), documento: [l.documento, l.num_documento].filter(Boolean).join(' ') })),
      },
      maiores_devedores_ate_1_ano: [...porCliente.entries()].sort((a, b) => b[1].valor - a[1].valor).slice(0, 10)
        .map(([cliente, v]) => ({ cliente, valor: arred(v.valor), titulos: v.qtd, dias_atraso_max: v.dias_atraso_max })),
    },
    pago_ontem_p2s: {
      ...vq(pagoOntem.data || [], l => num(l.valor_pago) || num(l.valor)),
      maiores: maiores((pagoOntem.data || []) as any[], l => num(l.valor_pago) || num(l.valor), l => ({ fornecedor: l.fornecedor, valor: arred(num(l.valor_pago) || num(l.valor)), centro: l.centro, descricao: l.descricao })),
    },
    pagar_vencendo_7d_p2s: {
      ...vq(pagar7d.data || [], l => num(l.valor)),
      maiores: maiores((pagar7d.data || []) as any[], l => num(l.valor), l => ({ fornecedor: l.fornecedor, valor: arred(num(l.valor)), vencimento: l.data_vencimento, centro: l.centro })),
    },
    ops: {
      criadas_ontem: {
        ...vq(opsCriadas.data || [], l => num(l.total_geral)),
        lista: maiores((opsCriadas.data || []) as any[], l => num(l.total_geral), l => ({ numero_op: l.numero_op, favorecido: l.empresa_recebedora, natureza: l.natureza_pagamento, valor: arred(num(l.total_geral)), vencimento: l.data_vencimento, evento: l.os_evento }), 10),
      },
      pagas_ontem: vq(opsPagas.data || [], l => num(l.total_geral)),
      pendentes_aprovacao: {
        ...vq(pendentes, l => num(l.total_geral)),
        vencidas: vq(pendentes.filter(l => l.data_vencimento && l.data_vencimento < T), l => num(l.total_geral)),
        mais_antigas: [...pendentes].sort((a, b) => String(a.data_criacao).localeCompare(String(b.data_criacao))).slice(0, 5)
          .map(l => ({ numero_op: l.numero_op, favorecido: l.empresa_recebedora, valor: arred(num(l.total_geral)), dias_pendente: diasEntre(String(l.data_criacao).slice(0, 10), T), vencimento: l.data_vencimento })),
      },
    },
    lotes_pagamento: {
      com_erro: lotesLista.filter(l => l.status === 'ERRO').map(l => ({ id: l.id, nome: l.nome_lote, valor: arred(num(l.valor_total)) })),
      criados_ontem: vq(lotesLista.filter(l => l.criado_em >= inicioDia(D) && l.criado_em < fimDia(D)), l => num(l.valor_total)),
    },
  };
}

async function blocoComercial(db: DB, E: number, D: string, T: string, falhou: Falhou) {
  const mes = periodosMes(D);
  const campos = 'numero, cliente, evento_feira, valor_final, data_inicial, data_final, status, vendedor';
  const [emitidasOntem, doMes, doMesAnt, iniciando, encerrando, suspensas] = await Promise.all([
    db.from('fichas_reserva').select(campos).eq('empresa_id', E).eq('data_emissao', D).neq('status', 'CA'),
    buscarTodasPaginas((de, ate) => db.from('fichas_reserva').select('id, valor_final, status').eq('empresa_id', E).gte('data_emissao', mes.inicio).lte('data_emissao', mes.fim).order('id').range(de, ate)),
    buscarTodasPaginas((de, ate) => db.from('fichas_reserva').select('id, valor_final, status').eq('empresa_id', E).gte('data_emissao', mes.inicioAnt).lte('data_emissao', mes.fimAnt).order('id').range(de, ate)),
    db.from('fichas_reserva').select(campos).eq('empresa_id', E).gte('data_inicial', T).lte('data_inicial', somarDias(T, 7)).neq('status', 'CA').order('data_inicial'),
    db.from('fichas_reserva').select(campos).eq('empresa_id', E).gte('data_final', D).lte('data_final', somarDias(T, 3)).neq('status', 'CA').order('data_final'),
    db.from('fichas_reserva').select(campos + ', justificativa_suspensao').eq('empresa_id', E).eq('faturamento_suspenso', true).gte('data_final', somarDias(D, -90)),
  ]);
  falhou('fichas de reserva', emitidasOntem.error || iniciando.error);
  const ficha = (l: any) => ({ numero: l.numero, cliente: l.cliente, evento: l.evento_feira, valor: arred(num(l.valor_final)), inicio: l.data_inicial, fim: l.data_final, status: rotuloStatusP2s(l.status), vendedor: l.vendedor });
  const semCanceladas = (linhas: any[]) => linhas.filter(l => l.status !== 'CA');
  const porStatus = (linhas: any[]) => linhas.reduce((m: Record<string, number>, l) => { const s = rotuloStatusP2s(l.status); m[s] = (m[s] || 0) + 1; return m; }, {});

  return {
    fichas_emitidas_ontem: { ...vq(emitidasOntem.data || [], l => num(l.valor_final)), lista: maiores((emitidasOntem.data || []) as any[], l => num(l.valor_final), ficha, 10) },
    fichas_emitidas_mes_ate_ontem: { ...vq(semCanceladas(doMes.data), l => num(l.valor_final)), por_status: porStatus(doMes.data) },
    fichas_emitidas_mesmo_periodo_mes_anterior: vq(semCanceladas(doMesAnt.data), l => num(l.valor_final)),
    locacoes_iniciando_proximos_7d: { ...vq(iniciando.data || [], l => num(l.valor_final)), lista: ((iniciando.data || []) as any[]).slice(0, 15).map(ficha) },
    locacoes_encerrando_ate_3d: { qtd: (encerrando.data || []).length, lista: ((encerrando.data || []) as any[]).slice(0, 15).map(ficha) },
    faturamento_suspenso_90d: { qtd: (suspensas.data || []).length, lista: ((suspensas.data || []) as any[]).slice(0, 10).map(l => ({ ...ficha(l), justificativa: l.justificativa_suspensao })) },
  };
}

async function blocoExpedicao(db: DB, E: number, D: string, T: string, falhou: Falhou) {
  const [criados, semRetorno, divergencias] = await Promise.all([
    db.from('checklists').select('numero, evento_feira, cliente, status').eq('empresa_id', E).gte('created_at', inicioDia(D)).lt('created_at', fimDia(D)),
    db.from('checklists').select('numero, evento_feira, cliente, periodo_fim, responsavel_saida').eq('empresa_id', E).eq('status', 'SAIDA_CONFERIDA'),
    db.from('checklist_divergencias').select('checklist_id, checklist_numero, tipo, secao, descricao, qtd_esperada, qtd_real, evento_feira, cliente').gte('created_at', inicioDia(D)).lt('created_at', fimDia(D)),
  ]);
  falhou('expedição', criados.error || semRetorno.error || divergencias.error);
  // checklist_divergencias não tem empresa_id — filtra pelos checklists da empresa.
  const divs = (divergencias.data || []) as any[];
  let divsEmpresa: any[] = [];
  if (divs.length) {
    const { data: doEmpresa } = await db.from('checklists').select('id').eq('empresa_id', E).in('id', [...new Set(divs.map(d => d.checklist_id))]);
    const ids = new Set(((doEmpresa || []) as any[]).map(c => c.id));
    divsEmpresa = divs.filter(d => ids.has(d.checklist_id));
  }
  const fora = (semRetorno.data || []) as any[];
  return {
    checklists_criados_ontem: (criados.data || []).length,
    material_fora: {
      qtd: fora.length,
      retorno_atrasado: fora.filter(c => c.periodo_fim && c.periodo_fim < T)
        .map(c => ({ checklist: c.numero, evento: c.evento_feira, cliente: c.cliente, fim_previsto: c.periodo_fim, dias_atraso: diasEntre(c.periodo_fim, T), responsavel_saida: c.responsavel_saida }))
        .sort((a, b) => b.dias_atraso - a.dias_atraso).slice(0, 15),
    },
    divergencias_ontem: {
      qtd: divsEmpresa.length,
      lista: divsEmpresa.slice(0, 15).map(d => ({ checklist: d.checklist_numero, tipo: d.tipo, item: d.descricao, secao: d.secao, esperado: num(d.qtd_esperada), real: num(d.qtd_real), evento: d.evento_feira, cliente: d.cliente })),
    },
  };
}

async function blocoFrota(db: DB, E: number, D: string, T: string, falhou: Falhou) {
  const [veiculos, saidas, retornos, emAndamento, multas, pedagios, manutencoes] = await Promise.all([
    db.from('frota_veiculos').select('id, apelido, placa, status, propriedade, crlv_vencimento, seguro_vigencia_fim, ipva_vencimento, locacao_vigencia_fim').eq('empresa_id', E),
    db.from('frota_checklists').select('id').eq('empresa_id', E).gte('saida_em', inicioDia(D)).lt('saida_em', fimDia(D)),
    db.from('frota_checklists').select('id').eq('empresa_id', E).gte('retorno_em', inicioDia(D)).lt('retorno_em', fimDia(D)),
    db.from('frota_checklists').select('veiculo_id, motorista_nome, destino, saida_em').eq('empresa_id', E).eq('status', 'EM_ANDAMENTO'),
    db.from('frota_multas_debitos').select('veiculo_id, tipo, descricao, valor, data_infracao, prazo_indicacao_condutor, condutor_indicado_em, condutor_nome, created_at, data_vencimento').eq('empresa_id', E).eq('status', 'ABERTO'),
    db.from('frota_pedagios').select('placa, valor, data_limite_pagamento').eq('empresa_id', E).eq('status', 'ABERTO'),
    db.from('frota_manutencoes').select('veiculo_id, tipo, proxima_data, descricao').gte('proxima_data', D).lte('proxima_data', somarDias(T, 15)),
  ]);
  falhou('frota', veiculos.error || multas.error);
  const listaVeiculos = (veiculos.data || []) as any[];
  const nomeVeiculo = new Map(listaVeiculos.map(v => [v.id, `${v.apelido || v.placa}${v.placa && v.apelido ? ` (${v.placa})` : ''}`]));
  const idsEmpresa = new Set(listaVeiculos.map(v => v.id));

  const limite30 = somarDias(T, 30);
  const documentos: { veiculo: string; documento: string; vencimento: string; dias: number }[] = [];
  for (const v of listaVeiculos.filter(v => v.status === 'ATIVO')) {
    const campos: [string, string | null][] = [['CRLV', v.crlv_vencimento], ['IPVA', v.ipva_vencimento],
      v.propriedade === 'ALUGADO' ? ['Contrato de locação', v.locacao_vigencia_fim] : ['Seguro', v.seguro_vigencia_fim]];
    for (const [doc, venc] of campos) if (venc && venc <= limite30) documentos.push({ veiculo: nomeVeiculo.get(v.id) || '?', documento: doc, vencimento: venc, dias: diasEntre(T, venc) });
  }

  const listaMultas = (multas.data || []) as any[];
  const limite7 = somarDias(T, 7);
  const listaPedagios = (pedagios.data || []) as any[];
  return {
    veiculos_ativos: listaVeiculos.filter(v => v.status === 'ATIVO').length,
    saidas_ontem: (saidas.data || []).length,
    retornos_ontem: (retornos.data || []).length,
    veiculos_na_rua_agora: ((emAndamento.data || []) as any[]).map(c => ({ veiculo: nomeVeiculo.get(c.veiculo_id) || '?', motorista: c.motorista_nome, destino: c.destino, saiu_em: c.saida_em, dias_fora: diasEntre(String(c.saida_em).slice(0, 10), T) })),
    multas_abertas: {
      ...vq(listaMultas, l => num(l.valor)),
      novas_ontem: listaMultas.filter(m => m.created_at >= inicioDia(D) && m.created_at < fimDia(D)).map(m => ({ veiculo: nomeVeiculo.get(m.veiculo_id) || '?', descricao: m.descricao, valor: arred(num(m.valor)) })),
      prazo_indicacao_condutor_7d: listaMultas.filter(m => m.prazo_indicacao_condutor && !m.condutor_indicado_em && m.prazo_indicacao_condutor <= limite7)
        .map(m => ({ veiculo: nomeVeiculo.get(m.veiculo_id) || '?', prazo: m.prazo_indicacao_condutor, dias: diasEntre(T, m.prazo_indicacao_condutor), condutor: m.condutor_nome })),
    },
    pedagios_abertos: {
      ...vq(listaPedagios, l => num(l.valor)),
      vencendo_3d: vq(listaPedagios.filter(p => p.data_limite_pagamento && p.data_limite_pagamento <= somarDias(T, 3)), l => num(l.valor)),
    },
    documentos_vencendo_30d: documentos.sort((a, b) => a.dias - b.dias),
    manutencoes_proximas_15d: ((manutencoes.data || []) as any[]).filter(m => idsEmpresa.has(m.veiculo_id))
      .map(m => ({ veiculo: nomeVeiculo.get(m.veiculo_id) || '?', tipo: m.tipo, data: m.proxima_data, descricao: m.descricao })),
  };
}

async function blocoRh(db: DB, E: number, D: string, T: string, falhou: Falhou) {
  const [ativos, admissoes, desligamentos, ponto, feriasAndamento, feriasProximas, afastamentos, rescisoes] = await Promise.all([
    db.from('folha_funcionarios').select('id', { count: 'exact', head: true }).eq('empresa_id', E).eq('ativo', true),
    db.from('folha_funcionarios').select('nome_completo, cargo, data_admissao').eq('empresa_id', E).gte('data_admissao', somarDias(D, -6)).lte('data_admissao', somarDias(T, 7)),
    db.from('folha_funcionarios').select('nome_completo, cargo, data_desligamento').eq('empresa_id', E).gte('data_desligamento', somarDias(D, -6)).lte('data_desligamento', somarDias(T, 7)),
    db.from('folha_ponto_diaria').select('funcionario_nome, entrada_1, saida_1, entrada_2, saida_2').eq('empresa_id', E).eq('data_registro', D),
    db.from('folha_ferias').select('funcionario_nome, data_inicio_gozo, data_fim_gozo').eq('empresa_id', E).eq('status', 'AGENDADA').lte('data_inicio_gozo', T).gte('data_fim_gozo', T),
    db.from('folha_ferias').select('funcionario_nome, data_inicio_gozo, data_fim_gozo').eq('empresa_id', E).eq('status', 'AGENDADA').gt('data_inicio_gozo', T).lte('data_inicio_gozo', somarDias(T, 7)),
    db.from('folha_afastamentos').select('funcionario_nome, data_inicio, data_fim').eq('empresa_id', E).eq('status', 'ATIVO'),
    db.from('folha_rescisoes').select('funcionario_nome, status, data_desligamento, valor_total_liquido').eq('empresa_id', E).neq('status', 'CANCELADA').is('pago_em', null),
  ]);
  falhou('RH', ponto.error || ativos.error);
  const registros = (ponto.data || []) as any[];
  // Ponto com número ímpar de batidas = entrada sem saída (ou vice-versa).
  const incompletos = registros.filter(r => [r.entrada_1, r.saida_1, r.entrada_2, r.saida_2].filter(Boolean).length % 2 === 1);
  return {
    funcionarios_ativos: ativos.count || 0,
    admissoes_ultimos_7d_e_proximos_7d: (admissoes.data || []).map((f: any) => ({ nome: f.nome_completo, cargo: f.cargo, data: f.data_admissao })),
    desligamentos_ultimos_7d_e_proximos_7d: (desligamentos.data || []).map((f: any) => ({ nome: f.nome_completo, cargo: f.cargo, data: f.data_desligamento })),
    ponto_ontem: { registros: registros.length, incompletos: incompletos.length, nomes_incompletos: incompletos.slice(0, 15).map(r => r.funcionario_nome) },
    ferias_em_andamento: (feriasAndamento.data || []).map((f: any) => ({ nome: f.funcionario_nome, ate: f.data_fim_gozo })),
    ferias_comecando_7d: (feriasProximas.data || []).map((f: any) => ({ nome: f.funcionario_nome, inicio: f.data_inicio_gozo, fim: f.data_fim_gozo })),
    afastamentos_ativos: (afastamentos.data || []).map((f: any) => ({ nome: f.funcionario_nome, desde: f.data_inicio, ate: f.data_fim })),
    rescisoes_a_pagar: ((rescisoes.data || []) as any[]).map(r => ({ nome: r.funcionario_nome, status: r.status, desligamento: r.data_desligamento, valor: arred(num(r.valor_total_liquido)) })),
  };
}
