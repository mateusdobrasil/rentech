// app/lib/locacao/fichaLocacao.ts
// Ficha de Locação PRÓPRIA (2026-11-20). Só servidor, SEM checagem de acesso
// (quem chama — server action ou Expedição — valida rota/empresa).
//
// Decisões do usuário:
//   * só fichas criadas no sistema (origem SISTEMA); as do P2S continuam lá;
//   * número FL-07050/A (= OS FR-07050 + letra); /B, /C… são complementos;
//   * saída/devolução pela Expedição (checklist) E manual na ficha;
//   * cada saída/devolução gera um comprovante (a OS que vai pra rua), com
//     assinatura do recebedor na tela;
//   * prorrogação, complemento, troca e extravio (indenização).
//
// Mesmas tabelas do histórico do P2S (locacao_fichas_locacao*), com origem
// SISTEMA — relatórios enxergam as duas. Status: A = aberta, F = finalizada.
//
// Agenda (locacao_alocacoes), por item previsto:
//   saída     → RESERVADO vira LOCADO (peça lida troca a peça reservada)
//   devolução → LOCADO vira DEVOLVIDO, período termina na data + dias de retorno
//   extravio  → LOCADO vira CANCELADO (a peça/quantidade sai do estoque pela avaria)
//
// Extravio é AUTOMÁTICO (decisão do usuário 2026-11-20): o que não teve
// entrada quando o retorno foi encerrado (checklist da Expedição finalizado ou
// "devolução final" na ficha) vira extravio + cobrança de REPOSIÇÃO no
// Financeiro (título origem REPOSICAO). O Financeiro cobra ou cancela — título
// cancelado fica só no histórico e a avaria vira "não cobrar".
// Prorrogação e complemento são do COMERCIAL (envolvem custo): ficam no
// painel da OS (ficha de reserva), não na tela da operação.
//   atraso    → estenderAtrasos (cron) puxa o fim do LOCADO para hoje + retorno
import type { supabaseAdmin } from '../supabase';
import { expandirKits, verificarDisponibilidade, reservarItensAdicionais, sublocadoPorProduto, type LinhaDisponibilidade } from './disponibilidade';
import { periodoAlocacao, daterangeInclusivo, lerDaterange, somarDias, diasInclusivos, hojeISO, dataValida, type DatasFicha } from './datas';
import { numeroFichaPorId } from './fichaNumero';
import { registrarAvaria } from './manutencao';
import { precificarItens, type Modalidade } from './precificacao';

type Db = ReturnType<typeof supabaseAdmin>;
export type TipoMovimento = 'SAIDA' | 'DEVOLUCAO' | 'EXTRAVIO';

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
const arred3 = (v: number) => Math.round(v * 1000) / 1000;
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const numeroFichaLocacao = (reservaId: number, letra: string) => `${numeroFichaPorId(reservaId).replace(/^FR-/, 'FL-')}/${letra}`;

// ============================================================================
// LEITURA
// ============================================================================
export interface PrevistoComSaldo {
  id: number;
  ficha_item_id: number | null;
  produto_id: number;
  kit_produto_id: number | null;
  descricao: string;
  codigo: string | null;
  controle: 'INDIVIDUAL' | 'QUANTIDADE';
  valor_indenizacao: number | null;
  dias_retorno: number;
  prevista: number;
  extra: boolean;
  saiu: number;           // saídas normais (sem troca)
  devolvido: number;      // devoluções normais (sem troca)
  extraviado: number;
  fora: number;           // está com o cliente agora
  pendenteSaida: number;  // reservado e ainda não saiu
  pecasFora: { id: number; numero: string }[];
}

/** Itens previstos da ficha com o que já saiu/voltou. */
export async function saldosDaFicha(db: Db, fichaLocacaoId: number): Promise<PrevistoComSaldo[]> {
  const [rI, rM] = await Promise.all([
    db.from('locacao_fichas_locacao_itens')
      .select('*, produto:produtos!locacao_fichas_locacao_itens_produto_id_fkey(nome_item, codigo_formatado, controle_locacao, valor_indenizacao, dias_retorno)')
      .eq('ficha_locacao_id', fichaLocacaoId).order('ordem').order('id'),
    db.from('locacao_fichas_locacao_movimentos')
      .select('ficha_locacao_item_id, tipo, quantidade, troca, patrimonio_id, patrimonio:locacao_patrimonios(numero_patrimonio)')
      .eq('ficha_locacao_id', fichaLocacaoId),
  ]);
  if (rI.error) throw rI.error;
  if (rM.error) throw rM.error;
  const movs = (rM.data || []) as any[];
  return ((rI.data || []) as any[]).map(it => {
    const meus = movs.filter(m => m.ficha_locacao_item_id === it.id);
    const soma = (f: (m: any) => boolean) => arred3(meus.filter(f).reduce((s, m) => s + n(m.quantidade), 0));
    const saiu = soma(m => m.tipo === 'SAIDA' && !m.troca);
    const saiuTroca = soma(m => m.tipo === 'SAIDA' && m.troca);
    const devolvido = soma(m => m.tipo === 'DEVOLUCAO' && !m.troca);
    const devTroca = soma(m => m.tipo === 'DEVOLUCAO' && m.troca);
    const extraviado = soma(m => m.tipo === 'EXTRAVIO');
    const fora = arred3(saiu + saiuTroca - devolvido - devTroca - extraviado);
    // peças com o cliente: última movimentação de cada patrimônio é saída
    const estado = new Map<number, { numero: string; fora: boolean }>();
    for (const m of meus) if (m.patrimonio_id) estado.set(m.patrimonio_id, { numero: m.patrimonio?.numero_patrimonio || `#${m.patrimonio_id}`, fora: m.tipo === 'SAIDA' });
    return {
      id: it.id, ficha_item_id: it.ficha_item_id, produto_id: it.produto_id, kit_produto_id: it.kit_produto_id,
      descricao: it.descricao, codigo: it.produto?.codigo_formatado || null,
      controle: it.produto?.controle_locacao === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'QUANTIDADE',
      valor_indenizacao: it.produto?.valor_indenizacao ?? null, dias_retorno: n(it.produto?.dias_retorno),
      prevista: n(it.quantidade), extra: !!it.extra,
      saiu, devolvido, extraviado, fora, pendenteSaida: Math.max(0, arred3(n(it.quantidade) - saiu)),
      pecasFora: [...estado.entries()].filter(([, e]) => e.fora).map(([id, e]) => ({ id, numero: e.numero })),
    };
  });
}

