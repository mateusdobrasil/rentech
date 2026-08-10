"use client";

// app/admin/ExigirMFA.tsx
// Camada extra de proteção usada pelo app/admin/layout.tsx para TODAS as
// páginas do admin — o layout consulta folha_paginas_permissoes.requer_2fa
// para a rota atual (configurável em /admin/parametros/permissoes, aba
// "Permissão 2FA") e repassa aqui via prop `ativo`. Exige 2FA (TOTP) do
// Supabase Auth além do login + permissão de rota que já protegem as demais
// páginas do admin. Ativação/desativação do fator vive em /admin/conta.
//
// O Supabase mantém o nível aal2 na própria sessão até logout/expiração do
// refresh token (dias) — sem controle próprio, o usuário só seria desafiado
// uma vez e nunca mais. Por isso este componente também rastreia a última
// interação do usuário em qualquer página do admin (localStorage, global —
// ver useEffect de atividade abaixo) e força um novo desafio se o usuário
// ficar mais de 1h sem interagir, mesmo com aal2 ainda válido.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { registrarLogAuditoria } from '../actions';

type EstadoMfa = 'verificando' | 'liberado' | 'exige_codigo' | 'nao_cadastrado';

const CHAVE_ULTIMA_ATIVIDADE = 'rentech_admin_ultima_atividade';
const LIMITE_INATIVIDADE_MS = 60 * 60 * 1000; // 1 hora

function tempoInativoMs(): number {
  const ultima = Number(localStorage.getItem(CHAVE_ULTIMA_ATIVIDADE)) || Date.now();
  return Date.now() - ultima;
}

export default function ExigirMFA({ children, ativo = true }: { children: React.ReactNode; ativo?: boolean }) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoMfa>('verificando');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [verificando, setVerificando] = useState(false);

  // Rastreador de atividade — roda sempre (independente de `ativo`), já que
  // ExigirMFA está montado em toda página do admin via app/admin/layout.tsx.
  // Throttlado pra não gravar no localStorage a cada pixel de mousemove.
  useEffect(() => {
    if (localStorage.getItem(CHAVE_ULTIMA_ATIVIDADE) === null) {
      localStorage.setItem(CHAVE_ULTIMA_ATIVIDADE, String(Date.now()));
    }
    let ultimoRegistro = 0;
    const registrarAtividade = () => {
      const agora = Date.now();
      if (agora - ultimoRegistro < 30_000) return;
      ultimoRegistro = agora;
      localStorage.setItem(CHAVE_ULTIMA_ATIVIDADE, String(agora));
    };
    const eventos = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'] as const;
    eventos.forEach(ev => window.addEventListener(ev, registrarAtividade, { passive: true }));
    return () => eventos.forEach(ev => window.removeEventListener(ev, registrarAtividade));
  }, []);

  const irParaDesafio = useCallback(async () => {
    // Tem fator verificado cadastrado, só falta o desafio.
    const { data: fatores } = await supabase.auth.mfa.listFactors();
    const fator = fatores?.totp?.[0];
    if (!fator) { setEstado('nao_cadastrado'); return; }
    setFactorId(fator.id);
    setEstado('exige_codigo');
  }, []);

  const checar = useCallback(async () => {
    const { data: aal, error: aalErro } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalErro || !aal) { setErro(aalErro?.message || 'Não foi possível verificar a autenticação.'); setEstado('nao_cadastrado'); return; }

    if (aal.currentLevel === 'aal2') {
      if (tempoInativoMs() < LIMITE_INATIVIDADE_MS) { setEstado('liberado'); return; }
      // aal2 ainda válido pro Supabase, mas o usuário ficou +1h sem usar o
      // sistema — cobra o código de novo mesmo assim.
      await irParaDesafio();
      return;
    }

    if (aal.nextLevel === 'aal2') { await irParaDesafio(); return; }

    // nextLevel === 'aal1' — nenhum fator verificado cadastrado ainda.
    setEstado('nao_cadastrado');
  }, [irParaDesafio]);

  useEffect(() => { if (ativo) checar(); }, [ativo, checar]);

  // Enquanto a página fica aberta e liberada, confere periodicamente se a
  // inatividade passou de 1h (sem isso, só re-checaríamos na próxima
  // navegação/remontagem do componente).
  useEffect(() => {
    if (!ativo || estado !== 'liberado') return;
    const id = setInterval(() => {
      if (tempoInativoMs() >= LIMITE_INATIVIDADE_MS) checar();
    }, 60_000);
    return () => clearInterval(id);
  }, [ativo, estado, checar]);

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
        acao: 'VERIFICAÇÃO 2FA',
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

  if (!ativo) return <>{children}</>;

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
          <p className="text-sm text-gray-500 mb-6">Esta área exige autenticação em duas etapas (2FA) ativa. Ative em Minha Conta antes de continuar.</p>
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
          <p className="text-sm text-gray-500 mb-6">Digite o código do seu aplicativo autenticador para continuar.</p>
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
