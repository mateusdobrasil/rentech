-- ============================================================================
-- Novo catálogo de Departamentos (mesmo molde de folha_tipocontrato) + coluna
-- departamento na ficha do funcionário. Gerenciado em
-- /admin/rh/parametros → Cargos e Tipos de Contrato, e usado na ficha do
-- funcionário (/admin/rh/funcionario) e no popup de Aniversariantes do Mês
-- (hub /admin/rh).
-- Rodar no SQL Editor do Supabase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS folha_departamento (
  id bigint generated always as identity primary key,
  nome text not null unique
);

ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS departamento text;
