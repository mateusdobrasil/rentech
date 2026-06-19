"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    async function checkAuthAndLogAccess() {
      // 1. Verifica a sessão
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      // 2. Busca o nome do usuário para a Auditoria
      const { data: perfil } = await supabase
        .from('perfis_usuarios')
        .select('nome')
        .eq('id', session.user.id)
        .single();

      const nomeUsuario = perfil?.nome || session.user.email || 'Usuário Desconhecido';
      const dataHoraAtual = new Date().toISOString();

      // 3. Atualiza silenciosamente o último acesso no perfil
      await supabase
        .from('perfis_usuarios')
        .update({ ultimo_acesso: dataHoraAtual })
        .eq('id', session.user.id);

      // 4. Grava na Auditoria (Apenas se for o primeiro acesso da sessão atual)
      if (!sessionStorage.getItem('logAcessoRegistrado')) {
        const { error: logError } = await supabase
          .from('logs_auditoria')
          .insert([{
            usuario_nome: nomeUsuario,
            acao: 'ACESSO AO SISTEMA',
            setor: 'HUB PRINCIPAL',
            equipamento_id: null,
            equipamento_nome: null
          }]);

        if (!logError) {
          // Marca no navegador que o log já foi feito para não repetir no F5
          sessionStorage.setItem('logAcessoRegistrado', 'true');
        } else {
          console.error("Erro ao gravar auditoria:", logError.message);
        }
      }

      // 5. Liberta a visualização da página
      setIsAuthorized(true);
    }

    checkAuthAndLogAccess();
  }, [router]);

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return <>{children}</>;
}