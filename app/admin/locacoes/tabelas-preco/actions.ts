'use server';

// app/admin/locacoes/tabelas-preco/actions.ts
// Tabelas de Preço da locação (/admin/locacoes/tabelas-preco, 2026-11-16).
// Leitura e gravação só pelo servidor (tabelas locacao_* só têm grant pro
// service_role) e sempre restritas às empresas do usuário.
// Regras de cálculo: app/lib/locacao/preco.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { registrarLogAuditoria } from '../../../actions';
import type { TipoTabelaPreco } from '../../../lib/locacao/preco';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/locacoes/tabelas-preco';
const SETOR = 'LOCACOES';
const MAX_DIAS_FAIXA = 365;

async function contexto(accessToken: string) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}

async function empresasVisiveis(permitidas: number[] | null) {
  const { data } = await supabaseAdmin().from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
  return ((data || []) as any[])
    .filter(e => permitidas === null || permitidas.includes(e.id))
    .map(e => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() }));
}

// Carrega a tabela e confere se o usuário pode mexer nela (empresa).
async function tabelaDoUsuario(id: number, permitidas: number[] | null) {
  const { data, error } = await supabaseAdmin().from('locacao_tabelas_preco').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return { erro: 'Tabela de preço não encontrada.' } as const;
  if (!empresaPermitida(permitidas, data.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  return { tabela: data } as const;
}

const numOuNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const dataOuNull = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const limparBusca = (s: string) => s.replace(/[%_,()]/g, ' ').trim();

function log(perfilNome: string, acao: string, detalhe?: string) {
  registrarLogAuditoria({ usuario_nome: perfilNome, acao, setor: SETOR, equipamento_nome: detalhe || null });
}

// ============================================================================
// LISTA
// ============================================================================
export async function listarTabelasPrecoAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const empresas = await empresasVisiveis(ctx.permitidas);
    if (!empresas.length) return { ok: true, info: { empresas, tabelas: [] } };

    const { data, error } = await supabaseAdmin()
      .from('locacao_tabelas_preco')
      .select('*, parceiro:parceiros(id, nome_exibicao, nome_completo), evento:eventos_feiras(id, nome, data_inicial), produtos:locacao_tabela_produtos(count)')
      .in('empresa_id', empresas.map(e => e.id))
      .order('ativa', { ascending: false })
      .order('tipo')
      .order('nome');
    if (error) throw error;

    const tabelas = (data || []).map((t: any) => ({
      ...t,
      parceiro_nome: t.parceiro ? (t.parceiro.nome_exibicao || t.parceiro.nome_completo) : null,
      evento_nome: t.evento?.nome || null,
      qtd_produtos: t.produtos?.[0]?.count ?? 0,
      parceiro: undefined, evento: undefined, produtos: undefined,
    }));
    return { ok: true, info: { empresas, tabelas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CABEÇALHO (criar / editar / excluir / duplicar)
// ============================================================================
export interface DadosTabelaPreco {
  id?: number;
  nome: string;
  tipo: TipoTabelaPreco;
  empresa_id: number;
  parceiro_id?: number | null;
  evento_id?: string | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  ativa: boolean;
  observacoes?: string | null;
}

function validarCabecalho(d: DadosTabelaPreco): string | null {
  if (!d.nome?.trim()) return 'Informe o nome da tabela.';
  if (!['PADRAO', 'CLIENTE', 'EVENTO'].includes(d.tipo)) return 'Tipo de tabela inválido.';
  if (!d.empresa_id) return 'Escolha a empresa.';
  if (d.tipo === 'CLIENTE' && !d.parceiro_id) return 'Escolha o cliente da tabela.';
  if (d.tipo === 'EVENTO' && !d.evento_id) return 'Escolha o evento/feira da tabela.';
  const ini = dataOuNull(d.vigencia_inicio), fim = dataOuNull(d.vigencia_fim);
  if (ini && fim && fim < ini) return 'O fim da vigência é anterior ao início.';
  return null;
}

export async function salvarTabelaPrecoAction(dados: DadosTabelaPreco, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const invalido = validarCabecalho(dados);
  if (invalido) return { ok: false, erro: invalido };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };

  const db = supabaseAdmin();
  try {
    const linha = {
      nome: dados.nome.trim(),
      tipo: dados.tipo,
      empresa_id: dados.empresa_id,
      parceiro_id: dados.tipo === 'CLIENTE' ? dados.parceiro_id : null,
      evento_id: dados.tipo === 'EVENTO' ? dados.evento_id : null,
      vigencia_inicio: dataOuNull(dados.vigencia_inicio),
      vigencia_fim: dataOuNull(dados.vigencia_fim),
      ativa: !!dados.ativa,
      observacoes: dados.observacoes?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (dados.id) {
      const atual = await tabelaDoUsuario(dados.id, ctx.permitidas);
      if ('erro' in atual) return { ok: false, erro: atual.erro };
      const { error } = await db.from('locacao_tabelas_preco').update(linha).eq('id', dados.id);
      if (error) throw error;
      log(ctx.perfil.nome, 'EDITOU TABELA DE PREÇO', `${linha.nome} (#${dados.id})`);
      return { ok: true, info: { id: dados.id } };
    }

    const { data, error } = await db.from('locacao_tabelas_preco')
      .insert({ ...linha, criado_por: ctx.perfil.nome }).select('id').single();
    if (error) throw error;
    log(ctx.perfil.nome, 'CRIOU TABELA DE PREÇO', `${linha.nome} (#${data.id})`);
    return { ok: true, info: { id: data.id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function excluirTabelaPrecoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const atual = await tabelaDoUsuario(id, ctx.permitidas);
    if ('erro' in atual) return { ok: false, erro: atual.erro };

    const { count } = await supabaseAdmin().from('locacao_fichas_reserva')
      .select('id', { count: 'exact', head: true }).eq('tabela_preco_id', id);
    if ((count || 0) > 0) {
      return { ok: false, erro: `Esta tabela já foi usada em ${count} ficha(s) de reserva — desative-a em vez de excluir.` };
    }

    const { error } = await supabaseAdmin().from('locacao_tabelas_preco').delete().eq('id', id);
    if (error) throw error;
    log(ctx.perfil.nome, 'EXCLUIU TABELA DE PREÇO', `${atual.tabela.nome} (#${id})`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Cópia da tabela (cabeçalho + produtos + faixas), com reajuste opcional em %.
// Uso típico: reajuste anual — duplica com vigência nova e desativa a antiga.
export async function duplicarTabelaPrecoAction(
  id: number,
  opcoes: { nome: string; reajustePct: number; vigencia_inicio?: string | null; vigencia_fim?: string | null },
  accessToken: string
): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!opcoes.nome?.trim()) return { ok: false, erro: 'Informe o nome da nova tabela.' };
  const pct = Number(opcoes.reajustePct) || 0;
  if (pct <= -100) return { ok: false, erro: 'Reajuste inválido.' };

  const db = supabaseAdmin();
  try {
    const atual = await tabelaDoUsuario(id, ctx.permitidas);
    if ('erro' in atual) return { ok: false, erro: atual.erro };
    const t = atual.tabela;
    const fator = 1 + pct / 100;
    const ajustar = (v: number | null) => (v === null || v === undefined ? null : Math.round(Number(v) * fator * 100) / 100);

    const { data: nova, error: eNova } = await db.from('locacao_tabelas_preco').insert({
      nome: opcoes.nome.trim(), tipo: t.tipo, empresa_id: t.empresa_id, parceiro_id: t.parceiro_id, evento_id: t.evento_id,
      vigencia_inicio: dataOuNull(opcoes.vigencia_inicio), vigencia_fim: dataOuNull(opcoes.vigencia_fim),
      ativa: true, observacoes: `Cópia de "${t.nome}"${pct ? ` com reajuste de ${pct}%` : ''}.`, criado_por: ctx.perfil.nome,
    }).select('id').single();
    if (eNova) throw eNova;

    const { data: produtos, error: eProd } = await buscarTodasPaginas<any>((de, ate) =>
      db.from('locacao_tabela_produtos').select('id, produto_id, valor_diaria_extra, valor_mensal, faixas:locacao_tabela_faixas(dias, valor_diaria)')
        .eq('tabela_id', id).order('id').range(de, ate));
    if (eProd) throw eProd;

    if (produtos.length) {
      const { data: inseridos, error: eIns } = await db.from('locacao_tabela_produtos').insert(
        produtos.map(p => ({ tabela_id: nova.id, produto_id: p.produto_id, valor_diaria_extra: ajustar(p.valor_diaria_extra), valor_mensal: ajustar(p.valor_mensal) }))
      ).select('id, produto_id');
      if (eIns) throw eIns;
      const idPorProduto = new Map((inseridos || []).map((r: any) => [r.produto_id, r.id]));
      const faixas = produtos.flatMap(p => (p.faixas || []).map((f: any) => ({
        tabela_produto_id: idPorProduto.get(p.produto_id), dias: f.dias, valor_diaria: ajustar(f.valor_diaria),
      })));
      for (let i = 0; i < faixas.length; i += 500) {
        const { error } = await db.from('locacao_tabela_faixas').insert(faixas.slice(i, i + 500));
        if (error) throw error;
      }
    }

    log(ctx.perfil.nome, 'DUPLICOU TABELA DE PREÇO', `${t.nome} (#${id}) → ${opcoes.nome.trim()} (#${nova.id}), reajuste ${pct}%`);
    return { ok: true, info: { id: nova.id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PRODUTOS E FAIXAS DA TABELA
// ============================================================================
export async function carregarTabelaPrecoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const atual = await tabelaDoUsuario(id, ctx.permitidas);
    if ('erro' in atual) return { ok: false, erro: atual.erro };

    const { data, error } = await buscarTodasPaginas<any>((de, ate) =>
      db.from('locacao_tabela_produtos')
        .select('id, produto_id, valor_diaria_extra, valor_mensal, produto:produtos(id, nome_item, codigo_formatado, unidade, categoria_nome, flag_em_desuso, valor_indenizacao), faixas:locacao_tabela_faixas(dias, valor_diaria)')
        .eq('tabela_id', id).order('id').range(de, ate));
    if (error) throw error;

    const linhas = data.map(r => ({
      tabela_produto_id: r.id,
      produto_id: r.produto_id,
      nome: r.produto?.nome_item || `Produto #${r.produto_id}`,
      codigo: r.produto?.codigo_formatado || null,
      unidade: r.produto?.unidade || null,
      categoria: r.produto?.categoria_nome || null,
      em_desuso: !!r.produto?.flag_em_desuso,
      valor_indenizacao: r.produto?.valor_indenizacao ?? null,
      valor_diaria_extra: r.valor_diaria_extra === null ? null : Number(r.valor_diaria_extra),
      valor_mensal: r.valor_mensal === null ? null : Number(r.valor_mensal),
      faixas: Object.fromEntries((r.faixas || []).map((f: any) => [String(f.dias), Number(f.valor_diaria)])),
    })).sort((a, b) => (a.codigo || a.nome).localeCompare(b.codigo || b.nome, 'pt-BR', { numeric: true }));

    return { ok: true, info: { tabela: atual.tabela, linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface LinhaPrecoEntrada {
  produto_id: number;
  faixas: Record<string, number | null>;
  valor_diaria_extra: number | null;
  valor_mensal: number | null;
}

// Grava as linhas alteradas na grade (substitui as faixas de cada produto
// enviado pelas faixas informadas; faixa vazia = removida).
export async function salvarPrecosTabelaAction(tabelaId: number, linhas: LinhaPrecoEntrada[], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!linhas.length) return { ok: true, info: { salvos: 0 } };

  for (const l of linhas) {
    for (const [dias, valor] of Object.entries(l.faixas)) {
      const d = Number(dias);
      if (!Number.isInteger(d) || d < 1 || d > MAX_DIAS_FAIXA) return { ok: false, erro: `Faixa de dias inválida: ${dias}.` };
      if (valor !== null && (!Number.isFinite(Number(valor)) || Number(valor) < 0)) return { ok: false, erro: 'Há valor negativo ou inválido na grade.' };
    }
    for (const v of [l.valor_diaria_extra, l.valor_mensal]) {
      if (v !== null && (!Number.isFinite(Number(v)) || Number(v) < 0)) return { ok: false, erro: 'Há valor negativo ou inválido na grade.' };
    }
  }

  const db = supabaseAdmin();
  try {
    const atual = await tabelaDoUsuario(tabelaId, ctx.permitidas);
    if ('erro' in atual) return { ok: false, erro: atual.erro };

    const agora = new Date().toISOString();
    const { data: gravados, error: eUp } = await db.from('locacao_tabela_produtos').upsert(
      linhas.map(l => ({
        tabela_id: tabelaId, produto_id: l.produto_id,
        valor_diaria_extra: numOuNull(l.valor_diaria_extra), valor_mensal: numOuNull(l.valor_mensal), updated_at: agora,
      })),
      { onConflict: 'tabela_id,produto_id' }
    ).select('id, produto_id');
    if (eUp) throw eUp;

    const idPorProduto = new Map((gravados || []).map((r: any) => [r.produto_id, r.id as number]));
    const ids = [...idPorProduto.values()];
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db.from('locacao_tabela_faixas').delete().in('tabela_produto_id', ids.slice(i, i + 200));
      if (error) throw error;
    }

    const faixas = linhas.flatMap(l => Object.entries(l.faixas)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([dias, v]) => ({ tabela_produto_id: idPorProduto.get(l.produto_id), dias: Number(dias), valor_diaria: numOuNull(v) })));
    for (let i = 0; i < faixas.length; i += 500) {
      const { error } = await db.from('locacao_tabela_faixas').insert(faixas.slice(i, i + 500));
      if (error) throw error;
    }

    await db.from('locacao_tabelas_preco').update({ updated_at: agora }).eq('id', tabelaId);
    log(ctx.perfil.nome, 'ALTEROU PREÇOS DA TABELA', `${atual.tabela.nome} (#${tabelaId}): ${linhas.length} produto(s)`);
    return { ok: true, info: { salvos: linhas.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function removerProdutosTabelaAction(tabelaId: number, produtoIds: number[], accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!produtoIds.length) return { ok: true };
  try {
    const atual = await tabelaDoUsuario(tabelaId, ctx.permitidas);
    if ('erro' in atual) return { ok: false, erro: atual.erro };
    const { error } = await supabaseAdmin().from('locacao_tabela_produtos').delete()
      .eq('tabela_id', tabelaId).in('produto_id', produtoIds);
    if (error) throw error;
    log(ctx.perfil.nome, 'REMOVEU PRODUTOS DA TABELA', `${atual.tabela.nome} (#${tabelaId}): ${produtoIds.length} produto(s)`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// BUSCAS (produto, cliente, evento)
// ============================================================================
export async function buscarProdutosLocacaoAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const termo = limparBusca(texto || '');
  if (termo.length < 2) return { ok: true, info: [] };
  try {
    const { data, error } = await supabaseAdmin().from('produtos')
      .select('id, nome_item, codigo_formatado, unidade, categoria_nome')
      .eq('habilitado_para_locacao', true).eq('flag_em_desuso', false)
      .or(`nome_item.ilike.%${termo}%,codigo_formatado.ilike.%${termo}%,categoria_nome.ilike.%${termo}%`)
      .order('nome_item').limit(40);
    if (error) throw error;
    return { ok: true, info: data || [] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Só id + nome + cidade — o cadastro completo (dados sensíveis) continua na
// tela de Parceiros.
export async function buscarClientesAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const termo = limparBusca(texto || '');
  if (termo.length < 2) return { ok: true, info: [] };
  try {
    const { data, error } = await supabaseAdmin().from('parceiros')
      .select('id, nome_exibicao, nome_completo, cidade1, estado1')
      .eq('flag_cliente', true)
      .or(`nome_exibicao.ilike.%${termo}%,nome_completo.ilike.%${termo}%`)
      .order('nome_exibicao').limit(30);
    if (error) throw error;
    return {
      ok: true,
      info: (data || []).map((p: any) => ({
        id: p.id, nome: p.nome_exibicao || p.nome_completo,
        detalhe: [p.nome_completo !== p.nome_exibicao ? p.nome_completo : null, [p.cidade1, p.estado1].filter(Boolean).join('/')].filter(Boolean).join(' · '),
      })),
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function buscarEventosAction(texto: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const termo = limparBusca(texto || '');
  if (termo.length < 2) return { ok: true, info: [] };
  try {
    const { data, error } = await supabaseAdmin().from('eventos_feiras')
      .select('id, nome, data_inicial, data_final, local')
      .ilike('nome', `%${termo}%`)
      .order('data_inicial', { ascending: false }).limit(30);
    if (error) throw error;
    return {
      ok: true,
      info: (data || []).map((e: any) => ({
        id: e.id, nome: e.nome,
        detalhe: [e.data_inicial ? e.data_inicial.split('-').reverse().join('/') : null, e.local].filter(Boolean).join(' · '),
      })),
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// IMPORTAR DO P2S
// ============================================================================
// O P2S guarda uma "tabela" por número de diárias ("01 - Tabela 1 diaria -
// Rentech" … "05 - Tabela 5 diarias - Rentech") com o valor da DIÁRIA — vira
// UMA tabela padrão com faixas 1–5. "09- Tabela Alfa Light" vira a padrão da
// Alfa Light com faixa de 1 dia. "50 - Indenização" vai para
// produtos.valor_indenizacao. As "CANCELADO n" são ignoradas.
// Lê de produtos.precos (espelho do P2S) — rode o sync de Produtos antes se
// quiser os preços mais recentes. Reimportar SUBSTITUI os produtos/faixas das
// tabelas importadas (as criadas à mão não são tocadas).
type DestinoImport = { chave: string; nomeTabela: string; empresaBusca: RegExp; faixaDe: (nomeP2s: string) => number | null };

const DESTINOS_IMPORT: DestinoImport[] = [
  {
    chave: 'P2S_PADRAO_RENTECH', nomeTabela: 'Padrão Rentech (importada do P2S)', empresaBusca: /RENTECH/i,
    faixaDe: n => { const m = n.match(/^\s*\d+\s*-\s*Tabela\s+(\d+)\s+diaria/i); return m && /rentech/i.test(n) ? Number(m[1]) : null; },
  },
  {
    chave: 'P2S_PADRAO_ALFALIGHT', nomeTabela: 'Padrão Alfa Light (importada do P2S)', empresaBusca: /ALFA/i,
    faixaDe: n => (/^\s*09\s*-\s*Tabela\s+Alfa\s+Light/i.test(n) ? 1 : null),
  },
];
const ehIndenizacao = (n: string) => /^\s*50\s*-\s*Indeniza/i.test(n);

export async function importarTabelasP2sAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: empresasRows } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true);
    const { data: produtos, error: eProd } = await buscarTodasPaginas<any>((de, ate) =>
      db.from('produtos').select('id, precos, habilitado_para_locacao, flag_em_desuso')
        .not('precos', 'is', null).order('id').range(de, ate));
    if (eProd) throw eProd;

    const resumo: { tabela: string; empresa: string; produtos: number; faixas: number[] }[] = [];
    const avisos: string[] = [];

    for (const destino of DESTINOS_IMPORT) {
      const empresa = (empresasRows || []).find((e: any) => destino.empresaBusca.test(`${e.nome_curto || ''} ${e.nome || ''}`));
      if (!empresa) { avisos.push(`Empresa não encontrada para "${destino.nomeTabela}".`); continue; }
      if (!empresaPermitida(ctx.permitidas, empresa.id)) { avisos.push(`Sem acesso à empresa de "${destino.nomeTabela}" — pulada.`); continue; }

      // produto → { dias → diária }
      const porProduto = new Map<number, Record<string, number>>();
      const faixasVistas = new Set<number>();
      for (const p of produtos) {
        if (!p.habilitado_para_locacao || p.flag_em_desuso) continue;
        for (const preco of (p.precos || [])) {
          const dias = destino.faixaDe(String(preco.tabela || ''));
          const valor = Number(preco.preco);
          if (!dias || !Number.isFinite(valor) || valor <= 0) continue;
          const f = porProduto.get(p.id) || {};
          f[String(dias)] = Math.round(valor * 100) / 100;
          porProduto.set(p.id, f);
          faixasVistas.add(dias);
        }
      }
      if (!porProduto.size) { avisos.push(`Nenhum preço encontrado no P2S para "${destino.nomeTabela}".`); continue; }

      // Cria ou reaproveita a tabela marcada com a chave de origem.
      const { data: existente } = await db.from('locacao_tabelas_preco').select('id').eq('p2s_origem', destino.chave).maybeSingle();
      let tabelaId: number;
      if (existente) {
        tabelaId = existente.id;
        await db.from('locacao_tabelas_preco').update({ updated_at: new Date().toISOString() }).eq('id', tabelaId);
        const { error } = await db.from('locacao_tabela_produtos').delete().eq('tabela_id', tabelaId);
        if (error) throw error;
      } else {
        const { data: nova, error } = await db.from('locacao_tabelas_preco').insert({
          nome: destino.nomeTabela, tipo: 'PADRAO', empresa_id: empresa.id, ativa: true, p2s_origem: destino.chave,
          observacoes: 'Criada pelo botão "Importar do P2S". Reimportar substitui os preços desta tabela.', criado_por: ctx.perfil.nome,
        }).select('id').single();
        if (error) throw error;
        tabelaId = nova.id;
      }

      const entradas = [...porProduto.entries()];
      const idPorProduto = new Map<number, number>();
      for (let i = 0; i < entradas.length; i += 500) {
        const { data: ins, error } = await db.from('locacao_tabela_produtos')
          .insert(entradas.slice(i, i + 500).map(([produto_id]) => ({ tabela_id: tabelaId, produto_id })))
          .select('id, produto_id');
        if (error) throw error;
        for (const r of ins || []) idPorProduto.set(r.produto_id, r.id);
      }
      const faixas = entradas.flatMap(([produto_id, f]) =>
        Object.entries(f).map(([dias, valor]) => ({ tabela_produto_id: idPorProduto.get(produto_id), dias: Number(dias), valor_diaria: valor })));
      for (let i = 0; i < faixas.length; i += 500) {
        const { error } = await db.from('locacao_tabela_faixas').insert(faixas.slice(i, i + 500));
        if (error) throw error;
      }

      resumo.push({
        tabela: destino.nomeTabela, empresa: (empresa.nome_curto || empresa.nome || '').trim(),
        produtos: porProduto.size, faixas: [...faixasVistas].sort((a, b) => a - b),
      });
    }

    // Indenização → produtos.valor_indenizacao
    const indenizacoes = produtos.flatMap(p => {
      const preco = (p.precos || []).find((x: any) => ehIndenizacao(String(x.tabela || '')));
      const valor = preco ? Number(preco.preco) : NaN;
      return Number.isFinite(valor) && valor > 0 ? [{ id: p.id as number, valor: Math.round(valor * 100) / 100 }] : [];
    });
    for (let i = 0; i < indenizacoes.length; i += 20) {
      const resultados = await Promise.all(indenizacoes.slice(i, i + 20).map(x =>
        db.from('produtos').update({ valor_indenizacao: x.valor }).eq('id', x.id)));
      const falha = resultados.find(r => r.error);
      if (falha?.error) throw falha.error;
    }

    log(ctx.perfil.nome, 'IMPORTOU TABELAS DE PREÇO DO P2S',
      resumo.map(r => `${r.tabela}: ${r.produtos} produtos`).join('; ') + `; indenização: ${indenizacoes.length}`);
    return { ok: true, info: { resumo, indenizacoes: indenizacoes.length, avisos } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
