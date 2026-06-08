"use server";

import { supabase } from '../../lib/supabase';
import { revalidatePath } from 'next/cache';
import nodemailer from 'nodemailer';

// Tipagem de segurança para garantir que a OP não falte dados
export interface NovaOPData {
  responsavel_nome: string;
  responsavel_email: string;
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

// 1. Criar Nova OP
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

    // =========================================================
    // NOVO: DISPARO AUTOMÁTICO DE E-MAIL NA CRIAÇÃO
    // =========================================================
    try {
      // Chama a função de e-mail passando os dados da OP recém-criada
      // e o e-mail do responsável para garantir que ele receba a cópia
      await dispararEmailOP(data, data.responsavel_email);
    } catch (emailError) {
      console.error("A OP foi criada, mas houve um erro no disparo do e-mail:", emailError);
      // Nota: Não damos um 'throw' aqui para não cancelar a criação da OP
      // caso o servidor de e-mail da locaweb/hostgator dê alguma instabilidade momentânea.
    }
    
    revalidatePath('/admin');
    return { success: true, id: novaOp.id };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function listarOPs(nivelAcesso: string, usuarioAtual: string) {
  try {
    // 1. Inicia a busca na tabela (ajuste 'ordens_pagamento' para o nome exato da sua tabela no Supabase se for diferente)
    let query = supabase
      .from('ordens_pagamento')
      .select('*')
      .order('data_criacao', { ascending: false }); // Traz as mais recentes primeiro

    // 2. A MÁGICA ACONTECE AQUI: 
    // Se o nível NÃO for 'DIR' (Diretor/Admin), ele trava a busca para trazer apenas as OPs do usuário.
    // Se for 'DIR', ele ignora esse filtro e traz o banco de dados inteiro!
    if (nivelAcesso !== 'DIR') {
      query = query.eq('responsavel_nome', usuarioAtual);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error("Erro ao listar OPs:", error);
    return { success: false, message: error.message, data: [] };
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

    revalidatePath('/admin');
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

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ============================================================================
// NOVO: DISPARO DE E-MAIL VIA SMTP (NODEMAILER) COM TEMPLATE COMPLETO
// ============================================================================
export async function dispararEmailOP(op: any, emailSolicitante: string) {
  try {
    // 1. Configura o "Carteiro" com os dados do seu .env.local
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // 2. Formata os dados financeiros e as linhas da tabela
    const totalGeral = Number(op.total_geral || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
    const itensHtml = op.itens.map((it: any) => {
      const descricao = it.descricao || it.description || '';
      const qtd = it.qtd || it.quantity || 1;
      const unitario = Number(it.valor_unitario || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const total = Number(it.total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; color: #0C1D4D; font-weight: bold; font-size: 12px;">${descricao}</td>
          <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: center; color: #64748B; font-size: 12px;">${qtd}</td>
          <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: right; color: #64748B; font-size: 12px;">${unitario}</td>
          <td style="padding: 10px; border-bottom: 1px solid #E2E8F0; text-align: right; color: #336699; font-weight: bold; font-size: 12px;">${total}</td>
        </tr>
      `;
    }).join('');

    // Tratamento do Anexo
    const anexoHtml = op.file_url 
      ? `<a href="${op.file_url}" style="display: inline-block; padding: 12px 24px; background-color: #336699; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 12px;">📎 Visualizar Comprovante / Anexo</a>`
      : `<span style="color: #94A3B8; font-style: italic; font-size: 12px;">Nenhum anexo enviado.</span>`;

    // 3. Monta o Corpo do E-mail
    const mailOptions = {
      from: `"Sistema Rentech" <${process.env.SMTP_USER}>`,
      to: `${emailSolicitante}, financeiro@locadorarentech.com.br`, 
      subject: `[Nova OP] OS: ${op.os_numero || 'S/N'} - ${op.empresa_recebedora}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
          
          <div style="background-color: #0C1D4D; padding: 20px; text-align: center; color: white;">
            <h2 style="margin: 0; font-size: 20px; letter-spacing: 1px; text-transform: uppercase;">Ordem de Pagamento</h2>
            <p style="margin: 5px 0 0 0; color: #94A3B8; font-size: 13px;">Nº da OS: <strong>${op.os_numero || 'S/N'}</strong></p>
          </div>

          <div style="padding: 20px; border-bottom: 1px solid #E2E8F0;">
            <h3 style="color: #336699; font-size: 14px; text-transform: uppercase; margin-top: 0; margin-bottom: 15px; letter-spacing: 0.5px;">📋 Dados do Projeto</h3>
            <table style="width: 100%; font-size: 13px; line-height: 1.5;">
              <tr>
                <td style="padding-bottom: 10px; width: 50%;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Solicitante</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.responsavel_nome}</span>
                </td>
                <td style="padding-bottom: 10px; width: 50%;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Natureza</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.natureza_pagamento || 'Não informada'}</span>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom: 10px;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Cliente</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.os_cliente || 'Não informado'}</span>
                </td>
                <td style="padding-bottom: 10px;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Evento</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.os_evento || 'Não informado'}</span>
                </td>
              </tr>
              <tr>
                <td colspan="2">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Período</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.os_periodo || 'Não informado'}</span>
                </td>
              </tr>
            </table>
          </div>

          <div style="padding: 20px; border-bottom: 1px solid #E2E8F0; background-color: #F8FAFC;">
            <h3 style="color: #336699; font-size: 14px; text-transform: uppercase; margin-top: 0; margin-bottom: 15px; letter-spacing: 0.5px;">🏢 Dados do Favorecido</h3>
            <table style="width: 100%; font-size: 13px; line-height: 1.5;">
              <tr>
                <td style="padding-bottom: 10px; width: 50%;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Empresa / Nome</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.empresa_recebedora}</span>
                </td>
                <td style="padding-bottom: 10px; width: 50%;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">CNPJ / CPF</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.cnpj_cpf_recebedora || 'Não informado'}</span>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom: 10px;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Telefone / Contato</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.telefone_recebedora || 'Não informado'}</span>
                </td>
                <td style="padding-bottom: 10px;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Endereço</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.endereco_recebedora || 'Não informado'}</span>
                </td>
              </tr>
            </table>
          </div>

          <div style="padding: 20px; border-bottom: 1px solid #E2E8F0;">
            <h3 style="color: #336699; font-size: 14px; text-transform: uppercase; margin-top: 0; margin-bottom: 15px; letter-spacing: 0.5px;">💳 Informações de Pagamento</h3>
            <table style="width: 100%; font-size: 13px; line-height: 1.5;">
              <tr>
                <td style="padding-bottom: 10px; width: 50%;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Forma de Pagamento</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.tipo_pagamento}</span>
                </td>
                <td style="padding-bottom: 10px; width: 50%;">
                  <strong style="color:red; font-size: 10px; text-transform: uppercase;">Data de Vencimento</strong><br/>
                  <span style="color:red; font-weight: bold;">${op.data_vencimento || 'Não informada'}</span>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom: 10px;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Chave PIX</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.chave_pix || 'Não informada'}</span>
                </td>
                <td style="padding-bottom: 10px;">
                  <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Dados Bancários (Ag/Conta)</strong><br/>
                  <span style="color:#0C1D4D; font-weight: bold;">${op.dados_pagamento || 'Não informados'}</span>
                </td>
              </tr>
            </table>
          </div>

          <div style="padding: 20px;">
            <h3 style="color: #336699; font-size: 14px; text-transform: uppercase; margin-top: 0; margin-bottom: 15px; letter-spacing: 0.5px;">🛒 Detalhamento de Itens</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
              <thead>
                <tr style="background-color: #F8FAFC; color: #64748B; text-transform: uppercase;">
                  <th style="padding: 10px; text-align: left; font-size: 10px;">Descrição</th>
                  <th style="padding: 10px; text-align: center; font-size: 10px;">Qtd</th>
                  <th style="padding: 10px; text-align: right; font-size: 10px;">Unitário</th>
                  <th style="padding: 10px; text-align: right; font-size: 10px;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${itensHtml}
              </tbody>
            </table>
            
            <div style="background-color: #F8FAFC; padding: 15px; border-radius: 8px; border: 1px solid #E2E8F0;">
              <strong style="color:#64748B; font-size: 10px; text-transform: uppercase;">Observações Adicionais</strong><br/>
              <span style="color:#0C1D4D; font-size: 12px; font-weight: 500;">${op.observacao || 'Nenhuma observação registrada para esta OP.'}</span>
              <div style="margin-top: 15px;">
                ${anexoHtml}
              </div>
            </div>
          </div>

          <div style="background-color: #E0F2FE; padding: 25px 20px; text-align: right; border-top: 2px solid #BAE6FD;">
            <span style="color: #0369A1; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Valor Total a Pagar</span>
            <br/>
            <strong style="color: #0C1D4D; font-size: 28px;">${totalGeral}</strong>
          </div>

          <div style="padding: 15px; text-align: center; background-color: #F1F5F9; color: #94A3B8; font-size: 10px;">
            <p style="margin:0;">Este é um e-mail automático gerado pelo Sistema Rentech.</p>
            <p style="margin:0;">Por favor, não responda diretamente a este endereço.</p>
          </div>

        </div>
      `
    };

    // 4. Dispara o e-mail
    await transporter.sendMail(mailOptions);
    return { success: true };
    
  } catch (error: any) {
    console.error("Erro crítico no envio de email via SMTP:", error);
    return { success: false, message: error.message || "Falha na conexão com o servidor de e-mail." };
  }
}