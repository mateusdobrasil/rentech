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
import { criarObjeto, atualizarObjeto, dataParaP2s, type AmbienteP2s } from '../../../lib/p2s';

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

    // O PostgREST corta em 1000 linhas por padrão — com ~2 mil contas
    // quitadas na base, um select sem paginação descartava silenciosamente
    // parte delas (a causa raiz de OPs citadas em contas fora do primeiro
    // lote nunca serem encontradas). Pagina até esgotar.
    const TAMANHO_PAGINA = 1000;
    const contas: { descricao: string | null }[] = [];
    for (let offset = 0; ; offset += TAMANHO_PAGINA) {
      const { data: lote, error: erroContas } = await db
        .from('contas_pagar')
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
// ENVIAR OP PARA O PRIMESTART — cria a Conta a Pagar correspondente lá, pra
// não precisar redigitar a OP manualmente no ERP. Disparo manual (botão na
// tela), nunca automático na criação da OP — o Financeiro decide quando
// mandar. A conta nasce em aberto (sem FlagQuitado — em teste no sandbox,
// forçar essa flag direto por PUT se mostrou não confiável, provavelmente
// controlada pelo workflow de pagamento do próprio PrimeStart); a quitação
// continua acontecendo dentro do PrimeStart e volta pra cá pela sincronização
// + conciliarOpsComContasPagarAction, fechando o ciclo.
// ============================================================================

export interface ResultadoEnvioP2s {
  p2sOid: string;
  fornecedorVinculado: boolean;
  origemVinculo: 'parceiro' | 'colaborador' | null;
}

type ResultadoEnvio =
  | { ok: true; info: ResultadoEnvioP2s }
  | { ok: false; erro: string };

// Busca a Entidade pelo CNPJ/CPF já digitado no formulário da OP — não mais
// via API ao vivo (a live query batia só contra TCustomParceiro; o
// favorecido de uma OP pode ser um TCustomColaborador nosso, ex: freelancer,
// que não é Parceiro). Usa as tabelas `parceiros` e `colaboradores`, já
// sincronizadas do PrimeStart (ver app/admin/comercial/parceiros/actions.ts)
// — mais rápido que ir na API a cada envio, e cobre as duas fontes.
// Colaborador só tem CPF (é sempre pessoa física), por isso só entra na
// busca quando o documento tem 11 dígitos.
async function buscarEntidadeLocal(documentoFormatado: string): Promise<{ oid: string; origem: 'parceiro' | 'colaborador' } | null> {
  const digitos = documentoFormatado.replace(/\D/g, '');
  if (!digitos) return null;
  const campo = digitos.length > 11 ? 'cnpj' : 'cpf';

  const db = supabaseAdmin();

  const { data: parceiro } = await db.from('parceiros').select('p2s_oid').eq(campo, documentoFormatado).limit(1).maybeSingle();
  if (parceiro?.p2s_oid) return { oid: parceiro.p2s_oid as string, origem: 'parceiro' };

  if (campo === 'cpf') {
    const { data: colaborador } = await db.from('colaboradores').select('p2s_oid').eq('cpf', documentoFormatado).limit(1).maybeSingle();
    if (colaborador?.p2s_oid) return { oid: colaborador.p2s_oid as string, origem: 'colaborador' };
  }

  return null;
}

export async function enviarOpParaPrimeStartAction(opId: string, accessToken: string): Promise<ResultadoEnvio> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { perfil } = acesso;

  try {
    const db = supabaseAdmin();
    const { data: op, error: erroOp } = await db
      .from('op_ordens_pagamento')
      .select('id, numero_op, os_numero, os_cliente, os_evento, natureza_pagamento, empresa_recebedora, cnpj_cpf_recebedora, total_geral, data_vencimento, p2s_conta_pagar_oid')
      .eq('id', opId)
      .single();
    if (erroOp) throw new Error(erroOp.message);
    if (!op) throw new Error('OP não encontrada.');
    if (op.p2s_conta_pagar_oid) throw new Error('Esta OP já foi enviada pro PrimeStart anteriormente.');

    const ambiente: AmbienteP2s = 'PRODUCAO';

    const entidade = op.cnpj_cpf_recebedora
      ? await buscarEntidadeLocal(op.cnpj_cpf_recebedora as string)
      : null;

    const criado = await criarObjeto(ambiente, 'TCustomContaPagar');

    const campos: Record<string, unknown> = {
      Descricao: `OP: ${op.numero_op} - ${op.empresa_recebedora}`,
      Valor: Number(op.total_geral) || 0,
      DataVencimentoNominal: dataParaP2s(new Date(`${op.data_vencimento}T00:00:00Z`)),
      Observacoes: `Lançada via sistema Rentech por ${perfil.nome} | Natureza: ${op.natureza_pagamento || '—'} | OS: ${op.os_numero || 'S/N'} | Cliente: ${op.os_cliente || '—'} | Evento: ${op.os_evento || '—'}`,
    };
    if (entidade) campos.Entidade = entidade.oid;

    await atualizarObjeto(ambiente, 'TCustomContaPagar', criado.oid, campos);

    const agora = new Date().toISOString();
    const { error: erroUpdate } = await db
      .from('op_ordens_pagamento')
      .update({ p2s_conta_pagar_oid: criado.oid, p2s_conta_pagar_enviado_em: agora, p2s_conta_pagar_enviado_por: perfil.nome })
      .eq('id', opId);
    if (erroUpdate) throw new Error(erroUpdate.message);

    registrarLogAuditoria({
      usuario_nome: perfil.nome,
      acao: `ENVIOU OP PARA O PRIMESTART — CRIOU CONTA A PAGAR ${criado.oid}${entidade ? ` (VINCULADA A ${entidade.origem.toUpperCase()})` : ' (SEM FORNECEDOR VINCULADO — CONFERIR CNPJ/CPF)'}`,
      setor: 'OP',
      equipamento_id: opId,
      equipamento_nome: `OP #${op.numero_op} — OS ${op.os_numero || 'S/N'}`,
    });

    revalidatePath('/admin');
    return { ok: true, info: { p2sOid: criado.oid, fornecedorVinculado: !!entidade, origemVinculo: entidade?.origem ?? null } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
