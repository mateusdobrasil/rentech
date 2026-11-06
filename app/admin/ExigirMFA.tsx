"use client";

// app/admin/ExigirMFA.tsx
// Camada extra de proteção usada pelo app/admin/layout.tsx para TODAS as
// páginas do admin — o layout consulta parametros_paginas_permissoes.requer_2fa
// para a rota atual (configurável em /admin/parametros/permissoes, aba
// "Permissão 2FA") e repassa aqui via prop `ativo`. Exige 2FA (TOTP) do
// Supabase Auth além do login + permissão de rota que já protegem as demais
// páginas do admin. Ativação/desativação do fator vive em /admin/conta.
//
// Este componente também rastreia a última interação do usuário em qualquer
// página do admin (localStorage, global — ver useEffect de atividade abaixo)
// e, se passar de 1h sem interagir, desloga de verdade (mesmo efeito do botão
// "Sair" da Navbar) — ver deslogarPorInatividade. Isso vale pra TODA página do
// admin, não só pras que exigem 2FA, já que ExigirMFA está montado em todas
// via app/admin/layout.tsx.
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';
import { registrarLogAuditoria } from '../actions';
import { enviarCodigoMfaEmailAction, verificarCodigoMfaEmailAction, liberacaoMfaEmailAtivaAction } from './actions-mfa';

