// app/admin/financeiro/contas-pagar/contasPagarCore.ts
// Lógica de negócio do sync de Contas a Pagar, SEM "use server" — importada
// tanto por actions.ts (que expõe a versão protegida por accessToken pra UI)
// quanto por app/api/cron/sync-p2s/route.ts (rotina agendada, protegida só
// por CRON_SECRET, sem sessão de usuário). Ficar fora de um arquivo
// "use server" é o que garante que esta função não vira um endpoint de
// Server Action chamável direto por qualquer um — só é alcançável via
// import server-side. Mesmo padrão de
// app/admin/rh/actions/consignadoCore.ts.
//
// Descobertas empíricas em produção (2026-08-10, 4787 contas em aberto no
// total, ~13KB/registro completo):
// - proxy=true reduz o payload em ~27x (62MB → 1,9MB pros mesmos 1384
//   registros) e mantém todos os campos usados aqui — inclusive
//   DescricaoCentroFinanceiro/DescricaoSubCentroFinanceiro, que já vêm como
//   texto pronto (sem precisar resolver referência).
// - Existem registros com DataVencimento claramente corrompida (valores
//   absurdos como -620149, dias antes do ano 0) — provavelmente lixo de
//   migração antiga. O filtro por janela de datas (abaixo) já exclui esses
//   registros por não caírem no intervalo, mas paraDataISO() também rejeita
//   qualquer serial fora de uma faixa sã como defesa extra.
// - Nem toda conta tem Entidade (fornecedor) ou FormaPagamento vinculados —
//   por isso a tabela não tem NOT NULL nesses campos.
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, buscarObjeto, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';
import { registrarSincronizacao } from '../../../lib/syncLog';
import { carregarEmpresasCadastro } from '../../../lib/empresa';
import { resolverCentrosP2s, empresaIdDoCentroP2s } from '../../../lib/empresaP2s';

type Resultado = { ok: boolean; erro?: string; info?: any };

// Exportadas para reuso em app/admin/financeiro/integracao/actions.ts
// (conciliarP2sComItauAction) — resolve nome de fornecedor a partir do oid
// de Entidade sem duplicar a mesma lógica de lote/fallback aqui.
export function nomeExibicao(obj: ObjetoP2s | null): string | null {
  if (!obj) return null;
  const nome = (obj.NomeExibicao || obj.NomeCompleto || obj.Nome || '') as string;
  return nome || null;
}

export async function resolverNomes(ambiente: AmbienteP2s, oids: (string | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(oids.filter((oid): oid is string => !!oid && oid !== 'null'))];
  const mapa = new Map<string, string>();
  const TAMANHO_LOTE = 8;
  for (let i = 0; i < unicos.length; i += TAMANHO_LOTE) {
    const lote = unicos.slice(i, i + TAMANHO_LOTE);
    const objetos = await Promise.all(lote.map(oid => buscarObjeto(ambiente, oid).catch(() => null)));
    objetos.forEach((obj, idx) => {
      const nome = nomeExibicao(obj);
      if (nome) mapa.set(lote[idx], nome);
    });
  }
  return mapa;
}

// Serial fora dessa faixa (aprox. anos 1900–2173) é lixo, não data real — ver
// nota no topo do arquivo sobre DataVencimento corrompida encontrada em
// produção.
export function paraDataISO(serial: unknown): string | null {
  const n = Number(serial);
  if (!n || n < 1 || n > 100_000) return null;
  const data = p2sParaData(n);
  return data ? data.toISOString().slice(0, 10) : null;
}

// Data de quitação de uma conta (a pagar ou a receber) do P2S. Com
// proxy=true a API NÃO devolve o campo DataQuitacao (só a consulta completa
// por oid traz) — o que vem é ListaDatasPagamentos, texto "dd/mm/aaaa" (uma
// data por pagamento). Descoberto em 2026-11-15: das 2.896 contas a pagar
// quitadas sincronizadas, só 2 tinham data_quitacao. Usa DataQuitacao quando
// existir e, senão, a ÚLTIMA data da lista (a que fechou o título).
export function dataQuitacaoISO(o: ObjetoP2s): string | null {
  const direta = paraDataISO(o.DataQuitacao);
  if (direta) return direta;
  const datas = [...String(o.ListaDatasPagamentos || '').matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)]
    .map(m => `${m[3]}-${m[2]}-${m[1]}`)
    .sort();
  return datas.length ? datas[datas.length - 1] : null;
}

