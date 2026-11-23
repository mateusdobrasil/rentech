// app/lib/locacao/eventosP2s.ts
// Eventos do P2S nas fichas importadas (2026-11-22).
//
// O problema: o sync diário de eventos só traz os últimos 60 dias + futuros, e
// os ~5,5 mil eventos antigos vieram de uma planilha SEM o oid do P2S. A
// importação de fichas liga a ficha ao evento pelo oid (f.Evento) — então 28 mil
// das 31 mil fichas do P2S ficaram sem evento (relatório de Eventos, Diretor,
// comparação com a edição anterior).
//
// O conserto, em três peças:
// - gravarEventos: grava eventos vindos do P2S ADOTANDO a linha da planilha
//   quando nome + data inicial batem (ganha o p2s_oid e mantém o id); o resto
//   entra por upsert no p2s_oid. Conflito de nome+data entre dois eventos do
//   P2S não derruba o lote: a linha é pulada e contada.
// - backfillEventosP2s: carga de todos os eventos do P2S, ano a ano.
// - religarEventosFichas: lê as fichas do P2S mês a mês em modo proxy (11x mais
//   rápido, já traz o campo Evento) e preenche evento_id onde está vazio.
// - garantirEventosPorOid: a importação de fichas busca na hora o evento que
//   ainda não está aqui (evita o buraco daqui pra frente).
import type { supabaseAdmin } from '../supabase';
import { consultarObjetos, buscarObjeto, criterio, type AmbienteP2s, type ObjetoP2s } from '../p2s';
import { converterEventosP2s } from '../../admin/comercial/eventos-feiras/eventosCore';

type Db = ReturnType<typeof supabaseAdmin>;
type Linha = Awaited<ReturnType<typeof converterEventosP2s>>[number];

const EPOCA = Date.UTC(1899, 11, 30);
const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - EPOCA) / 86_400_000);
const ref = (v: unknown) => { const s = v ? String(v) : ''; return s && s !== 'null' ? s : null; };
const chaveNome = (nome: unknown, data: unknown) => `${String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()}|${data || ''}`;

export interface ResultadoEventos { lidos: number; adotados: number; gravados: number; conflitos: number }

/** Grava eventos do P2S: adota a linha da planilha (sem p2s_oid) de mesmo nome + data; o resto por p2s_oid. */
export async function gravarEventos(db: Db, linhas: Linha[]): Promise<ResultadoEventos> {
  const res: ResultadoEventos = { lidos: linhas.length, adotados: 0, gravados: 0, conflitos: 0 };
  if (!linhas.length) return res;
  const porOid = new Map(linhas.map(l => [l.p2s_oid, l]));
  const unicas = [...porOid.values()];

  // Já ligados por oid: só atualiza (upsert). Sem oid ainda: tenta adotar a linha da planilha.
  const jaTem = new Set<string>();
  const oids = unicas.map(l => l.p2s_oid);
  for (let i = 0; i < oids.length; i += 300) {
    const { data } = await db.from('eventos_feiras').select('p2s_oid').in('p2s_oid', oids.slice(i, i + 300));
    for (const r of (data || []) as any[]) jaTem.add(r.p2s_oid);
  }
  const novas = unicas.filter(l => !jaTem.has(l.p2s_oid));
  const datas = [...new Set(novas.map(l => l.data_inicial).filter(Boolean))] as string[];
  const planilha = new Map<string, number>();
  for (let i = 0; i < datas.length; i += 200) {
    const { data } = await db.from('eventos_feiras').select('id, nome, data_inicial').is('p2s_oid', null).in('data_inicial', datas.slice(i, i + 200));
    for (const r of (data || []) as any[]) planilha.set(chaveNome(r.nome, r.data_inicial), r.id);
  }
  const resto: Linha[] = [...unicas.filter(l => jaTem.has(l.p2s_oid))];
  for (const l of novas) {
    const id = planilha.get(chaveNome(l.nome, l.data_inicial));
    if (id) {
      planilha.delete(chaveNome(l.nome, l.data_inicial));
      const { error } = await db.from('eventos_feiras').update(l).eq('id', id);
      if (error) res.conflitos++; else res.adotados++;
    } else resto.push(l);
  }
  for (let i = 0; i < resto.length; i += 500) {
    const lote = resto.slice(i, i + 500);
    const { error } = await db.from('eventos_feiras').upsert(lote, { onConflict: 'p2s_oid' });
    if (!error) { res.gravados += lote.length; continue; }
    // Algum par nome+data repetido no lote/na tabela: grava um a um, pulando o conflito.
    for (const l of lote) {
      const { error: e1 } = await db.from('eventos_feiras').upsert(l, { onConflict: 'p2s_oid' });
      if (e1) res.conflitos++; else res.gravados++;
    }
  }
  return res;
}

