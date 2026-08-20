-- fichas_reserva (aba Calendário de /admin/operacional/relatorios) não tinha
-- empresa_id — cada ficha pertence a um "Centro" no P2S (um por CNPJ do
-- grupo), e esse nome já é resolvido e gravado na coluna "centro" pelo sync
-- (ver app/admin/comercial/fichas/fichasCore.ts). Usa esse texto pra casar
-- com o nome da empresa.
ALTER TABLE public.fichas_reserva
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_fichas_reserva_empresa_id
  ON public.fichas_reserva(empresa_id);

-- Backfill preciso: casa "centro" (nome resolvido do Centro no P2S) com o
-- nome cadastrado da empresa, nos dois sentidos (cobre tanto "centro" mais
-- curto que o nome oficial quanto o contrário).
UPDATE public.fichas_reserva f
SET empresa_id = e.id
FROM public.empresas e
WHERE f.empresa_id IS NULL
  AND f.centro IS NOT NULL
  AND (upper(f.centro) LIKE '%' || upper(e.nome) || '%' OR upper(e.nome) LIKE '%' || upper(f.centro) || '%');

-- Fallback: o que sobrou (centro nulo, ou não bateu com nenhuma empresa
-- cadastrada) é Rentech (id 12) — todo o histórico de fichas é anterior à
-- AlfaLight, mesmo raciocínio já usado em op_ordens_pagamento/frota_veiculos.
UPDATE public.fichas_reserva
SET empresa_id = 12
WHERE empresa_id IS NULL;

ALTER TABLE public.fichas_reserva ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fichas_reserva_isolamento ON public.fichas_reserva;
CREATE POLICY fichas_reserva_isolamento ON public.fichas_reserva
  FOR ALL
  USING (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador())
  WITH CHECK (empresa_id IS NULL OR empresa_id = ANY(auth_empresas_permitidas()) OR auth_e_administrador());

-- Conferência: quantas fichas ficaram sem correspondência exata de "centro"
-- (foram parar em Rentech pelo fallback, não por casamento de nome) — vale
-- conferir manualmente se algumas dessas na verdade são da AlfaLight.
SELECT count(*) AS total, count(*) FILTER (WHERE centro IS NULL) AS sem_centro
FROM public.fichas_reserva;
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'fichas_reserva';
