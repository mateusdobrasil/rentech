'use server';

// app/admin/estoque/inventario/actions.ts
// Inventário de estoque (2026-11-17) — ferramenta da virada do P2S e de
// contagens parciais. Regras:
//  - Ao ABRIR, congela por produto: saldo do sistema, manutenção e o que está
//    EM LOCAÇÃO agora (alocações LOCADO hoje) — o que está com cliente não é
//    contado no depósito. Esperado no depósito = saldo − em locação.
//  - QUANTIDADE: digita-se o contado. INDIVIDUAL: contado = patrimônios lidos
//    (QR ou nº). Código lido que não existe fica como "desconhecido".
//  - Ao CONCLUIR: saldo novo = contado + em locação (só produtos contados);
//    patrimônio não lido de produto sem nada em locação pode virar EXTRAVIADO.
//  - Atenção na fase paralela: "Carregar saldos do P2S" sobrescreve o local
//    PRINCIPAL — o inventário vale de verdade na virada.
import { supabaseAdmin } from '../../../lib/supabase';
import { empresasCongeladas } from '../../../lib/virada/estado';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { buscarTodasPaginas } from '../../../lib/paginacao';
import { registrarLogAuditoria } from '../../../actions';
import { daterangeInclusivo, hojeISO } from '../../../lib/locacao/datas';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/estoque/inventario';
const LOCAL_PADRAO = 'PRINCIPAL';
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function contexto(accessToken: string) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}

