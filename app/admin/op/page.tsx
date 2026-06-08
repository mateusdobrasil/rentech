"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import logoColorido from '../../../app/imgs/logo.png';
import { Analytics } from "@vercel/analytics/next"

export default function HubOrdensPagamento() {
  const router = useRouter();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [nivelAcesso, setNivelAcesso] = useState<'DIR' | 'USU'>('USU');
  const [authLoading, setAuthLoading] = useState(true);

  // 1. Validar a Sessão e Nível de Acesso
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfil } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (perfil) {
        setUsuarioAtual(perfil.nome || 'Equipe');
        
        const permissaoBanco = String(perfil.permissao || perfil.nivel || '').toUpperCase();
        const cargosAltaGestao = ['DIR', 'DIRETOR', 'ADMINISTRADOR', 'ADMIN', 'FINANCEIRO'];
        
        if (cargosAltaGestao.includes(permissaoBanco)) {
          setNivelAcesso('DIR');
        } else {
          setNivelAcesso('USU');
        }
      }
      
      setAuthLoading(false);
    }
    
    checkAuth();
  }, [router]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] flex flex-col pt-4 font-sans">
      <Analytics/>
      
      {/* HEADER TÉCNICO ALINHADO AO NAVBAR GLOBAL */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          💳 <strong>Olá, {usuarioAtual}</strong>. Módulo de Ordens de Pagamento (OP).
        </p>
        <button 
          onClick={() => router.push('/admin')} 
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ VOLTAR AO HUB CENTRAL
        </button>
      </div>

      <div className="flex-grow flex flex-col items-center p-4 py-12">
        <div className="mb-10 text-center">
          <Image 
            src={logoColorido} 
            alt="Rentech Locadora" 
            width={180} 
            height={55} 
            className="mx-auto mb-6 opacity-90"
          />
          <h1 className="text-2xl md:text-3xl font-black text-[#0C1D4D] uppercase tracking-wide">Portal de Pagamentos</h1>
          <p className="text-[#64748B] font-medium mt-2 max-w-lg mx-auto">
            Selecione abaixo a operação desejada. O acesso é restrito conforme suas permissões no sistema.
          </p>
        </div>

        {/* GRID DE CARDS DE NAVEGAÇÃO */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl px-4">
          
          {/* CARD: NOVA OP (Todos veem) */}
          <Link href="/admin/op/nova" className="group bg-white p-6 md:p-8 rounded-2xl shadow-sm hover:shadow-xl border-t-4 border-t-[#16A34A] border-transparent hover:border-[#16A34A] transition-all transform hover:-translate-y-1">
            <div className="w-14 h-14 bg-green-50 rounded-xl flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">
              ➕
            </div>
            <h2 className="text-xl font-black text-[#0A2A4A] uppercase tracking-wider mb-2">Solicitar Nova OP</h2>
            <p className="text-[#64748B] text-sm font-medium leading-relaxed">
              Preencha o formulário para enviar um pagamento para análise e aprovação da diretoria.
            </p>
          </Link>

          {/* CARD: MINHAS OPs (Todos veem) */}
          <Link href="/admin/op/responsavel" className="group bg-white p-6 md:p-8 rounded-2xl shadow-sm hover:shadow-xl border-t-4 border-t-[#336699] border-transparent hover:border-[#336699] transition-all transform hover:-translate-y-1">
            <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform">
              📋
            </div>
            <h2 className="text-xl font-black text-[#0A2A4A] uppercase tracking-wider mb-2">Minhas OPs</h2>
            <p className="text-[#64748B] text-sm font-medium leading-relaxed">
              Acompanhe o status de aprovação ou edite as Ordens de Pagamento solicitadas por você.
            </p>
          </Link>

          {/* CARD: FINANCEIRO (Apenas Alta Gestão/Financeiro vê) */}
          {nivelAcesso === 'DIR' && (
            <Link href="/admin/op/financeiro" className="group bg-white p-6 md:p-8 rounded-2xl shadow-sm hover:shadow-xl border-t-4 border-t-amber-500 border-transparent hover:border-amber-500 transition-all transform hover:-translate-y-1 md:col-span-2 lg:col-span-2 lg:w-1/2 lg:mx-auto">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
                <div className="w-16 h-16 bg-amber-50 rounded-xl flex items-center justify-center text-4xl group-hover:scale-110 transition-transform flex-shrink-0 border border-amber-100">
                  👑
                </div>
                <div>
                  <h2 className="text-xl font-black text-[#0A2A4A] uppercase tracking-wider mb-1">Painel Financeiro</h2>
                  <p className="text-[#64748B] text-sm font-medium leading-relaxed">
                    Acesso exclusivo. Analise, aprove ou efetue as baixas de todas as OPs do sistema Rentech.
                  </p>
                </div>
              </div>
            </Link>
          )}

        </div>
      </div>
    </div>
  );
}