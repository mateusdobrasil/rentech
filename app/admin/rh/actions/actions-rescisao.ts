'use server';

// app/admin/rh/actions/actions-rescisao.ts
// Lançamento, cálculo e homologação de rescisões de funcionário (CLT).
// Funcionários com fechamento próprio (recebeFechamento=true, resolvido por
// resolverFontesPagamento) têm as verbas calculadas automaticamente
// (app/lib/calculoRescisao.ts); os demais só recebem o anexo do TRCT
// fornecido pela contabilidade — nenhum valor é calculado nesse caso.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { resolverFontesPagamento } from './actions-fontes-pagamento';
import { consultarAssinaturaAction, baixarAssinadoAction } from './actions-assinatura';
import { autentiqueCriarDocumento } from '../../../lib/autentique';
import { gerarRescisaoPdf } from '../../../lib/gerarRescisaoPdf';
import {
  calcularRescisao, calcularDiasAvisoPrevio, calcularPercentualMultaFgts, calcularEstimativaFgts,
  type MotivoRescisao, type TipoAvisoPrevio, type ItemRescisao
} from '../../../lib/calculoRescisao';

type Resultado = { ok: boolean; erro?: string; info?: any };

const BUCKET = 'documentos-funcionarios';

// Rota única do módulo — todas as actions deste arquivo são usadas a partir
// de /admin/rh/rescisao (lista e detalhe) ou da aba "Rescisão" de
// /admin/rh/assinaturas (que reaproveita listarAssinaturasRescisaoAction /
// atualizarAssinaturaRescisaoAction / baixarAssinadoRescisaoAction).
const ROTA = '/admin/rh/rescisao';
const ROTAS_PERMITIDAS = [ROTA, '/admin/rh/assinaturas'];

async function validarAcessoRescisao(accessToken: string) {
  for (const rota of ROTAS_PERMITIDAS) {
    const acesso = await validarAcesso(accessToken, rota);
    if (acesso.ok) return acesso;
  }
  return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
}

const MOTIVO_LABEL: Record<string, string> = {
  SEM_JUSTA_CAUSA: 'Sem justa causa (dispensa)', PEDIDO_DEMISSAO: 'Pedido de demissão', JUSTA_CAUSA: 'Justa causa',
  ACORDO_MUTUO: 'Acordo mútuo (CLT 484-A)', TERMINO_CONTRATO_EXPERIENCIA: 'Término de contrato de experiência',
  APOSENTADORIA: 'Aposentadoria'
};
const AVISO_LABEL: Record<string, string> = { INDENIZADO: 'Indenizado', TRABALHADO: 'Trabalhado', ISENTO: 'Não se aplica' };

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const moedaSimples = (v: number): string => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hojeIso = (): string => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
};

const normalizarCelularBR = (celular?: string | null): string | null => {
  if (!celular) return null;
  const digits = celular.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const comPais = digits.startsWith('55') ? digits : `55${digits}`;
  return `+${comPais}`;
};

// Status que encerram o ciclo de vida de uma rescisão (libera o funcionário
// para uma nova rescisão futura, se algum dia voltar a trabalhar na empresa).
const STATUS_FINAIS = ['HOMOLOGADA', 'CANCELADA'];

// Marcador usado como "mes_referencia" sintético em folha_holerite_assinaturas
// (mesma tabela/mecanismo usado pelos documentos avulsos e holerites) — não é
// um mês real, só uma chave única pra rastrear o envio do TRCT dessa rescisão.
const marcadorAssinatura = (id: number) => `RESCISAO-${id}`;

// salario_folha é só um valor de referência para cálculo de hora — em vários
// tipos de contrato ele fica zerado e o salário real está em
// salario_contrato. Mesma regra usada em holerite/page.tsx (salarioBaseCalculo).
const resolverSalarioBase = (func: { salario_folha: number | null; salario_contrato: number | null }): number => {
  const folha = Number(func.salario_folha) || 0;
  return folha > 0 ? folha : Number(func.salario_contrato) || 0;
};

// Mesmas contas de folha_descontos usadas em holerite/page.tsx (calcularMesFim/
// getParcelaAtual), duplicadas aqui pelo mesmo padrão do resto do projeto.
const calcularMesFim = (mesInicio: string, parcelas: number): string => {
  if (!mesInicio || parcelas < 1) return mesInicio;
  const [ano, mes] = mesInicio.split('-').map(Number);
  const dataFim = new Date(ano, (mes - 1) + (parcelas - 1), 1);
  return `${dataFim.getFullYear()}-${String(dataFim.getMonth() + 1).padStart(2, '0')}`;
};
const getParcelaAtual = (mesInicio: string, mesRef: string): number => {
  if (!mesInicio || !mesRef) return 1;
  const [anoI, mesI] = mesInicio.split('-').map(Number);
  const [anoR, mesR] = mesRef.split('-').map(Number);
  return (anoR - anoI) * 12 + (mesR - mesI) + 1;
};

