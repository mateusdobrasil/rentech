'use server';

// app/admin/integracao/actions.ts
// Cadastro de parceiros (bancos, benefícios, assinatura digital) — status,
// ambiente (sandbox/produção) e metadados de configuração (nunca segredos).
// A montagem de lotes de pagamento e geração de arquivos CNAB vive em
// app/admin/rh/actions/actions-financeiro.ts (tela RH → Financeiro).
import { supabaseAdmin } from '../../lib/supabase';
import { enviarComProvedor, type ProvedorWhatsApp } from '../../lib/whatsapp';

type Resultado = { ok: boolean; erro?: string; info?: any };

export async function listarIntegracoesAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db.from('folha_integracoes').select('*').order('tipo');
    if (error) throw new Error(error.message);
    return { ok: true, info: { integracoes: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Confirma (sem nunca expor o valor) se o token da Autentique está definido
// no ambiente do servidor. O token nunca é lido/gravado via cliente do banco.
export async function statusTokenAutentiqueAction(): Promise<Resultado> {
  return { ok: true, info: { configurado: !!process.env.AUTENTIQUE_API_TOKEN } };
}

// Estatísticas de uso da integração com a Autentique, para exibir no card e
// no modal de configuração.
export async function estatisticasAutentiqueAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_holerite_assinaturas')
      .select('status, sandbox, enviado_em')
      .order('enviado_em', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = data || [];
    const total = rows.length;
    const assinados = rows.filter(r => r.status === 'ASSINADO').length;
    const rejeitados = rows.filter(r => r.status === 'REJEITADO').length;
    const pendentes = total - assinados - rejeitados;
    const producao = rows.filter(r => !r.sandbox).length;

    return {
      ok: true,
      info: {
        total, assinados, rejeitados, pendentes,
        producao, sandbox: total - producao,
        ultimoEnvio: rows[0]?.enviado_em || null
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Confirma (sem nunca expor os valores) se as credenciais da Z-API estão
// definidas no ambiente do servidor. Usadas pelo Cron (app/lib/zapi.ts) para
// os disparos de WhatsApp configurados em Agendamentos e Disparos.
export async function statusZapiAction(): Promise<Resultado> {
  return {
    ok: true,
    info: {
      instanceConfigurado: !!process.env.ZAPI_INSTANCE,
      tokenConfigurado: !!process.env.ZAPI_TOKEN,
      clientTokenConfigurado: !!process.env.API_CLIENT_TOKEN,
    }
  };
}

// Confirma (sem nunca expor os valores) se as credenciais da Meta Cloud
// API estão definidas no ambiente do servidor. Usadas pelo Cron (app/lib/
// metaWhatsapp.ts) sempre que o roteamento (ver *RoteamentoWhatsAppAction)
// apontar para META em vez de ZAPI.
export async function statusMetaAction(): Promise<Resultado> {
  return {
    ok: true,
    info: {
      tokenConfigurado: !!process.env.META_WHATSAPP_TOKEN,
      phoneNumberIdConfigurado: !!process.env.META_WHATSAPP_PHONE_NUMBER_ID,
      appSecretConfigurado: !!process.env.META_APP_SECRET,
      verifyTokenConfigurado: !!process.env.META_WEBHOOK_VERIFY_TOKEN,
    }
  };
}

export interface ConfigRoteamentoWhatsApp {
  modo: 'GLOBAL' | 'INDEPENDENTE';
  provedor_global: 'ZAPI' | 'META';
  provedor_envio: 'ZAPI' | 'META';
  provedor_recebimento: 'ZAPI' | 'META';
}

const ROTEAMENTO_PADRAO: ConfigRoteamentoWhatsApp = {
  modo: 'GLOBAL', provedor_global: 'ZAPI', provedor_envio: 'ZAPI', provedor_recebimento: 'ZAPI',
};

// Lê o interruptor que decide, para o envio (automações/lembretes) e para o
// recebimento (webhook do fluxo de Ponto), se o WhatsApp usa a Z-API ou a
// Meta Cloud API — ver app/lib/whatsapp.ts (resolverProvedor), que é quem
// realmente aplica essa config em tempo de execução.
export async function obterRoteamentoWhatsAppAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_integracoes')
      .select('config')
      .eq('parceiro', 'WHATSAPP_ROTEAMENTO')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, info: { ...ROTEAMENTO_PADRAO, ...(data?.config || {}) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function salvarRoteamentoWhatsAppAction(config: ConfigRoteamentoWhatsApp): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_integracoes').update({
      config, atualizado_em: new Date().toISOString()
    }).eq('parceiro', 'WHATSAPP_ROTEAMENTO');
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Dispara uma mensagem de teste direto pelo provedor escolhido (ignora o
// roteamento de envio/recebimento — serve justamente para validar cada
// provedor isoladamente, inclusive o que não está "no ar" no momento).
// Usa o mesmo enviarComProvedor que automacoes.ts chama em produção, então
// o teste exercita o caminho real de envio.
export async function enviarTesteWhatsAppAction(provedor: ProvedorWhatsApp, celular: string): Promise<Resultado> {
  const celularLimpo = (celular || '').replace(/\D/g, '');
  if (!celularLimpo) return { ok: false, erro: 'Informe um celular válido (com DDD).' };

  const mensagem = `✅ Mensagem de teste (${provedor === 'META' ? 'Meta Cloud API' : 'Z-API'}) — se você recebeu isso, a integração está funcionando.`;
  const res = await enviarComProvedor(provedor, celularLimpo, mensagem);
  // `detalhe` traz a resposta crua do provedor — HTTP 2xx só confirma que o
  // provedor aceitou a mensagem, não que o WhatsApp já entregou no aparelho;
  // é o que dá pra conferir de fato (ex: o wamid da Meta) quando o "ok"
  // sozinho não explica por que a mensagem não chegou.
  return res.ok ? { ok: true, info: { detalhe: res.detalhe } } : { ok: false, erro: res.erro };
}

// Quantas automações de Agendamentos e Disparos usam o canal WhatsApp hoje,
// para dar uma ideia de uso real da integração no card. Serve tanto para o
// card da Z-API quanto para o da Meta — o canal salvo em folha_automacoes
// é genérico ("WhatsApp"), não por provedor.
export async function estatisticasZapiAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data, error } = await db
      .from('folha_automacoes')
      .select('ativo, canais, ultima_execucao')
      .contains('canais', ['WhatsApp']);
    if (error) throw new Error(error.message);

    const rows = data || [];
    const total = rows.length;
    const ativas = rows.filter(r => r.ativo).length;
    const ultimoDisparo = rows
      .map(r => r.ultima_execucao)
      .filter(Boolean)
      .sort()
      .pop() || null;

    return { ok: true, info: { total, ativas, ultimoDisparo } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// Salva metadados de configuração (NÃO segredos) e status de uma integração
export async function salvarIntegracaoAction(payload: {
  parceiro: string; ativo: boolean; ambiente: 'SANDBOX' | 'PRODUCAO'; config: any;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('folha_integracoes').update({
      ativo: payload.ativo, ambiente: payload.ambiente, config: payload.config || {},
      atualizado_em: new Date().toISOString()
    }).eq('parceiro', payload.parceiro);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
