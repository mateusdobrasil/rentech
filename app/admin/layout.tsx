"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../lib/supabase';
import ExigirMFA from './ExigirMFA';
import { NotificationProvider } from '../components/ui/NotificationProvider';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);
  // Exigência de 2FA por rota (folha_paginas_permissoes.requer_2fa, editável
  // em /admin/parametros/permissoes → aba "Permissão 2FA"). Fica centralizado
  // aqui no layout para valer automaticamente em toda página nova do admin,
  // sem precisar instrumentar cada page.tsx individualmente.
  const [requerMfa, setRequerMfa] = useState(true); // seguro por padrão até a consulta resolver
  const [mfaCarregado, setMfaCarregado] = useState(false);

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

  // Roda de novo a cada troca de rota (o layout fica montado entre navegações
  // dentro do /admin) para saber se a página atual exige 2FA.
  useEffect(() => {
    if (!isAuthorized) return;
    let ativo = true;
    setMfaCarregado(false);

    async function checarMfaRota() {
      // /admin/conta é onde o 2FA é ativado/desativado — nunca pode exigir
      // 2FA para entrar, senão quem ainda não cadastrou o fator fica sem
      // como chegar lá (mesmo que alguém marque essa rota por engano na
      // aba "Permissão 2FA").
      if (pathname === '/admin/conta') {
        if (ativo) { setRequerMfa(false); setMfaCarregado(true); }
        return;
      }

      const { data, error } = await supabase
        .from('folha_paginas_permissoes')
        .select('requer_2fa')
        .eq('endereco_route', pathname)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error("Erro ao buscar exigência de 2FA da rota:", error);
      }
      if (!ativo) return;
      setRequerMfa(data?.requer_2fa ?? false);
      setMfaCarregado(true);
    }

    checarMfaRota();
    return () => { ativo = false; };
  }, [isAuthorized, pathname]);

  if (!isAuthorized || !mfaCarregado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return (
    <NotificationProvider>
      <ExigirMFA ativo={requerMfa}>{children}</ExigirMFA>
    </NotificationProvider>
  );
}