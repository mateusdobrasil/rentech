// mobile/lib/pushNotifications.ts
// Registro do token de push (Expo) — envio de verdade é 100% do lado
// servidor (app/lib/push.ts no repo web/), aqui só pede permissão, obtém o
// token e avisa o servidor de quem é o dono dele.
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

export async function registrarPushToken(accessToken: string, tipoConta: 'STAFF' | 'PORTAL'): Promise<{ ok: boolean; erro?: string }> {
  if (!Device.isDevice) {
    return { ok: false, erro: 'Notificações push só funcionam num aparelho físico, não em simulador/emulador.' };
  }

  // .d.ts desta versão do expo-notifications não expõe `granted`/`status`
  // corretamente por um conflito de resolução de tipos com expo-modules-core
  // (o campo existe de verdade em runtime, documentado pela própria Expo) —
  // any local e contido, não vale a pena brigar com o resolver do TS por isso.
  const permissaoAtual: any = await Notifications.getPermissionsAsync();
  let concedida: boolean = permissaoAtual.granted;
  if (!concedida) {
    const pedido: any = await Notifications.requestPermissionsAsync();
    concedida = pedido.granted;
  }
  if (!concedida) {
    return { ok: false, erro: 'Permissão de notificações negada. Ative pelas configurações do aparelho.' };
  }

  // Projeto EAS ainda não configurado (extra.eas.projectId vazio até alguém
  // rodar `eas init` dentro de mobile/) — sem isso não tem como pedir o
  // token, mas o resto do app segue funcionando normalmente.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    return { ok: false, erro: 'Projeto de push ainda não configurado (eas init pendente). Fale com o time técnico.' };
  }

  let token: string;
  try {
    const resultado = await Notifications.getExpoPushTokenAsync({ projectId });
    token = resultado.data;
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Não foi possível obter o token de push.' };
  }

  if (!SITE_URL) return { ok: false, erro: 'EXPO_PUBLIC_SITE_URL não configurado.' };

  try {
    const res = await fetch(`${SITE_URL}/api/portal/push/registrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token, plataforma: Platform.OS, tipoConta }),
    });
    const json = await res.json();
    if (!json.ok) return { ok: false, erro: json.erro || 'Não foi possível registrar o token no servidor.' };
  } catch {
    return { ok: false, erro: 'Sem conexão. Tente novamente.' };
  }

  return { ok: true };
}

export async function removerPushToken(accessToken: string): Promise<void> {
  if (!Device.isDevice || !SITE_URL) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await fetch(`${SITE_URL}/api/portal/push/remover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token }),
    });
  } catch {
    // sem token pra remover ou sem rede — não bloqueia desativar a preferência local
  }
}
