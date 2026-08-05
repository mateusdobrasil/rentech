"use client";

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import { normalizarPermissao } from '../../../lib/permissoes';
import { consultarPagamentosItauAction, consultarPagamentoItauAction, type FiltrosConsultaItau } from './actions';
import { listarIntegracoesAction, statusItauApiAction } from '../../integracao/actions';
import ExigirMFA from '../ExigirMFA';

const BRL = (v: string | number | null | undefined) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (d: string | null | undefined) => {
  if (!d) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  if (!iso) return d;
  const [a, m, dd] = iso.split('-');
  return `${dd}/${m}/${a}`;
};

// Domínio documentado pela Especificação Técnica do Itaú (GET /pagamentos_sispag)
const STATUS_LABEL: Record<string, string> = { AE: 'A Efetuar', EF: 'Efetuado', NE: 'Não Efetuado', TD: 'Todos' };
const STATUS_COR: Record<string, string> = {
  AE: 'bg-amber-100 text-amber-700',
  EF: 'bg-emerald-100 text-emerald-700',
  NE: 'bg-red-100 text-red-600',
};

interface ItemPagamentoItau {
  id_pagamento?: string;
  numero_lote?: string;
  numero_lancamento?: string;
  nome_favorecido?: string;
  nome_beneficiario?: string;
  cpf_cnpj?: string;
  codigo_banco?: string;
  numero_agencia?: string;
  numero_conta?: string;
  referencia_empresa?: string;
  data_pagamento?: string;
  valor_pagamento?: string;
  tipo_pagamento?: string;
  status?: string;
  motivo?: string;
}

interface Integracao {
  id: number; parceiro: string; nome_exibicao: string; tipo: string;
  ativo: boolean; ambiente: string; config: any;
}
interface StatusItauApiAmbiente {
  clientIdConfigurado: boolean; clientSecretConfigurado: boolean;
  certificadoConfigurado: boolean; chaveConfigurada: boolean;
}

export default function IntegracaoFinanceiraPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  // Abas por instituição bancária — hoje só o Itaú está integrado via API;
  // se outro banco entrar no futuro, basta somar um item aqui e um painel
  // próprio, sem mexer no resto da tela.
  const INSTITUICOES = [{ chave: 'ITAU', rotulo: '🏦 Itaú' }] as const;
  const [instituicaoAtiva, setInstituicaoAtiva] = useState<typeof INSTITUICOES[number]['chave']>('ITAU');

  const [integracaoItau, setIntegracaoItau] = useState<Integracao | null>(null);
  const [statusItauApi, setStatusItauApi] = useState<{ sandbox: StatusItauApiAmbiente; producao: StatusItauApiAmbiente } | null>(null);

  const hoje = () => new Date().toISOString().slice(0, 10);
  const trintaDiasAtras = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [filtros, setFiltros] = useState<FiltrosConsultaItau>({
    tipoLista: 'Detalhada', dataInicial: trintaDiasAtras(), dataFinal: hoje(), status: undefined,
  });
  const [consultando, setConsultando] = useState(false);
  const [resultados, setResultados] = useState<ItemPagamentoItau[]>([]);
  const [totalResultado, setTotalResultado] = useState<string | null>(null);
  const [jaConsultou, setJaConsultou] = useState(false);

  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<any | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();
      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes').select('permissoes_permitidas')
        .eq('endereco_route', pathname).single();
      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];
      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true); setAuthLoading(false); return;
      }

      setAuthLoading(false);
      carregar();
    }
    checkAuth();
  }, [router, pathname]);

  const carregar = async () => {
    const [integRes, statusRes] = await Promise.all([listarIntegracoesAction(), statusItauApiAction()]);
    if (integRes.ok) setIntegracaoItau(integRes.info.integracoes.find((i: Integracao) => i.parceiro === 'ITAU') || null);
    if (statusRes.ok) setStatusItauApi(statusRes.info);
  };

  const consultar = async () => {
    setConsultando(true);
    try {
      const res = await consultarPagamentosItauAction(filtros);
      if (!res.ok) { alert(res.erro || 'Não foi possível consultar.'); setResultados([]); setTotalResultado(null); return; }
      setResultados(res.info.itens || []);
      setTotalResultado(res.info.total ?? null);
      setJaConsultou(true);
    } finally {
      setConsultando(false);
    }
  };

  const verDetalhe = async (idPagamento: string) => {
    setDetalheId(idPagamento);
    setDetalhe(null);
    setCarregandoDetalhe(true);
    try {
      const res = await consultarPagamentoItauAction(idPagamento);
      if (!res.ok) { alert(res.erro || 'Não foi possível abrir o detalhe.'); setDetalheId(null); return; }
      setDetalhe(res.info.pagamento);
    } finally {
      setCarregandoDetalhe(false);
    }
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar esta página.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  const ambienteAtual = integracaoItau?.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX';
  const credenciaisAmbiente = statusItauApi ? (ambienteAtual === 'PRODUCAO' ? statusItauApi.producao : statusItauApi.sandbox) : null;

  return (
    <ExigirMFA>
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          🔌 <strong>Integração Bancária</strong>. Consultas diretas às APIs dos bancos integrados.
        </p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO FINANCEIRO
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm mb-4">
          {INSTITUICOES.map(inst => (
            <button key={inst.chave} onClick={() => setInstituicaoAtiva(inst.chave)}
              className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${instituicaoAtiva === inst.chave ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
              {inst.rotulo}
            </button>
          ))}
        </div>

        {instituicaoAtiva === 'ITAU' && (<>
          {/* Status da integração — espelha o que está configurado em Integrações, sem duplicar o cadastro */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4 flex flex-wrap items-center gap-4">
            <div>
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">🏦 API SISPAG (Cash Management)</h3>
              <p className="text-[11px] text-gray-500">Consulta de pagamentos já lançados no SISPAG — via API ou arquivo CNAB manual.</p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase ${ambienteAtual === 'PRODUCAO' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>
                Ambiente: {ambienteAtual === 'PRODUCAO' ? 'Produção' : 'Sandbox'}
              </span>
              <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase ${integracaoItau?.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {integracaoItau?.ativo ? '✓ Ativa' : '✕ Inativa'}
              </span>
              <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase ${credenciaisAmbiente?.clientIdConfigurado && credenciaisAmbiente?.clientSecretConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {!statusItauApi ? '…' : credenciaisAmbiente?.clientIdConfigurado && credenciaisAmbiente?.clientSecretConfigurado ? '✓ Credenciais OK' : '✕ Credenciais incompletas'}
              </span>
              <button onClick={() => router.push('/admin/integracao')} className="text-[10px] font-black bg-[#F8FAFC] border border-gray-300 text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg uppercase tracking-wider transition-colors">
                ⚙ Configurar
              </button>
            </div>
          </div>

          {/* Consulta de pagamentos — GET /pagamentos_sispag */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4">
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">🔎 Consulta de Pagamentos</h3>
            <div className="flex flex-wrap items-end gap-3 mb-2">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data inicial</label>
                <input type="date" value={filtros.dataInicial || ''} onChange={e => setFiltros(f => ({ ...f, dataInicial: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data final</label>
                <input type="date" value={filtros.dataFinal || ''} onChange={e => setFiltros(f => ({ ...f, dataFinal: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Status</label>
                <select value={filtros.status || ''} onChange={e => setFiltros(f => ({ ...f, status: (e.target.value || undefined) as FiltrosConsultaItau['status'] }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]">
                  <option value="">Todos</option>
                  <option value="AE">A Efetuar</option>
                  <option value="EF">Efetuado</option>
                  <option value="NE">Não Efetuado</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nº do lote</label>
                <input type="text" placeholder="opcional" value={filtros.numeroLote || ''} onChange={e => setFiltros(f => ({ ...f, numeroLote: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC] w-32" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Lista</label>
                <select value={filtros.tipoLista || 'Detalhada'} onChange={e => setFiltros(f => ({ ...f, tipoLista: e.target.value as FiltrosConsultaItau['tipoLista'] }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]">
                  <option value="Detalhada">Detalhada</option>
                  <option value="Lote">Por lote</option>
                </select>
              </div>
              <button onClick={consultar} disabled={consultando} className="text-xs font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
                {consultando ? '⏳ Consultando...' : '🔎 Consultar'}
              </button>
            </div>

            {jaConsultou && (
              <div className="pt-3 border-t border-gray-100 mt-2">
                <p className="text-[11px] text-gray-500 font-bold mb-2">
                  {resultados.length} pagamento(s) encontrado(s){totalResultado ? ` · Total: ${BRL(totalResultado)}` : ''}
                </p>
                {resultados.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-4 text-center">Nenhum pagamento encontrado para os filtros informados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[9px] font-black text-gray-400 uppercase border-b border-gray-200">
                          <th className="py-2 pr-3">Favorecido</th>
                          <th className="py-2 pr-3">Valor</th>
                          <th className="py-2 pr-3">Data pagto.</th>
                          <th className="py-2 pr-3">Tipo</th>
                          <th className="py-2 pr-3">Lote / Lanç.</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Motivo</th>
                          <th className="py-2 pr-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultados.map((p, idx) => (
                          <tr key={p.id_pagamento || idx} className="border-b border-gray-100 hover:bg-[#F8FAFC]">
                            <td className="py-2 pr-3 font-bold">{p.nome_favorecido || p.nome_beneficiario || '—'}</td>
                            <td className="py-2 pr-3 font-bold">{BRL(p.valor_pagamento)}</td>
                            <td className="py-2 pr-3">{fmtData(p.data_pagamento)}</td>
                            <td className="py-2 pr-3">{p.tipo_pagamento || '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{p.numero_lote || '—'} / {p.numero_lancamento || '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_COR[p.status || ''] || 'bg-gray-100 text-gray-500'}`}>
                                {STATUS_LABEL[p.status || ''] || p.status || '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-gray-400">{p.motivo || '—'}</td>
                            <td className="py-2 pr-3">
                              {p.id_pagamento && (
                                <button onClick={() => verDetalhe(p.id_pagamento!)} className="text-[10px] font-black text-[#1E40AF] hover:underline uppercase">
                                  Detalhes
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </>)}
      </div>

      {/* Modal de detalhe — GET /pagamentos_sispag/{id}, inclui histórico de etapas */}
      {detalheId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetalheId(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">Detalhe do Pagamento</h3>
              <button onClick={() => setDetalheId(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            {carregandoDetalhe && <p className="text-xs text-gray-400 py-6 text-center">Carregando...</p>}

            {!carregandoDetalhe && detalhe && (
              <div className="space-y-3">
                {detalhe.dados_pagamento && (
                  <div className="bg-[#F8FAFC] rounded-lg p-3 text-xs space-y-1">
                    <p><span className="text-gray-400">Favorecido:</span> <strong>{detalhe.dados_pagamento.nome_favorecido || '—'}</strong></p>
                    <p><span className="text-gray-400">Valor:</span> <strong>{BRL(detalhe.dados_pagamento.valor_pagamento)}</strong></p>
                    <p><span className="text-gray-400">Banco:</span> {detalhe.dados_pagamento.nome_banco_favorecido || '—'} · Ag {detalhe.dados_pagamento.numero_agencia_favorecido || '—'} · C/C {detalhe.dados_pagamento.numero_conta_favorecido || '—'}</p>
                  </div>
                )}
                {detalhe.dados_debito && (
                  <div className="bg-[#F8FAFC] rounded-lg p-3 text-xs space-y-1">
                    <p className="text-[9px] font-black text-gray-400 uppercase mb-1">Débito</p>
                    <p>{detalhe.dados_debito.nome_empresa_debito || '—'} · Ag {detalhe.dados_debito.numero_agencia_debito || '—'} · C/C {detalhe.dados_debito.numero_conta_debito || '—'}</p>
                  </div>
                )}
                {Array.isArray(detalhe.historico_pagamento) && detalhe.historico_pagamento.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase mb-2">Histórico</p>
                    <div className="space-y-2">
                      {detalhe.historico_pagamento.map((h: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs border-b border-gray-100 pb-1.5">
                          <span className="font-bold">{h.status}</span>
                          <span className="text-gray-400">{h.data} {h.nome_operador ? `· ${h.nome_operador}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!detalhe.dados_pagamento && !detalhe.historico_pagamento && (
                  <pre className="text-[10px] bg-[#F8FAFC] rounded-lg p-3 overflow-x-auto">{JSON.stringify(detalhe, null, 2)}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </ExigirMFA>
  );
}
