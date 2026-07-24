"use server";

import { createClient } from '@supabase/supabase-js';
import { registrarLogAuditoria } from '../../actions';
import { revalidatePath } from 'next/cache';
import nodemailer from 'nodemailer';
import { dispararAutomacaoWhatsApp } from '../../lib/automacoes';
import { normalizarPermissao, ehAltaGestaoOP } from '../../lib/permissoes';
import { gerarHtmlEmailOP } from './emailTemplate';
import { ItemOPNormalizado, validarNovaOP, validarItensOP } from './utils';

// ============================================================================
// CLIENTE ADMIN: IGNORA RLS PARA OPERAÇÕES DO SERVIDOR
// Certifique-se de que a variável SUPABASE_SERVICE_ROLE_KEY está no seu .env.local
// ============================================================================
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  // Nenhuma tela do módulo coleta este dado hoje — opcional para não fingir
  // uma obrigatoriedade que não existe no formulário.
  telefone_recebedora?: string;
  tipo_pagamento: string;
  chave_pix: string;
  dados_pagamento: string;
  itens: ItemOPNormalizado[];
  total_geral: number;
  data_vencimento: string; // YYYY-MM-DD
  observacao: string;
  file_url: string;
}

// ============================================================================
// VALIDAÇÃO DE SESSÃO E PERMISSÃO — SEMPRE NO SERVIDOR
// ----------------------------------------------------------------------------
// Antes, cada Server Action confiava cegamente em parâmetros vindos do cliente
// (nivelAcesso, usuarioAtual, usuarioAlteracao...) para decidir o que mostrar
// ou quem "fez" a ação. Como Server Actions são endpoints HTTP de verdade, dava
// para chamá-las diretamente pulando toda a checagem de permissão que só
// existia na tela (useEffect). Agora cada action abaixo recebe o access_token
// da sessão Supabase do chamador e revalida, aqui no servidor, contra a mesma
// tabela folha_paginas_permissoes que já controlava o acesso às páginas.
// ============================================================================
interface PerfilValidado {
  id: string;
  nome: string;
  email: string;
  permissaoBruta: string;
  permissaoNormalizada: string;
}

async function obterPerfilValidado(accessToken: string): Promise<PerfilValidado | null> {
  if (!accessToken) return null;

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  // select('*') de propósito: o resto do app nunca lista colunas específicas
  // aqui, e sim acessa perfil.permissao / perfil.nivel como propriedades
  // opcionais do objeto retornado. Nomear as colunas explicitamente quebra a
  // consulta inteira (erro do Postgrest) se alguma delas não existir na tabela
  // em algum ambiente — e como este é o único perfil de acesso usado por TODA
  // Server Action do módulo, isso derruba a leitura/gravação de OPs inteira
  // silenciosamente (a action só retorna { success: false }, sem aviso na UI).
  const { data: perfil, error: perfilError } = await supabaseAdmin
    .from('perfis_usuarios')
    .select('*')
    .eq('id', userData.user.id)
    .single();

  if (perfilError || !perfil) return null;

  const permissaoBruta = perfil.permissao || perfil.nivel || '';
  return {
    id: userData.user.id,
    nome: (perfil.nome || userData.user.email || 'Usuário') as string,
    email: (perfil.email || userData.user.email || '') as string,
    permissaoBruta,
    permissaoNormalizada: normalizarPermissao(permissaoBruta),
  };
}

async function possuiAcessoRota(permissaoNormalizada: string, rota: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('folha_paginas_permissoes')
    .select('permissoes_permitidas')
    .eq('endereco_route', rota)
    .single();

  return ((data?.permissoes_permitidas as string[]) || []).includes(permissaoNormalizada);
}

type ResultadoAcesso =
  | { ok: true; perfil: PerfilValidado }
  | { ok: false; message: string };

async function validarAcesso(accessToken: string, rota: string): Promise<ResultadoAcesso> {
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { ok: false, message: 'Sessão inválida ou expirada. Faça login novamente.' };

  const autorizado = await possuiAcessoRota(perfil.permissaoNormalizada, rota);
  if (!autorizado) return { ok: false, message: 'Você não tem permissão para executar esta ação.' };

  return { ok: true, perfil };
}

