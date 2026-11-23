// app/lib/virada/ensaio.ts
// "Limpar o ensaio" — passo da Virada da Chave (2026-11-22), feito ANTES de
// congelar o P2S.
//
// Durante a fase paralela a equipe testa as telas novas (roteiro de testes):
// fichas, reservas, fichas de locação, títulos, Notas de Débito de ensaio,
// avarias, OS de manutenção, sublocações e lançamentos de caixa ficam no banco.
// Depois da virada isso viraria dado real: reserva de teste ocupando a agenda,
// título de teste no DRE e no fluxo de caixa, avaria de teste a cobrar.
//
// Regra: tudo isso nasceu no sistema antes do congelamento, logo é ensaio (o
// oficial ainda está no P2S). Nada é APAGADO — é cancelado pelas mesmas rotinas
// das telas (desfazem os efeitos: OS devolve o patrimônio/saldo, estorno apaga
// o movimento de caixa, reserva cancelada libera a agenda) e fica no histórico.
// Exceção: lançamentos de caixa feitos à mão não têm "cancelado" — esses são
// excluídos, e só quando marcados (podem ser lançamentos reais).
// Ficam fora sempre: OPs e seus títulos (reais desde antes da virada), checklists
// da Expedição (operação real) e notas fiscais (homologação já é teste).
import type { supabaseAdmin } from '../supabase';
import { buscarTodasPaginas } from '../paginacao';
import { mudarStatusManutencao, STATUS_OS_ABERTOS } from '../locacao/manutencao';
import { cancelarSublocacao } from '../locacao/sublocacao';
import { estornarBaixa, cancelarTitulo } from '../financeiro/pagar';
import { cancelarFatura } from '../financeiro/faturamento';

type Db = ReturnType<typeof supabaseAdmin>;

const MOTIVO = 'Ensaio da fase paralela — limpeza da Virada da Chave';
const num = (v: unknown) => Number(v) || 0;
const arred = (n: number) => Math.round(n * 100) / 100;
const ORIGENS_CAIXA = ['MANUAL', 'AJUSTE', 'TRANSFERENCIA', 'EXTRATO'];

export type CategoriaEnsaio = 'fichas' | 'fichas_locacao' | 'titulos_receber' | 'faturas' | 'titulos_pagar' | 'avarias' | 'manutencoes' | 'sublocacoes' | 'caixa';

export const CATEGORIAS_ENSAIO: { chave: CategoriaEnsaio; titulo: string; acao: string; padrao: boolean }[] = [
  { chave: 'fichas', titulo: 'Orçamentos e OS criados no sistema', acao: 'cancela e libera as reservas da agenda', padrao: true },
  { chave: 'fichas_locacao', titulo: 'Fichas de locação abertas', acao: 'encerra como canceladas (sem extravio nem reposição)', padrao: true },
  { chave: 'titulos_receber', titulo: 'Títulos a receber', acao: 'estorna recebimentos e cancela', padrao: true },
  { chave: 'faturas', titulo: 'Notas de Débito de ensaio', acao: 'cancela', padrao: true },
  { chave: 'titulos_pagar', titulo: 'Contas a pagar lançadas à mão e recorrentes (sem OP)', acao: 'estorna pagamentos, cancela e desliga as recorrências', padrao: true },
  { chave: 'avarias', titulo: 'Avarias com cobrança pendente', acao: 'marca como "não cobrar"', padrao: true },
  { chave: 'manutencoes', titulo: 'OS de manutenção abertas', acao: 'cancela (patrimônio e saldo voltam)', padrao: true },
  { chave: 'sublocacoes', titulo: 'Sublocações em andamento', acao: 'cancela', padrao: true },
  { chave: 'caixa', titulo: 'Lançamentos de caixa feitos à mão (avulsos, ajustes, transferências, do extrato)', acao: 'EXCLUI — marque só se forem todos de teste', padrao: false },
];

