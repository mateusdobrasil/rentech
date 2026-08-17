'use server';

// app/admin/estoque/expedicao/actions.ts
// Escrita no PrimeStart (P2S): ao finalizar um Checklist de Carga vinculado
// a um evento, registra a devolução de todas as Fichas de Locação daquele
// evento que ainda não estiverem finalizadas.
//
// Primeira tentativa (2026-08-17, abandonada): dar Update genérico direto no
// campo Status="F" da Ficha de Locação. O PUT era aceito (204) mas o campo
// voltava sozinho pra "A" — Status é recalculado por lógica interna do
// servidor, não é setável direto. Confirmado com o suporte da P2S: o jeito
// certo é chamar o método de negócio gExpedicao.EfetuaRetornoLocacao (objeto
// singleton do servidor, oid obtido via GET /objects/gExpedicao).
//
// Mapeamento validado empiricamente em Sandbox (2026-08-17, Ficha 000005/A,
// oid P,7893): a API pede os oids em AArrayFichaReservaLocacaoItem, mas o
// valor certo NÃO é o oid do próprio item da Ficha de Locação — é o valor do
// campo "PrevisaoMovEstoque" desse item, que referencia um objeto de classe
// TCustomFichaReservaLocacaoItem (mesmo nome do parâmetro). A quantidade
// pendente de devolução vem do campo "QuantidadeNaoRetPositiva" desse mesmo
// objeto (o PrimeStart já mantém isso atualizado, inclusive descontando
// devoluções parciais anteriores) — não é recalculada aqui a partir da
// Ficha de Locação. Teste confirmou round-trip completo: Status virou "F",
// DataUltimaMovDevolucao foi preenchido e o saldo de estoque voltou.
//
// Itens com controle individual (numeração patrimonial, campo
// ItemEstoqueIndividual) entram também em AArrayItemIndividual — um array
// PARALELO e de tamanho INDEPENDENTE do array de linhas
// (AArrayFichaReservaLocacaoItem): pode haver várias unidades individuais
// devolvidas para a mesma linha/reserva (ex: 3 unidades seriadas do mesmo
// equipamento), cada uma referenciando de volta a linha via
// AArrayFichaReservaLocacaoItemCorrespond.
//
// Descoberta crítica em produção (2026-08-10, ainda válida aqui): filtrar
// TCustomFichaLocacao pelo campo de referência "Evento" usando propvaluetype
// "str" com o oid completo ("P,573460") NÃO dá erro — só ignora o critério
// silenciosamente e devolve TODAS as fichas. O formato correto é
// propvaluetype "int" com só a parte numérica do oid — ver criterioRef() em
// app/lib/p2s.ts.
import { buscarObjeto, consultarObjetos, criterioRef, dataParaP2s, invocarMetodo, type AmbienteP2s, type ObjetoP2s, type ParametroMetodoP2s } from '../../../lib/p2s';
import { validarAcesso } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/estoque/expedicao';
const STATUS_FINALIZADA = 'F';

export interface FinalizarFichasLocacaoInfo {
  totalFichasDoEvento: number;
  jaEstavamFinalizadas: number;
  atualizadas: number;
  falhas: { numero: string; erro: string }[];
}

function refOuNull(v: unknown): string | undefined {
  const s = v ? String(v) : '';
  return s && s !== 'null' ? s : undefined;
}

function paramMetodo(paramname: string, paramtype: ParametroMetodoP2s['paramtype'], paramvalue: string | string[]): ParametroMetodoP2s {
  return { paramname, paramtype, paramvalue };
}

