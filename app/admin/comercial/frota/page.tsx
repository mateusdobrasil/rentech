"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';

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

// Listas fixas de apoio
const ICONE_TIPO: Record<string, string> = {
  'CAMINHÃO': '🚛', 'VAN': '🚐', 'CARRO': '🚗', 'UTILITÁRIO': '🚚',
  'CARRETA': '⛟', 'MOTO': '🏍️', 'ÔNIBUS': '🚌', 'OUTRO': '🚙'
};
const STATUS_VEICULO = ['ATIVO', 'EM MANUTENÇÃO', 'INATIVO'];
const COR_STATUS: Record<string, string> = {
  'ATIVO': 'bg-green-100 text-green-700 border-green-300',
  'EM MANUTENÇÃO': 'bg-amber-100 text-amber-700 border-amber-300',
  'INATIVO': 'bg-gray-100 text-gray-500 border-gray-300'
};
const PROPRIEDADE_VEICULO = ['PRÓPRIO', 'ALUGADO'];
const COR_PROPRIEDADE: Record<string, string> = {
  'PRÓPRIO': 'bg-slate-100 text-slate-600 border-slate-300',
  'ALUGADO': 'bg-indigo-100 text-indigo-700 border-indigo-300'
};
const ICONE_DOCUMENTO: Record<string, string> = {
  'APÓLICE DE SEGURO': '🛡️', 'CRLV': '🪪', 'CONTRATO DE LOCAÇÃO': '📃', 'NOTA FISCAL': '🧾', 'OUTRO': '📎'
};

// Interfaces do Banco de Dados
interface Veiculo {
  id: string;
  apelido: string;
  tipo: string;
  marca?: string;
  modelo?: string;
  ano_fabricacao?: number | null;
  ano_modelo?: number | null;
  placa: string;
  renavam?: string;
  chassi?: string;
  cor?: string;
  combustivel?: string;
  km_atual?: number | null;
  status: string;
  propriedade: string;
  exibir_na_frota: boolean;
  locacao_locadora?: string;
  locacao_vigencia_inicio?: string | null;
  locacao_vigencia_fim?: string | null;
  locacao_apolice?: string;
  locacao_contato_nome?: string;
  locacao_contato_telefone?: string;
  apolice_numero?: string;
  segurado_nome?: string;
  segurado_cnpj?: string;
  seguradora?: string;
  seguradora_telefone?: string;
  corretora?: string;
  seguro_vigencia_inicio?: string | null;
  seguro_vigencia_fim?: string | null;
  crlv_vencimento?: string | null;
  ipva_vencimento?: string | null;
  observacoes?: string;
}

interface Documento {
  id: string;
  veiculo_id: string;
  tipo: string;
  descricao?: string;
  arquivo_url: string;
}

