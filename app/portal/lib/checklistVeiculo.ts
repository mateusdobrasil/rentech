// app/portal/lib/checklistVeiculo.ts
// Núcleo do checklist de veículo (saída/retorno + avarias), extraído de
// actions-checklist-veiculo.ts pra poder ser chamado tanto pela Server Action
// do Portal web quanto pelas Route Handlers novas usadas pelo app mobile
// (app/api/portal/checklist-veiculo/*). Mesmo motivo de espelhoPonto.ts: um
// módulo "use server" só pode exportar Server Actions, então funções soltas
// de dentro dele não são um jeito confiável de compartilhar lógica com uma
// Route Handler.
//
// Parametrizado por motoristaNome (não accessToken) — quem resolve a
// identidade (Portal por CPF ou equipe por cargo OPERACIONAL) é o chamador:
// actions-checklist-veiculo.ts (Portal) ou resolverMotorista.ts (mobile).
import { supabaseAdmin } from '../../lib/supabase';

export type Etapa = 'SAIDA' | 'RETORNO';
const BUCKET_FROTA = 'frota';

export interface ItemMarcado {
  descricao: string;
  ordem: number;
  marcado: boolean;
}

export interface GpsCaptura {
  lat: number;
  lng: number;
  local: string | null;
  capturadoEm: string;
}

// Confirma no servidor que o funcionário (via PORTAL) tem pode_dirigir = true.
// Fica aqui (não em actions-checklist-veiculo.ts, que é "use server") porque
// resolverMotorista.ts também precisa chamar isso a partir de uma Route
// Handler, e importar de dentro de um módulo "use server" é um padrão frágil
// fora do protocolo de Server Actions do Next.
export async function exigirPermissaoDirigir(db: ReturnType<typeof supabaseAdmin>, funcionarioNome: string): Promise<boolean> {
  const { data } = await db.from('folha_funcionarios').select('pode_dirigir').eq('nome_completo', funcionarioNome).maybeSingle();
  return !!data?.pode_dirigir;
}

