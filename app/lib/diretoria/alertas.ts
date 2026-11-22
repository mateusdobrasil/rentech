// app/lib/diretoria/alertas.ts
// Alertas de exceção do Diretor (Fase 2, 2026-11-15) — detectados por
// CÓDIGO (sem IA: é regra fixa, tem que ser exato e barato), gravados em
// diretoria_alertas com uma chave única por ocorrência (avisa uma vez só) e
// enviados AGRUPADOS por empresa às 12h e às 18h (app/api/cron/diretoria-alertas).
//
// Tipos (escolhidos pelo usuário):
// - Risco no pagamento: OP para favorecido que nunca recebeu antes; mesma
//   chave Pix/conta em favorecidos diferentes; OP de valor alto.
// - Cliente grande atrasou: título a receber acima do corte que venceu e não
//   foi pago (só empresas com fonte_recebimentos = P2S).
// - Material/veículo não voltou: checklist de expedição sem retorno N dias
//   depois do fim do evento; checklist de veículo em andamento há N dias.
// - Caixa apertado: saídas previstas nos próximos 7 dias (contas a pagar do
//   P2S + OPs pendentes que ainda não foram pro P2S) maiores que as entradas
//   previstas (contas a receber). Uma vez por semana ISO. NÃO considera o
//   saldo em banco (o sistema não tem essa informação).
//
// Observação sobre as OPs: em op_ordens_pagamento, `chave_pix` guarda o TIPO
// da chave ("CPF/CNPJ", "CELULAR"…) e a chave em si fica em `dados_pagamento`.
import { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { formatarMoeda } from '../formatadores';
import { hojeISO, somarDias, type FonteRecebimentos } from './indicadoresDiarios';
import { carregarParametrosDiretoria, type ParametrosDiretoria } from './parametros';
import { progressoMetasDoMes } from './metas';
import { fonteDoDiretor, lerReceber, lerPagar } from './fontes';
import { faltasNaAgenda, nfeForaDeSpSemMdfe } from './locacao';
import { enviarPeloCard, montarEmailAlertas, baseUrlSistema } from './envioDiretoria';

type DB = ReturnType<typeof supabaseAdmin>;

export const CHAVE_CARD_ALERTAS = 'diretoria-alertas';

export type TipoAlerta = 'OP_FAVORECIDO_NOVO' | 'OP_CONTA_COMPARTILHADA' | 'OP_VALOR_ALTO' | 'RECEBER_ATRASO' | 'EXPEDICAO_SEM_RETORNO' | 'FROTA_FORA' | 'CAIXA_SEMANA'
  | 'META_TETO_OPS' | 'META_TETO_INADIMPLENCIA' | 'MDFE_ABERTO' | 'MDFE_PENDENTE' | 'FALTA_AGENDA';

interface NovoAlerta {
  empresa_id: number;
  tipo: TipoAlerta;
  chave: string;
  titulo: string;
  detalhe: string;
  valor: number | null;
  link: string;
}

const num = (v: unknown) => Number(v) || 0;
const BRL = (v: number) => formatarMoeda(v);
const dm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const nomeNorm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const diasEntre = (de: string, ate: string) => Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000);

