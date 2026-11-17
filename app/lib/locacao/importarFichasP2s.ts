// app/lib/locacao/importarFichasP2s.ts
// Importa as Fichas de Reserva do P2S para locacao_fichas_reserva (origem
// 'P2S', somente leitura aqui) — decisão de 2026-11-16: o P2S segue oficial
// até o rentech-web rodar sem intercorrências, e a agenda/disponibilidade
// daqui só valem se enxergarem as reservas reais.
//
// SEM "use server": usada pela action (botão) e pelo cron app/api/cron/sync-p2s.
//
// - UMA consulta ao P2S (TCustomFichaReservaLocacao já traz Itens e
//   ExtrasOrcados). Nomes de cliente/produto/evento/vendedor saem das tabelas
//   espelho daqui (parceiros, produtos, eventos_feiras, colaboradores) pelo
//   p2s_oid — nada de uma chamada por objeto.
// - Janela: fichas com DataFinal a partir de hoje − 30 dias.
// - Status (rótulos da tela antiga de fichas, mesma ordem dos códigos):
//     EP Em preparação → ORCAMENTO      EN Enviado → ENVIADO
//     A  Aprovado, aguardando saída → RESERVADA (ocupa agenda)
//     X  Em locação → EM_LOCACAO (ocupa agenda)
//     E  Finalizado → FINALIZADA        RE Reprovado → PERDIDO
//     CA Cancelado → CANCELADA          outros → ORCAMENTO (código cru fica em p2s_status)
// - Cada item do P2S tem as próprias datas; a alocação usa as datas do item
//   ± dias de preparo/retorno do produto.
// - Ocupa só o que está em aberto em cada item (não saiu + não voltou);
//   item devolvido não ocupa; em locação vencido e não devolvido ocupa até
//   hoje; sublocação (SubLocacoes) é abatida — equipamento de terceiro.
// - Reimportar substitui itens e alocações da ficha (o P2S manda).
import type { supabaseAdmin } from '../supabase';
import { consultarObjetos, criterio, p2sParaData, type AmbienteP2s, type ObjetoP2s } from '../p2s';
import { resolverCentrosP2s, empresaIdDoCentroP2s } from '../empresaP2s';
import type { LinhaEmpresa } from '../empresa';
import { periodoAlocacao, daterangeInclusivo, diasInclusivos, somarDias } from './datas';
import { sincronizarParceirosPorOidsCore } from '../../admin/comercial/parceiros/parceirosCore';

type Db = ReturnType<typeof supabaseAdmin>;

const STATUS_P2S: Record<string, string> = {
  EP: 'ORCAMENTO', EN: 'ENVIADO', A: 'RESERVADA', X: 'EM_LOCACAO', E: 'FINALIZADA', RE: 'PERDIDO', CA: 'CANCELADA',
};
const OCUPA_AGENDA: Record<string, 'RESERVADO' | 'LOCADO'> = { A: 'RESERVADO', X: 'LOCADO' };

const ref = (v: unknown) => { const s = v ? String(v) : ''; return s && s !== 'null' ? s : null; };
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred = (v: number) => Math.round(v * 100) / 100;
function dataISO(serial: unknown): string | null {
  const x = Number(serial);
  if (!x) return null;
  const d = p2sParaData(x);
  return d ? d.toISOString().slice(0, 10) : null;
}

async function mapaPorP2sOid(db: Db, tabela: string, colunas: string, oids: string[]): Promise<Map<string, any>> {
  const mapa = new Map<string, any>();
  const unicos = [...new Set(oids)];
  for (let i = 0; i < unicos.length; i += 300) {
    const { data, error } = await db.from(tabela).select(`p2s_oid, ${colunas}`).in('p2s_oid', unicos.slice(i, i + 300));
    if (error) throw error;
    for (const r of (data || []) as any[]) mapa.set(r.p2s_oid, r);
  }
  return mapa;
}

export interface ResultadoImportacaoP2s {
  lidas: number;
  gravadas: number;
  ocupandoAgenda: number;
  itens: number;
  alocacoes: number;
  puladas: { numero: string; motivo: string }[];
  produtosNaoEncontrados: number;
  clientesBuscados: number;
  sublocadas: number;      // unidades abatidas por sublocação
  atrasados: number;       // itens em locação vencidos e não devolvidos (ocupam até hoje)
}

