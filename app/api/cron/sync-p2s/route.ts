import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
// Importa a lógica de negócio direto dos arquivos *Core.ts (sem "use
// server"), não das actions.ts — esta rotina roda sem sessão de usuário
// (protegida só por CRON_SECRET), então não pode passar pelas actions que
// exigem accessToken de admin. Mesmo padrão de app/api/cron/consignado/route.ts.
import { sincronizarProdutosCore } from '../../../admin/estoque/produtos/produtosCore';
import { sincronizarParceirosCore, sincronizarColaboradoresCore } from '../../../admin/comercial/parceiros/parceirosCore';
import { sincronizarFichasReservaCore } from '../../../admin/comercial/fichas/fichasCore';
import { sincronizarEventosFeirasCore } from '../../../admin/comercial/eventos-feiras/eventosCore';
import { sincronizarContasPagarCore } from '../../../admin/financeiro/contas-pagar/contasPagarCore';

// Chave do card "Sincronização PrimeStart (P2S)" em /admin/parametros/agendamentos
// (ver sql/sync_p2s_automacao.sql) — esse card não dispara mensagem nenhuma
// (canais/destinatarios/mensagem são ignorados aqui): serve só de liga/desliga
// visível na tela, lido pelo `ativo` abaixo. Mesmo padrão do card de controle
// do Consignado (app/api/cron/consignado/route.ts).
const CHAVE_CARD_CONTROLE = 'sync-p2s';

// Rotina duas vezes ao dia (ver vercel.json, agendada para 14h/20h UTC =
// 11h/17h BR) que roda as 6 sincronizações com o PrimeStart já usadas nos
// botões "Sincronizar agora" de cada tela. Cada uma roda isolada em seu
// próprio try/catch — uma integração falhando não impede as outras 5 de
// rodar. Sequencial (não Promise.all) de propósito, mesmo estilo já usado
// nos syncs individuais, pra não sobrecarregar o servidor on-premise da P2S
// com uma rajada de 6 sincronizações simultâneas.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data: card } = await db
    .from('folha_automacoes')
    .select('ativo')
    .eq('chave', CHAVE_CARD_CONTROLE)
    .maybeSingle();

  if (!card || card.ativo === false) {
    return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada (ou card ainda não criado) em /admin/parametros/agendamentos.' });
  }

  const integracoes: { nome: string; fn: () => Promise<any> }[] = [
    { nome: 'produtos', fn: () => sincronizarProdutosCore() },
    { nome: 'parceiros', fn: () => sincronizarParceirosCore() },
    { nome: 'colaboradores', fn: () => sincronizarColaboradoresCore() },
    { nome: 'fichas_reserva', fn: () => sincronizarFichasReservaCore() },
    { nome: 'eventos_feiras', fn: () => sincronizarEventosFeirasCore() },
    { nome: 'contas_pagar', fn: () => sincronizarContasPagarCore() },
  ];

  const resultados: Record<string, any> = {};
  for (const integ of integracoes) {
    try {
      resultados[integ.nome] = await integ.fn();
    } catch (e: any) {
      resultados[integ.nome] = { ok: false, erro: e.message };
    }
  }

  await db.from('folha_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_CONTROLE);

  return NextResponse.json({ success: true, executado: true, resultados });
}
