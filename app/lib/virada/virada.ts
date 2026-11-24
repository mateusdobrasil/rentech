// app/lib/virada/virada.ts
// Virada da chave — empresa por empresa (2026-11-21). Decisões do usuário:
//   • OS em andamento no P2S MIGRAM para o sistema (viram origem SISTEMA com o nº
//     do P2S; as fichas de locação, as saídas e devoluções e a agenda passam a ser
//     do sistema; o que o P2S já faturou fica em valor_faturado_p2s);
//   • contas a receber e a pagar em aberto MIGRAM como títulos (origem MIGRADO),
//     só as que vencem a partir de uma data de corte escolhida na tela;
//   • a escrita no P2S desliga ao CONGELAR (ver app/lib/virada/estado.ts).
// Tudo é idempotente: rodar de novo pula o que já migrou. Sempre há uma prévia
// (simular = true) antes de gravar. SEM checagem de acesso (as actions validam).
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { hojeISO, somarDias, periodoAlocacao, daterangeInclusivo } from '../locacao/datas';
import { numeroFicha } from '../locacao/fichaNumero';
import { focus } from '../fiscal/focus';
import { sincronizarParceirosPorOidsCore } from '../../admin/comercial/parceiros/parceirosCore';
import type { EtapaVirada } from './estado';
import { previaEnsaio } from './ensaio';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number, c = 2) => Math.round(v * 10 ** c) / 10 ** c;
const limpo = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const RE_FICHA_LOC = /Ficha\s+Loc\.?\s*(\d+\s*\/\s*[A-Z]+)/gi;
const fichasNaDescricao = (d: string) => [...String(d || '').matchAll(RE_FICHA_LOC)].map(m => m[1].replace(/\s/g, ''));
const parcelaDe = (s: unknown) => { const m = [...String(s || '').matchAll(/(\d+)\s*\/\s*(\d+)/g)].at(-1); return m ? { parcela: Number(m[1]) || 1, total: Number(m[2]) || 1 } : { parcela: 1, total: 1 }; };
const OS_ABERTAS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO'];

