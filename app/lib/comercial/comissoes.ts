// app/lib/comercial/comissoes.ts
// Comissão de vendas (2026-11-17). Regras decididas com o usuário:
//   - % por vendedor (comercial_comissao_vendedores): locação nos
//     equipamentos/kits/outros, serviços nos serviços; FRETE fora;
//   - sobre o valor líquido (desconto da ficha rateado);
//   - liberada conforme o cliente paga: cada recebimento × % efetiva da ficha.
// % efetiva da ficha = (locação × %loc aplicada + serviços × %serv) ÷ valor bruto dos itens.
// %loc aplicada = regra do vendedor (regraComissao.ts): cheia na tabela/prazo
// padrão; faixa de desconto sobre a tabela; menos pontos por dias não cobrados.
//   desconto: ficha daqui = desconto_pct gravado ao salvar; ficha do P2S =
//             recalculado aqui contra a tabela (valoresTabelaLote);
//   prazo:    dias do evento − dias cobrados (ficha do P2S: 0, o P2S já cobra
//             pelos dias do item — prazo menor aparece como desconto).
// Fontes de recebimento na fase paralela:
//   P2S     financeiro_contas_receber quitados; a ficha vem da descrição
//           ("Ficha Loc. 027666 /A", "Fichas 022556/A, 022803/A…"); título com
//           várias fichas é rateado pelo valor de cada ficha;
//   SISTEMA financeiro_titulos_receber PAGOS das fichas criadas aqui.
// O mês em aberto é calculado na hora; o fechamento grava os lançamentos
// (comercial_comissao_lancamentos) e eles não mudam mais.
// SEM checagem de acesso — quem chama (server action) valida.
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { numeroFicha } from '../locacao/fichaNumero';
import { diasInclusivos } from '../locacao/datas';
import { valoresTabelaLote, type Modalidade } from '../locacao/precificacao';
import { pctLocacaoAplicada, normalizarFaixasDesconto, normalizarFaixasPrazo, type RegraComissao } from './regraComissao';

type Db = ReturnType<typeof supabaseAdmin>;
const arred = (v: number) => Math.round(v * 100) / 100;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export interface LinhaComissao {
  fonte: 'P2S' | 'SISTEMA';
  titulo_ref: string;
  ficha_chave: string;
  ficha_id: number | null;
  ficha_numero: string;
  cliente: string;
  descricao: string;
  recebido_em: string;
  valor_recebido: number;
  pct_efetivo: number;
  valor_comissao: number;
  vendedor_id: number;
  rateio: boolean;
  pct_locacao_aplicada: number;
  desconto_pct: number;
  dias_nao_cobrados: number;
  regra_motivo: string;
}

export interface Pendencia { fonte: 'P2S' | 'SISTEMA'; titulo_ref: string; descricao: string; cliente: string; recebido_em: string; valor: number; motivo: string }

/** Números de ficha citados na descrição do título do P2S (6 dígitos, como p2s_numero). */
export function numerosFichaNaDescricao(descricao: string | null | undefined): string[] {
  const d = descricao || '';
  const pos = d.search(/ficha/i);
  if (pos < 0) return [];
  const nums = [...d.slice(pos).matchAll(/\b(\d{5,6})\b/g)].map(m => m[1].padStart(6, '0'));
  return [...new Set(nums)];
}

interface FichaComissao {
  id: number; chave: string; numero: string; vendedor_id: number | null; valor_total: number; cliente: string;
  baseLoc: number; baseServ: number; bruto: number;
  descontoPct: number; diasNaoCobrados: number;
}

