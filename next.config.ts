import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
