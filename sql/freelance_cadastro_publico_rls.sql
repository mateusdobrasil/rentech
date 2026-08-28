-- /freelance (auto-cadastro público de freelancers, sem login) estava
-- devolvendo 401 / erro Postgres 42501 (insufficient_privilege) ao tentar
-- gravar em "freelancers": a tabela tem RLS habilitado mas não existe (ou
-- foi removida) a política que permite o papel "anon" inserir uma linha.
-- Isso derrubou o auto-cadastro em produção (relatos de freelancers que não
-- conseguiam se cadastrar) — o formulário em si estava correto, faltava
-- permissão no banco. Roda uma vez no SQL Editor do Supabase.
--
-- Escopo intencionalmente mínimo: só concede INSERT pro anônimo (o
-- necessário pro formulário público funcionar). Leitura/edição/exclusão
-- continuam exclusivas de quem já tinha acesso (telas internas, que usam a
-- service role e não passam por RLS).

alter table freelancers enable row level security;
drop policy if exists "freelancers_insert_publico" on freelancers;
create policy "freelancers_insert_publico"
  on freelancers
  for insert
  to anon
  with check (true);

alter table freelancers_setor_nivel enable row level security;
drop policy if exists "freelancers_setor_nivel_insert_publico" on freelancers_setor_nivel;
create policy "freelancers_setor_nivel_insert_publico"
  on freelancers_setor_nivel
  for insert
  to anon
  with check (true);

-- Leitura dos catálogos de setor/nível também é feita pelo formulário
-- público (sem login) pra montar a seção "Nível de Conhecimento Técnico" —
-- sem policy de SELECT pro anônimo, essa seção aparece vazia (sem erro
-- visível) em vez de travar o cadastro, mas é bom já cobrir.
alter table freelancers_setores enable row level security;
drop policy if exists "freelancers_setores_select_publico" on freelancers_setores;
create policy "freelancers_setores_select_publico"
  on freelancers_setores
  for select
  to anon
  using (true);

alter table freelancers_niveis enable row level security;
drop policy if exists "freelancers_niveis_select_publico" on freelancers_niveis;
create policy "freelancers_niveis_select_publico"
  on freelancers_niveis
  for select
  to anon
  using (true);
