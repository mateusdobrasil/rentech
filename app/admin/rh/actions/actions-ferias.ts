'use server';

// app/admin/rh/actions/actions-ferias.ts
// Controle de períodos aquisitivos e agendamento de férias.
// v1: um agendamento por período aquisitivo (5 a 30 dias, sem fracionamento
// em até 3 períodos — regra CLT que fica para uma próxima versão) e sem
// integração com o cálculo de holerite (só agendamento e prazos por enquanto).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/rh/ferias-afastamentos';

const addAnos = (iso: string, anos: number): string => {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a + anos, m - 1, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const addDias = (iso: string, dias: number): string => {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const hojeIso = (): string => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
};

// ============================================================================
// GARANTE que todo período aquisitivo já completado (admissão → hoje, ou
// admissão → desligamento) tenha uma linha em folha_ferias. Idempotente:
// usa o unique(funcionario_nome, periodo_aquisitivo_inicio) para não duplicar.
// ============================================================================
async function ensurePeriodos(db: ReturnType<typeof supabaseAdmin>) {
  const hoje = hojeIso();
  const { data: funcs } = await db.from('folha_funcionarios')
    .select('nome_completo, data_admissao, data_desligamento, empresa_id')
    .not('data_admissao', 'is', null);

  const { data: existentes } = await db.from('folha_ferias').select('funcionario_nome, periodo_aquisitivo_inicio');
  const jaExiste = new Set((existentes || []).map(r => `${r.funcionario_nome}|${r.periodo_aquisitivo_inicio}`));

  const novos: any[] = [];
  (funcs || []).forEach(f => {
    if (!f.data_admissao) return;
    const tetoData = f.data_desligamento && f.data_desligamento < hoje ? f.data_desligamento : hoje;
    let inicioCiclo = f.data_admissao;
    while (true) {
      const fimCiclo = addAnos(inicioCiclo, 1);
      if (fimCiclo > tetoData) break; // ciclo ainda não completou
      const chave = `${f.nome_completo}|${inicioCiclo}`;
      if (!jaExiste.has(chave)) {
        novos.push({
          funcionario_nome: f.nome_completo,
          empresa_id: f.empresa_id,
          periodo_aquisitivo_inicio: inicioCiclo,
          periodo_aquisitivo_fim: fimCiclo,
          periodo_concessivo_fim: addAnos(fimCiclo, 1),
          status: 'DISPONIVEL'
        });
      }
      inicioCiclo = fimCiclo;
    }
  });

  if (novos.length) await db.from('folha_ferias').insert(novos);
}

// ============================================================================
// PAINEL: uma linha por período de férias (aquisitivo), com status calculado
// (agendada/em gozo/concluída derivado das datas — só CANCELADA/DISPONIVEL/
// AGENDADA ficam gravadas) e alerta de vencimento do período concessivo.
// ============================================================================
export async function painelFeriasAction(accessToken: string): Promise<Resultado> {
  let acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) {
    // Também usada pelo painel de pendências do hub /admin/rh.
    const acessoHub = await validarAcesso(accessToken, '/admin/rh');
    if (!acessoHub.ok) return { ok: false, erro: acesso.message };
    acesso = acessoHub;
  }

  const db = supabaseAdmin();
  try {
    await ensurePeriodos(db);

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let qFuncs = db.from('folha_funcionarios')
      .select('nome_completo, cargo, departamento, ativo').order('nome_completo');
    if (empresasPermitidas) qFuncs = qFuncs.in('empresa_id', empresasPermitidas);
    const { data: funcs } = await qFuncs;

    let qPeriodos = db.from('folha_ferias').select('*')
      .order('periodo_aquisitivo_inicio', { ascending: true });
    if (empresasPermitidas) qPeriodos = qPeriodos.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data: periodos } = await qPeriodos;

    const hoje = hojeIso();
    const em60 = addDias(hoje, 60);

    const porFunc: Record<string, any[]> = {};
    (periodos || []).forEach(p => {
      let statusExibicao: 'DISPONIVEL' | 'AGENDADA' | 'EM_GOZO' | 'CONCLUIDA' | 'CANCELADA' = p.status;
      if (p.status === 'AGENDADA' && p.data_fim_gozo) {
        if (hoje > p.data_fim_gozo) statusExibicao = 'CONCLUIDA';
        else if (hoje >= p.data_inicio_gozo) statusExibicao = 'EM_GOZO';
      }
      const vencida = p.status === 'DISPONIVEL' && p.periodo_concessivo_fim < hoje;
      const vencendo = p.status === 'DISPONIVEL' && !vencida && p.periodo_concessivo_fim <= em60;
      (porFunc[p.funcionario_nome] ||= []).push({ ...p, statusExibicao, vencida, vencendo });
    });

    const linhas = (funcs || [])
      .filter(f => porFunc[f.nome_completo])
      .map(f => {
        const periodosFunc = porFunc[f.nome_completo] || [];
        return {
          nome: f.nome_completo, cargo: f.cargo, departamento: f.departamento, ativo: f.ativo,
          periodos: periodosFunc,
          temVencida: periodosFunc.some(p => p.vencida),
          temVencendo: periodosFunc.some(p => p.vencendo)
        };
      });

    const todosPeriodos = linhas.flatMap(l => l.periodos);
    const totais = {
      funcionarios: linhas.length,
      vencidas: todosPeriodos.filter(p => p.vencida).length,
      vencendo: todosPeriodos.filter(p => p.vencendo).length,
      agendadas: todosPeriodos.filter(p => p.statusExibicao === 'AGENDADA' || p.statusExibicao === 'EM_GOZO').length
    };

    return { ok: true, info: { linhas, totais } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// AGENDAR/EDITAR o gozo de um período (5 a 30 dias corridos + até 10 dias de
// abono pecuniário, respeitando o teto de 30 dias somados).
// ============================================================================
export async function agendarFeriasAction(payload: {
  id: number;
  dataInicioGozo: string;
  diasGozo: number;
  diasAbono?: number;
  observacao?: string | null;
  usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { id, dataInicioGozo, diasGozo, diasAbono = 0, observacao, usuarioNome } = payload;

  if (!dataInicioGozo || !diasGozo) return { ok: false, erro: 'Informe a data de início e a quantidade de dias.' };
  if (diasGozo < 5 || diasGozo > 30) return { ok: false, erro: 'O período de gozo deve ter entre 5 e 30 dias.' };
  if (diasAbono < 0 || diasAbono > 10) return { ok: false, erro: 'O abono pecuniário vai de 0 a 10 dias.' };
  if (diasGozo + diasAbono > 30) return { ok: false, erro: 'Gozo + abono não pode passar de 30 dias.' };

  try {
    const { data: periodo } = await db.from('folha_ferias').select('empresa_id').eq('id', id).maybeSingle();
    if (!periodo) return { ok: false, erro: 'Período de férias não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, periodo.empresa_id)) return { ok: false, erro: 'Período de férias não encontrado.' };

    const dataFimGozo = addDias(dataInicioGozo, diasGozo - 1);
    const { error } = await db.from('folha_ferias').update({
      status: 'AGENDADA', data_inicio_gozo: dataInicioGozo, data_fim_gozo: dataFimGozo,
      dias_gozo: diasGozo, dias_abono: diasAbono, observacao: observacao || null,
      criado_por: usuarioNome, atualizado_em: new Date().toISOString()
    }).eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function cancelarAgendamentoFeriasAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: periodo } = await db.from('folha_ferias').select('empresa_id').eq('id', payload.id).maybeSingle();
    if (!periodo) return { ok: false, erro: 'Período de férias não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, periodo.empresa_id)) return { ok: false, erro: 'Período de férias não encontrado.' };

    const { error } = await db.from('folha_ferias').update({
      status: 'DISPONIVEL', data_inicio_gozo: null, data_fim_gozo: null,
      dias_gozo: null, dias_abono: 0, atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