async function carregarFichas(db: Db, filtro: { coluna: 'p2s_numero' | 'id'; valores: (string | number)[] }): Promise<FichaComissao[]> {
  const out: FichaComissao[] = [];
  const valores = [...new Set(filtro.valores)];
  for (let i = 0; i < valores.length; i += 200) {
    const lote = valores.slice(i, i + 200);
    let q = db.from('locacao_fichas_reserva')
      .select('id, origem, p2s_numero, vendedor_id, valor_total, valor_equipamentos, valor_servicos, desconto_pct, dias_cobrados, data_inicio, data_fim, empresa_id, parceiro_id, evento_id, modalidade, parceiro:parceiros(nome_exibicao, nome_completo)')
      .in(filtro.coluna, lote);
    if (filtro.coluna === 'p2s_numero') q = q.eq('origem', 'P2S');
    const { data: fichas, error } = await q;
    if (error) throw error;
    const ids = (fichas || []).map((f: any) => f.id);
    const { data: itens, error: eI } = ids.length
      ? await db.from('locacao_fichas_reserva_itens').select('ficha_id, tipo, descricao, produto_id, quantidade, dias, valor_unitario, valor_total').in('ficha_id', ids)
      : { data: [], error: null };
    if (eI) throw eI;
    const porFicha = new Map<number, { loc: number; serv: number; bruto: number }>();
    for (const it of (itens || []) as any[]) {
      const x = porFicha.get(it.ficha_id) || { loc: 0, serv: 0, bruto: 0 };
      const v = n(it.valor_total);
      const ehFrete = it.tipo === 'FRETE' || (it.tipo === 'SERVICO' && /^\s*frete/i.test(it.descricao || ''));
      if (!ehFrete) {
        if (it.tipo === 'SERVICO') x.serv += v; else x.loc += v;
      }
      x.bruto += v;
      porFicha.set(it.ficha_id, x);
    }
    // desconto das fichas do P2S: contra a tabela, em lote
    const itensPorFicha = new Map<number, any[]>();
    for (const it of (itens || []) as any[]) itensPorFicha.set(it.ficha_id, [...(itensPorFicha.get(it.ficha_id) || []), it]);
    const doP2s = ((fichas || []) as any[]).filter(f => f.origem === 'P2S');
    const ehEquipComProduto = (it: any) => (it.tipo === 'EQUIPAMENTO' || it.tipo === 'KIT') && it.produto_id;
    const tabela = await valoresTabelaLote(db, doP2s.map(f => ({
      chave: String(f.id), empresaId: f.empresa_id, parceiroId: f.parceiro_id, eventoId: f.evento_id, dataRef: f.data_inicio,
      modalidade: (f.modalidade || 'DIARIA') as Modalidade,
      itens: (itensPorFicha.get(f.id) || []).filter(ehEquipComProduto).map(it => ({ produto_id: it.produto_id, dias: n(it.dias) || n(f.dias_cobrados) || 1 })),
    })));
    const descontoP2s = (f: any): number => {
      const its = itensPorFicha.get(f.id) || [];
      const valores = tabela.get(String(f.id)) || [];
      let k = 0;
      // No P2S é comum o pacote ir num item e os acessórios ficarem a R$ 0 —
      // item a R$ 0 fica fora da referência (senão vira "desconto" falso).
      const ref = its.reduce((s, it) => {
        const vt = ehEquipComProduto(it) ? valores[k++] : null;
        if (!(n(it.valor_unitario) > 0)) return s;
        return s + n(it.quantidade) * (vt !== null && vt !== undefined ? vt : n(it.valor_unitario));
      }, 0);
      return ref > 0.009 ? Math.max(0, Math.round(((ref - n(f.valor_total)) / ref) * 10000) / 100) : 0;
    };

    for (const f of (fichas || []) as any[]) {
      let b = porFicha.get(f.id);
      // sem itens gravados: usa o cabeçalho
      if (!b || b.bruto <= 0.009) b = { loc: n(f.valor_equipamentos), serv: n(f.valor_servicos), bruto: n(f.valor_equipamentos) + n(f.valor_servicos) };
      out.push({
        id: f.id, chave: f.origem === 'P2S' ? String(f.p2s_numero) : String(f.id), numero: numeroFicha(f),
        vendedor_id: f.vendedor_id, valor_total: n(f.valor_total),
        cliente: f.parceiro ? (f.parceiro.nome_exibicao || f.parceiro.nome_completo || '') : '',
        baseLoc: b.loc, baseServ: b.serv, bruto: b.bruto,
        descontoPct: f.origem === 'P2S' ? descontoP2s(f) : n(f.desconto_pct),
        diasNaoCobrados: f.origem === 'P2S' || !f.data_inicio || !f.data_fim || !f.dias_cobrados ? 0 : Math.max(0, diasInclusivos(f.data_inicio, f.data_fim) - n(f.dias_cobrados)),
      });
    }
  }
  return out;
}

