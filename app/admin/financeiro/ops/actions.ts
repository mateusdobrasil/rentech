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

const ROTA = '/admin/financeiro/ops';

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
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { perfil } = acesso;

  try {
    const db = supabaseAdmin();

    const { data: contas, error: erroContas } = await db
      .from('contas_pagar')
      .select('descricao')
      .eq('quitado', true)
      .not('descricao', 'is', null);
    if (erroContas) throw new Error(erroContas.message);

    // Extrai todo número referenciado em "OP: N" ou "#N" nas descrições
    // quitadas — guarda a última descrição encontrada por número só pra
    // exibir contexto no resultado (não afeta a baixa em si).
    const numerosPorDescricao = new Map<number, string | null>();
    for (const conta of contas || []) {
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
