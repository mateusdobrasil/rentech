"use server";

import { createClient } from '@supabase/supabase-js';
import { registrarLogAuditoria } from '../../actions';
import { revalidatePath } from 'next/cache';
import nodemailer from 'nodemailer';
import { dispararAutomacoesPorEventoWhatsApp } from '../../lib/automacoes';
import { notificarPush } from '../../lib/push';
import { normalizarPermissao, ehAltaGestaoOP } from '../../lib/permissoes';
import { obterEmpresasPermitidas, empresaPermitida } from '../../lib/serverAuth';
import { gerarHtmlEmailOP } from './emailTemplate';
import { ItemOPNormalizado, validarNovaOP, validarItensOP } from './utils';
import { criarContaPagarParaOP } from '../financeiro/ops/enviarOpP2sCore';

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
  // Rentech × AlfaLight — a quem esta OP pertence. Escolhida na tela (trava
  // sozinha se o usuário só tiver acesso a uma empresa), mas revalidada aqui
  // no servidor contra perfis_usuarios_empresas antes de gravar.
  empresa_id: number | null;
  empresa_recebedora: string;
  cnpj_cpf_recebedora: string;
  endereco_recebedora: string;
  // Celular do signatário (E.164 ou BR cru) — obrigatório: é o canal usado
  // pela Autentique para enviar o recibo para assinatura via WhatsApp.
  telefone_recebedora: string;
  // CPF de quem vai assinar o recibo — obrigatório mesmo quando o favorecido
  // é PJ (cnpj_cpf_recebedora pode ser um CNPJ), pois a Autentique valida o
  // signatário por CPF, nunca por CNPJ.
  cpf_signatario: string;
  tipo_pagamento: string;
  chave_pix: string;
  dados_pagamento: string;
  itens: ItemOPNormalizado[];
  total_geral: number;
  data_vencimento: string; // YYYY-MM-DD
  observacao: string;
  file_url: string;
  // Anexos podem ser mais de um comprovante (NF + recibo + PIX, por exemplo).
  // file_url continua guardando o primeiro, por compatibilidade com telas que
  // ainda só mostram um único link (e-mail, painel financeiro).
  file_urls?: string[];
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

