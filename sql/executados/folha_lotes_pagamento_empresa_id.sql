-- folha_lotes_pagamento não tinha empresa_id própria — só os itens (JSONB)
-- carregavam empresa_id individual, o que obrigava a inspecionar o array
-- inteiro toda vez que uma tela precisava saber de qual empresa é o lote.
-- Agora que a montagem do lote (/admin/financeiro/rh) exige escolher a
-- empresa ANTES de montar, todo lote novo é de uma empresa só — faz sentido
-- ter a coluna no nível do lote.
--
-- IF NOT EXISTS: seguro rodar mesmo que a coluna já exista.
ALTER TABLE public.folha_lotes_pagamento
  ADD COLUMN IF NOT EXISTS empresa_id int NULL REFERENCES public.empresas(id);

CREATE INDEX IF NOT EXISTS idx_folha_lotes_pagamento_empresa_id
  ON public.folha_lotes_pagamento(empresa_id);

-- Backfill: só preenche lotes ANTIGOS cujos itens são inequivocamente de UMA
-- única empresa (todo item com o mesmo empresa_id, ignorando itens sem
-- empresa_id). Lotes que misturam empresas, ou cujos itens não têm
-- empresa_id nenhum, ficam com empresa_id NULL — tratado como visível a
-- todos, mesmo critério já usado no resto do sistema.
UPDATE public.folha_lotes_pagamento AS l
SET empresa_id = sub.unica_empresa
FROM (
  SELECT
    l2.id AS lote_id,
    MIN((item ->> 'empresa_id')::int) AS unica_empresa
  FROM public.folha_lotes_pagamento AS l2
  CROSS JOIN LATERAL jsonb_array_elements(l2.itens) AS item
  WHERE l2.empresa_id IS NULL
    AND jsonb_typeof(l2.itens) = 'array'
    AND jsonb_array_length(l2.itens) > 0
    AND item ->> 'empresa_id' IS NOT NULL
    AND item ->> 'empresa_id' <> 'null'
  GROUP BY l2.id
  HAVING COUNT(DISTINCT (item ->> 'empresa_id')::int) = 1
) AS sub
WHERE l.id = sub.lote_id;

-- Conferência: quantos lotes continuam sem empresa_id (mistos, sem itens
-- com empresa_id, ou sem itens registrados) — normal não zerar.
SELECT count(*) AS lotes_sem_empresa FROM public.folha_lotes_pagamento WHERE empresa_id IS NULL;
SELECT count(*) AS lotes_com_empresa FROM public.folha_lotes_pagamento WHERE empresa_id IS NOT NULL;