export async function carregarChecklistVeiculoCore(db: ReturnType<typeof supabaseAdmin>, motoristaNome: string) {
  const [{ data: veiculos, error: erroVeiculos }, { data: checklistAberto, error: erroAberto }, { data: checklistsHistorico, error: erroHistorico }] = await Promise.all([
    db.from('frota_veiculos')
      .select('id, apelido, tipo, placa, km_atual, status, crlv_vencimento, seguro_vigencia_fim')
      .eq('status', 'ATIVO').eq('exibir_na_frota', true).order('apelido', { ascending: true }),
    db.from('frota_checklists').select('id, numero, veiculo_id, destino, km_inicial, combustivel_saida, saida_em')
      .eq('motorista_nome', motoristaNome).eq('status', 'EM_ANDAMENTO').order('saida_em', { ascending: false }).limit(1).maybeSingle(),
    db.from('frota_checklists').select('id, numero, veiculo_id, status, destino, km_inicial, km_final, saida_em, retorno_em')
      .eq('motorista_nome', motoristaNome).order('saida_em', { ascending: false }).limit(20),
  ]);
  if (erroVeiculos) throw new Error(erroVeiculos.message);
  if (erroAberto) throw new Error(erroAberto.message);
  if (erroHistorico) throw new Error(erroHistorico.message);

  const etapa: Etapa = checklistAberto ? 'RETORNO' : 'SAIDA';
  const veiculoIds = Array.from(new Set((checklistsHistorico || []).map((c: { veiculo_id: string }) => c.veiculo_id)));

  const [{ data: veiculosHistorico }, { data: itensModeloSaida, error: erroItensSaida }, { data: itensModeloRetorno, error: erroItensRetorno }, { data: avariasAbertas, error: erroAvarias }] = await Promise.all([
    veiculoIds.length > 0
      ? db.from('frota_veiculos').select('id, apelido, placa').in('id', veiculoIds)
      : Promise.resolve({ data: [] as { id: string; apelido: string; placa: string }[] }),
    db.from('frota_checklist_modelo_itens').select('id, ordem, descricao').eq('etapa', 'SAIDA').eq('ativo', true).order('ordem', { ascending: true }),
    // Busca as duas etapas sempre (não só a "atual") — o app mobile precisa
    // cachear os itens de SAÍDA e RETORNO de uma vez só pra dar pra criar um
    // checklist inteiro offline (ida e volta) sem depender de estar online no
    // meio da viagem pra buscar o modelo da segunda etapa.
    db.from('frota_checklist_modelo_itens').select('id, ordem, descricao').eq('etapa', 'RETORNO').eq('ativo', true).order('ordem', { ascending: true }),
    checklistAberto
      ? db.from('frota_checklist_avarias').select('id, etapa, descricao, foto_url, created_at').eq('checklist_id', checklistAberto.id).order('created_at', { ascending: true })
      : Promise.resolve({ data: [] as { id: string; etapa: string; descricao: string; foto_url: string | null; created_at: string }[], error: null }),
  ]);
  if (erroItensSaida) throw new Error(erroItensSaida.message);
  if (erroItensRetorno) throw new Error(erroItensRetorno.message);
  if (erroAvarias) throw new Error(erroAvarias.message);

  const historico = (checklistsHistorico || []).map((c: { veiculo_id: string }) => ({
    ...c,
    veiculo: veiculosHistorico?.find((v: { id: string }) => v.id === c.veiculo_id) || null,
  }));

  const itensPorEtapa = { SAIDA: itensModeloSaida || [], RETORNO: itensModeloRetorno || [] };

  return {
    veiculos: veiculos || [],
    checklistAberto: checklistAberto || null,
    avariasAbertas: avariasAbertas || [],
    historico,
    // itensModelo (singular) fica pra trás por compatibilidade com o Portal
    // web (ChecklistVeiculo.tsx), que só usa a etapa atual. O app mobile usa
    // itensModeloSaida/itensModeloRetorno pra cachear as duas de uma vez.
    itensModelo: itensPorEtapa[etapa],
    itensModeloSaida: itensPorEtapa.SAIDA,
    itensModeloRetorno: itensPorEtapa.RETORNO,
  };
}

export async function abrirChecklistCore(db: ReturnType<typeof supabaseAdmin>, params: {
  motoristaNome: string;
  empresaId: string | null;
  origem: 'PORTAL' | 'APP';
  veiculoId: string;
  kmInicial: number;
  combustivelSaida: string;
  destino: string;
  itens: ItemMarcado[];
  gps?: GpsCaptura;
  observacoesSaida?: string;
}): Promise<{ id: string; numero: number }> {
  if (!params.veiculoId) throw new Error('Selecione o veículo.');

  const { data: aberto } = await db
    .from('frota_checklists')
    .select('id')
    .eq('motorista_nome', params.motoristaNome)
    .eq('status', 'EM_ANDAMENTO')
    .maybeSingle();
  if (aberto) throw new Error('Você já tem um checklist em andamento. Finalize-o antes de abrir outro.');

  const { data: header, error: erroHeader } = await db
    .from('frota_checklists')
    .insert([{
      veiculo_id: params.veiculoId,
      motorista_nome: params.motoristaNome,
      empresa_id: params.empresaId,
      origem: params.origem,
      status: 'EM_ANDAMENTO',
      destino: params.destino || null,
      km_inicial: params.kmInicial,
      combustivel_saida: params.combustivelSaida || null,
      observacoes_saida: params.observacoesSaida || null,
      saida_gps_lat: params.gps?.lat ?? null,
      saida_gps_lng: params.gps?.lng ?? null,
      saida_gps_local: params.gps?.local ?? null,
      saida_gps_capturado_em: params.gps?.capturadoEm ?? null,
    }])
    .select('id, numero')
    .single();
  if (erroHeader || !header) throw new Error(erroHeader?.message || 'Falha ao abrir o checklist.');

  if (params.itens.length > 0) {
    const { error: erroItens } = await db.from('frota_checklist_itens').insert(
      params.itens.map(i => ({ checklist_id: header.id, etapa: 'SAIDA', ordem: i.ordem, descricao: i.descricao, marcado: i.marcado }))
    );
    if (erroItens) throw new Error(erroItens.message);
  }

  return { id: header.id, numero: header.numero };
}

