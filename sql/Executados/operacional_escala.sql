-- Escala de Trabalho (/admin/operacional/escala): coordenador/encarregado
-- monta, dia a dia, onde cada colaborador de um departamento vai trabalhar
-- e a que horário chega — arrastando o colaborador até o local no celular.
-- Roda uma vez no SQL Editor do Supabase.
--
-- escala_locais: catálogo de locais de trabalho por empresa (mesmo espírito
-- de folha_departamento), com opção de cadastrar um local novo direto na tela.
--
-- escala_alocacoes: uma linha por colaborador+dia. local_nome é um snapshot
-- do nome do local no momento da alocação (sobrevive a rename/remoção do
-- local no catálogo, mesmo raciocínio de guardar funcionario_nome como texto
-- em vez de só FK). unique(empresa_id, data, funcionario_nome) garante que
-- um colaborador só esteja em um local por dia — mover de local é upsert
-- nessa chave, não delete+insert.
--
-- Sem RLS: acesso controlado nas Server Actions (validarAcesso +
-- obterEmpresasPermitidas/empresaPermitida de app/lib/serverAuth.ts), mesmo
-- critério já documentado em mobile_push_notificacoes.sql.
create table if not exists escala_locais (
  id uuid primary key default gen_random_uuid(),
  empresa_id int not null references empresas(id),
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table if not exists escala_alocacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id int not null references empresas(id),
  data date not null,
  funcionario_nome text not null,
  departamento text,
  local_id uuid references escala_locais(id) on delete set null,
  local_nome text not null,
  horario time not null,
  observacao text,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, data, funcionario_nome)
);

create index if not exists escala_alocacoes_empresa_data_idx on escala_alocacoes (empresa_id, data);

insert into folha_paginas_permissoes (nome_pagina, endereco_route, permissoes_permitidas, requer_2fa)
values ('OPERACIONAL · ESCALA', '/admin/operacional/escala', array['OPERACIONAL', 'ADMINISTRADOR'], false)
on conflict (endereco_route) do nothing;
