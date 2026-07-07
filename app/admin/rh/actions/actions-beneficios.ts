'use server';

// app/admin/rh/actions-beneficios.ts
// Gestão de benefícios fixos (vale-alimentação, saúde, etc.) com histórico.
// O VR/VT NÃO é gravado aqui — é lido do holerite (contrato + ficha) e apenas
// exibido junto no painel, para não duplicar a fonte da verdade.
import { supabaseAdmin } from '../../../lib/supabase';

type Resultado = { ok: boolean; erro?: string; info?: any };

// ============================================================================
// DIAS ÚTEIS DO MÊS (seg-sex menos feriados cadastrados) — mesma régua do holerite
// ============================================================================
async function contarDiasUteis(db: ReturnType<typeof supabaseAdmin>, mesAno: string): Promise<number> {
  const [ano, mes] = mesAno.split('-').map(Number);
  const { data: fers } = await db.from('folha_feriados').select('data_feriado');
  const feriados = new Set((fers || []).map(f => f.data_feriado));

  const ultimoDia = new Date(ano, mes, 0).getDate();
  let uteis = 0;
  for (let d = 1; d <= ultimoDia; d++) {
    const data = new Date(ano, mes - 1, d);
    const diaSemana = data.getDay(); // 0=dom, 6=sáb
    const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (diaSemana !== 0 && diaSemana !== 6 && !feriados.has(iso)) uteis++;
  }
  return uteis;
}

