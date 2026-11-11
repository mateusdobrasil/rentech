"use client";

// "Esqueci minha senha" do /login — código no e-mail + senha nova
// (app/login/actions.ts). Aparece no lugar do formulário de login, no mesmo
// cartão.
import { useState } from 'react';
import { solicitarCodigoSenhaAction, redefinirSenhaComCodigoAction } from './actions';

type Etapa = 'email' | 'codigo' | 'concluido';

const CAMPO = 'w-full p-3.5 bg-black/50 border border-[#284B8C]/50 rounded-xl text-sm text-white focus:border-[#336699] focus:ring-1 focus:ring-[#336699] outline-none font-medium transition-all';
const ROTULO = 'block text-[10px] font-black text-[#999999] uppercase tracking-widest mb-1.5 pl-1';
const BOTAO = 'w-full bg-[#284B8C] text-white font-black uppercase tracking-widest text-sm py-4 rounded-xl hover:bg-[#336699] hover:shadow-[0_0_20px_rgba(51,102,153,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const LINK = 'w-full text-[11px] font-bold text-[#999999] hover:text-white uppercase tracking-widest py-2 transition-colors';

export default function RecuperarSenha({ emailInicial, aoVoltar }: { emailInicial: string; aoVoltar: (email: string) => void }) {
  const [etapa, setEtapa] = useState<Etapa>('email');
  const [email, setEmail] = useState(emailInicial);
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [carregando, setCarregando] = useState(false);

  const pedirCodigo = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErro(''); setCarregando(true);
    const res = await solicitarCodigoSenhaAction({ email });
    setCarregando(false);
    if (!res.ok) { setErro(res.erro || 'Não foi possível enviar o código.'); return; }
    setAviso(res.info.mensagem);
    setCodigo('');
    setEtapa('codigo');
  };

  const redefinir = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (senha !== confirmar) { setErro('As duas senhas não são iguais.'); return; }
    setCarregando(true);
    const res = await redefinirSenhaComCodigoAction({ email, codigo, novaSenha: senha });
    setCarregando(false);
    if (!res.ok) { setErro(res.erro || 'Não foi possível redefinir a senha.'); return; }
    setEtapa('concluido');
  };

  const caixaErro = erro && (
    <div className="bg-red-500/10 border border-red-500/50 p-3 rounded-lg text-center">
      <p className="text-xs text-red-400 font-bold">{erro}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-sm font-black text-white uppercase tracking-widest">Esqueci minha senha</p>
      </div>

      {etapa === 'email' && (
        <form onSubmit={pedirCodigo} className="space-y-5">
          <p className="text-xs text-[#999999] text-center">Digite o e-mail do seu login. Vamos mandar um código de 6 números para ele.</p>
          <div>
            <label className={ROTULO}>E-mail Corporativo</label>
            <input type="email" required autoFocus className={CAMPO} placeholder="seu.nome@rentech.com.br" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          {caixaErro}
          <button type="submit" disabled={carregando || !email.includes('@')} className={BOTAO}>
            {carregando ? 'ENVIANDO...' : 'ENVIAR CÓDIGO'}
          </button>
          <button type="button" onClick={() => aoVoltar(email)} className={LINK}>← Voltar para o login</button>
        </form>
      )}

      {etapa === 'codigo' && (
        <form onSubmit={redefinir} className="space-y-5">
          {aviso && (
            <div className="bg-emerald-500/10 border border-emerald-500/40 p-3 rounded-lg text-center">
              <p className="text-xs text-emerald-300 font-bold">{aviso}</p>
            </div>
          )}
          <div>
            <label className={ROTULO}>Código recebido no e-mail</label>
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={6}
              className={`${CAMPO} text-center text-xl font-black tracking-[0.5em]`} placeholder="000000"
              value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <div>
            <label className={ROTULO}>Senha nova (mín. 8 caracteres)</label>
            <input type="password" autoComplete="new-password" required className={CAMPO} placeholder="••••••••" value={senha} onChange={e => setSenha(e.target.value)} />
          </div>
          <div>
            <label className={ROTULO}>Repita a senha nova</label>
            <input type="password" autoComplete="new-password" required className={CAMPO} placeholder="••••••••" value={confirmar} onChange={e => setConfirmar(e.target.value)} />
          </div>
          {caixaErro}
          <button type="submit" disabled={carregando || codigo.length !== 6 || senha.length < 8 || !confirmar} className={BOTAO}>
            {carregando ? 'SALVANDO...' : 'SALVAR SENHA NOVA'}
          </button>
          <button type="button" onClick={() => pedirCodigo()} disabled={carregando} className={LINK}>Não chegou? Reenviar código</button>
          <button type="button" onClick={() => aoVoltar(email)} className={LINK}>← Voltar para o login</button>
        </form>
      )}

      {etapa === 'concluido' && (
        <div className="space-y-5 text-center">
          <div className="text-4xl">✅</div>
          <p className="text-sm text-white font-bold">Senha alterada!</p>
          <p className="text-xs text-[#999999]">Entre com a senha nova. Se a área pedir a verificação em duas etapas, use o aplicativo autenticador do celular.</p>
          <button type="button" onClick={() => aoVoltar(email)} className={BOTAO}>IR PARA O LOGIN</button>
        </div>
      )}
    </div>
  );
}
