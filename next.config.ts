import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Versão do build, pra suporte conseguir saber se o navegador do usuário está
// com a última versão do sistema aberta (ver VersaoSistema.tsx) — usa o SHA
// curto do commit. Na Vercel, VERCEL_GIT_COMMIT_SHA já vem pronto; local
// (build ou dev) cai pro git direto.
function resolverVersaoBuild(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: resolverVersaoBuild(),
    NEXT_PUBLIC_APP_BUILT_AT: new Date().toISOString(),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb'
    }
  },
  // Teste local do app mobile: a WebView acessa o dev server pelo IP da rede
  // (192.168.x.x), não localhost. Sem isso, o Next 16 bloqueia recursos de
  // dev (HMR e possivelmente mais) pra essa origem, e o JS da página nunca
  // termina de rodar — sintoma: WebView presa em "Entrando...", nada
  // acontece. Só entra em efeito com o dev server reiniciado.
  allowedDevOrigins: ['192.168.15.40'],
};

export default nextConfig;
