// app/lib/financeiro/faturamento.ts
// FATURAMENTO — Nota de Débito (Financeiro, 2026-11-20). Só servidor, sem
// checagem de acesso.
//
// Decisões do usuário:
//   * fatura APÓS A DEVOLUÇÃO: OS (ficha de reserva do sistema) FINALIZADA com
//     saldo a faturar entra na fila; antecipar é possível por OS;
//   * TUDO NA NOTA DE DÉBITO: equipamentos + serviços + prorrogações;
//   * numeração: série ENSAIO enquanto a fonte financeira da empresa for o P2S;
//     depois da virada, série OFICIAL continuando do último nº de Nota de
//     Débito do P2S da empresa (função SQL financeiro_proximo_numero_fatura);
//   * envio: PDF por e-mail (anexo + link), link pelo WhatsApp, Portal do Cliente.
//
// Saldo a faturar da OS = total da OS + prorrogações − títulos a receber da
// OS já gerados (origem FICHA, não cancelados — inclui os de faturas
// anteriores e os gerados à mão no painel da OS).
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { hojeISO, somarDias, dataValida } from '../locacao/datas';
import { numeroFichaPorId } from '../locacao/fichaNumero';
import { fontesDasEmpresas } from './caixa';
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
const limpo = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const VENCIMENTO_PADRAO_DIAS = 7;
export const baseUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const linkFatura = (token: string) => `${baseUrl()}/api/fatura/${token}`;
export const numeroExibicao = (f: { serie: string; numero: number }) => (f.serie === 'OFICIAL' ? String(f.numero) : `ENS-${String(f.numero).padStart(4, '0')}`);

export interface ItemFatura { tipo: string; descricao: string; quantidade: number; dias: number | null; valor_unitario: number; desconto: number; valor_total: number; ref?: string }

// ============================================================================
// COMPOSIÇÃO DA OS (o que falta faturar)
// ============================================================================
export async function composicaoOs(db: Db, reservaId: number) {
  const { data: r, error } = await db.from('locacao_fichas_reserva')
    .select('id, empresa_id, parceiro_id, origem, status, valor_total, desconto_valor, data_inicio, data_fim, contato_nome, contato_telefone, contato_email, condicao_pagamento, forma_pagamento, parceiro:parceiros(nome_exibicao, nome_completo, email1, telefone1), evento:eventos_feiras(nome)')
    .eq('id', reservaId).maybeSingle();
  if (error) throw error;
  if (!r) throw new Error('OS não encontrada.');
  const [{ data: itens }, { data: prorrs }, { data: tits }, { data: fats }] = await Promise.all([
    db.from('locacao_fichas_reserva_itens').select('tipo, descricao, quantidade, dias, valor_unitario, desconto_valor, valor_total').eq('ficha_id', reservaId).order('ordem'),
    db.from('locacao_prorrogacoes').select('id, fim_anterior, fim_novo, dias_adicionais, valor_estimado').eq('ficha_reserva_id', reservaId).order('criado_em'),
    db.from('financeiro_titulos_receber').select('valor, status, fatura_id, origem').eq('ficha_id', reservaId).eq('origem', 'FICHA').neq('status', 'CANCELADO'),
    db.from('financeiro_faturas').select('id, serie, numero, valor_total, valor_desconto, itens, status, data_emissao').eq('ficha_reserva_id', reservaId).order('id'),
  ]);
  const itensOs: ItemFatura[] = ((itens || []) as any[]).map(i => ({
    tipo: i.tipo, descricao: limpo(i.descricao), quantidade: n(i.quantidade), dias: i.dias ? n(i.dias) : null,
    valor_unitario: n(i.valor_unitario), desconto: n(i.desconto_valor), valor_total: n(i.valor_total),
  }));
  // Todas as prorrogações entram no total da OS; o que já foi faturado (títulos FICHA
  // não cancelados + descontos dados em faturas válidas) sai no abatimento. Assim uma
  // 2ª fatura (ex.: prorrogação depois da 1ª) fecha certo: OS + prorr. − já resolvido.
  const prorrogacoes: ItemFatura[] = ((prorrs || []) as any[]).filter(p => n(p.valor_estimado) > 0).map(p => ({
    tipo: 'PRORROGACAO', descricao: `Prorrogação de ${p.fim_anterior.split('-').reverse().join('/')} até ${p.fim_novo.split('-').reverse().join('/')} (+${p.dias_adicionais} dia(s))`,
    quantidade: 1, dias: p.dias_adicionais, valor_unitario: n(p.valor_estimado), desconto: 0, valor_total: n(p.valor_estimado), ref: `PRORROGACAO:${p.id}`,
  }));
  const totalOs = arred(n(r.valor_total));
  const totalProrr = arred(prorrogacoes.reduce((a, p) => a + p.valor_total, 0));
  const descontosFaturas = ((fats || []) as any[]).filter(f => f.status !== 'CANCELADA').reduce((a, f) => a + n(f.valor_desconto), 0);
  const jaGerado = arred(((tits || []) as any[]).reduce((a, t) => a + n(t.valor), 0) + descontosFaturas);
  const saldo = arred(totalOs + totalProrr - jaGerado);
  return {
    reserva: r as any, numeroOs: numeroFichaPorId(r.id), itensOs, prorrogacoes, totalOs, descontoOs: n(r.desconto_valor), totalProrr, jaGerado, saldo,
    faturas: ((fats || []) as any[]).map(f => ({ ...f, numero_exibicao: numeroExibicao(f), valor_total: n(f.valor_total) })),
  };
}

