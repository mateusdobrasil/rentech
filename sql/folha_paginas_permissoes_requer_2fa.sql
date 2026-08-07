-- Torna a exigência de 2FA por rota configurável em
-- /admin/parametros/permissoes (aba "Permissão 2FA"), em vez de fixa no
-- código só para a área Financeiro.

alter table folha_paginas_permissoes
  add column if not exists requer_2fa boolean not null default false;

-- Preserva o comportamento atual: essas rotas já exigem 2FA hoje via
-- app/admin/financeiro/ExigirMFA.tsx.
update folha_paginas_permissoes set requer_2fa = true
where endereco_route in (
  '/admin/financeiro',
  '/admin/financeiro/rh',
  '/admin/financeiro/ops',
  '/admin/financeiro/consignado',
  '/admin/financeiro/relatorios',
  '/admin/financeiro/integracao'
);
