"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../lib/supabase';
import {
  listarCategoriasDocAction, criarCategoriaDocAction, uploadDocumentoAction,
  listarDocumentosAction, urlDocumentoAction, excluirDocumentoAction, painelDocumentosAction,
  alternarVisivelPortalAction
} from '../actions/actions-documentos-func';
import {
  listarCategoriasDocEmpresaAction, criarCategoriaDocEmpresaAction, uploadDocumentoEmpresaAction,
  listarDocumentosEmpresaAction, urlDocumentoEmpresaAction, excluirDocumentoEmpresaAction
} from '../actions/actions-documentos-empresa';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';

const fmtTamanho = (b: number | null) => {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};
const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

interface Categoria { id: number; nome: string; exige_validade: boolean; }
interface Documento {
  id: number; funcionario_nome: string; categoria_id: number; categoria: string;
  titulo: string | null; nome_arquivo: string; tipo_mime: string | null;
  tamanho_bytes: number | null; data_validade: string | null; observacao: string | null;
  criado_em: string; statusValidade: 'SEM' | 'OK' | 'VENCENDO' | 'VENCIDO';
  visivel_portal: boolean;
}
interface LinhaPainel {
  nome: string; cargo: string; totalDocs: number; vencidos: number; vencendo: number; semDocumentos: boolean;
}

interface CategoriaEmpresa { id: number; nome: string; exige_validade: boolean; }
interface DocumentoEmpresa {
  id: number; categoria_id: number; categoria: string; empresa_id: number | null;
  titulo: string | null; nome_arquivo: string; tipo_mime: string | null;
  tamanho_bytes: number | null; data_validade: string | null; observacao: string | null;
  criado_em: string; statusValidade: 'SEM' | 'OK' | 'VENCENDO' | 'VENCIDO';
}
interface EmpresaCatalogo { id: number; nome: string; }

