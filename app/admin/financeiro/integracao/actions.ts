'use server';

// app/admin/financeiro/integracao/actions.ts
// Consultas à API do Itaú (SISPAG/Cash Management) — complementa o envio de
// pagamentos feito em app/admin/rh/actions/actions-financeiro.ts com o lado
// de leitura: GET /pagamentos_sispag cobre TODOS os pagamentos lançados no
// SISPAG (via API ou via arquivo CNAB manual), não só os enviados por aqui —
// serve para conciliação/auditoria. Cliente HTTP real em app/lib/itauSispag.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import {
  consultarPagamentosSispag, consultarPagamentoSispag, credenciaisItauConfiguradas,
  type AmbienteItau,
} from '../../../lib/itauSispag';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/financeiro/integracao';

// Lê ambiente + conta configurados em Integrações (não expostos no formulário
// — a consulta é sempre sobre a própria conta da empresa, não uma escolhida
// pelo usuário) e confere que as credenciais do ambiente ativo estão prontas.
// perfilId/permissaoNormalizada: confere se o usuário tem acesso à empresa
// dona da integração (ex.: Itaú é só da Rentech) — quem só tem acesso à
// AlfaLight nem consegue consultar/ver os pagamentos.
async function resolverContextoItau(perfilId: string, permissaoNormalizada: string): Promise<
  { ok: true; ambiente: AmbienteItau; agenciaOperacao: string; contaOperacao: string; cnpjEmpresa: string }
  | { ok: false; erro: string }
> {
  const db = supabaseAdmin();
  const { data: integ } = await db.from('folha_integracoes')
    .select('ativo, ambiente, config, empresa_id').eq('parceiro', 'ITAU').maybeSingle();
  if (!integ) return { ok: false, erro: 'Integração com o Itaú não encontrada (ver Integrações).' };
  if (!integ.ativo) return { ok: false, erro: 'A integração com o Itaú ainda não está ativa (ver Integrações → ⚙ Configurar).' };

  const empresasPermitidas = await obterEmpresasPermitidas(perfilId, permissaoNormalizada);
  if (!empresaPermitida(empresasPermitidas, integ.empresa_id)) {
    return { ok: false, erro: 'Você não tem permissão para consultar os pagamentos desta empresa.' };
  }

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

export async function consultarPagamentosItauAction(filtros: FiltrosConsultaItau, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const ctx = await resolverContextoItau(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    // Em produção o Itaú exige as duas datas — sem elas devolve 400 dizendo
    // "o campo data_inicial é obrigatório". Barra aqui com mensagem clara em
    // vez de deixar o erro cru do banco chegar na tela.
    if (!filtros.dataInicial || !filtros.dataFinal) {
      return { ok: false, erro: 'Informe a data inicial e a data final — a API do Itaú exige as duas na consulta.' };
    }

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
    // A API do Itaú embrulha o corpo de sucesso num nível extra "data" (ex.:
    // {"data":{"itens":[...],"total":"998.99"},"pagination":{...}}) —
    // confirmado por curl direto contra o sandbox (2026-08-07), diferente do
    // que a Especificação Técnica dava a entender.
    // `pagination` era descartado aqui, então a tela mostrava só a 1ª página
    // (20 itens) sem avisar que existiam mais — em produção já vimos
    // totalElements 68 / totalPages 4. Agora vai pra UI paginar de verdade.
    const paginacao = data?.pagination || {};
    return {
      ok: true,
      info: {
        itens: data?.data?.itens || [],
        total: data?.data?.total ?? null,
        ambiente: ctx.ambiente,
        paginaAtual: Number(paginacao.page ?? 0),
        totalPaginas: Number(paginacao.totalPages ?? paginacao.total_pages ?? 1),
        totalItens: Number(paginacao.totalElements ?? paginacao.total_elements ?? (data?.data?.itens || []).length),
        tamanhoPagina: Number(paginacao.pageSize ?? paginacao.page_size ?? 20),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function consultarPagamentoItauAction(idPagamentoSispag: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const ctx = await resolverContextoItau(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    const { status, ok, data } = await consultarPagamentoSispag(ctx.ambiente, idPagamentoSispag);
    if (!ok) {
      return { ok: false, erro: `Consulta rejeitada pela API do Itaú (HTTP ${status}).` };
    }
    // Mesmo embrulho extra "data" do endpoint de listagem, ver nota acima.
    return { ok: true, info: { pagamento: data?.data ?? data, ambiente: ctx.ambiente } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
