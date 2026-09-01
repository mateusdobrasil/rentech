import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDataExtenso = (d: string) =>
  capitalize(new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }));

interface AlocacaoLink {
  id: string; funcionario_nome: string; data: string; local_nome: string; horario: string; confirmado_em: string | null;
}

// ============================================================================
// GET: só EXIBE a página de confirmação — nunca grava. Mesmo motivo do
// api/baixar-op: o WhatsApp busca o link sozinho pra gerar a prévia da
// mensagem (e clientes de e-mail/antivírus fazem o mesmo com outros links),
// então se o GET gravasse, a confirmação aconteceria sem nenhum toque
// humano. A gravação de fato só acontece no POST, disparado pelo botão.
// ============================================================================
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return new NextResponse('Link inválido.', { status: 400 });

  const admin = supabaseAdmin();
  const { data: alocacao, error } = await admin
    .from('escala_alocacoes').select('id, funcionario_nome, data, local_nome, horario, confirmado_em')
    .eq('id', id).single();

  if (error || !alocacao) {
    return new NextResponse(paginaResultadoHtml({
      icone: '⚠️', titulo: 'Escala não encontrada', corBorda: '#DC2626',
      mensagem: 'Esse link não é mais válido.',
    }), { status: 404, headers: { 'Content-Type': 'text/html' } });
  }

  if (alocacao.confirmado_em) {
    return new NextResponse(paginaResultadoHtml({
      icone: '✅', titulo: 'Já confirmado', corBorda: '#16A34A',
      mensagem: `Você já confirmou ciência dessa escala em <strong>${new Date(alocacao.confirmado_em).toLocaleString('pt-BR')}</strong>.`,
    }), { headers: { 'Content-Type': 'text/html' } });
  }

  return new NextResponse(paginaConfirmacaoHtml(alocacao as AlocacaoLink), { headers: { 'Content-Type': 'text/html' } });
}

// ============================================================================
// POST: grava confirmado_em de fato, com idempotência (não sobrescreve se já
// confirmado) e log de auditoria — mesmo padrão do api/baixar-op.
// ============================================================================
export async function POST(request: Request) {
  const formData = await request.formData();
  const id = String(formData.get('id') || '');
  if (!id) return new NextResponse('Link inválido.', { status: 400 });

  const admin = supabaseAdmin();
  const { data: alocacao, error: erroBusca } = await admin
    .from('escala_alocacoes').select('id, funcionario_nome, data, local_nome, horario, confirmado_em')
    .eq('id', id).single();

  if (erroBusca || !alocacao) {
    return new NextResponse(paginaResultadoHtml({
      icone: '⚠️', titulo: 'Escala não encontrada', corBorda: '#DC2626',
      mensagem: 'Esse link não é mais válido.',
    }), { status: 404, headers: { 'Content-Type': 'text/html' } });
  }

  if (alocacao.confirmado_em) {
    return new NextResponse(paginaResultadoHtml({
      icone: '✅', titulo: 'Já confirmado', corBorda: '#16A34A',
      mensagem: `Você já tinha confirmado ciência dessa escala em <strong>${new Date(alocacao.confirmado_em).toLocaleString('pt-BR')}</strong>.`,
    }), { headers: { 'Content-Type': 'text/html' } });
  }

  const agora = new Date().toISOString();
  const { error } = await admin.from('escala_alocacoes').update({ confirmado_em: agora }).eq('id', id);
  if (error) return new NextResponse(`Erro ao confirmar: ${error.message}`, { status: 500 });

  await registrarLogAuditoria({
    usuario_nome: `${alocacao.funcionario_nome} (LINK WHATSAPP)`,
    acao: 'CONFIRMOU CIÊNCIA DA ESCALA',
    setor: 'OPERACIONAL / ESCALA',
    equipamento_id: id,
    equipamento_nome: `${alocacao.local_nome} — ${fmtDataExtenso(alocacao.data)}`,
  });

  return new NextResponse(paginaResultadoHtml({
    icone: '✅', titulo: 'Confirmado!', corBorda: '#16A34A',
    mensagem: `Sua ciência da escala em <strong>${alocacao.local_nome}</strong>, ${fmtDataExtenso(alocacao.data)} às <strong>${alocacao.horario?.slice(0, 5)}</strong>, foi registrada. Obrigado!`,
  }), { headers: { 'Content-Type': 'text/html' } });
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
        body { font-family: 'Arial', sans-serif; background-color: #F0F4F8; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
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

function paginaConfirmacaoHtml(alocacao: AlocacaoLink) {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Confirmar Escala</title>
      <style>
        body { font-family: 'Arial', sans-serif; background-color: #F0F4F8; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 420px; border-top: 6px solid #336699; }
        h1 { color: #0C1D4D; margin: 0 0 16px 0; font-size: 22px; text-transform: uppercase; letter-spacing: 1px; }
        p { color: #64748B; line-height: 1.5; margin: 0 0 6px 0; }
        .nome { font-size: 18px; font-weight: bold; color: #0C1D4D; margin-bottom: 16px; }
        .detalhe { background: #F8FAFC; border-radius: 10px; padding: 14px; margin-bottom: 20px; text-align: left; }
        .detalhe p { margin: 4px 0; font-size: 14px; }
        button { background-color: #16A34A; color: white; border: none; padding: 16px 32px; border-radius: 8px; font-weight: bold; font-size: 15px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; width: 100%; }
        button:hover { background-color: #15803D; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🗓️ Sua Escala</h1>
        <div class="nome">${alocacao.funcionario_nome}</div>
        <div class="detalhe">
          <p>📅 <strong>${fmtDataExtenso(alocacao.data)}</strong></p>
          <p>📍 Local: <strong>${alocacao.local_nome}</strong></p>
          <p>🕐 Horário: <strong>${alocacao.horario?.slice(0, 5)}</strong></p>
        </div>
        <p>Confirme que recebeu e está ciente da sua escala:</p>
        <form method="POST">
          <input type="hidden" name="id" value="${alocacao.id}" />
          <button type="submit">✅ Confirmar Ciência</button>
        </form>
      </div>
    </body>
    </html>
  `;
}