// PostgREST quando a coluna ainda não existe no banco (SQL não rodado):
// "Could not find the 'empresa_id' column of '...' in the schema cache".
export function erroColunaInexistente(error: { code?: string; message?: string } | null, coluna: string): boolean {
  return !!error && (error.code === 'PGRST204' || /schema cache/i.test(error.message || '')) && (error.message || '').includes(coluna);
}

export function refOuNull(v: unknown): string | undefined {
  const s = v ? String(v) : '';
  return s && s !== 'null' ? s : undefined;
}

export function textoOuNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s || null;
}

export interface SincronizarContasPagarOpcoes {
  ambiente?: AmbienteP2s;
  diasRetroativos?: number;
}

// Puxa as Contas a Pagar do P2S em DUAS consultas (a API só faz AND entre
// critérios diferentes — não dá pra pedir "quitadas de qualquer data OU
// abertas futuras" numa chamada só, ver nota em app/lib/p2s.ts):
// 1) já QUITADAS, com vencimento a partir de N dias atrás (sem limite
//    superior) — janela que, de quebra, já filtra fora os registros com
//    DataVencimento corrompida (ver nota no topo do arquivo).
// 2) em ABERTO (ainda não quitadas), mas só com vencimento a partir de
//    HOJE — dá pra usar o filtro de vencimento em /admin/financeiro/contas-pagar
//    pra pagamentos futuros já lançados no PrimeStart, sem trazer o volume
//    de contas antigas em aberto que ninguém mais consulta (~4787 num teste
//    empírico) — só isso já justificava não trazer tudo de uma vez.
// Consequência: "Vencidas" (em aberto com vencimento no passado) continua
// sem dado aqui de propósito — se precisar disso no futuro, é só adicionar
// uma 3ª consulta nos mesmos moldes.
export async function sincronizarContasPagarCore(opcoes: SincronizarContasPagarOpcoes = {}): Promise<Resultado> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  // ~13 meses de quitadas (era 90 dias até 2026-11-15): o relatório mensal do
  // Diretor compara com o mesmo mês do ano anterior. A tela pagina no servidor.
  const diasRetroativos = opcoes.diasRetroativos ?? 400;
  const iniciadoEm = new Date();

  try {
    const hojeSerial = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000);
    const desde = hojeSerial - diasRetroativos;

    // TCustomContaPagar não tem campo de "última alteração" (testado em
    // produção, 2026-08-17 — nenhum DataUltimaAlteracaoCadastro nem
    // equivalente nessa classe) — mesma limitação de TCustomEvento. Sem
    // isso, não dá pra fazer sincronização incremental de verdade: sempre
    // busca a janela rolante de N dias por vencimento + quitadas, sem
    // cursor. A execução ainda é registrada no log (ver app/lib/syncLog.ts),
    // só sem o ganho de performance que as outras integrações têm.
    const criteriosQuitadas = [
      criterio('DataVencimento', 'ge', 'dbl', desde),
      criterio('FlagQuitado', 'eq', 'bool', true),
    ];
    const criteriosAbertasFuturas = [
      criterio('DataVencimento', 'ge', 'dbl', hojeSerial),
      criterio('FlagQuitado', 'eq', 'bool', false),
    ];

    const [resultadoQuitadas, resultadoAbertas] = await Promise.all([
      consultarObjetos(ambiente, 'TCustomContaPagar', criteriosQuitadas, { order: 'DataVencimento', proxy: true }),
      consultarObjetos(ambiente, 'TCustomContaPagar', criteriosAbertasFuturas, { order: 'DataVencimento', proxy: true }),
    ]);
    const objectlist = [...resultadoQuitadas.objectlist, ...resultadoAbertas.objectlist];
    const totalEncontradas = resultadoQuitadas.count + resultadoAbertas.count;

    if (objectlist.length === 0) {
      await registrarSincronizacao({
        integracao: 'contas_pagar', ambiente, tipo: 'completa',
        cursorDesde: null, cursorAte: null,
        encontrados: 0, processados: 0, status: 'sucesso', iniciadoEm,
      });
      return { ok: true, info: { processados: 0, totalEncontradas: 0 } };
    }

    const mapaNomes = await resolverNomes(ambiente, objectlist.flatMap(o => [
      refOuNull(o.Entidade), refOuNull(o.FormaPagamento), refOuNull(o.ContaFinanceira),
    ]));
    const centros = await resolverCentrosP2s(ambiente, objectlist.map(o => refOuNull(o.Centro)));
    const db = supabaseAdmin();
    const empresas = await carregarEmpresasCadastro(db);

    const registros = objectlist.map(o => {
      const entidadeOid = refOuNull(o.Entidade);
      const formaPagamentoOid = refOuNull(o.FormaPagamento);
      const contaFinanceiraOid = refOuNull(o.ContaFinanceira);
      const centroOid = refOuNull(o.Centro);
      return {
        // Empresa pelo CNPJ do "Centro" do P2S (ver app/lib/empresaP2s.ts) — o
        // campo `centro` abaixo é outra coisa: o centro FINANCEIRO ("03 - RH").
        empresa_id: empresaIdDoCentroP2s(centroOid ? centros.get(centroOid) : undefined, empresas),
        p2s_oid: o.oid,
        descricao: textoOuNull(o.Descricao),
        centro: textoOuNull(o.DescricaoCentroFinanceiro),
        sub_centro: textoOuNull(o.DescricaoSubCentroFinanceiro),
        fornecedor: entidadeOid ? (mapaNomes.get(entidadeOid) || null) : null,
        forma_pagamento: formaPagamentoOid ? (mapaNomes.get(formaPagamentoOid) || null) : null,
        conta_financeira: contaFinanceiraOid ? (mapaNomes.get(contaFinanceiraOid) || null) : null,
        num_documento: textoOuNull(o.NumDocumento),
        num_parcela: textoOuNull(o.NumParcela),
        valor: Number(o.Valor) || null,
        valor_pago: Number(o.ValorPago) || null,
        data_vencimento: paraDataISO(o.DataVencimento),
        data_emissao: paraDataISO(o.DataEmissaoPagamentoRecebimento) || paraDataISO(o.DataCompetencia),
        quitado: String(o.FlagQuitado) === 'true',
        data_quitacao: dataQuitacaoISO(o),
        observacoes: textoOuNull(o.Observacoes),
        updated_at: new Date().toISOString(),
      };
    });

    const TAMANHO_LOTE = 500;
    let processados = 0;
    // empresa_id entrou por .sql/Pendentes/diretoria_fase1.sql — se o código
    // subir antes do SQL, grava sem a coluna em vez de derrubar o sync.
    let semEmpresa = false;
    const tirarEmpresa = (linhas: typeof registros) => linhas.map(l => {
      const copia: Partial<typeof l> = { ...l };
      delete copia.empresa_id;
      return copia;
    });
    for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
      const lote = registros.slice(i, i + TAMANHO_LOTE);
      let { error } = await db.from('financeiro_contas_pagar').upsert(semEmpresa ? tirarEmpresa(lote) : lote, { onConflict: 'p2s_oid' });
      if (error && !semEmpresa && erroColunaInexistente(error, 'empresa_id')) {
        semEmpresa = true;
        ({ error } = await db.from('financeiro_contas_pagar').upsert(tirarEmpresa(lote), { onConflict: 'p2s_oid' }));
      }
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    await registrarSincronizacao({
      integracao: 'contas_pagar', ambiente, tipo: 'completa',
      cursorDesde: null, cursorAte: null,
      encontrados: totalEncontradas, processados, status: 'sucesso', iniciadoEm,
    });
    return { ok: true, info: { processados, totalEncontradas } };
  } catch (e: any) {
    await registrarSincronizacao({
      integracao: 'contas_pagar', ambiente, tipo: 'completa',
      cursorDesde: null, cursorAte: null,
      encontrados: 0, processados: 0, status: 'erro', erro: e.message, iniciadoEm,
    });
    return { ok: false, erro: e.message };
  }
}
