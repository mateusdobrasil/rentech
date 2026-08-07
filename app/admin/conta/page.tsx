"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { registrarLogAuditoria } from '../../actions';
import { Analytics } from "@vercel/analytics/next";

// Página aberta a QUALQUER usuário autenticado — de propósito não checa
// folha_paginas_permissoes (diferente das demais páginas do /admin). Um
// usuário recém-criado, ainda sem nenhum módulo liberado, precisa conseguir
// trocar a senha provisória mesmo assim.
export default function MinhaConta() {
  const router = useRouter();

  const [authLoading, setAuthLoading] = useState(true);
  const [perfil, setPerfil] = useState<{ nome: string; email: string; permissao: string } | null>(null);

  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; type: 'success' | 'error' }>({ show: false, msg: '', type: 'success' });

  // Autenticação em duas etapas (2FA/TOTP) — exigida em páginas marcadas com
  // "requer 2FA" em /admin/parametros/permissoes (ver app/admin/ExigirMFA.tsx
  // e app/admin/layout.tsx), ativada aqui.
  const [fatorMfa, setFatorMfa] = useState<{ id: string; status: string } | null>(null);
  const [carregandoMfa, setCarregandoMfa] = useState(true);
  const [ativacaoMfa, setAtivacaoMfa] = useState<{ factorId: string; qrCode: string; segredo: string } | null>(null);
  const [codigoMfa, setCodigoMfa] = useState('');
  const [processandoMfa, setProcessandoMfa] = useState(false);
  const [erroMfa, setErroMfa] = useState('');

  useEffect(() => {
    async function carregar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      const { data } = await supabase
        .from('perfis_usuarios')
        .select('nome, permissao')
        .eq('id', session.user.id)
        .single();

      setPerfil({
        nome: data?.nome || session.user.email || 'Usuário',
        email: session.user.email || '',
        permissao: data?.permissao || '',
      });
      setAuthLoading(false);
      carregarFatorMfa();
    }

    carregar();
  }, [router]);

  const carregarFatorMfa = async () => {
    setCarregandoMfa(true);
    const { data } = await supabase.auth.mfa.listFactors();
    const fator = data?.totp?.[0];
    setFatorMfa(fator ? { id: fator.id, status: fator.status } : null);
    setCarregandoMfa(false);
  };

  // Inicia o cadastro: gera o QR code + segredo (fallback caso não dê pra
  // escanear) e deixa pronto pra receber o código de confirmação.
  const iniciarAtivacaoMfa = async () => {
    setErroMfa('');

    // Uma tentativa anterior abandonada (fechou a aba, removeu do app
    // autenticador sem clicar em "Cancelar" aqui, deu erro de rede entre o
    // enroll e o verify) deixa um fator TOTP "unverified" pendurado no
    // Supabase. Como o friendly_name vazio ("") é o mesmo em toda tentativa,
    // o próximo enroll esbarra nesse fator órfão com "A factor with the
    // friendly name... already exists" — limpa qualquer fator TOTP não
    // verificado antes de tentar de novo.
    // `data.totp` vem tipado como sempre 'verified' (imprecisão da lib), então
    // usamos `data.all` — que carrega o status real — pra achar os órfãos.
    const { data: fatoresAtuais } = await supabase.auth.mfa.listFactors();
    const orfaos = (fatoresAtuais?.all || []).filter(f => f.factor_type === 'totp' && f.status === 'unverified');
    for (const orfao of orfaos) {
      await supabase.auth.mfa.unenroll({ factorId: orfao.id });
    }

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Rentech' });
    if (error) { mostrarFeedback(error.message, 'error'); return; }
    setAtivacaoMfa({ factorId: data.id, qrCode: data.totp.qr_code, segredo: data.totp.secret });
  };

  // Cancela um cadastro em andamento (fator ainda não verificado) — não
  // exige aal2, diferente de desativar um fator já ativo.
  const cancelarAtivacaoMfa = async () => {
    if (ativacaoMfa) await supabase.auth.mfa.unenroll({ factorId: ativacaoMfa.factorId });
    setAtivacaoMfa(null);
    setCodigoMfa('');
    setErroMfa('');
  };

  const confirmarAtivacaoMfa = async () => {
    if (!ativacaoMfa || codigoMfa.length !== 6) return;
    setProcessandoMfa(true); setErroMfa('');
    try {
      const { data: desafio, error: desafioErro } = await supabase.auth.mfa.challenge({ factorId: ativacaoMfa.factorId });
      if (desafioErro) throw desafioErro;
      const { error: verifyErro } = await supabase.auth.mfa.verify({ factorId: ativacaoMfa.factorId, challengeId: desafio.id, code: codigoMfa });
      if (verifyErro) throw verifyErro;

      registrarLogAuditoria({ usuario_nome: perfil?.nome || 'Usuário', acao: 'ATIVOU AUTENTICAÇÃO EM DUAS ETAPAS (2FA)', setor: 'ACESSO' });
      mostrarFeedback('2FA ativado com sucesso!', 'success');
      setAtivacaoMfa(null);
      setCodigoMfa('');
      carregarFatorMfa();
    } catch (e: any) {
      setErroMfa('Código inválido ou expirado. Tente novamente.');
      setCodigoMfa('');
    } finally {
      setProcessandoMfa(false);
    }
  };

  const desativarMfa = async () => {
    if (!fatorMfa) return;
    if (!confirm('Desativar a autenticação em duas etapas? Você perderá a camada extra de proteção da área Financeira até ativar de novo.')) return;
    setProcessandoMfa(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: fatorMfa.id });
      if (error) throw error;
      registrarLogAuditoria({ usuario_nome: perfil?.nome || 'Usuário', acao: 'DESATIVOU AUTENTICAÇÃO EM DUAS ETAPAS (2FA)', setor: 'ACESSO' });
      mostrarFeedback('2FA desativado.', 'success');
      setFatorMfa(null);
    } catch (e: any) {
      mostrarFeedback('Não foi possível desativar: confirme seu código atual primeiro (abra qualquer página do Financeiro) e tente de novo.', 'error');
    } finally {
      setProcessandoMfa(false);
    }
  };

  const mostrarFeedback = (msg: string, type: 'success' | 'error') => {
    setFeedback({ show: true, msg, type });
    setTimeout(() => setFeedback({ show: false, msg: '', type: 'success' }), 3000);
  };

  const alterarSenha = async () => {
    if (novaSenha.length < 8) {
      return mostrarFeedback('A nova senha precisa ter pelo menos 8 caracteres.', 'error');
    }
    if (novaSenha !== confirmarSenha) {
      return mostrarFeedback('As senhas digitadas não coincidem.', 'error');
    }

    setSalvando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;

      registrarLogAuditoria({
        usuario_nome: perfil?.nome || 'Usuário',
        acao: 'ALTEROU A PRÓPRIA SENHA',
        setor: 'ACESSO',
      });

      mostrarFeedback('Senha alterada com sucesso!', 'success');
      setNovaSenha('');
      setConfirmarSenha('');
    } catch (error: any) {
      mostrarFeedback(error.message || 'Erro ao alterar senha.', 'error');
    } finally {
      setSalvando(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Minha Conta</h1>
          <p className="text-sm font-medium text-gray-500">Gerencie seus dados de acesso ao sistema.</p>
        </div>
        <Link href="/admin" className="text-xs font-bold bg-white hover:bg-gray-100 border border-gray-300 text-gray-600 px-6 py-3 rounded-lg transition-colors uppercase tracking-wider shadow-sm">
          ⬅ Voltar ao Hub
        </Link>
      </div>

      {feedback.show && (
        <div className={`fixed top-6 right-8 px-6 py-3 rounded-lg shadow-xl z-50 font-black text-xs uppercase tracking-wider ${feedback.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
          {feedback.type === 'success' ? '✅ ' : '❌ '}{feedback.msg}
        </div>
      )}

      <div className="px-4 md:px-8 pb-8 flex-grow flex justify-center">
        <div className="w-full max-w-lg space-y-6">

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0]">
            <div className="w-14 h-14 bg-[#336699] text-white rounded-full flex items-center justify-center text-xl font-black mx-auto mb-3">
              {perfil?.nome.charAt(0)}
            </div>
            <div className="text-center">
              <strong className="block text-base text-[#0C1D4D] font-black uppercase tracking-tight">{perfil?.nome}</strong>
              <span className="text-xs text-[#64748B] font-bold block">{perfil?.email}</span>
              {perfil?.permissao && (
                <span className="inline-block mt-2 px-3 py-1 border rounded-full text-[10px] font-black tracking-widest bg-blue-100 text-blue-700 border-blue-300">
                  {perfil.permissao}
                </span>
              )}
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
            <div className="border-b border-gray-100 pb-2">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">Alterar Senha</h2>
              <p className="text-[11px] text-gray-400 font-bold uppercase mt-0.5">Defina uma nova senha para o seu acesso</p>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nova Senha</label>
              <input
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={novaSenha}
                onChange={e => setNovaSenha(e.target.value)}
                className="w-full p-3 border-2 border-[#CBD5E1] rounded-xl text-sm font-bold bg-gray-50 text-[#0C1D4D] outline-none focus:border-[#336699]"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Confirmar Nova Senha</label>
              <input
                type="password"
                placeholder="Repita a nova senha"
                value={confirmarSenha}
                onChange={e => setConfirmarSenha(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && alterarSenha()}
                className="w-full p-3 border-2 border-[#CBD5E1] rounded-xl text-sm font-bold bg-gray-50 text-[#0C1D4D] outline-none focus:border-[#336699]"
              />
            </div>

            <button
              onClick={alterarSenha}
              disabled={salvando}
              className="w-full bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-[#284B8C] transition-all shadow-md disabled:opacity-50"
            >
              {salvando ? '...' : '🔒 Salvar Nova Senha'}
            </button>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
            <div className="border-b border-gray-100 pb-2 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">🔐 Autenticação em Duas Etapas</h2>
                <p className="text-[11px] text-gray-400 font-bold uppercase mt-0.5">Obrigatória para acessar a área Financeira</p>
              </div>
              {!carregandoMfa && fatorMfa && !ativacaoMfa && (
                <span className="text-[9px] font-black px-2.5 py-1 rounded-full uppercase bg-emerald-100 text-emerald-700 shrink-0">✓ Ativado</span>
              )}
            </div>

            {carregandoMfa && <p className="text-xs text-gray-400 text-center py-2">Carregando...</p>}

            {!carregandoMfa && !ativacaoMfa && !fatorMfa && (
              <div className="text-center py-2">
                <p className="text-xs text-gray-500 mb-4">Ative um aplicativo autenticador (Google Authenticator, Authy, etc.) para proteger seu acesso ao Financeiro com um código extra.</p>
                <button onClick={iniciarAtivacaoMfa} className="w-full bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-[#284B8C] transition-all shadow-md">
                  🔐 Ativar 2FA
                </button>
              </div>
            )}

            {!carregandoMfa && !ativacaoMfa && fatorMfa && (
              <div className="text-center py-2">
                <p className="text-xs text-gray-500 mb-4">Seu acesso à área Financeira está protegido por um código de verificação adicional.</p>
                <button onClick={desativarMfa} disabled={processandoMfa} className="w-full bg-white border-2 border-red-300 text-red-600 font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-red-50 transition-all disabled:opacity-50">
                  {processandoMfa ? '...' : 'Desativar 2FA'}
                </button>
              </div>
            )}

            {ativacaoMfa && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 text-center">Escaneie o QR code com seu aplicativo autenticador, ou digite o código manualmente.</p>
                <div className="flex justify-center">
                  <img src={ativacaoMfa.qrCode} alt="QR code para ativar 2FA" className="w-40 h-40 border border-gray-200 rounded-lg" />
                </div>
                <div className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-1">Código manual</p>
                  <p className="text-xs font-mono font-bold text-[#0C1D4D] break-all">{ativacaoMfa.segredo}</p>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Código de 6 dígitos do app</label>
                  <input
                    type="text" inputMode="numeric" maxLength={6} value={codigoMfa} autoFocus
                    onChange={e => setCodigoMfa(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={e => e.key === 'Enter' && confirmarAtivacaoMfa()}
                    placeholder="000000"
                    className="w-full text-center text-xl font-black tracking-[0.4em] p-3 border-2 border-[#CBD5E1] rounded-xl outline-none focus:border-[#336699]"
                  />
                </div>
                {erroMfa && <p className="text-xs text-red-600 font-bold text-center">{erroMfa}</p>}
                <div className="flex gap-2">
                  <button onClick={cancelarAtivacaoMfa} className="flex-1 bg-white border-2 border-gray-300 text-gray-500 font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-gray-50 transition-all">
                    Cancelar
                  </button>
                  <button onClick={confirmarAtivacaoMfa} disabled={processandoMfa || codigoMfa.length !== 6} className="flex-1 bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl hover:bg-[#284B8C] transition-all disabled:opacity-50">
                    {processandoMfa ? '...' : 'Confirmar'}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
