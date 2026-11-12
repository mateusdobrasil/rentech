'use server';

// app/login/actions.ts
// "Esqueci minha senha" do /login (equipe do admin) — tour de melhorias
// 2026-11-11, item 5. Mesmo esquema do plano B do 2FA (app/admin/actions-mfa.ts):
//   1. a pessoa digita o e-mail do login e recebe um código de 6 dígitos
//      (10 min) pelo nosso SMTP;
//   2. digita o código + a senha nova; o servidor confere e troca a senha
//      (auth.admin.updateUserById).
// Não usa o resetPasswordForEmail do Supabase: aquele depende de URL de
// retorno configurada no painel e do envio padrão deles (poucos por hora).
// O 2FA continua valendo depois da troca — e por 24h o plano B do 2FA por
// e-mail fica bloqueado pra conta (ver senhaTrocadaPorEmailRecente em
// app/admin/actions-mfa.ts), senão quem tivesse só a caixa de e-mail entraria
// em tudo.
// Tabela: .sql/Pendentes/acesso_senha_codigos_email.sql
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { enviarEmailSistema, mascararEmail } from '../lib/emailSistema';
import { enviarCodigoAcessoWhatsApp } from '../lib/codigoWhatsapp';
import { registrarLogAuditoria } from '../actions';

type Resultado = { ok: boolean; erro?: string; info?: any };

const VALIDADE_CODIGO_MIN = 10;
const MAX_TENTATIVAS = 5;
const MAX_CODIGOS_15MIN = 3;
const ESPERA_REENVIO_S = 60;
const SENHA_MIN = 8;
const TABELA = 'acesso_senha_codigos_email';

const segredo = () => process.env.MFA_CODIGO_SEGREDO || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// Prefixo diferente do código do 2FA: um hash nunca vale pro outro fluxo
const hashCodigo = (userId: string, codigo: string) => createHmac('sha256', segredo()).update(`senha:${userId}:${codigo}`).digest('hex');

// Mesma resposta exista ou não o e-mail — o formulário não pode servir pra
// descobrir quem tem conta no sistema.
const MSG_GENERICA = 'Se este e-mail tiver acesso ao sistema, enviamos um código para ele. Confira também a caixa de spam.';
const MSG_CODIGO_INVALIDO = 'Código inválido ou expirado. Peça um novo.';

const normalizarEmail = (email: string) => String(email || '').trim().toLowerCase();

// Conta da equipe pelo e-mail. Só perfis ativos; contas do Portal do
// Funcionário (e-mail sintético) não têm perfil e ficam de fora sozinhas.
async function contaPorEmail(email: string): Promise<{ id: string; nome: string; email: string; funcionarioId: string | null } | null> {
  const alvo = normalizarEmail(email);
  if (!alvo || !alvo.includes('@')) return null;
  const { data } = await supabaseAdmin().from('perfis_usuarios').select('id, nome, email, ativo, funcionario_id').eq('ativo', true);
  const perfil = (data || []).find(p => normalizarEmail(p.email) === alvo);
  return perfil ? { id: perfil.id, nome: perfil.nome || alvo, email: alvo, funcionarioId: perfil.funcionario_id || null } : null;
}

// Canal WhatsApp: celular da ficha do colaborador vinculado ao usuário
// (Permissões → Colaboradores). Mesma resposta genérica — não revela se a conta
// existe nem se tem celular.
const MSG_GENERICA_WHATSAPP = 'Se este e-mail tiver acesso ao sistema e um celular vinculado, enviamos o código pelo WhatsApp. Não chegou? Volte e escolha receber por e-mail.';
const TEXTO_WHATSAPP = 'Seu código para redefinir a senha do Sistema Rentech é {{codigo}}. Válido por 10 minutos. Não compartilhe este código — se não foi você que pediu, avise o Administrador.';

