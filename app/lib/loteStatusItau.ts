// lib/loteStatusItau.ts
// Grava no próprio item do lote (financeiro_lotes_pagamento.itens) o status
// REAL do pagamento no Itaú. O api_status salvo no envio só diz que a API
// aceitou o pedido ("Sucesso"); o "Efetuado" de verdade só aparece consultando
// o SISPAG de novo. Sem gravar, quem lê o lote depois (ex.: Resumo de
// Recebimentos do holerite, pra saber se o benefício foi pago) não tinha como
// distinguir "aceito" de "pago".
import { supabaseAdmin } from './supabase';
import { semAcento, STATUS_ITAU_EFETUADO } from './itauSispag';

export async function gravarStatusItauItemLote(
  db: ReturnType<typeof supabaseAdmin>,
  loteId: number,
  codPagamento: string,
  statusItauBruto: string
): Promise<void> {
  const { data: lote } = await db.from('financeiro_lotes_pagamento').select('itens').eq('id', loteId).maybeSingle();
  const itens: any[] = Array.isArray(lote?.itens) ? lote!.itens : [];
  const item = itens.find(i => i.api_cod_pagamento === codPagamento);
  if (!item) return;
  const agora = new Date().toISOString();
  item.itau_status_atual = statusItauBruto || null;
  item.itau_consultado_em = agora;
  if (semAcento(statusItauBruto) === STATUS_ITAU_EFETUADO && !item.itau_efetuado_em) item.itau_efetuado_em = agora;
  await db.from('financeiro_lotes_pagamento').update({ itens }).eq('id', loteId);
}
