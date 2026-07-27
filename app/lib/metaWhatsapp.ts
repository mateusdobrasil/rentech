// Envio de WhatsApp via API oficial da Meta (WhatsApp Cloud API). Uso
// exclusivo em código de servidor (Server Actions / Route Handlers) —
// nunca importar em componentes client. Espelha app/lib/zapi.ts na
// assinatura de retorno para que app/lib/whatsapp.ts possa alternar entre
// os dois provedores sem os chamadores saberem qual está ativo.

const GRAPH_API_VERSION = 'v21.0';

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`;
}

export async function enviarWhatsAppMeta(celular: string, mensagem: string): Promise<{ ok: boolean; erro?: string }> {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { ok: false, erro: 'Credenciais da Meta Cloud API não configuradas nas variáveis de ambiente.' };
  }

  const celularLimpo = (celular || '').replace(/\D/g, '');
  if (!celularLimpo) return { ok: false, erro: 'Celular vazio ou inválido.' };

  try {
    const response = await fetch(graphUrl(`${phoneNumberId}/messages`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `55${celularLimpo}`,
        type: 'text',
        text: { body: mensagem },
      }),
    });

    if (!response.ok) {
      const texto = await response.text().catch(() => '');
      return { ok: false, erro: texto || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Checa se as credenciais da Meta Cloud API respondem. Diferente da Z-API,
// a Cloud API não tem conceito de sessão pareada por QR Code — uma vez
// configurada, o número está sempre "conectado"; aqui só confirmamos que o
// Phone Number ID e o token são válidos.
export async function verificarConexaoMeta(): Promise<{ conectado: boolean; detalhe?: string }> {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { conectado: false, detalhe: 'Credenciais da Meta Cloud API não configuradas.' };
  }

  try {
    const response = await fetch(graphUrl(`${phoneNumberId}?fields=display_phone_number,verified_name`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const texto = await response.text().catch(() => '');
      return { conectado: false, detalhe: texto || `HTTP ${response.status}` };
    }
    return { conectado: true };
  } catch (e: any) {
    return { conectado: false, detalhe: e.message };
  }
}

// Resolve um media id recebido no webhook (foto/PDF enviados pelo
// funcionário) para uma URL de download. A Graph API exige dois passos:
// 1) GET /{media-id} devolve uma url temporária; 2) baixar essa url exige o
// mesmo Bearer token no header — diferente da Z-API, que já entrega uma URL
// pública direta no payload do webhook.
export async function resolverMidiaMeta(mediaId: string): Promise<{ url: string; authHeader: string } | null> {
  const token = process.env.META_WHATSAPP_TOKEN;
  if (!token) return null;

  try {
    const response = await fetch(graphUrl(mediaId), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.url) return null;
    return { url: data.url, authHeader: `Bearer ${token}` };
  } catch {
    return null;
  }
}
