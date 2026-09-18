'use server';

// app/admin/financeiro/ops/actions.ts
// Concilia Ordens de Pagamento com as Contas a Pagar já quitadas (sincronizadas
// do PrimeStart em /admin/financeiro/contas-pagar). O Financeiro é orientado a
// colocar o termo "OP: <número>" na descrição da conta lá no ERP — quando essa
// conta aparece quitada aqui, lemos o número e damos baixa automática na OP
// correspondente (status -> PAGO), sem precisar clicar em "Baixar OP" uma por
// uma.
import { revalidatePath } from 'next/cache';
import { registrarLogAuditoria } from '../../../actions';
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { criarContaPagarParaOP, type ResultadoEnvioP2s } from './enviarOpP2sCore';
import { contextoEnvioItau, consultarPagamentoSispag, semAcento, STATUS_ITAU_EFETUADO } from '../../../lib/itauSispag';
import { marcarContaPagarQuitada } from '../../../lib/p2s';

const ROTA = '/admin/financeiro/ops';

// As duas conciliações (P2S e Itaú) também são acessíveis pelo botão
// "🔗 Conciliar Contas" em /admin/financeiro/integracao (pedido do usuário
// 2026-09-18) — quem só tem acesso àquela tela (não a /admin/financeiro/ops
// em si) precisa poder rodar a conciliação de lá também.
const ROTAS_CONCILIACAO = [ROTA, '/admin/financeiro/integracao'];
async function validarAcessoConciliacao(accessToken: string) {
  for (const rota of ROTAS_CONCILIACAO) {
    const acesso = await validarAcesso(accessToken, rota);
    if (acesso.ok) return acesso;
  }
  return { ok: false as const, message: 'Você não tem permissão para executar esta ação.' };
}

