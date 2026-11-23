"use client";

// Leitura de um manual (2026-11-23): o HTML gerado de docs/manuais vem da
// action depois da checagem de acesso; sumário fixo à esquerda, imprimir ou
// salvar em PDF pelo navegador, e leitor/baixar quando o manual é um PDF.
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { formatarDataBR } from '../../../lib/formatadores';
import { manualPorSlug } from '../catalogo';
import { abrirManualAction } from '../actions';
import '../manual.css';

type Conteudo = { html: string | null; sumario: { id: string; texto: string }[]; pdf: string | null };

export default function LerManual() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const manual = manualPorSlug(slug);
  const { accessToken, authLoading, acessoNegado, erro, tentarNovamente } = usePageAccess({ rota: '/admin/manuais' });
  const [conteudo, setConteudo] = useState<Conteudo | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !manual) return;
    let vivo = true;
    abrirManualAction(manual.slug, accessToken).then(r => {
      if (!vivo) return;
      if (r.ok && r.info) setConteudo(r.info); else setFalha(r.erro || 'Não foi possível abrir o manual.');
    });
    return () => { vivo = false; };
  }, [accessToken, manual]);

  // Abre no início do manual (não na rolagem da lista), salvo link com #seção.
  useEffect(() => {
    if (!conteudo) return;
    const alvo = window.location.hash ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    if (alvo) alvo.scrollIntoView(); else window.scrollTo(0, 0);
  }, [conteudo]);

  // PDF em base64 → link de arquivo para o leitor e o botão de baixar.
  const urlPdf = useMemo(() => {
    if (!conteudo?.pdf) return null;
    const bin = atob(conteudo.pdf);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }, [conteudo]);
  useEffect(() => () => { if (urlPdf) URL.revokeObjectURL(urlPdf); }, [urlPdf]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center"><p className="text-sm font-bold text-gray-500">Carregando…</p></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado || !manual || falha) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">{!manual ? '🔎' : '⛔'}</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">{!manual ? 'Manual não encontrado' : 'Acesso Restrito'}</h2>
          <p className="text-sm text-gray-500 mb-6">{!manual ? 'Este endereço não corresponde a nenhum manual.' : falha || 'Você não possui permissão para acessar os Manuais.'}</p>
          <button onClick={() => router.push('/admin/manuais')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar aos Manuais</button>
        </div>
      </div>
    );
  }

  const nomePdf = `${manual.titulo}.pdf`;
  const btn = 'text-[10px] md:text-xs font-black px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase';

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="manual-nao-imprimir bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">{manual.icone} <strong>{manual.titulo}</strong> · atualizado em {formatarDataBR(manual.atualizadoEm)}</p>
        <div className="flex flex-wrap gap-2">
          {conteudo?.html && <button onClick={() => window.print()} className={`${btn} bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1]`}>🖨 Imprimir / salvar PDF</button>}
          {urlPdf && <a href={urlPdf} download={nomePdf} className={`${btn} bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1]`}>⬇ Baixar PDF</a>}
          <button onClick={() => router.push('/admin/manuais')} className={`${btn} bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1]`}>⬅ Manuais</button>
        </div>
      </div>

      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-8">
        {manual.aviso && <p className="manual-nao-imprimir mb-6 text-sm rounded-xl border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3">⚠ {manual.aviso}</p>}
        {!conteudo ? (
          <p className="text-sm font-bold text-gray-500">Abrindo o manual…</p>
        ) : conteudo.html ? (
          <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8 items-start">
            {conteudo.sumario.length > 1 && (
              <nav className="manual-nao-imprimir mb-6 lg:mb-0 lg:sticky lg:top-24 bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm">
                <details open className="lg:[&>summary]:pointer-events-none">
                  <summary className="text-[10px] font-black uppercase tracking-wider text-gray-500 cursor-pointer">Neste manual</summary>
                  <ol className="mt-2 space-y-1">
                    {conteudo.sumario.map(s => (
                      <li key={s.id}><a href={`#${s.id}`} className="block text-xs text-[#336699] hover:underline leading-snug py-0.5">{s.texto}</a></li>
                    ))}
                  </ol>
                </details>
              </nav>
            )}
            <article className="manual-imprimir bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-5 md:p-10 min-w-0">
              <h1 className="manual-titulo">{manual.titulo}</h1>
              <p className="manual-data">Atualizado em {formatarDataBR(manual.atualizadoEm)}</p>
              <div className="manual-conteudo" dangerouslySetInnerHTML={{ __html: conteudo.html }} />
            </article>
          </div>
        ) : urlPdf ? (
          <div className="bg-white border border-[#E2E8F0] rounded-2xl shadow-sm overflow-hidden">
            <iframe src={urlPdf} title={manual.titulo} className="w-full h-[80vh]" />
            <p className="text-xs text-gray-500 px-4 py-3 border-t border-[#E2E8F0]">O PDF não abriu aqui (comum no celular)? Use <a href={urlPdf} download={nomePdf} className="text-[#336699] font-bold underline">Baixar PDF</a>.</p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Este manual ainda não tem conteúdo.</p>
        )}
      </div>
    </div>
  );
}