// Calcula o status de vencimento de uma data (seguro, CRLV, locação)
function getStatusVencimento(dataStr?: string | null): { texto: string; cor: string } {
  if (!dataStr) return { texto: 'Sem data cadastrada', cor: 'bg-gray-100 text-gray-500 border-gray-300' };
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${dataStr}T00:00:00`);
  const diffDias = Math.ceil((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDias < 0) return { texto: `Vencido há ${Math.abs(diffDias)}d`, cor: 'bg-red-100 text-red-700 border-red-300' };
  if (diffDias <= 30) return { texto: `Vence em ${diffDias}d`, cor: 'bg-amber-100 text-amber-700 border-amber-300' };
  return { texto: `Válido até ${alvo.toLocaleDateString('pt-BR')}`, cor: 'bg-green-100 text-green-700 border-green-300' };
}

// Pior urgência entre os documentos do veículo (CRLV + IPVA + Seguro ou Locação, conforme o caso)
function getUrgenciaVeiculo(v: Veiculo): 'vencido' | 'proximo' | null {
  const status = [getStatusVencimento(v.crlv_vencimento), getStatusVencimento(v.ipva_vencimento)];
  status.push(v.propriedade === 'ALUGADO' ? getStatusVencimento(v.locacao_vigencia_fim) : getStatusVencimento(v.seguro_vigencia_fim));

  if (status.some(s => s.cor.includes('red'))) return 'vencido';
  if (status.some(s => s.cor.includes('amber'))) return 'proximo';
  return null;
}

export default function ComercialFrotaPage() {
  const router = useRouter();
  const pathname = usePathname();

  // Estados de Segurança e Autenticação
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  // Estados de Dados
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [filtroPropriedade, setFiltroPropriedade] = useState('TODOS');

  // Veículo selecionado (ficha lateral)
  const [veiculoSelecionadoId, setVeiculoSelecionadoId] = useState('');

  // 1. Validar Sessão e Consultar Permissões Dinâmicas no Banco
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();

      if (perfilError || !perfil) {
        console.error("Erro crítico ao buscar perfil do usuário:", perfilError);
        router.push('/login');
        return;
      }

      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }

      setAuthLoading(false);
      carregarDados();
    }
    checkAuth();
  }, [router, pathname]);

  // 2. Carregar apenas os veículos liberados para exibição na Frota
  const carregarDados = async () => {
    setLoading(true);
    const { data: veiculosData } = await supabase
      .from('frota_veiculos').select('*').eq('exibir_na_frota', true).order('apelido', { ascending: true });

    if (veiculosData) {
      setVeiculos(veiculosData);
      const ids = veiculosData.map(v => v.id);
      if (ids.length > 0) {
        const { data: documentosData } = await supabase
          .from('frota_documentos').select('id, veiculo_id, tipo, descricao, arquivo_url').in('veiculo_id', ids).eq('visivel_frota', true);
        setDocumentos(documentosData || []);
      } else {
        setDocumentos([]);
      }
    }
    setLoading(false);
  };

  // Filtro Dinâmico
  const veiculosFiltrados = useMemo(() => {
    return veiculos.filter(v => {
      const termo = busca.toLowerCase();
      const matchBusca = v.apelido.toLowerCase().includes(termo) || (v.placa || '').toLowerCase().includes(termo) || (v.modelo || '').toLowerCase().includes(termo);
      const matchStatus = filtroStatus === 'TODOS' || v.status === filtroStatus;
      const matchPropriedade = filtroPropriedade === 'TODOS' || v.propriedade === filtroPropriedade;
      return matchBusca && matchStatus && matchPropriedade;
    });
  }, [veiculos, busca, filtroStatus, filtroPropriedade]);

  // Veículos com documentação vencida ou a vencer em até 30 dias
  const veiculosComAlerta = useMemo(() => {
    return veiculos.filter(v => getUrgenciaVeiculo(v) !== null);
  }, [veiculos]);

  // Mantém sempre um veículo selecionado para a ficha lateral, acompanhando os filtros
  useEffect(() => {
    if (veiculosFiltrados.length === 0) return;
    if (!veiculosFiltrados.some(v => v.id === veiculoSelecionadoId)) {
      setVeiculoSelecionadoId(veiculosFiltrados[0].id);
    }
  }, [veiculosFiltrados, veiculoSelecionadoId]);

  const veiculoDetalhe = useMemo(() => {
    return veiculos.find(v => v.id === veiculoSelecionadoId) || null;
  }, [veiculos, veiculoSelecionadoId]);

  // ============================================================================
  // RENDERIZAÇÃO
  // ============================================================================

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Frota.</p>
          <button onClick={() => router.push('/admin/comercial')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Comercial
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          🚚 <strong>Frota da Empresa</strong>. Consulte os veículos liberados para visualização pelo comercial.
        </p>
        <button onClick={() => router.push('/admin/comercial')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO COMERCIAL
        </button>
      </div>

      <div className="px-4 md:px-8 py-6 flex-grow flex flex-col">
        {veiculosComAlerta.length > 0 && (
          <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg">
            ⚠️ {veiculosComAlerta.length} veículo(s) com Seguro, Licenciamento, IPVA ou Contrato de Locação vencido ou vencendo nos próximos 30 dias.
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando frota...</div>
        ) : veiculos.length === 0 ? (
          <div className="text-center py-12 text-[#94A3B8] font-bold text-sm bg-white rounded-xl border border-dashed border-[#CBD5E1]">Nenhum veículo disponível para visualização no momento.</div>
        ) : (
          <div className="flex flex-col md:flex-row gap-5 flex-grow min-h-0">
            {/* SIDEBAR: busca, filtros e lista de veículos */}
            <div className="w-full md:w-80 flex-shrink-0 flex flex-col gap-3">
              <input
                type="text"
                placeholder="🔍 Buscar..."
                className="p-2.5 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none bg-white"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <div className="flex gap-2">
                <select
                  className="flex-1 p-2 border-2 border-[#E2E8F0] rounded-lg text-[11px] font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white"
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value)}
                >
                  <option value="TODOS">TODOS OS STATUS</option>
                  {STATUS_VEICULO.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  className="flex-1 p-2 border-2 border-[#E2E8F0] rounded-lg text-[11px] font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white"
                  value={filtroPropriedade}
                  onChange={(e) => setFiltroPropriedade(e.target.value)}
                >
                  <option value="TODOS">PRÓPRIO / ALUGADO</option>
                  {PROPRIEDADE_VEICULO.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm overflow-y-auto flex-grow max-h-[70vh] md:max-h-none divide-y divide-[#F1F5F9]">
                {veiculosFiltrados.length === 0 ? (
                  <p className="text-center text-[#94A3B8] text-xs font-bold p-6">Nenhum veículo encontrado.</p>
                ) : (
                  veiculosFiltrados.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setVeiculoSelecionadoId(v.id)}
                      className={`w-full text-left p-3 flex items-center gap-3 transition-colors ${v.id === veiculoSelecionadoId ? 'bg-blue-50 border-l-4 border-[#336699]' : 'hover:bg-[#F8FAFC] border-l-4 border-transparent'}`}
                    >
                      <span className="relative text-2xl flex-shrink-0">
                        {ICONE_TIPO[v.tipo] || '🚙'}
                        {(() => {
                          const urgencia = getUrgenciaVeiculo(v);
                          if (!urgencia) return null;
                          return (
                            <span
                              className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white ${urgencia === 'vencido' ? 'bg-red-500' : 'bg-amber-500'}`}
                              title={urgencia === 'vencido' ? 'Documento vencido' : 'Documento vence em até 30 dias'}
                            />
                          );
                        })()}
                      </span>
                      <div className="min-w-0 flex-grow">
                        <p className="font-black text-[#0C1D4D] text-xs uppercase truncate">{v.apelido}</p>
                        <p className="text-[10px] text-[#64748B] font-bold uppercase">{v.placa}</p>
                      </div>
                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border flex-shrink-0 ${COR_STATUS[v.status] || COR_STATUS['INATIVO']}`}>{v.status}</span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* FICHA COMPLETA DO VEÍCULO SELECIONADO */}
            <div className="flex-grow bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-y-auto">
              {!veiculoDetalhe ? (
                <div className="h-full flex items-center justify-center text-[#94A3B8] text-sm font-bold p-12 text-center">Selecione um veículo na lista ao lado para ver a ficha completa.</div>
              ) : (
                <FichaVeiculo veiculo={veiculoDetalhe} documentos={documentos.filter(d => d.veiculo_id === veiculoDetalhe.id)} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// FICHA COMPLETA DO VEÍCULO (somente leitura)
// ============================================================================
function Campo({ label, valor }: { label: string; valor?: string | number | null }) {
  return (
    <div>
      <span className="block text-[10px] font-bold text-[#94A3B8] uppercase tracking-wide mb-0.5">{label}</span>
      <span className="block text-sm font-bold text-[#0C1D4D]">{valor || valor === 0 ? valor : '—'}</span>
    </div>
  );
}

function FichaVeiculo({ veiculo, documentos }: { veiculo: Veiculo; documentos: Documento[] }) {
  const seguro = getStatusVencimento(veiculo.seguro_vigencia_fim);
  const crlv = getStatusVencimento(veiculo.crlv_vencimento);
  const ipva = getStatusVencimento(veiculo.ipva_vencimento);
  const locacao = getStatusVencimento(veiculo.locacao_vigencia_fim);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{ICONE_TIPO[veiculo.tipo] || '🚙'}</span>
          <div>
            <h2 className="font-black text-[#0C1D4D] text-lg uppercase tracking-wide">{veiculo.apelido}</h2>
            <p className="text-xs text-[#64748B] font-bold uppercase">{veiculo.placa} · {veiculo.tipo}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full border ${COR_STATUS[veiculo.status] || COR_STATUS['INATIVO']}`}>{veiculo.status}</span>
          <span className={`text-[10px] font-black uppercase px-3 py-1.5 rounded-full border ${COR_PROPRIEDADE[veiculo.propriedade] || COR_PROPRIEDADE['PRÓPRIO']}`}>{veiculo.propriedade || 'PRÓPRIO'}</span>
        </div>
      </div>

      <div>
        <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Dados do Veículo</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Campo label="Marca" valor={veiculo.marca} />
          <Campo label="Modelo" valor={veiculo.modelo} />
          <Campo label="Ano Fabricação" valor={veiculo.ano_fabricacao} />
          <Campo label="Ano Modelo" valor={veiculo.ano_modelo} />
          <Campo label="RENAVAM" valor={veiculo.renavam} />
          <Campo label="Chassi" valor={veiculo.chassi} />
          <Campo label="Cor" valor={veiculo.cor} />
          <Campo label="Combustível" valor={veiculo.combustivel} />
          <Campo label="KM Atual" valor={veiculo.km_atual ? `${veiculo.km_atual.toLocaleString('pt-BR')} km` : undefined} />
        </div>
      </div>

      {veiculo.propriedade === 'ALUGADO' ? (
        <div>
          <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Dados da Locação</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Campo label="Locadora" valor={veiculo.locacao_locadora} />
            <Campo label="Apólice da Locadora" valor={veiculo.locacao_apolice} />
            <Campo label="Contato" valor={veiculo.locacao_contato_nome} />
            <Campo label="Telefone" valor={veiculo.locacao_contato_telefone} />
          </div>
          <div className="flex items-center gap-2 mt-4">
            <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Vigência do Contrato</span>
            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${locacao.cor}`}>{locacao.texto}</span>
          </div>
        </div>
      ) : (
        <div>
          <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Dados do Seguro</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Campo label="Apólice" valor={veiculo.apolice_numero} />
            <Campo label="Seguradora" valor={veiculo.seguradora} />
            <Campo label="Segurado" valor={veiculo.segurado_nome} />
            <Campo label="CNPJ do Segurado" valor={veiculo.segurado_cnpj} />
            <Campo label="Telefone Seguradora" valor={veiculo.seguradora_telefone} />
            <Campo label="Corretora" valor={veiculo.corretora} />
          </div>
          <div className="flex items-center gap-2 mt-4">
            <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Vigência do Seguro</span>
            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${seguro.cor}`}>{seguro.texto}</span>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Documentação</h4>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span className="text-[10px] text-[#94A3B8] font-bold uppercase">Licenciamento</span>
          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${crlv.cor}`}>{crlv.texto}</span>
          <span className="text-[10px] text-[#94A3B8] font-bold uppercase">IPVA</span>
          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${ipva.cor}`}>{ipva.texto}</span>
        </div>
        {documentos.length === 0 ? (
          <p className="text-xs text-[#94A3B8] font-medium">Nenhum documento disponível para visualização.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {documentos.map(doc => (
              <a key={doc.id} href={doc.arquivo_url} target="_blank" rel="noopener noreferrer" className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-2 w-fit">
                <span>{ICONE_DOCUMENTO[doc.tipo] || '📎'}</span>
                <span className="uppercase">{doc.tipo}</span>
                {doc.descricao && <span className="text-[#94A3B8] font-medium normal-case">— {doc.descricao}</span>}
              </a>
            ))}
          </div>
        )}
      </div>

      {veiculo.observacoes && (
        <div>
          <h4 className="text-[10px] font-black text-[#0A2A4A] uppercase tracking-widest border-b border-[#E2E8F0] pb-2 mb-3">Observações</h4>
          <p className="text-sm text-[#475569] font-medium whitespace-pre-wrap">{veiculo.observacoes}</p>
        </div>
      )}
    </div>
  );
}
