"use server";

// app/portal/actions/actions-checklist-veiculo.ts
// Checklist de saída/retorno de veículos da frota, preenchido pelo próprio
// motorista no Portal. Mesma identidade nunca vem do cliente — sempre
// resolvida no servidor a partir do access_token (resolverFuncionarioPortal),
// e toda ação sobre um checklist existente confere que ele pertence ao
// funcionário logado antes de ler/gravar (mesmo padrão de actions-documentos.ts).
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';

type Resultado = { ok: boolean; erro?: string; info?: any };
type Etapa = 'SAIDA' | 'RETORNO';

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';
const ERRO_SEM_PERMISSAO = 'Você não tem permissão para dirigir veículos da frota.';
const BUCKET_FROTA = 'frota';

interface ItemMarcado {
  descricao: string;
  ordem: number;
  marcado: boolean;
}


// Confirma no servidor que o funcionário logado tem pode_dirigir = true —
// chamada no início de toda ação que abre/fecha checklist, além do check de
// visibilidade da aba feito em listarMeusChecklistsAction/podeDirigirAction.
async function exigirPermissaoDirigir(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string): Promise<boolean> {
  const { data } = await db.from('folha_funcionarios').select('pode_dirigir').eq('nome_completo', funcionarioNome).maybeSingle();
  return !!data?.pode_dirigir;
}

export async function podeDirigirAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  const podeDirigir = await exigirPermissaoDirigir(db, func.funcionarioNome);
  return { ok: true, info: { podeDirigir } };
}

