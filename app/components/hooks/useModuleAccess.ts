"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { normalizarPermissao } from '../../lib/permissoes';
import type { ModuloCard } from '../ui/ModuleGrid';

export interface PerfilUsuario {
  nome: string;
  email: string;
  permissao: string;
  permissaoNormalizada?: string;
}

export function useModuleAccess(modulos: ModuloCard[]) {
  const router = useRouter();
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [mapaPermissoes, setMapaPermissoes] = useState<Record<string, string[]>>({});
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    const carregarAcesso = async () => {
      setLoading(true);
      setErro(null);

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      setAccessToken(session.access_token);

      const [perfilRes, permissoesRes] = await Promise.all([
        supabase.from('perfis_usuarios').select('nome, email, permissao').eq('id', session.user.id).single(),
        supabase.from('folha_paginas_permissoes').select('endereco_route, permissoes_permitidas')
          .in('endereco_route', modulos.map(m => m.link))
      ]);

      if (permissoesRes.error) {
        console.error("Erro ao buscar permissões das rotas:", permissoesRes.error);
        setErro('Não foi possível carregar suas permissões. Verifique sua conexão e tente novamente.');
        setLoading(false);
        return;
      }
      const mapa: Record<string, string[]> = {};
      (permissoesRes.data || []).forEach(r => { mapa[r.endereco_route] = r.permissoes_permitidas || []; });
      setMapaPermissoes(mapa);

      if (perfilRes.error) {
        console.error("Erro ao buscar perfil do usuário:", perfilRes.error);
        setErro('Não foi possível carregar seu perfil. Verifique sua conexão e tente novamente.');
        setLoading(false);
        return;
      }

      if (perfilRes.data) {
        setPerfil({
          ...perfilRes.data,
          permissaoNormalizada: normalizarPermissao(perfilRes.data.permissao)
        });
      } else {
        console.error("Perfil não encontrado no banco de dados.");
      }
      setLoading(false);
    };

    carregarAcesso();
    // `modulos` é uma constante de módulo em cada página-hub (referência estável
    // entre renders) — não entra nas deps pra não recriar o efeito à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tentativa]);

  const modulosAutorizados = perfil
    ? modulos.filter(m => (mapaPermissoes[m.link] || []).includes(perfil.permissaoNormalizada!))
    : [];

  const tentarNovamente = () => setTentativa(t => t + 1);

  return { perfil, loading, modulosAutorizados, accessToken, erro, tentarNovamente };
}
