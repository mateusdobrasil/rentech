-- ============================================================================
-- Checklist de Veículos (Frota) — rodar no Supabase SQL Editor antes de usar
-- a nova aba em /admin/operacional/frota e a aba do Portal do Colaborador.
-- ============================================================================

-- 1. Permissão de dirigir no cadastro do funcionário (RH)
alter table folha_funcionarios
  add column if not exists pode_dirigir boolean not null default false;

-- 2. Cabeçalho do checklist (um registro por uso do veículo: aberto na saída,
--    fechado no retorno)
create table if not exists frota_checklists (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  veiculo_id uuid not null references frota_veiculos(id),
  motorista_nome text not null,
  origem text not null default 'PORTAL' check (origem in ('ADMIN', 'PORTAL')),
  status text not null default 'EM_ANDAMENTO' check (status in ('EM_ANDAMENTO', 'FINALIZADO')),
  destino text,
  km_inicial numeric,
  km_final numeric,
  combustivel_saida text,
  combustivel_retorno text,
  observacoes_saida text,
  observacoes_retorno text,
  saida_em timestamptz not null default now(),
  retorno_em timestamptz,
  created_at timestamptz not null default now()
);

-- 3. Itens marcados em cada etapa (saída/retorno), copiados do modelo abaixo
--    no momento de abrir/fechar o checklist
create table if not exists frota_checklist_itens (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references frota_checklists(id) on delete cascade,
  etapa text not null check (etapa in ('SAIDA', 'RETORNO')),
  ordem integer not null default 0,
  descricao text not null,
  marcado boolean not null default false
);

-- 4. Catálogo dos itens fixos do checklist (editável só via SQL por enquanto —
--    não há tela de administração deste catálogo nesta primeira versão)
create table if not exists frota_checklist_modelo_itens (
  id uuid primary key default gen_random_uuid(),
  etapa text not null check (etapa in ('SAIDA', 'RETORNO')),
  ordem integer not null default 0,
  descricao text not null,
  ativo boolean not null default true
);

-- Guardado por "tabela vazia" (não há unique constraint pra usar ON CONFLICT) —
-- seguro rodar o script mais de uma vez, não duplica o catálogo.
insert into frota_checklist_modelo_itens (etapa, ordem, descricao)
select * from (values
  ('SAIDA', 1, 'Cartão de abastecimento / pedágio'),
  ('SAIDA', 2, 'Inspecionar avarias (volta no veículo)'),
  ('SAIDA', 3, 'Amarração e segurança da carga'),
  ('SAIDA', 4, 'Ordem de Serviço (O.S.) em mãos'),
  ('SAIDA', 5, 'Verificar rodízio de placa do dia'),
  ('SAIDA', 6, 'Estepe calibrado e ferramentas'),
  ('SAIDA', 7, 'Cabine limpa'),
  ('RETORNO', 1, 'Devolução do cartão'),
  ('RETORNO', 2, 'Devolução da Nota Fiscal (N.F.)'),
  ('RETORNO', 3, 'Devolução da Ordem de Serviço'),
  ('RETORNO', 4, 'Verificar novas avarias no retorno'),
  ('RETORNO', 5, 'Estepe inspecionado'),
  ('RETORNO', 6, 'Cabine limpa')
) as seed(etapa, ordem, descricao)
where not exists (select 1 from frota_checklist_modelo_itens);

-- 5. Avarias reportadas (texto + foto opcional), em qualquer uma das etapas
create table if not exists frota_checklist_avarias (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references frota_checklists(id) on delete cascade,
  etapa text not null check (etapa in ('SAIDA', 'RETORNO')),
  descricao text not null,
  foto_path text,
  foto_url text,
  created_at timestamptz not null default now()
);

-- 6. RLS — o grid do admin lê frota_checklists/itens/avarias direto pelo client
--    autenticado (mesmo padrão de frota_manutencoes); as gravações do Portal
--    sempre passam pela service role (Server Actions), que ignora RLS.
alter table frota_checklists enable row level security;
alter table frota_checklist_itens enable row level security;
alter table frota_checklist_avarias enable row level security;
alter table frota_checklist_modelo_itens enable row level security;

create policy "authenticated_select_frota_checklists" on frota_checklists
  for select to authenticated using (true);
create policy "authenticated_select_frota_checklist_itens" on frota_checklist_itens
  for select to authenticated using (true);
create policy "authenticated_select_frota_checklist_avarias" on frota_checklist_avarias
  for select to authenticated using (true);
-- frota_checklist_modelo_itens não precisa de policy: só a service role (Portal) lê.
