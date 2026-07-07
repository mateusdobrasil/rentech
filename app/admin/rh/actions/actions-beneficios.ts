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
// ============================================================================
// DIAS ÚTEIS DO MÊS (seg-sex menos feriados) — mesma régua do holerite.
// Aceita janela opcional [inicio, fim] para contar só o período trabalhado
// (admissão/desligamento no meio do mês → benefício proporcional).
// ============================================================================
function diasUteisNoPeriodo(ano: number, mes: number, feriados: Set<string>, inicioIso?: string | null, fimIso?: string | null): number {
  const ultimoDia = new Date(ano, mes, 0).getDate();
  let uteis = 0;
  for (let d = 1; d <= ultimoDia; d++) {
    const diaSemana = new Date(ano, mes - 1, d).getDay(); // 0=dom, 6=sáb
    const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (diaSemana === 0 || diaSemana === 6 || feriados.has(iso)) continue;
    if (inicioIso && iso < inicioIso) continue;   // antes da admissão
    if (fimIso && iso > fimIso) continue;          // depois do desligamento
    uteis++;
  }
  return uteis;
}

async function contarDiasUteis(db: ReturnType<typeof supabaseAdmin>, mesAno: string): Promise<number> {
  const [ano, mes] = mesAno.split('-').map(Number);
  const { data: fers } = await db.from('folha_feriados').select('data_feriado');
  const feriados = new Set((fers || []).map(f => f.data_feriado));
  return diasUteisNoPeriodo(ano, mes, feriados);
}

