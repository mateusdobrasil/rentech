// app/actions.ts
"use server";

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;

// ============================================================================
// 1. FUNÇÃO DE E-MAIL (ORÇAMENTOS DO SITE)
// ============================================================================
export async function enviarOrcamento(formData: FormData) {
  try {
    const nome = formData.get('nome') as string;
    const email = formData.get('email') as string;
    const telefone = formData.get('telefone') as string;
    const tipo = formData.get('tipo') as string;
    const mensagem = formData.get('mensagem') as string;

    if (!nome || !email || !mensagem) {
      return { success: false, error: 'Preencha os campos obrigatórios.' };
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `"Site Rentech" <${process.env.SMTP_USER}>`,
      to: 'contato@locadorarentech.com.br',
      replyTo: email,
      subject: `[Novo Orçamento Site] ${tipo} - ${nome}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #E2E8F0; padding: 20px;">
          <h2 style="color: #0C1D4D; border-bottom: 2px solid #336699; padding-bottom: 10px;">Nova Solicitação de Orçamento</h2>
          <p><strong>Nome:</strong> ${nome}</p>
          <p><strong>E-mail:</strong> ${email}</p>
          <p><strong>Telefone:</strong> ${telefone}</p>
          <p><strong>Tipo de Evento:</strong> ${tipo}</p>
          <div style="background-color: #F8FAFC; padding: 15px; border-radius: 5px; margin-top: 20px;">
            <strong>Mensagem / Detalhes:</strong><br/><br/>
            ${mensagem.replace(/\n/g, '<br/>')}
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return { success: true };

  } catch (error: any) {
    console.error("Erro no envio do orçamento:", error);
    return { success: false, error: 'Falha ao enviar e-mail. Tente novamente mais tarde.' };
  }
}

// ============================================================================
// 2. FUNÇÃO GLOBAL DE AUDITORIA DO SISTEMA
// ============================================================================
interface LogPayload {
  usuario_nome: string;
  acao: string;
  setor: string;
  equipamento_id?: string | null;
  equipamento_nome?: string | null;
}

export async function uploadArquivoDownload(formData: FormData) {
  try {
    const nome = (formData.get('nome') as string | null)?.trim();
    const descricao = (formData.get('descricao') as string | null)?.trim() ?? '';
    const categoria = (formData.get('categoria') as string | null)?.trim() || 'COMERCIAL';
    const usuarioNome = (formData.get('usuarioNome') as string | null)?.trim() || 'Usuário';
    const file = formData.get('file');

    if (!nome || !file || !(file instanceof File)) {
      return { success: false, message: 'Preencha o nome e selecione um arquivo.' };
    }

    if (!supabaseAdmin) {
      return { success: false, message: 'Credenciais do Supabase ausentes.' };
    }

    const fileExt = file.name.split('.').pop() || 'bin';
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `${categoria.toLowerCase()}/${fileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('downloads')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream'
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: publicUrlData } = supabaseAdmin.storage.from('downloads').getPublicUrl(filePath);
    const tamanhoMB = parseFloat((file.size / (1024 * 1024)).toFixed(2));

    const { error: dbError } = await supabaseAdmin.from('arquivos_download').insert([{
      nome,
      descricao,
      categoria,
      file_url: publicUrlData.publicUrl,
      file_path: filePath,
      tamanho_mb: tamanhoMB
    }]);

    if (dbError) {
      throw new Error(dbError.message);
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `CADASTRO DE ARQUIVO: ${nome}`,
      setor: 'GESTAO DE DOWNLOADS',
      equipamento_nome: `Categoria: ${categoria}`
    });

    revalidatePath('/admin/downloads');
    return { success: true };
  } catch (error: any) {
    console.error('Erro ao enviar arquivo para o portal:', error.message);
    return { success: false, message: error.message || 'Falha ao enviar arquivo.' };
  }
}

