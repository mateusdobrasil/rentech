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
import { enviarWhatsAppMeta, enviarWhatsAppMetaTemplate } from './metaWhatsapp';

const JANELA_ATENDIMENTO_HORAS = 24;

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

export async function enviarComProvedor(provedor: ProvedorWhatsApp, celular: string, mensagem: string): Promise<{ ok: boolean; erro?: string; detalhe?: string }> {
  return provedor === 'META' ? enviarWhatsAppMeta(celular, mensagem) : enviarWhatsAppZapi(celular, mensagem);
}

// A Meta só entrega texto livre business-iniciado dentro da janela de 24h
// que abre quando o funcionário manda mensagem (ver folha_whatsapp_janela,
// atualizada por processarMensagemPontoWhatsApp a cada mensagem recebida,
// nos dois webhooks). Sem registro (nunca conversou) conta como fechada —
// degrada com segurança caso a tabela ainda não exista.
export async function janelaAbertaParaCelular(celular: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('folha_whatsapp_janela')
    .select('ultima_mensagem_em')
    .eq('celular', celular)
    .maybeSingle();

  if (error || !data?.ultima_mensagem_em) return false;
  const horasDesde = (Date.now() - new Date(data.ultima_mensagem_em).getTime()) / (1000 * 60 * 60);
  return horasDesde < JANELA_ATENDIMENTO_HORAS;
}

export interface TemplateMeta {
  nome: string;
  idioma: string; // ex: 'pt_BR'
  parametros: string[]; // na ordem dos {{1}}, {{2}}... do corpo aprovado no Business Manager
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
//
// `textoLivre` é usado sempre no Z-API, e na Meta quando a janela de 24h
// ainda está aberta (RH que analisa no mesmo dia). Fora da janela, a Meta
// só entrega via `templateMeta` (Message Template pré-aprovado) — texto
// livre nesse caso seria aceito pela API mas nunca chegaria no aparelho.
export async function notificarPontoWhatsApp(celular: string, textoLivre: string, templateMeta: TemplateMeta): Promise<{ ok: boolean; erro?: string; detalhe?: string }> {
  const provedor = await resolverProvedor('RECEBIMENTO');
  if (provedor === 'ZAPI') return enviarComProvedor('ZAPI', celular, textoLivre);

  const aberta = await janelaAbertaParaCelular(celular);
  if (aberta) return enviarComProvedor('META', celular, textoLivre);
  return enviarWhatsAppMetaTemplate(celular, templateMeta.nome, templateMeta.idioma, templateMeta.parametros);
}
