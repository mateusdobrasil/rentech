// app/admin/financeiro/contas-receber/contasReceberCore.ts
// Sync de Contas a Receber do PrimeStart (TCustomContaReceber) para
// financeiro_contas_receber — SEM "use server", mesmo padrão de
// contasPagarCore.ts: importado pelo cron (app/api/cron/sync-p2s) e por quem
// mais precisar, nunca exposto como Server Action.
//
// Pedido de 2026-11-15 (Agente Diretor, Fase 1): até aqui o sistema não
// sabia o que entrou nem quem está devendo. Testado em produção no mesmo
// dia: ~106 títulos em aberto a vencer, ~351 em aberto vencidos (boa parte
// com mais de 1 ano — provavelmente baixa pendente no P2S, não dívida real)
// e ~800 quitados por trimestre.
//
// Diferenças em relação ao Contas a Pagar:
// - Traz TODOS os títulos em aberto (inclusive vencidos — é a inadimplência,
//   o dado mais importante aqui), não só os a vencer.
// - Quitados: vencimento a partir de ~13 meses atrás, pra dar base ao
//   relatório anual e às comparações com o mesmo período do ano anterior.
// - Título que estava em aberto e sumiu das duas consultas (quitado com
//   vencimento antigo, cancelado ou excluído no P2S) é reconsultado pelo oid:
//   404 → apaga daqui; senão atualiza. Sem isso a inadimplência ficaria
//   inflada com título que não existe mais.
// - Nome do cliente sai primeiro da tabela `parceiros` (já sincronizada do
//   P2S) e só vai na API, um a um, para o que faltar.
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, buscarObjeto, criterio, type AmbienteP2s, type ObjetoP2s } from '../../../lib/p2s';
import { registrarSincronizacao } from '../../../lib/syncLog';
import { carregarEmpresasCadastro } from '../../../lib/empresa';
import { resolverCentrosP2s, empresaIdDoCentroP2s } from '../../../lib/empresaP2s';
import { resolverNomes, paraDataISO, refOuNull, textoOuNull, dataQuitacaoISO } from '../contas-pagar/contasPagarCore';

type Resultado = { ok: boolean; erro?: string; info?: any };

export interface SincronizarContasReceberOpcoes {
  ambiente?: AmbienteP2s;
  diasRetroativosQuitadas?: number;
}

const MAX_RECONSULTAS = 300;

async function nomesClientes(ambiente: AmbienteP2s, db: ReturnType<typeof supabaseAdmin>, oids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(oids)];
  const mapa = new Map<string, string>();
  for (let i = 0; i < unicos.length; i += 300) {
    const { data } = await db.from('parceiros').select('p2s_oid, nome_exibicao, nome_completo').in('p2s_oid', unicos.slice(i, i + 300));
    for (const p of (data || []) as { p2s_oid: string; nome_exibicao: string | null; nome_completo: string | null }[]) {
      const nome = (p.nome_exibicao || p.nome_completo || '').trim();
      if (nome) mapa.set(p.p2s_oid, nome);
    }
  }
  const faltando = unicos.filter(oid => !mapa.has(oid));
  if (faltando.length) {
    const daApi = await resolverNomes(ambiente, faltando);
    daApi.forEach((nome, oid) => mapa.set(oid, nome));
  }
  return mapa;
}

