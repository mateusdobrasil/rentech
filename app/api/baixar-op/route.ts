import { NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase'; // Ajuste o caminho se a lib estiver em outro lugar

export async function GET(request: Request) {
  // 1. Pega o ID da OP que veio no link do e-mail
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new NextResponse('ID da OP não fornecido no link.', { status: 400 });
  }

  // 2. Tenta dar a baixa no banco de dados (mudar status para PAGO)
  const { error } = await supabase
    .from('ordens_pagamento')
    .update({ status: 'PAGO' })
    .eq('id', id);

  if (error) {
    return new NextResponse(`Erro ao tentar baixar a OP: ${error.message}`, { status: 500 });
  }

  // 3. Retorna uma tela HTML simples e bonita confirmando o sucesso
  const htmlSucesso = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OP Baixada com Sucesso</title>
      <style>
        body { font-family: 'Arial', sans-serif; background-color: #F0F4F8; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 400px; border-top: 6px solid #16A34A; }
        .icon { font-size: 60px; margin-bottom: 15px; }
        h1 { color: #0C1D4D; margin: 0 0 10px 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
        p { color: #64748B; line-height: 1.5; margin: 0 0 20px 0; }
        .footer { font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 15px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">✅</div>
        <h1>OP Baixada!</h1>
        <p>O pagamento foi confirmado e o status da Ordem de Pagamento foi atualizado para <strong>PAGO</strong> no sistema da Rentech.</p>
        <div class="footer">Você já pode fechar esta janela.</div>
      </div>
    </body>
    </html>
  `;

  return new NextResponse(htmlSucesso, { headers: { 'Content-Type': 'text/html' } });
}