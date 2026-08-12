'use server';

// app/admin/integracao/actions.ts
// Cadastro de parceiros (bancos, benefícios, assinatura digital) — status,
// ambiente (sandbox/produção) e metadados de configuração (nunca segredos).
// A montagem de lotes de pagamento e geração de arquivos CNAB vive em
// app/admin/rh/actions/actions-financeiro.ts (tela RH → Financeiro).
import { supabaseAdmin } from '../../../lib/supabase';
import { enviarComProvedor, type ProvedorWhatsApp } from '../../../lib/whatsapp';
import { enviarWhatsAppMetaTemplate } from '../../../lib/metaWhatsapp';
import { statusCredenciaisP2s, testarConexao as testarConexaoP2s, type AmbienteP2s } from '../../../lib/p2s';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/parametros/integracao';

export async function listarIntegracoesAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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
export async function statusTokenAutentiqueAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  return { ok: true, info: { configurado: !!process.env.AUTENTIQUE_API_TOKEN } };
}

// Estatísticas de uso da integração com a Autentique, para exibir no card e
// no modal de configuração.
export async function estatisticasAutentiqueAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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
export async function statusZapiAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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
export async function statusMetaAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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

// Confirma (sem nunca expor os valores) se as credenciais da API SISPAG
// (Cash Management) do Itaú estão definidas no ambiente do servidor: OAuth2
// + header x-itau-apikey (= o próprio client_id, sem segredo à parte) + mTLS
// (certificado cliente obtido via credenciamento próprio — ver
// solicitarCertificadoItau em app/lib/itauSispag.ts). Sandbox e produção são
// apps diferentes no portal do Itaú (client_id/secret/certificado próprios
// de cada um — testado empiricamente que um certificado de um ambiente não
// funciona com o token do outro), por isso todo o status é por ambiente.
// Consumida por app/lib/itauSispag.ts, chamada em enviarLoteAoBancoAction
// (app/admin/rh/actions/actions-financeiro.ts).
export async function statusItauApiAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  return {
    ok: true,
    info: {
      sandbox: {
        clientIdConfigurado: !!process.env.ITAU_API_CLIENT_ID_SANDBOX,
        clientSecretConfigurado: !!process.env.ITAU_API_CLIENT_SECRET_SANDBOX,
        certificadoConfigurado: !!(process.env.ITAU_API_CERT_PEM_BASE64_SANDBOX || process.env.ITAU_API_CERT_PEM_PATH_SANDBOX),
        chaveConfigurada: !!(process.env.ITAU_API_CERT_KEY_BASE64_SANDBOX || process.env.ITAU_API_CERT_KEY_PATH_SANDBOX),
      },
      producao: {
        clientIdConfigurado: !!process.env.ITAU_API_CLIENT_ID_PRODUCAO,
        clientSecretConfigurado: !!process.env.ITAU_API_CLIENT_SECRET_PRODUCAO,
        certificadoConfigurado: !!(process.env.ITAU_API_CERT_PEM_BASE64_PRODUCAO || process.env.ITAU_API_CERT_PEM_PATH_PRODUCAO),
        chaveConfigurada: !!(process.env.ITAU_API_CERT_KEY_BASE64_PRODUCAO || process.env.ITAU_API_CERT_KEY_PATH_PRODUCAO),
      },
    }
  };
}

// Confirma (sem nunca expor os valores) se CNPJ/certificado digital ICP-Brasil
// da API "Crédito Trabalhador" da Dataprev (GOV.BR) estão definidos no
// ambiente do servidor. Usados por consultarConsignacoesEmpregadorGovBr em
// app/admin/rh/actions/actions-consignado.ts (tela RH → Consignado).
export async function statusGovBrConsignadoAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  return {
    ok: true,
    info: {
      cnpjConfigurado: !!process.env.GOVBR_CONSIGNADO_CNPJ,
      certificadoConfigurado: !!(process.env.GOVBR_CONSIGNADO_CERT_PFX_BASE64 || process.env.GOVBR_CONSIGNADO_CERT_PFX_PATH),
      senhaConfigurado: !!process.env.GOVBR_CONSIGNADO_CERT_SENHA,
      ambiente: (process.env.GOVBR_CONSIGNADO_AMBIENTE || 'homologacao').toLowerCase(),
    }
  };
}

// Confirma (sem nunca expor os valores) se host/porta/usuário/senha da API
// REST do PrimeStart (ERP da P2S) estão definidos por ambiente. SANDBOX cai
// no Demo público da P2S por padrão (sempre "configurado", sem env var
// nenhuma); PRODUCAO usa P2S_API_HOST/PORTA/USUARIO/SENHA (ou as variantes
// com sufixo _PRODUCAO) — ver credenciaisAmbiente em app/lib/p2s.ts.
export async function statusP2sAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  return { ok: true, info: statusCredenciaisP2s() };
}

// Testa a conexão de verdade (Basic Auth + rede) fazendo uma consulta leve
// que sempre retorna 0 resultados, sem depender do tamanho da base do
// cliente — ver testarConexao em app/lib/p2s.ts.
export async function testarConexaoP2sAction(ambiente: AmbienteP2s, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const res = await testarConexaoP2s(ambiente);
  return res.ok ? { ok: true, info: { detalhe: 'Conexão e autenticação confirmadas.' } } : { ok: false, erro: res.erro };
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
export async function obterRoteamentoWhatsAppAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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

export async function salvarRoteamentoWhatsAppAction(config: ConfigRoteamentoWhatsApp, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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
export async function enviarTesteWhatsAppAction(provedor: ProvedorWhatsApp, celular: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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

// Testa um Message Template da Meta diretamente (sem passar pelo roteamento
// nem pela checagem de janela de 24h) — serve tanto pra validar o
// `hello_world` (template padrão, sempre aprovado, sem variáveis) quanto
// os templates próprios depois de aprovados no Business Manager.
export async function enviarTesteTemplateWhatsAppAction(templateNome: string, idioma: string, parametros: string, celular: string, botaoCodigo: string | undefined, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const celularLimpo = (celular || '').replace(/\D/g, '');
  if (!celularLimpo) return { ok: false, erro: 'Informe um celular válido (com DDD).' };
  if (!templateNome.trim()) return { ok: false, erro: 'Informe o nome do template.' };

  const listaParametros = (parametros || '').split(',').map(s => s.trim()).filter(Boolean);
  const res = await enviarWhatsAppMetaTemplate(celularLimpo, templateNome.trim(), idioma.trim() || 'en_US', listaParametros, botaoCodigo?.trim() || undefined);
  return res.ok ? { ok: true, info: { detalhe: res.detalhe } } : { ok: false, erro: res.erro };
}

// Quantas automações de Agendamentos e Disparos usam o canal WhatsApp hoje,
// para dar uma ideia de uso real da integração no card. Serve tanto para o
// card da Z-API quanto para o da Meta — o canal salvo em folha_automacoes
// é genérico ("WhatsApp"), não por provedor.
export async function estatisticasZapiAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

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