// ============================================================================
// Monta a entrada do motor de cálculo a partir do estado atual do banco
// (dependentes, períodos de férias, descontos ativos) para um funcionário PROPRIO.
// ============================================================================
async function montarCalculo(db: ReturnType<typeof supabaseAdmin>, params: {
  funcionarioNome: string; salarioBase: number; dataAdmissao: string; dataDesligamento: string;
  motivo: MotivoRescisao; tipoAvisoPrevio: TipoAvisoPrevio;
}) {
  const { funcionarioNome, salarioBase, dataAdmissao, dataDesligamento, motivo, tipoAvisoPrevio } = params;

  const [depRes, feriasRes, descontosRes] = await Promise.all([
    db.from('folha_dependentes').select('id', { count: 'exact', head: true }).eq('funcionario_nome', funcionarioNome),
    db.from('folha_ferias').select('periodo_aquisitivo_fim, periodo_concessivo_fim, status').eq('funcionario_nome', funcionarioNome),
    db.from('folha_descontos').select('descricao, tipo, parcelas, mes_inicio, mes_fim, valor_parcela').eq('funcionario_nome', funcionarioNome)
  ]);

  const periodos = feriasRes.data || [];
  const feriasVencidasCount = periodos.filter(p => p.status === 'DISPONIVEL' && p.periodo_concessivo_fim < dataDesligamento).length;
  const ultimoPeriodoAquisitivoFim = periodos.map(p => p.periodo_aquisitivo_fim as string).sort().pop() || null;

  // Descontos ainda em aberto no mês do desligamento: parcelado é liquidado
  // de uma vez (soma as parcelas que ainda faltavam); fixo (sem fim definido)
  // entra só pelo valor do último mês, já que não tem um total a liquidar.
  const mesRef = dataDesligamento.slice(0, 7);
  const descontosAtivos = (descontosRes.data || [])
    .filter(d => {
      if (mesRef < d.mes_inicio) return false;
      if (d.tipo === 'FIXO') return true;
      const fimReal = (d.mes_inicio && d.parcelas > 0) ? calcularMesFim(d.mes_inicio, d.parcelas) : d.mes_fim;
      return mesRef <= fimReal;
    })
    .map(d => {
      if (d.tipo === 'FIXO') {
        return { descricao: d.descricao, valor: Number(d.valor_parcela) || 0, parcelaInfo: 'Desconto fixo — valor do último mês trabalhado' };
      }
      const parcelaAtual = getParcelaAtual(d.mes_inicio, mesRef);
      const parcelasRestantes = Math.max(0, d.parcelas - parcelaAtual + 1);
      return {
        descricao: d.descricao,
        valor: parcelasRestantes * (Number(d.valor_parcela) || 0),
        parcelaInfo: `${parcelasRestantes} parcela(s) restante(s) de ${d.parcelas} (${moedaSimples(d.valor_parcela)} cada) — liquidado na rescisão`
      };
    });

  return calcularRescisao({
    salarioBase, dataAdmissao, dataDesligamento, motivo, tipoAvisoPrevio,
    numeroDependentesIrrf: depRes.count || 0,
    feriasVencidasCount,
    ultimoPeriodoAquisitivoFim,
    descontosAtivos
  });
}

// ============================================================================
// Sincroniza a ficha do funcionário quando a rescisão é homologada:
// inativa, grava data_desligamento, lança DEMISSAO em folha_movimentacoes e
// baixa os períodos de férias vencidas já pagos na rescisão. Idempotente —
// mesmo padrão de sincronizarAbonosAfastamento em actions-afastamentos.ts.
// ============================================================================
async function sincronizarFichaRescisao(db: ReturnType<typeof supabaseAdmin>, params: {
  funcionarioNome: string; dataDesligamento: string; cargo: string | null;
}) {
  const { funcionarioNome, dataDesligamento, cargo } = params;

  await db.from('folha_funcionarios')
    .update({ ativo: false, data_desligamento: dataDesligamento })
    .eq('nome_completo', funcionarioNome).eq('ativo', true);

  const { data: movExistente } = await db.from('folha_movimentacoes')
    .select('id').eq('funcionario_nome', funcionarioNome).eq('motivo', 'DEMISSAO')
    .eq('data_movimentacao', dataDesligamento).maybeSingle();
  if (!movExistente) {
    await db.from('folha_movimentacoes').insert({
      funcionario_nome: funcionarioNome, motivo: 'DEMISSAO', cargo: cargo || null, data_movimentacao: dataDesligamento
    });
  }

  await db.from('folha_ferias')
    .update({ status: 'CANCELADA', observacao: 'Quitada na rescisão do funcionário' })
    .eq('funcionario_nome', funcionarioNome).eq('status', 'DISPONIVEL').lt('periodo_concessivo_fim', dataDesligamento);
}