async function emLotes<T>(ids: (number | string)[], tam: number, fn: (lote: any[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += tam) out.push(...(await fn(ids.slice(i, i + tam))));
  return out;
}
/** Lotes de ids + todas as páginas de cada lote (um lote de 200 fichas passa fácil de 1.000 movimentos). */
async function emLotesPag<T>(ids: (number | string)[], tam: number, montar: (lote: any[]) => any): Promise<T[]> {
  return emLotes<T>(ids, tam, async lote => {
    const { data, error } = await buscarTodasPaginas<T>((d, a) => montar(lote).order('id').range(d, a), 1000, 500000);
    if (error) throw error;
    return data;
  });
}

// ============================================================================
// ESTADO / LOG
// ============================================================================
export async function estadoVirada(db: Db, empresaId: number) {
  const { data, error } = await db.from('parametros_virada').select('*').eq('empresa_id', empresaId).maybeSingle();
  if (error) throw new Error('Rode o SQL virada_chave.sql (tabela parametros_virada).');
  if (data) return data as any;
  const { data: novo, error: e2 } = await db.from('parametros_virada').insert({ empresa_id: empresaId }).select('*').single();
  if (e2) throw e2;
  return novo as any;
}

async function registrar(db: Db, empresaId: number, por: string, acao: string, detalhe: string, extra: Record<string, unknown> = {}) {
  const atual = await estadoVirada(db, empresaId);
  const log = [...((atual.log || []) as any[]), { em: new Date().toISOString(), por, acao, detalhe }].slice(-300);
  const { error } = await db.from('parametros_virada').update({ log, atualizado_em: new Date().toISOString(), ...extra }).eq('empresa_id', empresaId);
  if (error) throw error;
}

export async function salvarConfirmacoes(db: Db, empresaId: number, confirmacoes: Record<string, boolean>, contasDesde: string | null, por: string) {
  await registrar(db, empresaId, por, 'CONFERÊNCIA', `${Object.values(confirmacoes).filter(Boolean).length} item(ns) marcados`, { confirmacoes, contas_desde: contasDesde || null });
}

// ============================================================================
// CHECKLIST (o que precisa estar pronto)
// ============================================================================
export const CONFIRMACOES_MANUAIS: { chave: string; titulo: string; dica: string }[] = [
  { chave: 'equipe_avisada', titulo: 'Equipe avisada: nada novo é lançado no P2S a partir da virada', dica: 'OS, contas, baixas — tudo passa a ser feito aqui.' },
  { chave: 'saldos_bancos', titulo: 'Saldo de cada conta conferido no dia do corte', dica: 'Financeiro › Caixa e Bancos: saldo inicial e data do saldo de cada conta.' },
  { chave: 'focus_numeracao', titulo: 'Numeração de produção da NF-e e do RPS ajustada no painel da Focus', dica: 'Série/próximo número depois do último emitido pelo P2S.' },
  { chave: 'focus_vercel', titulo: 'Tokens da Focus atualizados também na Vercel', dica: 'Os do .env.local foram trocados em 21/11.' },
  { chave: 'testes', titulo: 'Roteiro de testes executado com a equipe', dica: 'OS → saída → devolução → Nota de Débito → recebimento.' },
  { chave: 'backup_p2s', titulo: 'Exportação/backup do P2S guardado', dica: 'Para consulta futura, fora do sistema.' },
];

// ============================================================================
// INVENTÁRIO DA VIRADA (2026-11-23)
// O inventário desconta o que está EM LOCAÇÃO no sistema (alocações LOCADO) e
// conclui com saldo = contado + em locação. As fichas do P2S só viram LOCADO na
// migração das OS (Passo 3) — então o inventário que vale para a virada é um
// COMPLETO (todos os locais e categorias) ABERTO depois da migração. Concluído
// antes disso, o que estava com cliente sumiria do saldo.
// ============================================================================
export async function inventarioDaVirada(db: Db, empresaId: number) {
  const est = await estadoVirada(db, empresaId);
  const desde: string | null = est.resultado_os?.em || null;
  const { data, error } = await db.from('estoque_inventarios').select('id, nome, status, local, categorias, criado_em, concluido_em, concluido_por')
    .eq('empresa_id', empresaId).in('status', ['ABERTO', 'CONCLUIDO']).order('criado_em', { ascending: false }).limit(30);
  if (error) throw error;
  const lista = (data || []) as { id: number; nome: string; status: string; local: string | null; categorias: string[] | null; criado_em: string; concluido_em: string | null; concluido_por: string | null }[];
  const completo = (i: (typeof lista)[number]) => !i.local && !(i.categorias || []).length;
  const depois = (i: (typeof lista)[number]) => !!desde && i.criado_em >= desde;
  return {
    desde,
    valido: lista.find(i => i.status === 'CONCLUIDO' && completo(i) && depois(i)) || null,
    aberto: lista.find(i => i.status === 'ABERTO') || null,
    abertoAntesDaMigracao: lista.some(i => i.status === 'ABERTO' && completo(i) && !depois(i)),
  };
}

export async function checklistVirada(db: Db, empresaId: number) {
  const hoje = hojeISO();
  // Ensaio da fase paralela (ensaio.ts): só faz sentido antes de congelar — depois, o que nasce no sistema já é real.
  const etapa = (await estadoVirada(db, empresaId)).etapa;
  const ensaio = etapa === 'PREPARACAO' ? await previaEnsaio(db, empresaId).catch(() => null) : null;
  const pendEnsaio = ensaio ? ensaio.filter(c => c.chave !== 'caixa').reduce((s, c) => s + c.qtd, 0) : 0;
  const [inv, contas, fiscal, regras, prods, ultimaFicha] = await Promise.all([
    inventarioDaVirada(db, empresaId),
    db.from('financeiro_contas').select('id, nome, saldo_inicial, data_saldo_inicial').eq('empresa_id', empresaId).eq('ativa', true),
    db.from('fiscal_parametros').select('ativo, ambiente, nfse_item_lista_servico, nfse_aliquota').eq('empresa_id', empresaId).maybeSingle(),
    db.from('comercial_comissao_vendedores').select('vendedor_id, pct_locacao, ativo'),
    db.from('produtos').select('id, valor_indenizacao, custo_reposicao').eq('habilitado_para_locacao', true).eq('flag_em_desuso', false),
    db.from('locacao_fichas_reserva').select('p2s_sincronizado_em').eq('empresa_id', empresaId).eq('origem', 'P2S').not('p2s_sincronizado_em', 'is', null).order('p2s_sincronizado_em', { ascending: false }).limit(1),
  ]);
  let tokenOk: boolean | null = null;
  if (fiscal.data?.ativo) {
    try { const r = await focus('PRODUCAO', 'GET', '/v2/nfe/teste-virada-inexistente', undefined, empresaId); tokenOk = r.http === 404; } catch { tokenOk = false; }
  }
  const semValor = ((prods.data || []) as any[]).filter(p => !(n(p.valor_indenizacao) > 0) && !(n(p.custo_reposicao) > 0)).length;
  const regrasAtivas = ((regras.data || []) as any[]).filter(r => r.ativo && n(r.pct_locacao) > 0).length;
  const ultimaLeitura = ((ultimaFicha.data || []) as any[])[0]?.p2s_sincronizado_em || null;
  const itens = [
    { chave: 'inventario', titulo: 'Inventário da virada combinado (data, equipe, etiquetas)', ok: etapa === 'PREPARACAO' ? null : !!inv.valido, detalhe: etapa === 'PREPARACAO' ? 'é feito no dia, DEPOIS de migrar as OS (Passo 4) — veja o roteiro em Manuais' : inv.valido ? `concluído em ${String(inv.valido.concluido_em || '').slice(0, 10).split('-').reverse().join('/')}` : 'pendente (Passo 4)', link: '/admin/manuais/inventario-virada' },
    { chave: 'contas', titulo: 'Contas de Caixa e Bancos criadas', ok: ((contas.data || []) as any[]).length > 0, detalhe: `${((contas.data || []) as any[]).length} conta(s) ativa(s)`, link: '/admin/financeiro/caixa' },
    { chave: 'leitura', titulo: 'Última leitura do P2S recente', ok: !!ultimaLeitura && ultimaLeitura.slice(0, 10) >= somarDias(hoje, -1), detalhe: ultimaLeitura ? `fichas lidas em ${new Date(ultimaLeitura).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'nunca', link: null },
    { chave: 'comissao', titulo: 'Regras de comissão preenchidas', ok: regrasAtivas > 0, detalhe: `${regrasAtivas} vendedor(es) com % de locação`, link: '/admin/comercial/comissoes' },
    { chave: 'ensaio', titulo: 'Ensaio da fase paralela limpo', ok: etapa !== 'PREPARACAO' || (!!ensaio && pendEnsaio === 0), detalhe: etapa !== 'PREPARACAO' ? 'feito antes do congelamento' : !ensaio ? 'não consegui contar' : pendEnsaio ? `${pendEnsaio} item(ns) de teste ainda ativos — use Limpar o ensaio, abaixo` : 'nenhum item de teste ativo', link: null },
    { chave: 'valor_bem', titulo: 'Valor do bem nos equipamentos (remessa, retorno, reposição)', ok: semValor === 0, detalhe: `${semValor} equipamento(s) de locação sem valor de indenização nem custo de reposição`, link: '/admin/estoque/equipamentos' },
    ...(fiscal.data?.ativo ? [
      { chave: 'fiscal', titulo: 'Fiscal: código de serviço e alíquota do ISS', ok: !!fiscal.data.nfse_item_lista_servico && fiscal.data.nfse_aliquota !== null, detalhe: fiscal.data.nfse_item_lista_servico ? `serviço ${fiscal.data.nfse_item_lista_servico} · ISS ${fiscal.data.nfse_aliquota ?? '—'}%` : 'faltam (Fiscal › Parâmetros)', link: '/admin/financeiro/fiscal' },
      { chave: 'focus_token', titulo: 'Token de produção da Focus válido', ok: tokenOk, detalhe: tokenOk ? 'respondeu' : 'não respondeu como esperado', link: null },
    ] : []),
  ];
  return { itens, manuais: CONFIRMACOES_MANUAIS };
}

// ============================================================================
// OS EM ANDAMENTO
// ============================================================================
async function osDaVirada(db: Db, empresaId: number, finalizadasDesde: string) {
  const { data: abertas } = await buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_reserva')
    .select('id, p2s_numero, origem, status, data_saida, data_montagem, data_inicio, data_fim, data_desmontagem, data_retorno, valor_total, parceiro:parceiros(nome_exibicao, nome_completo)')
    .eq('empresa_id', empresaId).eq('origem', 'P2S').in('status', OS_ABERTAS).order('id').range(d, a), 1000, 20000);
  // finalizadas no P2S mas ainda não faturadas (ficha de locação "Não faturado", devolvida nos últimos 180 dias)
  const { data: flN } = await buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_locacao').select('ficha_reserva_id')
    .eq('empresa_id', empresaId).eq('origem', 'P2S').eq('status_ultimo_faturamento', 'N').not('data_devolucao', 'is', null).gte('data_devolucao', finalizadasDesde)
    .not('ficha_reserva_id', 'is', null).order('id').range(d, a), 1000, 20000);
  const idsAbertas = new Set(((abertas || []) as any[]).map(x => x.id));
  const outrasIds = [...new Set(((flN || []) as any[]).map(x => x.ficha_reserva_id).filter((id: number) => !idsAbertas.has(id)))];
  const outras = await emLotes<any>(outrasIds, 300, async lote => ((await db.from('locacao_fichas_reserva')
    .select('id, p2s_numero, origem, status, data_saida, data_montagem, data_inicio, data_fim, data_desmontagem, data_retorno, valor_total, parceiro:parceiros(nome_exibicao, nome_completo)')
    .in('id', lote).eq('origem', 'P2S').neq('status', 'CANCELADA')).data || []) as any[]);
  return [...((abertas || []) as any[]), ...outras];
}

/** Padrão da janela das finalizadas "Não faturado": o P2S deixa ~20% das fichas devolvidas assim todo mês, e as antigas não vão mais ser faturadas. */
export const finalizadasDesdePadrao = () => somarDias(hojeISO(), -60);

export async function migrarOs(db: Db, empresaId: number, finalizadasDesde: string, usuario: string, simular: boolean) {
  const est = await estadoVirada(db, empresaId);
  if (!simular && est.etapa !== 'CONGELADA') throw new Error('Congele o P2S da empresa antes de migrar.');
  const hoje = hojeISO();
  const todas = await osDaVirada(db, empresaId, finalizadasDesde);
  let oss = todas;
  const ids = oss.map(o => o.id);
  const [itens, fls] = await Promise.all([
    emLotesPag<any>(ids, 200, lote => db.from('locacao_fichas_reserva_itens').select('id, ficha_id, produto_id, quantidade, ordem, descricao').in('ficha_id', lote).in('tipo', ['EQUIPAMENTO', 'KIT']).not('produto_id', 'is', null)),
    emLotesPag<any>(ids, 200, lote => db.from('locacao_fichas_locacao').select('id, numero, ficha_reserva_id, data_saida, data_devolucao, origem').in('ficha_reserva_id', lote).eq('origem', 'P2S')),
  ]);
  const movs = await emLotesPag<any>(fls.map(f => f.id), 200, lote => db.from('locacao_fichas_locacao_movimentos').select('id, ficha_locacao_id, tipo, produto_id, quantidade, troca, data_movimentacao').in('ficha_locacao_id', lote).not('produto_id', 'is', null));
  // itens em ordem da OS e fichas em ordem de letra (a paginação ordena por id)
  itens.sort((a, b) => n(a.ordem) - n(b.ordem) || a.id - b.id);
  fls.sort((a, b) => String(a.numero).localeCompare(String(b.numero)));
  const prodIds = [...new Set([...itens.map(i => i.produto_id), ...movs.map(m => m.produto_id)])];
  const prods = new Map<number, any>((await emLotes<any>(prodIds, 300, async lote => ((await db.from('produtos').select('id, nome_item, dias_preparo, dias_retorno').in('id', lote)).data || []) as any[])).map(p => [p.id, p]));
  // o que o P2S já faturou de cada OS (Notas de Débito que citam as fichas de locação dela)
  const osDaFl = new Map(fls.map(f => [f.numero, f.ficha_reserva_id]));
  const desde = fls.map(f => f.data_saida).filter(Boolean).sort()[0] || somarDias(hoje, -365);
  const { data: nds } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_contas_receber').select('descricao, valor_final')
    .eq('empresa_id', empresaId).ilike('documento', 'Nota de D%').gte('data_emissao', somarDias(desde, -15)).order('id').range(d, a), 1000, 100000);
  const faturadoP2s = new Map<number, number>();
  for (const r of (nds || []) as any[]) {
    const osIds = [...new Set(fichasNaDescricao(r.descricao).map(x => osDaFl.get(x)).filter(Boolean))] as number[];
    for (const os of osIds) faturadoP2s.set(os, (faturadoP2s.get(os) || 0) + n(r.valor_final) / osIds.length);
  }

  // finalizada sem valor (uso interno, cortesia) ou que o P2S já faturou por inteiro: nada a faturar aqui — fica no P2S
  const foraFinalizadas = oss.filter(o => o.status === 'FINALIZADA' && (n(o.valor_total) <= 0.009 || n(faturadoP2s.get(o.id)) >= n(o.valor_total) - 0.009));
  if (foraFinalizadas.length) { const fora = new Set(foraFinalizadas.map(o => o.id)); oss = oss.filter(o => !fora.has(o.id)); }

  const plano: any[] = [];
  let feitas = 0;
  const erros: string[] = [];
  for (const os of oss) {
    const itensOs = itens.filter(i => i.ficha_id === os.id);
    const flsOs = fls.filter(f => f.ficha_reserva_id === os.id);
    const movsOs = movs.filter(m => flsOs.some(f => f.id === m.ficha_locacao_id));
    const previsto = new Map<number, number>();
    for (const i of itensOs) previsto.set(i.produto_id, arred(n(previsto.get(i.produto_id)) + n(i.quantidade), 3));
    const soma = (f: (m: any) => boolean) => { const m = new Map<number, number>(); for (const x of movsOs.filter(f)) m.set(x.produto_id, arred(n(m.get(x.produto_id)) + n(x.quantidade), 3)); return m; };
    const saiuNT = soma(m => m.tipo === 'SAIDA' && !m.troca);
    const fora = new Map<number, number>();
    for (const x of movsOs) fora.set(x.produto_id, arred(n(fora.get(x.produto_id)) + (x.tipo === 'SAIDA' ? 1 : -1) * n(x.quantidade), 3));
    const finalizada = os.status === 'FINALIZADA';
    const pendente = new Map<number, number>();
    if (!finalizada) for (const [p, q] of previsto) { const r = arred(q - n(saiuNT.get(p)), 3); if (r > 0) pendente.set(p, r); }
    const alvo = [...flsOs].reverse().find(f => !f.data_devolucao) || flsOs.at(-1) || null;
    const unidadesFora = [...fora.values()].reduce((a, v) => a + Math.max(0, v), 0);
    const unidadesPend = [...pendente.values()].reduce((a, v) => a + v, 0);
    plano.push({
      os: numeroFicha(os), id: os.id, cliente: limpo(os.parceiro?.nome_exibicao || os.parceiro?.nome_completo) || '—', status: os.status,
      fichasLocacao: flsOs.map(f => f.numero).join(', ') || '—', unidadesNaRua: arred(unidadesFora, 3), unidadesASair: arred(unidadesPend, 3),
      valorOs: arred(n(os.valor_total)), faturadoP2s: arred(faturadoP2s.get(os.id) || 0),
      alerta: os.status === 'EM_LOCACAO' && !flsOs.length ? 'em locação no P2S, mas a ficha de locação não foi lida — rode a leitura das fichas de locação'
        : finalizada && unidadesFora > 0.0001 ? 'finalizada no P2S com unidades sem retorno lançado — não ocupa a agenda; confira o retorno'
        : null,
    });
    if (simular) continue;

    try {
      const primeiroItem = new Map<number, number>();
      for (const i of itensOs) if (!primeiroItem.has(i.produto_id)) primeiroItem.set(i.produto_id, i.id);
      // 1) itens previstos de cada ficha de locação + vínculo dos movimentos
      for (const fl of flsOs) {
        await db.from('locacao_fichas_locacao_itens').delete().eq('ficha_locacao_id', fl.id);
        const movsFl = movsOs.filter(m => m.ficha_locacao_id === fl.id);
        const saidaFl = new Map<number, number>();
        for (const m of movsFl.filter(x => x.tipo === 'SAIDA' && !x.troca)) saidaFl.set(m.produto_id, arred(n(saidaFl.get(m.produto_id)) + n(m.quantidade), 3));
        const prodsFl = new Set<number>([...movsFl.map(m => m.produto_id), ...(alvo?.id === fl.id ? [...pendente.keys()] : [])]);
        const linhas = [...prodsFl].map((p, k) => ({
          ficha_locacao_id: fl.id, ficha_item_id: primeiroItem.get(p) || null, produto_id: p, kit_produto_id: null,
          descricao: limpo(prods.get(p)?.nome_item) || `Produto #${p}`,
          quantidade: arred(n(saidaFl.get(p)) + (alvo?.id === fl.id ? n(pendente.get(p)) : 0), 3), extra: !previsto.has(p), ordem: k,
        }));
        const porProd = new Map<number, number>();
        if (linhas.length) {
          const { data: ins, error } = await db.from('locacao_fichas_locacao_itens').insert(linhas).select('id, produto_id');
          if (error) throw error;
          for (const x of (ins || []) as any[]) porProd.set(x.produto_id, x.id);
        }
        for (const [p, itemId] of porProd) {
          const { error } = await db.from('locacao_fichas_locacao_movimentos').update({ ficha_locacao_item_id: itemId }).eq('ficha_locacao_id', fl.id).eq('produto_id', p);
          if (error) throw error;
        }
        const foraFl = new Map<number, number>();
        for (const m of movsFl) foraFl.set(m.produto_id, n(foraFl.get(m.produto_id)) + (m.tipo === 'SAIDA' ? 1 : -1) * n(m.quantidade));
        const aberta = [...foraFl.values()].some(v => v > 0.0001) || (alvo?.id === fl.id && pendente.size > 0);
        const { error: eF } = await db.from('locacao_fichas_locacao').update({
          origem: 'SISTEMA', letra: (fl.numero.split('/')[1] || 'A').toUpperCase(), status: aberta ? 'A' : 'F',
          finalizada_em: aberta ? null : (fl.data_devolucao ? `${fl.data_devolucao}T12:00:00Z` : new Date().toISOString()), finalizada_por: aberta ? null : 'Virada da chave',
          migrada_p2s_em: new Date().toISOString(), criado_por: 'Virada da chave (P2S)',
        }).eq('id', fl.id);
        if (eF) throw eF;
      }
      // 2) agenda refeita: o que está na rua = LOCADO, o que falta sair = RESERVADO (finalizada não ocupa nada)
      await db.from('locacao_alocacoes').delete().eq('ficha_id', os.id);
      const aloc: any[] = [];
      if (!finalizada) for (const [p, qPrev] of previsto) {
        const pr = prods.get(p);
        const per = periodoAlocacao(os, n(pr?.dias_preparo), n(pr?.dias_retorno));
        const fimLocado = per.fim < hoje ? hoje : per.fim;
        let rua = Math.max(0, n(fora.get(p))), falta = n(pendente.get(p));
        const itensP = itensOs.filter(i => i.produto_id === p);
        for (const it of itensP) {
          let cap = n(it.quantidade);
          const qL = Math.min(cap, rua); if (qL > 0) { aloc.push({ ficha_id: os.id, ficha_item_id: it.id, empresa_id: empresaId, produto_id: p, quantidade: arred(qL, 3), periodo: daterangeInclusivo(per.inicio, fimLocado), status: 'LOCADO' }); rua -= qL; cap -= qL; }
          const qR = Math.min(cap, falta); if (qR > 0) { aloc.push({ ficha_id: os.id, ficha_item_id: it.id, empresa_id: empresaId, produto_id: p, quantidade: arred(qR, 3), periodo: daterangeInclusivo(per.inicio, per.fim), status: 'RESERVADO' }); falta -= qR; }
        }
        if (rua > 0.0001) aloc.push({ ficha_id: os.id, ficha_item_id: itensP[0]?.id || null, empresa_id: empresaId, produto_id: p, quantidade: arred(rua, 3), periodo: daterangeInclusivo(per.inicio, fimLocado), status: 'LOCADO' });
        void qPrev;
      }
      // saiu sem estar previsto na OS (extra) e ainda está na rua
      if (!finalizada) for (const [p, q] of fora) if (!previsto.has(p) && q > 0.0001) {
        const pr = prods.get(p);
        const per = periodoAlocacao(os, n(pr?.dias_preparo), n(pr?.dias_retorno));
        aloc.push({ ficha_id: os.id, ficha_item_id: null, empresa_id: empresaId, produto_id: p, quantidade: arred(q, 3), periodo: daterangeInclusivo(per.inicio, per.fim < hoje ? hoje : per.fim), status: 'LOCADO' });
      }
      if (aloc.length) { const { error } = await db.from('locacao_alocacoes').insert(aloc); if (error) throw error; }
      // 3) a OS vira do sistema (por último: se algo falhar antes, ela segue na lista para migrar de novo)
      const { error: eR } = await db.from('locacao_fichas_reserva').update({
        origem: 'SISTEMA', migrada_p2s_em: new Date().toISOString(), valor_faturado_p2s: arred(faturadoP2s.get(os.id) || 0), updated_at: new Date().toISOString(),
      }).eq('id', os.id).eq('origem', 'P2S');
      if (eR) throw eR;
      await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: os.id, usuario, acao: 'MIGRADA_DO_P2S', detalhe: `Virada da chave: ${flsOs.length} ficha(s) de locação, ${arred(unidadesFora, 3)} un. na rua, ${arred(unidadesPend, 3)} a sair, R$ ${arred(faturadoP2s.get(os.id) || 0).toFixed(2)} já faturado no P2S` });
      feitas++;
    } catch (e: any) {
      erros.push(`${numeroFicha(os)}: ${e.message || e}`);
    }
  }
  const resumo = { os: oss.length, migradas: feitas, finalizadasDesde, finalizadasSemSaldo: foraFinalizadas.length, comAlerta: plano.filter(p => p.alerta).length, naRua: arred(plano.reduce((a, p) => a + p.unidadesNaRua, 0), 3), aSair: arred(plano.reduce((a, p) => a + p.unidadesASair, 0), 3), faturadoP2s: arred(plano.reduce((a, p) => a + p.faturadoP2s, 0)), erros };
  if (!simular) await registrar(db, empresaId, usuario, 'MIGROU OS', `${feitas} de ${oss.length} OS${erros.length ? ` · ${erros.length} erro(s)` : ''}`, { resultado_os: { ...resumo, em: new Date().toISOString() } });
  return { resumo, plano };
}

