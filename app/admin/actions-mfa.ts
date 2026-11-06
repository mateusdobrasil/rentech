'use server';

// app/admin/actions-mfa.ts
// Plano B da Autenticação em Duas Etapas (2FA) — usado por ExigirMFA.tsx e por
// /admin/parametros/permissoes:
//   1. "Não estou com meu celular": código de 6 dígitos no e-mail do login,
//      válido por 10 min. Acertou → libera SÓ a sessão de login atual (claim
//      session_id do token) por até 12h, sem desligar o 2FA. O Supabase não
//      deixa um código nosso subir a sessão pra aal2, então a liberação fica
//      registrada no banco (acesso_mfa_codigos_email) e o ExigirMFA pergunta
//      aqui antes de pedir o código do autenticador.
//   2. Reset pelo Administrador: apaga o fator TOTP do usuário (quem perdeu
//      ou trocou de celular); no próximo acesso a uma página com 2FA ele
//      cadastra o celular novo em Minha Conta.
// Tabela: .sql/Pendentes/acesso_mfa_codigos_email.sql
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '../lib/supabase';
import { validarAcesso } from '../lib/serverAuth';
import { ehAdministradorGlobal } from '../lib/permissoes';
import { registrarLogAuditoria } from '../actions';

type Resultado = { ok: boolean; erro?: string; info?: any };

const VALIDADE_CODIGO_MIN = 10;
const LIBERACAO_HORAS = 12;
const MAX_TENTATIVAS = 5;
const MAX_CODIGOS_15MIN = 3;
const ESPERA_REENVIO_S = 60;

const segredo = () => process.env.MFA_CODIGO_SEGREDO || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hashCodigo = (userId: string, codigo: string) => createHmac('sha256', segredo()).update(`${userId}:${codigo}`).digest('hex');

const mascararEmail = (email: string) => {
  const [nome, dominio] = email.split('@');
  return `${nome.slice(0, 1)}${'*'.repeat(Math.max(1, nome.length - 1))}@${dominio}`;
};

// Usuário dono do token + a sessão de login dele (claim session_id do JWT,
// que muda a cada login). getUser valida o token antes de ler o claim.
async function usuarioESessao(accessToken: string) {
  if (!accessToken) return null;
  const db = supabaseAdmin();
  const { data, error } = await db.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  let sessaoId: string | null = null;
  try {
    sessaoId = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')).session_id || null;
  } catch { /* sem claim — trata como sem sessão */ }
  return { user: data.user, sessaoId };
}

async function enviarEmail(para: string, assunto: string, texto: string) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({ from: `"Sistema Rentech" <${process.env.SMTP_USER}>`, to: para, subject: assunto, text: texto });
}

