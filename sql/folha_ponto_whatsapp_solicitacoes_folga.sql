-- Adiciona suporte à opção 4 (Solicitar folga) no bot de ponto via WhatsApp.
-- A mesma tabela que já guarda JUSTIFICATIVA_BATIDA e ABONO_DIA passa a
-- aceitar também FOLGA_DIA, com uma coluna extra para o fim do período
-- (nula para os tipos existentes, que continuam sendo de um dia só).
--
-- ATENÇÃO: o nome da constraint abaixo (folha_ponto_whatsapp_solicitacoes_tipo_check)
-- é o padrão do Postgres/Supabase quando o CHECK é criado inline na coluna.
-- Confira no Supabase (Database > Tables > folha_ponto_whatsapp_solicitacoes >
-- Constraints) se o nome bate antes de rodar — se for diferente, ajuste o
-- DROP CONSTRAINT abaixo para o nome real.

ALTER TABLE folha_ponto_whatsapp_solicitacoes
  ADD COLUMN IF NOT EXISTS data_referencia_fim date;

ALTER TABLE folha_ponto_whatsapp_solicitacoes
  DROP CONSTRAINT IF EXISTS folha_ponto_whatsapp_solicitacoes_tipo_check;

ALTER TABLE folha_ponto_whatsapp_solicitacoes
  ADD CONSTRAINT folha_ponto_whatsapp_solicitacoes_tipo_check
  CHECK (tipo IN ('JUSTIFICATIVA_BATIDA', 'ABONO_DIA', 'FOLGA_DIA'));
