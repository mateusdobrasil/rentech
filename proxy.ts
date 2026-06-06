// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
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
  matcher: ['/admin/op/:path*'],
};