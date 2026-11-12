"use server";

// app/portal/actions/actions-acesso.ts
// Cadastro/login do Portal do Funcionário. Fluxo: CPF -> código por WhatsApp
// (2º fator, já que CPF sozinho não é segredo) -> definição de senha -> conta
// criada em auth.users + vínculo em portal_funcionarios_auth.
//
// Identidade do portal é mantida SEPARADA de perfis_usuarios/parametros_paginas_permissoes
// (sistema de permissões do admin) de propósito: um bug aqui nunca deve virar
// acesso administrativo.
import crypto from 'crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { enviarCodigoAcessoWhatsApp } from '../../lib/codigoWhatsapp';
import { somenteDigitos, cpfValido, emailSinteticoPortal } from '../lib/cpf';
import { registrarLogAuditoria } from '../../actions';

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


// ============================================================================
// PASSO 1 — Solicitar acesso: recebe o CPF, valida contra folha_funcionarios
// (ativo=true, sem vínculo de portal ainda) e dispara o código por WhatsApp.
// ============================================================================
export async function solicitarAcessoAction(payload: { cpf: string }): Promise<Resultado> {
  return enviarCodigoPorCpf(payload.cpf, 'PRIMEIRO_ACESSO');
}

// "Esqueci minha senha" do portal (tour de melhorias 2026-11-11, item 5):
// mesmo código por WhatsApp, só que pra quem JÁ tem acesso. O e-mail do
// login do portal é sintético (emailSinteticoPortal), então o e-mail de
// recuperação do Supabase não chegaria a ninguém.
export async function solicitarRedefinicaoSenhaAction(payload: { cpf: string }): Promise<Resultado> {
  return enviarCodigoPorCpf(payload.cpf, 'REDEFINIR_SENHA');
}

// PRIMEIRO_ACESSO só envia pra quem ainda não tem conta; REDEFINIR_SENHA só
// pra quem já tem. Resposta sempre genérica nos dois casos.
async function enviarCodigoPorCpf(cpfBruto: string, finalidade: 'PRIMEIRO_ACESSO' | 'REDEFINIR_SENHA'): Promise<Resultado> {
  const cpf = somenteDigitos(cpfBruto);
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
      .select('id, nome_completo, cpf, celular, empresa_id')
      .eq('ativo', true)
      .not('cpf', 'is', null);

    const funcionario = (candidatos || []).find(f => somenteDigitos(f.cpf || '') === cpf);

    if (funcionario?.celular) {
      const { data: jaTemAcesso } = await db
        .from('portal_funcionarios_auth')
        .select('id')
        .eq('funcionario_id', funcionario.id)
        .maybeSingle();

      if (finalidade === 'PRIMEIRO_ACESSO' ? !jaTemAcesso : !!jaTemAcesso) {
        const codigo = gerarCodigo();
        const expiraEm = new Date(Date.now() + VALIDADE_CODIGO_MIN * 60 * 1000).toISOString();

        await db.from('portal_acesso_otps').insert({
          cpf,
          funcionario_nome: funcionario.nome_completo,
          celular: funcionario.celular,
          codigo_hash: hashCodigo(codigo),
          expira_em: expiraEm,
        });

        await enviarCodigoAcessoWhatsApp(funcionario.celular, codigo, funcionario.empresa_id ?? null);
      }
    }

    // Resposta idêntica em todos os casos (CPF não encontrado, sem celular,
    // já tem / ainda não tem conta, ou código enviado com sucesso).
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
      .eq(otp.funcionario_id ? 'funcionario_id' : 'funcionario_nome', otp.funcionario_id || otp.funcionario_nome)
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
      ...(otp.funcionario_id ? { funcionario_id: otp.funcionario_id } : {}),
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
// ESQUECI MINHA SENHA — passo final: com o código do WhatsApp já conferido
// (verificarCodigoAction), troca a senha da conta existente.
// ============================================================================
export async function redefinirSenhaPortalAction(payload: { cpf: string; token: string; senha: string }): Promise<Resultado> {
  const cpf = somenteDigitos(payload.cpf);
  if ((payload.senha || '').length < 8) return { ok: false, erro: 'A senha precisa ter pelo menos 8 caracteres.' };
  if (!payload.token) return { ok: false, erro: 'Verificação expirada. Refaça o processo.' };

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
    if (!otp || new Date(otp.expira_em) < new Date()) return { ok: false, erro: 'Verificação expirada. Refaça o processo.' };

    const { data: vinculo } = await db
      .from('portal_funcionarios_auth')
      .select('auth_user_id')
      .eq(otp.funcionario_id ? 'funcionario_id' : 'funcionario_nome', otp.funcionario_id || otp.funcionario_nome)
      .maybeSingle();
    if (!vinculo?.auth_user_id) return { ok: false, erro: 'Você ainda não tem acesso ao portal. Use "Solicitar acesso".' };

    const { error } = await db.auth.admin.updateUserById(vinculo.auth_user_id, { password: payload.senha });
    if (error) {
      const fraca = /weak|pwned|leaked|characters|password/i.test(error.message);
      return { ok: false, erro: fraca ? 'Essa senha foi recusada (fraca ou conhecida em vazamentos). Escolha outra.' : error.message };
    }
    await db.from('portal_acesso_otps').update({ usado: true }).eq('id', otp.id);

    registrarLogAuditoria({ usuario_nome: otp.funcionario_nome, acao: 'PORTAL: SENHA REDEFINIDA POR CÓDIGO NO WHATSAPP', setor: 'PORTAL' });
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
  // ID da ficha (folha_funcionarios.id) — identidade estável: as funções do
  // portal filtram por ele (app/lib/funcionarioRef.ts). O nome vem da ficha
  // atual, só pra exibição/registros de texto.
  funcionarioId: string | null;
  funcionarioNome: string;
}

export async function resolverFuncionarioPortal(accessToken: string): Promise<FuncionarioPortal | null> {
  if (!accessToken) return null;
  const db = supabaseAdmin();

  const { data: userData, error: userError } = await db.auth.getUser(accessToken);
  if (userError || !userData?.user) return null;

  const { data: vinculo, error: vinculoError } = await db
    .from('portal_funcionarios_auth')
    .select('funcionario_nome, funcionario_id')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (vinculoError || !vinculo) return null;

  // Pelo ID do vínculo, o nome vem da ficha ATUAL (se o RH corrigiu o nome,
  // o portal já enxerga o novo, sem depender de nada mais).
  if (vinculo.funcionario_id) {
    const { data: ficha } = await db.from('folha_funcionarios').select('nome_completo').eq('id', vinculo.funcionario_id).maybeSingle();
    return { authUserId: userData.user.id, funcionarioId: vinculo.funcionario_id, funcionarioNome: ficha?.nome_completo || vinculo.funcionario_nome };
  }
  return { authUserId: userData.user.id, funcionarioId: null, funcionarioNome: vinculo.funcionario_nome };
}