/** Fila: OSs do sistema finalizadas (ou, com `emAndamento`, reservadas/em locação) com saldo a faturar. */
export async function filaAFaturar(db: Db, empresaIds: number[], emAndamento: boolean) {
  const status = emAndamento ? ['RESERVADA', 'EM_LOCACAO', 'FINALIZADA'] : ['FINALIZADA'];
  const { data: oss, error } = await buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_reserva')
    .select('id, empresa_id, status, valor_total, data_inicio, data_fim, parceiro_id, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome)')
    .eq('origem', 'SISTEMA').in('status', status).in('empresa_id', empresaIds.length ? empresaIds : [0]).order('data_fim').range(d, a), 1000, 20000);
  if (error) throw error;
  if (!oss.length) return [];
  const ids = oss.map((o: any) => o.id);
  const tits: any[] = [], prorrs: any[] = [], fats: any[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const lote = ids.slice(i, i + 300);
    const [t, p, f] = await Promise.all([
      db.from('financeiro_titulos_receber').select('ficha_id, valor').in('ficha_id', lote).eq('origem', 'FICHA').neq('status', 'CANCELADO'),
      db.from('locacao_prorrogacoes').select('id, ficha_reserva_id, valor_estimado').in('ficha_reserva_id', lote),
      db.from('financeiro_faturas').select('ficha_reserva_id, valor_desconto').in('ficha_reserva_id', lote).neq('status', 'CANCELADA'),
    ]);
    tits.push(...(t.data || [])); prorrs.push(...(p.data || [])); fats.push(...(f.data || []));
  }
  const { data: fls } = await db.from('locacao_fichas_locacao').select('ficha_reserva_id, data_devolucao, status').in('ficha_reserva_id', ids).eq('origem', 'SISTEMA');
  const devolucao = new Map<number, string>();
  for (const f of (fls || []) as any[]) if (f.data_devolucao && (!devolucao.has(f.ficha_reserva_id) || f.data_devolucao > devolucao.get(f.ficha_reserva_id)!)) devolucao.set(f.ficha_reserva_id, f.data_devolucao);
  return oss.map((o: any) => {
    const prorr = prorrs.filter(p => p.ficha_reserva_id === o.id).reduce((a, p) => a + Math.max(0, n(p.valor_estimado)), 0);
    const ja = tits.filter(t => t.ficha_id === o.id).reduce((a, t) => a + n(t.valor), 0)
      + fats.filter(f => f.ficha_reserva_id === o.id).reduce((a, f) => a + n(f.valor_desconto), 0);
    const saldo = arred(n(o.valor_total) + prorr - ja);
    return {
      id: o.id, numero: numeroFichaPorId(o.id), empresa_id: o.empresa_id, status: o.status, cliente: o.parceiro ? (o.parceiro.nome_exibicao || o.parceiro.nome_completo) : '—',
      evento: o.evento?.nome || null, inicio: o.data_inicio, fim: o.data_fim, devolucao: devolucao.get(o.id) || null,
      total: arred(n(o.valor_total) + prorr), ja_faturado: arred(ja), saldo,
    };
  }).filter((o: any) => o.saldo > 0.009);
}

