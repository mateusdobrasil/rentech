import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Sinaliza se o Supabase está realmente configurado neste ambiente.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

// Aviso amigável no console (não derruba a aplicação).
// Antes lançávamos um erro aqui, o que quebrava TODA a aplicação — inclusive
// a página principal — já que a Navbar importa este módulo.
if (!isSupabaseConfigured && typeof window !== 'undefined') {
  console.warn(
    '[Supabase] Credenciais ausentes. Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY para habilitar autenticação e dados.'
  );
}

// Usa placeholders válidos quando as credenciais não existem, evitando o crash
// na criação do cliente. Chamadas de auth/dados simplesmente falham de forma
// silenciosa até que as variáveis reais sejam configuradas.
export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseKey ?? 'public-anon-key'
);
