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
  consultarPagamentosSispag, consultarPagamentoSispag, credenciaisItauConfiguradas, semAcento,
  type AmbienteItau,
} from '../../../lib/itauSispag';
import { consultarObjetos, buscarObjeto, criterio, marcarContaPagarQuitada, dataParaP2s, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';
import { resolverNomes, paraDataISO, refOuNull, textoOuNull } from '../contas-pagar/contasPagarCore';
import { revalidatePath } from 'next/cache';

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

// ============================================================================
// CONCILIAÇÃO P2S x ITAÚ — cobre contas a pagar lançadas DIRETO no PrimeStart
// (fora do fluxo de OP do Rentech Web) e pagas direto no banco, que por isso
// nunca recebem baixa automática (marcarContaPagarQuitada só roda hoje a
// partir de uma OP nossa, ver conciliarOpsComItauAction em
// app/admin/financeiro/ops/actions.ts). Casa por VALOR (busca ancorada no
// P2S por valor exato) + nome do favorecido/fornecedor.
//
// Por que buscar o P2S ao vivo por valor, em vez de usar o cache local
// financeiro_contas_pagar: esse cache só guarda contas em aberto com
// vencimento >= hoje (ver contasPagarCore.ts) — contas em aberto VENCIDAS,
// o perfil mais provável de "esqueceram de baixar", ficam de fora dele de
// propósito. Uma consulta por valor distinto dos pagamentos do Itaú no
// período é bem mais barata que varrer todas as contas em aberto (~4700
// num teste anterior) e ainda cobre as vencidas.
// ============================================================================

const SUFIXOS_EMPRESA_CONCILIACAO = /\b(ltda|me|epp|eireli|s\s?\/?\s?a|sa|cia|comercio|comercial|servicos?|industria|distribuidora|participacoes)\b\.?/g;

function normalizarNomeConciliacao(s: string | null | undefined): string {
  return semAcento(s || '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(SUFIXOS_EMPRESA_CONCILIACAO, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 1 = nomes iguais após normalizar; 0.7 = um contém o outro; 0–0.6 =
// interseção de palavras (nomes reordenados/parciais); 0 = nada em comum —
// ainda assim mostrado, pois o valor já bateu (ver casarPorValor abaixo) e
// cabe ao usuário decidir visualmente.
function similaridadeNomesConciliacao(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizarNomeConciliacao(a);
  const nb = normalizarNomeConciliacao(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.7;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  const inter = [...ta].filter(t => tb.has(t)).length;
  if (inter === 0) return 0;
  const uniao = new Set([...ta, ...tb]).size || 1;
  return inter / uniao;
}

function confiancaPorScore(score: number): 'alta' | 'media' | 'baixa' {
  if (score >= 1) return 'alta';
  if (score >= 0.7) return 'media';
  return 'baixa';
}

export interface PagamentoItauConciliacao {
  idPagamento: string | null;
  nomeFavorecido: string | null;
  valor: number;
  dataPagamento: string | null;
  numeroLote: string | null;
}

export interface CandidatoConciliacaoP2sItau {
  p2sOid: string;
  fornecedor: string | null;
  descricao: string | null;
  numDocumento: string | null;
  valor: number;
  dataVencimento: string | null;
  pagamentoItau: PagamentoItauConciliacao;
  confianca: 'alta' | 'media' | 'baixa';
}

// Conta que o /qpo devolveu como candidata (Valor batendo, dentro do
// vencimento pedido), mas que na reconferência (GET /objects/{oid}, fora do
// proxy) já está com FlagQuitado=true — mostrada só informativamente, sem
// pedir baixa de novo.
export interface CandidatoJaQuitadoP2s {
  p2sOid: string;
  fornecedor: string | null;
  descricao: string | null;
  valor: number;
  dataQuitacao: string | null;
}

export interface FiltrosConciliacaoP2sItau {
  dataInicial: string;
  dataFinal: string;
  vencimentoInicial: string;
  vencimentoFinal: string;
}

// Quantas consultas por valor distinto rodam ao mesmo tempo contra o P2S —
// mesmo cuidado de PAGINAS_EM_PARALELO acima, pra não estourar rate limit.
const VALORES_EM_PARALELO = 5;
// Teto de valores distintos consultados numa chamada só — acima disso pede
// pra estreitar o período em vez de disparar centenas de consultas ao P2S.
const MAX_VALORES_CONSULTADOS = 150;

export async function conciliarP2sComItauAction(filtros: FiltrosConciliacaoP2sItau, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  if (!filtros.dataInicial || !filtros.dataFinal) {
    return { ok: false, erro: 'Informe a data inicial e a data final do pagamento.' };
  }
  if (!filtros.vencimentoInicial || !filtros.vencimentoFinal) {
    return { ok: false, erro: 'Informe o período de vencimento a buscar no PrimeStart.' };
  }

  try {
    // Serial P2S (dias desde 30/12/1899) do início/fim do período de
    // vencimento pedido na tela — construído à meia-noite UTC pra bater
    // exatamente com a data escolhida, sem deslizar um dia por fuso horário.
    const serialVencimentoInicial = dataParaP2s(new Date(`${filtros.vencimentoInicial}T00:00:00Z`));
    const serialVencimentoFinal = dataParaP2s(new Date(`${filtros.vencimentoFinal}T00:00:00Z`));
    const ctxItau = await resolverContextoItau(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!ctxItau.ok) return { ok: false, erro: ctxItau.erro };

    // Só pagamentos EFETUADOS entram na conciliação — pendente/não efetuado
    // não justificam baixa nenhuma.
    const filtrosItau: FiltrosConsultaItau = { dataInicial: filtros.dataInicial, dataFinal: filtros.dataFinal, tipoLista: 'Detalhada', status: 'EF' };
    const primeira = await buscarPaginaItau(ctxItau, filtrosItau, 0);
    const itens = [...primeira.itens];
    const pagamentosTruncados = primeira.totalPaginas > MAX_PAGINAS_AGREGADAS;
    if (primeira.totalPaginas > 1) {
      const restantes = Array.from({ length: Math.min(primeira.totalPaginas, MAX_PAGINAS_AGREGADAS) - 1 }, (_, i) => i + 1);
      for (let i = 0; i < restantes.length; i += PAGINAS_EM_PARALELO) {
        const bloco = await Promise.all(
          restantes.slice(i, i + PAGINAS_EM_PARALELO).map(p => buscarPaginaItau(ctxItau, filtrosItau, p))
        );
        for (const pagina of bloco) itens.push(...pagina.itens);
      }
    }

    const pagamentos: PagamentoItauConciliacao[] = itens.map(it => ({
      idPagamento: (it.id_pagamento as string) || null,
      nomeFavorecido: (it.nome_favorecido as string) || (it.nome_beneficiario as string) || null,
      valor: Number(it.valor_pagamento) || 0,
      dataPagamento: (it.data_pagamento as string) || null,
      numeroLote: (it.numero_lote as string) || null,
    })).filter(p => p.valor > 0);

    registrarLogAuditoria({
      usuario_nome: acesso.perfil.nome,
      acao: `CONCILIOU P2S x ITAÚ (${filtros.dataInicial} a ${filtros.dataFinal})`,
      setor: 'FINANCEIRO / RH',
    });

    if (pagamentos.length === 0) {
      return { ok: true, info: { candidatos: [], jaQuitadas: [], totalPagamentosItau: 0, totalContasEncontradas: 0, valoresConsultados: 0, valoresTruncados: false, pagamentosTruncados } };
    }

    // Agrupa por valor (2 casas decimais) — cada bucket vira uma consulta só
    // no P2S, mesmo que vários pagamentos do Itaú compartilhem o valor.
    const porValor = new Map<string, PagamentoItauConciliacao[]>();
    for (const p of pagamentos) {
      const chave = p.valor.toFixed(2);
      if (!porValor.has(chave)) porValor.set(chave, []);
      porValor.get(chave)!.push(p);
    }

    const chavesValor = [...porValor.keys()];
    const valoresTruncados = chavesValor.length > MAX_VALORES_CONSULTADOS;
    const chavesConsultadas = chavesValor.slice(0, MAX_VALORES_CONSULTADOS);

    const ambienteP2s: AmbienteP2s = 'PRODUCAO';
    const contasPorValor = new Map<string, ObjetoP2s[]>();

    for (let i = 0; i < chavesConsultadas.length; i += VALORES_EM_PARALELO) {
      const bloco = chavesConsultadas.slice(i, i + VALORES_EM_PARALELO);
      const resultados = await Promise.all(bloco.map(async chave => {
        const valor = Number(chave);
        const { objectlist } = await consultarObjetos(ambienteP2s, 'TCustomContaPagar', [
          criterio('FlagQuitado', 'eq', 'bool', false),
          criterio('Valor', 'eq', 'dbl', valor),
          criterio('DataVencimento', 'ge', 'dbl', serialVencimentoInicial),
          criterio('DataVencimento', 'le', 'dbl', serialVencimentoFinal),
        ], { proxy: true });
        return { chave, objectlist };
      }));
      for (const r of resultados) contasPorValor.set(r.chave, r.objectlist);
    }

    const todasContas = [...contasPorValor.values()].flat();
    if (todasContas.length === 0) {
      return {
        ok: true,
        info: {
          candidatos: [], jaQuitadas: [], totalPagamentosItau: pagamentos.length, totalContasEncontradas: 0,
          valoresConsultados: chavesConsultadas.length, valoresTruncados, pagamentosTruncados,
        },
      };
    }

    const mapaNomes = await resolverNomes(ambienteP2s, todasContas.map(c => refOuNull(c.Entidade)));

    // Reconferência: o /qpo (proxy=true) já pediu FlagQuitado=false, mas em
    // teoria pode devolver estado levemente desatualizado logo após uma
    // baixa recente (índice de busca vs. objeto de verdade). Como o
    // GET /objects/{oid} não passa pelo proxy, é a fonte mais confiável pra
    // decidir "está mesmo em aberto?" — quem já está quitada de verdade sai
    // da lista de candidatos (não pede baixa de novo) e vira só informativa.
    const oidsUnicos = [...new Set(todasContas.map(c => c.oid))];
    const statusFresco = new Map<string, ObjetoP2s | null>();
    for (let i = 0; i < oidsUnicos.length; i += VALORES_EM_PARALELO) {
      const lote = oidsUnicos.slice(i, i + VALORES_EM_PARALELO);
      const resultados = await Promise.all(lote.map(oid => buscarObjeto(ambienteP2s, oid).catch(() => null)));
      lote.forEach((oid, idx) => statusFresco.set(oid, resultados[idx]));
    }

    const contasAbertasPorValor = new Map<string, ObjetoP2s[]>();
    const jaQuitadas: CandidatoJaQuitadoP2s[] = [];
    for (const [chave, contas] of contasPorValor) {
      const abertas: ObjetoP2s[] = [];
      for (const conta of contas) {
        const fresca = statusFresco.get(conta.oid);
        const quitadaDeVerdade = !!fresca && String(fresca.FlagQuitado) === 'true';
        if (quitadaDeVerdade) {
          const entidadeOid = refOuNull(conta.Entidade);
          jaQuitadas.push({
            p2sOid: conta.oid,
            fornecedor: entidadeOid ? (mapaNomes.get(entidadeOid) || null) : null,
            descricao: textoOuNull(conta.Descricao),
            valor: Number(conta.Valor) || 0,
            dataQuitacao: paraDataISO(fresca!.DataQuitacao),
          });
        } else {
          abertas.push(conta);
        }
      }
      if (abertas.length > 0) contasAbertasPorValor.set(chave, abertas);
    }

    // Corrige o cache local pras contas que já estavam quitadas de verdade
    // no PrimeStart — evita que a mesma divergência apareça de novo na
    // próxima conciliação.
    if (jaQuitadas.length > 0) {
      const db = supabaseAdmin();
      await db.from('financeiro_contas_pagar').upsert(
        jaQuitadas.map(c => ({
          p2s_oid: c.p2sOid,
          fornecedor: c.fornecedor,
          descricao: c.descricao,
          valor: c.valor,
          valor_pago: c.valor,
          quitado: true,
          data_quitacao: c.dataQuitacao,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'p2s_oid' },
      );
    }

    const candidatos: CandidatoConciliacaoP2sItau[] = [];
    for (const chave of chavesConsultadas) {
      const contas = contasAbertasPorValor.get(chave) || [];
      const pagamentosDoValor = porValor.get(chave) || [];
      if (contas.length === 0) continue;

      // Casamento guloso dentro do bucket: ordena todos os pares conta x
      // pagamento por similaridade de nome (desc) e atribui 1-para-1 — cobre
      // tanto o caso comum (1 conta / 1 pagamento) quanto empates de valor
      // entre fornecedores diferentes no mesmo bucket.
      const pares: { contaIdx: number; pagIdx: number; score: number }[] = [];
      contas.forEach((conta, contaIdx) => {
        const entidadeOid = refOuNull(conta.Entidade);
        const fornecedor = entidadeOid ? (mapaNomes.get(entidadeOid) || null) : null;
        pagamentosDoValor.forEach((pag, pagIdx) => {
          pares.push({ contaIdx, pagIdx, score: similaridadeNomesConciliacao(fornecedor, pag.nomeFavorecido) });
        });
      });
      pares.sort((a, b) => b.score - a.score);

      const contasUsadas = new Set<number>();
      const pagamentosUsados = new Set<number>();
      for (const par of pares) {
        if (contasUsadas.has(par.contaIdx) || pagamentosUsados.has(par.pagIdx)) continue;
        contasUsadas.add(par.contaIdx);
        pagamentosUsados.add(par.pagIdx);

        const conta = contas[par.contaIdx];
        const entidadeOid = refOuNull(conta.Entidade);
        const fornecedor = entidadeOid ? (mapaNomes.get(entidadeOid) || null) : null;

        candidatos.push({
          p2sOid: conta.oid,
          fornecedor,
          descricao: textoOuNull(conta.Descricao),
          numDocumento: textoOuNull(conta.NumDocumento),
          valor: Number(conta.Valor) || 0,
          dataVencimento: paraDataISO(conta.DataVencimento),
          pagamentoItau: pagamentosDoValor[par.pagIdx],
          confianca: confiancaPorScore(par.score),
        });
      }
      // Contas do bucket que sobraram sem par (mais contas do que pagamentos
      // com o mesmo valor) ficam de fora — sem um pagamento pra comparar, não
      // há o que mostrar de conciliação pra elas.
    }

    const ORDEM_CONFIANCA = { alta: 0, media: 1, baixa: 2 } as const;
    candidatos.sort((a, b) => ORDEM_CONFIANCA[a.confianca] - ORDEM_CONFIANCA[b.confianca]);

    return {
      ok: true,
      info: {
        candidatos,
        jaQuitadas,
        totalPagamentosItau: pagamentos.length,
        totalContasEncontradas: todasContas.length,
        valoresConsultados: chavesConsultadas.length,
        valoresTruncados,
        pagamentosTruncados,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function darBaixaContaPagarConciliacaoAction(payload: {
  p2sOid: string; valor: number; fornecedor?: string | null; descricao?: string | null; dataQuitacao?: string;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  try {
    const data = payload.dataQuitacao ? new Date(`${payload.dataQuitacao}T12:00:00`) : new Date();

    // Reconfere direto no objeto (fora do proxy) antes de chamar o método de
    // baixa — cobre a corrida entre a busca que montou o grid e o clique
    // aqui (alguém já deu baixa nesse meio-tempo, por outra tela). Se já
    // estiver quitada de verdade, não tenta baixar de novo: só sincroniza o
    // cache local e avisa.
    const objetoAtual = await buscarObjeto('PRODUCAO', payload.p2sOid).catch(() => null);
    const jaEstavaQuitada = !!objetoAtual && String(objetoAtual.FlagQuitado) === 'true';

    if (!jaEstavaQuitada) {
      const baixa = await marcarContaPagarQuitada('PRODUCAO', payload.p2sOid, data);
      if (!baixa.ok) {
        return { ok: false, erro: baixa.motivo || 'PrimeStart recusou a quitação desta conta.' };
      }
    }

    // Reflete a baixa no cache local imediatamente, sem esperar o próximo
    // sync de /admin/financeiro/contas-pagar (mesmo formato de registro de
    // sincronizarContasPagarCore, ver contasPagarCore.ts).
    const dataQuitacaoIso = (jaEstavaQuitada && objetoAtual ? paraDataISO(objetoAtual.DataQuitacao) : null) || data.toISOString().slice(0, 10);
    const db = supabaseAdmin();
    await db.from('financeiro_contas_pagar').upsert({
      p2s_oid: payload.p2sOid,
      fornecedor: payload.fornecedor || null,
      descricao: payload.descricao || null,
      valor: payload.valor,
      valor_pago: payload.valor,
      quitado: true,
      data_quitacao: dataQuitacaoIso,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'p2s_oid' });

    if (!jaEstavaQuitada) {
      registrarLogAuditoria({
        usuario_nome: acesso.perfil.nome,
        acao: `DEU BAIXA NA CONTA A PAGAR (P2S ${payload.p2sOid}) VIA CONCILIAÇÃO COM ITAÚ — FORNECEDOR: ${payload.fornecedor || 's/nome'} — VALOR: R$ ${payload.valor.toFixed(2)}`,
        setor: 'FINANCEIRO / RH',
      });
    }

    revalidatePath('/admin/financeiro/contas-pagar');

    return { ok: true, info: { p2sOid: payload.p2sOid, jaEstavaQuitada } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
