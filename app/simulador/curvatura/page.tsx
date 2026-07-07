"use client";

import { useState, useEffect, useRef } from 'react';
import { Analytics } from "@vercel/analytics/next";

const MOD_W = 0.5; // Largura exata do chassi em metros

export default function SimuladorCurvatura() {
  // 1. Dados do Projeto
  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');

  // 2. O Painel
  const [modeloPainel, setModeloPainel] = useState<number>(5); 
  
  // 3. Lógica da Curvatura (Como ele curva)
  const [modoAngulo, setModoAngulo] = useState<'unico' | 'diametro' | 'raio' | 'circunferencia' | 'multiplo'>('unico');
  const [angleInput, setAngleInput] = useState<string>('5');
  
  // 4. Dimensionamento (Qual o tamanho)
  const [sizeMode, setSizeMode] = useState<'qty' | 'corda' | 'linear'>('qty');
  const [qty, setQty] = useState<number>(10);
  const [inputCorda, setInputCorda] = useState<number>(2.0);
  const [inputLinear, setInputLinear] = useState<number>(5.0);

  // 5. Motor de Resultados (Adicionado circDisplay)
  const [resultados, setResultados] = useState({
    n: 0, linear: 0, corda: 0, totalAngle: 0, 
    raioDisplay: '---', diamDisplay: '---', circDisplay: '---', 
    avisoSeguranca: ''
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  useEffect(() => {
    calcularEDesenhar();
  }, [projeto, cliente, modeloPainel, modoAngulo, angleInput, sizeMode, qty, inputCorda, inputLinear, isPrintMode]);

  // ============================================================================
  // MOTOR MATEMÁTICO (FÍSICA POLIGONAL EXATA)
  // ============================================================================
  const calcularEDesenhar = () => {
    let aviso = '';
    const maxPermitido = modeloPainel;
    const nomeModelo = maxPermitido === 5 ? 'P2 Indoor (Curvo Máx 5°)' : maxPermitido === 15 ? 'P3 Indoor (Curvo Máx 15°)' : 'P2 Flexível (Máx 45°)';
    
    let angles: number[] = [];
    let n = 0;
    
    if (['unico', 'diametro', 'raio', 'circunferencia'].includes(modoAngulo)) {
      let anguloUnico = 0;
      
      const raioMinimo = MOD_W / (2 * Math.sin((maxPermitido / 2) * (Math.PI / 180)));
      const diametroMinimo = 2 * raioMinimo;
      const circMinima = diametroMinimo * Math.PI;

      if (modoAngulo === 'diametro' || modoAngulo === 'raio' || modoAngulo === 'circunferencia') {
        let raioAlvo = 0;

        if (modoAngulo === 'diametro') {
          let diam = parseFloat(angleInput);
          if (isNaN(diam) || diam <= 0) diam = diametroMinimo;
          if (diam < diametroMinimo) { diam = diametroMinimo; aviso = `Ajustado para diâmetro mínimo seguro (${diametroMinimo.toFixed(2)}m)`; }
          raioAlvo = diam / 2;
        } else if (modoAngulo === 'raio') {
          raioAlvo = parseFloat(angleInput);
          if (isNaN(raioAlvo) || raioAlvo <= 0) raioAlvo = raioMinimo;
          if (raioAlvo < raioMinimo) { raioAlvo = raioMinimo; aviso = `Ajustado para raio mínimo seguro (${raioMinimo.toFixed(2)}m)`; }
        } else if (modoAngulo === 'circunferencia') {
          let circ = parseFloat(angleInput);
          if (isNaN(circ) || circ <= 0) circ = circMinima;
          if (circ < circMinima) { circ = circMinima; aviso = `Ajustado para circunferência mínima segura (${circMinima.toFixed(2)}m)`; }
          raioAlvo = circ / (2 * Math.PI);
        }
        
        anguloUnico = 2 * Math.asin(MOD_W / (2 * raioAlvo)) * (180 / Math.PI);
      } else {
        anguloUnico = parseFloat(angleInput);
        if (isNaN(anguloUnico)) anguloUnico = 0;
        if (anguloUnico > maxPermitido) { anguloUnico = maxPermitido; aviso = `Bloqueado mecânicamente em ${maxPermitido}° por chassi.`; }
      }

      if (modoAngulo === 'circunferencia') {
        n = Math.round(360 / anguloUnico);
        aviso = aviso || "Circunferência Perfeita Calculada";
      } else if (sizeMode === 'qty') {
        n = Math.max(1, qty);
      } else if (sizeMode === 'linear') {
        n = Math.max(1, Math.ceil(inputLinear / MOD_W));
      } else {
        const raioCalc = MOD_W / (2 * Math.sin((Math.max(anguloUnico, 0.1) / 2) * (Math.PI / 180)));
        if (inputCorda >= raioCalc * 2 && anguloUnico > 0) {
          aviso = "A corda solicitada é maior que o diâmetro do círculo.";
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

    const pts = [{ x: 0, y: 0 }];
    const totalAngleDeg = angles.reduce((sum, val) => sum + val, 0);
    
    let currentHeading = -(totalAngleDeg * Math.PI / 180) / 2;

    for (let i = 0; i < n; i++) {
      const a_deg = angles[i] || 0;
      const a_rad = a_deg * (Math.PI / 180);
      
      const nextX = pts[pts.length - 1].x + MOD_W * Math.cos(currentHeading);
      const nextY = pts[pts.length - 1].y + MOD_W * Math.sin(currentHeading);
      pts.push({ x: nextX, y: nextY });
      
      currentHeading += a_rad;
    }

    const linear = n * MOD_W;
    const cordaFinal = Math.sqrt(Math.pow(pts[pts.length - 1].x - pts[0].x, 2) + Math.pow(pts[pts.length - 1].y - pts[0].y, 2));

    let raioDisplay = "Variável";
    let diamDisplay = "Variável";
    let circDisplay = "Variável";
    
    if (modoAngulo !== 'multiplo') {
      const angBase = angles[0] || 0;
      if (Math.abs(angBase) < 0.0001) {
        raioDisplay = "Plano (Reto)"; 
        diamDisplay = "Plano (Reto)";
        circDisplay = "Plano (Reto)";
      } else {
        const rCalc = MOD_W / (2 * Math.sin((Math.abs(angBase) / 2) * (Math.PI / 180)));
        raioDisplay = rCalc.toFixed(2) + " m";
        diamDisplay = (rCalc * 2).toFixed(2) + " m";
        circDisplay = (rCalc * 2 * Math.PI).toFixed(2) + " m";
      }
    }

    setResultados({ 
      n, linear, corda: cordaFinal, totalAngle: totalAngleDeg, 
      raioDisplay, diamDisplay, circDisplay, avisoSeguranca: aviso 
    });
    
    desenharCanvas(pts, linear, cordaFinal, n, nomeModelo, projeto || "PROJETO RENTECH", cliente || "Não informado");
  };

  // ============================================================================
  // RENDERIZAÇÃO GRÁFICA NO CANVAS
  // ============================================================================
  const desenharCanvas = (pts: {x:number, y:number}[], linear: number, corda: number, n: number, nomeModelo: string, pName: string, cName: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    let escala = Math.min(canvas.width * 0.80 / (width || 0.001), canvas.height * 0.60 / (height || 0.001));
    if (escala > 400) escala = 400;

    const offsetX = (canvas.width / 2) - (cx * escala);
    const offsetY = (canvas.height / 2) - (cy * escala) + 50;

    if (pts.length > 1 && !isPrintMode) {
      ctx.beginPath();
      ctx.setLineDash([15, 15]);
      ctx.moveTo(pts[0].x * escala + offsetX, pts[0].y * escala + offsetY);
      ctx.lineTo(pts[pts.length - 1].x * escala + offsetX, pts[pts.length - 1].y * escala + offsetY);
      ctx.strokeStyle = '#336699'; 
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]); 

      ctx.fillStyle = '#336699';
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Corda Real: ${corda.toFixed(2)}m`, canvas.width / 2, pts[0].y * escala + offsetY - 20);
    }

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x * escala + offsetX, pts[0].y * escala + offsetY);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * escala + offsetX, pts[i].y * escala + offsetY);
    }

    if (!isPrintMode) {
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(12, 29, 77, 0.4)';
      ctx.strokeStyle = '#0C1D4D';
    } else {
      ctx.strokeStyle = '#0C1D4D';
    }
    
    ctx.lineWidth = 20;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = isPrintMode ? '#ffffff' : '#336699';
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x * escala + offsetX, pts[i].y * escala + offsetY, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.textAlign = "center";
    const baseColor = isPrintMode ? '#000000' : '#0C1D4D';
    const subColor = isPrintMode ? '#666666' : '#64748B';

    ctx.fillStyle = baseColor;
    ctx.font = "900 42px sans-serif";
    ctx.fillText(`${pName.toUpperCase()}`, canvas.width / 2, 70);

    ctx.fillStyle = subColor;
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(`Cliente: ${cName} | Equipamento: ${nomeModelo}`, canvas.width / 2, 110);

    ctx.fillStyle = subColor;
    ctx.font = "italic 22px sans-serif";
    ctx.fillText(`Curvatura Total: ${resultados.totalAngle.toFixed(1)}° | Raio Técnico: ${resultados.raioDisplay}`, canvas.width / 2, canvas.height - 40);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 px-4 md:px-8 py-6 bg-[#F0F4F8] text-[#0F172A] min-h-screen font-sans print:bg-white print:text-black print:block print:p-0">
      <Analytics/>
      
      <aside className="w-full lg:w-[400px] flex-shrink-0 flex flex-col gap-4 print:hidden">
        
        <div className="bg-[#0C1D4D] p-5 rounded-2xl shadow-md text-white">
          <h1 className="text-xl font-black uppercase tracking-widest leading-tight">Engenharia LED</h1>
          <p className="text-blue-300 text-xs mt-1">Simulador de Curvas e Polígonos</p>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-5">
          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">1. Dados do Projeto</h3>
            <div className="space-y-3">
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Projeto / Evento</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold uppercase focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} /></div>
              <div><label className="text-[10px] font-bold text-gray-500 uppercase">Cliente</label><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm font-bold focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
            </div>
          </div>

          <div>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">2. Estrutura Física</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase mb-1 block">Modelo de Gabinete</label>
                <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-lg">
                  <button onClick={() => setModeloPainel(5)} className={`py-1.5 text-[10px] font-black uppercase rounded ${modeloPainel === 5 ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>P2 (Max 5°)</button>
                  <button onClick={() => setModeloPainel(15)} className={`py-1.5 text-[10px] font-black uppercase rounded ${modeloPainel === 15 ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>P3 (Max 15°)</button>
                  <button onClick={() => setModeloPainel(45)} className={`py-1.5 text-[10px] font-black uppercase rounded ${modeloPainel === 45 ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:bg-gray-200'}`}>Flex (45°)</button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
            <h3 className="font-black text-[#336699] uppercase tracking-wider text-[10px] mb-3">3. Definição da Curvatura</h3>
            <select className="w-full p-2 bg-white border border-blue-200 rounded text-xs font-bold text-[#0C1D4D] mb-2 cursor-pointer outline-none" value={modoAngulo} onChange={(e) => setModoAngulo(e.target.value as any)}>
              <option value="unico">Travar Ângulo por Placa (°)</option>
              <option value="diametro">Informar Diâmetro da Curva (m)</option>
              <option value="raio">Informar Raio da Curva (m)</option>
              <option value="circunferencia">Informar Circunferência Total (m)</option>
              <option value="multiplo">Painel S-Curve Livre (Custom)</option>
            </select>
            
            <label className="text-[9px] font-bold text-gray-500 uppercase mt-2 block">
              {modoAngulo === 'unico' ? 'Qual o ângulo entre as placas?' : modoAngulo === 'diametro' ? 'Qual o diâmetro desejado?' : modoAngulo === 'raio' ? 'Qual o raio desejado?' : modoAngulo === 'circunferencia' ? 'Tamanho da circunferência?' : 'Digite os ângulos separados por vírgula'}
            </label>
            <input type="text" className="w-full p-2 bg-white border border-blue-300 rounded text-sm text-[#0C1D4D] font-black focus:border-[#0C1D4D] outline-none" value={angleInput} onChange={(e) => setAngleInput(e.target.value)} />
            {resultados.avisoSeguranca && <p className="text-[9px] text-[#0C1D4D] font-bold mt-1 bg-blue-100 p-1.5 rounded">{resultados.avisoSeguranca}</p>}
          </div>

          {modoAngulo !== 'circunferencia' && (
            <div>
              <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-xs border-b border-gray-100 pb-2 mb-3">4. Tamanho Final</h3>
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-2">
                <button onClick={() => setSizeMode('qty')} className={`flex-1 py-1.5 rounded text-[9px] font-black uppercase transition-all ${sizeMode === 'qty' ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}>Qtd. Placas</button>
                <button onClick={() => setSizeMode('corda')} className={`flex-1 py-1.5 rounded text-[9px] font-black uppercase transition-all ${sizeMode === 'corda' ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}>Larg. Corda</button>
                <button onClick={() => setSizeMode('linear')} className={`flex-1 py-1.5 rounded text-[9px] font-black uppercase transition-all ${sizeMode === 'linear' ? 'bg-[#336699] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`}>Metr. Linear</button>
              </div>

              {sizeMode === 'qty' && <div><input type="number" min="1" className="w-full p-2 border border-[#336699] rounded text-sm font-black text-[#0C1D4D] outline-none" value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} /></div>}
              {sizeMode === 'corda' && <div><input type="number" step="0.5" className="w-full p-2 border border-[#336699] rounded text-sm font-black text-[#0C1D4D] outline-none" value={inputCorda} onChange={(e) => setInputCorda(parseFloat(e.target.value) || 1)} /></div>}
              {sizeMode === 'linear' && <div><input type="number" step="0.5" className="w-full p-2 border border-[#336699] rounded text-sm font-black text-[#0C1D4D] outline-none" value={inputLinear} onChange={(e) => setInputLinear(parseFloat(e.target.value) || 1)} /></div>}
            </div>
          )}

          <button onClick={() => window.print()} className="w-full bg-[#0C1D4D] text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-[#284B8C] shadow-md transition-colors mt-4">
            🖨️ Gerar PDF / Imprimir
          </button>
        </div>
      </aside>

      <main className="flex-grow flex flex-col gap-4 relative print:p-8">
        
        {/* CARDS DE RESULTADOS - AGORA COM 5 MÉTRICAS */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 flex-shrink-0 print:gap-4">
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#0C1D4D] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Total Gabinetes</span>
            <strong className="block text-2xl text-[#0C1D4D] font-black print:text-black">{resultados.n} un.</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#336699] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Metragem Linear</span>
            <strong className="block text-2xl text-[#336699] font-black print:text-black">{resultados.linear.toFixed(2)}m</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#16A34A] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Raio</span>
            <strong className="block text-2xl text-[#16A34A] font-black print:text-black">{resultados.raioDisplay}</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#D97706] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Diâmetro</span>
            <strong className="block text-2xl text-[#D97706] font-black print:text-black">{resultados.diamDisplay}</strong>
          </div>
          <div className="bg-white border border-[#E2E8F0] border-t-4 border-t-[#7C3AED] p-4 rounded-xl shadow-sm print:bg-white print:border-gray-400">
            <span className="block text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Circunferência</span>
            <strong className="block text-2xl text-[#7C3AED] font-black print:text-black">{resultados.circDisplay}</strong>
          </div>
        </div>

        <div className="flex-grow bg-white border border-[#E2E8F0] rounded-2xl relative overflow-hidden shadow-sm bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:32px_32px] print:bg-transparent print:border-none print:shadow-none flex items-center justify-center min-h-[400px]">
          <canvas 
            ref={canvasRef} 
            width={2000} 
            height={1200} 
            className="w-full h-full object-contain p-4 print:p-0"
          />
        </div>
      </main>
    </div>
  );
}