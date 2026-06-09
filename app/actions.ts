// app/actions.ts
"use server";

import nodemailer from 'nodemailer';

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
      to: 'contato@locadorarentech.com.br', // <-- E-mail que recebe os orçamentos
      replyTo: email, // Permite que a equipe responda direto para o cliente
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