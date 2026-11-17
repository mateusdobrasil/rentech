// app/api/cron/backfill-parceiros/route.ts
// Carga completa de Parceiros do P2S EM PARTES (2026-11-17).
//
// Por quê: o P2S tem ~26.800 parceiros (códigos contínuos) e cada janela de
// 200 códigos demora 15–36 s (cada parceiro traz FollowUp/Contatos/Endereços).
// A carga completa original (sincronizarParceirosCore sem cursor) estourou o
// limite de 5 min e parou no meio — o espelho ficou com 1.562 parceiros e,
// depois disso, o sync só passou a puxar os alterados. Faltavam clientes nas
// buscas do orçamento e nas fichas importadas.
//
// Como: roda de madrugada (vercel.json, a cada 15 min das 0h às 6h BR, para
// não pesar no P2S em horário de uso), processa janelas até ~3,5 min,
// grava pelo mesmo conversor do sync (gravarParceirosP2s) e guarda o cursor em
// integracoes_backfill. Ao achar 5 janelas vazias seguidas, marca concluído e
// passa a responder "nada a fazer". Para refazer: concluido=false, cursor=0.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, criterio } from '../../../lib/p2s';
import { gravarParceirosP2s } from '../../../admin/comercial/parceiros/parceirosCore';

export const maxDuration = 300;

const JANELA = 200;
const ORCAMENTO_MS = 210_000;       // não começa janela nova depois disso
const JANELAS_VAZIAS_PARA_FIM = 5;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  const { data: estado } = await db.from('integracoes_backfill').select('*').eq('integracao', 'parceiros').maybeSingle();
  if (!estado) return NextResponse.json({ ok: true, executado: false, motivo: 'Sem registro em integracoes_backfill (rode .sql/Pendentes/integracoes_backfill_parceiros.sql).' });
  if (estado.concluido) return NextResponse.json({ ok: true, executado: false, motivo: 'Carga completa já concluída.' });

  const inicio = Date.now();
  let cursor = Number(estado.cursor) || 0;
  let processados = Number(estado.processados) || 0;
  let vazias = 0;
  let janelas = 0;
  let concluido = false;
  let erro: string | null = null;

  try {
    while (Date.now() - inicio < ORCAMENTO_MS) {
      const r = await consultarObjetos('PRODUCAO', 'TCustomParceiro', [
        criterio('CodigoParceiro', 'gt', 'int', cursor),
        criterio('CodigoParceiro', 'le', 'int', cursor + JANELA),
      ], { order: 'CodigoParceiro' });
      janelas++;
      if (r.objectlist.length) {
        processados += await gravarParceirosP2s('PRODUCAO', r.objectlist);
        vazias = 0;
      } else if (++vazias >= JANELAS_VAZIAS_PARA_FIM) {
        cursor += JANELA;
        concluido = true;
        break;
      }
      cursor += JANELA;
      // grava o progresso a cada janela (se a função cair, retoma daqui)
      await db.from('integracoes_backfill').update({ cursor, processados, atualizado_em: new Date().toISOString(), ultimo_erro: null }).eq('integracao', 'parceiros');
    }
  } catch (e: any) {
    erro = e.message;
  }

  await db.from('integracoes_backfill').update({
    cursor, processados, concluido, ultimo_erro: erro, atualizado_em: new Date().toISOString(),
  }).eq('integracao', 'parceiros');

  return NextResponse.json({ ok: !erro, executado: true, janelas, cursor, processados, concluido, erro, duracaoMs: Date.now() - inicio });
}