// Semana ISO ("2026-W47") — o alerta de caixa repete no máximo uma vez por semana.
function semanaIso(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia + 3);
  const primeiraQuinta = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const semana = 1 + Math.round(((d.getTime() - primeiraQuinta.getTime()) / 86_400_000 - 3 + ((primeiraQuinta.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

// Mesmo favorecido: mesmo CPF/CNPJ (quando as duas OPs têm) OU nomes
// compatíveis. Só o documento não basta — há OP antiga sem CPF para a mesma
// pessoa. Calibrado no histórico real de OPs (2026-11-15): sem a tolerância
// de nome, 10 de 11 alertas de "conta compartilhada" eram a mesma pessoa
// escrita de outro jeito ("JULIA NOGUEIRA" × "JULIA NOGUEIRA SOUSA",
// "Henrique Emanuel" × nome completo, "LINDENBERG" × "LINDEMBERG",
// "1- PROJECTOS STANDS" × "PROJECTOS STANDS").
function mesmoFavorecido(a: any, b: any): boolean {
  const da = digitos(a.cnpj_cpf_recebedora), dbb = digitos(b.cnpj_cpf_recebedora);
  if (da && dbb && da === dbb) return true;
  return nomesCompativeis(a.empresa_recebedora, b.empresa_recebedora);
}

const PALAVRAS_IGNORADAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);
const tokensNome = (s: unknown) => nomeNorm(s).replace(/[^A-Z ]/g, ' ').split(' ').filter(t => t.length > 1 && !PALAVRAS_IGNORADAS.has(t));

function distanciaAte1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}
const tokenIgual = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && distanciaAte1(a, b));

// Primeiro nome igual e todas as palavras do nome mais curto (mínimo 2)
// presentes no mais longo, aceitando 1 letra de diferença em palavras longas.
function nomesCompativeis(x: unknown, y: unknown): boolean {
  const a = tokensNome(x), b = tokensNome(y);
  if (!a.length || !b.length) return false;
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  if (!tokenIgual(curto[0], longo[0])) return false;
  if (curto.length === 1) return longo.length === 1;
  return curto.every(t => longo.some(u => tokenIgual(t, u)));
}

// Chave da conta de destino: Pix pela chave (dados_pagamento); transferência
// pela agência/conta. Boleto não tem conta de destino comparável.
function contaDestino(op: any): string | null {
  const tipo = nomeNorm(op.tipo_pagamento);
  if (tipo.startsWith('BOLETO')) return null;
  if (tipo === 'PIX') {
    const bruta = String(op.dados_pagamento || '').trim();
    if (!bruta) return null;
    const d = digitos(bruta);
    return `pix:${bruta.includes('@') ? bruta.toLowerCase() : d.length >= 8 ? d.replace(/^55(?=\d{10,11}$)/, '') : bruta.toLowerCase()}`;
  }
  if (op.banco_conta) return `conta:${digitos(op.banco_codigo)}|${digitos(op.banco_agencia)}|${digitos(op.banco_conta)}`;
  const d = digitos(op.dados_pagamento);
  return d.length >= 6 ? `conta:${d}` : null;
}

async function detectarOps(db: DB, E: number, p: ParametrosDiretoria): Promise<NovoAlerta[]> {
  const { data: ops } = await buscarTodasPaginas((de, ate) => db.from('op_ordens_pagamento')
    .select('id, numero_op, data_criacao, status, empresa_id, empresa_recebedora, cnpj_cpf_recebedora, tipo_pagamento, dados_pagamento, banco_codigo, banco_agencia, banco_conta, total_geral, natureza_pagamento, responsavel_nome, data_vencimento')
    .neq('status', 'REPROVADA').order('id').range(de, ate));
  const todas = (ops || []) as any[];
  // Só OPs dos últimos 3 dias geram alerta — o histórico serve de comparação.
  const desde = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const recentes = todas.filter(o => o.empresa_id === E && o.data_criacao >= desde);
  const link = `${baseUrlSistema()}/admin/financeiro/ops`;
  const alertas: NovoAlerta[] = [];

  for (const op of recentes) {
    const valor = num(op.total_geral);
    const quem = String(op.empresa_recebedora || '').trim() || '(sem nome)';
    const base = `OP ${op.numero_op} — ${quem}, ${BRL(valor)}${op.natureza_pagamento ? ` (${String(op.natureza_pagamento).trim()})` : ''}, pedida por ${String(op.responsavel_nome || '?').trim()}`;
    const anteriores = todas.filter(o => o.id !== op.id && o.data_criacao < op.data_criacao && mesmoFavorecido(o, op));
    if (anteriores.length === 0) {
      alertas.push({ empresa_id: E, tipo: 'OP_FAVORECIDO_NOVO', chave: `${E}:op-favorecido-novo:${op.id}`, titulo: `Favorecido novo: ${quem}`, detalhe: `${base}. Primeira OP para este CPF/CNPJ — confira os dados antes de aprovar.`, valor, link });
    }

    const conta = contaDestino(op);
    if (conta) {
      const outros = [...new Set(todas.filter(o => o.id !== op.id && contaDestino(o) === conta && !mesmoFavorecido(o, op)).map(o => String(o.empresa_recebedora || '').trim()))].filter(Boolean);
      if (outros.length) {
        alertas.push({ empresa_id: E, tipo: 'OP_CONTA_COMPARTILHADA', chave: `${E}:op-conta-compartilhada:${op.id}`, titulo: `Conta de destino já usada por outro favorecido`, detalhe: `${base}. A mesma ${conta.startsWith('pix:') ? 'chave Pix' : 'conta bancária'} já recebeu em nome de: ${outros.slice(0, 3).join(', ')}${outros.length > 3 ? ` e mais ${outros.length - 3}` : ''}.`, valor, link });
      }
    }

    if (valor >= p.alerta_op_valor_alto) {
      alertas.push({ empresa_id: E, tipo: 'OP_VALOR_ALTO', chave: `${E}:op-valor-alto:${op.id}`, titulo: `OP de valor alto: ${BRL(valor)}`, detalhe: `${base}${op.data_vencimento ? `, vence ${dm(op.data_vencimento)}` : ''}.`, valor, link });
    }
  }
  return alertas;
}

async function detectarReceber(db: DB, E: number, hoje: string, p: ParametrosDiretoria): Promise<NovoAlerta[]> {
  // Espelho do P2S antes da virada, títulos do sistema depois (fontes.ts).
  const origem = await fonteDoDiretor(db, E);
  const { data: linhas, error } = await lerReceber(db, origem, { quitado: false, vencAntes: hoje, vencDe: somarDias(hoje, -p.alerta_receber_janela_dias) });
  if (error) throw error;
  const data = linhas.filter(t => t.valor_final >= p.alerta_receber_valor_minimo);
  const link = `${baseUrlSistema()}/admin/diretoria`;
  return ((data || []) as any[]).map(t => {
    const valor = num(t.valor_final);
    const doc = [t.documento, t.num_documento].filter(Boolean).join(' ');
    return {
      empresa_id: E, tipo: 'RECEBER_ATRASO' as const, chave: `${E}:receber-atraso:${t.chave}`,
      titulo: `${t.cliente || '(sem cliente)'} não pagou ${BRL(valor)}`,
      detalhe: `Venceu em ${dm(t.data_vencimento)} (${diasEntre(t.data_vencimento, hoje)} dia(s) de atraso)${doc ? ` — ${doc}` : ''}${t.evento ? `, ${t.evento}` : ''}.`,
      valor, link,
    };
  });
}

async function detectarRetornos(db: DB, E: number, hoje: string, p: ParametrosDiretoria): Promise<NovoAlerta[]> {
  const [checklists, veiculosFora, veiculos] = await Promise.all([
    db.from('checklists').select('id, numero, evento_feira, cliente, periodo_fim, responsavel_saida').eq('empresa_id', E).eq('status', 'SAIDA_CONFERIDA')
      .lt('periodo_fim', somarDias(hoje, -p.alerta_expedicao_dias_tolerancia)),
    db.from('frota_checklists').select('id, veiculo_id, motorista_nome, destino, saida_em').eq('empresa_id', E).eq('status', 'EM_ANDAMENTO')
      .lt('saida_em', new Date(Date.now() - p.alerta_frota_dias_fora * 86_400_000).toISOString()),
    db.from('frota_veiculos').select('id, apelido, placa').eq('empresa_id', E),
  ]);
  const nomeVeiculo = new Map(((veiculos.data || []) as any[]).map(v => [v.id, `${v.apelido || v.placa}${v.placa && v.apelido ? ` (${v.placa})` : ''}`]));
  const alertas: NovoAlerta[] = ((checklists.data || []) as any[]).map(c => ({
    empresa_id: E, tipo: 'EXPEDICAO_SEM_RETORNO' as const, chave: `${E}:expedicao-sem-retorno:${c.id}`,
    titulo: `Material não voltou: ${String(c.evento_feira || c.cliente || `checklist ${c.numero}`).trim()}`,
    detalhe: `Checklist ${c.numero}${c.cliente ? ` (${String(c.cliente).trim()})` : ''}: evento terminou em ${dm(c.periodo_fim)}, ${diasEntre(c.periodo_fim, hoje)} dia(s) sem retorno conferido. Saída conferida por ${String(c.responsavel_saida || '?').trim()}.`,
    valor: null, link: `${baseUrlSistema()}/admin/estoque/expedicao`,
  }));
  for (const v of (veiculosFora.data || []) as any[]) {
    const dias = diasEntre(String(v.saida_em).slice(0, 10), hoje);
    alertas.push({
      empresa_id: E, tipo: 'FROTA_FORA', chave: `${E}:frota-fora:${v.id}`,
      titulo: `Veículo fora há ${dias} dias: ${nomeVeiculo.get(v.veiculo_id) || 'veículo'}`,
      detalhe: `Saiu em ${dm(String(v.saida_em).slice(0, 10))} com ${String(v.motorista_nome || '?').trim()}${v.destino ? ` para ${String(v.destino).trim()}` : ''} e o checklist de retorno não foi feito.`,
      valor: null, link: `${baseUrlSistema()}/admin/operacional/frota`,
    });
  }
  return alertas;
}

// MDF-e de produção autorizado e não encerrado há mais de 1 dia: enquanto estiver
// aberto, a SEFAZ recusa outro MDF-e para a mesma placa (2026-11-21).
async function detectarMdfeAbertos(db: DB, E: number, hoje: string): Promise<NovoAlerta[]> {
  const { data, error } = await db.from('fiscal_mdfe').select('id, numero, placa, criado_em, municipios_descarregamento, valor_carga')
    .eq('empresa_id', E).eq('status', 'AUTORIZADO').eq('ambiente', 'PRODUCAO').lt('criado_em', new Date(Date.now() - 86_400_000).toISOString());
  if (error) throw error;
  return ((data || []) as any[]).map(m => {
    const destino = ((m.municipios_descarregamento || []) as any[]).map(d => `${d.nome}/${d.uf}`).join(', ');
    return {
      empresa_id: E, tipo: 'MDFE_ABERTO' as const, chave: `${E}:mdfe-aberto:${m.id}`,
      titulo: `MDF-e nº ${m.numero} aberto: ${m.placa}`,
      detalhe: `Emitido em ${dm(String(m.criado_em).slice(0, 10))}${destino ? ` para ${destino}` : ''}, há ${diasEntre(String(m.criado_em).slice(0, 10), hoje)} dia(s) sem encerrar. Enquanto estiver aberto, a SEFAZ recusa outro MDF-e para esta placa.`,
      valor: num(m.valor_carga) || null, link: `${baseUrlSistema()}/admin/financeiro/fiscal`,
    };
  });
}

// NF-e de PRODUÇÃO para fora de SP sem MDF-e (obrigatório só na viagem
// interestadual — regra confirmada pelo usuário em 2026-11-22). Espera 1h:
// dá tempo de emitir o MDF-e logo depois da nota.
async function detectarMdfePendente(db: DB, E: number, hoje: string): Promise<NovoAlerta[]> {
  const notas = await nfeForaDeSpSemMdfe(db, E, somarDias(hoje, -30));
  const limite = new Date(Date.now() - 3_600_000).toISOString();
  return notas.filter(n => n.emitida_em < limite).map(n => ({
    empresa_id: E, tipo: 'MDFE_PENDENTE' as const, chave: `${E}:mdfe-pendente:${n.id}`,
    titulo: `NF-e nº ${n.numero} para ${n.uf} sem MDF-e`,
    detalhe: `${n.cliente} — viagem interestadual exige MDF-e antes de o caminhão sair (Financeiro › Fiscal › MDF-e).`,
    valor: n.valor || null, link: `${baseUrlSistema()}/admin/financeiro/fiscal`,
  }));
}

// Equipamento com mais reserva que estoque nos próximos 7 dias. Só depois da
// virada (antes disso as reservas do sistema são ensaio) — locacao.ts.
async function detectarFaltasAgenda(db: DB, E: number, hoje: string): Promise<NovoAlerta[]> {
  const faltas = await faltasNaAgenda(db, await fonteDoDiretor(db, E), hoje, 7);
  return faltas.map(f => ({
    empresa_id: E, tipo: 'FALTA_AGENDA' as const, chave: `${E}:falta-agenda:${f.produto_id}:${f.primeiro_dia}`,
    titulo: `Falta ${f.pico - f.estoque} un. de ${f.nome} em ${dm(f.primeiro_dia)}`,
    detalhe: `Estoque ${f.estoque}, reservado ${f.pico} no pico. Sublocar, trocar o equipamento ou rever as reservas (Locações › Agenda).`,
    valor: null, link: `${baseUrlSistema()}/admin/locacoes/agenda`,
  }));
}

async function detectarCaixa(db: DB, E: number, hoje: string, fonte: FonteRecebimentos, p: ParametrosDiretoria): Promise<NovoAlerta[]> {
  // Sem recebimentos integrados não dá pra comparar entradas × saídas.
  if (fonte !== 'P2S') return [];
  const fim = somarDias(hoje, 6);
  // Espelho do P2S antes da virada, títulos do sistema depois (fontes.ts).
  const origem = await fonteDoDiretor(db, E);
  const [pagar, ops, receber] = await Promise.all([
    lerPagar(db, origem, { quitado: false, vencDe: hoje, vencAte: fim }),
    // OP já enviada ao P2S vira conta a pagar lá — não contar duas vezes. Depois
    // da virada toda OP já é título a pagar do sistema.
    origem.financeiro === 'SISTEMA' ? Promise.resolve({ data: [] as any[] }) : db.from('op_ordens_pagamento').select('numero_op, empresa_recebedora, total_geral, data_vencimento').eq('empresa_id', E).eq('status', 'PENDENTE').is('p2s_conta_pagar_oid', null).gte('data_vencimento', hoje).lte('data_vencimento', fim),
    lerReceber(db, origem, { quitado: false, vencDe: hoje, vencAte: fim }),
  ]);
  const saidasP2s = ((pagar.data || []) as any[]).reduce((s, l) => s + num(l.valor), 0);
  const saidasOps = ((ops.data || []) as any[]).reduce((s, l) => s + num(l.total_geral), 0);
  const entradas = ((receber.data || []) as any[]).reduce((s, l) => s + num(l.valor_final), 0);
  const saidas = saidasP2s + saidasOps;
  const diferenca = Math.round((saidas - entradas) * 100) / 100;
  if (diferenca <= p.alerta_caixa_margem) return [];

  const maioresSaidas = [
    ...((pagar.data || []) as any[]).map(l => ({ nome: l.fornecedor, valor: num(l.valor), data: l.data_vencimento })),
    ...((ops.data || []) as any[]).map(l => ({ nome: `OP ${l.numero_op} ${String(l.empresa_recebedora || '').trim()}`, valor: num(l.total_geral), data: l.data_vencimento })),
  ].sort((a, b) => b.valor - a.valor).slice(0, 3);
  return [{
    empresa_id: E, tipo: 'CAIXA_SEMANA', chave: `${E}:caixa-semana:${semanaIso(hoje)}`,
    titulo: `Caixa apertado: saídas superam entradas em ${BRL(diferenca)}`,
    detalhe: `De ${dm(hoje)} a ${dm(fim)}: saídas previstas ${BRL(saidas)} (contas a pagar ${BRL(saidasP2s)} + OPs pendentes ${BRL(saidasOps)}) contra entradas previstas ${BRL(entradas)}. Maiores saídas: ${maioresSaidas.map(s => `${String(s.nome || '?').trim()} ${BRL(s.valor)} em ${dm(s.data)}`).join('; ')}. Não considera o saldo em banco.`,
    valor: diferenca, link: `${baseUrlSistema()}/admin/financeiro`,
  }];
}

// Tetos das metas (Fase 4): OPs do mês passaram de 80% e de 100% do teto
// (um aviso de cada por mês); inadimplência até 1 ano acima do teto (um por mês).
async function detectarTetos(db: DB, E: number, hoje: string, fonte: FonteRecebimentos): Promise<NovoAlerta[]> {
  const { mes, metas } = await progressoMetasDoMes(db, E, fonte, hoje);
  const alertas: NovoAlerta[] = [];
  const ops = metas.find(m => m.tipo === 'TETO_OPS');
  if (ops?.meta && ops.realizado != null) {
    for (const nivel of [80, 100]) {
      if (ops.realizado >= ops.meta * nivel / 100) {
        alertas.push({
          empresa_id: E, tipo: 'META_TETO_OPS', chave: `${E}:meta-teto-ops-${nivel}:${mes}`,
          titulo: nivel === 100 ? `OPs do mês estouraram o teto: ${BRL(ops.realizado)}` : `OPs do mês passaram de 80% do teto`,
          detalhe: `OPs criadas em ${mes.slice(5)}/${mes.slice(0, 4)} somam ${BRL(ops.realizado)} contra teto de ${BRL(ops.meta)} (${String(ops.pct_da_meta).replace('.', ',')}%).`,
          valor: ops.realizado, link: `${baseUrlSistema()}/admin/financeiro/ops`,
        });
      }
    }
  }
  const inad = metas.find(m => m.tipo === 'TETO_INADIMPLENCIA');
  if (inad?.meta && inad.realizado != null && inad.realizado > inad.meta) {
    alertas.push({
      empresa_id: E, tipo: 'META_TETO_INADIMPLENCIA', chave: `${E}:meta-teto-inadimplencia:${mes}`,
      titulo: `Inadimplência acima do teto: ${BRL(inad.realizado)}`,
      detalhe: `Vencido a receber (até 1 ano) está em ${BRL(inad.realizado)}, acima do teto de ${BRL(inad.meta)} — ${BRL(-(inad.faltam || 0))} a mais.`,
      valor: inad.realizado, link: `${baseUrlSistema()}/admin/diretoria`,
    });
  }
  return alertas;
}

export interface ResultadoAlertasEmpresa {
  empresa: string;
  detectados: number;
  novos: number;
  enviados: number;
  envio: string | null;
  erros: string[];
}

// Só detecta (leitura) — não grava nem envia.
export async function detectarAlertas(db: DB, empresaId: number): Promise<{ detectados: NovoAlerta[]; erros: string[] }> {
  const hoje = hojeISO();
  const p = await carregarParametrosDiretoria(db);
  const { data: cadastro } = await db.from('empresas').select('*').eq('id', empresaId).maybeSingle();
  const fonte: FonteRecebimentos = cadastro?.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S';
  const erros: string[] = [];
  const proteger = async (nome: string, fn: () => Promise<NovoAlerta[]>) => {
    try { return await fn(); } catch (e: any) { erros.push(`${nome}: ${e?.message || e}`); return []; }
  };
  const detectados = (await Promise.all([
    proteger('pagamentos', () => detectarOps(db, empresaId, p)),
    fonte === 'P2S' ? proteger('contas a receber', () => detectarReceber(db, empresaId, hoje, p)) : Promise.resolve([]),
    proteger('retornos', () => detectarRetornos(db, empresaId, hoje, p)),
    proteger('caixa', () => detectarCaixa(db, empresaId, hoje, fonte, p)),
    proteger('metas', () => detectarTetos(db, empresaId, hoje, fonte)),
    proteger('mdfe', () => detectarMdfeAbertos(db, empresaId, hoje)),
    proteger('mdfe-pendente', () => detectarMdfePendente(db, empresaId, hoje)),
    proteger('agenda', () => detectarFaltasAgenda(db, empresaId, hoje)),
  ])).flat();
  return { detectados, erros };
}

// Detecta, grava os novos (chave única) e, se pedido, envia os ainda não
// enviados num e-mail só por empresa.
export async function processarAlertas(db: DB, empresa: { id: number; nome: string }, opcoes: { enviarEmail: boolean }): Promise<ResultadoAlertasEmpresa> {
  const hoje = hojeISO();
  const { detectados, erros } = await detectarAlertas(db, empresa.id);

  let novos = 0;
  if (detectados.length) {
    let { data: inseridos, error } = await db.from('diretoria_alertas')
      .upsert(detectados, { onConflict: 'chave', ignoreDuplicates: true }).select('id');
    // Tipo novo antes do SQL que o libera (diretoria_alertas_locacao.sql): grava os outros.
    if (error?.code === '23514') {
      const novosTipos = ['MDFE_PENDENTE', 'FALTA_AGENDA'];
      erros.push(`alertas ${novosTipos.join('/')} não gravados: falta rodar .sql/Pendentes/diretoria_alertas_locacao.sql`);
      ({ data: inseridos, error } = await db.from('diretoria_alertas')
        .upsert(detectados.filter(a => !novosTipos.includes(a.tipo)), { onConflict: 'chave', ignoreDuplicates: true }).select('id'));
    }
    if (error) erros.push(`gravar alertas: ${error.message}`);
    novos = (inseridos || []).length;
  }

  let enviados = 0;
  let envioTexto: string | null = null;
  if (opcoes.enviarEmail) {
    // Só o que é recente: alerta que ficou sem envio (card desligado, falha)
    // por mais de 3 dias continua visível na tela, mas não vira mensagem velha.
    const { data: pendentes } = await db.from('diretoria_alertas').select('id, titulo, detalhe')
      .eq('empresa_id', empresa.id).is('enviado_em', null)
      .gte('detectado_em', new Date(Date.now() - 3 * 86_400_000).toISOString())
      .order('detectado_em');
    const lista = (pendentes || []) as { id: number; titulo: string; detalhe: string }[];
    if (lista.length) {
      const envio = await enviarPeloCard(db, CHAVE_CARD_ALERTAS, hoje, montarEmailAlertas({
        empresa: empresa.nome,
        alertas: lista,
        link: `${baseUrlSistema()}/admin/diretoria?empresa=${empresa.id}&tipo=ALERTAS`,
      }), empresa.id);
      envioTexto = envio.texto;
      enviados = envio.enviados;
      await db.from('diretoria_alertas')
        .update({ enviado_em: envio.enviados > 0 ? new Date().toISOString() : null, envio_resultado: envio.texto })
        .in('id', lista.map(a => a.id));
    }
  }

  return { empresa: empresa.nome, detectados: detectados.length, novos, enviados, envio: envioTexto, erros };
}
