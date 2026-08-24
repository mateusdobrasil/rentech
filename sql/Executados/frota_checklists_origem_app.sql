-- App mobile cria checklist com origem = 'APP', mas frota_checklists_origem_check
-- só aceitava 'PORTAL' até agora (erro confirmado ao testar: "new row for
-- relation frota_checklists violates check constraint
-- frota_checklists_origem_check"). Roda uma vez no SQL Editor do Supabase.
alter table frota_checklists drop constraint frota_checklists_origem_check;
alter table frota_checklists add constraint frota_checklists_origem_check
  check (origem in ('PORTAL', 'APP'));
