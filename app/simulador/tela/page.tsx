"use client";

import { useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../../../app/imgs/logo.png';
import logoPB from '../../../app/imgs/logo_pb.png';
import { Analytics } from "@vercel/analytics/next"

export default function SimuladorTela() {
  // Estados de entrada de dados
  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');
  const [ratio, setRatio] = useState<number>(1.7777); // 16:9 como padrão
  const [mode, setMode] = useState<'w' | 'h' | 'd'>('w');
  const [inputValue, setInputValue] = useState<number>(300);

  // Mapeamento de labels para a impressão
  const ratioLabels: { [key: number]: string } = {
    1.7777: "16:9 (Widescreen)",
    1.3333: "4:3 (Vídeo / Projeção)",
    2.3333: "21:9 (Ultrawide)",
    1.6: "16:10 (WUXGA)",
    0.5625: "9:16 (Vertical LED)",
    0.75: "3:4 (Vertical)",
    1: "1:1 (Quadrado)"
  };

  const modeLabels = {
    w: "Largura",
    h: "Altura",
    d: "Diagonal"
  };

  // Cálculo matemático em tempo real usando useMemo
  const medidas = useMemo(() => {
    let w = 0, h = 0, d_pol = 0, d_cm = 0;
    const val = inputValue || 0;

    if (mode === 'w') {
      w = val;
      h = w / ratio;
      d_cm = Math.sqrt(w * w + h * h);
      d_pol = d_cm / 2.54;
    } else if (mode === 'h') {
      h = val;
      w = h * ratio;
      d_cm = Math.sqrt(w * w + h * h);
      d_pol = d_cm / 2.54;
    } else {
      d_pol = val;
      d_cm = d_pol * 2.54;
      h = Math.sqrt(Math.pow(d_cm, 2) / (Math.pow(ratio, 2) + 1));
      w = h * ratio;
    }

    // Cálculo da escala visual para o mockup
    const maxW = 400; // Limite de largura visual
    const maxH = 250; // Limite de altura visual
    let visW, visH;

    if (ratio >= 1) {
      visW = maxW;
      visH = visW / ratio;
      if (visH > maxH) {
        visH = maxH;
        visW = visH * ratio;
      }
    } else {
      visH = maxH;
      visW = visH * ratio;
      if (visW > maxW) {
        visW = maxW;
        visH = visW / ratio;
      }
    }

    return { w, h, d_pol, visW, visH };
  }, [ratio, mode, inputValue]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 bg-[#000000] text-[#B3B3B3] min-h-screen font-sans print:bg-white print:text-black print:block">
      <Analytics/>
      
      {/* SIDEBAR DE CONTROLES (Oculta na impressão) */}
      <aside className="bg-[#0C1D4D]/20 p-5 rounded-2xl shadow-xl w-full lg:w-[380px] flex-shrink-0 flex flex-col border border-[#284B8C]/30 overflow-y-auto backdrop-blur-sm print:hidden">
        <div className="text-center mb-6 pb-6 border-b border-[#284B8C]/30">
          <Link href="/simulador">
            <Image src={logoPB} alt="Rentech Locadora" width={160} height={50} className="mx-auto hover:scale-105 transition-transform" priority />
          </Link>
          <h1 className="mt-4 text-xs font-black uppercase tracking-widest text-[#336699]">Simulador Técnico de Proporção</h1>
        </div>

        <div className="space-y-4 flex-grow">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Projeto / Evento</label>
              <input type="text" placeholder="Nome do projeto" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Cliente</label>
              <input type="text" placeholder="Nome do cliente" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Formato da Tela (Aspect Ratio)</label>
            <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={ratio} onChange={(e) => setRatio(parseFloat(e.target.value))}>
              <optgroup label="Horizontal">
                <option value="1.7777">16:9 (Widescreen)</option>
                <option value="1.3333">4:3 (Vídeo / Projeção)</option>
                <option value="2.3333">21:9 (Ultrawide)</option>
                <option value="1.6">16:10 (WUXGA)</option>
              </optgroup>
              <optgroup label="Vertical">
                <option value="0.5625">9:16 (Vertical LED)</option>
                <option value="0.75">3:4 (Vertical)</option>
              </optgroup>
              <option value="1">1:1 (Quadrado)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Referência</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={mode} onChange={(e) => setMode(e.target.value as 'w' | 'h' | 'd')}>
                <option value="w">Largura (cm)</option>
                <option value="h">Altura (cm)</option>
                <option value="d">Diagonal (")</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Valor Informado</label>
              <input type="number" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none font-bold" value={inputValue} onChange={(e) => setInputValue(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
        </div>

        <div className="mt-8">
          <button onClick={() => window.print()} className="w-full border border-[#666666] text-[#B3B3B3] p-3.5 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#666666]/10 transition-colors">
            🖨️ Imprimir Relatório Técnico
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / PREVIEW */}
      <main className="flex-grow flex flex-col gap-6 relative print:p-0">
        
        {/* Header de Impressão (Visível apenas ao imprimir) */}
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-6">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Relatório de Proporção de Telas</h2>
          </div>
        </div>

        {/* Informações do Projeto (Impressão) */}
        <div className="hidden print:grid grid-cols-2 gap-4 mb-6 border-b border-gray-300 pb-6">
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Projeto / Evento:</span>
            <strong className="text-base text-black">{projeto || 'N/A'}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Cliente:</span>
            <strong className="text-base text-black">{cliente || 'N/A'}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Formato da Tela:</span>
            <strong className="text-base text-black">{ratioLabels[ratio]}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Referência Base:</span>
            <strong className="text-base text-black">{modeLabels[mode]} ({inputValue}{mode === 'd' ? '"' : ' cm'})</strong>
          </div>
        </div>

        {/* Métrica de Resultados Totais */}
        <div className="grid grid-cols-3 gap-4 flex-shrink-0 print:gap-2">
          <div className="bg-[#284B8C] p-4 rounded-xl shadow-lg print:bg-gray-100 print:border print:border-gray-400">
            <span className="block text-[10px] text-blue-200 uppercase font-bold tracking-wider mb-1 print:text-gray-600">Largura Total</span>
            <strong className="block text-2xl text-white font-black print:text-black">{Math.round(medidas.w)} cm</strong>
          </div>
          <div className="bg-[#284B8C] p-4 rounded-xl shadow-lg print:bg-gray-100 print:border print:border-gray-400">
            <span className="block text-[10px] text-blue-200 uppercase font-bold tracking-wider mb-1 print:text-gray-600">Altura Total</span>
            <strong className="block text-2xl text-white font-black print:text-black">{Math.round(medidas.h)} cm</strong>
          </div>
          <div className="bg-[#284B8C] p-4 rounded-xl shadow-lg print:bg-gray-100 print:border print:border-gray-400">
            <span className="block text-[10px] text-blue-200 uppercase font-bold tracking-wider mb-1 print:text-gray-600">Diagonal</span>
            <strong className="block text-2xl text-white font-black print:text-black">{medidas.d_pol.toFixed(1)}&quot;</strong>
          </div>
        </div>

        {/* Mockup Visual */}
        <div className="flex-grow bg-[#0C1D4D]/10 border border-[#284B8C]/30 rounded-2xl flex items-center justify-center p-12 relative backdrop-blur-sm min-h-[400px] print:bg-white print:border print:border-gray-300 print:min-h-[350px]">
          
          <div 
            className="bg-black border-4 border-[#336699] relative transition-all duration-300 ease-in-out shadow-[0_0_40px_rgba(51,102,153,0.3)] print:bg-gray-100 print:border-black print:shadow-none"
            style={{ width: `${medidas.visW}px`, height: `${medidas.visH}px` }}
          >
            {/* Medida: Largura */}
            <div className="absolute -bottom-8 left-0 w-full text-center text-[#00ff88] border-b-2 border-[#00ff88] font-bold text-xs pb-1 print:text-black print:border-black">
              {Math.round(medidas.w)} cm
            </div>
            
            {/* Medida: Altura */}
            <div className="absolute top-0 -right-16 h-full flex items-center text-[#ff4d4d] border-r-2 border-[#ff4d4d] font-bold text-xs pr-2 print:text-black print:border-black">
              {Math.round(medidas.h)} cm
            </div>

            {/* Medida: Diagonal */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
              <div 
                className="text-[#FFD700] border-b border-dashed border-[#FFD700] text-center font-bold text-xs pb-1 transform -rotate-[20deg] w-[70%] print:text-black print:border-black"
              >
                {medidas.d_pol.toFixed(1)}&quot;
              </div>
            </div>
          </div>

        </div>

      </main>

    </div>
  );
}