/** Carga de todos os eventos do P2S, ano a ano (DataInicial). */
export async function backfillEventosP2s(db: Db, ambiente: AmbienteP2s, anoDe: number, anoAte: number, aoAvancar?: (ano: number, r: ResultadoEventos) => void) {
  const total: ResultadoEventos = { lidos: 0, adotados: 0, gravados: 0, conflitos: 0 };
  for (let ano = anoDe; ano <= anoAte; ano++) {
    const r = await consultarObjetos(ambiente, 'TCustomEvento', [criterio('DataInicial', 'ge', 'dbl', serial(`${ano}-01-01`)), criterio('DataInicial', 'lt', 'dbl', serial(`${ano + 1}-01-01`))], { order: 'DataInicial' });
    const g = await gravarEventos(db, await converterEventosP2s(ambiente, r.objectlist));
    for (const k of Object.keys(total) as (keyof ResultadoEventos)[]) total[k] += g[k];
    aoAvancar?.(ano, g);
  }
  return total;
}

/** Busca no P2S os eventos (por oid) que ainda não estão aqui e grava. Devolve quantos trouxe. */
export async function garantirEventosPorOid(db: Db, ambiente: AmbienteP2s, oids: string[], limite = 60): Promise<number> {
  const unicos = [...new Set(oids.filter(Boolean))];
  if (!unicos.length) return 0;
  const existentes = new Set<string>();
  for (let i = 0; i < unicos.length; i += 300) {
    const { data } = await db.from('eventos_feiras').select('p2s_oid').in('p2s_oid', unicos.slice(i, i + 300));
    for (const r of (data || []) as any[]) existentes.add(r.p2s_oid);
  }
  const faltam = unicos.filter(o => !existentes.has(o)).slice(0, limite);
  if (!faltam.length) return 0;
  const objs: ObjetoP2s[] = [];
  for (const oid of faltam) { const o = await buscarObjeto(ambiente, oid).catch(() => null); if (o && o.classname === 'TCustomEvento') objs.push(o); }
  const g = await gravarEventos(db, await converterEventosP2s(ambiente, objs));
  return g.adotados + g.gravados;
}

export interface ResultadoReligar { meses: number; fichasLidas: number; religadas: number; semEventoNoP2s: number; eventoNaoEncontrado: number }

/** Preenche evento_id das fichas do P2S sem evento, mês a mês (DataEmissao), em modo proxy. */
export async function religarEventosFichas(db: Db, ambiente: AmbienteP2s, de: string, ate: string, aoAvancar?: (mes: string, r: ResultadoReligar) => void) {
  const res: ResultadoReligar = { meses: 0, fichasLidas: 0, religadas: 0, semEventoNoP2s: 0, eventoNaoEncontrado: 0 };
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7); ) {
    const [y, mm] = m.split('-').map(Number);
    const prox = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
    const r = await consultarObjetos(ambiente, 'TCustomFichaReservaLocacao', [criterio('DataEmissao', 'ge', 'dbl', serial(`${m}-01`)), criterio('DataEmissao', 'lt', 'dbl', serial(`${prox}-01`))], { proxy: true });
    res.meses++; res.fichasLidas += r.objectlist.length;
    const eventoDaFicha = new Map<string, string>();
    for (const f of r.objectlist) { const ev = ref(f.Evento); if (ev) eventoDaFicha.set(f.oid, ev); else res.semEventoNoP2s++; }
    // Só as fichas daqui sem evento.
    const oidsFichas = [...eventoDaFicha.keys()];
    const semEvento: string[] = [];
    for (let i = 0; i < oidsFichas.length; i += 300) {
      const { data } = await db.from('locacao_fichas_reserva').select('p2s_oid').eq('origem', 'P2S').is('evento_id', null).in('p2s_oid', oidsFichas.slice(i, i + 300));
      for (const x of (data || []) as any[]) semEvento.push(x.p2s_oid);
    }
    if (semEvento.length) {
      const oidsEventos = [...new Set(semEvento.map(o => eventoDaFicha.get(o)!))];
      await garantirEventosPorOid(db, ambiente, oidsEventos, 200);
      const idDoEvento = new Map<string, number>();
      for (let i = 0; i < oidsEventos.length; i += 300) {
        const { data } = await db.from('eventos_feiras').select('id, p2s_oid').in('p2s_oid', oidsEventos.slice(i, i + 300));
        for (const e of (data || []) as any[]) idDoEvento.set(e.p2s_oid, e.id);
      }
      // Agrupa por evento e atualiza em lote.
      const porEvento = new Map<number, string[]>();
      for (const o of semEvento) {
        const id = idDoEvento.get(eventoDaFicha.get(o)!);
        if (!id) { res.eventoNaoEncontrado++; continue; }
        porEvento.set(id, [...(porEvento.get(id) || []), o]);
      }
      for (const [eventoId, fichas] of porEvento) {
        for (let i = 0; i < fichas.length; i += 300) {
          const { data, error } = await db.from('locacao_fichas_reserva').update({ evento_id: eventoId }).eq('origem', 'P2S').is('evento_id', null).in('p2s_oid', fichas.slice(i, i + 300)).select('id');
          if (error) throw error;
          res.religadas += (data || []).length;
        }
      }
    }
    aoAvancar?.(m, res);
    m = prox;
  }
  return res;
}
