import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Trava de segurança para avisar se esquecermos de configurar o .env
if (!supabaseUrl || !supabaseKey) {
  throw new Error('⚠️ Faltam as credenciais do Supabase! Verifique o seu arquivo .env.local.');
}

// Inicializa e exporta o cliente para ser usado em qualquer lugar do ecossistema
export const supabase = createClient(supabaseUrl, supabaseKey);