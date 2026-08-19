-- Separação de rota: Diretoria e Gerência deixam de ser tratadas como
-- "Administrador" para fins de ACESSO A PÁGINAS (app/lib/permissoes.ts,
-- normalizarPermissao). Motivo: /admin/academy (e possivelmente outras)
-- deveria ser só de administradores de verdade, mas como Diretor/Gerente
-- normalizava pro mesmo balde ADMINISTRADOR, qualquer rota liberada pra
-- ADMINISTRADOR também liberava Diretoria/Gerência sem ninguém ter marcado
-- isso explicitamente.
--
-- Esta migração:
--   1) Cria os setores "DIRETORIA" e "GERENCIA" no catálogo (pra aparecerem
--      como checkbox próprio na aba Páginas de /admin/parametros/permissoes).
--   2) Em toda página que hoje libera ADMINISTRADOR, adiciona também
--      DIRETORIA e GERENCIA — preserva o acesso que Diretoria/Gerência já
--      tinham em todo o resto do sistema, já que só o /admin/academy foi
--      confirmado como "deveria ter sido só administrador".
--   3) EXCLUI /admin/academy desse backfill de propósito — é a página que
--      motivou a mudança, então ela fica só com ADMINISTRADOR.
--
-- Se existir OUTRA página que também deveria ser só-administrador (e
-- Diretoria/Gerência só tinham acesso por causa desse bug), ela vai
-- continuar liberada pra elas depois desta migração (o backfill do passo 2
-- preserva o comportamento de hoje) — rode o SELECT no final pra revisar
-- lista completa, e desmarque DIRETORIA/GERENCIA manualmente na aba Páginas
-- pra qualquer rota que precisar do mesmo tratamento do academy.
--
-- Pressupõe que folha_paginas_permissoes.permissoes_permitidas é coluna
-- text[]. Se der erro de tipo, avise — a sintaxe muda pra jsonb.

INSERT INTO public.setores_permissao (nome)
SELECT 'DIRETORIA' WHERE NOT EXISTS (SELECT 1 FROM public.setores_permissao WHERE nome = 'DIRETORIA');

INSERT INTO public.setores_permissao (nome)
SELECT 'GERENCIA' WHERE NOT EXISTS (SELECT 1 FROM public.setores_permissao WHERE nome = 'GERENCIA');

UPDATE public.folha_paginas_permissoes
SET permissoes_permitidas = (
  SELECT array_agg(DISTINCT v) FROM unnest(
    permissoes_permitidas || ARRAY['DIRETORIA', 'GERENCIA']
  ) AS v
)
WHERE 'ADMINISTRADOR' = ANY(permissoes_permitidas)
  AND endereco_route <> '/admin/academy';

-- Conferência: revise se alguma outra rota (além de /admin/academy) também
-- deveria ficar só-administrador — remova DIRETORIA/GERENCIA dela na aba
-- Páginas se for o caso.
SELECT endereco_route, nome_pagina, permissoes_permitidas
FROM public.folha_paginas_permissoes
WHERE 'ADMINISTRADOR' = ANY(permissoes_permitidas)
ORDER BY endereco_route;
