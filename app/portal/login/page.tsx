"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../lib/supabase';
import { formatarCpf, somenteDigitos, emailSinteticoPortal } from '../lib/cpf';

export default function PortalLoginPage() {
  const router = useRouter();
  const [cpf, setCpf] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const entrar = async () => {
    setErro(''); setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: emailSinteticoPortal(cpf),
      password: senha,
    });
    setCarregando(false);
    if (error) { setErro('CPF ou senha incorretos.'); return; }
    router.push('/portal');
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex items-center justify-center p-4">
      <Analytics />
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 border border-[#E2E8F0]">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">👤</div>
          <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider">Portal do Funcionário</h1>
          <p className="text-xs text-[#64748B] font-medium mt-1">Entrar</p>
        </div>

        {erro && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-4 py-3 rounded-lg">{erro}</div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">CPF</label>
            <input
              type="text"
              placeholder="000.000.000-00"
              className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none"
              value={formatarCpf(cpf)}
              onChange={(e) => setCpf(somenteDigitos(e.target.value).slice(0, 11))}
              maxLength={14}
              onKeyDown={(e) => { if (e.key === 'Enter') entrar(); }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Senha</label>
            <input
              type="password"
              className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') entrar(); }}
            />
          </div>
          <button
            onClick={entrar}
            disabled={carregando || somenteDigitos(cpf).length !== 11 || !senha}
            className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3.5 rounded-xl shadow-lg transition-colors disabled:opacity-40"
          >
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
          <button onClick={() => router.push('/portal/acesso')} className="w-full text-[#336699] font-bold text-xs py-2">
            Ainda não tenho acesso — solicitar
          </button>
        </div>
      </div>
    </div>
  );
}
