"use server";

// app/portal/actions/actions-acesso.ts
// Cadastro/login do Portal do Funcionário. Fluxo: CPF -> código por WhatsApp
// (2º fator, já que CPF sozinho não é segredo) -> definição de senha -> conta
// criada em auth.users + vínculo em portal_funcionarios_auth.
//
// Identidade do portal é mantida SEPARADA de perfis_usuarios/folha_paginas_permissoes
// (sistema de permissões do admin) de propósito: um bug aqui nunca deve virar
// acesso administrativo.
import crypto from 'crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { resolverProvedorAutomacao, enviarComJanela, type ProvedorAutomacao, type TemplateMeta } from '../../lib/whatsapp';
import { somenteDigitos, cpfValido, emailSinteticoPortal } from '../lib/cpf';

type Resultado = { ok: boolean; erro?: string; info?: any };

const VALIDADE_CODIGO_MIN = 10;
const COOLDOWN_REENVIO_SEG = 60;
const MAX_TENTATIVAS = 5;

const hashCodigo = (codigo: string) => crypto.createHash('sha256').update(codigo).digest('hex');
const gerarCodigo = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const gerarToken = () => crypto.randomBytes(24).toString('hex');

// Mensagem sempre igual, exista ou não o CPF na base — evita que o endpoint
// sirva pra descobrir se um CPF é ou não de um funcionário da empresa.
const MSG_GENERICA = 'Se os dados informados estiverem corretos, um código de verificação foi enviado por WhatsApp para o celular já cadastrado.';

// Card correspondente em /admin/agendamentos — crie uma automação WEBHOOK
// chamada exatamente "Portal Acesso OTP" (o `chave` abaixo é gerado por slug
// do nome) pra poder escolher o provedor (Z-API/Meta) e, depois de aprovado,
// o Template de Autenticação da Meta, sem precisar mexer em código.
const CHAVE_AUTOMACAO_OTP = 'portal-acesso-otp';
const MENSAGEM_PADRAO_OTP = 'RENTECH: seu código de acesso ao Portal do Funcionário é {{codigo}}. Válido por 10 minutos. Não compartilhe este código.';

interface ConfigAutomacaoOtp {
  ativo: boolean;
  mensagem: string | null;
  provedor_whatsapp: 'PADRAO' | 'ZAPI' | 'META';
  meta_template_nome: string | null;
  meta_template_idioma: string | null;
  meta_template_variaveis: string[] | null;
}

// ============================================================================
// ENVIO DO CÓDIGO — configuração (provedor Z-API/Meta + Template de Autenticação
// da Meta, quando aprovado) vem do card "Portal Acesso OTP" em
// /admin/agendamentos (tabela folha_automacoes), igual a qualquer outra
// automação de WhatsApp do sistema. Sem o card criado ainda, cai no padrão
// (provedor PADRAO + mensagem de texto livre abaixo) — nada quebra.
// ============================================================================
async function enviarCodigoAcessoWhatsApp(celular: string, codigo: string): Promise<{ ok: boolean; erro?: string }> {
  const db = supabaseAdmin();
  const { data: automacao } = await db
    .from('folha_automacoes')
    .select('ativo, mensagem, provedor_whatsapp, meta_template_nome, meta_template_idioma, meta_template_variaveis')
    .eq('chave', CHAVE_AUTOMACAO_OTP)
    .maybeSingle<ConfigAutomacaoOtp>();

  if (automacao && automacao.ativo === false) {
    return { ok: false, erro: 'Envio de código por WhatsApp está temporariamente desativado. Tente novamente mais tarde.' };
  }

  const vars: Record<string, string> = { codigo };
  const texto = (automacao?.mensagem || MENSAGEM_PADRAO_OTP).replace(/\{\{(\w+)\}\}/g, (m, chave) => vars[chave] ?? m);

  const provedor = await resolverProvedorAutomacao((automacao?.provedor_whatsapp as ProvedorAutomacao) || 'PADRAO');

  const nomesVariaveis = automacao?.meta_template_variaveis?.length ? automacao.meta_template_variaveis : ['codigo'];
  const templateMeta: TemplateMeta | null = automacao?.meta_template_nome ? {
    nome: automacao.meta_template_nome,
    idioma: automacao.meta_template_idioma || 'pt_BR',
    parametros: nomesVariaveis.map(v => vars[v] ?? ''),
    // O template de Autenticação aprovado tem botão "Copiar código" —
    // precisa do mesmo código também como parâmetro do botão (ver
    // enviarWhatsAppMetaTemplate em app/lib/metaWhatsapp.ts).
    botaoCodigo: codigo,
  } : null;

  const res = await enviarComJanela(provedor, celular, texto, templateMeta);
  // A resposta pro cliente (solicitarAcessoAction) é sempre genérica de propósito
  // (anti-enumeração de CPF) — sem isto aqui, uma falha de envio (credencial
  // errada, template rejeitado pela Meta etc.) fica invisível pra sempre.
  // Confira os logs do servidor se o código não chegar no teste.
  if (!res.ok) console.error(`[Portal OTP] Falha ao enviar código via ${provedor}:`, res.erro);
  return res;
}

