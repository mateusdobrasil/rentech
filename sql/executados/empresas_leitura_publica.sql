-- A tabela empresas nunca teve GRANT de SELECT pro papel anon — por isso o
-- select em /freelance/page.tsx (formulário público, sem login) pro campo
-- "Empresa de Cadastro" vinha sempre vazio (erro 42501 "permission denied
-- for table empresas", confirmado direto na API REST do Supabase).
--
-- Nomes de empresa não são dado sensível (mesma lógica já aplicada a
-- equipamentos em sql/equipamentos_empresa_id.sql, que também precisa ser
-- lido sem login pelo Simulador público).
GRANT SELECT ON public.empresas TO anon;

-- Conferência: relrowsecurity=false (RLS nem está ligada nessa tabela) ou,
-- se estiver, precisa ter uma policy permitindo SELECT pro anon — sem isso o
-- GRANT acima sozinho não é suficiente (RLS filtra depois do GRANT).
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'empresas';
