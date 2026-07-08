'use server';

// app/admin/rh/actions/actions-integracao.ts
// Integração com parceiros (bancos, benefícios). Nesta versão: estrutura,
// montagem do lote de pagamento a partir da folha, e histórico. O envio real
// ao banco é um ponto de plugagem (stub) — exige credenciais/certificado em
// variáveis de ambiente e homologação, que entram numa fase posterior.
import { supabaseAdmin } from '../../../lib/supabase';

type Resultado = { ok: boolean; erro?: string; info?: any };

// ============================================================================
// PARCEIROS / INTEGRAÇÕES
// ============================================================================
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

// ============================================================================
// MONTAR LOTE DE PAGAMENTO a partir da folha fechada do mês.
// Sugere um pagamento por funcionário (líquido a receber), já validando se
// tem dados bancários. Você ajusta antes de gerar.
// ============================================================================
export async function montarLoteSalariosAction(payload: { mesReferencia: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: fechados } = await db
      .from('folha_holerites')
      .select('funcionario_nome, dados')
      .eq('mes_referencia', payload.mesReferencia);
    if (!fechados?.length) {
      return { ok: false, erro: 'Nenhuma folha fechada neste mês. Feche a folha para montar o lote.' };
    }

    // Dados bancários dos funcionários
    const { data: funcs } = await db.from('folha_funcionarios')
      .select('nome_completo, cpf, banco_codigo, banco_agencia, banco_conta, banco_tipo, pix_tipo, pix_chave');
    const bancoPorNome: Record<string, any> = {};
    (funcs || []).forEach(f => { bancoPorNome[f.nome_completo] = f; });

    const itens = fechados.map(f => {
      const b = bancoPorNome[f.funcionario_nome] || {};
      const valor = Number(f.dados?.valorLiquidoReceber || 0);
      const temPix = !!(b.pix_tipo && b.pix_chave);
      const temConta = !!(b.banco_codigo && b.banco_agencia && b.banco_conta);
      return {
        funcionario_nome: f.funcionario_nome,
        cpf: b.cpf || '',
        valor,
        metodo: temPix ? 'PIX' : temConta ? 'TED' : 'SEM_DADOS',
        pix_tipo: b.pix_tipo || null,
        pix_chave: b.pix_chave || null,
        banco_codigo: b.banco_codigo || null,
        banco_agencia: b.banco_agencia || null,
        banco_conta: b.banco_conta || null,
        banco_tipo: b.banco_tipo || null,
        pronto: (temPix || temConta) && valor > 0
      };
    }).sort((a, b) => a.funcionario_nome.localeCompare(b.funcionario_nome));

    const semDados = itens.filter(i => i.metodo === 'SEM_DADOS').length;
    const valorTotal = itens.filter(i => i.pronto).reduce((s, i) => s + i.valor, 0);

    return { ok: true, info: { itens, semDados, valorTotal, totalItens: itens.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// SALVAR LOTE (histórico). Guarda o snapshot dos pagamentos escolhidos.
// ============================================================================
export async function salvarLoteAction(payload: {
  parceiro: string; mesReferencia: string; tipoLote: string;
  itens: any[]; criadoPor: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const prontos = payload.itens.filter(i => i.pronto);
    if (prontos.length === 0) return { ok: false, erro: 'Nenhum pagamento pronto (com dados bancários) para incluir no lote.' };

    const valorTotal = prontos.reduce((s, i) => s + Number(i.valor || 0), 0);
    const { data, error } = await db.from('folha_lotes_pagamento').insert({
      parceiro: payload.parceiro,
      mes_referencia: payload.mesReferencia,
      tipo_lote: payload.tipoLote,
      qtd_pagamentos: prontos.length,
      valor_total: valorTotal,
      status: 'GERADO',
      itens: prontos,
      criado_por: payload.criadoPor || null
    }).select('id').single();
    if (error) throw new Error(error.message);
    return { ok: true, info: { loteId: data.id, qtd: prontos.length, valorTotal } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function listarLotesAction(payload: { mesReferencia?: string }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    let q = db.from('folha_lotes_pagamento')
      .select('id, parceiro, mes_referencia, tipo_lote, qtd_pagamentos, valor_total, status, criado_por, criado_em')
      .order('criado_em', { ascending: false });
    if (payload.mesReferencia) q = q.eq('mes_referencia', payload.mesReferencia);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true, info: { lotes: data || [] } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIAR LOTE AO BANCO — PONTO DE PLUGAGEM (stub).
// A integração real com a API do Itaú exige: certificado digital (mTLS),
// OAuth com client_id/secret, e homologação. Essas credenciais vivem em
// variáveis de ambiente no servidor, nunca no cliente. Enquanto não houver
// acesso homologado, esta função apenas registra a intenção e orienta.
// ============================================================================
export async function enviarLoteAoBancoAction(payload: { loteId: number }): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const { data: lote } = await db.from('folha_lotes_pagamento')
      .select('parceiro, status').eq('id', payload.loteId).maybeSingle();
    if (!lote) return { ok: false, erro: 'Lote não encontrado.' };

    // Verifica se a integração está configurada e ativa
    const { data: integ } = await db.from('folha_integracoes')
      .select('ativo, ambiente').eq('parceiro', lote.parceiro).maybeSingle();

    if (!integ?.ativo) {
      return {
        ok: false,
        erro: `A integração com ${lote.parceiro} ainda não está ativa. Configure as credenciais (certificado e OAuth) no servidor e ative a integração antes de enviar. O lote está salvo e pode ser exportado.`
      };
    }

    // TODO (fase de integração real): autenticar via mTLS/OAuth com o Itaú,
    // montar o payload da API de pagamentos em lote, enviar e tratar retorno.
    // Requer AMBIENTE de produção homologado.
    return {
      ok: false,
      erro: 'Envio direto à API do banco ainda não implementado nesta versão. Use a exportação do lote (CNAB/planilha) para processar no internet banking, ou aguarde a ativação da API homologada.'
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}