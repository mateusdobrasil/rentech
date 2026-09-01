-- Tipo da escala (Montagem/Desmontagem/Visita Técnica/...) era um enum fixo
-- no código (check constraint em escala_locais_dia.tipo) — virou catálogo
-- editável, mesmo espírito de folha_departamento, pra crescer sem precisar
-- de deploy. Global (sem empresa_id): tipo de operação não muda por
-- empresa, mesmo critério de folha_departamento.
--
-- Sem dado de produção salvo em escala_locais_dia.tipo até agora (conferido
-- antes desta migration), então é seguro trocar a coluna direto — não
-- precisa de passo de migração de dado.
--
-- Roda uma vez no SQL Editor do Supabase.
create table if not exists escala_tipo (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

insert into escala_tipo (nome) values
  ('Montagem'), ('Desmontagem'), ('Visita Técnica'), ('Pré-montagem'), ('Devolução')
on conflict (nome) do nothing;

-- tipo (texto + check constraint) vira tipo_id (FK) + tipo_nome (snapshot),
-- mesmo padrão já usado em local_id/local_nome.
alter table escala_locais_dia drop constraint if exists escala_locais_dia_tipo_check;
alter table escala_locais_dia drop column if exists tipo;
alter table escala_locais_dia add column if not exists tipo_id uuid references escala_tipo(id) on delete set null;
alter table escala_locais_dia add column if not exists tipo_nome text;
