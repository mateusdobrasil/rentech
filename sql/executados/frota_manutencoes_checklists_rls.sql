-- Completa o isolamento por empresa da Frota: frota_veiculos e
-- frota_documentos já tinham RLS (sql/frota_veiculos_empresa_id.sql), mas
-- frota_manutencoes e frota_checklists (+ itens/avarias) continuavam
-- totalmente abertas — mesmo sem UI pra isso, dava pra consultar direto pela
-- API do Supabase (chave anon) e ver manutenção/checklist de veículo de
-- qualquer empresa. Nenhuma dessas tabelas tem empresa_id própria: todas
-- herdam a empresa do veículo (frota_veiculos.empresa_id), via join.

ALTER TABLE public.frota_manutencoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frota_manutencoes_isolamento ON public.frota_manutencoes;
CREATE POLICY frota_manutencoes_isolamento ON public.frota_manutencoes
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.frota_veiculos fv
    WHERE fv.id = frota_manutencoes.veiculo_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.frota_veiculos fv
    WHERE fv.id = frota_manutencoes.veiculo_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

ALTER TABLE public.frota_checklists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frota_checklists_isolamento ON public.frota_checklists;
CREATE POLICY frota_checklists_isolamento ON public.frota_checklists
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.frota_veiculos fv
    WHERE fv.id = frota_checklists.veiculo_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.frota_veiculos fv
    WHERE fv.id = frota_checklists.veiculo_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

-- Dois níveis: item/avaria -> checklist -> veículo -> empresa.
ALTER TABLE public.frota_checklist_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frota_checklist_itens_isolamento ON public.frota_checklist_itens;
CREATE POLICY frota_checklist_itens_isolamento ON public.frota_checklist_itens
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.frota_checklists fc
    JOIN public.frota_veiculos fv ON fv.id = fc.veiculo_id
    WHERE fc.id = frota_checklist_itens.checklist_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.frota_checklists fc
    JOIN public.frota_veiculos fv ON fv.id = fc.veiculo_id
    WHERE fc.id = frota_checklist_itens.checklist_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

ALTER TABLE public.frota_checklist_avarias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS frota_checklist_avarias_isolamento ON public.frota_checklist_avarias;
CREATE POLICY frota_checklist_avarias_isolamento ON public.frota_checklist_avarias
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.frota_checklists fc
    JOIN public.frota_veiculos fv ON fv.id = fc.veiculo_id
    WHERE fc.id = frota_checklist_avarias.checklist_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.frota_checklists fc
    JOIN public.frota_veiculos fv ON fv.id = fc.veiculo_id
    WHERE fc.id = frota_checklist_avarias.checklist_id
      AND (fv.empresa_id IS NULL OR fv.empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  ));

-- frota_tipos_manutencao NÃO entra aqui de propósito: é um catálogo
-- compartilhado (ex.: "Troca de óleo"), sem vínculo com veículo/empresa.

-- Conferência.
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('frota_manutencoes', 'frota_checklists', 'frota_checklist_itens', 'frota_checklist_avarias');
