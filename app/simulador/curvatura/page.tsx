"use client";

import { useState, useEffect, useRef } from 'react';
import { Analytics } from "@vercel/analytics/next";

const MOD_W = 0.5; // Largura do módulo em metros

export default function SimuladorCurvatura() {
  // Estados de Informações
  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');

  // Estados de Configuração
  const [modeloPainel, setModeloPainel] = useState<number>(5); // 5°, 15°, 45°
  const [tipoCurva, setTipoCurva] = useState<'concavo' | 'convexo'>('concavo');
  // ADICIONADO: 'circunferencia' às opções
  const [modoAngulo, setModoAngulo] = useState<'unico' | 'diametro' | 'raio' | 'circunferencia' | 'multiplo'>('unico');
  const [angleInput, setAngleInput] = useState<string>('5');
  
  // Estados de Dimensionamento
  const [sizeMode, setSizeMode] = useState<'qty' | 'corda' | 'linear'>('qty');
  const [qty, setQty] = useState<number>(10);
  const [inputCorda, setInputCorda] = useState<number>(2.0);
  const [inputLinear, setInputLinear] = useState<number>(5.0);

  // Estados de Resultados / Telemetria
  const [resultados, setResultados] = useState({
    n: 0,
    linear: 0,
    corda: 0,
    totalAngle: 0,
    raioDisplay: '---',
    diamDisplay: '---',
    avisoSeguranca: ''
  });

  // Referência para o Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPrintMode, setIsPrintMode] = useState(false);

  // Listener para impressão
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

  // Lógica principal: Recalcular e Desenhar sempre que houver mudança nos inputs
  useEffect(() => {
    calcularEDesenhar();
  }, [projeto, cliente, modeloPainel, tipoCurva, modoAngulo, angleInput, sizeMode, qty, inputCorda, inputLinear, isPrintMode]);

  const calcularEDesenhar = () => {
    let aviso = '';
    const maxPermitido = modeloPainel;
    const nomeModelo = maxPermitido === 5 ? 'P2 Curvo' : maxPermitido === 15 ? 'P3 Curvo' : 'P2 Flexível';
    
    let angles: number[] = [];
    let n = 0;
    
    // ADICIONADO: 'circunferencia' nas opções tratadas automaticamente
    if (modoAngulo === 'unico' || modoAngulo === 'diametro' || modoAngulo === 'raio' || modoAngulo === 'circunferencia') {
      let anguloUnico = 0;
      const raioMinimo = MOD_W / ((maxPermitido * Math.PI) / 180);
      const diametroMinimo = 2 * raioMinimo;
      const circMinima = diametroMinimo * Math.PI;

      if (modoAngulo === 'diametro' || modoAngulo === 'raio' || modoAngulo === 'circunferencia') {
        let raioAlvo = 0;

        if (modoAngulo === 'diametro') {
          let diametroAlvo = parseFloat(angleInput);
          if (isNaN(diametroAlvo) || diametroAlvo <= 0) diametroAlvo = Math.ceil(diametroMinimo);
          
          if (diametroAlvo < diametroMinimo) {
            diametroAlvo = diametroMinimo;
            aviso = `Ajustado p/ diâmetro mín. (${diametroMinimo.toFixed(2)}m)`;
          }
          raioAlvo = diametroAlvo / 2;
        } else if (modoAngulo === 'raio') {
          raioAlvo = parseFloat(angleInput);
          if (isNaN(raioAlvo) || raioAlvo <= 0) raioAlvo = Math.ceil(raioMinimo);
          
          if (raioAlvo < raioMinimo) {
            raioAlvo = raioMinimo;
            aviso = `Ajustado p/ raio mín. (${raioMinimo.toFixed(2)}m)`;
          }
        } else if (modoAngulo === 'circunferencia') {
          let circAlvo = parseFloat(angleInput);
          if (isNaN(circAlvo) || circAlvo <= 0) circAlvo = Math.ceil(circMinima);
          
          if (circAlvo < circMinima) {
            circAlvo = circMinima;
            aviso = `Circunferência exigiria curva > ${maxPermitido}°. Ajustado p/ ${circMinima.toFixed(2)}m.`;
          }
          raioAlvo = circAlvo / (2 * Math.PI);
        }
        
        anguloUnico = (MOD_W / raioAlvo) * (180 / Math.PI);
      } else {
        anguloUnico = parseFloat(angleInput);
        if (isNaN(anguloUnico)) anguloUnico = 0;
        if (anguloUnico > maxPermitido) {
          anguloUnico = maxPermitido;
          aviso = `Ajustado p/ o limite (${maxPermitido}°)`;
        }
      }

      // Processamento de Quantidade/Tamanho
      if (modoAngulo === 'circunferencia') {
        // Quando é circunferência plena, a quantidade de placas é fixa pelo comprimento total da curva dividida pela placa.
        // O Círculo completo tem 360°.
        n = Math.round(360 / anguloUnico);
        aviso = aviso || "Círculo Fechado Otimizado";
      } else if (sizeMode === 'qty') {
        n = Math.max(1, qty);
      } else if (sizeMode === 'linear') {
        n = Math.max(1, Math.ceil(inputLinear / MOD_W));
      } else {
        const raioCalc = MOD_W / (Math.max(anguloUnico, 0.1) * Math.PI / 180);
        if (inputCorda >= raioCalc * 2 && anguloUnico > 0) {
          aviso = "Corda solicitada maior que o diâmetro.";
          n = 1;
        } else if (anguloUnico <= 0) {
          n = Math.max(1, Math.ceil(inputCorda / MOD_W));
        } else {
          const anguloTotalRad = 2 * Math.asin(inputCorda / (2 * raioCalc));
          n = Math.max(1, Math.ceil(anguloTotalRad / (anguloUnico * Math.PI / 180)));
        }
      }
      angles = Array(n).fill(anguloUnico);

    } else {
      // Modo Múltiplo (S-Curve, Custom)
      const parts = angleInput.split(',');
      for (const part of parts) {
        let val = parseFloat(part.trim());
        if (!isNaN(val)) {
          if (val > maxPermitido) { val = maxPermitido; aviso = "Valores excedentes limitados."; }
          else if (val < -maxPermitido) { val = -maxPermitido; aviso = "Valores excedentes limitados."; }
          angles.push(val);
        }
      }
      if (angles.length === 0) angles = [0];
      n = angles.length;
    }

    // Cálculos Finais da Telemetria
    let raioDisplay = "Variável";
    let diamDisplay = "Variável";

    if (modoAngulo === 'unico' || modoAngulo === 'diametro' || modoAngulo === 'raio' || modoAngulo === 'circunferencia') {
      const angBase = angles[0];
      if (Math.abs(angBase) < 0.0001) {
        raioDisplay = "Plano (Reto)";
        diamDisplay = "Plano (Reto)";
      } else {
        const rCalc = MOD_W / (Math.abs(angBase) * Math.PI / 180);
        raioDisplay = rCalc.toFixed(2) + " m";
        diamDisplay = (rCalc * 2).toFixed(2) + " m";
      }
    }

    const pts = [{ x: 0, y: 0 }];
    const dir = tipoCurva === 'concavo' ? -1 : 1;
    const totalAngleDeg = angles.reduce((sum, val) => sum + val, 0);
    let currentHeading = -(totalAngleDeg * dir * Math.PI / 180) / 2;

    for (const a_deg of angles) {
      const a_rad = a_deg * dir * (Math.PI / 180);
      let chordLength, stepHeading;

      if (Math.abs(a_rad) < 0.0001) {
        chordLength = MOD_W;
        stepHeading = currentHeading;
      } else {
        const r = MOD_W / Math.abs(a_rad);
        chordLength = 2 * r * Math.sin(Math.abs(a_rad) / 2);
        const turnDirection = a_rad > 0 ? 1 : -1;
        stepHeading = currentHeading + (Math.abs(a_rad) / 2) * turnDirection;
      }

      const nextX = pts[pts.length - 1].x + chordLength * Math.cos(stepHeading);
      const nextY = pts[pts.length - 1].y + chordLength * Math.sin(stepHeading);
      pts.push({ x: nextX, y: nextY });
      currentHeading += a_rad;
    }

    const linear = n * MOD_W;
    const cordaFinal = Math.sqrt(Math.pow(pts[pts.length - 1].x - pts[0].x, 2) + Math.pow(pts[pts.length - 1].y - pts[0].y, 2));

    setResultados({
      n, linear, corda: cordaFinal, totalAngle: totalAngleDeg, raioDisplay, diamDisplay, avisoSeguranca: aviso
    });

    // Chamada para Função de Desenho
    desenharCanvas(pts, linear, cordaFinal, n, nomeModelo, projeto || "PROJETO RENTECH", cliente || "Não informado");
  };

  const desenharCanvas = (pts: {x:number, y:number}[], linear: number, corda: number, n: number, nomeModelo: string, pName: string, cName: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ajuste de cores para o Light Mode
    ctx.fillStyle = isPrintMode ? '#ffffff' : '#F8FAFC';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const minX = Math.min(...pts.map(p => p.x));
    const maxX = Math.max(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxY = Math.max(...pts.map(p => p.y));

    const width = maxX - minX;
    const height = maxY - minY;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    let escala = Math.min(canvas.width * 0.75 / (width || 0.001), canvas.height * 0.45 / (height || 0.001));
    if (escala > 400) escala = 400;

    const offsetX = (canvas.width / 2) - (cx * escala);
    const offsetY = (canvas.height / 2) - (cy * escala) + 50;

    // Traçado principal do painel
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x * escala + offsetX, pts[0].y * escala + offsetY);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * escala + offsetX, pts[i].y * escala + offsetY);
    }

    if (!isPrintMode) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'rgba(51, 102, 153, 0.3)';
      ctx.strokeStyle = '#336699';
    } else {
      ctx.strokeStyle = '#0C1D4D';
    }
    
    ctx.lineWidth = 25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Junções/Módulos (Bolinhas separadoras)
    ctx.fillStyle = isPrintMode ? '#ffffff' : '#0C1D4D';
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x * escala + offsetX, pts[i].y * escala + offsetY, 8, 0, Math.PI * 2);
      ctx.fill();
      if (isPrintMode) {
         ctx.strokeStyle = '#0C1D4D';
         ctx.lineWidth = 2;
         ctx.stroke();
      }
    }

    // Tipografia
    ctx.textAlign = "center";
    const baseColor = isPrintMode ? '#000000' : '#0C1D4D';
    const subColor = isPrintMode ? '#666666' : '#64748B';
    const highlightColor = isPrintMode ? '#284B8C' : '#16A34A';

    ctx.fillStyle = baseColor;
    ctx.font = "900 42px sans-serif";
    ctx.fillText(`${pName.toUpperCase()} - ${nomeModelo.toUpperCase()}`, canvas.width / 2, 80);

    ctx.fillStyle = subColor;
    ctx.font = "bold 28px sans-serif";
    ctx.fillText(`Cliente: ${cName}`, canvas.width / 2, 125);

    ctx.fillStyle = subColor;
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(`Configuração: ${n} Módulos | Metragem Linear: ${linear.toFixed(2)}m`, canvas.width / 2, 165);

    ctx.fillStyle = highlightColor;
    ctx.font = "900 36px sans-serif";
    ctx.fillText(`LARGURA TOTAL DA CORDA: ${corda.toFixed(2)}m`, canvas.width / 2, canvas.height - 100);

    ctx.fillStyle = subColor;
    ctx.font = "italic 22px sans-serif";
    ctx.fillText(`Curvatura Total: ${resultados.totalAngle.toFixed(1)}° | Raio: ${resultados.raioDisplay}`, canvas.width / 2, canvas.height - 50);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-3 px-4 md:px-6 pb-4 md:pb-6 pt-6 
      bg-[#F0F4F8] text-[#0F172A] h-screen max-h-[800px] overflow-hidden font-sans print:bg-white 
      print:text-black print:block print:p-0">
      <Analytics/>
      
      {/* SIDEBAR TÉCNICA (Oculta na Impressão) */}
      <aside className="bg-white p-3 md:p-4 rounded-2xl shadow-sm w-full lg:w-80 flex-shrink-0 flex flex-col border border-[#E2E8F0] overflow-y-auto print:hidden">
        
        <div className="bg-[#F0F4F8] p-2.5 rounded-xl mb-3 border-l-4 border-l-[#336699]">
          <h1 className="text-[10px] font-black uppercase tracking-widest text-[#0C1D4D] leading-tight">Engenharia LED <br/><span className="text-[#336699]">Curvo & Flexível</span></h1>
        </div>

        <div className="space-y-3 flex-grow">
          {/* Dados do Cliente */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Projeto/Evento</label>
              <input type="text" className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Cliente</label>
              <input type="text" className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} />
            </div>
          </div>

          <div className="border-t border-dashed border-[#CBD5E1]"></div>

          {/* Configurações Estruturais */}
          <div className="space-y-2.5">
            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Modelo do Painel</label>
              <select className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none font-bold cursor-pointer" value={modeloPainel} onChange={(e) => setModeloPainel(parseInt(e.target.value))}>
                <option value={15}>P3 Curvo (Máx 15°)</option>
                <option value={5}>P2 Curvo (Máx 5°)</option>
                <option value={45}>P2 Flexível (Máx 45°)</option>
              </select>
            </div>

            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Direção Principal</label>
              <select className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none cursor-pointer" value={tipoCurva} onChange={(e) => setTipoCurva(e.target.value as any)}>
                <option value="concavo">Côncavo (Para DENTRO)</option>
                <option value="convexo">Convexo (Para FORA)</option>
              </select>
            </div>

            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Lógica do Ângulo</label>
              <select className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none cursor-pointer" value={modoAngulo} onChange={(e) => setModoAngulo(e.target.value as any)}>
                <option value="unico">Por Ângulo Constante</option>
                <option value="diametro">Por Diâmetro da Curva (m)</option>
                <option value="raio">Por Raio da Curva (m)</option>
                <option value="circunferencia">Por Circunferência (m)</option>
                <option value="multiplo">Por Placa Livre (S-Curve)</option>
              </select>
            </div>

            <div>
              <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">
                {modoAngulo === 'unico' ? 'Ângulo por Placa (°)' : modoAngulo === 'diametro' ? 'Diâmetro Alvo (m)' : modoAngulo === 'raio' ? 'Raio Alvo (m)' : modoAngulo === 'circunferencia' ? 'Circunferência (m)' : 'Ângulos (Por vírgula)'}
              </label>
              <input type="text" className="w-full p-1.5 bg-white border border-[#CBD5E1] rounded-lg text-sm text-[#0C1D4D] font-black outline-none focus:border-[#336699]" value={angleInput} onChange={(e) => setAngleInput(e.target.value)} />
              {resultados.avisoSeguranca && <p className="text-[9px] text-[#D97706] font-bold mt-1 leading-tight">{resultados.avisoSeguranca}</p>}
            </div>
          </div>

          {/* Ao selecionar Circunferência, as opções de dimensionamento de Qtd/Linear/Corda não fazem sentido,
              pois a circunferência define sozinha quantas placas são necessárias. Escondemos os botões. */}
          {modoAngulo !== 'circunferencia' && (
            <>
              <div className="border-t border-dashed border-[#CBD5E1]"></div>
              {/* Dimensionamento */}
              <div className="space-y-1.5 pb-1">
                <label className="text-[9px] font-bold text-[#64748B] uppercase tracking-wider block">Definir Tamanho Por:</label>
                <div className="flex gap-1 bg-[#F8FAFC] p-1 rounded-lg border border-[#CBD5E1]">
                  <button onClick={() => setSizeMode('qty')} className={`flex-1 py-1 rounded-md text-[9px] font-bold uppercase transition-all ${sizeMode === 'qty' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#E2E8F0]'}`}>Módulos</button>
                  <button onClick={() => setSizeMode('corda')} className={`flex-1 py-1 rounded-md text-[9px] font-bold uppercase transition-all ${sizeMode === 'corda' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#E2E8F0]'}`}>Corda</button>
                  <button onClick={() => setSizeMode('linear')} className={`flex-1 py-1 rounded-md text-[9px] font-bold uppercase transition-all ${sizeMode === 'linear' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:bg-[#E2E8F0]'}`}>Linear</button>
                </div>

                {sizeMode === 'qty' && (
                  <div><input type="number" min="1" className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-bold outline-none focus:border-[#336699]" value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} /></div>
                )}
                {sizeMode === 'corda' && (
                  <div><input type="number" step="0.5" className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-bold outline-none focus:border-[#336699]" value={inputCorda} onChange={(e) => setInputCorda(parseFloat(e.target.value) || 1)} /></div>
                )}
                {sizeMode === 'linear' && (
                  <div><input type="number" step="0.5" className="w-full p-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-bold outline-none focus:border-[#336699]" value={inputLinear} onChange={(e) => setInputLinear(parseFloat(e.target.value) || 1)} /></div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="mt-2 pt-2 border-t border-dashed border-[#CBD5E1]">
          <button onClick={() => window.print()} className="w-full border-2 border-[#E2E8F0] text-[#64748B] p-2 rounded-xl font-black uppercase text-[10px] tracking-wider hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors">
            🖨️ Imprimir Projeto
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / CANVAS - Rola independentemente e com tamanho muito reduzido */}
      <main className="flex-grow flex flex-col gap-2 relative print:p-8 overflow-y-auto pr-1">
        
        {/* Cards de Resultados - Mais compactos */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-shrink-0 print:gap-2">
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-2.5 rounded-xl shadow-sm print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-0.5 print:text-gray-600">Gabinetes</span>
            <strong className="block text-lg text-[#0C1D4D] font-black print:text-black">{resultados.n} un.</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-2.5 rounded-xl shadow-sm print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-0.5 print:text-gray-600">Metragem Linear</span>
            <strong className="block text-lg text-[#0C1D4D] font-black print:text-black">{resultados.linear.toFixed(2)} m</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#16A34A] p-2.5 rounded-xl shadow-sm print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-0.5 print:text-gray-600">Corda Real</span>
            <strong className="block text-lg text-[#16A34A] font-black print:text-green-700">{resultados.corda.toFixed(2)} m</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-2.5 rounded-xl shadow-sm print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-0.5 print:text-gray-600">Ângulo Gerado</span>
            <strong className="block text-lg text-[#0C1D4D] font-black print:text-black">{resultados.totalAngle.toFixed(1)}°</strong>
          </div>
        </div>

        {/* Workspace Canvas - Altura agressivamente reduzida para evitar rolagem de tela */}
        <div className="flex-grow bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl relative overflow-hidden shadow-inner min-h-[150px] bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:24px_24px] print:bg-transparent print:border-none print:shadow-none flex items-center justify-center">
          <canvas 
            ref={canvasRef} 
            width={1800} 
            height={850} 
            className="w-full h-auto max-h-[70vh] object-contain print:max-h-[85vh]"
          />
        </div>

      </main>
    </div>
  );
}