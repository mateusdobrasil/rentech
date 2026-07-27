// app/api/webhooks/zapi-ponto/route.ts
// Recebe as mensagens de WhatsApp da Z-API (webhook "ao receber mensagem") e
// conduz o fluxo de "bater ponto": app/lib/pontoWhatsapp.ts decide a
// pergunta/confirmação e este endpoint só extrai o payload e devolve a
// resposta via Z-API.
//
// Configurar no painel da Z-API (instância → Webhooks → "Ao receber"):
//   https://SEU-DOMINIO/api/webhooks/zapi-ponto?token=SEU_ZAPI_WEBHOOK_SECRET
// O token é comparado a process.env.ZAPI_WEBHOOK_SECRET — a Z-API não
// garante um header de assinatura, então esse segredo na própria URL é a
// proteção contra POSTs arbitrários vindos da internet.
import { NextRequest, NextResponse } from 'next/server';
import { enviarWhatsApp } from '../../../lib/zapi';
import { resolverProvedor } from '../../../lib/whatsapp';
import { processarMensagemPontoWhatsApp, type AnexoWhatsApp } from '../../../lib/pontoWhatsapp';

function extrairMensagem(body: any): { telefone: string | null; texto: string; messageId: string | null; fromMe: boolean; anexo: AnexoWhatsApp | null } {
  const telefone = body?.phone || body?.telefone || null;
  const texto = body?.text?.message || body?.message?.text || body?.body || body?.image?.caption || '';
  const messageId = body?.messageId || body?.id || null;
  const fromMe = Boolean(body?.fromMe);

  // Foto ou PDF enviados pelo funcionário (ex: atestado, no fluxo ABONAR).
  // Formato conforme a documentação da Z-API para o webhook "ao receber".
  let anexo: AnexoWhatsApp | null = null;
  if (body?.image?.imageUrl) {
    const extensao = (body.image.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
    anexo = { url: body.image.imageUrl, nomeArquivo: `foto.${extensao}`, mimeType: body.image.mimeType || 'image/jpeg' };
  } else if (body?.document?.documentUrl) {
    anexo = { url: body.document.documentUrl, nomeArquivo: body.document.fileName || 'documento.pdf', mimeType: body.document.mimeType || 'application/pdf' };
  }

  return { telefone, texto, messageId, fromMe, anexo };
}

export async function POST(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!process.env.ZAPI_WEBHOOK_SECRET || token !== process.env.ZAPI_WEBHOOK_SECRET) {
      return NextResponse.json({ ok: false, erro: 'Token inválido.' }, { status: 401 });
    }

    // Se o roteamento de WhatsApp estiver apontando o recebimento para a
    // Meta, esta rota fica "desligada" — evita processar em duplicidade caso
    // os dois webhooks estejam cadastrados nos respectivos painéis ao mesmo
    // tempo (ex: durante uma migração gradual).
    if ((await resolverProvedor('RECEBIMENTO')) !== 'ZAPI') {
      return NextResponse.json({ ok: true, ignorado: true, motivo: 'canal Z-API inativo para recebimento' });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, motivo: 'corpo vazio ou inválido' }, { status: 200 });
    }

    const { telefone, texto, messageId, fromMe, anexo } = extrairMensagem(body);

    // Mensagens enviadas pela própria instância (nossas respostas) não devem
    // reiniciar o fluxo — sem essa guarda o bot conversaria consigo mesmo.
    if (fromMe || !telefone) {
      return NextResponse.json({ ok: true, ignorado: true });
    }

    const resultado = await processarMensagemPontoWhatsApp({ telefone, texto, messageId, anexo, payloadBruto: body });
    if (resultado?.mensagem) {
      await enviarWhatsApp(telefone, resultado.mensagem);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('Webhook Ponto WhatsApp — erro:', e.message);
    // Responde 200 para a Z-API não ficar reentregando o mesmo evento em loop.
    return NextResponse.json({ ok: false, erro: e.message }, { status: 200 });
  }
}

// A Z-API faz um GET de verificação ao cadastrar o webhook.
export async function GET() {
  return NextResponse.json({ ok: true, servico: 'webhook-zapi-ponto' });
}
