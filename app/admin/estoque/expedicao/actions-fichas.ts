'use server';

// app/admin/estoque/expedicao/actions-fichas.ts
// Expedição × fichas estruturadas e QR (2026-11-17):
//  - itensFichasDoEventoAction: itens das Fichas de Reserva do evento vindos
//    de locacao_fichas_reserva (importadas do P2S + criadas aqui), com produto
//    e quantidade exatos — substitui o parse do texto livre de fichas_reserva
//    (que fica como reserva para fichas fora da janela de importação).
//  - lerPecaAction / listarPecasAction / removerPecaAction: conferência peça a
//    peça pelo QR do patrimônio (etiquetas de Estoque → Equipamentos de
//    Locação), registrada em checklist_item_pecas.
// locacao_* e checklist_item_pecas só têm grant pro service_role — por isso
// passam por aqui, e não pelo client supabase que o resto da tela usa.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/estoque/expedicao';
const CONFIRMADAS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const numeroFicha = (f: { id: number; origem: string; p2s_numero: string | null }) =>
  f.origem === 'P2S' && f.p2s_numero ? f.p2s_numero : `FR-${String(f.id).padStart(5, '0')}`;
const normalizar = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

async function contexto(accessToken: string) {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { erro: acesso.message } as const;
  const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  return { perfil: acesso.perfil, permitidas } as const;
}

