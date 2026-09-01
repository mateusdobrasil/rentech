-- Confirmação de leitura da escala: o colaborador recebe um link no
-- WhatsApp (junto com local/horário) e, ao tocar em "Confirmar" numa página
-- pública simples, grava que está ciente — pra gestão ver quem já confirmou
-- e quem ainda não. O próprio `id` da alocação (uuid já existente,
-- imprevisível) serve de token do link — não precisa de coluna nova pra
-- isso, só o carimbo de quando confirmou.
--
-- Roda uma vez no SQL Editor do Supabase.
alter table escala_alocacoes add column if not exists confirmado_em timestamptz;
