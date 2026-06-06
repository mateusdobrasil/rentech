"use server";

import { supabase } from '../../lib/supabase';
import { revalidatePath } from 'next/cache';

// Tipagem de segurança para garantir que a OP não falte dados
export interface NovaOPData {
  responsavel_nome: string;
  natureza_pagamento: string;
  os_numero: string;
  os_cliente: string;
  os_evento: string;
  os_periodo: string;
  empresa_recebedora: string;
  cnpj_cpf_recebedora: string;
  endereco_recebedora: string;
  telefone_recebedora: string;
  tipo_pagamento: string;
  chave_pix: string;
  dados_pagamento: string;
  itens: any[]; 
  total_geral: number;
  data_vencimento: string; // YYYY-MM-DD
  observacao: string;
  file_url: string;
}

// 1. Criar Nova OP (Substitui o saveAndSendData)
export async function criarOP(data: NovaOPData) {
  try {
    const { data: novaOp, error } = await supabase
      .from('ordens_pagamento')
      .insert([data])
      .select('id')
      .single();

    if (error) throw error;

    // Registra a criação no histórico de auditoria
    await supabase.from('historico_op').insert([{
      op_id: novaOp.id,
      usuario_nome: data.responsavel_nome,
      acao: 'CRIOU OP'
    }]);

    // O envio de e-mail (antigo MailApp) será feito aqui no futuro usando uma API como Resend ou SendGrid
    
    revalidatePath('/admin/op');
    return { success: true, id: novaOp.id };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 2. Buscar todas as OPs (Substitui o getAllOPs e getMinhasOPs)
export async function listarOPs(nivel: string, nomeUsuario: string) {
  try {
    let query = supabase
      .from('ordens_pagamento')
      .select('*')
      .order('data_criacao', { ascending: false });

    // Regra de Negócio: Se for 'USU' (Responsável), vê apenas as próprias OPs
    if (nivel !== 'ADM') {
      query = query.eq('responsavel_nome', nomeUsuario);
    }

    const { data: ops, error } = await query;
    if (error) throw error;

    return { success: true, data: ops };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 3. Atualizar Status (Substitui o atualizarStatusOP)
export async function atualizarStatus(opId: string, novoStatus: string, usuarioAlteracao: string) {
  try {
    const { error } = await supabase
      .from('ordens_pagamento')
      .update({ status: novoStatus, updated_at: new Date().toISOString() })
      .eq('id', opId);

    if (error) throw error;

    // Salva na Caixa Preta / Histórico quem mexeu na OP
    await supabase.from('historico_op').insert([{
      op_id: opId,
      usuario_nome: usuarioAlteracao,
      acao: `MUDOU STATUS PARA ${novoStatus}`
    }]);

    revalidatePath('/admin/op');
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 4. Buscar OP Específica para Edição (Substitui o getOPForEdit)
export async function buscarOP(opId: string) {
  try {
    const { data: op, error } = await supabase
      .from('ordens_pagamento')
      .select('*')
      .eq('id', opId)
      .single();

    if (error) throw error;
    return { success: true, data: op };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 5. Atualizar Dados da OP (Substitui o updateOPData)
export async function atualizarOP(opId: string, dadosAtualizados: Partial<NovaOPData>, usuarioAlteracao: string) {
  try {
    const { error } = await supabase
      .from('ordens_pagamento')
      .update({ ...dadosAtualizados, updated_at: new Date().toISOString() })
      .eq('id', opId);

    if (error) throw error;

    await supabase.from('historico_op').insert([{
      op_id: opId,
      usuario_nome: usuarioAlteracao,
      acao: 'EDITOU DADOS DA OP'
    }]);

    revalidatePath('/admin/op');
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}