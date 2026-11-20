// app/lib/locacao/sublocacao.ts
// SUBLOCAÇÃO (2026-11-20): quando falta equipamento, pegamos com um parceiro.
// Só servidor, SEM checagem de acesso (quem chama valida rota/empresa).
//
// Decisões do usuário:
//   * nasce da falta na OS ("Sublocar o que falta") ou avulsa;
//   * CONFIRMADA pelo parceiro, a quantidade sai da demanda sobre o estoque
//     próprio daquela OS (disponibilidade.ts → abaterSublocadoDaFicha);
//   * equipamento do parceiro POR QUANTIDADE: ENTRADA (veio do parceiro) e
//     DEVOLUÇÃO (voltou para ele), fora do saldo próprio/inventário/indicadores;
//     tudo devolvido → ENCERRADO;
//   * pagamento por OP pré-preenchida (op_ordens_pagamento.sublocacao_id);
//     pode haver mais de uma OP (ex.: avaria cobrada depois) — a nova cobre só
//     o que ainda não está em OP não reprovada;
//   * avaria no equipamento do parceiro: quanto ele nos cobra (valor_parceiro)
//     e, se repassar, o valor ao cliente pelo fluxo normal de Avarias. NÃO mexe
//     no estoque próprio nem abre OS de manutenção (a peça não é nossa);
//   * margem por OS (receita do item na OS × custo da sublocação) e ranking.
import type { supabaseAdmin } from '../supabase';
import { reservarFicha } from './disponibilidade';
import { numeroFichaPorId } from './fichaNumero';
import { dataValida, hojeISO, somarDias } from './datas';
import { formatarDocumento } from './pdfBase';
import { naturezaSublocacao } from '../financeiro/planoContas';

type Db = ReturnType<typeof supabaseAdmin>;
export type StatusSublocacao = 'SOLICITADO' | 'CONFIRMADO' | 'ENCERRADO' | 'CANCELADO';

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
const arred3 = (v: number) => Math.round(v * 1000) / 1000;
export const numeroSublocacao = (id: number) => `SL-${String(id).padStart(5, '0')}`;
const nomeParceiro = (p: any) => (p ? (p.nome_exibicao || p.nome_completo || '—') : '—');

export interface ItemSublocacaoEntrada { produto_id: number; quantidade: number; valor_unitario: number; descricao?: string | null }
export interface DadosSublocacao {
  empresa_id: number;
  fornecedor_id: number;
  ficha_reserva_id?: number | null;
  data_retirada: string;
  data_devolucao: string;
  valor_frete?: number | null;
  vencimento?: string | null;
  contato?: string | null;
  condicoes?: string | null;
  observacoes?: string | null;
  itens: ItemSublocacaoEntrada[];
  confirmar?: boolean;   // o parceiro já confirmou
}

