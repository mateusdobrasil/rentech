-- Isolamento de dados entre empresas (Rentech x AlfaLight)
-- Passo 3/3: funções auxiliares + RLS nas tabelas ligadas a funcionário.
-- Rode depois de colunas.sql e backfill.sql.
--
-- IMPORTANTE (lição registrada em fases anteriores): depois de rodar, confirme
-- que cada ENABLE ROW LEVEL SECURITY realmente "pegou":
--   select relname, relrowsecurity from pg_class
--   where relname in ('folha_funcionarios','folha_rescisoes','folha_ponto_diaria', ...)
--     and relrowsecurity is not true;
-- Essa consulta deve devolver zero linhas. Se devolver alguma, rode de novo
-- SÓ o ALTER TABLE ... ENABLE ROW LEVEL SECURITY daquela tabela, isolado.

-- ============================================================================
-- Funções auxiliares (SECURITY DEFINER pra não depender de RLS nas tabelas
-- que elas mesmas consultam, e search_path fixo por segurança).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auth_empresas_permitidas()
RETURNS int[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(empresa_id), ARRAY[]::int[])
  FROM public.perfis_usuarios_empresas
  WHERE perfil_id = auth.uid();
$$;

-- Mesma regra de app/lib/permissoes.ts (ehAdministradorGlobal): o balde
-- ADMINISTRADOR (ADMIN/DIR/GEREN) dá o mesmo acesso de ROTA nas telas, mas só
-- quem é literalmente "Administrador" enxerga TODAS as empresas sem
-- restrição — Diretoria e Gerência ficam escopadas por
-- perfis_usuarios_empresas como qualquer outro usuário, porque diretorias
-- diferentes tocam empresas diferentes (Rentech × AlfaLight).
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

GRANT EXECUTE ON FUNCTION public.auth_empresas_permitidas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_e_administrador() TO authenticated;

-- ============================================================================
-- RLS: mesma política em todas as tabelas — linha sem empresa (NULL, legado)
-- é visível pra qualquer autenticado, linha com empresa só é visível pra quem
-- está vinculado a ela em perfis_usuarios_empresas, ou é administrador.
-- ============================================================================

DO $$
DECLARE
  tabelas text[] := ARRAY[
    'folha_funcionarios',
    'folha_rescisoes',
    'folha_ponto_diaria',
    'folha_ponto_abono',
    'folha_ponto_whatsapp_registros',
    'folha_ponto_whatsapp_ajustes',
    'folha_ponto_whatsapp_solicitacoes',
    'folha_ponto_whatsapp_pendencias',
    'folha_holerites',
    'folha_holerite_assinaturas',
    'folha_documentos_contabeis',
    'folha_documentos',
    'folha_afastamentos',
    'folha_ferias',
    'folha_consignados',
    'frota_checklists'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS multiempresa_isolamento ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY multiempresa_isolamento ON public.%I
      FOR ALL
      USING (empresa_id IS NULL OR empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador())
      WITH CHECK (empresa_id IS NULL OR empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador())
    $f$, t);
  END LOOP;
END $$;

-- frota_checklist_itens e frota_checklist_avarias não têm empresa_id próprio
-- (têm checklist_id, FK real pra frota_checklists) — a política enxerga a
-- empresa através do checklist pai.
ALTER TABLE public.frota_checklist_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS multiempresa_isolamento ON public.frota_checklist_itens;
CREATE POLICY multiempresa_isolamento ON public.frota_checklist_itens
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.frota_checklists c
    WHERE c.id = frota_checklist_itens.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.frota_checklists c
    WHERE c.id = frota_checklist_itens.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador())
  ));

ALTER TABLE public.frota_checklist_avarias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS multiempresa_isolamento ON public.frota_checklist_avarias;
CREATE POLICY multiempresa_isolamento ON public.frota_checklist_avarias
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.frota_checklists c
    WHERE c.id = frota_checklist_avarias.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.frota_checklists c
    WHERE c.id = frota_checklist_avarias.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador())
  ));

-- empresa_documentos já tem empresa_id próprio desde a Fase 2 (não-nullable
-- no INSERT, mas a coluna em si permite NULL em linhas antigas) — mesma regra.
ALTER TABLE public.empresa_documentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS multiempresa_isolamento ON public.empresa_documentos;
CREATE POLICY multiempresa_isolamento ON public.empresa_documentos
  FOR ALL
  USING (empresa_id IS NULL OR empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador())
  WITH CHECK (empresa_id IS NULL OR empresa_id = ANY(public.auth_empresas_permitidas()) OR public.auth_e_administrador());

-- ============================================================================
-- Achado paralelo: perfis_usuarios_empresas hoje é gravada direto do
-- navegador (permissoes/page.tsx) sem checagem nenhuma no servidor — qualquer
-- autenticado poderia se auto-vincular a qualquer empresa via console. A
-- escrita passa a ser feita só por Server Action com service role
-- (vincularEmpresasUsuarioAction em app/actions.ts, que ignora estes grants);
-- aqui só fechamos a porta pro cliente anon/authenticated gravar direto.
-- A leitura continua liberada (a tela de Permissões precisa listar o vínculo
-- de todo mundo pra montar a grid de usuários).
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE ON public.perfis_usuarios_empresas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.perfis_usuarios_empresas FROM anon;