export async function obterPerfilValidado(accessToken: string): Promise<PerfilValidado | null> {
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

export async function possuiAcessoRota(permissaoNormalizada: string, rota: string): Promise<boolean> {
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

  // A empresa escolhida na tela precisa estar entre as que o usuário
  // realmente pode enxergar (resolvido aqui no servidor via
  // perfis_usuarios_empresas) — nunca confiar cegamente no que o cliente
  // mandou, senão um usuário só-Rentech poderia gravar uma OP como AlfaLight
  // manipulando a chamada direta.
  const empresasPermitidas = await obterEmpresasPermitidas(perfil.id, perfil.permissaoNormalizada);
  if (!empresaPermitida(empresasPermitidas, data.empresa_id)) {
    return { success: false, message: 'Você não tem permissão para criar uma OP para esta empresa.' };
  }

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
      .from('op_ordens_pagamento')
      .insert([payload])
      .select('id, numero_op')
      .single();

    if (error) throw error;

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
      // "payload" é o objeto ANTES do insert — nunca teve id/numero_op (quem
      // gera isso é o banco). Sem mesclar novaOp aqui, o link de baixa do
      // e-mail saía como ".../api/baixar-op?id=undefined".
      await enviarEmailOPInterno({ ...payload, id: novaOp.id, numero_op: novaOp.numero_op }, payload.responsavel_email);
    } catch (emailError) {
      console.error("A OP foi criada, mas houve um erro no disparo do e-mail:", emailError);
    }

    // =========================================================
    // DISPARO AUTOMÁTICO DE WHATSAPP NA CRIAÇÃO
    // Respeita o toggle, os destinatários e o texto da mensagem de qualquer
    // automação cadastrada em Agendamentos e Disparos com evento de sistema
    // "Nova Ordem de Pagamento criada" — só passamos as variáveis do evento,
    // o template é 100% dela. Pode haver mais de uma (ex: uma pra Operacional
    // e outra pra Diretoria).
    // =========================================================
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      await dispararAutomacoesPorEventoWhatsApp('NOVA_OP', {
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

    // =========================================================
    // DISPARO AUTOMÁTICO DE PUSH (app mobile) NA CRIAÇÃO
    // Quem tem acesso a /admin/financeiro/ops (mesmo público que aprova pelo
    // app) recebe o aviso — nunca bloqueia a criação da OP.
    // =========================================================
    try {
      await notificarPush(
        '/mobile/op',
        'Nova OP aguardando pagamento',
        `OP #${novaOp.numero_op} — ${payload.empresa_recebedora} — ${Number(payload.total_geral || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
        { tipo: 'op', id: novaOp.id }
      );
    } catch (pushError) {
      console.error("A OP foi criada, mas houve um erro no disparo do push:", pushError);
    }

    // =========================================================
    // DISPARO AUTOMÁTICO PARA O PRIMESTART NA CRIAÇÃO
    // Cria a Conta a Pagar correspondente no ERP assim que a OP é salva —
    // decisão explícita do usuário em 2026-08-17 (antes só existia o botão
    // manual em /admin/financeiro/ops, pra dar controle antes de gravar no
    // ERP real; trocado pra eliminar a redigitação manual da OP lá). Se não
    // achar o fornecedor pelo CNPJ/CPF (nem local, nem ao vivo na API),
    // CADASTRA um Parceiro novo automaticamente — ver enviarOpP2sCore.ts. Se
    // isso falhar (ERP fora do ar, CNPJ/CPF ausente etc.), a OP continua
    // criada normalmente e o botão manual em /admin/financeiro/ops fica
    // disponível como fallback (p2s_conta_pagar_oid continua nulo).
    // =========================================================
    try {
      await criarContaPagarParaOP({ ...payload, id: novaOp.id, numero_op: novaOp.numero_op }, payload.responsavel_nome);
    } catch (p2sError) {
      console.error("A OP foi criada, mas houve um erro ao enviar pro PrimeStart:", p2sError);
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
export async function listarOPs(accessToken: string, rota: '/admin/op/responsavel' | '/admin/financeiro/ops') {
  const acesso = await validarAcesso(accessToken, rota);
  if (!acesso.ok) return { success: false, message: acesso.message, data: [] };
  const { perfil } = acesso;

  const verTodas = rota === '/admin/financeiro/ops' || ehAltaGestaoOP(perfil.permissaoBruta);

  try {
    let query = supabaseAdmin
      .from('op_ordens_pagamento')
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
  const acesso = await validarAcesso(accessToken, '/admin/financeiro/ops');
  if (!acesso.ok) return { success: false, message: acesso.message };
  const { perfil } = acesso;

  try {
    const { error } = await supabaseAdmin
      .from('op_ordens_pagamento')
      .update({ status: novoStatus, updated_at: new Date().toISOString() })
      .eq('id', opId);

    if (error) throw error;

    // Nome vem do perfil validado no servidor, não de texto livre enviado
    // pelo cliente.
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

// 3.1 Reprovar OP — para quando a OP foi criada mas não foi autorizada pelo
// Financeiro. Diferente de atualizarStatus (genérica), essa: só permite
// reprovar quem ainda está PENDENTE (uma OP já paga não pode ser "reprovada"
// depois — nesse caso o caminho é outro, fora do escopo daqui); guarda o
// motivo digitado anexado à observação da OP; e loga a ação com o texto
// correto (a genérica sempre grava "BAIXOU OP", mesmo pra outros status).
export async function reprovarOPAction(opId: string, motivo: string, accessToken: string) {
  const acesso = await validarAcesso(accessToken, '/admin/financeiro/ops');
  if (!acesso.ok) return { success: false, message: acesso.message };
  const { perfil } = acesso;

  try {
    const { data: op, error: buscaError } = await supabaseAdmin
      .from('op_ordens_pagamento')
      .select('status, observacao, os_numero')
      .eq('id', opId)
      .single();
    if (buscaError) throw buscaError;
    if (!op) return { success: false, message: 'OP não encontrada.' };
    if (op.status !== 'PENDENTE') return { success: false, message: `Só é possível reprovar uma OP pendente (status atual: ${op.status}).` };

    const notaReprovacao = `[REPROVADA em ${new Date().toLocaleString('pt-BR')} por ${perfil.nome}]${motivo ? `: ${motivo}` : ''}`;
    const observacaoAtualizada = [op.observacao, notaReprovacao].filter(Boolean).join('\n');

    const { error } = await supabaseAdmin
      .from('op_ordens_pagamento')
      .update({ status: 'REPROVADA', observacao: observacaoAtualizada, updated_at: new Date().toISOString() })
      .eq('id', opId);
    if (error) throw error;

    registrarLogAuditoria({
      usuario_nome: perfil.nome,
      acao: `REPROVOU OP${motivo ? ` — MOTIVO: ${motivo}` : ''}`,
      setor: 'OP',
      equipamento_id: opId,
      equipamento_nome: `OS ${op.os_numero || 'S/N'}`,
    });

    revalidatePath('/admin');
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// 3.2 Reabrir OP reprovada — desfaz uma reprovação feita por engano, volta
// pra PENDENTE. Só faz sentido a partir de REPROVADA (uma OP já paga segue
// o fluxo normal, não "reabre" por aqui).
export async function reabrirOPAction(opId: string, accessToken: string) {
  const acesso = await validarAcesso(accessToken, '/admin/financeiro/ops');
  if (!acesso.ok) return { success: false, message: acesso.message };
  const { perfil } = acesso;

  try {
    const { data: op, error: buscaError } = await supabaseAdmin
      .from('op_ordens_pagamento')
      .select('status, os_numero')
      .eq('id', opId)
      .single();
    if (buscaError) throw buscaError;
    if (!op) return { success: false, message: 'OP não encontrada.' };
    if (op.status !== 'REPROVADA') return { success: false, message: `Só é possível reabrir uma OP reprovada (status atual: ${op.status}).` };

    const { error } = await supabaseAdmin
      .from('op_ordens_pagamento')
      .update({ status: 'PENDENTE', updated_at: new Date().toISOString() })
      .eq('id', opId);
    if (error) throw error;

    registrarLogAuditoria({
      usuario_nome: perfil.nome,
      acao: 'REABRIU OP REPROVADA — VOLTOU PARA PENDENTE',
      setor: 'OP',
      equipamento_id: opId,
      equipamento_nome: `OS ${op.os_numero || 'S/N'}`,
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
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/financeiro/ops'),
  ]);
  if (!temResponsavel && !temFinanceiro) {
    return { success: false, message: 'Você não tem permissão para executar esta ação.' };
  }

  try {
    const { data: op, error } = await supabaseAdmin
      .from('op_ordens_pagamento')
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
        .from('op_ordens_pagamento')
        .select('responsavel_nome')
        .eq('id', opId)
        .single();

      if (opError) throw opError;
      if ((opAtual?.responsavel_nome || '').toUpperCase().trim() !== perfil.nome.toUpperCase().trim()) {
        return { success: false, message: 'Você não tem permissão para editar esta OP.' };
      }
    }

    const { error } = await supabaseAdmin
      .from('op_ordens_pagamento')
      .update({ ...dadosAtualizados, updated_at: new Date().toISOString() })
      .eq('id', opId);

    if (error) throw error;

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
    possuiAcessoRota(perfil.permissaoNormalizada, '/admin/financeiro/ops'),
  ]);
  if (!temResponsavel && !temFinanceiro) {
    return { success: false, message: 'Você não tem permissão para executar esta ação.' };
  }

  try {
    const { data: op, error } = await supabaseAdmin
      .from('op_ordens_pagamento')
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

// Assinatura das Ordens de Pagamento agora é feita via Autentique — ver
// app/admin/op/actions-assinatura.ts (envio, consulta e arquivamento do PDF
// assinado) e app/api/webhooks/autentique/route.ts (atualização de status).
