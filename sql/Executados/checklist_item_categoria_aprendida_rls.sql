-- checklist_item_categoria_aprendida nasceu com RLS ligado e sem política
-- nenhuma (nem SELECT nem INSERT/UPDATE passam pra ninguém) — como é só um
-- cache interno de categoria por descrição, sem dado sensível, libera geral
-- pra quem estiver logado.
alter table checklist_item_categoria_aprendida enable row level security;
drop policy if exists "checklist_item_categoria_aprendida_autenticado" on checklist_item_categoria_aprendida;
create policy "checklist_item_categoria_aprendida_autenticado"
  on checklist_item_categoria_aprendida
  for all
  to authenticated
  using (true)
  with check (true);
