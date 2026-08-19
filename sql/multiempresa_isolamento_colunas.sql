-- Isolamento de dados entre empresas (Rentech x AlfaLight)
-- Passo 1/3: adiciona empresa_id nas tabelas que hoje só ligam ao funcionário
-- por nome (texto), sem nenhuma coluna de empresa própria.
--
-- folha_funcionarios e folha_rescisoes JÁ têm empresa_id (fases anteriores) e
-- não entram aqui.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase antes do
-- multiempresa_isolamento_backfill.sql.

ALTER TABLE public.folha_ponto_diaria            ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_ponto_abono              ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_ponto_whatsapp_registros ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_ponto_whatsapp_ajustes   ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_ponto_whatsapp_solicitacoes ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_ponto_whatsapp_pendencias   ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

ALTER TABLE public.folha_holerites            ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_holerite_assinaturas ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_documentos_contabeis ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_documentos           ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

ALTER TABLE public.folha_afastamentos ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_ferias       ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);
ALTER TABLE public.folha_consignados  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

ALTER TABLE public.frota_checklists ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_folha_ponto_diaria_empresa            ON public.folha_ponto_diaria(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_ponto_abono_empresa             ON public.folha_ponto_abono(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_ponto_whatsapp_registros_empresa ON public.folha_ponto_whatsapp_registros(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_ponto_whatsapp_ajustes_empresa   ON public.folha_ponto_whatsapp_ajustes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_ponto_whatsapp_solicitacoes_empresa ON public.folha_ponto_whatsapp_solicitacoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_ponto_whatsapp_pendencias_empresa   ON public.folha_ponto_whatsapp_pendencias(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_holerites_empresa            ON public.folha_holerites(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_holerite_assinaturas_empresa ON public.folha_holerite_assinaturas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_documentos_contabeis_empresa ON public.folha_documentos_contabeis(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_documentos_empresa           ON public.folha_documentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_afastamentos_empresa ON public.folha_afastamentos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_ferias_empresa       ON public.folha_ferias(empresa_id);
CREATE INDEX IF NOT EXISTS idx_folha_consignados_empresa  ON public.folha_consignados(empresa_id);
CREATE INDEX IF NOT EXISTS idx_frota_checklists_empresa   ON public.frota_checklists(empresa_id);
