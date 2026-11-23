// app/api/cron/backfill-parceiros/route.ts
// Carga completa de Parceiros do P2S EM PARTES (2026-11-17).
//
// Por quê: o P2S tem ~6.100 parceiros, mas os códigos NÃO são contínuos —
// vão de 1 a ~1.372 e pulam para 22.000–26.797 (buraco de ~20.600 códigos,
// medido em 2026-11-17). Cada janela de 200 códigos com parceiros demora
// 15–36 s (cada parceiro traz FollowUp/Contatos/Endereços); janela vazia ~0,1 s.
// A carga completa original (sincronizarParceirosCore sem cursor) estourou o
// limite de 5 min e parou no meio — o espelho ficou com 1.562 parceiros e,
// depois disso, o sync só passou a puxar os alterados. Faltavam clientes nas
// buscas do orçamento e nas fichas importadas.
//
// Como: roda de madrugada (vercel.json, a cada 15 min das 0h às 6h BR, para
// não pesar no P2S em horário de uso), processa janelas até ~3,5 min,
// grava pelo mesmo conversor do sync (gravarParceirosP2s) e guarda o cursor em
// integracoes_backfill. Só marca concluído depois de 250 janelas vazias
// seguidas (50.000 códigos sem ninguém) — com 5 (1.000 códigos) a carga parou
// no buraco do código 1.372 achando que tinha acabado (incidente 2026-11-17).
// Para refazer: concluido=false, cursor=0.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { consultarObjetos, criterio } from '../../../lib/p2s';
import { gravarParceirosP2s } from '../../../admin/comercial/parceiros/parceirosCore';
import { cadastrosNoSistema } from '../../../lib/cadastros/parceiros';

export const maxDuration = 300;

const JANELA = 200;
const ORCAMENTO_MS = 210_000;       // não começa janela nova depois disso
const JANELAS_VAZIAS_PARA_FIM = 250;   // 50.000 códigos vazios seguidos (~25 s de consultas vazias)

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const db = supabaseAdmin();
  // Depois da virada o cadastro de parceiros é do sistema: nada a buscar no P2S.
  if (await cadastrosNoSistema(db)) return NextResponse.json({ ok: true, executado: false, motivo: 'Cadastros já são do sistema (virada da chave).' });
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
      // grava o progresso a cada janela com parceiros e a cada 20 vazias (se a função cair, retoma daqui)
      if (vazias === 0 || vazias % 20 === 0) {
        await db.from('integracoes_backfill').update({ cursor, processados, atualizado_em: new Date().toISOString(), ultimo_erro: null }).eq('integracao', 'parceiros');
      }
    }
  } catch (e: any) {
    erro = e.message;
  }

  await db.from('integracoes_backfill').update({
    cursor, processados, concluido, ultimo_erro: erro, atualizado_em: new Date().toISOString(),
  }).eq('integracao', 'parceiros');

  return NextResponse.json({ ok: !erro, executado: true, janelas, cursor, processados, concluido, erro, duracaoMs: Date.now() - inicio });
}
