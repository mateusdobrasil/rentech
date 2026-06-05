'use client'; // Indica que este componente tem interatividade no navegador

import { useState } from 'react';

export default function Contato() {
  const [status, setStatus] = useState('');

  // Esta é a função que conectaremos ao Supabase futuramente
  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('Enviando...');
    
    // Aqui entrará o código do Supabase:
    // await supabase.from('orcamentos').insert([{ nome, telefone, evento }])
    
    setTimeout(() => {
      setStatus('Solicitação enviada com sucesso! Nossa equipe entrará em contato.');
    }, 1500);
  };

  return (
    <section id="contato" className="py-24 bg-[#0b0f19] border-t border-gray-800">
      <div className="container mx-auto px-6 grid md:grid-cols-2 gap-12">
        
        {/* Textos de Contato */}
        <div>
          <h2 className="text-3xl font-bold mb-6 text-white">Inicie seu Projeto</h2>
          <p className="text-gray-400 mb-8 leading-relaxed">
            Pronto para elevar o nível técnico do seu evento? Preencha o formulário e nossa equipe analisará suas necessidades para enviar uma proposta detalhada.
          </p>
          <div className="flex items-center text-gray-300">
            <svg className="w-6 h-6 text-blue-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>
            <span>contato@locadorarentech.com.br</span>
          </div>
        </div>

        {/* Formulário */}
        <div className="bg-gray-800 p-8 rounded-xl border border-gray-700 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Nome / Empresa</label>
                <input type="text" required className="w-full bg-gray-900 border border-gray-700 text-white p-3 rounded focus:border-blue-500 outline-none transition-colors" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">WhatsApp</label>
                <input type="text" required className="w-full bg-gray-900 border border-gray-700 text-white p-3 rounded focus:border-blue-500 outline-none transition-colors" />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Tipo de Evento</label>
                <select className="w-full bg-gray-900 border border-gray-700 text-white p-3 rounded focus:border-blue-500 outline-none transition-colors">
                  <option value="feira">Feira / Exibição</option>
                  <option value="congresso">Congresso / Palestra</option>
                  <option value="show">Plenária / Show</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Data do Evento</label>
                <input type="date" className="w-full bg-gray-900 border border-gray-700 text-gray-300 p-3 rounded focus:border-blue-500 outline-none transition-colors" />
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Detalhes do Projeto</label>
              <textarea rows="4" className="w-full bg-gray-900 border border-gray-700 text-white p-3 rounded focus:border-blue-500 outline-none transition-colors" placeholder="Ex: Tamanho da tela, local..."></textarea>
            </div>

            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded hover:bg-blue-500 transition-colors">
              Enviar Solicitação
            </button>
            
            {status && <p className="text-green-400 text-sm mt-3 text-center">{status}</p>}
          </form>
        </div>
      </div>
    </section>
  );
}