// ============================================================================
// BENEFÍCIOS CALCULADOS DE UM MÊS (para o relatório financeiro)
// Valor único = valor direto; por diária = valor × dias úteis do mês.
// ============================================================================
export async function beneficiosDoMesAction(payload: { mesReferencia: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const diasUteis = await contarDiasUteis(db, payload.mesReferencia);

    const { data: beneficios } = await db.from('folha_beneficios')
      .select('id, funcionario_nome, valor_mensal, modalidade, tipo_id, meio_id')
      .eq('ativo', true);
    const { data: tipos } = await db.from('folha_beneficio_tipos').select('id, nome');
    const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
    const nomeTipo = (id: number) => tipos?.find(t => t.id === id)?.nome || '—';
    const nomeMeio = (id: number) => meios?.find(m => m.id === id)?.nome || '—';

    // Agrupa por funcionário, calculando o valor do mês conforme a modalidade
    const porFunc: Record<string, any> = {};
    (beneficios || []).forEach(b => {
      const porDiaria = b.modalidade === 'POR_DIARIA';
      const valorMes = porDiaria ? Number(b.valor_mensal) * diasUteis : Number(b.valor_mensal);
      (porFunc[b.funcionario_nome] ||= { funcionario_nome: b.funcionario_nome, itens: [], total: 0 });
      porFunc[b.funcionario_nome].itens.push({
        tipo: nomeTipo(b.tipo_id), meio: nomeMeio(b.meio_id),
        modalidade: b.modalidade, valorBase: Number(b.valor_mensal), valorMes,
        detalhe: porDiaria ? `${BRLnum(Number(b.valor_mensal))}/dia × ${diasUteis}` : 'valor único'
      });
      porFunc[b.funcionario_nome].total += valorMes;
    });

    return { ok: true, info: { diasUteis, funcionarios: Object.values(porFunc) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

const BRLnum = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ============================================================================
// CATÁLOGOS (tipos e meios)
// ============================================================================
export async function listarCatalogosBeneficioAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const [{ data: tipos }, { data: meios }] = await Promise.all([
      db.from('folha_beneficio_tipos').select('*').eq('ativo', true).order('nome'),
      db.from('folha_beneficio_meios').select('*').eq('ativo', true).order('nome'),
    ]);
    return { ok: true, info: { tipos: tipos || [], meios: meios || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarTipoBeneficioAction(payload: { nome: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome para o tipo de benefício.' };
  try {
    const { error } = await db.from('folha_beneficio_tipos').insert({ nome });
    if (error) {
      if (error.code === '23505') return { ok: false, erro: `"${nome}" já existe.` };
      throw new Error(error.message);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function criarMeioBeneficioAction(payload: { nome: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  const nome = payload.nome.toUpperCase().trim();
  if (!nome) return { ok: false, erro: 'Digite um nome para o meio de pagamento.' };
  try {
    const { error } = await db.from('folha_beneficio_meios').insert({ nome });
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
// CONCESSÃO DE BENEFÍCIO (cria/atualiza + registra histórico)
// ============================================================================
export async function salvarBeneficioAction(payload: {
  id?: number;
  funcionarioNome: string;
  tipoId: number;
  meioId: number;
  valorMensal: number;
  modalidade: 'VALOR_UNICO' | 'POR_DIARIA';
  observacao?: string | null;
  usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { id, funcionarioNome, tipoId, meioId, valorMensal, modalidade, observacao, usuarioNome } = payload;

  if (!funcionarioNome || !tipoId || !meioId) {
    return { ok: false, erro: 'Funcionário, tipo e meio de pagamento são obrigatórios.' };
  }

  try {
    // Nomes de meio para o histórico legível
    const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
    const nomeMeio = (mid: number) => meios?.find(m => m.id === mid)?.nome || null;

    if (id) {
      // Atualização: compara com o atual para registrar o que mudou
      const { data: atual } = await db.from('folha_beneficios').select('*').eq('id', id).maybeSingle();
      if (!atual) return { ok: false, erro: 'Benefício não encontrado.' };

      const { error } = await db.from('folha_beneficios').update({
        meio_id: meioId, valor_mensal: valorMensal, modalidade, observacao: observacao || null,
        atualizado_em: new Date().toISOString()
      }).eq('id', id);
      if (error) throw new Error(error.message);

      // Registra histórico das mudanças relevantes
      const historico: any[] = [];
      if (Number(atual.valor_mensal) !== Number(valorMensal)) {
        historico.push({ beneficio_id: id, valor_anterior: atual.valor_mensal, valor_novo: valorMensal, acao: 'VALOR_ALTERADO', alterado_por: usuarioNome });
      }
      if (atual.meio_id !== meioId) {
        historico.push({ beneficio_id: id, meio_anterior: nomeMeio(atual.meio_id), meio_novo: nomeMeio(meioId), acao: 'MEIO_ALTERADO', alterado_por: usuarioNome });
      }
      if (historico.length) await db.from('folha_beneficios_historico').insert(historico);

      return { ok: true, info: { atualizado: true, mudancas: historico.length } };
    } else {
      // Criação
      const { data: novo, error } = await db.from('folha_beneficios').insert({
        funcionario_nome: funcionarioNome, tipo_id: tipoId, meio_id: meioId,
        valor_mensal: valorMensal, modalidade, observacao: observacao || null
      }).select('id').single();
      if (error) {
        if (error.code === '23505') return { ok: false, erro: 'Este funcionário já tem este tipo de benefício. Edite o existente.' };
        throw new Error(error.message);
      }

      await db.from('folha_beneficios_historico').insert({
        beneficio_id: novo.id, valor_novo: valorMensal, meio_novo: nomeMeio(meioId),
        acao: 'CRIADO', alterado_por: usuarioNome
      });

      return { ok: true, info: { criado: true } };
    }
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Ativa/desativa um benefício (mantém histórico)
export async function alternarBeneficioAction(payload: {
  id: number; ativo: boolean; usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_beneficios').update({
      ativo: payload.ativo, atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (error) throw new Error(error.message);

    await db.from('folha_beneficios_historico').insert({
      beneficio_id: payload.id, acao: payload.ativo ? 'REATIVADO' : 'DESATIVADO', alterado_por: payload.usuarioNome
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function historicoBeneficioAction(payload: { beneficioId: number }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('folha_beneficios_historico')
      .select('*').eq('beneficio_id', payload.beneficioId).order('alterado_em', { ascending: false });
    if (error) throw new Error(error.message);
    return { ok: true, info: { historico: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PAINEL CONSOLIDADO: junta benefícios fixos + VR/VT do sistema, por funcionário
// ============================================================================
export async function painelBeneficiosAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    // Funcionários ativos
    const { data: funcs } = await db.from('folha_funcionarios')
      .select('nome_completo, tipo_contrato, valor_refeicao, valor_transporte, cargo')
      .eq('ativo', true).order('nome_completo');

    // Regras (para saber direito a VR/VT e modalidade)
    const { data: regras } = await db.from('folha_parametros')
      .select('nome_regra, direito_vr, direito_vt, modalidade_beneficio');
    const regraPorNome: Record<string, any> = {};
    (regras || []).forEach(r => { regraPorNome[r.nome_regra] = r; });

    // Benefícios fixos ativos, com nomes de tipo e meio
    const { data: beneficios } = await db.from('folha_beneficios')
      .select('id, funcionario_nome, valor_mensal, modalidade, ativo, observacao, tipo_id, meio_id')
      .eq('ativo', true);
    const { data: tipos } = await db.from('folha_beneficio_tipos').select('id, nome');
    const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
    const nomeTipo = (id: number) => tipos?.find(t => t.id === id)?.nome || '—';
    const nomeMeio = (id: number) => meios?.find(m => m.id === id)?.nome || '—';

    const benefPorFunc: Record<string, any[]> = {};
    (beneficios || []).forEach(b => {
      (benefPorFunc[b.funcionario_nome] ||= []).push({
        id: b.id, tipo: nomeTipo(b.tipo_id), meio: nomeMeio(b.meio_id),
        valor: Number(b.valor_mensal), modalidade: b.modalidade || 'VALOR_UNICO', observacao: b.observacao
      });
    });

    // Monta a linha de cada funcionário
    const linhas = (funcs || []).map(f => {
      const regra = regraPorNome[f.tipo_contrato] || {};
      const temVr = regra.direito_vr === true;
      const temVt = regra.direito_vt === true;
      const modalidade = regra.modalidade_beneficio || 'POR_DIA';
      const fixos = benefPorFunc[f.nome_completo] || [];

      // Total mensal dos benefícios de VALOR ÚNICO (os por-diária dependem do
      // mês, então não entram num total fixo — aparecem calculados no relatório).
      const totalFixos = fixos.filter(b => b.modalidade !== 'POR_DIARIA').reduce((s, b) => s + b.valor, 0);
      const temPorDiaria = fixos.some(b => b.modalidade === 'POR_DIARIA');

      return {
        nome: f.nome_completo,
        cargo: f.cargo,
        contrato: f.tipo_contrato,
        vr: temVr ? { valor: Number(f.valor_refeicao) || 0, modalidade } : null,
        vt: temVt ? { valor: Number(f.valor_transporte) || 0, modalidade } : null,
        beneficiosFixos: fixos,
        totalFixos,
        temPorDiaria,
        semNenhum: !temVr && !temVt && fixos.length === 0
      };
    });

    return { ok: true, info: { linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}