// 1. Criar Nova OP (exige acesso à rota /admin/op/nova)
export async function criarOP(data: NovaOPData, accessToken: string) {
  const acesso = await validarAcesso(accessToken, '/admin/op/nova');
  if (!acesso.ok) return { success: false, message: acesso.message };
  const { perfil } = acesso;

  // A validação no formulário (nova/page.tsx) já barra a maioria destes casos,
  // mas como a action é um endpoint HTTP de verdade, precisa revalidar aqui —
  // senão uma chamada direta, sem passar pela tela, grava OPs com itens vazios,
  // valores inválidos ou sem data de vencimento.
  const erroValidacao = validarNovaOP(data);
  if (erroValidacao) return { success: false, message: erroValidacao };

  try {
    // O solicitante vem sempre do perfil validado no servidor — nunca do que o
    // cliente mandar no payload — para impedir que alguém crie uma OP em nome
    // de outra pessoa manipulando a chamada.
    const payload: NovaOPData = {
      ...data,
      responsavel_nome: perfil.nome.toUpperCase(),
      responsavel_email: perfil.email,
      telefone_recebedora: data.telefone_recebedora || '',
    };

    const { data: novaOp, error } = await supabaseAdmin
      .from('ordens_pagamento')
      .insert([payload])
      .select('id, numero_op')
      .single();

    if (error) throw error;

    // Registra a criação no histórico de auditoria
    await supabaseAdmin.from('historico_op').insert([{
      op_id: novaOp.id,
      usuario_nome: payload.responsavel_nome,
      acao: 'CRIOU OP'
    }]);

    registrarLogAuditoria({
      usuario_nome: payload.responsavel_nome,
      acao: 'CRIOU OP',
      setor: 'OP',
      equipamento_id: novaOp.id,
      equipamento_nome: `OS ${payload.os_numero || 'S/N'} — ${payload.empresa_recebedora}`,
    });

    // =========================================================
    // DISPARO AUTOMÁTICO DE E-MAIL NA CRIAÇÃO
    // =========================================================
    try {
      await enviarEmailOPInterno(payload, payload.responsavel_email);
    } catch (emailError) {
      console.error("A OP foi criada, mas houve um erro no disparo do e-mail:", emailError);
    }

    // =========================================================
    // DISPARO AUTOMÁTICO DE WHATSAPP NA CRIAÇÃO
    // Respeita o toggle, os destinatários e o texto da mensagem configurados
    // na automação "Notificação de Nova OP" (Agendamentos e Disparos, chave
    // 'nova-op') — só passamos as variáveis do evento, o template é 100% dela.
    // =========================================================
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      await dispararAutomacaoWhatsApp('nova-op', {
        numero_op: novaOp.numero_op || novaOp.id,
        os_numero: payload.os_numero || 'S/N',
        solicitante: payload.responsavel_nome,
        favorecido: payload.empresa_recebedora,
        valor: Number(payload.total_geral || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        link: `${baseUrl}/api/baixar-op?id=${novaOp.id}`,
      });
    } catch (whatsappError) {
      console.error("A OP foi criada, mas houve um erro no disparo do WhatsApp:", whatsappError);
    }

    revalidatePath('/admin');
    return { success: true, id: novaOp.id };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 2. Listar OPs — a rota chamada define o que a página tem direito de ver.
// "Minhas OPs" (responsavel) só mostra tudo para cargos de alta gestão; os
// demais só veem as OPs que ELES MESMOS solicitaram, e esse "eles mesmos" vem
// do perfil validado no servidor — não de um parâmetro enviado pelo cliente.
export async function listarOPs(accessToken: string, rota: '/admin/op/responsavel' | '/admin/op/financeiro') {
  const acesso = await validarAcesso(accessToken, rota);
  if (!acesso.ok) return { success: false, message: acesso.message, data: [] };
  const { perfil } = acesso;

  const verTodas = rota === '/admin/op/financeiro' || ehAltaGestaoOP(perfil.permissaoBruta);

  try {
    let query = supabaseAdmin
      .from('ordens_pagamento')
      .select('*')
      .order('data_criacao', { ascending: false }); // Traz as mais recentes primeiro

    if (!verTodas) {
      query = query.ilike('responsavel_nome', perfil.nome);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error("Erro ao listar OPs:", error);
    return { success: false, message: error.message, data: [] };
  }
}

// 3. Atualizar Status (exclusivo do Painel Financeiro)
export async function atualizarStatus(opId: string, novoStatus: string, accessToken: string) {
  const acesso = await validarAcesso(accessToken, '/admin/op/financeiro');
  if (!acesso.ok) return { success: false, message: acesso.message };
  const { perfil } = acesso;

  try {
    const { error } = await supabaseAdmin
      .from('ordens_pagamento')
      .update({ status: novoStatus, updated_at: new Date().toISOString() })
      .eq('id', opId);

    if (error) throw error;

    // Salva na Caixa Preta / Histórico quem mexeu na OP (nome vem do perfil
    // validado no servidor, não de texto livre enviado pelo cliente)
    await supabaseAdmin.from('historico_op').insert([{
      op_id: opId,
      usuario_nome: perfil.nome,
      acao: `MUDOU STATUS PARA ${novoStatus}`
    }]);

    registrarLogAuditoria({
      usuario_nome: perfil.nome,
      acao: `BAIXOU OP — STATUS: ${novoStatus}`,
      setor: 'OP',
      equipamento_id: opId,
    });

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 4. Buscar OP Específica para Edição
export async function buscarOP(opId: string, accessToken: string) {
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { success: false, message: 'Sessão inválida ou expirada. Faça login novamente.' };

  const [temResponsavel, temFinanceiro] = await Promise.all([
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/op/responsavel'),
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/op/financeiro'),
  ]);
  if (!temResponsavel && !temFinanceiro) {
    return { success: false, message: 'Você não tem permissão para executar esta ação.' };
  }

  try {
    const { data: op, error } = await supabaseAdmin
      .from('ordens_pagamento')
      .select('*')
      .eq('id', opId)
      .single();

    if (error) throw error;

    const podeVerTudo = temFinanceiro || ehAltaGestaoOP(perfil.permissaoBruta);
    if (!podeVerTudo && (op.responsavel_nome || '').toUpperCase().trim() !== perfil.nome.toUpperCase().trim()) {
      return { success: false, message: 'Você não tem permissão para ver esta OP.' };
    }

    return { success: true, data: op };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 5. Atualizar Dados da OP (exclusivo da página "Minhas OPs")
export async function atualizarOP(opId: string, dadosAtualizados: Partial<NovaOPData>, accessToken: string) {
  const acesso = await validarAcesso(accessToken, '/admin/op/responsavel');
  if (!acesso.ok) return { success: false, message: acesso.message };
  const { perfil } = acesso;

  // Mesma lógica de validação de criarOP, mas só para os campos que de fato
  // vieram na atualização (a edição é parcial).
  if (dadosAtualizados.itens) {
    const erroItens = validarItensOP(dadosAtualizados.itens);
    if (erroItens) return { success: false, message: erroItens };
  }
  if (dadosAtualizados.data_vencimento !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dadosAtualizados.data_vencimento)) {
    return { success: false, message: 'Informe uma data de vencimento válida.' };
  }

  try {
    // Defesa em profundidade: mesmo a listagem já filtrando o que cada usuário
    // vê, revalidamos aqui que a OP pertence a ele antes de gravar (cargos de
    // alta gestão podem editar qualquer OP, como já podiam ver todas).
    if (!ehAltaGestaoOP(perfil.permissaoBruta)) {
      const { data: opAtual, error: opError } = await supabaseAdmin
        .from('ordens_pagamento')
        .select('responsavel_nome')
        .eq('id', opId)
        .single();

      if (opError) throw opError;
      if ((opAtual?.responsavel_nome || '').toUpperCase().trim() !== perfil.nome.toUpperCase().trim()) {
        return { success: false, message: 'Você não tem permissão para editar esta OP.' };
      }
    }

    const { error } = await supabaseAdmin
      .from('ordens_pagamento')
      .update({ ...dadosAtualizados, updated_at: new Date().toISOString() })
      .eq('id', opId);

    if (error) throw error;

    await supabaseAdmin.from('historico_op').insert([{
      op_id: opId,
      usuario_nome: perfil.nome,
      acao: 'EDITOU DADOS DA OP'
    }]);

    registrarLogAuditoria({
      usuario_nome: perfil.nome,
      acao: 'EDITOU OP',
      setor: 'OP',
      equipamento_id: opId,
    });

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ============================================================================
// DISPARO DE E-MAIL VIA SMTP COM MAGIC LINK E DATA TRATADA (PT-BR)
// ----------------------------------------------------------------------------
// enviarEmailOPInterno() faz o trabalho de fato e só é chamada a partir deste
// arquivo (por criarOP, já validado, e pela action pública abaixo) — não tem
// checagem de sessão própria porque não é, e não deve ser, exposta ao cliente.
// ============================================================================
async function enviarEmailOPInterno(op: any, emailSolicitante: string, apenasCopia: boolean = false) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // 1. Envio para o Solicitante (Sem o Botão)
    await transporter.sendMail({
      from: `"Sistema Rentech" <${process.env.SMTP_USER}>`,
      to: emailSolicitante,
      subject: apenasCopia ? `[Segunda Via] Cópia da OP - OS: ${op.os_numero || 'S/N'}` : `[Cópia] Sua OP foi enviada - OS: ${op.os_numero || 'S/N'}`,
      html: gerarHtmlEmailOP(op, false)
    });

    // 2. Envio para o Financeiro (COM o Botão)
    if (!apenasCopia) {
      await transporter.sendMail({
        from: `"Sistema Rentech" <${process.env.SMTP_USER}>`,
        to: process.env.FINANCEIRO_EMAIL || 'financeiro@locadorarentech.com.br',
        subject: `[APROVAÇÃO] Nova OP Recebida - OS: ${op.os_numero || 'S/N'}`,
        html: gerarHtmlEmailOP(op, true)
      });
    }

    return { success: true };

  } catch (error: any) {
    console.error("Erro crítico no envio de email via SMTP:", error);
    return { success: false, message: error.message || "Falha na conexão com o servidor de e-mail." };
  }
}

// Versão exposta como Server Action (usada pelos botões "Receber Cópia" e
// "Reenviar" nas páginas responsavel/financeiro). Exige um access_token válido,
// busca a OP direto do banco pelo id (nunca confia num objeto "op" vindo do
// cliente) e envia sempre para o e-mail do próprio usuário autenticado — nunca
// para um destinatário arbitrário informado na chamada — para que esta action
// não possa virar um "relay" de e-mails para terceiros.
export async function dispararEmailOP(opId: string, accessToken: string, apenasCopia: boolean = false) {
  const perfil = await obterPerfilValidado(accessToken);
  if (!perfil) return { success: false, message: 'Sessão inválida ou expirada. Faça login novamente.' };

  const [temResponsavel, temFinanceiro] = await Promise.all([
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/op/responsavel'),
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/op/financeiro'),
  ]);
  if (!temResponsavel && !temFinanceiro) {
    return { success: false, message: 'Você não tem permissão para executar esta ação.' };
  }

  try {
    const { data: op, error } = await supabaseAdmin
      .from('ordens_pagamento')
      .select('*')
      .eq('id', opId)
      .single();

    if (error) throw error;

    const podeVerTudo = temFinanceiro || ehAltaGestaoOP(perfil.permissaoBruta);
    if (!podeVerTudo && (op.responsavel_nome || '').toUpperCase().trim() !== perfil.nome.toUpperCase().trim()) {
      return { success: false, message: 'Você não tem permissão para ver esta OP.' };
    }

    if (!perfil.email) {
      return { success: false, message: 'Não foi possível identificar o seu e-mail cadastrado.' };
    }

    return await enviarEmailOPInterno(op, perfil.email, apenasCopia);
  } catch (error: any) {
    console.error("Erro ao localizar OP para envio de e-mail:", error);
    return { success: false, message: error.message };
  }
}

// Assinatura das Ordens de Pagamento
// ----------------------------------------------------------------------------
// Ao contrário das actions acima, esta é chamada por /recibo/[id] — uma página
// pública acessada pelo favorecido (freelancer/fornecedor) via link enviado no
// WhatsApp/e-mail, que nunca faz login no painel administrativo. Por isso não
// exige access_token: a "autorização" aqui é o próprio link/id da OP, e a ação
// (desenhar e confirmar a assinatura) exige um gesto explícito do usuário —
// diferente do problema corrigido em /api/baixar-op, que mudava o status só
// com uma requisição GET passiva.
export async function salvarAssinaturaRecibo(opId: string, assinaturaBase64: string, ip: string = '0.0.0.0') {
  try {
    // 1. Converter Base64 para Buffer (Ficheiro de Imagem)
    const base64Data = assinaturaBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    const fileName = `assinatura_${opId}_${Date.now()}.png`;

    // 2. Fazer Upload para o Supabase Storage (no bucket 'recibos_assinados')
    const { error: uploadError } = await supabaseAdmin.storage
      .from('recibos_assinados')
      .upload(fileName, buffer, {
        contentType: 'image/png',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // 3. Obter o Link Público da Assinatura
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('recibos_assinados')
      .getPublicUrl(fileName);

    const imageUrl = publicUrlData.publicUrl;

    // 4. Atualizar a OP no Banco de Dados
    const dataHoraAssinatura = new Date().toISOString();

    const { error: updateError } = await supabaseAdmin
      .from('ordens_pagamento')
      .update({
        recibo_url: imageUrl,
        data_assinatura: dataHoraAssinatura,
        status: 'PAGO E ASSINADO', // Muda o status automaticamente!
        updated_at: dataHoraAssinatura
      })
      .eq('id', opId);

    if (updateError) throw updateError;

    // 5. Registar na auditoria interna da OP
    await supabaseAdmin.from('historico_op').insert([{
      op_id: opId,
      usuario_nome: 'SISTEMA (AUTOMAÇÃO)',
      acao: `RECIBO ASSINADO DIGITALMENTE (IP: ${ip})`
    }]);

    revalidatePath('/admin');
    return { success: true, url: imageUrl };
  } catch (error: any) {
    console.error("Erro ao salvar assinatura:", error);
    return { success: false, message: error.message };
  }
}
