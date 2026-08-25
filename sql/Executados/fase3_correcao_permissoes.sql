-- Fase 3 do app mobile: corrige /mobile/ponto e /mobile/op, semeadas "no
-- chute" na Fase 2 — não batiam com quem de fato tem acesso nas páginas
-- admin equivalentes (conferido direto na tabela antes desta migração).
-- Roda uma vez no SQL Editor do Supabase.

-- aprovarSolicitacaoAction/rejeitarSolicitacaoAction aceitam quem tem acesso
-- a QUALQUER UMA de /admin/rh/ponto, /admin/operacional/registro-ponto ou
-- /admin/rh/holerite — união dos cargos das três.
update folha_paginas_permissoes
  set permissoes_permitidas = array['ADMINISTRADOR','DIRETORIA','FINANCEIRO','GERENCIA','GESTORES','OPERACIONAL']
  where endereco_route = '/mobile/ponto';

-- atualizarStatus (aprovar/baixar OP) exige acesso a /admin/financeiro/ops.
update folha_paginas_permissoes
  set permissoes_permitidas = array['ADMINISTRADOR','DIRETORIA','FINANCEIRO','GERENCIA']
  where endereco_route = '/mobile/op';
