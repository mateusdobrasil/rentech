-- Checklist de Carga (/admin/estoque/expedicao): itens importados via
-- "Importar Itens das OS's" agora guardam o(s) nº da(s) OS de origem, exibido
-- como um selo "OS 1234" ao lado da descrição (tanto na tela quanto na
-- impressão). No modo Consolidado, quando o mesmo material vem de mais de
-- uma OS do evento, os números ficam juntos na mesma coluna ("1234, 5678").
-- Itens do modelo padrão ou adicionados manualmente ficam com null. Roda uma
-- vez no SQL Editor do Supabase.
alter table checklist_itens
  add column if not exists os_numero text;