export async function regrasVendedores(db: Db): Promise<Map<number, RegraComissao & { ativo: boolean }>> {
  const { data, error } = await db.from('comercial_comissao_vendedores').select('*');
  if (error) throw error;
  return new Map(((data || []) as any[]).map(r => [r.vendedor_id as number, {
    pct_locacao: n(r.pct_locacao), pct_servicos: n(r.pct_servicos), ativo: !!r.ativo,
    faixas_desconto: normalizarFaixasDesconto(r.faixas_desconto), faixas_prazo: normalizarFaixasPrazo(r.faixas_prazo),
  }]));
}

export async function inicioComissoes(db: Db): Promise<string> {
  const { data } = await db.from('comercial_comissao_config').select('inicio').eq('id', 1).maybeSingle();
  return (data?.inicio as string) || new Date().toISOString().slice(0, 8) + '01';
}


/**
 * Recebimentos ainda não fechados, de `inicio` até `ate` (inclusive).
 * vendedorId: só as linhas desse vendedor (visão do vendedor padrão).
 */
export async function calcularComissoesAbertas(db: Db, ate: string, vendedorId?: number | null): Promise<{ linhas: LinhaComissao[]; pendencias: Pendencia[]; inicio: string }> {
  const inicio = await inicioComissoes(db);
  const linhas: LinhaComissao[] = [];
  const pendencias: Pendencia[] = [];
  if (ate < inicio) return { linhas, pendencias, inicio };
  const regras = await regrasVendedores(db);

  // ---------------- P2S ----------------
  const { data: recP2s, error: e1 } = await buscarTodasPaginas<any>((de, a) => db.from('financeiro_contas_receber')
    .select('id, p2s_oid, descricao, cliente, valor_final, valor_pago, data_quitacao')
    .eq('quitado', true).gte('data_quitacao', inicio).lte('data_quitacao', ate).order('id').range(de, a), 1000, 50000);
  if (e1) throw e1;
  const numeros = recP2s.flatMap(r => numerosFichaNaDescricao(r.descricao));
  const fichasP2s = await carregarFichas(db, { coluna: 'p2s_numero', valores: numeros });
  const porNumero = new Map(fichasP2s.map(f => [f.chave, f]));

  // ---------------- SISTEMA ----------------
  const { data: recSis, error: e2 } = await buscarTodasPaginas<any>((de, a) => db.from('financeiro_titulos_receber')
    .select('id, ficha_id, descricao, valor, valor_pago, juros_multa, data_pagamento, cliente:parceiros(nome_exibicao, nome_completo)')
    .eq('status', 'PAGO').not('ficha_id', 'is', null).gte('data_pagamento', inicio).lte('data_pagamento', ate).order('id').range(de, a), 1000, 50000);
  if (e2) throw e2;
  const fichasSis = await carregarFichas(db, { coluna: 'id', valores: recSis.map(r => r.ficha_id) });
  const porId = new Map(fichasSis.map(f => [f.id, f]));

  // já fechados
  const fechados = new Set<string>();
  const refs = [...recP2s.map(r => `P2S|${r.id}`), ...recSis.map(r => `SISTEMA|${r.id}`)];
  for (let i = 0; i < refs.length; i += 300) {
    const lote = refs.slice(i, i + 300).map(x => x.split('|')[1]);
    const { data, error } = await db.from('comercial_comissao_lancamentos').select('fonte, titulo_ref, ficha_chave').in('titulo_ref', lote);
    if (error) throw error;
    for (const l of (data || []) as any[]) fechados.add(`${l.fonte}|${l.titulo_ref}|${l.ficha_chave}`);
  }

  const empurrar = (fonte: 'P2S' | 'SISTEMA', ref: string, f: FichaComissao, valor: number, recebidoEm: string, descricao: string, clienteTitulo: string, rateio: boolean) => {
    if (fechados.has(`${fonte}|${ref}|${f.chave}`)) return;
    if (!f.vendedor_id) { pendencias.push({ fonte, titulo_ref: ref, descricao, cliente: clienteTitulo || f.cliente, recebido_em: recebidoEm, valor, motivo: `${f.numero} sem vendedor` }); return; }
    if (vendedorId && f.vendedor_id !== vendedorId) return;
    const r = regras.get(f.vendedor_id);
    if (r && !r.ativo) return;
    const regra = r || { pct_locacao: 0, pct_servicos: 0, faixas_desconto: [], faixas_prazo: [] };
    const loc = pctLocacaoAplicada(regra, f.descontoPct, f.diasNaoCobrados);
    const pct = f.bruto > 0.009 ? (f.baseLoc * loc.pct + f.baseServ * regra.pct_servicos) / f.bruto : 0;
    linhas.push({
      pct_locacao_aplicada: loc.pct, desconto_pct: f.descontoPct, dias_nao_cobrados: f.diasNaoCobrados, regra_motivo: loc.motivo,
      fonte, titulo_ref: ref, ficha_chave: f.chave, ficha_id: f.id, ficha_numero: f.numero, cliente: f.cliente || clienteTitulo,
      descricao, recebido_em: recebidoEm, valor_recebido: arred(valor), pct_efetivo: Math.round(pct * 10000) / 10000,
      valor_comissao: arred(valor * pct / 100), vendedor_id: f.vendedor_id, rateio,
    });
  };

  for (const r of recP2s) {
    // recebido sem juros: o menor entre o pago e o valor do título
    const recebido = Math.min(n(r.valor_pago) || n(r.valor_final), n(r.valor_final) || n(r.valor_pago));
    if (recebido <= 0) continue;
    const nums = numerosFichaNaDescricao(r.descricao);
    const achadas = nums.map(x => porNumero.get(x)).filter((x): x is FichaComissao => !!x);
    if (!achadas.length) {
      if (!vendedorId) pendencias.push({ fonte: 'P2S', titulo_ref: String(r.id), descricao: r.descricao || '', cliente: r.cliente || '', recebido_em: r.data_quitacao, valor: recebido, motivo: nums.length ? `ficha ${nums.join(', ')} não importada` : 'título sem nº de ficha' });
      continue;
    }
    const pesoTotal = achadas.reduce((s, f) => s + Math.max(0, f.valor_total), 0);
    for (const f of achadas) {
      const parte = achadas.length === 1 ? recebido : pesoTotal > 0 ? recebido * Math.max(0, f.valor_total) / pesoTotal : recebido / achadas.length;
      empurrar('P2S', String(r.id), f, parte, r.data_quitacao, r.descricao || '', r.cliente || '', achadas.length > 1 || nums.length > achadas.length);
    }
  }
  for (const r of recSis) {
    const f = porId.get(r.ficha_id);
    if (!f) continue;
    const recebido = Math.max(0, (n(r.valor_pago) || n(r.valor)) - n(r.juros_multa));
    if (recebido <= 0) continue;
    const cli = r.cliente ? (r.cliente.nome_exibicao || r.cliente.nome_completo || '') : '';
    empurrar('SISTEMA', String(r.id), f, recebido, r.data_pagamento, r.descricao || '', cli, false);
  }

  linhas.sort((a, b) => a.recebido_em.localeCompare(b.recebido_em) || a.ficha_numero.localeCompare(b.ficha_numero));
  return { linhas, pendencias, inicio };
}

export const primeiroDiaMes = (iso: string) => `${iso.slice(0, 7)}-01`;
export function ultimoDiaMes(iso: string): string {
  const [a, m] = iso.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
