-- Execute no SQL Editor do Supabase.
-- Log agregado de disparos por execução, usado para os contadores reais de
-- "WhatsApp Enviados" / "E-mails Enviados este mês" na tela Agendamentos e
-- Disparos (antes eram números fixos no código).

create table if not exists public.folha_automacoes_envios (
  id bigint generated always as identity primary key,
  chave text not null,
  canal text not null check (canal in ('WhatsApp', 'E-mail')),
  quantidade int not null default 0,
  criado_em timestamptz not null default now()
);

create index if not exists idx_folha_automacoes_envios_criado_em on public.folha_automacoes_envios (criado_em);
