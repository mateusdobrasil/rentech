"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { registrarLogAuditoria } from '../../actions';
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';
import { useToast } from '../../components/ui/NotificationProvider';
import { CATEGORIAS, NIVEIS, PUBLICOS, type Artigo, type CategoriaId, type Secao } from '../../academy/categorias';
import { getYoutubeEmbedUrl } from '../../academy/youtube';

interface SecaoForm {
  titulo: string;
  texto: string;
  listaTexto: string; // um item por linha
}

interface ArtigoForm {
  id: number | null;
  categoria: CategoriaId;
  titulo: string;
  slug: string;
  resumo: string;
  nivel: (typeof NIVEIS)[number];
  publico: (typeof PUBLICOS)[number];
  tempoLeitura: string;
  videoUrl: string;
  ativo: boolean;
  secoes: SecaoForm[];
  checklistTexto: string; // um item por linha
}

const slugify = (s: string) =>
  s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const formVazio: ArtigoForm = {
  id: null,
  categoria: 'tv',
  titulo: '',
  slug: '',
  resumo: '',
  nivel: 'Básico',
  publico: 'Técnico e Comercial',
  tempoLeitura: '5 min',
  videoUrl: '',
  ativo: true,
  secoes: [{ titulo: '', texto: '', listaTexto: '' }],
  checklistTexto: '',
};