// ============================================================================
// LEITURA
// ============================================================================
export async function carregarSublocacao(db: Db, id: number) {
  const { data: s, error } = await db.from('locacao_sublocacoes')
    .select('*, fornecedor:parceiros(id, nome_exibicao, nome_completo, cnpj, cpf, telefone1, email1), empresa:empresas(id, nome, nome_curto)')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  if (!s) return null;
  const [rI, rM, rO, rA, rF] = await Promise.all([
    db.from('locacao_sublocacao_itens').select('*, produto:produtos(codigo_formatado, categoria_nome)').eq('sublocacao_id', id).order('ordem').order('id'),
    db.from('locacao_sublocacao_movimentos').select('*').eq('sublocacao_id', id).order('criado_em', { ascending: false }),
    db.from('op_ordens_pagamento').select('id, numero_op, status, total_geral, data_criacao, data_vencimento, pago_em').eq('sublocacao_id', id).order('data_criacao'),
    db.from('locacao_avarias').select('id, produto_id, quantidade, gravidade, descricao, valor_parceiro, status_cobranca, valor_cobranca, registrada_por, registrada_em').eq('sublocacao_id', id).order('registrada_em'),
    s.ficha_reserva_id
      ? db.from('locacao_fichas_reserva').select('id, status, data_inicio, data_fim, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)').eq('id', s.ficha_reserva_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [rI, rM, rO, rA, rF] as any[]) if (r.error) throw r.error;
  const movs = (rM.data || []) as any[];
  const itens = ((rI.data || []) as any[]).map(i => {
    const soma = (t: string) => arred3(movs.filter(m => m.item_id === i.id && m.tipo === t).reduce((a, m) => a + n(m.quantidade), 0));
    const recebido = soma('ENTRADA'), devolvido = soma('DEVOLUCAO');
    return {
      id: i.id, produto_id: i.produto_id, descricao: i.descricao, codigo: i.produto?.codigo_formatado || null, categoria: i.produto?.categoria_nome || null,
      quantidade: n(i.quantidade), valor_unitario: n(i.valor_unitario), valor_total: n(i.valor_total),
      recebido, devolvido, comAgente: arred3(recebido - devolvido), aReceber: Math.max(0, arred3(n(i.quantidade) - recebido)),
    };
  });
  const custoItens = arred(itens.reduce((a, i) => a + i.valor_total, 0));
  const custoAvarias = arred(((rA.data || []) as any[]).reduce((a, x) => a + n(x.valor_parceiro), 0));
  const custoTotal = arred(custoItens + n(s.valor_frete) + custoAvarias);
  const ops = (rO.data || []) as any[];
  const emOp = arred(ops.filter(o => o.status !== 'REPROVADA').reduce((a, o) => a + n(o.total_geral), 0));
  const pago = arred(ops.filter(o => o.status === 'PAGO').reduce((a, o) => a + n(o.total_geral), 0));
  const os = rF.data as any;
  return {
    sublocacao: s as any,
    numero: numeroSublocacao(s.id),
    fornecedor: s.fornecedor ? { id: s.fornecedor.id, nome: nomeParceiro(s.fornecedor), documento: formatarDocumento(s.fornecedor.cnpj, s.fornecedor.cpf), telefone: s.fornecedor.telefone1, email: s.fornecedor.email1 } : null,
    os: os ? { id: os.id, numero: numeroFichaPorId(os.id), status: os.status, cliente: nomeParceiro(os.parceiro), evento: os.evento?.nome || null, inicio: os.data_inicio, fim: os.data_fim } : null,
    itens, movimentos: movs, ops, avarias: rA.data || [],
    valores: { custoItens, frete: n(s.valor_frete), custoAvarias, custoTotal, emOp, pago, aGerarOp: Math.max(0, arred(custoTotal - emOp)) },
    fisico: {
      aReceber: arred3(itens.reduce((a, i) => a + i.aReceber, 0)),
      comAgente: arred3(itens.reduce((a, i) => a + i.comAgente, 0)),
      devolvido: arred3(itens.reduce((a, i) => a + i.devolvido, 0)),
    },
  };
}

// ============================================================================
// CRIAR / EDITAR / STATUS
// ============================================================================
function validar(d: DadosSublocacao): string | null {
  if (!d.empresa_id) return 'Escolha a empresa.';
  if (!d.fornecedor_id) return 'Escolha o parceiro (fornecedor).';
  if (!dataValida(d.data_retirada) || !dataValida(d.data_devolucao)) return 'Informe as datas de retirada e devolução ao parceiro.';
  if (d.data_devolucao < d.data_retirada) return 'A devolução ao parceiro é antes da retirada.';
  if (d.vencimento && !dataValida(d.vencimento)) return 'Vencimento inválido.';
  if (n(d.valor_frete) < 0) return 'Frete inválido.';
  const itens = (d.itens || []).filter(i => i.produto_id && n(i.quantidade) > 0);
  if (!itens.length) return 'Inclua ao menos um equipamento.';
  if (itens.some(i => n(i.valor_unitario) < 0)) return 'Valor negativo em algum item.';
  return null;
}

async function linhasItens(db: Db, sublocacaoId: number, itens: ItemSublocacaoEntrada[]) {
  const validos = itens.filter(i => i.produto_id && n(i.quantidade) > 0);
  const { data: prods } = await db.from('produtos').select('id, nome_item').in('id', validos.map(i => i.produto_id));
  const nome = new Map(((prods || []) as any[]).map(p => [p.id, p.nome_item]));
  return validos.map((i, k) => {
    const q = arred3(n(i.quantidade)), vu = arred(n(i.valor_unitario));
    return { sublocacao_id: sublocacaoId, produto_id: i.produto_id, descricao: (i.descricao || '').trim() || nome.get(i.produto_id) || `Produto #${i.produto_id}`, quantidade: q, valor_unitario: vu, valor_total: arred(q * vu), ordem: k };
  });
}

async function historicoOs(db: Db, fichaId: number | null, usuario: string, acao: string, detalhe: string) {
  if (!fichaId) return;
  await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: fichaId, usuario, acao, detalhe });
}