// ============================================================================
// CONTAS A RECEBER / A PAGAR EM ABERTO
// ============================================================================
async function abertasDoEspelho(db: Db, tabela: 'financeiro_contas_receber' | 'financeiro_contas_pagar', empresaId: number, colunas: string) {
  const { data, error } = await buscarTodasPaginas<any>((d, a) => db.from(tabela).select(colunas)
    .eq('empresa_id', empresaId).eq('quitado', false).is('migrado_titulo_id', null).order('id').range(d, a), 1000, 100000);
  if (error) throw error;
  return (data || []) as any[];
}
const porAno = (linhas: { venc: string | null; saldo: number; migra: boolean }[]) => {
  const m = new Map<string, { ano: string; titulos: number; valor: number; migra: number; valorMigra: number }>();
  for (const l of linhas) {
    const k = l.venc ? l.venc.slice(0, 4) : 'sem vencimento';
    const g = m.get(k) || { ano: k, titulos: 0, valor: 0, migra: 0, valorMigra: 0 };
    g.titulos++; g.valor += l.saldo; if (l.migra) { g.migra++; g.valorMigra += l.saldo; }
    m.set(k, g);
  }
  return [...m.values()].map(g => ({ ...g, valor: arred(g.valor), valorMigra: arred(g.valorMigra) })).sort((a, b) => a.ano.localeCompare(b.ano));
};

