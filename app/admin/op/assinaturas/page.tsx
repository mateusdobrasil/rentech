"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { useAcessoRota } from '../useAcessoRota';
import {
  listarAssinaturasOPAction, enviarAssinaturaOPAction, consultarAssinaturaOPAction,
  atualizarTodasAssinaturasOPAction, baixarAssinadoOPAction,
} from '../actions-assinatura';

interface ControleAssinatura {
  status: string;
  link_assinatura: string | null;
  sandbox: boolean;
  enviado_em: string | null;
  visualizado_em: string | null;
  assinado_em: string | null;
}

interface OPComAssinatura {
  id: string;
  numero_op: number;
  os_numero: string;
  os_cliente: string;
  empresa_recebedora: string;
  cpf_signatario: string | null;
  telefone_recebedora: string | null;
  total_geral: number;
  data_vencimento: string;
  recibo_url: string | null;
  assinatura: ControleAssinatura | null;
}

const dataHora = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR') : '—';
const formatarMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

type StatusAssinatura = 'NAO_ENVIADO' | 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'REJEITADO';

const STATUS_INFO: Record<StatusAssinatura, { label: string; cor: string; bg: string; icone: string }> = {
  NAO_ENVIADO: { label: 'Não enviado', cor: '#64748B', bg: '#F8FAFC', icone: '—' },
  ENVIADO:     { label: 'Enviado',     cor: '#4F46E5', bg: '#EEF2FF', icone: '📤' },
  VISUALIZADO: { label: 'Visualizado', cor: '#2563EB', bg: '#EFF6FF', icone: '👁' },
  ASSINADO:    { label: 'Assinado',    cor: '#16A34A', bg: '#F0FDF4', icone: '✅' },
  REJEITADO:   { label: 'Rejeitado',   cor: '#DC2626', bg: '#FEF2F2', icone: '✖' },
};

const statusDe = (op: OPComAssinatura): StatusAssinatura => (op.assinatura?.status as StatusAssinatura) || 'NAO_ENVIADO';
const dadosCompletos = (op: OPComAssinatura) =>
  (op.cpf_signatario || '').replace(/\D/g, '').length === 11 && (op.telefone_recebedora || '').replace(/\D/g, '').length >= 10;