/** Refaz a reserva da OS (o sublocado confirmado muda o que o estoque próprio precisa cobrir). */
async function rerreservarOs(db: Db, fichaId: number | null): Promise<string | null> {
  if (!fichaId) return null;
  const { data: f } = await db.from('locacao_fichas_reserva').select('status, origem').eq('id', fichaId).maybeSingle();
  if (!f || f.origem !== 'SISTEMA' || f.status !== 'RESERVADA') return null;
  const r = await reservarFicha(db, fichaId);
  if (r.ok) return null;
  return r.erro || `A OS ${numeroFichaPorId(fichaId)} ficou com falta: ${(r.faltas || []).map(x => `${x.falta}× ${x.nome}`).join(', ')} — a reserva anterior foi mantida.`;
}

export async function criarSublocacao(db: Db, d: DadosSublocacao, usuario: string): Promise<{ id: number; aviso: string | null }> {
  const erro = validar(d);
  if (erro) throw new Error(erro);
  if (d.ficha_reserva_id) {
    const { data: f } = await db.from('locacao_fichas_reserva').select('id, empresa_id, origem, status').eq('id', d.ficha_reserva_id).maybeSingle();
    if (!f) throw new Error('OS não encontrada.');
    if (f.origem !== 'SISTEMA') throw new Error('OS do P2S — a sublocação dela é feita no PrimeStart.');
    if (f.empresa_id !== d.empresa_id) throw new Error('A empresa da sublocação precisa ser a mesma da OS.');
    if (['PERDIDO', 'CANCELADA', 'FINALIZADA'].includes(f.status)) throw new Error(`A OS está ${f.status}.`);
  }
  const confirmar = !!d.confirmar;
  const { data: s, error } = await db.from('locacao_sublocacoes').insert({
    empresa_id: d.empresa_id, fornecedor_id: d.fornecedor_id, ficha_reserva_id: d.ficha_reserva_id || null,
    status: confirmar ? 'CONFIRMADO' : 'SOLICITADO', data_retirada: d.data_retirada, data_devolucao: d.data_devolucao,
    valor_frete: arred(n(d.valor_frete)), vencimento: d.vencimento || null, contato: d.contato?.trim() || null,
    condicoes: d.condicoes?.trim() || null, observacoes: d.observacoes?.trim() || null, criado_por: usuario,
    confirmado_por: confirmar ? usuario : null, confirmado_em: confirmar ? new Date().toISOString() : null,
  }).select('id').single();
  if (error) throw error;
  const linhas = await linhasItens(db, s.id, d.itens);
  const { error: eI } = await db.from('locacao_sublocacao_itens').insert(linhas);
  if (eI) { await db.from('locacao_sublocacoes').delete().eq('id', s.id); throw eI; }
  await historicoOs(db, d.ficha_reserva_id || null, usuario, 'SUBLOCACAO', `${numeroSublocacao(s.id)} ${confirmar ? 'confirmada' : 'solicitada'}: ${linhas.map(l => `${l.quantidade}× ${l.descricao}`).join(', ')}`);
  const aviso = confirmar ? await rerreservarOs(db, d.ficha_reserva_id || null) : null;
  return { id: s.id, aviso };
}