// ============================================================================
// BENEFÍCIOS CALCULADOS DE UM MÊS (para o relatório financeiro)
// Valor único = valor direto; por diária = valor × dias úteis do mês.
// ============================================================================
export async function beneficiosDoMesAction(payload: { mesReferencia: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { diasUteisMes, itens } = await calcularBeneficiosMes(db, payload.mesReferencia);

    // Agrupa por funcionário
    const porFunc: Record<string, any> = {};
    itens.forEach(it => {
      (porFunc[it.funcionario_nome] ||= { funcionario_nome: it.funcionario_nome, itens: [], total: 0 });
      porFunc[it.funcionario_nome].itens.push({ tipo: it.tipo, meio: it.meio, modalidade: it.modalidade, valorBase: it.valorBase, valorMes: it.valorMes, detalhe: it.detalhe });
      porFunc[it.funcionario_nome].total += it.valorMes;
    });

    return { ok: true, info: { diasUteis: diasUteisMes, funcionarios: Object.values(porFunc) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// NÚCLEO: calcula os benefícios de um mês, com proporcionalidade por
// admissão/desligamento. Reutilizado pelo relatório e pelo grid.
// ============================================================================
async function calcularBeneficiosMes(db: ReturnType<typeof supabaseAdmin>, mesAno: string) {
  const [ano, mes] = mesAno.split('-').map(Number);
  const primeiroDoMes = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoNum = new Date(ano, mes, 0).getDate();
  const ultimoDoMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoNum).padStart(2, '0')}`;

  const { data: fers } = await db.from('folha_feriados').select('data_feriado');
  const feriados = new Set((fers || []).map(f => f.data_feriado));

  // Dias úteis do mês cheio (referência para quem trabalhou o mês todo)
  const diasUteisMes = diasUteisNoPeriodo(ano, mes, feriados);

  // Datas de admissão/desligamento de cada funcionário
  const { data: funcs } = await db.from('folha_funcionarios')
    .select('nome_completo, data_admissao, data_desligamento');
  const dadosFunc: Record<string, { adm: string | null; deslig: string | null }> = {};
  (funcs || []).forEach(f => { dadosFunc[f.nome_completo] = { adm: f.data_admissao, deslig: f.data_desligamento }; });

  // Dias úteis trabalhados no mês por funcionário (respeitando admissão/desligamento)
  const diasUteisTrabalhados = (nome: string): number => {
    const d = dadosFunc[nome] || { adm: null, deslig: null };
    // Se admitido depois do mês ou desligado antes, não trabalhou no mês
    if (d.adm && d.adm.slice(0, 7) > mesAno) return 0;
    if (d.deslig && d.deslig.slice(0, 7) < mesAno) return 0;
    const inicio = (d.adm && d.adm > primeiroDoMes) ? d.adm : null;
    const fim = (d.deslig && d.deslig < ultimoDoMes) ? d.deslig : null;
    return diasUteisNoPeriodo(ano, mes, feriados, inicio, fim);
  };

  const { data: beneficios } = await db.from('folha_beneficios')
    .select('id, funcionario_nome, valor_mensal, modalidade, qtd_dias, tipo_id, meio_id')
    .eq('ativo', true);
  const { data: tipos } = await db.from('folha_beneficio_tipos').select('id, nome');
  const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
  const nomeTipo = (id: number) => tipos?.find(t => t.id === id)?.nome || '—';
  const nomeMeio = (id: number) => meios?.find(m => m.id === id)?.nome || '—';

  const itens = (beneficios || []).map(b => {
    const diasTrab = diasUteisTrabalhados(b.funcionario_nome);
    const parcial = diasTrab < diasUteisMes; // trabalhou só parte do mês
    let valorMes: number;
    let detalhe: string;

    if (b.modalidade === 'POR_DIARIA') {
      // Proporcional: dias úteis dentro do período trabalhado
      valorMes = Number(b.valor_mensal) * diasTrab;
      detalhe = `${BRLnum(Number(b.valor_mensal))}/dia × ${diasTrab} úteis${parcial ? ' (proporc.)' : ''}`;
    } else if (b.modalidade === 'DIAS_FIXOS') {
      // Teto: min(dias digitados, dias úteis trabalhados)
      const digitados = Number(b.qtd_dias) || 0;
      const diasPagos = Math.min(digitados, diasTrab);
      valorMes = Number(b.valor_mensal) * diasPagos;
      detalhe = `${BRLnum(Number(b.valor_mensal))}/dia × ${diasPagos} dias${diasPagos < digitados ? ` (teto ${digitados}, proporc.)` : ''}`;
    } else {
      // Valor único: não é proporcional
      valorMes = Number(b.valor_mensal);
      detalhe = 'valor único';
    }

    return {
      funcionario_nome: b.funcionario_nome,
      tipo: nomeTipo(b.tipo_id), meio: nomeMeio(b.meio_id),
      modalidade: b.modalidade, valorBase: Number(b.valor_mensal), valorMes, detalhe,
      diasTrab, parcial
    };
  });

  return { ano, mes, diasUteisMes, itens };
}

const BRLnum = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ============================================================================
// GRID CONSOLIDADO DE BENEFÍCIOS (para a aba e o financeiro)
// Retorna: por funcionário (itens + total) E por meio de pagamento + total geral.
// ============================================================================
export async function gridBeneficiosAction(payload: { mesReferencia: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { diasUteisMes, itens } = await calcularBeneficiosMes(db, payload.mesReferencia);

    const porFunc: Record<string, any> = {};
    const porMeio: Record<string, number> = {};
    let totalGeral = 0;

    itens.forEach(it => {
      (porFunc[it.funcionario_nome] ||= { funcionario_nome: it.funcionario_nome, itens: [], total: 0 });
      porFunc[it.funcionario_nome].itens.push({ tipo: it.tipo, meio: it.meio, valorMes: it.valorMes, detalhe: it.detalhe });
      porFunc[it.funcionario_nome].total += it.valorMes;
      porMeio[it.meio] = (porMeio[it.meio] || 0) + it.valorMes;
      totalGeral += it.valorMes;
    });

    const funcionarios = Object.values(porFunc).sort((a: any, b: any) => a.funcionario_nome.localeCompare(b.funcionario_nome));
    const meiosResumo = Object.entries(porMeio).map(([meio, total]) => ({ meio, total })).sort((a, b) => b.total - a.total);

    return { ok: true, info: { diasUteis: diasUteisMes, funcionarios, meiosResumo, totalGeral } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

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
  modalidade: 'VALOR_UNICO' | 'POR_DIARIA' | 'DIAS_FIXOS';
  qtdDias?: number | null;
  observacao?: string | null;
  usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { id, funcionarioNome, tipoId, meioId, valorMensal, modalidade, qtdDias, observacao, usuarioNome } = payload;

  if (!funcionarioNome || !tipoId || !meioId) {
    return { ok: false, erro: 'Funcionário, tipo e meio de pagamento são obrigatórios.' };
  }
  if (modalidade === 'DIAS_FIXOS' && (!qtdDias || qtdDias <= 0)) {
    return { ok: false, erro: 'Informe a quantidade de dias para a modalidade "Dias fixos".' };
  }

  const diasField = modalidade === 'DIAS_FIXOS' ? (qtdDias || null) : null;

  try {
    // Nomes de meio para o histórico legível
    const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
    const nomeMeio = (mid: number) => meios?.find(m => m.id === mid)?.nome || null;

    if (id) {
      // Atualização: compara com o atual para registrar o que mudou
      const { data: atual } = await db.from('folha_beneficios').select('*').eq('id', id).maybeSingle();
      if (!atual) return { ok: false, erro: 'Benefício não encontrado.' };

      const { error } = await db.from('folha_beneficios').update({
        tipo_id: tipoId, meio_id: meioId, valor_mensal: valorMensal, modalidade, qtd_dias: diasField,
        observacao: observacao || null, atualizado_em: new Date().toISOString()
      }).eq('id', id);
      if (error) {
        if (error.code === '23505') return { ok: false, erro: 'Este funcionário já tem este tipo de benefício.' };
        throw new Error(error.message);
      }

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
        valor_mensal: valorMensal, modalidade, qtd_dias: diasField, observacao: observacao || null
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
      .select('nome_completo, tipo_contrato, cargo')
      .eq('ativo', true).order('nome_completo');

    // Benefícios fixos ativos, com nomes de tipo e meio
    const { data: beneficios } = await db.from('folha_beneficios')
      .select('id, funcionario_nome, valor_mensal, modalidade, qtd_dias, ativo, observacao, tipo_id, meio_id')
      .eq('ativo', true);
    const { data: tipos } = await db.from('folha_beneficio_tipos').select('id, nome');
    const { data: meios } = await db.from('folha_beneficio_meios').select('id, nome');
    const nomeTipo = (id: number) => tipos?.find(t => t.id === id)?.nome || '—';
    const nomeMeio = (id: number) => meios?.find(m => m.id === id)?.nome || '—';

    const benefPorFunc: Record<string, any[]> = {};
    (beneficios || []).forEach(b => {
      (benefPorFunc[b.funcionario_nome] ||= []).push({
        id: b.id, tipoId: b.tipo_id, meioId: b.meio_id,
        tipo: nomeTipo(b.tipo_id), meio: nomeMeio(b.meio_id),
        valor: Number(b.valor_mensal), modalidade: b.modalidade || 'VALOR_UNICO',
        qtdDias: b.qtd_dias, observacao: b.observacao
      });
    });

    // Monta a linha de cada funcionário (só benefícios fixos; VR/VT vive no holerite)
    const linhas = (funcs || []).map(f => {
      const fixos = benefPorFunc[f.nome_completo] || [];
      const totalFixos = fixos.filter(b => b.modalidade === 'VALOR_UNICO').reduce((s, b) => s + b.valor, 0);
      const temVariavel = fixos.some(b => b.modalidade !== 'VALOR_UNICO');
      return {
        nome: f.nome_completo,
        cargo: f.cargo,
        contrato: f.tipo_contrato,
        beneficiosFixos: fixos,
        totalFixos,
        temVariavel,
        semNenhum: fixos.length === 0
      };
    });

    return { ok: true, info: { linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}