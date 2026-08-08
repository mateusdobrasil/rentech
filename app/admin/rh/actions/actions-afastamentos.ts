'use server';

// app/admin/rh/actions/actions-afastamentos.ts
// Lançamento e controle de afastamentos (atestados, INSS, licenças, etc.).
// Reaproveita o bucket de Storage do módulo de Documentos (documentos-funcionarios)
// para o anexo opcional do atestado/laudo.
import { supabaseAdmin } from '../../../lib/supabase';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET = 'documentos-funcionarios';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const hojeIso = (): string => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
};
const addDiasIso = (iso: string, dias: number): string => {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// ============================================================================
// INTEGRAÇÃO COM O PONTO: garante que os dias do período do afastamento
// tenham abono de dia todo em folha_ponto_abono (não conta falta, não exige
// batida). Sem dataFim conhecida, cobre só até hoje — dias futuros entram
// quando o afastamento for editado/encerrado com a data final. Nunca
// sobrescreve um dia que já tenha abono de outra origem (WhatsApp, CSV,
// lançamento manual, etc.), e pula meses com folha já fechada (mesma trava
// usada no lançamento manual de ponto).
// ============================================================================
async function sincronizarAbonosAfastamento(db: ReturnType<typeof supabaseAdmin>, params: {
  afastamentoId: number; funcionarioNome: string; dataInicio: string; dataFimEfetivo: string; tipoNome: string;
}) {
  const { afastamentoId, funcionarioNome, dataInicio, dataFimEfetivo, tipoNome } = params;

  const dias: string[] = [];
  for (let d = dataInicio; d <= dataFimEfetivo; d = addDiasIso(d, 1)) dias.push(d);

  const mesesEnvolvidos = Array.from(new Set(dias.map(d => d.slice(0, 7))));
  const { data: fechadas } = mesesEnvolvidos.length
    ? await db.from('folha_holerites').select('mes_referencia').eq('funcionario_nome', funcionarioNome).in('mes_referencia', mesesEnvolvidos)
    : { data: [] as { mes_referencia: string }[] };
  const mesesFechados = new Set((fechadas || []).map(f => f.mes_referencia));
  const diasValidos = new Set(dias.filter(d => !mesesFechados.has(d.slice(0, 7))));

  // Remove vínculos antigos deste afastamento que ficaram fora do período
  // atual (ex.: RH encurtou a data de fim numa edição)
  const { data: vinculados } = await db.from('folha_ponto_abono').select('id, data_abono').eq('afastamento_id', afastamentoId);
  const idsParaRemover = (vinculados || []).filter(v => !diasValidos.has(v.data_abono)).map(v => v.id);
  if (idsParaRemover.length) await db.from('folha_ponto_abono').delete().in('id', idsParaRemover);

  const diasFaltando = Array.from(diasValidos).filter(d => !(vinculados || []).some(v => v.data_abono === d));
  if (!diasFaltando.length) return;

  // Não sobrescreve dia que já tenha abono lançado por outra fonte
  const { data: ocupadosPorOutros } = await db.from('folha_ponto_abono')
    .select('data_abono').eq('funcionario_nome', funcionarioNome).in('data_abono', diasFaltando);
  const ocupados = new Set((ocupadosPorOutros || []).map(o => o.data_abono));

  const novos = diasFaltando.filter(d => !ocupados.has(d)).map(d => ({
    funcionario_nome: funcionarioNome, data_abono: d, dia_todo: true,
    hora_inicio: null, hora_fim: null, minutos_abonados: 480,
    motivo: `Afastamento: ${tipoNome}`, origem: 'AFASTAMENTO', afastamento_id: afastamentoId
  }));
  if (novos.length) await db.from('folha_ponto_abono').insert(novos);
}

// ============================================================================
// CATÁLOGO DE TIPOS
// ============================================================================
export async function listarTiposAfastamentoAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('folha_afastamento_tipos').select('*').eq('ativo', true).order('nome');
    if (error) throw new Error(error.message);
    return { ok: true, info: { tipos: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarTipoAfastamentoAction(payload: { nome: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome para o tipo de afastamento.' };
  try {
    const { error } = await db.from('folha_afastamento_tipos').insert({ nome });
    if (error) {
      if (error.code === '23505') return { ok: false, erro: `"${nome}" já existe.` };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PAINEL: lista todos os afastamentos com tipo/cargo já resolvidos + KPIs.
// ============================================================================
export async function painelAfastamentosAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: afastamentos, error } = await db.from('folha_afastamentos')
      .select('*').order('data_inicio', { ascending: false });
    if (error) throw new Error(error.message);

    const { data: tipos } = await db.from('folha_afastamento_tipos').select('id, nome');
    const nomeTipo = (id: number) => tipos?.find(t => t.id === id)?.nome || '—';
    const { data: funcs } = await db.from('folha_funcionarios').select('nome_completo, cargo');
    const cargoFunc = (nome: string) => funcs?.find(f => f.nome_completo === nome)?.cargo || null;

    const hoje = hojeIso();
    const linhas = (afastamentos || []).map(a => {
      const dias = a.data_fim ? Math.round((new Date(a.data_fim).getTime() - new Date(a.data_inicio).getTime()) / 86400000) + 1
        : Math.round((new Date(hoje).getTime() - new Date(a.data_inicio).getTime()) / 86400000) + 1;
      return {
        ...a, tipo: nomeTipo(a.tipo_id), cargo: cargoFunc(a.funcionario_nome),
        temAnexo: !!a.storage_path, dias
      };
    });

    const totais = {
      ativos: linhas.filter(l => l.status === 'ATIVO').length,
      encerradosNoMes: linhas.filter(l => l.status === 'ENCERRADO' && l.data_fim && l.data_fim.slice(0, 7) === hoje.slice(0, 7)).length,
      total: linhas.length
    };

    return { ok: true, info: { linhas, totais } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LANÇAR/EDITAR afastamento (com anexo opcional em base64)
// ============================================================================
export async function salvarAfastamentoAction(payload: {
  id?: number;
  funcionarioNome: string;
  tipoId: number;
  dataInicio: string;
  dataFim?: string | null;
  cid?: string | null;
  observacao?: string | null;
  arquivoBase64?: string | null;
  nomeArquivo?: string | null;
  tipoMime?: string | null;
  usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { id, funcionarioNome, tipoId, dataInicio, dataFim, cid, observacao, arquivoBase64, nomeArquivo, tipoMime, usuarioNome } = payload;

  if (!funcionarioNome || !tipoId || !dataInicio) {
    return { ok: false, erro: 'Funcionário, tipo e data de início são obrigatórios.' };
  }
  if (dataFim && dataFim < dataInicio) {
    return { ok: false, erro: 'A data de fim não pode ser antes da data de início.' };
  }

  try {
    let storagePath: string | null = null;
    let nomeArquivoSalvo: string | null = null;
    if (arquivoBase64 && nomeArquivo) {
      const bytes = Buffer.from(arquivoBase64, 'base64');
      const path = `${slug(funcionarioNome)}/afastamentos/${Date.now()}-${slug(nomeArquivo.replace(/\.[^.]+$/, ''))}.${(nomeArquivo.split('.').pop() || 'bin').toLowerCase()}`;
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
        contentType: tipoMime || 'application/octet-stream', upsert: false
      });
      if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);
      storagePath = path;
      nomeArquivoSalvo = nomeArquivo;
    }

    const status = dataFim && dataFim < hojeIso() ? 'ENCERRADO' : 'ATIVO';

    const { data: tipoRow } = await db.from('folha_afastamento_tipos').select('nome').eq('id', tipoId).maybeSingle();
    const tipoNome = tipoRow?.nome || 'AFASTAMENTO';

    let afastamentoId: number;
    if (id) {
      const update: any = {
        tipo_id: tipoId, data_inicio: dataInicio, data_fim: dataFim || null,
        cid: cid || null, observacao: observacao || null, status,
        atualizado_em: new Date().toISOString()
      };
      if (storagePath) { update.storage_path = storagePath; update.nome_arquivo = nomeArquivoSalvo; }
      const { error } = await db.from('folha_afastamentos').update(update).eq('id', id);
      if (error) throw new Error(error.message);
      afastamentoId = id;
    } else {
      const { data: novo, error } = await db.from('folha_afastamentos').insert({
        funcionario_nome: funcionarioNome, tipo_id: tipoId, data_inicio: dataInicio, data_fim: dataFim || null,
        cid: cid || null, observacao: observacao || null, status,
        storage_path: storagePath, nome_arquivo: nomeArquivoSalvo, criado_por: usuarioNome
      }).select('id').single();
      if (error) throw new Error(error.message);
      afastamentoId = novo.id;
    }

    await sincronizarAbonosAfastamento(db, {
      afastamentoId, funcionarioNome, dataInicio, dataFimEfetivo: dataFim || hojeIso(), tipoNome
    });

    return { ok: true, info: { id: afastamentoId } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENCERRAR rapidamente (define data_fim e muda o status, sem abrir o modal cheio)
// ============================================================================
export async function encerrarAfastamentoAction(payload: { id: number; dataFim: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: atual } = await db.from('folha_afastamentos').select('funcionario_nome, data_inicio, tipo_id').eq('id', payload.id).maybeSingle();
    if (!atual) return { ok: false, erro: 'Afastamento não encontrado.' };
    if (payload.dataFim < atual.data_inicio) return { ok: false, erro: 'A data de fim não pode ser antes da data de início.' };

    const { error } = await db.from('folha_afastamentos').update({
      data_fim: payload.dataFim, status: 'ENCERRADO', atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (error) throw new Error(error.message);

    const { data: tipoRow } = await db.from('folha_afastamento_tipos').select('nome').eq('id', atual.tipo_id).maybeSingle();
    await sincronizarAbonosAfastamento(db, {
      afastamentoId: payload.id, funcionarioNome: atual.funcionario_nome, dataInicio: atual.data_inicio,
      dataFimEfetivo: payload.dataFim, tipoNome: tipoRow?.nome || 'AFASTAMENTO'
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function excluirAfastamentoAction(payload: { id: number }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: af } = await db.from('folha_afastamentos').select('storage_path').eq('id', payload.id).maybeSingle();
    if (af?.storage_path) await db.storage.from(BUCKET).remove([af.storage_path]);
    const { error } = await db.from('folha_afastamentos').delete().eq('id', payload.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// URL assinada do anexo (10 min), mesmo padrão do módulo de Documentos.
// ============================================================================
export async function urlAnexoAfastamentoAction(payload: { id: number; download?: boolean }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: af } = await db.from('folha_afastamentos').select('storage_path, nome_arquivo').eq('id', payload.id).maybeSingle();
    if (!af?.storage_path) return { ok: false, erro: 'Este afastamento não tem anexo.' };

    const opts = payload.download ? { download: af.nome_arquivo || undefined } : undefined;
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(af.storage_path, 60 * 10, opts);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Falha ao gerar link.');
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
