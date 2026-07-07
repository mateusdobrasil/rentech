"use client";

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import logoColorido from '../../../app/imgs/logo.png';
import { Analytics } from "@vercel/analytics/next";

const TAMANHO_FISICO_MOD = 0.5; // Módulo padrão de 50x50cm
const PESO_MEDIO_MODULO_KG = 8; // Média de peso por gabinete 50x50
const CONSUMO_MAX_WATT_M2 = 500; // Máximo aproximado por m²
const CONSUMO_MEDIO_WATT_M2 = 400; // Consumo médio/típico por m²

export default function SimuladorGrid() {
  // 1. Dados do Projeto
  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');
  
  // 2. Configurações Estruturais
  const [unidade, setUnidade] = useState<'mod' | 'met'>('mod');
  const [modelo, setModelo] = useState<number>(128); // Resolução (Pitch)
  const [inputL, setInputL] = useState<number>(10);
  const [inputH, setInputH] = useState<number>(6);

  // 3. Estados do Grid Interativo
  const [gridConfig, setGridConfig] = useState({ cols: 10, rows: 6 });
  const [modulosAtivos, setModulosAtivos] = useState<boolean[]>([]);
  
  // Controle de Arraste (Drag-to-Draw)
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState(true); // true = ligando, false = desligando

  // Inicializa o Grid na primeira renderização
  useEffect(() => {
    gerarGrid(10, 6);
    
    // Finaliza o arraste mesmo se o rato soltar fora do grid
    const handleMouseUpGlobal = () => setIsDragging(false);
    window.addEventListener('mouseup', handleMouseUpGlobal);
    return () => window.removeEventListener('mouseup', handleMouseUpGlobal);
  }, []);

  const processarNovoGrid = () => {
    let novasColunas = unidade === 'met' ? Math.ceil(inputL / TAMANHO_FISICO_MOD) : Math.round(inputL);
    let novasLinhas = unidade === 'met' ? Math.ceil(inputH / TAMANHO_FISICO_MOD) : Math.round(inputH);
    
    if (novasColunas > 150) novasColunas = 150; // Limite de segurança renderização
    if (novasLinhas > 150) novasLinhas = 150;

    gerarGrid(novasColunas, novasLinhas);
  };

  const gerarGrid = (cols: number, rows: number) => {
    setGridConfig({ cols, rows });
    setModulosAtivos(Array(cols * rows).fill(true));
  };

  // ============================================================================
  // INTERAÇÕES COM O GRID (CLICK & DRAG)
  // ============================================================================
  const handleMouseDown = (index: number) => {
    setIsDragging(true);
    const novoStatus = !modulosAtivos[index];
    setDragMode(novoStatus); // O primeiro clique dita se vamos "pintar" ou "apagar"
    alterarModulo(index, novoStatus);
  };

  const handleMouseEnter = (index: number) => {
    if (isDragging) alterarModulo(index, dragMode);
  };

  const alterarModulo = (index: number, status: boolean) => {
    setModulosAtivos(prev => {
      const novos = [...prev];
      novos[index] = status;
      return novos;
    });
  };

  // Ações em Lote
  const setTodos = (status: boolean) => setModulosAtivos(Array(gridConfig.cols * gridConfig.rows).fill(status));
  const inverterSelecao = () => setModulosAtivos(prev => prev.map(s => !s));

  // ============================================================================
  // TELEMETRIA DE ENGENHARIA (UseMemo)
  // ============================================================================
  const calculos = useMemo(() => {
    const ativos = modulosAtivos.filter(status => status === true).length;
    const larguraMetros = gridConfig.cols * TAMANHO_FISICO_MOD;
    const alturaMetros = gridConfig.rows * TAMANHO_FISICO_MOD;
    const areaAtivaM2 = ativos * (TAMANHO_FISICO_MOD * TAMANHO_FISICO_MOD);
    const resLargura = gridConfig.cols * modelo;
    const resAltura = gridConfig.rows * modelo;

    let nomePitch = 'P3.9 / P4';
    if (modelo === 128) nomePitch = 'P3.9';
    if (modelo === 168) nomePitch = 'P2.9';
    if (modelo === 192) nomePitch = 'P2.6';

    const pesoTotal = ativos * PESO_MEDIO_MODULO_KG;
    const consumoMaxW = areaAtivaM2 * CONSUMO_MAX_WATT_M2;
    const consumoMedW = areaAtivaM2 * CONSUMO_MEDIO_WATT_M2;

    return { ativos, larguraMetros, alturaMetros, areaAtivaM2, resLargura, resAltura, nomePitch, pesoTotal, consumoMaxW, consumoMedW };
  }, [modulosAtivos, gridConfig, modelo]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 px-4 md:px-8 py-6 bg-[#F0F4F8] text-[#0F172A] min-h-screen font-sans print:bg-white print:text-black print:block print:p-0">
      <Analytics/>
      
      {/* SIDEBAR DE CONTROLES */}
      <aside className="w-full lg:w-[400px] flex-shrink-0 flex flex-col gap-4 print:hidden">
        
        {/* Cabeçalho */}
        <div className="bg-[#0C1D4D] p-5 rounded-2xl shadow-md text-white">
          <h1 className="text-xl font-black uppercase tracking-widest leading-tight">Engenharia LED</h1>
          <p className="text-blue-300 text-xs mt-1">Simulador de Matriz e Grid (50x50)</p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-5">
          
          {/* Seção 1 */}
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">1. Dados do Projeto</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Projeto / Evento</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold uppercase focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} /></div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Cliente</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
            </div>
          </div>

          {/* Seção 2 */}
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">2. Equipamento e Medidas</h3>
            
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Modelo da Placa (Resolução por 50cm)</label>
                <select className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-[#0C1D4D] font-bold focus:border-[#336699] outline-none cursor-pointer" value={modelo} onChange={(e) => setModelo(parseInt(e.target.value))}>
                  <option value="128">Pitch 3.9 (128x128 px)</option>
                  <option value="168">Pitch 2.9 (168x168 px)</option>
                  <option value="192">Pitch 2.6 (192x192 px)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Unidade de Cálculo</label>
                <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg">
                  <button onClick={() => setUnidade('mod')} className={`py-1.5 text-[10px] font-black uppercase rounded ${unidade === 'mod' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Qtd. Módulos</button>
                  <button onClick={() => setUnidade('met')} className={`py-1.5 text-[10px] font-black uppercase rounded ${unidade === 'met' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Metros L x A</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">{unidade === 'mod' ? 'Largura (Qtd)' : 'Largura (Metros)'}</label>
                  <input type="number" min="0.5" step={unidade === 'met' ? '0.5' : '1'} className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={inputL} onChange={(e) => setInputL(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#336699] uppercase mb-1 block">{unidade === 'mod' ? 'Altura (Qtd)' : 'Altura (Metros)'}</label>
                  <input type="number" min="0.5" step={unidade === 'met' ? '0.5' : '1'} className="w-full p-2 border border-blue-200 bg-blue-50/50 rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={inputH} onChange={(e) => setInputH(parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              
              <button onClick={processarNovoGrid} className="w-full bg-[#16A34A] text-white p-3 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#15803D] transition-all shadow-sm">
                Desenhar Nova Matriz
              </button>
            </div>
          </div>

          {/* Seção 3: Ações Rápidas */}
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">3. Ferramentas do Grid</h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-2">💡 Clique e Arraste no mapa para ligar/desligar painéis rapidamente.</p>
            <div className="grid grid-cols-3 gap-1">
              <button onClick={() => setTodos(true)} className="bg-gray-100 hover:bg-gray-200 text-[#0C1D4D] text-[9px] font-black uppercase py-2 rounded transition-colors">Ligar Tudo</button>
              <button onClick={() => setTodos(false)} className="bg-gray-100 hover:bg-red-100 text-red-600 text-[9px] font-black uppercase py-2 rounded transition-colors">Limpar Tudo</button>
              <button onClick={inverterSelecao} className="bg-gray-100 hover:bg-gray-200 text-[#336699] text-[9px] font-black uppercase py-2 rounded transition-colors">Inverter</button>
            </div>
          </div>

          <button onClick={() => window.print()} className="w-full bg-[#0C1D4D] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-[#284B8C] shadow-md transition-colors mt-4">
            🖨️ Gerar PDF / Imprimir
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / WORKSPACE */}
      <main className="flex-grow flex flex-col gap-4 relative print:bg-white print:p-8 overflow-y-auto">
        
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-2 flex-shrink-0">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Mapa Estrutural e Resolução</h2>
            <p className="text-sm font-bold text-gray-600 mt-1">Data: {new Date().toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        <div className="hidden print:grid grid-cols-2 gap-4 mb-2 border-b border-gray-300 pb-4 flex-shrink-0">
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Projeto / Evento:</span>
            <strong className="text-base text-black">{projeto || '---'}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Cliente:</span>
            <strong className="text-base text-black">{cliente || '---'}</strong>
          </div>
        </div>

        {/* METRICS CARDS (5 Cards para Informações de Engenharia) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-shrink-0 print:gap-3">
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#0C1D4D] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Área Externa (L x A)</span>
            <strong className="block text-lg text-[#0C1D4D] font-black print:text-black">{calculos.larguraMetros.toFixed(2)}m x {calculos.alturaMetros.toFixed(2)}m</strong>
            <span className="text-[9px] font-bold text-[#336699] uppercase print:text-gray-500">Matriz: {gridConfig.cols} x {gridConfig.rows}</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Resolução Final (Pixel)</span>
            <strong className="block text-lg text-[#336699] font-black print:text-black">{calculos.resLargura} x {calculos.resAltura}</strong>
            <span className="text-[9px] font-bold text-[#336699] uppercase print:text-gray-500">Pitch Estimado: {calculos.nomePitch}</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#16A34A] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Painéis Ativos (Qtd / m²)</span>
            <strong className="block text-lg text-[#16A34A] font-black print:text-black">{calculos.ativos} un.</strong>
            <span className="text-[9px] font-bold text-[#16A34A] uppercase print:text-gray-500">Área de Luz: {calculos.areaAtivaM2.toFixed(2)} m²</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-amber-500 p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Peso Estimado da Tela</span>
            <strong className="block text-lg text-amber-600 font-black print:text-black">{calculos.pesoTotal} KG</strong>
            <span className="text-[9px] font-bold text-amber-600 uppercase print:text-gray-500">Baseado em ~8kg / Gabinete</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#7C3AED] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Consumo Elétrico (Watt)</span>
            <strong className="block text-lg text-[#7C3AED] font-black print:text-black">{calculos.consumoMaxW} W</strong>
            <span className="text-[9px] font-bold text-[#7C3AED] uppercase print:text-gray-500">Média Estável: {calculos.consumoMedW} W</span>
          </div>
        </div>

        {/* WORKSPACE DO GRID INTERATIVO */}
        <div 
          className="flex-grow bg-white border border-[#E2E8F0] rounded-2xl relative overflow-hidden shadow-sm flex items-center justify-center p-4 print:bg-transparent print:border-none print:shadow-none bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:32px_32px]"
          // Removemos o scroll e a interação de arraste não causa highlight no texto do navegador
          onDragStart={(e) => e.preventDefault()}
        >
          <div 
            className="grid bg-white border-2 border-[#0C1D4D] shadow-md p-1 md:p-1.5 rounded-lg print:bg-white print:border-2 print:border-black print:inline-grid select-none"
            style={{ 
              gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))`,
              gap: gridConfig.cols > 60 ? '0px' : gridConfig.cols > 30 ? '1px' : '2px',
              // Escalonamento Dinâmico Inteligente
              width: `min(100%, calc((100vh - 320px) * ${gridConfig.cols / gridConfig.rows}), ${gridConfig.cols * 60}px)`
            }}
          >
            {modulosAtivos.map((ativo, index) => (
              <div 
                key={index}
                // Eventos Mouse Drag-to-Draw
                onMouseDown={() => handleMouseDown(index)}
                onMouseEnter={() => handleMouseEnter(index)}
                className={`
                  w-full aspect-square transition-colors duration-75 rounded-[1px] md:rounded-sm
                  print:border print:border-gray-300 print:rounded-none
                  ${ativo 
                      ? 'bg-[#336699] hover:bg-[#284B8C] shadow-inner print:bg-gray-700 print:shadow-none' 
                      : 'bg-[#F1F5F9] border border-dashed border-[#CBD5E1] print:border-none print:bg-transparent print:opacity-0'
                  }
                `}
              />
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}