// ============================================================================
// PASSO 1 — Solicitar acesso: recebe o CPF, valida contra folha_funcionarios
// (ativo=true, sem vínculo de portal ainda) e dispara o código por WhatsApp.
// ============================================================================
export async function solicitarAcessoAction(payload: { cpf: string }): Promise<Resultado> {
  const cpf = somenteDigitos(payload.cpf);
  if (!cpfValido(cpf)) return { ok: false, erro: 'CPF inválido. Confira os números digitados.' };

  const db = supabaseAdmin();

  try {
    // Throttle: não deixa pedir um novo código antes do cooldown, por CPF.
    const { data: recente } = await db
      .from('portal_acesso_otps')
      .select('criado_em')
      .eq('cpf', cpf)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recente?.criado_em) {
      const segundosDesde = (Date.now() - new Date(recente.criado_em).getTime()) / 1000;
      if (segundosDesde < COOLDOWN_REENVIO_SEG) {
        const restante = Math.ceil(COOLDOWN_REENVIO_SEG - segundosDesde);
        return { ok: false, erro: `Aguarde ${restante}s antes de solicitar um novo código.` };
      }
    }

    // Compara dígitos, já que o CPF em folha_funcionarios é texto livre (sem
    // formatação garantida) e não há índice funcional para buscar direto.
    const { data: candidatos } = await db
      .from('folha_funcionarios')
      .select('nome_completo, cpf, celular')
      .eq('ativo', true)
      .not('cpf', 'is', null);

    const funcionario = (candidatos || []).find(f => somenteDigitos(f.cpf || '') === cpf);

    if (funcionario?.celular) {
      const { data: jaTemAcesso } = await db
        .from('portal_funcionarios_auth')
        .select('id')
        .eq('funcionario_nome', funcionario.nome_completo)
        .maybeSingle();

      if (!jaTemAcesso) {
        const codigo = gerarCodigo();
        const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MIN * 60 * 1000).toISOString();

        await db.from('portal_acesso_otps').insert({
          cpf,
          funcionario_nome: funcionario.nome_completo,
          celular: funcionario.celular,
          codigo_hash: hashCodigo(codigo),
          expira_em: expiraEm,
        });

        await enviarCodigoAcessoWhatsApp(funcionario.celular, codigo);
      }
    }

    // Resposta idêntica em todos os casos (CPF não encontrado, sem celular,
    // já tem conta, ou código enviado com sucesso).
    return { ok: true, info: { mensagem: MSG_GENERICA } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PASSO 2 — Verificar o código recebido por WhatsApp.
// ============================================================================
export async function verificarCodigoAction(payload: { cpf: string; codigo: string }): Promise<Resultado> {
  const cpf = somenteDigitos(payload.cpf);
  const codigo = somenteDigitos(payload.codigo);
  const db = supabaseAdmin();

  try {
    const { data: otp } = await db
      .from('portal_acesso_otps')
      .select('*')
      .eq('cpf', cpf)
      .eq('usado', false)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) return { ok: false, erro: 'Código inválido ou expirado. Solicite um novo.' };
    if (new Date(otp.expira_em) < new Date()) return { ok: false, erro: 'Código expirado. Solicite um novo.' };
    if (otp.tentativas >= MAX_TENTATIVAS) {
      await db.from('portal_acesso_otps').update({ usado: true }).eq('id', otp.id);
      return { ok: false, erro: 'Número máximo de tentativas excedido. Solicite um novo código.' };
    }

    if (hashCodigo(codigo) !== otp.codigo_hash) {
      await db.from('portal_acesso_otps').update({ tentativas: otp.tentativas + 1 }).eq('id', otp.id);
      return { ok: false, erro: 'Código incorreto.' };
    }

    const token = gerarToken();
    await db.from('portal_acesso_otps').update({
      verificado_em: new Date().toISOString(),
      token_verificacao: token,
    }).eq('id', otp.id);

    return { ok: true, info: { token } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// PASSO 3 — Definir senha e criar a conta.
// ============================================================================
export async function criarContaAction(payload: { cpf: string; token: string; senha: string }): Promise<Resultado> {
  const cpf = somenteDigitos(payload.cpf);
  if ((payload.senha || '').length < 8) return { ok: false, erro: 'A senha precisa ter pelo menos 8 caracteres.' };

  const db = supabaseAdmin();

  try {
    const { data: otp } = await db
      .from('portal_acesso_otps')
      .select('*')
      .eq('cpf', cpf)
      .eq('token_verificacao', payload.token)
      .eq('usado', false)
      .not('verificado_em', 'is', null)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) return { ok: false, erro: 'Verificação expirada. Refaça o processo de acesso.' };
    if (new Date(otp.expira_em) < new Date()) return { ok: false, erro: 'Verificação expirada. Refaça o processo de acesso.' };

    const { data: jaTemAcesso } = await db
      .from('portal_funcionarios_auth')
      .select('id')
      .eq('funcionario_nome', otp.funcionario_nome)
      .maybeSingle();
    if (jaTemAcesso) return { ok: false, erro: 'Este funcionário já possui acesso. Faça login.' };

    const { data: criado, error: authError } = await db.auth.admin.createUser({
      email: emailSinteticoPortal(cpf),
      password: payload.senha,
      email_confirm: true,
      user_metadata: { cpf, funcionario_nome: otp.funcionario_nome, tipo: 'PORTAL_FUNCIONARIO' },
    });
    if (authError || !criado?.user) return { ok: false, erro: authError?.message || 'Falha ao criar o acesso.' };

    const { error: vinculoError } = await db.from('portal_funcionarios_auth').insert({
      auth_user_id: criado.user.id,
      funcionario_nome: otp.funcionario_nome,
      cpf,
    });
    if (vinculoError) {
      await db.auth.admin.deleteUser(criado.user.id);
      return { ok: false, erro: vinculoError.message };
    }

    await db.from('portal_acesso_otps').update({ usado: true }).eq('id', otp.id);

    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// Resolve a identidade do funcionário logado a partir do access_token da
// sessão Supabase — NUNCA a partir de um nome/id vindo do cliente. Usado por
// toda Server Action do portal que devolve dados pessoais (documentos, etc).
// ============================================================================
export interface FuncionarioPortal {
  authUserId: string;
  funcionarioNome: string;
}

export async function resolverFuncionarioPortal(accessToken: string): Promise<FuncionarioPortal | null> {
  if (!accessToken) return null;
  const db = supabaseAdmin();

  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  const { data: vinculo, error: vinculoError } = await db
    .from('portal_funcionarios_auth')
    .select('funcionario_nome')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (vinculoError || !vinculo) return null;

  return { authUserId: userData.user.id, funcionarioNome: vinculo.funcionario_nome };
}
