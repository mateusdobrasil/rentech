"use client";

// Hub Manuais (2026-11-23): todos os manuais do sistema num lugar só, lidos
// dentro do Rentech WEB (os documentos originais ficam no Claude, privados).
// Catálogo em ./catalogo.ts; manual restrito só aparece para quem pode abrir.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';
import { formatarDataBR } from '../../lib/formatadores';
import { GRUPOS, MANUAIS, podeVerManual } from './catalogo';

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function ManuaisHub() {
  const router = useRouter();
  const { usuarioAtual, permissaoNormalizada, authLoading, acessoNegado, erro, tentarNovamente } = usePageAccess({ rota: '/admin/manuais' });
  const [busca, setBusca] = useState('');

  // O card fica no fim do Painel: sem isso a lista abria com a rolagem da
  // página anterior (mostrando o fim). Sobe para o topo quando a lista aparece.
  useEffect(() => { if (!authLoading) window.scrollTo(0, 0); }, [authLoading]);

  const visiveis = useMemo(() => {
    const q = normalizar(busca.trim());
    return MANUAIS.filter(m => podeVerManual(m, permissaoNormalizada))
      .filter(m => !q || normalizar(`${m.titulo} ${m.descricao}`).includes(q));
  }, [busca, permissaoNormalizada]);

  if (authLoading) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center"><p className="text-sm font-bold text-gray-500">Carregando…</p></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Manuais.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Painel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">📚 <strong>Olá, {usuarioAtual}</strong>. Manuais do sistema.</p>
        <button onClick={() => router.push('/admin')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">⬅ Voltar ao Painel</button>
      </div>

      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Manuais</h1>
            <p className="text-[#64748B] font-medium">Como usar o sistema, passo a passo, com as telas reais.</p>
          </div>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar manual…"
            className="w-full md:w-80 border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm bg-white" />
        </div>

        {GRUPOS.map(g => {
          const itens = visiveis.filter(m => m.grupo === g.grupo);
          if (!itens.length) return null;
          return (
            <section key={g.grupo}>
              <h2 className="text-xs font-black uppercase tracking-wider text-[#0C1D4D]">{g.titulo}</h2>
              <p className="text-xs text-gray-500 mb-3">{g.descricao}</p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {itens.map(m => (
                  <button key={m.slug} onClick={() => router.push(`/admin/manuais/${m.slug}`)}
                    className="text-left bg-white border border-[#E2E8F0] hover:border-[#336699] rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-3xl leading-none">{m.icone}</span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {!m.fonte && m.pdf && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">PDF</span>}
                        {m.restrito && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Diretoria</span>}
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wide">{m.titulo}</h3>
                    <p className="text-xs text-gray-600 leading-relaxed flex-1">{m.descricao}</p>
                    <p className="text-[10px] font-bold text-gray-400">Atualizado em {formatarDataBR(m.atualizadoEm)}</p>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {!visiveis.length && <p className="text-sm text-gray-500">Nenhum manual encontrado para “{busca}”.</p>}
      </div>
    </div>
  );
}
