"use client";

import { Suspense, useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../lib/supabase';
import { urlMeuDocumentoAction, urlMeuHoleriteAction } from './actions/actions-documentos';
import { carregarPortalHomeAction } from './actions/actions-home';
import MeuCracha, { type DadosCracha } from './MeuCracha';
import ChecklistVeiculo from './ChecklistVeiculo';
import EspelhoPonto from './EspelhoPonto';

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

const ABAS_VALIDAS = ['documentos', 'holerites', 'ponto', 'checklist'] as const;
type AbaPortal = (typeof ABAS_VALIDAS)[number];

function PortalDashboardConteudo() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [accessToken, setAccessToken] = useState('');

  // Suporta abrir direto numa aba (?aba=holerites) — usado pelo app mobile
  // pra linkar "Holerite" e "Documentos" pro lugar certo dentro do Portal,
  // que é uma SPA de aba só (sem rota própria por seção).
  const [aba, setAba] = useState<AbaPortal>(() => {
    const abaParam = searchParams.get('aba');
    return (ABAS_VALIDAS as readonly string[]).includes(abaParam || '') ? (abaParam as AbaPortal) : 'documentos';
  });
  const [menuAbasAberto, setMenuAbasAberto] = useState(false);
  const [documentos, setDocumentos] = useState<DocumentoPortal[]>([]);
  const [holerites, setHolerites] = useState<HoleritePortal[]>([]);
  const [cracha, setCracha] = useState<DadosCracha | null>(null);
  const [podeDirigir, setPodeDirigir] = useState(false);
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
    const res = await carregarPortalHomeAction(token);
    if (res.ok) {
      setDocumentos(res.info.documentos);
      setHolerites(res.info.holerites);
      setCracha(res.info.cracha);
      setPodeDirigir(res.info.podeDirigir);
      const erros = [res.info.erroDocumentos, res.info.erroCracha, res.info.erroPodeDirigir].filter(Boolean);
      if (erros.length > 0) setErro(erros.join(' '));
    } else {
      setErro(res.erro || 'Erro ao carregar seus dados.');
    }
    setLoading(false);
  };

  // Compara só mês/dia (ignora o ano) com a data local do navegador — o
  // aniversariante recebe a saudação o dia todo, sem depender de fuso do servidor.
  const ehAniversarioHoje = useMemo(() => {
    const dataNascimento = cracha?.dataNascimento;
    if (!dataNascimento) return false;
    const [, mesStr, diaStr] = dataNascimento.split('-');
    const hoje = new Date();
    return Number(mesStr) === hoje.getMonth() + 1 && Number(diaStr) === hoje.getDate();
  }, [cracha?.dataNascimento]);

  const abas = useMemo(() => {
    const lista: { id: typeof aba; label: string; icone: string }[] = [
      { id: 'documentos', label: 'Meus Documentos', icone: '📁' },
      { id: 'holerites', label: 'Holerites', icone: '💰' },
      { id: 'ponto', label: 'Espelho de Ponto', icone: '🕒' },
    ];
    if (podeDirigir) lista.push({ id: 'checklist', label: 'Checklist Veículos', icone: '✅' });
    return lista;
  }, [podeDirigir]);
  const abaSelecionada = abas.find(a => a.id === aba) || abas[0];

  const sair = async () => {
    await supabase.auth.signOut();
    router.push('/portal/login');
  };

  const abrirDocumento = async (doc: DocumentoPortal) => {
    const res = await urlMeuDocumentoAction(accessToken, { id: doc.id, download: true });
    if (!res.ok) { setErro(res.erro || 'Erro ao abrir documento.'); return; }
    window.open(res.info.url, '_blank', 'noopener,noreferrer');
  };

  const abrirHolerite = async (h: HoleritePortal) => {
    const res = await urlMeuHoleriteAction(accessToken, { id: h.id });
    if (!res.ok) { setErro(res.erro || 'Erro ao abrir holerite.'); return; }
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

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-3 md:py-4 flex flex-wrap justify-between items-center gap-2 shadow-sm">
        <p className="text-[#1E40AF] font-medium text-xs md:text-sm">
          👤 <strong>Portal do Funcionário</strong><span className="hidden sm:inline">. Seus documentos pessoais e holerites.</span>
        </p>
        <button onClick={sair} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase shrink-0">
          Sair
        </button>
      </div>

      {ehAniversarioHoje && (
        <div className="bg-gradient-to-r from-pink-500 via-fuchsia-500 to-amber-400 px-4 md:px-8 py-3 text-center shadow-sm">
          <p className="text-white font-black text-sm md:text-base tracking-wide">
            🎉🎈 Feliz Aniversário, {cracha?.nome?.split(' ')[0]}! Que Deus te abençoe muito! Muitas felicidades! 🎂🥳🎊
          </p>
        </div>
      )}

      <div className="p-4 md:px-8 pt-6 max-w-[1200px] mx-auto w-full flex-grow flex flex-col lg:flex-row gap-6">
        {cracha && (
          <div className="flex-shrink-0 flex justify-center lg:justify-start lg:sticky lg:top-6 lg:self-start">
            <MeuCracha dados={cracha} />
          </div>
        )}

        <div className="flex flex-col gap-4 flex-grow min-w-0">
          {/* Celular: botão "sanduíche" que abre um menu suspenso com as
              abas — a faixa horizontal (mesmo com rolagem) exigia largura
              maior do que a tela e cortava a última aba fora da janela.
              Desktop: mantém a faixa horizontal de sempre. */}
          <div className="md:hidden relative">
            <button
              onClick={() => setMenuAbasAberto(v => !v)}
              className="w-full flex items-center justify-between gap-2 bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 shadow-sm"
            >
              <span className="text-xs font-black uppercase tracking-wider text-[#0C1D4D]">
                {abaSelecionada.icone} {abaSelecionada.label}
              </span>
              <span className="text-[#336699] text-lg leading-none">{menuAbasAberto ? '✕' : '☰'}</span>
            </button>
            {menuAbasAberto && (
              <div className="absolute z-20 mt-1.5 w-full bg-white border border-[#E2E8F0] rounded-xl shadow-lg overflow-hidden">
                {abas.map(a => (
                  <button
                    key={a.id}
                    onClick={() => { setAba(a.id); setMenuAbasAberto(false); }}
                    className={`w-full text-left px-4 py-3 text-xs font-black uppercase tracking-wider transition-colors ${aba === a.id ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
                  >
                    {a.icone} {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden md:flex gap-2 border-b border-[#E2E8F0] bg-white rounded-t-xl">
            {abas.map(a => (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === a.id ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
              >
                {a.icone} {a.label}
              </button>
            ))}
          </div>

          {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-4 py-3 rounded-lg">{erro}</div>}

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
                    {doc.titulo && <p className="text-[11px] text-gray-600 break-words">{doc.titulo}</p>}
                    <p className="text-[10px] text-gray-400 break-words">{doc.nome_arquivo}{doc.data_validade && <> · vence {fmtData(doc.data_validade)}</>}</p>
                  </div>
                  <span className="text-gray-400 shrink-0">⬇</span>
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

          {aba === 'ponto' && accessToken && (
            <EspelhoPonto accessToken={accessToken} />
          )}

          {aba === 'checklist' && podeDirigir && accessToken && (
            <ChecklistVeiculo accessToken={accessToken} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function PortalDashboardPage() {
  return (
    <Suspense fallback={null}>
      <PortalDashboardConteudo />
    </Suspense>
  );
}
