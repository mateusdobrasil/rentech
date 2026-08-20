// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Subdomínio próprio da AlfaLight apontando pro mesmo deploy: white-label
// sem trocar a URL visível (fica portal.alfalight.com.br/login, nunca
// aparece o ?empresa=alfalight nem o domínio rentech.tech).
const ALFALIGHT_HOST = 'portal.alfalight.com.br';

export function proxy(request: NextRequest) {
  if (
    request.nextUrl.hostname === ALFALIGHT_HOST &&
    request.nextUrl.pathname === '/login' &&
    !request.nextUrl.searchParams.has('empresa')
  ) {
    const url = request.nextUrl.clone();
    url.searchParams.set('empresa', 'alfalight');
    return NextResponse.rewrite(url);
  }

  // Pega o token de sessão do Supabase (o nome padrão começa com 'sb-')
  const session = request.cookies.get('sb-access-token');

  // Se o usuário tentar acessar qualquer rota dentro de /admin/op...
  if (request.nextUrl.pathname.startsWith('/admin/op')) {
    // E não estiver logado, redireciona para a página de login
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

// Configuração para rodar em todas as rotas admin
export const config = {
  matcher: ['/admin/op/:path*', '/login'],
};