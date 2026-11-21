// app/lib/locacao/importarFichasLocacaoP2s.ts
// Importa as FICHAS DE LOCAÇÃO do P2S (TCustomFichaLocacao) — a locação
// efetiva de cada ficha de reserva (028209/A, /B…): movimentações de saída e
// devolução (itens), extras, NF de remessa/devolução e situação do
// faturamento. Item 2 do roteiro (histórico fiel), 2026-11-17.
// Por período da 1ª saída (DataPrimeiraMovSaida). Reimportar substitui os
// movimentos/extras da ficha (o P2S manda). SEM checagem de acesso.
import type { supabaseAdmin } from '../supabase';
import { consultarObjetos, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../p2s';
import { resolverCentrosP2s, empresaIdDoCentroP2s } from '../empresaP2s';
import { carregarEmpresasCadastro } from '../empresa';
import { sincronizarParceirosPorOidsCore } from '../../admin/comercial/parceiros/parceirosCore';
import { empresasCongeladas } from '../virada/estado';

type Db = ReturnType<typeof supabaseAdmin>;
const ref = (v: unknown) => { const s = v ? String(v) : ''; return s && s !== 'null' ? s : null; };
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const nOuNull = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
const txt = (v: unknown) => { const s = String(v ?? '').trim(); return s && s !== 'null' ? s : null; };
const bool = (v: unknown) => String(v) === 'true';
const serial = (iso: string) => Math.floor((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
function dataISO(v: unknown): string | null {
  const x = Number(v);
  if (!x || x < 1) return null;
  const d = p2sParaData(x);
  return d ? d.toISOString().slice(0, 10) : null;
}

async function mapaPorP2sOid(db: Db, tabela: string, colunas: string, oids: string[]): Promise<Map<string, any>> {
  const mapa = new Map<string, any>();
  const unicos = [...new Set(oids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 300) {
    const { data, error } = await db.from(tabela).select(`p2s_oid, ${colunas}`).in('p2s_oid', unicos.slice(i, i + 300));
    if (error) throw error;
    for (const r of (data || []) as any[]) mapa.set(r.p2s_oid, r);
  }
  return mapa;
}

export interface ResultadoFichasLocacao { lidas: number; gravadas: number; movimentos: number; extras: number; semReserva: number }

/** Fichas de locação com a 1ª saída entre de e ate (AAAA-MM-DD, inclusive). */
export async function importarFichasLocacaoP2s(db: Db, opcoes: { de: string; ate: string; ambiente?: AmbienteP2s }): Promise<ResultadoFichasLocacao> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const r = await consultarObjetos(ambiente, 'TCustomFichaLocacao', [
    criterio('DataPrimeiraMovSaida', 'ge', 'dbl', serial(opcoes.de)),
    criterio('DataPrimeiraMovSaida', 'le', 'dbl', serial(opcoes.ate)),
  ]);
  const fichas = r.objectlist as ObjetoP2s[];
  const res: ResultadoFichasLocacao = { lidas: fichas.length, gravadas: 0, movimentos: 0, extras: 0, semReserva: 0 };
  if (!fichas.length) return res;

  const itensDe = (f: ObjetoP2s) => (Array.isArray(f.Itens) ? f.Itens : []) as any[];
  const extrasDe = (f: ObjetoP2s) => (Array.isArray(f.Extras) ? f.Extras : []) as any[];

  // clientes que faltam no espelho: busca no P2S antes de mapear
  const oidsParceiro = fichas.map(f => ref(f.Parceiro)).filter((x): x is string => !!x);
  let parceiros = await mapaPorP2sOid(db, 'parceiros', 'id', oidsParceiro);
  const faltando = [...new Set(oidsParceiro.filter(o => !parceiros.has(o)))];
  if (faltando.length) {
    await sincronizarParceirosPorOidsCore(faltando, ambiente).catch(() => 0);
    parceiros = await mapaPorP2sOid(db, 'parceiros', 'id', oidsParceiro);
  }
  const [reservas, eventos, vendedores, produtos, centros, empresas] = await Promise.all([
    mapaPorP2sOid(db, 'locacao_fichas_reserva', 'id', fichas.map(f => ref(f.FichaReservaLocacao)).filter((x): x is string => !!x)),
    mapaPorP2sOid(db, 'eventos_feiras', 'id', fichas.map(f => ref(f.Evento)).filter((x): x is string => !!x)),
    mapaPorP2sOid(db, 'colaboradores', 'id', fichas.map(f => ref(f.VendedorRep)).filter((x): x is string => !!x)),
    mapaPorP2sOid(db, 'produtos', 'id', fichas.flatMap(f => itensDe(f).map(i => ref(i.ItemEstoque))).filter((x): x is string => !!x)),
    resolverCentrosP2s(ambiente, fichas.map(f => ref(f.Centro) || undefined)),
    carregarEmpresasCadastro(db),
  ]);
  const agora = new Date().toISOString();

  // Virada da chave (2026-11-21): ficha de locação já migrada (origem SISTEMA) não é
  // regravada — a importação apaga e refaz os movimentos, o que desfaria a ligação
  // com os itens da ficha própria; e empresa congelada não é mais lida do P2S.
  const congeladas = await empresasCongeladas(db);
  const migradas = new Set<string>();
  for (let i = 0; i < fichas.length; i += 300) {
    const { data } = await db.from('locacao_fichas_locacao').select('p2s_oid').in('p2s_oid', fichas.slice(i, i + 300).map(f => f.oid)).neq('origem', 'P2S');
    for (const x of (data || []) as any[]) migradas.add(x.p2s_oid);
  }
  const pular = (f: ObjetoP2s) => {
    if (migradas.has(f.oid)) return true;
    const centroOid = ref(f.Centro);
    const emp = empresaIdDoCentroP2s(centroOid ? centros.get(centroOid) : undefined, empresas);
    return !!emp && congeladas.has(emp);
  };
  for (let i = fichas.length - 1; i >= 0; i--) if (pular(fichas[i])) fichas.splice(i, 1);
  if (!fichas.length) return res;

  const cabecalhos = fichas.map(f => {
    const reservaOid = ref(f.FichaReservaLocacao);
    const reserva = reservaOid ? reservas.get(reservaOid) : null;
    if (!reserva) res.semReserva++;
    const centroOid = ref(f.Centro);
    return {
      p2s_oid: f.oid, numero: String(f.Numero || f.oid).replace(/\s+/g, ''),
      ficha_reserva_id: reserva?.id ?? null, ficha_reserva_p2s_oid: reservaOid,
      empresa_id: empresaIdDoCentroP2s(centroOid ? centros.get(centroOid) : undefined, empresas),
      parceiro_id: parceiros.get(ref(f.Parceiro) || '')?.id ?? null,
      evento_id: eventos.get(ref(f.Evento) || '')?.id ?? null,
      vendedor_id: vendedores.get(ref(f.VendedorRep) || '')?.id ?? null,
      responsavel: txt(f.ResponsavelReserva), status: txt(f.Status),
      data_saida: dataISO(f.DataPrimeiraMovSaida), data_devolucao: dataISO(f.DataUltimaMovDevolucao),
      devolucao_solicitada: bool(f.DevolucaoSolicitada), data_solicitacao_devolucao: dataISO(f.DataSolicitacaoDevolucao),
      quem_solicitou_devolucao: txt(f.QuemSolicitouDevolucao),
      desconto: nOuNull(f.Desconto), valor_itens_nao_devolvidos: nOuNull(f.ValorTotalItensNaoDevolvidos),
      faturamento_iniciado: bool(f.FlagAlgumFaturamento), faturada_definitivo: bool(f.FlagFaturadaEmDefinitivo),
      status_ultimo_faturamento: txt(f.StatusUltimoFaturamento),
      nf_remessa_p2s_oid: ref(f.NotaFiscalRemessa), nf_devolucao_p2s_oid: ref(f.NotaFiscalDevolucao),
      observacoes: txt(f.Observacoes), p2s_sincronizado_em: agora,
    };
  });

  const idPorOid = new Map<string, number>();
  for (let i = 0; i < cabecalhos.length; i += 300) {
    const { data, error } = await db.from('locacao_fichas_locacao').upsert(cabecalhos.slice(i, i + 300), { onConflict: 'p2s_oid' }).select('id, p2s_oid');
    if (error) throw error;
    for (const x of (data || []) as any[]) idPorOid.set(x.p2s_oid, x.id);
  }
  res.gravadas = idPorOid.size;

  // movimentos e extras: substitui tudo das fichas lidas
  const ids = [...idPorOid.values()];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const [a, b] = await Promise.all([
      db.from('locacao_fichas_locacao_movimentos').delete().in('ficha_locacao_id', lote),
      db.from('locacao_fichas_locacao_extras').delete().in('ficha_locacao_id', lote),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
  }
  const movimentos: any[] = [];
  const extras: any[] = [];
  for (const f of fichas) {
    const fichaId = idPorOid.get(f.oid);
    if (!fichaId) continue;
    for (const it of itensDe(f)) {
      const q = n(it.QuantidadeMovimentada);
      if (!q) continue;
      movimentos.push({
        ficha_locacao_id: fichaId, p2s_oid: it.oid, tipo: q < 0 ? 'SAIDA' : 'DEVOLUCAO',
        data_movimentacao: dataISO(it.DataMovimentacao), produto_id: produtos.get(ref(it.ItemEstoque) || '')?.id ?? null,
        produto_p2s_oid: ref(it.ItemEstoque), patrimonio_p2s_oid: ref(it.ItemEstoqueIndividual),
        quantidade: Math.abs(q), quantidade_sublocada: Math.abs(n(it.QuantidadeMovimentadaSubLocada)) || null,
        dias: n(it.NumDiasPeriodo) || null, valor_unitario: nOuNull(it.ValorUnitario), valor_total: nOuNull(it.ValorTotal),
        valor_final: nOuNull(it.ValorFinal), desconto: nOuNull(it.Desconto), custo_unitario: nOuNull(it.CustoUnitario),
        devolucao_incompleta: bool(it.DevolucaoIncompleta), troca: bool(it.FlagTroca), usuario: txt(it.LoginUsuario), observacoes: txt(it.Observacoes),
      });
    }
    for (const ex of extrasDe(f)) {
      extras.push({
        ficha_locacao_id: fichaId, p2s_oid: ex.oid, descricao: txt(ex.Descricao), data_referencia: dataISO(ex.DataReferencia),
        quantidade: n(ex.Quantidade) || null, valor_unitario: nOuNull(ex.ValorUnitario), valor_final: nOuNull(ex.ValorFinal),
        porcentagem: n(ex.Porcentagem) || null,
      });
    }
  }
  for (let i = 0; i < movimentos.length; i += 500) {
    const { error } = await db.from('locacao_fichas_locacao_movimentos').upsert(movimentos.slice(i, i + 500), { onConflict: 'p2s_oid' });
    if (error) throw error;
  }
  for (let i = 0; i < extras.length; i += 500) {
    const { error } = await db.from('locacao_fichas_locacao_extras').upsert(extras.slice(i, i + 500), { onConflict: 'p2s_oid' });
    if (error) throw error;
  }
  res.movimentos = movimentos.length;
  res.extras = extras.length;
  return res;
}
