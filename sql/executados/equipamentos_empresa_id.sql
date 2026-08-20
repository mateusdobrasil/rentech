-- equipamentos (Controle de Estoque) não tinha nenhuma dimensão de empresa —
-- cada empresa do grupo (Rentech, AlfaLight) tem seu próprio patrimônio de
-- equipamentos (LED, som, estruturas etc.), então precisa ser tratado igual
-- a frota_veiculos.
--
-- ATENÇÃO — diferença importante da frota: esta tabela também é lida pelo
-- SIMULADOR PÚBLICO (app/simulador/videowall — sem login, cliente vendo o
-- catálogo antes de fechar negócio). Se a RLS bloqueasse por empresa igual
-- fizemos em frota_veiculos, o simulador ficaria com o catálogo vazio pra
-- qualquer visitante não autenticado assim que os itens fossem marcados com
-- uma empresa. Por isso aqui a política é em duas partes: o papel "anon"
-- (visitante sem login) sempre vê tudo; só o papel "authenticated" (equipe
-- logada, telas internas) fica escopado por empresa.

ALTER TABLE public.equipamentos
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_equipamentos_empresa_id
  ON public.equipamentos(empresa_id);

-- Todo o catálogo existente é anterior à AlfaLight, então é da Rentech (id 12).
UPDATE public.equipamentos
SET empresa_id = 12
WHERE empresa_id IS NULL;

ALTER TABLE public.equipamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS equipamentos_leitura_publica ON public.equipamentos;
CREATE POLICY equipamentos_leitura_publica ON public.equipamentos
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS equipamentos_isolamento_autenticado ON public.equipamentos;
CREATE POLICY equipamentos_isolamento_autenticado ON public.equipamentos
  FOR ALL
  TO authenticated
  USING (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  WITH CHECK (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador());

-- categorias (rótulos como "Iluminação", "Som") NÃO entra aqui de propósito:
-- é um catálogo compartilhado, sem vínculo com empresa — mesmo tratamento
-- de frota_tipos_manutencao.

-- Conferência.
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'equipamentos';
SELECT count(*) AS sem_empresa FROM public.equipamentos WHERE empresa_id IS NULL;
