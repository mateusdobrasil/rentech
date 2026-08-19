// Motor de normalização de permissões — usado tanto no cliente (para exibir/ocultar
// módulos) quanto no servidor (para validar Server Actions). Mantenha uma única fonte
// de verdade aqui: qualquer mudança nas regras precisa valer nos dois lados.
export const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();

  // 1. ADMINISTRATIVO deve vir ANTES de ADMIN para evitar a colisão de texto
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';

  // 2. ALTA GESTÃO — Diretoria e Gerência são categorias PRÓPRIAS pra fins de
  // acesso de rota (cada uma controlável por página em Parâmetros →
  // Permissões → Páginas), não mais o mesmo balde de "Administrador".
  // Diretorias/gerências diferentes tocam empresas diferentes, e nem toda
  // página de administrador é pra elas verem (ex.: /admin/academy).
  if (p.includes('DIR')) return 'DIRETORIA';
  if (p.includes('GEREN')) return 'GERENCIA';
  if (p.includes('ADMIN')) return 'ADMINISTRADOR';

  // 3. DEMAIS DEPARTAMENTOS
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  if (p.includes('GESTOR')) return 'GESTORES';

  // PADRÃO
  return 'USUARIO';
};

// Cargos que têm visão total sobre as OPs (não apenas as próprias) dentro do
// módulo de Ordem de Pagamento.
//
// Antes esta função comparava o valor BRUTO de perfis_usuarios.permissao contra
// uma lista fechada ('DIR', 'DIRETOR', 'ADMINISTRADOR', 'ADMIN', 'FINANCEIRO').
// Isso cria dois sistemas de classificação de cargo divergentes: o acesso à
// ROTA usa normalizarPermissao() (fuzzy, via .includes()), enquanto esta
// checagem exigia igualdade EXATA com o texto bruto. Um usuário cujo cargo no
// banco seja, por exemplo, "Administrador Geral" ou "Admin Master" passa na
// checagem de rota (normaliza para ADMINISTRADOR) mas falhava aqui — via
// "Minhas OPs" e aparentava não ter nenhuma OP, mesmo sendo administrador.
// Reaproveitar normalizarPermissao() garante que as duas checagens concordem.
export const ehAltaGestaoOP = (permissaoBruta: string): boolean => {
  const normalizada = normalizarPermissao(permissaoBruta);
  // Diretoria/Gerência aqui listadas explicitamente pra preservar o
  // comportamento de antes da separação de DIRETORIA/GERENCIA do balde
  // ADMINISTRADOR (ver normalizarPermissao acima) — este módulo (Ordem de
  // Pagamento) não faz parte do pedido de restringir Diretoria por página.
  return normalizada === 'ADMINISTRADOR' || normalizada === 'DIRETORIA' || normalizada === 'GERENCIA' || normalizada === 'FINANCEIRO';
};

// Só quem é literalmente "Administrador" enxerga dados de TODAS as empresas
// sem restrição — Diretoria e Gerência (categorias próprias desde a
// separação em normalizarPermissao acima) ficam escopadas por
// perfis_usuarios_empresas igual a qualquer outro usuário, porque diretorias
// diferentes cuidam de empresas diferentes (Rentech e AlfaLight têm
// diretorias próprias). Independente de normalizarPermissao — checagem
// própria no texto bruto, pra não depender do balde de rota.
export const ehAdministradorGlobal = (permissaoBruta: string): boolean => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return false;
  if (p.includes('DIR') || p.includes('GEREN')) return false;
  return p.includes('ADMIN');
};
