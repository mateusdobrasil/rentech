-- Diagnóstico: por que o Sandro (Diretor, só-AlfaLight) ainda enxerga um
-- veículo com empresa_id = 12 (Rentech) em frota_veiculos.

-- 1) RLS está mesmo ligada na tabela?
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname = 'frota_veiculos';

-- 2) A política existe e está com a definição esperada?
SELECT polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) AS using_expr, pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy WHERE polrelid = 'public.frota_veiculos'::regclass;

-- 3) O que auth_e_administrador() está considerando "administrador" hoje?
-- (deve conter a exclusão explícita de DIR/GEREN — se não tiver, é a causa)
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'auth_e_administrador';

-- 4) Cargo bruto e vínculo de empresa do Sandro (rode com o e-mail dele).
SELECT pu.id, pu.nome, pu.permissao, pue.empresa_id
FROM public.perfis_usuarios pu
LEFT JOIN public.perfis_usuarios_empresas pue ON pue.perfil_id = pu.id
WHERE pu.nome ILIKE '%sandro%';