interface Previa { chave: CategoriaEnsaio; qtd: number; valor: number | null; exemplos: string[] }

async function idsContasDaEmpresa(db: Db, E: number) {
  const { data } = await db.from('financeiro_contas').select('id').eq('empresa_id', E);
  return ((data || []) as any[]).map(c => c.id as number);
}

/** O que seria limpo, por categoria (só leitura). */
export async function previaEnsaio(db: Db, E: number): Promise<Previa[]> {
  const contas = await idsContasDaEmpresa(db, E);
  const [fichas, fls, tr, fat, tp, rec, av, man, sub, cx] = await Promise.all([
    buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_reserva').select('id, status, valor_total').eq('empresa_id', E).eq('origem', 'SISTEMA').is('migrada_p2s_em', null).neq('status', 'CANCELADA').order('id').range(d, a)),
    db.from('locacao_fichas_locacao').select('id, numero').eq('empresa_id', E).eq('origem', 'SISTEMA').is('migrada_p2s_em', null).eq('status', 'A'),
    buscarTodasPaginas<any>((d, a) => db.from('financeiro_titulos_receber').select('id, valor, status').eq('empresa_id', E).neq('status', 'CANCELADO').neq('origem', 'MIGRADO').order('id').range(d, a)),
    db.from('financeiro_faturas').select('id, serie, numero, valor_total').eq('empresa_id', E).eq('serie', 'ENSAIO').neq('status', 'CANCELADA'),
    buscarTodasPaginas<any>((d, a) => db.from('financeiro_titulos_pagar').select('id, valor, status').eq('empresa_id', E).in('origem', ['MANUAL', 'RECORRENCIA']).neq('status', 'CANCELADO').order('id').range(d, a)),
    db.from('financeiro_recorrencias').select('id').eq('empresa_id', E).eq('ativa', true),
    db.from('locacao_avarias').select('id, valor_cobranca, status_cobranca').eq('empresa_id', E).neq('status_cobranca', 'NAO_COBRAR'),
    db.from('locacao_manutencoes').select('id').eq('empresa_id', E).in('status', STATUS_OS_ABERTOS),
    db.from('locacao_sublocacoes').select('id').eq('empresa_id', E).in('status', ['SOLICITADO', 'CONFIRMADO']),
    contas.length ? db.from('financeiro_movimentos').select('id, tipo, valor, descricao').in('conta_id', contas).in('origem', ORIGENS_CAIXA) : Promise.resolve({ data: [] as any[] }),
  ]);
  for (const r of [fichas, fls, tr, fat, tp, rec, av, man, sub, cx] as any[]) if (r?.error) throw r.error;
  const lista = (r: any) => (r.data || []) as any[];
  const soma = (l: any[], f: (x: any) => number) => arred(l.reduce((s, x) => s + f(x), 0));
  return [
    { chave: 'fichas', qtd: lista(fichas).length, valor: soma(lista(fichas), x => num(x.valor_total)), exemplos: [] },
    { chave: 'fichas_locacao', qtd: lista(fls).length, valor: null, exemplos: lista(fls).slice(0, 5).map(f => f.numero) },
    { chave: 'titulos_receber', qtd: lista(tr).length, valor: soma(lista(tr), x => num(x.valor)), exemplos: [] },
    { chave: 'faturas', qtd: lista(fat).length, valor: soma(lista(fat), x => num(x.valor_total)), exemplos: [] },
    { chave: 'titulos_pagar', qtd: lista(tp).length + lista(rec).length, valor: soma(lista(tp), x => num(x.valor)), exemplos: lista(rec).length ? [`${lista(rec).length} recorrência(s) ativa(s)`] : [] },
    { chave: 'avarias', qtd: lista(av).length, valor: soma(lista(av), x => num(x.valor_cobranca)), exemplos: [] },
    { chave: 'manutencoes', qtd: lista(man).length, valor: null, exemplos: [] },
    { chave: 'sublocacoes', qtd: lista(sub).length, valor: null, exemplos: [] },
    { chave: 'caixa', qtd: lista(cx).length, valor: null, exemplos: lista(cx).slice(0, 5).map(m => `${m.tipo === 'ENTRADA' ? '+' : '−'} ${arred(num(m.valor))} ${String(m.descricao || '').slice(0, 40)}`) },
  ];
}