export default function DocumentosPage() {
  const router = useRouter();
  const [aba, setAba] = useState<'funcionarios' | 'empresa'>('funcionarios');
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<LinhaPainel[]>([]);
  const [totais, setTotais] = useState({ funcionarios: 0, semDocumentos: 0, totalDocs: 0, vencidos: 0, vencendo: 0 });
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'TODOS' | 'SEM' | 'PENDENCIAS'>('TODOS');

  // Funcionário selecionado (drawer de documentos)
  const [funcSel, setFuncSel] = useState<string | null>(null);
  const [docsFunc, setDocsFunc] = useState<Documento[]>([]);
  const [carregandoDocs, setCarregandoDocs] = useState(false);

  // Upload
  const [mostrarUpload, setMostrarUpload] = useState(false);
  const [upCategoria, setUpCategoria] = useState('');
  const [upTitulo, setUpTitulo] = useState('');
  const [upArquivo, setUpArquivo] = useState<File | null>(null);
  const [upValidade, setUpValidade] = useState('');
  const [upObs, setUpObs] = useState('');
  const [upVisivelPortal, setUpVisivelPortal] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const upRef = useRef<HTMLInputElement>(null);

  const { usuarioAtual, emailUsuario, permissaoNormalizada, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ nomeFallback: 'Equipe RH' });
  const toast = useToast();

  // Restrição por empresa (multi-empresa, Fase 2): null = sem restrição
  // (setor ADMINISTRADOR); array = só enxerga essas empresas — mesmo
  // padrão de /admin/rh/funcionario.
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<EmpresaCatalogo[]>([]);

  // carregar()/carregarEmpresa() só disparam depois que empresasPermitidas
  // está resolvido — chamar antes buscaria dados sem restrição de empresa.
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    async function inicializar() {
      let permitidas: number[] | null = null;
      if (permissaoNormalizada !== 'ADMINISTRADOR') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data: vinculos } = await supabase
          .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
        permitidas = (vinculos || []).map(v => v.empresa_id);
      }
      setEmpresasPermitidas(permitidas);

      const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(empresasData || []);

      carregar(permitidas, accessToken);
      carregarEmpresa(permitidas, accessToken);
    }
    inicializar();
  }, [authLoading, acessoNegado, permissaoNormalizada, accessToken]);

  // Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Documento | null>(null);

  // Nova categoria
  const [mostrarCats, setMostrarCats] = useState(false);
  const [novaCat, setNovaCat] = useState('');
  const [novaCatValidade, setNovaCatValidade] = useState(false);

  // ============================================================================
  // ABA "EMPRESA" — documentos da Rentech (certidões, cartão CNPJ, etc.)
  // ============================================================================
  const [categoriasEmpresa, setCategoriasEmpresa] = useState<CategoriaEmpresa[]>([]);
  const [docsEmpresa, setDocsEmpresa] = useState<DocumentoEmpresa[]>([]);
  const [carregandoEmpresa, setCarregandoEmpresa] = useState(true);
  const [buscaEmpresa, setBuscaEmpresa] = useState('');
  const [filtroEmpresa, setFiltroEmpresa] = useState<'TODOS' | 'PENDENCIAS'>('TODOS');
  const [filtroEmpresaId, setFiltroEmpresaId] = useState('TODAS');

  const [mostrarUploadEmpresa, setMostrarUploadEmpresa] = useState(false);
  const [upEmpresaEmpresa, setUpEmpresaEmpresa] = useState('');
  const [upCategoriaEmpresa, setUpCategoriaEmpresa] = useState('');
  const [upTituloEmpresa, setUpTituloEmpresa] = useState('');
  const [upArquivoEmpresa, setUpArquivoEmpresa] = useState<File | null>(null);
  const [upValidadeEmpresa, setUpValidadeEmpresa] = useState('');
  const [upObsEmpresa, setUpObsEmpresa] = useState('');
  const [enviandoEmpresa, setEnviandoEmpresa] = useState(false);
  const upRefEmpresa = useRef<HTMLInputElement>(null);

  const [mostrarCatsEmpresa, setMostrarCatsEmpresa] = useState(false);
  const [novaCatEmpresa, setNovaCatEmpresa] = useState('');
  const [novaCatValidadeEmpresa, setNovaCatValidadeEmpresa] = useState(false);

  const [previewUrlEmpresa, setPreviewUrlEmpresa] = useState<string | null>(null);
  const [previewDocEmpresa, setPreviewDocEmpresa] = useState<DocumentoEmpresa | null>(null);

  const carregarEmpresa = async (empresaIds: number[] | null = empresasPermitidas, token: string = accessToken) => {
    setCarregandoEmpresa(true);
    try {
      const [docs, cats] = await Promise.all([listarDocumentosEmpresaAction({ empresaIds }, token), listarCategoriasDocEmpresaAction(token)]);
      if (docs.ok) setDocsEmpresa(docs.info.documentos);
      if (cats.ok) setCategoriasEmpresa(cats.info.categorias);
    } catch (e: any) { toast('Erro ao carregar documentos da empresa: ' + e.message, 'error'); }
    finally { setCarregandoEmpresa(false); }
  };

  const catSelecionadaEmpresa = categoriasEmpresa.find(c => String(c.id) === upCategoriaEmpresa);

  const enviarUploadEmpresa = async () => {
    if (!upEmpresaEmpresa) { toast('Escolha a empresa (CNPJ).', 'error'); return; }
    if (!upCategoriaEmpresa) { toast('Escolha a categoria.', 'error'); return; }
    if (!upArquivoEmpresa) { toast('Selecione o arquivo.', 'error'); return; }
    if (catSelecionadaEmpresa?.exige_validade && !upValidadeEmpresa) {
      if (!confirm('Esta categoria costuma ter validade e você não preencheu a data. Enviar mesmo assim?')) return;
    }
    setEnviandoEmpresa(true);
    try {
      const base64 = await fileParaBase64(upArquivoEmpresa);
      const res = await uploadDocumentoEmpresaAction({
        categoriaId: Number(upCategoriaEmpresa), empresaId: Number(upEmpresaEmpresa), titulo: upTituloEmpresa || null,
        arquivoBase64: base64, nomeArquivo: upArquivoEmpresa.name, tipoMime: upArquivoEmpresa.type,
        dataValidade: upValidadeEmpresa || null, observacao: upObsEmpresa || null, enviadoPor: usuarioAtual
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setUpEmpresaEmpresa(''); setUpCategoriaEmpresa(''); setUpTituloEmpresa(''); setUpArquivoEmpresa(null); setUpValidadeEmpresa(''); setUpObsEmpresa('');
      if (upRefEmpresa.current) upRefEmpresa.current.value = '';
      setMostrarUploadEmpresa(false);
      carregarEmpresa();
    } catch (e: any) { toast('Erro ao enviar: ' + e.message, 'error'); }
    finally { setEnviandoEmpresa(false); }
  };

  const abrirPreviewEmpresa = async (doc: DocumentoEmpresa) => {
    try {
      const res = await urlDocumentoEmpresaAction({ id: doc.id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setPreviewUrlEmpresa(res.info.url); setPreviewDocEmpresa(doc);
    } catch (e: any) { toast('Erro ao abrir: ' + e.message, 'error'); }
  };

  const baixarEmpresa = async (doc: DocumentoEmpresa) => {
    try {
      const res = await urlDocumentoEmpresaAction({ id: doc.id, download: true }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { toast('Erro ao baixar: ' + e.message, 'error'); }
  };

  const excluirEmpresa = async (doc: DocumentoEmpresa) => {
    if (!confirm(`Excluir "${doc.categoria}${doc.titulo ? ' — ' + doc.titulo : ''}"?\n\nEsta ação é permanente.`)) return;
    try {
      const res = await excluirDocumentoEmpresaAction({ id: doc.id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      carregarEmpresa();
    } catch (e: any) { toast('Erro ao excluir: ' + e.message, 'error'); }
  };

  const adicionarCategoriaEmpresa = async () => {
    if (!novaCatEmpresa.trim()) return;
    const res = await criarCategoriaDocEmpresaAction({ nome: novaCatEmpresa, exigeValidade: novaCatValidadeEmpresa }, accessToken);
    if (!res.ok) { toast(res.erro || 'Não foi possível criar a categoria.', 'error'); return; }
    setNovaCatEmpresa(''); setNovaCatValidadeEmpresa(false);
    const cats = await listarCategoriasDocEmpresaAction(accessToken);
    if (cats.ok) setCategoriasEmpresa(cats.info.categorias);
  };

  const docsEmpresaFiltrados = useMemo(() => docsEmpresa
    .filter(d => `${d.categoria} ${d.titulo || ''} ${d.nome_arquivo}`.toLowerCase().includes(buscaEmpresa.toLowerCase()))
    .filter(d => filtroEmpresa === 'TODOS' || d.statusValidade === 'VENCENDO' || d.statusValidade === 'VENCIDO')
    .filter(d => filtroEmpresaId === 'TODAS' || String(d.empresa_id) === filtroEmpresaId),
    [docsEmpresa, buscaEmpresa, filtroEmpresa, filtroEmpresaId]);

  const totaisEmpresa = useMemo(() => ({
    total: docsEmpresa.length,
    vencendo: docsEmpresa.filter(d => d.statusValidade === 'VENCENDO').length,
    vencidos: docsEmpresa.filter(d => d.statusValidade === 'VENCIDO').length,
  }), [docsEmpresa]);

  const carregar = async (empresaIds: number[] | null = empresasPermitidas, token: string = accessToken) => {
    setLoading(true);
    try {
      const [painel, cats] = await Promise.all([painelDocumentosAction(empresaIds, token), listarCategoriasDocAction(token)]);
      if (painel.ok) { setLinhas(painel.info.linhas); setTotais(painel.info.totais); }
      if (cats.ok) setCategorias(cats.info.categorias);
    } catch (e: any) { toast('Erro ao carregar: ' + e.message, 'error'); }
    finally { setLoading(false); }
  };

  const abrirFuncionario = async (nome: string) => {
    setFuncSel(nome); setDocsFunc([]); setCarregandoDocs(true); setMostrarUpload(false);
    try {
      const res = await listarDocumentosAction({ funcionarioNome: nome }, accessToken);
      if (res.ok) setDocsFunc(res.info.documentos);
    } finally { setCarregandoDocs(false); }
  };

  // Abre o drawer já com o formulário de upload aberto
  const abrirParaEnviar = async (nome: string) => {
    await abrirFuncionario(nome);
    setMostrarUpload(true);
  };

  const catSelecionada = categorias.find(c => String(c.id) === upCategoria);

  const fileParaBase64 = (file: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej; r.readAsDataURL(file);
  });

  const enviarUpload = async () => {
    if (!upCategoria) { toast('Escolha a categoria.', 'error'); return; }
    if (!upArquivo) { toast('Selecione o arquivo.', 'error'); return; }
    if (catSelecionada?.exige_validade && !upValidade) {
      if (!confirm('Esta categoria costuma ter validade e você não preencheu a data. Enviar mesmo assim?')) return;
    }
    setEnviando(true);
    try {
      const base64 = await fileParaBase64(upArquivo);
      const res = await uploadDocumentoAction({
        funcionarioNome: funcSel!, categoriaId: Number(upCategoria), titulo: upTitulo || null,
        arquivoBase64: base64, nomeArquivo: upArquivo.name, tipoMime: upArquivo.type,
        dataValidade: upValidade || null, observacao: upObs || null, enviadoPor: usuarioAtual,
        visivelPortal: upVisivelPortal
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setUpCategoria(''); setUpTitulo(''); setUpArquivo(null); setUpValidade(''); setUpObs(''); setUpVisivelPortal(false);
      if (upRef.current) upRef.current.value = '';
      setMostrarUpload(false);
      abrirFuncionario(funcSel!); carregar();
    } catch (e: any) { toast('Erro ao enviar: ' + e.message, 'error'); }
    finally { setEnviando(false); }
  };

  const abrirPreview = async (doc: Documento) => {
    try {
      const res = await urlDocumentoAction({ id: doc.id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setPreviewUrl(res.info.url); setPreviewDoc(doc);
    } catch (e: any) { toast('Erro ao abrir: ' + e.message, 'error'); }
  };

  const baixar = async (doc: Documento) => {
    try {
      const res = await urlDocumentoAction({ id: doc.id, download: true }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { toast('Erro ao baixar: ' + e.message, 'error'); }
  };

  const alternarVisivelPortal = async (doc: Documento) => {
    const novoValor = !doc.visivel_portal;
    setDocsFunc(prev => prev.map(d => d.id === doc.id ? { ...d, visivel_portal: novoValor } : d));
    const res = await alternarVisivelPortalAction({ id: doc.id, visivel: novoValor }, accessToken);
    if (!res.ok) {
      setDocsFunc(prev => prev.map(d => d.id === doc.id ? { ...d, visivel_portal: !novoValor } : d));
      toast('Erro ao atualizar: ' + res.erro, 'error');
    }
  };

  const excluir = async (doc: Documento) => {
    if (!confirm(`Excluir "${doc.categoria}${doc.titulo ? ' — ' + doc.titulo : ''}" de ${doc.funcionario_nome}?\n\nEsta ação é permanente.`)) return;
    try {
      const res = await excluirDocumentoAction({ id: doc.id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      abrirFuncionario(funcSel!); carregar();
    } catch (e: any) { toast('Erro ao excluir: ' + e.message, 'error'); }
  };

  const adicionarCategoria = async () => {
    if (!novaCat.trim()) return;
    const res = await criarCategoriaDocAction({ nome: novaCat, exigeValidade: novaCatValidade }, accessToken);
    if (!res.ok) { toast(res.erro || 'Não foi possível criar a categoria.', 'error'); return; }
    setNovaCat(''); setNovaCatValidade(false);
    const cats = await listarCategoriasDocAction(accessToken);
    if (cats.ok) setCategorias(cats.info.categorias);
  };

  const filtradas = useMemo(() => linhas
    .filter(l => l.nome.toLowerCase().includes(busca.toLowerCase()))
    .filter(l => filtro === 'TODOS' || (filtro === 'SEM' ? l.semDocumentos : (l.vencidos > 0 || l.vencendo > 0))),
    [linhas, busca, filtro]);

  const isImagem = (mime: string | null) => mime?.startsWith('image/');
  const isPdf = (mime: string | null) => mime === 'application/pdf';

  const badgeValidade = (s: Documento['statusValidade']) => {
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar esta página.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
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
          📁 <strong>Gestão de Documentos</strong>. Arquivos da empresa e de cada colaborador.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      {/* ABAS */}
      <div className="px-4 md:px-8 pt-4 flex-shrink-0 flex gap-2 border-b border-[#E2E8F0] bg-white">
        <button
          onClick={() => setAba('funcionarios')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'funcionarios' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          👤 Funcionários
        </button>
        <button
          onClick={() => setAba('empresa')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'empresa' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}
        >
          🏢 Empresa {(totaisEmpresa.vencidos + totaisEmpresa.vencendo) > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[9px]">{totaisEmpresa.vencidos + totaisEmpresa.vencendo}</span>}
        </button>
      </div>

      {/* ============================================================================ */}
      {/* ABA: FUNCIONÁRIOS */}
      {/* ============================================================================ */}
      {aba === 'funcionarios' && (
      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Funcionários</p>
            <p className="text-2xl font-black text-[#0C1D4D]">{totais.funcionarios}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total de documentos</p>
            <p className="text-2xl font-black text-[#336699]">{totais.totalDocs}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Sem documentos</p>
            <p className={`text-2xl font-black ${totais.semDocumentos > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{totais.semDocumentos}</p>
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
            <input type="text" placeholder="Buscar funcionário..." value={busca} onChange={e => setBusca(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['TODOS', 'SEM', 'PENDENCIAS'] as const).map(f => (
                <button key={f} onClick={() => setFiltro(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtro === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                  {f === 'TODOS' ? 'Todos' : f === 'SEM' ? 'Sem docs' : 'Vencimentos'}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setMostrarCats(!mostrarCats)} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2.5 rounded-lg uppercase tracking-wider">⚙ Categorias</button>
        </div>

        {/* Painel de categorias */}
        {mostrarCats && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border-2 border-blue-200 mb-6">
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Categorias de documento</h3>
            <div className="flex flex-wrap gap-2 items-end mb-4">
              <input type="text" value={novaCat} onChange={e => setNovaCat(e.target.value)} placeholder="Nova categoria..." className="p-2 border border-gray-300 rounded text-sm uppercase" />
              <label className="flex items-center gap-2 text-[11px] font-black uppercase text-gray-600 cursor-pointer">
                <input type="checkbox" checked={novaCatValidade} onChange={e => setNovaCatValidade(e.target.checked)} /> Tem validade
              </label>
              <button onClick={adicionarCategoria} className="bg-[#336699] text-white font-black text-xs px-4 py-2 rounded-lg uppercase">Add</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categorias.map(c => (
                <span key={c.id} className="text-[10px] font-black bg-blue-50 text-blue-700 px-2 py-1 rounded uppercase">
                  {c.nome}{c.exige_validade && <span className="text-amber-500 ml-1">⏳</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Lista de funcionários */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando...</div>
          ) : filtradas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum funcionário neste filtro.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                    <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Funcionário</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Docs</th>
                    <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Situação</th>
                    <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px] tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((l, idx) => (
                    <tr key={l.nome} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0] hover:bg-blue-50/40 cursor-pointer`} onClick={() => abrirFuncionario(l.nome)}>
                      <td className="p-3">
                        <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                        <span className="text-[10px] text-gray-400 font-bold uppercase">{l.cargo || '—'}</span>
                      </td>
                      <td className="p-3 text-center font-black text-[#336699]">{l.totalDocs}</td>
                      <td className="p-3 text-center">
                        {l.semDocumentos ? <span className="text-[10px] font-black text-amber-500 uppercase">⚠ Sem documentos</span>
                          : l.vencidos > 0 ? <span className="text-[10px] font-black text-red-600 uppercase">{l.vencidos} vencido(s)</span>
                          : l.vencendo > 0 ? <span className="text-[10px] font-black text-amber-600 uppercase">{l.vencendo} vencendo</span>
                          : <span className="text-[10px] font-black text-emerald-600 uppercase">✓ Em dia</span>}
                      </td>
                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => abrirFuncionario(l.nome)} className="text-[10px] font-black text-[#0C1D4D] bg-white border border-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">👁 Ver</button>
                          <button onClick={() => abrirParaEnviar(l.nome)} className="text-[10px] font-black text-white bg-[#16A34A] hover:bg-[#15803D] px-3 py-1.5 rounded-lg uppercase">＋ Enviar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ============================================================================ */}
      {/* ABA: EMPRESA (certidões, cartão CNPJ, contrato social, etc.) */}
      {/* ============================================================================ */}
      {aba === 'empresa' && (
      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total de documentos</p>
            <p className="text-2xl font-black text-[#336699]">{totaisEmpresa.total}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vencendo (30d)</p>
            <p className={`text-2xl font-black ${totaisEmpresa.vencendo > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{totaisEmpresa.vencendo}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vencidos</p>
            <p className={`text-2xl font-black ${totaisEmpresa.vencidos > 0 ? 'text-red-600' : 'text-gray-300'}`}>{totaisEmpresa.vencidos}</p>
          </div>
        </div>

        {/* Controles */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Buscar documento..." value={buscaEmpresa} onChange={e => setBuscaEmpresa(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <select value={filtroEmpresaId} onChange={e => setFiltroEmpresaId(e.target.value)} className="p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]">
              <option value="TODAS">Todas as empresas</option>
              {empresasCatalogo.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
            <div className="flex bg-gray-100 p-1 rounded-xl">
              {(['TODOS', 'PENDENCIAS'] as const).map(f => (
                <button key={f} onClick={() => setFiltroEmpresa(f)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtroEmpresa === f ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>
                  {f === 'TODOS' ? 'Todos' : 'Vencimentos'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setMostrarCatsEmpresa(!mostrarCatsEmpresa)} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2.5 rounded-lg uppercase tracking-wider">⚙ Categorias</button>
            <button onClick={() => setMostrarUploadEmpresa(!mostrarUploadEmpresa)} className={`text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-lg transition-colors ${mostrarUploadEmpresa ? 'bg-gray-200 text-gray-700' : 'bg-[#16A34A] text-white hover:bg-[#15803D]'}`}>
              {mostrarUploadEmpresa ? '✕ Fechar envio' : '＋ Enviar documento'}
            </button>
          </div>
        </div>

        {/* Painel de categorias */}
        {mostrarCatsEmpresa && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border-2 border-blue-200 mb-6">
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Categorias de documento da empresa</h3>
            <div className="flex flex-wrap gap-2 items-end mb-4">
              <input type="text" value={novaCatEmpresa} onChange={e => setNovaCatEmpresa(e.target.value)} placeholder="Nova categoria..." className="p-2 border border-gray-300 rounded text-sm uppercase" />
              <label className="flex items-center gap-2 text-[11px] font-black uppercase text-gray-600 cursor-pointer">
                <input type="checkbox" checked={novaCatValidadeEmpresa} onChange={e => setNovaCatValidadeEmpresa(e.target.checked)} /> Tem validade
              </label>
              <button onClick={adicionarCategoriaEmpresa} className="bg-[#336699] text-white font-black text-xs px-4 py-2 rounded-lg uppercase">Add</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categoriasEmpresa.map(c => (
                <span key={c.id} className="text-[10px] font-black bg-blue-50 text-blue-700 px-2 py-1 rounded uppercase">
                  {c.nome}{c.exige_validade && <span className="text-amber-500 ml-1">⏳</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Formulário de upload */}
        {mostrarUploadEmpresa && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] mb-6 space-y-3">
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Enviar documento da empresa</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Empresa (CNPJ)</label>
                <select value={upEmpresaEmpresa} onChange={e => setUpEmpresaEmpresa(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {empresasCatalogo.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Categoria</label>
                <select value={upCategoriaEmpresa} onChange={e => setUpCategoriaEmpresa(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {categoriasEmpresa.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">
                  Validade {catSelecionadaEmpresa?.exige_validade && <span className="text-amber-500">(recomendada)</span>}
                </label>
                <input type="date" value={upValidadeEmpresa} onChange={e => setUpValidadeEmpresa(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Título / descrição (opcional)</label>
              <input type="text" value={upTituloEmpresa} onChange={e => setUpTituloEmpresa(e.target.value)} placeholder="Ex: Cartão CNPJ atualizado 2026" className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Arquivo (PDF ou imagem)</label>
              <input ref={upRefEmpresa} type="file" accept="application/pdf,image/*" onChange={e => setUpArquivoEmpresa(e.target.files?.[0] || null)} className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#0C1D4D] file:text-white file:font-bold file:text-xs file:uppercase" />
            </div>
            <button onClick={enviarUploadEmpresa} disabled={enviandoEmpresa} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl disabled:opacity-50">
              {enviandoEmpresa ? '⏳ Enviando...' : '📤 Enviar Documento'}
            </button>
          </div>
        )}

        {/* Lista de documentos da empresa */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-3 md:p-4 space-y-2">
          {carregandoEmpresa ? (
            <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Carregando...</p>
          ) : docsEmpresaFiltrados.length === 0 ? (
            <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Nenhum documento da empresa encontrado.</p>
          ) : docsEmpresaFiltrados.map(doc => (
            <div key={doc.id} className="bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] p-3 flex items-center gap-3">
              <div className="text-2xl">{isImagem(doc.tipo_mime) ? '🖼️' : isPdf(doc.tipo_mime) ? '📄' : '📎'}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-[#0C1D4D] text-[13px] uppercase">{doc.categoria}</span>
                  {badgeValidade(doc.statusValidade)}
                  {doc.empresa_id ? (
                    <span className="text-[9px] font-black bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full uppercase">
                      🏢 {empresasCatalogo.find(e => e.id === doc.empresa_id)?.nome || '?'}
                    </span>
                  ) : (
                    <span className="text-[9px] font-black bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full uppercase">
                      ⚠ Sem empresa
                    </span>
                  )}
                </div>
                {doc.titulo && <p className="text-[11px] text-gray-600">{doc.titulo}</p>}
                <p className="text-[10px] text-gray-400">
                  {doc.nome_arquivo} · {fmtTamanho(doc.tamanho_bytes)}
                  {doc.data_validade && <> · vence {fmtData(doc.data_validade)}</>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => abrirPreviewEmpresa(doc)} title="Visualizar" className="text-gray-400 hover:text-[#0C1D4D] p-1.5">👁</button>
                <button onClick={() => baixarEmpresa(doc)} title="Baixar" className="text-gray-400 hover:text-emerald-600 p-1.5">⬇</button>
                <button onClick={() => excluirEmpresa(doc)} title="Excluir" className="text-gray-400 hover:text-red-600 p-1.5">🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Drawer de documentos do funcionário */}
      {funcSel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-end z-40" onClick={() => setFuncSel(null)}>
          <div className="bg-[#F0F4F8] h-full w-full max-w-2xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="bg-[#0C1D4D] text-white p-5 flex justify-between items-center">
              <div>
                <h2 className="font-black uppercase tracking-wider">{funcSel}</h2>
                <p className="text-[11px] text-blue-200">{docsFunc.length} documento(s)</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMostrarUpload(!mostrarUpload)} className={`font-black uppercase tracking-wider text-[10px] px-4 py-2 rounded-lg transition-colors ${mostrarUpload ? 'bg-white/20 text-white' : 'bg-[#16A34A] text-white hover:bg-[#15803D]'}`}>
                  {mostrarUpload ? '✕ Fechar envio' : '＋ Enviar documento'}
                </button>
                <button onClick={() => setFuncSel(null)} className="text-white/70 hover:text-white text-xl px-2">✕</button>
              </div>
            </div>

            {/* Formulário de upload */}
            {mostrarUpload && (
              <div className="bg-white border-b border-gray-200 p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Categoria</label>
                    <select value={upCategoria} onChange={e => setUpCategoria(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                      <option value="">— Selecione —</option>
                      {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">
                      Validade {catSelecionada?.exige_validade && <span className="text-amber-500">(recomendada)</span>}
                    </label>
                    <input type="date" value={upValidade} onChange={e => setUpValidade(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Título / descrição (opcional)</label>
                  <input type="text" value={upTitulo} onChange={e => setUpTitulo(e.target.value)} placeholder="Ex: RG frente e verso" className="w-full p-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Arquivo (PDF ou imagem)</label>
                  <input ref={upRef} type="file" accept="application/pdf,image/*" onChange={e => setUpArquivo(e.target.files?.[0] || null)} className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#0C1D4D] file:text-white file:font-bold file:text-xs file:uppercase" />
                </div>
                <label className="flex items-center gap-2 text-[11px] font-black uppercase text-gray-600 cursor-pointer bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 w-fit">
                  <input type="checkbox" checked={upVisivelPortal} onChange={e => setUpVisivelPortal(e.target.checked)} />
                  👤 Visível no Portal do Funcionário
                </label>
                <button onClick={enviarUpload} disabled={enviando} className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl disabled:opacity-50">
                  {enviando ? '⏳ Enviando...' : '📤 Enviar Documento'}
                </button>
              </div>
            )}

            {/* Lista de documentos */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {carregandoDocs ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Carregando...</p>
              ) : docsFunc.length === 0 ? (
                <p className="text-center py-12 text-gray-400 font-bold uppercase">Nenhum documento. Clique em "Enviar" para adicionar.</p>
              ) : docsFunc.map(doc => (
                <div key={doc.id} className="bg-white rounded-xl border border-[#E2E8F0] p-3 flex items-center gap-3">
                  <div className="text-2xl">{isImagem(doc.tipo_mime) ? '🖼️' : isPdf(doc.tipo_mime) ? '📄' : '📎'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-[#0C1D4D] text-[13px] uppercase">{doc.categoria}</span>
                      {badgeValidade(doc.statusValidade)}
                    </div>
                    {doc.titulo && <p className="text-[11px] text-gray-600">{doc.titulo}</p>}
                    <p className="text-[10px] text-gray-400">
                      {doc.nome_arquivo} · {fmtTamanho(doc.tamanho_bytes)}
                      {doc.data_validade && <> · vence {fmtData(doc.data_validade)}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <label
                      title="Visível no Portal do Funcionário"
                      className={`flex items-center gap-1 text-[9px] font-black uppercase px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${doc.visivel_portal ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}
                    >
                      <input type="checkbox" className="hidden" checked={doc.visivel_portal} onChange={() => alternarVisivelPortal(doc)} />
                      👤 Portal
                    </label>
                    <button onClick={() => abrirPreview(doc)} title="Visualizar" className="text-gray-400 hover:text-[#0C1D4D] p-1.5">👁</button>
                    <button onClick={() => baixar(doc)} title="Baixar" className="text-gray-400 hover:text-emerald-600 p-1.5">⬇</button>
                    <button onClick={() => excluir(doc)} title="Excluir" className="text-gray-400 hover:text-red-600 p-1.5">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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

      {/* Preview inline — documentos da empresa */}
      {previewUrlEmpresa && previewDocEmpresa && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => { setPreviewUrlEmpresa(null); setPreviewDocEmpresa(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-4 border-b border-gray-200">
              <div>
                <h3 className="font-black text-[#0C1D4D] uppercase text-sm">{previewDocEmpresa.categoria}</h3>
                <p className="text-[11px] text-gray-500">{previewDocEmpresa.nome_arquivo}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => baixarEmpresa(previewDocEmpresa)} className="text-[10px] font-black bg-emerald-600 text-white px-3 py-2 rounded-lg uppercase">⬇ Baixar</button>
                <button onClick={() => { setPreviewUrlEmpresa(null); setPreviewDocEmpresa(null); }} className="text-[10px] font-black bg-gray-100 px-3 py-2 rounded-lg uppercase">Fechar</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center">
              {isImagem(previewDocEmpresa.tipo_mime) ? (
                <img src={previewUrlEmpresa} alt={previewDocEmpresa.nome_arquivo} className="max-w-full max-h-full object-contain" />
              ) : isPdf(previewDocEmpresa.tipo_mime) ? (
                <iframe src={previewUrlEmpresa} className="w-full h-[75vh]" title={previewDocEmpresa.nome_arquivo} />
              ) : (
                <div className="p-12 text-center">
                  <p className="text-gray-500 mb-3">Este tipo de arquivo não tem pré-visualização.</p>
                  <button onClick={() => baixarEmpresa(previewDocEmpresa)} className="bg-[#0C1D4D] text-white font-black uppercase text-xs px-5 py-3 rounded-xl">⬇ Baixar arquivo</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}