async function checklistDoUsuario(checklistId: string, permitidas: number[] | null) {
  const { data } = await supabaseAdmin().from('checklists').select('id, empresa_id, status').eq('id', checklistId).maybeSingle();
  if (!data) return { erro: 'Checklist não encontrado.' } as const;
  if (data.empresa_id !== null && !empresaPermitida(permitidas, data.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  return { checklist: data } as const;
}

// ============================================================================
// ITENS DAS FICHAS DO EVENTO
// ============================================================================
export async function itensFichasDoEventoAction(args: { evento_nome: string; evento_p2s_oid?: string | null }, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    // evento: pelo oid do P2S (gravado no checklist ao vincular) ou pelo nome
    let q = db.from('eventos_feiras').select('id');
    q = args.evento_p2s_oid ? q.eq('p2s_oid', args.evento_p2s_oid) : q.ilike('nome', (args.evento_nome || '').trim());
    const { data: evs } = await q;
    const eventoIds = (evs || []).map((e: any) => e.id);
    if (!eventoIds.length) return { ok: true, info: { linhas: [], fichasNaoConfirmadas: 0 } };

    let qf = db.from('locacao_fichas_reserva').select('id, origem, p2s_numero, status, empresa_id, parceiro:parceiros(nome_exibicao, nome_completo)').in('evento_id', eventoIds);
    if (ctx.permitidas !== null) qf = qf.in('empresa_id', ctx.permitidas.length ? ctx.permitidas : [0]);
    const { data: fichas, error } = await qf;
    if (error) throw error;
    const confirmadas = (fichas || []).filter((f: any) => CONFIRMADAS.includes(f.status));
    const naoConfirmadas = (fichas || []).filter((f: any) => ['ORCAMENTO', 'ENVIADO'].includes(f.status)).length;
    if (!confirmadas.length) return { ok: true, info: { linhas: [], fichasNaoConfirmadas: naoConfirmadas } };

    const { data: itens, error: eI } = await db.from('locacao_fichas_reserva_itens')
      .select('ficha_id, ordem, tipo, produto_id, descricao, quantidade')
      .in('ficha_id', confirmadas.map((f: any) => f.id)).in('tipo', ['EQUIPAMENTO', 'KIT']).order('ordem');
    if (eI) throw eI;
    const porId = new Map(confirmadas.map((f: any) => [f.id, f]));
    const linhas = (itens || []).map((i: any) => {
      const f: any = porId.get(i.ficha_id);
      return {
        ficha_numero: numeroFicha(f), ficha_cliente: f.parceiro ? (f.parceiro.nome_exibicao || f.parceiro.nome_completo) : '',
        ficha_status: f.status, produto_id: i.produto_id, descricao: String(i.descricao || '').toUpperCase(),
        qtd: Number(i.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 }), ordem: i.ordem,
      };
    });
    return { ok: true, info: { linhas, fichasNaoConfirmadas: naoConfirmadas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// QR — PEÇA A PEÇA
// ============================================================================
export async function listarPecasAction(checklistId: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const chk = await checklistDoUsuario(checklistId, ctx.permitidas);
  if ('erro' in chk) return { ok: false, erro: chk.erro };
  try {
    const { data, error } = await supabaseAdmin().from('checklist_item_pecas')
      .select('id, checklist_item_id, tipo, lido_por, lido_em, patrimonio:locacao_patrimonios(id, empresa_id, produto_id, numero_patrimonio, numero_serie, produto:produtos(nome_item, valor_indenizacao))')
      .eq('checklist_id', checklistId).order('lido_em', { ascending: false });
    if (error) throw error;
    return {
      ok: true,
      info: (data || []).map((p: any) => ({
        id: p.id, checklist_item_id: p.checklist_item_id, tipo: p.tipo, lido_por: p.lido_por, lido_em: p.lido_em,
        patrimonio_id: p.patrimonio?.id, numero: p.patrimonio?.numero_patrimonio, serie: p.patrimonio?.numero_serie, produto: p.patrimonio?.produto?.nome_item,
        produto_id: p.patrimonio?.produto_id, empresa_id: p.patrimonio?.empresa_id, valor_indenizacao: p.patrimonio?.produto?.valor_indenizacao ?? null,
      })),
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/**
 * Lê um código (QR "PAT-<empresa>-<nº>" ou o próprio nº do patrimônio) e
 * registra a peça na SAÍDA ou no RETORNO, na linha do checklist do mesmo
 * produto (por produto_id; sem ele, pela descrição igual ao nome do produto).
 * Só considera itens já salvos.
 */
export async function lerPecaAction(checklistId: string, codigo: string, tipo: 'SAIDA' | 'RETORNO', accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const chk = await checklistDoUsuario(checklistId, ctx.permitidas);
  if ('erro' in chk) return { ok: false, erro: chk.erro };
  const lido = (codigo || '').trim().toUpperCase();
  if (!lido) return { ok: false, erro: 'Código vazio.' };
  const db = supabaseAdmin();
  try {
    // 1) acha o patrimônio
    const sel = 'id, empresa_id, produto_id, numero_patrimonio, situacao, produto:produtos(nome_item)';
    let { data: pats } = await db.from('locacao_patrimonios').select(sel).eq('qr_code', lido);
    if (!pats?.length) ({ data: pats } = await db.from('locacao_patrimonios').select(sel).eq('numero_patrimonio', lido));
    let lista = (pats || []).filter((p: any) => empresaPermitida(ctx.permitidas, p.empresa_id));
    if (lista.length > 1 && chk.checklist.empresa_id) lista = lista.filter((p: any) => p.empresa_id === chk.checklist.empresa_id);
    if (!lista.length) return { ok: false, erro: `Patrimônio "${lido}" não encontrado.` };
    if (lista.length > 1) return { ok: false, erro: `"${lido}" existe em mais de uma empresa — leia pelo QR da etiqueta.` };
    const pat: any = lista[0];
    const nomeProduto = pat.produto?.nome_item || '';
    if (tipo === 'SAIDA' && pat.situacao !== 'ATIVO') {
      return { ok: false, erro: `${pat.numero_patrimonio} está como ${pat.situacao} — não pode sair para locação.` };
    }

    // 2) acha a linha do checklist
    const { data: itens } = await db.from('checklist_itens').select('id, produto_id, descricao, extra').eq('checklist_id', checklistId);
    const candidatos = (itens || []).filter((i: any) => i.produto_id === pat.produto_id);
    const porNome = (itens || []).filter((i: any) => !i.produto_id && normalizar(i.descricao).startsWith(normalizar(nomeProduto)));
    const item: any = candidatos.find((i: any) => !i.extra) || candidatos[0] || porNome.find((i: any) => !i.extra) || porNome[0];
    if (!item) return { ok: false, erro: `${pat.numero_patrimonio} (${nomeProduto}) não está neste checklist. Adicione o item e salve antes de ler.` };

    // 3) regras de sentido
    const { data: jaLidas } = await db.from('checklist_item_pecas').select('tipo').eq('checklist_id', checklistId).eq('patrimonio_id', pat.id);
    const tipos = new Set((jaLidas || []).map((x: any) => x.tipo));
    if (tipos.has(tipo)) return { ok: false, erro: `${pat.numero_patrimonio} já foi lido na ${tipo === 'SAIDA' ? 'saída' : 'volta'} deste checklist.`, info: { duplicada: true } };
    const avisoSemSaida = tipo === 'RETORNO' && !tipos.has('SAIDA');

    // a mesma peça não pode estar saindo em outro checklist sem ter voltado
    if (tipo === 'SAIDA') {
      const { data: outras } = await db.from('checklist_item_pecas').select('checklist_id, tipo').eq('patrimonio_id', pat.id).neq('checklist_id', checklistId);
      const porChk = new Map<string, Set<string>>();
      for (const o of outras || []) porChk.set(o.checklist_id, (porChk.get(o.checklist_id) || new Set()).add(o.tipo));
      const presa = [...porChk.entries()].find(([, t]) => t.has('SAIDA') && !t.has('RETORNO'));
      if (presa) {
        const { data: c } = await db.from('checklists').select('numero, evento_feira').eq('id', presa[0]).maybeSingle();
        return { ok: false, erro: `${pat.numero_patrimonio} saiu no checklist ${c?.numero ?? ''} (${c?.evento_feira || 'outro evento'}) e ainda não voltou.` };
      }
    }

    const { error } = await db.from('checklist_item_pecas').insert({
      checklist_id: checklistId, checklist_item_id: item.id, patrimonio_id: pat.id, tipo, lido_por: ctx.perfil.nome,
    });
    if (error) {
      if (String(error.message).includes('duplicate key')) return { ok: false, erro: `${pat.numero_patrimonio} já foi lido.` };
      throw error;
    }
    const { count } = await db.from('checklist_item_pecas').select('id', { count: 'exact', head: true })
      .eq('checklist_item_id', item.id).eq('tipo', tipo);
    return {
      ok: true,
      info: { checklist_item_id: item.id, numero: pat.numero_patrimonio, produto: nomeProduto, contagem: count || 0, avisoSemSaida },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function removerPecaAction(pecaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const { data: p } = await db.from('checklist_item_pecas').select('checklist_id, checklist_item_id, tipo').eq('id', pecaId).maybeSingle();
    if (!p) return { ok: false, erro: 'Leitura não encontrada.' };
    const chk = await checklistDoUsuario(p.checklist_id, ctx.permitidas);
    if ('erro' in chk) return { ok: false, erro: chk.erro };
    const { error } = await db.from('checklist_item_pecas').delete().eq('id', pecaId);
    if (error) throw error;
    const { count } = p.checklist_item_id
      ? await db.from('checklist_item_pecas').select('id', { count: 'exact', head: true }).eq('checklist_item_id', p.checklist_item_id).eq('tipo', p.tipo)
      : { count: 0 };
    return { ok: true, info: { checklist_item_id: p.checklist_item_id, tipo: p.tipo, contagem: count || 0 } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
