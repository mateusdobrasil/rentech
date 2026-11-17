'use server';

// app/admin/locacoes/reservas/actions.ts
// Orçamentos e Reservas — Ficha de Reserva própria (2026-11-16, Fase 1 da
// substituição do P2S). Fluxo:
//   ORCAMENTO → ENVIADO → RESERVADA → (EM_LOCACAO → FINALIZADA, pela expedição)
//   PERDIDO / CANCELADA são finais (podem ser reabertas como orçamento).
// Reservar grava as alocações (app/lib/locacao/disponibilidade.ts) e só
// passa se não faltar nada. Ficha RESERVADA pode ser editada: a reserva é
// refeita ao salvar (e o salvamento é recusado se a mudança criar falta).
// Preço sugerido: app/lib/locacao/precificacao.ts.
// Envio ao P2S (espelho até a Fase 3) ainda não está aqui — próximo passo.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { registrarLogAuditoria } from '../../../actions';
import { buscarClientes, buscarEventos, buscarProdutosLocaveis } from '../../../lib/locacao/buscas';
import { precificarItens, type Modalidade } from '../../../lib/locacao/precificacao';
import { verificarDisponibilidade, reservarFicha, liberarReservaFicha, type ItemDemanda } from '../../../lib/locacao/disponibilidade';
import { dataValida, diasInclusivos, type DatasFicha } from '../../../lib/locacao/datas';
import { importarFichasP2sCore, ultimaImportacaoFichasP2s } from '../../../lib/locacao/importarFichasP2s';
import {
  acessoLocacao, acessoParaTela, clientesDaCarteira, donosCarteira, podeVerCliente, podeAtenderCliente, assumirClienteSemCarteira,
  descontoAutoAprovado, vendedoresAtivos, MSG_FICHA_FORA_CARTEIRA, type AcessoLocacao,
} from '../../../lib/locacao/acessoFichas';
import { calcularDescontoPct, descontoPendente } from '../../../lib/locacao/descontoFicha';
import { BUCKET_PROPOSTAS } from './propostaCore';
import { FORMAS_PAGAMENTO } from '../../../lib/locacao/textosPadrao';
import { regrasVendedores } from '../../../lib/comercial/comissoes';
import type { RegraComissao } from '../../../lib/comercial/regraComissao';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/locacoes/reservas';
const SETOR = 'LOCACOES';

export type StatusFicha = 'ORCAMENTO' | 'ENVIADO' | 'APROVADO' | 'PERDIDO' | 'RESERVADA' | 'EM_LOCACAO' | 'FINALIZADA' | 'CANCELADA';
export type TipoItem = 'EQUIPAMENTO' | 'KIT' | 'SERVICO' | 'FRETE' | 'OUTRO';
export type AcaoStatus = 'ENVIAR' | 'VOLTAR_ORCAMENTO' | 'RESERVAR' | 'DESFAZER_RESERVA' | 'PERDER' | 'CANCELAR' | 'REABRIR';

const EDITAVEIS: StatusFicha[] = ['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA'];

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const [permitidas, acesso] = await Promise.all([
    obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada),
    acessoLocacao(supabaseAdmin(), v.perfil),
  ]);
  return { perfil: v.perfil, permitidas, acesso } as const;
}
type Ctx = { permitidas: number[] | null; acesso: AcessoLocacao };

const SEM_PERMISSAO = {
  criar: 'Seu usuário não pode criar fichas de locação.',
  editar: 'Seu usuário não pode alterar fichas de locação.',
  excluir: 'Seu usuário não pode cancelar, marcar como perdida ou excluir fichas.',
  aprovar: 'Seu usuário não pode aprovar desconto.',
};
/** Regras de comissão que a tela pode mostrar (gestão: todas; vendedor padrão: só a dele). */
async function regrasParaTela(acesso: AcessoLocacao): Promise<Record<number, RegraComissao>> {
  try {
    const todas = await regrasVendedores(supabaseAdmin());
    const out: Record<number, RegraComissao> = {};
    for (const [id, r] of todas) {
      if (!r.ativo) continue;
      if (acesso.escopo === 'TODAS' || id === acesso.vendedorId) out[id] = { pct_locacao: r.pct_locacao, pct_servicos: r.pct_servicos, faixas_desconto: r.faixas_desconto, faixas_prazo: r.faixas_prazo };
    }
    return out;
  } catch {
    return {}; // SQL das comissões ainda não rodou
  }
}

const pctTxt = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

async function empresasVisiveis(permitidas: number[] | null) {
  // select('*'): proposta_validade_dias só existe depois de locacao_contrato_proposta.sql
  const { data } = await supabaseAdmin().from('empresas').select('*').eq('ativo', true).order('id');
  return ((data || []) as any[])
    .filter(e => permitidas === null || permitidas.includes(e.id))
    .map(e => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim(), validadeDias: Number(e.proposta_validade_dias) || 7 }));
}

