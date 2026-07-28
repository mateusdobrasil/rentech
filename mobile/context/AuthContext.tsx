import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { normalizarPermissao } from '../lib/permissoes';

export interface PerfilUsuario {
  nome: string;
  email: string;
  permissaoBruta: string;
  permissaoNormalizada: string;
}

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  perfil: PerfilUsuario | null;
  signIn: (email: string, senha: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Busca o registro em perfis_usuarios correspondente à sessão — mesma tabela
// e mesmas colunas (permissao/nivel) que o web usa em useAcessoRota.ts.
async function buscarPerfil(userId: string, emailFallback: string): Promise<PerfilUsuario | null> {
  const { data, error } = await supabase
    .from('perfis_usuarios')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  const permissaoBruta = data.permissao || data.nivel || '';
  return {
    nome: data.nome || '',
    email: data.email || emailFallback,
    permissaoBruta,
    permissaoNormalizada: normalizarPermissao(permissaoBruta),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);

  useEffect(() => {
    let ativo = true;

    async function carregar(sessaoAtual: Session | null) {
      if (!ativo) return;
      setSession(sessaoAtual);

      if (!sessaoAtual) {
        setPerfil(null);
        setLoading(false);
        return;
      }

      const perfilCarregado = await buscarPerfil(sessaoAtual.user.id, sessaoAtual.user.email ?? '');
      if (!ativo) return;
      setPerfil(perfilCarregado);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data: { session } }) => carregar(session));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, sessaoAtual) => {
      carregar(sessaoAtual);
    });

    return () => {
      ativo = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, senha: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ loading, session, perfil, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