export async function migrarContasReceber(db: Db, empresaId: number, desde: string, usuario: string, simular: boolean) {
  const est = await estadoVirada(db, empresaId);
  if (!simular && est.etapa !== 'CONGELADA') throw new Error('Congele o P2S da empresa antes de migrar.');
  const linhas = await abertasDoEspelho(db, 'financeiro_contas_receber', empresaId, 'id, p2s_oid, documento, num_documento, num_parcela, descricao, cliente, cliente_oid, valor_final, valor_pago, data_emissao, data_vencimento, forma_pagamento');
  const avaliadas = linhas.map(r => ({ r, venc: r.data_vencimento as string | null, saldo: arred(n(r.valor_final) - n(r.valor_pago)) })).filter(x => x.saldo > 0.009);
  const migrar = avaliadas.filter(x => x.venc && x.venc >= desde);
  const resumoAnos = porAno(avaliadas.map(x => ({ venc: x.venc, saldo: x.saldo, migra: !!x.venc && x.venc >= desde })));
  // cliente e OS de cada título
  const oids = [...new Set(migrar.map(x => x.r.cliente_oid).filter(Boolean))] as string[];
  const parceiro = new Map<string, number>();
  const carregar = async (lista: string[]) => { for (const p of await emLotes<any>(lista, 300, async lote => ((await db.from('parceiros').select('id, p2s_oid').in('p2s_oid', lote)).data || []) as any[])) parceiro.set(p.p2s_oid, p.id); };
  await carregar(oids);
  const faltam = oids.filter(o => !parceiro.has(o));
  if (faltam.length && !simular) { await sincronizarParceirosPorOidsCore(faltam).catch(() => 0); await carregar(faltam); }
  const fls = [...new Set(migrar.flatMap(x => fichasNaDescricao(x.r.descricao)))];
  const osDaFl = new Map<string, number>();
  for (const f of await emLotes<any>(fls, 300, async lote => ((await db.from('locacao_fichas_locacao').select('numero, ficha_reserva_id').in('numero', lote)).data || []) as any[])) if (f.ficha_reserva_id) osDaFl.set(f.numero, f.ficha_reserva_id);

  const semCliente = migrar.filter(x => !parceiro.has(x.r.cliente_oid));
  const ok = migrar.filter(x => parceiro.has(x.r.cliente_oid));
  let gravados = 0;
  if (!simular) {
    for (let i = 0; i < ok.length; i += 200) {
      const lote = ok.slice(i, i + 200);
      const { data: ins, error } = await db.from('financeiro_titulos_receber').insert(lote.map(({ r, saldo }) => {
        const pc = parcelaDe(r.num_parcela);
        const fl = fichasNaDescricao(r.descricao)[0];
        return {
          empresa_id: empresaId, parceiro_id: parceiro.get(r.cliente_oid), origem: 'MIGRADO', ficha_id: fl ? osDaFl.get(fl) || null : null,
          descricao: limpo([`${limpo(r.documento) || 'Título'} ${limpo(r.num_documento)}`.trim(), limpo(r.descricao)].filter(Boolean).join(' · ')).slice(0, 200),
          parcela: pc.parcela, total_parcelas: pc.total, valor: saldo, data_emissao: r.data_emissao || hojeISO(), vencimento: r.data_vencimento,
          forma_pagamento: limpo(r.forma_pagamento) || null, p2s_oid: r.p2s_oid,
          observacoes: `Migrado do P2S na virada da chave${n(r.valor_pago) > 0 ? ` — já recebido R$ ${n(r.valor_pago).toFixed(2)} no P2S` : ''}.`, criado_por: usuario,
        };
      })).select('id, p2s_oid');
      if (error) throw error;
      const agora = new Date().toISOString();
      for (const t of (ins || []) as any[]) await db.from('financeiro_contas_receber').update({ migrado_titulo_id: t.id, migrado_em: agora }).eq('p2s_oid', t.p2s_oid);
      gravados += (ins || []).length;
    }
  }
  const resumo = {
    abertos: avaliadas.length, aMigrar: migrar.length, valorAMigrar: arred(migrar.reduce((a, x) => a + x.saldo, 0)), gravados,
    semCliente: semCliente.length, ficamNoP2s: avaliadas.length - migrar.length, valorFica: arred(avaliadas.filter(x => !migrar.includes(x)).reduce((a, x) => a + x.saldo, 0)), desde,
  };
  if (!simular) await registrar(db, empresaId, usuario, 'MIGROU CONTAS A RECEBER', `${gravados} título(s) · R$ ${resumo.valorAMigrar.toFixed(2)} (vencendo desde ${desde})`, { resultado_receber: { ...resumo, em: new Date().toISOString() }, contas_desde: desde });
  return { resumo, anos: resumoAnos, pendencias: semCliente.slice(0, 200).map(x => ({ cliente: limpo(x.r.cliente), descricao: limpo(x.r.descricao), vencimento: x.venc, valor: x.saldo, motivo: 'cliente não encontrado no cadastro' })) };
}

