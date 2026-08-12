"use client";

import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export function HubLoading() {
  return (
    <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-24">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Carregando módulos...</h2>
      </div>
    </div>
  );
}

export function HubErro({ mensagem, onTentarNovamente }: { mensagem: string; onTentarNovamente: () => void }) {
  return (
    <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 pt-24">
      <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Erro ao Carregar</h2>
        <p className="text-[#64748B] text-sm mb-6">{mensagem}</p>
        <button onClick={onTentarNovamente} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors w-full">
          Tentar Novamente
        </button>
      </div>
    </div>
  );
}

export function HubPerfilNaoLocalizado() {
  const router = useRouter();

  const handleSair = async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 pt-24">
      <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-[#BAE6FD]">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Perfil não localizado</h2>
        <p className="text-[#64748B] text-sm mb-6">Sua conta de autenticação existe, mas seu perfil de permissões não foi encontrado no banco de dados. Contate o Administrador.</p>
        <button onClick={handleSair} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors w-full">
          Voltar para Login
        </button>
      </div>
    </div>
  );
}
