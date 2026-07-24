import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';

// ============================================================================
// GET: só EXIBE uma página de confirmação — nunca altera o banco.
// ----------------------------------------------------------------------------
// Antes, o GET já dava baixa direto na OP. Isso é um antipadrão perigoso:
// clientes de e-mail e antivírus costumam "pré-visitar" (prefetch) todo link
// recebido para checar segurança, o que disparava a baixa sozinho, sem
// nenhuma ação humana. Agora o GET é só leitura; a baixa de fato só acontece
// no POST, que exige o clique explícito no botão desta página.
// ============================================================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new NextResponse('ID da OP não fornecido no link.', { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: op, error } = await admin
    .from('op_ordens_pagamento')
    .select('id, numero_op, os_numero, empresa_recebedora, total_geral, status')
    .eq('id', id)
    .single();

  if (error || !op) {
    return new NextResponse('Ordem de Pagamento não encontrada.', { status: 404, headers: { 'Content-Type': 'text/html' } });
  }

  if (String(op.status || '').includes('PAGO')) {
    return new NextResponse(
      paginaResultadoHtml({
        icone: 'ℹ️',
        titulo: 'OP já baixada',
        corBorda: '#336699',
        mensagem: `A OP <strong>#${op.numero_op}</strong> (OS ${op.os_numero || 'S/N'}) já está com status <strong>${op.status}</strong>. Nenhuma ação adicional é necessária.`,
      }),
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  const valorFormatado = Number(op.total_geral || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return new NextResponse(paginaConfirmacaoHtml(op, valorFormatado), { headers: { 'Content-Type': 'text/html' } });
}

// ============================================================================
// POST: dá a baixa de fato, com cliente admin, checagem de idempotência e
// registro em logs_auditoria — igual ao que já acontece quando o Financeiro
// baixa a OP manualmente pelo painel.
// ============================================================================
export async function POST(request: Request) {
  const formData = await request.formData();
  const id = String(formData.get('id') || '');

  if (!id) {
    return new NextResponse('ID da OP não fornecido.', { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: op, error: opError } = await admin
    .from('op_ordens_pagamento')
    .select('id, numero_op, os_numero, status')
    .eq('id', id)
    .single();

  if (opError || !op) {
    return new NextResponse('Ordem de Pagamento não encontrada.', { status: 404, headers: { 'Content-Type': 'text/html' } });
  }

  if (String(op.status || '').includes('PAGO')) {
    return new NextResponse(
      paginaResultadoHtml({
        icone: 'ℹ️',
        titulo: 'OP já baixada',
        corBorda: '#336699',
        mensagem: `A OP <strong>#${op.numero_op}</strong> já estava com status <strong>${op.status}</strong>.`,
      }),
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  const { error } = await admin
    .from('op_ordens_pagamento')
    .update({ status: 'PAGO', updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return new NextResponse(`Erro ao tentar baixar a OP: ${error.message}`, { status: 500 });
  }

  await registrarLogAuditoria({
    usuario_nome: 'FINANCEIRO (LINK DE E-MAIL)',
    acao: 'BAIXOU OP — STATUS: PAGO',
    setor: 'OP',
    equipamento_id: id,
    equipamento_nome: `OS ${op.os_numero || 'S/N'}`,
  });

  return new NextResponse(
    paginaResultadoHtml({
      icone: '✅',
      titulo: 'OP Baixada!',
      corBorda: '#16A34A',
      mensagem: `O pagamento foi confirmado e o status da OP <strong>#${op.numero_op}</strong> foi atualizado para <strong>PAGO</strong> no sistema da Rentech.`,
    }),
    { headers: { 'Content-Type': 'text/html' } }
  );
}

function paginaResultadoHtml({ icone, titulo, corBorda, mensagem }: { icone: string; titulo: string; corBorda: string; mensagem: string }) {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${titulo}</title>
      <style>
        body { font-family: 'Arial', sans-serif; background-color: #F0F4F8; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 420px; border-top: 6px solid ${corBorda}; }
        .icon { font-size: 60px; margin-bottom: 15px; }
        h1 { color: #0C1D4D; margin: 0 0 10px 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
        p { color: #64748B; line-height: 1.5; margin: 0 0 20px 0; }
        .footer { font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 15px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">${icone}</div>
        <h1>${titulo}</h1>
        <p>${mensagem}</p>
        <div class="footer">Você já pode fechar esta janela.</div>
      </div>
    </body>
    </html>
  `;
}

function paginaConfirmacaoHtml(
  op: { id: string; numero_op: number; os_numero: string; empresa_recebedora: string },
  valorFormatado: string
) {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Confirmar Baixa da OP</title>
      <style>
        body { font-family: 'Arial', sans-serif; background-color: #F0F4F8; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 420px; border-top: 6px solid #16A34A; }
        h1 { color: #0C1D4D; margin: 0 0 10px 0; font-size: 22px; text-transform: uppercase; letter-spacing: 1px; }
        p { color: #64748B; line-height: 1.5; margin: 0 0 8px 0; }
        .valor { font-size: 28px; font-weight: bold; color: #0C1D4D; margin: 15px 0; }
        button { background-color: #16A34A; color: white; border: none; padding: 16px 32px; border-radius: 8px; font-weight: bold; font-size: 15px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; width: 100%; }
        button:hover { background-color: #15803D; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Confirmar Pagamento</h1>
        <p>OS: <strong>${op.os_numero || 'S/N'}</strong> — Favorecido: <strong>${op.empresa_recebedora}</strong></p>
        <div class="valor">${valorFormatado}</div>
        <form method="POST">
          <input type="hidden" name="id" value="${op.id}" />
          <button type="submit">✅ Confirmar e Baixar OP</button>
        </form>
      </div>
    </body>
    </html>
  `;
}
