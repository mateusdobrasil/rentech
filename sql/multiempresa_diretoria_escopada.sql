-- Isolamento de dados entre empresas (Rentech x AlfaLight)
-- Ajuste pedido depois do rollout inicial: Diretoria e Gerência NÃO devem
-- mais enxergar todas as empresas automaticamente — diretorias diferentes
-- tocam empresas diferentes (Rentech e AlfaLight têm diretorias próprias).
-- Só quem é literalmente "Administrador" continua sem restrição de empresa;
-- Diretoria/Gerência passam a ser escopadas por perfis_usuarios_empresas
-- como qualquer outro usuário (mas mantêm o mesmo acesso de ROTA/telas que
-- já tinham — isso não muda).
--
-- Substitui só a função auth_e_administrador() já criada em
-- multiempresa_isolamento_rls.sql — não precisa rodar o arquivo grande de
-- novo. Rode este arquivo inteiro no SQL Editor do Supabase.

CREATE OR REPLACE FUNCTION public.auth_e_administrador()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis_usuarios
    WHERE id = auth.uid()
      AND upper(COALESCE(permissao, '')) NOT LIKE '%ADMINISTRATIVO%'
      AND upper(COALESCE(permissao, '')) NOT LIKE '%DIR%'
      AND upper(COALESCE(permissao, '')) NOT LIKE '%GEREN%'
      AND upper(COALESCE(permissao, '')) LIKE '%ADMIN%'
  );
$$;

-- Conferência: cargos hoje cadastrados que caem em cada lado da regra —
-- útil pra revisar se algum "Diretor Administrativo"/"Gerente Geral" etc.
-- ficou classificado como você esperava.
SELECT
  permissao,
  count(*) AS qtd,
  (
    upper(COALESCE(permissao, '')) NOT LIKE '%ADMINISTRATIVO%'
    AND upper(COALESCE(permissao, '')) NOT LIKE '%DIR%'
    AND upper(COALESCE(permissao, '')) NOT LIKE '%GEREN%'
    AND upper(COALESCE(permissao, '')) LIKE '%ADMIN%'
  ) AS continua_sem_restricao_de_empresa
FROM public.perfis_usuarios
GROUP BY permissao
ORDER BY continua_sem_restricao_de_empresa DESC, permissao;
