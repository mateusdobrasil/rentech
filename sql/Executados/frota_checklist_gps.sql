-- Fase 2 do app mobile: GPS de saída e retorno no Checklist de Veículo.
-- Rodar uma vez no SQL Editor do Supabase. Todas as colunas são nullable —
-- não quebra o fluxo web existente, que nunca vai preenchê-las (GPS é só do
-- app mobile nesta leva).
alter table frota_checklists
  add column if not exists saida_gps_lat numeric(10,7),
  add column if not exists saida_gps_lng numeric(10,7),
  add column if not exists saida_gps_local text,
  add column if not exists saida_gps_capturado_em timestamptz,
  add column if not exists retorno_gps_lat numeric(10,7),
  add column if not exists retorno_gps_lng numeric(10,7),
  add column if not exists retorno_gps_local text,
  add column if not exists retorno_gps_capturado_em timestamptz;

-- Se der erro de constraint aqui (frota_checklists.origem só aceitava 'PORTAL'
-- até então), descubra o nome da constraint com:
--   select conname from pg_constraint where conrelid = 'frota_checklists'::regclass;
-- e rode "alter table frota_checklists drop constraint <nome>;" antes de tentar
-- criar um checklist com origem = 'APP' pelo app.
