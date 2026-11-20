// app/lib/financeiro/planoContas.ts
// Plano de contas do P2S no nosso banco (2026-11-20): Centros
// (TCustomCentroCusto) e Sub-Centros (TCustomSubCentroCusto) em
// financeiro_centros / financeiro_subcentros. Decisão do usuário: cada
// sub-centro vira uma NATUREZA da OP (op_naturezas_pagamento, origem P2S), já
// classificada — "SUBLOCAÇÃO — 6.4 TELEVISORES". As naturezas cadastradas à
// mão continuam; sub-centro que já tem natureza manual não ganha outra.
// Reimportar atualiza nomes (P2S manda) e cria o que surgiu. Só servidor.
import type { supabaseAdmin } from '../supabase';
import { consultarObjetos, type AmbienteP2s } from '../p2s';

type Db = ReturnType<typeof supabaseAdmin>;

const limpo = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
function partesCentro(nomeP2s: string) {
  const m = nomeP2s.match(/^\s*(\d+)\s*-?\s*(.*)$/);
  return m ? { codigo: m[1], nome: limpo(m[2]) || nomeP2s } : { codigo: null, nome: nomeP2s };
}
function partesSub(nomeP2s: string) {
  const m = nomeP2s.match(/^\s*(\d+(?:\.\d+)*)\.?\s+(.*)$/);
  return m ? { codigo: m[1], nome: limpo(m[2]) || nomeP2s } : { codigo: null, nome: nomeP2s };
}
export const nomeNaturezaDoSubcentro = (centroNome: string, subNomeP2s: string) => `${centroNome} — ${subNomeP2s}`.toUpperCase().slice(0, 120);

