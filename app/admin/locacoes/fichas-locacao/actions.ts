'use server';

// app/admin/locacoes/fichas-locacao/actions.ts
// Ficha de Locação própria (2026-11-20) — telas /admin/locacoes/fichas-locacao
// e o painel do editor da Ficha de Reserva. Regras em app/lib/locacao/fichaLocacao.ts.
// Lista também as fichas de locação do P2S (histórico importado, só leitura).
// Acesso: rota da tela OU de Orçamentos e Reservas (o painel mora lá) — hoje
// as duas são só do Administrador (decisão do usuário, 2026-11-20).
// Prorrogação e complemento são do COMERCIAL (envolvem custo): partem da OS
// e exigem permissão de editar fichas. Extravio é automático (sem entrada no
// estoque ao encerrar o retorno) e gera a cobrança de reposição.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { acessoLocacao, podeVerCliente, clientesDaCarteira, MSG_FICHA_FORA_CARTEIRA, type AcessoLocacao } from '../../../lib/locacao/acessoFichas';
import {
  abrirFichaLocacao, saldosDaFicha, registrarMovimento, registrarTroca, encerrarFichaLocacao, prorrogarLocacao, complementarLocacao,
  sincronizarPrevistosSemMovimento, fichasLocacaoDaReserva, extraviarPendentes, type LinhaMovimento,
} from '../../../lib/locacao/fichaLocacao';
import { gerarOsLocacaoPdf, type ItemOs } from '../../../lib/locacao/gerarOsLocacaoPdf';
import { buscarProdutosLocaveis } from '../../../lib/locacao/buscas';
import { numeroFichaPorId } from '../../../lib/locacao/fichaNumero';
import { formatarDocumento } from '../../../lib/locacao/pdfBase';
import { hojeISO, lerDaterange } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTAS = ['/admin/locacoes/fichas-locacao', '/admin/locacoes/reservas'];
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nomeParceiro = (p: any) => (p ? (p.nome_exibicao || p.nome_completo || '—') : '—');

async function contexto(accessToken: string) {
  const v = await validarAcessoAlgumaRota(accessToken, ROTAS);
  if (!v.ok) return { erro: v.message } as const;
  const db = supabaseAdmin();
  const [permitidas, acesso] = await Promise.all([obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada), acessoLocacao(db, v.perfil)]);
  return { perfil: v.perfil, permitidas, acesso, db } as const;
}
type Ctx = { permitidas: number[] | null; acesso: AcessoLocacao; db: ReturnType<typeof supabaseAdmin> };