// ============================================================================
// EMITIR / CANCELAR
// ============================================================================
/**
 * Último nº de Nota de Débito do P2S para continuar a série OFICIAL. No P2S cada
 * centro numera à parte (a Alfa Light tem "ALFA LIGHT", hoje ~675, e "ELITE", ~1643
 * e quase parado) — então vale o centro que emitiu a ND mais recente, e dele o maior nº.
 */
export async function ultimoNumeroNdP2s(db: Db, empresaId: number): Promise<{ numero: number; centro: string | null }> {
  const { data } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_contas_receber').select('id, num_documento, centro, data_emissao')
    .eq('empresa_id', empresaId).ilike('documento', 'Nota de D%').order('id').range(d, a), 1000, 200000);
  const porCentro = new Map<string, { max: number; ultima: string }>();
  for (const r of (data || []) as any[]) {
    const num = Number(String(r.num_documento || '').replace(/\D/g, '')) || 0;
    if (!num) continue;
    const c = limpo(r.centro) || '';
    const g = porCentro.get(c) || { max: 0, ultima: '' };
    g.max = Math.max(g.max, num);
    const em = String(r.data_emissao || '');
    if (em > g.ultima) g.ultima = em;
    porCentro.set(c, g);
  }
  let escolhido: [string, { max: number; ultima: string }] | null = null;
  for (const e of porCentro) if (!escolhido || e[1].ultima > escolhido[1].ultima || (e[1].ultima === escolhido[1].ultima && e[1].max > escolhido[1].max)) escolhido = e;
  return escolhido ? { numero: escolhido[1].max, centro: escolhido[0] || null } : { numero: 0, centro: null };
}

export interface ParcelaFatura { valor: number; vencimento: string }

