// Motor de normalização de permissões — usado tanto no cliente (para exibir/ocultar
// módulos) quanto no servidor (para validar Server Actions). Mantenha uma única fonte
// de verdade aqui: qualquer mudança nas regras precisa valer nos dois lados.
export const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();

  // 1. ADMINISTRATIVO deve vir ANTES de ADMIN para evitar a colisão de texto
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';

  // 2. ALTA GESTÃO (Acesso Total)
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';

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
  return normalizada === 'ADMINISTRADOR' || normalizada === 'FINANCEIRO';
};
