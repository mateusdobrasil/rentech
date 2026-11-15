"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarContasReceberAction, resumoContasReceberAction, sincronizarContasReceberP2sAction, buscarUltimaSincronizacaoContasReceberAction,
  type SituacaoReceber,
} from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import UltimaSincronizacaoInfo from '../../../components/ui/UltimaSincronizacaoInfo';
import type { UltimaSincronizacao } from '../../../lib/syncLog';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';

// Contas a Receber sincronizadas do PrimeStart (pedido de 2026-11-15) —
// irmã de /admin/financeiro/contas-pagar. A leitura vem do servidor, já
// filtrada pelas empresas do usuário (ver actions.ts).

interface ContaReceberGrid {
  id: number; empresa_id: number | null; cliente: string | null; descricao: string | null;
  documento: string | null; num_documento: string | null; num_parcela: string | null; evento: string | null;
  centro_financeiro: string | null; forma_pagamento: string | null; conta_financeira: string | null;
  valor_final: number | null; valor_pago: number | null;
  data_emissao: string | null; data_vencimento: string | null; data_quitacao: string | null; quitado: boolean; prorrogado: boolean;
}
type ValorQtd = { valor: number; qtd: number };
interface Resumo { aVencer: ValorQtd; aVencer7d: ValorQtd; vencidoAte1Ano: ValorQtd; vencidoMais1Ano: ValorQtd; recebidoMes: ValorQtd }
interface EmpresaOpcao { id: number; nome: string; fonte_recebimentos: 'P2S' | 'EXTERNA' }

const formatarDataBR = (iso: string | null): string => {
  if (!iso) return '—';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
};
const formatarMoeda = (v: number | null | undefined): string =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diasEntre = (de: string, ate: string) => Math.round((new Date(`${ate}T12:00:00Z`).getTime() - new Date(`${de}T12:00:00Z`).getTime()) / 86_400_000);

const SITUACOES: { valor: SituacaoReceber; rotulo: string }[] = [
  { valor: 'abertas', rotulo: 'Em aberto (todas)' },
  { valor: 'a_vencer', rotulo: 'A vencer' },
  { valor: 'vencidas_ate_1_ano', rotulo: 'Vencidas (até 1 ano)' },
  { valor: 'vencidas_mais_1_ano', rotulo: 'Vencidas há mais de 1 ano' },
  { valor: 'vencidas', rotulo: 'Vencidas (todas)' },
  { valor: 'quitadas', rotulo: 'Recebidas' },
  { valor: 'todas', rotulo: 'Todas' },
];

