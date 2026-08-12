"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { normalizarPermissao } from '../../lib/permissoes';

interface UsePageAccessOptions {
  /** Nome exibido quando o perfil não tem `nome` preenchido. Default: 'Usuário'. */
  nomeFallback?: string;
  /** Rota usada para consultar `folha_paginas_permissoes`. Default: a rota atual (usePathname()) — só precisa ser passado em rotas dinâmicas (ex.: `/admin/x/[id]`). */
  rota?: string;
  /** Executado (e aguardado) depois que o acesso é liberado, antes de soltar `authLoading`. Só necessário quando a página precisa garantir que outro carregamento termine antes de renderizar (ver rh/holerite). */
  aoAutorizar?: () => unknown;
}

export function usePageAccess(options: UsePageAccessOptions = {}) {
  const { nomeFallback = 'Usuário', rota, aoAutorizar } = options;
  const router = useRouter();
  const pathname = usePathname();
  const rotaEfetiva = rota || pathname;

  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [emailUsuario, setEmailUsuario] = useState('');
  const [permissaoNormalizada, setPermissaoNormalizada] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    async function checkAuth() {
      setAuthLoading(true);
      setErro(null);
      setAcessoNegado(false);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();

      if (perfilError) {
        console.error("Erro ao buscar perfil do usuário:", perfilError);
        setErro('Não foi possível carregar seu perfil. Verifique sua conexão e tente novamente.');
        setAuthLoading(false);
        return;
      }
      if (!perfil) {
        console.error("Perfil não encontrado no banco de dados.");
        router.push('/login');
        return;
      }

      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', rotaEfetiva).single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
        setErro('Não foi possível verificar sua permissão de acesso. Verifique sua conexão e tente novamente.');
        setAuthLoading(false);
        return;
      }

      const pn = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(pn)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      setUsuarioAtual(perfil.nome || nomeFallback);
      setEmailUsuario(perfil.email || session.user.email || '');
      setPermissaoNormalizada(pn);
      setAccessToken(session.access_token);

      if (aoAutorizar) await aoAutorizar();
      setAuthLoading(false);
    }

    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, rotaEfetiva, tentativa]);

  const tentarNovamente = () => setTentativa(t => t + 1);

  return { usuarioAtual, emailUsuario, permissaoNormalizada, accessToken, authLoading, acessoNegado, erro, tentarNovamente };
}
