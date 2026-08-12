-- Controle de pagamento da rescisão no lote de Financeiro RH
-- (/admin/financeiro/rh). Diferente das outras fontes do lote (FOLHA, 13º,
-- Férias etc.), rescisão NÃO é escopada por mês de competência — sem esse
-- marcador, a mesma rescisão homologada voltaria a aparecer pra pagamento
-- toda vez que o lote for remontado. pago_em é gravado por
-- enviarLoteAoBancoAction (actions-financeiro.ts) assim que o PIX é
-- confirmado com sucesso pelo Itaú.
alter table folha_rescisoes add column if not exists pago_em timestamptz;
alter table folha_rescisoes add column if not exists pago_lote_id bigint;