export default function ContasReceberPage() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [sincronizando, setSincronizando] = useState(false);
  const [feedback, setFeedback] = useState<{ show: boolean; msg: string; tipo: 'success' | 'error' }>({ show: false, msg: '', tipo: 'success' });

  const [linhas, setLinhas] = useState<ContaReceberGrid[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [gridLoading, setGridLoading] = useState(true);
  const [gridErro, setGridErro] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState<SituacaoReceber>('vencidas_ate_1_ano');
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  const [filtroDataDe, setFiltroDataDe] = useState('');
  const [filtroDataAte, setFiltroDataAte] = useState('');
  const [pagina, setPagina] = useState(0);
  const [total, setTotal] = useState(0);
  const [soma, setSoma] = useState(0);
  const [tamanhoPagina, setTamanhoPagina] = useState(50);
  const [hoje, setHoje] = useState(new Date().toISOString().slice(0, 10));
  const [refresh, setRefresh] = useState(0);

  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [ultimaSync, setUltimaSync] = useState<UltimaSincronizacao | null>(null);
  const [ultimaSyncLoading, setUltimaSyncLoading] = useState(true);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    let ativo = true;
    buscarUltimaSincronizacaoContasReceberAction(accessToken).then(res => {
      if (!ativo) return;
      if (res.ok) setUltimaSync(res.info);
      setUltimaSyncLoading(false);
    });
    return () => { ativo = false; };
  }, [authLoading, acessoNegado, accessToken, refresh]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    let ativo = true;
    resumoContasReceberAction(filtroEmpresa, accessToken).then(res => { if (ativo && res.ok) setResumo(res.info); });
    return () => { ativo = false; };
  }, [authLoading, acessoNegado, accessToken, filtroEmpresa, refresh]);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    let ativo = true;
    const handle = setTimeout(async () => {
      setGridLoading(true);
      const res = await listarContasReceberAction({ texto: filtroTexto, situacao: filtroSituacao, empresaId: filtroEmpresa, de: filtroDataDe, ate: filtroDataAte, pagina }, accessToken);
      if (!ativo) return;
      if (!res.ok) { setGridErro(res.erro || 'Erro ao carregar.'); setLinhas([]); }
      else {
        setGridErro('');
        setLinhas(res.info.linhas); setEmpresas(res.info.empresas); setTotal(res.info.total); setSoma(res.info.soma);
        setTamanhoPagina(res.info.tamanhoPagina); if (res.info.hoje) setHoje(res.info.hoje);
      }
      setGridLoading(false);
    }, 300);
    return () => { ativo = false; clearTimeout(handle); };
  }, [authLoading, acessoNegado, accessToken, pagina, filtroSituacao, filtroTexto, filtroEmpresa, filtroDataDe, filtroDataAte, refresh]);

  const sincronizarViaApi = async () => {
    setSincronizando(true);
    setFeedback({ show: false, msg: '', tipo: 'success' });
    try {
      const res = await sincronizarContasReceberP2sAction(accessToken);
      if (!res.ok) { setFeedback({ show: true, tipo: 'error', msg: `Falha ao sincronizar com o PrimeStart: ${res.erro}` }); return; }
      setFeedback({ show: true, tipo: 'success', msg: `${res.info.processados} título(s) sincronizado(s) do PrimeStart (${res.info.abertas} em aberto, ${res.info.quitadas} recebidos).` });
      setPagina(0);
      setUltimaSyncLoading(true);
      setRefresh(v => v + 1);
    } finally {
      setSincronizando(false);
    }
  };

  const mudar = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPagina(0); };
  const quitadas = filtroSituacao === 'quitadas';
  const empresaFonteExterna = filtroEmpresa ? empresas.find(e => e.id === filtroEmpresa)?.fonte_recebimentos === 'EXTERNA' : false;

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Contas a Receber.</p>
          <button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  const cartoes: { titulo: string; v?: ValorQtd; destaque?: boolean; filtro: SituacaoReceber; dica?: string }[] = [
    { titulo: 'A vencer', v: resumo?.aVencer, filtro: 'a_vencer', dica: resumo ? `${formatarMoeda(resumo.aVencer7d.valor)} nos próximos 7 dias` : undefined },
    { titulo: 'Vencido até 1 ano', v: resumo?.vencidoAte1Ano, destaque: (resumo?.vencidoAte1Ano.qtd ?? 0) > 0, filtro: 'vencidas_ate_1_ano', dica: 'Inadimplência real' },
    { titulo: 'Vencido há mais de 1 ano', v: resumo?.vencidoMais1Ano, filtro: 'vencidas_mais_1_ano', dica: 'Quase sempre baixa pendente no P2S' },
    { titulo: 'Recebido no mês', v: resumo?.recebidoMes, filtro: 'quitadas', dica: `Desde 01/${hoje.slice(5, 7)}` },
  ];

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🧾 <strong>Olá, {usuarioAtual}</strong>. Contas a receber sincronizadas direto do PrimeStart.
        </p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cartoes.map(c => (
              <button key={c.titulo} onClick={() => { setFiltroSituacao(c.filtro); setFiltroDataDe(''); setFiltroDataAte(''); setPagina(0); }}
                className={`text-left bg-white p-4 rounded-2xl border shadow-sm hover:shadow-md transition-all min-w-0 ${filtroSituacao === c.filtro ? 'border-[#336699]' : c.destaque ? 'border-red-200' : 'border-[#E2E8F0]'}`}>
                <p className={`text-lg font-black leading-tight truncate ${c.destaque ? 'text-red-600' : 'text-[#0C1D4D]'}`}>{c.v ? formatarMoeda(c.v.valor) : '—'}</p>
                <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider leading-tight mt-1">{c.titulo}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-1 truncate">{c.v ? `${c.v.qtd} título(s)` : 'carregando...'}{c.dica ? ` · ${c.dica}` : ''}</p>
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Sincronizar via API</h2>
            <p className="text-xs text-[#64748B] mb-4">
              Puxa do PrimeStart (produção) todos os títulos em aberto (inclusive vencidos) e os recebidos com vencimento nos últimos ~13 meses. Roda sozinho às 9h30, 11h e 17h. Leva cerca de 1 minuto.
            </p>
            <button onClick={sincronizarViaApi} disabled={sincronizando}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-bold uppercase text-xs tracking-wider transition-colors">
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
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Contas a Receber</h2>
              <span className="text-xs font-black uppercase tracking-wider text-[#64748B]">
                {total} título(s) · {formatarMoeda(soma)}
              </span>
            </div>

            {empresas.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                <button onClick={() => mudar(setFiltroEmpresa)(null)}
                  className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === null ? `${corSeloEmpresa(null)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>Todas</button>
                {empresas.map(e => (
                  <button key={e.id} onClick={() => mudar(setFiltroEmpresa)(e.id)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>
                ))}
              </div>
            )}
            {empresaFonteExterna && (
              <p className="mb-4 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Os recebimentos desta empresa estão marcados como “outra fonte” em Empresas do Grupo — os títulos do P2S abaixo podem não refletir o que foi recebido.
              </p>
            )}

            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <input type="text" value={filtroTexto} onChange={(e) => mudar(setFiltroTexto)(e.target.value)}
                placeholder="Buscar por cliente, descrição, nº do documento, evento ou centro..."
                className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]" />
              <select value={filtroSituacao} onChange={(e) => mudar(setFiltroSituacao)(e.target.value as SituacaoReceber)}
                className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]">
                {SITUACOES.map(s => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
              </select>
            </div>

            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-[#64748B] mb-1">{quitadas ? 'Recebido de' : 'Vencimento de'}</label>
                <input type="date" value={filtroDataDe} onChange={(e) => mudar(setFiltroDataDe)(e.target.value)}
                  className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-[#64748B] mb-1">{quitadas ? 'Recebido até' : 'Vencimento até'}</label>
                <input type="date" value={filtroDataAte} onChange={(e) => mudar(setFiltroDataAte)(e.target.value)}
                  className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]" />
              </div>
              {(filtroDataDe || filtroDataAte) && (
                <button onClick={() => { setFiltroDataDe(''); setFiltroDataAte(''); setPagina(0); }}
                  className="text-xs font-black uppercase tracking-wider bg-red-50 text-red-500 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-100 transition-colors">
                  ✕ Limpar datas
                </button>
              )}
            </div>

            {gridErro && <p className="mb-3 text-sm font-bold text-red-600">⚠ {gridErro}</p>}

            <div className="overflow-x-auto max-h-[32rem] border border-[#E2E8F0] rounded-xl relative min-h-[120px]">
              {gridLoading && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
                  <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                </div>
              )}
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8] sticky top-0">
                  <tr className="text-left text-[#64748B] uppercase tracking-wider font-black">
                    <th className="p-2">{quitadas ? 'Recebido em' : 'Vencimento'}</th>
                    <th className="p-2">Cliente</th>
                    <th className="p-2">Documento</th>
                    <th className="p-2">Evento</th>
                    <th className="p-2">Centro</th>
                    {empresas.length > 1 && <th className="p-2">Empresa</th>}
                    <th className="p-2 text-right">Valor</th>
                    <th className="p-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.length === 0 && !gridLoading ? (
                    <tr><td colSpan={8} className="p-6 text-center text-[#94A3B8] font-bold uppercase text-xs">Nenhum título encontrado.</td></tr>
                  ) : linhas.map(c => {
                    const vencida = !c.quitado && !!c.data_vencimento && c.data_vencimento < hoje;
                    const atraso = vencida && c.data_vencimento ? diasEntre(c.data_vencimento, hoje) : 0;
                    const empresa = empresas.find(e => e.id === c.empresa_id);
                    return (
                      <tr key={c.id} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC]">
                        <td className="p-2 whitespace-nowrap">{formatarDataBR(c.quitado ? c.data_quitacao : c.data_vencimento)}</td>
                        <td className="p-2 font-bold">{c.cliente || '—'}</td>
                        <td className="p-2 whitespace-nowrap">{[c.documento, c.num_documento].filter(Boolean).join(' ') || '—'}{c.num_parcela ? <span className="text-gray-400"> · {c.num_parcela}</span> : null}</td>
                        <td className="p-2">{c.evento || '—'}</td>
                        <td className="p-2">{c.centro_financeiro || '—'}</td>
                        {empresas.length > 1 && (
                          <td className="p-2">{empresa ? <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${corSeloEmpresa(empresa.id)}`}>{empresa.nome}</span> : '—'}</td>
                        )}
                        <td className="p-2 text-right whitespace-nowrap">{formatarMoeda(c.quitado ? (c.valor_pago || c.valor_final) : c.valor_final)}</td>
                        <td className="p-2 whitespace-nowrap">
                          {c.quitado
                            ? <span className="text-green-600 font-bold">Recebido</span>
                            : vencida
                              ? <span className={`font-bold ${atraso > 365 ? 'text-gray-500' : 'text-red-600'}`} title={atraso > 365 ? 'Vencido há mais de 1 ano — provável baixa pendente no P2S' : undefined}>Vencido há {atraso} dia{atraso === 1 ? '' : 's'}</span>
                              : <span className="text-amber-600 font-bold">Em aberto{c.prorrogado ? ' (prorrogado)' : ''}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between items-center gap-2 mt-4">
              <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0 || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">⬅ Anterior</button>
              <span className="text-xs font-bold text-[#64748B]">Página {total === 0 ? 0 : pagina + 1} de {Math.max(1, Math.ceil(total / tamanhoPagina))}</span>
              <button onClick={() => setPagina(p => p + 1)} disabled={(pagina + 1) * tamanhoPagina >= total || gridLoading}
                className="text-xs font-black uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#E2E8F0] transition-colors">Próxima ➡</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
