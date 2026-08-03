-- ============================================================================
-- Checklist de Carga/Retorno — marcação de "Equipamento Extra" por item —
-- rodar no Supabase SQL Editor antes de usar em /admin/operacional/checklist.
-- ============================================================================

-- Sinaliza que aquela linha do checklist é uma unidade a mais do que o pedido
-- original previa (ex: pedido de 50 TVs, mas enviando 53 — as 3 a mais entram
-- como uma linha separada com extra=true).
alter table checklist_itens
  add column if not exists extra boolean not null default false;