// Devolve todos os itens de saída ainda pendentes de uma Ficha de Locação,
// via gExpedicao.EfetuaRetornoLocacao. Retorna pulou=true quando não havia
// nada pendente pra essa ficha (idempotente — seguro chamar de novo).
async function devolverFichaLocacao(ambiente: AmbienteP2s, gExpedicaoOid: string, ficha: ObjetoP2s, observacaoGeral: string): Promise<{ pulou: boolean }> {
  const itens = Array.isArray(ficha.Itens) ? (ficha.Itens as any[]) : [];
  const itensSaida = itens.filter(it => Number(it?.QuantidadeMovimentada) < 0 && refOuNull(it?.PrevisaoMovEstoque));

  if (itensSaida.length === 0) return { pulou: true };

  const oidsReserva = [...new Set(itensSaida.map(it => String(it.PrevisaoMovEstoque)))];
  const reservaObjs = await Promise.all(oidsReserva.map(oid => buscarObjeto(ambiente, oid)));
  const mapaReserva = new Map(oidsReserva.map((oid, idx) => [oid, reservaObjs[idx]]));

  // Uma linha (Group A) por item de reserva distinto, com a quantidade TOTAL
  // ainda pendente pra ele — mesmo que várias unidades individuais (Group B)
  // apontem pra essa mesma linha.
  const reservaPendentes = new Map<string, number>();
  for (const oid of oidsReserva) {
    const obj = mapaReserva.get(oid);
    if (!obj) throw new Error(`Item de reserva ${oid} referenciado pela Ficha ${ficha.Numero || ficha.oid} não foi encontrado no PrimeStart.`);
    const pendente = Number(obj.QuantidadeNaoRetPositiva) || 0;
    if (pendente > 0) reservaPendentes.set(oid, pendente);
  }

  if (reservaPendentes.size === 0) return { pulou: true };

  const arrFichaReservaItem = [...reservaPendentes.keys()];
  const arrQuantidade = arrFichaReservaItem.map(oid => String(reservaPendentes.get(oid)));
  const arrFlagData = arrFichaReservaItem.map(() => 'T');
  const arrObsItem = arrFichaReservaItem.map(() => '');

  const arrIndividual: string[] = [];
  const arrQtdFracIndividual: string[] = [];
  const arrIndividualCorrespond: string[] = [];
  for (const item of itensSaida) {
    const reservaOid = String(item.PrevisaoMovEstoque);
    if (!reservaPendentes.has(reservaOid)) continue;
    const individualOid = refOuNull(item.ItemEstoqueIndividual);
    if (individualOid) {
      arrIndividual.push(individualOid);
      arrQtdFracIndividual.push('1');
      arrIndividualCorrespond.push(reservaOid);
    }
  }

  const serial = dataParaP2s(new Date());
  const dataSerial = String(Math.floor(serial));
  const horaSerial = String(serial - Math.floor(serial));

  const paramlist: ParametroMetodoP2s[] = [
    paramMetodo('ADataMovimentacao', 'dbl', dataSerial),
    paramMetodo('AHoraMovimentacao', 'dbl', horaSerial),
    paramMetodo('ADataFinalFaturamento', 'dbl', dataSerial),
    paramMetodo('AHoraFinalFaturamento', 'dbl', horaSerial),
    paramMetodo('AObservacoes', 'str', observacaoGeral),
    paramMetodo('AFlagTroca', 'bool', 'F'),
    paramMetodo('AFichaLocacao', 'oid', ficha.oid),
    paramMetodo('AArrayFlagAtualizaDataFinalParaFaturamento', 'bool', arrFlagData),
    paramMetodo('AArrayFichaReservaLocacaoItem', 'oid', arrFichaReservaItem),
    paramMetodo('AArrayQuantidade', 'dbl', arrQuantidade),
    paramMetodo('ADevolucaoIncompleta', 'bool', 'F'),
    paramMetodo('AArrayItemIndividual', 'oid', arrIndividual),
    paramMetodo('AArrayQtdFracionadaItemInd', 'dbl', arrQtdFracIndividual),
    paramMetodo('AArrayFichaReservaLocacaoItemCorrespond', 'oid', arrIndividualCorrespond),
    paramMetodo('AEstoqueParaTransferir', 'oid', 'null'),
    paramMetodo('AArrayObservacoes', 'str', arrObsItem),
  ];

  const resposta = await invocarMetodo(ambiente, 'TCustomExpedicao', 'EfetuaRetornoLocacao', gExpedicaoOid, paramlist);
  const paramErros = resposta.paramlist.find(p => p.paramname === 'AArrayMensagemErro');
  const listaErros = (Array.isArray(paramErros?.paramvalue) ? paramErros.paramvalue : []).filter(Boolean);
  if (listaErros.length > 0) {
    throw new Error(listaErros.join('; '));
  }

  return { pulou: false };
}

// Busca as Fichas de Locação do evento (por oid do PrimeStart) e registra a
// devolução das que ainda não estiverem Finalizadas. Idempotente — pode ser
// chamada de novo sem duplicar efeito (fichas já "F", ou itens já devolvidos
// dentro de uma ficha parcial, são só pulados).
export async function finalizarFichasLocacaoPorEventoAction(eventoP2sOid: string, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  if (!eventoP2sOid) return { ok: false, erro: 'Checklist não está vinculado a um evento do PrimeStart.' };

  const ambiente: AmbienteP2s = 'PRODUCAO';

  try {
    const resultado = await consultarObjetos(ambiente, 'TCustomFichaLocacao', [
      criterioRef('Evento', eventoP2sOid),
    ]);

    const pendentes = resultado.objectlist.filter(f => String(f.Status) !== STATUS_FINALIZADA);
    const falhas: { numero: string; erro: string }[] = [];
    let atualizadas = 0;

    if (pendentes.length > 0) {
      const gExpedicao = await buscarObjeto(ambiente, 'gExpedicao');
      if (!gExpedicao) throw new Error('Objeto gExpedicao não encontrado no PrimeStart.');

      for (const ficha of pendentes) {
        try {
          const { pulou } = await devolverFichaLocacao(ambiente, gExpedicao.oid, ficha, 'Devolucao via Checklist de Carga (Rentech Web)');
          if (!pulou) atualizadas++;
        } catch (e: any) {
          falhas.push({ numero: String(ficha.Numero || ficha.oid), erro: e.message });
        }
      }
    }

    const info: FinalizarFichasLocacaoInfo = {
      totalFichasDoEvento: resultado.count,
      jaEstavamFinalizadas: resultado.objectlist.length - pendentes.length,
      atualizadas,
      falhas,
    };
    return { ok: true, info };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
