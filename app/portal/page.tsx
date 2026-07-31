"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../lib/supabase';
import { listarMeusDocumentosAction, urlMeuDocumentoAction, listarMeusHoleritesAction, urlMeuHoleriteAction } from './actions/actions-documentos';
import { buscarMeuCrachaAction } from './actions/actions-cracha';
import MeuCracha, { type DadosCracha } from './MeuCracha';

interface DocumentoPortal {
  id: number; categoria: string; titulo: string | null; nome_arquivo: string;
  tipo_mime: string | null; data_validade: string | null; criado_em: string;
}

interface HoleritePortal {
  id: number; mes_referencia: string; status: string; assinado_em: string | null;
}

const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtMesReferencia = (m: string) => {
  const [ano, mes] = m.split('-');
  if (!ano || !mes) return m;
  return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

export default function PortalDashboardPage() {
  const router = useRouter();
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [accessToken, setAccessToken] = useState('');

  const [aba, setAba] = useState<'documentos' | 'holerites'>('documentos');
  const [documentos, setDocumentos] = useState<DocumentoPortal[]>([]);
  const [holerites, setHolerites] = useState<HoleritePortal[]>([]);
  const [cracha, setCracha] = useState<DadosCracha | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    async function iniciar() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/portal/login'); return; }
      setAccessToken(session.access_token);
      setCarregandoSessao(false);
      await carregar(session.access_token);
    }
    iniciar();
  }, [router]);

  const carregar = async (token: string) => {
    setLoading(true);
    const [docsRes, holeritesRes, crachaRes] = await Promise.all([
      listarMeusDocumentosAction(token),
      listarMeusHoleritesAction(token),
      buscarMeuCrachaAction(token),
    ]);
    if (docsRes.ok) setDocumentos(docsRes.info.documentos);
    else setErro(docsRes.erro || 'Erro ao carregar documentos.');
    if (holeritesRes.ok) setHolerites(holeritesRes.info.holerites);
    if (crachaRes.ok) setCracha(crachaRes.info);
    setLoading(false);
  };

  const sair = async () => {
    await supabase.auth.signOut();
    router.push('/portal/login');
  };

  const abrirDocumento = async (doc: DocumentoPortal) => {
    const res = await urlMeuDocumentoAction(accessToken, { id: doc.id, download: true });
    if (!res.ok) { alert(res.erro || 'Erro ao abrir documento.'); return; }
    window.open(res.info.url, '_blank', 'noopener,noreferrer');
  };

  const abrirHolerite = async (h: HoleritePortal) => {
    const res = await urlMeuHoleriteAction(accessToken, { id: h.id });
    if (!res.ok) { alert(res.erro || 'Erro ao abrir holerite.'); return; }
    window.open(res.info.url, '_blank', 'noopener,noreferrer');
  };

  if (carregandoSessao) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">👤 <strong>Portal do Funcionário</strong>. Seus documentos pessoais e holerites.</p>
        <button onClick={sair} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          Sair
        </button>
      </div>

      {cracha && (
        <div className="px-4 md:px-8 pt-6 flex justify-center">
          <div className="w-full max-w-[1000px] overflow-x-auto pb-2">
            <div className="min-w-fit flex justify-center">
              <MeuCracha dados={cracha} />
            </div>
          </div>
        </div>
      )}

      <div className="px-4 md:px-8 pt-4 flex gap-2 border-b border-[#E2E8F0] bg-white">
        <button
          onClick={() => setAba('documentos')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'documentos' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          📁 Meus Documentos
        </button>
        <button
          onClick={() => setAba('holerites')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'holerites' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          💰 Holerites
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1000px] mx-auto w-full flex-grow">
        {erro && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-4 py-3 rounded-lg">{erro}</div>}

        {aba === 'documentos' && (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-3 md:p-4 space-y-2">
            {loading ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Carregando...</p>
            ) : documentos.length === 0 ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Nenhum documento disponível ainda.</p>
            ) : documentos.map(doc => (
              <button key={doc.id} onClick={() => abrirDocumento(doc)} className="w-full text-left bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] p-3 flex items-center gap-3 hover:bg-blue-50 transition-colors">
                <div className="text-2xl">📎</div>
                <div className="flex-1 min-w-0">
                  <span className="font-black text-[#0C1D4D] text-[13px] uppercase">{doc.categoria}</span>
                  {doc.titulo && <p className="text-[11px] text-gray-600">{doc.titulo}</p>}
                  <p className="text-[10px] text-gray-400">{doc.nome_arquivo}{doc.data_validade && <> · vence {fmtData(doc.data_validade)}</>}</p>
                </div>
                <span className="text-gray-400">⬇</span>
              </button>
            ))}
          </div>
        )}

        {aba === 'holerites' && (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-3 md:p-4 space-y-2">
            {loading ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Carregando...</p>
            ) : holerites.length === 0 ? (
              <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Nenhum holerite disponível ainda.</p>
            ) : holerites.map(h => (
              <button key={h.id} onClick={() => abrirHolerite(h)} className="w-full text-left bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] p-3 flex items-center gap-3 hover:bg-blue-50 transition-colors">
                <div className="text-2xl">💰</div>
                <div className="flex-1 min-w-0">
                  <span className="font-black text-[#0C1D4D] text-[13px] uppercase">{fmtMesReferencia(h.mes_referencia)}</span>
                  <p className="text-[10px] text-gray-400">Assinado em {h.assinado_em ? new Date(h.assinado_em).toLocaleDateString('pt-BR') : '—'}</p>
                </div>
                <span className="text-gray-400">⬇</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
