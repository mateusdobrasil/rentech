"use client";

import { useState, useEffect, useRef, Fragment } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import {
  listarConsignadosAction, importarConsignacoesArquivoAction, listarConsignadosPersistidosAction,
  type ConsignadoFuncionario
} from '../../rh/actions/actions-consignado';
import ExigirMFA from '../ExigirMFA';

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

const formatarCpf = (cpf: string | null) => {
  if (!cpf) return '—';
  const digitos = cpf.replace(/\D/g, '');
  if (digitos.length !== 11) return cpf;
  return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

const formatarMoeda = (valor: number | null) => {
  if (valor === null || valor === undefined) return '—';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function GestaoDeConsignado() {
  const router = useRouter();
  const pathname = usePathname();
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  const [lista, setLista] = useState<ConsignadoFuncionario[]>([]);
  const [loading, setLoading] = useState(true);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [expandidoCpf, setExpandidoCpf] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Três fontes possíveis para a mesma tabela: o retrato persistido em
  // folha_consignados (padrão ao abrir a tela), consulta ao vivo via API
  // (exige certificado digital, ainda não configurado) ou importação manual
  // do arquivo baixado no Portal Emprega Brasil (usável hoje). As duas
  // últimas gravam em folha_consignados e disparam aviso de novo empréstimo.
  const [fonte, setFonte] = useState<'BANCO' | 'API' | 'ARQUIVO'>('BANCO');
  const [competenciaArquivo, setCompetenciaArquivo] = useState<string | null>(null);
  const [nomeArquivoImportado, setNomeArquivoImportado] = useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [avisoNovos, setAvisoNovos] = useState<number | null>(null);

  const [mesAnoSelecionado, setMesAnoSelecionado] = useState(() => {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  });

  // 1. Validar Sessão e Consultar Permissões Dinâmicas no Banco
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
    }

    checkAuth();
  }, [router, pathname]);

  // Carga padrão ao abrir a tela: o último retrato gravado em
  // folha_consignados (sem chamar API nem exigir arquivo nenhum).
  const carregarPersistido = async () => {
    setLoading(true);
    setErro(null);
    setFonte('BANCO');
    const res = await listarConsignadosPersistidosAction();
    if (!res.ok) {
      setErro(res.erro || 'Falha ao carregar os dados persistidos de consignado.');
      setLista([]);
    } else {
      setLista(res.info.lista || []);
      setAtualizadoEm(res.info.atualizadoEm || null);
      setCompetenciaArquivo(res.info.competencia || null);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregarPersistido();
  }, [authLoading, acessoNegado]);

  const carregarLista = async (mesAnoAlvo?: string) => {
    setLoading(true);
    setErro(null);
    setAvisoNovos(null);
    setFonte('API');
    const competencia = (mesAnoAlvo || mesAnoSelecionado).replace('-', '');
    const res = await listarConsignadosAction(competencia);
    if (!res.ok) {
      setErro(res.erro || 'Falha ao carregar os dados de consignado.');
      setLista([]);
    } else {
      setLista(res.info.lista || []);
      setAvisoNovos(res.info.novosDetectados ?? 0);
      setAtualizadoEm(new Date().toISOString());
    }
    setLoading(false);
  };

  // Importação manual do arquivo de consignações baixado no Portal Emprega
  // Brasil — não depende do certificado digital da API ao vivo. Substitui a
  // lista atual pelo conteúdo do arquivo, sem tocar mesAnoSelecionado (que
  // dispara a consulta via API), para não sobrescrever o que acabou de ser
  // importado.
  const handleImportarArquivo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportando(true);
    setErro(null);
    setAvisoNovos(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const texto = e.target?.result as string;
        let registros: any[];
        try {
          const json = JSON.parse(texto);
          registros = Array.isArray(json) ? json : (json.registros || json.consignacoes || [json]);
        } catch {
          throw new Error('Arquivo inválido: não é um JSON válido.');
        }

        const res = await importarConsignacoesArquivoAction({ registros });
        if (!res.ok) throw new Error(res.erro);

        setLista(res.info.lista);
        setCompetenciaArquivo(res.info.competencia || null);
        setNomeArquivoImportado(file.name);
        setFonte('ARQUIVO');
        setAvisoNovos(res.info.novosDetectados ?? 0);
        setAtualizadoEm(new Date().toISOString());
      } catch (error: any) {
        setErro(error.message);
      } finally {
        setImportando(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  // Só mostra quem realmente tem consignação — evita listar todo o quadro de
  // funcionários ativos (a maioria sem empréstimo nenhum) e deixa a tela mais limpa.
  const listaFiltrada = lista
    .filter(f => f.qtd_emprestimos > 0)
    .filter(f =>
      f.nome_completo.toLowerCase().includes(busca.toLowerCase()) ||
      (f.cpf || '').includes(busca.replace(/\D/g, ''))
    );

  const integracaoPendente = lista.length > 0 && lista.every(f => f.status === 'NAO_CONFIGURADO');
  const totalGeralParcelas = lista.reduce((acc, f) => acc + f.valor_total_parcelas, 0);

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Consignado.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <ExigirMFA>
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🏦 <strong>Consignado (Crédito Trabalhador)</strong>. Consignações aptas a desconto na folha, via API da Dataprev/eSocial.
        </p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO FINANCEIRO
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 flex-grow flex flex-col max-w-[1400px] mx-auto w-full">

        {integracaoPendente && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-6 text-sm">
            ⚠️ <strong>Integração com a API do GOV.BR (Crédito Trabalhador / Dataprev) ainda não configurada.</strong> Os funcionários abaixo estão listados a partir do cadastro interno, mas as consignações ainda não podem ser consultadas — depende do certificado digital ICP-Brasil vinculado ao CNPJ da empresa (ou com procuração eletrônica), que ainda não foi configurado.
          </div>
        )}

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center flex-1">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Competência</label>
              <input
                type="month"
                value={mesAnoSelecionado}
                onChange={(e) => setMesAnoSelecionado(e.target.value)}
                className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold outline-none focus:border-[#336699] bg-[#F8FAFC]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Buscar</label>
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome ou CPF..."
                className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-medium outline-none focus:border-[#336699] bg-[#F8FAFC]"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleImportarArquivo} className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importando}
              className="bg-white border border-[#CBD5E1] hover:bg-gray-50 text-[#0C1D4D] font-black uppercase tracking-widest text-xs py-2.5 px-5 rounded-lg transition-colors disabled:opacity-50"
            >
              {importando ? 'Importando...' : '📂 Importar Arquivo'}
            </button>
            <button
              onClick={() => carregarLista()}
              disabled={loading}
              className="bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-2.5 px-5 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Atualizando...' : '🔄 Consultar API'}
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">{erro}</div>
        )}

        {fonte === 'ARQUIVO' && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 mb-6 text-sm">
            📂 Exibindo dados importados do arquivo <strong>{nomeArquivoImportado}</strong>{competenciaArquivo ? <> — competência <strong>{competenciaArquivo}</strong></> : null}.
          </div>
        )}

        {avisoNovos !== null && avisoNovos > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 mb-6 text-sm">
            🔔 <strong>{avisoNovos} novo(s) empréstimo(s) consignado(s)</strong> detectado(s) nesta atualização — aviso disparado para o RH/Financeiro (WhatsApp + e-mail, conforme configurado em Agendamentos e Disparos).
          </div>
        )}
        {avisoNovos === 0 && (
          <div className="bg-gray-50 border border-gray-200 text-gray-600 rounded-xl p-4 mb-6 text-sm">
            ✅ Nenhum empréstimo novo nesta atualização — apenas contratos já conhecidos.
          </div>
        )}

        {!integracaoPendente && !loading && (
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-6 flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                Total a descontar na competência {competenciaArquivo || mesAnoSelecionado.split('-').reverse().join('/')}
              </span>
              {atualizadoEm && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Última atualização: {new Date(atualizadoEm).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
            <span className="text-lg font-black text-[#0C1D4D]">{formatarMoeda(totalGeralParcelas)}</span>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0] text-xs uppercase font-black tracking-wider text-[#0C1D4D]">
                  <th className="p-3">Funcionário</th>
                  <th className="p-3">CPF</th>
                  <th className="p-3">Matrícula</th>
                  <th className="p-3 text-right">Qtd Consignações</th>
                  <th className="p-3 text-right">Total a Descontar</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {loading ? (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-400 font-medium">Carregando...</td></tr>
                ) : listaFiltrada.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-gray-400 font-medium">Nenhum colaborador com empréstimo consignado encontrado.</td></tr>
                ) : (
                  listaFiltrada.map((f) => (
                    <Fragment key={f.nome_completo}>
                      <tr className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-3 font-bold">{f.nome_completo}</td>
                        <td className="p-3">{formatarCpf(f.cpf)}</td>
                        <td className="p-3">{f.matricula || '—'}</td>
                        <td className="p-3 text-right">{f.qtd_emprestimos || '—'}</td>
                        <td className="p-3 text-right font-bold">{formatarMoeda(f.valor_total_parcelas)}</td>
                        <td className="p-3 text-right">
                          {f.emprestimos.length > 0 && (
                            <button
                              onClick={() => setExpandidoCpf(expandidoCpf === f.cpf ? null : f.cpf)}
                              className="text-[10px] font-black uppercase text-[#336699] hover:underline"
                            >
                              {expandidoCpf === f.cpf ? 'Fechar' : 'Ver detalhes'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandidoCpf === f.cpf && f.emprestimos.length > 0 && (
                        <tr>
                          <td colSpan={6} className="p-0 bg-[#F8FAFC]">
                            <table className="w-full text-xs text-left">
                              <thead>
                                <tr className="text-[10px] uppercase font-black text-[#64748B] border-b border-[#E2E8F0]">
                                  <th className="p-2 pl-6">Instituição</th>
                                  <th className="p-2">Contrato</th>
                                  <th className="p-2 text-right">Parcela</th>
                                  <th className="p-2 text-right">Parcelas</th>
                                  <th className="p-2">Início Contrato</th>
                                  <th className="p-2">Fim Contrato</th>
                                  <th className="p-2">Desconto (Início→Fim)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {f.emprestimos.map((e, idx) => (
                                  <tr key={idx} className="border-b border-[#E2E8F0] last:border-0">
                                    <td className="p-2 pl-6 font-bold">{e.instituicaoNome} <span className="text-gray-400 font-normal">({e.instituicaoCodigo})</span></td>
                                    <td className="p-2">{e.contrato}</td>
                                    <td className="p-2 text-right">{formatarMoeda(e.valorParcela)}</td>
                                    <td className="p-2 text-right">{e.totalParcelas}</td>
                                    <td className="p-2">{e.dataInicioContrato}</td>
                                    <td className="p-2">{e.dataFimContrato}</td>
                                    <td className="p-2">{e.competenciaInicioDesconto} → {e.competenciaFimDesconto}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    </ExigirMFA>
  );
}
