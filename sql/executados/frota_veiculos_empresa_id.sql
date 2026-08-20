-- frota_veiculos não tinha nenhuma dimensão de empresa — todo veículo era
-- visível/editável por qualquer usuário com acesso à rota, independente de
-- ser Rentech ou AlfaLight. Adiciona a coluna e RLS de verdade (as telas de
-- frota usam o cliente anon do navegador direto, sem Server Action —
-- diferente da maioria do resto do sistema — então a única proteção real
-- contra IDOR aqui é RLS no banco).
--
-- Pressupõe que auth_empresas_permitidas() e auth_e_administrador() já
-- existem (criadas em sql/multiempresa_isolamento_rls.sql). Se der erro de
-- função inexistente, avise antes de rodar o resto.

ALTER TABLE public.frota_veiculos
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_frota_veiculos_empresa_id
  ON public.frota_veiculos(empresa_id);

ALTER TABLE public.frota_veiculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_veiculos_isolamento ON public.frota_veiculos;
CREATE POLICY frota_veiculos_isolamento ON public.frota_veiculos
  FOR ALL
  USING (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  WITH CHECK (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador());

-- frota_documentos não tem (e não precisa de) empresa_id própria — herda a
-- empresa do veículo pai (mesmo padrão de frota_checklist_itens/avarias em
-- sql/multiempresa_isolamento_rls.sql).
ALTER TABLE public.frota_documentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS frota_documentos_isolamento ON public.frota_documentos;
CREATE POLICY frota_documentos_isolamento ON public.frota_documentos
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.frota_veiculos fv
    WHERE fv.id = frota_documentos.veiculo_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.frota_veiculos fv
    WHERE fv.id = frota_documentos.veiculo_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

-- Conferência: confirma que RLS está de fato ligada nas duas tabelas.
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('frota_veiculos', 'frota_documentos');
