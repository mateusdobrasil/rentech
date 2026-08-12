-- Rescisão de Funcionário (HUB RH). tipo_folha é resolvido via
-- resolverFontesPagamento (Ficha → Cargo → Contrato) e CONGELADO no momento
-- da criação — mudanças posteriores na regra de contrato não alteram uma
-- rescisão já aberta.
-- PROPRIO: dados_calculo (jsonb) guarda o detalhamento editável do cálculo.
-- CONTABILIDADE: nenhum valor é calculado; só o anexo do TRCT em storage_path.
--
-- ATENÇÃO: valores em dados_calculo são ESTIMATIVAS por regras gerais da CLT
-- (ver app/lib/calculoRescisao.ts). Conferir com a contabilidade antes de
-- homologar — não é fonte legal autoritativa.
create table if not exists folha_rescisoes (
  id bigserial primary key,

  funcionario_nome text not null,
  empresa_id bigint,
  cargo text,
  departamento text,
  data_admissao date,

  data_desligamento date not null,
  motivo text not null check (motivo in (
    'SEM_JUSTA_CAUSA', 'PEDIDO_DEMISSAO', 'JUSTA_CAUSA',
    'ACORDO_MUTUO', 'TERMINO_CONTRATO_EXPERIENCIA', 'APOSENTADORIA'
  )),
  tipo_aviso_previo text check (tipo_aviso_previo in ('INDENIZADO', 'TRABALHADO', 'ISENTO')),
  dias_aviso_previo integer,

  -- snapshot congelado de resolverFontesPagamento() no momento da criação
  tipo_folha text not null check (tipo_folha in ('PROPRIO', 'CONTABILIDADE')),

  status text not null default 'RASCUNHO' check (status in (
    'RASCUNHO', 'EM_CALCULO', 'AGUARDANDO_DOCUMENTO',
    'AGUARDANDO_HOMOLOGACAO', 'HOMOLOGADA', 'CANCELADA'
  )),

  -- FGTS: saldo digitado manualmente pelo RH (extrato/contabilidade) — o
  -- sistema NÃO tenta reconstruir o histórico de depósitos.
  saldo_fgts_informado numeric(12,2),
  fgts_percentual_multa numeric(5,2),
  fgts_valor_multa numeric(12,2),

  -- Caso PROPRIO: detalhamento completo do cálculo (ver formato em
  -- app/lib/calculoRescisao.ts). Caso CONTABILIDADE: fica null.
  dados_calculo jsonb,
  valor_total_liquido numeric(12,2),

  -- TRCT: PDF fornecido pela contabilidade (caso CONTABILIDADE) ou
  -- anexado após conferência (caso PROPRIO). Bucket documentos-funcionarios,
  -- mesmo padrão de path usado em actions-afastamentos.ts.
  storage_path text,
  nome_arquivo text,

  observacoes text,

  homologado_em timestamptz,
  homologado_por text,
  criado_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists folha_rescisoes_funcionario_idx on folha_rescisoes (funcionario_nome);
create index if not exists folha_rescisoes_status_idx on folha_rescisoes (status);

alter table folha_rescisoes disable row level security;

-- Libera a página /admin/rh/rescisao para os mesmos setores que já mexem em
-- valores financeiros sensíveis do funcionário. Ajustar em
-- /admin/parametros/permissoes (aba "Páginas") se precisar de outro recorte.
insert into folha_paginas_permissoes (nome_pagina, endereco_route, permissoes_permitidas)
values ('RESCISÃO DE FUNCIONÁRIO', '/admin/rh/rescisao', array['ADMINISTRADOR','FINANCEIRO','ADMINISTRATIVO'])
on conflict do nothing;