export async function migrarContasPagar(db: Db, empresaId: number, desde: string, usuario: string, simular: boolean) {
  const est = await estadoVirada(db, empresaId);
  if (!simular && est.etapa !== 'CONGELADA') throw new Error('Congele o P2S da empresa antes de migrar.');
  const linhas = await abertasDoEspelho(db, 'financeiro_contas_pagar', empresaId, 'id, p2s_oid, descricao, centro, sub_centro, fornecedor, documento_fornecedor, forma_pagamento, num_documento, num_parcela, valor, valor_pago, data_vencimento, data_emissao, pix_chave, boleto_linha');
  const avaliadas = linhas.map(r => ({ r, venc: r.data_vencimento as string | null, saldo: arred(n(r.valor) - n(r.valor_pago)) })).filter(x => x.saldo > 0.009);
  const migrar = avaliadas.filter(x => x.venc && x.venc >= desde);
  const resumoAnos = porAno(avaliadas.map(x => ({ venc: x.venc, saldo: x.saldo, migra: !!x.venc && x.venc >= desde })));
  // conta que nasceu de uma OP daqui: o título da OP já existe — só liga
  const { data: ops } = await db.from('op_ordens_pagamento').select('id, p2s_conta_pagar_oid').not('p2s_conta_pagar_oid', 'is', null).limit(20000);
  const opDoOid = new Map(((ops || []) as any[]).map(o => [o.p2s_conta_pagar_oid, o.id]));
  const opIds = [...new Set(migrar.map(x => opDoOid.get(x.r.p2s_oid)).filter(Boolean))] as string[];
  const tituloDaOp = new Map<string, number>();
  for (const t of await emLotes<any>(opIds, 300, async lote => ((await db.from('financeiro_titulos_pagar').select('id, op_id').in('op_id', lote).neq('status', 'CANCELADO')).data || []) as any[])) tituloDaOp.set(t.op_id, t.id);
  const ligadas = migrar.filter(x => { const op = opDoOid.get(x.r.p2s_oid); return op && tituloDaOp.has(op); });
  const novas = migrar.filter(x => !ligadas.includes(x));
  // fornecedor pelo CNPJ/CPF; sub-centro pelo nome do P2S
  const docs = [...new Set(novas.map(x => dig(x.r.documento_fornecedor)).filter(d => d.length === 11 || d.length === 14))];
  const fornecedor = new Map<string, number>();
  for (const p of await emLotes<any>(docs, 200, async lote => ((await db.from('parceiros').select('id, cnpj_digitos, cpf_digitos').or(`cnpj_digitos.in.(${lote.join(',')}),cpf_digitos.in.(${lote.join(',')})`)).data || []) as any[])) {
    if (p.cnpj_digitos) fornecedor.set(p.cnpj_digitos, p.id); if (p.cpf_digitos) fornecedor.set(p.cpf_digitos, p.id);
  }
  const nomeChave = (v: unknown) => limpo(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const nomes = [...new Set(novas.filter(x => !fornecedor.has(dig(x.r.documento_fornecedor))).map(x => limpo(x.r.fornecedor)).filter(Boolean))];
  const porNome = new Map<string, Set<number>>();
  for (const campo of ['nome_completo', 'nome_exibicao'] as const)
    for (const p of await emLotes<any>(nomes, 100, async lote => ((await db.from('parceiros').select(`id, ${campo}`).in(campo, lote)).data || []) as any[])) {
      const k = nomeChave(p[campo]); const s = porNome.get(k) || new Set<number>(); s.add(p.id); porNome.set(k, s);
    }
  const fornecedorDe = (r: any): number | null => {
    const porDoc = fornecedor.get(dig(r.documento_fornecedor)); if (porDoc) return porDoc;
    const s = porNome.get(nomeChave(r.fornecedor)); return s && s.size === 1 ? [...s][0] : null;
  };
const { data: subs } = await db.from('financeiro_subcentros').select('id, nome_p2s, centro:financeiro_centros(nome, nome_p2s)');
  const chaveSub = (c: unknown, s: unknown) => `${limpo(c).toUpperCase()}|${limpo(s).toUpperCase()}`;
  const subDe = new Map<string, number>();
  for (const s of (subs || []) as any[]) { subDe.set(chaveSub(s.centro?.nome, s.nome_p2s), s.id); subDe.set(chaveSub(s.centro?.nome_p2s, s.nome_p2s), s.id); }
  let gravados = 0, ligados = 0;
  if (!simular) {
    const agora = new Date().toISOString();
    for (const x of ligadas) { const tid = tituloDaOp.get(opDoOid.get(x.r.p2s_oid)!)!; await db.from('financeiro_contas_pagar').update({ migrado_titulo_id: tid, migrado_em: agora }).eq('id', x.r.id); ligados++; }
    for (let i = 0; i < novas.length; i += 200) {
      const lote = novas.slice(i, i + 200);
      const { data: ins, error } = await db.from('financeiro_titulos_pagar').insert(lote.map(({ r, saldo }) => {
        const pc = parcelaDe(r.num_parcela);
        return {
          empresa_id: empresaId, origem: 'MIGRADO', fornecedor_id: fornecedorDe(r), fornecedor_nome: limpo(r.fornecedor) || '—',
          descricao: limpo(r.descricao) || 'Conta a pagar (P2S)', documento: limpo(r.num_documento) || null, subcentro_id: subDe.get(chaveSub(r.centro, r.sub_centro)) || null,
          competencia: r.data_emissao || null, vencimento: r.data_vencimento, valor: saldo, parcela: pc.parcela, total_parcelas: pc.total,
          forma_pagamento: limpo(r.forma_pagamento) || null, boleto_linha: limpo(r.boleto_linha) || null, pix_chave: limpo(r.pix_chave) || null, p2s_oid: r.p2s_oid,
          observacoes: `Migrado do P2S na virada da chave${n(r.valor_pago) > 0 ? ` — já pago R$ ${n(r.valor_pago).toFixed(2)} no P2S` : ''}.`, criado_por: usuario,
        };
      })).select('id, p2s_oid');
      if (error) throw error;
      for (const t of (ins || []) as any[]) await db.from('financeiro_contas_pagar').update({ migrado_titulo_id: t.id, migrado_em: agora }).eq('p2s_oid', t.p2s_oid);
      gravados += (ins || []).length;
    }
  }
  const resumo = {
    abertos: avaliadas.length, aMigrar: migrar.length, valorAMigrar: arred(migrar.reduce((a, x) => a + x.saldo, 0)), gravados, ligadosOp: simular ? ligadas.length : ligados,
    semSubcentro: novas.filter(x => !subDe.has(chaveSub(x.r.centro, x.r.sub_centro))).length, semFornecedor: novas.filter(x => !fornecedorDe(x.r)).length,
    ficamNoP2s: avaliadas.length - migrar.length, valorFica: arred(avaliadas.filter(x => !migrar.includes(x)).reduce((a, x) => a + x.saldo, 0)), desde,
  };
  if (!simular) await registrar(db, empresaId, usuario, 'MIGROU CONTAS A PAGAR', `${gravados} título(s) novos + ${ligados} ligados à OP · R$ ${resumo.valorAMigrar.toFixed(2)} (vencendo desde ${desde})`, { resultado_pagar: { ...resumo, em: new Date().toISOString() }, contas_desde: desde });
  return { resumo, anos: resumoAnos };
}

// ============================================================================
// ETAPAS
// ============================================================================
export async function congelar(db: Db, empresaId: number, usuario: string) {
  const est = await estadoVirada(db, empresaId);
  if (est.etapa !== 'PREPARACAO') throw new Error('Esta empresa já está congelada.');
  const agora = new Date().toISOString();
  await registrar(db, empresaId, usuario, 'CONGELOU O P2S', 'P2S não é mais lido nem escrito para esta empresa', { etapa: 'CONGELADA' as EtapaVirada, congelada_em: agora, congelada_por: usuario, data_corte: hojeISO() });
}

export async function descongelar(db: Db, empresaId: number, usuario: string) {
  const est = await estadoVirada(db, empresaId);
  if (est.etapa !== 'CONGELADA') throw new Error('Só dá para descongelar uma empresa congelada (e ainda não concluída).');
  if (est.resultado_os?.migradas || est.resultado_receber?.gravados || est.resultado_pagar?.gravados) throw new Error('Já houve migração — não dá mais para voltar ao P2S por aqui.');
  await registrar(db, empresaId, usuario, 'DESCONGELOU', 'voltou a ler e escrever no P2S', { etapa: 'PREPARACAO' as EtapaVirada, congelada_em: null, congelada_por: null });
}

export async function concluir(db: Db, empresaId: number, usuario: string) {
  const est = await estadoVirada(db, empresaId);
  if (est.etapa !== 'CONGELADA') throw new Error('Congele e migre antes de concluir.');
  const faltam = [!est.resultado_os && 'OS', !est.resultado_receber && 'contas a receber', !est.resultado_pagar && 'contas a pagar'].filter(Boolean);
  if (faltam.length) throw new Error(`Falta migrar: ${faltam.join(', ')}.`);
  const inv = await inventarioDaVirada(db, empresaId);
  if (!inv.valido) throw new Error('Falta o inventário da virada (Passo 4): um inventário completo — todos os locais e categorias — aberto DEPOIS de migrar as OS e concluído.');
  const { error } = await db.from('financeiro_parametros').upsert({ empresa_id: empresaId, fonte: 'SISTEMA', atualizado_em: new Date().toISOString(), atualizado_por: usuario }, { onConflict: 'empresa_id' });
  if (error) throw error;
  await registrar(db, empresaId, usuario, 'CONCLUIU A VIRADA', 'Financeiro na fonte SISTEMA; Nota de Débito na série oficial', { etapa: 'CONCLUIDA' as EtapaVirada, concluida_em: new Date().toISOString(), concluida_por: usuario });
}