export async function solicitarCodigoSenhaAction(payload: { email: string; canal?: 'EMAIL' | 'WHATSAPP' }): Promise<Resultado> {
  const email = normalizarEmail(payload.email);
  if (!email.includes('@')) return { ok: false, erro: 'Digite o e-mail do seu login.' };
  const porWhatsapp = payload.canal === 'WHATSAPP';
  const msgGenerica = porWhatsapp ? MSG_GENERICA_WHATSAPP : MSG_GENERICA;

  const db = supabaseAdmin();
  try {
    const conta = await contaPorEmail(email);
    if (!conta) return { ok: true, info: { mensagem: msgGenerica } };

    let destinoWhatsapp: { celular: string; empresaId: number | null } | null = null;
    if (porWhatsapp) {
      if (!conta.funcionarioId) return { ok: true, info: { mensagem: msgGenerica } };
      const { data: ficha } = await db.from('folha_funcionarios').select('celular, empresa_id').eq('id', conta.funcionarioId).maybeSingle();
      if (!ficha?.celular) return { ok: true, info: { mensagem: msgGenerica } };
      destinoWhatsapp = { celular: ficha.celular, empresaId: ficha.empresa_id ?? null };
    }

    const desde = new Date(Date.now() - 15 * 60000).toISOString();
    const { data: recentes, error: erroLeitura } = await db.from(TABELA)
      .select('criado_em').eq('user_id', conta.id).gte('criado_em', desde).order('criado_em', { ascending: false });
    if (erroLeitura) throw new Error(erroLeitura.message);
    // Os limites só aparecem pra conta que existe — mas aí quem pediu é, em
    // geral, o dono, e sem eles o formulário viraria uma metralhadora de e-mail.
    if ((recentes || []).length >= MAX_CODIGOS_15MIN) {
      return { ok: false, erro: 'Muitos códigos pedidos. Aguarde 15 minutos e tente de novo.' };
    }
    const ultimo = recentes?.[0]?.criado_em;
    if (ultimo && Date.now() - new Date(ultimo).getTime() < ESPERA_REENVIO_S * 1000) {
      return { ok: false, erro: 'Aguarde um minuto antes de pedir outro código.' };
    }

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const agora = new Date().toISOString();
    // Código novo invalida os anteriores ainda não usados
    await db.from(TABELA).update({ expira_em: agora }).eq('user_id', conta.id).is('usado_em', null).gt('expira_em', agora);
    const { error } = await db.from(TABELA).insert({
      user_id: conta.id,
      codigo_hash: hashCodigo(conta.id, codigo),
      expira_em: new Date(Date.now() + VALIDADE_CODIGO_MIN * 60000).toISOString(),
    });
    if (error) throw new Error(error.message);

    if (destinoWhatsapp) {
      const envio = await enviarCodigoAcessoWhatsApp(destinoWhatsapp.celular, codigo, destinoWhatsapp.empresaId, TEXTO_WHATSAPP);
      if (!envio.ok) throw new Error(envio.erro || 'falha no envio pelo WhatsApp');
      registrarLogAuditoria({ usuario_nome: conta.nome, acao: 'SENHA: CÓDIGO DE REDEFINIÇÃO ENVIADO POR WHATSAPP', setor: 'ACESSO', equipamento_nome: mascararEmail(conta.email) });
      return { ok: true, info: { mensagem: msgGenerica } };
    }

    await enviarEmailSistema(conta.email, `Redefinir senha — código ${codigo}`,
      `Olá, ${conta.nome}.\n\n` +
      `Seu código para redefinir a senha do Sistema Rentech é: ${codigo}\n\n` +
      `Ele vale por ${VALIDADE_CODIGO_MIN} minutos. Digite-o na tela de login, junto com a senha nova.\n\n` +
      `Se não foi você que pediu, ignore este e-mail — sua senha continua a mesma — e avise o Administrador.`);

    registrarLogAuditoria({ usuario_nome: conta.nome, acao: 'SENHA: CÓDIGO DE REDEFINIÇÃO ENVIADO POR E-MAIL', setor: 'ACESSO', equipamento_nome: mascararEmail(conta.email) });
    return { ok: true, info: { mensagem: msgGenerica } };
  } catch (e: any) {
    console.error('[Esqueci minha senha] Falha ao enviar código:', e.message);
    return { ok: false, erro: 'Não foi possível enviar o código agora. Tente de novo em alguns minutos.' };
  }
}

export async function redefinirSenhaComCodigoAction(payload: { email: string; codigo: string; novaSenha: string }): Promise<Resultado> {
  const codigo = String(payload.codigo || '').replace(/\D/g, '');
  const novaSenha = String(payload.novaSenha || '');
  if (codigo.length !== 6) return { ok: false, erro: 'Digite os 6 números do código.' };
  if (novaSenha.length < SENHA_MIN) return { ok: false, erro: `A senha nova precisa ter pelo menos ${SENHA_MIN} caracteres.` };

  const db = supabaseAdmin();
  try {
    const conta = await contaPorEmail(payload.email);
    if (!conta) return { ok: false, erro: MSG_CODIGO_INVALIDO };

    const { data: linha } = await db.from(TABELA)
      .select('id, codigo_hash, tentativas')
      .eq('user_id', conta.id).is('usado_em', null).gt('expira_em', new Date().toISOString())
      .order('criado_em', { ascending: false }).limit(1).maybeSingle();
    if (!linha) return { ok: false, erro: MSG_CODIGO_INVALIDO };
    if (linha.tentativas >= MAX_TENTATIVAS) {
      await db.from(TABELA).update({ expira_em: new Date().toISOString() }).eq('id', linha.id);
      return { ok: false, erro: 'Tentativas demais com este código. Peça um novo.' };
    }

    const esperado = Buffer.from(linha.codigo_hash, 'hex');
    const recebido = Buffer.from(hashCodigo(conta.id, codigo), 'hex');
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
      await db.from(TABELA).update({ tentativas: linha.tentativas + 1 }).eq('id', linha.id);
      return { ok: false, erro: 'Código incorreto. Confira e tente de novo.' };
    }

    const { error: erroSenha } = await db.auth.admin.updateUserById(conta.id, { password: novaSenha });
    if (erroSenha) {
      const fraca = /weak|pwned|leaked|characters|password/i.test(erroSenha.message);
      return { ok: false, erro: fraca ? 'O sistema recusou essa senha (fraca ou conhecida em vazamentos). Escolha outra.' : erroSenha.message };
    }
    await db.from(TABELA).update({ usado_em: new Date().toISOString() }).eq('id', linha.id);

    registrarLogAuditoria({ usuario_nome: conta.nome, acao: 'SENHA REDEFINIDA POR CÓDIGO DE E-MAIL', setor: 'ACESSO', equipamento_nome: mascararEmail(conta.email) });
    // Aviso de troca — se não foi a pessoa, ela fica sabendo
    enviarEmailSistema(conta.email, 'Sua senha foi alterada',
      `A senha do Sistema Rentech da conta ${conta.email} foi alterada agora (${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}) pela opção "Esqueci minha senha".\n\n` +
      `Se não foi você, avise o Administrador imediatamente.`).catch(() => {});
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
