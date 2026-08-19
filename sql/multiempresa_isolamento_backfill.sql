-- Isolamento de dados entre empresas (Rentech x AlfaLight)
-- Passo 2/3: preenche o empresa_id novo em linhas já existentes, casando
-- pelo nome do funcionário com folha_funcionarios (upper/trim pra não perder
-- linha por diferença de caixa/espaço). Rode depois do
-- multiempresa_isolamento_colunas.sql e antes do _rls.sql.
--
-- Funcionários sem empresa_id definido em folha_funcionarios continuam NULL
-- aqui (não há empresa pra herdar) — a política de RLS trata NULL como
-- "visível pra todo mundo autenticado", igual ao comportamento de hoje, até
-- alguém rodar a atribuição de empresa nesse funcionário.

UPDATE public.folha_ponto_diaria t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_ponto_abono t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

-- folha_ponto_whatsapp_registros é o livro-razão legal do ponto via WhatsApp
-- e tem um trigger (folha_ponto_whatsapp_bloquear_alteracao) que rejeita
-- QUALQUER UPDATE nela, de propósito — é append-only, correções vão pra
-- folha_ponto_whatsapp_ajustes, nunca reescrevendo a linha original. Por
-- isso NÃO backfillamos empresa_id aqui: linhas antigas ficam NULL (visível
-- a qualquer autenticado, igual ao comportamento de hoje — inofensivo, já
-- que tudo que existe até a AlfaLight entrar é da Rentech). Registros novos
-- já saem com empresa_id preenchido desde a gravação (ver
-- empresaIdDoFuncionario em app/lib/pontoWhatsapp.ts), então o isolamento
-- funciona plenamente pra frente, que é o que importa.

UPDATE public.folha_ponto_whatsapp_ajustes t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_ponto_whatsapp_solicitacoes t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_ponto_whatsapp_pendencias t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_holerites t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_holerite_assinaturas t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_documentos_contabeis t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_documentos t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_afastamentos t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_ferias t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

UPDATE public.folha_consignados t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

-- frota_checklists liga pelo motorista (motorista_nome), não funcionario_nome.
UPDATE public.frota_checklists t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.motorista_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

-- folha_rescisoes já grava empresa_id no momento da criação (actions-rescisao.ts),
-- mas rescisões antigas de funcionário sem empresa definida na época ficaram NULL.
UPDATE public.folha_rescisoes t SET empresa_id = f.empresa_id
FROM public.folha_funcionarios f
WHERE upper(trim(f.nome_completo)) = upper(trim(t.funcionario_nome)) AND t.empresa_id IS NULL AND f.empresa_id IS NOT NULL;

-- Conferência: linhas que ficaram sem empresa_id em cada tabela (funcionário
-- sem empresa definida, ou nome sem correspondência exata em folha_funcionarios
-- — vale olhar essas manualmente).
SELECT 'folha_ponto_diaria' AS tabela, count(*) FROM public.folha_ponto_diaria WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_ponto_abono', count(*) FROM public.folha_ponto_abono WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_ponto_whatsapp_registros', count(*) FROM public.folha_ponto_whatsapp_registros WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_ponto_whatsapp_ajustes', count(*) FROM public.folha_ponto_whatsapp_ajustes WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_ponto_whatsapp_solicitacoes', count(*) FROM public.folha_ponto_whatsapp_solicitacoes WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_ponto_whatsapp_pendencias', count(*) FROM public.folha_ponto_whatsapp_pendencias WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_holerites', count(*) FROM public.folha_holerites WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_holerite_assinaturas', count(*) FROM public.folha_holerite_assinaturas WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_documentos_contabeis', count(*) FROM public.folha_documentos_contabeis WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_documentos', count(*) FROM public.folha_documentos WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_afastamentos', count(*) FROM public.folha_afastamentos WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_ferias', count(*) FROM public.folha_ferias WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_consignados', count(*) FROM public.folha_consignados WHERE empresa_id IS NULL
UNION ALL SELECT 'frota_checklists', count(*) FROM public.frota_checklists WHERE empresa_id IS NULL
UNION ALL SELECT 'folha_rescisoes', count(*) FROM public.folha_rescisoes WHERE empresa_id IS NULL;
