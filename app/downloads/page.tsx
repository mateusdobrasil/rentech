"use client";

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { verificarSenhaDownloads } from '../actions'; // Importação da Server Action

interface Arquivo {
  id: string;
  nome: string;
  descricao: string;
  categoria: string;
  file_url: string;
  tamanho_mb: number;
}

export default function PortalDownloads() {
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  // Estados de Autenticação da Página
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [inputSenha, setInputSenha] = useState('');
  const [erroSenha, setErroSenha] = useState('');
  const [verificandoSenha, setVerificandoSenha] = useState(false);

  // Verifica se o usuário já digitou a senha nesta sessão
  useEffect(() => {
    if (sessionStorage.getItem('downloads_autorizado') === 'true') {
      setIsAuthorized(true);
      carregarArquivos();
    } else {
      setLoading(false);
    }
  }, []);

  const carregarArquivos = async () => {
    setLoading(true);
    const { data } = await supabase.from('arquivos_download').select('*').order('created_at', { ascending: false });
    if (data) setArquivos(data);
    setLoading(false);
  };

  const handleSubmitSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroSenha('');
    setVerificandoSenha(true);

    const res = await verificarSenhaDownloads(inputSenha);

    if (res.success) {
      sessionStorage.setItem('downloads_autorizado', 'true');
      setIsAuthorized(true);
      carregarArquivos();
    } else {
      setErroSenha(res.message || 'Senha incorreta.');
    }
    setVerificandoSenha(false);
  };

  const arquivosFiltrados = useMemo(() => {
    const termo = busca.toLowerCase();
    return arquivos.filter(arq => 
      arq.nome.toLowerCase().includes(termo) || 
      arq.descricao?.toLowerCase().includes(termo) ||
      arq.categoria.toLowerCase().includes(termo)
    );
  }, [arquivos, busca]);

  const arquivosAgrupados = useMemo(() => {
    return arquivosFiltrados.reduce((acc, arq) => {
      if (!acc[arq.categoria]) acc[arq.categoria] = [];
      acc[arq.categoria].push(arq);
      return acc;
    }, {} as Record<string, Arquivo[]>);
  }, [arquivosFiltrados]);

  // ============================================================================
  // TELA DE BLOQUEIO POR SENHA (RENDERIZADA SE NÃO ESTIVER AUTORIZADO)
  // ============================================================================
  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <Analytics />
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-[#E2E8F0] max-w-md w-full text-center">
          <div className="w-16 h-14 bg-blue-50 text-[#336699] rounded-2xl flex items-center justify-center text-3xl mx-auto mb-5 shadow-sm">
            🔐
          </div>
          <h2 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Área Restrita</h2>
          <p className="text-[#64748B] text-sm mb-6 font-medium">Insira a chave de acesso fornecida pela equipe Rentech para visualizar os downloads disponíveis.</p>
          
          <form onSubmit={handleSubmitSenha} className="space-y-4">
            <div className="relative">
              <input 
                type="password"
                required
                placeholder="Digite a chave de acesso..."
                value={inputSenha}
                onChange={(e) => setInputSenha(e.target.value)}
                className="w-full px-4 py-3.5 border border-[#CBD5E1] rounded-xl text-center text-sm font-bold tracking-widest outline-none focus:border-[#336699] focus:ring-2 focus:ring-[#336699]/10 bg-gray-50 transition-all placeholder:tracking-normal placeholder:font-normal"
              />
            </div>

            {erroSenha && (
              <p className="text-xs text-red-500 font-bold bg-red-50 py-2 rounded-lg border border-red-100">{erroSenha}</p>
            )}

            <button 
              type="submit"
              disabled={verificandoSenha || !inputSenha}
              className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-40"
            >
              {verificandoSenha ? 'A Validar...' : 'Destravar Portal'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================================
  // INTERFACE PRINCIPAL DO PORTAL (RENDERIZADA APÓS ACERTAR A SENHA)
  // ============================================================================
  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-[#0F172A] py-12">
      <Analytics />
      
      <main className="container mx-auto px-6 max-w-6xl">
        <div className="mb-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <h2 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight mb-2">Central de Downloads</h2>
            <p className="text-[#64748B] text-sm">Manuais, softwares e documentos técnicos.</p>
          </div>
          <div className="w-full md:w-80">
            <input 
              type="text" 
              placeholder="🔍 Filtrar arquivos..." 
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full p-3 pl-4 border border-[#CBD5E1] rounded-xl text-sm outline-none focus:border-[#336699] shadow-sm bg-white"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
          </div>
        ) : Object.keys(arquivosAgrupados).length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-[#CBD5E1]">
            <p className="text-[#64748B] font-medium">Nenhum arquivo encontrado.</p>
          </div>
        ) : (
          <div className="space-y-12">
            {Object.entries(arquivosAgrupados).sort().map(([categoria, lista]) => (
              <div key={categoria}>
                <h3 className="text-sm font-black text-[#336699] uppercase tracking-widest mb-6 border-b border-[#E2E8F0] pb-2">
                  {categoria} ({lista.length})
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {lista.map(arq => (
                    <div key={arq.id} className="bg-white p-6 rounded-2xl shadow-sm border border-[#F1F5F9] flex flex-col hover:border-[#336699]/30 transition-all">
                      <div className="flex-grow mb-6">
                        <strong className="block text-[#0C1D4D] font-black text-sm mb-2 uppercase">{arq.nome}</strong>
                        <p className="text-[#64748B] text-xs leading-relaxed">{arq.descricao || 'Sem descrição.'}</p>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t border-[#F8FAFC]">
                        <span className="text-[10px] font-bold text-[#94A3B8]">{arq.tamanho_mb} MB</span>
                        <a 
                          href={arq.file_url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="bg-[#336699] text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase hover:bg-[#0C1D4D] transition-colors"
                        >
                          Baixar
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}