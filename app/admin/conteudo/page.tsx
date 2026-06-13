"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";

// Interface para os dados do site incluindo as URLs das imagens
interface SiteConfig {
  id: number;
  whatsapp: string;
  email_contato: string;
  hero_titulo: string;
  hero_subtitulo: string;
  video_url: string;
  videos_carrossel?: string[]; // Array de links para o carrossel
  img_feiras: string;
  img_feiras_titulo?: string;
  img_feiras_desc?: string;
  img_congressos: string;
  img_congressos_titulo?: string;
  img_congressos_desc?: string;
  img_shows: string;
  img_shows_titulo?: string;
  img_shows_desc?: string;
  img_case_corporativo: string;
  img_case_corporativo_titulo?: string;
  img_case_corporativo_desc?: string;
  img_case_festival: string;
  img_case_festival_titulo?: string;
  img_case_festival_desc?: string;
  img_case_congresso: string;
  img_case_congresso_titulo?: string;
  img_case_congresso_desc?: string;
}

export default function GestaoConteudo() {
  const router = useRouter();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);

  // Estados do Conteúdo com Placeholders Iniciais do código estático
  const [config, setConfig] = useState<SiteConfig>({
    id: 1,
    whatsapp: '5511998527420',
    email_contato: 'contato@locadorarentech.com.br',
    hero_titulo: 'Engenharia Audiovisual para Grandes Eventos',
    hero_subtitulo: 'Elevamos o padrão do seu evento corporativo, show ou congresso com infraestrutura técnica de ponta.',
    video_url: '',
    videos_carrossel: [],
    img_feiras: '/cases/feiras2.jpg',
    img_feiras_titulo: 'Feiras e Exibições',
    img_feiras_desc: 'Estrutura completa para stands e painéis.',
    img_congressos: '/cases/congressos.png',
    img_congressos_titulo: 'Congressos',
    img_congressos_desc: 'Sonorização e projeção de alta qualidade.',
    img_shows: '/cases/shows.png',
    img_shows_titulo: 'Shows e Festivais',
    img_shows_desc: 'Grandes palcos e iluminação cênica.',
    img_case_corporativo: '/cases/case-corporativo.jpg',
    img_case_corporativo_titulo: 'Case Corporativo',
    img_case_corporativo_desc: 'Evento de final de ano com transmissão.',
    img_case_festival: '/cases/case-festival.png',
    img_case_festival_titulo: 'Case Festival',
    img_case_festival_desc: 'Festival de música com painéis de LED.',
    img_case_congresso: '/cases/case-congresso.jpg',
    img_case_congresso_titulo: 'Case Congresso',
    img_case_congresso_desc: 'Congresso internacional médico.'
  });

  const [dialog, setDialog] = useState({ open: false, msg: '', title: '', isError: false });

  // 1. Validar Sessão (Diretoria, Administrador e Editor liberados)
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil } = await supabase.from('perfis_usuarios').select('*').eq('id', session.user.id).single();
      
      if (perfil) {
        setUsuarioAtual(perfil.nome || 'Gestor');
        const permissao = String(perfil.permissao || perfil.nivel || '').toUpperCase();
        
        // ADICIONADO: 'EDITOR' e 'ADMINISTRATIVO' incluídos na validação de acesso do card
        if (!['DIR', 'DIRETOR', 'ADMINISTRADOR', 'ADMIN', 'EDITOR', 'ADMINISTRATIVO'].includes(permissao)) {
          router.push('/admin');
          return;
        }
      }
      setAuthLoading(false);
      carregarConfiguracoes();
    }
    checkAuth();
  }, [router]);

  // 2. Carregar dados do banco
  const carregarConfiguracoes = async () => {
    const { data, error } = await supabase.from('site_config').select('*').eq('id', 1).single();
    if (data && !error) {
      setConfig(prev => ({ ...prev, ...data }));
    }
  };

  // 3. Função de Upload de Imagens para o Storage
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, campo: keyof SiteConfig) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert("A imagem é muito grande. O limite máximo é 5MB.");
      return;
    }

    setUploadingField(campo);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `site-${campo}-${Date.now()}.${fileExt}`;
      const filePath = `site_conteudo/${fileName}`;

      // Envia para o bucket público 'comprovantes' (ou outro criado para o site)
      const { error: uploadError } = await supabase.storage
        .from('comprovantes')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('comprovantes').getPublicUrl(filePath);
      
      setConfig(prev => ({ ...prev, [campo]: publicUrlData.publicUrl }));
      setDialog({ open: true, title: 'Upload Concluído', msg: 'Imagem carregada com sucesso. Lembre-se de salvar as alterações.', isError: false });
    } catch (error: any) {
      setDialog({ open: true, title: 'Erro no Upload', msg: error.message || 'Falha ao processar imagem.', isError: true });
    } finally {
      setUploadingField(null);
    }
  };

  // 4. Salvar alterações textuais e caminhos de imagem
  const salvarConfiguracoes = async () => {
    setLoading(true);
    const { error } = await supabase.from('site_config').upsert({ ...config, id: 1 });
    
    if (error) {
      setDialog({ open: true, title: 'Erro de Conexão', msg: error.message, isError: true });
    } else {
      setDialog({ open: true, title: 'Sucesso!', msg: 'O conteúdo e as imagens do site foram publicados.', isError: false });
    }
    
    setLoading(false);
  };
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      {/* HEADER TÉCNICO */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🌐 <strong>Olá, {usuarioAtual}</strong>. Gestão Avançada de Conteúdo e Mídias.
        </p>
        <button 
          onClick={() => router.push('/admin')} 
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-grow p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6 pb-24">
        
        <div className="mb-8">
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider">Editor do Site Oficial</h1>
          <p className="text-[#64748B] text-sm font-medium mt-1">
            Altere canais de atendimento, blocos de texto e mídias visuais da página inicial.
          </p>
        </div>

        {/* SEÇÃO 1: TEXTOS E CONFIGURAÇÕES */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
            <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">
              📞 Canais de Atendimento
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">WhatsApp (Apenas Números)</label>
                <input 
                  type="text" 
                  className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0A2A4A] outline-none focus:border-[#336699]"
                  value={config.whatsapp}
                  onChange={(e) => setConfig({...config, whatsapp: e.target.value.replace(/\D/g, '')})}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">E-mail Principal</label>
                <input 
                  type="email" 
                  className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0A2A4A] outline-none focus:border-[#336699]"
                  value={config.email_contato}
                  onChange={(e) => setConfig({...config, email_contato: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
            <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">
              🖥️ Textos do Banner Principal (Hero)
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Título Grande</label>
                <input 
                  type="text" 
                  className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0A2A4A] outline-none focus:border-[#336699]"
                  value={config.hero_titulo}
                  onChange={(e) => setConfig({...config, hero_titulo: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Subtítulo de Apoio</label>
                <textarea 
                  rows={3}
                  className="w-full p-3 border-2 border-[#E2E8F0] rounded-xl text-sm font-bold text-[#0A2A4A] outline-none focus:border-[#336699] resize-none"
                  value={config.hero_subtitulo}
                  onChange={(e) => setConfig({...config, hero_subtitulo: e.target.value})}
                />
              </div>
            </div>
          </div>
        </div>

        {/* SEÇÃO 2: GERENCIAMENTO DE IMAGENS DAS ESPECIALIDADES */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-6 border-b border-[#E2E8F0] pb-2">
            📸 Imagens da Seção de Especialidades
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: 'Feiras e Exibições', campo: 'img_feiras' as const, campoTitulo: 'img_feiras_titulo' as const, campoDesc: 'img_feiras_desc' as const },
              { label: 'Congressos', campo: 'img_congressos' as const, campoTitulo: 'img_congressos_titulo' as const, campoDesc: 'img_congressos_desc' as const },
              { label: 'Shows e Festivais', campo: 'img_shows' as const, campoTitulo: 'img_shows_titulo' as const, campoDesc: 'img_shows_desc' as const }
            ].map(item => (
              <div key={item.campo} className="border border-[#E2E8F0] p-4 rounded-xl flex flex-col bg-[#F8FAFC] gap-3">
                <div className="flex-shrink-0">
                  <span className="block text-xs font-black uppercase tracking-wider text-[#0C1D4D] mb-2">{item.label}</span>
                  <div className="relative h-32 w-full bg-gray-200 rounded-lg overflow-hidden mb-3 border border-[#CBD5E1]">
                    <img src={config[item.campo]} alt={item.label} className="w-full h-full object-cover" />
                  </div>
                </div>
                <label className="w-full text-center bg-white border border-[#BAE6FD] hover:bg-blue-50 text-[#0369A1] font-bold text-[10px] uppercase tracking-wider py-2 rounded-lg cursor-pointer block transition-colors">
                  {uploadingField === item.campo ? 'Carregando...' : '🔄 Alterar Imagem'}
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, item.campo)} disabled={uploadingField !== null} />
                </label>

                <div className="space-y-3 mt-2 border-t border-[#E2E8F0] pt-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Título</label>
                    <input 
                      type="text" 
                      className="w-full p-2 border border-[#CBD5E1] rounded-lg text-xs font-bold text-[#0A2A4A] outline-none focus:border-[#336699]"
                      value={config[item.campoTitulo] || ''}
                      onChange={(e) => setConfig({...config, [item.campoTitulo]: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Descrição Curta</label>
                    <textarea 
                      rows={2}
                      className="w-full p-2 border border-[#CBD5E1] rounded-lg text-xs font-medium text-[#0A2A4A] outline-none focus:border-[#336699] resize-none"
                      value={config[item.campoDesc] || ''}
                      onChange={(e) => setConfig({...config, [item.campoDesc]: e.target.value})}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SEÇÃO 3: GERENCIAMENTO DE IMAGENS DO PORTFÓLIO / CASES */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-6 border-b border-[#E2E8F0] pb-2">
            💼 Imagens da Seção Cases de Sucesso
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: 'Case Corporativo', campo: 'img_case_corporativo' as const, campoTitulo: 'img_case_corporativo_titulo' as const, campoDesc: 'img_case_corporativo_desc' as const },
              { label: 'Case Festival', campo: 'img_case_festival' as const, campoTitulo: 'img_case_festival_titulo' as const, campoDesc: 'img_case_festival_desc' as const },
              { label: 'Case Congresso', campo: 'img_case_congresso' as const, campoTitulo: 'img_case_congresso_titulo' as const, campoDesc: 'img_case_congresso_desc' as const }
            ].map(item => (
              <div key={item.campo} className="border border-[#E2E8F0] p-4 rounded-xl flex flex-col bg-[#F8FAFC] gap-3">
                <div className="flex-shrink-0">
                  <span className="block text-xs font-black uppercase tracking-wider text-[#0C1D4D] mb-2">{item.label}</span>
                  <div className="relative h-32 w-full bg-gray-200 rounded-lg overflow-hidden mb-3 border border-[#CBD5E1]">
                    <img src={config[item.campo]} alt={item.label} className="w-full h-full object-cover" />
                  </div>
                </div>
                <label className="w-full text-center bg-white border border-[#BAE6FD] hover:bg-blue-50 text-[#0369A1] font-bold text-[10px] uppercase tracking-wider py-2 rounded-lg cursor-pointer block transition-colors">
                  {uploadingField === item.campo ? 'Carregando...' : '🔄 Alterar Imagem'}
                  <input type="file" className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, item.campo)} disabled={uploadingField !== null} />
                </label>

                <div className="space-y-3 mt-2 border-t border-[#E2E8F0] pt-3">
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Título do Case</label>
                    <input 
                      type="text" 
                      className="w-full p-2 border border-[#CBD5E1] rounded-lg text-xs font-bold text-[#0A2A4A] outline-none focus:border-[#336699]"
                      value={config[item.campoTitulo] || ''}
                      onChange={(e) => setConfig({...config, [item.campoTitulo]: e.target.value})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Descrição Resumida</label>
                    <textarea 
                      rows={2}
                      className="w-full p-2 border border-[#CBD5E1] rounded-lg text-xs font-medium text-[#0A2A4A] outline-none focus:border-[#336699] resize-none"
                      value={config[item.campoDesc] || ''}
                      onChange={(e) => setConfig({...config, [item.campoDesc]: e.target.value})}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SEÇÃO 4: CARROSSEL DE VÍDEOS */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0]">
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">
            🎬 Carrossel de Vídeos (Página Inicial)
          </h2>
          <div className="space-y-4">
            {(config.videos_carrossel || []).map((video, index) => {
              const isVertical = video.startsWith('vertical|');
              const url = video.replace('vertical|', '').replace('horizontal|', '');

              return (
                <div key={index} className="flex flex-col md:flex-row gap-2 items-center bg-[#F8FAFC] border border-[#E2E8F0] p-2 rounded-xl">
                  <input 
                    type="text" 
                    className="flex-1 w-full p-3 border-2 border-[#E2E8F0] rounded-xl text-sm font-medium text-[#0A2A4A] outline-none focus:border-[#336699]"
                    placeholder="Ex: https://www.youtube.com/embed/..."
                    value={url}
                    onChange={(e) => {
                      const newVideos = [...(config.videos_carrossel || [])];
                      newVideos[index] = `${isVertical ? 'vertical|' : 'horizontal|'}${e.target.value}`;
                      setConfig({...config, videos_carrossel: newVideos});
                    }}
                  />
                  <label className="flex items-center gap-2 px-3 py-3 text-sm font-bold text-[#64748B] cursor-pointer whitespace-nowrap">
                    <input 
                      type="checkbox"
                      className="w-5 h-5 accent-[#336699] rounded cursor-pointer"
                      checked={isVertical}
                      onChange={(e) => {
                        const newVideos = [...(config.videos_carrossel || [])];
                        newVideos[index] = `${e.target.checked ? 'vertical|' : 'horizontal|'}${url}`;
                        setConfig({...config, videos_carrossel: newVideos});
                      }}
                    />
                    Vertical (9:16)
                  </label>
                  <button
                    onClick={() => {
                      const newVideos = [...(config.videos_carrossel || [])];
                      newVideos.splice(index, 1);
                      setConfig({...config, videos_carrossel: newVideos});
                    }}
                    className="w-full md:w-auto bg-red-50 text-red-500 font-bold px-4 py-3 rounded-xl hover:bg-red-100 transition-colors border border-red-100"
                    title="Remover Vídeo"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => {
                setConfig({...config, videos_carrossel: [...(config.videos_carrossel || []), 'horizontal|']});
              }}
              className="w-full md:w-auto px-6 py-3 bg-[#F0F4F8] border border-[#CBD5E1] text-[#336699] font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-[#E2E8F0] transition-colors"
            >
              ➕ Adicionar Novo Vídeo
            </button>
          </div>
        </div>

        {/* BARRA DE AÇÃO FLUTUANTE / FIXA EM BAIXO */}
        <div className="bg-[#0C1D4D] p-6 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-4 shadow-lg">
          <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-widest text-center md:text-left">
            Certifique-se de que os uploads terminaram antes de publicar.
          </p>
          <button 
            onClick={salvarConfiguracoes}
            disabled={loading || uploadingField !== null}
            className="w-full md:w-auto bg-[#336699] hover:bg-[#284B8C] text-white px-10 py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-colors shadow-md disabled:opacity-50"
          >
            {loading ? 'Sincronizando...' : 'Publicar Todo o Conteúdo'}
          </button>
        </div>

      </div>

      {/* DIALOG DE FEEDBACK */}
      {dialog.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-sm w-full mx-4">
            <div className="text-5xl mb-4">
              {dialog.isError ? '⚠️' : '✅'}
            </div>
            <h3 className="text-xl font-black uppercase tracking-wider mb-2 text-[#0C1D4D]">
              {dialog.title}
            </h3>
            <p className="text-sm text-[#64748B] font-medium mb-8">{dialog.msg}</p>
            <button 
              onClick={() => setDialog({ ...dialog, open: false })} 
              className="w-full py-3 bg-[#0C1D4D] text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-lg hover:bg-[#284B8C] transition-colors"
            >
              Ciente
            </button>
          </div>
        </div>
      )}

    </div>
  );
}