export async function removerArquivoDownload(formData: FormData) {
  try {
    const id = (formData.get('id') as string | null)?.trim();
    const filePath = (formData.get('filePath') as string | null)?.trim();
    const usuarioNome = (formData.get('usuarioNome') as string | null)?.trim() || 'Usuário';

    if (!id || !filePath) {
      return { success: false, message: 'Registro inválido para exclusão.' };
    }

    if (!supabaseAdmin) {
      return { success: false, message: 'Credenciais do Supabase ausentes.' };
    }

    const { error: storageError } = await supabaseAdmin.storage.from('downloads').remove([filePath]);
    if (storageError) {
      throw new Error(storageError.message);
    }

    const { error: dbError } = await supabaseAdmin.from('arquivos_download').delete().eq('id', id);
    if (dbError) {
      throw new Error(dbError.message);
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `EXCLUSÃO DE ARQUIVO: ${id}`,
      setor: 'GESTAO DE DOWNLOADS'
    });

    revalidatePath('/admin/downloads');
    return { success: true };
  } catch (error: any) {
    console.error('Erro ao remover arquivo do portal:', error.message);
    return { success: false, message: error.message || 'Falha ao remover arquivo.' };
  }
}

// ============================================================================
// 2.1 CRIAÇÃO DE NOVO USUÁRIO (GESTÃO DE ACESSOS)
// ============================================================================
export async function criarUsuarioAcesso(payload: {
  nome: string;
  email: string;
  senha: string;
  permissao: string;
  usuarioNome: string;
}) {
  const nome = (payload.nome || '').trim();
  const email = (payload.email || '').trim().toLowerCase();
  const senha = payload.senha || '';
  const permissao = (payload.permissao || '').trim();

  if (!nome || !email || !permissao) {
    return { success: false, message: 'Preencha nome, e-mail e setor de permissão.' };
  }
  if (senha.length < 8) {
    return { success: false, message: 'A senha precisa ter pelo menos 8 caracteres.' };
  }
  if (!supabaseAdmin) {
    return { success: false, message: 'Credenciais do Supabase ausentes.' };
  }

  const { data: criado, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome },
  });

  if (authError || !criado?.user) {
    const jaExiste = authError?.status === 422 || (authError?.message || '').toLowerCase().includes('already');
    return { success: false, message: jaExiste ? 'Já existe um usuário cadastrado com este e-mail.' : (authError?.message || 'Falha ao criar credenciais de acesso.') };
  }

  const { error: perfilError } = await supabaseAdmin.from('perfis_usuarios').insert([{
    id: criado.user.id,
    nome: nome.toUpperCase(),
    email,
    permissao,
    ativo: true,
  }]);

  if (perfilError) {
    await supabaseAdmin.auth.admin.deleteUser(criado.user.id);
    return { success: false, message: perfilError.message || 'Falha ao gravar o perfil do usuário.' };
  }

  await registrarLogAuditoria({
    usuario_nome: payload.usuarioNome,
    acao: 'REGISTROU NOVO USUÁRIO',
    setor: 'PERMISSÕES',
    equipamento_id: criado.user.id,
    equipamento_nome: `${nome.toUpperCase()} (${email}) → ${permissao}`,
  });

  revalidatePath('/admin/permissoes');
  return { success: true };
}

export async function registrarLogAuditoria(payload: LogPayload) {
  try {
    if (!supabaseAdmin) {
      throw new Error('Credenciais do Supabase ausentes.');
    }

    const { error } = await supabaseAdmin
      .from('logs_auditoria')
      .insert([{
        usuario_nome: payload.usuario_nome.toUpperCase().trim(),
        acao: payload.acao.toUpperCase().trim(),
        setor: payload.setor.toUpperCase().trim(),
        equipamento_id: payload.equipamento_id || null,
        equipamento_nome: payload.equipamento_nome || null,
        data_hora: new Date().toISOString() 
      }]);

    if (error) {
      console.error("Erro no Supabase ao gravar a auditoria:", error.message);
      throw error;
    }

    return { success: true };
  } catch (error: any) {
    console.error("Falha crítica ao tentar gravar o log de auditoria:", error.message);
    return { success: false, message: error.message };
  }
}

// ============================================================================
// 3. VERIFICAÇÃO SEGURA DE SENHA DO PORTAL DE DOWNLOADS
// ============================================================================
export async function verificarSenhaDownloads(senhaDigitada: string) {
  const senhaCorreta = process.env.DOWNLOADS_PASSWORD;

  if (!senhaCorreta) {
    console.error("Erro: A variável DOWNLOADS_PASSWORD não está configurada no servidor.");
    return { success: false, message: "O acesso não foi configurado corretamente no servidor." };
  }

  if (senhaDigitada === senhaCorreta) {
    return { success: true };
  }

  return { success: false, message: "Senha incorreta. Tente novamente." };
}