export async function emitirFatura(db: Db, reservaId: number, o: { parcelas: ParcelaFatura[]; forma_pagamento?: string | null; observacoes?: string | null; desconto_extra?: number; data_emissao?: string | null }, usuario: string) {
  const c = await composicaoOs(db, reservaId);
  const r = c.reserva;
  if (r.origem !== 'SISTEMA') throw new Error('OS do P2S — o faturamento dela é feito no PrimeStart.');
  if (!['RESERVADA', 'EM_LOCACAO', 'FINALIZADA'].includes(r.status)) throw new Error('Só OS reservada, em locação ou finalizada pode ser faturada.');
  if (c.saldo <= 0.009) throw new Error('Nada a faturar nesta OS (já foi tudo faturado/cobrado).');
  const desconto = arred(n(o.desconto_extra));
  if (desconto < 0 || desconto >= c.saldo) throw new Error('Desconto inválido.');
  const total = arred(c.saldo - desconto);
  const parcelas = (o.parcelas || []).filter(p => n(p.valor) > 0);
  if (!parcelas.length) throw new Error('Informe as parcelas.');
  if (parcelas.some(p => !dataValida(p.vencimento))) throw new Error('Há parcela sem vencimento.');
  const somaParc = arred(parcelas.reduce((a, p) => a + n(p.valor), 0));
  if (Math.abs(somaParc - total) > 0.009) throw new Error(`As parcelas somam ${somaParc.toFixed(2)} e a fatura é de ${total.toFixed(2)}.`);
  const emissao = o.data_emissao && dataValida(o.data_emissao) ? o.data_emissao : hojeISO();

  // itens: se nada foi cobrado antes, a OS inteira; senão, a OS e o abatimento do que já foi cobrado
  const itens: ItemFatura[] = [...c.itensOs];
  if (c.descontoOs > 0) itens.push({ tipo: 'DESCONTO', descricao: 'Desconto da OS', quantidade: 1, dias: null, valor_unitario: -c.descontoOs, desconto: 0, valor_total: -c.descontoOs });
  itens.push(...c.prorrogacoes);
  if (c.jaGerado > 0) itens.push({ tipo: 'ABATIMENTO', descricao: 'Valores já faturados/cobrados anteriormente', quantidade: 1, dias: null, valor_unitario: -c.jaGerado, desconto: 0, valor_total: -c.jaGerado });
  if (desconto > 0) itens.push({ tipo: 'DESCONTO', descricao: 'Desconto no faturamento', quantidade: 1, dias: null, valor_unitario: -desconto, desconto: 0, valor_total: -desconto });

  const fonte = (await fontesDasEmpresas(db, [r.empresa_id])).get(r.empresa_id) || 'P2S';
  const serie = fonte === 'SISTEMA' ? 'OFICIAL' : 'ENSAIO';
  let inicio = 0;
  if (serie === 'OFICIAL') {
    const { data: s } = await db.from('financeiro_faturamento_series').select('ultimo_numero').eq('empresa_id', r.empresa_id).eq('serie', 'OFICIAL').maybeSingle();
    if (!s) inicio = (await ultimoNumeroNdP2s(db, r.empresa_id)).numero;
  }
  const { data: numero, error: eN } = await db.rpc('financeiro_proximo_numero_fatura', { p_empresa_id: r.empresa_id, p_serie: serie, p_inicio: inicio });
  if (eN) throw eN;
  const { data: fat, error } = await db.from('financeiro_faturas').insert({
    empresa_id: r.empresa_id, serie, numero, parceiro_id: r.parceiro_id, ficha_reserva_id: r.id, data_emissao: emissao, competencia: `${emissao.slice(0, 7)}-01`,
    antecipada: r.status !== 'FINALIZADA', itens, valor_itens: c.saldo, valor_desconto: desconto, valor_total: total,
    forma_pagamento: o.forma_pagamento || r.forma_pagamento || null, observacoes: limpo(o.observacoes) || null,
    token_publico: randomBytes(18).toString('base64url'), criado_por: usuario,
  }).select('id, serie, numero').single();
  if (error) throw error;
  const nf = numeroExibicao(fat as any);
  const evento = r.evento?.nome ? ` — ${r.evento.nome}` : '';
  const { error: eT } = await db.from('financeiro_titulos_receber').insert(parcelas.map((p, i) => ({
    empresa_id: r.empresa_id, parceiro_id: r.parceiro_id, origem: 'FICHA', ficha_id: r.id, fatura_id: fat.id,
    descricao: `Nota de Débito ${nf} · Locação ${c.numeroOs}${evento}`.slice(0, 200) + (parcelas.length > 1 ? ` (${i + 1}/${parcelas.length})` : ''),
    parcela: i + 1, total_parcelas: parcelas.length, valor: arred(n(p.valor)), vencimento: p.vencimento, data_emissao: emissao,
    forma_pagamento: o.forma_pagamento || r.forma_pagamento || null, criado_por: usuario,
  })));
  if (eT) {
    await db.from('financeiro_faturas').update({ status: 'CANCELADA', motivo_cancelamento: `Falha ao gerar os títulos: ${eT.message}`, cancelada_em: new Date().toISOString() }).eq('id', fat.id);
    throw eT;
  }
  await db.from('locacao_fichas_reserva_historico').insert({
    ficha_id: r.id, usuario, acao: 'FATURADA', detalhe: `Nota de Débito ${nf}${serie === 'ENSAIO' ? ' (ensaio)' : ''} · R$ ${total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em ${parcelas.length} parcela(s)`,
  });
  return { id: fat.id as number, numero: nf, serie, total };
}

