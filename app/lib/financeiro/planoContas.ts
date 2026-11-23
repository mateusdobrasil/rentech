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

// ============================================================================
// PLANO DE CONTAS PRÓPRIO (2026-11-23) — centro e sub-centro criados AQUI, para
// depois da virada (o P2S deixa de ser consultado). Ganham um identificador
// próprio "SIS:..." no campo p2s_oid: a importação do P2S (upsert por p2s_oid)
// nunca os toca, e a classificação das naturezas continua igual. Cada sub-centro
// novo vira uma natureza da OP já classificada, como os importados.
// ============================================================================
const idSistema = (tipo: 'C' | 'S') => `SIS:${tipo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function criarCentroLocal(db: Db, d: { codigo: string; nome: string; tipo: 'P' | 'R' }) {
  const codigo = limpo(d.codigo).replace(/\D/g, ''), nome = limpo(d.nome).toUpperCase();
  if (!codigo || !nome) throw new Error('Informe o código (número) e o nome do centro.');
  const nomeP2s = `${codigo.padStart(2, '0')} - ${nome}`;
  const { data: dup } = await db.from('financeiro_centros').select('id').or(`codigo.eq.${codigo},nome_p2s.ilike.${nomeP2s.replace(/[,()%]/g, ' ')}`).limit(1);
  if (dup?.length) throw new Error('Já existe um centro com este código ou nome.');
  const { data, error } = await db.from('financeiro_centros').insert({ p2s_oid: idSistema('C'), codigo, nome, nome_p2s: nomeP2s, tipo: d.tipo === 'R' ? 'R' : 'P', em_desuso: false, sincronizado_em: new Date().toISOString() }).select('id, p2s_oid, nome_p2s').single();
  if (error) throw error;
  return data as { id: number; p2s_oid: string; nome_p2s: string };
}

export async function criarSubcentroLocal(db: Db, d: { centroOid: string; codigo: string; nome: string }) {
  const { data: c, error: eC } = await db.from('financeiro_centros').select('id, p2s_oid, nome, nome_p2s, codigo').eq('p2s_oid', d.centroOid).maybeSingle();
  if (eC) throw eC;
  if (!c) throw new Error('Centro não encontrado.');
  const codigo = limpo(d.codigo), nome = limpo(d.nome).toUpperCase();
  if (!/^\d+(\.\d+)*$/.test(codigo) || !nome) throw new Error('Informe o código (ex.: 6.4) e o nome do sub-centro.');
  const nomeP2s = `${codigo} ${nome}`;
  const { data: dup } = await db.from('financeiro_subcentros').select('id').eq('centro_id', c.id).or(`codigo.eq.${codigo},nome_p2s.ilike.${nomeP2s.replace(/[,()%]/g, ' ')}`).limit(1);
  if (dup?.length) throw new Error('Já existe um sub-centro com este código ou nome neste centro.');
  const { data: s, error } = await db.from('financeiro_subcentros').insert({ p2s_oid: idSistema('S'), centro_id: c.id, codigo, nome, nome_p2s: nomeP2s, em_desuso: false, sincronizado_em: new Date().toISOString() }).select('id, p2s_oid, nome_p2s').single();
  if (error) throw error;
  // natureza da OP já classificada (mesmo formato das importadas)
  const natureza = nomeNaturezaDoSubcentro(c.nome, nomeP2s);
  const { data: existe } = await db.from('op_naturezas_pagamento').select('id').eq('natureza', natureza).maybeSingle();
  if (!existe) {
    const { error: eN } = await db.from('op_naturezas_pagamento').insert({
      natureza, origem: 'MANUAL', subcentro_id: s.id, tipo_classificacao: 'CUSTO',
      centro_financeiro_oid: c.p2s_oid, centro_financeiro_nome: c.nome_p2s, subcentro_financeiro_oid: s.p2s_oid, subcentro_financeiro_nome: nomeP2s,
    });
    if (eN) throw eN;
  }
  return { ...(s as { id: number; p2s_oid: string; nome_p2s: string }), natureza };
}