export default function GestaoAcademy() {
  const router = useRouter();
  const { usuarioAtual: usuarioNome, authLoading, acessoNegado, erro, tentarNovamente } = usePageAccess({ nomeFallback: 'Usuário' });
  const toast = useToast();

  const [artigos, setArtigos] = useState<Artigo[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaId | 'todos'>('todos');

  const [view, setView] = useState<'lista' | 'form'>('lista');
  const [form, setForm] = useState<ArtigoForm>(formVazio);
  const [slugTocado, setSlugTocado] = useState(false);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    carregarDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado]);

  const carregarDados = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('academy_artigos')
      .select('*')
      .order('categoria', { ascending: true })
      .order('ordem', { ascending: true });
    if (data) setArtigos(data);
    setLoading(false);
  };

  const artigosFiltrados = useMemo(() => {
    const termo = busca.toLowerCase();
    return artigos.filter((a) =>
      (filtroCategoria === 'todos' || a.categoria === filtroCategoria) &&
      (a.titulo.toLowerCase().includes(termo) || a.resumo.toLowerCase().includes(termo))
    );
  }, [artigos, busca, filtroCategoria]);

  const abrirNovo = () => {
    setForm(formVazio);
    setSlugTocado(false);
    setView('form');
  };

  const abrirEdicao = (artigo: Artigo) => {
    setForm({
      id: artigo.id,
      categoria: artigo.categoria,
      titulo: artigo.titulo,
      slug: artigo.slug,
      resumo: artigo.resumo,
      nivel: artigo.nivel,
      publico: artigo.publico,
      tempoLeitura: artigo.tempo_leitura,
      videoUrl: artigo.video_url || '',
      ativo: artigo.ativo,
      secoes: artigo.secoes.length > 0
        ? artigo.secoes.map((s) => ({ titulo: s.titulo, texto: s.texto || '', listaTexto: (s.lista || []).join('\n') }))
        : [{ titulo: '', texto: '', listaTexto: '' }],
      checklistTexto: (artigo.checklist || []).join('\n'),
    });
    setSlugTocado(true);
    setView('form');
  };

  const handleTituloChange = (titulo: string) => {
    setForm((f) => ({ ...f, titulo, slug: slugTocado ? f.slug : slugify(titulo) }));
  };

  const addSecao = () => {
    setForm((f) => ({ ...f, secoes: [...f.secoes, { titulo: '', texto: '', listaTexto: '' }] }));
  };

  const removeSecao = (i: number) => {
    setForm((f) => ({ ...f, secoes: f.secoes.filter((_, idx) => idx !== i) }));
  };

  const updateSecao = (i: number, campo: keyof SecaoForm, valor: string) => {
    setForm((f) => ({ ...f, secoes: f.secoes.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)) }));
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.titulo.trim()) return toast('Informe o título do artigo.', 'error');
    if (!form.slug.trim()) return toast('Informe o slug (endereço) do artigo.', 'error');
    if (!form.resumo.trim()) return toast('Informe o resumo do artigo.', 'error');

    const secoes: Secao[] = form.secoes
      .filter((s) => s.titulo.trim())
      .map((s) => {
        const lista = s.listaTexto.split('\n').map((l) => l.trim()).filter(Boolean);
        const secao: Secao = { titulo: s.titulo.trim() };
        if (s.texto.trim()) secao.texto = s.texto.trim();
        if (lista.length > 0) secao.lista = lista;
        return secao;
      });

    if (secoes.length === 0) return toast('Adicione ao menos uma seção com título.', 'error');

    const videoUrl = form.videoUrl.trim();
    if (videoUrl && !getYoutubeEmbedUrl(videoUrl)) {
      return toast('Link de vídeo não reconhecido. Use um link do YouTube (youtube.com/watch?v=... ou youtu.be/...).', 'error');
    }

    const checklist = form.checklistTexto.split('\n').map((l) => l.trim()).filter(Boolean);

    const payload = {
      categoria: form.categoria,
      titulo: form.titulo.trim(),
      slug: slugify(form.slug),
      resumo: form.resumo.trim(),
      nivel: form.nivel,
      publico: form.publico,
      tempo_leitura: form.tempoLeitura.trim() || '5 min',
      video_url: videoUrl || null,
      ativo: form.ativo,
      secoes,
      checklist: checklist.length > 0 ? checklist : null,
    };

    setSalvando(true);
    try {
      if (form.id) {
        const { error } = await supabase.from('academy_artigos').update(payload).eq('id', form.id);
        if (error) throw error;
        await registrarLogAuditoria({
          usuario_nome: usuarioNome,
          acao: `EDIÇÃO DE ARTIGO: ${payload.titulo}`,
          setor: 'RENTECH ACADEMY',
        });
        toast('Artigo atualizado com sucesso!', 'success');
      } else {
        const { error } = await supabase.from('academy_artigos').insert([payload]);
        if (error) throw error;
        await registrarLogAuditoria({
          usuario_nome: usuarioNome,
          acao: `CADASTRO DE ARTIGO: ${payload.titulo}`,
          setor: 'RENTECH ACADEMY',
        });
        toast('Artigo publicado com sucesso!', 'success');
      }
      setView('lista');
      carregarDados();
    } catch (error: any) {
      if (error.code === '23505') {
        toast('Já existe um artigo com esse slug. Escolha outro.', 'error');
      } else {
        toast(`Erro ao salvar: ${error.message}`, 'error');
      }
    } finally {
      setSalvando(false);
    }
  };

  const handleToggleAtivo = async (artigo: Artigo) => {
    const { error } = await supabase.from('academy_artigos').update({ ativo: !artigo.ativo }).eq('id', artigo.id);
    if (error) return toast(`Erro ao atualizar: ${error.message}`, 'error');
    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `${!artigo.ativo ? 'PUBLICAÇÃO' : 'DESPUBLICAÇÃO'} DE ARTIGO: ${artigo.titulo}`,
      setor: 'RENTECH ACADEMY',
    });
    carregarDados();
  };

  const handleDeletar = async (artigo: Artigo) => {
    if (!confirm(`Tem certeza que deseja excluir "${artigo.titulo}"? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from('academy_artigos').delete().eq('id', artigo.id);
    if (error) return toast(`Erro ao excluir: ${error.message}`, 'error');
    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `EXCLUSÃO DE ARTIGO: ${artigo.titulo}`,
      setor: 'RENTECH ACADEMY',
    });
    toast('Artigo excluído.', 'success');
    carregarDados();
  };

  // ============================================================================
  // BARREIRAS DE ACESSO VISUAIS
  // ============================================================================
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para gerenciar o conteúdo da Rentech Academy.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  // ============================================================================
  // FORMULÁRIO (novo / edição)
  // ============================================================================
  if (view === 'form') {
    return (
      <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
        <Analytics />

        <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
          <p className="text-[#0369A1] font-medium text-sm">
            🎓 <strong>{form.id ? 'Editar Artigo' : 'Novo Artigo'}</strong> — Rentech Academy
          </p>
          <button onClick={() => setView('lista')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
            ⬅ VOLTAR À LISTA
          </button>
        </div>

        <form onSubmit={handleSalvar} className="p-4 md:p-8 max-w-4xl mx-auto w-full space-y-6">

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2 mb-2">Dados Gerais</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Categoria</label>
                <select value={form.categoria} onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value as CategoriaId }))} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold outline-none focus:border-[#336699] bg-white cursor-pointer">
                  {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.icone} {c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Nível</label>
                <select value={form.nivel} onChange={(e) => setForm((f) => ({ ...f, nivel: e.target.value as ArtigoForm['nivel'] }))} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold outline-none focus:border-[#336699] bg-white cursor-pointer">
                  {NIVEIS.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Público</label>
                <select value={form.publico} onChange={(e) => setForm((f) => ({ ...f, publico: e.target.value as ArtigoForm['publico'] }))} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold outline-none focus:border-[#336699] bg-white cursor-pointer">
                  {PUBLICOS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Título</label>
              <input type="text" required value={form.titulo} onChange={(e) => handleTituloChange(e.target.value)} placeholder="Ex: Instalação de TVs em Eventos" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699]" />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Slug (endereço em /academy/...)</label>
              <input type="text" required value={form.slug} onChange={(e) => { setSlugTocado(true); setForm((f) => ({ ...f, slug: e.target.value })); }} onBlur={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))} placeholder="instalacao-tvs-eventos" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-mono outline-none focus:border-[#336699]" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Resumo (aparece no card)</label>
                <textarea required value={form.resumo} onChange={(e) => setForm((f) => ({ ...f, resumo: e.target.value }))} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] h-20 resize-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Tempo de leitura</label>
                <input type="text" value={form.tempoLeitura} onChange={(e) => setForm((f) => ({ ...f, tempoLeitura: e.target.value }))} placeholder="5 min" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699]" />

                <label className="flex items-center gap-2 mt-4 cursor-pointer w-fit">
                  <input type="checkbox" checked={form.ativo} onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))} className="w-4 h-4 accent-[#336699]" />
                  <span className="text-xs font-bold text-[#64748B]">Publicado (visível em /academy)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Vídeo do YouTube (opcional)</label>
              <input
                type="url"
                value={form.videoUrl}
                onChange={(e) => setForm((f) => ({ ...f, videoUrl: e.target.value }))}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699]"
              />
              {form.videoUrl.trim() && (
                getYoutubeEmbedUrl(form.videoUrl.trim()) ? (
                  <div className="mt-3 rounded-lg overflow-hidden border border-[#CBD5E1] bg-black aspect-video max-w-sm">
                    <iframe src={getYoutubeEmbedUrl(form.videoUrl.trim())!} title="Pré-visualização" allowFullScreen className="w-full h-full" />
                  </div>
                ) : (
                  <p className="text-[10px] text-red-500 font-bold mt-1.5">Link não reconhecido como vídeo do YouTube.</p>
                )
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-5">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider">Seções do Artigo</h3>
              <button type="button" onClick={addSecao} className="text-[10px] font-black bg-blue-50 text-[#336699] hover:bg-blue-100 px-3 py-1.5 rounded-lg uppercase tracking-wider transition-colors">
                + Adicionar Seção
              </button>
            </div>

            {form.secoes.map((secao, i) => (
              <div key={i} className="border border-[#E2E8F0] rounded-xl p-4 space-y-3 bg-[#F8FAFC]">
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="text"
                    placeholder={`Título da seção ${i + 1}`}
                    value={secao.titulo}
                    onChange={(e) => updateSecao(i, 'titulo', e.target.value)}
                    className="flex-1 p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold outline-none focus:border-[#336699] bg-white"
                  />
                  {form.secoes.length > 1 && (
                    <button type="button" onClick={() => removeSecao(i)} className="text-[10px] font-black text-red-500 hover:text-red-700 px-2 uppercase">
                      Remover
                    </button>
                  )}
                </div>
                <textarea
                  placeholder="Texto explicativo (opcional)"
                  value={secao.texto}
                  onChange={(e) => updateSecao(i, 'texto', e.target.value)}
                  className="w-full p-2 border border-[#CBD5E1] rounded-lg text-xs outline-none focus:border-[#336699] h-16 resize-none bg-white"
                />
                <textarea
                  placeholder={'Lista de tópicos — um por linha (opcional)'}
                  value={secao.listaTexto}
                  onChange={(e) => updateSecao(i, 'listaTexto', e.target.value)}
                  className="w-full p-2 border border-[#CBD5E1] rounded-lg text-xs outline-none focus:border-[#336699] h-20 resize-none bg-white"
                />
              </div>
            ))}
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-3">
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2 mb-2">Checklist Rápido (opcional)</h3>
            <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Um item por linha</label>
            <textarea
              value={form.checklistTexto}
              onChange={(e) => setForm((f) => ({ ...f, checklistTexto: e.target.value }))}
              className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] h-28 resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button type="button" onClick={() => setView('lista')} className="px-6 py-3 rounded-lg font-black uppercase text-xs tracking-wider border border-[#CBD5E1] text-[#64748B] hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className="flex-1 bg-[#336699] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-3 rounded-lg shadow-md transition-all active:scale-[0.99] disabled:opacity-50">
              {salvando ? 'A Salvar...' : '💾 Salvar Artigo'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ============================================================================
  // LISTAGEM
  // ============================================================================
  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🎓 <strong>Gestão da Rentech Academy</strong>. Publique dicas técnicas de TV, LED, som e luz.
        </p>
        <button onClick={() => router.push('/admin')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="p-4 md:p-8 max-w-6xl mx-auto w-full">

        <div className="flex flex-col md:flex-row gap-4 mb-6 items-stretch md:items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFiltroCategoria('todos')}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide border transition-colors ${filtroCategoria === 'todos' ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white text-[#64748B] border-[#CBD5E1] hover:border-[#336699]'}`}
            >
              Todos ({artigos.length})
            </button>
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                onClick={() => setFiltroCategoria(c.id)}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide border transition-colors ${filtroCategoria === c.id ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white text-[#64748B] border-[#CBD5E1] hover:border-[#336699]'}`}
              >
                {c.icone} {c.label}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="🔍 Buscar artigo..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] bg-white w-full md:w-64"
            />
            <button onClick={abrirNovo} className="bg-[#336699] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs px-5 py-2.5 rounded-lg shadow-md transition-all whitespace-nowrap">
              + Novo Artigo
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-[#94A3B8] font-bold text-sm flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
              A carregar artigos...
            </div>
          ) : artigosFiltrados.length === 0 ? (
            <div className="p-10 text-center text-[#94A3B8] font-bold text-sm">Nenhum artigo encontrado.</div>
          ) : (
            <div className="divide-y divide-[#E2E8F0]">
              {artigosFiltrados.map((artigo) => {
                const cat = CATEGORIAS.find((c) => c.id === artigo.categoria);
                return (
                  <div key={artigo.id} className="p-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="bg-blue-100 text-[#336699] text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider">{cat?.icone} {cat?.label}</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${artigo.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {artigo.ativo ? 'Publicado' : 'Rascunho'}
                        </span>
                        <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-slate-100 text-slate-600">{artigo.nivel}</span>
                        {artigo.video_url && <span className="text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider bg-indigo-100 text-indigo-700">🎥 Vídeo</span>}
                      </div>
                      <strong className="text-sm text-[#0C1D4D] block truncate" title={artigo.titulo}>{artigo.titulo}</strong>
                      <p className="text-xs text-[#64748B] mt-0.5 line-clamp-1">{artigo.resumo}</p>
                      <span className="text-[10px] text-[#94A3B8] font-semibold mt-1 block font-mono">/academy/{artigo.slug}</span>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => handleToggleAtivo(artigo)} className="bg-slate-100 text-slate-600 hover:bg-slate-200 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors">
                        {artigo.ativo ? 'Despublicar' : 'Publicar'}
                      </button>
                      <button onClick={() => abrirEdicao(artigo)} className="bg-[#E0F2FE] text-[#0369A1] hover:bg-[#BAE6FD] px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors">
                        Editar
                      </button>
                      <button onClick={() => handleDeletar(artigo)} className="bg-red-50 text-red-600 hover:bg-red-100 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors">
                        Excluir
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
