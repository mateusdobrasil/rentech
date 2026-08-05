'use server';

// app/admin/financeiro/integracao/actions.ts
// Consultas à API do Itaú (SISPAG/Cash Management) — complementa o envio de
// pagamentos feito em app/admin/rh/actions/actions-financeiro.ts com o lado
// de leitura: GET /pagamentos_sispag cobre TODOS os pagamentos lançados no
// SISPAG (via API ou via arquivo CNAB manual), não só os enviados por aqui —
// serve para conciliação/auditoria. Cliente HTTP real em app/lib/itauSispag.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import {
  consultarPagamentosSispag, consultarPagamentoSispag, credenciaisItauConfiguradas,
  type AmbienteItau,
} from '../../../lib/itauSispag';

type Resultado = { ok: boolean; erro?: string; info?: any };

// Lê ambiente + conta configurados em Integrações (não expostos no formulário
// — a consulta é sempre sobre a própria conta da empresa, não uma escolhida
// pelo usuário) e confere que as credenciais do ambiente ativo estão prontas.
async function resolverContextoItau(): Promise<
  { ok: true; ambiente: AmbienteItau; agenciaOperacao: string; contaOperacao: string; cnpjEmpresa: string }
  | { ok: false; erro: string }
> {
  const db = supabaseAdmin();
  const { data: integ } = await db.from('folha_integracoes')
    .select('ativo, ambiente, config').eq('parceiro', 'ITAU').maybeSingle();
  if (!integ) return { ok: false, erro: 'Integração com o Itaú não encontrada (ver Integrações).' };
  if (!integ.ativo) return { ok: false, erro: 'A integração com o Itaú ainda não está ativa (ver Integrações → ⚙ Configurar).' };

  const ambiente: AmbienteItau = integ.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX';
  if (!credenciaisItauConfiguradas(ambiente)) {
    return { ok: false, erro: `Credenciais da API do Itaú não configuradas no servidor para o ambiente ${ambiente}.` };
  }

  const cfg = integ.config || {};
  const camposFaltando = (['cnpj', 'agencia_debito', 'conta_debito'] as const).filter(c => !String(cfg[c] || '').trim());
  if (camposFaltando.length > 0) {
    return { ok: false, erro: `Configure primeiro (Integrações → ⚙ Configurar Itaú): ${camposFaltando.join(', ')}.` };
  }

  const limpaNum = (s: string) => String(s || '').replace(/\D/g, '');
  // Mesma convenção do pagador em enviarLoteAoBancoAction: conta + dígito
  // verificador concatenados numa string só.
  const [contaBase, dacBase] = String(cfg.conta_debito || '').split('-');
  return {
    ok: true,
    ambiente,
    agenciaOperacao: limpaNum(cfg.agencia_debito),
    contaOperacao: limpaNum(contaBase) + limpaNum(dacBase || ''),
    cnpjEmpresa: limpaNum(cfg.cnpj),
  };
}

export interface FiltrosConsultaItau {
  tipoLista?: 'Detalhada' | 'Lote';
  numeroLote?: string;
  dataInicial?: string;
  dataFinal?: string;
  status?: 'AE' | 'EF' | 'NE' | 'TD';
  page?: number;
  pageSize?: number;
}

export async function consultarPagamentosItauAction(filtros: FiltrosConsultaItau): Promise<Resultado> {
  try {
    const ctx = await resolverContextoItau();
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    const { status, ok, data } = await consultarPagamentosSispag({
      ambiente: ctx.ambiente,
      agenciaOperacao: ctx.agenciaOperacao,
      contaOperacao: ctx.contaOperacao,
      cnpjEmpresa: ctx.cnpjEmpresa,
      tipoLista: filtros.tipoLista || 'Detalhada',
      numeroLote: filtros.numeroLote || undefined,
      dataInicial: filtros.dataInicial || undefined,
      dataFinal: filtros.dataFinal || undefined,
      status: filtros.status || undefined,
      page: filtros.page,
      pageSize: filtros.pageSize,
    });
    if (!ok) {
      return { ok: false, erro: `Consulta rejeitada pela API do Itaú (HTTP ${status}): ${data?.mensagem || JSON.stringify(data || {}).slice(0, 300)}` };
    }
    return { ok: true, info: { itens: data?.itens || [], total: data?.total ?? null, ambiente: ctx.ambiente } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function consultarPagamentoItauAction(idPagamentoSispag: string): Promise<Resultado> {
  try {
    const ctx = await resolverContextoItau();
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    const { status, ok, data } = await consultarPagamentoSispag(ctx.ambiente, idPagamentoSispag);
    if (!ok) {
      return { ok: false, erro: `Consulta rejeitada pela API do Itaú (HTTP ${status}).` };
    }
    return { ok: true, info: { pagamento: data, ambiente: ctx.ambiente } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
