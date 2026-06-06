"use client";

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Analytics } from "@vercel/analytics/next";
import logoColorido from '../../../app/imgs/logo.png';

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
    // Transformação Light Premium, travada na tela sem rolar
    <div className="flex flex-col lg:flex-row gap-3 px-4 md:px-6 pb-4 md:pb-6 pt-6 bg-[#F0F4F8] text-[#0F172A] h-screen max-h-[800px] overflow-hidden font-sans print:bg-white print:text-black print:block print:p-0">
      <Analytics/>
      
      {/* SIDEBAR DE CONTROLES */}
      <aside className="bg-white p-3 md:p-4 rounded-2xl shadow-sm w-full lg:w-80 flex-shrink-0 flex flex-col border border-[#E2E8F0] overflow-y-auto print:hidden">
        
        <div className="bg-[#F0F4F8] p-2.5 rounded-xl mb-4 border-l-4 border-l-[#336699]">
          <h1 className="text-[10px] font-black uppercase tracking-widest text-[#0C1D4D] leading-tight">Simulador Técnico <br/><span className="text-[#336699]">Proporção & Aspecto</span></h1>
        </div>

        <div className="space-y-4 flex-grow">
          {/* Informações Iniciais */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Projeto/Evento</label>
              <input type="text" placeholder="Ex: Show SP" className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Cliente</label>
              <input type="text" placeholder="Ex: Rentech" className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
          </div>

          <div className="border-t border-dashed border-[#CBD5E1]"></div>

          {/* Formato da Tela */}
          <div>
            <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Formato da Tela (Aspect Ratio)</label>
            <select className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-bold focus:border-[#336699] outline-none cursor-pointer" value={ratio} onChange={(e) => setRatio(parseFloat(e.target.value))}>
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

          {/* Referência e Valores */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Referência Base</label>
              <select className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none cursor-pointer" value={mode} onChange={(e) => setMode(e.target.value as 'w' | 'h' | 'd')}>
                <option value="w">Largura (cm)</option>
                <option value="h">Altura (cm)</option>
                <option value="d">Diagonal (")</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Valor Informado</label>
              <input type="number" className="w-full p-2 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0C1D4D] font-black focus:border-[#336699] outline-none" value={inputValue} onChange={(e) => setInputValue(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
        </div>

        <div className="mt-4 pt-2 border-t border-dashed border-[#CBD5E1]">
          <button onClick={() => window.print()} className="w-full border-2 border-[#E2E8F0] text-[#64748B] p-2.5 rounded-xl font-black uppercase text-[10px] tracking-wider hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors">
            🖨️ Imprimir Relatório
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / PREVIEW - Rola de forma independente */}
      <main className="flex-grow flex flex-col gap-3 relative print:p-8 overflow-y-auto pr-1">
        
        {/* Header de Impressão (Visível apenas ao imprimir) */}
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-6 flex-shrink-0">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Relatório de Proporção de Telas</h2>
          </div>
        </div>

        {/* Informações do Projeto (Visível apenas ao imprimir) */}
        <div className="hidden print:grid grid-cols-2 gap-4 mb-6 border-b border-gray-300 pb-6 flex-shrink-0">
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

        {/* Métrica de Resultados Totais - Cartões mais finos */}
        <div className="grid grid-cols-3 gap-2 flex-shrink-0 print:gap-2">
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Largura Total</span>
            <strong className="block text-xl text-[#0C1D4D] font-black print:text-black">{Math.round(medidas.w)} cm</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Altura Total</span>
            <strong className="block text-xl text-[#0C1D4D] font-black print:text-black">{Math.round(medidas.h)} cm</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#D97706] p-3 rounded-xl shadow-sm print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Diagonal Visual</span>
            <strong className="block text-xl text-[#D97706] font-black print:text-black">{medidas.d_pol.toFixed(1)}&quot;</strong>
          </div>
        </div>

        {/* Mockup Visual - Área Cinza Claro */}
        <div className="flex-grow bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl flex items-center justify-center p-12 relative overflow-hidden shadow-inner min-h-[250px] bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:24px_24px] print:bg-transparent print:border-none print:shadow-none">
          
          <div 
            className="bg-[#0C1D4D] border-4 border-[#336699] relative transition-all duration-300 ease-in-out shadow-[0_15px_40px_rgba(12,29,77,0.25)] print:bg-gray-100 print:border-black print:shadow-none rounded-sm"
            style={{ width: `${medidas.visW}px`, height: `${medidas.visH}px` }}
          >
            {/* Medida: Largura */}
            <div className="absolute -bottom-8 left-0 w-full text-center text-[#16A34A] border-b-2 border-[#16A34A] font-black text-xs pb-1 print:text-black print:border-black">
              {Math.round(medidas.w)} cm
            </div>
            
            {/* Medida: Altura */}
            <div className="absolute top-0 -right-16 h-full flex items-center text-[#DC2626] border-r-2 border-[#DC2626] font-black text-xs pr-2 print:text-black print:border-black">
              {Math.round(medidas.h)} cm
            </div>

            {/* Medida: Diagonal */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
              <div 
                className="text-[#F59E0B] border-b-2 border-dashed border-[#F59E0B] text-center font-black text-xs pb-1 transform -rotate-[20deg] w-[70%] print:text-black print:border-black"
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