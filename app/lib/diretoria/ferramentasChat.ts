// app/lib/diretoria/ferramentasChat.ts
// Ferramentas do chat "pergunte ao diretor" (Fase 3, 2026-11-15). Todas são
// SÓ DE LEITURA, com consultas fixas (a IA nunca escreve SQL) e presas às
// empresas que o usuário pode ver — a lista vem do servidor
// (obterEmpresasPermitidas), nunca do modelo.
//
// Mesmo princípio dos relatórios: totais e agrupamentos saem prontos daqui,
// pra IA não somar. Linhas vêm limitadas (padrão 30, máximo 100) com o total
// verdadeiro informado à parte.
//
// Fora de alcance de propósito: CPF, salário, dados bancários e chave Pix.
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { calcularIndicadoresDiarios, somarDias, type FonteRecebimentos } from './indicadoresDiarios';
import { calcularIndicadoresSemanais } from './indicadoresSemanais';
import { progressoMetasDoMes, metasDoAno } from './metas';
import { projetarCaixa } from './caixa';
import { somarKm } from './km';
import { calcularIndicadoresPeriodo, periodosMensal, periodosAnual } from './indicadoresPeriodo';

type DB = ReturnType<typeof supabaseAdmin>;

export interface EmpresaChat { id: number; nome: string; fonte_recebimentos: FonteRecebimentos }
export interface ContextoChat { db: DB; empresas: EmpresaChat[]; hoje: string }

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const EMPRESA = z.number().int().describe('id da empresa (veja a lista de empresas no contexto da pergunta).');
const LIMITE = z.number().int().min(1).max(100).optional().describe('Quantas linhas devolver (padrão 30, máximo 100). Os totais sempre consideram tudo.');
const TEXTO = (o: string) => z.string().min(2).optional().describe(`Parte do nome ${o} (busca sem diferenciar maiúsculas).`);

const num = (v: unknown) => Number(v) || 0;
const arred = (n: number) => Math.round(n * 100) / 100;
const inicioDia = (iso: string) => `${iso}T00:00:00-03:00`;
const fimDia = (iso: string) => `${somarDias(iso, 1)}T00:00:00-03:00`;
// Vírgula e parênteses quebram o filtro `.or(...)` do PostgREST — saem também.
const like = (s: string) => `%${s.replace(/[%_,()]/g, ' ').trim()}%`;
const total = (linhas: any[], campo: (l: any) => number) => ({ valor: arred(linhas.reduce((s, l) => s + campo(l), 0)), qtd: linhas.length });
function agrupar(linhas: any[], chave: (l: any) => string, valor: (l: any) => number, n = 15) {
  const m = new Map<string, { valor: number; qtd: number }>();
  for (const l of linhas) { const k = chave(l) || '(não informado)'; const a = m.get(k) || { valor: 0, qtd: 0 }; a.valor += valor(l); a.qtd++; m.set(k, a); }
  return [...m.entries()].sort((a, b) => b[1].valor - a[1].valor).slice(0, n).map(([nome, v]) => ({ nome, valor: arred(v.valor), qtd: v.qtd }));
}
const limitar = <T,>(linhas: T[], limite?: number) => {
  const n = limite ?? 30;
  return { linhas: linhas.slice(0, n), mostrando: Math.min(n, linhas.length), total_de_linhas: linhas.length };
};

interface Ferramenta<S extends z.ZodType> {
  nome: string;
  descricao: string;
  schema: S;
  rodar: (entrada: z.infer<S>, ctx: ContextoChat, empresa: EmpresaChat) => Promise<unknown>;
}
const ferramenta = <S extends z.ZodObject<any>>(f: Ferramenta<S>) => f;

