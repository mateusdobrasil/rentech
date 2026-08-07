"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import {
  listarIntegracoesAction, salvarIntegracaoAction,
  statusTokenAutentiqueAction, estatisticasAutentiqueAction,
  statusZapiAction, estatisticasZapiAction, statusMetaAction, statusItauApiAction,
  statusGovBrConsignadoAction,
  obterRoteamentoWhatsAppAction, salvarRoteamentoWhatsAppAction,
  enviarTesteWhatsAppAction, enviarTesteTemplateWhatsAppAction,
  statusP2sAction, testarConexaoP2sAction,
  type ConfigRoteamentoWhatsApp
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
  if (p.includes('GESTOR')) return 'GESTORES';
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
interface StatusMeta {
  tokenConfigurado: boolean; phoneNumberIdConfigurado: boolean; appSecretConfigurado: boolean; verifyTokenConfigurado: boolean;
}
interface StatusItauApiAmbiente {
  clientIdConfigurado: boolean; clientSecretConfigurado: boolean;
  certificadoConfigurado: boolean; chaveConfigurada: boolean;
}
interface StatusItauApi {
  sandbox: StatusItauApiAmbiente; producao: StatusItauApiAmbiente;
}
interface StatusGovBrConsignado {
  cnpjConfigurado: boolean; certificadoConfigurado: boolean; senhaConfigurado: boolean; ambiente: string;
}
interface StatusP2sAmbiente {
  hostConfigurado: boolean; portaConfigurada: boolean; usuarioConfigurado: boolean; senhaConfigurada: boolean; host?: string;
}
interface StatusP2s {
  sandbox: StatusP2sAmbiente; producao: StatusP2sAmbiente;
}

