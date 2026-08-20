-- Todo o histórico de frota_veiculos é anterior à AlfaLight, então pertence
-- à Rentech (id 12) — mesmo raciocínio do backfill de op_ordens_pagamento.
-- Sem isso, veículo com empresa_id NULL é tratado como "visível a todos"
-- (mesmo critério usado no resto do sistema), o que vazava veículos da
-- Rentech (ex.: "Caminhão Branco") pra dentro da tela de um usuário que só
-- tem acesso à AlfaLight.
--
-- WHERE empresa_id IS NULL: só toca nos veículos que ainda não têm empresa
-- definida — não sobrescreve nenhum que você já tenha marcado manualmente
-- como AlfaLight em Controle de Frota.
UPDATE public.frota_veiculos
SET empresa_id = 12
WHERE empresa_id IS NULL;

-- Conferência: confirma que não sobrou nenhum veículo sem empresa.
SELECT count(*) AS veiculos_sem_empresa
FROM public.frota_veiculos
WHERE empresa_id IS NULL;
