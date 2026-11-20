// app/lib/locacao/expedicaoFichaLocacao.ts
// Expedição → Ficha de Locação própria (2026-11-20). Depois de salvar um
// checklist, cada item conferido que pertence a uma OS do sistema ("FR-07050"
// em checklist_itens.os_numero) vira movimento na ficha de locação:
//   saida_ok   → SAÍDA de saida_qtd   (abre a FL /A se ainda não existe)
//   retorno_ok → DEVOLUÇÃO de retorno_qtd
// Idempotente: compara com o que já foi registrado por aquele item do
// checklist (movimentos.checklist_item_id) e grava só a diferença. Peças
// lidas por QR (checklist_item_pecas) entram com o patrimônio.
// Fichas do P2S (nº sem "FR-") não são tocadas — seguem no PrimeStart.
// Checklist FINALIZADO = retorno encerrado: o que saiu por ele e não teve
// entrada vira extravio automático com cobrança de reposição (2026-11-20).
// Só servidor, sem checagem de acesso (a action da Expedição valida).
import type { supabaseAdmin } from '../supabase';
import { abrirFichaLocacao, saldosDaFicha, registrarMovimento, sincronizarPrevistosSemMovimento, extraviarPendentes, type LinhaMovimento } from './fichaLocacao';
import { hojeISO } from './datas';

type Db = ReturnType<typeof supabaseAdmin>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const arred3 = (v: number) => Math.round(v * 1000) / 1000;
const tokensOs = (t: string | null | undefined) => String(t || '').toUpperCase().split(/[,;/\s]+/).filter(x => /^FR-\d+$/.test(x));

export interface ResultadoExpedicaoFl {
  fichas: string[];
  saidas: number;
  devolucoes: number;
  extravios: number;
  avisos: string[];
}

