"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { sincronizarContasPagarP2sAction, buscarUltimaSincronizacaoContasPagarAction } from './actions';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import UltimaSincronizacaoInfo from '../../../components/ui/UltimaSincronizacaoInfo';
import type { UltimaSincronizacao } from '../../../lib/syncLog';

interface ContaPagarGrid {
  id: number;
  descricao: string | null;
  fornecedor: string | null;
  centro: string | null;
  valor: number | null;
  data_vencimento: string | null;
  quitado: boolean;
  forma_pagamento: string | null;
}

const TAMANHO_PAGINA = 50;

const formatarDataBR = (iso: string | null): string => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
};

const formatarMoeda = (v: number | null): string =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const hojeISO = (): string => new Date().toISOString().slice(0, 10);

export default function ContasPagarPage() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [sincronizando, setSincronizando] = useState(false);
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; tipo: 'success' | 'error' }>({ show: false, msg: '', tipo: 'success' });

  const [contasGrid, setContasGrid] = useState<ContaPagarGrid[]>([]);
  const [gridLoading, setGridLoading] = useState(false);
  const [gridErro, setGridErro] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState<'abertas' | 'vencidas' | 'quitadas' | 'todas'>('quitadas');
  const [pagina, setPagina] = useState(0);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [refreshGrid, setRefreshGrid] = useState(0);

  const [ultimaSync, setUltimaSync] = useState<UltimaSincronizacao | null>(null);
  const [ultimaSyncLoading, setUltimaSyncLoading] = useState(true);

  const carregarUltimaSync = async () => {
    setUltimaSyncLoading(true);
    const res = await buscarUltimaSincronizacaoContasPagarAction(accessToken);
    if (res.ok) setUltimaSync(res.info);
    setUltimaSyncLoading(false);
  };

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    carregarUltimaSync();
  }, [authLoading, acessoNegado]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;

    const handle = setTimeout(async () => {
      setGridLoading(true);
      setGridErro('');

      let query = supabase
        .from('contas_pagar')
        .select('id, descricao, fornecedor, centro, valor, data_vencimento, quitado, forma_pagamento', { count: 'exact' })
        .order('data_vencimento', { ascending: true, nullsFirst: false })
        .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);

      if (filtroSituacao === 'abertas') query = query.eq('quitado', false);
      else if (filtroSituacao === 'vencidas') query = query.eq('quitado', false).lt('data_vencimento', hojeISO());
      else if (filtroSituacao === 'quitadas') query = query.eq('quitado', true);

      if (filtroTexto.trim()) {
        const termo = `%${filtroTexto.trim()}%`;
        query = query.or(`descricao.ilike.${termo},fornecedor.ilike.${termo},centro.ilike.${termo}`);
      }

      const { data, error, count } = await query;
      if (error) {
        setGridErro(error.message);
        setContasGrid([]);
      } else {
        setContasGrid(data || []);
        setTotalRegistros(count || 0);
      }
      setGridLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [authLoading, acessoNegado, pagina, filtroSituacao, filtroTexto, refreshGrid]);

  const sincronizarViaApi = async () => {
    setSincronizando(true);
    setFeedback({ show: false, msg: '', tipo: 'success' });
    try {
      const res = await sincronizarContasPagarP2sAction({}, accessToken);
      if (!res.ok) {
        setFeedback({ show: true, tipo: 'error', msg: `Falha ao sincronizar com o PrimeStart: ${res.erro}` });
        return;
      }
      await registrarLogAuditoria({
        usuario_nome: usuarioAtual,
        acao: 'SINCRONIZOU CONTAS A PAGAR VIA API (P2S)',
        setor: 'FINANCEIRO',
        equipamento_nome: `${res.info.processados} registro(s)`,
      });
      setFeedback({ show: true, tipo: 'success', msg: `${res.info.processados} conta(s) sincronizada(s) direto do PrimeStart (${res.info.totalEncontradas} encontrada(s) no total).` });
      setPagina(0);
      setRefreshGrid(v => v + 1);
      carregarUltimaSync();
    } finally {
      setSincronizando(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Contas a Pagar.</p>
          <button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          💳 <strong>Olá, {usuarioAtual}</strong>. Contas a pagar sincronizadas direto do PrimeStart.
        </p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Sincronizar via API</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Puxa direto do PrimeStart (produção) as contas a pagar já quitadas dos últimos 3 meses (mais todas as futuras). Sem tela de upload manual — essa integração é só via API.
            </p>
            <button
              onClick={sincronizarViaApi}
              disabled={sincronizando}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider transition-colors"
            >
              {sincronizando ? 'Sincronizando...' : '🔄 Sincronizar agora'}
            </button>
            <UltimaSincronizacaoInfo info={ultimaSync} carregando={ultimaSyncLoading} />
          </div>

          {feedback.show && (
            <div className={`p-4 rounded-xl border font-bold text-sm ${feedback.tipo === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {feedback.tipo === 'success' ? '✅' : '⚠'} {feedback.msg}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Contas a Pagar</h2>
              <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                {totalRegistros} registro(s)
              </span>
            </div>

            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <input
                type="text"
                value={filtroTexto}
                onChange={(e) => { setFiltroTexto(e.target.value); setPagina(0); }}
                placeholder="Buscar por descrição, fornecedor ou centro..."
                className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
              />
              <select
                value={filtroSituacao}
                onChange={(e) => { setFiltroSituacao(e.target.value as typeof filtroSituacao); setPagina(0); }}
                className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]"
              >
                <option value="abertas">Em aberto</option>
                <option value="vencidas">Vencidas</option>
                <option value="quitadas">Quitadas</option>
                <option value="todas">Todas</option>
              </select>
            </div>

            {gridErro && (
              <p className="mb-3 text-sm font-bold text-red-600">⚠ {gridErro}</p>
            )}

            <div className="overflow-x-auto max-h-96 border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
              {gridLoading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                </div>
              )}
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8] sticky top-0">
                  <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                    <th className="p-2">Vencimento</th>
                    <th className="p-2">Descrição</th>
                    <th className="p-2">Fornecedor</th>
                    <th className="p-2">Centro</th>
                    <th className="p-2">Forma Pagto</th>
                    <th className="p-2">Valor</th>
                    <th className="p-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {contasGrid.length === 0 && !gridLoading ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">
                        Nenhuma conta encontrada.
                      </td>
                    </tr>
                  ) : (
                    contasGrid.map((c) => {
                      const vencida = !c.quitado && c.data_vencimento && c.data_vencimento < hojeISO();
                      return (
                        <tr key={c.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC]">
                          <td className="p-2">{formatarDataBR(c.data_vencimento)}</td>
                          <td className="p-2 font-bold">{c.descricao || '—'}</td>
                          <td className="p-2">{c.fornecedor || '—'}</td>
                          <td className="p-2">{c.centro || '—'}</td>
                          <td className="p-2">{c.forma_pagamento || '—'}</td>
                          <td className="p-2">{formatarMoeda(c.valor)}</td>
                          <td className="p-2">
                            {c.quitado
                              ? <span className="text-green-600 font-bold">Quitada</span>
                              : vencida
                                ? <span className="text-red-600 font-bold">Vencida</span>
                                : <span className="text-amber-600 font-bold">Em aberto</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 mt-4">
              <button
                onClick={() => setPagina(p => Math.max(0, p - 1))}
                disabled={pagina === 0 || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
              >
                ⬅ Anterior
              </button>
              <span className="text-xs font-bold text-[#64748B]">
                Página {totalRegistros === 0 ? 0 : pagina + 1} de {Math.max(1, Math.ceil(totalRegistros / TAMANHO_PAGINA))}
              </span>
              <button
                onClick={() => setPagina(p => p + 1)}
                disabled={(pagina + 1) * TAMANHO_PAGINA >= totalRegistros || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors"
              >
                Próxima ➡
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
