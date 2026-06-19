"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";

interface Freelancer {
  id: string;
  nome: string;
  telefone: string;
  pix_tipo: string;
  pix_chave: string;
  nivel_led: string;
  nivel_videowall: string;
  nivel_tv: string;
  nivel_audio: string;
  nivel_luz: string;
  comentarios: string;
  created_at: string;
  status: string;
}

export default function GestaoFreelancers() {
  const router = useRouter();
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtros
  const [busca, setBusca] = useState('');
  const [filtroEspecialidade, setFiltroEspecialidade] = useState('');

  const [modalOpen, setModalOpen] = useState<{ open: boolean; free: Freelancer | null }>({ open: false, free: null });

  useEffect(() => {
    async function loadFreelancers() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data, error } = await supabase.from('freelancers').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        setFreelancers(data);
      }
      setLoading(false);
    }
    loadFreelancers();
  }, [router]);

  // Filtro Dinâmico
  const filtrados = useMemo(() => {
    let lista = freelancers;
    const termo = busca.toLowerCase();

    if (termo) {
      lista = lista.filter(f => f.nome.toLowerCase().includes(termo) || f.telefone.includes(termo));
    }

    if (filtroEspecialidade) {
      lista = lista.filter(f => {
        const nivel = (f as any)[`nivel_${filtroEspecialidade}`];
        return nivel && nivel !== 'Não trabalho com o Item';
      });
    }

    return lista;
  }, [freelancers, busca, filtroEspecialidade]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      
      {/* NAVEGAÇÃO E TÍTULO */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          👷 <strong>Banco de Talentos</strong>. Gestão de Freelancers Cadastrados.
        </p>
        <button 
          onClick={() => router.push('/admin')} 
          className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      {/* DASHBOARD RÁPIDO & FILTROS */}
      <div className="p-4 md:px-8 pt-6 flex-shrink-0">
        
        {/* CARDS INDICADORES */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-[#336699]">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Total Cadastrados</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">{freelancers.length}</p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-green-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em LED</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => f.nivel_led && f.nivel_led !== 'Não trabalho com o Item').length}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-blue-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em TV</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => f.nivel_tv && f.nivel_tv !== 'Não trabalho com o Item').length}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-amber-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em SOM</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => f.nivel_audio && f.nivel_audio !== 'Não trabalho com o Item').length}
            </p>
          </div>
          <div className="bg-white p-5 rounded-xl shadow-sm border-l-4 border-purple-500">
            <h3 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Espec. em LUZ</h3>
            <p className="text-2xl font-black text-[#0C1D4D] mt-1">
              {freelancers.filter(f => f.nivel_luz && f.nivel_luz !== 'Não trabalho com o Item').length}
            </p>
          </div>
        </div>

        {/* BARRA DE PESQUISA E FILTRO */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row gap-4 items-center">
          <div className="flex-1 w-full relative">
            <input 
              type="text" 
              placeholder="🔍 Buscar por Nome ou Telefone..." 
              className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#0A2A4A] focus:border-[#336699] outline-none transition-all"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="w-full lg:w-64 relative shadow-sm">
            <select 
              className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-semibold text-[#64748B] outline-none transition-all cursor-pointer focus:border-[#336699]"
              value={filtroEspecialidade}
              onChange={(e) => setFiltroEspecialidade(e.target.value)}
            >
              <option value="">Filtro: Todos os Setores</option>
              <option value="led">Painel de LED</option>
              <option value="videowall">Video Wall</option>
              <option value="tv">Televisores</option>
              <option value="audio">Áudio / Sonorização</option>
              <option value="luz">Iluminação</option>
            </select>
          </div>
        </div>
      </div>

      {/* TABELA DE FREELANCERS */}
      <div className="px-4 md:px-8 pb-8 flex-grow overflow-hidden flex flex-col mt-2">
        <div className="bg-white rounded-xl shadow-sm border border-[#E2E8F0] flex-grow overflow-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead className="bg-[#F8FAFC] sticky top-0 z-10 shadow-sm">
              <tr className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">
                <th className="p-4 border-b-2 border-[#E2E8F0]">Nome e Contato</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Média de Nível (Skills)</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">PIX (Tipo/Chave)</th>
                <th className="p-4 border-b-2 border-[#E2E8F0]">Data de Cadastro</th>
                <th className="p-4 border-b-2 border-[#E2E8F0] text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {filtrados.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-[#94A3B8] font-bold text-sm">Nenhum freelancer encontrado.</td></tr>
              ) : (
                filtrados.map((free) => (
                  <tr key={free.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="p-4">
                      <strong className="block text-sm text-[#0C1D4D] font-black">{free.nome}</strong>
                      <span className="text-[#64748B] font-semibold">📱 {free.telefone}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2 flex-wrap max-w-[320px]">
                        {free.nivel_led !== 'Não trabalho com o Item' && <span className="bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">LED: {free.nivel_led.split(',')[0]}</span>}
                        {free.nivel_tv !== 'Não trabalho com o Item' && <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">TV: {free.nivel_tv.split(',')[0]}</span>}
                        {free.nivel_audio !== 'Não trabalho com o Item' && <span className="bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">Som: {free.nivel_audio.split(',')[0]}</span>}
                        {free.nivel_luz !== 'Não trabalho com o Item' && <span className="bg-purple-50 text-purple-600 border border-purple-200 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider">Luz: {free.nivel_luz.split(',')[0]}</span>}
                      </div>
                    </td>
                    <td className="p-4">
                      <strong className="block text-[#0C1D4D] font-bold">{free.pix_chave}</strong>
                      <span className="text-[10px] text-[#94A3B8] font-black uppercase tracking-widest">{free.pix_tipo}</span>
                    </td>
                    <td className="p-4 font-semibold text-[#64748B]">
                      {new Date(free.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-4 text-center">
                      <button 
                        onClick={() => setModalOpen({ open: true, free })}
                        className="bg-white border border-[#CBD5E1] text-[#336699] font-bold text-[10px] uppercase tracking-wider px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors shadow-sm"
                      >
                        Ver Perfil
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DO PERFIL COMPLETO */}
      {modalOpen.open && modalOpen.free && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#0C1D4D] p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">Ficha Técnica do Freelancer</h3>
              <button onClick={() => setModalOpen({ open: false, free: null })} className="text-white hover:text-red-400 text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              
              <div className="flex justify-between items-start border-b border-[#E2E8F0] pb-4">
                <div>
                  <h2 className="text-2xl font-black text-[#0C1D4D]">{modalOpen.free.nome}</h2>
                  <p className="text-sm font-semibold text-[#64748B]">📱 WhatsApp: <a href={`https://wa.me/${modalOpen.free.telefone.replace(/\D/g,'')}`} target="_blank" className="text-[#336699] hover:underline">{modalOpen.free.telefone}</a></p>
                </div>
                <div className="text-right bg-[#F8FAFC] border border-[#E2E8F0] p-3 rounded-xl">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-[#64748B]">CHAVE PIX ({modalOpen.free.pix_tipo})</span>
                  <strong className="text-base text-[#16A34A]">{modalOpen.free.pix_chave}</strong>
                </div>
              </div>

              <div>
                <h4 className="text-[10px] font-black uppercase text-[#64748B] tracking-widest mb-3">Avaliação Técnica do Profissional</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Painel de LED</span>
                    <strong className={`text-xs ${modalOpen.free.nivel_led === 'Não trabalho com o Item' ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_led}</strong>
                  </div>
                  <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Televisores / Video Wall</span>
                    <strong className={`text-xs ${modalOpen.free.nivel_tv === 'Não trabalho com o Item' ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_tv}</strong>
                  </div>
                  <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Áudio</span>
                    <strong className={`text-xs ${modalOpen.free.nivel_audio === 'Não trabalho com o Item' ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_audio}</strong>
                  </div>
                  <div className="bg-[#F8FAFC] p-3 border border-[#E2E8F0] rounded-lg">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">Iluminação</span>
                    <strong className={`text-xs ${modalOpen.free.nivel_luz === 'Não trabalho com o Item' ? 'text-[#94A3B8]' : 'text-[#0C1D4D]'}`}>{modalOpen.free.nivel_luz}</strong>
                  </div>
                </div>
              </div>

              {modalOpen.free.comentarios && (
                <div>
                  <h4 className="text-[10px] font-black uppercase text-[#64748B] tracking-widest mb-2">Comentários e Experiência</h4>
                  <p className="bg-[#F0F4F8] p-4 rounded-xl text-sm text-[#0A2A4A] font-medium leading-relaxed whitespace-pre-line">
                    {modalOpen.free.comentarios}
                  </p>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  );
}