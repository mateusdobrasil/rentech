'use server';

// app/admin/financeiro/titulos-receber/actions.ts
// Contas a Receber de LOCAÇÃO (2026-11-17, Fase 3a). Títulos das fichas
// próprias (parcelas), das avarias e avulsos; baixa manual por enquanto —
// emissão do Bolecode/baixa automática pela API de Cobrança do Itaú entram
// quando houver especificação + credencial (campos boleto_* já existem).
// Fase paralela: ENSAIO — a cobrança oficial segue no P2S.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { registrarLogAuditoria } from '../../../actions';
import { buscarClientes } from '../../../lib/locacao/buscas';
import { sugerirParcelas } from '../../../lib/financeiro/parcelas';
import { dataValida, hojeISO } from '../../../lib/locacao/datas';
import { numeroFicha } from '../../../lib/locacao/fichaNumero';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/titulos-receber';
const ROTA_FICHAS = '/admin/locacoes/reservas';
const ROTA_AVARIAS = '/admin/estoque/manutencao';
const FATURAVEIS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const arred = (v: number) => Math.round(v * 100) / 100;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function contexto(accessToken: string, rotas: string[] = [ROTA]) {
  const acesso = rotas.length === 1 ? await validarAcesso(accessToken, rotas[0]) : await validarAcessoAlgumaRota(accessToken, rotas);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}
function log(nome: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: nome, acao, setor: 'FINANCEIRO', equipamento_nome: detalhe });
}
async function tituloDoUsuario(id: number, permitidas: number[] | null) {
  const { data } = await supabaseAdmin().from('financeiro_titulos_receber').select('*').eq('id', id).maybeSingle();
  if (!data) return { erro: 'Título não encontrado.' } as const;
  if (!empresaPermitida(permitidas, data.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  return { t: data } as const;
}

// ============================================================================
// LISTA
// ============================================================================
export async function listarTitulosAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: emps } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
    const empresas = (emps || []).filter((e: any) => ctx.permitidas === null || ctx.permitidas.includes(e.id))
      .map((e: any) => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() }));
    const { data, error } = await buscarTodasPaginas<any>((de, ate) => db.from('financeiro_titulos_receber')
      .select('*, cliente:parceiros(nome_exibicao, nome_completo), ficha:locacao_fichas_reserva(id, origem, p2s_numero)')
      .in('empresa_id', empresas.length ? empresas.map(e => e.id) : [0]).order('vencimento').order('id').range(de, ate), 1000, 10000);
    if (error) throw error;
    return {
      ok: true,
      info: {
        empresas,
        titulos: data.map(t => ({ ...t, cliente: undefined, ficha: undefined, cliente_nome: t.cliente?.nome_exibicao || t.cliente?.nome_completo || '—', ficha_numero: t.ficha ? numeroFicha(t.ficha) : null })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarClientesTituloAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: await buscarClientes(supabaseAdmin(), texto) }; } catch (e: any) { return { ok: false, erro: e.message }; }
}

