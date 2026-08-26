// app/lib/push.ts
// Envio de push notification do app mobile — espelha o padrão já existente
// de notificarPontoWhatsApp/enviarWhatsApp (app/lib/whatsapp.ts): evento
// direto do app, sempre liga, sem configuração em folha_automacoes (essa
// tabela é pra campanhas configuráveis, não pra notificação de evento).
//
// Usa o serviço de push da própria Expo (exp.host) — não precisa de
// credencial própria da Apple/Google pra enviar; a credencial só entra na
// hora de gerar um build de produção assinado (EAS Build resolve sozinho).
import { supabaseAdmin } from './supabase';
import { listarPerfisComAcessoRota } from './serverAuth';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function enviarPushExpo(tokens: string[], titulo: string, corpo: string, dados?: object): Promise<void> {
  if (tokens.length === 0) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map(to => ({ to, title: titulo, body: corpo, data: dados || {} }))),
    });
  } catch (e) {
    console.error('[push] falha ao enviar via Expo:', e);
  }
}

// Notifica todo mundo que acessa `rota` — usado pelos eventos do app
// (nova solicitação de ponto, nova OP, carga aguardando retorno, frota
// vencida). Sempre grava em folha_mobile_notificacoes independente de ter
// token de push registrado ou não — é a mesma linha que alimenta o inbox
// "Ver notificações" no app, nunca dessincroniza do que foi enviado.
export async function notificarPush(rota: string, titulo: string, corpo: string, dados?: object): Promise<void> {
  const db = supabaseAdmin();
  const destinatarios = await listarPerfisComAcessoRota(rota);
  if (destinatarios.length === 0) return;

  const ids = destinatarios.map(d => d.id);
  await db.from('folha_mobile_notificacoes').insert(
    ids.map(auth_user_id => ({ auth_user_id, titulo, corpo, dados: dados || {} }))
  );

  const { data: tokens } = await db.from('folha_mobile_push_tokens').select('expo_push_token').in('auth_user_id', ids);
  await enviarPushExpo(((tokens || []) as { expo_push_token: string }[]).map(t => t.expo_push_token), titulo, corpo, dados);
}

// Variante pra 1 destinatário só, já com o auth_user_id resolvido — pronta
// pra quando "recibo assinado" entrar (hoje fora de escopo: não dá pra
// resolver com segurança quem é o destinatário só a partir de um nome em
// texto livre, ver plano da Fase de Push).
export async function notificarPushParaUsuario(authUserId: string, titulo: string, corpo: string, dados?: object): Promise<void> {
  const db = supabaseAdmin();
  await db.from('folha_mobile_notificacoes').insert({ auth_user_id: authUserId, titulo, corpo, dados: dados || {} });
  const { data: tokens } = await db.from('folha_mobile_push_tokens').select('expo_push_token').eq('auth_user_id', authUserId);
  await enviarPushExpo(((tokens || []) as { expo_push_token: string }[]).map(t => t.expo_push_token), titulo, corpo, dados);
}
