import { NextResponse } from 'next/server';
import { atualizarStatusEventos } from '../../../lib/cadastros/eventos';
import { p2sDesligado } from '../../../lib/virada/estado';
import { supabaseAdmin } from '../../../lib/supabase';
// Importa a lógica de negócio direto dos arquivos *Core.ts (sem "use
// server"), não das actions.ts — esta rotina roda sem sessão de usuário
// (protegida só por CRON_SECRET), então não pode passar pelas actions que
// exigem accessToken de admin. Mesmo padrão de app/api/cron/consignado/route.ts.
import { sincronizarProdutosCore } from '../../../admin/estoque/produtos/produtosCore';
import { sincronizarParceirosCore, sincronizarColaboradoresCore } from '../../../admin/comercial/parceiros/parceirosCore';
import { sincronizarFichasReservaCore } from '../../../admin/locacoes/fichas-reserva/fichasCore';
import { importarFichasP2sCore } from '../../../lib/locacao/importarFichasP2s';
import { estenderAtrasos } from '../../../lib/locacao/fichaLocacao';
import { importarPlanoContasP2s } from '../../../lib/financeiro/planoContas';
import { sincronizarMovimentosP2s } from '../../../lib/financeiro/caixa';
import { gerarRecorrencias, sincronizarOpsTitulos } from '../../../lib/financeiro/pagar';
import { sincronizarEventosFeirasCore } from '../../../admin/comercial/eventos-feiras/eventosCore';
import { sincronizarContasPagarCore } from '../../../admin/financeiro/contas-pagar/contasPagarCore';
import { sincronizarContasReceberCore } from '../../../admin/financeiro/contas-receber/contasReceberCore';

// 7 integrações em sequência contra o servidor on-premise da P2S — contas a
// pagar sozinho já leva ~1 min. Roda também às 9h30 (BR), meia hora antes do
// Relatório do Diretor (app/api/cron/diretoria), pra ele ler dado fresco.
export const maxDuration = 300;

// Chave do card "Sincronização PrimeStart (P2S)" em /admin/parametros/agendamentos
// (ver sql/sync_p2s_automacao.sql) — esse card não dispara mensagem nenhuma
// (canais/destinatarios/mensagem são ignorados aqui): serve só de liga/desliga
// visível na tela, lido pelo `ativo` abaixo. Mesmo padrão do card de controle
// do Consignado (app/api/cron/consignado/route.ts).
const CHAVE_CARD_CONTROLE = 'sync-p2s';

// Rotina duas vezes ao dia (ver vercel.json, agendada para 14h/20h UTC =
// 11h/17h BR) que roda as 7 sincronizações com o PrimeStart já usadas nos
// botões "Sincronizar agora" de cada tela. Cada uma roda isolada em seu
// próprio try/catch — uma integração falhando não impede as outras 6 de
// rodar. Sequencial (não Promise.all) de propósito, mesmo estilo já usado
// nos syncs individuais, pra não sobrecarregar o servidor on-premise da P2S
// com uma rajada de 7 sincronizações simultâneas.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data: card } = await db
    .from('parametros_automacoes')
    .select('ativo')
    .eq('chave', CHAVE_CARD_CONTROLE)
    .maybeSingle();

  if (!card || card.ativo === false) {
    return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada (ou card ainda não criado) em /admin/parametros/agendamentos.' });
  }

  const integracoes: { nome: string; p2s?: boolean; fn: () => Promise<any> }[] = [
    { nome: 'produtos', p2s: true, fn: () => sincronizarProdutosCore() },
    { nome: 'parceiros', p2s: true, fn: () => sincronizarParceirosCore() },
    { nome: 'colaboradores', p2s: true, fn: () => sincronizarColaboradoresCore() },
    { nome: 'fichas_reserva', p2s: true, fn: () => sincronizarFichasReservaCore() },
    // Fichas do P2S → locacao_fichas_reserva (somente leitura) + agenda de
    // disponibilidade. Depois de parceiros/produtos, que ela usa pelo p2s_oid.
    { nome: 'locacao_fichas_p2s', p2s: true, fn: () => importarFichasP2sCore(db) },
    { nome: 'eventos_feiras', p2s: true, fn: () => sincronizarEventosFeirasCore() },
    { nome: 'contas_pagar', p2s: true, fn: () => sincronizarContasPagarCore() },
    { nome: 'contas_receber', p2s: true, fn: () => sincronizarContasReceberCore() },
    // Ficha de Locação própria (sem P2S): o que não voltou no prazo segue
    // ocupando a agenda até hoje + dias de retorno.
    { nome: 'locacao_atrasos', fn: () => estenderAtrasos(db) },
    // Status dos eventos pela data (Futuro / Em Execução / Finalizado) — sem P2S
    { nome: 'eventos_status', fn: () => atualizarStatusEventos(db) },
    // Plano de contas (centros/sub-centros) → naturezas da OP (2026-11-20)
    { nome: 'plano_contas', p2s: true, fn: () => importarPlanoContasP2s(db) },
    // Caixa e Bancos: contas pagas/recebidas do P2S → movimentos (depois de contas a pagar/receber)
    { nome: 'caixa_movimentos', fn: () => sincronizarMovimentosP2s(db) },
    // Contas a pagar próprio: vencimentos das recorrentes (45 dias) e títulos das OPs
    { nome: 'pagar_recorrencias', fn: () => gerarRecorrencias(db) },
    { nome: 'pagar_ops', fn: () => sincronizarOpsTitulos(db) },
  ];

  const resultados: Record<string, any> = {};
  // Todas as empresas concluíram a virada: o que lê o P2S é pulado (app/lib/virada/estado.ts).
  const desligado = await p2sDesligado(db);
  for (const integ of integracoes) {
    if (desligado && integ.p2s) { resultados[integ.nome] = { ok: true, pulado: 'P2S desligado (virada concluída)' }; continue; }
    try {
      resultados[integ.nome] = await integ.fn();
    } catch (e: any) {
      resultados[integ.nome] = { ok: false, erro: e.message };
    }
  }

  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_CONTROLE);

  return NextResponse.json({ success: true, executado: true, resultados });
}