/** Executa a limpeza das categorias escolhidas. Só antes de congelar o P2S. */
export async function limparEnsaio(db: Db, E: number, categorias: CategoriaEnsaio[], usuario: string) {
  const { data: v } = await db.from('parametros_virada').select('etapa').eq('empresa_id', E).maybeSingle();
  if (v && v.etapa !== 'PREPARACAO') throw new Error('A limpeza do ensaio é feita antes de congelar o P2S — depois disso, o que nasce no sistema já é real.');
  const quer = new Set(categorias);
  const feito: Record<string, number> = {};
  const erros: string[] = [];
  const tentar = async (rotulo: string, fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e: any) { erros.push(`${rotulo}: ${e?.message || e}`); return false; } };
  const agora = () => new Date().toISOString();

  // 1) Títulos a receber primeiro (a Nota de Débito só cancela sem parcela recebida).
  if (quer.has('titulos_receber')) {
    const { data } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_titulos_receber').select('id, status, movimento_id, avaria_id').eq('empresa_id', E).neq('status', 'CANCELADO').neq('origem', 'MIGRADO').order('id').range(d, a));
    let n = 0;
    for (const t of data) {
      if (await tentar(`título a receber #${t.id}`, async () => {
        if (t.movimento_id) {
          await db.from('financeiro_extrato_linhas').update({ status: 'PENDENTE', movimento_id: null, conciliado_por: null, conciliado_em: null }).eq('movimento_id', t.movimento_id);
          await db.from('financeiro_movimentos').delete().eq('id', t.movimento_id);
        }
        const { error } = await db.from('financeiro_titulos_receber').update({ status: 'CANCELADO', motivo_cancelamento: MOTIVO, movimento_id: null, atualizado_em: agora() }).eq('id', t.id);
        if (error) throw error;
      })) n++;
    }
    feito.titulos_receber = n;
  }
  if (quer.has('faturas')) {
    const { data } = await db.from('financeiro_faturas').select('id').eq('empresa_id', E).eq('serie', 'ENSAIO').neq('status', 'CANCELADA');
    let n = 0;
    for (const f of (data || []) as any[]) if (await tentar(`Nota de Débito #${f.id}`, () => cancelarFatura(db, f.id, MOTIVO, usuario))) n++;
    feito.faturas = n;
  }
  if (quer.has('titulos_pagar')) {
    const { data } = await buscarTodasPaginas<any>((d, a) => db.from('financeiro_titulos_pagar').select('id, status').eq('empresa_id', E).in('origem', ['MANUAL', 'RECORRENCIA']).neq('status', 'CANCELADO').order('id').range(d, a));
    let n = 0;
    for (const t of data) if (await tentar(`conta a pagar #${t.id}`, async () => { if (t.status === 'PAGO') await estornarBaixa(db, t.id); await cancelarTitulo(db, t.id, MOTIVO); })) n++;
    const { data: recs } = await db.from('financeiro_recorrencias').update({ ativa: false }).eq('empresa_id', E).eq('ativa', true).select('id');
    feito.titulos_pagar = n;
    feito.recorrencias = (recs || []).length;
  }
  // 2) Operação de locação.
  if (quer.has('sublocacoes')) {
    const { data } = await db.from('locacao_sublocacoes').select('id').eq('empresa_id', E).in('status', ['SOLICITADO', 'CONFIRMADO']);
    let n = 0;
    for (const s of (data || []) as any[]) if (await tentar(`sublocação #${s.id}`, () => cancelarSublocacao(db, s.id, MOTIVO, usuario))) n++;
    feito.sublocacoes = n;
  }
  if (quer.has('manutencoes')) {
    const { data } = await db.from('locacao_manutencoes').select('id').eq('empresa_id', E).in('status', STATUS_OS_ABERTOS);
    let n = 0;
    for (const m of (data || []) as any[]) if (await tentar(`OS de manutenção #${m.id}`, () => mudarStatusManutencao(db, m.id, 'CANCELADA', { observacoes: MOTIVO }, usuario))) n++;
    feito.manutencoes = n;
  }
  if (quer.has('avarias')) {
    const { data, error } = await db.from('locacao_avarias').update({ status_cobranca: 'NAO_COBRAR', observacao_cobranca: MOTIVO, atualizado_em: agora() }).eq('empresa_id', E).neq('status_cobranca', 'NAO_COBRAR').select('id');
    if (error) erros.push(`avarias: ${error.message}`);
    feito.avarias = (data || []).length;
  }
  if (quer.has('fichas_locacao')) {
    const { data, error } = await db.from('locacao_fichas_locacao').update({ status: 'C', finalizada_em: agora(), finalizada_por: usuario, observacoes: MOTIVO })
      .eq('empresa_id', E).eq('origem', 'SISTEMA').is('migrada_p2s_em', null).eq('status', 'A').select('id');
    if (error) erros.push(`fichas de locação: ${error.message}`);
    feito.fichas_locacao = (data || []).length;
  }
  if (quer.has('fichas')) {
    const { data } = await buscarTodasPaginas<any>((d, a) => db.from('locacao_fichas_reserva').select('id, status').eq('empresa_id', E).eq('origem', 'SISTEMA').is('migrada_p2s_em', null).neq('status', 'CANCELADA').order('id').range(d, a));
    let n = 0;
    for (const f of data) {
      if (await tentar(`ficha #${f.id}`, async () => {
        const { error: eA } = await db.from('locacao_alocacoes').update({ status: 'CANCELADO', updated_at: agora() }).eq('ficha_id', f.id).neq('status', 'CANCELADO');
        if (eA) throw eA;
        const { error } = await db.from('locacao_fichas_reserva').update({ status: 'CANCELADA', updated_at: agora() }).eq('id', f.id);
        if (error) throw error;
        await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: f.id, usuario, acao: 'CANCELADA', detalhe: MOTIVO, status_de: f.status, status_para: 'CANCELADA' });
      })) n++;
    }
    feito.fichas = n;
  }
  // 3) Caixa (só marcado): lançamentos à mão não têm "cancelado" — são excluídos.
  if (quer.has('caixa')) {
    const contas = await idsContasDaEmpresa(db, E);
    let n = 0;
    if (contas.length) {
      const { data } = await db.from('financeiro_movimentos').select('id').in('conta_id', contas).in('origem', ORIGENS_CAIXA);
      const ids = ((data || []) as any[]).map(m => m.id);
      if (ids.length) {
        await db.from('financeiro_extrato_linhas').update({ status: 'PENDENTE', movimento_id: null, conciliado_por: null, conciliado_em: null }).in('movimento_id', ids);
        const { error } = await db.from('financeiro_movimentos').delete().in('id', ids);
        if (error) erros.push(`caixa: ${error.message}`); else n = ids.length;
      }
    }
    feito.caixa = n;
  }

  const resumo = Object.entries(feito).map(([k, q]) => `${k} ${q}`).join(' · ');
  const atual = await db.from('parametros_virada').select('log').eq('empresa_id', E).maybeSingle();
  const log = [...(((atual.data?.log as any[]) || [])), { em: agora(), por: usuario, acao: 'LIMPOU O ENSAIO', detalhe: `${resumo || 'nada'}${erros.length ? ` · ${erros.length} erro(s)` : ''}` }].slice(-300);
  await db.from('parametros_virada').update({ log, atualizado_em: agora() }).eq('empresa_id', E);
  return { feito, erros };
}
