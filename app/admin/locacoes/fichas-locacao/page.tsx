"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarDataBR } from '../../../lib/formatadores';
import { listarFichasLocacaoAction } from './actions';

// Fichas de Locação (2026-11-20): as próprias (saída/devolução feitas aqui) e
// o histórico do P2S (importado, só leitura).
interface Linha {
  id: number; numero: string; origem: 'SISTEMA' | 'P2S'; status: string; empresa_id: number; cliente: string; evento: string | null;
  os: string | null; reserva_id: number | null; saida: string | null; devolucao: string | null; inicio: string | null; fim: string | null;
  com_cliente: number | null; atrasada: boolean;
}

const fmtQtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default function FichasLocacaoPage() {
  const router = useRouter();
  const toast = useToast();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [origem, setOrigem] = useState<'SISTEMA' | 'P2S' | 'TODAS'>('SISTEMA');
  const [status, setStatus] = useState<'' | 'A' | 'F'>('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<{ total: number; porPagina: number; fichas: Linha[]; indicadores: { abertasProprias: number; abertasP2s: number } } | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setBuscaAplicada(busca); setPagina(0); }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await listarFichasLocacaoAction({ origem, status, busca: buscaAplicada, pagina }, accessToken);
      if (!vivo) return;
      if (r.ok) setDados(r.info); else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, origem, status, buscaAplicada, pagina]);

  if (authLoading) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar as Fichas de Locação.</p>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const fichas = dados?.fichas || [];
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;
  const selo = (f: Linha) => {
    if (f.status === 'F') return <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-gray-200 text-gray-600">Finalizada</span>;
    // C = cancelada na limpeza do ensaio da Virada da Chave (2026-11-22)
    if (f.status === 'C') return <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-gray-100 text-gray-400 line-through">Cancelada (ensaio)</span>;
    if (f.atrasada) return <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-red-100 text-red-700">Atrasada</span>;
    if (f.origem === 'SISTEMA' && !f.saida) return <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-cyan-100 text-cyan-700">Aguardando saída</span>;
    return <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase bg-violet-100 text-violet-700">Em locação</span>;
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">🚚 <strong>Olá, {usuarioAtual}</strong>. Fichas de locação: saídas, devoluções e o que está com o cliente.</p>
        <button onClick={() => router.push('/admin/locacoes')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
              <p className="text-2xl font-black text-[#0C1D4D]">{dados ? dados.indicadores.abertasProprias : '—'}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Abertas (sistema)</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
              <p className="text-2xl font-black text-[#0C1D4D]">{dados ? dados.indicadores.abertasP2s : '—'}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Abertas no P2S</p>
            </div>
            <div className="col-span-2 bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm text-xs text-gray-600 leading-relaxed">
              A ficha de locação nasce da OS reservada (FR-…) na primeira saída — pela conferência da Expedição ou pelo botão na ficha de reserva. As do P2S aparecem só para consulta.
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 flex flex-col md:flex-row gap-3 md:items-center">
            <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-[10px] font-black uppercase tracking-wider">
              {([['SISTEMA', 'Do sistema'], ['P2S', 'Histórico P2S'], ['TODAS', 'Todas']] as const).map(([v, r]) => (
                <button key={v} onClick={() => { setOrigem(v); setPagina(0); }} className={`px-3 py-2 ${origem === v ? 'bg-[#0C1D4D] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{r}</button>
              ))}
            </div>
            <div className="flex rounded-lg border border-[#E2E8F0] overflow-hidden text-[10px] font-black uppercase tracking-wider">
              {([['', 'Todas'], ['A', 'Abertas'], ['F', 'Finalizadas']] as const).map(([v, r]) => (
                <button key={v || 'todas'} onClick={() => { setStatus(v); setPagina(0); }} className={`px-3 py-2 ${status === v ? 'bg-[#336699] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{r}</button>
              ))}
            </div>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número ou cliente..."
              className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#336699]" />
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            <div className="overflow-x-auto relative min-h-[120px]">
              {carregando && <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10"><div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>}
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8]">
                  <tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                    <th className="p-3">Ficha</th><th className="p-3">OS</th><th className="p-3">Cliente / evento</th><th className="p-3">Período</th>
                    <th className="p-3">Saída</th><th className="p-3">Devolução</th><th className="p-3 text-right">Com o cliente</th><th className="p-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {!carregando && !fichas.length && (
                    <tr><td colSpan={8} className="p-8 text-center text-gray-400 font-bold text-xs uppercase">
                      {origem === 'SISTEMA' ? 'Nenhuma ficha de locação do sistema ainda — ela nasce na primeira saída de uma OS reservada.' : 'Nenhuma ficha encontrada.'}
                    </td></tr>
                  )}
                  {fichas.map(f => (
                    <tr key={f.id} onClick={() => router.push(`/admin/locacoes/fichas-locacao/${f.id}`)} className="border-t border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer">
                      <td className="p-3 whitespace-nowrap">
                        <span className="font-black text-[#0C1D4D]">{f.numero}</span>
                        <span className={`ml-2 text-[9px] font-black px-1.5 py-0.5 rounded ${corSeloEmpresa(f.empresa_id)}`}>{f.origem === 'P2S' ? 'P2S' : 'SIS'}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap text-gray-600">{f.os || '—'}</td>
                      <td className="p-3 min-w-[220px]"><p className="font-bold">{f.cliente}</p>{f.evento && <p className="text-[10px] text-gray-500">{f.evento}</p>}</td>
                      <td className="p-3 whitespace-nowrap">{f.inicio ? `${formatarDataBR(f.inicio)} a ${formatarDataBR(f.fim)}` : '—'}</td>
                      <td className="p-3 whitespace-nowrap">{formatarDataBR(f.saida)}</td>
                      <td className="p-3 whitespace-nowrap">{formatarDataBR(f.devolucao)}</td>
                      <td className="p-3 text-right font-black">{f.com_cliente == null ? '—' : fmtQtd(f.com_cliente)}</td>
                      <td className="p-3">{selo(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dados && dados.total > dados.porPagina && (
              <div className="flex items-center justify-between p-3 border-t border-[#E2E8F0] text-xs">
                <span className="text-gray-500">{dados.total.toLocaleString('pt-BR')} ficha(s) · página {pagina + 1} de {paginas}</span>
                <div className="flex gap-2">
                  <button disabled={pagina === 0} onClick={() => setPagina(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-[#E2E8F0] font-black disabled:opacity-40">‹ Anterior</button>
                  <button disabled={pagina + 1 >= paginas} onClick={() => setPagina(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-[#E2E8F0] font-black disabled:opacity-40">Próxima ›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