export async function sincronizarContasReceberCore(opcoes: SincronizarContasReceberOpcoes = {}): Promise<Resultado> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const diasRetroativos = opcoes.diasRetroativosQuitadas ?? 400;
  const iniciadoEm = new Date();

  try {
    const hojeSerial = Math.floor((Date.now() - Date.UTC(1899, 11, 30)) / 86_400_000);

    // A API só faz AND entre critérios (ver app/lib/p2s.ts) — duas consultas.
    // `DataVencimento ge 1` nas abertas tira os registros com data corrompida
    // (seriais negativos) vistos no Contas a Pagar.
    const [quitadas, abertas] = await Promise.all([
      consultarObjetos(ambiente, 'TCustomContaReceber', [
        criterio('DataVencimento', 'ge', 'dbl', hojeSerial - diasRetroativos),
        criterio('FlagQuitado', 'eq', 'bool', true),
      ], { order: 'DataVencimento', proxy: true }),
      consultarObjetos(ambiente, 'TCustomContaReceber', [
        criterio('DataVencimento', 'ge', 'dbl', 1),
        criterio('FlagQuitado', 'eq', 'bool', false),
      ], { order: 'DataVencimento', proxy: true }),
    ]);
    const objectlist = [...quitadas.objectlist, ...abertas.objectlist];

    const db = supabaseAdmin();
    const empresas = await carregarEmpresasCadastro(db);
    const mapaNomes = await resolverNomes(ambiente, objectlist.flatMap(o => [
      refOuNull(o.FormaPagamento), refOuNull(o.ContaFinanceira),
    ]));
    const centros = await resolverCentrosP2s(ambiente, objectlist.map(o => refOuNull(o.Centro)));
    const mapaClientes = await nomesClientes(ambiente, db, objectlist.map(o => refOuNull(o.Entidade)).filter((x): x is string => !!x));

    const montar = (o: ObjetoP2s) => {
      const clienteOid = refOuNull(o.Entidade);
      const centroOid = refOuNull(o.Centro);
      const formaOid = refOuNull(o.FormaPagamento);
      const contaOid = refOuNull(o.ContaFinanceira);
      const centro = centroOid ? centros.get(centroOid) : undefined;
      const quitado = String(o.FlagQuitado) === 'true';
      return {
        p2s_oid: o.oid,
        // Pelo CNPJ do Centro (ver app/lib/empresaP2s.ts) — nossa Alfa Light é "ELITE" no P2S.
        empresa_id: empresaIdDoCentroP2s(centro, empresas),
        centro: centro?.nome ?? null,
        descricao: textoOuNull(o.Descricao),
        origem: textoOuNull(o.DescricaoOrigem),
        documento: textoOuNull(o.Documento),
        num_documento: textoOuNull(o.NumDocumento),
        num_parcela: textoOuNull(o.NumParcela),
        cliente: clienteOid ? (mapaClientes.get(clienteOid) || null) : null,
        cliente_oid: clienteOid || null,
        evento: textoOuNull(String(o.ListaEventos || '').replace(/\s*[\r\n]+\s*/g, ' / ').replace(/\s*\/\s*$/, '')),
        centro_financeiro: textoOuNull(o.DescricaoCentroFinanceiro),
        sub_centro: textoOuNull(o.DescricaoSubCentroFinanceiro),
        unidade_negocio: textoOuNull(o.DescricaoUnidadeNegocio),
        forma_pagamento: formaOid ? (mapaNomes.get(formaOid) || null) : null,
        conta_financeira: textoOuNull(o.ListaContasFinanceirasReal) || (contaOid ? (mapaNomes.get(contaOid) || null) : null),
        valor: Number(o.Valor) || null,
        valor_final: Number(o.ValorFinal) || Number(o.Valor) || null,
        valor_pago: Number(o.ValorPago) || null,
        data_emissao: paraDataISO(o.DataEmissaoPagamentoRecebimento) || paraDataISO(o.DataEmissaoDocumento),
        data_competencia: paraDataISO(o.DataCompetencia),
        data_vencimento: paraDataISO(o.DataVencimento),
        data_quitacao: quitado ? dataQuitacaoISO(o) : null,
        quitado,
        prorrogado: String(o.Prorrogado) === 'true',
        observacoes: textoOuNull(o.Observacoes),
        updated_at: new Date().toISOString(),
      };
    };

    const registros = objectlist.map(montar);
    let processados = 0;
    for (let i = 0; i < registros.length; i += 500) {
      const lote = registros.slice(i, i + 500);
      const { error } = await db.from('financeiro_contas_receber').upsert(lote, { onConflict: 'p2s_oid' });
      if (error) throw new Error(error.message);
      processados += lote.length;
    }

    // Abertos daqui que não vieram nesta rodada → reconsulta pelo oid.
    const { data: orfaos } = await db
      .from('financeiro_contas_receber')
      .select('p2s_oid')
      .eq('quitado', false)
      .lt('updated_at', iniciadoEm.toISOString())
      .limit(MAX_RECONSULTAS);
    let removidos = 0, reconsultados = 0;
    const oidsOrfaos = ((orfaos || []) as { p2s_oid: string }[]).map(o => o.p2s_oid);
    for (let i = 0; i < oidsOrfaos.length; i += 8) {
      const lote = oidsOrfaos.slice(i, i + 8);
      const objetos = await Promise.all(lote.map(oid => buscarObjeto(ambiente, oid).then(obj => ({ oid, obj, falhou: false })).catch(() => ({ oid, obj: null, falhou: true }))));
      for (const { oid, obj, falhou } of objetos) {
        if (falhou) continue; // erro de rede: tenta de novo na próxima rodada
        if (!obj) {
          await db.from('financeiro_contas_receber').delete().eq('p2s_oid', oid);
          removidos++;
        } else {
          await db.from('financeiro_contas_receber').upsert(montar(obj), { onConflict: 'p2s_oid' });
          reconsultados++;
        }
      }
    }

    await registrarSincronizacao({
      integracao: 'contas_receber', ambiente, tipo: 'completa',
      cursorDesde: null, cursorAte: null,
      encontrados: quitadas.count + abertas.count, processados, status: 'sucesso', iniciadoEm,
    });
    return { ok: true, info: { processados, quitadas: quitadas.count, abertas: abertas.count, reconsultados, removidos } };
  } catch (e: any) {
    await registrarSincronizacao({
      integracao: 'contas_receber', ambiente, tipo: 'completa',
      cursorDesde: null, cursorAte: null,
      encontrados: 0, processados: 0, status: 'erro', erro: e.message, iniciadoEm,
    });
    return { ok: false, erro: e.message };
  }
}