// ============================================================================
// VEÍCULOS DISPONÍVEIS PARA O SELETOR
// ============================================================================
export async function listarVeiculosParaChecklistAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  if (!(await exigirPermissaoDirigir(db, func.funcionarioNome))) return { ok: false, erro: ERRO_SEM_PERMISSAO };

  try {
    const { data, error } = await db
      .from('frota_veiculos')
      .select('id, apelido, tipo, placa')
      .eq('status', 'ATIVO')
      .eq('exibir_na_frota', true)
      .order('apelido', { ascending: true });
    if (error) throw new Error(error.message);
    return { ok: true, info: { veiculos: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// MODELO DE ITENS (catálogo fixo, por etapa)
// ============================================================================
export async function listarModeloItensAction(accessToken: string, etapa: Etapa): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('frota_checklist_modelo_itens')
      .select('id, ordem, descricao')
      .eq('etapa', etapa)
      .eq('ativo', true)
      .order('ordem', { ascending: true });
    if (error) throw new Error(error.message);
    return { ok: true, info: { itens: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CHECKLIST EM ANDAMENTO DO PRÓPRIO MOTORISTA (define se a tela mostra
// "abrir saída" ou "fechar retorno")
// ============================================================================
export async function buscarChecklistAbertoAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('frota_checklists')
      .select('id, numero, veiculo_id, destino, km_inicial, combustivel_saida, saida_em')
      .eq('motorista_nome', func.funcionarioNome)
      .eq('status', 'EM_ANDAMENTO')
      .order('saida_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, info: { checklist: data || null } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// HISTÓRICO DO PRÓPRIO MOTORISTA
// ============================================================================
export async function listarMeusChecklistsAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('frota_checklists')
      .select('id, numero, veiculo_id, status, destino, km_inicial, km_final, saida_em, retorno_em')
      .eq('motorista_nome', func.funcionarioNome)
      .order('saida_em', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    const veiculoIds = Array.from(new Set((data || []).map(c => c.veiculo_id)));
    const { data: veiculos } = veiculoIds.length > 0
      ? await db.from('frota_veiculos').select('id, apelido, placa').in('id', veiculoIds)
      : { data: [] as { id: string; apelido: string; placa: string }[] };

    const checklists = (data || []).map(c => ({
      ...c,
      veiculo: veiculos?.find(v => v.id === c.veiculo_id) || null,
    }));

    return { ok: true, info: { checklists } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ABRIR CHECKLIST (SAÍDA)
// ============================================================================
export async function abrirChecklistAction(accessToken: string, payload: {
  veiculoId: string;
  kmInicial: number;
  combustivelSaida: string;
  destino: string;
  itens: ItemMarcado[];
}): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  if (!(await exigirPermissaoDirigir(db, func.funcionarioNome))) return { ok: false, erro: ERRO_SEM_PERMISSAO };

  if (!payload.veiculoId) return { ok: false, erro: 'Selecione o veículo.' };

  try {
    const { data: aberto } = await db
      .from('frota_checklists')
      .select('id')
      .eq('motorista_nome', func.funcionarioNome)
      .eq('status', 'EM_ANDAMENTO')
      .maybeSingle();
    if (aberto) return { ok: false, erro: 'Você já tem um checklist em andamento. Finalize-o antes de abrir outro.' };

    const { data: header, error: erroHeader } = await db
      .from('frota_checklists')
      .insert([{
        veiculo_id: payload.veiculoId,
        motorista_nome: func.funcionarioNome,
        origem: 'PORTAL',
        status: 'EM_ANDAMENTO',
        destino: payload.destino || null,
        km_inicial: payload.kmInicial,
        combustivel_saida: payload.combustivelSaida || null,
      }])
      .select('id, numero')
      .single();
    if (erroHeader || !header) throw new Error(erroHeader?.message || 'Falha ao abrir o checklist.');

    if (payload.itens.length > 0) {
      const { error: erroItens } = await db.from('frota_checklist_itens').insert(
        payload.itens.map(i => ({ checklist_id: header.id, etapa: 'SAIDA', ordem: i.ordem, descricao: i.descricao, marcado: i.marcado }))
      );
      if (erroItens) throw new Error(erroItens.message);
    }

    return { ok: true, info: { id: header.id, numero: header.numero } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// FINALIZAR CHECKLIST (RETORNO)
// ============================================================================
export async function finalizarChecklistAction(accessToken: string, payload: {
  checklistId: string;
  kmFinal: number;
  combustivelRetorno: string;
  itens: ItemMarcado[];
}): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const { data: checklist } = await db
      .from('frota_checklists')
      .select('id, motorista_nome, status')
      .eq('id', payload.checklistId)
      .maybeSingle();

    // Confere posse e estado no servidor — nunca confia que o checklistId
    // pedido pelo cliente já "é" do motorista certo e está em aberto.
    if (!checklist || checklist.motorista_nome !== func.funcionarioNome) {
      return { ok: false, erro: 'Checklist não encontrado.' };
    }
    if (checklist.status !== 'EM_ANDAMENTO') {
      return { ok: false, erro: 'Este checklist já foi finalizado.' };
    }

    const { error: erroUpdate } = await db
      .from('frota_checklists')
      .update({
        status: 'FINALIZADO',
        km_final: payload.kmFinal,
        combustivel_retorno: payload.combustivelRetorno || null,
        retorno_em: new Date().toISOString(),
      })
      .eq('id', payload.checklistId);
    if (erroUpdate) throw new Error(erroUpdate.message);

    if (payload.itens.length > 0) {
      const { error: erroItens } = await db.from('frota_checklist_itens').insert(
        payload.itens.map(i => ({ checklist_id: payload.checklistId, etapa: 'RETORNO', ordem: i.ordem, descricao: i.descricao, marcado: i.marcado }))
      );
      if (erroItens) throw new Error(erroItens.message);
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// REGISTRAR AVARIA (texto + foto opcional)
// Chamada depois de abrirChecklistAction/finalizarChecklistAction, já com o
// checklistId em mãos — confere posse antes de gravar. Quando há foto, o
// cliente lê o arquivo como base64 e esta mesma ação sobe pro Storage, no
// mesmo padrão de uploadFotoFuncionarioAction
// (app/admin/rh/actions/actions-documentos-func.ts).
// ============================================================================
export async function registrarAvariaChecklistAction(accessToken: string, payload: {
  checklistId: string;
  etapa: Etapa;
  descricao: string;
  arquivoBase64?: string;
  nomeArquivo?: string;
  tipoMime?: string;
}): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const { data: checklist } = await db
      .from('frota_checklists')
      .select('id, motorista_nome')
      .eq('id', payload.checklistId)
      .maybeSingle();
    if (!checklist || checklist.motorista_nome !== func.funcionarioNome) {
      return { ok: false, erro: 'Checklist não encontrado.' };
    }

    let fotoPath: string | null = null;
    let fotoUrl: string | null = null;

    if (payload.arquivoBase64) {
      const bytes = Buffer.from(payload.arquivoBase64, 'base64');
      const ext = (payload.nomeArquivo?.split('.').pop() || 'jpg').toLowerCase();
      const path = `checklists/${payload.checklistId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: upErr } = await db.storage.from(BUCKET_FROTA).upload(path, bytes, { contentType: payload.tipoMime || 'image/jpeg' });
      if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

      fotoPath = path;
      fotoUrl = db.storage.from(BUCKET_FROTA).getPublicUrl(path).data.publicUrl;
    }

    const { error: erroInsert } = await db.from('frota_checklist_avarias').insert([{
      checklist_id: payload.checklistId,
      etapa: payload.etapa,
      descricao: payload.descricao,
      foto_path: fotoPath,
      foto_url: fotoUrl,
    }]);
    if (erroInsert) throw new Error(erroInsert.message);

    return { ok: true, info: { fotoUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