const FERRAMENTAS = [
  ferramenta({
    nome: 'resumo_do_dia',
    descricao: 'Todos os indicadores de um dia de uma empresa (os mesmos do relatório diário): recebido, a receber, inadimplência por faixa, pago, a pagar, OPs, fichas, expedição, frota e RH. Bom ponto de partida para perguntas gerais sobre "ontem", "hoje" ou um dia específico.',
    schema: z.strictObject({ empresa_id: EMPRESA, data: DATA.optional().describe('Dia analisado, AAAA-MM-DD. Padrão: ontem.') }),
    rodar: async (e, ctx, emp) => calcularIndicadoresDiarios(ctx.db, { id: emp.id, nome: emp.nome }, e.data),
  }),
  ferramenta({
    nome: 'resumo_da_semana',
    descricao: 'Indicadores de uma semana fechada (segunda a domingo) com séries das 4 semanas anteriores e a agenda da semana seguinte. Use para comparações semanais e tendências.',
    schema: z.strictObject({ empresa_id: EMPRESA, segunda_feira: DATA.optional().describe('Segunda-feira da semana, AAAA-MM-DD. Padrão: a última semana completa.') }),
    rodar: async (e, ctx, emp) => calcularIndicadoresSemanais(ctx.db, { id: emp.id, nome: emp.nome }, e.segunda_feira ? somarDias(e.segunda_feira, 7) : ctx.hoje),
  }),
  ferramenta({
    nome: 'contas_a_receber',
    descricao: 'Títulos a receber do PrimeStart (P2S). Para EM_ABERTO, VENCIDAS e A_VENCER o período filtra o vencimento; para QUITADAS, a data em que foi pago. Devolve total, total por cliente e as linhas.',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      situacao: z.enum(['EM_ABERTO', 'VENCIDAS', 'A_VENCER', 'QUITADAS']),
      cliente: TEXTO('do cliente'),
      de: DATA.optional(), ate: DATA.optional(),
      limite: LIMITE,
    }),
    rodar: async (e, ctx, emp) => {
      if (emp.fonte_recebimentos === 'EXTERNA') return { aviso: `Os recebimentos da ${emp.nome} vêm de uma fonte externa, ainda não integrada ao sistema — não há contas a receber dela para consultar.` };
      const quitadas = e.situacao === 'QUITADAS';
      const campoData = quitadas ? 'data_quitacao' : 'data_vencimento';
      const { data, error } = await buscarTodasPaginas((de, ate) => {
        let q = ctx.db.from('financeiro_contas_receber')
          .select('id, cliente, valor_final, valor_pago, data_vencimento, data_quitacao, documento, num_documento, num_parcela, evento, centro_financeiro')
          .eq('empresa_id', emp.id).eq('quitado', quitadas);
        if (e.situacao === 'VENCIDAS') q = q.lt('data_vencimento', ctx.hoje);
        if (e.situacao === 'A_VENCER') q = q.gte('data_vencimento', ctx.hoje);
        if (e.cliente) q = q.ilike('cliente', like(e.cliente));
        if (e.de) q = q.gte(campoData, e.de);
        if (e.ate) q = q.lte(campoData, e.ate);
        return q.order(campoData, { ascending: !quitadas }).order('id').range(de, ate);
      });
      if (error) return { erro: error.message };
      const valor = (l: any) => (quitadas ? num(l.valor_pago) || num(l.valor_final) : num(l.valor_final));
      return {
        empresa: emp.nome, situacao: e.situacao, periodo: { de: e.de ?? null, ate: e.ate ?? null, campo: campoData },
        total: total(data, valor),
        por_cliente: agrupar(data, l => l.cliente, valor),
        ...limitar(data.map(l => ({
          cliente: l.cliente, valor: arred(valor(l)), vencimento: l.data_vencimento, quitado_em: l.data_quitacao,
          dias_de_atraso: !quitadas && l.data_vencimento < ctx.hoje ? Math.round((new Date(`${ctx.hoje}T12:00:00Z`).getTime() - new Date(`${l.data_vencimento}T12:00:00Z`).getTime()) / 86_400_000) : null,
          documento: [l.documento, l.num_documento, l.num_parcela].filter(Boolean).join(' '), evento: l.evento,
        })), e.limite),
        observacao: e.situacao !== 'QUITADAS' ? 'Títulos vencidos há mais de 365 dias costumam ser baixa pendente no P2S, não dívida real.' : undefined,
      };
    },
  }),
  ferramenta({
    nome: 'contas_a_pagar',
    descricao: 'Contas a pagar do PrimeStart (P2S): A_VENCER (de hoje em diante) ou QUITADAS (período = data do pagamento). Contas vencidas em aberto NÃO são sincronizadas. Devolve total, total por fornecedor e por centro financeiro, e as linhas.',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      situacao: z.enum(['A_VENCER', 'QUITADAS']),
      fornecedor: TEXTO('do fornecedor'),
      centro: z.string().min(2).optional().describe('Parte do centro financeiro (ex.: "RH", "SÓCIOS", "VEÍCULOS").'),
      de: DATA.optional(), ate: DATA.optional(),
      limite: LIMITE,
    }),
    rodar: async (e, ctx, emp) => {
      const quitadas = e.situacao === 'QUITADAS';
      const campoData = quitadas ? 'data_quitacao' : 'data_vencimento';
      const { data, error } = await buscarTodasPaginas((de, ate) => {
        let q = ctx.db.from('financeiro_contas_pagar')
          .select('id, fornecedor, descricao, centro, sub_centro, valor, valor_pago, data_vencimento, data_quitacao, num_documento')
          .eq('empresa_id', emp.id).eq('quitado', quitadas);
        if (!quitadas) q = q.gte('data_vencimento', ctx.hoje);
        if (e.fornecedor) q = q.ilike('fornecedor', like(e.fornecedor));
        if (e.centro) q = q.ilike('centro', like(e.centro));
        if (e.de) q = q.gte(campoData, e.de);
        if (e.ate) q = q.lte(campoData, e.ate);
        return q.order(campoData, { ascending: !quitadas }).order('id').range(de, ate);
      });
      if (error) return { erro: error.message };
      const valor = (l: any) => (quitadas ? num(l.valor_pago) || num(l.valor) : num(l.valor));
      return {
        empresa: emp.nome, situacao: e.situacao, periodo: { de: e.de ?? null, ate: e.ate ?? null, campo: campoData },
        total: total(data, valor),
        por_fornecedor: agrupar(data, l => l.fornecedor, valor),
        por_centro: agrupar(data, l => l.centro, valor),
        ...limitar(data.map(l => ({ fornecedor: l.fornecedor, valor: arred(valor(l)), vencimento: l.data_vencimento, pago_em: l.data_quitacao, centro: l.centro, descricao: l.descricao })), e.limite),
      };
    },
  }),
  ferramenta({
    nome: 'ordens_de_pagamento',
    descricao: 'Ordens de Pagamento (OPs) do sistema. Filtre por número, favorecido, status, natureza ou período de criação. Devolve total, total por natureza e por favorecido, e as linhas (sem dados bancários).',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      numero_op: z.number().int().optional(),
      favorecido: TEXTO('do favorecido'),
      status: z.enum(['PENDENTE', 'PAGO', 'REPROVADA']).optional(),
      natureza: z.string().min(2).optional().describe('Parte da natureza (ex.: "FREELANCE", "REEMBOLSO").'),
      criada_de: DATA.optional(), criada_ate: DATA.optional(),
      limite: LIMITE,
    }),
    rodar: async (e, ctx, emp) => {
      const { data, error } = await buscarTodasPaginas((de, ate) => {
        let q = ctx.db.from('op_ordens_pagamento')
          .select('id, numero_op, data_criacao, status, empresa_recebedora, natureza_pagamento, total_geral, data_vencimento, pago_em, responsavel_nome, os_numero, os_cliente, os_evento, observacao')
          .eq('empresa_id', emp.id);
        if (e.numero_op) q = q.eq('numero_op', e.numero_op);
        if (e.favorecido) q = q.ilike('empresa_recebedora', like(e.favorecido));
        if (e.status) q = q.eq('status', e.status);
        if (e.natureza) q = q.ilike('natureza_pagamento', like(e.natureza));
        if (e.criada_de) q = q.gte('data_criacao', inicioDia(e.criada_de));
        if (e.criada_ate) q = q.lt('data_criacao', fimDia(e.criada_ate));
        return q.order('numero_op', { ascending: false }).order('id').range(de, ate);
      });
      if (error) return { erro: error.message };
      const valor = (l: any) => num(l.total_geral);
      return {
        empresa: emp.nome,
        total: total(data, valor),
        por_status: agrupar(data, l => l.status, valor),
        por_natureza: agrupar(data, l => String(l.natureza_pagamento || '').trim().toUpperCase(), valor),
        por_favorecido: agrupar(data, l => String(l.empresa_recebedora || '').trim(), valor),
        ...limitar(data.map(l => ({
          numero_op: l.numero_op, criada_em: String(l.data_criacao).slice(0, 10), status: l.status, favorecido: String(l.empresa_recebedora || '').trim(),
          natureza: l.natureza_pagamento, valor: arred(valor(l)), vencimento: l.data_vencimento, pago_em: l.pago_em ? String(l.pago_em).slice(0, 10) : null,
          pedida_por: l.responsavel_nome, os: l.os_numero, cliente_os: l.os_cliente, evento: l.os_evento, observacao: l.observacao,
        })), e.limite),
      };
    },
  }),
  ferramenta({
    nome: 'fichas_de_locacao',
    descricao: 'Fichas de reserva de locação (P2S). Filtre por cliente, evento, emissão ou período do evento (fichas que acontecem dentro de de/ate). Status são códigos crus do P2S; canceladas (CA) ficam de fora salvo se pedir status CA. Devolve total, por cliente, por evento e as linhas.',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      cliente: TEXTO('do cliente'),
      evento: TEXTO('do evento/feira'),
      status: z.string().max(3).optional(),
      emissao_de: DATA.optional(), emissao_ate: DATA.optional(),
      periodo_de: DATA.optional().describe('Eventos que terminam a partir desta data.'),
      periodo_ate: DATA.optional().describe('Eventos que começam até esta data.'),
      limite: LIMITE,
    }),
    rodar: async (e, ctx, emp) => {
      const { data, error } = await buscarTodasPaginas((de, ate) => {
        let q = ctx.db.from('fichas_reserva')
          .select('id, numero, cliente, evento_feira, valor_final, data_emissao, data_inicial, data_final, status, vendedor, status_faturamento, faturamento_suspenso')
          .eq('empresa_id', emp.id);
        q = e.status ? q.eq('status', e.status.toUpperCase()) : q.neq('status', 'CA');
        if (e.cliente) q = q.ilike('cliente', like(e.cliente));
        if (e.evento) q = q.ilike('evento_feira', like(e.evento));
        if (e.emissao_de) q = q.gte('data_emissao', e.emissao_de);
        if (e.emissao_ate) q = q.lte('data_emissao', e.emissao_ate);
        if (e.periodo_de) q = q.gte('data_final', e.periodo_de);
        if (e.periodo_ate) q = q.lte('data_inicial', e.periodo_ate);
        return q.order('data_inicial', { ascending: false }).order('id').range(de, ate);
      });
      if (error) return { erro: error.message };
      const valor = (l: any) => num(l.valor_final);
      return {
        empresa: emp.nome,
        total: total(data, valor),
        por_cliente: agrupar(data, l => l.cliente, valor),
        por_evento: agrupar(data, l => String(l.evento_feira || '').trim(), valor),
        por_vendedor: agrupar(data, l => l.vendedor, valor, 10),
        ...limitar(data.map(l => ({
          numero: l.numero, cliente: l.cliente, evento: l.evento_feira, valor: arred(valor(l)), emissao: l.data_emissao,
          inicio: l.data_inicial, fim: l.data_final, status: l.status, vendedor: l.vendedor, faturamento: l.status_faturamento, faturamento_suspenso: l.faturamento_suspenso,
        })), e.limite),
      };
    },
  }),
  ferramenta({
    nome: 'expedicao',
    descricao: 'Checklists de expedição (saída e retorno de material para eventos) e divergências (itens que saíram ou voltaram em quantidade diferente). Status: RASCUNHO, SAIDA_CONFERIDA (material fora) ou FINALIZADO.',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      evento: TEXTO('do evento ou cliente'),
      status: z.enum(['RASCUNHO', 'SAIDA_CONFERIDA', 'FINALIZADO']).optional(),
      periodo_de: DATA.optional(), periodo_ate: DATA.optional(),
      limite: LIMITE,
    }),
    rodar: async (e, ctx, emp) => {
      let q = ctx.db.from('checklists').select('id, numero, ficha_numero, evento_feira, cliente, local, periodo_inicio, periodo_fim, status, responsavel_saida, responsavel_retorno').eq('empresa_id', emp.id);
      if (e.status) q = q.eq('status', e.status);
      if (e.evento) q = q.or(`evento_feira.ilike.${like(e.evento)},cliente.ilike.${like(e.evento)}`);
      if (e.periodo_de) q = q.gte('periodo_fim', e.periodo_de);
      if (e.periodo_ate) q = q.lte('periodo_inicio', e.periodo_ate);
      const { data, error } = await q.order('periodo_inicio', { ascending: false }).limit(500);
      if (error) return { erro: error.message };
      const lista = (data || []) as any[];
      const ids = lista.slice(0, 200).map(c => c.id);
      const { data: divs } = ids.length
        ? await ctx.db.from('checklist_divergencias').select('checklist_id, checklist_numero, tipo, secao, descricao, qtd_esperada, qtd_real').in('checklist_id', ids)
        : { data: [] as any[] };
      const porChecklist = new Map<string, any[]>();
      for (const d of (divs || []) as any[]) porChecklist.set(d.checklist_id, [...(porChecklist.get(d.checklist_id) || []), d]);
      return {
        empresa: emp.nome,
        total_checklists: lista.length,
        por_status: agrupar(lista, l => l.status, () => 1),
        ...limitar(lista.map(c => ({
          checklist: c.numero, ficha: c.ficha_numero, evento: c.evento_feira, cliente: c.cliente, local: c.local, inicio: c.periodo_inicio, fim: c.periodo_fim, status: c.status,
          retorno_atrasado_dias: c.status === 'SAIDA_CONFERIDA' && c.periodo_fim && c.periodo_fim < ctx.hoje ? Math.round((new Date(`${ctx.hoje}T12:00:00Z`).getTime() - new Date(`${c.periodo_fim}T12:00:00Z`).getTime()) / 86_400_000) : null,
          saida_por: c.responsavel_saida, retorno_por: c.responsavel_retorno,
          divergencias: (porChecklist.get(c.id) || []).map(d => ({ tipo: d.tipo, item: d.descricao, secao: d.secao, esperado: num(d.qtd_esperada), real: num(d.qtd_real) })),
        })), e.limite),
      };
    },
  }),
  ferramenta({
    nome: 'frota',
    descricao: 'Frota da empresa: veículos (status, vencimento de CRLV, IPVA, seguro/contrato), veículos na rua agora, multas e pedágios em aberto, manutenções e uso nos últimos 30 dias. Filtre por placa ou apelido.',
    schema: z.strictObject({ empresa_id: EMPRESA, veiculo: z.string().min(2).optional().describe('Placa ou apelido (parte).') }),
    rodar: async (e, ctx, emp) => {
      const { data: veiculos, error } = await ctx.db.from('frota_veiculos')
        .select('id, apelido, placa, tipo, marca, modelo, status, propriedade, km_atual, crlv_vencimento, ipva_vencimento, seguro_vigencia_fim, locacao_vigencia_fim, seguradora').eq('empresa_id', emp.id);
      if (error) return { erro: error.message };
      const filtro = e.veiculo ? e.veiculo.toUpperCase().replace(/[^A-Z0-9 ]/g, '') : '';
      const lista = ((veiculos || []) as any[]).filter(v => !filtro || `${v.apelido} ${v.placa}`.toUpperCase().replace(/[^A-Z0-9 ]/g, '').includes(filtro));
      const ids = lista.map(v => v.id);
      if (!ids.length) return { empresa: emp.nome, veiculos: [], aviso: 'Nenhum veículo encontrado.' };
      const nome = new Map(lista.map(v => [v.id, `${v.apelido || v.placa}${v.placa && v.apelido ? ` (${v.placa})` : ''}`]));
      const [checks, multas, pedagios, manut] = await Promise.all([
        ctx.db.from('frota_checklists').select('veiculo_id, motorista_nome, destino, status, saida_em, retorno_em, km_inicial, km_final').in('veiculo_id', ids).gte('saida_em', inicioDia(somarDias(ctx.hoje, -30))),
        ctx.db.from('frota_multas_debitos').select('veiculo_id, tipo, descricao, valor, data_infracao, data_vencimento, prazo_indicacao_condutor, condutor_nome, condutor_indicado_em').in('veiculo_id', ids).eq('status', 'ABERTO'),
        ctx.db.from('frota_pedagios').select('veiculo_id, placa, valor, data_limite_pagamento, concessionaria').eq('empresa_id', emp.id).eq('status', 'ABERTO'),
        ctx.db.from('frota_manutencoes').select('veiculo_id, tipo, data, custo, proxima_data, descricao').in('veiculo_id', ids).gte('data', somarDias(ctx.hoje, -180)),
      ]);
      const ch = (checks.data || []) as any[];
      return {
        empresa: emp.nome,
        veiculos: lista.map(v => ({
          veiculo: nome.get(v.id), tipo: v.tipo, modelo: [v.marca, v.modelo].filter(Boolean).join(' '), status: v.status, propriedade: v.propriedade, km_atual: v.km_atual,
          crlv: v.crlv_vencimento, ipva: v.ipva_vencimento, seguro_ate: v.seguro_vigencia_fim, contrato_locacao_ate: v.locacao_vigencia_fim,
          saidas_30d: ch.filter(c => c.veiculo_id === v.id).length,
          ...(() => { const r = somarKm(ch.filter(c => c.veiculo_id === v.id)); return { km_30d: r.km, viagens_com_km_suspeito_30d: r.viagens_com_km_suspeito }; })(),
        })),
        na_rua_agora: ch.filter(c => c.status === 'EM_ANDAMENTO').map(c => ({ veiculo: nome.get(c.veiculo_id), motorista: c.motorista_nome, destino: c.destino, saiu_em: c.saida_em })),
        multas_abertas: { ...total((multas.data || []) as any[], l => num(l.valor)), linhas: ((multas.data || []) as any[]).map(m => ({ veiculo: nome.get(m.veiculo_id), descricao: m.descricao, valor: arred(num(m.valor)), infracao: m.data_infracao, vencimento: m.data_vencimento, prazo_indicacao: m.prazo_indicacao_condutor, condutor: m.condutor_nome, condutor_indicado: !!m.condutor_indicado_em })) },
        pedagios_abertos: { ...total(((pedagios.data || []) as any[]).filter(p => !p.veiculo_id || ids.includes(p.veiculo_id)), l => num(l.valor)) },
        manutencoes_180d: ((manut.data || []) as any[]).map(m => ({ veiculo: nome.get(m.veiculo_id), tipo: m.tipo, data: m.data, custo: arred(num(m.custo)), proxima: m.proxima_data, descricao: m.descricao })),
      };
    },
  }),
  ferramenta({
    nome: 'rh',
    descricao: 'RH sem dados pessoais (sem salário, CPF ou conta). QUADRO: funcionários ativos por cargo e departamento. PONTO: registros e pontos incompletos por pessoa no período. FERIAS_AFASTAMENTOS: férias agendadas/em andamento e afastamentos ativos. MOVIMENTACOES: admissões, desligamentos e rescisões no período.',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      consulta: z.enum(['QUADRO', 'PONTO', 'FERIAS_AFASTAMENTOS', 'MOVIMENTACOES']),
      nome: TEXTO('do funcionário'),
      de: DATA.optional(), ate: DATA.optional(),
    }),
    rodar: async (e, ctx, emp) => {
      const de = e.de || somarDias(ctx.hoje, -30);
      const ate = e.ate || ctx.hoje;
      if (e.consulta === 'QUADRO') {
        let q = ctx.db.from('folha_funcionarios').select('nome_completo, cargo, departamento, tipo_contrato, data_admissao').eq('empresa_id', emp.id).eq('ativo', true);
        if (e.nome) q = q.ilike('nome_completo', like(e.nome));
        const { data, error } = await q.order('nome_completo');
        if (error) return { erro: error.message };
        const l = (data || []) as any[];
        return { empresa: emp.nome, ativos: l.length, por_cargo: agrupar(l, x => x.cargo, () => 1, 30), por_departamento: agrupar(l, x => x.departamento, () => 1, 30), por_contrato: agrupar(l, x => x.tipo_contrato, () => 1), funcionarios: l.map(x => ({ nome: x.nome_completo, cargo: x.cargo, departamento: x.departamento, contrato: x.tipo_contrato, admissao: x.data_admissao })) };
      }
      if (e.consulta === 'PONTO') {
        const { data, error } = await buscarTodasPaginas((i, f) => {
          let q = ctx.db.from('folha_ponto_diaria').select('id, funcionario_nome, data_registro, entrada_1, saida_1, entrada_2, saida_2, minutos_trabalhados').eq('empresa_id', emp.id).gte('data_registro', de).lte('data_registro', ate);
          if (e.nome) q = q.ilike('funcionario_nome', like(e.nome));
          return q.order('id').range(i, f);
        });
        if (error) return { erro: error.message };
        const incompleto = (r: any) => [r.entrada_1, r.saida_1, r.entrada_2, r.saida_2].filter(Boolean).length % 2 === 1;
        const porPessoa = new Map<string, { dias: number; incompletos: number; minutos: number }>();
        for (const r of data as any[]) { const a = porPessoa.get(r.funcionario_nome) || { dias: 0, incompletos: 0, minutos: 0 }; a.dias++; if (incompleto(r)) a.incompletos++; a.minutos += num(r.minutos_trabalhados); porPessoa.set(r.funcionario_nome, a); }
        return { empresa: emp.nome, periodo: { de, ate }, registros: data.length, incompletos: (data as any[]).filter(incompleto).length,
          por_pessoa: [...porPessoa.entries()].sort((a, b) => b[1].incompletos - a[1].incompletos).map(([nome, v]) => ({ nome, dias_com_registro: v.dias, dias_incompletos: v.incompletos, horas: Math.round(v.minutos / 6) / 10 })),
          datas_incompletas: e.nome ? (data as any[]).filter(incompleto).map(r => r.data_registro) : undefined };
      }
      if (e.consulta === 'FERIAS_AFASTAMENTOS') {
        const [ferias, afast] = await Promise.all([
          ctx.db.from('folha_ferias').select('funcionario_nome, data_inicio_gozo, data_fim_gozo, dias_gozo, status, periodo_concessivo_fim').eq('empresa_id', emp.id).in('status', ['AGENDADA', 'DISPONIVEL']).order('data_inicio_gozo'),
          ctx.db.from('folha_afastamentos').select('funcionario_nome, data_inicio, data_fim, status').eq('empresa_id', emp.id).eq('status', 'ATIVO'),
        ]);
        const filtroNome = (l: any[]) => (e.nome ? l.filter(x => String(x.funcionario_nome).toUpperCase().includes(e.nome!.toUpperCase())) : l);
        const f = filtroNome((ferias.data || []) as any[]);
        return {
          empresa: emp.nome,
          ferias_agendadas: f.filter(x => x.status === 'AGENDADA' && x.data_fim_gozo >= ctx.hoje).map(x => ({ nome: x.funcionario_nome, inicio: x.data_inicio_gozo, fim: x.data_fim_gozo, dias: x.dias_gozo, em_andamento: x.data_inicio_gozo <= ctx.hoje })),
          ferias_a_agendar: f.filter(x => x.status === 'DISPONIVEL').map(x => ({ nome: x.funcionario_nome, prazo_concessivo: x.periodo_concessivo_fim })),
          afastamentos_ativos: filtroNome((afast.data || []) as any[]).map(x => ({ nome: x.funcionario_nome, desde: x.data_inicio, ate: x.data_fim })),
        };
      }
      const [adm, desl, resc] = await Promise.all([
        ctx.db.from('folha_funcionarios').select('nome_completo, cargo, data_admissao').eq('empresa_id', emp.id).gte('data_admissao', de).lte('data_admissao', ate),
        ctx.db.from('folha_funcionarios').select('nome_completo, cargo, data_desligamento').eq('empresa_id', emp.id).gte('data_desligamento', de).lte('data_desligamento', ate),
        ctx.db.from('folha_rescisoes').select('funcionario_nome, status, data_desligamento, motivo, valor_total_liquido, pago_em').eq('empresa_id', emp.id).gte('data_desligamento', de).lte('data_desligamento', ate),
      ]);
      return {
        empresa: emp.nome, periodo: { de, ate },
        admissoes: ((adm.data || []) as any[]).map(x => ({ nome: x.nome_completo, cargo: x.cargo, data: x.data_admissao })),
        desligamentos: ((desl.data || []) as any[]).map(x => ({ nome: x.nome_completo, cargo: x.cargo, data: x.data_desligamento })),
        rescisoes: ((resc.data || []) as any[]).map(x => ({ nome: x.funcionario_nome, status: x.status, desligamento: x.data_desligamento, motivo: x.motivo, valor_liquido: arred(num(x.valor_total_liquido)), paga_em: x.pago_em ? String(x.pago_em).slice(0, 10) : null })),
      };
    },
  }),
  ferramenta({
    nome: 'metas',
    descricao: 'Metas mensais da empresa (faturamento por fichas emitidas, recebimento, teto de OPs, teto de inadimplência) com realizado, % da meta, ritmo esperado e situação. Um mês só (padrão: o mês corrente até hoje) ou o ano inteiro mês a mês.',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      mes: z.string().regex(/^\d{4}-\d{2}$/, 'Use AAAA-MM').optional().describe('Mês AAAA-MM. Padrão: o mês corrente.'),
      ano_inteiro: z.number().int().min(2020).max(2100).optional().describe('Se informado, devolve o ano todo mês a mês (ignora "mes").'),
    }),
    rodar: async (e, ctx, emp) => {
      if (e.ano_inteiro) return { empresa: emp.nome, ano: e.ano_inteiro, meses: await metasDoAno(ctx.db, emp.id, emp.fonte_recebimentos, e.ano_inteiro, ctx.hoje) };
      const mes = e.mes || ctx.hoje.slice(0, 7);
      const [a, m] = mes.split('-').map(Number);
      const ultimoDia = `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
      return { empresa: emp.nome, ...(await progressoMetasDoMes(ctx.db, emp.id, emp.fonte_recebimentos, ultimoDia < ctx.hoje ? ultimoDia : ctx.hoje)) };
    },
  }),
  ferramenta({
    nome: 'projecao_de_caixa',
    descricao: 'Projeção de caixa de 30/60/90 dias a partir de hoje, semana a semana: entradas (contas a receber em aberto) e saídas (contas a pagar do P2S + OPs pendentes), maiores entradas/saídas e saídas por centro. Não tem saldo em banco nem despesas ainda não lançadas no P2S.',
    schema: z.strictObject({ empresa_id: EMPRESA }),
    rodar: async (_e, ctx, emp) => projetarCaixa(ctx.db, { id: emp.id, nome: emp.nome }, ctx.hoje),
  }),
  ferramenta({
    nome: 'resumo_do_periodo',
    descricao: 'Indicadores de um MÊS (com os 5 meses anteriores e o mesmo mês do ano anterior) ou de um ANO (com o ano anterior e os 12 meses), por área: recebido, pago por centro, OPs por natureza, fichas por cliente/vendedor, expedição, frota, RH, metas e caixa. Use para comparações mensais e anuais.',
    schema: z.strictObject({
      empresa_id: EMPRESA,
      tipo: z.enum(['MES', 'ANO']),
      referencia: z.string().regex(/^\d{4}(-\d{2})?$/, 'Use AAAA-MM (mês) ou AAAA (ano)').describe('AAAA-MM para mês, AAAA para ano.'),
    }),
    rodar: async (e, ctx, emp) => {
      const [a, m] = e.referencia.split('-').map(Number);
      if (e.tipo === 'MES' && !m) return { erro: 'Para tipo MES informe a referência como AAAA-MM.' };
      return calcularIndicadoresPeriodo(ctx.db, { id: emp.id, nome: emp.nome }, e.tipo === 'MES' ? 'MENSAL' : 'ANUAL', e.tipo === 'MES' ? periodosMensal(a, m) : periodosAnual(a));
    },
  }),
  ferramenta({
    nome: 'historico_do_diretor',
    descricao: 'O que o próprio Diretor já registrou: relatórios diários ou semanais (manchete, situação, pontos de atenção e pendências) ou alertas enviados, num período.',
    schema: z.strictObject({ empresa_id: EMPRESA, tipo: z.enum(['DIARIO', 'SEMANAL', 'ALERTAS']), de: DATA.optional(), ate: DATA.optional() }),
    rodar: async (e, ctx, emp) => {
      const de = e.de || somarDias(ctx.hoje, -14);
      const ate = e.ate || ctx.hoje;
      if (e.tipo === 'ALERTAS') {
        const { data, error } = await ctx.db.from('diretoria_alertas').select('tipo, titulo, detalhe, detectado_em, enviado_em').eq('empresa_id', emp.id)
          .gte('detectado_em', inicioDia(de)).lt('detectado_em', fimDia(ate)).order('detectado_em', { ascending: false }).limit(100);
        if (error) return { erro: error.message };
        return { empresa: emp.nome, periodo: { de, ate }, alertas: data };
      }
      const { data, error } = await ctx.db.from('diretoria_relatorios').select('data_referencia, status, conteudo').eq('empresa_id', emp.id).eq('tipo', e.tipo)
        .gte('data_referencia', de).lte('data_referencia', ate).order('data_referencia', { ascending: false }).limit(31);
      if (error) return { erro: error.message };
      return {
        empresa: emp.nome, periodo: { de, ate },
        relatorios: ((data || []) as any[]).map(r => ({
          data: r.data_referencia, situacao: r.conteudo?.situacao ?? null, manchete: r.conteudo?.manchete ?? r.status,
          pontos_de_atencao: (r.conteudo?.pontos_de_atencao || []).map((p: any) => `${p.gravidade}: ${p.titulo}`),
          pendencias_abertas: (r.conteudo?.pendencias || []).filter((p: any) => p.situacao === 'ABERTA').map((p: any) => p.descricao),
        })),
      };
    },
  }),
];

// Definições no formato da API — ordem e conteúdo FIXOS (o histórico da
// conversa fica atrelado ao conjunto de ferramentas). QUALQUER mudança nas
// ferramentas (nome, descrição, parâmetros) → somar 1 em VERSAO_FERRAMENTAS:
// conversas de versões anteriores deixam de aceitar perguntas novas (o
// modelo recusaria o histórico) e a tela pede para abrir uma nova.
//   1 = Fase 3 (10 ferramentas) · 2 = Fase 4 (+ metas, projeção de caixa, resumo de mês/ano)
export const VERSAO_FERRAMENTAS = 2;
export const DEFINICOES_FERRAMENTAS: Anthropic.Beta.BetaTool[] = FERRAMENTAS.map(f => {
  const schema = z.toJSONSchema(f.schema) as Record<string, unknown>;
  delete schema.$schema;
  return { name: f.nome, description: f.descricao, input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
});

const LIMITE_RESULTADO = 60_000; // caracteres de JSON por chamada

export async function executarFerramenta(nome: string, entrada: unknown, ctx: ContextoChat): Promise<{ conteudo: string; erro: boolean }> {
  const f = FERRAMENTAS.find(x => x.nome === nome);
  if (!f) return { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true };
  const validado = (f.schema as z.ZodType).safeParse(entrada);
  if (!validado.success) return { conteudo: `Parâmetros inválidos: ${validado.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`, erro: true };
  const dados = validado.data as { empresa_id: number };
  const empresa = ctx.empresas.find(e => e.id === dados.empresa_id);
  if (!empresa) return { conteudo: `Empresa ${dados.empresa_id} não está entre as que este usuário pode consultar: ${ctx.empresas.map(e => `${e.nome} (${e.id})`).join(', ')}.`, erro: true };
  try {
    const resultado = await (f.rodar as (e: unknown, c: ContextoChat, emp: EmpresaChat) => Promise<unknown>)(dados, ctx, empresa);
    let texto = JSON.stringify(resultado);
    if (texto.length > LIMITE_RESULTADO) texto = `${texto.slice(0, LIMITE_RESULTADO)}… [resultado cortado — refaça a consulta com filtros ou limite menor]`;
    return { conteudo: texto, erro: false };
  } catch (e: any) {
    return { conteudo: `Falha na consulta: ${e?.message || e}`, erro: true };
  }
}

// Rótulo curto pra tela mostrar o que o diretor consultou.
export function rotuloFerramenta(nome: string, entrada: any, empresas: EmpresaChat[]): string {
  const emp = empresas.find(e => e.id === entrada?.empresa_id)?.nome;
  const rotulos: Record<string, string> = {
    resumo_do_dia: 'Resumo do dia', resumo_da_semana: 'Resumo da semana', contas_a_receber: 'Contas a receber', contas_a_pagar: 'Contas a pagar',
    ordens_de_pagamento: 'Ordens de pagamento', fichas_de_locacao: 'Fichas de locação', expedicao: 'Expedição', frota: 'Frota', rh: 'RH', historico_do_diretor: 'Histórico do diretor',
    metas: 'Metas', projecao_de_caixa: 'Projeção de caixa', resumo_do_periodo: 'Resumo de mês/ano',
  };
  return `${rotulos[nome] || nome}${emp ? ` · ${emp}` : ''}`;
}
