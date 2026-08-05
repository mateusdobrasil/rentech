"use client";

// app/admin/financeiro/ExigirMFA.tsx
// Camada extra de proteção para a área Financeiro (dispara pagamentos PIX
// reais via API do Itaú — ver app/lib/itauSispag.ts). Exige 2FA (TOTP) do
// Supabase Auth além do login + permissão de rota que já protegem as demais
// páginas do admin. Ativação/desativação do fator vive em /admin/conta —
// aqui só cobramos o desafio (uma vez por sessão, já que o Supabase mantém
// o nível aal2 na própria sessão até logout/expiração).
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';

type EstadoMfa = 'verificando' | 'liberado' | 'exige_codigo' | 'nao_cadastrado';

export default function ExigirMFA({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoMfa>('verificando');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [verificando, setVerificando] = useState(false);

  useEffect(() => { checar(); }, []);

  const checar = async () => {
    const { data: aal, error: aalErro } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalErro || !aal) { setErro(aalErro?.message || 'Não foi possível verificar a autenticação.'); setEstado('nao_cadastrado'); return; }

    if (aal.currentLevel === 'aal2') { setEstado('liberado'); return; }

    if (aal.nextLevel === 'aal2') {
      // Tem fator verificado cadastrado, só falta o desafio desta sessão.
      const { data: fatores } = await supabase.auth.mfa.listFactors();
      const fator = fatores?.totp?.[0];
      if (!fator) { setEstado('nao_cadastrado'); return; }
      setFactorId(fator.id);
      setEstado('exige_codigo');
      return;
    }

    // nextLevel === 'aal1' — nenhum fator verificado cadastrado ainda.
    setEstado('nao_cadastrado');
  };

  const confirmar = async () => {
    if (!factorId || codigo.length !== 6) return;
    setVerificando(true); setErro('');
    try {
      const { data: desafio, error: desafioErro } = await supabase.auth.mfa.challenge({ factorId });
      if (desafioErro) throw desafioErro;

      const { error: verifyErro } = await supabase.auth.mfa.verify({ factorId, challengeId: desafio.id, code: codigo });
      if (verifyErro) throw verifyErro;

      const { data: { session } } = await supabase.auth.getSession();
      registrarLogAuditoria({
        usuario_nome: session?.user.email || 'Usuário',
        acao: 'VERIFICAÇÃO 2FA (ÁREA FINANCEIRA)',
        setor: 'ACESSO',
      });

      // verify() já sobe a sessão pra aal2 em segundo plano — não precisa
      // rechecar getAuthenticatorAssuranceLevel() aqui (evita corrida).
      setEstado('liberado');
    } catch (e: any) {
      setErro('Código inválido ou expirado. Tente novamente.');
      setCodigo('');
    } finally {
      setVerificando(false);
    }
  };

  if (estado === 'verificando') {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <p className="text-[#64748B] font-bold text-sm uppercase tracking-wider">Verificando segurança...</p>
      </div>
    );
  }

  if (estado === 'nao_cadastrado') {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-amber-200">
          <div className="text-5xl mb-4">🔐</div>
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Autenticação em Duas Etapas Obrigatória</h2>
          <p className="text-sm text-gray-500 mb-6">A área Financeira exige 2FA ativo, já que envolve pagamentos reais. Ative em Minha Conta antes de continuar.</p>
          <button onClick={() => router.push('/admin/conta')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Ir para Minha Conta
          </button>
        </div>
      </div>
    );
  }

  if (estado === 'exige_codigo') {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-[#E2E8F0]">
          <div className="text-5xl mb-4">🔐</div>
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Confirme sua identidade</h2>
          <p className="text-sm text-gray-500 mb-6">Digite o código do seu aplicativo autenticador para acessar a área Financeira.</p>
          <input
            type="text" inputMode="numeric" maxLength={6} value={codigo} autoFocus
            onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && confirmar()}
            placeholder="000000"
            className="w-full text-center text-2xl font-black tracking-[0.5em] p-3 border-2 border-[#CBD5E1] rounded-xl mb-3 outline-none focus:border-[#336699]"
          />
          {erro && <p className="text-xs text-red-600 font-bold mb-3">{erro}</p>}
          <button onClick={confirmar} disabled={verificando || codigo.length !== 6} className="w-full bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors disabled:opacity-50">
            {verificando ? 'Verificando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
