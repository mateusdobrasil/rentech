-- Multi-empresa (Fase 1) — vincula cada funcionário a 1 empresa.
-- Rodar depois de sql/empresas.sql.
--
-- Nullable de propósito: funcionários já cadastrados não têm como ser
-- migrados automaticamente (não dá pra adivinhar a empresa de cada um).
-- Use a ação "Atribuir empresa em massa" em /admin/rh/funcionario para
-- zerar os pendentes depois de rodar esta migração.

alter table folha_funcionarios
  add column if not exists empresa_id integer references empresas(id);