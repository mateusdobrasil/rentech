-- App mobile: permissões de aba passam a vir de folha_paginas_permissoes
-- (mesma tabela que já controla acesso de rota no /admin, editável em
-- /admin/parametros/permissoes → aba "Páginas"), em vez de array fixo no
-- código. Roda uma vez no SQL Editor do Supabase — depois disso, ajustar
-- quem acessa cada aba do app é só editar essas linhas pela tela de
-- Permissões, sem precisar mexer em código.
--
-- Valores abaixo replicam o que estava hardcoded até agora. Ajuste como
-- quiser depois — inclusive adicionar outros cargos (ex.: ADMINISTRATIVO
-- também em frota, se fizer sentido).
insert into folha_paginas_permissoes (nome_pagina, endereco_route, permissoes_permitidas, requer_2fa)
values
  ('APP MOBILE · FROTA', '/mobile/frota', array['OPERACIONAL', 'ADMINISTRADOR'], false),
  ('APP MOBILE · CARGA', '/mobile/carga', array['OPERACIONAL', 'ADMINISTRADOR'], false),
  ('APP MOBILE · PONTO', '/mobile/ponto', array['ADMINISTRATIVO', 'ADMINISTRADOR'], false),
  ('APP MOBILE · OP', '/mobile/op', array['ADMINISTRATIVO', 'ADMINISTRADOR'], false)
on conflict (endereco_route) do nothing;
