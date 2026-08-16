// app/api/webhooks/meta-ponto/route.ts
// Recebe as mensagens de WhatsApp da Meta Cloud API (Webhook do produto
// WhatsApp) e conduz o mesmo fluxo de "bater ponto" do webhook da Z-API
// (app/api/webhooks/zapi-ponto/route.ts): app/lib/pontoWhatsapp.ts decide a
// pergunta/confirmação, este endpoint só extrai o payload (formato Meta) e
// devolve a resposta via Meta.
//
// Configurar em developers.facebook.com → App → WhatsApp → Configuration:
//   Callback URL: https://SEU-DOMINIO/api/webhooks/meta-ponto
//   Verify Token: o mesmo valor de process.env.META_WEBHOOK_VERIFY_TOKEN
//   Campo assinado: messages
// A Meta garante a autenticidade do POST via assinatura HMAC no header
// x-hub-signature-256 (calculada com META_APP_SECRET) — diferente da
// Z-API, que usa um token na própria URL.
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { enviarWhatsAppMeta, resolverMidiaMeta } from '../../../lib/metaWhatsapp';
import { resolverProvedor } from '../../../lib/whatsapp';
import { processarMensagemPontoWhatsApp, type AnexoWhatsApp } from '../../../lib/pontoWhatsapp';

// Handshake de verificação exigido pela Meta ao cadastrar o webhook.
export async function GET(req: NextRequest) {
  const modo = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');

  if (modo === 'subscribe' && token && process.env.META_WEBHOOK_VERIFY_TOKEN && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge || '', { status: 200 });
  }
  return NextResponse.json({ ok: false, erro: 'Verify token inválido.' }, { status: 403 });
}

function assinaturaValida(corpoBruto: string, assinaturaHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !assinaturaHeader) return false;

  const esperada = 'sha256=' + crypto.createHmac('sha256', appSecret).update(corpoBruto).digest('hex');
  const bufA = Buffer.from(assinaturaHeader);
  const bufB = Buffer.from(esperada);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

interface MensagemMeta {
  telefone: string | null;
  texto: string;
  messageId: string | null;
  anexo: AnexoWhatsApp | null;
}

async function extrairMensagem(value: any): Promise<MensagemMeta | null> {
  const msg = value?.messages?.[0];
  if (!msg) return null; // payload só com "statuses" (confirmação de entrega/leitura) — nada a processar

  const telefone: string | null = msg.from || null;
  const messageId: string | null = msg.id || null;
  let texto = msg.text?.body || msg.image?.caption || msg.document?.caption || '';

  let anexo: AnexoWhatsApp | null = null;
  const media = msg.image || msg.document || null;
  if (media?.id) {
    const resolvida = await resolverMidiaMeta(media.id);
    if (resolvida) {
      const mimeType = media.mime_type || 'application/octet-stream';
      const extensao = (mimeType.split('/')[1] || 'bin').split(';')[0];
      anexo = {
        url: resolvida.url,
        authHeader: resolvida.authHeader,
        nomeArquivo: msg.document?.filename || `arquivo.${extensao}`,
        mimeType,
      };
    }
  }

  return { telefone, texto, messageId, anexo };
}

export async function POST(req: NextRequest) {
  try {
    const corpoBruto = await req.text();
    if (!assinaturaValida(corpoBruto, req.headers.get('x-hub-signature-256'))) {
      return NextResponse.json({ ok: false, erro: 'Assinatura inválida.' }, { status: 401 });
    }

    // Se o roteamento de WhatsApp estiver apontando o recebimento para a
    // Z-API, esta rota fica "desligada" — evita processar em duplicidade
    // caso os dois webhooks estejam cadastrados ao mesmo tempo (ex: durante
    // uma migração gradual).
    if ((await resolverProvedor('RECEBIMENTO')) !== 'META') {
      return NextResponse.json({ ok: true, ignorado: true, motivo: 'canal Meta inativo para recebimento' });
    }

    const body = JSON.parse(corpoBruto || 'null');
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) {
      return NextResponse.json({ ok: false, motivo: 'corpo vazio ou inválido' }, { status: 200 });
    }

    const mensagem = await extrairMensagem(value);
    if (!mensagem || !mensagem.telefone) {
      // Sem "messages" (só "statuses" de entrega/leitura) — nada a fazer.
      // Diferente da Z-API, a Cloud API não reenvia por este webhook as
      // mensagens que a própria instância manda, então não existe aqui um
      // equivalente ao filtro "fromMe".
      return NextResponse.json({ ok: true, ignorado: true });
    }

    try {
      const resultado = await processarMensagemPontoWhatsApp({
        telefone: mensagem.telefone,
        texto: mensagem.texto,
        messageId: mensagem.messageId,
        anexo: mensagem.anexo,
        payloadBruto: body,
      });
      if (resultado?.mensagem) {
        await enviarWhatsAppMeta(mensagem.telefone, resultado.mensagem);
      }
    } catch (eProcessamento: any) {
      // Erro dentro do processamento (não de validação do webhook em si):
      // loga o detalhe pro servidor E avisa o funcionário — antes disso o
      // funcionário ficava sem resposta nenhuma, achando que o bot travou.
      console.error('Webhook Meta Ponto WhatsApp — erro ao processar mensagem:', eProcessamento.message);
      await enviarWhatsAppMeta(mensagem.telefone, '⚠ Ocorreu um erro ao registrar seu ponto. Tente novamente em instantes ou avise o RH se persistir.').catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('Webhook Meta Ponto WhatsApp — erro:', e.message);
    // Responde 200 para a Meta não ficar reentregando o mesmo evento em loop.
    return NextResponse.json({ ok: false, erro: e.message }, { status: 200 });
  }
}