export async function cancelarFatura(db: Db, id: number, motivo: string, usuario: string) {
  if (!limpo(motivo)) throw new Error('Informe o motivo.');
  const { data: f } = await db.from('financeiro_faturas').select('id, status, serie, numero, ficha_reserva_id').eq('id', id).maybeSingle();
  if (!f) throw new Error('Fatura não encontrada.');
  if (f.status === 'CANCELADA') throw new Error('Fatura já cancelada.');
  const { data: tits } = await db.from('financeiro_titulos_receber').select('id, status').eq('fatura_id', id);
  if (((tits || []) as any[]).some(t => t.status === 'PAGO')) throw new Error('Há parcela já recebida — estorne o recebimento antes de cancelar a fatura.');
  await db.from('financeiro_titulos_receber').update({ status: 'CANCELADO', motivo_cancelamento: `Nota de Débito ${numeroExibicao(f as any)} cancelada: ${limpo(motivo)}`, atualizado_em: new Date().toISOString() }).eq('fatura_id', id).eq('status', 'ABERTO');
  await db.from('financeiro_faturas').update({ status: 'CANCELADA', cancelada_em: new Date().toISOString(), cancelada_por: usuario, motivo_cancelamento: limpo(motivo) }).eq('id', id);
  if (f.ficha_reserva_id) await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: f.ficha_reserva_id, usuario, acao: 'FATURA_CANCELADA', detalhe: `Nota de Débito ${numeroExibicao(f as any)}: ${limpo(motivo)}` });
}