export async function enviarCodigoMfaEmailAction(accessToken: string): Promise<Resultado> {
  const us = await usuarioESessao(accessToken);
  if (!us || !us.sessaoId) return { ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' };
  const email = us.user.email;
  if (!email) return { ok: false, erro: 'Seu usuário não tem e-mail cadastrado. Fale com o Administrador.' };

  const db = supabaseAdmin();
  try {
    // Só faz sentido pra quem já tem 2FA cadastrado (é o plano B dele)
    const { data: fatores } = await db.auth.admin.mfa.listFactors({ userId: us.user.id });
    if (!(fatores?.factors || []).some(f => f.factor_type === 'totp' && f.status === 'verified')) {
      return { ok: false, erro: 'Você ainda não tem a autenticação em duas etapas cadastrada. Cadastre em Minha Conta.' };
    }

    const desde = new Date(Date.now() - 15 * 60000).toISOString();
    const { data: recentes } = await db.from('acesso_mfa_codigos_email')
      .select('criado_em').eq('user_id', us.user.id).gte('criado_em', desde).order('criado_em', { ascending: false });
    if ((recentes || []).length >= MAX_CODIGOS_15MIN) {
      return { ok: false, erro: 'Muitos códigos pedidos. Aguarde 15 minutos e tente de novo.' };
    }
    const ultimo = recentes?.[0]?.criado_em;
    if (ultimo && Date.now() - new Date(ultimo).getTime() < ESPERA_REENVIO_S * 1000) {
      return { ok: false, erro: 'Aguarde um minuto antes de pedir outro código.' };
    }

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // Código novo invalida os anteriores ainda não usados
    await db.from('acesso_mfa_codigos_email').update({ expira_em: new Date().toISOString() })
      .eq('user_id', us.user.id).is('usado_em', null).gt('expira_em', new Date().toISOString());
    const { error } = await db.from('acesso_mfa_codigos_email').insert({
      user_id: us.user.id,
      codigo_hash: hashCodigo(us.user.id, codigo),
      expira_em: new Date(Date.now() + VALIDADE_CODIGO_MIN * 60000).toISOString(),
    });
    if (error) throw new Error(error.message);

    await enviarEmail(email, `Código de acesso: ${codigo}`,
      `Seu código de verificação do Sistema Rentech é: ${codigo}\n\n` +
      `Ele vale por ${VALIDADE_CODIGO_MIN} minutos e libera só este acesso, no navegador em que foi pedido.\n\n` +
      `Se não foi você que pediu, ignore este e-mail e avise o Administrador — alguém pode estar com a sua senha.`);

    registrarLogAuditoria({ usuario_nome: email, acao: '2FA: CÓDIGO DE ACESSO ENVIADO POR E-MAIL', setor: 'ACESSO' });
    return { ok: true, info: { email: mascararEmail(email) } };
  } catch (e: any) {
    return { ok: false, erro: `Não foi possível enviar o código: ${e.message}` };
  }
}

export async function verificarCodigoMfaEmailAction(payload: { codigo: string }, accessToken: string): Promise<Resultado> {
  const us = await usuarioESessao(accessToken);
  if (!us || !us.sessaoId) return { ok: false, erro: 'Sessão inválida ou expirada. Faça login novamente.' };
  const codigo = String(payload.codigo || '').replace(/\D/g, '');
  if (codigo.length !== 6) return { ok: false, erro: 'Digite os 6 números do código.' };

  const db = supabaseAdmin();
  try {
    const { data: linha } = await db.from('acesso_mfa_codigos_email')
      .select('id, codigo_hash, tentativas')
      .eq('user_id', us.user.id).is('usado_em', null).gt('expira_em', new Date().toISOString())
      .order('criado_em', { ascending: false }).limit(1).maybeSingle();
    if (!linha) return { ok: false, erro: 'Código expirado ou inexistente. Peça um novo.' };
    if (linha.tentativas >= MAX_TENTATIVAS) {
      await db.from('acesso_mfa_codigos_email').update({ expira_em: new Date().toISOString() }).eq('id', linha.id);
      return { ok: false, erro: 'Tentativas demais com este código. Peça um novo.' };
    }

    const esperado = Buffer.from(linha.codigo_hash, 'hex');
    const recebido = Buffer.from(hashCodigo(us.user.id, codigo), 'hex');
    if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) {
      await db.from('acesso_mfa_codigos_email').update({ tentativas: linha.tentativas + 1 }).eq('id', linha.id);
      return { ok: false, erro: 'Código incorreto. Confira e tente de novo.' };
    }

    const { error } = await db.from('acesso_mfa_codigos_email').update({
      usado_em: new Date().toISOString(),
      sessao_id: us.sessaoId,
      liberado_ate: new Date(Date.now() + LIBERACAO_HORAS * 3600000).toISOString(),
    }).eq('id', linha.id);
    if (error) throw new Error(error.message);

    registrarLogAuditoria({ usuario_nome: us.user.email || 'Usuário', acao: 'VERIFICAÇÃO 2FA POR CÓDIGO DE E-MAIL (sem o celular)', setor: 'ACESSO' });
    // Aviso de uso — se não foi a pessoa, ela fica sabendo
    if (us.user.email) {
      enviarEmail(us.user.email, 'Seu acesso foi liberado por código de e-mail',
        `O acesso ao Sistema Rentech foi liberado agora (${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}) usando um código enviado para este e-mail, sem o aplicativo autenticador.\n\n` +
        `Se não foi você, avise o Administrador imediatamente e troque sua senha.`).catch(() => {});
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ExigirMFA pergunta isto antes de pedir o código do autenticador. Qualquer
// falha (inclusive tabela ainda não criada) = não liberado: cai no fluxo normal.
export async function liberacaoMfaEmailAtivaAction(accessToken: string): Promise<boolean> {
  const us = await usuarioESessao(accessToken);
  if (!us || !us.sessaoId) return false;
  try {
    const { data } = await supabaseAdmin().from('acesso_mfa_codigos_email')
      .select('id').eq('user_id', us.user.id).eq('sessao_id', us.sessaoId)
      .gt('liberado_ate', new Date().toISOString()).limit(1);
    return !!(data && data.length > 0);
  } catch {
    return false;
  }
}

// Reset pelo Administrador — só quem é literalmente "Administrador"
// (ehAdministradorGlobal), não o balde inteiro de permissão ADMINISTRADOR.
export async function resetarMfaUsuarioAction(payload: { perfilId: string; usuarioNome: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, '/admin/parametros/permissoes');
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!ehAdministradorGlobal(acesso.perfil.permissaoBruta)) {
    return { ok: false, erro: 'Só o Administrador pode resetar a autenticação em duas etapas.' };
  }

  const db = supabaseAdmin();
  try {
    const { data: alvo } = await db.from('perfis_usuarios').select('nome, email').eq('id', payload.perfilId).maybeSingle();
    if (!alvo) return { ok: false, erro: 'Usuário não encontrado.' };

    const { data: fatores, error: errLista } = await db.auth.admin.mfa.listFactors({ userId: payload.perfilId });
    if (errLista) throw new Error(errLista.message);
    const lista = fatores?.factors || [];
    if (lista.length === 0) return { ok: false, erro: `${alvo.nome} não tem autenticação em duas etapas cadastrada.` };

    for (const f of lista) {
      const { error } = await db.auth.admin.mfa.deleteFactor({ userId: payload.perfilId, id: f.id });
      if (error) throw new Error(error.message);
    }
    // Liberações por e-mail ainda válidas também caem
    await db.from('acesso_mfa_codigos_email').update({ liberado_ate: new Date().toISOString() })
      .eq('user_id', payload.perfilId).gt('liberado_ate', new Date().toISOString());

    await registrarLogAuditoria({
      usuario_nome: payload.usuarioNome || acesso.perfil.nome,
      acao: 'RESETOU A AUTENTICAÇÃO EM DUAS ETAPAS',
      setor: 'PERMISSÕES',
      equipamento_id: payload.perfilId,
      equipamento_nome: `${alvo.nome} (${alvo.email})`,
    });
    if (alvo.email) {
      enviarEmail(alvo.email, 'Sua autenticação em duas etapas foi resetada',
        `O Administrador resetou a autenticação em duas etapas da sua conta no Sistema Rentech.\n\n` +
        `No próximo acesso a uma página protegida, cadastre de novo o aplicativo autenticador em Minha Conta.\n\n` +
        `Se você não pediu isso, avise o Administrador.`).catch(() => {});
    }
    return { ok: true, info: { removidos: lista.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
