// app/lib/arquivoP2s.ts
// CÓPIA COMPLETA do banco do P2S (2026-11-25), para guardar tudo antes de
// cancelar o contrato. Diferente do histórico (historicoP2s.ts), que traduz
// reservas/locações/títulos para as tabelas do sistema, aqui vai o objeto
// bruto de TODAS as classes, como a API devolve, em p2s_arquivo (uma linha por
// oid). SQL: .sql/Pendentes/p2s_arquivo.sql.
//
// O que aprendemos testando a API de produção (2026-11-25):
// - Não existe endpoint que liste as classes. A lista abaixo saiu de seguir as
//   referências "P,n" entre objetos e de testar nomes ("Class X is not
//   registered" = não existe). Classes novas que aparecerem embutidas em algum
//   objeto entram sozinhas na varredura (descobrirClasses).
// - TCustomX e TX são conjuntos diferentes (ex.: TCondicaoPagamento 52 mil ×
//   TCustomCondicaoPagamento 31 mil) — por isso os dois nomes ficam na lista.
// - A consulta com proxy=true OMITE campos (DataQuitacao da conta a pagar,
//   ChaveNFe/protocolo da NF-e, itens…). Aqui é sempre proxy=false: o objeto
//   inteiro, com os filhos embutidos.
// - Qualquer classe pagina por faixa de oid (critério "oid" ge/lt, int).
//
// Retomável: cursor por classe em p2s_arquivo_classes; o tamanho da faixa se
// ajusta ao volume. Rodar de novo grava por cima (upsert pelo oid). Uma
// "passada nova" zera os cursores para reler tudo — a última deve ser depois
// de todas as empresas concluírem a virada (a leitura do arquivo continua
// liberada com o P2S desligado; ver chamar() em p2s.ts).
import type { supabaseAdmin } from './supabase';
import { consultarObjetos, criterio, p2sParaData, type ObjetoP2s } from './p2s';

type Db = ReturnType<typeof supabaseAdmin>;

