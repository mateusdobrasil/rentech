// app/lib/camposFichaExport.ts
// Campos da Ficha do Funcionário que podem ir para o Excel (botão "Exportar
// Excel" em /admin/rh/funcionario). Um catálogo só, usado pela tela (caixas de
// seleção, com os mesmos nomes do formulário) e pelo servidor (que só aceita
// colunas daqui — nada de nome de coluna vindo livre do navegador).
//
// Salário, benefícios e adiantamento não estão aqui de propósito: não são da
// ficha (ficam no Holerite) e o valor é restrito a quem acessa o Financeiro.

export type TipoCampoFicha = 'texto' | 'data' | 'simnao' | 'cpf' | 'celular' | 'empresa' | 'situacao';

export interface CampoFicha { coluna: string; rotulo: string; tipo?: TipoCampoFicha }
export interface GrupoCamposFicha { id: string; titulo: string; campos: CampoFicha[]; padrao?: boolean }

export const GRUPOS_CAMPOS_FICHA: GrupoCamposFicha[] = [
  {
    id: 'identificacao', titulo: 'Identificação e contrato', padrao: true, campos: [
      { coluna: 'cpf', rotulo: 'CPF', tipo: 'cpf' },
      { coluna: 'empresa_id', rotulo: 'Empresa', tipo: 'empresa' },
      { coluna: 'cargo', rotulo: 'Cargo' },
      { coluna: 'departamento', rotulo: 'Departamento' },
      { coluna: 'tipo_contrato', rotulo: 'Tipo de Regra de Contrato' },
      { coluna: 'data_admissao', rotulo: 'Data de Admissão', tipo: 'data' },
      { coluna: 'data_desligamento', rotulo: 'Data de Desligamento', tipo: 'data' },
      { coluna: 'ativo', rotulo: 'Situação', tipo: 'situacao' },
    ],
  },
  {
    id: 'pessoais', titulo: 'Dados pessoais', campos: [
      { coluna: 'data_nascimento', rotulo: 'Data de Nascimento', tipo: 'data' },
      { coluna: 'genero', rotulo: 'Gênero' },
      { coluna: 'estado_civil', rotulo: 'Estado Civil' },
      { coluna: 'etnia', rotulo: 'Etnia' },
      { coluna: 'escolaridade', rotulo: 'Escolaridade' },
      { coluna: 'nome_mae', rotulo: 'Nome da Mãe' },
      { coluna: 'nome_pai', rotulo: 'Nome do Pai' },
      { coluna: 'pais_nascimento', rotulo: 'País de Nascimento' },
      { coluna: 'cidade_nascimento', rotulo: 'Cidade de Nascimento' },
      { coluna: 'aposentado', rotulo: 'É aposentado?', tipo: 'simnao' },
    ],
  },
  {
    id: 'contato', titulo: 'Contato e endereço', padrao: true, campos: [
      { coluna: 'celular', rotulo: 'Celular (WhatsApp)', tipo: 'celular' },
      { coluna: 'email', rotulo: 'E-mail' },
      { coluna: 'telefone_alternativo', rotulo: 'Telefone Alternativo', tipo: 'celular' },
      { coluna: 'email_alternativo', rotulo: 'E-mail Alternativo' },
      { coluna: 'cep', rotulo: 'CEP' },
      { coluna: 'endereco', rotulo: 'Endereço' },
      { coluna: 'numero', rotulo: 'Número' },
      { coluna: 'complemento', rotulo: 'Complemento' },
      { coluna: 'bairro', rotulo: 'Bairro' },
      { coluna: 'cidade', rotulo: 'Cidade' },
    ],
  },
  {
    id: 'registro', titulo: 'Definições de registro', campos: [
      { coluna: 'pis', rotulo: 'PIS' },
      { coluna: 'matricula_esocial', rotulo: 'Matrícula eSocial' },
      { coluna: 'recebe_fechamento', rotulo: 'Recebe fechamento (nossa folha)', tipo: 'simnao' },
      { coluna: 'recebe_holerite', rotulo: 'Recebe holerite (contabilidade)', tipo: 'simnao' },
      { coluna: 'ponto_whatsapp_ativo', rotulo: 'Bate ponto pelo WhatsApp', tipo: 'simnao' },
    ],
  },
  {
    id: 'bancarios', titulo: 'Dados bancários', campos: [
      { coluna: 'pix_tipo', rotulo: 'Tipo da chave PIX' },
      { coluna: 'pix_chave', rotulo: 'Chave PIX' },
      { coluna: 'banco_codigo', rotulo: 'Banco (código)' },
      { coluna: 'banco_agencia', rotulo: 'Agência' },
      { coluna: 'banco_conta', rotulo: 'Conta' },
      { coluna: 'banco_tipo', rotulo: 'Tipo de conta' },
    ],
  },
  {
    id: 'cnh', titulo: 'Frota e CNH', campos: [
      { coluna: 'pode_dirigir', rotulo: 'Pode dirigir veículos da frota', tipo: 'simnao' },
      { coluna: 'cnh_numero', rotulo: 'CNH — Nº de registro' },
      { coluna: 'cnh_categoria', rotulo: 'CNH — Categoria' },
      { coluna: 'cnh_validade', rotulo: 'CNH — Validade', tipo: 'data' },
    ],
  },
  {
    id: 'especiais', titulo: 'Informações especiais', campos: [
      { coluna: 'deficiencia_fisica', rotulo: 'Deficiência física', tipo: 'simnao' },
      { coluna: 'deficiencia_mental', rotulo: 'Deficiência mental', tipo: 'simnao' },
      { coluna: 'deficiencia_auditiva', rotulo: 'Deficiência auditiva', tipo: 'simnao' },
      { coluna: 'deficiencia_intelectual', rotulo: 'Deficiência intelectual', tipo: 'simnao' },
      { coluna: 'deficiencia_visual', rotulo: 'Deficiência visual', tipo: 'simnao' },
      { coluna: 'reabilitado_readaptado', rotulo: 'Reabilitado / readaptado', tipo: 'simnao' },
      { coluna: 'notas_especiais', rotulo: 'Notas' },
    ],
  },
  {
    id: 'estrangeiro', titulo: 'Trabalhador estrangeiro', campos: [
      { coluna: 'estrangeiro', rotulo: 'É estrangeiro?', tipo: 'simnao' },
      { coluna: 'casado_com_brasileiro', rotulo: 'É casado com brasileiro(a)?', tipo: 'simnao' },
      { coluna: 'filhos_brasileiros', rotulo: 'Tem filhos brasileiros?', tipo: 'simnao' },
      { coluna: 'data_chegada_estrangeiro', rotulo: 'Data de Chegada', tipo: 'data' },
      { coluna: 'tipo_visto_estrangeiro', rotulo: 'Tipo de Visto' },
      { coluna: 'pais_estrangeiro', rotulo: 'País (endereço no exterior)' },
      { coluna: 'cidade_estrangeiro', rotulo: 'Cidade (exterior)' },
      { coluna: 'endereco_estrangeiro', rotulo: 'Endereço (exterior)' },
      { coluna: 'numero_estrangeiro', rotulo: 'Número (exterior)' },
      { coluna: 'complemento_estrangeiro', rotulo: 'Complemento (exterior)' },
      { coluna: 'bairro_estrangeiro', rotulo: 'Bairro (exterior)' },
      { coluna: 'cep_estrangeiro', rotulo: 'CEP (exterior)' },
    ],
  },
];

export const CAMPOS_FICHA: CampoFicha[] = GRUPOS_CAMPOS_FICHA.flatMap(g => g.campos);
export const COLUNAS_FICHA_PERMITIDAS = new Set(CAMPOS_FICHA.map(c => c.coluna));
