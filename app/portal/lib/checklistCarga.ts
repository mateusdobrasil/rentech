// app/portal/lib/checklistCarga.ts
// Núcleo do checklist de carga pro app mobile — porta a lógica essencial de
// app/admin/estoque/expedicao/page.tsx (criar, listar, abrir, conferir).
// Não porta a importação de itens das OS's/fichas de reserva (parsing de
// texto livre, só faz sentido no desktop) nem a baixa automática no
// PrimeStart (finalizarFichasLocacaoPorEventoAction, só dispara quando
// evento_p2s_oid existe — checklists criados pelo app nunca têm isso, já que
// a criação aqui é sempre manual, sem vínculo de evento).
import { supabaseAdmin } from '../../lib/supabase';

export type EtapaCarga = 'SAIDA' | 'RETORNO';

interface ChecklistItemRow {
  id: string;
  checklist_id: string;
  ordem: number;
  secao: string;
  equipamento_id: string | null;
  descricao: string;
  qtd_prevista: string | null;
  saida_ok: boolean;
  saida_qtd: number | null;
  retorno_ok: boolean;
  retorno_qtd: number | null;
  extra: boolean;
}

interface ChecklistRow {
  id: string;
  numero: number;
  evento_feira: string | null;
  cliente: string | null;
  local: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  status: 'RASCUNHO' | 'SAIDA_CONFERIDA' | 'FINALIZADO';
  empresa_id: number | null;
  created_at: string;
}

export async function carregarChecklistsCargaCore(db: ReturnType<typeof supabaseAdmin>, empresasPermitidas: number[] | null) {
  let query = db
    .from('checklists')
    .select('id, numero, evento_feira, cliente, local, periodo_inicio, periodo_fim, status, empresa_id, created_at')
    .order('created_at', { ascending: false });
  if (empresasPermitidas) query = query.in('empresa_id', empresasPermitidas.length ? empresasPermitidas : [-1]);

  const { data: checklists, error } = await query;
  if (error) throw new Error(error.message);

  const ids = (checklists || []).map((c: ChecklistRow) => c.id);
  const divergenciasPorChecklist: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: divergencias, error: erroDiv } = await db.from('checklist_divergencias').select('checklist_id').in('checklist_id', ids);
    if (erroDiv) throw new Error(erroDiv.message);
    (divergencias || []).forEach((d: { checklist_id: string }) => {
      divergenciasPorChecklist[d.checklist_id] = (divergenciasPorChecklist[d.checklist_id] || 0) + 1;
    });
  }

  return (checklists || []).map((c: ChecklistRow) => ({ ...c, divergencias: divergenciasPorChecklist[c.id] || 0 }));
}

export async function abrirChecklistCargaCore(db: ReturnType<typeof supabaseAdmin>, params: {
  criadoPor: string;
  empresaId: number;
  eventoFeira: string;
  cliente: string;
  local: string;
  periodoInicio: string | null;
  periodoFim: string | null;
}): Promise<{ id: string; numero: number }> {
  const { data: header, error } = await db
    .from('checklists')
    .insert([{
      evento_feira: params.eventoFeira || null,
      cliente: params.cliente || null,
      local: params.local || null,
      periodo_inicio: params.periodoInicio,
      periodo_fim: params.periodoFim,
      status: 'RASCUNHO',
      created_by: params.criadoPor,
      empresa_id: params.empresaId,
    }])
    .select('id, numero')
    .single();
  if (error || !header) throw new Error(error?.message || 'Falha ao criar o checklist.');

  const { data: modelo, error: erroModelo } = await db
    .from('checklist_modelo_itens')
    .select('ordem, secao, equipamento_id, descricao, qtd_padrao')
    .eq('ativo', true)
    .order('ordem', { ascending: true });
  if (erroModelo) throw new Error(erroModelo.message);

  if (modelo && modelo.length > 0) {
    const payloadItens = modelo.map((m: { ordem: number; secao: string; equipamento_id: string | null; descricao: string; qtd_padrao: string | null }) => ({
      checklist_id: header.id,
      ordem: m.ordem,
      secao: m.secao,
      equipamento_id: m.equipamento_id,
      descricao: m.descricao,
      qtd_prevista: m.qtd_padrao,
    }));
    const { error: erroItens } = await db.from('checklist_itens').insert(payloadItens);
    if (erroItens) throw new Error(erroItens.message);
  }

  return { id: header.id, numero: header.numero };
}