async function inventarioDoUsuario(id: number, permitidas: number[] | null) {
  const { data } = await supabaseAdmin().from('estoque_inventarios').select('*').eq('id', id).maybeSingle();
  if (!data) return { erro: 'Inventário não encontrado.' } as const;
  if (!empresaPermitida(permitidas, data.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  return { inv: data } as const;
}

function log(nome: string, acao: string, detalhe: string) {
  registrarLogAuditoria({ usuario_nome: nome, acao, setor: 'ESTOQUE', equipamento_nome: detalhe });
}

// ============================================================================
// LISTA / CRIAR
// ============================================================================
export async function listarInventariosAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: emps } = await db.from('empresas').select('id, nome, nome_curto').eq('ativo', true).order('id');
    const empresas = (emps || []).filter((e: any) => ctx.permitidas === null || ctx.permitidas.includes(e.id))
      .map((e: any) => ({ id: e.id as number, nome: ((e.nome_curto || e.nome) as string).trim() }));
    const ids = empresas.map(e => e.id);
    const { data: invs } = ids.length
      ? await db.from('estoque_inventarios').select('*, itens:estoque_inventario_itens(contado)').in('empresa_id', ids).order('criado_em', { ascending: false }).limit(100)
      : { data: [] };
    const { data: cats } = await db.from('produtos').select('categoria_nome').eq('habilitado_para_locacao', true).eq('flag_em_desuso', false);
    const { data: locais } = ids.length ? await db.from('locacao_saldos').select('local').in('empresa_id', ids) : { data: [] };
    const congeladas = await empresasCongeladas(db);
    return {
      ok: true,
      info: {
        empresas: empresas.map(e => ({ ...e, congelada: congeladas.has(e.id) })),
        categorias: [...new Set((cats || []).map((c: any) => c.categoria_nome).filter(Boolean))].sort(),
        locais: [...new Set((locais || []).map((l: any) => l.local).filter(Boolean))].sort(),
        inventarios: (invs || []).map((i: any) => ({
          ...i, itens: undefined, total_itens: i.itens?.length || 0, contados: (i.itens || []).filter((x: any) => x.contado !== null).length,
        })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarInventarioAction(dados: { empresa_id: number; nome: string; local?: string | null; categorias?: string[] }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!empresaPermitida(ctx.permitidas, dados.empresa_id)) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
  const nome = (dados.nome || '').trim();
  if (!nome) return { ok: false, erro: 'Dê um nome ao inventário (ex.: "Inventário geral nov/2026").' };
  const local = (dados.local || '').trim().toUpperCase() || null;
  const categorias = (dados.categorias || []).filter(Boolean);
  const db = supabaseAdmin();
  try {
    // produtos no escopo
    const { data: prods, error } = await buscarTodasPaginas<any>((de, ate) => {
      let q = db.from('produtos').select('id, controle_locacao').eq('habilitado_para_locacao', true).eq('flag_em_desuso', false);
      if (categorias.length) q = q.in('categoria_nome', categorias);
      return q.order('id').range(de, ate);
    });
    if (error) throw error;
    if (!prods.length) return { ok: false, erro: 'Nenhum produto no escopo escolhido.' };
    const ids = prods.map(p => p.id);

    const saldo = new Map<number, { total: number; manut: number }>();
    const somar = (id: number, total: number, manut: number) => { const s = saldo.get(id) || { total: 0, manut: 0 }; s.total += total; s.manut += manut; saldo.set(id, s); };
    const emLoc = new Map<number, number>();
    const hoje = hojeISO();
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      let qs = db.from('locacao_saldos').select('produto_id, quantidade_total, quantidade_manutencao').eq('empresa_id', dados.empresa_id).in('produto_id', lote);
      if (local) qs = qs.eq('local', local);
      let qp = db.from('locacao_patrimonios').select('produto_id, situacao').eq('empresa_id', dados.empresa_id).in('situacao', ['ATIVO', 'MANUTENCAO']).in('produto_id', lote);
      if (local) qp = qp.eq('local', local);
      const [rS, rP, rA] = await Promise.all([
        qs, qp,
        db.from('locacao_alocacoes').select('produto_id, quantidade').eq('empresa_id', dados.empresa_id).eq('status', 'LOCADO')
          .in('produto_id', lote).overlaps('periodo', daterangeInclusivo(hoje, hoje)),
      ]);
      for (const r of [rS, rP, rA] as any[]) if (r.error) throw r.error;
      const individuais = new Set(prods.filter(p => p.controle_locacao === 'INDIVIDUAL').map(p => p.id));
      for (const s of rS.data || []) if (!individuais.has(s.produto_id)) somar(s.produto_id, n(s.quantidade_total), n(s.quantidade_manutencao));
      for (const p of rP.data || []) if (individuais.has(p.produto_id)) somar(p.produto_id, 1, p.situacao === 'MANUTENCAO' ? 1 : 0);
      for (const a of rA.data || []) emLoc.set(a.produto_id, (emLoc.get(a.produto_id) || 0) + n(a.quantidade));
    }

    const { data: inv, error: eI } = await db.from('estoque_inventarios').insert({
      empresa_id: dados.empresa_id, nome, local, categorias: categorias.length ? categorias : null, criado_por: ctx.perfil.nome,
    }).select('id').single();
    if (eI) throw eI;

    const linhas = prods.map(p => ({
      inventario_id: inv.id, produto_id: p.id, controle: p.controle_locacao === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'QUANTIDADE',
      saldo_sistema: saldo.get(p.id)?.total || 0, manutencao_sistema: saldo.get(p.id)?.manut || 0, em_locacao: emLoc.get(p.id) || 0,
    }));
    for (let i = 0; i < linhas.length; i += 500) {
      const { error: e2 } = await db.from('estoque_inventario_itens').insert(linhas.slice(i, i + 500));
      if (e2) throw e2;
    }
    log(ctx.perfil.nome, 'ABRIU INVENTÁRIO', `#${inv.id} ${nome} — ${linhas.length} produto(s)${local ? `, local ${local}` : ''}`);
    return { ok: true, info: { id: inv.id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CARREGAR
// ============================================================================
export async function carregarInventarioAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const a = await inventarioDoUsuario(id, ctx.permitidas);
    if ('erro' in a) return { ok: false, erro: a.erro };
    const [rI, rP] = await Promise.all([
      buscarTodasPaginas<any>((de, ate) => db.from('estoque_inventario_itens')
        .select('*, produto:produtos(nome_item, codigo_formatado, categoria_nome, unidade, custo_reposicao, valor_indenizacao)')
        .eq('inventario_id', id).order('id').range(de, ate)),
      buscarTodasPaginas<any>((de, ate) => db.from('estoque_inventario_pecas')
        .select('id, codigo_lido, patrimonio_id, produto_id, lido_por, lido_em, patrimonio:locacao_patrimonios(numero_patrimonio)')
        .eq('inventario_id', id).order('id').range(de, ate)),
    ]);
    if (rI.error) throw rI.error;
    if (rP.error) throw rP.error;

    // patrimônios esperados (itens por patrimônio) para apontar os não lidos
    const individuais = rI.data.filter(i => i.controle === 'INDIVIDUAL').map(i => i.produto_id);
    const esperados: any[] = [];
    for (let i = 0; i < individuais.length; i += 200) {
      let q = db.from('locacao_patrimonios').select('id, produto_id, numero_patrimonio, situacao, local')
        .eq('empresa_id', a.inv.empresa_id).in('situacao', ['ATIVO', 'MANUTENCAO']).in('produto_id', individuais.slice(i, i + 200));
      if (a.inv.local) q = q.eq('local', a.inv.local);
      const { data } = await q;
      esperados.push(...(data || []));
    }

    return {
      ok: true,
      info: {
        inventario: a.inv,
        itens: rI.data.map(i => ({
          id: i.id, produto_id: i.produto_id, controle: i.controle, saldo_sistema: n(i.saldo_sistema), manutencao_sistema: n(i.manutencao_sistema),
          em_locacao: n(i.em_locacao), contado: i.contado === null ? null : n(i.contado), contado_por: i.contado_por, contado_em: i.contado_em, observacao: i.observacao,
          nome: i.produto?.nome_item, codigo: i.produto?.codigo_formatado, categoria: i.produto?.categoria_nome, unidade: i.produto?.unidade,
          valor_unitario: n(i.produto?.custo_reposicao) || n(i.produto?.valor_indenizacao) || null,
        })).sort((x, y) => (x.codigo || x.nome || '').localeCompare(y.codigo || y.nome || '', 'pt-BR', { numeric: true })),
        pecas: rP.data.map(p => ({ id: p.id, codigo: p.codigo_lido, patrimonio_id: p.patrimonio_id, produto_id: p.produto_id, numero: p.patrimonio?.numero_patrimonio || null, lido_por: p.lido_por, lido_em: p.lido_em })),
        esperados,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CONTAGEM
// ============================================================================
export async function contarItemAction(itemId: number, contado: number | null, observacao: string | null, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (contado !== null && (!Number.isFinite(contado) || contado < 0)) return { ok: false, erro: 'Quantidade inválida.' };
  const db = supabaseAdmin();
  try {
    const { data: item } = await db.from('estoque_inventario_itens').select('inventario_id, controle').eq('id', itemId).maybeSingle();
    if (!item) return { ok: false, erro: 'Item não encontrado.' };
    const a = await inventarioDoUsuario(item.inventario_id, ctx.permitidas);
    if ('erro' in a) return { ok: false, erro: a.erro };
    if (a.inv.status !== 'ABERTO') return { ok: false, erro: 'Inventário já encerrado.' };
    if (item.controle === 'INDIVIDUAL') return { ok: false, erro: 'Item por patrimônio: conte lendo as etiquetas (aba Patrimônios).' };
    const { error } = await db.from('estoque_inventario_itens').update({
      contado, observacao: observacao?.trim() || null, contado_por: contado === null ? null : ctx.perfil.nome, contado_em: contado === null ? null : new Date().toISOString(),
    }).eq('id', itemId);
    if (error) throw error;
    return { ok: true, info: { contado_por: ctx.perfil.nome } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

async function recontarIndividual(db: ReturnType<typeof supabaseAdmin>, inventarioId: number, produtoId: number, usuario: string) {
  const { count } = await db.from('estoque_inventario_pecas').select('id', { count: 'exact', head: true })
    .eq('inventario_id', inventarioId).eq('produto_id', produtoId).not('patrimonio_id', 'is', null);
  await db.from('estoque_inventario_itens').update({ contado: count || 0, contado_por: usuario, contado_em: new Date().toISOString() })
    .eq('inventario_id', inventarioId).eq('produto_id', produtoId);
  return count || 0;
}

export async function lerPecaInventarioAction(inventarioId: number, codigo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const lido = (codigo || '').trim().toUpperCase();
  if (!lido) return { ok: false, erro: 'Código vazio.' };
  const db = supabaseAdmin();
  try {
    const a = await inventarioDoUsuario(inventarioId, ctx.permitidas);
    if ('erro' in a) return { ok: false, erro: a.erro };
    if (a.inv.status !== 'ABERTO') return { ok: false, erro: 'Inventário já encerrado.' };
    const sel = 'id, produto_id, numero_patrimonio, situacao, produto:produtos(nome_item)';
    let { data: pats } = await db.from('locacao_patrimonios').select(sel).eq('empresa_id', a.inv.empresa_id).eq('qr_code', lido);
    if (!pats?.length) ({ data: pats } = await db.from('locacao_patrimonios').select(sel).eq('empresa_id', a.inv.empresa_id).eq('numero_patrimonio', lido));
    const pat: any = pats?.[0] || null;

    // A mesma peça pode chegar pelo QR ("PAT-12-0001") ou digitada ("0001"):
    // códigos diferentes, mesmo patrimônio — a duplicidade é pelo patrimônio.
    if (pat) {
      const { data: ja } = await db.from('estoque_inventario_pecas').select('codigo_lido, lido_por')
        .eq('inventario_id', inventarioId).eq('patrimonio_id', pat.id).limit(1).maybeSingle();
      if (ja) return { ok: false, erro: `${pat.numero_patrimonio} já foi contado neste inventário (lido como "${ja.codigo_lido}" por ${ja.lido_por}).`, info: { duplicada: true } };
    }

    const { error } = await db.from('estoque_inventario_pecas').insert({
      inventario_id: inventarioId, codigo_lido: lido, patrimonio_id: pat?.id || null, produto_id: pat?.produto_id || null, lido_por: ctx.perfil.nome,
    });
    if (error) {
      if (String(error.message).includes('duplicate key')) return { ok: false, erro: `${lido} já foi lido neste inventário.`, info: { duplicada: true } };
      throw error;
    }
    if (!pat) return { ok: true, info: { desconhecido: true, codigo: lido } };

    // produto fora do escopo do inventário: entra como linha nova (achado)
    const { data: item } = await db.from('estoque_inventario_itens').select('id').eq('inventario_id', inventarioId).eq('produto_id', pat.produto_id).maybeSingle();
    if (!item) {
      await db.from('estoque_inventario_itens').insert({ inventario_id: inventarioId, produto_id: pat.produto_id, controle: 'INDIVIDUAL', saldo_sistema: 0, observacao: 'Fora do escopo — achado na leitura' });
    }
    const contagem = await recontarIndividual(db, inventarioId, pat.produto_id, ctx.perfil.nome);
    return { ok: true, info: { numero: pat.numero_patrimonio, produto: pat.produto?.nome_item, situacao: pat.situacao, contagem, produto_id: pat.produto_id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function removerPecaInventarioAction(pecaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: p } = await db.from('estoque_inventario_pecas').select('inventario_id, produto_id').eq('id', pecaId).maybeSingle();
    if (!p) return { ok: false, erro: 'Leitura não encontrada.' };
    const a = await inventarioDoUsuario(p.inventario_id, ctx.permitidas);
    if ('erro' in a) return { ok: false, erro: a.erro };
    if (a.inv.status !== 'ABERTO') return { ok: false, erro: 'Inventário já encerrado.' };
    await db.from('estoque_inventario_pecas').delete().eq('id', pecaId);
    if (p.produto_id) await recontarIndividual(db, p.inventario_id, p.produto_id, ctx.perfil.nome);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CONCLUIR (aplicar) / CANCELAR
// ============================================================================
export async function concluirInventarioAction(id: number, opcoes: { marcarExtraviados: boolean }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const a = await inventarioDoUsuario(id, ctx.permitidas);
    if ('erro' in a) return { ok: false, erro: a.erro };
    if (a.inv.status !== 'ABERTO') return { ok: false, erro: 'Inventário já encerrado.' };
    const inv = a.inv;
    const localAlvo = inv.local || LOCAL_PADRAO;
    const agora = new Date().toISOString();

    const { data: itens } = await buscarTodasPaginas<any>((de, ate) => db.from('estoque_inventario_itens').select('*').eq('inventario_id', id).order('id').range(de, ate));
    const contados = itens.filter(i => i.contado !== null);
    let saldosAjustados = 0, extraviados = 0, semMudanca = 0;

    for (const it of contados.filter(i => i.controle === 'QUANTIDADE')) {
      const novoTotal = n(it.contado) + n(it.em_locacao);
      if (novoTotal === n(it.saldo_sistema)) { semMudanca++; continue; }
      // sem local no inventário: o total vale para a empresa; o PRINCIPAL absorve a diferença dos outros locais
      let alvo = novoTotal;
      if (!inv.local) {
        const { data: outros } = await db.from('locacao_saldos').select('quantidade_total').eq('empresa_id', inv.empresa_id).eq('produto_id', it.produto_id).neq('local', LOCAL_PADRAO);
        alvo = Math.max(0, novoTotal - (outros || []).reduce((s: number, o: any) => s + n(o.quantidade_total), 0));
      }
      const { data: atual } = await db.from('locacao_saldos').select('quantidade_manutencao').eq('empresa_id', inv.empresa_id).eq('produto_id', it.produto_id).eq('local', localAlvo).maybeSingle();
      const { error } = await db.from('locacao_saldos').upsert({
        produto_id: it.produto_id, empresa_id: inv.empresa_id, local: localAlvo, quantidade_total: alvo,
        quantidade_manutencao: Math.min(n(atual?.quantidade_manutencao), alvo), observacoes: `Inventário #${id} (${agora.slice(0, 10)})`, updated_at: agora,
      }, { onConflict: 'produto_id,empresa_id,local' });
      if (error) throw error;
      saldosAjustados++;
    }

    if (opcoes.marcarExtraviados) {
      const { data: lidas } = await db.from('estoque_inventario_pecas').select('patrimonio_id').eq('inventario_id', id).not('patrimonio_id', 'is', null);
      const lidasSet = new Set((lidas || []).map((x: any) => x.patrimonio_id));
      for (const it of itens.filter(i => i.controle === 'INDIVIDUAL' && n(i.em_locacao) === 0 && i.contado !== null)) {
        // só ATIVO: peça em MANUTENCAO não lida pode estar no conserto (fornecedor)
        let q = db.from('locacao_patrimonios').select('id').eq('empresa_id', inv.empresa_id).eq('produto_id', it.produto_id).eq('situacao', 'ATIVO');
        if (inv.local) q = q.eq('local', inv.local);
        const { data: pats } = await q;
        const naoLidos = (pats || []).map((p: any) => p.id).filter((pid: number) => !lidasSet.has(pid));
        if (naoLidos.length) {
          await db.from('locacao_patrimonios').update({ situacao: 'EXTRAVIADO', observacoes: `Não encontrado no inventário #${id}`, updated_at: agora }).in('id', naoLidos);
          extraviados += naoLidos.length;
        }
      }
    }

    // peça que estava EXTRAVIADA e apareceu na contagem volta a ATIVO
    const { data: achadas } = await db.from('estoque_inventario_pecas').select('patrimonio:locacao_patrimonios(id, situacao)').eq('inventario_id', id).not('patrimonio_id', 'is', null);
    const reativar = (achadas || []).map((x: any) => x.patrimonio).filter((p: any) => p?.situacao === 'EXTRAVIADO').map((p: any) => p.id);
    if (reativar.length) await db.from('locacao_patrimonios').update({ situacao: 'ATIVO', observacoes: `Encontrado no inventário #${id}`, updated_at: agora }).in('id', reativar);

    const resumo = { contados: contados.length, naoContados: itens.length - contados.length, saldosAjustados, semMudanca, extraviados, reativados: reativar.length };
    await db.from('estoque_inventarios').update({ status: 'CONCLUIDO', concluido_por: ctx.perfil.nome, concluido_em: agora, resumo_aplicacao: resumo }).eq('id', id);
    log(ctx.perfil.nome, 'CONCLUIU INVENTÁRIO', `#${id} ${inv.nome}: ${saldosAjustados} saldo(s) ajustado(s), ${extraviados} extraviado(s)`);
    return { ok: true, info: resumo };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function cancelarInventarioAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const a = await inventarioDoUsuario(id, ctx.permitidas);
  if ('erro' in a) return { ok: false, erro: a.erro };
  if (a.inv.status !== 'ABERTO') return { ok: false, erro: 'Inventário já encerrado.' };
  await supabaseAdmin().from('estoque_inventarios').update({ status: 'CANCELADO', concluido_por: ctx.perfil.nome, concluido_em: new Date().toISOString() }).eq('id', id);
  log(ctx.perfil.nome, 'CANCELOU INVENTÁRIO', `#${id} ${a.inv.nome}`);
  return { ok: true };
}
