-- Multi-empresa (Fase 1) — vínculo N:N entre usuários do admin e empresas.
-- Um usuário sem nenhuma linha aqui não vê dados de nenhuma empresa nas
-- telas que já aplicam a restrição (ver /admin/rh/funcionario), exceto
-- setor ADMINISTRADOR, que enxerga todas por padrão.
-- Rodar depois de sql/empresas.sql.

create table if not exists perfis_usuarios_empresas (
  perfil_id uuid not null references perfis_usuarios(id) on delete cascade,
  empresa_id integer not null references empresas(id) on delete cascade,
  primary key (perfil_id, empresa_id)
);

-- Mesmo tratamento de acesso que perfis_usuarios já tem hoje (consulta
-- direta do client autenticado, sem camada de RLS neste projeto).
--
-- Só `authenticated` (não `anon`): a tela que usa esta tabela já exige
-- sessão logada antes de consultar, então não há motivo pra liberar também
-- pra quem nunca fez login (a anon key é pública, vai no JS do navegador).
alter table perfis_usuarios_empresas disable row level security;
revoke all on perfis_usuarios_empresas from anon;
grant select, insert, update, delete on perfis_usuarios_empresas to authenticated;