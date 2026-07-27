"use client";

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { Analytics } from "@vercel/analytics/next";
import logoColorido from '../../../app/imgs/logo.png';

export default function SimuladorTela() {
  // 1. Dados do Projeto
  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');
  
  // 2. Aspect Ratio (Formato)
  const [ratio, setRatio] = useState<number>(1.7777); // Padrão 16:9
  
  // 3. Referência Dimensional
  const [mode, setMode] = useState<'w' | 'h' | 'd'>('w');
  const [inputValue, setInputValue] = useState<number>(300);

  // 4. Painel de LED (módulos de 50x50cm — largura e altura são "arredondadas"
  // para o múltiplo de 50cm mais próximo, pois não dá para quebrar o módulo)
  const [isPainelLed, setIsPainelLed] = useState(false);

  const [isPrintMode, setIsPrintMode] = useState(false);

  useEffect(() => {
    const handleBeforePrint = () => setIsPrintMode(true);
    const handleAfterPrint = () => setIsPrintMode(false);
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, []);

  // Mapeamento para Impressão
  const ratioLabels: { [key: number]: string } = {
    1.7777: "16:9 (Widescreen)",
    1.3333: "4:3 (Clássico)",
    2.3333: "21:9 (Ultrawide)",
    1.6: "16:10 (WUXGA)",
    0.5625: "9:16 (Vertical Mídia)",
    0.75: "3:4 (Vertical Clássico)",
    1: "1:1 (Quadrado)"
  };

  const modeLabels = { w: "Largura", h: "Altura", d: "Diagonal" };

  // ============================================================================
  // MOTOR MATEMÁTICO E TRIGONOMÉTRICO
  // ============================================================================
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

    // Painel de LED: módulo físico é 50x50cm, então largura e altura só
    // existem em múltiplos de 50cm — arredonda para o mais próximo (pra
    // mais ou pra menos) e recalcula diagonal/área a partir do tamanho real.
    if (isPainelLed) {
      w = Math.max(50, Math.round(w / 50) * 50);
      h = Math.max(50, Math.round(h / 50) * 50);
      d_cm = Math.sqrt(w * w + h * h);
      d_pol = d_cm / 2.54;
    }

    const area_m2 = (w / 100) * (h / 100);

    // Escalonamento Dinâmico para o Mockup Visual
    const maxW = 500; 
    const maxH = 300; 
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

    // Geometria Exata da Diagonal (Arco-Tangente)
    // Usado para rodar perfeitamente o texto da diagonal no mockup
    const diagAngle = Math.atan(visH / visW) * (180 / Math.PI);

    return { w, h, d_pol, area_m2, visW, visH, diagAngle };
  }, [ratio, mode, inputValue, isPainelLed]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 px-4 md:px-8 py-6 bg-[#F0F4F8] text-[#0F172A] min-h-screen font-sans print:bg-white print:text-black print:block print:p-0">
      <Analytics/>
      
      {/* SIDEBAR TÉCNICA */}
      <aside className="w-full lg:w-[400px] flex-shrink-0 flex flex-col gap-4 print:hidden">
        
        <div className="bg-[#0C1D4D] p-5 rounded-2xl shadow-md text-white">
          <h1 className="text-xl font-black uppercase tracking-widest leading-tight">Engenharia LED</h1>
          <p className="text-blue-300 text-xs mt-1">Simulador de Aspect Ratio e Telas</p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-5">
          
          {/* Seção 1: Projeto */}
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">1. Dados do Projeto</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Projeto / Evento</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold uppercase focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} /></div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Cliente</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
            </div>
          </div>

          {/* Seção 2: Formato da Tela */}
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">2. Formato da Tela</h3>
            <div className="grid grid-cols-2 gap-1.5 bg-gray-100 p-1.5 rounded-xl">
              <button onClick={() => setRatio(1.7777)} className={`py-2 text-[10px] font-black uppercase rounded transition-colors ${ratio === 1.7777 ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}>16:9 Widescreen</button>
              <button onClick={() => setRatio(0.5625)} className={`py-2 text-[10px] font-black uppercase rounded transition-colors ${ratio === 0.5625 ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}>9:16 Vertical</button>
              <button onClick={() => setRatio(1.3333)} className={`py-2 text-[10px] font-black uppercase rounded transition-colors ${ratio === 1.3333 ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}>4:3 Clássico</button>
              <button onClick={() => setRatio(0.75)} className={`py-2 text-[10px] font-black uppercase rounded transition-colors ${ratio === 0.75 ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}>3:4 Vertical</button>
              <button onClick={() => setRatio(2.3333)} className={`py-2 text-[10px] font-black uppercase rounded transition-colors ${ratio === 2.3333 ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}>21:9 Ultrawide</button>
              <button onClick={() => setRatio(1)} className={`py-2 text-[10px] font-black uppercase rounded transition-colors ${ratio === 1 ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-200'}`}>1:1 Quadrado</button>
            </div>
            
            {/* Opção para formatos incomuns */}
            <div className="mt-2">
              <select className="w-full p-2 bg-gray-50 border border-gray-300 rounded-lg text-[10px] font-bold text-gray-500 uppercase cursor-pointer outline-none" value={ratio} onChange={(e) => setRatio(parseFloat(e.target.value))}>
                <option disabled value={ratio}>Outros Formatos...</option>
                <option value="1.6">16:10 (WUXGA)</option>
                <option value="1.25">5:4 (Antigos)</option>
              </select>
            </div>
          </div>

          {/* Seção 3: Referência Dimensional */}
          <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
            <h3 className="font-black text-[#336699] uppercase tracking-wider text-[10px] mb-3">3. Medida de Referência</h3>
            <div className="flex gap-1 bg-white p-1 border border-blue-200 rounded-lg mb-3">
              <button onClick={() => setMode('w')} className={`flex-1 py-1.5 rounded text-[9px] font-black uppercase transition-all ${mode === 'w' ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>Largura</button>
              <button onClick={() => setMode('h')} className={`flex-1 py-1.5 rounded text-[9px] font-black uppercase transition-all ${mode === 'h' ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>Altura</button>
              <button onClick={() => setMode('d')} className={`flex-1 py-1.5 rounded text-[9px] font-black uppercase transition-all ${mode === 'd' ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}>Diagonal</button>
            </div>
            
            <label className="text-[9px] font-bold text-[#0C1D4D] uppercase mt-2 block">
              Qual {mode === 'w' ? 'a LARGURA em centímetros' : mode === 'h' ? 'a ALTURA em centímetros' : 'a DIAGONAL em polegadas'}?
            </label>
            <input type="number" min="1" step="0.5" className="w-full p-2 bg-white border border-blue-300 rounded text-sm text-[#0C1D4D] font-black focus:border-[#0C1D4D] outline-none" value={inputValue} onChange={(e) => setInputValue(parseFloat(e.target.value) || 0)} />
          </div>

          {/* Seção 4: Painel de LED */}
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">4. Tipo de Tela</h3>
            <button
              onClick={() => setIsPainelLed(v => !v)}
              className={`w-full flex items-center justify-between gap-2 p-3 rounded-xl border transition-colors ${isPainelLed ? 'bg-[#0C1D4D] border-[#0C1D4D] text-white' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}
            >
              <span className="text-[10px] font-black uppercase tracking-wider text-left">
                É Painel de LED?
                <span className="block text-[9px] font-normal normal-case opacity-80 mt-0.5">Arredonda a medida para o módulo de 50x50cm mais próximo</span>
              </span>
              <span className={`flex-shrink-0 w-10 h-5 rounded-full relative transition-colors ${isPainelLed ? 'bg-[#F59E0B]' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${isPainelLed ? 'left-5' : 'left-0.5'}`} />
              </span>
            </button>
          </div>

          <button onClick={() => window.print()} className="w-full bg-[#0C1D4D] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-[#284B8C] shadow-md transition-colors mt-4">
            🖨️ Gerar PDF / Imprimir
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / PREVIEW */}
      <main className="flex-grow flex flex-col gap-4 relative print:p-8">
        
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-2 flex-shrink-0">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-[#0C1D4D]">Relatório de Proporção de Telas</h2>
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
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Formato da Tela:</span>
            <strong className="text-base text-black">{ratioLabels[ratio] || 'Customizado'}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Medida Informada:</span>
            <strong className="text-base text-black">{modeLabels[mode]} ({inputValue}{mode === 'd' ? '"' : ' cm'})</strong>
          </div>
          <div>
            <span className="block text-[10px] text-gray-500 uppercase font-bold">Tipo de Tela:</span>
            <strong className="text-base text-black">{isPainelLed ? 'Painel de LED (módulos 50×50cm)' : 'Tela / Projeção'}</strong>
          </div>
        </div>

        {/* METRICS CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0 print:gap-3">
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#16A34A] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Largura Final</span>
            <strong className="block text-2xl text-[#16A34A] font-black print:text-black">{Math.round(medidas.w)} cm</strong>
            <span className="text-[10px] font-bold text-gray-400">{(medidas.w / 100).toFixed(2)} Metros{isPainelLed ? ' · ajustado' : ''}</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Altura Final</span>
            <strong className="block text-2xl text-[#336699] font-black print:text-black">{Math.round(medidas.h)} cm</strong>
            <span className="text-[10px] font-bold text-gray-400">{(medidas.h / 100).toFixed(2)} Metros{isPainelLed ? ' · ajustado' : ''}</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#D97706] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Diagonal Efetiva</span>
            <strong className="block text-2xl text-[#D97706] font-black print:text-black">{medidas.d_pol.toFixed(1)}&quot;</strong>
            <span className="text-[10px] font-bold text-gray-400">Polegadas Visuais</span>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#7C3AED] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Área Total Útil</span>
            <strong className="block text-2xl text-[#7C3AED] font-black print:text-black">{medidas.area_m2.toFixed(2)} m²</strong>
            <span className="text-[10px] font-bold text-gray-400">Metros Quadrados</span>
          </div>
        </div>

        {/* WORKSPACE DO PREVIEW VISUAL */}
        <div className="flex-grow bg-white border border-[#E2E8F0] rounded-2xl flex items-center justify-center p-12 relative overflow-hidden shadow-sm min-h-[400px] bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:32px_32px] print:bg-transparent print:border-none print:shadow-none">
          
          <div 
            className="bg-[#0C1D4D] border-[6px] border-[#336699] relative transition-all duration-300 ease-in-out shadow-[0_20px_50px_rgba(12,29,77,0.3)] print:bg-gray-100 print:border-black print:shadow-none rounded-sm"
            style={{ width: `${medidas.visW}px`, height: `${medidas.visH}px` }}
          >
            {/* SVG perfeito da Diagonal Geométrica */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <line x1="0" y1={medidas.visH} x2={medidas.visW} y2="0" stroke="#F59E0B" strokeWidth="2.5" strokeDasharray="8,8" />
            </svg>

            {/* Texto da Diagonal rodado via trigonometria */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span 
                style={{ transform: `rotate(-${medidas.diagAngle}deg)` }} 
                className="text-[#F59E0B] font-black text-sm bg-[#0C1D4D] print:bg-gray-100 px-3 tracking-widest print:text-black print:border-black"
              >
                {medidas.d_pol.toFixed(1)}&quot;
              </span>
            </div>

            {/* Indicador de Largura */}
            <div className="absolute -bottom-10 left-0 w-full text-center text-[#16A34A] border-t-[3px] border-[#16A34A] font-black text-sm pt-2 print:text-black print:border-black">
              {Math.round(medidas.w)} cm
            </div>
            
            {/* Indicador de Altura */}
            <div className="absolute top-0 -right-16 h-full flex items-center text-[#336699] border-l-[3px] border-[#336699] font-black text-sm pl-3 print:text-black print:border-black">
              {Math.round(medidas.h)} cm
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}