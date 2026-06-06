"use client";

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase'; // Importando a conexão real do banco
import logoPB from '../imgs/logo_pb.png'; // Usando a logo monocromática para o fundo escuro

export default function Login() {
  const router = useRouter();
  
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErro('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: senha,
      });

      if (error) {
        throw error;
      }

      // NOVIDADE: Cria o Cookie manualmente para o Middleware conseguir ler!
      if (data.session) {
        document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=86400; SameSite=Lax`;
      }

      // REDIRECIONAMENTO CORRIGIDO: Agora aponta para o Hub Administrativo
      router.push('/admin');
      
    } catch (error: any) {
      console.error("Erro no login:", error);
      if (error.message.includes('Invalid login credentials')) {
        setErro('E-mail ou senha incorretos.');
      } else {
        setErro('Ocorreu um erro ao tentar acessar. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    // Fundo escuro premium com leve gradiente radial
    <div className="min-h-screen bg-[#000000] bg-[radial-gradient(circle_at_center,_rgba(12,29,77,0.4)_0%,_transparent_100%)] flex flex-col items-center justify-center p-4 font-sans">
      
      <div className="w-full max-w-md bg-[#0C1D4D]/20 p-8 md:p-10 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] border border-[#284B8C]/30 backdrop-blur-md transform transition-all">
        
        {/* Cabeçalho */}
        <div className="flex flex-col items-center mb-8">
          <Image 
            src={logoPB} 
            alt="Rentech Locadora" 
            width={180} 
            height={60} 
            priority
            className="mb-6 hover:scale-105 transition-transform duration-500"
          />
          <h1 className="text-xl font-black text-white uppercase tracking-widest">
            Acesso Restrito
          </h1>
          <p className="text-xs text-[#999999] font-bold tracking-wide mt-2">
            Identifique-se para entrar no ecossistema
          </p>
        </div>

        {/* Formulário */}
        <form onSubmit={handleLogin} className="space-y-5">
          
          <div>
            <label className="block text-[10px] font-black text-[#999999] uppercase tracking-widest mb-1.5 pl-1">
              E-mail Corporativo
            </label>
            <input 
              type="email" 
              className="w-full p-3.5 bg-black/50 border border-[#284B8C]/50 rounded-xl text-sm text-white focus:border-[#336699] focus:ring-1 focus:ring-[#336699] outline-none font-medium transition-all"
              placeholder="seu.nome@rentech.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-[#999999] uppercase tracking-widest mb-1.5 pl-1">
              Senha de Acesso
            </label>
            <input 
              type="password" 
              className="w-full p-3.5 bg-black/50 border border-[#284B8C]/50 rounded-xl text-sm text-white focus:border-[#336699] focus:ring-1 focus:ring-[#336699] outline-none font-medium transition-all"
              placeholder="••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>

          {/* Mensagem de Erro */}
          {erro && (
            <div className="bg-red-500/10 border border-red-500/50 p-3 rounded-lg text-center animate-pulse">
              <p className="text-xs text-red-400 font-bold uppercase tracking-wider">{erro}</p>
            </div>
          )}

          {/* Botão Submit */}
          <button 
            type="submit"
            disabled={loading}
            className="w-full mt-4 bg-[#284B8C] text-white font-black uppercase tracking-widest text-sm py-4 rounded-xl hover:bg-[#336699] hover:shadow-[0_0_20px_rgba(51,102,153,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'AUTENTICANDO...' : 'ENTRAR NO SISTEMA'}
          </button>

        </form>

        <div className="mt-8 text-center border-t border-[#284B8C]/30 pt-6">
          <p className="text-[10px] text-[#666666] font-bold uppercase tracking-widest">
            Ecossistema Digital Rentech &copy; {new Date().getFullYear()}
          </p>
        </div>

      </div>
    </div>
  );
}