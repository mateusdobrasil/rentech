'use server';

// app/admin/financeiro/integracao/actions.ts
// Consultas à API do Itaú (SISPAG/Cash Management) — complementa o envio de
// pagamentos feito em app/admin/rh/actions/actions-financeiro.ts com o lado
// de leitura: GET /pagamentos_sispag cobre TODOS os pagamentos lançados no
// SISPAG (via API ou via arquivo CNAB manual), não só os enviados por aqui —
// serve para conciliação/auditoria. Cliente HTTP real em app/lib/itauSispag.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
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
  const { data: integ } = await db.from('parametros_integracoes')
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

// ORDENAÇÃO — a API do Itaú devolve os pagamentos na ordem dela (na prática,
// os mais antigos primeiro) e não expõe parâmetro de ordenação. Ordenar só a
// página recebida não resolveria nada: a "página 1" continuaria sendo a das
// datas mais antigas, e o pagamento de ontem ficaria escondido na última.
// Por isso, quando o resultado cabe num número razoável de páginas, buscamos
// TODAS antes de ordenar e a tela pagina em cima do conjunto já ordenado.
// Acima desse teto a consulta volta ao modo página a página da API (a tela
// avisa), pra não disparar dezenas de chamadas ao banco numa consulta só.
const MAX_PAGINAS_AGREGADAS = 20;
// Quantas páginas buscar ao mesmo tempo. Sequencial ficaria lento demais pro
// limite de tempo de uma Server Action; tudo de uma vez arriscaria esbarrar
// em rate limit do Itaú.
const PAGINAS_EM_PARALELO = 4;

// Data comparável (AAAAMMDD) a partir do que a API devolve — ISO na prática,
// mas aceita dd/mm/aaaa por segurança. Sem data reconhecível vira '' e o item
// cai pro fim da lista, em vez de embaralhar o resto.
const chaveData = (valor: unknown): string => {
  const d = String(valor || '');
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}${br[2]}${br[1]}`;
  return '';
};

const numeroOuZero = (valor: unknown): number => {
  const n = Number(String(valor || '').replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Mais recentes primeiro; empate na data cai pro lote e pro lançamento mais
// altos, que é a ordem em que foram lançados no dia.
function ordenarMaisRecentesPrimeiro<T extends Record<string, unknown>>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const dataA = chaveData(a?.data_pagamento);
    const dataB = chaveData(b?.data_pagamento);
    if (dataA !== dataB) {
      if (!dataA) return 1;
      if (!dataB) return -1;
      return dataB.localeCompare(dataA);
    }
    const loteDiff = numeroOuZero(b?.numero_lote) - numeroOuZero(a?.numero_lote);
    if (loteDiff !== 0) return loteDiff;
    return numeroOuZero(b?.numero_lancamento) - numeroOuZero(a?.numero_lancamento);
  });
}

type ContextoItau = { ambiente: AmbienteItau; agenciaOperacao: string; contaOperacao: string; cnpjEmpresa: string };
type PaginaItau = { itens: Record<string, unknown>[]; total: unknown; paginaAtual: number; totalPaginas: number; totalItens: number; tamanhoPagina: number };

async function buscarPaginaItau(ctx: ContextoItau, filtros: FiltrosConsultaItau, page: number): Promise<PaginaItau> {
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
    page,
    pageSize: filtros.pageSize,
  });
  if (!ok) {
    throw new Error(`Consulta rejeitada pela API do Itaú (HTTP ${status}): ${data?.mensagem || JSON.stringify(data || {}).slice(0, 300)}`);
  }
  // A API do Itaú embrulha o corpo de sucesso num nível extra "data" (ex.:
  // {"data":{"itens":[...],"total":"998.99"},"pagination":{...}}) —
  // confirmado por curl direto contra o sandbox (2026-08-07), diferente do
  // que a Especificação Técnica dava a entender.
  // `pagination` era descartado aqui, então a tela mostrava só a 1ª página
  // (20 itens) sem avisar que existiam mais — em produção já vimos
  // totalElements 68 / totalPages 4.
  const itens: Record<string, unknown>[] = data?.data?.itens || [];
  const paginacao = data?.pagination || {};
  return {
    itens,
    total: data?.data?.total ?? null,
    paginaAtual: Number(paginacao.page ?? page),
    totalPaginas: Number(paginacao.totalPages ?? paginacao.total_pages ?? 1),
    totalItens: Number(paginacao.totalElements ?? paginacao.total_elements ?? itens.length),
    tamanhoPagina: Number(paginacao.pageSize ?? paginacao.page_size ?? 20),
  };
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

    const primeira = await buscarPaginaItau(ctx, filtros, filtros.page ?? 0);

    // Um log só por chamada desta action, não por página buscada — uma
    // consulta agregada pode disparar até MAX_PAGINAS_AGREGADAS requisições
    // reais ao Itaú, e isso é implementação, não uma "ação" nova cada vez.
    registrarLogAuditoria({
      usuario_nome: acesso.perfil.nome,
      acao: `CONSULTOU PAGAMENTOS NO ITAÚ (${filtros.dataInicial} a ${filtros.dataFinal})`,
      setor: 'FINANCEIRO / RH',
    });

    // Cabe agregar: busca o resto e devolve tudo ordenado de uma vez, com a
    // paginação passando a ser responsabilidade da tela.
    if (primeira.totalPaginas > 1 && primeira.totalPaginas <= MAX_PAGINAS_AGREGADAS) {
      const restantes = Array.from({ length: primeira.totalPaginas - 1 }, (_, i) => i + 1);
      const itens = [...primeira.itens];
      for (let i = 0; i < restantes.length; i += PAGINAS_EM_PARALELO) {
        const bloco = await Promise.all(
          restantes.slice(i, i + PAGINAS_EM_PARALELO).map(p => buscarPaginaItau(ctx, filtros, p))
        );
        for (const pagina of bloco) itens.push(...pagina.itens);
      }
      const ordenados = ordenarMaisRecentesPrimeiro(itens);
      return {
        ok: true,
        info: {
          itens: ordenados,
          total: primeira.total,
          ambiente: ctx.ambiente,
          // ordemCompleta: a tela pode paginar localmente sabendo que a
          // ordenação vale pro resultado inteiro, não só pra uma fatia.
          ordemCompleta: true,
          paginaAtual: 0,
          totalPaginas: primeira.totalPaginas,
          totalItens: ordenados.length,
          tamanhoPagina: primeira.tamanhoPagina,
        },
      };
    }

    // Resultado grande demais (ou página única): mantém a paginação da API e
    // ordena o que veio. Com uma página só isso já é a ordem final.
    return {
      ok: true,
      info: {
        itens: ordenarMaisRecentesPrimeiro(primeira.itens),
        total: primeira.total,
        ambiente: ctx.ambiente,
        ordemCompleta: primeira.totalPaginas <= 1,
        paginaAtual: primeira.paginaAtual,
        totalPaginas: primeira.totalPaginas,
        totalItens: primeira.totalItens,
        tamanhoPagina: primeira.tamanhoPagina,
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

    registrarLogAuditoria({
      usuario_nome: acesso.perfil.nome,
      acao: `CONSULTOU PAGAMENTO NO ITAÚ (SISPAG ${idPagamentoSispag})`,
      setor: 'FINANCEIRO / RH',
    });

    // Mesmo embrulho extra "data" do endpoint de listagem, ver nota acima.
    return { ok: true, info: { pagamento: data?.data ?? data, ambiente: ctx.ambiente } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