export const CLASSES_ARQUIVO: string[] = [
  'TCargo', 'TCartaCorrecaoEletronica', 'TCheque', 'TCondicaoPagamento', 'TCustomAcessoParceiroLojaVirtual', 'TCustomAdministradoraCartao',
  'TCustomAgenciaBancaria', 'TCustomBanco', 'TCustomCargo', 'TCustomCartaCorrecaoEletronica', 'TCustomCarteiraCobranca', 'TCustomCategoriaItemEstoque',
  'TCustomCategoriaProdutoLocall', 'TCustomCentro', 'TCustomCentroCusto', 'TCustomCentroReceita', 'TCustomChavePix', 'TCustomCheque',
  'TCustomClassificacaoPagtoRec', 'TCustomColaborador', 'TCustomCondPagtoPadraoDia', 'TCustomCondicaoPagamento', 'TCustomCondicaoPagamentoPadrao',
  'TCustomContaBancaria', 'TCustomContaPagar', 'TCustomContaReceber', 'TCustomContadorUtilizacaoItemEstoque', 'TCustomContato', 'TCustomDadosBancarios',
  'TCustomDepartamento', 'TCustomDeptoColaborador', 'TCustomDeptoPontoAprovCompras', 'TCustomEndereco', 'TCustomEntrega', 'TCustomEstoque',
  'TCustomEvento', 'TCustomEventoNFe', 'TCustomFeriado', 'TCustomFichaLocacao', 'TCustomFichaLocacaoItem', 'TCustomFichaLocacaoItemContador',
  'TCustomFichaLocacaoItemExtra', 'TCustomFichaResLocItemContador', 'TCustomFichaResLocItemExtra', 'TCustomFichaReservaLocacao',
  'TCustomFichaReservaLocacaoDespesa', 'TCustomFichaReservaLocacaoItem', 'TCustomFichaReservaLocacaoSalaRef', 'TCustomFollowUp',
  'TCustomFormaPagCartParamsRec', 'TCustomFormaPagPagSegParamsRec', 'TCustomFormaPagamento', 'TCustomFormaPagamentoLojaVirtual',
  'TCustomGrupoCentroReceita', 'TCustomHorarioColaborador', 'TCustomHumorFollowUp', 'TCustomInfoItemEstoque', 'TCustomItemEstoqueIndividual',
  'TCustomListaDocsParaAssinarAssociados', 'TCustomLocalEventoPadrao', 'TCustomLojaVirtual', 'TCustomLoteEnvioNFe', 'TCustomMDFe', 'TCustomMarca',
  'TCustomMotivoReprovacaoComercial', 'TCustomMovimentacaoEstoque', 'TCustomMovimentacaoFinanceira', 'TCustomNFeItemCOFINS', 'TCustomNFeItemIBSCBS',
  'TCustomNFeItemICMS', 'TCustomNFeItemICMSOpInterestadual', 'TCustomNFeItemII', 'TCustomNFeItemIPI', 'TCustomNFeItemIPIDevolvido',
  'TCustomNFeItemISSQN', 'TCustomNFeItemInfoIBSOuCBS', 'TCustomNFeItemPIS', 'TCustomNFeItemProdEspMedicamento', 'TCustomNaturezaOperacao',
  'TCustomNotaDebito', 'TCustomNotaFiscal', 'TCustomNotaFiscalEletronica', 'TCustomNotaFiscalEletronicaComEx', 'TCustomNotaFiscalEletronicaCompraGov',
  'TCustomNotaFiscalEletronicaItem', 'TCustomNotaFiscalEletronicaLocEnt', 'TCustomOrdemCompra', 'TCustomOrdemServico', 'TCustomPagamento',
  'TCustomPagamentoRecebimento', 'TCustomParamsAssinaturaEletronica', 'TCustomParceiro', 'TCustomParceiroCNAESecundario', 'TCustomPedidoCompra',
  'TCustomPedidoVenda', 'TCustomProduto', 'TCustomProdutoConfigLV', 'TCustomProdutoFotoLV', 'TCustomProdutoPreco', 'TCustomQtdMinimaItemEstoque',
  'TCustomRPS', 'TCustomRecebimento', 'TCustomSala', 'TCustomSelecaoTemplateDocumento', 'TCustomSocio', 'TCustomStatusComercial',
  'TCustomSubCategoriaItemEstoque', 'TCustomSubCentroCusto', 'TCustomSubCentroReceita', 'TCustomSubTopicoFollowUp', 'TCustomTabelaPreco',
  'TCustomTarefa', 'TCustomTipoEvento', 'TCustomTipoLocacao', 'TCustomTipoVenda', 'TCustomTopicoFollowUp', 'TCustomUnidadeNegocio',
  'TCustomVariavelLojaVirtual', 'TEntrega', 'TEventoNFe', 'TFeriado', 'TFichaReservaLocacaoDespesa', 'TMDFe', 'TMovimentacaoFinanceira',
  'TNFeItemCOFINS', 'TNotaDebito', 'TNotaFiscal', 'TOrdemCompra', 'TOrdemServico', 'TPagamento', 'TPagamentoRecebimento', 'TParticipacaoSocietaria',
  'TPedidoCompra', 'TPedidoVenda', 'TRPS', 'TRecebimento', 'TSala', 'TTarefa',
];

// Maior oid visto em produção em 2026-11-25 ≈ 2,77 mi. A varredura de uma
// classe acaba quando passa do maior oid já visto em qualquer classe + folga.
const TETO_MINIMO = 2_800_000;
const FOLGA_TETO = 150_000;
const PASSO_MIN = 2_000;
const PASSO_MAX = 800_000;
const ALVO_OBJETOS = 400;        // por consulta
const ALVO_BYTES = 6_000_000;    // ~6 MB de JSON por consulta
const LOTE_GRAVACAO = 150;

export interface EstadoClasseArquivo {
  grupo: string; passada: number; cursor_oid: number; passo: number; concluido: boolean;
  registros: number; maior_oid: number; ultimo_erro: string | null; concluido_em: string | null; atualizado_em: string;
}

const numOid = (oid: string) => Number(String(oid).split(',')[1]) || 0;
const agora = () => new Date().toISOString();

