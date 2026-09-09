// Versão que ESTE bundle (já carregado no navegador, ou rodando no servidor)
// acredita ser a atual — inlined em tempo de build (ver next.config.ts).
// Usado tanto pelo selo em /admin (page.tsx) quanto pelo polling de
// VersaoSistema.tsx, que compara contra /api/version.
export const VERSAO_APP = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';
