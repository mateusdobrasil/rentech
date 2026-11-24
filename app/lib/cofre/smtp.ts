// app/lib/cofre/smtp.ts
// Transporte de e-mail único (antes repetido em 7 lugares), com as
// credenciais do cofre Sistema → Vercel. `null` = SMTP não configurado.
import nodemailer, { type Transporter } from 'nodemailer';
import { segredos } from './segredos';

export interface TransporteSmtp { transporter: Transporter; remetente: string }

export async function transporteSmtp(): Promise<TransporteSmtp | null> {
  const s = await segredos(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] as const);
  if (!s.SMTP_HOST || !s.SMTP_USER) return null;
  const porta = Number(s.SMTP_PORT) || 465;
  return {
    transporter: nodemailer.createTransport({ host: s.SMTP_HOST, port: porta, secure: porta === 465, auth: { user: s.SMTP_USER, pass: s.SMTP_PASS } }),
    remetente: s.SMTP_USER,
  };
}

/** Igual, mas falha com mensagem clara quando não há SMTP. */
export async function exigirSmtp(): Promise<TransporteSmtp> {
  const t = await transporteSmtp();
  if (!t) throw new Error('E-mail (SMTP) não configurado: preencha em Parâmetros → Empresas → Sistema → Credenciais.');
  return t;
}
