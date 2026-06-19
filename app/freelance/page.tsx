"use client";

import { useState } from 'react';
import Image from 'next/image';
import { supabase } from '../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import logoColorido from '../imgs/logo.png'; // Verifique o caminho da logo

export default function CadastroFreelance() {
  const [loading, setLoading] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erroMsg, setErroMsg] = useState(''); // Estado para capturar o aviso de duplicidade
  
  const [formData, setFormData] = useState({
    nome: '', cpf: '', data_nascimento: '', email: '', telefone: '', endereco: '',
    pix_chave: '', pix_tipo: 'CPF',
    nivel_led: 'Não trabalho com o Item',
    nivel_videowall: 'Não trabalho com o Item',
    nivel_tv: 'Não trabalho com o Item',
    nivel_audio: 'Não trabalho com o Item',
    nivel_luz: 'Não trabalho com o Item',
    comentarios: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErroMsg(''); // Limpa erros anteriores antes de tentar novamente

    const { error } = await supabase.from('freelancers').insert([formData]);

    if (!error) {
      setSucesso(true);
      window.scrollTo(0, 0);
    } else {
      // Verifica se o erro foi causado pela restrição de CPF ou Celular Único (Código 23505 no Postgres)
      if (error.code === '23505' || error.message.includes('duplicate') || error.message.includes('unique')) {
        setErroMsg("⚠️ Este CPF ou Número de WhatsApp já está cadastrado em nossa base.");
      } else {
        setErroMsg("❌ Houve um erro inesperado ao enviar. Verifique sua conexão e tente novamente.");
      }
    }
    setLoading(false);
  };

  if (sucesso) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-10 rounded-2xl shadow-xl max-w-md w-full border-t-8 border-[#16A34A]">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Cadastro Recebido!</h1>
          <p className="text-[#64748B] font-medium mb-8">
            Suas informações foram enviadas para o banco de talentos da Rentech Locadora com sucesso.
          </p>
          <button onClick={() => window.location.reload()} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold text-xs uppercase tracking-wider hover:bg-[#284B8C] transition-colors w-full">
            Fazer Novo Cadastro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pb-12">
      <Analytics />
      
      {/* Header */}
      <div className="bg-[#0C1D4D] text-center py-10 px-4 rounded-b-[40px] shadow-lg mb-8">
        <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-wider mb-2">
          Banco de Talentos
        </h1>
        <p className="text-[#94A3B8] text-sm max-w-lg mx-auto font-medium">
          Faça parte da nossa equipe de freelancers. Preencha seus dados técnicos e informações para pagamento de diárias (PIX).
        </p>
      </div>

      <div className="container mx-auto px-4 max-w-3xl">
        <form onSubmit={handleSubmit} className="bg-white p-6 md:p-10 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-8">
          
          {/* Dados Pessoais */}
          <div>
            <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">👤 Dados Pessoais</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Nome Completo</label>
                <input required type="text" name="nome" value={formData.nome} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">CPF</label>
                <input required type="text" name="cpf" value={formData.cpf} onChange={handleChange} placeholder="Apenas números" className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Data de Nascimento</label>
                <input required type="date" name="data_nascimento" value={formData.data_nascimento} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none text-[#64748B]" />
              </div>
            </div>
          </div>

          {/* Contato e Endereço */}
          <div>
            <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">📍 Contato e Endereço</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">WhatsApp</label>
                <input required type="tel" name="telefone" value={formData.telefone} onChange={handleChange} placeholder="(11) 90000-0000" className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">E-mail</label>
                <input required type="email" name="email" value={formData.email} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Endereço Completo</label>
                <input required type="text" name="endereco" value={formData.endereco} onChange={handleChange} placeholder="Rua, Número, Bairro, Cidade" className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
              </div>
            </div>
          </div>

          {/* Dados Bancários */}
          <div>
            <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">💳 Dados para Pagamento (PIX)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Tipo de Chave</label>
                <select name="pix_tipo" value={formData.pix_tipo} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-bold text-[#0C1D4D] focus:border-[#336699] outline-none cursor-pointer">
                  <option value="CPF">CPF</option>
                  <option value="Celular">Celular</option>
                  <option value="E-mail">E-mail</option>
                  <option value="Chave Aleatória">Chave Aleatória</option>
                  <option value="CNPJ">CNPJ</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Sua Chave PIX</label>
                <input required type="text" name="pix_chave" value={formData.pix_chave} onChange={handleChange} className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none" />
              </div>
            </div>
            <p className="text-[10px] text-red-500 font-bold mt-2">* Não nos responsabilizamos por dados de PIX informados incorretamente.</p>
          </div>

          {/* Conhecimento Técnico */}
          <div>
            <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">⚙️ Nível de Conhecimento Técnico</h2>
            <p className="text-xs text-[#64748B] mb-4">Seja sincero na sua avaliação para que possamos escalar você para os eventos corretos.</p>
            
            <div className="space-y-4">
              {[
                { name: 'nivel_led', label: 'Painel de LED' },
                { name: 'nivel_videowall', label: 'Video Wall' },
                { name: 'nivel_tv', label: 'Televisores' },
                { name: 'nivel_audio', label: 'Sonorização' },
                { name: 'nivel_luz', label: 'Iluminação' },
              ].map((item) => (
                <div key={item.name} className="flex flex-col md:flex-row md:items-center justify-between bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
                  <label className="text-sm font-bold text-[#0C1D4D] uppercase tracking-wider mb-2 md:mb-0">{item.label}</label>
                  <select name={item.name} value={(formData as any)[item.name]} onChange={handleChange} className="w-full md:w-64 p-2 bg-white border border-[#CBD5E1] rounded-lg text-xs font-semibold text-[#0C1D4D] focus:border-[#336699] outline-none cursor-pointer">
                    <option value="Não trabalho com o Item">Não trabalho com o Item</option>
                    <option value="Ajudante">Ajudante / Carregador</option>
                    <option value="Instalador">Instalador Estrutural</option>
                    <option value="Instala e Configura">Instala e Configura</option>
                    <option value="Instalador, Configura e Opera">Instala, Configura e Opera</option>
                    <option value="Coordenador">Coordenador de Equipe</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Experiência / Comentários */}
          <div>
            <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm mb-4 border-b border-[#E2E8F0] pb-2">📝 Resumo Profissional</h2>
            <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1">Fale um pouco sobre você (Opcional)</label>
            <textarea name="comentarios" rows={4} value={formData.comentarios} onChange={handleChange} placeholder="Descreva sua experiência, empresas que já atendeu, softwares que domina (ex: NovaStar, vMix, MA, etc)..." className="w-full p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl text-sm font-semibold focus:border-[#336699] outline-none resize-none"></textarea>
          </div>

          {/* CAIXA DE ERRO SE HOUVER DUPLICIDADE */}
          {erroMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-center font-bold text-sm shadow-sm mt-4">
              {erroMsg}
            </div>
          )}

          <button type="submit" disabled={loading} className="w-full bg-[#336699] hover:bg-[#284B8C] text-white p-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-md disabled:opacity-50 mt-6">
            {loading ? 'Enviando Cadastro...' : 'Enviar Cadastro Rentech'}
          </button>

        </form>
      </div>
    </div>
  );
}