export async function carregarChecklistCargaCore(db: ReturnType<typeof supabaseAdmin>, checklistId: string, empresasPermitidas: number[] | null) {
  const { data: checklist, error } = await db.from('checklists').select('*').eq('id', checklistId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!checklist) throw new Error('Checklist não encontrado.');
  if (empresasPermitidas && checklist.empresa_id != null && !empresasPermitidas.includes(checklist.empresa_id)) {
    throw new Error('Checklist não encontrado.');
  }

  const { data: itens, error: erroItens } = await db.from('checklist_itens').select('*').eq('checklist_id', checklistId).order('ordem', { ascending: true });
  if (erroItens) throw new Error(erroItens.message);

  const { data: divergencias, error: erroDiv } = await db.from('checklist_divergencias').select('*').eq('checklist_id', checklistId);
  if (erroDiv) throw new Error(erroDiv.message);

  return { checklist: checklist as ChecklistRow, itens: (itens || []) as ChecklistItemRow[], divergencias: divergencias || [] };
}

// "Lote" e outros textos livres não numéricos em qtd_prevista simplesmente
// nunca geram divergência (não há o que comparar) — só itens com previsto
// numérico entram na checagem, igual ao admin.
function qtdNumerica(v: string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export async function salvarConferenciaCore(db: ReturnType<typeof supabaseAdmin>, params: {
  checklistId: string;
  tipo: EtapaCarga;
  usuarioNome: string;
  itens: { id: string; ok: boolean; qtd: number | null }[];
}): Promise<void> {
  const { data: checklist, error: erroChecklist } = await db
    .from('checklists')
    .select('id, numero, evento_feira, cliente')
    .eq('id', params.checklistId)
    .maybeSingle();
  if (erroChecklist || !checklist) throw new Error('Checklist não encontrado.');

  const colOk = params.tipo === 'SAIDA' ? 'saida_ok' : 'retorno_ok';
  const colQtd = params.tipo === 'SAIDA' ? 'saida_qtd' : 'retorno_qtd';

  for (const item of params.itens) {
    const { error } = await db.from('checklist_itens').update({ [colOk]: item.ok, [colQtd]: item.qtd }).eq('id', item.id);
    if (error) throw new Error(`Falha ao salvar item: ${error.message}`);
  }

  const idsItens = params.itens.map(i => i.id);
  const { data: itensAtualizados, error: erroItens } = await db.from('checklist_itens').select('*').in('id', idsItens);
  if (erroItens) throw new Error(erroItens.message);

  const linhas = (itensAtualizados || []) as ChecklistItemRow[];
  const divergentes = linhas.filter(item => {
    const marcado = params.tipo === 'SAIDA' ? item.saida_ok : item.retorno_ok;
    const qtdReal = params.tipo === 'SAIDA' ? item.saida_qtd : item.retorno_qtd;
    const previsto = qtdNumerica(item.qtd_prevista);
    return marcado && qtdReal != null && previsto != null && qtdReal !== previsto;
  });
  const resolvidos = linhas.filter(item => !divergentes.includes(item));

  if (divergentes.length > 0) {
    const payload = divergentes.map(item => ({
      checklist_id: params.checklistId,
      item_id: item.id,
      checklist_numero: checklist.numero,
      tipo: params.tipo,
      secao: item.secao,
      descricao: item.descricao,
      qtd_esperada: qtdNumerica(item.qtd_prevista),
      qtd_real: params.tipo === 'SAIDA' ? item.saida_qtd : item.retorno_qtd,
      usuario_nome: params.usuarioNome,
      evento_feira: checklist.evento_feira || null,
      cliente: checklist.cliente || null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await db.from('checklist_divergencias').upsert(payload, { onConflict: 'item_id,tipo' });
    if (error) throw new Error(error.message);
  }
  if (resolvidos.length > 0) {
    const idsResolvidos = resolvidos.map(i => i.id);
    const { error } = await db.from('checklist_divergencias').delete().eq('tipo', params.tipo).in('item_id', idsResolvidos);
    if (error) throw new Error(error.message);
  }

  const novoStatus = params.tipo === 'SAIDA' ? 'SAIDA_CONFERIDA' : 'FINALIZADO';
  const patch: Record<string, unknown> = { status: novoStatus, updated_at: new Date().toISOString() };
  if (params.tipo === 'SAIDA') patch.responsavel_saida = params.usuarioNome;
  else patch.responsavel_retorno = params.usuarioNome;

  const { error: erroStatus } = await db.from('checklists').update(patch).eq('id', params.checklistId);
  if (erroStatus) throw new Error(erroStatus.message);
}
