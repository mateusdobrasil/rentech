"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { listarOPs, atualizarOP, dispararEmailOP } from '../actions';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next"

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
  os_evento: string;
  os_periodo: string;
  empresa_recebedora: string;
  tipo_pagamento: string;
  dados_pagamento: string;
  total_geral: number;
  data_vencimento: string;
  observacao: string;
  status: string;
  itens: ItemOP[];
}

export default function PainelResponsavel() {
  const router = useRouter();

  // Estados de Autenticação
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [usuarioEmail, setUsuarioEmail] = useState('');
  const [nivelAcesso, setNivelAcesso] = useState<'DIR' | 'USU'>('USU');
  const [authLoading, setAuthLoading] = useState(true);

  // Estados Principais
  const [ops, setOps] = useState<OP[]>([]);
  const [loading, setLoading] = useState(true);

  // ── NOVOS: Estados de Filtro ──────────────────────────────────────────────
  const [busca, setBusca] = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  // ──────────────────────────────────────────────────────────────────────────

  // Estados de Modais
  const [modalDetalhes, setModalDetalhes] = useState<{ open: boolean; op: OP | null }>({ open: false, op: null });
  const [modalEdit, setModalEdit] = useState<{ open: boolean; op: Partial<OP> | null }>({ open: false, op: null });
  const [dialog, setDialog] = useState<{ open: boolean; type: 'loading' | 'confirm' | 'success' | 'error'; title: string; msg: string; onConfirm?: () => void }>({ open: false, type: 'loading', title: '', msg: '' });

  // 1. Autenticação
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (perfil) {
        setUsuarioAtual(perfil.nome || 'Usuário');
        setUsuarioEmail(session.user.email || '');
        const permissaoBanco = String(perfil.permissao || perfil.nivel || '').toUpperCase();
        const cargosAltaGestao = ['DIR', 'DIRETOR', 'ADMINISTRADOR', 'ADMIN', 'FINANCEIRO'];
        setNivelAcesso(cargosAltaGestao.includes(permissaoBanco) ? 'DIR' : 'USU');
      } else {
        setUsuarioAtual(session.user.email?.split('@')[0] || 'Usuário');
        setUsuarioEmail(session.user.email || '');
      }
      setAuthLoading(false);
    }
    checkAuth();
  }, [router]);

  // 2. Busca de dados
  const carregarDados = async () => {
    if (!usuarioAtual) return;
    setLoading(true);
    const res = await listarOPs(nivelAcesso, usuarioAtual);
    if (res.success && res.data) {
      const opsNormalizadas = res.data.map((op: any) => {
        const itensCorrigidos = Array.isArray(op.itens) ? op.itens.map((it: any) => {
          const quantidade = Number(it.qtd || it.quantity || 1);
          const total = Number(it.total || 0);
          const unitario = Number(it.valor_unitario || (total / quantidade) || 0);
          return { descricao: it.descricao || it.description || '', qtd: quantidade, valor_unitario: unitario, total };
        }) : [];
        return { ...op, itens: itensCorrigidos };
      });
      setOps(opsNormalizadas);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && usuarioAtual) carregarDados();
  }, [authLoading, usuarioAtual, nivelAcesso]);

  // ── Listas únicas para os dropdowns (geradas a partir dos dados reais e normalizadas) ────
  const responsaveisUnicos = useMemo(() => {
    // Normaliza para maiúsculo e remove espaços em branco extras
    const nomes = ops.map(op => (op.responsavel_nome || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(nomes)].sort();
  }, [ops]);

  const clientesUnicos = useMemo(() => {
    // Normaliza para maiúsculo e remove espaços em branco extras
    const clientes = ops.map(op => (op.os_cliente || '').toUpperCase().trim()).filter(Boolean);
    return [...new Set(clientes)].sort();
  }, [ops]);
  // ──────────────────────────────────────────────────────────────────────────

  // ── OPs filtradas (computadas, sem estado extra, com normalização de case) ──────────────────────────
  const opsFiltradas = useMemo(() => {
    const termo = busca.toLowerCase().trim();
    return ops.filter((op) => {
      // Filtro de Busca Geral (mantém minúsculo para busca parcial)
      const matchBusca = !termo || [
        op.os_numero, op.os_cliente, op.responsavel_nome,
        op.natureza_pagamento, op.empresa_recebedora, op.status,
      ].some((campo) => (campo || '').toLowerCase().includes(termo));

      // Filtro Específico (normaliza ambos os lados para MAIÚSCULO para comparação exata)
      const nomeResponsavelLimpo = (op.responsavel_nome || '').toUpperCase().trim();
      const matchResponsavel = !filtroResponsavel || nomeResponsavelLimpo === filtroResponsavel;
      
      const nomeClienteLimpo = (op.os_cliente || '').toUpperCase().trim();
      const matchCliente = !filtroCliente || nomeClienteLimpo === filtroCliente;

      return matchBusca && matchResponsavel && matchCliente;
    });
  }, [ops, busca, filtroResponsavel, filtroCliente]);

  const limparFiltros = () => {
    setBusca('');
    setFiltroResponsavel('');
    setFiltroCliente('');
  };

  const filtrosAtivos = busca || filtroResponsavel || filtroCliente;
  // ──────────────────────────────────────────────────────────────────────────

  // Utilitários
  const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
  const formatarData = (d: string) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '---';

  // Lógica de edição (inalterada)
  const abrirEdicao = (op: OP) => {
    const copiaOp = JSON.parse(JSON.stringify(op));
    if (!copiaOp.itens || copiaOp.itens.length === 0)
      copiaOp.itens = [{ descricao: '', qtd: 0, valor_unitario: 0, total: 0 }];
    setModalEdit({ open: true, op: copiaOp });
  };

  const updateEditField = (field: keyof OP, value: any) => {
    if (modalEdit.op) setModalEdit({ ...modalEdit, op: { ...modalEdit.op, [field]: value } });
  };

  const updateEditItem = (index: number, field: keyof ItemOP, value: any) => {
    if (!modalEdit.op || !modalEdit.op.itens) return;
    const novosItens = [...modalEdit.op.itens];
    novosItens[index] = { ...novosItens[index], [field]: value };
    if (field === 'qtd' || field === 'valor_unitario')
      novosItens[index].total = (novosItens[index].qtd || 0) * (novosItens[index].valor_unitario || 0);
    setModalEdit({ ...modalEdit, op: { ...modalEdit.op, itens: novosItens } });
  };

  const addEditItem = () => {
    if (modalEdit.op?.itens)
      setModalEdit({ ...modalEdit, op: { ...modalEdit.op, itens: [...modalEdit.op.itens, { descricao: '', qtd: 0, valor_unitario: 0, total: 0 }] } });
  };

  const removeEditItem = (index: number) => {
    if (modalEdit.op?.itens && modalEdit.op.itens.length > 1) {
      const novosItens = modalEdit.op.itens.filter((_, i) => i !== index);
      setModalEdit({ ...modalEdit, op: { ...modalEdit.op, itens: novosItens } });
    }
  };

  const totalEdit = useMemo(() =>
    modalEdit.op?.itens?.reduce((acc, curr) => acc + (curr.total || 0), 0) || 0
  , [modalEdit.op?.itens]);

  const salvarEdicao = async () => {
    if (!modalEdit.op?.id) return;
    const itensValidos = modalEdit.op.itens?.filter(i => i.descricao.trim() !== '' && i.qtd > 0).map(i => ({
      descricao: i.descricao, description: i.descricao,
      qtd: i.qtd, quantity: String(i.qtd),
      valor_unitario: i.valor_unitario, total: i.total,
    }));
    if (!itensValidos || itensValidos.length === 0) {
      setDialog({ open: true, type: 'error', title: 'Atenção', msg: 'A OP precisa ter pelo menos um item válido com quantidade e valor.' });
      return;
    }
    setDialog({ open: true, type: 'loading', title: 'Salvando...', msg: 'Atualizando as informações no banco de dados.' });
    const payloadAtualizacao = {
      os_cliente: modalEdit.op.os_cliente, os_evento: modalEdit.op.os_evento,
      os_periodo: modalEdit.op.os_periodo, natureza_pagamento: modalEdit.op.natureza_pagamento,
      empresa_recebedora: modalEdit.op.empresa_recebedora, tipo_pagamento: modalEdit.op.tipo_pagamento,
      dados_pagamento: modalEdit.op.dados_pagamento, data_vencimento: modalEdit.op.data_vencimento,
      observacao: modalEdit.op.observacao, itens: itensValidos, total_geral: totalEdit,
    };
    const res = await atualizarOP(modalEdit.op.id, payloadAtualizacao, usuarioAtual);
    if (res.success) {
      setModalEdit({ open: false, op: null });
      setDialog({ open: true, type: 'success', title: 'Concluído!', msg: 'Ordem de Pagamento atualizada com sucesso.' });
      carregarDados();
    } else {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.message });
    }
  };

  const solicitarCopia = async (op: OP) => {
    setDialog({ open: true, type: 'loading', title: 'Enviando...', msg: 'Enviando cópia para o seu e-mail.' });
    const emailDestino = (op as any).responsavel_email || usuarioEmail;
    
    if (!emailDestino) {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: 'Não foi possível identificar o e-mail de destino.' });
      return;
    }

    const res = await dispararEmailOP(op, emailDestino, true);
    if (res.success) {
      setDialog({ open: true, type: 'success', title: 'Cópia Enviada', msg: `A cópia foi enviada para ${emailDestino}.` });
    } else {
      setDialog({ open: true, type: 'error', title: 'Erro', msg: res.message || 'Falha ao enviar e-mail.' });
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

      {/* HEADER */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          👤 <strong>Olá, {usuarioAtual}</strong>.{' '}
          {nivelAcesso === 'DIR'
            ? 'Você tem visão administrativa sobre todas as OPs do sistema.'
            : 'Estas são as solicitações sob sua responsabilidade.'}
        </p>
        <button
          onClick={() => router.push('/admin')}
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      {/* ── BARRA DE FILTROS ─────────────────────────────────────────────────── */}
      <div className="px-4 md:px-8 pt-5 pb-3 flex-shrink-0">
        <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm px-4 py-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">

          {/* Busca geral */}
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Buscar por OS, cliente, natureza, favorecido..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]/30 transition-all placeholder:text-[#94A3B8]"
            />
          </div>

          {/* Dropdown Responsável */}
          <select
            value={filtroResponsavel}
            onChange={(e) => setFiltroResponsavel(e.target.value)}
            className="py-2.5 px-3 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]/30 transition-all text-[#0A2A4A] bg-white md:w-52 shrink-0"
          >
            <option value="">👤 Todos os responsáveis</option>
            {responsaveisUnicos.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          {/* Dropdown Cliente */}
          <select
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
            className="py-2.5 px-3 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699]/30 transition-all text-[#0A2A4A] bg-white md:w-52 shrink-0"
          >
            <option value="">🏢 Todos os clientes</option>
            {clientesUnicos.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Botão limpar (só aparece se algum filtro estiver ativo) */}
          {filtrosAtivos && (
            <button
              onClick={limparFiltros}
              className="shrink-0 py-2.5 px-4 bg-red-50 border border-red-200 text-red-500 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-red-100 transition-colors"
            >
              ✕ Limpar
            </button>
          )}
        </div>

        {/* Contador de resultados */}
        <p className="text-[11px] text-[#94A3B8] font-medium mt-2 ml-1">
          {filtrosAtivos
            ? `${opsFiltradas.length} de ${ops.length} OPs encontradas`
            : `${ops.length} OPs no total`}
        </p>
      </div>
      {/* ──────────────────────────────────────────────────────────────────────── */}

      {/* TABELA */}
      <div className="px-4 md:px-8 pb-6 flex-grow overflow-hidden flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead className="bg-[#F8FAFC] sticky top-0 shadow-sm z-10">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-4 border-b-2 border-[#E2E8F0] w-24">Data OP</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-24">OS</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-32">Responsável</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Cliente</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Natureza / Descrição</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-40">Favorecido</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-32">Valor Total</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-28">Status</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] w-32 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Buscando as solicitações...</td></tr>
              ) : opsFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <p className="text-[#94A3B8] font-bold text-sm">Nenhuma OP encontrada.</p>
                    {filtrosAtivos && (
                      <button onClick={limparFiltros} className="mt-3 text-[#336699] font-bold text-xs underline">
                        Limpar filtros
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                opsFiltradas.map((op) => {
                  const isPago = op.status === 'PAGO';
                  return (
                    <tr key={op.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="p-4 font-semibold text-[#94A3B8]">{formatarData(op.data_criacao)}</td>
                      <td className="p-4"><span className="bg-[#E0F2FE] text-[#0369A1] font-bold px-2 py-1 rounded-md text-[10px]">{op.os_numero || 'S/N'}</span></td>
                      <td className="p-4 font-bold text-[#336699] truncate max-w-[120px]">{op.responsavel_nome}</td>
                      <td className="p-4 font-bold truncate max-w-[150px]">{op.os_cliente}</td>
                      <td className="p-4">
                        <div className="font-semibold text-[#0A2A4A] truncate max-w-[200px]">{op.natureza_pagamento}</div>
                        <button onClick={() => setModalDetalhes({ open: true, op })} className="text-[9px] font-black uppercase tracking-wider text-[#336699] hover:underline mt-1">Ver Detalhes</button>
                      </td>
                      <td className="p-4 font-bold text-[#64748B] truncate max-w-[150px]">{op.empresa_recebedora}</td>
                      <td className="p-4 font-black text-[#0C1D4D]">{formatarMoeda(op.total_geral)}</td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-[9px] font-black tracking-wider ${isPago ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-orange-100 text-orange-700 border border-orange-200'}`}>
                          {op.status}
                        </span>
                      </td>
                      <td className="p-4 text-center space-y-2">
                        <button
                          onClick={() => abrirEdicao(op)}
                          disabled={isPago}
                          className="w-full bg-amber-100 border border-amber-300 text-amber-700 font-bold text-[9px] uppercase tracking-wider py-1.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-200"
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => solicitarCopia(op)}
                          className="w-full bg-[#F0F4F8] border border-[#CBD5E1] text-[#64748B] font-bold text-[9px] uppercase tracking-wider py-1 rounded transition-colors hover:bg-[#E2E8F0]"
                        >
                          📩 Receber Cópia
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

      {/* MODAL: VER DETALHES */}
      {modalDetalhes.open && modalDetalhes.op && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="bg-[#336699] p-4 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">Resumo da Solicitação</h3>
              <button onClick={() => setModalDetalhes({ open: false, op: null })} className="text-white hover:text-red-400 text-xl leading-none">&times;</button>
            </div>
            <div className="p-6">
              <div className="space-y-2 mb-4">
                <div className="text-sm font-bold text-[#0A2A4A] border-b border-[#E2E8F0] pb-1 flex justify-between">
                  <span>Itens Solicitados</span><span>Total</span>
                </div>
                {modalDetalhes.op.itens?.map((it, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-dashed border-[#F1F5F9]">
                    <span className="text-[#64748B] font-semibold uppercase">{it.descricao} <span className="font-normal">(x{it.qtd})</span></span>
                    <strong className="text-[#0C1D4D]">{formatarMoeda(it.total)}</strong>
                  </div>
                ))}
              </div>
              <div className="text-right text-xl font-black text-[#336699] pt-2">
                TOTAL: {formatarMoeda(modalDetalhes.op.total_geral)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIÇÃO */}
      {modalEdit.open && modalEdit.op && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto py-10">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden mb-10 relative">
            <div className="bg-amber-500 p-5 flex justify-between items-center text-white sticky top-0 z-10">
              <h3 className="font-black uppercase tracking-wider text-sm">✏️ Editando OP: {modalEdit.op.os_numero}</h3>
              <button onClick={() => setModalEdit({ open: false, op: null })} className="text-white hover:text-red-900 text-2xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <h4 className="text-[10px] font-black uppercase text-white bg-[#0A2A4A] inline-block px-3 py-1 rounded mb-3">Dados do Evento e Cliente</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">CLIENTE</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.os_cliente || ''} onChange={e => updateEditField('os_cliente', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">EVENTO</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.os_evento || ''} onChange={e => updateEditField('os_evento', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">PERÍODO</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.os_periodo || ''} onChange={e => updateEditField('os_periodo', e.target.value)} /></div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] mb-1">NATUREZA</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699]" value={modalEdit.op.natureza_pagamento || 'SUBLOCAÇÃO'} onChange={e => updateEditField('natureza_pagamento', e.target.value)}>
                      <option value="SUBLOCAÇÃO">SUBLOCAÇÃO</option><option value="FREELANCE">FREELANCE</option><option value="REEMBOLSO">REEMBOLSO</option><option value="HOSPEDAGEM">HOSPEDAGEM</option><option value="BV">BV</option><option value="OUTROS">OUTROS</option>
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-[10px] font-black uppercase text-white bg-[#0A2A4A] inline-block px-3 py-1 rounded mb-3">Financeiro e Pagamento</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">FAVORECIDO</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm font-bold outline-none focus:border-[#336699]" value={modalEdit.op.empresa_recebedora || ''} onChange={e => updateEditField('empresa_recebedora', e.target.value)} /></div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] mb-1">FORMA</label>
                    <select className="w-full p-2.5 border border-[#CBD5E1] rounded text-sm outline-none focus:border-[#336699]" value={modalEdit.op.tipo_pagamento || 'PIX'} onChange={e => updateEditField('tipo_pagamento', e.target.value)}>
                      <option value="PIX">PIX</option><option value="BOLETO">BOLETO</option><option value="TRANSFERÊNCIA">TRANSFERÊNCIA</option><option value="DINHEIRO">DINHEIRO</option>
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">DADOS BANCÁRIOS / PIX</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.dados_pagamento || ''} onChange={e => updateEditField('dados_pagamento', e.target.value)} /></div>
                  <div><label className="block text-[10px] font-bold text-red-500 mb-1">VENCIMENTO</label><input type="date" className="w-full p-2.5 border border-red-300 rounded text-sm outline-none focus:border-red-500 font-bold" value={modalEdit.op.data_vencimento || ''} onChange={e => updateEditField('data_vencimento', e.target.value)} /></div>
                </div>
              </div>
              <div>
                <h4 className="text-[10px] font-black uppercase text-white bg-[#0A2A4A] inline-block px-3 py-1 rounded mb-3">Detalhamento de Itens</h4>
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#F8FAFC]">
                      <tr>
                        <th className="p-3 border-b border-[#E2E8F0] w-1/2">Descrição</th>
                        <th className="p-3 border-b border-[#E2E8F0] w-20 text-center">Qtd</th>
                        <th className="p-3 border-b border-[#E2E8F0] w-32">Unitário (R$)</th>
                        <th className="p-3 border-b border-[#E2E8F0] w-12 text-center">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {modalEdit.op.itens?.map((it, idx) => (
                        <tr key={idx}>
                          <td className="p-2"><input type="text" className="w-full p-2 border border-[#CBD5E1] rounded outline-none uppercase" value={it.descricao} onChange={e => updateEditItem(idx, 'descricao', e.target.value)} /></td>
                          <td className="p-2"><input type="number" min="0" className="w-full p-2 border border-[#CBD5E1] rounded outline-none text-center font-bold" value={it.qtd || ''} onChange={e => updateEditItem(idx, 'qtd', parseFloat(e.target.value) || 0)} /></td>
                          <td className="p-2"><input type="number" min="0" step="0.01" className="w-full p-2 border border-[#CBD5E1] rounded outline-none font-bold" value={it.valor_unitario || ''} onChange={e => updateEditItem(idx, 'valor_unitario', parseFloat(e.target.value) || 0)} /></td>
                          <td className="p-2 text-center"><button onClick={() => removeEditItem(idx)} className="text-red-500 font-bold bg-red-100 p-2 rounded hover:bg-red-200">&times;</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={addEditItem} className="mt-2 w-full py-2 bg-[#F0F4F8] border border-dashed border-[#94A3B8] text-[#64748B] font-bold text-[10px] uppercase rounded-lg hover:bg-[#E2E8F0] transition-colors">➕ Adicionar Item</button>
              </div>
              <div className="flex justify-between items-center bg-[#F8FAFC] p-4 rounded-lg border border-[#E2E8F0]">
                <span className="text-sm font-black uppercase text-[#64748B]">Total Calculado</span>
                <span className="text-2xl font-black text-[#336699]">{formatarMoeda(totalEdit)}</span>
              </div>
              <div><label className="block text-[10px] font-bold text-[#64748B] mb-1">OBSERVAÇÕES ADICIONAIS</label><input type="text" className="w-full p-2.5 border border-[#CBD5E1] rounded uppercase text-sm outline-none focus:border-[#336699]" value={modalEdit.op.observacao || ''} onChange={e => updateEditField('observacao', e.target.value)} /></div>
              <button onClick={salvarEdicao} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black text-sm uppercase py-4 rounded-xl shadow-lg transition-colors">
                💾 SALVAR ALTERAÇÕES DA OP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG */}
      {dialog.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4">
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
                  <button onClick={() => setDialog({ ...dialog, open: false })} className="flex-1 py-3 bg-[#F0F4F8] text-[#64748B] font-bold text-xs uppercase rounded-lg">Voltar</button>
                  <button onClick={dialog.onConfirm} className="flex-1 py-3 bg-[#0C1D4D] text-white font-bold text-xs uppercase rounded-lg shadow-lg">Confirmar</button>
                </>
              ) : dialog.type !== 'loading' ? (
                <button onClick={() => setDialog({ ...dialog, open: false })} className="w-full py-3 bg-[#0C1D4D] text-white font-bold text-xs uppercase rounded-lg shadow-lg">OK, Entendido</button>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}