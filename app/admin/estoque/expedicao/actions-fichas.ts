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
import { gerarConferenciaMontagemPdf, type OsConferencia } from '../../../lib/locacao/gerarConferenciaMontagemPdf';
import { sincronizarChecklistComFichasLocacao } from '../../../lib/locacao/expedicaoFichaLocacao';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/estoque/expedicao';
const CONFIRMADAS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
// nº do P2S SEM prefixo de propósito: casa com os checklists antigos, importados do
// texto de fichas_reserva (ver app/lib/locacao/fichaNumero.ts)
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

// ============================================================================
// FICHA DE LOCAÇÃO PRÓPRIA (2026-11-20): depois de salvar o checklist, o que
// foi conferido na saída/retorno das OSs do sistema (FR-…) vira movimento na
// ficha de locação (abre a FL /A na 1ª saída). Fichas do P2S não mudam.
// ============================================================================
export async function sincronizarFichaLocacaoDoChecklistAction(checklistId: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const chk = await checklistDoUsuario(checklistId, ctx.permitidas);
  if ('erro' in chk) return { ok: false, erro: chk.erro };
  try {
    return { ok: true, info: await sincronizarChecklistComFichasLocacao(supabaseAdmin(), checklistId, ctx.perfil.nome) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// OS PARA SEPARAR (2026-11-17): fichas aprovadas/reservadas que ainda NÃO estão
// em nenhum checklist — o painel do topo da Expedição avisa a operação. "Está
// num checklist" = o nº da ficha aparece em checklists.ficha_numero ou em
// checklist_itens.os_numero ("027646", "027475, 027318", "FR-07050").
// Inclui as fichas do P2S (status A) e as criadas aqui. Só eventos que ainda
// não terminaram.
// ============================================================================
export async function osParaSepararAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const fichas: any[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await db.from('locacao_fichas_reserva')
        .select('id, origem, p2s_numero, status, empresa_id, data_saida, data_montagem, data_inicio, data_fim, aprovado_em, local_entrega, vendedor_nome, parceiro:parceiros(nome_exibicao, nome_completo), evento:eventos_feiras(id, nome, local, data_inicial, data_final, p2s_oid)')
        .in('status', ['APROVADO', 'RESERVADA']).gte('data_fim', hoje).order('id').range(de, de + 999);
      if (error) throw error;
      fichas.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const visiveis = fichas.filter(f => empresaPermitida(ctx.permitidas, f.empresa_id));
    if (!visiveis.length) return { ok: true, info: { os: [] } };

    // números já em checklist (checklists dos últimos 12 meses)
    const corte = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const usados = new Set<string>();
    const tokens = (t: string | null | undefined) => normalizar(t || '').replace(/^P2S\s*/, '').split(/[,;/\s]+/).filter(Boolean);
    const ids: string[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await db.from('checklists').select('id, ficha_numero').gte('updated_at', corte).order('id').range(de, de + 999);
      if (error) throw error;
      for (const c of (data || []) as any[]) { ids.push(c.id); tokens(c.ficha_numero).forEach(x => usados.add(x)); }
      if (!data || data.length < 1000) break;
    }
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from('checklist_itens').select('os_numero').in('checklist_id', ids.slice(i, i + 200)).not('os_numero', 'is', null);
      if (error) throw error;
      for (const it of (data || []) as any[]) tokens(it.os_numero).forEach(x => usados.add(x));
    }

    const pendentes = visiveis.filter(f => !usados.has(normalizar(numeroFicha(f))));
    // quantos equipamentos cada uma tem (só das pendentes)
    const qtdItens = new Map<number, number>();
    const pIds = pendentes.map(f => f.id);
    for (let i = 0; i < pIds.length; i += 300) {
      const { data } = await db.from('locacao_fichas_reserva_itens').select('ficha_id, quantidade, tipo').in('ficha_id', pIds.slice(i, i + 300)).in('tipo', ['EQUIPAMENTO', 'KIT', 'OUTRO']);
      for (const it of (data || []) as any[]) qtdItens.set(it.ficha_id, (qtdItens.get(it.ficha_id) || 0) + Number(it.quantidade || 0));
    }
    const dia = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
    const os = pendentes.map(f => {
      const saida = f.data_saida || f.data_montagem || f.data_inicio;
      return {
        ficha_id: f.id, numero: numeroFicha(f), origem: f.origem, status: f.status, empresa_id: f.empresa_id,
        cliente: f.parceiro ? (f.parceiro.nome_exibicao || f.parceiro.nome_completo) : '—',
        evento: f.evento ? { nome: f.evento.nome, local: f.evento.local, data_inicial: f.evento.data_inicial, data_final: f.evento.data_final, p2s_oid: f.evento.p2s_oid } : null,
        local: f.local_entrega || f.evento?.local || null, vendedor: f.vendedor_nome,
        saida, inicio: f.data_inicio, fim: f.data_fim, dias_ate_saida: Math.round((dia(saida) - dia(hoje)) / 86_400_000),
        aprovado_em: f.aprovado_em, novo: !!f.aprovado_em && Date.now() - Date.parse(f.aprovado_em) < 48 * 3_600_000,
        qtd_itens: qtdItens.get(f.id) || 0,
      };
    }).sort((a, b) => a.saida.localeCompare(b.saida) || a.numero.localeCompare(b.numero));
    return { ok: true, info: { os } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CONFERÊNCIA DE MONTAGEM / DESMONTAGEM (2026-11-17): relatório impresso por
// evento — uma folha por OS que está nos checklists daquele evento, com os
// equipamentos e serviços/extras da ficha e colunas de check.
// ============================================================================
/** Eventos que têm checklist (os mais recentes primeiro). */
export async function eventosComChecklistAction(accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const { data, error } = await supabaseAdmin().from('checklists')
      .select('id, evento_feira, empresa_id, status, periodo_inicio, periodo_fim, updated_at')
      .not('evento_feira', 'is', null).order('updated_at', { ascending: false }).limit(800);
    if (error) throw error;
    const grupos = new Map<string, { nome: string; checklists: number; status: string[]; periodo_inicio: string | null; periodo_fim: string | null; atualizado: string }>();
    for (const c of (data || []) as any[]) {
      if (c.empresa_id !== null && !empresaPermitida(ctx.permitidas, c.empresa_id)) continue;
      const chave = normalizar(c.evento_feira);
      if (!chave) continue;
      const g = grupos.get(chave) || { nome: String(c.evento_feira).trim(), checklists: 0, status: [] as string[], periodo_inicio: c.periodo_inicio, periodo_fim: c.periodo_fim, atualizado: c.updated_at };
      g.checklists++;
      if (!g.status.includes(c.status)) g.status.push(c.status);
      if (c.periodo_inicio && (!g.periodo_inicio || c.periodo_inicio < g.periodo_inicio)) g.periodo_inicio = c.periodo_inicio;
      if (c.periodo_fim && (!g.periodo_fim || c.periodo_fim > g.periodo_fim)) g.periodo_fim = c.periodo_fim;
      grupos.set(chave, g);
    }
    return { ok: true, info: [...grupos.values()] };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function conferenciaMontagemAction(evento: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const chave = normalizar(evento);
  if (!chave) return { ok: false, erro: 'Escolha o evento.' };
  const db = supabaseAdmin();
  try {
    // checklists do evento
    const { data: cks, error } = await db.from('checklists').select('id, evento_feira, empresa_id, cliente, local, ficha_numero')
      .ilike('evento_feira', `%${evento.trim().replace(/[%_]/g, ' ')}%`).limit(200);
    if (error) throw error;
    const doEvento = ((cks || []) as any[]).filter(c => normalizar(c.evento_feira) === chave && (c.empresa_id === null || empresaPermitida(ctx.permitidas, c.empresa_id)));
    if (!doEvento.length) return { ok: false, erro: 'Nenhum checklist encontrado para este evento.' };

    // OSs citadas nos itens (e no cabeçalho) dos checklists, na ordem em que aparecem
    const tokens = (t: string | null | undefined) => normalizar(t || '').replace(/^P2S\s*/, '').split(/[,;/\s]+/).filter(Boolean);
    const ordem: string[] = [];
    const itensChecklist = new Map<string, { descricao: string; quantidade: number }[]>();
    const add = (n: string) => { if (!ordem.includes(n)) ordem.push(n); };
    for (const c of doEvento) tokens(c.ficha_numero).forEach(add);
    const { data: itens, error: eI } = await db.from('checklist_itens').select('checklist_id, ordem, descricao, qtd_prevista, os_numero, extra')
      .in('checklist_id', doEvento.map(c => c.id)).not('os_numero', 'is', null).order('ordem');
    if (eI) throw eI;
    for (const it of (itens || []) as any[]) {
      const nums = tokens(it.os_numero);
      nums.forEach(add);
      // item com uma OS só: guarda como reserva (OS que não está no sistema)
      if (nums.length === 1) itensChecklist.set(nums[0], [...(itensChecklist.get(nums[0]) || []), { descricao: String(it.descricao || ''), quantidade: Number(it.qtd_prevista) || 0 }]);
    }
    if (!ordem.length) return { ok: false, erro: 'Os checklists deste evento ainda não têm OS vinculada (use "Importar das OSs" no checklist).' };

    // fichas: "FR-00012" (daqui) ou nº do P2S
    const idsSis = ordem.filter(n => /^FR-\d+$/.test(n)).map(n => Number(n.slice(3)));
    const numsP2s = ordem.filter(n => !/^FR-/.test(n));
    const sel = 'id, origem, p2s_numero, empresa_id, contato_nome, contato_telefone, vendedor_nome, endereco_estande, local_entrega, data_montagem, data_inicio, data_fim, data_desmontagem, observacoes, observacoes_internas, parceiro:parceiros(nome_exibicao, nome_completo), empresa:empresas(nome, nome_curto)';
    const [rSis, rP2s] = await Promise.all([
      idsSis.length ? db.from('locacao_fichas_reserva').select(sel).in('id', idsSis) : Promise.resolve({ data: [], error: null }),
      numsP2s.length ? db.from('locacao_fichas_reserva').select(sel).eq('origem', 'P2S').in('p2s_numero', numsP2s) : Promise.resolve({ data: [], error: null }),
    ]);
    if (rSis.error) throw rSis.error;
    if (rP2s.error) throw rP2s.error;
    const porNumero = new Map<string, any>();
    for (const f of [...(rSis.data || []), ...(rP2s.data || [])] as any[]) {
      if (empresaPermitida(ctx.permitidas, f.empresa_id)) porNumero.set(normalizar(numeroFicha(f)), f);
    }
    const fichaIds = [...porNumero.values()].map(f => f.id);
    const { data: fItens, error: eF } = fichaIds.length
      ? await db.from('locacao_fichas_reserva_itens').select('ficha_id, ordem, tipo, descricao, quantidade, produto_id, led_largura_m, led_altura_m, produto:produtos(codigo_formatado)').in('ficha_id', fichaIds).order('ordem')
      : { data: [], error: null };
    if (eF) throw eF;
    const itensPorFicha = new Map<number, any[]>();
    for (const it of (fItens || []) as any[]) itensPorFicha.set(it.ficha_id, [...(itensPorFicha.get(it.ficha_id) || []), it]);

    const m2 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lista: OsConferencia[] = ordem.map(n => {
      const f = porNumero.get(n);
      const ck = doEvento[0];
      if (!f) {
        return {
          numero: n, logo: 'RENTECH' as const, cliente: ck.cliente || '—', local: ck.local || null,
          equipamentos: (itensChecklist.get(n) || []).map(i => ({ quantidade: i.quantidade, descricao: i.descricao })), servicos: [], doChecklist: true,
        };
      }
      const its = itensPorFicha.get(f.id) || [];
      const ehEquip = (i: any) => i.tipo === 'EQUIPAMENTO' || i.tipo === 'KIT' || (i.tipo === 'OUTRO' && i.produto_id);
      const conv = (i: any) => ({
        quantidade: Number(i.quantidade) || 0, descricao: String(i.descricao || ''), codigo: i.produto?.codigo_formatado || null,
        detalhe: Number(i.led_largura_m) > 0 && Number(i.led_altura_m) > 0 ? `painel ${m2(Number(i.led_largura_m))} x ${m2(Number(i.led_altura_m))} m` : null,
      });
      const nomeEmp = `${f.empresa?.nome_curto || ''} ${f.empresa?.nome || ''}`.toUpperCase();
      return {
        numero: n, logo: (/ALFA/.test(nomeEmp) ? 'ALFALIGHT' : 'RENTECH') as 'ALFALIGHT' | 'RENTECH',
        cliente: f.parceiro ? (f.parceiro.nome_exibicao || f.parceiro.nome_completo) : '—',
        estande: f.endereco_estande, local: f.local_entrega,
        contato: [f.contato_nome, f.contato_telefone].filter(Boolean).join(' · ') || null, vendedor: f.vendedor_nome,
        montagem: f.data_montagem, inicio: f.data_inicio, fim: f.data_fim, desmontagem: f.data_desmontagem,
        observacoes: [f.observacoes, f.observacoes_internas].filter(Boolean).join(' | ') || null,
        equipamentos: its.filter(ehEquip).map(conv), servicos: its.filter(i => !ehEquip(i)).map(conv),
      };
    });
    const bytes = await gerarConferenciaMontagemPdf(doEvento[0].evento_feira.trim(), lista);
    return {
      ok: true,
      info: {
        base64: Buffer.from(bytes).toString('base64'),
        nome: `conferencia-montagem-${normalizar(evento).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
        qtdOs: lista.length, foraDoSistema: lista.filter(o => o.doChecklist).length,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
