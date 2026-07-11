// Envio de WhatsApp via Z-API. Uso exclusivo em código de servidor
// (Server Actions / Route Handlers) — nunca importar em componentes client.

export async function enviarWhatsApp(celular: string, mensagem: string): Promise<{ ok: boolean; erro?: string }> {
  const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE;
  const ZAPI_TOKEN = process.env.ZAPI_TOKEN;
  const ZAPI_CLIENT_TOKEN = process.env.API_CLIENT_TOKEN;

  if (!ZAPI_INSTANCE || !ZAPI_TOKEN) {
    return { ok: false, erro: 'Credenciais da Z-API não configuradas nas variáveis de ambiente.' };
  }

  const celularLimpo = (celular || '').replace(/\D/g, '');
  if (!celularLimpo) return { ok: false, erro: 'Celular vazio ou inválido.' };

  const zapiUrl = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

  try {
    const response = await fetch(zapiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': ZAPI_CLIENT_TOKEN || ''
      },
      body: JSON.stringify({ phone: `55${celularLimpo}`, message: mensagem })
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
