'use server';

// app/admin/integracao/actions.ts
// Cadastro de parceiros (bancos, benefícios, assinatura digital) — status,
// ambiente (sandbox/produção) e metadados de configuração (nunca segredos).
// A montagem de lotes de pagamento e geração de arquivos CNAB vive em
// app/admin/rh/actions/actions-financeiro.ts (tela RH → Financeiro).
import { supabaseAdmin } from '../../lib/supabase';

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

// Quantas automações de Agendamentos e Disparos usam o canal WhatsApp hoje,
// para dar uma ideia de uso real da integração no card.
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
