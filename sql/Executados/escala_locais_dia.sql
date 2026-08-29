-- Escala de Trabalho: contexto do local NAQUELE DIA — separado do catálogo
-- reutilizável (escala_locais, sem data) e das alocações individuais
-- (escala_alocacoes, uma por colaborador). Um mesmo local físico (ex:
-- "Anhembi") hospeda eventos diferentes em datas diferentes, então
-- evento/tipo/responsável não podem viver no catálogo — e precisam existir
-- mesmo antes de qualquer colaborador ser arrastado pra lá (por isso não são
-- colunas em escala_alocacoes).
--
-- horario_padrao: exibido ao lado do nome do local na tela; ao ser alterado,
-- o código (salvarContextoLocalAction, em actions-escala.ts) propaga pra
-- todos os colaboradores já alocados nesse local naquele dia — exceções
-- pontuais continuam editáveis direto no horário individual de cada card
-- (coluna escala_alocacoes.horario, já existente).
--
-- tipo: natureza da operação (Montagem/Desmontagem/Visita Técnica/
-- Pré-montagem/Devolução) — vale pra todo mundo alocado ali naquele dia, sem
-- exceção por colaborador (diferente do horário).
--
-- Roda uma vez no SQL Editor do Supabase.
create table if not exists escala_locais_dia (
  id uuid primary key default gen_random_uuid(),
  empresa_id int not null references empresas(id),
  data date not null,
  local_id uuid not null references escala_locais(id) on delete cascade,
  horario_padrao time,
  tipo text,
  evento text,
  responsavel text,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, data, local_id)
);

alter table escala_locais_dia
  add constraint escala_locais_dia_tipo_check
  check (tipo is null or tipo in ('MONTAGEM', 'DESMONTAGEM', 'VISITA_TECNICA', 'PRE_MONTAGEM', 'DEVOLUCAO'));

create index if not exists escala_locais_dia_empresa_data_idx on escala_locais_dia (empresa_id, data);
