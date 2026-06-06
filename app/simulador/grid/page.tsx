"use client";

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../../../app/imgs/logo.png';
import logoPB from '../../../app/imgs/logo_pb.png';

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
    <div className="flex flex-col lg:flex-row gap-4 p-4 bg-[#000000] text-[#B3B3B3] min-h-screen font-sans print:bg-white print:text-black print:block print:p-0">
      
      {/* SIDEBAR DE CONTROLES (Oculta na impressão) */}
      <aside className="bg-[#0C1D4D]/20 p-5 rounded-2xl shadow-xl w-full lg:w-[380px] flex-shrink-0 flex flex-col border border-[#284B8C]/30 overflow-y-auto backdrop-blur-sm print:hidden">
        <div className="text-center mb-6 pb-6 border-b border-[#284B8C]/30">
          <Link href="/simulador">
            <Image src={logoPB} alt="Rentech Locadora" width={160} height={50} className="mx-auto hover:scale-105 transition-transform" priority />
          </Link>
          <h1 className="mt-4 text-xs font-black uppercase tracking-widest text-[#336699]">Simulador de LED <span className="text-white">GRID</span></h1>
        </div>

        <div className="space-y-4 flex-grow">
          {/* Dados do Cliente */}
          <div className="bg-[#0C1D4D]/50 p-4 rounded-xl border border-[#284B8C]/20 space-y-3">
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Projeto / Evento</label>
              <input type="text" placeholder="Ex: Stand Feira de Tecnologia" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Cliente</label>
              <input type="text" placeholder="Ex: Corporativo SA" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
          </div>

          {/* Configurações Matemáticas */}
          <div className="space-y-3">
            <div className="flex gap-2 bg-black/40 p-1 rounded-lg border border-[#284B8C]/30">
              <button 
                onClick={() => setUnidade('mod')} 
                className={`flex-1 py-2 rounded-md text-xs font-bold uppercase transition-all ${unidade === 'mod' ? 'bg-[#336699] text-white shadow-md' : 'text-[#666666] hover:text-white'}`}
              >
                Em Módulos
              </button>
              <button 
                onClick={() => setUnidade('met')} 
                className={`flex-1 py-2 rounded-md text-xs font-bold uppercase transition-all ${unidade === 'met' ? 'bg-[#336699] text-white shadow-md' : 'text-[#666666] hover:text-white'}`}
              >
                Em Metros
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Modelo (Pitch)</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={modelo} onChange={(e) => setModelo(parseInt(e.target.value))}>
                <option value="128">P3 (128x128px)</option>
                <option value="168">P2.9 (168x168px)</option>
                <option value="192">P2.6 (192x192px)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">{unidade === 'mod' ? 'Largura (Módulos)' : 'Largura (Metros)'}</label>
                <input type="number" min="0.5" step="0.5" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none font-bold" value={inputL} onChange={(e) => setInputL(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">{unidade === 'mod' ? 'Altura (Módulos)' : 'Altura (Metros)'}</label>
                <input type="number" min="0.5" step="0.5" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none font-bold" value={inputH} onChange={(e) => setInputH(parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <button onClick={processarNovoGrid} className="w-full bg-[#336699] text-white p-3.5 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-all shadow-[0_0_15px_rgba(51,102,153,0.3)]">
            Gerar Matriz Grid
          </button>
          <button onClick={() => window.print()} className="w-full border border-[#666666] text-[#B3B3B3] p-3.5 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#666666]/10 transition-colors">
            🖨️ Imprimir Mapa
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / WORKSPACE */}
      <main className="flex-grow flex flex-col gap-6 relative print:bg-white print:p-8">
        
        {/* Header de Impressão (Visível apenas ao imprimir) */}
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-6">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Mapa Estrutural de Montagem</h2>
            <p className="text-sm font-bold text-gray-600 mt-1">Data: {new Date().toLocaleDateString('pt-BR')}</p>
          </div>
        </div>

        {/* Informações do Projeto (Impressão) */}
        <div className="hidden print:grid grid-cols-2 gap-4 mb-4 border-b border-gray-300 pb-4">
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-shrink-0 print:gap-2">
          <div className="bg-[#0C1D4D]/50 border-l-4 border-[#336699] p-5 rounded-xl shadow-lg print:bg-gray-100 print:border print:border-l-4 print:border-gray-800">
            <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Dimensão Física Bruta</span>
            <strong className="block text-2xl text-white font-black print:text-black">{calculos.larguraMetros.toFixed(2)}m x {calculos.alturaMetros.toFixed(2)}m</strong>
            <span className="text-xs font-semibold text-[#336699] print:text-gray-500">{gridConfig.cols} x {gridConfig.rows} módulos</span>
          </div>
          <div className="bg-[#0C1D4D]/50 border-l-4 border-[#336699] p-5 rounded-xl shadow-lg print:bg-gray-100 print:border print:border-l-4 print:border-gray-800">
            <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Resolução Final (Mapeamento)</span>
            <strong className="block text-2xl text-white font-black print:text-black">{calculos.resLargura} x {calculos.resAltura} px</strong>
            <span className="text-xs font-semibold text-[#336699] print:text-gray-500">Modelo {calculos.nomePitch}</span>
          </div>
          <div className="bg-[#0C1D4D]/50 border-l-4 border-green-500 p-5 rounded-xl shadow-lg print:bg-gray-100 print:border print:border-l-4 print:border-gray-800">
            <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Área LED Útil Montada</span>
            <strong className="block text-2xl text-green-400 font-black print:text-black">{calculos.areaAtivaM2.toFixed(2)} m²</strong>
            <span className="text-xs font-semibold text-green-600 print:text-gray-500">{calculos.ativos} módulos ativos</span>
          </div>
        </div>

        <div className="text-center print:hidden">
            <p className="text-xs text-[#666666] italic">Dica: Clique nos quadradinhos do mapa abaixo para ligar/desligar painéis e criar formatos customizados.</p>
        </div>

        {/* Workspace do Grid Interativo */}
        <div className="flex-grow bg-[#050B14] border border-[#284B8C]/30 rounded-2xl p-6 relative overflow-auto shadow-inner print:bg-white print:border-none print:shadow-none print:p-0 print:overflow-visible">
          
          <div className="min-w-max flex justify-center print:block print:w-full print:text-center">
            <div 
              className="grid gap-[2px] p-2 bg-[#0C1D4D]/40 border border-[#284B8C]/50 rounded-lg print:bg-white print:border-none print:gap-[1px] print:inline-grid"
              style={{ gridTemplateColumns: `repeat(${gridConfig.cols}, minmax(0, 1fr))` }}
            >
              {modulosAtivos.map((ativo, index) => (
                <div 
                  key={index}
                  onClick={() => toggleModulo(index)}
                  className={`
                    w-7 h-7 sm:w-8 sm:h-8 md:w-10 md:h-10 cursor-pointer transition-all duration-200 rounded-[2px] 
                    print:w-5 print:h-5 print:border print:border-gray-400 print:rounded-none
                    ${ativo 
                        ? 'bg-[#336699] hover:bg-[#4A90E2] shadow-[0_0_8px_rgba(51,102,153,0.5)] print:bg-gray-800 print:shadow-none' 
                        : 'bg-black border border-dashed border-[#666666]/50 hover:bg-[#1A1A1A] print:border-none print:bg-transparent print:opacity-0'
                    }
                  `}
                  title={`Módulo ${index + 1}`}
                />
              ))}
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}