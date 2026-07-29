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
  // Preencher só quando o template for de categoria Authentication com botão
  // "Copiar código"/autofill (a Meta exige o componente `button` além do
  // `body` nesse caso) — ver enviarWhatsAppMetaTemplate em metaWhatsapp.ts.
  botaoCodigo?: string;
}

// Decide texto livre vs. Message Template pré-aprovado: no Z-API sempre
// texto livre; na Meta, texto livre só se a janela de 24h estiver aberta
// (destinatário falou recentemente), senão cai no template (se houver) —
// texto livre fora da janela seria aceito pela API mas nunca chegaria no
// aparelho. Compartilhada por notificarPontoWhatsApp (aprovação/rejeição)
// e por dispararAutomacaoWhatsApp (automacoes.ts).
async function enviarConsiderandoJanela(provedor: ProvedorWhatsApp, celular: string, textoLivre: string, templateMeta: TemplateMeta | null): Promise<{ ok: boolean; erro?: string; detalhe?: string }> {
  if (provedor === 'ZAPI') return enviarComProvedor('ZAPI', celular, textoLivre);
  if (!templateMeta) return enviarComProvedor('META', celular, textoLivre);

  const aberta = await janelaAbertaParaCelular(celular);
  if (aberta) return enviarComProvedor('META', celular, textoLivre);
  return enviarWhatsAppMetaTemplate(celular, templateMeta.nome, templateMeta.idioma, templateMeta.parametros, templateMeta.botaoCodigo);
}

export { enviarConsiderandoJanela as enviarComJanela };

// Usado por automacoes.ts para disparos avulsos. Para disparar em lote
// (loop de vários funcionários), prefira resolver o provedor uma vez com
// resolverProvedor('ENVIO') e chamar enviarComProvedor diretamente —
// evita uma leitura no banco por mensagem.
export async function enviarWhatsApp(celular: string, mensagem: string): Promise<{ ok: boolean; erro?: string }> {
  const provedor = await resolverProvedor('ENVIO');
  return enviarComProvedor(provedor, celular, mensagem);
}

export type ProvedorAutomacao = 'PADRAO' | 'ZAPI' | 'META';

// Override por automação (campo folha_automacoes.provedor_whatsapp):
// 'PADRAO' segue o interruptor global de Envio; 'ZAPI'/'META' força aquele
// provedor específico, ignorando o global — usado quando se quer testar ou
// fixar uma automação num provedor sem afetar as demais.
export async function resolverProvedorAutomacao(override: ProvedorAutomacao): Promise<ProvedorWhatsApp> {
  return override === 'PADRAO' ? resolverProvedor('ENVIO') : override;
}

// Usado por actions-ponto-whatsapp.ts para notificar o funcionário sobre a
// aprovação/rejeição de uma justificativa ou abono — segue o provedor de
// RECEBIMENTO porque é resposta à conversa que o funcionário já está tendo
// pelo WhatsApp, não um disparo de automação.
export async function notificarPontoWhatsApp(celular: string, textoLivre: string, templateMeta: TemplateMeta): Promise<{ ok: boolean; erro?: string; detalhe?: string }> {
  const provedor = await resolverProvedor('RECEBIMENTO');
  return enviarConsiderandoJanela(provedor, celular, textoLivre, templateMeta);
}