// opcoes.de/ate (AAAA-MM-DD): período explícito — fichas que cruzam [de, ate]
// (DataFinal >= de E DataInicial <= ate). Usado para trazer o HISTÓRICO mês a
// mês (tela de Indicadores); sem eles, janela padrão de diasPassados (30).
export async function importarFichasP2sCore(db: Db, opcoes: { ambiente?: AmbienteP2s; diasPassados?: number; de?: string; ate?: string } = {}): Promise<ResultadoImportacaoP2s> {
  const ambiente = opcoes.ambiente || 'PRODUCAO';
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const corte = opcoes.de || somarDias(hoje, -(opcoes.diasPassados ?? 30));
  const serialCorte = Math.floor((Date.parse(`${corte}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

  const criterios = [criterio('DataFinal', 'ge', 'dbl', serialCorte)];
  if (opcoes.ate) criterios.push(criterio('DataInicial', 'le', 'dbl', Math.floor((Date.parse(`${opcoes.ate}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000)));
  const r = await consultarObjetos(ambiente, 'TCustomFichaReservaLocacao', criterios, { proxy: false });
  const fichas = r.objectlist as ObjetoP2s[];
  const res: ResultadoImportacaoP2s = { lidas: fichas.length, gravadas: 0, ocupandoAgenda: 0, itens: 0, alocacoes: 0, puladas: [], produtosNaoEncontrados: 0, clientesBuscados: 0, sublocadas: 0, atrasados: 0 };
  if (!fichas.length) return res;

  const itensDe = (f: ObjetoP2s) => (Array.isArray(f.Itens) ? f.Itens : []) as any[];
  const extrasDe = (f: ObjetoP2s) => (Array.isArray(f.ExtrasOrcados) ? f.ExtrasOrcados : []) as any[];

  const [parceiros, produtos, eventos, vendedores, centros, { data: empresasData }] = await Promise.all([
    mapaPorP2sOid(db, 'parceiros', 'id', fichas.map(f => ref(f.Parceiro)).filter((x): x is string => !!x)),
    mapaPorP2sOid(db, 'produtos', 'id, nome_item, dias_preparo, dias_retorno', fichas.flatMap(f => itensDe(f).map(i => ref(i.ItemEstoque))).filter((x): x is string => !!x)),
    mapaPorP2sOid(db, 'eventos_feiras', 'id', fichas.map(f => ref(f.Evento)).filter((x): x is string => !!x)),
    mapaPorP2sOid(db, 'colaboradores', 'nome_exibicao, nome_completo', fichas.map(f => ref(f.VendedorRep)).filter((x): x is string => !!x)),
    resolverCentrosP2s(ambiente, fichas.map(f => ref(f.Centro) || undefined)),
    db.from('empresas').select('*').eq('ativo', true),
  ]);
  const empresas = (empresasData || []) as LinhaEmpresa[];
  const agora = new Date().toISOString();

  // Clientes que o espelho de parceiros não tem (a carga completa deixou
  // buracos) — busca só esses no P2S, grava e completa o mapa.
  const oidsParceiro = [...new Set(fichas.map(f => ref(f.Parceiro)).filter((x): x is string => !!x))];
  const faltando = oidsParceiro.filter(o => !parceiros.has(o));
  if (faltando.length) {
    res.clientesBuscados = await sincronizarParceirosPorOidsCore(faltando, ambiente);
    const novos = await mapaPorP2sOid(db, 'parceiros', 'id', faltando);
    for (const [k, v] of novos) parceiros.set(k, v);
  }

  // ---------------- cabeçalhos ----------------
  const cabecalhos: any[] = [];
  const porOid = new Map<string, ObjetoP2s>();
  for (const f of fichas) {
    const numero = String(f.Numero || f.oid);
    const centroOid = ref(f.Centro);
    const empresaId = empresaIdDoCentroP2s(centroOid ? centros.get(centroOid) : null, empresas);
    const parceiro = parceiros.get(ref(f.Parceiro) || '');
    const inicio = dataISO(f.DataInicial);
    let fim = dataISO(f.DataFinal);
    if (!empresaId) { res.puladas.push({ numero, motivo: 'centro sem empresa' }); continue; }
    if (!parceiro) { res.puladas.push({ numero, motivo: 'cliente não sincronizado (rode o sync de Parceiros)' }); continue; }
    if (!inicio) { res.puladas.push({ numero, motivo: 'sem data inicial' }); continue; }
    if (!fim || fim < inicio) fim = inicio;

    const vend = vendedores.get(ref(f.VendedorRep) || '');
    const equip = arred(n(f.ValorFinalItens));
    const serv = arred(n(f.ValorTotalExtrasOrcados));
    const total = arred(n(f.ValorFinal));
    const emissao = dataISO(f.DataEmissao);
    const endereco = (f.EnderecoEntrega && typeof f.EnderecoEntrega === 'object') ? String((f.EnderecoEntrega as any).EnderecoCompleto || '').trim() : '';
    const statusP2s = String(f.Status || '');

    cabecalhos.push({
      origem: 'P2S', p2s_oid: f.oid, p2s_numero: numero, p2s_status: statusP2s || null, p2s_sincronizado_em: agora,
      status: STATUS_P2S[statusP2s] || 'ORCAMENTO', modalidade: 'DIARIA',
      empresa_id: empresaId, parceiro_id: parceiro.id, evento_id: eventos.get(ref(f.Evento) || '')?.id || null,
      vendedor_nome: vend ? (vend.nome_exibicao || vend.nome_completo) : (String(f.ResponsavelReserva || '') || null),
      contato_telefone: String(f.TelefoneContato || '').trim() || null, contato_email: String(f.EMailContato || '').trim() || null,
      local_entrega: endereco || null,
      data_inicio: inicio, data_fim: fim, dias_cobrados: diasInclusivos(inicio, fim),
      validade_orcamento: emissao && n(f.NumDiasValidade) ? somarDias(emissao, n(f.NumDiasValidade)) : null,
      observacoes: String(f.Observacoes || '').trim() || null,
      valor_equipamentos: equip, valor_servicos: serv, desconto_valor: Math.max(0, arred(equip + serv - total)), valor_total: total,
      aprovado_em: n(f.DataAprovacao) ? `${dataISO(f.DataAprovacao)}T12:00:00Z` : null,
      criado_por: String(f.LoginCriou || '') || 'P2S',
      updated_at: agora, conteudo_alterado_em: agora,
    });
    porOid.set(f.oid, f);
  }

  const cabPorOid = new Map(cabecalhos.map(c => [c.p2s_oid as string, c]));
  const idPorOid = new Map<string, number>();
  for (let i = 0; i < cabecalhos.length; i += 300) {
    const { data, error } = await db.from('locacao_fichas_reserva').upsert(cabecalhos.slice(i, i + 300), { onConflict: 'p2s_oid' }).select('id, p2s_oid');
    if (error) throw error;
    for (const x of data || []) idPorOid.set(x.p2s_oid, x.id);
  }
  res.gravadas = idPorOid.size;

  // ---------------- itens + alocações (substitui tudo das fichas lidas) ----------------
  const ids = [...idPorOid.values()];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const { error: eA } = await db.from('locacao_alocacoes').delete().in('ficha_id', lote);
    if (eA) throw eA;
    const { error: eI } = await db.from('locacao_fichas_reserva_itens').delete().in('ficha_id', lote);
    if (eI) throw eI;
  }

  const itensNovos: any[] = [];
  const alocPendentes: { ficha_id: number; ordem: number; empresa_id: number; produto_id: number; quantidade: number; periodo: string; status: string }[] = [];
  for (const [oid, fichaId] of idPorOid) {
    const f = porOid.get(oid)!;
    const cab = cabPorOid.get(oid)!;
    const ocupa = OCUPA_AGENDA[String(f.Status || '')];
    if (ocupa) res.ocupandoAgenda++;
    // Sublocação (equipamento de terceiro): por produto, quanto da ficha NÃO
    // sai do estoque próprio. Abatido dos itens daquele produto, em ordem.
    const sublocado = new Map<string, number>();
    for (const s of (Array.isArray(f.SubLocacoes) ? f.SubLocacoes : []) as any[]) {
      if (String(s.Status || '') === 'E') continue;
      const item = ref(s.ItemEstoque);
      const q = Math.abs(n(s.QuantidadeNaoExecPositiva) + n(s.QuantidadeNaoRetPositiva)) || Math.abs(n(s.Quantidade));
      if (item && q > 0) sublocado.set(item, (sublocado.get(item) || 0) + q);
    }
    let ordem = 0;
    for (const it of itensDe(f).sort((a, b) => n(a.OrdemFicha) - n(b.OrdemFicha))) {
      const qtd = n(it.QuantidadePositiva) || Math.abs(n(it.Quantidade));
      if (!(qtd > 0)) continue;
      const prod = produtos.get(ref(it.ItemEstoque) || '');
      if (!prod) res.produtosNaoEncontrados++;
      const obs = String(it.Observacoes || '').trim();
      const valorTotal = arred(n(it.ValorTotal));
      const valorFinal = arred(n(it.ValorFinal));
      itensNovos.push({
        ficha_id: fichaId, ordem, tipo: prod ? 'EQUIPAMENTO' : 'OUTRO', produto_id: prod?.id || null,
        descricao: [prod?.nome_item || `Item do P2S ${ref(it.ItemEstoque) || ''}`.trim(), obs].filter(Boolean).join(' — '),
        quantidade: qtd, dias: n(it.NumDiasPeriodo) || n(it.NumDiasFaturamento) || null,
        valor_unitario: arred(n(it.ValorTotalPeriodoPorUnid) || (qtd ? valorTotal / qtd : 0)),
        desconto_valor: Math.max(0, arred(valorTotal - valorFinal)), valor_total: valorFinal,
        observacoes: null, preco_manual: false,
      });
      // Quanto deste item ainda ocupa o estoque próprio: não saiu ainda
      // (NaoExec) + saiu e não voltou (NaoRet). Item já devolvido (status
      // "E" no item) ou totalmente devolvido não ocupa; devolução parcial
      // ocupa só o que falta voltar. Menos o que foi sublocado.
      const statusItem = String(it.Status || '');
      let emAberto = statusItem === 'E' ? 0 : n(it.QuantidadeNaoExecPositiva) + n(it.QuantidadeNaoRetPositiva);
      const chaveItem = ref(it.ItemEstoque) || '';
      const sub = sublocado.get(chaveItem) || 0;
      if (sub > 0 && emAberto > 0) { const abate = Math.min(sub, emAberto); emAberto -= abate; sublocado.set(chaveItem, sub - abate); res.sublocadas += abate; }
      if (ocupa && prod && emAberto > 0) {
        const ini = dataISO(it.DataInicial) || cab.data_inicio;
        let fimIt = dataISO(it.DataFinal) || cab.data_fim;
        if (fimIt < ini) fimIt = ini;
        // em locação, ainda não devolvido e já passou do fim: segue ocupando até hoje (atraso)
        if (ocupa === 'LOCADO' && n(it.QuantidadeNaoRetPositiva) > 0 && fimIt < hoje) { fimIt = hoje; res.atrasados++; }
        const p = periodoAlocacao({ data_inicio: ini, data_fim: fimIt }, n(prod.dias_preparo), n(prod.dias_retorno));
        alocPendentes.push({ ficha_id: fichaId, ordem, empresa_id: cab.empresa_id, produto_id: prod.id, quantidade: emAberto, periodo: daterangeInclusivo(p.inicio, p.fim), status: ocupa });
      }
      ordem++;
    }
    for (const ex of extrasDe(f)) {
      const descricao = String(ex.Descricao || '').trim();
      if (!descricao) continue;
      const qtd = n(ex.Quantidade) > 0 ? n(ex.Quantidade) : 1;
      itensNovos.push({
        ficha_id: fichaId, ordem: ordem++, tipo: 'SERVICO', produto_id: null, descricao, quantidade: qtd, dias: null,
        valor_unitario: arred(n(ex.ValorUnitario)), desconto_valor: 0, valor_total: arred(n(ex.ValorFinal)), preco_manual: false,
      });
    }
  }

  const idItem = new Map<string, number>();
  for (let i = 0; i < itensNovos.length; i += 500) {
    const { data, error } = await db.from('locacao_fichas_reserva_itens').insert(itensNovos.slice(i, i + 500)).select('id, ficha_id, ordem');
    if (error) throw error;
    for (const x of data || []) idItem.set(`${x.ficha_id}:${x.ordem}`, x.id);
  }
  res.itens = itensNovos.length;

  const alocs = alocPendentes.map(a => ({
    ficha_id: a.ficha_id, ficha_item_id: idItem.get(`${a.ficha_id}:${a.ordem}`) || null, empresa_id: a.empresa_id,
    produto_id: a.produto_id, quantidade: a.quantidade, periodo: a.periodo, status: a.status,
  }));
  for (let i = 0; i < alocs.length; i += 500) {
    const { error } = await db.from('locacao_alocacoes').insert(alocs.slice(i, i + 500));
    if (error) throw error;
  }
  res.alocacoes = alocs.length;
  return res;
}

/** Última importação (maior p2s_sincronizado_em). */
export async function ultimaImportacaoFichasP2s(db: Db): Promise<string | null> {
  const { data } = await db.from('locacao_fichas_reserva').select('p2s_sincronizado_em')
    .eq('origem', 'P2S').not('p2s_sincronizado_em', 'is', null).order('p2s_sincronizado_em', { ascending: false }).limit(1).maybeSingle();
  return data?.p2s_sincronizado_em || null;
}

