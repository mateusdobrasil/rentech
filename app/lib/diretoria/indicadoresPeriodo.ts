// app/lib/diretoria/indicadoresPeriodo.ts
// Números dos relatórios MENSAL e ANUAL do Diretor (Fase 4, 2026-11-15).
// Recebe uma lista de períodos: o primeiro é o analisado (com detalhes —
// maiores clientes, centros, naturezas…), os demais são comparação (só
// totais). Tudo calculado aqui; a IA só lê.
//   Mensal: [mês M, M-1 … M-5, mesmo mês do ano anterior]
//   Anual:  [ano Y, ano Y-1, jan … dez de Y]
import { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { hojeISO, somarDias, type FonteRecebimentos } from './indicadoresDiarios';
import { progressoMetasDoMes, metasDoAno } from './metas';
import { projetarCaixa, resumoCaixa } from './caixa';
import { somarKm } from './km';
import { fonteDoDiretor, descreverFonte, lerReceber, lerPagar, lerFichas } from './fontes';

type DB = ReturnType<typeof supabaseAdmin>;
export interface Periodo { rotulo: string; inicio: string; fim: string }

const FUSO = 'America/Sao_Paulo';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const num = (v: unknown) => Number(v) || 0;
const arred = (n: number) => Math.round(n * 100) / 100;
const dataLocal = (ts: string | null | undefined) => (ts ? new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(ts)) : null);
const fimDoMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, '0')}`;
const periodoMes = (ano: number, mes: number): Periodo => {
  const d = new Date(Date.UTC(ano, mes - 1, 1));
  const a = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return { rotulo: `${MESES[m - 1]}/${a}`, inicio: `${a}-${String(m).padStart(2, '0')}-01`, fim: fimDoMes(a, m) };
};

// Mês fechado anterior a `hoje` (no dia 1, o mês que acabou ontem).
export function mesFechado(hoje = hojeISO()): { ano: number; mes: number } {
  const [a, m] = hoje.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

export function periodosMensal(ano: number, mes: number): Periodo[] {
  return [0, 1, 2, 3, 4, 5].map(i => periodoMes(ano, mes - i)).concat([{ ...periodoMes(ano - 1, mes), rotulo: `${MESES[mes - 1]}/${ano - 1} (mesmo mês do ano anterior)` }]);
}

export function periodosAnual(ano: number): Periodo[] {
  return [
    { rotulo: String(ano), inicio: `${ano}-01-01`, fim: `${ano}-12-31` },
    { rotulo: String(ano - 1), inicio: `${ano - 1}-01-01`, fim: `${ano - 1}-12-31` },
    ...Array.from({ length: 12 }, (_, i) => periodoMes(ano, i + 1)),
  ];
}

// `cobertoDesde`: a partir de quando o sistema tem o dado completo — período
// que começa antes sai marcado `dados_incompletos` (a IA não deve comparar com ele).
function porPeriodo(periodos: Periodo[], linhas: any[], data: (l: any) => string | null | undefined, valor: (l: any) => number, cobertoDesde?: string | null) {
  return periodos.map(p => {
    const da = linhas.filter(l => { const d = (data(l) || '').slice(0, 10); return d >= p.inicio && d <= p.fim; });
    return { periodo: p.rotulo, valor: arred(da.reduce((s, l) => s + valor(l), 0)), qtd: da.length, ...(cobertoDesde && p.inicio < cobertoDesde ? { dados_incompletos: true } : {}) };
  });
}

// Até onde vai o histórico de cada fonte no sistema (2026-11-15):
// - contas a receber/pagar: o sync guarda quitados com vencimento nos últimos
//   400 dias → pagamentos de um mês só estão completos a partir de ~370 dias atrás;
// - fichas: o sync via API começou com 90 dias de histórico na 1ª carga completa.
async function coberturaDados(db: DB) {
  const hoje = hojeISO();
  const { data } = await db.from('integracoes_sync_log').select('finalizado_em').eq('integracao', 'fichas_reserva').eq('status', 'sucesso').eq('tipo', 'completa')
    .order('finalizado_em').limit(1).maybeSingle();
  const primeiraFichas = data?.finalizado_em ? String(data.finalizado_em).slice(0, 10) : null;
  return { financeiro: somarDias(hoje, -370), fichas: primeiraFichas ? somarDias(primeiraFichas, -90) : null };
}
function agrupar(linhas: any[], chave: (l: any) => string, valor: (l: any) => number, n = 10) {
  const m = new Map<string, { valor: number; qtd: number }>();
  for (const l of linhas) { const k = (chave(l) || '').trim() || '(não informado)'; const a = m.get(k) || { valor: 0, qtd: 0 }; a.valor += valor(l); a.qtd++; m.set(k, a); }
  return [...m.entries()].sort((a, b) => b[1].valor - a[1].valor).slice(0, n).map(([nome, v]) => ({ nome, valor: arred(v.valor), qtd: v.qtd }));
}
const variacao = (atual: number, base: number) => (base > 0 ? Math.round(((atual - base) / base) * 1000) / 10 : null);

export interface IndicadoresPeriodo {
  versao: 1;
  tipo: 'MENSAL' | 'ANUAL';
  empresa: { id: number; nome: string };
  periodo: Periodo;
  periodos_comparacao: Periodo[];
  gerado_em: string;
  avisos: string[];
  financeiro: Record<string, any>;
  comercial: Record<string, any>;
  expedicao: Record<string, any>;
  frota: Record<string, any>;
  rh: Record<string, any>;
  metas: unknown;
  caixa: unknown;
  alertas_por_tipo: { nome: string; qtd: number }[];
  relatorios_do_periodo: { data: string; tipo: string; situacao: string | null; manchete: string | null }[];
}

export async function calcularIndicadoresPeriodo(db: DB, empresa: { id: number; nome: string }, tipo: 'MENSAL' | 'ANUAL', periodos: Periodo[]): Promise<IndicadoresPeriodo> {
  const E = empresa.id;
  const [P] = periodos;
  const desde = periodos.reduce((m, p) => (p.inicio < m ? p.inicio : m), P.inicio);
  const ate = periodos.reduce((m, p) => (p.fim > m ? p.fim : m), P.fim);
  const ini = (d: string) => `${d}T00:00:00-03:00`;
  const fimTs = (d: string) => `${somarDias(d, 1)}T00:00:00-03:00`;
  const avisos: string[] = [];
  const falhou = (area: string, e: any) => { if (e) avisos.push(`Falha ao ler ${area}: ${e.message || 'erro'} — números dessa área podem estar incompletos.`); };

  const { data: cadastro } = await db.from('empresas').select('*').eq('id', E).maybeSingle();
  const fonte: FonteRecebimentos = cadastro?.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S';
  if (fonte === 'EXTERNA') avisos.push('Os recebimentos desta empresa vêm de uma fonte externa, ainda não integrada ao sistema — recebido, a receber e inadimplência ficam fora deste relatório.');
  const vazio = Promise.resolve({ data: [] as any[], error: null });
  // Antes ou depois da virada da chave (fontes.ts): de onde vêm contas e fichas.
  const origem = await fonteDoDiretor(db, E);
  const avisoFonte = descreverFonte(origem);
  if (avisoFonte) avisos.push(avisoFonte);

  const pag = (montar: (de: number, a: number) => any) => buscarTodasPaginas(montar);
  const cobertura = await coberturaDados(db);
  const [receb, pago, ops, fichas, checklists, divergencias, frotaChk, multas, manut, ponto, func, alertas, relatorios] = await Promise.all([
    fonte === 'P2S' ? lerReceber(db, origem, { quitado: true, quitacaoDe: desde, quitacaoAte: ate }) : vazio,
    lerPagar(db, origem, { quitado: true, quitacaoDe: desde, quitacaoAte: ate }),
    pag((de, a) => db.from('op_ordens_pagamento').select('id, total_geral, data_criacao, natureza_pagamento, empresa_recebedora, status').eq('empresa_id', E).neq('status', 'REPROVADA').gte('data_criacao', ini(desde)).lt('data_criacao', fimTs(ate)).order('id').range(de, a)),
    lerFichas(db, origem, { emissaoDe: desde, emissaoAte: ate }),
    pag((de, a) => db.from('checklists').select('id, created_at').eq('empresa_id', E).gte('created_at', ini(desde)).lt('created_at', fimTs(ate)).order('id').range(de, a)),
    pag((de, a) => db.from('checklist_divergencias').select('id, checklist_id, tipo, created_at').gte('created_at', ini(P.inicio)).lt('created_at', fimTs(P.fim)).order('id').range(de, a)),
    pag((de, a) => db.from('frota_checklists').select('id, saida_em, km_inicial, km_final').eq('empresa_id', E).gte('saida_em', ini(desde)).lt('saida_em', fimTs(ate)).order('id').range(de, a)),
    db.from('frota_multas_debitos').select('valor, created_at').eq('empresa_id', E).gte('created_at', ini(desde)).lt('created_at', fimTs(ate)),
    db.from('frota_manutencoes').select('veiculo_id, custo, data, tipo').gte('data', P.inicio).lte('data', P.fim),
    pag((de, a) => db.from('folha_ponto_diaria').select('id, funcionario_nome, entrada_1, saida_1, entrada_2, saida_2').eq('empresa_id', E).gte('data_registro', P.inicio).lte('data_registro', P.fim).order('id').range(de, a)),
    db.from('folha_funcionarios').select('nome_completo, cargo, ativo, data_admissao, data_desligamento').eq('empresa_id', E),
    db.from('diretoria_alertas').select('tipo').eq('empresa_id', E).gte('detectado_em', ini(P.inicio)).lt('detectado_em', fimTs(P.fim)),
    db.from('diretoria_relatorios').select('data_referencia, tipo, conteudo').eq('empresa_id', E).eq('tipo', tipo === 'MENSAL' ? 'SEMANAL' : 'MENSAL').gte('data_referencia', P.inicio).lte('data_referencia', P.fim).order('data_referencia'),
  ]);
  falhou('contas a receber', (receb as any).error); falhou('contas a pagar', (pago as any).error); falhou('OPs', (ops as any).error); falhou('fichas', (fichas as any).error);

  const dataBR = (iso: string) => iso.split('-').reverse().join('/');
  if (desde < cobertura.financeiro) avisos.push(`Recebimentos e pagamentos só estão completos no sistema a partir de ${dataBR(cobertura.financeiro)} (o sync com o P2S guarda ~13 meses) — períodos anteriores vêm marcados dados_incompletos: não compare com eles.`);
  if (cobertura.fichas && desde < cobertura.fichas) avisos.push(`Fichas de reserva só estão completas a partir de ${dataBR(cobertura.fichas)} (início do sync com o P2S) — períodos anteriores vêm marcados dados_incompletos: não compare com eles.`);

  const valorReceb = (l: any) => num(l.valor_pago) || num(l.valor_final);
  const valorPago = (l: any) => num(l.valor_pago) || num(l.valor);
  const noPeriodo = (l: any[], data: (x: any) => string | null | undefined) => l.filter(x => { const d = (data(x) || '').slice(0, 10); return d >= P.inicio && d <= P.fim; });

  const recebidoSerie = porPeriodo(periodos, receb.data, l => l.data_quitacao, valorReceb, cobertura.financeiro);
  const pagoSerie = porPeriodo(periodos, pago.data, l => l.data_quitacao, valorPago, cobertura.financeiro);
  const opsSerie = porPeriodo(periodos, ops.data, l => dataLocal(l.data_criacao), l => num(l.total_geral));
  const fichasSerie = porPeriodo(periodos, fichas.data, l => l.data_emissao, l => num(l.valor_final), cobertura.fichas);
  // Variação só contra período com dado completo.
  const variacaoSe = (serie: { valor: number; dados_incompletos?: boolean }[], i: number) => (serie[i]?.dados_incompletos || serie[0]?.dados_incompletos ? null : variacao(serie[0].valor, serie[i].valor));
  const base = 1; // comparação principal: período anterior (mês M-1 / ano Y-1)

  const financeiro = {
    fonte_recebimentos: fonte,
    recebido_por_periodo: fonte === 'P2S' ? recebidoSerie : null,
    variacao_pct_recebido_vs_anterior: fonte === 'P2S' ? variacaoSe(recebidoSerie, base) : null,
    variacao_pct_recebido_vs_ano_anterior: fonte === 'P2S' && tipo === 'MENSAL' ? variacaoSe(recebidoSerie, 6) : null,
    maiores_pagadores: fonte === 'P2S' ? agrupar(noPeriodo(receb.data, l => l.data_quitacao), l => l.cliente, valorReceb) : null,
    pago_p2s_por_periodo: pagoSerie,
    pago_p2s_por_centro: agrupar(noPeriodo(pago.data, l => l.data_quitacao), l => l.centro, valorPago, 15),
    maiores_fornecedores: agrupar(noPeriodo(pago.data, l => l.data_quitacao), l => l.fornecedor, valorPago),
    ops_por_periodo: opsSerie,
    ops_por_natureza: agrupar(noPeriodo(ops.data, l => dataLocal(l.data_criacao)), l => String(l.natureza_pagamento || '').toUpperCase(), l => num(l.total_geral)),
  };
  const comercial = {
    fichas_emitidas_por_periodo: fichasSerie,
    variacao_pct_fichas_vs_anterior: variacaoSe(fichasSerie, base),
    variacao_pct_fichas_vs_ano_anterior: tipo === 'MENSAL' ? variacaoSe(fichasSerie, 6) : null,
    maiores_clientes: agrupar(noPeriodo(fichas.data, l => l.data_emissao), l => l.cliente, l => num(l.valor_final)),
    maiores_eventos: agrupar(noPeriodo(fichas.data, l => l.data_emissao), l => l.evento_feira, l => num(l.valor_final)),
    por_vendedor: agrupar(noPeriodo(fichas.data, l => l.data_emissao), l => l.vendedor, l => num(l.valor_final)),
  };

  const divs = divergencias.data as any[];
  let divsEmpresa = 0;
  if (divs.length) {
    const ids = [...new Set(divs.map(d => d.checklist_id))];
    const { data: doEmpresa } = await db.from('checklists').select('id').eq('empresa_id', E).in('id', ids.slice(0, 1000));
    const set = new Set(((doEmpresa || []) as any[]).map(c => c.id));
    divsEmpresa = divs.filter(d => set.has(d.checklist_id)).length;
  }
  const expedicao = {
    checklists_por_periodo: porPeriodo(periodos, checklists.data, l => dataLocal(l.created_at), () => 0).map(p => ({ periodo: p.periodo, qtd: p.qtd })),
    divergencias_no_periodo: divsEmpresa,
  };

  const { data: veiculos } = await db.from('frota_veiculos').select('id').eq('empresa_id', E);
  const idsVeiculos = new Set(((veiculos || []) as any[]).map(v => v.id));
  const chkPeriodo = noPeriodo(frotaChk.data, l => dataLocal(l.saida_em));
  const frota = {
    saidas_por_periodo: porPeriodo(periodos, frotaChk.data, l => dataLocal(l.saida_em), () => 0).map(p => ({ periodo: p.periodo, qtd: p.qtd })),
    km_rodados_no_periodo: somarKm(chkPeriodo).km,
    viagens_com_km_suspeito: somarKm(chkPeriodo).viagens_com_km_suspeito,
    multas_novas_por_periodo: porPeriodo(periodos, (multas.data || []) as any[], l => dataLocal(l.created_at), l => num(l.valor)),
    custo_manutencao_no_periodo: arred(((manut.data || []) as any[]).filter(m => idsVeiculos.has(m.veiculo_id)).reduce((s, m) => s + num(m.custo), 0)),
  };

  const regs = ponto.data as any[];
  const incompletos = regs.filter(r => [r.entrada_1, r.saida_1, r.entrada_2, r.saida_2].filter(Boolean).length % 2 === 1);
  const funcionarios = (func.data || []) as any[];
  const rh = {
    funcionarios_ativos_hoje: funcionarios.filter(f => f.ativo).length,
    admissoes_no_periodo: funcionarios.filter(f => f.data_admissao && f.data_admissao >= P.inicio && f.data_admissao <= P.fim).map(f => ({ nome: f.nome_completo, cargo: f.cargo, data: f.data_admissao })),
    desligamentos_no_periodo: funcionarios.filter(f => f.data_desligamento && f.data_desligamento >= P.inicio && f.data_desligamento <= P.fim).map(f => ({ nome: f.nome_completo, cargo: f.cargo, data: f.data_desligamento })),
    ponto: { registros: regs.length, incompletos: incompletos.length, quem_mais_esqueceu: agrupar(incompletos, r => r.funcionario_nome, () => 1, 5).map(x => ({ nome: x.nome, dias: x.qtd })) },
  };

  const anoP = Number(P.inicio.slice(0, 4));
  const metas = tipo === 'MENSAL'
    ? await progressoMetasDoMes(db, E, fonte, P.fim)
    : { ano: anoP, meses: await metasDoAno(db, E, fonte, anoP, P.fim) };

  const caixa = resumoCaixa(await projetarCaixa(db, empresa));

  return {
    versao: 1, tipo, empresa,
    periodo: P, periodos_comparacao: periodos.slice(1),
    gerado_em: new Date().toISOString(),
    avisos, financeiro, comercial, expedicao, frota, rh, metas, caixa,
    alertas_por_tipo: agrupar((alertas.data || []) as any[], a => a.tipo, () => 1, 20).map(a => ({ nome: a.nome, qtd: a.qtd })),
    relatorios_do_periodo: ((relatorios.data || []) as any[]).map(r => ({ data: r.data_referencia, tipo: r.tipo, situacao: r.conteudo?.situacao ?? null, manchete: r.conteudo?.manchete ?? null })),
  };
}