async function fichaDoUsuario(id: number, ctx: Ctx) {
  const db = supabaseAdmin();
  const { data, error } = await db.from('locacao_fichas_reserva').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return { erro: 'Ficha não encontrada.' } as const;
  if (!empresaPermitida(ctx.permitidas, data.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  if (!(await podeVerCliente(db, ctx.acesso, data.parceiro_id))) return { erro: MSG_FICHA_FORA_CARTEIRA } as const;
  return { ficha: data } as const;
}

async function especLed(produtoIds: number[]): Promise<Map<number, any>> {
  const ids = [...new Set(produtoIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await supabaseAdmin().from('locacao_produto_led').select('*').in('produto_id', ids);
  return new Map(((data || []) as any[]).map(r => [r.produto_id as number, r]));
}

async function historico(fichaId: number, usuario: string, acao: string, detalhe: string | null, de?: string | null, para?: string | null) {
  await supabaseAdmin().from('locacao_fichas_reserva_historico').insert({
    ficha_id: fichaId, usuario, acao, detalhe, status_de: de ?? null, status_para: para ?? null,
  });
}

function log(perfilNome: string, acao: string, detalhe?: string) {
  registrarLogAuditoria({ usuario_nome: perfilNome, acao, setor: SETOR, equipamento_nome: detalhe || null });
}

const num = (v: unknown, padrao = 0) => { const x = Number(v); return Number.isFinite(x) ? x : padrao; };
const arred = (v: number) => Math.round(v * 100) / 100;
const txt = (s?: string | null) => (s && s.trim()) || null;
const dataOuNull = (s?: string | null) => (dataValida(s) ? s : null);
const formatarMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ============================================================================
// LISTA
// ============================================================================
export async function listarFichasAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const empresas = await empresasVisiveis(ctx.permitidas);
    const acesso = acessoParaTela(ctx.acesso);
    if (!empresas.length) return { ok: true, info: { empresas, fichas: [], acesso } };
    // vendedor padrão: só os clientes da carteira dele
    const carteira = ctx.acesso.escopo === 'CARTEIRA' ? new Set(await clientesDaCarteira(db, ctx.acesso.vendedorId)) : null;
    if (carteira && !carteira.size) return { ok: true, info: { empresas, fichas: [], acesso, clientesCarteira: 0 } };
    const { data, error } = await buscarTodasPaginas<any>((de, ate) => db.from('locacao_fichas_reserva')
      .select('id, empresa_id, status, modalidade, data_inicio, data_fim, valor_total, vendedor_nome, validade_orcamento, updated_at, created_at, p2s_numero, p2s_status, origem, motivo_perda, desconto_pct, desconto_aprovado_pct, parceiro_id, parceiro:parceiros(id, nome_exibicao, nome_completo), evento:eventos_feiras(id, nome)')
      .in('empresa_id', empresas.map(e => e.id))
      .order('data_inicio', { ascending: false }).order('id', { ascending: false }).range(de, ate), 1000, 8000);
    if (error) throw error;
    const fichas = data.filter(f => !carteira || carteira.has(f.parceiro_id)).map(f => ({
      ...f,
      cliente: f.parceiro ? (f.parceiro.nome_exibicao || f.parceiro.nome_completo) : '—',
      evento_nome: f.evento?.nome || null,
      desconto_pendente: descontoPendente(f),
      parceiro: undefined, evento: undefined,
    }));
    return { ok: true, info: { empresas, fichas, acesso, clientesCarteira: carteira ? carteira.size : null, ultimaImportacaoP2s: await ultimaImportacaoFichasP2s(db) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CARREGAR / CONTEXTO DE NOVA FICHA
// ============================================================================
export async function contextoNovaFichaAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeCriar) return { ok: false, erro: SEM_PERMISSAO.criar };
  try {
    return {
      ok: true,
      info: {
        empresas: await empresasVisiveis(ctx.permitidas), usuario: ctx.perfil.nome,
        acesso: acessoParaTela(ctx.acesso),
        vendedores: ctx.acesso.escopo === 'TODAS' ? await vendedoresAtivos(supabaseAdmin()) : [],
        regrasComissao: await regrasParaTela(ctx.acesso),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function carregarFichaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const atual = await fichaDoUsuario(id, ctx);
    if ('erro' in atual) return { ok: false, erro: atual.erro };
    const f = atual.ficha;

    const [rItens, rParc, rEv, rHist, rAloc, vendedores, donos] = await Promise.all([
      db.from('locacao_fichas_reserva_itens')
        .select('*, produto:produtos(nome_item, codigo_formatado, unidade, controle_locacao)').eq('ficha_id', id).order('ordem'),
      db.from('parceiros').select('id, nome_exibicao, nome_completo, cidade1, estado1').eq('id', f.parceiro_id).maybeSingle(),
      f.evento_id ? db.from('eventos_feiras').select('id, nome, data_inicial, data_final, local').eq('id', f.evento_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      db.from('locacao_fichas_reserva_historico').select('*').eq('ficha_id', id).order('criado_em', { ascending: false }).limit(100),
      db.from('locacao_alocacoes').select('ficha_item_id, produto_id, quantidade, status, patrimonio:locacao_patrimonios(numero_patrimonio)')
        .eq('ficha_id', id).in('status', ['RESERVADO', 'LOCADO']),
      vendedoresAtivos(db),
      donosCarteira(db, [f.parceiro_id]),
    ]);
    for (const r of [rItens, rParc, rEv, rHist, rAloc] as any[]) if (r.error) throw r.error;

    const p = rParc.data as any;
    const ev = rEv.data as any;
    const dono = donos.get(f.parceiro_id) ?? null;
    const leds = await especLed((rItens.data || []).map((i: any) => i.produto_id));
    return {
      ok: true,
      info: {
        empresas: await empresasVisiveis(ctx.permitidas),
        usuario: ctx.perfil.nome,
        acesso: acessoParaTela(ctx.acesso),
        vendedores: ctx.acesso.escopo === 'TODAS' ? vendedores : [],
        regrasComissao: await regrasParaTela(ctx.acesso),
        carteira: dono ? { vendedor_id: dono, nome: vendedores.find(v => v.id === dono)?.nome || `#${dono}` } : null,
        descontoPendente: descontoPendente(f),
        ficha: f,
        itens: (rItens.data || []).map((i: any) => ({
          ...i, produto: undefined,
          produto_nome: i.produto?.nome_item || null, produto_codigo: i.produto?.codigo_formatado || null,
          produto_unidade: i.produto?.unidade || null, produto_controle: i.produto?.controle_locacao || null,
          led_espec: i.produto_id ? leds.get(i.produto_id) || null : null,
        })),
        cliente: p ? { id: p.id, nome: p.nome_exibicao || p.nome_completo, detalhe: [p.cidade1, p.estado1].filter(Boolean).join('/') } : null,
        evento: ev ? { id: ev.id, nome: ev.nome, detalhe: [ev.data_inicial?.split('-').reverse().join('/'), ev.local].filter(Boolean).join(' · '), extra: ev } : null,
        historico: rHist.data || [],
        alocacoes: (rAloc.data || []).map((a: any) => ({ ficha_item_id: a.ficha_item_id, produto_id: a.produto_id, quantidade: num(a.quantidade), status: a.status, patrimonio: a.patrimonio?.numero_patrimonio || null })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// BUSCAS / PREÇO / DISPONIBILIDADE (apoio ao editor)
// ============================================================================
export async function buscarClientesFichaAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const lista = await buscarClientes(db, texto);
    const [donos, vendedores] = await Promise.all([donosCarteira(db, lista.map(c => Number(c.id))), vendedoresAtivos(db)]);
    const nomeVend = new Map(vendedores.map(v => [v.id, v.nome]));
    const meu = ctx.acesso.vendedorId;
    const info = lista
      // vendedor padrão não vê (nem escolhe) cliente da carteira de outro vendedor
      .filter(c => ctx.acesso.escopo === 'TODAS' || !donos.has(Number(c.id)) || donos.get(Number(c.id)) === meu)
      .map(c => {
        const dono = donos.get(Number(c.id)) ?? null;
        const carteira = dono ? (dono === meu ? 'sua carteira' : `carteira: ${nomeVend.get(dono) || `#${dono}`}`) : 'sem carteira';
        return { ...c, detalhe: [c.detalhe, carteira].filter(Boolean).join(' · '), extra: { ...(c.extra || {}), carteira_vendedor_id: dono, carteira_nome: dono ? nomeVend.get(dono) || null : null } };
      });
    return { ok: true, info };
  } catch (e: any) { return { ok: false, erro: e.message }; }
}
export async function buscarEventosFichaAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try { return { ok: true, info: await buscarEventos(supabaseAdmin(), texto) }; } catch (e: any) { return { ok: false, erro: e.message }; }
}
export async function buscarProdutosFichaAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const prods = await buscarProdutosLocaveis(supabaseAdmin(), texto);
    // marca quais são kit (têm componentes)
    const ids = prods.map((p: any) => p.id);
    const { data: kits } = ids.length ? await supabaseAdmin().from('locacao_kit_itens').select('kit_produto_id').in('kit_produto_id', ids) : { data: [] };
    const setKits = new Set((kits || []).map((k: any) => k.kit_produto_id));
    const leds = await especLed(ids);
    return { ok: true, info: prods.map((p: any) => ({ ...p, eh_kit: setKits.has(p.id), led: leds.get(p.id) || null })) };
  } catch (e: any) { return { ok: false, erro: e.message }; }
}

export async function precificarFichaAction(
  args: { empresa_id: number; parceiro_id?: number | null; evento_id?: string | null; data_inicio: string; modalidade: Modalidade; itens: { chave: string; produto_id: number; dias: number }[] },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, args.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  if (!dataValida(args.data_inicio)) return { ok: false, erro: 'Informe a data de início do evento para calcular o preço.' };
  try {
    const r = await precificarItens(supabaseAdmin(), {
      empresaId: args.empresa_id, parceiroId: args.parceiro_id, eventoId: args.evento_id, dataRef: args.data_inicio,
      modalidade: args.modalidade, itens: args.itens,
    });
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function verificarDisponibilidadeFichaAction(
  args: { ficha_id?: number | null; empresa_id: number; datas: DatasFicha; itens: ItemDemanda[] },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, args.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const erroDatas = validarDatas(args.datas);
  if (erroDatas) return { ok: false, erro: erroDatas };
  try {
    const r = await verificarDisponibilidade(supabaseAdmin(), {
      empresaId: args.empresa_id, datas: limparDatas(args.datas), ignorarFichaId: args.ficha_id || null,
      itens: args.itens.filter(i => i.produto_id && num(i.quantidade) > 0),
    });
    return { ok: true, info: { linhas: r.linhas, temFalta: r.temFalta } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// SALVAR
// ============================================================================
export interface ItemFichaEntrada {
  id?: number | null;
  tipo: TipoItem;
  produto_id?: number | null;
  descricao: string;
  quantidade: number;
  dias?: number | null;
  valor_unitario: number;
  desconto_valor: number;
  origem_preco?: unknown;
  preco_manual: boolean;
  observacoes?: string | null;
  led_largura_m?: number | null;   // painel de LED: medida pedida (m)
  led_altura_m?: number | null;
}

export interface DadosFicha {
  id?: number | null;
  empresa_id: number;
  modalidade: Modalidade;
  parceiro_id: number | null;
  contato_nome?: string | null;
  contato_telefone?: string | null;
  contato_email?: string | null;
  evento_id?: string | null;
  tabela_preco_id?: number | null;
  vendedor_id?: number | null;
  vendedor_nome?: string | null;
  local_entrega?: string | null;
  endereco_estande?: string | null;
  data_saida?: string | null;
  data_montagem?: string | null;
  data_inicio: string;
  data_fim: string;
  data_desmontagem?: string | null;
  data_retorno?: string | null;
  dias_cobrados?: number | null;
  validade_orcamento?: string | null;
  condicao_pagamento?: string | null;
  forma_pagamento?: string | null;
  observacoes?: string | null;
  observacoes_internas?: string | null;
  desconto_valor: number;
  itens: ItemFichaEntrada[];
}

function limparDatas(d: DatasFicha): DatasFicha {
  return {
    data_saida: dataOuNull(d.data_saida), data_montagem: dataOuNull(d.data_montagem),
    data_inicio: d.data_inicio, data_fim: d.data_fim,
    data_desmontagem: dataOuNull(d.data_desmontagem), data_retorno: dataOuNull(d.data_retorno),
  };
}

function validarDatas(d: DatasFicha): string | null {
  if (!dataValida(d.data_inicio) || !dataValida(d.data_fim)) return 'Informe o início e o fim do evento.';
  if (d.data_fim < d.data_inicio) return 'O fim do evento é anterior ao início.';
  const ini = d.data_inicio, fim = d.data_fim;
  if (dataValida(d.data_saida) && d.data_saida! > ini) return 'A saída precisa ser no início do evento ou antes.';
  if (dataValida(d.data_montagem) && d.data_montagem! > ini) return 'A montagem precisa ser no início do evento ou antes.';
  if (dataValida(d.data_saida) && dataValida(d.data_montagem) && d.data_saida! > d.data_montagem!) return 'A saída precisa ser na montagem ou antes.';
  if (dataValida(d.data_desmontagem) && d.data_desmontagem! < fim) return 'A desmontagem precisa ser no fim do evento ou depois.';
  if (dataValida(d.data_retorno) && d.data_retorno! < fim) return 'O retorno precisa ser no fim do evento ou depois.';
  if (dataValida(d.data_retorno) && dataValida(d.data_desmontagem) && d.data_retorno! < d.data_desmontagem!) return 'O retorno precisa ser na desmontagem ou depois.';
  if (diasInclusivos(ini, fim) > 3660) return 'Período longo demais.';
  return null;
}

export async function salvarFichaAction(dados: DadosFicha, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (dados.id ? !ctx.acesso.podeEditar : !ctx.acesso.podeCriar) return { ok: false, erro: dados.id ? SEM_PERMISSAO.editar : SEM_PERMISSAO.criar };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  if (!dados.parceiro_id) return { ok: false, erro: 'Escolha o cliente.' };
  if (!['DIARIA', 'PERIODO', 'MENSAL'].includes(dados.modalidade)) return { ok: false, erro: 'Modalidade inválida.' };
  if (dados.forma_pagamento && !(FORMAS_PAGAMENTO as readonly string[]).includes(dados.forma_pagamento)) return { ok: false, erro: 'Forma de pagamento inválida.' };
  const erroDatas = validarDatas(dados);
  if (erroDatas) return { ok: false, erro: erroDatas };

  // Itens: valida e recalcula totais no servidor
  const itens = (dados.itens || []).map((i, idx) => {
    const quantidade = num(i.quantidade), vu = arred(num(i.valor_unitario)), desc = arred(num(i.desconto_valor));
    return {
      id: i.id || null, ordem: idx, tipo: i.tipo, produto_id: i.produto_id || null,
      descricao: (i.descricao || '').trim(), quantidade, dias: i.dias ? Math.max(1, Math.floor(num(i.dias))) : null,
      valor_unitario: vu, desconto_valor: desc, valor_total: arred(quantidade * vu - desc),
      origem_preco: i.origem_preco ?? null, preco_manual: !!i.preco_manual, alterado_por: i.preco_manual ? ctx.perfil.nome : null,
      observacoes: txt(i.observacoes),
      led_largura_m: num(i.led_largura_m) > 0 ? Math.round(num(i.led_largura_m) * 100) / 100 : null,
      led_altura_m: num(i.led_altura_m) > 0 ? Math.round(num(i.led_altura_m) * 100) / 100 : null,
    };
  });
  for (const i of itens) {
    if (!['EQUIPAMENTO', 'KIT', 'SERVICO', 'FRETE', 'OUTRO'].includes(i.tipo)) return { ok: false, erro: 'Tipo de item inválido.' };
    if (!i.descricao) return { ok: false, erro: 'Há item sem descrição.' };
    if (!(i.quantidade > 0)) return { ok: false, erro: `Quantidade inválida em "${i.descricao}".` };
    if (['EQUIPAMENTO', 'KIT'].includes(i.tipo) && !i.produto_id) return { ok: false, erro: `"${i.descricao}" precisa de um produto.` };
    if (i.valor_unitario < 0 || i.desconto_valor < 0) return { ok: false, erro: `Valor negativo em "${i.descricao}".` };
    if (i.valor_total < 0) return { ok: false, erro: `O desconto de "${i.descricao}" passa do valor do item.` };
  }
  const ehEquip = (t: string) => t === 'EQUIPAMENTO' || t === 'KIT';
  const valorEquip = arred(itens.filter(i => ehEquip(i.tipo)).reduce((s, i) => s + i.valor_total, 0));
  const valorServ = arred(itens.filter(i => !ehEquip(i.tipo)).reduce((s, i) => s + i.valor_total, 0));
  const desconto = arred(num(dados.desconto_valor));
  if (desconto < 0) return { ok: false, erro: 'Desconto inválido.' };
  const total = arred(valorEquip + valorServ - desconto);
  if (total < 0) return { ok: false, erro: 'O desconto passa do valor da ficha.' };

  const db = supabaseAdmin();
  try {
    let statusAtual: StatusFicha = 'ORCAMENTO';
    let fichaAtual: any = null;
    if (dados.id) {
      const atual = await fichaDoUsuario(dados.id, ctx);
      if ('erro' in atual) return { ok: false, erro: atual.erro };
      fichaAtual = atual.ficha;
      if (atual.ficha.origem === 'P2S') return { ok: false, erro: 'Ficha importada do P2S — altere no PrimeStart (aqui é só leitura). Use Duplicar para simular uma cópia.' };
      statusAtual = atual.ficha.status;
      if (!EDITAVEIS.includes(statusAtual)) return { ok: false, erro: 'Esta ficha não pode mais ser editada (perdida, cancelada ou já em locação).' };
      if (atual.ficha.empresa_id !== dados.empresa_id && statusAtual === 'RESERVADA') return { ok: false, erro: 'Desfaça a reserva antes de trocar a empresa da ficha.' };
    }

    // Carteira: vendedor padrão só atende cliente dele (ou sem carteira)
    const atende = await podeAtenderCliente(db, ctx.acesso, dados.parceiro_id);
    if (!atende.ok) return { ok: false, erro: atende.erro };

    // Vendedor da ficha (é quem recebe a comissão): vendedor padrão = ele
    // mesmo; gestão escolhe (padrão: dono da carteira do cliente).
    const vendedores = await vendedoresAtivos(db);
    let vendedorId: number | null = ctx.acesso.escopo === 'CARTEIRA'
      ? ctx.acesso.vendedorId
      : (dados.vendedor_id ?? atende.dono ?? ctx.acesso.vendedorId ?? null);
    if (vendedorId && !vendedores.some(v => v.id === vendedorId)) {
      // vendedor que saiu: mantém o que a ficha já tinha, não aceita novo
      if (vendedorId !== fichaAtual?.vendedor_id) return { ok: false, erro: 'Vendedor inválido ou inativo.' };
    }
    const vendedorNome = vendedorId ? (vendedores.find(v => v.id === vendedorId)?.nome || fichaAtual?.vendedor_nome || null) : (txt(dados.vendedor_nome) || ctx.perfil.nome);
    if (!vendedorId) vendedorId = null;

    const datas = limparDatas(dados);
    const diasCob = dados.dias_cobrados ? Math.max(1, Math.floor(num(dados.dias_cobrados))) : diasInclusivos(datas.data_inicio, datas.data_fim);

    // Desconto contra a tabela; acima do limite do usuário fica pendente de aprovação
    const desc = await calcularDescontoPct(db, {
      empresaId: dados.empresa_id, parceiroId: dados.parceiro_id, eventoId: dados.evento_id || null, dataInicio: datas.data_inicio,
      modalidade: dados.modalidade, diasCobrados: diasCob, total,
      itens: itens.map(i => ({ tipo: i.tipo, produto_id: i.produto_id, quantidade: i.quantidade, dias: i.dias, valor_unitario: i.valor_unitario })),
    });
    const aprovadoAntes = Number(fichaAtual?.desconto_aprovado_pct) || 0;
    let camposDesconto: Record<string, unknown> = { desconto_pct: desc.pct };
    let descontoAguardando = false;
    if (desc.pct > aprovadoAntes + 0.005) {
      if (descontoAutoAprovado(ctx.acesso, desc.pct)) {
        camposDesconto = { ...camposDesconto, desconto_aprovado_pct: desc.pct, desconto_aprovado_por: ctx.perfil.nome, desconto_aprovado_em: new Date().toISOString() };
      } else if (statusAtual === 'RESERVADA') {
        return { ok: false, erro: `Desconto de ${pctTxt(desc.pct)} passa do seu limite (${pctTxt(ctx.acesso.descontoMaxPct)}) e a ficha já está reservada. Peça a quem aprova desconto para fazer a alteração.` };
      } else {
        descontoAguardando = true;
      }
    }
    // Ficha reservada: a mudança não pode criar falta (confere ANTES de gravar).
    if (statusAtual === 'RESERVADA') {
      const verif = await verificarDisponibilidade(db, {
        empresaId: dados.empresa_id, datas, ignorarFichaId: dados.id!,
        itens: itens.filter(i => ehEquip(i.tipo) && i.produto_id).map(i => ({ produto_id: i.produto_id!, quantidade: i.quantidade })),
      });
      if (verif.temFalta) return { ok: false, erro: 'Com essas mudanças vai faltar equipamento — a ficha está reservada. Ajuste ou desfaça a reserva.', info: { faltas: verif.linhas.filter(l => l.falta > 0) } };
    }

    const cabecalho = {
      empresa_id: dados.empresa_id, modalidade: dados.modalidade, parceiro_id: dados.parceiro_id,
      contato_nome: txt(dados.contato_nome), contato_telefone: txt(dados.contato_telefone), contato_email: txt(dados.contato_email),
      evento_id: dados.evento_id || null, tabela_preco_id: dados.tabela_preco_id || null,
      vendedor_id: vendedorId, vendedor_nome: vendedorNome,
      ...camposDesconto,
      local_entrega: txt(dados.local_entrega), endereco_estande: txt(dados.endereco_estande),
      ...datas,
      dias_cobrados: diasCob,
      validade_orcamento: dataOuNull(dados.validade_orcamento), condicao_pagamento: txt(dados.condicao_pagamento), forma_pagamento: dados.forma_pagamento || null,
      observacoes: txt(dados.observacoes), observacoes_internas: txt(dados.observacoes_internas),
      valor_equipamentos: valorEquip, valor_servicos: valorServ, desconto_valor: desconto, valor_total: total,
      updated_at: new Date().toISOString(),
      // muda só aqui (não em troca de status) — a proposta enviada guarda esta
      // versão para a tela avisar quando ficou desatualizada
      conteudo_alterado_em: new Date().toISOString(),
    };

    let fichaId: number;
    if (dados.id) {
      fichaId = dados.id;
      const { error } = await db.from('locacao_fichas_reserva').update(cabecalho).eq('id', fichaId);
      if (error) throw error;
    } else {
      const { data, error } = await db.from('locacao_fichas_reserva').insert({ ...cabecalho, status: 'ORCAMENTO', criado_por: ctx.perfil.nome }).select('id').single();
      if (error) throw error;
      fichaId = data.id;
    }

    // Itens: atualiza os que vieram com id, insere os novos, apaga os removidos.
    const { data: existentes } = await db.from('locacao_fichas_reserva_itens').select('id').eq('ficha_id', fichaId);
    const idsExistentes = new Set((existentes || []).map((x: any) => x.id));
    const manter = new Set(itens.filter(i => i.id && idsExistentes.has(i.id)).map(i => i.id!));
    const remover = [...idsExistentes].filter(id => !manter.has(id));
    if (remover.length) {
      const { error } = await db.from('locacao_fichas_reserva_itens').delete().in('id', remover);
      if (error) throw error;
    }
    for (const i of itens.filter(i => i.id && manter.has(i.id))) {
      const { id, ...resto } = i;
      const { error } = await db.from('locacao_fichas_reserva_itens').update(resto).eq('id', id!);
      if (error) throw error;
    }
    const novos = itens.filter(i => !i.id || !manter.has(i.id)).map(({ id: _id, ...resto }) => ({ ...resto, ficha_id: fichaId }));
    if (novos.length) {
      const { error } = await db.from('locacao_fichas_reserva_itens').insert(novos);
      if (error) throw error;
    }

    let aviso: string | null = null;
    if (statusAtual === 'RESERVADA') {
      const r = await reservarFicha(db, fichaId);
      if (!r.ok) {
        // a troca é atômica (locacao_trocar_reserva): falhou = a reserva ANTERIOR continua valendo
        aviso = `Itens salvos, mas a reserva não pôde ser refeita (${r.erro || (r.faltas || []).map(x => `${x.nome}: faltam ${x.falta}`).join(', ') || 'falta equipamento'}). A reserva anterior foi mantida — ajuste os itens ou tente de novo.`;
        await historico(fichaId, ctx.perfil.nome, 'RESERVA_NAO_REFEITA', aviso);
      }
    }

    // cliente sem carteira entra na carteira do vendedor da ficha
    if (atende.dono === null && vendedorId) await assumirClienteSemCarteira(db, dados.parceiro_id, vendedorId, ctx.perfil.nome);
    if (descontoAguardando) await historico(fichaId, ctx.perfil.nome, 'DESCONTO_PENDENTE', `Desconto de ${pctTxt(desc.pct)} sobre a tabela (limite do usuário: ${pctTxt(ctx.acesso.descontoMaxPct)}) — aguardando aprovação`);

    await historico(fichaId, ctx.perfil.nome, dados.id ? 'EDITOU' : 'CRIOU', `${itens.length} item(ns) · total ${formatarMoeda(total)}${desc.pct > 0 ? ` · desconto ${pctTxt(desc.pct)}` : ''}${statusAtual === 'RESERVADA' ? (aviso ? ' · reserva NÃO refeita (anterior mantida)' : ' · reserva refeita') : ''}`);
    log(ctx.perfil.nome, dados.id ? 'EDITOU FICHA DE RESERVA' : 'CRIOU FICHA DE RESERVA', `#${fichaId} · ${formatarMoeda(total)}`);
    const avisoDesconto = descontoAguardando ? `Desconto de ${pctTxt(desc.pct)} passa do seu limite (${pctTxt(ctx.acesso.descontoMaxPct)}): a ficha fica aguardando aprovação de desconto antes de enviar ou reservar.` : null;
    return { ok: true, info: { id: fichaId, aviso: [aviso, avisoDesconto].filter(Boolean).join(' ') || null } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// STATUS
// ============================================================================
const TRANSICOES: Record<AcaoStatus, { de: StatusFicha[]; para: StatusFicha; exigeMotivo?: boolean; rotulo: string }> = {
  ENVIAR: { de: ['ORCAMENTO'], para: 'ENVIADO', rotulo: 'Marcou como enviado ao cliente' },
  VOLTAR_ORCAMENTO: { de: ['ENVIADO', 'APROVADO'], para: 'ORCAMENTO', rotulo: 'Voltou para orçamento' },
  RESERVAR: { de: ['ORCAMENTO', 'ENVIADO', 'APROVADO'], para: 'RESERVADA', rotulo: 'Aprovado pelo cliente — equipamentos reservados' },
  DESFAZER_RESERVA: { de: ['RESERVADA'], para: 'ENVIADO', rotulo: 'Desfez a reserva (equipamentos liberados)' },
  PERDER: { de: ['ORCAMENTO', 'ENVIADO', 'APROVADO'], para: 'PERDIDO', exigeMotivo: true, rotulo: 'Orçamento perdido' },
  CANCELAR: { de: ['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA'], para: 'CANCELADA', exigeMotivo: true, rotulo: 'Ficha cancelada' },
  REABRIR: { de: ['PERDIDO', 'CANCELADA'], para: 'ORCAMENTO', rotulo: 'Reaberta como orçamento' },
};

export async function mudarStatusFichaAction(id: number, acao: AcaoStatus, motivo: string | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const regra = TRANSICOES[acao];
  if (!regra) return { ok: false, erro: 'Ação inválida.' };
  const ehExclusao = acao === 'PERDER' || acao === 'CANCELAR';
  if (ehExclusao ? !ctx.acesso.podeExcluir : !ctx.acesso.podeEditar) return { ok: false, erro: ehExclusao ? SEM_PERMISSAO.excluir : SEM_PERMISSAO.editar };
  const db = supabaseAdmin();
  try {
    const atual = await fichaDoUsuario(id, ctx);
    if ('erro' in atual) return { ok: false, erro: atual.erro };
    if (atual.ficha.origem === 'P2S') return { ok: false, erro: 'Ficha importada do P2S — o status muda no PrimeStart.' };
    const de = atual.ficha.status as StatusFicha;
    if (!regra.de.includes(de)) return { ok: false, erro: `Não dá para fazer isso com a ficha em "${de}".` };
    if (regra.exigeMotivo && !txt(motivo)) return { ok: false, erro: 'Informe o motivo.' };
    if ((acao === 'ENVIAR' || acao === 'RESERVAR') && descontoPendente(atual.ficha)) {
      return { ok: false, erro: `Desconto de ${pctTxt(Number(atual.ficha.desconto_pct))} aguardando aprovação. Peça a quem aprova desconto (ou reduza o desconto).` };
    }

    const extra: Record<string, unknown> = {};
    if (acao === 'RESERVAR') {
      const r = await reservarFicha(db, id);
      if (!r.ok) return { ok: false, erro: r.erro || 'Falta equipamento para reservar.', info: { faltas: r.faltas || [] } };
      extra.aprovado_em = new Date().toISOString();
      extra.aprovado_por = ctx.perfil.nome;
    }
    if (acao === 'DESFAZER_RESERVA' || acao === 'CANCELAR') await liberarReservaFicha(db, id);
    if (regra.exigeMotivo) extra.motivo_perda = txt(motivo);
    if (acao === 'REABRIR') extra.motivo_perda = null;

    const { error } = await db.from('locacao_fichas_reserva').update({ status: regra.para, ...extra, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await historico(id, ctx.perfil.nome, acao, [regra.rotulo, txt(motivo)].filter(Boolean).join(': '), de, regra.para);
    log(ctx.perfil.nome, `FICHA DE RESERVA: ${acao}`, `#${id} ${de} → ${regra.para}${motivo ? ` (${motivo})` : ''}`);
    return { ok: true, info: { status: regra.para } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function duplicarFichaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeCriar) return { ok: false, erro: SEM_PERMISSAO.criar };
  const db = supabaseAdmin();
  try {
    const atual = await fichaDoUsuario(id, ctx);
    if ('erro' in atual) return { ok: false, erro: atual.erro };
    const f = atual.ficha;
    const {
      id: _id, status: _s, aprovado_em: _a, aprovado_por: _ap, p2s_oid: _o, p2s_numero: _n, p2s_enviado_em: _e, p2s_erro: _pe,
      origem: _or, p2s_status: _ps, p2s_sincronizado_em: _psi,
      desconto_aprovado_pct: _dap, desconto_aprovado_por: _dapp, desconto_aprovado_em: _dae,
      motivo_perda: _m, created_at: _c, updated_at: _u, criado_por: _cp, ...copia
    } = f;
    const pct = Number(f.desconto_pct) || 0;
    const autoAprova = descontoAutoAprovado(ctx.acesso, pct);
    const { data: nova, error } = await db.from('locacao_fichas_reserva')
      .insert({
        ...copia, status: 'ORCAMENTO', criado_por: ctx.perfil.nome,
        // a cópia é do vendedor que duplicou quando ele é vendedor padrão
        ...(ctx.acesso.escopo === 'CARTEIRA' ? { vendedor_id: ctx.acesso.vendedorId, vendedor_nome: ctx.acesso.vendedorNome || f.vendedor_nome } : {}),
        ...(autoAprova && pct > 0 ? { desconto_aprovado_pct: pct, desconto_aprovado_por: ctx.perfil.nome, desconto_aprovado_em: new Date().toISOString() } : {}),
      }).select('id').single();
    if (error) throw error;
    const { data: itens } = await db.from('locacao_fichas_reserva_itens').select('*').eq('ficha_id', id).order('ordem');
    if (itens?.length) {
      const { error: eI } = await db.from('locacao_fichas_reserva_itens').insert(itens.map(({ id: _iid, ficha_id: _fid, ...r }: any) => ({ ...r, ficha_id: nova.id })));
      if (eI) throw eI;
    }
    await historico(nova.id, ctx.perfil.nome, 'CRIOU', `Cópia da ficha #${id}`);
    log(ctx.perfil.nome, 'DUPLICOU FICHA DE RESERVA', `#${id} → #${nova.id}`);
    return { ok: true, info: { id: nova.id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// DESCONTO ACIMA DO LIMITE / EXCLUIR
// ============================================================================
export async function aprovarDescontoFichaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeAprovarDesconto) return { ok: false, erro: SEM_PERMISSAO.aprovar };
  const db = supabaseAdmin();
  try {
    const atual = await fichaDoUsuario(id, ctx);
    if ('erro' in atual) return { ok: false, erro: atual.erro };
    const f = atual.ficha;
    if (!descontoPendente(f)) return { ok: true };
    const pct = Number(f.desconto_pct) || 0;
    const { error } = await db.from('locacao_fichas_reserva')
      .update({ desconto_aprovado_pct: pct, desconto_aprovado_por: ctx.perfil.nome, desconto_aprovado_em: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await historico(id, ctx.perfil.nome, 'DESCONTO_APROVADO', `Aprovou desconto de ${pctTxt(pct)} sobre a tabela`);
    log(ctx.perfil.nome, 'APROVOU DESCONTO DE FICHA', `#${id} · ${pctTxt(pct)}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Apaga de vez um orçamento que não andou (sem títulos, avarias nem proposta em aberto). */
export async function excluirFichaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeExcluir) return { ok: false, erro: SEM_PERMISSAO.excluir };
  const db = supabaseAdmin();
  try {
    const atual = await fichaDoUsuario(id, ctx);
    if ('erro' in atual) return { ok: false, erro: atual.erro };
    const f = atual.ficha;
    if (f.origem === 'P2S') return { ok: false, erro: 'Ficha importada do P2S não pode ser excluída aqui.' };
    if (!['ORCAMENTO', 'ENVIADO', 'PERDIDO', 'CANCELADA'].includes(f.status)) return { ok: false, erro: 'Só dá para excluir orçamento (ou ficha perdida/cancelada). Ficha reservada: cancele.' };
    const [tit, ava, prop] = await Promise.all([
      db.from('financeiro_titulos_receber').select('id', { count: 'exact', head: true }).eq('ficha_id', id),
      db.from('locacao_avarias').select('id', { count: 'exact', head: true }).eq('ficha_id', id),
      db.from('locacao_propostas').select('id, status, pdf_original_path, pdf_assinado_path').eq('ficha_id', id),
    ]);
    if ((tit.count || 0) > 0) return { ok: false, erro: 'A ficha tem títulos a receber — cancele a ficha em vez de excluir.' };
    if ((ava.count || 0) > 0) return { ok: false, erro: 'A ficha tem avaria registrada — cancele a ficha em vez de excluir.' };
    const propostas = (prop.data || []) as any[];
    if (propostas.some(p => ['ENVIADO', 'VISUALIZADO', 'ASSINADO'].includes(p.status))) return { ok: false, erro: 'Há proposta enviada/assinada — cancele a proposta (ou a ficha) em vez de excluir.' };

    await db.from('cliente_portal_solicitacoes').update({ ficha_id: null, status: 'EM_ATENDIMENTO' }).eq('ficha_id', id);
    const arquivos = propostas.flatMap(p => [p.pdf_original_path, p.pdf_assinado_path]).filter(Boolean);
    if (arquivos.length) await db.storage.from(BUCKET_PROPOSTAS).remove(arquivos);
    await liberarReservaFicha(db, id);
    const { error } = await db.from('locacao_fichas_reserva').delete().eq('id', id);
    if (error) throw error;
    log(ctx.perfil.nome, 'EXCLUIU FICHA DE RESERVA', `#${id} (${f.status}) · ${formatarMoeda(Number(f.valor_total) || 0)}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// IMPORTAR FICHAS DO P2S (somente leitura aqui; ocupam a agenda)
// ============================================================================
export async function importarFichasP2sAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (ctx.acesso.escopo !== 'TODAS') return { ok: false, erro: 'Só quem vê todas as fichas pode importar do P2S.' };
  try {
    const r = await importarFichasP2sCore(supabaseAdmin());
    log(ctx.perfil.nome, 'IMPORTOU FICHAS DE RESERVA DO P2S', `${r.gravadas} fichas (${r.ocupandoAgenda} ocupando agenda), ${r.itens} itens, ${r.alocacoes} alocações${r.puladas.length ? `, ${r.puladas.length} puladas` : ''}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PEDIDOS DE ORÇAMENTO DO PORTAL DO CLIENTE (cliente_portal_solicitacoes)
// ============================================================================
export async function listarSolicitacoesPortalAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('cliente_portal_solicitacoes')
      .select('*, cliente:parceiros(nome_exibicao, nome_completo)').in('status', ['NOVA', 'EM_ATENDIMENTO'])
      .order('criado_em', { ascending: false }).limit(200);
    if (error) throw error;
    let lista = (data || []) as any[];
    if (ctx.acesso.escopo === 'CARTEIRA') {
      // vendedor padrão: pedidos dos clientes dele e dos sem carteira
      const donos = await donosCarteira(db, lista.map(s => s.parceiro_id).filter(Boolean));
      lista = lista.filter(s => s.parceiro_id && (!donos.has(s.parceiro_id) || donos.get(s.parceiro_id) === ctx.acesso.vendedorId));
    }
    return { ok: true, info: lista.map((s: any) => ({ ...s, cliente: undefined, cliente_nome: s.cliente?.nome_exibicao || s.cliente?.nome_completo || '—' })) };
  } catch (e: any) {
    // tabela ainda não criada (SQL do portal não rodou) — não quebra a tela
    return { ok: true, info: [] };
  }
}

export async function atualizarSolicitacaoPortalAction(id: number, status: 'EM_ATENDIMENTO' | 'DESCARTADA', accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!['EM_ATENDIMENTO', 'DESCARTADA'].includes(status)) return { ok: false, erro: 'Status inválido.' };
  const db = supabaseAdmin();
  const { data: s } = await db.from('cliente_portal_solicitacoes').select('parceiro_id').eq('id', id).maybeSingle();
  if (!s) return { ok: false, erro: 'Pedido não encontrado.' };
  if (ctx.acesso.escopo === 'CARTEIRA' && s.parceiro_id) {
    const at = await podeAtenderCliente(db, ctx.acesso, s.parceiro_id);
    if (!at.ok) return { ok: false, erro: at.erro };
  }
  const { error } = await db.from('cliente_portal_solicitacoes')
    .update({ status, atendida_por: ctx.perfil.nome, atendida_em: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/** Cria uma Ficha de Reserva (orçamento) a partir do pedido do portal. */
export async function converterSolicitacaoPortalAction(id: number, empresaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, empresaId)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  if (!ctx.acesso.podeCriar) return { ok: false, erro: SEM_PERMISSAO.criar };
  const db = supabaseAdmin();
  try {
    const { data: s } = await db.from('cliente_portal_solicitacoes').select('*').eq('id', id).maybeSingle();
    if (!s) return { ok: false, erro: 'Pedido não encontrado.' };
    if (!s.parceiro_id) return { ok: false, erro: 'Pedido sem cliente.' };
    const atende = await podeAtenderCliente(db, ctx.acesso, s.parceiro_id);
    if (!atende.ok) return { ok: false, erro: atende.erro };
    if (s.ficha_id) return { ok: true, info: { id: s.ficha_id } };
    const vendedores = await vendedoresAtivos(db);
    const vendedorId = ctx.acesso.escopo === 'CARTEIRA' ? ctx.acesso.vendedorId : (atende.dono ?? ctx.acesso.vendedorId ?? null);
    const vendedorNome = vendedorId ? vendedores.find(v => v.id === vendedorId)?.nome || ctx.perfil.nome : ctx.perfil.nome;
    const inicio = s.data_inicio || s.data_fim;
    const fim = s.data_fim || s.data_inicio;
    if (!inicio || !fim) return { ok: false, erro: 'O pedido veio sem datas — combine com o cliente e crie o orçamento manualmente.' };
    const { data: f, error } = await db.from('locacao_fichas_reserva').insert({
      empresa_id: empresaId, status: 'ORCAMENTO', modalidade: 'DIARIA', parceiro_id: s.parceiro_id,
      contato_nome: s.contato_nome, contato_telefone: s.contato_telefone, contato_email: s.email,
      local_entrega: s.local, data_inicio: inicio, data_fim: fim, dias_cobrados: diasInclusivos(inicio, fim),
      vendedor_id: vendedorId, vendedor_nome: vendedorNome, criado_por: ctx.perfil.nome,
      observacoes_internas: `Pedido do Portal do Cliente #${s.id}${s.evento ? ` — evento: ${s.evento}` : ''}\n\nPedido:\n${s.itens}${s.observacoes ? `\n\nObservações do cliente:\n${s.observacoes}` : ''}`,
      conteudo_alterado_em: new Date().toISOString(),
    }).select('id').single();
    if (error) throw error;
    await db.from('cliente_portal_solicitacoes').update({ status: 'ORCADA', ficha_id: f.id, atendida_por: ctx.perfil.nome, atendida_em: new Date().toISOString() }).eq('id', id);
    if (atende.dono === null && vendedorId) await assumirClienteSemCarteira(db, s.parceiro_id, vendedorId, ctx.perfil.nome);
    await historico(f.id, ctx.perfil.nome, 'CRIOU', `A partir do pedido #${s.id} do Portal do Cliente (${s.email})`);
    log(ctx.perfil.nome, 'CONVERTEU PEDIDO DO PORTAL EM ORÇAMENTO', `pedido #${s.id} → #${f.id}`);
    return { ok: true, info: { id: f.id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