export async function sincronizarChecklistComFichasLocacao(db: Db, checklistId: string, usuario: string): Promise<ResultadoExpedicaoFl> {
  const res: ResultadoExpedicaoFl = { fichas: [], saidas: 0, devolucoes: 0, extravios: 0, avisos: [] };
  const { data: itens, error } = await db.from('checklist_itens')
    .select('id, descricao, produto_id, os_numero, saida_ok, saida_qtd, retorno_ok, retorno_qtd').eq('checklist_id', checklistId);
  if (error) throw error;
  const doSistema = ((itens || []) as any[]).filter(i => i.produto_id && tokensOs(i.os_numero).length && (i.saida_ok || i.retorno_ok));
  if (!doSistema.length) return res;

  // reservas citadas (só do sistema, reservadas ou em locação)
  const reservaIds = [...new Set(doSistema.flatMap(i => tokensOs(i.os_numero).map(t => Number(t.slice(3)))))];
  const { data: reservas } = await db.from('locacao_fichas_reserva').select('id, origem, status').in('id', reservaIds);
  const validas = new Map(((reservas || []) as any[]).filter(r => r.origem === 'SISTEMA').map(r => [r.id, r]));
  for (const id of reservaIds) {
    const r = validas.get(id);
    if (!r) { res.avisos.push(`OS FR-${String(id).padStart(5, '0')} não encontrada no sistema.`); continue; }
    if (!['RESERVADA', 'EM_LOCACAO', 'FINALIZADA'].includes(r.status)) { res.avisos.push(`OS FR-${String(id).padStart(5, '0')} está ${r.status} — saída só de ficha reservada.`); validas.delete(id); }
  }
  if (!validas.size) return res;

  // fichas de locação abertas de cada reserva (abre a /A se precisar)
  const flsPorReserva = new Map<number, { id: number; numero: string }[]>();
  for (const [id, r] of validas) {
    const { data: fls } = await db.from('locacao_fichas_locacao').select('id, numero, letra, status').eq('ficha_reserva_id', id).eq('origem', 'SISTEMA').order('letra');
    let abertas = ((fls || []) as any[]).filter(f => f.status === 'A');
    if (!fls?.length && r.status === 'RESERVADA') {
      const nova = await abrirFichaLocacao(db, id, usuario);
      abertas = [{ id: nova.id, numero: nova.numero }];
    }
    for (const f of abertas) await sincronizarPrevistosSemMovimento(db, f.id);
    flsPorReserva.set(id, abertas);
  }

  // o que cada item do checklist já registrou
  const { data: jaMovs } = await db.from('locacao_fichas_locacao_movimentos').select('checklist_item_id, tipo, quantidade, patrimonio_id')
    .in('checklist_item_id', doSistema.map(i => i.id));
  const registrado = (itemId: string, tipo: string) => arred3(((jaMovs || []) as any[]).filter(m => m.checklist_item_id === itemId && m.tipo === tipo).reduce((s, m) => s + n(m.quantidade), 0));
  const pecasRegistradas = new Set(((jaMovs || []) as any[]).filter(m => m.patrimonio_id).map(m => `${m.checklist_item_id}|${m.tipo}|${m.patrimonio_id}`));
  const { data: pecas } = await db.from('checklist_item_pecas').select('checklist_item_id, patrimonio_id, tipo').eq('checklist_id', checklistId);

  const hoje = hojeISO();
  // agrupa as linhas por ficha de locação e tipo (um comprovante por ficha e sentido)
  const lotes = new Map<string, { flId: number; numero: string; tipo: 'SAIDA' | 'DEVOLUCAO'; linhas: LinhaMovimento[] }>();
  const addLinha = (flId: number, numero: string, tipo: 'SAIDA' | 'DEVOLUCAO', l: LinhaMovimento) => {
    const k = `${flId}|${tipo}`;
    if (!lotes.has(k)) lotes.set(k, { flId, numero, tipo, linhas: [] });
    lotes.get(k)!.linhas.push(l);
  };

  const saldosCache = new Map<number, Awaited<ReturnType<typeof saldosDaFicha>>>();
  const saldos = async (flId: number) => { if (!saldosCache.has(flId)) saldosCache.set(flId, await saldosDaFicha(db, flId)); return saldosCache.get(flId)!; };

  for (const it of doSistema) {
    const fls = tokensOs(it.os_numero).flatMap(t => flsPorReserva.get(Number(t.slice(3))) || []);
    if (!fls.length) continue;
    for (const tipo of ['SAIDA', 'DEVOLUCAO'] as const) {
      const ok = tipo === 'SAIDA' ? it.saida_ok : it.retorno_ok;
      if (!ok) continue;
      const conferido = arred3(n(tipo === 'SAIDA' ? it.saida_qtd : it.retorno_qtd));
      let delta = arred3(conferido - registrado(it.id, tipo));
      if (delta < -1e-9) { res.avisos.push(`"${it.descricao}": a ${tipo === 'SAIDA' ? 'saída' : 'volta'} conferida (${conferido}) é menor que a já registrada — corrija na ficha de locação.`); continue; }
      if (delta <= 1e-9) continue;
      // peças lidas por QR ainda não registradas
      const lidas = ((pecas || []) as any[]).filter(p => p.checklist_item_id === it.id && p.tipo === (tipo === 'SAIDA' ? 'SAIDA' : 'RETORNO') && !pecasRegistradas.has(`${it.id}|${tipo}|${p.patrimonio_id}`)).map(p => p.patrimonio_id as number);
      // distribui entre as fichas/itens previstos do produto
      for (const fl of fls) {
        if (delta <= 1e-9) break;
        const prev = (await saldos(fl.id)).filter(s => s.produto_id === it.produto_id);
        for (const s of prev) {
          if (delta <= 1e-9) break;
          const cabe = tipo === 'SAIDA' ? s.pendenteSaida : s.fora;
          const q = Math.min(delta, cabe);
          if (q <= 1e-9) continue;
          if (tipo === 'SAIDA') s.pendenteSaida = arred3(s.pendenteSaida - q); else s.fora = arred3(s.fora - q);
          delta = arred3(delta - q);
          let resto = q;
          while (resto >= 1 && lidas.length) { addLinha(fl.id, fl.numero, tipo, { previsto_id: s.id, quantidade: 1, patrimonio_id: lidas.shift()!, checklist_id: checklistId, checklist_item_id: it.id }); resto = arred3(resto - 1); }
          if (resto > 1e-9) addLinha(fl.id, fl.numero, tipo, { previsto_id: s.id, quantidade: resto, checklist_id: checklistId, checklist_item_id: it.id });
        }
      }
      if (delta > 1e-9) {
        if (tipo === 'SAIDA') {
          // saiu mais do que o previsto: entra como item extra na 1ª ficha aberta
          const fl = fls[0];
          const { data: extra } = await db.from('locacao_fichas_locacao_itens').insert({
            ficha_locacao_id: fl.id, produto_id: it.produto_id, descricao: String(it.descricao || '').trim() || `Produto #${it.produto_id}`,
            quantidade: 0, extra: true, ordem: 900,
          }).select('id').single();
          if (extra) {
            saldosCache.delete(fl.id);
            addLinha(fl.id, fl.numero, 'SAIDA', { previsto_id: extra.id, quantidade: delta, checklist_id: checklistId, checklist_item_id: it.id });
            res.avisos.push(`"${it.descricao}": ${delta} a mais que o previsto — registrado como extra em ${fl.numero}.`);
          }
        } else {
          res.avisos.push(`"${it.descricao}": voltaram ${delta} a mais do que saiu pela ficha de locação — confira.`);
        }
      }
    }
  }

  for (const lote of lotes.values()) {
    try {
      const r = await registrarMovimento(db, lote.flId, { tipo: lote.tipo, data: hoje, linhas: lote.linhas, usuario, permitirExtra: true, observacoes: 'Conferência da Expedição' });
      if (lote.tipo === 'SAIDA') res.saidas += r.movimentos; else res.devolucoes += r.movimentos;
      res.avisos.push(...r.avisos);
      if (!res.fichas.includes(lote.numero)) res.fichas.push(lote.numero);
    } catch (e: any) {
      res.avisos.push(`${lote.numero}: ${e.message}`);
    }
  }

  // retorno encerrado (checklist finalizado): o que não voltou vira extravio
  const { data: ck } = await db.from('checklists').select('status').eq('id', checklistId).maybeSingle();
  if (ck?.status === 'FINALIZADO') {
    const produtos = [...new Set(doSistema.filter(i => i.retorno_ok).map(i => i.produto_id as number))];
    const flIds = new Map<number, string>();
    for (const it of doSistema.filter(i => i.retorno_ok)) {
      for (const t of tokensOs(it.os_numero)) for (const fl of flsPorReserva.get(Number(t.slice(3))) || []) flIds.set(fl.id, fl.numero);
    }
    for (const [flId, numero] of flIds) {
      try {
        const { data: aberta } = await db.from('locacao_fichas_locacao').select('status').eq('id', flId).maybeSingle();
        if (aberta?.status !== 'A') continue;
        const r = await extraviarPendentes(db, flId, usuario, hoje, produtos);
        if (r.linhas) { res.extravios += r.linhas; res.avisos.push(`${numero}: ${r.avisos.join(' ')}`); if (!res.fichas.includes(numero)) res.fichas.push(numero); }
      } catch (e: any) {
        res.avisos.push(`${numero}: extravio automático falhou — ${e.message}`);
      }
    }
  }
  return res;
}
