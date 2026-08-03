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

// ============================================================================
// 2.2 LISTAGEM DE COLABORADORES COM ACESSO AO PORTAL DO FUNCIONÁRIO
// ============================================================================
// Lê a tabela portal_funcionarios_auth com a service role: ela guarda a
// identidade do login do portal (separada de perfis_usuarios de propósito,
// ver app/portal/actions/actions-acesso.ts) e não libera SELECT para o
// cliente autenticado do admin. Enriquecemos com cargo/celular de
// folha_funcionarios só para exibição — o vínculo é sempre feito pelo nome.
export async function listarAcessosPortalAction() {
  try {
    if (!supabaseAdmin) {
      throw new Error('Credenciais do Supabase ausentes.');
    }

    const { data: acessos, error } = await supabaseAdmin
      .from('portal_funcionarios_auth')
      .select('*')
      .order('funcionario_nome');

    if (error) throw error;

    const nomes = (acessos || []).map((a: any) => a.funcionario_nome);
    const { data: funcionarios } = nomes.length
      ? await supabaseAdmin
          .from('folha_funcionarios')
          .select('nome_completo, cargo, celular, ativo')
          .in('nome_completo', nomes)
      : { data: [] };

    const mapaFuncionarios = new Map((funcionarios || []).map((f: any) => [f.nome_completo, f]));

    const lista = (acessos || []).map((a: any) => {
      const funcionario = mapaFuncionarios.get(a.funcionario_nome);
      return {
        id: a.id,
        funcionario_nome: a.funcionario_nome,
        cpf: a.cpf,
        criado_em: a.criado_em || a.created_at || null,
        cargo: funcionario?.cargo || null,
        celular: funcionario?.celular || null,
        funcionario_ativo: funcionario?.ativo ?? null,
      };
    });

    return { success: true, data: lista };
  } catch (error: any) {
    console.error('Falha ao listar acessos do Portal do Funcionário:', error.message);
    return { success: false, message: error.message, data: [] };
  }
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
// 3. SINCRONIZAÇÃO DE ESTOQUE "EM LOCAÇÃO" (Checklist de Carga/Retorno)
// ============================================================================
// Roda com a service role (bypassa RLS): a tabela `estoque` não libera INSERT
// para o cliente anônimo/autenticado, e o checklist precisa criar a linha de
// estoque na primeira vez que um equipamento sai (upsert), não só atualizar.
interface DeltaEstoqueLocacao {
  equipamento_id: string;
  delta: number;
}

export async function sincronizarEstoqueEmLocacao(deltas: DeltaEstoqueLocacao[]) {
  try {
    if (!supabaseAdmin) {
      throw new Error('Credenciais do Supabase ausentes.');
    }
    if (deltas.length === 0) {
      return { success: true, afetados: 0 };
    }

    const ids = deltas.map(d => d.equipamento_id);
    const { data: estoqueAtual, error: erroLeitura } = await supabaseAdmin
      .from('estoque')
      .select('equipamento_id, qtd_locacao')
      .in('equipamento_id', ids);

    if (erroLeitura) throw erroLeitura;

    const qtdAtualMapa = new Map(
      (estoqueAtual || []).map((e: { equipamento_id: string; qtd_locacao: number | null }) => [e.equipamento_id, e.qtd_locacao || 0])
    );

    const payload = deltas.map(d => ({
      equipamento_id: d.equipamento_id,
      qtd_locacao: Math.max(0, (qtdAtualMapa.get(d.equipamento_id) || 0) + d.delta),
      updated_at: new Date().toISOString(),
    }));

    const { error: erroUpsert } = await supabaseAdmin.from('estoque').upsert(payload, { onConflict: 'equipamento_id' });
    if (erroUpsert) throw erroUpsert;

    return { success: true, afetados: payload.length };
  } catch (error: any) {
    console.error("Falha ao sincronizar estoque em locação:", error.message);
    return { success: false, message: error.message };
  }
}

// Lê todos os registros de estoque. Roda com a service role pelo mesmo motivo das
// gravações acima: sem uma policy de SELECT liberada para `estoque`, o cliente
// autenticado do navegador recebe lista vazia em silêncio (sem erro) e a tela some
// com os valores, mesmo estando tudo salvo no banco.
export async function buscarEstoque() {
  try {
    if (!supabaseAdmin) {
      throw new Error('Credenciais do Supabase ausentes.');
    }

    const { data, error } = await supabaseAdmin.from('estoque').select('*');
    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error("Falha ao buscar estoque:", error.message);
    return { success: false, message: error.message, data: [] };
  }
}

// Grava (cria ou atualiza) o registro completo de estoque de um equipamento — usado
// pelo modal de edição manual em Estoque > Controle Estoque. Mesma razão da service
// role acima: pode ser a primeira vez que esse equipamento ganha uma linha em `estoque`.
interface RegistroEstoquePayload {
  equipamento_id: string;
  qtd_total: number;
  qtd_manutencao: number;
  qtd_locacao: number;
  localizacao: string | null;
  avarias: string | null;
}

export async function salvarRegistroEstoque(payload: RegistroEstoquePayload) {
  try {
    if (!supabaseAdmin) {
      throw new Error('Credenciais do Supabase ausentes.');
    }

    const { error } = await supabaseAdmin.from('estoque').upsert({
      ...payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'equipamento_id' });

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("Falha ao salvar registro de estoque:", error.message);
    return { success: false, message: error.message };
  }
}

// Cria/remove vínculos de acessórios (tabela `gatilhos_acessorios`, usada em
// Estoque > Acessórios e Acessórios/Categoria). Mesma razão da service role acima:
// sem uma policy de DELETE liberada para o cliente autenticado, a exclusão volta
// sem erro mas não apaga nenhuma linha — parece removido na tela, mas continua no banco.
interface VinculoAcessorioPayload {
  equipamento_alvo_id?: string | null;
  categoria_alvo_id?: string | null;
  acessorio_id?: string | null;
  acessorio_categoria_id?: string | null;
}

export async function criarVinculoAcessorio(payload: VinculoAcessorioPayload) {
  try {
    if (!supabaseAdmin) {
      throw new Error('Credenciais do Supabase ausentes.');
    }

    const { data, error } = await supabaseAdmin.from('gatilhos_acessorios').insert([payload]).select().single();
    if (error) throw error;

    return { success: true, data };
  } catch (error: any) {
    console.error("Falha ao criar vínculo de acessório:", error.message);
    return { success: false, message: error.message };
  }
}

export async function removerVinculoAcessorio(gatilhoId: string) {
  try {
    if (!supabaseAdmin) {
      throw new Error('Credenciais do Supabase ausentes.');
    }

    const { error } = await supabaseAdmin.from('gatilhos_acessorios').delete().eq('id', gatilhoId);
    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("Falha ao remover vínculo de acessório:", error.message);
    return { success: false, message: error.message };
  }
}

// ============================================================================
// 4. VERIFICAÇÃO SEGURA DE SENHA DO PORTAL DE DOWNLOADS
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