/** Edita valores/itens/datas enquanto não houve entrada nem OP (não reprovada). */
export async function editarSublocacao(db: Db, id: number, d: Omit<DadosSublocacao, 'empresa_id' | 'ficha_reserva_id' | 'confirmar'>, usuario: string): Promise<{ aviso: string | null }> {
  const atual = await carregarSublocacao(db, id);
  if (!atual) throw new Error('Sublocação não encontrada.');
  const s = atual.sublocacao;
  if (!['SOLICITADO', 'CONFIRMADO'].includes(s.status)) throw new Error(`Sublocação ${s.status.toLowerCase()} não pode ser editada.`);
  if (atual.movimentos.length) throw new Error('Já houve entrada de equipamento — não dá mais para mudar os itens.');
  if (atual.ops.some((o: any) => o.status !== 'REPROVADA')) throw new Error('Já existe OP para esta sublocação — reprove a OP antes de editar.');
  const erro = validar({ ...d, empresa_id: s.empresa_id });
  if (erro) throw new Error(erro);
  await db.from('locacao_sublocacoes').update({
    fornecedor_id: d.fornecedor_id, data_retirada: d.data_retirada, data_devolucao: d.data_devolucao, valor_frete: arred(n(d.valor_frete)),
    vencimento: d.vencimento || null, contato: d.contato?.trim() || null, condicoes: d.condicoes?.trim() || null, observacoes: d.observacoes?.trim() || null,
    atualizado_em: new Date().toISOString(),
  }).eq('id', id);
  await db.from('locacao_sublocacao_itens').delete().eq('sublocacao_id', id);
  const { error } = await db.from('locacao_sublocacao_itens').insert(await linhasItens(db, id, d.itens));
  if (error) throw error;
  await historicoOs(db, s.ficha_reserva_id, usuario, 'SUBLOCACAO', `${numeroSublocacao(id)} editada`);
  return { aviso: s.status === 'CONFIRMADO' ? await rerreservarOs(db, s.ficha_reserva_id) : null };
}

