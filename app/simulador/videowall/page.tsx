"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../../imgs/logo.png';

// Importação hipotética do seu cliente Supabase (geralmente criado em lib/supabase.ts)
// import { supabase } from '../../lib/supabase';

export default function SimuladorVideoWall() {
  // Estados de Dados do Supabase
  const [db, setDb] = useState({ led: [], tv: [], sound: [], light: [], truss: [], acc: [] });
  const [loading, setLoading] = useState(true);

  // Estados de Interface e Controle
  const [equipType, setEquipType] = useState('led');
  const [projectList, setProjectList] = useState([]);
  const [isProjectView, setIsProjectView] = useState(false);

  // Estados Específicos (Exemplo para LED)
  const [ledConfig, setLedConfig] = useState({ width: 1, height: 1, shape: 'reto', pitch: '' });

  // Efeito para carregar os dados do Supabase
  useEffect(() => {
    async function fetchDatabase() {
      try {
        setLoading(true);
        
        /* 
          EXEMPLO DA LÓGICA SUPABASE:
          Aqui você fará a chamada para a sua tabela real.
          
          const { data: equipamentos, error } = await supabase
            .from('equipamentos')
            .select('*')
            .eq('ativo', true);

          Se você separar por categorias no banco, pode agrupar os dados aqui no frontend
          ou já trazer agrupado via Views do PostgreSQL.
        */

        // Simulando o tempo de resposta do Supabase para o layout não quebrar até você conectar
        setTimeout(() => {
          setDb({
            led: [], // Receberá os dados do Supabase: equipamentos.filter(e => e.categoria === 'led')
            tv: [],
            sound: [],
            light: [],
            truss: [],
            acc: []
          });
          setLoading(false);
        }, 800);

      } catch (error) {
        console.error("Erro ao carregar dados do Supabase:", error);
        setLoading(false);
      }
    }
    fetchDatabase();
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 bg-[#000000] text-[#B3B3B3] min-h-screen font-sans">
      
      {/* SIDEBAR DE CONTROLES */}
      <aside className="bg-[#0C1D4D]/20 p-5 rounded-xl shadow-lg w-full lg:w-80 flex-shrink-0 flex flex-col border border-[#284B8C]/30 overflow-y-auto backdrop-blur-sm">
        <div className="text-center mb-6 pb-6 border-b border-[#284B8C]/30">
          <Link href="/simulador">
             <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} className="mx-auto hover:scale-105 transition-transform" />
          </Link>
        </div>

        <div className="bg-[#0C1D4D]/50 p-4 rounded-lg mb-6 border-l-4 border-[#336699]">
          <label className="block text-white font-black mb-3 text-sm tracking-wide uppercase">Setor do Projeto</label>
          <select 
            className="w-full p-2.5 bg-black/50 border border-[#284B8C]/50 rounded-md text-sm text-white focus:outline-none focus:border-[#336699] focus:ring-1 focus:ring-[#336699] transition-all"
            value={equipType}
            onChange={(e) => setEquipType(e.target.value)}
          >
            <option value="led">Painel de Led Modular</option>
            <option value="tv">Televisores e Monitores</option>
            <option value="sound">Sistemas de Som</option>
            <option value="light">Sistemas de Luz</option>
            <option value="truss">Estrutura</option>
            <option value="acc">Acessórios/Periféricos</option>
          </select>
        </div>

        {/* Controles Condicionais por Setor */}
        {equipType === 'led' && (
          <div className="flex flex-col gap-4">
            <h3 className="font-black text-sm text-white uppercase tracking-wider mb-2">Configuração do Painel</h3>
            
            <div>
              <label className="text-xs font-bold text-[#999999] uppercase tracking-wider mb-1 block">Largura (Metros)</label>
              <input type="number" step="0.5" min="0.5" value={ledConfig.width} onChange={(e) => setLedConfig({...ledConfig, width: parseFloat(e.target.value)})} className="w-full p-2.5 bg-black/50 border border-[#284B8C]/30 rounded-md text-sm text-white focus:border-[#336699] transition-colors" />
            </div>
            
            <div>
              <label className="text-xs font-bold text-[#999999] uppercase tracking-wider mb-1 block">Altura (Metros)</label>
              <input type="number" step="0.5" min="0.5" value={ledConfig.height} onChange={(e) => setLedConfig({...ledConfig, height: parseFloat(e.target.value)})} className="w-full p-2.5 bg-black/50 border border-[#284B8C]/30 rounded-md text-sm text-white focus:border-[#336699] transition-colors" />
            </div>
            
            <div>
              <label className="text-xs font-bold text-[#999999] uppercase tracking-wider mb-1 block">Formato</label>
              <select value={ledConfig.shape} onChange={(e) => setLedConfig({...ledConfig, shape: e.target.value})} className="w-full p-2.5 bg-black/50 border border-[#284B8C]/30 rounded-md text-sm text-white focus:border-[#336699] transition-colors">
                <option value="reto">Reto Padrão</option>
                <option value="curvo">Curvo (Côncavo)</option>
                <option value="quina">Quina (90 Graus)</option>
              </select>
            </div>
          </div>
        )}

        {/* Botões de Ação */}
        <div className="mt-auto pt-8 flex flex-col gap-3">
          <button className="bg-green-600 text-white p-3.5 font-black uppercase tracking-wide text-sm rounded-lg hover:bg-green-500 hover:shadow-[0_0_15px_rgba(22,163,74,0.4)] transition-all disabled:opacity-50" disabled={loading}>
            Adicionar ao Projeto
          </button>
          <button className="bg-[#284B8C] text-white p-3.5 font-black uppercase tracking-wide text-sm rounded-lg hover:bg-[#336699] transition-all">
            Imprimir Tela
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <main className="flex-grow flex flex-col gap-6 relative">
        
        {/* Barra Superior */}
        <div className="flex justify-end">
          <button 
            onClick={() => setIsProjectView(!isProjectView)}
            className="bg-[#284B8C] text-white px-6 py-2.5 flex gap-3 items-center rounded-lg font-black uppercase text-sm hover:bg-[#336699] transition-colors"
          >
            {isProjectView ? 'Voltar ao Simulador' : 'Ver Projeto'} 
            <span className="bg-white text-[#284B8C] px-2.5 py-0.5 rounded-md text-xs font-black">{projectList.length}</span>
          </button>
        </div>

        {/* Container de Visualização */}
        {!isProjectView ? (
          <div className="flex flex-col gap-4 flex-grow">
            <h3 className="font-black text-2xl text-white tracking-tight">Visão Geral do Equipamento</h3>
            
            <div className="flex-grow bg-[#0C1D4D]/10 border border-[#284B8C]/30 rounded-xl flex items-center justify-center relative overflow-hidden backdrop-blur-sm">
              {loading && (
                <div className="absolute inset-0 bg-[#000000]/80 z-50 flex flex-col items-center justify-center rounded-xl backdrop-blur-md">
                  <div className="w-12 h-12 border-4 border-[#284B8C] border-t-[#336699] rounded-full animate-spin mb-4"></div>
                  <strong className="text-white font-bold tracking-widest uppercase text-sm">Consultando Supabase...</strong>
                </div>
              )}
              
              {!loading && equipType === 'led' && (
                <div className="w-64 h-48 bg-black border border-[#336699] shadow-[0_0_30px_rgba(51,102,153,0.2)] flex items-center justify-center text-[#666666] font-bold">
                  [{ledConfig.width}m x {ledConfig.height}m]
                </div>
              )}
            </div>

            {/* Painel de Informações */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-shrink-0">
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-[#336699]">
                <span className="block text-xs text-[#999999] uppercase font-bold tracking-wider mb-1">Dimensão</span>
                <strong className="block text-xl text-white font-black">{ledConfig.width}m x {ledConfig.height}m</strong>
              </div>
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-[#336699]">
                <span className="block text-xs text-[#999999] uppercase font-bold tracking-wider mb-1">Peso Bruto</span>
                <strong className="block text-xl text-white font-black">0.0 kg</strong>
              </div>
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-[#336699]">
                <span className="block text-xs text-[#999999] uppercase font-bold tracking-wider mb-1">Consumo</span>
                <strong className="block text-xl text-white font-black">0 W</strong>
              </div>
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-green-500">
                <span className="block text-xs text-[#999999] uppercase font-bold tracking-wider mb-1">Gerador (KVA)</span>
                <strong className="block text-xl text-green-400 font-black">0.00</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#0C1D4D]/20 p-8 rounded-xl border border-[#284B8C]/30 flex-grow flex flex-col backdrop-blur-sm">
            <h2 className="text-2xl font-black mb-6 text-white border-b border-[#284B8C]/50 pb-4">Lista de Equipamentos</h2>
            
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[#999999] text-xs uppercase tracking-wider font-bold border-b border-[#284B8C]/50">
                  <th className="pb-3">Qtd</th>
                  <th className="pb-3">Equipamento</th>
                  <th className="pb-3">Peso</th>
                  <th className="pb-3">Consumo</th>
                </tr>
              </thead>
              <tbody>
                {projectList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-[#666666] font-medium">Nenhum equipamento adicionado ao projeto.</td>
                  </tr>
                ) : (
                  null
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

    </div>
  );
}