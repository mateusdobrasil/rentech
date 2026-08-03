-- ============================================================================
-- Correção: departamentos cadastrados em /admin/rh/parametros gravam
-- corretamente na tabela (o insert roda no servidor com a service role, que
-- ignora RLS/grants), mas não aparecem no grid — a listagem roda no
-- navegador com a chave anon/authenticated, e a tabela nova ainda não tinha
-- permissão de leitura liberada pra esse papel (diferente de folha_cargo e
-- folha_tipocontrato, que já tinham).
-- Rodar no SQL Editor do Supabase.
-- ============================================================================

ALTER TABLE folha_departamento DISABLE ROW LEVEL SECURITY;
GRANT SELECT ON folha_departamento TO anon, authenticated;
