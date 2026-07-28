// Tipos compartilhados entre web/ e mobile/.
//
// `Database` deve vir do Supabase CLI (`npm run gen -w @rentech/types`, depois
// de configurar SEU_PROJECT_REF no script `gen` do package.json). Até lá, fica
// como `any` para não travar o build dos outros workspaces.
export type Database = any;

export type PermissaoNormalizada =
  | 'ADMINISTRADOR'
  | 'ADMINISTRATIVO'
  | 'FINANCEIRO'
  | 'OPERACIONAL'
  | 'ESTOQUE'
  | 'EDITOR'
  | 'USUARIO';

export interface PerfilUsuario {
  id: string;
  nome: string;
  email: string;
  permissao: string;
}