// ============================================================================
// ABRIR (A) / COMPLEMENTO (B, C…)
// ============================================================================
async function carregarReserva(db: Db, reservaId: number) {
  const { data, error } = await db.from('locacao_fichas_reserva').select('*').eq('id', reservaId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Ficha de reserva não encontrada.');
  return data as any;
}

/** Previstos (kits explodidos) dos itens de equipamento da reserva. */
async function montarPrevistos(db: Db, reservaId: number, somenteItens?: number[] | null) {
  let q = db.from('locacao_fichas_reserva_itens').select('id, tipo, produto_id, quantidade, ordem').eq('ficha_id', reservaId).in('tipo', ['EQUIPAMENTO', 'KIT']).order('ordem');
  if (somenteItens) q = q.in('id', somenteItens.length ? somenteItens : [0]);
  const { data: itens, error } = await q;
  if (error) throw error;
  const validos = ((itens || []) as any[]).filter(i => i.produto_id && n(i.quantidade) > 0);
  const demanda = await expandirKits(db, validos.map(i => ({ ficha_item_id: i.id, produto_id: i.produto_id, quantidade: n(i.quantidade) })));
  const ids = [...demanda.keys()];
  const { data: prods } = ids.length ? await db.from('produtos').select('id, nome_item').in('id', ids) : { data: [] };
  const nome = new Map(((prods || []) as any[]).map(p => [p.id, p.nome_item]));
  const ordemItem = new Map(validos.map(i => [i.id, n(i.ordem)]));
  const linhas: { ficha_item_id: number | null; produto_id: number; kit_produto_id: number | null; descricao: string; quantidade: number; ordem: number }[] = [];
  for (const [produtoId, partes] of demanda) {
    for (const p of partes) linhas.push({
      ficha_item_id: p.ficha_item_id, produto_id: produtoId, kit_produto_id: p.kit_produto_id,
      descricao: nome.get(produtoId) || `Produto #${produtoId}`, quantidade: arred3(p.quantidade), ordem: ordemItem.get(p.ficha_item_id || 0) ?? 999,
    });
  }
  return linhas.sort((a, b) => a.ordem - b.ordem || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

export async function fichasLocacaoDaReserva(db: Db, reservaId: number) {
  const { data, error } = await db.from('locacao_fichas_locacao').select('id, numero, letra, status, data_saida, data_devolucao, criado_em, finalizada_em')
    .eq('ficha_reserva_id', reservaId).eq('origem', 'SISTEMA').order('letra');
  if (error) throw error;
  return (data || []) as any[];
}

/**
 * Abre a ficha de locação /A da reserva (ou devolve a que já existe). Com
 * `itensComplemento`, abre a próxima letra só com esses itens.
 */
export async function abrirFichaLocacao(db: Db, reservaId: number, usuario: string, itensComplemento?: number[]): Promise<{ id: number; numero: string; nova: boolean }> {
  const r = await carregarReserva(db, reservaId);
  if (r.origem !== 'SISTEMA') throw new Error('Ficha importada do P2S — a locação dela é feita no PrimeStart.');
  const existentes = await fichasLocacaoDaReserva(db, reservaId);
  if (!itensComplemento) {
    if (!['RESERVADA', 'EM_LOCACAO'].includes(r.status)) throw new Error('A ficha de reserva precisa estar RESERVADA (aprovada, com equipamentos reservados).');
    const a = existentes.find(e => e.letra === 'A');
    if (a) return { id: a.id, numero: a.numero, nova: false };
  }
  const letra = itensComplemento ? LETRAS[existentes.length] : 'A';
  if (!letra) throw new Error('Limite de complementos atingido.');
  const numero = numeroFichaLocacao(reservaId, letra);
  const { data: cab, error } = await db.from('locacao_fichas_locacao').insert({
    origem: 'SISTEMA', p2s_oid: null, numero, letra, ficha_reserva_id: reservaId, empresa_id: r.empresa_id, parceiro_id: r.parceiro_id,
    evento_id: r.evento_id, vendedor_id: r.vendedor_id ?? null, responsavel: r.vendedor_nome, status: 'A', criado_por: usuario,
    p2s_sincronizado_em: new Date().toISOString(),
  }).select('id').single();
  if (error) {
    if (String(error.message).includes('locacao_fichas_locacao_propria_letra_uidx')) {
      const de = (await fichasLocacaoDaReserva(db, reservaId)).find(e => e.letra === letra);
      if (de) return { id: de.id, numero: de.numero, nova: false };
    }
    throw error;
  }
  // /A: itens que não são de outro complemento; complemento: só os itens dele
  let itens = itensComplemento ?? null;
  if (!itens && existentes.length) {
    const { data: outros } = await db.from('locacao_fichas_locacao_itens').select('ficha_item_id').in('ficha_locacao_id', existentes.map(e => e.id));
    const usados = new Set(((outros || []) as any[]).map(o => o.ficha_item_id));
    const { data: todos } = await db.from('locacao_fichas_reserva_itens').select('id').eq('ficha_id', reservaId);
    itens = ((todos || []) as any[]).map(t => t.id).filter(id => !usados.has(id));
  }
  const previstos = await montarPrevistos(db, reservaId, itens);
  if (previstos.length) {
    const { error: eI } = await db.from('locacao_fichas_locacao_itens').insert(previstos.map((p, i) => ({ ...p, ordem: i, ficha_locacao_id: cab.id })));
    if (eI) throw eI;
  }
  return { id: cab.id, numero, nova: true };
}

/**
 * /A sem nenhuma movimentação acompanha a reserva (que ainda pode ser
 * editada enquanto RESERVADA): refaz os previstos a partir dos itens atuais.
 */
export async function sincronizarPrevistosSemMovimento(db: Db, fichaLocacaoId: number): Promise<void> {
  const { data: fl } = await db.from('locacao_fichas_locacao').select('id, letra, status, origem, ficha_reserva_id').eq('id', fichaLocacaoId).maybeSingle();
  if (!fl || fl.origem !== 'SISTEMA' || fl.letra !== 'A' || fl.status !== 'A' || !fl.ficha_reserva_id) return;
  const { count } = await db.from('locacao_fichas_locacao_movimentos').select('id', { count: 'exact', head: true }).eq('ficha_locacao_id', fichaLocacaoId);
  if ((count || 0) > 0) return;
  const outras = (await fichasLocacaoDaReserva(db, fl.ficha_reserva_id)).filter(e => e.id !== fl.id);
  let itens: number[] | null = null;
  if (outras.length) {
    const { data: o } = await db.from('locacao_fichas_locacao_itens').select('ficha_item_id').in('ficha_locacao_id', outras.map(e => e.id));
    const usados = new Set(((o || []) as any[]).map(x => x.ficha_item_id));
    const { data: todos } = await db.from('locacao_fichas_reserva_itens').select('id').eq('ficha_id', fl.ficha_reserva_id);
    itens = ((todos || []) as any[]).map(t => t.id).filter(id => !usados.has(id));
  }
  const previstos = await montarPrevistos(db, fl.ficha_reserva_id, itens);
  const { data: atuais } = await db.from('locacao_fichas_locacao_itens').select('ficha_item_id, produto_id, quantidade, extra').eq('ficha_locacao_id', fichaLocacaoId);
  const chave = (x: any) => `${x.ficha_item_id}|${x.produto_id}|${n(x.quantidade)}`;
  const a = ((atuais || []) as any[]).filter(x => !x.extra).map(chave).sort().join(';');
  const b = previstos.map(chave).sort().join(';');
  if (a === b) return;
  await db.from('locacao_fichas_locacao_itens').delete().eq('ficha_locacao_id', fichaLocacaoId);
  if (previstos.length) await db.from('locacao_fichas_locacao_itens').insert(previstos.map((p, i) => ({ ...p, ordem: i, ficha_locacao_id: fichaLocacaoId })));
}

// ============================================================================
// MOVIMENTOS
// ============================================================================
export interface LinhaMovimento {
  previsto_id: number;
  quantidade: number;
  patrimonio_id?: number | null;
  /** devolução com avaria */
  avaria?: { gravidade: 'LEVE' | 'MEDIA' | 'GRAVE' | 'PERDA_TOTAL'; descricao: string; status_cobranca?: 'A_DEFINIR' | 'COBRAR' | 'NAO_COBRAR'; valor_cobranca?: number | null; abrir_os?: boolean; fotos?: string[] } | null;
  /** extravio */
  valor_indenizacao?: number | null;
  checklist_id?: string | null;
  checklist_item_id?: string | null;
}

export interface ArgsMovimento {
  tipo: TipoMovimento;
  data: string;
  linhas: LinhaMovimento[];
  usuario: string;
  troca?: boolean;
  observacoes?: string | null;
  /** Expedição: item conferido sem estar previsto entra como extra (não recusa) */
  permitirExtra?: boolean;
  /** devolução final: o que continuar com o cliente vira extravio (reposição) */
  devolucaoFinal?: boolean;
  /** devolução final só destes produtos (Expedição: os do checklist) */
  produtosDaDevolucaoFinal?: number[] | null;
  /** não cria comprovante (troca cria um só para as duas pernas) */
  semComprovante?: boolean;
  comprovanteId?: number | null;
}

async function cabecalhoAberto(db: Db, fichaLocacaoId: number) {
  const { data: fl, error } = await db.from('locacao_fichas_locacao').select('*').eq('id', fichaLocacaoId).maybeSingle();
  if (error) throw error;
  if (!fl) throw new Error('Ficha de locação não encontrada.');
  if (fl.origem !== 'SISTEMA') throw new Error('Ficha de locação do P2S — é movimentada no PrimeStart.');
  if (fl.status !== 'A') throw new Error(`${fl.numero} já está finalizada.`);
  return fl as any;
}

/** Fim do período (agenda) do produto nesta reserva: retorno + dias de retorno. */
function fimPeriodo(reserva: DatasFicha, diasPreparo: number, diasRetorno: number) {
  return periodoAlocacao(reserva, diasPreparo, diasRetorno);
}

/**
 * Registra saída, devolução ou extravio de uma ou mais linhas (uma só
 * data). Valida quantidades e peças antes de mexer em qualquer coisa.
 */
export async function registrarMovimento(db: Db, fichaLocacaoId: number, a: ArgsMovimento): Promise<{ movimentos: number; comprovanteId: number | null; avisos: string[]; extraviados?: number }> {
  if (!dataValida(a.data)) throw new Error('Data inválida.');
  if (a.data > somarDias(hojeISO(), 1)) throw new Error('A data não pode ser no futuro.');
  const fl = await cabecalhoAberto(db, fichaLocacaoId);
  const reserva = await carregarReserva(db, fl.ficha_reserva_id);
  const saldos = await saldosDaFicha(db, fichaLocacaoId);
  const porId = new Map(saldos.map(s => [s.id, s]));
  const linhas = a.linhas.filter(l => n(l.quantidade) > 0);
  if (!linhas.length) throw new Error('Informe ao menos uma quantidade.');
  const avisos: string[] = [];

  // ---- validação (nada é gravado se algo falhar) ----
  const usoPorPrevisto = new Map<number, number>();
  const pecasUsadas = new Set<number>();
  // peça devolvida que saiu sem leitura: devolve "por quantidade" na agenda
  const semPecaNaAgenda = new Set<LinhaMovimento>();
  const { data: prodInfo } = await db.from('produtos').select('id, dias_preparo, dias_retorno, valor_indenizacao, custo_reposicao').in('id', [...new Set(saldos.map(s => s.produto_id))]);
  const info = new Map(((prodInfo || []) as any[]).map(p => [p.id, p]));
  // sublocado (equipamento do parceiro): a saída além da reserva própria não ocupa o estoque próprio
  const sublocado = a.tipo === 'SAIDA' ? await sublocadoPorProduto(db, reserva.id) : new Map<number, number>();
  for (const l of linhas) {
    const s = porId.get(l.previsto_id);
    if (!s) throw new Error('Item não pertence a esta ficha de locação.');
    const q = arred3(n(l.quantidade));
    const acum = arred3((usoPorPrevisto.get(s.id) || 0) + q);
    usoPorPrevisto.set(s.id, acum);
    if (s.controle === 'INDIVIDUAL' && !Number.isInteger(q)) throw new Error(`"${s.descricao}" é controlado por patrimônio — quantidade inteira.`);
    if (l.patrimonio_id) {
      if (q !== 1) throw new Error('Com patrimônio, a quantidade da linha é 1.');
      if (pecasUsadas.has(l.patrimonio_id)) throw new Error('A mesma peça apareceu duas vezes.');
      pecasUsadas.add(l.patrimonio_id);
      const { data: p } = await db.from('locacao_patrimonios').select('id, empresa_id, produto_id, situacao, numero_patrimonio').eq('id', l.patrimonio_id).maybeSingle();
      if (!p || p.produto_id !== s.produto_id || p.empresa_id !== fl.empresa_id) throw new Error('Patrimônio não confere com o item/empresa.');
      const comCliente = s.pecasFora.some(x => x.id === p.id);
      if (a.tipo === 'SAIDA') {
        if (p.situacao !== 'ATIVO') throw new Error(`${p.numero_patrimonio} está ${p.situacao} — não pode sair.`);
        if (comCliente) throw new Error(`${p.numero_patrimonio} já está com o cliente.`);
        // peça presa em outra ficha no mesmo período?
        const per = fimPeriodo(reserva, n(info.get(s.produto_id)?.dias_preparo), n(info.get(s.produto_id)?.dias_retorno));
        const { data: conflito } = await db.from('locacao_alocacoes').select('ficha_id').eq('patrimonio_id', p.id).neq('ficha_id', reserva.id)
          .in('status', ['RESERVADO', 'LOCADO']).overlaps('periodo', daterangeInclusivo(a.data, per.fim)).limit(1);
        if (conflito?.length) throw new Error(`${p.numero_patrimonio} está reservada para ${numeroFichaPorId(conflito[0].ficha_id)} nesse período — leia outra peça.`);
      } else if (!comCliente) {
        const { data: aloc } = await db.from('locacao_alocacoes').select('id').eq('ficha_id', reserva.id).eq('patrimonio_id', p.id).eq('status', 'LOCADO').limit(1);
        if (!aloc?.length) {
          if (s.pecasFora.length >= s.fora) throw new Error(`${p.numero_patrimonio} não está com o cliente nesta ficha.`);
          semPecaNaAgenda.add(l);
        }
      }
    }
    if (a.tipo === 'SAIDA' && !a.troca && acum > s.pendenteSaida + 1e-9) {
      if (!a.permitirExtra) throw new Error(`"${s.descricao}": só ${s.pendenteSaida} pendente(s) de saída. Para levar mais, use Complemento.`);
      avisos.push(`"${s.descricao}": saiu ${acum} e estavam pendentes ${s.pendenteSaida} — o excedente fica como extra.`);
    }
    if ((a.tipo === 'DEVOLUCAO' || a.tipo === 'EXTRAVIO') && acum > s.fora + 1e-9) {
      throw new Error(`"${s.descricao}": só ${s.fora} com o cliente.`);
    }
  }

  // ---- comprovante (a OS que vai/volta) ----
  let comprovanteId = a.comprovanteId ?? null;
  if (!comprovanteId && !a.semComprovante && a.tipo !== 'EXTRAVIO') {
    const { data: c, error } = await db.from('locacao_comprovantes').insert({
      ficha_locacao_id: fichaLocacaoId, tipo: a.tipo, data: a.data, registrado_por: a.usuario, observacoes: a.observacoes || null,
    }).select('id').single();
    if (error) throw error;
    comprovanteId = c.id;
  }

  // ---- grava ----
  let gravados = 0;
  for (const l of linhas) {
    const s = porId.get(l.previsto_id)!;
    const q = arred3(n(l.quantidade));
    const pi = info.get(s.produto_id);
    const per = fimPeriodo(reserva, n(pi?.dias_preparo), n(pi?.dias_retorno));
    let avariaId: number | null = null;
    let valorInd: number | null = null;

    if (a.tipo === 'SAIDA') {
      const { error } = await db.rpc('locacao_mover_alocacao', {
        p_ficha_id: reserva.id, p_ficha_item_id: s.ficha_item_id, p_empresa_id: fl.empresa_id, p_produto_id: s.produto_id,
        p_patrimonio_id: l.patrimonio_id ?? null, p_quantidade: q, p_de: a.troca || s.extra ? 'TROCA' : 'RESERVADO', p_para: 'LOCADO',
        p_fim: null,
        p_periodo_novo: !a.troca && !s.extra && (sublocado.get(s.produto_id) || 0) > 0 ? null : daterangeInclusivo(a.data < per.fim ? a.data : per.fim, per.fim),
      });
      if (error) throw new Error(error.message.includes('patrimonio_sem_conflito') ? 'A peça está reservada para outra ficha nesse período.' : error.message);
    } else if (a.tipo === 'DEVOLUCAO') {
      const { error } = await db.rpc('locacao_mover_alocacao', {
        p_ficha_id: reserva.id, p_ficha_item_id: s.ficha_item_id, p_empresa_id: fl.empresa_id, p_produto_id: s.produto_id,
        p_patrimonio_id: semPecaNaAgenda.has(l) ? null : (l.patrimonio_id ?? null), p_quantidade: q, p_de: 'LOCADO', p_para: 'DEVOLVIDO',
        p_fim: somarDias(a.data, n(pi?.dias_retorno)), p_periodo_novo: null,
      });
      if (error) throw error;
      if (l.avaria?.descricao?.trim()) {
        const r = await registrarAvaria(db, {
          empresa_id: fl.empresa_id, produto_id: s.produto_id, patrimonio_id: l.patrimonio_id ?? null, quantidade: q,
          gravidade: l.avaria.gravidade, descricao: `${l.avaria.descricao.trim()} (${fl.numero})`, fotos: l.avaria.fotos || [],
          ficha_id: reserva.id, parceiro_id: reserva.parceiro_id, checklist_id: l.checklist_id ?? null,
          status_cobranca: l.avaria.status_cobranca || 'A_DEFINIR', valor_cobranca: l.avaria.valor_cobranca ?? null,
          abrir_os: l.avaria.abrir_os && l.avaria.gravidade !== 'PERDA_TOTAL' ? { tipo: 'INTERNA' } : null,
        }, a.usuario);
        avariaId = r.avariaId;
      }
    } else {
      // EXTRAVIO: não voltou — sai do estoque e gera a cobrança de reposição
      const { error } = await db.rpc('locacao_mover_alocacao', {
        p_ficha_id: reserva.id, p_ficha_item_id: s.ficha_item_id, p_empresa_id: fl.empresa_id, p_produto_id: s.produto_id,
        p_patrimonio_id: semPecaNaAgenda.has(l) ? null : (l.patrimonio_id ?? null), p_quantidade: q, p_de: 'LOCADO', p_para: 'CANCELADO',
        p_fim: a.data, p_periodo_novo: null,
      });
      if (error) throw error;
      // valor de indenização do produto; sem ele, o custo de reposição
      const unit = n(pi?.valor_indenizacao) > 0 ? n(pi.valor_indenizacao) : n(pi?.custo_reposicao) > 0 ? n(pi.custo_reposicao) : 0;
      valorInd = l.valor_indenizacao != null ? arred(n(l.valor_indenizacao)) : (unit > 0 ? arred(unit * q) : null);
      const r = await registrarAvaria(db, {
        empresa_id: fl.empresa_id, produto_id: s.produto_id, patrimonio_id: l.patrimonio_id ?? null, quantidade: q,
        gravidade: 'PERDA_TOTAL', descricao: `Não devolvido / extraviado (${fl.numero})${a.observacoes ? ` — ${a.observacoes}` : ''}`,
        ficha_id: reserva.id, parceiro_id: reserva.parceiro_id,
        status_cobranca: 'COBRAR', valor_cobranca: valorInd,
      }, a.usuario);
      avariaId = r.avariaId;
      const peca = l.patrimonio_id ? ` (${s.pecasFora.find(x => x.id === l.patrimonio_id)?.numero || 'peça'})` : '';
      const aviso = await gerarCobrancaReposicao(db, {
        avariaId: r.avariaId, empresaId: fl.empresa_id, parceiroId: reserva.parceiro_id, reservaId: reserva.id, valor: valorInd,
        descricao: `Reposição — ${q}× ${s.descricao}${peca} não devolvido · ${fl.numero}`, usuario: a.usuario,
      });
      if (aviso) avisos.push(aviso);
      if (l.patrimonio_id) {
        await db.from('locacao_patrimonios').update({ situacao: 'EXTRAVIADO', observacoes: `Extraviado — ${fl.numero} (avaria #${r.avariaId})`, updated_at: new Date().toISOString() }).eq('id', l.patrimonio_id);
      }
    }

    const { error: eM } = await db.from('locacao_fichas_locacao_movimentos').insert({
      ficha_locacao_id: fichaLocacaoId, origem: 'SISTEMA', p2s_oid: null, tipo: a.tipo, data_movimentacao: a.data,
      produto_id: s.produto_id, patrimonio_id: l.patrimonio_id ?? null, quantidade: q, ficha_locacao_item_id: s.id,
      troca: !!a.troca, usuario: a.usuario, observacoes: a.observacoes || null, checklist_id: l.checklist_id ?? null,
      checklist_item_id: l.checklist_item_id ?? null, avaria_id: avariaId, comprovante_id: comprovanteId, valor_indenizacao: valorInd,
    });
    if (eM) throw eM;
    gravados++;
  }

  let extraviados = 0;
  if (a.tipo === 'DEVOLUCAO' && a.devolucaoFinal) {
    const r = await extraviarPendentes(db, fichaLocacaoId, a.usuario, a.data, a.produtosDaDevolucaoFinal ?? null);
    extraviados = r.linhas;
    avisos.push(...r.avisos);
  }
  if (!extraviados) await atualizarSituacao(db, fichaLocacaoId, a.usuario);
  return { movimentos: gravados, comprovanteId, avisos, extraviados };
}

/**
 * Cobrança de reposição do extravio: título a receber (origem REPOSICAO)
 * vencendo em 7 dias, com o valor de indenização do produto. Sem valor
 * cadastrado não dá para gerar o título — a avaria fica "a cobrar" e avisa.
 */
async function gerarCobrancaReposicao(db: Db, d: { avariaId: number; empresaId: number; parceiroId: number; reservaId: number; valor: number | null; descricao: string; usuario: string }): Promise<string | null> {
  if (!(n(d.valor) > 0)) return `${d.descricao}: produto sem valor de indenização nem custo de reposição cadastrado — a avaria #${d.avariaId} ficou "a cobrar" para o Financeiro definir o valor.`;
  const { error } = await db.from('financeiro_titulos_receber').insert({
    empresa_id: d.empresaId, parceiro_id: d.parceiroId, origem: 'REPOSICAO', avaria_id: d.avariaId, ficha_id: d.reservaId,
    descricao: d.descricao.slice(0, 200), valor: arred(n(d.valor)), vencimento: somarDias(hojeISO(), 7), criado_por: d.usuario,
    observacoes: 'Gerado automaticamente (equipamento sem entrada no estoque). Cancele se não for cobrar — fica no histórico.',
  });
  if (error) return `Avaria #${d.avariaId}: não gerou a cobrança de reposição (${error.message}).`;
  await db.from('locacao_avarias').update({ status_cobranca: 'COBRADO', atualizado_em: new Date().toISOString() }).eq('id', d.avariaId);
  return null;
}

/**
 * Encerra o retorno: tudo que ainda está com o cliente (opcionalmente só dos
 * produtos indicados) vira extravio automático, peça a peça quando se sabe a
 * peça. Devolve quantas linhas extraviou.
 */
export async function extraviarPendentes(db: Db, fichaLocacaoId: number, usuario: string, data: string, produtos?: number[] | null): Promise<{ linhas: number; avisos: string[] }> {
  const saldos = await saldosDaFicha(db, fichaLocacaoId);
  const linhas: LinhaMovimento[] = [];
  for (const s of saldos) {
    if (s.fora <= 1e-9 || (produtos && !produtos.includes(s.produto_id))) continue;
    let resto = s.fora;
    for (const p of s.pecasFora) { linhas.push({ previsto_id: s.id, quantidade: 1, patrimonio_id: p.id }); resto = arred3(resto - 1); }
    if (resto > 1e-9) linhas.push({ previsto_id: s.id, quantidade: resto });
  }
  if (!linhas.length) return { linhas: 0, avisos: [] };
  const r = await registrarMovimento(db, fichaLocacaoId, { tipo: 'EXTRAVIO', data, linhas, usuario, observacoes: 'Sem entrada no estoque ao encerrar o retorno' });
  return { linhas: r.movimentos, avisos: [`${linhas.length} item(ns) sem entrada viraram extravio, com cobrança de reposição no Financeiro.`, ...r.avisos] };
}


/** Troca de peça/quantidade com defeito: volta uma, sai outra, mesmo comprovante. */
export async function registrarTroca(db: Db, fichaLocacaoId: number, t: {
  previsto_id: number; quantidade: number; volta_patrimonio_id?: number | null; sai_patrimonio_id?: number | null;
  data: string; usuario: string; motivo: string; avaria?: LinhaMovimento['avaria'];
}) {
  if (!t.motivo?.trim()) throw new Error('Informe o motivo da troca.');
  const fl = await cabecalhoAberto(db, fichaLocacaoId);
  const { data: c, error } = await db.from('locacao_comprovantes').insert({
    ficha_locacao_id: fichaLocacaoId, tipo: 'SAIDA', data: t.data, registrado_por: t.usuario, observacoes: `Troca: ${t.motivo.trim()}`,
  }).select('id').single();
  if (error) throw error;
  const obs = `Troca — ${t.motivo.trim()}`;
  // sai a nova ANTES de voltar a com defeito: a ficha não pode "finalizar" no meio da troca
  await registrarMovimento(db, fl.id, {
    tipo: 'SAIDA', data: t.data, usuario: t.usuario, troca: true, observacoes: obs, comprovanteId: c.id,
    linhas: [{ previsto_id: t.previsto_id, quantidade: t.quantidade, patrimonio_id: t.sai_patrimonio_id ?? null }],
  });
  await registrarMovimento(db, fl.id, {
    tipo: 'DEVOLUCAO', data: t.data, usuario: t.usuario, troca: true, observacoes: obs, comprovanteId: c.id,
    linhas: [{ previsto_id: t.previsto_id, quantidade: t.quantidade, patrimonio_id: t.volta_patrimonio_id ?? null, avaria: t.avaria ?? { gravidade: 'MEDIA', descricao: t.motivo, abrir_os: true } }],
  });
  return { comprovanteId: c.id };
}

/**
 * Situação depois de cada movimento: reserva vira EM_LOCACAO na 1ª saída;
 * ficha de locação finaliza quando nada está com o cliente nem pendente;
 * reserva finaliza quando todas as fichas de locação finalizaram.
 */
async function atualizarSituacao(db: Db, fichaLocacaoId: number, usuario: string) {
  const { data: fl } = await db.from('locacao_fichas_locacao').select('id, numero, ficha_reserva_id, status').eq('id', fichaLocacaoId).single();
  const saldos = await saldosDaFicha(db, fichaLocacaoId);
  const { data: movs } = await db.from('locacao_fichas_locacao_movimentos').select('tipo, data_movimentacao').eq('ficha_locacao_id', fichaLocacaoId);
  const datas = (t: string) => ((movs || []) as any[]).filter(m => m.tipo === t).map(m => m.data_movimentacao).sort();
  const saidas = datas('SAIDA'), devs = [...datas('DEVOLUCAO'), ...datas('EXTRAVIO')].sort();
  const campos: Record<string, unknown> = { data_saida: saidas[0] || null, data_devolucao: devs.length ? devs[devs.length - 1] : null };
  const nadaFora = saldos.every(s => s.fora <= 1e-9);
  const nadaPendente = saldos.every(s => s.pendenteSaida <= 1e-9);
  if (fl!.status === 'A' && saidas.length && nadaFora && nadaPendente) {
    campos.status = 'F'; campos.finalizada_em = new Date().toISOString(); campos.finalizada_por = usuario;
  }
  await db.from('locacao_fichas_locacao').update(campos).eq('id', fichaLocacaoId);
  await atualizarReserva(db, fl!.ficha_reserva_id, usuario);
}

async function historicoReserva(db: Db, reservaId: number, usuario: string, acao: string, detalhe: string, de?: string | null, para?: string | null) {
  await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: reservaId, usuario, acao, detalhe, status_de: de ?? null, status_para: para ?? null });
}

async function atualizarReserva(db: Db, reservaId: number, usuario: string) {
  const r = await carregarReserva(db, reservaId);
  const fls = await fichasLocacaoDaReserva(db, reservaId);
  const algumaSaida = fls.some(f => f.data_saida);
  if (r.status === 'RESERVADA' && algumaSaida) {
    await db.from('locacao_fichas_reserva').update({ status: 'EM_LOCACAO', updated_at: new Date().toISOString() }).eq('id', reservaId);
    await historicoReserva(db, reservaId, usuario, 'EM_LOCACAO', 'Primeira saída de equipamentos registrada', 'RESERVADA', 'EM_LOCACAO');
  } else if (r.status === 'EM_LOCACAO' && fls.length && fls.every(f => f.status === 'F')) {
    await db.from('locacao_alocacoes').update({ status: 'CANCELADO', updated_at: new Date().toISOString() }).eq('ficha_id', reservaId).eq('status', 'RESERVADO');
    await db.from('locacao_fichas_reserva').update({ status: 'FINALIZADA', updated_at: new Date().toISOString() }).eq('id', reservaId);
    await historicoReserva(db, reservaId, usuario, 'FINALIZADA', `Tudo devolvido — ${fls.map(f => f.numero).join(', ')}`, 'EM_LOCACAO', 'FINALIZADA');
  }
}

/**
 * Encerra a ficha de locação com itens que não vão mais sair (cliente levou
 * menos). Recusa se ainda houver equipamento com o cliente.
 */
export async function encerrarFichaLocacao(db: Db, fichaLocacaoId: number, usuario: string, motivo: string) {
  const fl = await cabecalhoAberto(db, fichaLocacaoId);
  const saldos = await saldosDaFicha(db, fichaLocacaoId);
  const fora = saldos.filter(s => s.fora > 1e-9);
  if (fora.length) throw new Error(`Ainda há equipamento com o cliente (${fora.map(s => `${s.fora}× ${s.descricao}`).slice(0, 3).join(', ')}). Registre a devolução ou o extravio.`);
  if (!motivo?.trim()) throw new Error('Informe o motivo do encerramento.');
  const itemIds = [...new Set(saldos.map(s => s.ficha_item_id).filter((x): x is number => !!x))];
  if (itemIds.length) {
    await db.from('locacao_alocacoes').update({ status: 'CANCELADO', updated_at: new Date().toISOString() })
      .eq('ficha_id', fl.ficha_reserva_id).eq('status', 'RESERVADO').in('ficha_item_id', itemIds);
  }
  await db.from('locacao_fichas_locacao').update({
    status: 'F', finalizada_em: new Date().toISOString(), finalizada_por: usuario,
    observacoes: [fl.observacoes, `Encerrada: ${motivo.trim()}`].filter(Boolean).join('\n'),
  }).eq('id', fichaLocacaoId);
  await historicoReserva(db, fl.ficha_reserva_id, usuario, 'ENCERROU_LOCACAO', `${fl.numero} encerrada: ${motivo.trim()}`);
  const r = await carregarReserva(db, fl.ficha_reserva_id);
  if (r.status === 'RESERVADA') {
    // nada saiu: a reserva continua; só finaliza se estiver em locação
    return;
  }
  await atualizarReserva(db, fl.ficha_reserva_id, usuario);
}

// ============================================================================
// PRORROGAÇÃO
// ============================================================================
export async function prorrogarLocacao(db: Db, reservaId: number, novoFim: string, motivo: string, usuario: string, fichaLocacaoId?: number | null):
  Promise<{ ok: true; dias: number; valorEstimado: number | null } | { ok: false; erro: string; faltas?: LinhaDisponibilidade[] }> {
  const r = await carregarReserva(db, reservaId);
  if (r.origem !== 'SISTEMA') return { ok: false, erro: 'Ficha do P2S — prorrogue no PrimeStart.' };
  if (!['RESERVADA', 'EM_LOCACAO'].includes(r.status)) return { ok: false, erro: 'Só dá para prorrogar ficha reservada ou em locação.' };
  if (!dataValida(novoFim) || novoFim <= r.data_fim) return { ok: false, erro: 'A nova data de término precisa ser depois da atual.' };
  if (!motivo?.trim()) return { ok: false, erro: 'Informe o motivo da prorrogação.' };
  const delta = diasInclusivos(r.data_fim, novoFim) - 1;
  const novasDatas: DatasFicha = {
    data_saida: r.data_saida, data_montagem: r.data_montagem, data_inicio: r.data_inicio, data_fim: novoFim,
    data_desmontagem: r.data_desmontagem ? somarDias(r.data_desmontagem, delta) : null,
    data_retorno: r.data_retorno ? somarDias(r.data_retorno, delta) : null,
  };
  const voltaAntiga = r.data_retorno || r.data_desmontagem || r.data_fim;
  const voltaNova = novasDatas.data_retorno || novasDatas.data_desmontagem || novoFim;

  // o que está alocado hoje (reservado + com o cliente) precisa caber nos dias a mais
  const { data: ativas, error } = await db.from('locacao_alocacoes').select('id, produto_id, patrimonio_id, quantidade, periodo, status')
    .eq('ficha_id', reservaId).in('status', ['RESERVADO', 'LOCADO']);
  if (error) throw error;
  const demanda = new Map<number, number>();
  for (const x of (ativas || []) as any[]) demanda.set(x.produto_id, (demanda.get(x.produto_id) || 0) + n(x.quantidade));
  if (demanda.size) {
    const verif = await verificarDisponibilidade(db, {
      empresaId: r.empresa_id, ignorarFichaId: reservaId,
      datas: { data_inicio: somarDias(voltaAntiga, 1), data_fim: voltaNova },
      itens: [...demanda].map(([produto_id, quantidade]) => ({ produto_id, quantidade })),
    });
    if (verif.temFalta) return { ok: false, erro: 'Falta equipamento para os dias a mais.', faltas: verif.linhas.filter(l => l.falta > 0) };
  }
  // peça a peça: nenhuma pode estar presa em outra ficha nos dias a mais
  const { data: prods } = await db.from('produtos').select('id, dias_preparo, dias_retorno').in('id', [...demanda.keys(), 0]);
  const info = new Map(((prods || []) as any[]).map(p => [p.id, p]));
  for (const x of ((ativas || []) as any[]).filter(a => a.patrimonio_id)) {
    const fimNovo = periodoAlocacao(novasDatas, n(info.get(x.produto_id)?.dias_preparo), n(info.get(x.produto_id)?.dias_retorno)).fim;
    const per = lerDaterange(x.periodo);
    if (!per || fimNovo <= per.fim) continue;
    const { data: c } = await db.from('locacao_alocacoes').select('ficha_id, patrimonio:locacao_patrimonios(numero_patrimonio)').eq('patrimonio_id', x.patrimonio_id).neq('ficha_id', reservaId)
      .in('status', ['RESERVADO', 'LOCADO']).overlaps('periodo', daterangeInclusivo(somarDias(per.fim, 1), fimNovo)).limit(1);
    if (c?.length) return { ok: false, erro: `A peça ${(c[0] as any).patrimonio?.numero_patrimonio || ''} está reservada para ${numeroFichaPorId(c[0].ficha_id)} nos dias a mais — faça uma troca de peça antes de prorrogar.` };
  }
  for (const x of (ativas || []) as any[]) {
    const fimNovo = periodoAlocacao(novasDatas, n(info.get(x.produto_id)?.dias_preparo), n(info.get(x.produto_id)?.dias_retorno)).fim;
    const per = lerDaterange(x.periodo);
    if (!per || fimNovo <= per.fim) continue;
    const { error: eU } = await db.from('locacao_alocacoes').update({ periodo: daterangeInclusivo(per.inicio, fimNovo), updated_at: new Date().toISOString() }).eq('id', x.id);
    if (eU) throw new Error(eU.message.includes('patrimonio_sem_conflito') ? 'Uma peça ficou reservada para outra ficha agora há pouco. Tente de novo.' : eU.message);
  }

  // valor estimado das diárias a mais (cobrança fica para o Faturamento)
  const valorEstimado = await estimarProrrogacao(db, r, delta);
  await db.from('locacao_fichas_reserva').update({
    data_fim: novoFim, data_desmontagem: novasDatas.data_desmontagem, data_retorno: novasDatas.data_retorno, updated_at: new Date().toISOString(),
  }).eq('id', reservaId);
  await db.from('locacao_prorrogacoes').insert({
    ficha_reserva_id: reservaId, ficha_locacao_id: fichaLocacaoId ?? null, fim_anterior: r.data_fim, fim_novo: novoFim,
    dias_adicionais: delta, valor_estimado: valorEstimado, motivo: motivo.trim(), registrado_por: usuario,
  });
  await historicoReserva(db, reservaId, usuario, 'PRORROGOU', `Término ${r.data_fim.split('-').reverse().join('/')} → ${novoFim.split('-').reverse().join('/')} (+${delta} dia(s))${valorEstimado != null ? ` · estimado R$ ${valorEstimado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}: ${motivo.trim()}`);
  return { ok: true, dias: delta, valorEstimado };
}

/** Diferença de tabela entre (dias cobrados + delta) e dias cobrados; sem tabela, proporcional. */
async function estimarProrrogacao(db: Db, r: any, delta: number): Promise<number | null> {
  const { data: itens } = await db.from('locacao_fichas_reserva_itens').select('id, tipo, produto_id, quantidade, dias, valor_total').eq('ficha_id', r.id).in('tipo', ['EQUIPAMENTO', 'KIT']);
  const lista = ((itens || []) as any[]).filter(i => i.produto_id);
  if (!lista.length) return null;
  const diasBase = n(r.dias_cobrados) || diasInclusivos(r.data_inicio, r.data_fim);
  if (r.modalidade === 'PERIODO') return arred(lista.reduce((s, i) => s + n(i.valor_total) / Math.max(1, diasBase) * delta, 0));
  try {
    const args = (dias: number) => ({ empresaId: r.empresa_id, parceiroId: r.parceiro_id, eventoId: r.evento_id, dataRef: r.data_inicio, modalidade: r.modalidade as Modalidade, itens: lista.map(i => ({ chave: String(i.id), produto_id: i.produto_id, dias })) });
    const [antes, depois] = await Promise.all([precificarItens(db, args(diasBase)), precificarItens(db, args(diasBase + delta))]);
    let total = 0;
    for (const i of lista) {
      const a = antes.precos[String(i.id)]?.valor_unitario, d = depois.precos[String(i.id)]?.valor_unitario;
      total += a != null && d != null ? (d - a) * n(i.quantidade) : n(i.valor_total) / Math.max(1, diasBase) * delta;
    }
    return arred(total);
  } catch {
    return arred(lista.reduce((s, i) => s + n(i.valor_total) / Math.max(1, diasBase) * delta, 0));
  }
}

// ============================================================================
// COMPLEMENTO (/B, /C…): cliente pede mais equipamento durante o evento
// ============================================================================
export async function complementarLocacao(db: Db, reservaId: number, itens: { produto_id: number; quantidade: number; valor_unitario?: number | null }[], usuario: string):
  Promise<{ ok: true; fichaLocacaoId: number | null; numero: string | null; valor: number } | { ok: false; erro: string; faltas?: LinhaDisponibilidade[] }> {
  const r = await carregarReserva(db, reservaId);
  if (r.origem !== 'SISTEMA') return { ok: false, erro: 'Ficha do P2S — o complemento é feito no PrimeStart.' };
  if (!['RESERVADA', 'EM_LOCACAO'].includes(r.status)) return { ok: false, erro: 'Complemento só em ficha reservada ou em locação.' };
  const validos = itens.filter(i => i.produto_id && n(i.quantidade) > 0);
  if (!validos.length) return { ok: false, erro: 'Inclua ao menos um equipamento com quantidade.' };
  const { data: prods } = await db.from('produtos').select('id, nome_item, controle_locacao').in('id', validos.map(i => i.produto_id));
  const prod = new Map(((prods || []) as any[]).map(p => [p.id, p]));
  for (const i of validos) {
    const p = prod.get(i.produto_id);
    if (!p) return { ok: false, erro: 'Produto não encontrado.' };
    if (p.controle_locacao === 'INDIVIDUAL' && !Number.isInteger(n(i.quantidade))) return { ok: false, erro: `"${p.nome_item}" é controlado por patrimônio — quantidade inteira.` };
  }
  const diasCob = n(r.dias_cobrados) || diasInclusivos(r.data_inicio, r.data_fim);
  const precos = await precificarItens(db, {
    empresaId: r.empresa_id, parceiroId: r.parceiro_id, eventoId: r.evento_id, dataRef: r.data_inicio, modalidade: r.modalidade as Modalidade,
    itens: validos.map((i, k) => ({ chave: String(k), produto_id: i.produto_id, dias: diasCob })),
  });
  const { data: ult } = await db.from('locacao_fichas_reserva_itens').select('ordem').eq('ficha_id', reservaId).order('ordem', { ascending: false }).limit(1);
  let ordem = n(ult?.[0]?.ordem) + 1;
  // Sem ficha de locação, ou com a /A ainda sem nenhuma saída, o item só entra
  // na OS (a /A pega sozinha). Já tendo saído algo, vira um complemento /B, /C…
  const existentes = await fichasLocacaoDaReserva(db, reservaId);
  const aSemSaida = existentes.length === 1 && existentes[0].letra === 'A' && !existentes[0].data_saida;
  const novaLetra = existentes.length > 0 && !aSemSaida;
  const letra = novaLetra ? (LETRAS[existentes.length] || '?') : 'A';
  const linhas = validos.map((i, k) => {
    const sug = precos.precos[String(k)];
    const vu = i.valor_unitario != null ? arred(n(i.valor_unitario)) : arred(n(sug?.valor_unitario));
    const q = arred3(n(i.quantidade));
    return {
      ficha_id: reservaId, ordem: ordem++, tipo: 'EQUIPAMENTO', produto_id: i.produto_id, descricao: prod.get(i.produto_id)!.nome_item,
      quantidade: q, dias: diasCob, valor_unitario: vu, desconto_valor: 0, valor_total: arred(q * vu),
      origem_preco: i.valor_unitario != null ? null : (sug?.origem ?? null), preco_manual: i.valor_unitario != null, alterado_por: i.valor_unitario != null ? usuario : null,
      observacoes: novaLetra ? `Complemento /${letra}` : 'Incluído depois da reserva',
    };
  });
  const { data: novos, error } = await db.from('locacao_fichas_reserva_itens').insert(linhas).select('id, valor_total');
  if (error) throw error;
  const novosIds = ((novos || []) as any[]).map(x => x.id);
  const res = await reservarItensAdicionais(db, reservaId, novosIds);
  if (!res.ok) {
    await db.from('locacao_fichas_reserva_itens').delete().in('id', novosIds);
    return { ok: false, erro: res.erro || 'Falta equipamento para o complemento.', faltas: res.faltas };
  }
  const soma = arred(((novos || []) as any[]).reduce((s, x) => s + n(x.valor_total), 0));
  await db.from('locacao_fichas_reserva').update({
    valor_equipamentos: arred(n(r.valor_equipamentos) + soma), valor_total: arred(n(r.valor_total) + soma), updated_at: new Date().toISOString(),
  }).eq('id', reservaId);
  let fl: { id: number; numero: string } | null = null;
  if (novaLetra) fl = await abrirFichaLocacao(db, reservaId, usuario, novosIds);
  else if (aSemSaida) await sincronizarPrevistosSemMovimento(db, existentes[0].id);
  await historicoReserva(db, reservaId, usuario, 'COMPLEMENTO', `${fl ? fl.numero : 'incluído na OS'}: ${linhas.map(l => `${l.quantidade}× ${l.descricao}`).join(', ')} · R$ ${soma.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  return { ok: true, fichaLocacaoId: fl?.id ?? existentes[0]?.id ?? null, numero: fl?.numero ?? null, valor: soma };
}

// ============================================================================
// ATRASOS (cron): o que não voltou no prazo continua ocupando a agenda
// ============================================================================
export async function estenderAtrasos(db: Db): Promise<{ estendidas: number; conflitos: string[] }> {
  const hoje = hojeISO();
  const { data: reservas } = await db.from('locacao_fichas_reserva').select('id').eq('origem', 'SISTEMA').eq('status', 'EM_LOCACAO');
  const ids = ((reservas || []) as any[]).map(r => r.id);
  if (!ids.length) return { estendidas: 0, conflitos: [] };
  const { data: alocs } = await db.from('locacao_alocacoes').select('id, ficha_id, produto_id, periodo, patrimonio:locacao_patrimonios(numero_patrimonio), produto:produtos(nome_item, dias_retorno)')
    .in('ficha_id', ids).eq('status', 'LOCADO');
  let estendidas = 0;
  const conflitos: string[] = [];
  for (const a of (alocs || []) as any[]) {
    const per = lerDaterange(a.periodo);
    const alvo = somarDias(hoje, n(a.produto?.dias_retorno));
    if (!per || per.fim >= alvo) continue;
    const { error } = await db.from('locacao_alocacoes').update({ periodo: daterangeInclusivo(per.inicio, alvo), updated_at: new Date().toISOString() }).eq('id', a.id);
    if (error) conflitos.push(`${numeroFichaPorId(a.ficha_id)}: ${a.patrimonio?.numero_patrimonio || a.produto?.nome_item || 'peça'} atrasada e já reservada para outra ficha`);
    else estendidas++;
  }
  return { estendidas, conflitos };
}
