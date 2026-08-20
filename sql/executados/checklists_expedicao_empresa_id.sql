-- Checklist de Carga/Retorno (Expedição, /admin/estoque/expedicao) não tinha
-- nenhuma dimensão de empresa. Diferente de frota_veiculos/equipamentos, o
-- checklist não é um cadastro fixo — nasce ou vinculado a um evento já
-- sincronizado do P2S (nesse caso a empresa é a mesma da Ficha de Reserva
-- daquele evento, resolvida por fichas_reserva.empresa_id via
-- sql/fichas_reserva_empresa_id.sql) ou criado manualmente (empresa escolhida
-- na hora pelo usuário — ver app/admin/estoque/expedicao/page.tsx).

ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_checklists_empresa_id
  ON public.checklists(empresa_id);

-- Backfill: casa o evento_feira do checklist com o mesmo evento_feira de
-- alguma fichas_reserva já resolvida (nomes vêm do mesmo texto livre/sync do
-- P2S nos dois lados, por isso o match direto ao invés de LIKE).
UPDATE public.checklists c
SET empresa_id = f.empresa_id
FROM public.fichas_reserva f
WHERE c.empresa_id IS NULL
  AND c.evento_feira IS NOT NULL
  AND f.empresa_id IS NOT NULL
  AND upper(f.evento_feira) = upper(c.evento_feira);

-- Fallback: o que sobrou (sem evento_feira, ou evento sem nenhuma ficha
-- correspondente) é Rentech (id 12) — mesmo raciocínio já usado em
-- fichas_reserva/frota_veiculos/equipamentos, todo o histórico é anterior à
-- AlfaLight.
UPDATE public.checklists
SET empresa_id = 12
WHERE empresa_id IS NULL;

ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklists_isolamento ON public.checklists;
CREATE POLICY checklists_isolamento ON public.checklists
  FOR ALL
  USING (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  WITH CHECK (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador());

-- checklist_itens e checklist_divergencias não têm empresa_id própria: herdam
-- a empresa do checklist (checklists.empresa_id), via join — mesmo padrão de
-- sql/frota_manutencoes_checklists_rls.sql.
ALTER TABLE public.checklist_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_itens_isolamento ON public.checklist_itens;
CREATE POLICY checklist_itens_isolamento ON public.checklist_itens
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.checklists c
    WHERE c.id = checklist_itens.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.checklists c
    WHERE c.id = checklist_itens.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

ALTER TABLE public.checklist_divergencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checklist_divergencias_isolamento ON public.checklist_divergencias;
CREATE POLICY checklist_divergencias_isolamento ON public.checklist_divergencias
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.checklists c
    WHERE c.id = checklist_divergencias.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.checklists c
    WHERE c.id = checklist_divergencias.checklist_id
      AND (c.empresa_id IS NULL OR c.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

-- checklist_modelo_itens NÃO entra aqui de propósito: é o modelo padrão
-- compartilhado (mesmo tratamento de categorias/frota_tipos_manutencao),
-- sem vínculo com empresa.

-- Conferência.
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('checklists', 'checklist_itens', 'checklist_divergencias');
SELECT count(*) AS total, count(*) FILTER (WHERE empresa_id = 12) AS foram_pro_fallback_rentech
FROM public.checklists;