const ICONE_TIPO: Record<string, string> = { BANCO: '🏦', BENEFICIO: '🎁', ASSINATURA: '✍️', MENSAGERIA: '💬', CONSIGNADO: '🏛️', ERP: '🧩' };
const ROTULO_PROVEDOR: Record<'ZAPI' | 'META', string> = { ZAPI: 'Z-API', META: 'Meta (Cloud API)' };

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
  const [statusMeta, setStatusMeta] = useState<StatusMeta | null>(null);
  const [statusItauApi, setStatusItauApi] = useState<StatusItauApi | null>(null);
  const [statusGovBr, setStatusGovBr] = useState<StatusGovBrConsignado | null>(null);
  const [statusP2s, setStatusP2s] = useState<StatusP2s | null>(null);
  const [roteamento, setRoteamento] = useState<ConfigRoteamentoWhatsApp | null>(null);

  const [testeP2sRodando, setTesteP2sRodando] = useState(false);
  const [testeP2sResultado, setTesteP2sResultado] = useState<{ ok: boolean; msg: string } | null>(null);

  const [editParceiro, setEditParceiro] = useState<Integracao | null>(null);
  const [edAtivo, setEdAtivo] = useState(false);
  const [edAmbiente, setEdAmbiente] = useState<'SANDBOX' | 'PRODUCAO'>('SANDBOX');
  const [edAgencia, setEdAgencia] = useState('');
  const [edConta, setEdConta] = useState('');
  const [edCnpj, setEdCnpj] = useState('');
  const [edRazaoSocial, setEdRazaoSocial] = useState('');
  const [edModoRoteamento, setEdModoRoteamento] = useState<'GLOBAL' | 'INDEPENDENTE'>('GLOBAL');
  const [edProvedorGlobal, setEdProvedorGlobal] = useState<'ZAPI' | 'META'>('ZAPI');
  const [edProvedorEnvio, setEdProvedorEnvio] = useState<'ZAPI' | 'META'>('ZAPI');
  const [edProvedorRecebimento, setEdProvedorRecebimento] = useState<'ZAPI' | 'META'>('ZAPI');
  const [salvandoRoteamento, setSalvandoRoteamento] = useState(false);

  const [testeCelular, setTesteCelular] = useState('');
  const [testeEnviando, setTesteEnviando] = useState(false);
  const [testeResultado, setTesteResultado] = useState<{ ok: boolean; msg: string; detalhe?: string } | null>(null);

  const [testeTemplateNome, setTesteTemplateNome] = useState('hello_world');
  const [testeTemplateIdioma, setTesteTemplateIdioma] = useState('en_US');
  const [testeTemplateParametros, setTesteTemplateParametros] = useState('');
  const [testeTemplateBotao, setTesteTemplateBotao] = useState('');
  const [testeTemplateEnviando, setTesteTemplateEnviando] = useState(false);
  const [testeTemplateResultado, setTesteTemplateResultado] = useState<{ ok: boolean; msg: string; detalhe?: string } | null>(null);

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
      const [integ, tokenRes, statsRes, zapiStatusRes, zapiStatsRes, metaStatusRes, roteamentoRes, itauApiStatusRes, govBrStatusRes, p2sStatusRes] = await Promise.all([
        listarIntegracoesAction(),
        statusTokenAutentiqueAction(), estatisticasAutentiqueAction(),
        statusZapiAction(), estatisticasZapiAction(),
        statusMetaAction(), obterRoteamentoWhatsAppAction(),
        statusItauApiAction(), statusGovBrConsignadoAction(),
        statusP2sAction()
      ]);
      if (integ.ok) setIntegracoes(integ.info.integracoes);
      if (tokenRes.ok) setTokenAutentiqueOk(tokenRes.info.configurado);
      if (statsRes.ok) setStatsAutentique(statsRes.info);
      if (zapiStatusRes.ok) setStatusZapi(zapiStatusRes.info);
      if (zapiStatsRes.ok) setStatsZapi(zapiStatsRes.info);
      if (metaStatusRes.ok) setStatusMeta(metaStatusRes.info);
      if (roteamentoRes.ok) setRoteamento(roteamentoRes.info);
      if (itauApiStatusRes.ok) setStatusItauApi(itauApiStatusRes.info);
      if (govBrStatusRes.ok) setStatusGovBr(govBrStatusRes.info);
      if (p2sStatusRes.ok) setStatusP2s(p2sStatusRes.info);
    } finally { setLoading(false); }
  };

  const abrirConfig = (i: Integracao) => {
    setEditParceiro(i); setEdAtivo(i.ativo); setEdAmbiente(i.ambiente as any);
    setEdAgencia(i.config?.agencia_debito || ''); setEdConta(i.config?.conta_debito || '');
    setEdCnpj(i.config?.cnpj || ''); setEdRazaoSocial(i.config?.razao_social || '');
    setTesteCelular(''); setTesteResultado(null);
    setTesteTemplateNome('hello_world'); setTesteTemplateIdioma('en_US'); setTesteTemplateParametros(''); setTesteTemplateResultado(null);
    setTesteP2sResultado(null);
    if (i.parceiro === 'WHATSAPP_ROTEAMENTO' && roteamento) {
      setEdModoRoteamento(roteamento.modo); setEdProvedorGlobal(roteamento.provedor_global);
      setEdProvedorEnvio(roteamento.provedor_envio); setEdProvedorRecebimento(roteamento.provedor_recebimento);
    }
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

  const enviarTeste = async (provedor: 'ZAPI' | 'META') => {
    setTesteEnviando(true); setTesteResultado(null);
    try {
      const res = await enviarTesteWhatsAppAction(provedor, testeCelular);
      setTesteResultado(res.ok
        ? { ok: true, msg: 'Aceito pelo provedor — isso ainda não confirma a entrega no aparelho.', detalhe: res.info?.detalhe }
        : { ok: false, msg: res.erro || 'Falha ao enviar.' });
    } finally { setTesteEnviando(false); }
  };

  const enviarTesteTemplate = async () => {
    setTesteTemplateEnviando(true); setTesteTemplateResultado(null);
    try {
      const res = await enviarTesteTemplateWhatsAppAction(testeTemplateNome, testeTemplateIdioma, testeTemplateParametros, testeCelular, testeTemplateBotao);
      setTesteTemplateResultado(res.ok
        ? { ok: true, msg: 'Template aceito pela Meta.', detalhe: res.info?.detalhe }
        : { ok: false, msg: res.erro || 'Falha ao enviar.' });
    } finally { setTesteTemplateEnviando(false); }
  };

  const testarP2s = async () => {
    if (!editParceiro) return;
    setTesteP2sRodando(true); setTesteP2sResultado(null);
    try {
      const res = await testarConexaoP2sAction(edAmbiente);
      setTesteP2sResultado(res.ok ? { ok: true, msg: res.info?.detalhe || 'Conexão confirmada.' } : { ok: false, msg: res.erro || 'Falha ao conectar.' });
    } finally { setTesteP2sRodando(false); }
  };

  const salvarRoteamento = async () => {
    setSalvandoRoteamento(true);
    try {
      const res = await salvarRoteamentoWhatsAppAction({
        modo: edModoRoteamento, provedor_global: edProvedorGlobal,
        provedor_envio: edProvedorEnvio, provedor_recebimento: edProvedorRecebimento
      });
      if (!res.ok) { alert(res.erro); return; }
      setEditParceiro(null);
      carregar();
    } finally { setSalvandoRoteamento(false); }
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
        <button onClick={() => router.push('/admin/parametros')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
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
                {i.parceiro !== 'WHATSAPP_ROTEAMENTO' && (
                  <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase ${i.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                    {i.ativo ? '● Ativo' : '○ Inativo'}
                  </span>
                )}
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

              {i.parceiro === 'META' && (
                <div className="mb-3 pb-3 border-b border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Credenciais no servidor</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusMeta && statusMeta.tokenConfigurado && statusMeta.phoneNumberIdConfigurado && statusMeta.appSecretConfigurado && statusMeta.verifyTokenConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {!statusMeta ? '…' : (statusMeta.tokenConfigurado && statusMeta.phoneNumberIdConfigurado && statusMeta.appSecretConfigurado && statusMeta.verifyTokenConfigurado) ? '✓ Configuradas' : '✕ Incompletas'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">API oficial do WhatsApp (Meta Cloud API) — alternativa à Z-API.</p>
                </div>
              )}

              {i.parceiro === 'WHATSAPP_ROTEAMENTO' && (
                <div className="mb-3 pb-3 border-b border-gray-100 space-y-2">
                  {roteamento ? (
                    roteamento.modo === 'GLOBAL' ? (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 font-bold uppercase">Modo Global</span>
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">{ROTULO_PROVEDOR[roteamento.provedor_global]}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-500 font-bold uppercase">Envio</span>
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">{ROTULO_PROVEDOR[roteamento.provedor_envio]}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-500 font-bold uppercase">Recebimento</span>
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">{ROTULO_PROVEDOR[roteamento.provedor_recebimento]}</span>
                        </div>
                      </>
                    )
                  ) : <p className="text-[10px] text-gray-400 font-semibold">…</p>}
                </div>
              )}

              {i.parceiro === 'ITAU' && (
                <div className="mb-3 pb-3 border-b border-gray-100 space-y-2">
                  <span className="inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-emerald-100 text-emerald-700">🔌 API SISPAG (PIX)</span>
                  <p className="text-[10px] text-gray-400 font-semibold mt-1.5 leading-snug">
                    Envio de PIX da folha direto via API (Cash Management/SISPAG). TED e demais formas continuam pelo arquivo CNAB240 manual em RH → Financeiro.
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Credenciais {i.ambiente === 'PRODUCAO' ? 'Produção (OAuth + mTLS)' : 'Sandbox (OAuth)'}</span>
                    {(() => {
                      const amb = i.ambiente === 'PRODUCAO' ? statusItauApi?.producao : statusItauApi?.sandbox;
                      // mTLS só é exigido em produção — sandbox funciona só com OAuth.
                      const ok = i.ambiente === 'PRODUCAO'
                        ? !!(amb?.clientIdConfigurado && amb?.clientSecretConfigurado && amb?.certificadoConfigurado && amb?.chaveConfigurada)
                        : !!(amb?.clientIdConfigurado && amb?.clientSecretConfigurado);
                      return (
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {!statusItauApi ? '…' : ok ? '✓ Configuradas' : '✕ Não configuradas'}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              )}

              {i.parceiro === 'GOVBR_CONSIGNADO' && (
                <div className="mb-3 pb-3 border-b border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 font-bold uppercase">Certificado no servidor</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusGovBr && statusGovBr.cnpjConfigurado && statusGovBr.certificadoConfigurado && statusGovBr.senhaConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {!statusGovBr ? '…' : (statusGovBr.cnpjConfigurado && statusGovBr.certificadoConfigurado && statusGovBr.senhaConfigurado) ? '✓ Configurado' : '✕ Incompleto'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">API "Crédito Trabalhador" da Dataprev (mTLS) — consulta consignados dos funcionários em RH → Consignado.</p>
                </div>
              )}

              {i.parceiro === 'P2S' && (
                <div className="mb-3 pb-3 border-b border-gray-100 space-y-2">
                  {(() => {
                    const amb = i.ambiente === 'PRODUCAO' ? statusP2s?.producao : statusP2s?.sandbox;
                    const ok = !!(amb?.hostConfigurado && amb?.portaConfigurada && amb?.usuarioConfigurado && amb?.senhaConfigurada);
                    return (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 font-bold uppercase">Credenciais ({i.ambiente === 'PRODUCAO' ? 'Produção' : 'Sandbox'})</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {!statusP2s ? '…' : ok ? '✓ Configuradas' : '✕ Incompletas'}
                        </span>
                      </div>
                    );
                  })()}
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">ERP PrimeStart (P2S Tecnologia) — servidor de objetos REST, envio e recebimento de dados.</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                {i.parceiro === 'WHATSAPP_ROTEAMENTO' ? <span /> : (
                  <span className={`text-[10px] font-black uppercase ${i.ambiente === 'PRODUCAO' ? 'text-[#0C1D4D]' : 'text-amber-600'}`}>
                    {i.ambiente === 'PRODUCAO' ? '🟢 Produção' : '🟡 Sandbox'}
                  </span>
                )}
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
              {editParceiro.parceiro !== 'WHATSAPP_ROTEAMENTO' && (
                <>
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
                </>
              )}

              {editParceiro.parceiro === 'META' && (
                <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-500 uppercase">Token de acesso</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusMeta?.tokenConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {!statusMeta ? '…' : statusMeta.tokenConfigurado ? '✓ Configurado' : '✕ Ausente'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-500 uppercase">Phone Number ID</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusMeta?.phoneNumberIdConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {!statusMeta ? '…' : statusMeta.phoneNumberIdConfigurado ? '✓ Configurado' : '✕ Ausente'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-500 uppercase">App Secret</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusMeta?.appSecretConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {!statusMeta ? '…' : statusMeta.appSecretConfigurado ? '✓ Configurado' : '✕ Ausente'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-500 uppercase">Verify Token do webhook</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusMeta?.verifyTokenConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                      {!statusMeta ? '…' : statusMeta.verifyTokenConfigurado ? '✓ Configurado' : '✕ Ausente'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                    As credenciais (META_WHATSAPP_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN) vivem só no ambiente do servidor — nunca são lidas, gravadas ou exibidas aqui.
                  </p>
                </div>
              )}

              {editParceiro.parceiro === 'META' && (
                <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                  <label className="block text-[10px] font-black text-gray-500 uppercase">Enviar mensagem de teste (Meta Cloud API)</label>
                  <input type="tel" value={testeCelular} onChange={e => setTesteCelular(e.target.value)} placeholder="DDD + celular (ex: 11987654321)" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                  <button onClick={() => enviarTeste('META')} disabled={testeEnviando} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white font-black uppercase tracking-wider text-[11px] py-2.5 rounded-lg transition-colors">
                    {testeEnviando ? 'Enviando...' : '📨 Enviar teste'}
                  </button>
                  {testeResultado && (
                    <div>
                      <p className={`text-[10px] font-bold ${testeResultado.ok ? 'text-emerald-600' : 'text-red-600'}`}>{testeResultado.msg}</p>
                      {testeResultado.detalhe && (
                        <p className="text-[9px] text-gray-400 font-mono break-all mt-1">{testeResultado.detalhe}</p>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                    Se o número ainda estiver em modo de teste no painel da Meta, ele precisa constar na lista de "Recipient numbers" do App para receber.
                  </p>
                </div>
              )}

              {editParceiro.parceiro === 'META' && (
                <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                  <label className="block text-[10px] font-black text-gray-500 uppercase">Testar Message Template</label>
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                    Ignora a janela de 24h e o roteamento — manda o template direto. Use <code>hello_world</code> / <code>en_US</code> (sem parâmetros) pra validar o envio de template mesmo antes dos nossos templates saírem aprovados.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={testeTemplateNome} onChange={e => setTesteTemplateNome(e.target.value)} placeholder="Nome do template" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                    <input type="text" value={testeTemplateIdioma} onChange={e => setTesteTemplateIdioma(e.target.value)} placeholder="Idioma (ex: en_US)" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                  </div>
                  <input type="text" value={testeTemplateParametros} onChange={e => setTesteTemplateParametros(e.target.value)} placeholder="Parâmetros do corpo, separados por vírgula (ex: 123456)" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-mono" />
                  <input type="text" value={testeTemplateBotao} onChange={e => setTesteTemplateBotao(e.target.value)} placeholder={'Código do botão "Copiar código" (só p/ templates de Autenticação com botão)'} className="w-full p-2 border border-gray-300 rounded-lg text-sm font-mono" />
                  <button onClick={enviarTesteTemplate} disabled={testeTemplateEnviando} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white font-black uppercase tracking-wider text-[11px] py-2.5 rounded-lg transition-colors">
                    {testeTemplateEnviando ? 'Enviando...' : '📨 Testar template'}
                  </button>
                  {testeTemplateResultado && (
                    <div>
                      <p className={`text-[10px] font-bold ${testeTemplateResultado.ok ? 'text-emerald-600' : 'text-red-600'}`}>{testeTemplateResultado.msg}</p>
                      {testeTemplateResultado.detalhe && (
                        <p className="text-[9px] text-gray-400 font-mono break-all mt-1">{testeTemplateResultado.detalhe}</p>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                    Usa o celular informado no teste de texto livre acima.
                  </p>
                </div>
              )}

              {editParceiro.parceiro === 'WHATSAPP_ROTEAMENTO' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Modo</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['GLOBAL', 'INDEPENDENTE'] as const).map(modo => (
                        <button key={modo} onClick={() => setEdModoRoteamento(modo)} className={`p-2.5 rounded-lg text-[11px] font-black uppercase border-2 ${edModoRoteamento === modo ? 'border-[#0C1D4D] bg-blue-50 text-[#0C1D4D]' : 'border-gray-200 text-gray-400'}`}>
                          {modo === 'GLOBAL' ? 'Global' : 'Independente'}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold mt-1.5 leading-snug">
                      {edModoRoteamento === 'GLOBAL'
                        ? 'Um único provedor cuida de envio (automações/lembretes) e recebimento (respostas dos funcionários no fluxo de Ponto).'
                        : 'Envio e recebimento podem usar provedores diferentes.'}
                    </p>
                  </div>

                  {edModoRoteamento === 'GLOBAL' ? (
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Provedor (envio + recebimento)</label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['ZAPI', 'META'] as const).map(p => (
                          <button key={p} onClick={() => setEdProvedorGlobal(p)} className={`p-2.5 rounded-lg text-[11px] font-black uppercase border-2 ${edProvedorGlobal === p ? 'border-[#0C1D4D] bg-blue-50 text-[#0C1D4D]' : 'border-gray-200 text-gray-400'}`}>
                            {ROTULO_PROVEDOR[p]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Provedor de envio</label>
                        <p className="text-[10px] text-gray-400 font-semibold mb-1.5 leading-snug">Mensagens dos nós de agendadores e lembretes.</p>
                        <div className="grid grid-cols-2 gap-2">
                          {(['ZAPI', 'META'] as const).map(p => (
                            <button key={p} onClick={() => setEdProvedorEnvio(p)} className={`p-2.5 rounded-lg text-[11px] font-black uppercase border-2 ${edProvedorEnvio === p ? 'border-[#0C1D4D] bg-blue-50 text-[#0C1D4D]' : 'border-gray-200 text-gray-400'}`}>
                              {ROTULO_PROVEDOR[p]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Provedor de recebimento</label>
                        <p className="text-[10px] text-gray-400 font-semibold mb-1.5 leading-snug">Mensagens recebidas dos colaboradores/funcionários (fluxo de Ponto via WhatsApp).</p>
                        <div className="grid grid-cols-2 gap-2">
                          {(['ZAPI', 'META'] as const).map(p => (
                            <button key={p} onClick={() => setEdProvedorRecebimento(p)} className={`p-2.5 rounded-lg text-[11px] font-black uppercase border-2 ${edProvedorRecebimento === p ? 'border-[#0C1D4D] bg-blue-50 text-[#0C1D4D]' : 'border-gray-200 text-gray-400'}`}>
                              {ROTULO_PROVEDOR[p]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

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

                  <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                    <label className="block text-[10px] font-black text-gray-500 uppercase">Enviar mensagem de teste (Z-API)</label>
                    <input type="tel" value={testeCelular} onChange={e => setTesteCelular(e.target.value)} placeholder="DDD + celular (ex: 11987654321)" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                    <button onClick={() => enviarTeste('ZAPI')} disabled={testeEnviando} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white font-black uppercase tracking-wider text-[11px] py-2.5 rounded-lg transition-colors">
                      {testeEnviando ? 'Enviando...' : '📨 Enviar teste'}
                    </button>
                    {testeResultado && (
                      <div>
                        <p className={`text-[10px] font-bold ${testeResultado.ok ? 'text-emerald-600' : 'text-red-600'}`}>{testeResultado.msg}</p>
                        {testeResultado.detalhe && (
                          <p className="text-[9px] text-gray-400 font-mono break-all mt-1">{testeResultado.detalhe}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => router.push('/admin/agendamentos')}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-[11px] py-3 rounded-xl transition-all"
                  >
                    ⏰ Ir para Agendamentos e Disparos
                  </button>
                </div>
              )}

              {editParceiro.parceiro === 'GOVBR_CONSIGNADO' && (
                <div className="space-y-3">
                  <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">CNPJ do empregador</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusGovBr?.cnpjConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusGovBr ? '…' : statusGovBr.cnpjConfigurado ? '✓ Configurado' : '✕ Ausente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Certificado ICP-Brasil (mTLS)</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusGovBr?.certificadoConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusGovBr ? '…' : statusGovBr.certificadoConfigurado ? '✓ Configurado' : '✕ Ausente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Senha do certificado</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${statusGovBr?.senhaConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusGovBr ? '…' : statusGovBr.senhaConfigurado ? '✓ Configurada' : '✕ Ausente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Ambiente da API</span>
                      <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-blue-100 text-blue-700">
                        {statusGovBr?.ambiente === 'producao' ? 'Produção' : 'Homologação'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                      As credenciais (GOVBR_CONSIGNADO_CNPJ, GOVBR_CONSIGNADO_CERT_PFX_BASE64, GOVBR_CONSIGNADO_CERT_SENHA, GOVBR_CONSIGNADO_AMBIENTE) vivem só no ambiente do servidor — nunca são lidas, gravadas ou exibidas aqui. Autenticação por certificado digital (mTLS), não OAuth.
                    </p>
                  </div>
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                    Consulta ao vivo (com certificado) e importação manual do arquivo do Portal Emprega Brasil (sem certificado) alimentam a mesma lista, em RH → Consignado.
                  </p>
                  <button
                    onClick={() => router.push('/admin/rh/consignado')}
                    className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-[11px] py-3 rounded-xl transition-all"
                  >
                    🏛️ Ir para RH → Consignado
                  </button>
                </div>
              )}

              {editParceiro.parceiro === 'P2S' && (() => {
                const amb = edAmbiente === 'PRODUCAO' ? statusP2s?.producao : statusP2s?.sandbox;
                return (
                <div className="space-y-3">
                  <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                    <p className="text-[10px] font-black text-gray-500 uppercase">Credenciais — {edAmbiente === 'PRODUCAO' ? 'Produção' : 'Sandbox'}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Servidor (host)</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.hostConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusP2s ? '…' : amb?.hostConfigurado ? '✓ Configurado' : '✕ Ausente'}
                      </span>
                    </div>
                    {amb?.host && <p className="text-[9px] text-gray-400 font-mono break-all -mt-1">{amb.host}</p>}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Porta</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.portaConfigurada ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusP2s ? '…' : amb?.portaConfigurada ? '✓ Configurada' : '✕ Ausente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Usuário da API</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.usuarioConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusP2s ? '…' : amb?.usuarioConfigurado ? '✓ Configurado' : '✕ Ausente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Senha da API</span>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.senhaConfigurada ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                        {!statusP2s ? '…' : amb?.senhaConfigurada ? '✓ Configurada' : '✕ Ausente'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                      {edAmbiente === 'SANDBOX'
                        ? 'Sandbox usa por padrão a instância Demo pública da P2S (demo.cloud.primestart.net, admin/admin) — sempre disponível, sem precisar configurar nada. Dá pra sobrepor com P2S_API_HOST_SANDBOX / _PORTA_SANDBOX / _USUARIO_SANDBOX / _SENHA_SANDBOX.'
                        : 'Credenciais de Produção (P2S_API_HOST, P2S_API_PORTA, P2S_API_USUARIO, P2S_API_SENHA, ou as variantes com sufixo _PRODUCAO) vivem só no ambiente do servidor — nunca são lidas, gravadas ou exibidas aqui.'}
                    </p>
                  </div>

                  <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-2">
                    <label className="block text-[10px] font-black text-gray-500 uppercase">Testar conexão — {edAmbiente === 'PRODUCAO' ? 'Produção' : 'Sandbox'}</label>
                    <p className="text-[10px] text-gray-400 font-semibold leading-snug">Faz uma consulta leve (0 resultados esperados) só para confirmar rede e autenticação, sem depender do tamanho da base do cliente.</p>
                    <button onClick={testarP2s} disabled={testeP2sRodando} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white font-black uppercase tracking-wider text-[11px] py-2.5 rounded-lg transition-colors">
                      {testeP2sRodando ? 'Testando...' : '🔌 Testar conexão'}
                    </button>
                    {testeP2sResultado && (
                      <p className={`text-[10px] font-bold ${testeP2sResultado.ok ? 'text-emerald-600' : 'text-red-600'}`}>{testeP2sResultado.msg}</p>
                    )}
                  </div>
                </div>
                );
              })()}

              {editParceiro.tipo === 'BANCO' && (
                <div className="space-y-3">
                  {editParceiro.parceiro === 'ITAU' && (
                    <div className="p-3 bg-emerald-50 rounded-xl space-y-1">
                      <span className="inline-block text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-emerald-100 text-emerald-700">🔌 API SISPAG (PIX)</span>
                      <p className="text-[10px] text-emerald-900 font-semibold leading-snug">
                        Pagamentos via PIX (chave) são enviados direto pela API Cash Management/SISPAG do Itaú, disparado pelo botão
                        "↗ Enviar ao banco" no histórico de lotes. TED e demais formas continuam pelo arquivo CNAB240 manual.
                      </p>
                    </div>
                  )}

                  {editParceiro.parceiro === 'ITAU' && (
                    <div className="p-3 bg-[#F8FAFC] rounded-xl space-y-3">
                      <p className="text-[10px] font-black text-gray-500 uppercase">Credenciais da API SISPAG</p>
                      <p className="text-[10px] text-gray-400 font-semibold leading-snug -mt-2">Sandbox e Produção são apps separados no portal do Itaú — client_id/secret próprios de cada um. mTLS (certificado) só é exigido em produção; o sandbox funciona só com OAuth.</p>

                      {([['sandbox', 'Sandbox'], ['producao', 'Produção']] as const).map(([chave, rotulo]) => {
                        const amb = statusItauApi?.[chave];
                        const exigeCertificado = chave === 'producao';
                        return (
                          <div key={chave} className="space-y-1.5 pt-1 border-t border-gray-200 first:border-t-0 first:pt-0">
                            <p className="text-[10px] font-black text-gray-600 uppercase">{rotulo}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-gray-500 font-bold uppercase">Client ID</span>
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.clientIdConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                {!statusItauApi ? '…' : amb?.clientIdConfigurado ? '✓ Configurado' : '✕ Ausente'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-gray-500 font-bold uppercase">Client Secret</span>
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.clientSecretConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                {!statusItauApi ? '…' : amb?.clientSecretConfigurado ? '✓ Configurado' : '✕ Ausente'}
                              </span>
                            </div>
                            {exigeCertificado && (
                              <>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-gray-500 font-bold uppercase">Chave privada (mTLS)</span>
                                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.chaveConfigurada ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                    {!statusItauApi ? '…' : amb?.chaveConfigurada ? '✓ Configurada' : '✕ Ausente'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-gray-500 font-bold uppercase">Certificado (CRT, mTLS)</span>
                                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${amb?.certificadoConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                    {!statusItauApi ? '…' : amb?.certificadoConfigurado ? '✓ Configurado' : '✕ Aguardando emissão pelo Itaú'}
                                  </span>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}

                      <p className="text-[10px] text-gray-400 font-semibold leading-snug">
                        As credenciais (ITAU_API_CLIENT_ID_SANDBOX/PRODUCAO, ITAU_API_CLIENT_SECRET_SANDBOX/PRODUCAO, ITAU_API_CERT_KEY_BASE64_SANDBOX/PRODUCAO, ITAU_API_CERT_PEM_BASE64_SANDBOX/PRODUCAO) vivem só no ambiente do servidor — nunca são lidas, gravadas ou exibidas aqui. O header x-itau-apikey usa o próprio client_id, sem segredo à parte. A base URL de negócio (produção/sandbox) é escolhida automaticamente pelo Ambiente selecionado acima.
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
                  <p className="text-[10px] text-gray-400 font-semibold leading-snug">Esses dados são usados para montar os arquivos SISPAG (CNAB240) e também como conta pagadora nos envios de PIX via API. Sem eles, os botões "Gerar SISPAG Itaú" ficam bloqueados e o envio via API falha. A conta débito deve ser informada como "número-dígito" (ex: 09312-4).</p>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditParceiro(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              {editParceiro.parceiro === 'WHATSAPP_ROTEAMENTO' ? (
                <button onClick={salvarRoteamento} disabled={salvandoRoteamento} className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl">
                  {salvandoRoteamento ? 'Salvando...' : 'Salvar'}
                </button>
              ) : (
                <button onClick={salvarConfig} className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl">Salvar</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
