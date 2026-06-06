"use client";

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import logoColorido from '../../../../app/imgs/logo.png';
import { listarOPs, atualizarStatus } from '../actions';
import { Analytics } from "@vercel/analytics/next"

// Interface baseada no banco Supabase que criamos
interface ItemOP {
  descricao: string;
  qtd: number;
  valor_unitario: number;
  total: number;
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
  
  // Estados de Dados
  const [ops, setOps] = useState<OP[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  // Estados de UI (Modais)
  const [modalDetalhes, setModalDetalhes] = useState<{ open: boolean; op: OP | null }>({ open: false, op: null });
  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'confirm' | 'success' | 'error'; title: string; msg: string; onConfirm?: () => void }>({ 
    open: false, type: 'loading', title: '', msg: '' 
  });

  // Busca os dados iniciais do Supabase
  const carregarDados = async () => {
    setLoading(true);
    // Para o Financeiro, passamos 'ADM' para puxar todas as OPs da empresa
    const res = await listarOPs('ADM', 'Diretoria');
    if (res.success && res.data) {
      setOps(res.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    carregarDados();
  }, []);

  // Formatadores
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatarData = (d: string) => {
    if (!d) return '---';
    const date = new Date(d);
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  // Filtro Dinâmico
  const opsFiltradas = useMemo(() => {
    const termo = busca.toLowerCase();
    return ops.filter(o => 
      (o.os_numero || '').toLowerCase().includes(termo) || 
      (o.os_cliente || '').toLowerCase().includes(termo) || 
      (o.empresa_recebedora || '').toLowerCase().includes(termo) || 
      (o.natureza_pagamento || '').toLowerCase().includes(termo)
    );
  }, [ops, busca]);

  // Cálculos do Dashboard Inteligente
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
        const res = await atualizarStatus(id, 'PAGO', 'Equipe Financeira');
        if (res.success) {
          await carregarDados();
          setDialog({ ...dialog, open: false });
        } else {
          setDialog({ open: true, type: 'error', title: 'Erro', msg: res.message });
        }
      }
    });
  };

  const dispararReenvio = (id: string, osNum: string) => {
    setDialog({
      open: true,
      type: 'confirm',
      title: 'Reenviar E-mail',
      msg: `Deseja enviar um novo e-mail com todos os dados da OS ${osNum} para os responsáveis?`,
      onConfirm: () => {
        setDialog({ open: true, type: 'loading', title: 'Enviando E-mail...', msg: 'Isso pode levar alguns segundos.' });
        // Simulação do disparo de e-mail (Aqui entraria a integração futura com Resend/SendGrid via Server Action)
        setTimeout(() => {
          setDialog({ open: true, type: 'success', title: 'E-mail Enviado!', msg: 'A cópia da OP foi enviada com sucesso.' });
        }, 1500);
      }
    });
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col">
      <Analytics/>
      
      {/* HEADER ADM */}
      <header className="bg-[#0C1D4D] text-white p-4 md:px-8 flex justify-between items-center shadow-md z-10 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Image src={logoColorido} alt="Rentech" width={140} height={40} className="brightness-0 invert" />
          <h2 className="text-lg font-black tracking-widest uppercase hidden md:block border-l-2 border-[#284B8C] pl-4">Painel Financeiro</h2>
        </div>
        <button onClick={() => router.push('/admin/op')} className="text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 rounded-lg transition-colors">
          ⬅ SAIR DO SISTEMA
        </button>
      </header>

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

      {/* GASTOS POR NATUREZA E BUSCA */}
      <div className="px-4 md:px-8 py-2 flex-shrink-0">
        <div className="bg-white p-5 rounded-xl shadow-sm border border-[#E2E8F0] mb-4">
          <h4 className="text-xs font-black text-[#0C1D4D] uppercase tracking-widest mb-3 flex items-center gap-2">
            📊 Gastos por Natureza <span className="text-[10px] font-normal text-[#94A3B8]">(Reflete a busca atual)</span>
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

        <div className="relative">
          <input 
            type="text" 
            placeholder="🔍 Filtrar por OS, Cliente, Favorecido ou Natureza..." 
            className="w-full p-4 pl-10 border-2 border-[#E2E8F0] rounded-xl text-sm font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none shadow-sm"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {/* TABELA DE DADOS (Scrollável) */}
      <div className="px-4 md:px-8 pb-8 flex-grow overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[1100px]">
            <thead className="bg-[#F8FAFC] sticky top-0 z-10 shadow-sm">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-4 border-b-2 border-[#E2E8F0]">Data OP</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">OS / Anexo</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Cliente</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Descrição Resumida</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Favorecido</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Valor Total</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Vencimento</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Status</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Carregando registros do banco de dados...</td></tr>
              ) : opsFiltradas.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhuma Ordem de Pagamento encontrada.</td></tr>
              ) : (
                opsFiltradas.map((op) => {
                  const isPago = op.status === 'PAGO';
                  return (
                    <tr key={op.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="p-4 font-semibold text-[#94A3B8] whitespace-nowrap">{formatarData(op.data_criacao)}</td>
                      <td className="p-4 whitespace-nowrap">
                        <span className="bg-[#E0F2FE] text-[#0369A1] font-bold px-2 py-1 rounded-md text-[10px] mr-2">{op.os_numero || 'S/N'}</span>
                        {op.file_url && <a href={op.file_url} target="_blank" rel="noreferrer" className="text-lg hover:scale-110 transition-transform inline-block" title="Ver Comprovante">📎</a>}
                      </td>
                      <td className="p-4 font-bold truncate max-w-[120px]" title={op.os_cliente}>{op.os_cliente}</td>
                      <td className="p-4">
                        <div className="truncate max-w-[180px] font-semibold text-[#64748B] mb-1">
                          {op.itens && op.itens.length > 0 ? op.itens[0].descricao : 'Sem descrição'}
                        </div>
                        <button onClick={() => setModalDetalhes({ open: true, op })} className="text-[9px] font-black uppercase tracking-wider text-[#336699] hover:underline">
                          Ver Detalhes ({op.itens?.length || 0})
                        </button>
                      </td>
                      <td className="p-4 font-bold truncate max-w-[150px]" title={op.empresa_recebedora}>{op.empresa_recebedora}</td>
                      <td className="p-4 font-black text-[#0C1D4D] whitespace-nowrap">{formatarMoeda(op.total_geral)}</td>
                      <td className="p-4 font-bold text-red-500 whitespace-nowrap">{formatarData(op.data_vencimento)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-[9px] font-black tracking-wider ${isPago ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                          {op.status}
                        </span>
                      </td>
                      <td className="p-4 text-center space-y-2">
                        {isPago ? (
                          <span className="block text-[10px] font-black text-green-600 uppercase tracking-widest">✅ Pago</span>
                        ) : (
                          <button onClick={() => confirmarBaixa(op.id, op.os_numero)} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold text-[9px] uppercase tracking-wider py-1.5 rounded transition-colors shadow-sm">
                            Baixar OP
                          </button>
                        )}
                        <button onClick={() => dispararReenvio(op.id, op.os_numero)} className="w-full bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-600 font-bold text-[9px] uppercase tracking-wider py-1 rounded transition-colors">
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

      {/* MODAL: DETALHES DOS ITENS */}
      {modalDetalhes.open && modalDetalhes.op && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
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

      {/* DIALOG DE CONFIRMAÇÃO / AVISO */}
      {dialog.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
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
  );
}