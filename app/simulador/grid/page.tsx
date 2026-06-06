"use client";

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import logoColorido from '../../../app/imgs/logo.png';
import { Analytics } from "@vercel/analytics/next";

const TAMANHO_FISICO_MOD = 0.5; // Módulo padrão de 50x50cm

export default function SimuladorGrid() {
  // Estados de Entrada e Configuração
  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');
  const [unidade, setUnidade] = useState<'mod' | 'met'>('mod');
  const [modelo, setModelo] = useState<number>(128); // Resolução do módulo
  const [inputL, setInputL] = useState<number>(10);
  const [inputH, setInputH] = useState<number>(6);

  // Estados do Grid Interativo
  const [gridConfig, setGridConfig] = useState({ cols: 10, rows: 6 });
  const [modulosAtivos, setModulosAtivos] = useState<boolean[]>([]);

  // Inicializa o Grid padrão na primeira renderização
  useEffect(() => {
    gerarGrid(10, 6);
  }, []);

  // Função para processar a criação de um novo Grid estrutural
  const processarNovoGrid = () => {
    let novasColunas = unidade === 'met' ? Math.ceil(inputL / TAMANHO_FISICO_MOD) : Math.round(inputL);
    let novasLinhas = unidade === 'met' ? Math.ceil(inputH / TAMANHO_FISICO_MOD) : Math.round(inputH);
    
    // Evita crashes por grids imensos digitados sem querer
    if (novasColunas > 100) novasColunas = 100;
    if (novasLinhas > 100) novasLinhas = 100;

    gerarGrid(novasColunas, novasLinhas);
  };

  const gerarGrid = (cols: number, rows: number) => {
    setGridConfig({ cols, rows });
    // Preenche um novo array com 'true' (todos os módulos ativos)
    setModulosAtivos(Array(cols * rows).fill(true));
  };

  // Alterna o status (ligado/desligado) de um módulo específico ao clicar
  const toggleModulo = (index: number) => {
    const novosModulos = [...modulosAtivos];
    novosModulos[index] = !novosModulos[index];
    setModulosAtivos(novosModulos);
  };

  // Cálculos matemáticos de telemetria usando useMemo para otimização
  const calculos = useMemo(() => {
    const ativos = modulosAtivos.filter(status => status === true).length;
    const larguraMetros = gridConfig.cols * TAMANHO_FISICO_MOD;
    const alturaMetros = gridConfig.rows * TAMANHO_FISICO_MOD;
    const areaAtivaM2 = ativos * (TAMANHO_FISICO_MOD * TAMANHO_FISICO_MOD);
    const resLargura = gridConfig.cols * modelo;
    const resAltura = gridConfig.rows * modelo;

    let nomePitch = 'P3';
    if (modelo === 168) nomePitch = 'P2.9';
    if (modelo === 192) nomePitch = 'P2.6';

    return {
      ativos,
      larguraMetros,
      alturaMetros,
      areaAtivaM2,
      resLargura,
      resAltura,
      nomePitch
    };
  }, [modulosAtivos, gridConfig, modelo]);

  return (
    // Visual Light Premium: pt-14 p/ a Navbar, max-h-[900px] travando a altura
    <div className="flex flex-col lg:flex-row gap-3 px-4 md:px-6 pb-4 md:pb-6 pt-4 bg-[#F0F4F8] text-[#0F172A] h-screen max-h-[800px] overflow-hidden font-sans print:bg-white print:text-black print:block print:p-0">
      <Analytics/>
      
      {/* SIDEBAR DE CONTROLES */}
      <aside className="bg-white p-3 md:p-4 rounded-2xl shadow-sm w-full lg:w-80 flex-shrink-0 flex flex-col border border-[#E2E8F0] overflow-y-auto print:hidden">
        
        <div className="bg-[#F0F4F8] p-2.5 rounded-xl mb-4 border-l-4 border-l-[#336699]">
          <h1 className="text-[10px] font-black uppercase tracking-widest text-[#0C1D4D] leading-tight">Simulador de LED <br/><span className="text-[#336699]">Matriz & Grid</span></h1>
        </div>

        <div className="space-y-4 flex-grow">
          
          {/* Dados do Cliente */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Projeto/Evento</label>
              <input type="text" placeholder="Ex: Stand SP" className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Cliente</label>
              <input type="text" placeholder="Ex: Rentech" className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
          </div>

          <div className="border-t border-dashed border-[#CBD5E1]"></div>

          {/* Configurações Matemáticas */}
          <div className="space-y-3">
            <div className="flex gap-1 bg-[#F8FAFC] p-1 rounded-lg border border-[#CBD5E1]">
              <button 
                onClick={() => setUnidade('mod')} 
                className={`flex-1 py-1.5 rounded-md text-[9px] font-bold uppercase transition-all ${unidade === 'mod' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#E2E8F0]'}`}
              >
                Em Módulos
              </button>
              <button 
                onClick={() => setUnidade('met')} 
                className={`flex-1 py-1.5 rounded-md text-[9px] font-bold uppercase transition-all ${unidade === 'met' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#E2E8F0]'}`}
              >
                Em Metros
              </button>
            </div>

            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Modelo da Placa (Pitch)</label>
              <select className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-bold focus:border-[#336699] outline-none cursor-pointer" value={modelo} onChange={(e) => setModelo(parseInt(e.target.value))}>
                <option value="128">P3 (128x128px)</option>
                <option value="168">P2.9 (168x168px)</option>
                <option value="192">P2.6 (192x192px)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">{unidade === 'mod' ? 'Largura (Módulos)' : 'Largura (m)'}</label>
                <input type="number" min="0.5" step="0.5" className="w-full p-2 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={inputL} onChange={(e) => setInputL(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">{unidade === 'mod' ? 'Altura (Módulos)' : 'Altura (m)'}</label>
                <input type="number" min="0.5" step="0.5" className="w-full p-2 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={inputH} onChange={(e) => setInputH(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 space-y-2 pb-2">
          <button onClick={processarNovoGrid} className="w-full bg-[#16A34A] text-white p-3 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#15803D] transition-all shadow-md hover:shadow-lg disabled:opacity-50">
            Gerar Matriz Grid
          </button>
          <button onClick={() => window.print()} className="w-full border-2 border-[#E2E8F0] text-[#64748B] p-2.5 rounded-xl font-black uppercase text-[10px] tracking-wider hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors">
            🖨️ Imprimir Mapa
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / WORKSPACE - Rolagem Independente */}
      <main className="flex-grow flex flex-col gap-3 relative print:bg-white print:p-8 overflow-y-auto pr-1">
        
        {/* Header de Impressão (Visível apenas ao imprimir) */}
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-6 flex-shrink-0">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Mapa Estrutural de Montagem</h2>
            <p className="text-sm font-bold text-gray-600 mt-1">Data: {new Date().toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        {/* Informações do Projeto (Impressão) */}
        <div className="hidden print:grid grid-cols-2 gap-4 mb-4 border-b border-gray-300 pb-4 flex-shrink-0">
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Projeto / Evento:</span>
            <strong className="text-base text-black">{projeto || '---'}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Cliente:</span>
            <strong className="text-base text-black">{cliente || '---'}</strong>
          </div>
        </div>

        {/* Métrica de Resultados Totais */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 flex-shrink-0 print:gap-2">
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-3 rounded-xl shadow-sm print:bg-gray-100 print:border print:border-t-4 print:border-gray-800">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Dimensão Física Bruta</span>
            <strong className="block text-xl text-[#0C1D4D] font-black print:text-black">{calculos.larguraMetros.toFixed(2)}m x {calculos.alturaMetros.toFixed(2)}m</strong>
            <span className="text-[10px] font-bold text-[#336699] print:text-gray-500">{gridConfig.cols} x {gridConfig.rows} módulos</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-3 rounded-xl shadow-sm print:bg-gray-100 print:border print:border-t-4 print:border-gray-800">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Resolução Final</span>
            <strong className="block text-xl text-[#0C1D4D] font-black print:text-black">{calculos.resLargura} x {calculos.resAltura} px</strong>
            <span className="text-[10px] font-bold text-[#336699] print:text-gray-500">Modelo {calculos.nomePitch}</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#16A34A] p-3 rounded-xl shadow-sm print:bg-gray-100 print:border print:border-t-4 print:border-gray-800">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Área LED Útil Montada</span>
            <strong className="block text-xl text-[#16A34A] font-black print:text-black">{calculos.areaAtivaM2.toFixed(2)} m²</strong>
            <span className="text-[10px] font-bold text-[#16A34A] print:text-gray-500">{calculos.ativos} gabinetes ativos</span>
          </div>
        </div>

        <div className="text-center print:hidden flex-shrink-0 mt-1">
            <p className="text-[10px] text-[#64748B] font-bold uppercase tracking-widest">💡 Clique nos quadradinhos abaixo para ligar/desligar painéis.</p>
        </div>

        {/* Workspace do Grid Interativo - Auto Scaling Ativado */}
        <div className="flex-grow bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-4 relative overflow-hidden shadow-inner flex items-center justify-center print:bg-white print:border-none print:shadow-none print:p-0">
          
          <div 
            className="grid bg-white border border-[#CBD5E1] shadow-sm p-1 md:p-2 rounded-lg print:bg-white print:border-none print:inline-grid"
            style={{ 
              gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))`,
              // O GAP diminui se a matriz for gigante para não criar "buracos" pretos
              gap: gridConfig.cols > 50 ? '0px' : gridConfig.cols > 25 ? '1px' : '2px',
              // A MÁGICA ACONTECE AQUI: O CSS calcula o espaço em tela livre (~300px descontados da altura) 
              // e multiplica pela proporção para a matriz JAMAIS quebrar ou precisar de barra de rolagem.
              width: `min(100%, calc((100vh - 300px) * ${gridConfig.cols / gridConfig.rows}), ${gridConfig.cols * 45}px)`
            }}
          >
            {modulosAtivos.map((ativo, index) => (
              <div 
                key={index}
                onClick={() => toggleModulo(index)}
                className={`
                  w-full aspect-square cursor-pointer transition-colors duration-100 rounded-[1px] md:rounded-sm
                  print:border print:border-gray-400 print:rounded-none
                  ${ativo 
                      ? 'bg-[#336699] hover:bg-[#284B8C] shadow-sm print:bg-gray-800 print:shadow-none' 
                      : 'bg-[#F1F5F9] border border-dashed border-[#CBD5E1] hover:bg-[#E2E8F0] print:border-none print:bg-transparent print:opacity-0'
                  }
                `}
                title={`Módulo ${index + 1}`}
              />
            ))}
          </div>

        </div>

      </main>
    </div>
  );
}