export default function AssinaturasOPPage() {
  const router = useRouter();
  const { authLoading, acessoNegado, perfil } = useAcessoRota('/admin/op/assinaturas');

  const [loading, setLoading] = useState(true);
  const [ops, setOps] = useState<OPComAssinatura[]>([]);
  const [filtro, setFiltro] = useState<'TODOS' | StatusAssinatura>('TODOS');
  const [busca, setBusca] = useState('');
  const [sandbox, setSandbox] = useState(true);

  const [enviando, setEnviando] = useState<string | null>(null);
  const [consultando, setConsultando] = useState<string | null>(null);
  const [atualizandoTodas, setAtualizandoTodas] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = async () => {
    if (!perfil) return;
    setLoading(true);
    try {
      const res = await listarAssinaturasOPAction({ accessToken: perfil.accessToken });
      if (!res.ok) throw new Error(res.erro);
      setOps(res.info.ops);
    } catch (e: any) {
      alert('Erro ao carregar OPs: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (!authLoading && perfil) carregar(); }, [authLoading, perfil]);

  const enviar = async (op: OPComAssinatura) => {
    if (!perfil) return;
    if (!dadosCompletos(op)) {
      alert(`A OP #${op.numero_op} não tem CPF e/ou celular válidos do signatário. Edite a OP em "Minhas OPs" antes de enviar para assinatura.`);
      return;
    }
    if (!confirm(
      `Enviar recibo da OP #${op.numero_op} para ${op.empresa_recebedora} assinar?\n\n` +
      (sandbox ? '🧪 MODO TESTE (sandbox): não gasta créditos.' : '⚠ MODO REAL: consome um documento do plano Autentique.')
    )) return;

    setEnviando(op.id);
    try {
      const res = await enviarAssinaturaOPAction({ opId: op.id, sandbox, accessToken: perfil.accessToken });
      if (!res.ok) throw new Error(res.erro);
      alert(`Recibo enviado para assinatura!${res.info?.link ? `\n\nLink: ${res.info.link}` : ''}`);
      carregar();
    } catch (e: any) {
      alert('Erro ao enviar: ' + e.message);
    } finally {
      setEnviando(null);
    }
  };

  const consultar = async (op: OPComAssinatura) => {
    if (!perfil) return;
    setConsultando(op.id);
    try {
      const res = await consultarAssinaturaOPAction({ opId: op.id, accessToken: perfil.accessToken });
      if (!res.ok) throw new Error(res.erro);
      carregar();
    } catch (e: any) {
      alert('Erro ao consultar status: ' + e.message);
    } finally {
      setConsultando(null);
    }
  };

  const atualizarTodas = async () => {
    if (!perfil) return;
    setAtualizandoTodas(true);
    try {
      const res = await atualizarTodasAssinaturasOPAction({ accessToken: perfil.accessToken });
      if (!res.ok) throw new Error(res.erro);
      const mudancasMsg = res.info?.mudancas?.length
        ? `\n\nMudanças:\n${res.info.mudancas.join('\n')}`
        : '\n\nNenhuma mudança de status desde a última consulta.';
      alert(`${res.info?.atualizados || 0} de ${res.info?.total || 0} envio(s) consultado(s).${mudancasMsg}`);
      carregar();
    } catch (e: any) {
      alert('Erro ao atualizar as assinaturas: ' + e.message);
    } finally {
      setAtualizandoTodas(false);
    }
  };

  const abrirAssinado = async (op: OPComAssinatura) => {
    if (!perfil) return;
    if (op.recibo_url) { window.open(op.recibo_url, '_blank', 'noopener,noreferrer'); return; }
    setBaixando(op.id);
    try {
      const res = await baixarAssinadoOPAction({ opId: op.id, accessToken: perfil.accessToken });
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      alert('Erro ao abrir o documento assinado: ' + e.message);
    } finally {
      setBaixando(null);
    }
  };

  const filtradas = useMemo(() => {
    const porStatus = filtro === 'TODOS' ? ops : ops.filter(op => statusDe(op) === filtro);
    const termo = busca.toLowerCase().trim();
    if (!termo) return porStatus;
    return porStatus.filter(op => [
      String(op.numero_op), op.os_numero, op.os_cliente, op.empresa_recebedora,
    ].some(campo => (campo || '').toLowerCase().includes(termo)));
  }, [ops, filtro, busca]);

  const contagem = useMemo(() => {
    const c = { total: ops.length, NAO_ENVIADO: 0, ENVIADO: 0, VISUALIZADO: 0, ASSINADO: 0, REJEITADO: 0 };
    ops.forEach(op => { c[statusDe(op)]++; });
    return c;
  }, [ops]);

  const pctAssinado = contagem.total > 0 ? Math.round((contagem.ASSINADO / contagem.total) * 100) : 0;

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
          <p className="text-sm text-gray-500">Você não tem permissão para acessar esta página.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-3 shadow-sm print:hidden">
        <p className="text-[#0369A1] font-medium text-sm">
          ✍️ <strong>Assinaturas de Ordens de Pagamento</strong>. Acompanhe o status de envio e assinatura via Autentique.
        </p>
        <button onClick={() => router.push('/admin/op')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR PARA OP
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full space-y-6">

        {/* Painel Superior de Ações */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider">Assinaturas de OP</h1>
            <p className="text-sm text-[#64748B] font-medium mt-1">{contagem.total} OP(s) • {pctAssinado}% assinada(s)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <label className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider cursor-pointer bg-gray-50 px-3 h-[42px] rounded-xl border border-gray-200 select-none min-w-[100px]">
              <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} className="accent-amber-600" />
              <span className={sandbox ? 'text-amber-600' : 'text-red-600'}>{sandbox ? '🧪 Teste' : '⚠ Real'}</span>
            </label>
            <button onClick={atualizarTodas} disabled={atualizandoTodas} className="flex-grow sm:flex-initial bg-[#336699] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#284B8C] transition-all disabled:opacity-50 text-center">
              {atualizandoTodas ? '⏳ Atualizando...' : '↻ Atualizar Todas'}
            </button>
          </div>
        </div>

        {/* Grelha de Indicadores Operacionais */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { k: 'total', lbl: 'Total de OPs', val: contagem.total, bg: 'border-t-[#0C1D4D]' },
            { k: 'NAO_ENVIADO', lbl: 'Não Enviadas', val: contagem.NAO_ENVIADO, bg: 'border-t-[#64748B]' },
            { k: 'ENVIADO', lbl: 'Aguardando', val: contagem.ENVIADO + contagem.VISUALIZADO, bg: 'border-t-[#4F46E5]' },
            { k: 'ASSINADO', lbl: 'Assinadas', val: contagem.ASSINADO, bg: 'border-t-[#16A34A]' },
            { k: 'REJEITADO', lbl: 'Rejeitadas', val: contagem.REJEITADO, bg: 'border-t-[#DC2626]' },
          ].map(c => (
            <div key={c.k} className={`bg-white rounded-2xl shadow-sm border border-[#E2E8F0] border-t-4 ${c.bg} p-4 text-center`}>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{c.lbl}</p>
              <p className="text-3xl font-black text-[#0C1D4D]">{c.val}</p>
            </div>
          ))}
        </div>

        {/* Busca + Barra de Seleção de Filtros */}
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <input
            type="text"
            placeholder="🔍 Busca livre (Nº OP, OS, Cliente, Favorecido)..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full md:w-80 p-2.5 border border-[#CBD5E1] rounded-xl text-sm font-semibold text-[#0A2A4A] bg-white focus:border-[#336699] outline-none transition-all shadow-sm"
          />
          <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm gap-1 flex-wrap">
            {(['TODOS', 'NAO_ENVIADO', 'ENVIADO', 'VISUALIZADO', 'ASSINADO', 'REJEITADO'] as const).map(f => (
              <button key={f} onClick={() => setFiltro(f)} className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtro === f ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D] hover:bg-gray-50'}`}>
                {f === 'TODOS' ? 'Todos' : STATUS_INFO[f].label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabela de Dados */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#0C1D4D] border-t-transparent rounded-full animate-spin"></div>
              Buscando registros...
            </div>
          ) : filtradas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
              {ops.length === 0 ? 'Nenhuma OP encontrada.' : busca ? 'Nenhuma OP encontrada para esta busca.' : 'Nenhuma OP com este status.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                  <tr className="text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                    <th className="p-4">OP / Favorecido</th>
                    <th className="p-4 text-center w-36">Status</th>
                    <th className="p-4">Enviado em</th>
                    <th className="p-4">Assinado em</th>
                    <th className="p-4 text-right">Valor</th>
                    <th className="p-4 text-center w-48">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] font-medium">
                  {filtradas.map(op => {
                    const status = statusDe(op);
                    const info = STATUS_INFO[status];
                    const completos = dadosCompletos(op);
                    return (
                      <tr key={op.id} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-4">
                          <span className="font-black text-[#0C1D4D] text-sm block">OP #{op.numero_op} — {op.empresa_recebedora}</span>
                          <span className="text-[10px] text-gray-400 font-bold block uppercase mt-0.5">OS {op.os_numero || 'S/N'} — {op.os_cliente}</span>
                          {!completos && (
                            <span className="text-[10px] text-amber-600 font-black block mt-0.5">⚠ CPF/celular do signatário incompletos — edite a OP</span>
                          )}
                          {op.assinatura?.sandbox && status !== 'NAO_ENVIADO' && (
                            <span className="mt-0.5 inline-block text-amber-600 font-black bg-amber-50 px-1.5 py-0.5 rounded text-[8px]">AMB. TESTE</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <span className="text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider inline-flex items-center gap-1" style={{ color: info.cor, background: info.bg }}>
                            {info.icone} {info.label}
                          </span>
                        </td>
                        <td className="p-4 text-[11px] text-gray-600">{dataHora(op.assinatura?.enviado_em || null)}</td>
                        <td className="p-4 text-[11px] text-gray-600">{dataHora(op.assinatura?.assinado_em || null)}</td>
                        <td className="p-4 text-right text-[12px] font-black text-[#0C1D4D]">{formatarMoeda(op.total_geral)}</td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {(status === 'NAO_ENVIADO' || status === 'REJEITADO') && (
                              <button onClick={() => enviar(op)} disabled={enviando !== null} title={!completos ? 'CPF/celular do signatário incompletos' : ''} className="text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50 border border-indigo-200 bg-white transition-colors">
                                {enviando === op.id ? '...' : '📤 Enviar'}
                              </button>
                            )}
                            {status !== 'NAO_ENVIADO' && status !== 'ASSINADO' && status !== 'REJEITADO' && (
                              <button onClick={() => consultar(op)} disabled={consultando !== null} className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:bg-blue-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50 border border-blue-200 bg-white transition-colors">
                                {consultando === op.id ? '...' : '↻ Consultar'}
                              </button>
                            )}
                            {op.assinatura?.link_assinatura && status !== 'ASSINADO' && (
                              <a href={op.assinatura.link_assinatura} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white transition-colors inline-block">
                                🔗 Link
                              </a>
                            )}
                            {status === 'ASSINADO' && (
                              <button onClick={() => abrirAssinado(op)} disabled={baixando !== null} className="text-[10px] font-black text-green-700 uppercase tracking-wider hover:bg-green-50 px-2.5 py-1.5 rounded-lg border border-green-200 disabled:opacity-50 bg-white transition-colors">
                                {baixando === op.id ? '...' : '⬇ Obter PDF'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 font-bold tracking-wide mt-2 text-center uppercase">
          A atualização sincroniza nativamente através dos webhooks da infraestrutura da Autentique. Use "↻ Consultar" ou "↻ Atualizar Todas" se precisar forçar uma varredura manual.
        </p>
      </div>
    </div>
  );
}