// ============================================================================
// LISTAGEM para o seletor de "Nova Rescisão" — só funcionários ativos sem
// rescisão em andamento, com o tipo de folha já resolvido.
// ============================================================================
export async function listarFuncionariosElegiveisRescisaoAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let qFuncs = db.from('folha_funcionarios')
      .select('nome_completo, cargo, data_desligamento').eq('ativo', true).order('nome_completo');
    if (empresasPermitidas) qFuncs = qFuncs.in('empresa_id', empresasPermitidas);
    const { data: funcs, error } = await qFuncs;
    if (error) throw new Error(error.message);

    const nomes = (funcs || []).map(f => f.nome_completo);
    const resolucao = await resolverFontesPagamento(db, nomes);

    const { data: abertas } = nomes.length
      ? await db.from('folha_rescisoes').select('funcionario_nome, status').in('funcionario_nome', nomes)
      : { data: [] as { funcionario_nome: string; status: string }[] };
    const bloqueados = new Set((abertas || []).filter(r => !STATUS_FINAIS.includes(r.status)).map(r => r.funcionario_nome));

    const linhas = (funcs || [])
      .filter(f => !bloqueados.has(f.nome_completo))
      .map(f => ({
        nome: f.nome_completo,
        cargo: f.cargo,
        dataDesligamento: f.data_desligamento,
        tipoFolha: resolucao[f.nome_completo]?.recebeFechamento === false ? 'CONTABILIDADE' : 'PROPRIO'
      }));

    return { ok: true, info: { linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CRIAR rescisão. Congela tipo_folha e, se PROPRIO, já calcula as verbas.
// ============================================================================
export async function criarRescisaoAction(payload: {
  funcionarioNome: string; dataDesligamento: string; motivo: MotivoRescisao;
  tipoAvisoPrevio: TipoAvisoPrevio; usuarioNome: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, dataDesligamento, motivo, tipoAvisoPrevio, usuarioNome } = payload;

  if (!funcionarioNome || !dataDesligamento || !motivo) {
    return { ok: false, erro: 'Funcionário, data de desligamento e motivo são obrigatórios.' };
  }

  try {
    const { data: func, error: funcErr } = await db.from('folha_funcionarios')
      .select('nome_completo, cargo, departamento, empresa_id, data_admissao, salario_folha, salario_contrato')
      .eq('nome_completo', funcionarioNome).maybeSingle();
    if (funcErr) throw new Error(funcErr.message);
    if (!func) return { ok: false, erro: 'Funcionário não encontrado.' };
    if (func.data_admissao && dataDesligamento < func.data_admissao) {
      return { ok: false, erro: 'A data de desligamento não pode ser antes da admissão.' };
    }
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, func.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para abrir rescisão para este funcionário.' };
    }

    const { data: abertaExistente } = await db.from('folha_rescisoes')
      .select('id, status').eq('funcionario_nome', funcionarioNome).order('id', { ascending: false }).limit(1).maybeSingle();
    if (abertaExistente && !STATUS_FINAIS.includes(abertaExistente.status)) {
      return { ok: false, erro: 'Já existe uma rescisão em andamento para este funcionário.' };
    }

    const resolucao = await resolverFontesPagamento(db, [funcionarioNome]);
    const tipoFolha: 'PROPRIO' | 'CONTABILIDADE' = resolucao[funcionarioNome]?.recebeFechamento === false ? 'CONTABILIDADE' : 'PROPRIO';

    // Data de admissão só é indispensável no caso PRÓPRIO — é usada em quase
    // toda fórmula do motor de cálculo (aviso prévio, 13º e férias
    // proporcionais). No caso CONTABILIDADE nenhum cálculo interno roda, então
    // a ausência não bloqueia — só fica registrada como null no snapshot.
    if (tipoFolha === 'PROPRIO' && !func.data_admissao) {
      return { ok: false, erro: 'Este funcionário tem folha própria (cálculo automático), mas não tem data de admissão cadastrada na ficha. Preencha a data de admissão em Gestão de Funcionários antes de abrir a rescisão.' };
    }

    const diasAvisoPrevio = calcularDiasAvisoPrevio(func.data_admissao || dataDesligamento, dataDesligamento, motivo);

    const registro: any = {
      funcionario_nome: funcionarioNome, empresa_id: func.empresa_id, cargo: func.cargo, departamento: func.departamento,
      data_admissao: func.data_admissao, data_desligamento: dataDesligamento, motivo, tipo_aviso_previo: tipoAvisoPrevio,
      dias_aviso_previo: diasAvisoPrevio, tipo_folha: tipoFolha,
      fgts_percentual_multa: calcularPercentualMultaFgts(motivo) * 100,
      criado_por: usuarioNome
    };

    if (tipoFolha === 'PROPRIO') {
      const salarioBase = resolverSalarioBase(func);
      const resultado = await montarCalculo(db, {
        funcionarioNome, salarioBase, dataAdmissao: func.data_admissao, dataDesligamento, motivo, tipoAvisoPrevio
      });
      registro.dados_calculo = resultado;
      registro.valor_total_liquido = resultado.valorLiquido;
      registro.status = 'EM_CALCULO';

      // Cálculo prévio do saldo do FGTS (8% × salário × meses de casa) — só um
      // ponto de partida, sempre editável. Base é o Salário Contrato Total
      // (remuneração real), não o Salário Folha (que é só a referência
      // registrada pela contabilidade, pode ficar zerado ou bem menor).
      const salarioContrato = Number(func.salario_contrato) || 0;
      const estimativaFgts = calcularEstimativaFgts(salarioContrato, func.data_admissao, dataDesligamento);
      registro.saldo_fgts_informado = estimativaFgts;
      registro.fgts_valor_multa = Math.round(estimativaFgts * (registro.fgts_percentual_multa / 100) * 100) / 100;
    } else {
      registro.status = 'AGUARDANDO_DOCUMENTO';
    }

    const { data: novo, error } = await db.from('folha_rescisoes').insert(registro).select('id').single();
    if (error) throw new Error(error.message);

    // Grava a data de desligamento na ficha já na abertura da rescisão (não
    // espera a homologação) — é o mesmo campo que a folha usa pra prorated
    // o mês (montarDadosHolerite). NÃO mexe em "ativo": o funcionário só é
    // inativado quando a rescisão é homologada.
    await db.from('folha_funcionarios').update({ data_desligamento: dataDesligamento }).eq('nome_completo', funcionarioNome);

    await registrarLogAuditoria({
      usuario_nome: usuarioNome, acao: `ABERTURA DE RESCISÃO: ${funcionarioNome}`, setor: 'RECURSOS HUMANOS / RESCISÃO'
    });

    return { ok: true, info: { id: novo.id } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function obterRescisaoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('folha_rescisoes').select('*').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, data.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    return { ok: true, info: { rescisao: data } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// RECALCULAR — reroda o motor com os dados atuais do funcionário, sobrescrevendo
// dados_calculo (a UI deve avisar que isso descarta edições manuais).
// ============================================================================
export async function recalcularRescisaoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('*').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    if (r.status === 'HOMOLOGADA') return { ok: false, erro: 'Rescisão já homologada não pode ser recalculada.' };
    if (r.tipo_folha !== 'PROPRIO') return { ok: false, erro: 'Este caso não tem cálculo interno — a folha é administrada pela contabilidade.' };
    if (!r.data_admissao) return { ok: false, erro: 'Esta rescisão não tem data de admissão registrada — não é possível calcular.' };

    const { data: func } = await db.from('folha_funcionarios').select('salario_folha, salario_contrato').eq('nome_completo', r.funcionario_nome).maybeSingle();
    const salarioBase = resolverSalarioBase(func || { salario_folha: 0, salario_contrato: 0 });

    const resultado = await montarCalculo(db, {
      funcionarioNome: r.funcionario_nome, salarioBase, dataAdmissao: r.data_admissao, dataDesligamento: r.data_desligamento,
      motivo: r.motivo, tipoAvisoPrevio: r.tipo_aviso_previo
    });

    // Também atualiza a estimativa de FGTS (8% do Salário Contrato Total ×
    // meses de casa) com os dados atuais da ficha — mantém o percentual da
    // multa que já estiver salvo (não reseta um override manual do %).
    const salarioContrato = Number(func?.salario_contrato) || 0;
    const estimativaFgts = calcularEstimativaFgts(salarioContrato, r.data_admissao, r.data_desligamento);
    const percentualAtual = Number(r.fgts_percentual_multa) || 0;
    const multaFgts = Math.round(estimativaFgts * (percentualAtual / 100) * 100) / 100;

    const { error: updErr } = await db.from('folha_rescisoes').update({
      dados_calculo: resultado, valor_total_liquido: resultado.valorLiquido,
      saldo_fgts_informado: estimativaFgts, fgts_valor_multa: multaFgts,
      atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, info: { dadosCalculo: resultado, saldoFgtsInformado: estimativaFgts, fgtsValorMulta: multaFgts } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// Edição manual linha a linha — nunca confia em totais vindos do cliente,
// recalcula no servidor a partir dos itens enviados.
// ============================================================================
export async function atualizarItemCalculoAction(payload: { id: number; itens: ItemRescisao[] }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('status, tipo_folha, dados_calculo, empresa_id').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    if (r.status === 'HOMOLOGADA') return { ok: false, erro: 'Rescisão já homologada.' };
    if (r.tipo_folha !== 'PROPRIO') return { ok: false, erro: 'Este caso não tem cálculo interno.' };

    const arred = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    const totalProventos = arred(payload.itens.filter(i => i.tipo === 'PROVENTO').reduce((s, i) => s + (Number(i.valor) || 0), 0));
    const totalDescontos = arred(payload.itens.filter(i => i.tipo === 'DESCONTO').reduce((s, i) => s + (Number(i.valor) || 0), 0));
    const valorLiquido = arred(totalProventos - totalDescontos);

    const dadosAtualizados = { ...(r.dados_calculo as any), itens: payload.itens, totalProventos, totalDescontos, valorLiquido };

    const { error: updErr } = await db.from('folha_rescisoes').update({
      dados_calculo: dadosAtualizados, valor_total_liquido: valorLiquido, atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (updErr) throw new Error(updErr.message);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function atualizarFgtsAction(payload: {
  id: number; saldoFgtsInformado: number; percentualOverride?: number;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('status, motivo, empresa_id').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    if (r.status === 'HOMOLOGADA') return { ok: false, erro: 'Rescisão já homologada.' };

    const percentual = payload.percentualOverride ?? calcularPercentualMultaFgts(r.motivo as MotivoRescisao) * 100;
    const saldo = Number(payload.saldoFgtsInformado) || 0;
    const valorMulta = Math.round(saldo * (percentual / 100) * 100) / 100;

    const { error: updErr } = await db.from('folha_rescisoes').update({
      saldo_fgts_informado: saldo, fgts_percentual_multa: percentual, fgts_valor_multa: valorMulta,
      atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, info: { valorMulta } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ANEXO DO TRCT (fornecido pela contabilidade, ou gerado/conferido no caso
// próprio) — mesmo padrão de upload de actions-afastamentos.ts.
// ============================================================================
export async function uploadTrctRescisaoAction(payload: {
  id: number; arquivoBase64: string; nomeArquivo: string; tipoMime?: string | null;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes')
      .select('funcionario_nome, tipo_folha, status, empresa_id').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };

    const bytes = Buffer.from(payload.arquivoBase64, 'base64');
    const ext = (payload.nomeArquivo.split('.').pop() || 'bin').toLowerCase();
    const path = `${slug(r.funcionario_nome)}/rescisao/${Date.now()}-${slug(payload.nomeArquivo.replace(/\.[^.]+$/, ''))}.${ext}`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: payload.tipoMime || 'application/octet-stream', upsert: false
    });
    if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);

    const update: any = { storage_path: path, nome_arquivo: payload.nomeArquivo, atualizado_em: new Date().toISOString() };
    if (r.tipo_folha === 'CONTABILIDADE' && r.status === 'AGUARDANDO_DOCUMENTO') update.status = 'AGUARDANDO_HOMOLOGACAO';

    const { error: updateErr } = await db.from('folha_rescisoes').update(update).eq('id', payload.id);
    if (updateErr) throw new Error(updateErr.message);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function urlTrctRescisaoAction(payload: { id: number; download?: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r } = await db.from('folha_rescisoes').select('storage_path, nome_arquivo, empresa_id').eq('id', payload.id).maybeSingle();
    if (!r?.storage_path) return { ok: false, erro: 'Esta rescisão não tem anexo.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };

    const opts = payload.download ? { download: r.nome_arquivo || undefined } : undefined;
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(r.storage_path, 60 * 10, opts);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Falha ao gerar link.');
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function atualizarStatusRescisaoAction(payload: {
  id: number;
  status: 'RASCUNHO' | 'EM_CALCULO' | 'AGUARDANDO_DOCUMENTO' | 'AGUARDANDO_HOMOLOGACAO' | 'CANCELADA';
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('status, tipo_folha, dados_calculo, storage_path, empresa_id').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    if (r.status === 'HOMOLOGADA') return { ok: false, erro: 'Rescisão já homologada não pode mudar de status por aqui.' };

    if (payload.status === 'AGUARDANDO_HOMOLOGACAO') {
      if (r.tipo_folha === 'PROPRIO' && !r.dados_calculo) return { ok: false, erro: 'É necessário calcular a rescisão antes.' };
      if (r.tipo_folha === 'CONTABILIDADE' && !r.storage_path) return { ok: false, erro: 'É necessário anexar o TRCT antes.' };
    }

    const { error: updErr } = await db.from('folha_rescisoes').update({
      status: payload.status, atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (updErr) throw new Error(updErr.message);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// HOMOLOGAR — passo final. Sincroniza a ficha do funcionário (idempotente).
// ============================================================================
export async function homologarRescisaoAction(payload: { id: number; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('*').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    if (r.status === 'HOMOLOGADA') return { ok: true }; // já homologada — idempotente
    if (r.status === 'CANCELADA') return { ok: false, erro: 'Rescisão cancelada não pode ser homologada.' };
    if (r.tipo_folha === 'PROPRIO' && !r.dados_calculo) return { ok: false, erro: 'É necessário calcular a rescisão antes de homologar.' };
    if (r.tipo_folha === 'CONTABILIDADE' && !r.storage_path) return { ok: false, erro: 'É necessário anexar o TRCT antes de homologar.' };

    const { error: updErr } = await db.from('folha_rescisoes').update({
      status: 'HOMOLOGADA', homologado_em: new Date().toISOString(), homologado_por: payload.usuarioNome,
      atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (updErr) throw new Error(updErr.message);

    await sincronizarFichaRescisao(db, {
      funcionarioNome: r.funcionario_nome, dataDesligamento: r.data_desligamento, cargo: r.cargo
    });

    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome, acao: `HOMOLOGAÇÃO DE RESCISÃO: ${r.funcionario_nome}`, setor: 'RECURSOS HUMANOS / RESCISÃO'
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CANCELAR — se já estava homologada, NÃO reverte a ficha automaticamente
// (operação distinta e mais arriscada); avisa a UI para ajuste manual.
// ============================================================================
export async function cancelarRescisaoAction(payload: { id: number; motivo?: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('status, funcionario_nome, empresa_id').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };

    const jaHomologada = r.status === 'HOMOLOGADA';
    const { error: updErr } = await db.from('folha_rescisoes').update({
      status: 'CANCELADA', observacoes: payload.motivo || null, atualizado_em: new Date().toISOString()
    }).eq('id', payload.id);
    if (updErr) throw new Error(updErr.message);

    // A data de desligamento foi gravada na ficha já na abertura (ver
    // criarRescisaoAction). Se a rescisão nunca chegou a ser homologada,
    // desfaz — o funcionário volta a não ter data de desligamento.
    if (!jaHomologada) {
      await db.from('folha_funcionarios').update({ data_desligamento: null }).eq('nome_completo', r.funcionario_nome);
    }

    return { ok: true, info: { avisoManual: jaHomologada } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PAINEL: lista todas as rescisões + KPIs, para a própria página e para o
// painel de pendências do HUB (actions-dashboard.ts).
// ============================================================================
export async function painelRescisoesAction(accessToken: string): Promise<Resultado> {
  let acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) {
    // Também usada pelo painel de pendências do hub /admin/rh.
    const acessoHub = await validarAcesso(accessToken, '/admin/rh');
    if (!acessoHub.ok) return { ok: false, erro: acesso.message };
    acesso = acessoHub;
  }

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let q = db.from('folha_rescisoes').select('*').order('data_desligamento', { ascending: false });
    if (empresasPermitidas) q = q.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const linhas = data || [];
    const hoje = hojeIso();
    const totais = {
      emAndamento: linhas.filter(l => !STATUS_FINAIS.includes(l.status)).length,
      homologadasNoMes: linhas.filter(l => l.status === 'HOMOLOGADA' && l.homologado_em && l.homologado_em.slice(0, 7) === hoje.slice(0, 7)).length,
      proprio: linhas.filter(l => l.tipo_folha === 'PROPRIO').length,
      contabilidade: linhas.filter(l => l.tipo_folha === 'CONTABILIDADE').length
    };

    return { ok: true, info: { linhas, totais } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ASSINATURA (Autentique) — só depois de homologada. Baixa o TRCT já
// anexado no storage e reaproveita o mecanismo de "documento avulso" já
// existente em actions-assinatura.ts (mesma tabela folha_holerite_assinaturas,
// mesma integração com a Autentique usada pelos holerites e advertências).
// NÃO reaproveita enviarDocumentoAvulsoAction() diretamente porque ela monta
// seu PRÓPRIO marcador (AVULSO-{mes}-{timestamp}), diferente do que a gente
// passa — o registro ficava salvo sob um mes_referencia que nunca batia com
// marcadorAssinatura(id), então a rescisão nunca mais encontrava o próprio
// envio (nem aparecia na aba Rescisão de /admin/rh/assinaturas). Aqui grava
// direto com o marcador exato (RESCISAO-{id}), fixo, então reenviar
// atualiza o mesmo registro em vez de acumular linhas órfãs.
// ============================================================================
export async function enviarRescisaoParaAssinaturaAction(payload: {
  id: number; usuarioNome: string; sandbox: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('*').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    if (r.status !== 'HOMOLOGADA') return { ok: false, erro: 'Só é possível enviar para assinatura depois da rescisão homologada.' };

    // Sem vínculo com a contabilidade (folha própria): o termo é o que o
    // próprio sistema calculou, gerado na hora — não depende de anexo.
    // Com a contabilidade: precisa do TRCT que ela mesma enviou.
    let pdfBase64: string;
    if (r.storage_path) {
      const { data: arquivo, error: dlErr } = await db.storage.from(BUCKET).download(r.storage_path);
      if (dlErr || !arquivo) throw new Error(dlErr?.message || 'Falha ao baixar o TRCT anexado.');
      pdfBase64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64');
    } else if (r.tipo_folha === 'PROPRIO' && r.dados_calculo) {
      const pdfBytes = await montarPdfBytesRescisao(db, r);
      pdfBase64 = Buffer.from(pdfBytes).toString('base64');
    } else {
      return { ok: false, erro: 'Nenhum TRCT anexado para enviar.' };
    }

    const { data: func } = await db.from('folha_funcionarios')
      .select('cpf, celular, email').eq('nome_completo', r.funcionario_nome).maybeSingle();

    const cpfLimpo = (func?.cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return { ok: false, erro: `CPF de ${r.funcionario_nome} ausente ou inválido. Preencha o CPF na ficha antes de enviar.` };
    }
    const celularE164 = normalizarCelularBR(func?.celular);
    if (!celularE164 && !func?.email) {
      return { ok: false, erro: `Informe celular ou e-mail de ${r.funcionario_nome} na ficha para enviar o link de assinatura.` };
    }

    const tituloDocumento = 'TRCT - Rescisão';
    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `${tituloDocumento} — ${r.funcionario_nome}`,
      signatarioNome: r.funcionario_nome,
      signatarioCpf: cpfLimpo,
      signatarioCelular: celularE164 || undefined,
      signatarioEmail: func?.email || undefined,
      pdfBuffer: new Uint8Array(Buffer.from(pdfBase64, 'base64')),
      pdfNomeArquivo: `trct-rescisao-${slug(r.funcionario_nome)}.pdf`,
      sandbox: payload.sandbox
    });

    const { error: upsertErr } = await db.from('folha_holerite_assinaturas').upsert({
      funcionario_nome: r.funcionario_nome,
      empresa_id: r.empresa_id,
      mes_referencia: marcadorAssinatura(payload.id),
      cpf: cpfLimpo,
      autentique_doc_id: doc.docId,
      public_id: doc.publicId,
      link_assinatura: doc.linkAssinatura,
      status: 'ENVIADO',
      sandbox: payload.sandbox,
      titulo_avulso: tituloDocumento,
      enviado_por: payload.usuarioNome || null,
      enviado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    }, { onConflict: 'funcionario_nome,mes_referencia' });
    if (upsertErr) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${upsertErr.message}`);

    return { ok: true, info: { docId: doc.docId, link: doc.linkAssinatura, sandbox: payload.sandbox } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Leitura "fria" (sem chamar a Autentique) do último envio — usada ao abrir
// a página, pra já mostrar o status sem gastar uma consulta à API.
export async function obterAssinaturaRescisaoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r } = await db.from('folha_rescisoes').select('funcionario_nome, empresa_id').eq('id', payload.id).maybeSingle();
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };

    const { data: assinatura } = await db.from('folha_holerite_assinaturas')
      .select('status, link_assinatura, sandbox, enviado_em, assinado_em, arquivo_assinado')
      .eq('funcionario_nome', r.funcionario_nome).eq('mes_referencia', marcadorAssinatura(payload.id)).maybeSingle();

    return { ok: true, info: { assinatura: assinatura || null } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Consulta "quente" — pergunta o status atual pra Autentique e atualiza o
// controle local (assinado/visualizado/rejeitado).
export async function atualizarAssinaturaRescisaoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r } = await db.from('folha_rescisoes').select('funcionario_nome, empresa_id').eq('id', payload.id).maybeSingle();
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    return await consultarAssinaturaAction({ funcionarioNome: r.funcionario_nome, mesReferencia: marcadorAssinatura(payload.id) }, accessToken);
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarAssinadoRescisaoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r } = await db.from('folha_rescisoes').select('funcionario_nome, empresa_id').eq('id', payload.id).maybeSingle();
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    return await baixarAssinadoAction({ funcionarioNome: r.funcionario_nome, mesReferencia: marcadorAssinatura(payload.id) }, accessToken);
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LISTAGEM para a aba "Rescisão" em /admin/rh/assinaturas — todos os envios
// de TRCT (qualquer mês/rescisão), já com o id da rescisão extraído do
// marcador pra dar link direto de volta pra tela de detalhe.
// ============================================================================
export async function listarAssinaturasRescisaoAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let q = db.from('folha_holerite_assinaturas')
      .select('*').like('mes_referencia', 'RESCISAO-%').order('enviado_em', { ascending: false });
    if (empresasPermitidas) q = q.or(`empresa_id.is.null,empresa_id.in.(${empresasPermitidas.join(',') || '0'})`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const linhas = (data || []).map(a => ({
      ...a,
      rescisaoId: Number(String(a.mes_referencia).replace('RESCISAO-', '')) || null
    }));

    return { ok: true, info: { assinaturas: linhas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// TERMO DE RESCISÃO EM PDF — gera a "folha" a partir do que foi calculado
// (mesmo padrão do preview de holerite: pdf-lib no servidor, base64 pro
// cliente montar um Blob e abrir numa aba nova). Só existe pro caso PRÓPRIO,
// que é o único com dados_calculo — no caso CONTABILIDADE o documento é o
// TRCT que a própria contabilidade envia (storage_path).
// ============================================================================
// Monta os bytes do termo calculado a partir da linha de folha_rescisoes já
// carregada (r = select('*')) — reaproveitado pela visualização e pelo envio
// para assinatura, pra não duplicar a montagem dos parâmetros do PDF.
async function montarPdfBytesRescisao(db: ReturnType<typeof supabaseAdmin>, r: any): Promise<Uint8Array> {
  const { data: func } = await db.from('folha_funcionarios').select('cpf').eq('nome_completo', r.funcionario_nome).maybeSingle();
  const dados = r.dados_calculo as any;

  return gerarRescisaoPdf({
    nome: r.funcionario_nome,
    cpf: func?.cpf || null,
    cargo: r.cargo,
    dataAdmissao: r.data_admissao,
    dataDesligamento: r.data_desligamento,
    motivoLabel: MOTIVO_LABEL[r.motivo] || r.motivo,
    avisoPrevioLabel: `${AVISO_LABEL[r.tipo_aviso_previo || ''] || '—'}${r.dias_aviso_previo ? ` (${r.dias_aviso_previo}d)` : ''}`,
    itens: dados.itens || [],
    totalProventos: dados.totalProventos || 0,
    totalDescontos: dados.totalDescontos || 0,
    valorLiquido: dados.valorLiquido ?? r.valor_total_liquido ?? 0,
    saldoFgtsInformado: r.saldo_fgts_informado,
    fgtsPercentualMulta: r.fgts_percentual_multa,
    fgtsValorMulta: r.fgts_valor_multa,
    calculadoEm: dados.calculadoEm || r.atualizado_em
  });
}

export async function gerarPdfRescisaoAction(payload: { id: number }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoRescisao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  try {
    const { data: r, error } = await db.from('folha_rescisoes').select('*').eq('id', payload.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) return { ok: false, erro: 'Rescisão não encontrada.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, r.empresa_id)) return { ok: false, erro: 'Rescisão não encontrada.' };
    if (r.tipo_folha !== 'PROPRIO' || !r.dados_calculo) {
      return { ok: false, erro: 'Não há cálculo disponível para gerar o termo — esse caso é administrado pela contabilidade.' };
    }

    const pdfBytes = await montarPdfBytesRescisao(db, r);
    return { ok: true, info: { pdfBase64: Buffer.from(pdfBytes).toString('base64') } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
