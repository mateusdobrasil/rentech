"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { listarDocumentosEmpresaAction, urlDocumentoEmpresaAction } from '../../rh/actions/actions-documentos-empresa';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { supabase } from '../../../lib/supabase';
import { ehAdministradorGlobal } from '../../../lib/permissoes';

const fmtTamanho = (b: number | null) => {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};
const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

interface DocumentoEmpresa {
  id: number; categoria_id: number; categoria: string; empresa_id: number | null;
  titulo: string | null; nome_arquivo: string; tipo_mime: string | null;
  tamanho_bytes: number | null; data_validade: string | null; observacao: string | null;
  criado_em: string; statusValidade: 'SEM' | 'OK' | 'VENCENDO' | 'VENCIDO';
}

export default function ComercialDocumentosPage() {
  const router = useRouter();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken, permissaoBruta } = usePageAccess();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<DocumentoEmpresa[]>([]);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'TODOS' | 'PENDENCIAS'>('TODOS');
  const [filtroCategoria, setFiltroCategoria] = useState('TODAS');

  // Empresa(s) que o usuário pode enxergar (Rentech × AlfaLight) — a listagem
  // já é filtrada no servidor (listarDocumentosEmpresaAction usa
  // obterEmpresasPermitidas); isso aqui é só pra alimentar o seletor da tela.
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    async function carregarEmpresas() {
      const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(empresasData || []);

      if (ehAdministradorGlobal(permissaoBruta)) {
        setEmpresasPermitidas(null);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: vinculos } = await supabase
        .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
      setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
    }
    carregarEmpresas();
  }, [authLoading, acessoNegado, permissaoBruta]);

  const empresasCatalogoVisivel = empresasPermitidas === null
    ? empresasCatalogo
    : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id));

  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) setFiltroEmpresaId(empresasCatalogoVisivel[0].id);
  }, [empresasCatalogoVisivel]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentoEmpresa | null>(null);

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregar();
  }, [authLoading, acessoNegado, accessToken]);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await listarDocumentosEmpresaAction(undefined, accessToken);
      if (res.ok) setDocs(res.info.documentos);
    } catch (e: any) { toast('Erro ao carregar documentos: ' + e.message, 'error'); }
    finally { setLoading(false); }
  };

  const abrirPreview = async (doc: DocumentoEmpresa) => {
    try {
      const res = await urlDocumentoEmpresaAction({ id: doc.id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setPreviewUrl(res.info.url); setPreviewDoc(doc);
    } catch (e: any) { toast('Erro ao abrir: ' + e.message, 'error'); }
  };

  const baixar = async (doc: DocumentoEmpresa) => {
    try {
      const res = await urlDocumentoEmpresaAction({ id: doc.id, download: true }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { toast('Erro ao baixar: ' + e.message, 'error'); }
  };

  const categorias = useMemo(() => Array.from(new Set(docs.map(d => d.categoria))).sort((a, b) => a.localeCompare(b)), [docs]);

  const docsFiltrados = useMemo(() => docs
    .filter(d => `${d.categoria} ${d.titulo || ''} ${d.nome_arquivo}`.toLowerCase().includes(busca.toLowerCase()))
    .filter(d => filtroCategoria === 'TODAS' || d.categoria === filtroCategoria)
    .filter(d => filtroStatus === 'TODOS' || d.statusValidade === 'VENCENDO' || d.statusValidade === 'VENCIDO')
    .filter(d => !filtroEmpresaId || d.empresa_id == null || d.empresa_id === filtroEmpresaId),
    [docs, busca, filtroCategoria, filtroStatus, filtroEmpresaId]);

  const totais = useMemo(() => ({
    total: docs.length,
    vencendo: docs.filter(d => d.statusValidade === 'VENCENDO').length,
    vencidos: docs.filter(d => d.statusValidade === 'VENCIDO').length,
  }), [docs]);

  const isImagem = (mime: string | null) => mime?.startsWith('image/');
  const isPdf = (mime: string | null) => mime === 'application/pdf';

  const badgeValidade = (s: DocumentoEmpresa['statusValidade']) => {
    if (s === 'VENCIDO') return <span className="text-[9px] font-black bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase">⚠ Vencido</span>;
    if (s === 'VENCENDO') return <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">⏳ Vencendo</span>;
    if (s === 'OK') return <span className="text-[9px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">✓ Válido</span>;
    return null;
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Documentos da Empresa.</p>
          <button onClick={() => router.push('/admin/comercial')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Comercial
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          📁 <strong>Documentos da Empresa</strong>. Certidões, cartão CNPJ e demais documentos da Rentech — consulta e download.
        </p>
        <button onClick={() => router.push('/admin/comercial')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO COMERCIAL
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total de documentos</p>
            <p className="text-2xl font-black text-[#336699]">{totais.total}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vencendo (30d)</p>
            <p className={`text-2xl font-black ${totais.vencendo > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{totais.vencendo}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vencidos</p>
            <p className={`text-2xl font-black ${totais.vencidos > 0 ? 'text-red-600' : 'text-gray-300'}`}>{totais.vencidos}</p>
          </div>
        </div>

        {/* Controles */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Buscar documento..." value={busca} onChange={e => setBusca(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <select
              value={filtroEmpresaId ?? ''}
              onChange={e => setFiltroEmpresaId(e.target.value ? Number(e.target.value) : null)}
              disabled={empresasCatalogoVisivel.length <= 1}
              className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC] cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 Todas as empresas</option>}
              {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC] cursor-pointer">
              <option value="TODAS">Todas as categorias</option>
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['TODOS', 'PENDENCIAS'] as const).map(f => (
                <button key={f} onClick={() => setFiltroStatus(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtroStatus === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                  {f === 'TODOS' ? 'Todos' : 'Vencimentos'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Lista de documentos */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-3 md:p-4 space-y-2">
          {loading ? (
            <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Carregando...</p>
          ) : docsFiltrados.length === 0 ? (
            <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Nenhum documento encontrado.</p>
          ) : docsFiltrados.map(doc => (
            <div key={doc.id} className="bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] p-3 flex items-center gap-3">
              <div className="text-2xl">{isImagem(doc.tipo_mime) ? '🖼️' : isPdf(doc.tipo_mime) ? '📄' : '📎'}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-[#0C1D4D] text-[13px] uppercase">{doc.categoria}</span>
                  {badgeValidade(doc.statusValidade)}
                  {doc.empresa_id ? (
                    <span className="text-[9px] font-black bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full uppercase">
                      🏢 {empresasCatalogo.find(e => e.id === doc.empresa_id)?.nome || '?'}
                    </span>
                  ) : (
                    <span className="text-[9px] font-black bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full uppercase">⚠ Sem empresa</span>
                  )}
                </div>
                {doc.titulo && <p className="text-[11px] text-gray-600">{doc.titulo}</p>}
                <p className="text-[10px] text-gray-400">
                  {doc.nome_arquivo} · {fmtTamanho(doc.tamanho_bytes)}
                  {doc.data_validade && <> · vence {fmtData(doc.data_validade)}</>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => abrirPreview(doc)} title="Visualizar" className="text-gray-400 hover:text-[#0C1D4D] p-1.5">👁</button>
                <button onClick={() => baixar(doc)} title="Baixar" className="text-gray-400 hover:text-emerald-600 p-1.5">⬇</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview inline */}
      {previewUrl && previewDoc && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => { setPreviewUrl(null); setPreviewDoc(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <div>
                <h3 className="font-black text-[#0C1D4D] uppercase text-sm">{previewDoc.categoria}</h3>
                <p className="text-[11px] text-gray-500">{previewDoc.nome_arquivo}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => baixar(previewDoc)} className="text-[10px] font-black bg-emerald-600 text-white px-3 py-2 rounded-lg uppercase">⬇ Baixar</button>
                <button onClick={() => { setPreviewUrl(null); setPreviewDoc(null); }} className="text-[10px] font-black bg-gray-100 px-3 py-2 rounded-lg uppercase">Fechar</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center">
              {isImagem(previewDoc.tipo_mime) ? (
                <img src={previewUrl} alt={previewDoc.nome_arquivo} className="max-w-full max-h-full object-contain" />
              ) : isPdf(previewDoc.tipo_mime) ? (
                <iframe src={previewUrl} className="w-full h-[75vh]" title={previewDoc.nome_arquivo} />
              ) : (
                <div className="p-12 text-center">
                  <p className="text-gray-500 mb-3">Este tipo de arquivo não tem pré-visualização.</p>
                  <button onClick={() => baixar(previewDoc)} className="bg-[#0C1D4D] text-white font-black uppercase text-xs px-5 py-3 rounded-xl">⬇ Baixar arquivo</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
