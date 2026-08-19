"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { normalizarPermissao, ehAltaGestaoOP } from '../../lib/permissoes';

// Hook compartilhado pelas páginas do módulo de OP (nova/responsavel/financeiro).
// Antes, cada página tinha sua própria cópia do bloco "buscar sessão → buscar
// perfil → buscar permissão da rota → comparar" — e a página "responsavel"
// chegava a repeti-lo duas vezes em efeitos separados, disparando a mesma
// consulta ao Supabase mais de uma vez. Este hook centraliza essa lógica numa
// única fonte, buscando perfil e permissão da rota em paralelo.
export interface PerfilAcesso {
  id: string;
  nome: string;
  email: string;
  permissaoBruta: string;
  permissaoNormalizada: string;
  altaGestao: boolean;
  accessToken: string;
  userMetadata: Record<string, any>;
}

interface AcessoRota {
  authLoading: boolean;
  acessoNegado: boolean;
  perfil: PerfilAcesso | null;
}

export function useAcessoRota(rota: string): AcessoRota {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [perfil, setPerfil] = useState<PerfilAcesso | null>(null);

  useEffect(() => {
    let ativo = true;

    async function checarAcesso() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const [perfilRes, rotaRes] = await Promise.all([
        supabase.from('perfis_usuarios').select('*').eq('id', session.user.id).single(),
        supabase.from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', rota).single(),
      ]);

      if (!ativo) return;

      if (perfilRes.error || !perfilRes.data) {
        console.error("Erro crítico ao buscar perfil do usuário:", perfilRes.error);
        router.push('/login');
        return;
      }

      if (rotaRes.error && rotaRes.error.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaRes.error);
      }

      const perfilDb = perfilRes.data;
      const permissaoBruta = perfilDb.permissao || perfilDb.nivel || '';
      const permissaoNormalizada = normalizarPermissao(permissaoBruta);
      const permissoesLiberadas: string[] = rotaRes.data?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      setPerfil({
        id: session.user.id,
        nome: perfilDb.nome || '',
        email: perfilDb.email || session.user.email || '',
        permissaoBruta,
        permissaoNormalizada,
        altaGestao: ehAltaGestaoOP(permissaoBruta),
        accessToken: session.access_token,
        userMetadata: session.user.user_metadata ?? {},
      });
      setAuthLoading(false);
    }

    checarAcesso();
    return () => { ativo = false; };
  }, [rota, router]);

  return { authLoading, acessoNegado, perfil };
}
