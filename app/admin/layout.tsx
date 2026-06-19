"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    async function checkAuthAndLogAccess() {
      // 1. Verifica se há uma sessão ativa
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // Se não houver, expulsa para o login imediatamente
        router.push('/login');
        return;
      }

      // 2. Regista a data e hora exata do acesso
      const dataHoraAtual = new Date().toISOString();

      // 3. Atualiza silenciosamente no banco de dados
      const { error } = await supabase
        .from('perfis_usuarios')
        .update({ ultimo_acesso: dataHoraAtual })
        .eq('id', session.user.id);

      if (error) {
        console.error("Erro ao registar último acesso no banco:", error.message);
      }

      // 4. Liberta a passagem para o conteúdo da página
      setIsAuthorized(true);
    }

    checkAuthAndLogAccess();
  }, [router]);

  // Enquanto verifica a identidade, mostra um loading suave
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  // Se passou no teste, renderiza a página que o utilizador queria aceder
  return <>{children}</>;
}