export async function importarPlanoContasP2s(db: Db, ambiente: AmbienteP2s = 'PRODUCAO') {
  const [rc, rs] = await Promise.all([
    consultarObjetos(ambiente, 'TCustomCentroCusto', [], { proxy: true }),
    consultarObjetos(ambiente, 'TCustomSubCentroCusto', [], { proxy: true }),
  ]);
  const agora = new Date().toISOString();

  // centros
  const centros = (rc.objectlist as any[]).map(o => {
    const nomeP2s = limpo(o.Nome);
    const p = partesCentro(nomeP2s);
    return { p2s_oid: String(o.oid), codigo: p.codigo, nome: p.nome, nome_p2s: nomeP2s, tipo: String(o.Tipo || 'P') === 'R' ? 'R' : 'P', em_desuso: String(o.FlagEmDesuso) === 'true', sincronizado_em: agora };
  }).filter(c => c.nome_p2s);
  const { data: cs, error: eC } = await db.from('financeiro_centros').upsert(centros, { onConflict: 'p2s_oid' }).select('id, p2s_oid, nome, nome_p2s');
  if (eC) throw eC;
  const centroPorOid = new Map(((cs || []) as any[]).map(c => [c.p2s_oid, c]));

  // sub-centros
  const subs = (rs.objectlist as any[]).map(o => {
    const nomeP2s = limpo(o.Nome);
    const p = partesSub(nomeP2s);
    const centro = centroPorOid.get(String(o.CentroFinanceiro || ''));
    return centro ? { p2s_oid: String(o.oid), centro_id: centro.id, codigo: p.codigo, nome: p.nome, nome_p2s: nomeP2s, em_desuso: String(o.FlagEmDesuso) === 'true', sincronizado_em: agora } : null;
  }).filter((s): s is NonNullable<typeof s> => !!s && !!s.nome_p2s);
  const semCentro = (rs.objectlist as any[]).length - subs.length;
  const { data: ss, error: eS } = await db.from('financeiro_subcentros').upsert(subs, { onConflict: 'p2s_oid' }).select('id, p2s_oid, centro_id, nome_p2s, em_desuso');
  if (eS) throw eS;
  const centroPorId = new Map(((cs || []) as any[]).map(c => [c.id, c]));

  // naturezas
  const { data: nats, error: eN } = await db.from('op_naturezas_pagamento').select('id, natureza, origem, subcentro_id, subcentro_financeiro_oid');
  if (eN) throw eN;
  const todas = (nats || []) as any[];
  const p2sPorSub = new Map(todas.filter(n => n.origem === 'P2S' && n.subcentro_id).map(n => [n.subcentro_id, n]));
  const subComManual = new Set(todas.filter(n => n.origem !== 'P2S' && n.subcentro_financeiro_oid).map(n => n.subcentro_financeiro_oid));
  const nomesUsados = new Set(todas.map(n => String(n.natureza).toUpperCase()));
  let criadas = 0, atualizadas = 0, puladas = 0, removidas = 0;
  const novas: any[] = [];
  for (const s of (ss || []) as any[]) {
    const c = centroPorId.get(s.centro_id);
    if (!c) continue;
    const nome = nomeNaturezaDoSubcentro(c.nome, s.nome_p2s);
    const classif = { tipo_classificacao: 'CUSTO', centro_financeiro_oid: c.p2s_oid, centro_financeiro_nome: c.nome_p2s, subcentro_financeiro_oid: s.p2s_oid, subcentro_financeiro_nome: s.nome_p2s };
    const existente = p2sPorSub.get(s.id);
    if (existente) {
      // sub-centro saiu de uso / virou "EXCLUIR": tira a natureza se nenhuma OP a usa
      if (s.em_desuso || /^EXCLU/i.test(String(s.nome_p2s).trim())) {
        const { count } = await db.from('op_ordens_pagamento').select('id', { count: 'exact', head: true }).eq('natureza_pagamento', existente.natureza);
        if (!count) { await db.from('op_naturezas_pagamento').delete().eq('id', existente.id); removidas++; }
        continue;
      }
      if (existente.natureza !== nome && !nomesUsados.has(nome)) {
        await db.from('op_naturezas_pagamento').update({ natureza: nome, ...classif, atualizado_em: agora }).eq('id', existente.id);
        nomesUsados.add(nome); atualizadas++;
      }
      continue;
    }
    // sub-centro chamado "EXCLUIR" está marcado para apagar no P2S — não vira natureza
    if (s.em_desuso || /^EXCLU/i.test(String(s.nome_p2s).trim()) || subComManual.has(s.p2s_oid) || nomesUsados.has(nome)) { puladas++; continue; }
    novas.push({ natureza: nome, origem: 'P2S', subcentro_id: s.id, ...classif, ordem: 0 });
    nomesUsados.add(nome);
  }
  for (let i = 0; i < novas.length; i += 200) {
    const { error } = await db.from('op_naturezas_pagamento').insert(novas.slice(i, i + 200));
    if (error) throw error;
    criadas += Math.min(200, novas.length - i);
  }
  return { centros: centros.length, subcentros: subs.length, semCentro, naturezasCriadas: criadas, naturezasAtualizadas: atualizadas, naturezasRemovidas: removidas, puladas };
}

/**
 * Natureza da OP de uma sublocação: sub-centro do centro "SUBLOCAÇÃO" cujo
 * nome aparece no equipamento/categoria (ex.: "6.4 TELEVISORES" ↔ TV/TELEVISORES).
 */
export async function naturezaSublocacao(db: Db, textoItens: string): Promise<string | null> {
  const { data, error } = await db.from('op_naturezas_pagamento').select('natureza, centro_financeiro_nome, subcentro_financeiro_nome').ilike('centro_financeiro_nome', '%SUBLOCA%');
  if (error || !data?.length) return null;
  const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const texto = sem(textoItens);
  let melhor: { natureza: string; pontos: number } | null = null;
  for (const n of data as any[]) {
    const sub = sem(String(n.subcentro_financeiro_nome || '')).replace(/^[\d.\s]+/, '');
    const palavras = sub.split(/[^A-Z0-9]+/).filter(p => p.length >= 3);
    // singular simples: TELEVISORES → TELEVISOR, NOTEBOOKS → NOTEBOOK
    const pontos = palavras.filter(p => texto.includes(p) || (p.endsWith('S') && texto.includes(p.slice(0, -1))) || (p.endsWith('ES') && texto.includes(p.slice(0, -2)))).length;
    if (pontos > 0 && (!melhor || pontos > melhor.pontos)) melhor = { natureza: n.natureza, pontos };
  }
  return melhor?.natureza ?? null;
}
