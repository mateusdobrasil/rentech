-- ============================================================================
-- Ficha Completa do Funcionário — colunas novas + tabelas de listas
-- Rodar no SQL Editor do Supabase.
-- ============================================================================

-- 1) Definições de registro
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS pis text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS matricula_esocial text;

-- 2) Dados pessoais
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS aposentado boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS pais_nascimento text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS cidade_nascimento text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS estado_civil text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS genero text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS nome_mae text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS nome_pai text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS etnia text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS escolaridade text;

-- 3) Contato e endereço
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS telefone_alternativo text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS email_alternativo text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS cep text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS cidade text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS endereco text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS numero text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS complemento text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS bairro text;

-- 4) Informações especiais
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS deficiencia_fisica boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS deficiencia_mental boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS deficiencia_auditiva boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS deficiencia_intelectual boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS deficiencia_visual boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS reabilitado_readaptado boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS notas_especiais text;

-- 5) Trabalhador estrangeiro
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS estrangeiro boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS casado_com_brasileiro boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS filhos_brasileiros boolean;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS data_chegada_estrangeiro date;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS tipo_visto_estrangeiro text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS cep_estrangeiro text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS pais_estrangeiro text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS cidade_estrangeiro text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS endereco_estrangeiro text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS numero_estrangeiro text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS complemento_estrangeiro text;
ALTER TABLE folha_funcionarios ADD COLUMN IF NOT EXISTS bairro_estrangeiro text;

-- 6) Dependentes (lista repetível por funcionário)
-- Sem FK para folha_funcionarios: segue o mesmo padrão de folha_descontos/folha_bonus,
-- que também vinculam por texto (funcionario_nome) sem constraint de chave estrangeira.
CREATE TABLE IF NOT EXISTS folha_dependentes (
  id bigint generated always as identity primary key,
  funcionario_nome text NOT NULL,
  tipo_dependente text,
  nome_completo text,
  cpf text,
  data_nascimento date,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_folha_dependentes_funcionario ON folha_dependentes(funcionario_nome);

-- 7) Histórico de movimentação (Admissão / Alteração de Cargo / Demissão)
CREATE TABLE IF NOT EXISTS folha_movimentacoes (
  id bigint generated always as identity primary key,
  funcionario_nome text NOT NULL,
  motivo text,
  cargo text,
  data_movimentacao date,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_folha_movimentacoes_funcionario ON folha_movimentacoes(funcionario_nome);