/** Classnames de todo objeto embutido (filhos, referências expandidas). */
function classesEmbutidas(v: unknown, acc: Set<string>, raiz = true) {
  if (Array.isArray(v)) { for (const x of v) classesEmbutidas(x, acc, false); return; }
  if (!v || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  if (!raiz && typeof o.classname === 'string' && typeof o.oid === 'string' && o.oid.startsWith('P,')) acc.add(o.classname);
  for (const x of Object.values(o)) if (x && typeof x === 'object') classesEmbutidas(x, acc, false);
}

/** Garante uma linha de progresso para cada classe da lista (e as descobertas). */
async function garantirClasses(db: Db, nomes: string[], passada: number): Promise<void> {
  if (!nomes.length) return;
  const { error } = await db.from('p2s_arquivo_classes')
    .upsert(nomes.map(grupo => ({ grupo, passada })), { onConflict: 'grupo', ignoreDuplicates: true });
  if (error) throw error;
}

export async function estadoArquivo(db: Db): Promise<EstadoClasseArquivo[]> {
  const { data, error } = await db.from('p2s_arquivo_classes').select('*').order('grupo');
  if (error) throw error;
  return (data || []) as EstadoClasseArquivo[];
}

async function passadaAtual(db: Db): Promise<number> {
  const { data } = await db.from('p2s_arquivo_classes').select('passada').order('passada', { ascending: false }).limit(1);
  return Number(data?.[0]?.passada) || 1;
}

/** Zera os cursores para reler tudo (os dados lidos ficam; a releitura grava por cima). */
export async function novaPassadaArquivo(db: Db): Promise<number> {
  const passada = (await passadaAtual(db)) + 1;
  await garantirClasses(db, CLASSES_ARQUIVO, passada);
  const { error } = await db.from('p2s_arquivo_classes').update({
    passada, cursor_oid: 0, concluido: false, registros: 0, ultimo_erro: null, concluido_em: null, atualizado_em: agora(),
  }).neq('grupo', '');
  if (error) throw error;
  return passada;
}

async function gravar(db: Db, grupo: string, passada: number, objetos: ObjetoP2s[]): Promise<void> {
  for (let i = 0; i < objetos.length; i += LOTE_GRAVACAO) {
    const linhas = objetos.slice(i, i + LOTE_GRAVACAO).map(o => ({
      oid: o.oid,
      classe: o.classname,
      grupo,
      dados: o,
      p2s_alterado_em: typeof o.lastupdatetimestamp === 'number' && o.lastupdatetimestamp > 0 ? p2sParaData(o.lastupdatetimestamp)?.toISOString() ?? null : null,
      lido_em: agora(),
      passada,
    }));
    const { error } = await db.from('p2s_arquivo').upsert(linhas, { onConflict: 'oid' });
    if (error) throw new Error(`gravar ${grupo}: ${error.message}`);
  }
}

// Classe que a API não deixa consultar (utilitária ou inexistente): pula, sem erro.
const naoConsultavel = (msg: string) => /not registered|not persistent/i.test(msg);

export interface PassoArquivo { grupo: string; faixa: string; lidos: number; erro?: string }

/** Lê UMA faixa de oid de uma classe, grava e avança o cursor. */
async function rodarFaixa(db: Db, e: EstadoClasseArquivo, teto: number, conhecidas: Set<string>): Promise<PassoArquivo> {
  const de = Number(e.cursor_oid) || 0;
  let passo = Math.min(PASSO_MAX, Math.max(PASSO_MIN, Number(e.passo) || 200_000));
  const ate = de + passo;
  const faixa = `${de.toLocaleString('pt-BR')}–${ate.toLocaleString('pt-BR')}`;
  const t0 = Date.now();
  let r;
  try {
    r = await consultarObjetos('PRODUCAO', e.grupo, [criterio('oid', 'ge', 'int', de), criterio('oid', 'lt', 'int', ate)], { proxy: false, leituraArquivo: true });
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (naoConsultavel(msg)) {
      await db.from('p2s_arquivo_classes').update({ concluido: true, concluido_em: agora(), ultimo_erro: 'não consultável pela API (classe utilitária)', atualizado_em: agora() }).eq('grupo', e.grupo);
      return { grupo: e.grupo, faixa, lidos: 0 };
    }
    // Faixa grande demais (timeout/estouro): tenta de novo com a metade.
    const menor = Math.max(PASSO_MIN, Math.floor(passo / 4));
    await db.from('p2s_arquivo_classes').update({ passo: menor, ultimo_erro: `${faixa}: ${msg}`.slice(0, 500), atualizado_em: agora() }).eq('grupo', e.grupo);
    throw err;
  }
  const objetos = (r.objectlist || []).filter(o => o?.oid?.startsWith('P,'));
  await gravar(db, e.grupo, e.passada, objetos);

  // Classes embutidas que ainda não estão na varredura entram nela.
  const achadas = new Set<string>();
  for (const o of objetos) classesEmbutidas(o, achadas);
  const novas = [...achadas].filter(c => !conhecidas.has(c));
  if (novas.length) { await garantirClasses(db, novas, e.passada); novas.forEach(c => conhecidas.add(c)); }

  // Próxima faixa: mira ~ALVO_OBJETOS objetos / ALVO_BYTES por consulta.
  const bytes = JSON.stringify(r.objectlist || []).length;
  const ms = Date.now() - t0;
  if (objetos.length > ALVO_OBJETOS * 2 || bytes > ALVO_BYTES * 2 || ms > 60_000) passo = Math.floor(passo / 2);
  else if (objetos.length < ALVO_OBJETOS / 4 && bytes < ALVO_BYTES / 4 && ms < 10_000) passo = passo * 2;
  passo = Math.min(PASSO_MAX, Math.max(PASSO_MIN, passo));

  const maior = Math.max(Number(e.maior_oid) || 0, ...objetos.map(o => numOid(o.oid)));
  const concluido = ate >= teto;
  const { error } = await db.from('p2s_arquivo_classes').update({
    cursor_oid: ate, passo, maior_oid: maior, registros: (Number(e.registros) || 0) + objetos.length,
    concluido, concluido_em: concluido ? agora() : null, ultimo_erro: null, atualizado_em: agora(),
  }).eq('grupo', e.grupo);
  if (error) throw error;
  return { grupo: e.grupo, faixa, lidos: objetos.length };
}

/**
 * Avança a cópia enquanto houver tempo, uma faixa de cada classe pendente por
 * volta. Erro numa classe para só ela nesta rodada (na próxima tenta com faixa menor).
 */
export async function avancarArquivoP2s(db: Db, orcamentoMs: number, aoPasso?: (p: PassoArquivo) => void): Promise<{ passos: PassoArquivo[]; pendentes: number }> {
  const inicio = Date.now();
  const passos: PassoArquivo[] = [];
  const comErro = new Set<string>();
  let passada = await passadaAtual(db);
  await garantirClasses(db, CLASSES_ARQUIVO, passada);
  for (;;) {
    const estados = await estadoArquivo(db);
    passada = Math.max(passada, ...estados.map(e => Number(e.passada) || 1));
    const conhecidas = new Set(estados.map(e => e.grupo));
    const teto = Math.max(TETO_MINIMO, ...estados.map(e => Number(e.maior_oid) || 0)) + FOLGA_TETO;
    const pendentes = estados.filter(e => !e.concluido && !comErro.has(e.grupo));
    if (!pendentes.length) return { passos, pendentes: estados.filter(e => !e.concluido).length };
    for (const e of pendentes) {
      if (Date.now() - inicio > orcamentoMs) return { passos, pendentes: pendentes.length };
      try {
        const p = await rodarFaixa(db, e, teto, conhecidas);
        passos.push(p); aoPasso?.(p);
      } catch (err: any) {
        comErro.add(e.grupo);
        const p = { grupo: e.grupo, faixa: String(e.cursor_oid), lidos: 0, erro: String(err?.message || err) };
        passos.push(p); aoPasso?.(p);
      }
    }
  }
}

/** Resumo para a tela: progresso por classe + o que já está guardado. */
export async function resumoArquivo(db: Db) {
  const estados = await estadoArquivo(db);
  const { count } = await db.from('p2s_arquivo').select('oid', { count: 'exact', head: true });
  const teto = Math.max(TETO_MINIMO, ...estados.map(e => Number(e.maior_oid) || 0)) + FOLGA_TETO;
  const concluidas = estados.filter(e => e.concluido).length;
  const lidoOid = estados.reduce((s, e) => s + Math.min(teto, Number(e.cursor_oid) || 0), 0);
  return {
    passada: Math.max(1, ...estados.map(e => Number(e.passada) || 1)),
    classes: estados.length,
    concluidas,
    pct: estados.length ? Math.round((lidoOid / (teto * estados.length)) * 100) : 0,
    objetos: count || 0,
    registrosPassada: estados.reduce((s, e) => s + (Number(e.registros) || 0), 0),
    comErro: estados.filter(e => e.ultimo_erro && !e.concluido).map(e => ({ grupo: e.grupo, erro: e.ultimo_erro })),
    maiores: [...estados].sort((a, b) => (Number(b.registros) || 0) - (Number(a.registros) || 0)).slice(0, 12).map(e => ({ grupo: e.grupo, registros: Number(e.registros) || 0, concluido: e.concluido })),
    concluidaEm: concluidas === estados.length && estados.length ? estados.map(e => e.concluido_em || '').sort().pop() || null : null,
  };
}
