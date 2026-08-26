-- Push notifications do app mobile + inbox de notificações.
-- auth_user_id = session.user.id (igual pra STAFF via perfis_usuarios.id e
-- PORTAL via portal_funcionarios_auth.auth_user_id — mesma tabela auth.users
-- por trás dos dois). Sem RLS: tudo passa por Route Handlers com
-- supabaseAdmin + validação de token no servidor, mesmo padrão já usado em
-- todo o resto do app mobile.

create table if not exists folha_mobile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  tipo_conta text not null,
  expo_push_token text not null unique,
  plataforma text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists folha_mobile_push_tokens_auth_user_id_idx on folha_mobile_push_tokens (auth_user_id);

create table if not exists folha_mobile_notificacoes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  titulo text not null,
  corpo text not null,
  dados jsonb,
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists folha_mobile_notificacoes_auth_user_id_criado_em_idx on folha_mobile_notificacoes (auth_user_id, criado_em desc);
