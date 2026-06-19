"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { listarOPs, atualizarStatus, dispararEmailOP } from '../actions'; 
import { supabase } from '../../../lib/supabase'; 
import { Analytics } from "@vercel/analytics/next"
import logoColorido from '../../../../app/imgs/logo.png'; // Importação da logo para o recibo

interface ItemOP {
  descricao: string;
  qtd: number;
  valor_unitario: number;
  total: number;
  description?: string; 
  quantity?: string | number; 
}

interface OP {
  id: string;
  numero_op: number;
  data_criacao: string;
  responsavel_nome: string;
  natureza_pagamento: string;
  os_numero: string;
  os_cliente: string;
  empresa_recebedora: string;
  cnpj_cpf_recebedora?: string; // Garantindo que o CPF/CNPJ do banco seja reconhecido
  tipo_pagamento: string;
  dados_pagamento: string;
  total_geral: number;
  data_vencimento: string;
  status: string;
  itens: ItemOP[];
  file_url: string;
}

export default function PainelFinanceiro() {
  const router = useRouter();
  
  // Estados Dinâmicos de Autenticação
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [emailUsuario, setEmailUsuario] = useState(''); 
  const [authLoading, setAuthLoading] = useState(true);

  // Estados de Dados
  const [ops, setOps] = useState<OP[]>([]);
  const [loading, setLoading] = useState(true);
  
  // ── ESTADOS DE FILTRO ──────────────────────────
  const [busca, setBusca] = useState('');
  const [tipoFiltroData, setTipoFiltroData] = useState<'DIA' | 'MES' | 'ANO'>('MES'); 
  const [filtroData, setFiltroData] = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');
  const [filtroFavorecido, setFiltroFavorecido] = useState('');

  // ── Estados de UI (Modais) ─────────────────────
  const [modalDetalhes, setModalDetalhes] = useState<{ open: boolean; op: OP | null }>({ open: false, op: null });
  const [modalRecibo, setModalRecibo] = useState<{ open: boolean; op: OP | null }>({ open: false, op: null }); // NOVO: Estado do Recibo
  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'confirm' | 'success' | 'error'; title: string; msg: string; onConfirm?: () => void }>({ 
    open: false, type: 'loading', title: '', msg: '' 
  });

  // 1. Validar a Sessão e Puxar Dados do Usuário Logado
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        router.push('/login');
        return;
      }

      const { data: perfil } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (perfil) {
        setUsuarioAtual(perfil.nome || 'Equipe Financeira');
        setEmailUsuario(perfil.email || session.user.email || ''); 
        
        const permissaoBanco = String(perfil.permissao || perfil.nivel || '').toUpperCase();
        const cargosAltaGestao = ['DIR', 'DIRETOR', 'ADMINISTRADOR', 'ADMIN', 'FINANCEIRO'];
        
        if (!cargosAltaGestao.includes(permissaoBanco)) {
          router.push('/admin');
          return;
        }
      } else {
        setUsuarioAtual('Equipe Financeira');
      }
      
      setAuthLoading(false);
    }
    
    checkAuth();
  }, [router]);

  // 2. Busca os dados iniciais
  const carregarDados = async () => {
    setLoading(true);
    const res = await listarOPs('DIR', usuarioAtual);
    if (res.success && res.data) {
      const opsNormalizadas = res.data.map((op: any) => {
        const itensCorrigidos = Array.isArray(op.itens) ? op.itens.map((it: any) => {
          const quantidade = Number(it.qtd || it.quantity || 1);
          const total = Number(it.total || 0);
          const unitario = Number(it.valor_unitario || (total / quantidade) || 0);
          
          return {
            descricao: it.descricao || it.description || '',
            qtd: quantidade,
            valor_unitario: unitario,
            total: total
          };
        }) : [];

        return { ...op, itens: itensCorrigidos };
      });

      setOps(opsNormalizadas);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading) {
      carregarDados();
    }
  }, [authLoading]);

  const responsaveisUnicos = useMemo(() => {
    const nomes = ops.map(op => (op.responsavel_nome || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(nomes)].sort();
  }, [ops]);

  const favorecidosUnicos = useMemo(() => {
    const nomes = ops.map(op => (op.empresa_recebedora || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(nomes)].sort();
  }, [ops]);

  // Formatadores
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatarData = (d: string) => {
    if (!d) return '---';
    const date = new Date(d);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  const opsFiltradas = useMemo(() => {
    const termoBusca = busca.toLowerCase().trim();
    
    return ops.filter(op => {
      const matchBusca = !termoBusca || 
        (op.os_numero || '').toLowerCase().includes(termoBusca) || 
        (op.os_cliente || '').toLowerCase().includes(termoBusca) || 
        (op.empresa_recebedora || '').toLowerCase().includes(termoBusca) || 
        (op.natureza_pagamento || '').toLowerCase().includes(termoBusca);

      const nomeResponsavelLimpo = (op.responsavel_nome || '').toUpperCase().trim();
      const matchResponsavel = !filtroResponsavel || nomeResponsavelLimpo === filtroResponsavel;

      const nomeFavorecidoLimpo = (op.empresa_recebedora || '').toUpperCase().trim();
      const matchFavorecido = !filtroFavorecido || nomeFavorecidoLimpo === filtroFavorecido;

      let matchData = true;
      if (filtroData) {
        const opDate = op.data_criacao ? op.data_criacao.split('T')[0] : '';
        matchData = opDate.startsWith(filtroData);
      }

      return matchBusca && matchResponsavel && matchFavorecido && matchData;
    });
  }, [ops, busca, filtroResponsavel, filtroFavorecido, filtroData]);

  const limparFiltros = () => {
    setBusca('');
    setFiltroData('');
    setFiltroResponsavel('');
    setFiltroFavorecido('');
  };

  const temFiltroAtivo = busca || filtroData || filtroResponsavel || filtroFavorecido;

  const metricas = useMemo(() => {
    let tGeral = 0, tPendente = 0, tPago = 0;
    const naturezas: Record<string, number> = {};

    opsFiltradas.forEach(op => {
      const val = Number(op.total_geral) || 0;
      tGeral += val;
      if (op.status === 'PAGO') tPago += val;
      else tPendente += val;

      const nat = op.natureza_pagamento || "NÃO INFORMADA";
      naturezas[nat] = (naturezas[nat] || 0) + val;
    });

    return { tGeral, tPendente, tPago, qtd: opsFiltradas.length, naturezas };
  }, [opsFiltradas]);

  // Ações do Sistema
  const confirmarBaixa = (id: string, osNum: string) => {
    setDialog({
      open: true,
      type: 'confirm',
      title: 'Baixar OP',
      msg: `Confirma o pagamento e a baixa da OS ${osNum} no sistema?`,
      onConfirm: async () => {
        setDialog({ open: true, type: 'loading', title: 'Aguarde...', msg: 'Atualizando o banco de dados...' });
        const res = await atualizarStatus(id, 'PAGO', usuarioAtual);
        if (res.success) {
          await carregarDados();
          setDialog({ ...dialog, open: false });
        } else {
          setDialog({ open: true, type: 'error', title: 'Erro', msg: res.message });
        }
      }
    });
  };

  const dispararReenvio = (op: OP) => {
    setDialog({
      open: true,
      type: 'confirm',
      title: 'Reenviar E-mail',
      msg: `Deseja enviar a OP ${op.os_numero || 'S/N'} para o seu e-mail (${emailUsuario}) e para o Financeiro?`,
      onConfirm: async () => {
        setDialog({ open: true, type: 'loading', title: 'Enviando E-mail...', msg: 'Isso pode levar alguns segundos.' });
        try {
          const res = await dispararEmailOP(op, emailUsuario);
          if (res.success) {
            setDialog({ open: true, type: 'success', title: 'E-mail Enviado!', msg: 'A cópia da OP foi enviada com sucesso para os departamentos.' });
          } else {
            throw new Error(res.message);
          }
        } catch (error: any) {
          setDialog({ open: true, type: 'error', title: 'Erro no Envio', msg: error.message || 'Não foi possível enviar o e-mail.' });
        }
      }
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  const anoAtual = new Date().getFullYear();
  const anosDisponiveis = [anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2];

  // ============================================================================
  // TEMPLATE DO RECIBO (Utilizado para Preview e Impressão Real)
  // ============================================================================
  const renderReciboLayout = (op: OP) => (
    <div className="border-2 border-black p-8 md:p-12 rounded-xl bg-white w-full max-w-4xl mx-auto shadow-none print:shadow-none print:border-none">
      
      {/* Cabeçalho do Recibo */}
      <div className="flex justify-between items-center border-b-2 border-black pb-6 mb-8">
        <div>
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} className="print:grayscale" />
        </div>
        <div className="text-right">
          <h1 className="text-3xl font-black uppercase tracking-wider text-black">RECIBO</h1>
          <p className="text-lg font-bold text-gray-700">Nº da OP / OS: {op.os_numero || 'S/N'}</p>
        </div>
      </div>

      {/* Caixa de Valor */}
      <div className="bg-gray-100 border border-gray-400 p-5 rounded-lg flex justify-between items-center mb-10 print:bg-gray-100 print:border-gray-500">
        <span className="text-sm font-bold uppercase tracking-widest text-gray-600">Valor Deste Recibo</span>
        <span className="text-4xl font-black text-black">{formatarMoeda(op.total_geral)}</span>
      </div>

      {/* Corpo / Declaração */}
      <div className="text-lg leading-relaxed mb-10 text-justify text-black">
        <p className="mb-4">
          Recebi(emos) da empresa <strong>RENTECH LOCADORA E SERVIÇOS</strong>, a importância supramencionada de <strong>{formatarMoeda(op.total_geral)}</strong>.
        </p>
        <p>
          Pagamento referente à prestação de serviços de <strong>{op.natureza_pagamento}</strong>, vinculados ao projeto/evento <strong>{op.os_cliente || 'N/A'}</strong>.
        </p>
      </div>

      {/* Tabela de Itens Prestados */}
      <div className="mb-16">
        <h4 className="font-black uppercase tracking-widest text-xs mb-3 border-b border-gray-400 pb-2 text-black">Detalhamento dos Serviços</h4>
        <table className="w-full text-sm text-left border-collapse text-black">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="py-3 font-bold">Descrição do Serviço / Item</th>
              <th className="py-3 text-center font-bold">Qtd</th>
              <th className="py-3 text-right font-bold">V. Unitário</th>
              <th className="py-3 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {op.itens?.map((it, idx) => (
              <tr key={idx} className="border-b border-gray-300">
                <td className="py-3 uppercase">{it.descricao}</td>
                <td className="py-3 text-center">{it.qtd}</td>
                <td className="py-3 text-right">{formatarMoeda(it.valor_unitario)}</td>
                <td className="py-3 text-right font-bold">{formatarMoeda(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assinatura */}
      <div className="mt-20 pt-8 flex flex-col items-center justify-center border-t-2 border-black w-3/4 mx-auto text-black">
        <strong className="text-xl uppercase tracking-wider">{op.empresa_recebedora}</strong>
        <p className="text-base mt-1">CPF/CNPJ: {op.cnpj_cpf_recebedora || '__________________________________'}</p>
      </div>

      {/* Data e Local */}
      <div className="text-center mt-12 text-base text-black font-medium">
        São Paulo, ______ de __________________________ de 20____.
      </div>

    </div>
  );

  return (
    <>
      {/* A MÁGICA DA IMPRESSÃO: A div principal abaixo recebe "print:hidden".
        Isso faz com que TUDO do painel administrativo suma na hora de imprimir. 
      */}
      <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16 print:hidden">
        <Analytics/>
        
        {/* IDENTIFICAÇÃO E NAVEGAÇÃO */}
        <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
          <p className="text-[#0369A1] font-medium text-sm">
            💳 <strong>Olá, {usuarioAtual}</strong>. Bem-vindo ao painel financeiro de aprovação de OPs.
          </p>
          <button 
            onClick={() => router.push('/admin')} 
            className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
          >
            ⬅ VOLTAR AO HUB
          </button>
        </div>

        {/* DASHBOARD CARDS */}
        <div className="p-4 md:px-8 pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0">
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#336699]">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Geral Visualizado</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">{formatarMoeda(metricas.tGeral)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-amber-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Pendente</h3>
            <p className="text-2xl font-black text-amber-500 mt-1">{formatarMoeda(metricas.tPendente)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Pago</h3>
            <p className="text-2xl font-black text-green-600 mt-1">{formatarMoeda(metricas.tPago)}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#0C1D4D]">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Quantidade de OPs</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">{metricas.qtd} <span className="text-sm font-semibold text-[#94A3B8]">registros</span></p>
          </div>
        </div>

        {/* GASTOS POR NATUREZA E FILTROS */}
        <div className="px-4 md:px-8 py-2 flex-shrink-0">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-[#E2E8F0] mb-4">
            <h4 className="text-xs font-black text-[#0C1D4D] uppercase tracking-widest mb-3 flex items-center gap-2">
              📊 Gastos por Natureza <span className="text-[10px] font-normal text-[#94A3B8]">(Reflete os filtros atuais)</span>
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {Object.entries(metricas.naturezas).sort((a,b) => b[1] - a[1]).map(([nat, val]) => (
                <div key={nat} className="flex justify-between items-center text-xs p-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-md">
                  <span className="font-bold text-[#64748B] truncate mr-2" title={nat}>{nat}</span>
                  <strong className="text-[#0C1D4D]">{formatarMoeda(val)}</strong>
                </div>
              ))}
              {Object.keys(metricas.naturezas).length === 0 && <span className="text-xs text-[#94A3B8]">Nenhum dado na busca.</span>}
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row gap-4 items-center">
            <div className="flex-1 w-full relative">
              <input type="text" placeholder="🔍 Busca livre (OS, Cliente, etc)..." className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0A2A4A] focus:border-[#336699] outline-none transition-all" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>

            <div className="w-full lg:w-auto flex relative shadow-sm rounded-lg">
              <select className="p-2.5 border-y border-l border-[#CBD5E1] rounded-l-lg text-xs font-bold text-[#0C1D4D] outline-none focus:border-[#336699] bg-[#F8FAFC] cursor-pointer" value={tipoFiltroData} onChange={(e) => { setTipoFiltroData(e.target.value as 'DIA' | 'MES' | 'ANO'); setFiltroData(''); }}>
                <option value="DIA">Por Dia</option>
                <option value="MES">Por Mês</option>
                <option value="ANO">Por Ano</option>
              </select>

              {tipoFiltroData === 'DIA' && <input type="date" className={`w-full lg:w-36 p-2.5 border border-[#CBD5E1] rounded-r-lg text-sm font-semibold outline-none transition-all ${filtroData ? 'border-[#336699] text-[#0A2A4A] bg-blue-50' : 'text-[#64748B]'}`} value={filtroData} onChange={(e) => setFiltroData(e.target.value)} />}
              {tipoFiltroData === 'MES' && <input type="month" className={`w-full lg:w-36 p-2.5 border border-[#CBD5E1] rounded-r-lg text-sm font-semibold outline-none transition-all ${filtroData ? 'border-[#336699] text-[#0A2A4A] bg-blue-50' : 'text-[#64748B]'}`} value={filtroData} onChange={(e) => setFiltroData(e.target.value)} />}
              {tipoFiltroData === 'ANO' && (
                <select className={`w-full lg:w-36 p-2.5 border border-[#CBD5E1] rounded-r-lg text-sm font-semibold outline-none transition-all cursor-pointer ${filtroData ? 'border-[#336699] text-[#0A2A4A] bg-blue-50' : 'text-[#64748B]'}`} value={filtroData} onChange={(e) => setFiltroData(e.target.value)}>
                  <option value="">Selecione o Ano...</option>
                  {anosDisponiveis.map(ano => <option key={ano} value={ano}>{ano}</option>)}
                </select>
              )}
            </div>

            <div className="w-full lg:w-56 relative shadow-sm">
              <select className={`w-full p-2.5 border rounded-lg text-sm font-semibold outline-none transition-all cursor-pointer ${filtroResponsavel ? 'border-[#336699] text-[#0A2A4A] bg-blue-50' : 'border-[#CBD5E1] text-[#64748B]'}`} value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)}>
                <option value="">👤 Todos os Solicitantes</option>
                {responsaveisUnicos.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div className="w-full lg:w-56 relative shadow-sm">
              <select className={`w-full p-2.5 border rounded-lg text-sm font-semibold outline-none transition-all cursor-pointer ${filtroFavorecido ? 'border-[#336699] text-[#0A2A4A] bg-blue-50' : 'border-[#CBD5E1] text-[#64748B]'}`} value={filtroFavorecido} onChange={(e) => setFiltroFavorecido(e.target.value)}>
                <option value="">🏢 Todos os Favorecidos</option>
                {favorecidosUnicos.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            {temFiltroAtivo && (
              <button onClick={limparFiltros} className="w-full lg:w-auto px-4 py-2.5 bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors flex-shrink-0 shadow-sm">
                ✕ Limpar
              </button>
            )}
          </div>
        </div>

        {/* ── TABELA DE DADOS COM LARGURAS DISTRIBUÍDAS ───────────────────── */}
        <div className="px-4 md:px-8 pb-8 flex-grow overflow-hidden flex flex-col mt-2">
          <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead className="bg-[#F8FAFC] sticky top-0 z-10 shadow-sm">
                <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                  {/* ALINHAMENTO DA LARGURA DAS COLUNAS (w-...) */}
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-24">Data OP</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-24">OS / Anexo</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-32">Solicitante</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] min-w-[120px] max-w-[150px]">Cliente</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] min-w-[160px] max-w-[200px]">Descrição Resumida</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] min-w-[140px] max-w-[180px]">Favorecido</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-32">Valor Total</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-28">Vencimento</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-24">Status</th>
                  <th className="p-4 border-b-2 border-[#E2E8F0] w-32 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] text-xs">
                {loading ? (
                  <tr><td colSpan={10} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando registros do banco de dados...</td></tr>
                ) : opsFiltradas.length === 0 ? (
                  <tr><td colSpan={10} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhuma Ordem de Pagamento encontrada para estes filtros.</td></tr>
                ) : (
                  opsFiltradas.map((op) => {
                    const isPago = op.status === 'PAGO';
                    return (
                      <tr key={op.id} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-4 font-semibold text-[#94A3B8] whitespace-nowrap">{formatarData(op.data_criacao)}</td>
                        <td className="p-4 whitespace-nowrap">
                          <span className="bg-[#E0F2FE] text-[#0369A1] font-bold px-2 py-1 rounded-md text-[10px] mr-2 inline-block">{op.os_numero || 'S/N'}</span>
                          {op.file_url && <a href={op.file_url} target="_blank" rel="noreferrer" className="text-base hover:scale-110 transition-transform inline-block" title="Ver Comprovante">📎</a>}
                        </td>
                        <td className="p-4 font-bold text-[#336699] truncate max-w-[120px]" title={op.responsavel_nome}>{op.responsavel_nome}</td>
                        <td className="p-4 font-bold truncate max-w-[150px]" title={op.os_cliente}>{op.os_cliente}</td>
                        <td className="p-4">
                          <div className="truncate max-w-[200px] font-semibold text-[#64748B] mb-1">
                            {op.itens && op.itens.length > 0 ? op.itens[0].descricao : 'Sem descrição'}
                          </div>
                          <button onClick={() => setModalDetalhes({ open: true, op })} className="text-[9px] font-black uppercase tracking-wider text-[#336699] hover:underline">
                            Ver Detalhes ({op.itens?.length || 0})
                          </button>
                        </td>
                        <td className="p-4 font-bold truncate max-w-[180px]" title={op.empresa_recebedora}>{op.empresa_recebedora}</td>
                        <td className="p-4 font-black text-[#0C1D4D] whitespace-nowrap">{formatarMoeda(op.total_geral)}</td>
                        <td className="p-4 font-bold text-red-500 whitespace-nowrap">{formatarData(op.data_vencimento)}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded-full text-[9px] font-black tracking-wider ${isPago ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                            {op.status}
                          </span>
                        </td>
                        
                        {/* ── COLUNA DE AÇÕES COM O GERADOR DE RECIBO ──────────────── */}
                        <td className="p-4 text-center space-y-1.5">
                          {isPago ? (
                            <span className="block text-[10px] font-black text-green-600 uppercase tracking-widest bg-green-50 py-1.5 rounded mb-1">✅ Pago</span>
                          ) : (
                            <button onClick={() => confirmarBaixa(op.id, op.os_numero)} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold text-[9px] uppercase tracking-wider py-1.5 rounded transition-colors shadow-sm">
                              Baixar OP
                            </button>
                          )}
                          
                          {/* NOVO BOTÃO: GERAR RECIBO */}
                          <button onClick={() => setModalRecibo({ open: true, op })} className="w-full bg-[#E0F2FE] hover:bg-[#BAE6FD] border border-[#7DD3FC] text-[#0369A1] font-bold text-[9px] uppercase tracking-wider py-1.5 rounded transition-colors shadow-sm">
                            📄 Gerar Recibo
                          </button>

                          <button onClick={() => dispararReenvio(op)} className="w-full bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-600 font-bold text-[9px] uppercase tracking-wider py-1.5 rounded transition-colors">
                            🔄 Reenviar
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAIS MANTIDOS INTACTOS (Detalhes da OP e Alertas) */}
        {modalDetalhes.open && modalDetalhes.op && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:hidden">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
                <h3 className="font-black uppercase tracking-wider text-sm">Detalhes da OP: {modalDetalhes.op.os_numero}</h3>
                <button onClick={() => setModalDetalhes({ open: false, op: null })} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
              </div>
              
              <div className="p-6 overflow-y-auto">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6 bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0]">
                  <div><span className="block text-[10px] uppercase text-[#64748B] font-bold">Natureza</span><strong className="text-xs">{modalDetalhes.op.natureza_pagamento}</strong></div>
                  <div><span className="block text-[10px] uppercase text-[#64748B] font-bold">Favorecido</span><strong className="text-xs truncate block" title={modalDetalhes.op.empresa_recebedora}>{modalDetalhes.op.empresa_recebedora}</strong></div>
                  <div><span className="block text-[10px] uppercase text-[#64748B] font-bold">Pagamento</span><strong className="text-xs">{modalDetalhes.op.tipo_pagamento}</strong></div>
                </div>

                <h4 className="text-xs font-black uppercase text-[#0C1D4D] tracking-widest mb-3 border-b border-[#E2E8F0] pb-2">Itens Solicitados</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-bold uppercase text-[#94A3B8] px-2">
                    <span className="flex-grow">Descrição do Item</span>
                    <span className="w-24 text-right">Total</span>
                  </div>
                  {modalDetalhes.op.itens?.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-white border border-[#E2E8F0] p-3 rounded-lg text-xs">
                      <span className="flex-grow font-semibold text-[#0A2A4A] uppercase">{it.descricao} <span className="text-[#94A3B8] font-normal">(x{it.qtd})</span></span>
                      <strong className="w-24 text-right text-[#336699]">{formatarMoeda(it.total)}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#F8FAFC] p-5 border-t border-[#E2E8F0] flex justify-between items-center">
                <span className="text-xs font-bold text-[#64748B] uppercase">Valor Total a Pagar</span>
                <span className="text-2xl font-black text-[#0C1D4D]">{formatarMoeda(modalDetalhes.op.total_geral)}</span>
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE PREVIEW DO RECIBO NA TELA */}
        {modalRecibo.open && modalRecibo.op && (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 print:hidden">
            <div className="bg-gray-100 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh]">
              {/* Barra de Ações Superior */}
              <div className="bg-[#0C1D4D] p-4 flex justify-between items-center text-white flex-shrink-0">
                <h3 className="font-black uppercase tracking-wider text-sm flex items-center gap-2">
                  📄 Gerador de Recibo de Pagamento
                </h3>
                <div className="flex gap-4">
                  {/* Ao clicar, chama a janela de impressão nativa do navegador */}
                  <button onClick={() => window.print()} className="bg-[#16A34A] hover:bg-[#15803D] text-white px-5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest shadow-lg flex items-center gap-2 transition-colors">
                    🖨️ Imprimir Recibo
                  </button>
                  <button onClick={() => setModalRecibo({ open: false, op: null })} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors">
                    Fechar
                  </button>
                </div>
              </div>

              {/* Área de Visualização do Recibo (Zoom out para caber na tela) */}
              <div className="p-6 overflow-y-auto flex justify-center bg-gray-200">
                <div className="bg-white shadow-xl">
                  {renderReciboLayout(modalRecibo.op)}
                </div>
              </div>
            </div>
          </div>
        )}

        {dialog.open && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 print:hidden">
            <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4 transform transition-all">
              <div className="text-5xl mb-4">
                {dialog.type === 'loading' ? '⏳' : dialog.type === 'success' ? '✅' : dialog.type === 'error' ? '❌' : '❓'}
              </div>
              <h3 className={`text-xl font-black uppercase tracking-wider mb-2 ${dialog.type === 'error' ? 'text-red-600' : 'text-[#0C1D4D]'}`}>
                {dialog.title}
              </h3>
              <p className="text-sm text-[#64748B] mb-8 font-medium">{dialog.msg}</p>
              
              <div className="flex gap-3 justify-center">
                {dialog.type === 'confirm' ? (
                  <>
                    <button onClick={() => setDialog({ ...dialog, open: false })} className="flex-1 py-3 bg-[#F0F4F8] text-[#64748B] font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#E2E8F0] transition-colors">
                      Voltar
                    </button>
                    <button onClick={dialog.onConfirm} className="flex-1 py-3 bg-[#0C1D4D] text-white font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-[#284B8C] transition-colors shadow-lg">
                      Sim, Confirmar
                    </button>
                  </>
                ) : dialog.type !== 'loading' ? (
                  <button onClick={() => setDialog({ ...dialog, open: false })} className={`w-full py-3 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors shadow-lg ${dialog.type === 'error' ? 'bg-red-600 hover:bg-red-500' : 'bg-[#0C1D4D] hover:bg-[#284B8C]'}`}>
                    OK, Entendido
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* A MÁGICA DA IMPRESSÃO PT.2: A div abaixo só existe (print:block) quando o navegador vai imprimir.
        Ela ocupa a folha A4 inteira, sem menus, sem botões, só o Recibo.
      */}
      {modalRecibo.open && modalRecibo.op && (
        <div className="hidden print:block bg-white w-full h-full text-black font-sans">
          {renderReciboLayout(modalRecibo.op)}
        </div>
      )}
    </>
  );
}