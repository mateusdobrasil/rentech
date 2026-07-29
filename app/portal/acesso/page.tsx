"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { formatarCpf, somenteDigitos } from '../lib/cpf';
import { solicitarAcessoAction, verificarCodigoAction, criarContaAction } from '../actions/actions-acesso';

type Etapa = 'cpf' | 'codigo' | 'senha' | 'concluido';

export default function SolicitarAcessoPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>('cpf');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const [cpf, setCpf] = useState('');
  const [codigo, setCodigo] = useState('');
  const [token, setToken] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mensagem, setMensagem] = useState('');

  const enviarCpf = async () => {
    setErro(''); setCarregando(true);
    const res = await solicitarAcessoAction({ cpf });
    setCarregando(false);
    if (!res.ok) { setErro(res.erro || 'Erro ao solicitar acesso.'); return; }
    setMensagem(res.info.mensagem);
    setEtapa('codigo');
  };

  const confirmarCodigo = async () => {
    setErro(''); setCarregando(true);
    const res = await verificarCodigoAction({ cpf, codigo });
    setCarregando(false);
    if (!res.ok) { setErro(res.erro || 'Código inválido.'); return; }
    setToken(res.info.token);
    setEtapa('senha');
  };

  const finalizar = async () => {
    setErro('');
    if (senha !== confirmarSenha) { setErro('As senhas não coincidem.'); return; }
    setCarregando(true);
    const res = await criarContaAction({ cpf, token, senha });
    setCarregando(false);
    if (!res.ok) { setErro(res.erro || 'Erro ao criar acesso.'); return; }
    setEtapa('concluido');
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex items-center justify-center p-4">
      <Analytics />
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 border border-[#E2E8F0]">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🔐</div>
          <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider">Portal do Funcionário</h1>
          <p className="text-xs text-[#64748B] font-medium mt-1">Solicitar acesso</p>
        </div>

        {erro && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-4 py-3 rounded-lg">{erro}</div>
        )}

        {etapa === 'cpf' && (
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
              />
            </div>
            <button
              onClick={enviarCpf}
              disabled={carregando || somenteDigitos(cpf).length !== 11}
              className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3.5 rounded-xl shadow-lg transition-colors disabled:opacity-40"
            >
              {carregando ? 'Enviando...' : 'Receber código pelo WhatsApp'}
            </button>
            <button onClick={() => router.push('/portal/login')} className="w-full text-[#336699] font-bold text-xs py-2">
              Já tenho acesso — fazer login
            </button>
          </div>
        )}

        {etapa === 'codigo' && (
          <div className="space-y-4">
            <p className="text-xs text-[#64748B] font-medium bg-blue-50 border border-blue-100 rounded-lg p-3">{mensagem}</p>
            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Código recebido no WhatsApp</label>
              <input
                type="text"
                placeholder="000000"
                className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-lg font-black tracking-[0.5em] text-center focus:border-[#336699] outline-none"
                value={codigo}
                onChange={(e) => setCodigo(somenteDigitos(e.target.value).slice(0, 6))}
                maxLength={6}
              />
            </div>
            <button
              onClick={confirmarCodigo}
              disabled={carregando || codigo.length !== 6}
              className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3.5 rounded-xl shadow-lg transition-colors disabled:opacity-40"
            >
              {carregando ? 'Verificando...' : 'Confirmar código'}
            </button>
            <button onClick={() => setEtapa('cpf')} className="w-full text-[#64748B] font-bold text-xs py-2">
              ⬅ Corrigir CPF / pedir novo código
            </button>
          </div>
        )}

        {etapa === 'senha' && (
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Crie uma senha (mín. 8 caracteres)</label>
              <input
                type="password"
                className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Confirme a senha</label>
              <input
                type="password"
                className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
              />
            </div>
            <button
              onClick={finalizar}
              disabled={carregando || senha.length < 8}
              className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-xs uppercase tracking-widest py-3.5 rounded-xl shadow-lg transition-colors disabled:opacity-40"
            >
              {carregando ? 'Criando acesso...' : 'Criar meu acesso'}
            </button>
          </div>
        )}

        {etapa === 'concluido' && (
          <div className="text-center space-y-4">
            <div className="text-5xl">✅</div>
            <p className="text-sm text-[#0C1D4D] font-bold">Acesso criado com sucesso!</p>
            <button
              onClick={() => router.push('/portal/login')}
              className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3.5 rounded-xl shadow-lg transition-colors"
            >
              Ir para o login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