// ============================================================================
// DADOS DO DOCUMENTO (PDF, e-mail, WhatsApp)
// ============================================================================
export async function dadosFatura(db: Db, id: number) {
  const { data: f } = await db.from('financeiro_faturas').select('*').eq('id', id).maybeSingle();
  if (!f) throw new Error('Fatura não encontrada.');
  const [{ data: emp }, { data: cli }, { data: os }, { data: tits }, { data: contas }, { data: fls }] = await Promise.all([
    db.from('empresas').select('*').eq('id', f.empresa_id).single(),
    db.from('parceiros').select('nome_completo, nome_exibicao, cnpj, cpf, inscricao_estadual, endereco1, numero1, complemento1, bairro1, cidade1, estado1, cep1, telefone1, email1').eq('id', f.parceiro_id).maybeSingle(),
    f.ficha_reserva_id ? db.from('locacao_fichas_reserva').select('id, data_inicio, data_fim, local_entrega, contato_nome, contato_telefone, contato_email, evento:eventos_feiras(nome)').eq('id', f.ficha_reserva_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('financeiro_titulos_receber').select('parcela, total_parcelas, valor, vencimento, status, data_pagamento').eq('fatura_id', id).neq('status', 'CANCELADO').order('parcela'),
    db.from('financeiro_contas').select('nome, banco_codigo, agencia, numero_conta, tipo').eq('empresa_id', f.empresa_id).eq('ativa', true).eq('tipo', 'BANCO').order('ordem').limit(1),
    f.ficha_reserva_id ? db.from('locacao_fichas_locacao').select('numero').eq('ficha_reserva_id', f.ficha_reserva_id).eq('origem', 'SISTEMA').order('letra') : Promise.resolve({ data: [] }),
  ]);
  return { fatura: f as any, empresa: emp as any, cliente: cli as any, os: os as any, parcelas: (tits || []) as any[], conta: ((contas || []) as any[])[0] || null, fichasLocacao: ((fls || []) as any[]).map(x => x.numero) };
}

/** E-mail com o PDF anexo + link. Fatura de ENSAIO só vai para o próprio usuário (teste). */
export async function enviarFaturaEmail(db: Db, id: number, para: string, pdf: Uint8Array, usuario: string) {
  const d = await dadosFatura(db, id);
  const f = d.fatura;
  if (f.status === 'CANCELADA') throw new Error('Fatura cancelada.');
  const nf = numeroExibicao(f);
  const empresa = limpo(d.empresa?.nome_curto || d.empresa?.nome);
  const venc = d.parcelas.map(p => `${p.vencimento.split('-').reverse().join('/')} — R$ ${n(p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join('\n');
  const texto = [
    `Olá${d.cliente ? `, ${limpo(d.cliente.nome_exibicao || d.cliente.nome_completo)}` : ''}.`, '',
    `Segue a Nota de Débito nº ${nf} da ${empresa}${d.os?.evento?.nome ? `, referente à locação para ${d.os.evento.nome}` : ''}.`, '',
    `Valor: R$ ${n(f.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, `Vencimento(s):\n${venc}`, '',
    d.conta ? `Dados para pagamento: ${d.conta.nome}${d.conta.banco_codigo ? ` · banco ${d.conta.banco_codigo}` : ''}${d.conta.agencia ? ` · ag. ${d.conta.agencia}` : ''}${d.conta.numero_conta ? ` · c/c ${d.conta.numero_conta}` : ''}` : '',
    `A fatura também pode ser vista neste link: ${linkFatura(f.token_publico)}`, '', `Qualquer dúvida, estamos à disposição.`, empresa,
  ].filter(x => x !== null).join('\n');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 465, secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: `"${empresa || 'Financeiro'}" <${process.env.SMTP_USER}>`, to: para, subject: `Nota de Débito ${nf} — ${empresa}${f.serie === 'ENSAIO' ? ' [ENSAIO]' : ''}`, text: texto,
    attachments: [{ filename: `nota-de-debito-${nf}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' }],
  });
  await db.from('financeiro_faturas').update({ enviada_email_em: new Date().toISOString(), enviada_email_para: para }).eq('id', id);
  void usuario;
}

/** Texto e telefone para o link do WhatsApp (o usuário abre e envia). */
export async function mensagemWhatsapp(db: Db, id: number) {
  const d = await dadosFatura(db, id);
  const f = d.fatura;
  const nf = numeroExibicao(f);
  const fone = String(d.os?.contato_telefone || d.cliente?.telefone1 || '').replace(/\D/g, '');
  const e164 = fone ? (fone.startsWith('55') ? fone : `55${fone}`) : '';
  const venc = d.parcelas.map(p => `${p.vencimento.split('-').reverse().join('/')}: R$ ${n(p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join(' · ');
  const texto = `Olá! Segue a Nota de Débito nº ${nf} da ${limpo(d.empresa?.nome_curto || d.empresa?.nome)}${d.os?.evento?.nome ? ` (${d.os.evento.nome})` : ''} — total R$ ${n(f.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, vencimento ${venc}. Fatura: ${linkFatura(f.token_publico)}`;
  return { telefone: e164, texto, link: `https://wa.me/${e164}?text=${encodeURIComponent(texto)}`, emailSugerido: limpo(d.os?.contato_email || d.cliente?.email1) || null, serie: f.serie };
}

export function parcelasPadrao(total: number, n_: number, primeiro: string): ParcelaFatura[] {
  const k = Math.max(1, Math.min(24, Math.floor(n_)));
  const base = Math.floor((total / k) * 100) / 100;
  return Array.from({ length: k }, (_, i) => ({ valor: i === k - 1 ? arred(total - base * (k - 1)) : base, vencimento: somarDias(primeiro, i * 30) }));
}
