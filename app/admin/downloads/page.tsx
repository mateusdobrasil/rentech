"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { registrarLogAuditoria } from '../../actions';
import PaginationFooter from '../../components/ui/PaginationFooter';
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';

const TAMANHO_PAGINA = 30;

interface Arquivo {
  id: string;
  nome: string;
  descricao: string;
  categoria: string;
  file_url: string;
  file_path: string;
  tamanho_mb: number;
  created_at: string;
}

export default function GestorDownloads() {
  const router = useRouter();
  const { usuarioAtual: usuarioNome, authLoading, acessoNegado, erro, tentarNovamente } = usePageAccess({ nomeFallback: 'Usuário' });

  // Estados de Dados
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [totalRegistros, setTotalRegistros] = useState(0);

  // Estados do Formulário
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState('COMERCIAL');
  
  // Estados de Alternância de Origem
  const [tipoOrigem, setTipoOrigem] = useState<'ARQUIVO' | 'LINK'>('ARQUIVO');
  const [file, setFile] = useState<File | null>(null);
  const [linkExterno, setLinkExterno] = useState('');
  const [tamanhoManual, setTamanhoManual] = useState('');

  // 2. Carregar dados da tabela, paginado (Agora só é chamado se a autenticação passar)
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    carregarDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, pagina]);

  const carregarDados = async () => {
    setLoading(true);
    const { data, count } = await supabase
      .from('arquivos_download')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);
    if (data) setArquivos(data);
    setTotalRegistros(count || 0);
    setLoading(false);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome) return alert('Por favor, insira o nome do arquivo.');

    setIsUploading(true);
    try {
      let finalUrl = '';
      let filePathDB = '';
      let tamanhoMB = 0;

      if (tipoOrigem === 'ARQUIVO') {
        if (!file) {
          setIsUploading(false);
          return alert('Selecione um arquivo físico para upload.');
        }

        // Upload para o Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `${categoria.toLowerCase()}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('downloads')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('downloads').getPublicUrl(filePath);
        
        finalUrl = publicUrlData.publicUrl;
        filePathDB = filePath;
        tamanhoMB = parseFloat((file.size / (1024 * 1024)).toFixed(2));
      } else {
        if (!linkExterno) {
          setIsUploading(false);
          return alert('Insira a URL do link externo.');
        }
        
        finalUrl = linkExterno.trim();
        filePathDB = 'LINK_EXTERNO'; // Flag para ignorar remoção do storage depois
        tamanhoMB = parseFloat(tamanhoManual) || 0;
      }

      // Salva o registro na tabela
      const { error: dbError } = await supabase.from('arquivos_download').insert([{
        nome,
        descricao,
        categoria,
        file_url: finalUrl,
        file_path: filePathDB,
        tamanho_mb: tamanhoMB
      }]);

      if (dbError) throw dbError;

      // Auditoria Rentech
      await registrarLogAuditoria({
        usuario_nome: usuarioNome,
        acao: `CADASTRO DE ARQUIVO (${tipoOrigem}): ${nome}`,
        setor: 'GESTAO DE DOWNLOADS',
        equipamento_nome: `Categoria: ${categoria}`
      });

      alert('Item adicionado com sucesso!');
      setNome(''); 
      setDescricao(''); 
      setFile(null);
      setLinkExterno('');
      setTamanhoManual('');
      
      const fileInput = document.getElementById('fileInput') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

      setPagina(0);
      carregarDados();

    } catch (error: any) {
      alert(`Erro ao processar: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeletar = async (arq: Arquivo) => {
    if (!confirm(`Tem certeza que deseja remover "${arq.nome}"?`)) return;

    try {
      // Só tenta remover do storage se for um arquivo físico local
      if (arq.file_path !== 'LINK_EXTERNO') {
        await supabase.storage.from('downloads').remove([arq.file_path]);
      }

      await supabase.from('arquivos_download').delete().eq('id', arq.id);

      await registrarLogAuditoria({
        usuario_nome: usuarioNome,
        acao: `EXCLUSÃO DE ARQUIVO: ${arq.nome}`,
        setor: 'GESTAO DE DOWNLOADS'
      });

      setPagina(0);
      carregarDados();
    } catch (error: any) {
      alert(`Erro ao deletar: ${error.message}`);
    }
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para gerenciar os arquivos e downloads do sistema.</p>
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
      
      {/* BANNER INFORMATIVO / HEADER */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          📁 <strong>Gestão de Downloads</strong>. Insira arquivos locais ou aponte links externos de qualquer tamanho.
        </p>
        <button onClick={() => router.push('/admin')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="p-4 md:p-8 flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto w-full">
        
        {/* FORMULÁRIO MODULAR */}
        <div className="w-full lg:w-1/3">
          <form onSubmit={handleUpload} className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4">
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2 mb-4">Novo Item</h3>
            
            {/* SELETOR INTELIGENTE DE ORIGEM */}
            <div className="bg-[#F8FAFC] p-1 rounded-xl border border-[#E2E8F0] grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setTipoOrigem('ARQUIVO')}
                className={`py-2 text-center text-xs font-black uppercase rounded-lg transition-all ${tipoOrigem === 'ARQUIVO' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}
              >
                📄 Arquivo Local
              </button>
              <button
                type="button"
                onClick={() => setTipoOrigem('LINK')}
                className={`py-2 text-center text-xs font-black uppercase rounded-lg transition-all ${tipoOrigem === 'LINK' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}
              >
                🔗 Link Externo
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Categoria</label>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold outline-none focus:border-[#336699] bg-white cursor-pointer">
                <option value="COMERCIAL">Apresentações Comerciais</option>
                <option value="OPERACIONAL">Manuais Operacionais</option>
                <option value="SOFTWARES">Softwares e Drivers</option>
                <option value="CLIENTES">Documentos para Clientes</option>
                <option value="MIDIA">Mídia</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Nome de Exibição</label>
              <input type="text" required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Manual Painel LED P2.5" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699]" />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Breve Descrição</label>
              <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Especifique detalhes ou versão do arquivo..." className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699] h-20 resize-none" />
            </div>

            {/* CAMPOS DINÂMICOS CONFORME A ORIGEM SELECIONADA */}
            {tipoOrigem === 'ARQUIVO' ? (
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Arquivo Físico (Máx 50MB)</label>
                <input type="file" required={tipoOrigem === 'ARQUIVO'} id="fileInput" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm text-[#64748B] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-[#336699] hover:file:bg-blue-100 cursor-pointer" />
                <p className="text-[10px] text-[#94A3B8] mt-1.5 font-medium">Nota: Para arquivos maiores que 50MB, alterne para a aba "Link Externo".</p>
              </div>
            ) : (
              <div className="space-y-4 animate-fadeIn">
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">URL Externa do Arquivo</label>
                  <input type="url" required={tipoOrigem === 'LINK'} value={linkExterno} onChange={(e) => setLinkExterno(e.target.value)} placeholder="https://drive.google.com/..." className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699]" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Tamanho Estimado (MB) - Opcional</label>
                  <input type="number" step="0.01" value={tamanhoManual} onChange={(e) => setTamanhoManual(e.target.value)} placeholder="Ex: 350" className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm outline-none focus:border-[#336699]" />
                </div>
              </div>
            )}

            <button type="submit" disabled={isUploading} className="w-full bg-[#336699] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-3 rounded-lg shadow-md transition-all active:scale-[0.99] disabled:opacity-50 mt-4">
              {isUploading ? 'A Processar...' : '💾 Salvar no Portal'}
            </button>
          </form>
        </div>

        {/* LISTAGEM DOS ITENS AUDITADOS */}
        <div className="w-full lg:w-2/3">
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider">Arquivos Disponíveis no Portal</h3>
            </div>
            
            {loading ? (
              <div className="p-10 text-center text-[#94A3B8] font-bold text-sm flex flex-col items-center gap-3">
                <div className="w-6 h-6 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                A carregar registros do banco de dados...
              </div>
            ) : arquivos.length === 0 ? (
              <div className="p-10 text-center text-[#94A3B8] font-bold text-sm">Nenhum documento listado no momento.</div>
            ) : (
              <div className="divide-y divide-[#E2E8F0]">
                {arquivos.map((arq) => {
                  const ehLink = arq.file_path === 'LINK_EXTERNO';
                  return (
                    <div key={arq.id} className="p-4 flex items-center justify-between hover:bg-[#F8FAFC] transition-colors gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="bg-blue-100 text-[#336699] text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider">{arq.categoria}</span>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${ehLink ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
                            {ehLink ? '🔗 Link Externo' : '📄 Local'}
                          </span>
                        </div>
                        <strong className="text-sm text-[#0C1D4D] block truncate" title={arq.nome}>{arq.nome}</strong>
                        <p className="text-xs text-[#64748B] mt-0.5 line-clamp-2">{arq.descricao || 'Sem descrição cadastrada.'}</p>
                        <span className="text-[10px] text-[#94A3B8] font-semibold mt-1 block">
                          {arq.tamanho_mb > 0 ? `${arq.tamanho_mb} MB` : 'Tamanho n/i'} • Vinculado em {new Date(arq.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <a href={arq.file_url} target="_blank" rel="noreferrer" className="bg-[#E0F2FE] text-[#0369A1] hover:bg-[#BAE6FD] px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors shadow-sm">
                          Testar
                        </a>
                        <button onClick={() => handleDeletar(arq)} className="bg-slate-100 text-slate-600 hover:bg-slate-200 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors">
                          Remover
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!loading && totalRegistros > 0 && (
              <div className="p-4 border-t border-[#E2E8F0]">
                <PaginationFooter
                  pagina={pagina}
                  totalRegistros={totalRegistros}
                  tamanhoPagina={TAMANHO_PAGINA}
                  loading={loading}
                  onAnterior={() => setPagina(p => Math.max(0, p - 1))}
                  onProxima={() => setPagina(p => p + 1)}
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}