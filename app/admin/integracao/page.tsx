"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../lib/supabase';
import {
  listarIntegracoesAction, salvarIntegracaoAction,
  statusTokenAutentiqueAction, estatisticasAutentiqueAction,
  statusZapiAction, estatisticasZapiAction
} from './actions';

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  return 'USUARIO';
};

const fmtDataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Integracao {
  id: number; parceiro: string; nome_exibicao: string; tipo: string;
  ativo: boolean; ambiente: string; config: any;
}
interface EstatisticasAutentique {
  total: number; assinados: number; rejeitados: number; pendentes: number;
  producao: number; sandbox: number; ultimoEnvio: string | null;
}
interface StatusZapi {
  instanceConfigurado: boolean; tokenConfigurado: boolean; clientTokenConfigurado: boolean;
}
interface EstatisticasZapi {
  total: number; ativas: number; ultimoDisparo: string | null;
}

const ICONE_TIPO: Record<string, string> = { BANCO: '🏦', BENEFICIO: '🎁', ASSINATURA: '✍️', MENSAGERIA: '💬' };

export default function IntegracaoPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [emailUsuario, setEmailUsuario] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  const [integracoes, setIntegracoes] = useState<Integracao[]>([]);
  const [loading, setLoading] = useState(true);

  const [tokenAutentiqueOk, setTokenAutentiqueOk] = useState<boolean | null>(null);
  const [statsAutentique, setStatsAutentique] = useState<EstatisticasAutentique | null>(null);

  const [statusZapi, setStatusZapi] = useState<StatusZapi | null>(null);
  const [statsZapi, setStatsZapi] = useState<EstatisticasZapi | null>(null);

  const [editParceiro, setEditParceiro] = useState<Integracao | null>(null);
  const [edAtivo, setEdAtivo] = useState(false);
  const [edAmbiente, setEdAmbiente] = useState<'SANDBOX' | 'PRODUCAO'>('SANDBOX');
  const [edAgencia, setEdAgencia] = useState('');
  const [edConta, setEdConta] = useState('');
  const [edCnpj, setEdCnpj] = useState('');
  const [edRazaoSocial, setEdRazaoSocial] = useState('');

  // Valida a sessão e a permissão (dinâmica, via banco) antes de liberar a página
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (perfilError || !perfil) {
        console.error("Erro crítico ao buscar perfil do usuário:", perfilError);
        router.push('/login');
        return;
      }

      // Consulta no banco de dados quem pode aceder a esta rota
      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      // Normaliza o perfil logado e verifica contra o banco
      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      // Aprovado
      setUsuarioAtual(perfil.nome || 'Equipe RH');
      setEmailUsuario(perfil.email || session.user.email || '');
      setAuthLoading(false);
      carregar();
    }
    checkAuth();
  }, [router, pathname]);

  const carregar = async () => {
    setLoading(true);
    try {
      const [integ, tokenRes, statsRes, zapiStatusRes, zapiStatsRes] = await Promise.all([
        listarIntegracoesAction(),
        statusTokenAutentiqueAction(), estatisticasAutentiqueAction(),
        statusZapiAction(), estatisticasZapiAction()
      ]);
      if (integ.ok) setIntegracoes(integ.info.integracoes);
      if (tokenRes.ok) setTokenAutentiqueOk(tokenRes.info.configurado);
      if (statsRes.ok) setStatsAutentique(statsRes.info);
      if (zapiStatusRes.ok) setStatusZapi(zapiStatusRes.info);
      if (zapiStatsRes.ok) setStatsZapi(zapiStatsRes.info);
    } finally { setLoading(false); }
  };

  const abrirConfig = (i: Integracao) => {
    setEditParceiro(i); setEdAtivo(i.ativo); setEdAmbiente(i.ambiente as any);
    setEdAgencia(i.config?.agencia_debito || ''); setEdConta(i.config?.conta_debito || '');
    setEdCnpj(i.config?.cnpj || ''); setEdRazaoSocial(i.config?.razao_social || '');
  };

  const salvarConfig = async () => {
    if (!editParceiro) return;
    const res = await salvarIntegracaoAction({
      parceiro: editParceiro.parceiro, ativo: edAtivo, ambiente: edAmbiente,
      config: {
        ...editParceiro.config, agencia_debito: edAgencia, conta_debito: edConta,
        cnpj: edCnpj, razao_social: edRazaoSocial
      }
    });
    if (!res.ok) { alert(res.erro); return; }
    setEditParceiro(null);
    carregar();
  };

  // Enquanto valida a sessão, mostra um estado de carregamento (evita piscar a
  // página antes da checagem de permissão)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <p className="text-[#64748B] font-bold text-sm uppercase tracking-wider">Validando acesso...</p>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar as Integrações.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          🔗 <strong>Integrações</strong>. Bancos e parceiros para pagamentos e envio de informações.
        </p>
        <button onClick={() => router.push('/admin')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {loading ? <p className="text-gray-400 font-bold uppercase p-8">Carregando...</p> : integracoes.map(i => (
            <div key={i.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{ICONE_TIPO[i.tipo] || '🔗'}</span>
                  <div>
                    <h3 className="font-black text-[#0C1D4D] uppercase text-sm">{i.nome_exibicao}</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase">{i.tipo}</p>
                  </div>
                </div>
                <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase ${i.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                  {i.ativo ? '● Ativo' : '○ Inativo'}
                </span>
              </div>

              {i.parceiro === 'AUTENTIQUE' && (
                <div className="mb-3 pb-3 border-b border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Token no servidor</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${tokenAutentiqueOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {tokenAutentiqueOk === null ? '…' : tokenAutentiqueOk ? '✓ Configurado' : '✕ Ausente'}
                    </span>
                  </div>
                  {statsAutentique && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-gray-100 text-gray-600">{statsAutentique.total} enviados</span>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-green-100 text-green-700">{statsAutentique.assinados} assinados</span>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-amber-100 text-amber-700">{statsAutentique.pendentes} pendentes</span>
                      {statsAutentique.rejeitados > 0 && (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-red-100 text-red-600">{statsAutentique.rejeitados} rejeitados</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {i.parceiro === 'FLASH' && (
                <div className="mb-3 pb-3 border-b border-gray-100">
                  <span className="inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-orange-100 text-orange-700">📄 Arquivo manual (CSV)</span>
                  <p className="text-[10px] text-gray-400 font-semibold mt-1.5 leading-snug">
                    Sem API — gere o CSV em RH → Grid de Benefícios ("⚡ Gerar Flash") e suba manualmente na plataforma Flash.
                  </p>
                </div>
              )}

              {i.parceiro === 'ZAPI' && (
                <div className="mb-3 pb-3 border-b border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Credenciais no servidor</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusZapi && statusZapi.instanceConfigurado && statusZapi.tokenConfigurado && statusZapi.clientTokenConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {!statusZapi ? '…' : (statusZapi.instanceConfigurado && statusZapi.tokenConfigurado && statusZapi.clientTokenConfigurado) ? '✓ Configuradas' : '✕ Incompletas'}
                    </span>
                  </div>
                  {statsZapi && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-gray-100 text-gray-600">{statsZapi.total} automações</span>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-green-100 text-green-700">{statsZapi.ativas} ativas</span>
                    </div>
                  )}
                </div>
              )}

              {i.parceiro === 'ITAU' && (
                <div className="mb-3 pb-3 border-b border-gray-100">
                  <span className="inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">📄 Arquivo manual (SISPAG)</span>
                  <p className="text-[10px] text-gray-400 font-semibold mt-1.5 leading-snug">
                    Hoje: geração de arquivos SISPAG (CNAB240) em RH → Financeiro — PIX e Conta/TED, envio manual pelo Itaú Empresas. API própria está planejada para o futuro.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-black uppercase ${i.ambiente === 'PRODUCAO' ? 'text-[#0C1D4D]' : 'text-amber-600'}`}>
                  {i.ambiente === 'PRODUCAO' ? '🟢 Produção' : '🟡 Sandbox'}
                </span>
                <button onClick={() => abrirConfig(i)} className="text-[10px] font-black text-[#0C1D4D] bg-white border border-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">⚙ Configurar</button>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
          <p className="text-sm text-amber-800 font-medium">
            🔒 <strong>Segurança das credenciais.</strong> Chaves de API, certificados digitais e segredos dos bancos nunca devem ser digitados aqui nem guardados no banco de dados.
          </p>
        </div>
      </div>

      {editParceiro && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditParceiro(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{editParceiro.nome_exibicao}</h2>
            <p className="text-[11px] text-gray-400 font-bold uppercase mb-4">{editParceiro.tipo}</p>

            <div className="space-y-4">
              <label className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-xl cursor-pointer">
                <span className="text-xs font-black text-[#0C1D4D] uppercase">Integração ativa</span>
                <input type="checkbox" checked={edAtivo} onChange={e => setEdAtivo(e.target.checked)} className="w-5 h-5" />
              </label>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Ambiente</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['SANDBOX', 'PRODUCAO'] as const).map(amb => (
                    <button key={amb} onClick={() => setEdAmbiente(amb)} className={`p-2.5 rounded-lg text-[11px] font-black uppercase border-2 ${edAmbiente === amb ? (amb === 'PRODUCAO' ? 'border-slate-400 bg-slate-50 text-slate-600' : 'border-amber-400 bg-amber-50 text-amber-600') : 'border-gray-200 text-gray-400'}`}>
                      {amb === 'SANDBOX' ? '🟡 Sandbox' : '🟢 Produção'}
                    </button>
                  ))}
                </div>
              </div>

              {editParceiro.parceiro === 'AUTENTIQUE' && (
                <div className="space-y-3">
                  <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Token da API</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${tokenAutentiqueOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {tokenAutentiqueOk === null ? '…' : tokenAutentiqueOk ? '✓ Configurado' : '✕ Ausente'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                      O token (AUTENTIQUE_API_TOKEN) vive só no ambiente do servidor — nunca é lido, gravado ou exibido aqui.
                    </p>
                  </div>

                  {statsAutentique && (
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Uso da integração</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 bg-gray-50 rounded-xl text-center">
                          <p className="text-xl font-black text-[#0C1D4D]">{statsAutentique.total}</p>
                          <p className="text-[9px] font-black text-gray-400 uppercase">Enviados</p>
                        </div>
                        <div className="p-3 bg-green-50 rounded-xl text-center">
                          <p className="text-xl font-black text-green-700">{statsAutentique.assinados}</p>
                          <p className="text-[9px] font-black text-green-500 uppercase">Assinados</p>
                        </div>
                        <div className="p-3 bg-amber-50 rounded-xl text-center">
                          <p className="text-xl font-black text-amber-700">{statsAutentique.pendentes}</p>
                          <p className="text-[9px] font-black text-amber-500 uppercase">Pendentes</p>
                        </div>
                        <div className="p-3 bg-red-50 rounded-xl text-center">
                          <p className="text-xl font-black text-red-700">{statsAutentique.rejeitados}</p>
                          <p className="text-[9px] font-black text-red-400 uppercase">Rejeitados</p>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 font-semibold mt-2">
                        {statsAutentique.producao} em produção · {statsAutentique.sandbox} em teste
                        {statsAutentique.ultimoEnvio && <> · último envio em {fmtDataHora(statsAutentique.ultimoEnvio)}</>}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {editParceiro.parceiro === 'FLASH' && (
                <div className="space-y-3">
                  <div className="p-3 bg-orange-50 rounded-xl space-y-1.5">
                    <span className="inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-orange-100 text-orange-700">📄 Arquivo manual (CSV)</span>
                    <p className="text-[10px] text-orange-800 font-semibold leading-snug">
                      A Flash não tem API integrada aqui. O pedido de benefícios é gerado na tela "Grid de Benefícios"
                      (botão "⚡ Gerar Flash"), já no formato de colunas que a plataforma da Flash espera
                      (Mobilidade / Refeição e Alimentação / Premiação), e enviado manualmente lá.
                    </p>
                  </div>
                  <button
                    onClick={() => router.push('/admin/rh/beneficios')}
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black uppercase tracking-widest text-[11px] py-3 rounded-xl transition-all"
                  >
                    🎁 Ir para Grid de Benefícios
                  </button>
                </div>
              )}

              {editParceiro.parceiro === 'ZAPI' && (
                <div className="space-y-3">
                  <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Instância</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusZapi?.instanceConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusZapi ? '…' : statusZapi.instanceConfigurado ? '✓ Configurada' : '✕ Ausente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Token da instância</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusZapi?.tokenConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusZapi ? '…' : statusZapi.tokenConfigurado ? '✓ Configurado' : '✕ Ausente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Client-Token</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusZapi?.clientTokenConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusZapi ? '…' : statusZapi.clientTokenConfigurado ? '✓ Configurado' : '✕ Ausente'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                      As credenciais (ZAPI_INSTANCE, ZAPI_TOKEN, API_CLIENT_TOKEN) vivem só no ambiente do servidor — nunca são lidas, gravadas ou exibidas aqui.
                    </p>
                  </div>

                  {statsZapi && (
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-2">Uso da integração</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 bg-gray-50 rounded-xl text-center">
                          <p className="text-xl font-black text-[#0C1D4D]">{statsZapi.total}</p>
                          <p className="text-[9px] font-black text-gray-400 uppercase">Automações c/ WhatsApp</p>
                        </div>
                        <div className="p-3 bg-green-50 rounded-xl text-center">
                          <p className="text-xl font-black text-green-700">{statsZapi.ativas}</p>
                          <p className="text-[9px] font-black text-green-500 uppercase">Ativas</p>
                        </div>
                      </div>
                      {statsZapi.ultimoDisparo && (
                        <p className="text-[10px] text-gray-400 font-semibold mt-2">último disparo em {fmtDataHora(statsZapi.ultimoDisparo)}</p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => router.push('/admin/agendamentos')}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[11px] py-3 rounded-xl transition-all"
                  >
                    ⏰ Ir para Agendamentos e Disparos
                  </button>
                </div>
              )}

              {editParceiro.tipo === 'BANCO' && (
                <div className="space-y-3">
                  {editParceiro.parceiro === 'ITAU' && (
                    <div className="p-3 bg-blue-50 rounded-xl space-y-1">
                      <span className="inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">📄 Arquivo manual (SISPAG)</span>
                      <p className="text-[10px] text-blue-800 font-semibold leading-snug">
                        Modo atual: geração de arquivo SISPAG (CNAB240) em RH → Financeiro, com envio manual pelo
                        Itaú Empresas. Integração via API está planejada para uma fase futura.
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Agência débito</label>
                      <input type="text" value={edAgencia} onChange={e => setEdAgencia(e.target.value)} placeholder="0000" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Conta débito</label>
                      <input type="text" value={edConta} onChange={e => setEdConta(e.target.value)} placeholder="00000-0" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">CNPJ da empresa</label>
                      <input type="text" value={edCnpj} onChange={e => setEdCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Razão social</label>
                      <input type="text" value={edRazaoSocial} onChange={e => setEdRazaoSocial(e.target.value)} placeholder="Razão social" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">Esses dados são usados para montar os arquivos SISPAG (CNAB240) do Itaú. Sem eles, os botões "Gerar SISPAG Itaú" ficam bloqueados. A conta débito deve ser informada como "número-dígito" (ex: 09312-4).</p>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditParceiro(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarConfig} className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