const tokenAtual = async () => (await supabase.auth.getSession()).data.session?.access_token || '';

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
  // Plano B "Não estou com meu celular": código no e-mail (actions-mfa.ts)
  const [modoEmail, setModoEmail] = useState(false);
  const [emailEnviadoPara, setEmailEnviadoPara] = useState<string | null>(null);
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [aviso, setAviso] = useState('');

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

  // Mesmo efeito do botão "Sair" da Navbar (components/Navbar.tsx), só que
  // disparado pela inatividade em vez de clique. Limpa a marca de atividade e
  // o flag de log de acesso pra sessão seguinte começar do zero.
  const deslogarPorInatividade = useCallback(async () => {
    await supabase.auth.signOut();
    document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    localStorage.removeItem(CHAVE_ULTIMA_ATIVIDADE);
    sessionStorage.removeItem('logAcessoRegistrado');
    router.push('/login?motivo=inatividade');
  }, [router]);

  // Checa a inatividade de toda e qualquer página do admin — independente de
  // `ativo`/2FA. Confere já no mount (cobre quem deixou a aba aberta ou
  // reabriu o navegador depois de +1h) e depois a cada 1min enquanto a página
  // ficar aberta.
  useEffect(() => {
    if (tempoInativoMs() >= LIMITE_INATIVIDADE_MS) { deslogarPorInatividade(); return; }
    const id = setInterval(() => {
      if (tempoInativoMs() >= LIMITE_INATIVIDADE_MS) deslogarPorInatividade();
    }, 60_000);
    return () => clearInterval(id);
  }, [deslogarPorInatividade]);

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

    // Inatividade >1h já é tratada à parte (deslogarPorInatividade desloga de
    // verdade antes mesmo de chegar aqui) — chegando até este ponto, aal2
    // válido já basta.
    if (aal.currentLevel === 'aal2') { setEstado('liberado'); return; }

    if (aal.nextLevel === 'aal2') {
      // Sessão já liberada por código de e-mail (sem o celular) — vale só
      // pra este login, conferido no servidor.
      if (await liberacaoMfaEmailAtivaAction(await tokenAtual())) { setEstado('liberado'); return; }
      await irParaDesafio();
      return;
    }

    // nextLevel === 'aal1' — nenhum fator verificado cadastrado ainda.
    setEstado('nao_cadastrado');
  }, [irParaDesafio]);

  useEffect(() => { if (ativo) checar(); }, [ativo, checar]);

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

  const pedirCodigoEmail = async () => {
    setEnviandoEmail(true); setErro(''); setAviso('');
    const res = await enviarCodigoMfaEmailAction(await tokenAtual());
    setEnviandoEmail(false);
    if (!res.ok) { setErro(res.erro || 'Não foi possível enviar o código.'); return; }
    setEmailEnviadoPara(res.info.email);
    setCodigo('');
    setAviso(`Código enviado para ${res.info.email}. Confira também a caixa de spam.`);
  };

  const confirmarCodigoEmail = async () => {
    if (codigo.length !== 6) return;
    setVerificando(true); setErro('');
    const res = await verificarCodigoMfaEmailAction({ codigo }, await tokenAtual());
    setVerificando(false);
    if (!res.ok) { setErro(res.erro || 'Código inválido.'); setCodigo(''); return; }
    setEstado('liberado');
  };

  const trocarModo = (email: boolean) => { setModoEmail(email); setCodigo(''); setErro(''); setAviso(''); };

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
    const campoCodigo = (aoConfirmar: () => void) => (
      <input
        type="text" inputMode="numeric" maxLength={6} value={codigo} autoFocus
        onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
        onKeyDown={e => e.key === 'Enter' && aoConfirmar()}
        placeholder="000000"
        className="w-full text-center text-2xl font-black tracking-[0.5em] p-3 border-2 border-[#CBD5E1] rounded-xl mb-3 outline-none focus:border-[#336699]"
      />
    );
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-[#E2E8F0]">
          <div className="text-5xl mb-4">{modoEmail ? '📧' : '🔐'}</div>
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Confirme sua identidade</h2>

          {!modoEmail ? (
            <>
              <p className="text-sm text-gray-500 mb-6">Digite o código do seu aplicativo autenticador para continuar.</p>
              {campoCodigo(confirmar)}
              {erro && <p className="text-xs text-red-600 font-bold mb-3">{erro}</p>}
              <button onClick={confirmar} disabled={verificando || codigo.length !== 6} className="w-full bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors disabled:opacity-50">
                {verificando ? 'Verificando...' : 'Confirmar'}
              </button>
              <button onClick={() => trocarModo(true)} className="mt-4 text-xs font-bold text-[#336699] hover:underline">
                📵 Não estou com meu celular
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-5">
                Enviamos um código de 6 dígitos para o e-mail do seu login. Ele vale por 10 minutos e libera <strong>só este acesso</strong>, neste navegador.
              </p>
              {!emailEnviadoPara ? (
                <button onClick={pedirCodigoEmail} disabled={enviandoEmail} className="w-full bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors disabled:opacity-50 mb-3">
                  {enviandoEmail ? 'Enviando...' : '📧 Enviar código por e-mail'}
                </button>
              ) : (
                <>
                  {campoCodigo(confirmarCodigoEmail)}
                  <button onClick={confirmarCodigoEmail} disabled={verificando || codigo.length !== 6} className="w-full bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors disabled:opacity-50 mb-2">
                    {verificando ? 'Verificando...' : 'Confirmar código do e-mail'}
                  </button>
                  <button onClick={pedirCodigoEmail} disabled={enviandoEmail} className="text-[11px] font-bold text-gray-500 hover:text-[#336699] disabled:opacity-50">
                    {enviandoEmail ? 'Enviando...' : 'Não chegou? Reenviar'}
                  </button>
                </>
              )}
              {aviso && <p className="text-xs text-emerald-700 font-bold mt-3">{aviso}</p>}
              {erro && <p className="text-xs text-red-600 font-bold mt-3">{erro}</p>}
              <button onClick={() => trocarModo(false)} className="mt-4 block mx-auto text-xs font-bold text-[#336699] hover:underline">
                ← Usar o aplicativo autenticador
              </button>
            </>
          )}

          <p className="text-[10px] text-gray-400 font-bold mt-6 pt-4 border-t border-[#E2E8F0]">
            Perdeu ou trocou de celular? Peça ao Administrador para resetar sua autenticação em duas etapas e cadastre o celular novo.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