// Aceita dois padrões: "OP: 252" / "OP:252" / "OP : 252" (case-insensitive)
// ou "#252". Global pra pegar mais de uma referência na mesma descrição (ex:
// um pagamento único cobrindo duas OPs).
const PADRAO_OP = /(?:OP\s*:\s*|#)(\d+)/gi;

interface OPBaixada {
  numero_op: number;
  os_numero: string | null;
  conta_descricao: string | null;
}

interface ContaSemCorrespondencia {
  numero_op: number;
  conta_descricao: string | null;
}

export interface ResultadoConciliacaoOPs {
  baixadas: OPBaixada[];
  semCorrespondencia: ContaSemCorrespondencia[];
  jaEstavamPagas: number;
}

type Resultado =
  | { ok: true; info: ResultadoConciliacaoOPs }
  | { ok: false; erro: string };

export async function conciliarOpsComContasPagarAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcessoConciliacao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { perfil } = acesso;

  try {
    const db = supabaseAdmin();

    // O PostgREST corta em 1000 linhas por padrão — com ~2 mil contas
    // quitadas na base, um select sem paginação descartava silenciosamente
    // parte delas (a causa raiz de OPs citadas em contas fora do primeiro
    // lote nunca serem encontradas). Pagina até esgotar.
    const TAMANHO_PAGINA = 1000;
    const contas: { descricao: string | null }[] = [];
    for (let offset = 0; ; offset += TAMANHO_PAGINA) {
      const { data: lote, error: erroContas } = await db
        .from('financeiro_contas_pagar')
        .select('descricao')
        .eq('quitado', true)
        .not('descricao', 'is', null)
        .range(offset, offset + TAMANHO_PAGINA - 1);
      if (erroContas) throw new Error(erroContas.message);
      contas.push(...(lote || []));
      if (!lote || lote.length < TAMANHO_PAGINA) break;
    }

    // Extrai todo número referenciado em "OP: N" ou "#N" nas descrições
    // quitadas — guarda a última descrição encontrada por número só pra
    // exibir contexto no resultado (não afeta a baixa em si).
    const numerosPorDescricao = new Map<number, string | null>();
    for (const conta of contas) {
      const descricao = conta.descricao as string | null;
      if (!descricao) continue;
      for (const match of descricao.matchAll(PADRAO_OP)) {
        const numero = Number(match[1]);
        if (Number.isFinite(numero)) numerosPorDescricao.set(numero, descricao);
      }
    }

    if (numerosPorDescricao.size === 0) {
      return { ok: true, info: { baixadas: [], semCorrespondencia: [], jaEstavamPagas: 0 } };
    }

    const numerosEncontrados = [...numerosPorDescricao.keys()];
    const { data: ops, error: erroOps } = await db
      .from('op_ordens_pagamento')
      .select('id, numero_op, os_numero, status')
      .in('numero_op', numerosEncontrados);
    if (erroOps) throw new Error(erroOps.message);

    const opsPorNumero = new Map((ops || []).map(op => [op.numero_op as number, op]));

    const paraBaixar: { id: string; numero_op: number; os_numero: string | null }[] = [];
    const semCorrespondencia: ContaSemCorrespondencia[] = [];
    let jaEstavamPagas = 0;

    for (const numero of numerosEncontrados) {
      const op = opsPorNumero.get(numero);
      if (!op) {
        semCorrespondencia.push({ numero_op: numero, conta_descricao: numerosPorDescricao.get(numero) ?? null });
      } else if (op.status === 'PAGO') {
        jaEstavamPagas++;
      } else {
        paraBaixar.push({ id: op.id as string, numero_op: numero, os_numero: op.os_numero as string | null });
      }
    }

    if (paraBaixar.length > 0) {
      const { error: erroUpdate } = await db
        .from('op_ordens_pagamento')
        .update({ status: 'PAGO', updated_at: new Date().toISOString() })
        .in('id', paraBaixar.map(op => op.id));
      if (erroUpdate) throw new Error(erroUpdate.message);

      await Promise.all(paraBaixar.map(op => registrarLogAuditoria({
        usuario_nome: perfil.nome,
        acao: 'BAIXOU OP — STATUS: PAGO (CONCILIAÇÃO AUTOMÁTICA VIA CONTA PAGA)',
        setor: 'OP',
        equipamento_id: op.id,
        equipamento_nome: `OP #${op.numero_op} — OS ${op.os_numero || 'S/N'}`,
      })));

      revalidatePath('/admin');
    }

    const baixadas: OPBaixada[] = paraBaixar.map(op => ({
      numero_op: op.numero_op,
      os_numero: op.os_numero,
      conta_descricao: numerosPorDescricao.get(op.numero_op) ?? null,
    }));

    return { ok: true, info: { baixadas, semCorrespondencia, jaEstavamPagas } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// CONCILIAÇÃO COM O ITAÚ — irmã da conciliação com o PrimeStart acima, mas
// pro caminho de pagamento direto pela nossa integração SISPAG (que o
// PrimeStart nunca fica sabendo que aconteceu — ver
// project_p2s_baixa_conta_pagar.md). Pedido do usuário 2026-09-18: o mesmo
// clique em "Conciliar Contas Pagas" também confere no Itaú, sem precisar ir
// em /admin/financeiro/rh consultar item por item.
//
// Candidatas: OPs com `pago_lote_id` preenchido (já foram incluídas num
// envio ao banco que a API aceitou — ver enviarLoteAoBancoAction) mas que
// ainda não viraram PAGO nem foram REPROVADA. "Aceito pela API" não é
// "pago de fato" — pagamento SISPAG passa por aprovação manual no Itaú
// Empresas antes de ser efetivado, por isso a reconsulta aqui.
//
// Confirmada a baixa no Itaú, tenta dar baixa TAMBÉM na Conta a Pagar
// correspondente no PrimeStart (p2s_conta_pagar_oid), via
// marcarContaPagarQuitada (app/lib/p2s.ts) — método/parâmetro confirmados
// com o suporte da P2S em 2026-09-18. Se o PrimeStart recusar (ex.: período
// bloqueado), a OP AINDA ASSIM vira PAGO aqui; só avisa o motivo.
// ============================================================================
export interface OPBaixadaItau { numero_op: number; os_numero: string | null; status_itau: string; avisoP2s?: string; }
export interface OPPendenteItau { numero_op: number; os_numero: string | null; status_itau: string; }
export interface OPFalhaConsultaItau { numero_op: number; erro: string; }

export interface ResultadoConciliacaoItau {
  baixadas: OPBaixadaItau[];
  aindaPendentes: OPPendenteItau[];
  falhasConsulta: OPFalhaConsultaItau[];
  semReferenciaItau: number; // pago_lote_id preenchido, mas sem api_cod_pagamento achado no lote (não deveria ocorrer)
}

type ResultadoItau =
  | { ok: true; info: ResultadoConciliacaoItau }
  | { ok: false; erro: string };

export async function conciliarOpsComItauAction(accessToken: string): Promise<ResultadoItau> {
  const acesso = await validarAcessoConciliacao(accessToken);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { perfil } = acesso;

  try {
    const db = supabaseAdmin();
    const ctx = await contextoEnvioItau();
    if (!ctx.ok) return { ok: false, erro: ctx.erro };

    const { data: opsCandidatas, error: erroOps } = await db
      .from('op_ordens_pagamento')
      .select('id, numero_op, os_numero, pago_lote_id, p2s_conta_pagar_oid')
      .neq('status', 'PAGO').neq('status', 'REPROVADA')
      .not('pago_lote_id', 'is', null);
    if (erroOps) throw new Error(erroOps.message);

    const resultado: ResultadoConciliacaoItau = { baixadas: [], aindaPendentes: [], falhasConsulta: [], semReferenciaItau: 0 };
    if (!opsCandidatas || opsCandidatas.length === 0) return { ok: true, info: resultado };

    // Um mesmo lote pode ter várias OPs — busca os lotes distintos de uma vez
    // só, em vez de um SELECT por OP.
    const loteIds = [...new Set(opsCandidatas.map(op => op.pago_lote_id as number))];
    const { data: lotes, error: erroLotes } = await db
      .from('financeiro_lotes_pagamento').select('id, itens').in('id', loteIds);
    if (erroLotes) throw new Error(erroLotes.message);

    const itemPorOpId = new Map<string, any>();
    (lotes || []).forEach(lote => {
      const itens: any[] = Array.isArray(lote.itens) ? lote.itens : [];
      itens.forEach(it => { if (it.fonte === 'OP' && it.opId) itemPorOpId.set(it.opId, it); });
    });

    // Sequencial de propósito (não Promise.all) — mesmo cuidado já usado no
    // envio real do lote, pra não estourar limite de taxa da API do Itaú com
    // muitas OPs pendentes de uma vez.
    for (const op of opsCandidatas) {
      const item = itemPorOpId.get(op.id);
      if (!item?.api_cod_pagamento) { resultado.semReferenciaItau++; continue; }

      const { ok, status, data } = await consultarPagamentoSispag(ctx.ambiente, item.api_cod_pagamento);
      if (!ok) {
        resultado.falhasConsulta.push({ numero_op: op.numero_op, erro: `HTTP ${status}` });
        continue;
      }
      const statusItauBruto = String((data?.data ?? data)?.dados_pagamento?.status || '');

      if (semAcento(statusItauBruto) === STATUS_ITAU_EFETUADO) {
        const { data: opAtualizada } = await db.from('op_ordens_pagamento')
          .update({ status: 'PAGO', updated_at: new Date().toISOString() })
          .eq('id', op.id).neq('status', 'REPROVADA').neq('status', 'PAGO')
          .select('numero_op').maybeSingle();
        if (opAtualizada) {
          let avisoP2s: string | undefined;
          if (op.p2s_conta_pagar_oid) {
            try {
              const baixa = await marcarContaPagarQuitada('PRODUCAO', op.p2s_conta_pagar_oid, new Date());
              if (!baixa.ok) avisoP2s = `PrimeStart recusou a quitação: ${baixa.motivo}`;
            } catch (e: any) {
              avisoP2s = `Falha ao dar baixa no PrimeStart: ${e.message}`;
            }
          }
          resultado.baixadas.push({ numero_op: op.numero_op, os_numero: op.os_numero, status_itau: statusItauBruto, avisoP2s });
          registrarLogAuditoria({
            usuario_nome: perfil.nome,
            acao: `BAIXOU OP #${op.numero_op} — STATUS: PAGO (CONCILIAÇÃO AUTOMÁTICA VIA API ITAÚ, "${statusItauBruto}")${avisoP2s ? ` — PRIMESTART: ${avisoP2s}` : op.p2s_conta_pagar_oid ? ' — PRIMESTART: QUITADO TAMBÉM' : ''}`,
            setor: 'OP',
            equipamento_id: op.id,
            equipamento_nome: `OP #${op.numero_op} — OS ${op.os_numero || 'S/N'}`,
          });
        }
      } else {
        resultado.aindaPendentes.push({ numero_op: op.numero_op, os_numero: op.os_numero, status_itau: statusItauBruto || 'desconhecido' });
      }
    }

    if (resultado.baixadas.length > 0) revalidatePath('/admin');

    return { ok: true, info: resultado };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ENVIAR OP PARA O PRIMESTART — botão manual (fallback), usado quando o
// disparo automático na criação da OP (ver criarOP em app/admin/op/actions.ts
// + enviarOpP2sCore.ts) falhou ou não achou o CNPJ/CPF a tempo. A lógica de
// fato mora em enviarOpP2sCore.ts (sem "use server"), reaproveitada pelos
// dois caminhos.
// ============================================================================

type ResultadoEnvio =
  | { ok: true; info: ResultadoEnvioP2s }
  | { ok: false; erro: string };

export async function enviarOpParaPrimeStartAction(opId: string, accessToken: string): Promise<ResultadoEnvio> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { perfil } = acesso;

  try {
    const db = supabaseAdmin();
    const { data: op, error: erroOp } = await db
      .from('op_ordens_pagamento')
      .select('id, numero_op, os_numero, os_cliente, os_evento, natureza_pagamento, empresa_recebedora, cnpj_cpf_recebedora, total_geral, data_vencimento, observacao, itens, p2s_conta_pagar_oid')
      .eq('id', opId)
      .single();
    if (erroOp) throw new Error(erroOp.message);
    if (!op) throw new Error('OP não encontrada.');
    if (op.p2s_conta_pagar_oid) throw new Error('Esta OP já foi enviada pro PrimeStart anteriormente.');

    const info = await criarContaPagarParaOP(op, perfil.nome);
    return { ok: true, info };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
