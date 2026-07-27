// Roteador de WhatsApp: decide se um envio/recebimento usa Z-API ou a Meta
// Cloud API, com base no config salvo em folha_integracoes (parceiro
// 'WHATSAPP_ROTEAMENTO', tela /admin/integracao). Uso exclusivo em código
// de servidor.
//
// Zero-config (linha ainda não cadastrada, ou config incompleto) sempre
// resolve para 'ZAPI' — preserva o comportamento anterior à existência
// deste roteador.
import { supabaseAdmin } from './supabase';
import { enviarWhatsApp as enviarWhatsAppZapi } from './zapi';
import { enviarWhatsAppMeta } from './metaWhatsapp';

export type ProvedorWhatsApp = 'ZAPI' | 'META';
export type EscopoWhatsApp = 'ENVIO' | 'RECEBIMENTO';

interface ConfigRoteamento {
  modo?: 'GLOBAL' | 'INDEPENDENTE';
  provedor_global?: ProvedorWhatsApp;
  provedor_envio?: ProvedorWhatsApp;
  provedor_recebimento?: ProvedorWhatsApp;
}

const PROVEDOR_PADRAO: ProvedorWhatsApp = 'ZAPI';

function normalizarProvedor(valor: unknown): ProvedorWhatsApp {
  return valor === 'META' ? 'META' : PROVEDOR_PADRAO;
}

// Envio disparado pelos nós de agendadores/lembretes (automacoes.ts): usa o
// escopo ENVIO. Notificações de aprovação/rejeição de ponto (RH →
// funcionário) usam o escopo RECEBIMENTO, porque são resposta a uma
// conversa que começou no canal onde o funcionário está falando com o bot,
// não um disparo agendado — ver notificarPontoWhatsApp.
export async function resolverProvedor(escopo: EscopoWhatsApp): Promise<ProvedorWhatsApp> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('folha_integracoes')
    .select('config')
    .eq('parceiro', 'WHATSAPP_ROTEAMENTO')
    .maybeSingle();

  const config: ConfigRoteamento = data?.config || {};
  if (config.modo === 'INDEPENDENTE') {
    return normalizarProvedor(escopo === 'ENVIO' ? config.provedor_envio : config.provedor_recebimento);
  }
  return normalizarProvedor(config.provedor_global);
}

export async function enviarComProvedor(provedor: ProvedorWhatsApp, celular: string, mensagem: string): Promise<{ ok: boolean; erro?: string }> {
  return provedor === 'META' ? enviarWhatsAppMeta(celular, mensagem) : enviarWhatsAppZapi(celular, mensagem);
}

// Usado por automacoes.ts para disparos avulsos. Para disparar em lote
// (loop de vários funcionários), prefira resolver o provedor uma vez com
// resolverProvedor('ENVIO') e chamar enviarComProvedor diretamente —
// evita uma leitura no banco por mensagem.
export async function enviarWhatsApp(celular: string, mensagem: string): Promise<{ ok: boolean; erro?: string }> {
  const provedor = await resolverProvedor('ENVIO');
  return enviarComProvedor(provedor, celular, mensagem);
}

// Usado por actions-ponto-whatsapp.ts para notificar o funcionário sobre a
// aprovação/rejeição de uma justificativa ou abono — segue o provedor de
// RECEBIMENTO porque é resposta à conversa que o funcionário já está tendo
// pelo WhatsApp, não um disparo de automação.
export async function notificarPontoWhatsApp(celular: string, mensagem: string): Promise<{ ok: boolean; erro?: string }> {
  const provedor = await resolverProvedor('RECEBIMENTO');
  return enviarComProvedor(provedor, celular, mensagem);
}