export async function finalizarChecklistCore(db: ReturnType<typeof supabaseAdmin>, params: {
  motoristaNome: string;
  checklistId: string;
  kmFinal: number;
  combustivelRetorno: string;
  itens: ItemMarcado[];
  gps?: GpsCaptura;
  observacoesRetorno?: string;
}): Promise<void> {
  const { data: checklist } = await db
    .from('frota_checklists')
    .select('id, motorista_nome, status, veiculo_id')
    .eq('id', params.checklistId)
    .maybeSingle();

  // Confere posse e estado no servidor — nunca confia que o checklistId
  // pedido pelo cliente já "é" do motorista certo e está em aberto.
  if (!checklist || checklist.motorista_nome !== params.motoristaNome) {
    throw new Error('Checklist não encontrado.');
  }
  if (checklist.status !== 'EM_ANDAMENTO') {
    throw new Error('Este checklist já foi finalizado.');
  }

  const { error: erroUpdate } = await db
    .from('frota_checklists')
    .update({
      status: 'FINALIZADO',
      km_final: params.kmFinal,
      combustivel_retorno: params.combustivelRetorno || null,
      observacoes_retorno: params.observacoesRetorno || null,
      retorno_em: new Date().toISOString(),
      retorno_gps_lat: params.gps?.lat ?? null,
      retorno_gps_lng: params.gps?.lng ?? null,
      retorno_gps_local: params.gps?.local ?? null,
      retorno_gps_capturado_em: params.gps?.capturadoEm ?? null,
    })
    .eq('id', params.checklistId);
  if (erroUpdate) throw new Error(erroUpdate.message);

  if (params.itens.length > 0) {
    const { error: erroItens } = await db.from('frota_checklist_itens').insert(
      params.itens.map(i => ({ checklist_id: params.checklistId, etapa: 'RETORNO', ordem: i.ordem, descricao: i.descricao, marcado: i.marcado }))
    );
    if (erroItens) throw new Error(erroItens.message);
  }

  // O README exige que o retorno atualize o KM do veículo — o fluxo original
  // nunca fazia isso.
  const { error: erroKm } = await db.from('frota_veiculos').update({ km_atual: params.kmFinal }).eq('id', checklist.veiculo_id);
  if (erroKm) throw new Error(erroKm.message);
}

export async function registrarAvariaChecklistCore(db: ReturnType<typeof supabaseAdmin>, params: {
  motoristaNome: string;
  checklistId: string;
  etapa: Etapa;
  descricao: string;
  arquivoBase64?: string;
  nomeArquivo?: string;
  tipoMime?: string;
}): Promise<{ fotoUrl: string | null }> {
  const { data: checklist } = await db
    .from('frota_checklists')
    .select('id, motorista_nome')
    .eq('id', params.checklistId)
    .maybeSingle();
  if (!checklist || checklist.motorista_nome !== params.motoristaNome) {
    throw new Error('Checklist não encontrado.');
  }

  let fotoPath: string | null = null;
  let fotoUrl: string | null = null;

  if (params.arquivoBase64) {
    const bytes = Buffer.from(params.arquivoBase64, 'base64');
    const ext = (params.nomeArquivo?.split('.').pop() || 'jpg').toLowerCase();
    const path = `checklists/${params.checklistId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await db.storage.from(BUCKET_FROTA).upload(path, bytes, { contentType: params.tipoMime || 'image/jpeg' });
    if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

    fotoPath = path;
    fotoUrl = db.storage.from(BUCKET_FROTA).getPublicUrl(path).data.publicUrl;
  }

  const { error: erroInsert } = await db.from('frota_checklist_avarias').insert([{
    checklist_id: params.checklistId,
    etapa: params.etapa,
    descricao: params.descricao,
    foto_path: fotoPath,
    foto_url: fotoUrl,
  }]);
  if (erroInsert) throw new Error(erroInsert.message);

  return { fotoUrl };
}