export async function confirmarSublocacao(db: Db, id: number, usuario: string): Promise<{ aviso: string | null }> {
  const { data: s } = await db.from('locacao_sublocacoes').select('id, status, ficha_reserva_id').eq('id', id).maybeSingle();
  if (!s) throw new Error('Sublocação não encontrada.');
  if (s.status !== 'SOLICITADO') throw new Error('Só sublocação solicitada pode ser confirmada.');
  await db.from('locacao_sublocacoes').update({ status: 'CONFIRMADO', confirmado_por: usuario, confirmado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', id);
  await historicoOs(db, s.ficha_reserva_id, usuario, 'SUBLOCACAO', `${numeroSublocacao(id)} confirmada pelo parceiro`);
  return { aviso: await rerreservarOs(db, s.ficha_reserva_id) };
}

export async function cancelarSublocacao(db: Db, id: number, motivo: string, usuario: string): Promise<{ aviso: string | null }> {
  if (!motivo?.trim()) throw new Error('Informe o motivo.');
  const atual = await carregarSublocacao(db, id);
  if (!atual) throw new Error('Sublocação não encontrada.');
  const s = atual.sublocacao;
  if (!['SOLICITADO', 'CONFIRMADO'].includes(s.status)) throw new Error(`Sublocação já ${s.status.toLowerCase()}.`);
  if (atual.fisico.comAgente > 0) throw new Error('Há equipamento do parceiro com a gente — registre a devolução antes de cancelar.');
  const aberta = atual.ops.find((o: any) => o.status !== 'REPROVADA');
  if (aberta) throw new Error(`Existe a OP #${aberta.numero_op} (${aberta.status}) — reprove-a antes de cancelar.`);
  await db.from('locacao_sublocacoes').update({ status: 'CANCELADO', motivo_cancelamento: motivo.trim(), atualizado_em: new Date().toISOString() }).eq('id', id);
  await historicoOs(db, s.ficha_reserva_id, usuario, 'SUBLOCACAO', `${numeroSublocacao(id)} cancelada: ${motivo.trim()}`);
  return { aviso: s.status === 'CONFIRMADO' ? await rerreservarOs(db, s.ficha_reserva_id) : null };
}

// ============================================================================
// ESTOQUE DO PARCEIRO (por quantidade)
// ============================================================================
export async function registrarMovimentoSublocacao(db: Db, id: number, tipo: 'ENTRADA' | 'DEVOLUCAO', linhas: { item_id: number; quantidade: number }[], data: string, usuario: string, observacoes?: string | null) {
  if (!dataValida(data)) throw new Error('Data inválida.');
  if (data > somarDias(hojeISO(), 1)) throw new Error('A data não pode ser no futuro.');
  const atual = await carregarSublocacao(db, id);
  if (!atual) throw new Error('Sublocação não encontrada.');
  if (atual.sublocacao.status !== 'CONFIRMADO') throw new Error(atual.sublocacao.status === 'SOLICITADO' ? 'Confirme a sublocação com o parceiro antes.' : `Sublocação ${atual.sublocacao.status.toLowerCase()}.`);
  const porId = new Map(atual.itens.map(i => [i.id, i]));
  const validas = linhas.filter(l => n(l.quantidade) > 0);
  if (!validas.length) throw new Error('Informe ao menos uma quantidade.');
  for (const l of validas) {
    const it = porId.get(l.item_id);
    if (!it) throw new Error('Item não pertence a esta sublocação.');
    const lim = tipo === 'ENTRADA' ? it.aReceber : it.comAgente;
    if (n(l.quantidade) > lim + 1e-9) throw new Error(`"${it.descricao}": ${tipo === 'ENTRADA' ? `só faltam receber ${lim}` : `só ${lim} com a gente`}.`);
  }
  const { error } = await db.from('locacao_sublocacao_movimentos').insert(validas.map(l => ({
    sublocacao_id: id, item_id: l.item_id, tipo, quantidade: arred3(n(l.quantidade)), data, usuario, observacoes: observacoes?.trim() || null,
  })));
  if (error) throw error;
  // tudo devolvido ao parceiro → encerra
  const depois = await carregarSublocacao(db, id);
  if (depois && depois.itens.every(i => i.devolvido + 1e-9 >= i.quantidade)) {
    await db.from('locacao_sublocacoes').update({ status: 'ENCERRADO', encerrado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', id);
    await historicoOs(db, depois.sublocacao.ficha_reserva_id, usuario, 'SUBLOCACAO', `${numeroSublocacao(id)} devolvida ao parceiro — encerrada`);
  }
}

// ============================================================================
// AVARIA NO EQUIPAMENTO DO PARCEIRO
// ============================================================================
export async function registrarAvariaSublocacao(db: Db, id: number, a: {
  item_id: number; quantidade: number; gravidade: 'LEVE' | 'MEDIA' | 'GRAVE' | 'PERDA_TOTAL'; descricao: string;
  valor_parceiro: number | null; repassar: boolean; valor_cliente: number | null;
}, usuario: string) {
  if (!a.descricao?.trim()) throw new Error('Descreva a avaria.');
  const atual = await carregarSublocacao(db, id);
  if (!atual) throw new Error('Sublocação não encontrada.');
  if (atual.sublocacao.status === 'CANCELADO') throw new Error('Sublocação cancelada.');
  const it = atual.itens.find(i => i.id === a.item_id);
  if (!it) throw new Error('Item não pertence a esta sublocação.');
  if (!(n(a.quantidade) > 0) || n(a.quantidade) > it.quantidade) throw new Error('Quantidade inválida.');
  let clienteId: number | null = null;
  if (atual.sublocacao.ficha_reserva_id) {
    const { data: f } = await db.from('locacao_fichas_reserva').select('parceiro_id').eq('id', atual.sublocacao.ficha_reserva_id).maybeSingle();
    clienteId = f?.parceiro_id ?? null;
  }
  if (a.repassar && !clienteId) throw new Error('Sublocação sem OS de cliente — não há a quem repassar.');
  // inserção direta: a peça não é nossa (não baixa estoque nem abre OS de manutenção)
  const { error } = await db.from('locacao_avarias').insert({
    empresa_id: atual.sublocacao.empresa_id, produto_id: it.produto_id, patrimonio_id: null, quantidade: arred3(n(a.quantidade)),
    gravidade: a.gravidade, descricao: `${a.descricao.trim()} (equipamento do parceiro ${atual.fornecedor?.nome || ''} — ${numeroSublocacao(id)})`,
    fotos: [], ficha_id: atual.sublocacao.ficha_reserva_id, parceiro_id: clienteId, sublocacao_id: id,
    valor_parceiro: a.valor_parceiro != null ? arred(n(a.valor_parceiro)) : null,
    status_cobranca: a.repassar ? 'COBRAR' : 'NAO_COBRAR', valor_cobranca: a.repassar && a.valor_cliente != null ? arred(n(a.valor_cliente)) : null,
    registrada_por: usuario,
  });
  if (error) throw error;
  await historicoOs(db, atual.sublocacao.ficha_reserva_id, usuario, 'SUBLOCACAO', `Avaria em equipamento sublocado (${numeroSublocacao(id)}): ${a.descricao.trim()}`);
}

// ============================================================================
// ORDEM DE PAGAMENTO (pré-preenchimento de /admin/op/nova?sublocacaoId=)
// ============================================================================
export async function dadosOpSublocacao(db: Db, id: number) {
  const atual = await carregarSublocacao(db, id);
  if (!atual) throw new Error('Sublocação não encontrada.');
  const s = atual.sublocacao;
  if (!['CONFIRMADO', 'ENCERRADO'].includes(s.status)) throw new Error('Confirme a sublocação com o parceiro antes de gerar a OP.');
  const v = atual.valores;
  if (v.aGerarOp <= 0.009) throw new Error(`Não há valor a pagar fora de OP (custo ${v.custoTotal.toFixed(2)}, já em OP ${v.emOp.toFixed(2)}).`);
  const { data: forn } = await db.from('parceiros').select('nome_completo, nome_exibicao, cnpj, cpf, telefone1, endereco1, numero1, complemento1, bairro1, cidade1, estado1, cep1').eq('id', s.fornecedor_id).single();
  // itens: na 1ª OP, os equipamentos + frete + avarias; nas seguintes, só o que falta (uma linha)
  const primeira = v.emOp <= 0.009;
  const itens = primeira
    ? [
      ...atual.itens.map(i => ({ descricao: `SUBLOCAÇÃO ${i.descricao}`.toUpperCase().slice(0, 150), qtd: i.quantidade, valor: i.valor_unitario })),
      ...(v.frete > 0 ? [{ descricao: 'FRETE DA SUBLOCAÇÃO', qtd: 1, valor: v.frete }] : []),
      ...(v.custoAvarias > 0 ? [{ descricao: 'AVARIA EM EQUIPAMENTO SUBLOCADO', qtd: 1, valor: v.custoAvarias }] : []),
    ].filter(i => i.valor > 0)
    : [{ descricao: `COMPLEMENTO DA SUBLOCAÇÃO ${atual.numero}${v.custoAvarias > 0 ? ' (AVARIAS)' : ''}`, qtd: 1, valor: v.aGerarOp }];
  // natureza: 1º o sub-centro do centro SUBLOCAÇÃO que casa com o equipamento
  // (plano de contas do P2S — "6.4 TELEVISORES"); depois a "SUBLOCAÇÃO ..."
  // manual cujo complemento aparece nos itens; depois a genérica "SUBLOCAÇÃO";
  // senão não chuta — o usuário escolhe
  const texto = atual.itens.map(i => `${i.descricao} ${i.categoria || ''}`).join(' ').toUpperCase();
  const { data: nats } = await db.from('op_naturezas_pagamento').select('natureza').ilike('natureza', 'SUBLOCA%').order('ordem');
  const lista = ((nats || []) as any[]).map(x => String(x.natureza));
  const natureza = (await naturezaSublocacao(db, texto))
    || lista.find(nm => { const resto = nm.replace(/^SUBLOCA[ÇC][ÃA]O\s*/i, '').trim(); return resto && !resto.startsWith('—') && texto.includes(resto.toUpperCase()); })
    || lista.find(nm => /^SUBLOCA[ÇC][ÃA]O$/i.test(nm.trim())) || null;
  const endereco = forn ? [[forn.endereco1, forn.numero1].filter(Boolean).join(', '), forn.complemento1, forn.bairro1, [forn.cidade1, forn.estado1].filter(Boolean).join('/'), forn.cep1].filter(Boolean).join(' - ') : '';
  return {
    empresaId: s.empresa_id, natureza, naturezasSublocacao: lista,
    favorecido: nomeParceiro(forn).toUpperCase(), documento: (forn?.cnpj || forn?.cpf || '').replace(/\D/g, ''), endereco, telefone: forn?.telefone1 || '',
    itens, total: arred(itens.reduce((a, i) => a + i.qtd * i.valor, 0)),
    vencimento: s.vencimento || null,
    os: atual.os ? { numero: atual.os.numero, cliente: atual.os.cliente, evento: atual.os.evento || '', periodo: `${atual.os.inicio.split('-').reverse().join('/')} A ${atual.os.fim.split('-').reverse().join('/')}` } : null,
    observacao: `REFERENTE À SUBLOCAÇÃO ${atual.numero}${atual.os ? ` — OS ${atual.os.numero}` : ''} — ${atual.itens.map(i => `${i.quantidade}× ${i.descricao}`).join(', ')} — PERÍODO ${s.data_retirada.split('-').reverse().join('/')} A ${s.data_devolucao.split('-').reverse().join('/')}`.toUpperCase().slice(0, 900),
  };
}

// ============================================================================
// MARGEM DA OS
// ============================================================================
/** Receita (preço da OS) dos itens sublocados × custo da sublocação, por sublocação. */
export async function margemDaOs(db: Db, fichaId: number) {
  const { data: subs } = await db.from('locacao_sublocacoes').select('id, status, valor_frete, fornecedor:parceiros(nome_exibicao, nome_completo), itens:locacao_sublocacao_itens(produto_id, descricao, quantidade, valor_total)')
    .eq('ficha_reserva_id', fichaId).neq('status', 'CANCELADO').order('id');
  if (!subs?.length) return { sublocacoes: [], receita: 0, custo: 0, margem: 0 };
  const { data: itensOs } = await db.from('locacao_fichas_reserva_itens').select('produto_id, quantidade, valor_total').eq('ficha_id', fichaId).in('tipo', ['EQUIPAMENTO', 'KIT']);
  const precoUnit = new Map<number, number>();
  for (const i of (itensOs || []) as any[]) {
    if (!i.produto_id || !(n(i.quantidade) > 0)) continue;
    const vu = n(i.valor_total) / n(i.quantidade);
    precoUnit.set(i.produto_id, Math.max(precoUnit.get(i.produto_id) || 0, vu));
  }
  const ids = (subs as any[]).map(s => s.id);
  const { data: avs } = await db.from('locacao_avarias').select('sublocacao_id, valor_parceiro').in('sublocacao_id', ids);
  const lista = (subs as any[]).map(s => {
    const receita = arred((s.itens || []).reduce((a: number, i: any) => a + (precoUnit.get(i.produto_id) || 0) * n(i.quantidade), 0));
    const custo = arred((s.itens || []).reduce((a: number, i: any) => a + n(i.valor_total), 0) + n(s.valor_frete)
      + ((avs || []) as any[]).filter(x => x.sublocacao_id === s.id).reduce((a, x) => a + n(x.valor_parceiro), 0));
    return { id: s.id, numero: numeroSublocacao(s.id), status: s.status, fornecedor: nomeParceiro(s.fornecedor), itens: (s.itens || []).map((i: any) => `${n(i.quantidade)}× ${i.descricao}`).join(', '), receita, custo, margem: arred(receita - custo) };
  });
  const receita = arred(lista.reduce((a, x) => a + x.receita, 0)), custo = arred(lista.reduce((a, x) => a + x.custo, 0));
  return { sublocacoes: lista, receita, custo, margem: arred(receita - custo) };
}

// ============================================================================
// RANKING (parceiros e produtos mais sublocados)
// ============================================================================
export async function rankingSublocacao(db: Db, empresas: number[] | null, de: string, ate: string) {
  let q = db.from('locacao_sublocacoes').select('id, empresa_id, status, valor_frete, data_retirada, fornecedor_id, fornecedor:parceiros(nome_exibicao, nome_completo), itens:locacao_sublocacao_itens(produto_id, descricao, quantidade, valor_total)')
    .neq('status', 'CANCELADO').gte('data_retirada', de).lte('data_retirada', ate);
  if (empresas !== null) q = q.in('empresa_id', empresas.length ? empresas : [0]);
  const { data, error } = await q.limit(5000);
  if (error) throw error;
  const porForn = new Map<number, { fornecedor: string; sublocacoes: number; unidades: number; valor: number }>();
  const porProd = new Map<number, { produto: string; vezes: number; unidades: number; valor: number }>();
  for (const s of (data || []) as any[]) {
    const custo = (s.itens || []).reduce((a: number, i: any) => a + n(i.valor_total), 0) + n(s.valor_frete);
    const f = porForn.get(s.fornecedor_id) || { fornecedor: nomeParceiro(s.fornecedor), sublocacoes: 0, unidades: 0, valor: 0 };
    f.sublocacoes++; f.valor += custo; f.unidades += (s.itens || []).reduce((a: number, i: any) => a + n(i.quantidade), 0);
    porForn.set(s.fornecedor_id, f);
    for (const i of s.itens || []) {
      const p = porProd.get(i.produto_id) || { produto: i.descricao, vezes: 0, unidades: 0, valor: 0 };
      p.vezes++; p.unidades += n(i.quantidade); p.valor += n(i.valor_total);
      porProd.set(i.produto_id, p);
    }
  }
  const arr = <T extends { valor: number }>(m: Map<number, T>) => [...m.entries()].map(([id, v]) => ({ id, ...v, valor: arred(v.valor) })).sort((a, b) => b.valor - a.valor);
  return { fornecedores: arr(porForn), produtos: arr(porProd), total: arred([...porForn.values()].reduce((a, f) => a + f.valor, 0)), sublocacoes: (data || []).length };
}

// ============================================================================
// EXPEDIÇÃO: o que receber do parceiro e o que devolver
// ============================================================================
export async function pendenciasExpedicaoSublocacao(db: Db, empresas: number[] | null) {
  let q = db.from('locacao_sublocacoes').select('id').eq('status', 'CONFIRMADO').order('data_retirada');
  if (empresas !== null) q = q.in('empresa_id', empresas.length ? empresas : [0]);
  const { data, error } = await q.limit(200);
  if (error) {
    if (/locacao_sublocacoes/.test(error.message)) return [];
    throw error;
  }
  const out = [];
  for (const s of (data || []) as any[]) {
    const c = await carregarSublocacao(db, s.id);
    if (!c || (c.fisico.aReceber <= 0 && c.fisico.comAgente <= 0)) continue;
    out.push({
      id: c.sublocacao.id, numero: c.numero, empresa_id: c.sublocacao.empresa_id, fornecedor: c.fornecedor?.nome || '—', os: c.os?.numero || null, cliente: c.os?.cliente || null,
      evento: c.os?.evento || null, retirada: c.sublocacao.data_retirada, devolucao: c.sublocacao.data_devolucao,
      itens: c.itens.map(i => ({ id: i.id, descricao: i.descricao, quantidade: i.quantidade, aReceber: i.aReceber, comAgente: i.comAgente })),
      aReceber: c.fisico.aReceber, comAgente: c.fisico.comAgente,
    });
  }
  return out;
}