// ============================================================================
// FICHA → PARCELAS
// ============================================================================
/** Títulos já gerados da ficha + sugestão de parcelas do saldo (leitura — também para quem só vê a ficha). */
export async function titulosDaFichaAction(fichaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA, ROTA_FICHAS]);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: f } = await db.from('locacao_fichas_reserva').select('id, empresa_id, status, origem, valor_total, condicao_pagamento, data_fim').eq('id', fichaId).maybeSingle();
    if (!f || !empresaPermitida(ctx.permitidas, f.empresa_id)) return { ok: false, erro: 'Ficha não encontrada.' };
    const { data: titulos } = await db.from('financeiro_titulos_receber').select('id, parcela, total_parcelas, descricao, valor, vencimento, status, data_pagamento, valor_pago, boleto_status')
      .eq('ficha_id', fichaId).order('vencimento');
    const gerado = (titulos || []).filter((t: any) => t.status !== 'CANCELADO').reduce((s: number, t: any) => s + n(t.valor), 0);
    const saldo = arred(n(f.valor_total) - gerado);
    const podeGerar = (await validarAcesso(accessToken, ROTA)).ok;
    return {
      ok: true,
      info: {
        titulos: titulos || [], gerado: arred(gerado), saldo, podeGerar,
        faturavel: f.origem === 'SISTEMA' && FATURAVEIS.includes(f.status),
        sugestao: saldo > 0.009 ? sugerirParcelas(saldo, f.condicao_pagamento, hojeISO(), f.data_fim) : [],
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function gerarTitulosFichaAction(fichaId: number, parcelas: { valor: number; vencimento: string; descricao?: string }[], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: `${ctx.erro} (gerar título exige acesso a Títulos a Receber no Financeiro)` };
  const db = supabaseAdmin();
  try {
    const { data: f } = await db.from('locacao_fichas_reserva').select('id, empresa_id, parceiro_id, status, origem, valor_total, evento:eventos_feiras(nome)').eq('id', fichaId).maybeSingle();
    if (!f || !empresaPermitida(ctx.permitidas, f.empresa_id)) return { ok: false, erro: 'Ficha não encontrada.' };
    if (f.origem !== 'SISTEMA') return { ok: false, erro: 'Ficha do P2S — o faturamento é feito no P2S.' };
    if (!FATURAVEIS.includes(f.status)) return { ok: false, erro: 'Só fichas aprovadas/reservadas/em locação/finalizadas geram títulos.' };
    if (!parcelas.length) return { ok: false, erro: 'Nenhuma parcela.' };
    for (const p of parcelas) {
      if (!(n(p.valor) > 0)) return { ok: false, erro: 'Há parcela sem valor.' };
      if (!dataValida(p.vencimento)) return { ok: false, erro: 'Há parcela sem vencimento.' };
    }
    const { data: existentes } = await db.from('financeiro_titulos_receber').select('valor, status').eq('ficha_id', fichaId);
    const gerado = (existentes || []).filter((t: any) => t.status !== 'CANCELADO').reduce((s: number, t: any) => s + n(t.valor), 0);
    const novo = parcelas.reduce((s, p) => s + n(p.valor), 0);
    if (gerado + novo > n(f.valor_total) + 0.01) {
      return { ok: false, erro: `As parcelas (${novo.toFixed(2)}) passam do saldo da ficha (${(n(f.valor_total) - gerado).toFixed(2)}).` };
    }
    const numero = `FR-${String(f.id).padStart(5, '0')}`;
    const evento = (f as any).evento?.nome;
    const linhas = parcelas.map((p, i) => ({
      empresa_id: f.empresa_id, parceiro_id: f.parceiro_id, origem: 'FICHA', ficha_id: f.id,
      descricao: `Locação ${numero}${evento ? ` — ${evento}` : ''}${parcelas.length > 1 ? ` (${i + 1}/${parcelas.length}${p.descricao ? ` · ${p.descricao}` : ''})` : ''}`,
      parcela: i + 1, total_parcelas: parcelas.length, valor: arred(n(p.valor)), vencimento: p.vencimento, criado_por: ctx.perfil.nome,
    }));
    const { error } = await db.from('financeiro_titulos_receber').insert(linhas);
    if (error) throw error;
    await db.from('locacao_fichas_reserva_historico').insert({
      ficha_id: f.id, usuario: ctx.perfil.nome, acao: 'TITULOS_GERADOS',
      detalhe: `${linhas.length} título(s) a receber gerado(s): ${linhas.map(l => `R$ ${l.valor.toFixed(2)} venc. ${l.vencimento.split('-').reverse().join('/')}`).join('; ')}`,
    });
    log(ctx.perfil.nome, 'GEROU TÍTULOS A RECEBER', `${numero}: ${linhas.length} parcela(s), R$ ${novo.toFixed(2)}`);
    return { ok: true, info: { gerados: linhas.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// AVARIA → TÍTULO
// ============================================================================
export async function gerarTituloAvariaAction(avariaId: number, vencimento: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken, [ROTA, ROTA_AVARIAS]);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(vencimento)) return { ok: false, erro: 'Informe o vencimento.' };
  const db = supabaseAdmin();
  try {
    const { data: a } = await db.from('locacao_avarias').select('*, produto:produtos(nome_item), patrimonio:locacao_patrimonios(numero_patrimonio)').eq('id', avariaId).maybeSingle();
    if (!a || !empresaPermitida(ctx.permitidas, a.empresa_id)) return { ok: false, erro: 'Avaria não encontrada.' };
    if (!a.parceiro_id) return { ok: false, erro: 'Avaria sem cliente responsável — vincule a ficha/cliente antes.' };
    if (!(n(a.valor_cobranca) > 0)) return { ok: false, erro: 'Defina o valor a cobrar antes.' };
    const { count } = await db.from('financeiro_titulos_receber').select('id', { count: 'exact', head: true }).eq('avaria_id', avariaId).neq('status', 'CANCELADO');
    if ((count || 0) > 0) return { ok: false, erro: 'Esta avaria já tem título a receber.' };
    const { error } = await db.from('financeiro_titulos_receber').insert({
      empresa_id: a.empresa_id, parceiro_id: a.parceiro_id, origem: 'AVARIA', avaria_id: a.id, ficha_id: a.ficha_id,
      descricao: `Avaria #${a.id} — ${a.patrimonio?.numero_patrimonio ? `${a.patrimonio.numero_patrimonio} · ` : ''}${a.produto?.nome_item || ''}`.slice(0, 200),
      valor: arred(n(a.valor_cobranca)), vencimento, criado_por: ctx.perfil.nome,
    });
    if (error) throw error;
    await db.from('locacao_avarias').update({ status_cobranca: 'COBRADO', atualizado_em: new Date().toISOString() }).eq('id', avariaId);
    log(ctx.perfil.nome, 'GEROU TÍTULO DE AVARIA', `avaria #${avariaId}: R$ ${n(a.valor_cobranca).toFixed(2)}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// AVULSO / BAIXA / ESTORNO / CANCELAMENTO
// ============================================================================
export async function criarTituloAvulsoAction(d: { empresa_id: number; parceiro_id: number; descricao: string; valor: number; vencimento: string; observacoes?: string | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, d.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  if (!d.parceiro_id) return { ok: false, erro: 'Escolha o cliente.' };
  if (!d.descricao?.trim()) return { ok: false, erro: 'Descreva o título.' };
  if (!(n(d.valor) > 0)) return { ok: false, erro: 'Valor inválido.' };
  if (!dataValida(d.vencimento)) return { ok: false, erro: 'Vencimento inválido.' };
  const { error } = await supabaseAdmin().from('financeiro_titulos_receber').insert({
    empresa_id: d.empresa_id, parceiro_id: d.parceiro_id, origem: 'AVULSO', descricao: d.descricao.trim(), valor: arred(n(d.valor)),
    vencimento: d.vencimento, observacoes: d.observacoes?.trim() || null, criado_por: ctx.perfil.nome,
  });
  if (error) return { ok: false, erro: error.message };
  log(ctx.perfil.nome, 'CRIOU TÍTULO A RECEBER AVULSO', `${d.descricao.trim()} R$ ${n(d.valor).toFixed(2)}`);
  return { ok: true };
}

export async function baixarTituloAction(id: number, d: { data_pagamento: string; valor_pago: number; forma_pagamento: string; juros_multa?: number; desconto?: number; observacoes?: string | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dataValida(d.data_pagamento)) return { ok: false, erro: 'Data do pagamento inválida.' };
  if (!(n(d.valor_pago) > 0)) return { ok: false, erro: 'Valor pago inválido.' };
  const db = supabaseAdmin();
  try {
    const a = await tituloDoUsuario(id, ctx.permitidas);
    if ('erro' in a) return { ok: false, erro: a.erro };
    if (a.t.status !== 'ABERTO') return { ok: false, erro: 'Título não está em aberto.' };
    const { error } = await db.from('financeiro_titulos_receber').update({
      status: 'PAGO', data_pagamento: d.data_pagamento, valor_pago: arred(n(d.valor_pago)), forma_pagamento: d.forma_pagamento || null,
      juros_multa: arred(n(d.juros_multa)), desconto: arred(n(d.desconto)), observacoes: d.observacoes?.trim() || a.t.observacoes,
      baixado_por: ctx.perfil.nome, atualizado_em: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw error;
    if (a.t.avaria_id) await db.from('locacao_avarias').update({ status_cobranca: 'PAGO', atualizado_em: new Date().toISOString() }).eq('id', a.t.avaria_id);
    log(ctx.perfil.nome, 'BAIXOU TÍTULO A RECEBER', `#${id} ${a.t.descricao}: R$ ${n(d.valor_pago).toFixed(2)} em ${d.data_pagamento}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function estornarBaixaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  const a = await tituloDoUsuario(id, ctx.permitidas);
  if ('erro' in a) return { ok: false, erro: a.erro };
  if (a.t.status !== 'PAGO') return { ok: false, erro: 'Título não está pago.' };
  await db.from('financeiro_titulos_receber').update({
    status: 'ABERTO', data_pagamento: null, valor_pago: null, forma_pagamento: null, juros_multa: 0, desconto: 0, baixado_por: null, atualizado_em: new Date().toISOString(),
  }).eq('id', id);
  if (a.t.avaria_id) await db.from('locacao_avarias').update({ status_cobranca: 'COBRADO' }).eq('id', a.t.avaria_id);
  log(ctx.perfil.nome, 'ESTORNOU BAIXA DE TÍTULO', `#${id} ${a.t.descricao}`);
  return { ok: true };
}

export async function cancelarTituloAction(id: number, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!motivo?.trim()) return { ok: false, erro: 'Informe o motivo.' };
  const db = supabaseAdmin();
  const a = await tituloDoUsuario(id, ctx.permitidas);
  if ('erro' in a) return { ok: false, erro: a.erro };
  if (a.t.status !== 'ABERTO') return { ok: false, erro: 'Só título em aberto pode ser cancelado (estorne a baixa antes).' };
  await db.from('financeiro_titulos_receber').update({ status: 'CANCELADO', motivo_cancelamento: motivo.trim(), atualizado_em: new Date().toISOString() }).eq('id', id);
  if (a.t.avaria_id) await db.from('locacao_avarias').update({ status_cobranca: 'COBRAR' }).eq('id', a.t.avaria_id);
  log(ctx.perfil.nome, 'CANCELOU TÍTULO A RECEBER', `#${id} ${a.t.descricao}: ${motivo.trim()}`);
  return { ok: true };
}
