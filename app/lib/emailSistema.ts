// app/lib/emailSistema.ts
// E-mail de texto simples do sistema (códigos de acesso, avisos de segurança)
// pelo SMTP_* do ambiente. Fica em lib, SEM 'use server' de propósito: se
// fosse uma Server Action exportada, qualquer um poderia chamar e mandar
// e-mail pra qualquer endereço. Só código de servidor importa isto.
import { exigirSmtp } from './cofre/smtp';

export async function enviarEmailSistema(para: string, assunto: string, texto: string): Promise<void> {
  const { transporter, remetente } = await exigirSmtp();
  await transporter.sendMail({ from: `"Sistema Rentech" <${remetente}>`, to: para, subject: assunto, text: texto });
}

export const mascararEmail = (email: string) => {
  const [nome, dominio] = email.split('@');
  return `${nome.slice(0, 1)}${'*'.repeat(Math.max(1, nome.length - 1))}@${dominio}`;
};
