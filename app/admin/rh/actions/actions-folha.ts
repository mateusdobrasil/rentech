'use server';

// app/admin/rh/actions-folha.ts
// Server actions para as GRAVAÇÕES sensíveis do módulo de folha.
// Rodam no servidor com service role — a lógica de escrita sai do browser.
import { supabaseAdmin } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';

type Resultado = { ok: boolean; erro?: string; info?: any };

// ============================================================================
// SALVAR FICHA DO COLABORADOR (funcionário + dependentes + movimentações)
// ============================================================================
export async function salvarColaboradorAction(payload: {
  form: any;
  dependentes: any[];
  movimentacoes: any[];
  usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { form, dependentes, movimentacoes, usuarioNome } = payload;

  if (!form?.nome_completo) return { ok: false, erro: 'O Nome Completo é obrigatório.' };

  // Nome sempre em MAIÚSCULO no banco (padroniza a chave usada em todas as tabelas)
  form.nome_completo = String(form.nome_completo).trim().toUpperCase();

  try {
    const { error: upsertError } = await db
      .from('folha_funcionarios')
      .upsert(form, { onConflict: 'nome_completo' });
    if (upsertError) throw new Error(`Falha ao gravar a ficha: ${upsertError.message}`);

    const { error: delDep } = await db.from('folha_dependentes').delete().eq('funcionario_nome', form.nome_completo);
    if (delDep) throw new Error(`Falha ao limpar dependentes antigos: ${delDep.message}`);

    if (dependentes.length > 0) {
      const limpaDependentes = dependentes.map((d: any) => ({
        funcionario_nome: form.nome_completo,
        tipo_dependente: d.tipo_dependente || null,
        nome_completo: d.nome_completo || null,
        cpf: d.cpf || null,
        data_nascimento: d.data_nascimento || null
      }));
      const { error: insDep } = await db.from('folha_dependentes').insert(limpaDependentes);
      if (insDep) throw new Error(`Falha ao gravar dependentes: ${insDep.message}`);
    }

    const { error: delMov } = await db.from('folha_movimentacoes').delete().eq('funcionario_nome', form.nome_completo);
    if (delMov) throw new Error(`Falha ao limpar movimentações antigas: ${delMov.message}`);

    if (movimentacoes.length > 0) {
      const limpaMovimentacoes = movimentacoes.map((m: any) => ({
        funcionario_nome: form.nome_completo,
        motivo: m.motivo || null,
        cargo: m.cargo || null,
        data_movimentacao: m.data_movimentacao || null
      }));
      const { error: insMov } = await db.from('folha_movimentacoes').insert(limpaMovimentacoes);
      if (insMov) throw new Error(`Falha ao gravar movimentações: ${insMov.message}`);
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `ATUALIZAÇÃO FINANCEIRA INTEGRADA: ${form.nome_completo}`,
      setor: 'RECURSOS HUMANOS / HOLERITES'
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// SALVAR BÔNUS E DESCONTOS DE UM FUNCIONÁRIO (usado pela página de Holerite)
// ============================================================================
export async function salvarBonusDescontosAction(payload: {
  funcionarioNome: string;
  descontos: any[];
  bonus: any[];
  usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { funcionarioNome, descontos, bonus, usuarioNome } = payload;

  if (!funcionarioNome) return { ok: false, erro: 'Funcionário não informado.' };

  try {
    const { error: delDesc } = await db.from('folha_descontos').delete().eq('funcionario_nome', funcionarioNome);
    if (delDesc) throw new Error(`Falha ao limpar descontos antigos: ${delDesc.message}`);

    if (descontos.length > 0) {
      const limpaDescontos = descontos.map((d: any) => ({
        funcionario_nome: funcionarioNome,
        descricao: d.descricao || 'DESCONTO', tipo: d.tipo,
        parcelas: d.tipo === 'FIXO' ? 1 : (Number(d.parcelas) || 1),
        mes_inicio: d.mes_inicio,
        mes_fim: d.tipo === 'FIXO' ? '2099-12' : d.mes_fim,
        valor_parcela: Number(d.valor_parcela) || 0
      }));
      const { error: insDesc } = await db.from('folha_descontos').insert(limpaDescontos);
      if (insDesc) throw new Error(`Falha ao gravar descontos: ${insDesc.message}`);
    }

    const { error: delBonus } = await db.from('folha_bonus').delete().eq('funcionario_nome', funcionarioNome);
    if (delBonus) throw new Error(`Falha ao limpar bônus antigos: ${delBonus.message}`);

    if (bonus.length > 0) {
      const limpaBonus = bonus.map((b: any) => ({
        funcionario_nome: funcionarioNome,
        descricao: b.descricao || 'PRÊMIO', recorrencia: b.recorrencia,
        mes_referencia: b.mes_referencia, valor: Number(b.valor) || 0
      }));
      const { error: insBonus } = await db.from('folha_bonus').insert(limpaBonus);
      if (insBonus) throw new Error(`Falha ao gravar bônus: ${insBonus.message}`);
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `ATUALIZAÇÃO DE BÔNUS/DESCONTOS: ${funcionarioNome}`,
      setor: 'RECURSOS HUMANOS / HOLERITES'
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// SALVAR DADOS SALARIAIS DE UM FUNCIONÁRIO (usado pela página de Holerite)
// ============================================================================
export async function salvarDadosSalariaisAction(payload: {
  funcionarioNome: string;
  salario_folha: number;
  salario_contrato: number;
  valor_refeicao: number;
  valor_transporte: number;
  valor_adiantamento: number;
  valor_premio_diaria_viagem: number;
  usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { funcionarioNome, salario_folha, salario_contrato, valor_refeicao, valor_transporte, valor_adiantamento, valor_premio_diaria_viagem, usuarioNome } = payload;

  if (!funcionarioNome) return { ok: false, erro: 'Funcionário não informado.' };

  try {
    const { error } = await db
      .from('folha_funcionarios')
      .update({
        salario_folha: Number(salario_folha) || 0,
        salario_contrato: Number(salario_contrato) || 0,
        valor_refeicao: Number(valor_refeicao) || 0,
        valor_transporte: Number(valor_transporte) || 0,
        valor_adiantamento: Number(valor_adiantamento) || 0,
        valor_premio_diaria_viagem: Number(valor_premio_diaria_viagem) || 0
      })
      .eq('nome_completo', funcionarioNome);
    if (error) throw new Error(`Falha ao gravar os dados salariais: ${error.message}`);

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `ATUALIZAÇÃO DE DADOS SALARIAIS: ${funcionarioNome}`,
      setor: 'RECURSOS HUMANOS / HOLERITES'
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// FECHAR FOLHA EM LOTE
// ============================================================================
export async function fecharFolhaLoteAction(payload: {
  mesReferencia: string;
  linhas: { funcionario_nome: string; dados: any }[];
  usuarioNome: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { mesReferencia, linhas, usuarioNome } = payload;

  if (!linhas.length) return { ok: false, erro: 'Nenhum funcionário para fechar.' };

  try {
    const agora = new Date().toISOString();
    const registros = linhas.map(l => ({
      funcionario_nome: l.funcionario_nome,
      mes_referencia: mesReferencia,
      dados: l.dados,
      total_creditos: Number((l.dados.totalCreditos || 0).toFixed(2)),
      total_debitos: Number((l.dados.totalDebitos || 0).toFixed(2)),
      valor_liquido: Number((l.dados.valorLiquidoReceber || 0).toFixed(2)),
      fechado_por: usuarioNome || null,
      fechado_em: agora
    }));

    const { error } = await db.from('folha_holerites')
      .upsert(registros, { onConflict: 'funcionario_nome,mes_referencia' });
    if (error) throw new Error(error.message);

    const totalLiquido = registros.reduce((s, r) => s + r.valor_liquido, 0);
    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `FECHAMENTO DE FOLHA EM LOTE (${mesReferencia}): ${registros.length} funcionário(s), líquido total R$ ${totalLiquido.toFixed(2)}`,
      setor: 'RECURSOS HUMANOS / HOLERITES'
    });

    return { ok: true, info: { fechados: registros.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// REABRIR FOLHA (um ou vários ids)
// ============================================================================
export async function reabrirFolhaAction(payload: {
  ids: number[];
  mesReferencia: string;
  usuarioNome: string;
  descricao: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { ids, mesReferencia, usuarioNome, descricao } = payload;

  if (!ids.length) return { ok: false, erro: 'Nenhuma folha para reabrir.' };

  try {
    const { error } = await db.from('folha_holerites').delete().in('id', ids);
    if (error) throw new Error(error.message);

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `REABERTURA DE FOLHA (${mesReferencia}): ${descricao}`,
      setor: 'RECURSOS HUMANOS / HOLERITES'
    });

    return { ok: true, info: { reabertos: ids.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}