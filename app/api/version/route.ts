import { NextResponse } from 'next/server';

// Chamada pelo VersaoSistema.tsx (polling em segundo plano) pra comparar com
// a versão já carregada no navegador do usuário. Precisa rodar sem cache: uma
// função serverless nova é publicada a cada deploy (Vercel troca a função
// inteira, atomicamente), então esta rota sempre responde com a versão do
// deploy ATIVO no momento — mesmo que a aba aberta esteja com um bundle
// antigo em cache.
export async function GET() {
  return NextResponse.json(
    {
      version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
      builtAt: process.env.NEXT_PUBLIC_APP_BUILT_AT || null,
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  );
}