async function fichaVisivel(ctx: Ctx, flId: number) {
  const { data: fl, error } = await ctx.db.from('locacao_fichas_locacao').select('*').eq('id', flId).maybeSingle();
  if (error) throw error;
  if (!fl) return { erro: 'Ficha de locação não encontrada.' } as const;
  if (!empresaPermitida(ctx.permitidas, fl.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  if (fl.parceiro_id && !(await podeVerCliente(ctx.db, ctx.acesso, fl.parceiro_id))) return { erro: MSG_FICHA_FORA_CARTEIRA } as const;
  return { fl: fl as any } as const;
}

async function reservaVisivel(ctx: Ctx, reservaId: number) {
  const { data: r } = await ctx.db.from('locacao_fichas_reserva').select('id, empresa_id, parceiro_id, origem, status').eq('id', reservaId).maybeSingle();
  if (!r) return { erro: 'Ficha de reserva não encontrada.' } as const;
  if (!empresaPermitida(ctx.permitidas, r.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  if (!(await podeVerCliente(ctx.db, ctx.acesso, r.parceiro_id))) return { erro: MSG_FICHA_FORA_CARTEIRA } as const;
  return { reserva: r as any } as const;
}

function log(usuario: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: usuario, acao, setor: 'LOCACOES', equipamento_nome: detalhe });
}

// ============================================================================
// LISTA
// ============================================================================
export async function listarFichasLocacaoAction(filtros: { origem: 'SISTEMA' | 'P2S' | 'TODAS'; status: '' | 'A' | 'F'; busca: string; pagina: number }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = ctx.db;
  try {
    const POR_PAGINA = 100;
    let carteira: number[] | null = null;
    if (ctx.acesso.escopo === 'CARTEIRA') carteira = await clientesDaCarteira(db, ctx.acesso.vendedorId);

    let q = db.from('locacao_fichas_locacao')
      .select('id, numero, origem, status, letra, data_saida, data_devolucao, empresa_id, ficha_reserva_id, criado_em, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(nome), reserva:locacao_fichas_reserva(id, data_inicio, data_fim, p2s_numero)', { count: 'exact' });
    if (filtros.origem !== 'TODAS') q = q.eq('origem', filtros.origem);
    if (filtros.status) q = q.eq('status', filtros.status);
    if (ctx.permitidas !== null) q = q.in('empresa_id', ctx.permitidas.length ? ctx.permitidas : [0]);
    if (carteira) q = q.in('parceiro_id', carteira.length ? carteira.slice(0, 1000) : [0]);
    const busca = (filtros.busca || '').trim();
    if (busca) {
      const t = busca.replace(/[%,()]/g, ' ');
      const { data: parc } = await db.from('parceiros').select('id').or(`nome_exibicao.ilike.%${t}%,nome_completo.ilike.%${t}%`).limit(200);
      const ids = ((parc || []) as any[]).map(p => p.id);
      q = q.or([`numero.ilike.%${t}%`, ids.length ? `parceiro_id.in.(${ids.join(',')})` : null].filter(Boolean).join(','));
    }
    const pagina = Math.max(0, Math.floor(n(filtros.pagina)));
    const { data, error, count } = await q.order('origem', { ascending: false }).order('status').order('data_saida', { ascending: false, nullsFirst: true })
      .order('id', { ascending: false }).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
    if (error) throw error;

    // próprias abertas: o que está com o cliente e se atrasou
    const hoje = hojeISO();
    const proprias = ((data || []) as any[]).filter(f => f.origem === 'SISTEMA' && f.status === 'A');
    const comCliente = new Map<number, number>();
    for (const f of proprias) comCliente.set(f.id, (await saldosDaFicha(db, f.id)).reduce((s, x) => s + x.fora, 0));

    // indicadores (todas as páginas)
    const base = () => {
      let b = db.from('locacao_fichas_locacao').select('id', { count: 'exact', head: true });
      if (ctx.permitidas !== null) b = b.in('empresa_id', ctx.permitidas.length ? ctx.permitidas : [0]);
      return b;
    };
    const [abertasProprias, abertasP2s] = await Promise.all([
      base().eq('origem', 'SISTEMA').eq('status', 'A'),
      base().eq('origem', 'P2S').eq('status', 'A'),
    ]);

    return {
      ok: true,
      info: {
        total: count || 0, porPagina: POR_PAGINA,
        indicadores: { abertasProprias: abertasProprias.count || 0, abertasP2s: abertasP2s.count || 0 },
        fichas: ((data || []) as any[]).map(f => {
          const fora = comCliente.get(f.id) ?? null;
          return {
            id: f.id, numero: f.numero, origem: f.origem, status: f.status, empresa_id: f.empresa_id,
            cliente: nomeParceiro(f.parceiro), evento: f.evento?.nome || null,
            os: f.origem === 'SISTEMA' && f.ficha_reserva_id ? numeroFichaPorId(f.ficha_reserva_id) : (f.reserva?.p2s_numero || null),
            reserva_id: f.ficha_reserva_id, saida: f.data_saida, devolucao: f.data_devolucao,
            inicio: f.reserva?.data_inicio || null, fim: f.reserva?.data_fim || null,
            com_cliente: fora, atrasada: f.origem === 'SISTEMA' && f.status === 'A' && !!fora && !!f.reserva?.data_fim && f.reserva.data_fim < hoje,
          };
        }),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// DETALHE
// ============================================================================
export async function carregarFichaLocacaoAction(flId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = ctx.db;
  try {
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    if (v.fl.origem === 'SISTEMA') await sincronizarPrevistosSemMovimento(db, flId);
    const fl = (await db.from('locacao_fichas_locacao').select('*').eq('id', flId).single()).data as any;

    const [rRes, rParc, rEv, rMov, rComp, rEmp, rExtras] = await Promise.all([
      fl.ficha_reserva_id ? db.from('locacao_fichas_reserva').select('*').eq('id', fl.ficha_reserva_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      fl.parceiro_id ? db.from('parceiros').select('id, nome_exibicao, nome_completo, cnpj, cpf').eq('id', fl.parceiro_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      fl.evento_id ? db.from('eventos_feiras').select('id, nome, local').eq('id', fl.evento_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      db.from('locacao_fichas_locacao_movimentos')
        .select('id, tipo, data_movimentacao, produto_id, quantidade, troca, usuario, observacoes, ficha_locacao_item_id, comprovante_id, valor_indenizacao, avaria_id, criado_em, patrimonio:locacao_patrimonios(numero_patrimonio), produto:produtos(nome_item, codigo_formatado)')
        .eq('ficha_locacao_id', flId).order('data_movimentacao', { ascending: false }).order('id', { ascending: false }).limit(2000),
      db.from('locacao_comprovantes').select('id, tipo, data, registrado_por, recebedor_nome, recebedor_documento, assinado_em, observacoes, criado_em').eq('ficha_locacao_id', flId).order('criado_em', { ascending: false }),
      db.from('empresas').select('id, nome, nome_curto').eq('id', fl.empresa_id).maybeSingle(),
      db.from('locacao_fichas_locacao_extras').select('descricao, quantidade, valor_final').eq('ficha_locacao_id', flId),
    ]);
    for (const r of [rRes, rParc, rEv, rMov, rComp, rEmp] as any[]) if (r.error) throw r.error;
    const reserva = rRes.data as any;
    const saldos = fl.origem === 'SISTEMA' ? await saldosDaFicha(db, flId) : [];
    const [irmas, prorrogacoes, servicos] = reserva ? await Promise.all([
      fichasLocacaoDaReserva(db, reserva.id),
      db.from('locacao_prorrogacoes').select('*').eq('ficha_reserva_id', reserva.id).order('criado_em', { ascending: false }).then(r => r.data || []),
      db.from('locacao_fichas_reserva_itens').select('descricao, quantidade, tipo').eq('ficha_id', reserva.id).not('tipo', 'in', '(EQUIPAMENTO,KIT)').order('ordem').then(r => r.data || []),
    ]) : [[], [], []];
    const hoje = hojeISO();
    return {
      ok: true,
      info: {
        hoje, usuario: ctx.perfil.nome,
        podeEditar: ctx.acesso.podeEditar,
        ficha: {
          id: fl.id, numero: fl.numero, origem: fl.origem, status: fl.status, letra: fl.letra, data_saida: fl.data_saida, data_devolucao: fl.data_devolucao,
          criado_em: fl.criado_em, criado_por: fl.criado_por, finalizada_em: fl.finalizada_em, finalizada_por: fl.finalizada_por, observacoes: fl.observacoes,
          empresa: rEmp.data ? ((rEmp.data as any).nome_curto || (rEmp.data as any).nome) : null, empresa_id: fl.empresa_id,
          faturamento: fl.status_ultimo_faturamento, valor_nao_devolvidos: fl.valor_itens_nao_devolvidos,
        },
        reserva: reserva ? {
          id: reserva.id, os: reserva.origem === 'P2S' ? `P2S ${reserva.p2s_numero}` : numeroFichaPorId(reserva.id), origem: reserva.origem, status: reserva.status,
          data_saida: reserva.data_saida, data_montagem: reserva.data_montagem, data_inicio: reserva.data_inicio, data_fim: reserva.data_fim,
          data_desmontagem: reserva.data_desmontagem, data_retorno: reserva.data_retorno, local: reserva.local_entrega, estande: reserva.endereco_estande,
          contato: [reserva.contato_nome, reserva.contato_telefone].filter(Boolean).join(' · ') || null, vendedor: reserva.vendedor_nome,
          atrasada: reserva.data_fim < hoje && saldos.some(s => s.fora > 0),
        } : null,
        cliente: rParc.data ? { id: (rParc.data as any).id, nome: nomeParceiro(rParc.data), documento: formatarDocumento((rParc.data as any).cnpj, (rParc.data as any).cpf) } : null,
        evento: rEv.data ? { nome: (rEv.data as any).nome, local: (rEv.data as any).local } : null,
        saldos, servicos, extrasP2s: rExtras.data || [],
        irmas: (irmas as any[]).map(i => ({ id: i.id, numero: i.numero, status: i.status })),
        prorrogacoes,
        movimentos: ((rMov.data || []) as any[]).map(m => ({
          id: m.id, tipo: m.tipo, data: m.data_movimentacao, quantidade: n(m.quantidade), troca: !!m.troca, usuario: m.usuario, observacoes: m.observacoes,
          previsto_id: m.ficha_locacao_item_id, comprovante_id: m.comprovante_id, valor_indenizacao: m.valor_indenizacao, avaria_id: m.avaria_id,
          patrimonio: m.patrimonio?.numero_patrimonio || null, produto: m.produto?.nome_item || `#${m.produto_id}`, codigo: m.produto?.codigo_formatado || null,
        })),
        comprovantes: rComp.data || [],
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// AÇÕES
// ============================================================================
export async function abrirFichaLocacaoAction(reservaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: 'Seu usuário não pode alterar fichas de locação.' };
  try {
    const v = await reservaVisivel(ctx, reservaId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const r = await abrirFichaLocacao(ctx.db, reservaId, ctx.perfil.nome);
    if (r.nova) log(ctx.perfil.nome, 'ABRIU FICHA DE LOCAÇÃO', r.numero);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function fichasLocacaoDaReservaAction(reservaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await reservaVisivel(ctx, reservaId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    return { ok: true, info: await fichasLocacaoDaReserva(ctx.db, reservaId) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function registrarMovimentoAction(flId: number, dados: { tipo: 'SAIDA' | 'DEVOLUCAO'; data: string; linhas: LinhaMovimento[]; observacoes?: string | null; devolucaoFinal?: boolean }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  // extravio não é lançado à mão: nasce da devolução final / retorno encerrado
  if (!['SAIDA', 'DEVOLUCAO'].includes(dados.tipo)) return { ok: false, erro: 'Tipo inválido.' };
  try {
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    // da tela não chegam vínculos de checklist (só a Expedição grava esses)
    const linhas = (dados.linhas || []).map(l => ({ ...l, checklist_id: null, checklist_item_id: null, valor_indenizacao: null }));
    const r = await registrarMovimento(ctx.db, flId, {
      tipo: dados.tipo, data: dados.data, linhas, usuario: ctx.perfil.nome, observacoes: dados.observacoes || null,
      devolucaoFinal: dados.tipo === 'DEVOLUCAO' && !!dados.devolucaoFinal,
    });
    log(ctx.perfil.nome, `FICHA DE LOCAÇÃO: ${dados.tipo}`, `${v.fl.numero} · ${r.movimentos} linha(s)`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function registrarTrocaAction(flId: number, dados: {
  previsto_id: number; quantidade: number; volta_patrimonio_id?: number | null; sai_patrimonio_id?: number | null;
  data: string; motivo: string; avaria?: LinhaMovimento['avaria'];
}, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const r = await registrarTroca(ctx.db, flId, { ...(dados as any), usuario: ctx.perfil.nome });
    log(ctx.perfil.nome, 'FICHA DE LOCAÇÃO: TROCA', v.fl.numero);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Retorno encerrado sem mais nada voltar: o que está com o cliente vira extravio + reposição. */
export async function encerrarRetornoAction(flId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    if (v.fl.origem !== 'SISTEMA' || v.fl.status !== 'A') return { ok: false, erro: 'Ficha não está aberta.' };
    const r = await extraviarPendentes(ctx.db, flId, ctx.perfil.nome, hojeISO(), null);
    if (!r.linhas) return { ok: false, erro: 'Nada está com o cliente.' };
    log(ctx.perfil.nome, 'FICHA DE LOCAÇÃO: RETORNO ENCERRADO (EXTRAVIO)', `${v.fl.numero} · ${r.linhas} linha(s)`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function encerrarFichaLocacaoAction(flId: number, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: 'Seu usuário não pode alterar fichas de locação.' };
  try {
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    await encerrarFichaLocacao(ctx.db, flId, ctx.perfil.nome, motivo);
    log(ctx.perfil.nome, 'FICHA DE LOCAÇÃO: ENCERROU', `${v.fl.numero}: ${motivo}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

const SO_COMERCIAL = 'Prorrogação e complemento são do Comercial — seu usuário não pode alterar fichas.';

export async function prorrogarReservaAction(reservaId: number, novoFim: string, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SO_COMERCIAL };
  try {
    const v = await reservaVisivel(ctx, reservaId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const fls = await fichasLocacaoDaReserva(ctx.db, reservaId);
    const r = await prorrogarLocacao(ctx.db, reservaId, novoFim, motivo, ctx.perfil.nome, fls.find(f => f.status === 'A')?.id ?? null);
    if (!r.ok) return { ok: false, erro: r.erro, info: { faltas: r.faltas || [] } };
    log(ctx.perfil.nome, 'OS: PRORROGOU LOCAÇÃO', `${numeroFichaPorId(reservaId)} até ${novoFim} (+${r.dias})`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function complementoReservaAction(reservaId: number, itens: { produto_id: number; quantidade: number; valor_unitario?: number | null }[], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SO_COMERCIAL };
  try {
    const v = await reservaVisivel(ctx, reservaId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const r = await complementarLocacao(ctx.db, reservaId, itens, ctx.perfil.nome);
    if (!r.ok) return { ok: false, erro: r.erro, info: { faltas: r.faltas || [] } };
    log(ctx.perfil.nome, 'OS: COMPLEMENTO', `${numeroFichaPorId(reservaId)} · ${r.numero || 'incluído na OS'} · R$ ${r.valor}`);
    return { ok: true, info: r };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarProdutosComplementoAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    return { ok: true, info: await buscarProdutosLocaveis(ctx.db, texto) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Peças do produto para escolher na saída/troca (livres no período primeiro). */
export async function pecasDoItemAction(flId: number, previstoId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const { data: it } = await ctx.db.from('locacao_fichas_locacao_itens').select('produto_id').eq('id', previstoId).eq('ficha_locacao_id', flId).maybeSingle();
    if (!it) return { ok: false, erro: 'Item não encontrado.' };
    const [{ data: pats }, { data: alocs }] = await Promise.all([
      ctx.db.from('locacao_patrimonios').select('id, numero_patrimonio, numero_serie, situacao').eq('empresa_id', v.fl.empresa_id).eq('produto_id', it.produto_id).eq('situacao', 'ATIVO').order('numero_patrimonio'),
      ctx.db.from('locacao_alocacoes').select('patrimonio_id, ficha_id, status, periodo').eq('produto_id', it.produto_id).in('status', ['RESERVADO', 'LOCADO']).not('patrimonio_id', 'is', null),
    ]);
    const hoje = hojeISO();
    const estado = new Map<number, string>();
    for (const a of (alocs || []) as any[]) {
      const p = lerDaterange(a.periodo);
      if (a.ficha_id === v.fl.ficha_reserva_id) estado.set(a.patrimonio_id, a.status === 'LOCADO' ? 'COM_CLIENTE' : 'RESERVADA_AQUI');
      else if (p && p.fim >= hoje && !estado.has(a.patrimonio_id)) estado.set(a.patrimonio_id, a.status === 'LOCADO' ? `EM LOCAÇÃO (${numeroFichaPorId(a.ficha_id)})` : `RESERVADA (${numeroFichaPorId(a.ficha_id)})`);
    }
    return {
      ok: true,
      info: ((pats || []) as any[]).map(p => ({ id: p.id, numero: p.numero_patrimonio, serie: p.numero_serie, estado: estado.get(p.id) || 'LIVRE' }))
        .sort((a, b) => (a.estado === 'RESERVADA_AQUI' ? 0 : a.estado === 'LIVRE' ? 1 : 2) - (b.estado === 'RESERVADA_AQUI' ? 0 : b.estado === 'LIVRE' ? 1 : 2)),
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Lê QR/nº de patrimônio e diz a qual item previsto da ficha ele pertence. */
export async function lerPatrimonioAction(flId: number, codigo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const lido = (codigo || '').trim().toUpperCase();
  if (!lido) return { ok: false, erro: 'Código vazio.' };
  try {
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const sel = 'id, empresa_id, produto_id, numero_patrimonio, situacao';
    let { data: pats } = await ctx.db.from('locacao_patrimonios').select(sel).eq('qr_code', lido).eq('empresa_id', v.fl.empresa_id);
    if (!pats?.length) ({ data: pats } = await ctx.db.from('locacao_patrimonios').select(sel).eq('numero_patrimonio', lido).eq('empresa_id', v.fl.empresa_id));
    const p = (pats || [])[0] as any;
    if (!p) return { ok: false, erro: `Patrimônio "${lido}" não encontrado nesta empresa.` };
    const saldos = await saldosDaFicha(ctx.db, flId);
    const itens = saldos.filter(s => s.produto_id === p.produto_id);
    if (!itens.length) return { ok: false, erro: `${p.numero_patrimonio} não é de nenhum item desta ficha.` };
    return { ok: true, info: { patrimonio_id: p.id, numero: p.numero_patrimonio, situacao: p.situacao, previstos: itens.map(i => i.id), comCliente: itens.some(i => i.pecasFora.some(x => x.id === p.id)) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function assinarComprovanteAction(comprovanteId: number, dados: { nome: string; documento?: string | null; png: string }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!dados.nome?.trim()) return { ok: false, erro: 'Informe o nome de quem assina.' };
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dados.png || '') || dados.png.length > 400_000) return { ok: false, erro: 'Assinatura inválida — desenhe de novo.' };
  try {
    const { data: c } = await ctx.db.from('locacao_comprovantes').select('id, ficha_locacao_id, tipo').eq('id', comprovanteId).maybeSingle();
    if (!c) return { ok: false, erro: 'Comprovante não encontrado.' };
    const v = await fichaVisivel(ctx, c.ficha_locacao_id);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const { error } = await ctx.db.from('locacao_comprovantes').update({
      recebedor_nome: dados.nome.trim(), recebedor_documento: dados.documento?.trim() || null, assinatura_png: dados.png,
      assinado_em: new Date().toISOString(), assinado_registrado_por: ctx.perfil.nome,
    }).eq('id', comprovanteId);
    if (error) throw error;
    log(ctx.perfil.nome, 'FICHA DE LOCAÇÃO: ASSINATURA', `${v.fl.numero} · ${c.tipo} #${comprovanteId} · ${dados.nome.trim()}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/**
 * PDF da OS: de um comprovante (o que saiu/voltou naquele registro) ou a
 * prévia com tudo que está pendente de saída (para levar na separação).
 */
export async function pdfOsAction(args: { comprovanteId?: number | null; flId?: number | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = ctx.db;
  try {
    let comp: any = null;
    let flId = args.flId ?? null;
    if (args.comprovanteId) {
      const { data } = await db.from('locacao_comprovantes').select('*').eq('id', args.comprovanteId).maybeSingle();
      if (!data) return { ok: false, erro: 'Comprovante não encontrado.' };
      comp = data; flId = data.ficha_locacao_id;
    }
    if (!flId) return { ok: false, erro: 'Ficha não informada.' };
    const v = await fichaVisivel(ctx, flId);
    if ('erro' in v) return { ok: false, erro: v.erro };
    const fl = v.fl;
    if (fl.origem !== 'SISTEMA' || !fl.ficha_reserva_id) return { ok: false, erro: 'OS só para fichas do sistema.' };
    const [{ data: r }, { data: emp }] = await Promise.all([
      db.from('locacao_fichas_reserva').select('*, parceiro:parceiros(nome_exibicao, nome_completo, cnpj, cpf), evento:eventos_feiras(nome, local)').eq('id', fl.ficha_reserva_id).single(),
      db.from('empresas').select('*').eq('id', fl.empresa_id).single(),
    ]);
    const saldos = await saldosDaFicha(db, flId);
    const porPrev = new Map(saldos.map(s => [s.id, s]));
    let itens: ItemOs[] = [];
    const avarias: string[] = [];
    if (comp) {
      const { data: movs } = await db.from('locacao_fichas_locacao_movimentos')
        .select('ficha_locacao_item_id, quantidade, troca, patrimonio:locacao_patrimonios(numero_patrimonio), avaria:locacao_avarias(gravidade, descricao)')
        .eq('comprovante_id', comp.id).eq('tipo', comp.tipo === 'SAIDA' ? 'SAIDA' : 'DEVOLUCAO');
      const grupo = new Map<number, ItemOs>();
      for (const m of (movs || []) as any[]) {
        const s = porPrev.get(m.ficha_locacao_item_id);
        const g = grupo.get(m.ficha_locacao_item_id) || { quantidade: 0, descricao: s?.descricao || 'Item', codigo: s?.codigo || null, patrimonios: [], observacao: m.troca ? 'troca' : null };
        g.quantidade += n(m.quantidade);
        if (m.patrimonio?.numero_patrimonio) g.patrimonios!.push(m.patrimonio.numero_patrimonio);
        grupo.set(m.ficha_locacao_item_id, g);
        if (m.avaria) avarias.push(`${s?.descricao || 'Item'}${m.patrimonio?.numero_patrimonio ? ` (${m.patrimonio.numero_patrimonio})` : ''}: ${m.avaria.descricao} — ${m.avaria.gravidade}`);
      }
      itens = [...grupo.values()];
    } else {
      itens = saldos.filter(s => s.pendenteSaida > 0).map(s => ({ quantidade: s.pendenteSaida, descricao: s.descricao, codigo: s.codigo }));
      if (!itens.length) return { ok: false, erro: 'Nada pendente de saída nesta ficha.' };
    }
    const comCliente = comp?.tipo === 'DEVOLUCAO' ? saldos.filter(s => s.fora > 0).map(s => ({ quantidade: s.fora, descricao: s.descricao, codigo: s.codigo, patrimonios: s.pecasFora.map(p => p.numero) })) : [];
    const { data: servs } = await db.from('locacao_fichas_reserva_itens').select('descricao, quantidade, tipo').eq('ficha_id', r.id).not('tipo', 'in', '(EQUIPAMENTO,KIT)').order('ordem');
    const nomeEmp = `${emp?.nome_curto || ''} ${emp?.nome || ''}`.toUpperCase();
    const bytes = await gerarOsLocacaoPdf({
      tipo: comp?.tipo === 'DEVOLUCAO' ? 'DEVOLUCAO' : 'SAIDA',
      logo: /ALFA/.test(nomeEmp) ? 'ALFALIGHT' : 'RENTECH',
      empresa: { nome: emp?.razao_social || emp?.nome || '', documento: formatarDocumento(emp?.cnpj, null), endereco: emp?.endereco, telefone: emp?.telefone },
      os: numeroFichaPorId(r.id), fichaLocacao: fl.numero, data: comp?.data || hojeISO(),
      cliente: { nome: nomeParceiro(r.parceiro), documento: r.parceiro ? formatarDocumento(r.parceiro.cnpj, r.parceiro.cpf) : null },
      evento: r.evento?.nome || null, local: r.local_entrega || r.evento?.local || null, estande: r.endereco_estande,
      contato: [r.contato_nome, r.contato_telefone].filter(Boolean).join(' · ') || null, vendedor: r.vendedor_nome,
      periodo: { montagem: r.data_montagem, inicio: r.data_inicio, fim: r.data_fim, desmontagem: r.data_desmontagem },
      itens, servicos: comp?.tipo === 'DEVOLUCAO' ? [] : ((servs || []) as any[]).map(x => ({ quantidade: n(x.quantidade), descricao: x.descricao })),
      comCliente, avarias, observacoes: comp ? comp.observacoes : 'Prévia para separação — a saída é registrada na conferência da Expedição ou na ficha de locação.',
      registradoPor: comp?.registrado_por || ctx.perfil.nome,
      recebedor: comp ? { nome: comp.recebedor_nome, documento: comp.recebedor_documento, assinaturaPng: comp.assinatura_png, assinadoEm: comp.assinado_em } : null,
    });
    return { ok: true, info: { base64: Buffer.from(bytes).toString('base64'), nome: `${comp?.tipo === 'DEVOLUCAO' ? 'devolucao' : 'os'}-${fl.numero.replace(/[^A-Za-z0-9]+/g, '-')}${comp ? `-${comp.id}` : '-previa'}.pdf` } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
