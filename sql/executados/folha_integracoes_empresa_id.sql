-- folha_integracoes (tela /admin/parametros/integracao) não diferenciava
-- integrações exclusivas de uma empresa (ex.: Banco Itaú — só Rentech) das
-- compartilhadas por todo o grupo (ex.: WhatsApp Meta — Rentech e AlfaLight).
-- empresa_id NULL = compartilhada (comportamento de sempre); preenchida =
-- exclusiva daquela empresa.
ALTER TABLE public.folha_integracoes
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_folha_integracoes_empresa_id
  ON public.folha_integracoes(empresa_id);

-- Conferência.
SELECT id, parceiro, nome_exibicao, empresa_id FROM public.folha_integracoes ORDER BY id;
