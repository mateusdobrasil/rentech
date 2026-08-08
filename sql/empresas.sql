-- Multi-empresa (Fase 1) — tabela de cadastro das empresas do Grupo Rentech.
-- Rodar antes de sql/folha_funcionarios_empresa_id.sql e sql/perfis_usuarios_empresas.sql.

create table if not exists empresas (
  id serial primary key,
  nome text not null unique,
  razao_social text,
  cnpj text unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Toda tabela nova neste projeto precisa disso desde o início — sem RLS
-- desabilitado + grants, o admin (que lê E grava direto com a chave
-- anon/authenticated do navegador, sem passar por server action) trava com
-- "new row violates row-level security policy" ou fica com o grid vazio.
--
-- Só `authenticated` (não `anon`): todas as telas que usam esta tabela já
-- exigem sessão logada antes de consultar, então não há motivo pra liberar
-- também pra quem nunca fez login (a anon key é pública, vai no JS do
-- navegador de qualquer visitante).
alter table empresas disable row level security;
revoke all on empresas from anon;
grant select, insert, update, delete on empresas to authenticated;