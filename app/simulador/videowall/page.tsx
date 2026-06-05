"use client";

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../../imgs/logo.png'; // Ajuste o caminho conforme sua estrutura

// URL da API original do Google Apps Script
const API_URL = "https://script.google.com/macros/s/AKfycbxQgcj0R6MMX0Nw9BQyOECMj8Lr477bpWFc13cnDRfHXM50e4SvCUtUYhOhbH2bdyE7mg/exec";

export default function SimuladorVideoWall() {
  // Estados de Dados da API
  const [db, setDb] = useState({ led: {}, inventory: {}, sound: {}, light: {}, truss: {}, acc: {} });
  const [loading, setLoading] = useState(true);

  // Estados de Interface e Controle
  const [equipType, setEquipType] = useState('led');
  const [projectList, setProjectList] = useState([]);
  const [isProjectView, setIsProjectView] = useState(false);

  // Estados Específicos (Exemplo para LED)
  const [ledConfig, setLedConfig] = useState({ width: 1, height: 1, shape: 'reto', pitch: '' });

  // Efeito para carregar os dados ao montar o componente
  useEffect(() => {
    async function fetchDatabase() {
      try {
        const response = await fetch(API_URL);
        const data = await response.json();
        setDb({
          led: data.ledData || {},
          inventory: data.inventoryData || {},
          sound: data.soundData || {},
          light: data.lightData || {},
          truss: data.trussData || {},
          acc: data.accData || {}
        });
        setLoading(false);
      } catch (error) {
        console.error("Erro ao carregar banco de dados", error);
        setLoading(false);
      }
    }
    fetchDatabase();
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 bg-[#F0F4F8] text-[#0A2A4A] min-h-screen font-sans">
      
      {/* SIDEBAR DE CONTROLES */}
      <aside className="bg-white p-5 rounded-xl shadow-sm w-full lg:w-80 flex-shrink-0 flex flex-col border border-[#E2E8F0] overflow-y-auto">
        <div className="text-center mb-4 pb-4 border-b border-[#E2E8F0]">
          <Link href="/simulador">
             <Image src={logoColorido} alt="Rentech Logo" width={150} height={45} className="mx-auto" />
          </Link>
        </div>

        <div className="bg-[#F8FAFC] p-3 rounded-lg mb-4 border-2 border-[#00A8E8]">
          <label className="block text-[#0A2A4A] font-bold mb-2">Setor do Projeto</label>
          <select 
            className="w-full p-2 border border-[#E2E8F0] rounded-md text-sm focus:outline-none focus:border-[#00A8E8]"
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
          <div className="flex flex-col gap-3">
            <h3 className="font-bold text-sm">Configuração do Painel</h3>
            
            <label className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Largura (Metros)</label>
            <input type="number" step="0.5" min="0.5" value={ledConfig.width} onChange={(e) => setLedConfig({...ledConfig, width: parseFloat(e.target.value)})} className="w-full p-2 border border-[#E2E8F0] rounded-md text-sm" />
            
            <label className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Altura (Metros)</label>
            <input type="number" step="0.5" min="0.5" value={ledConfig.height} onChange={(e) => setLedConfig({...ledConfig, height: parseFloat(e.target.value)})} className="w-full p-2 border border-[#E2E8F0] rounded-md text-sm" />
            
            <label className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Formato</label>
            <select value={ledConfig.shape} onChange={(e) => setLedConfig({...ledConfig, shape: e.target.value})} className="w-full p-2 border border-[#E2E8F0] rounded-md text-sm">
              <option value="reto">Reto Padrão</option>
              <option value="curvo">Curvo (Côncavo)</option>
              <option value="quina">Quina (90 Graus)</option>
            </select>
          </div>
        )}

        {/* Dados do Cliente */}
        <div className="mt-4 pt-4 border-t border-dashed border-[#E2E8F0] flex flex-col gap-3">
          <label className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">Evento (Opcional)</label>
          <input type="text" placeholder="Ex: Congresso TI" className="w-full p-2 border border-[#E2E8F0] rounded-md text-sm" />
        </div>

        {/* Botões de Ação */}
        <div className="mt-auto pt-4 flex flex-col gap-2">
          <button className="bg-[#10B981] text-white p-3 font-bold rounded-lg hover:bg-[#059669] transition-all shadow-md disabled:opacity-50" disabled={loading}>
            ➕ Adicionar ao Projeto
          </button>
          <button className="bg-[#00A8E8] text-white p-3 font-bold rounded-lg hover:bg-[#0A2A4A] transition-all shadow-md">
            🖨️ Imprimir Tela
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <main className="flex-grow flex flex-col gap-4 relative">
        
        {/* Barra Superior */}
        <div className="flex justify-end">
          <button 
            onClick={() => setIsProjectView(!isProjectView)}
            className="bg-[#0A2A4A] text-white px-5 py-2 flex gap-2 items-center rounded-lg font-bold hover:bg-[#00A8E8] transition-colors"
          >
            {isProjectView ? '⚙️ Voltar ao Simulador' : '📋 Ver Projeto'} 
            <span className="bg-[#EF4444] text-white px-2 py-0.5 rounded-full text-xs">{projectList.length}</span>
          </button>
        </div>

        {/* Container de Visualização */}
        {!isProjectView ? (
          <div className="flex flex-col gap-4 flex-grow">
            <h3 className="font-bold text-lg text-[#0A2A4A]">Visão Geral do Equipamento</h3>
            
            <div className="flex-grow bg-white border border-[#E2E8F0] rounded-xl flex items-center justify-center relative overflow-hidden">
              {loading && (
                <div className="absolute inset-0 bg-white/90 z-50 flex flex-col items-center justify-center rounded-xl">
                  <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#00A8E8] rounded-full animate-spin mb-4"></div>
                  <strong className="text-[#0A2A4A]">Conectando ao Banco de Dados...</strong>
                </div>
              )}
              
              {/* Renderização Visual do LED - Placeholder onde a lógica matemática entrará */}
              {!loading && equipType === 'led' && (
                <div className="w-64 h-48 bg-[#111] border-2 border-gray-700 shadow-2xl flex items-center justify-center text-gray-500">
                  [{ledConfig.width}m x {ledConfig.height}m]
                </div>
              )}
            </div>

            {/* Painel de Informações */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
              <div className="bg-white p-3 rounded-lg border-t-4 border-[#0A2A4A] shadow-sm">
                <span className="block text-xs text-[#64748B] uppercase font-semibold">Dimensão</span>
                <strong className="block text-lg text-[#0A2A4A]">{ledConfig.width}m x {ledConfig.height}m</strong>
              </div>
              <div className="bg-white p-3 rounded-lg border-t-4 border-[#00A8E8] shadow-sm">
                <span className="block text-xs text-[#64748B] uppercase font-semibold">Peso Bruto</span>
                <strong className="block text-lg text-[#0A2A4A]">0.0 kg</strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-xl border border-[#E2E8F0] flex-grow flex flex-col">
            <h2 className="text-xl font-bold mb-4 border-b pb-2">Lista de Equipamentos</h2>
            
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F0F4F8] text-[#64748B] text-sm uppercase">
                  <th className="p-3 border-b">Qtd</th>
                  <th className="p-3 border-b">Equipamento</th>
                  <th className="p-3 border-b">Peso</th>
                </tr>
              </thead>
              <tbody>
                {projectList.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center p-8 text-[#64748B]">Nenhum equipamento adicionado.</td>
                  </tr>
                ) : (
                  // Mapeamento real dos itens entraria aqui
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