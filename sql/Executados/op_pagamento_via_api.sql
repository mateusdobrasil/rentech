-- OP (Ordem de Pagamento): quando o lote de pagamento do Financeiro
-- (/admin/financeiro/rh, fonte "Ordem de Pagamento") envia uma OP via API
-- Pix do Itaú, a API responder "Sucesso" só significa que o PEDIDO foi
-- aceito — pagamentos SISPAG ainda passam por aprovação manual no Itaú
-- Empresas antes de serem efetivados de verdade (mesmo aviso já documentado
-- em app/admin/rh/actions/actions-financeiro.ts, enviarLoteAoBancoAction).
-- Por isso o envio NÃO grava status='PAGO' automaticamente — confirmar como
-- paga continua sendo uma ação humana (botão "Baixar OP" em
-- /admin/financeiro/ops, ou a conciliação com o PrimeStart). pago_em só
-- serve pra excluir a OP do próximo lote (evita reenviar e pagar em dobro),
-- igual ao mesmo campo já usado em folha_rescisoes. Roda uma vez no SQL
-- Editor do Supabase.
alter table op_ordens_pagamento
  add column if not exists pago_em timestamptz,
  add column if not exists pago_lote_id integer;
