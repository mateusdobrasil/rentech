"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../../../app/imgs/logo.png';
import logoPB from '../../../app/imgs/logo_pb.png';

const MOD_W = 0.5; // Largura do módulo em metros

export default function SimuladorCurvatura() {
  // Estados de Informações
  const [projeto, setProjeto] = useState('');
  const [cliente, setCliente] = useState('');

  // Estados de Configuração
  const [modeloPainel, setModeloPainel] = useState<number>(5); // 5°, 15°, 45°
  const [tipoCurva, setTipoCurva] = useState<'concavo' | 'convexo'>('concavo');
  const [modoAngulo, setModoAngulo] = useState<'unico' | 'diametro' | 'multiplo'>('unico');
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
    
    // Processamento de Ângulo
    if (modoAngulo === 'unico' || modoAngulo === 'diametro') {
      let anguloUnico = 0;
      const diametroMinimo = 2 * (MOD_W / ((maxPermitido * Math.PI) / 180));

      if (modoAngulo === 'diametro') {
        let diametroAlvo = parseFloat(angleInput);
        if (isNaN(diametroAlvo) || diametroAlvo <= 0) diametroAlvo = Math.ceil(diametroMinimo);
        
        if (diametroAlvo < diametroMinimo) {
          diametroAlvo = diametroMinimo;
          aviso = `Ajustado para diâmetro mínimo (${diametroMinimo.toFixed(2)}m) suportado pelo modelo.`;
        }
        const raioAlvo = diametroAlvo / 2;
        anguloUnico = (MOD_W / raioAlvo) * (180 / Math.PI);
      } else {
        anguloUnico = parseFloat(angleInput);
        if (isNaN(anguloUnico)) anguloUnico = 0;
        if (anguloUnico > maxPermitido) {
          anguloUnico = maxPermitido;
          aviso = `Ajustado para o limite máximo (${maxPermitido}°) suportado.`;
        }
      }

      // Processamento de Quantidade/Tamanho
      if (sizeMode === 'qty') {
        n = Math.max(1, qty);
      } else if (sizeMode === 'linear') {
        n = Math.max(1, Math.ceil(inputLinear / MOD_W));
      } else {
        const raioCalc = MOD_W / (Math.max(anguloUnico, 0.1) * Math.PI / 180);
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
      // Modo Múltiplo (S-Curve, Custom)
      const parts = angleInput.split(',');
      for (const part of parts) {
        let val = parseFloat(part.trim());
        if (!isNaN(val)) {
          if (val > maxPermitido) { val = maxPermitido; aviso = "Valores excedentes foram limitados."; }
          else if (val < -maxPermitido) { val = -maxPermitido; aviso = "Valores excedentes foram limitados."; }
          angles.push(val);
        }
      }
      if (angles.length === 0) angles = [0];
      n = angles.length;
    }

    // Cálculos Finais da Telemetria
    let raioDisplay = "Variável / Ondulado";
    let diamDisplay = "Variável / Ondulado";

    if (modoAngulo === 'unico' || modoAngulo === 'diametro') {
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
    desenharCanvas(pts, linear, cordaFinal, n, angles, nomeModelo, projeto || "PROJETO RENTECH", cliente || "Não informado");
  };

  const desenharCanvas = (pts: {x:number, y:number}[], linear: number, corda: number, n: number, angles: number[], nomeModelo: string, pName: string, cName: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Ajusta visual conforme o tema (Print ou Tela Escura Rentech)
    ctx.fillStyle = isPrintMode ? '#ffffff' : '#050B14';
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

    // Traçado principal do painel (A linha de LED)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x * escala + offsetX, pts[0].y * escala + offsetY);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * escala + offsetX, pts[i].y * escala + offsetY);
    }

    if (!isPrintMode) {
      ctx.shadowBlur = 25;
      ctx.shadowColor = '#336699';
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
    ctx.fillStyle = isPrintMode ? '#ffffff' : 'rgba(0, 0, 0, 0.7)';
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

    // Tipografia da Simulação
    ctx.textAlign = "center";
    const baseColor = isPrintMode ? '#000000' : '#ffffff';
    const subColor = isPrintMode ? '#666666' : '#999999';
    const highlightColor = isPrintMode ? '#284B8C' : '#336699';

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
    <div className="flex flex-col lg:flex-row gap-4 p-4 bg-[#000000] text-[#B3B3B3] min-h-screen font-sans print:bg-white print:text-black print:block print:p-0">
      
      {/* SIDEBAR TÉCNICA (Oculta na Impressão) */}
      <aside className="bg-[#0C1D4D]/20 p-5 rounded-2xl shadow-xl w-full lg:w-[400px] flex-shrink-0 flex flex-col border border-[#284B8C]/30 overflow-y-auto backdrop-blur-sm print:hidden">
        <div className="text-center mb-6 pb-6 border-b border-[#284B8C]/30">
          <Link href="/simulador">
            <Image src={logoPB} alt="Rentech Locadora" width={160} height={50} className="mx-auto hover:scale-105 transition-transform" priority />
          </Link>
          <h1 className="mt-4 text-[11px] font-black uppercase tracking-widest text-[#336699]">Engenharia LED: <span className="text-white">Curvo & Flexível</span></h1>
        </div>

        <div className="space-y-5 flex-grow">
          {/* Dados do Cliente */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Projeto / Evento</label>
                <input type="text" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={projeto} onChange={(e) => setProjeto(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Cliente</label>
                <input type="text" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={cliente} onChange={(e) => setCliente(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="h-px bg-[#284B8C]/30 w-full my-4"></div>

          {/* Configurações Estruturais */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Modelo do Painel</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none font-bold" value={modeloPainel} onChange={(e) => setModeloPainel(parseInt(e.target.value))}>
                <option value={15}>P3 Curvo (Máx 15°)</option>
                <option value={5}>P2 Curvo (Máx 5°)</option>
                <option value={45}>P2 Flexível (Máx 45°)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Direção Principal da Curva</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={tipoCurva} onChange={(e) => setTipoCurva(e.target.value as any)}>
                <option value="concavo">Côncavo (Para DENTRO)</option>
                <option value="convexo">Convexo (Para FORA)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Lógica do Ângulo</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white focus:border-[#336699] outline-none" value={modoAngulo} onChange={(e) => setModoAngulo(e.target.value as any)}>
                <option value="unico">Por Ângulo Constante</option>
                <option value="diametro">Por Diâmetro da Curva (m)</option>
                <option value="multiplo">Por Placa Livre (S-Curve)</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">
                {modoAngulo === 'unico' ? 'Ângulo por Placa (°)' : modoAngulo === 'diametro' ? 'Diâmetro Alvo (m)' : 'Ângulos (Separados por vírgula)'}
              </label>
              <input type="text" className="w-full p-2.5 bg-[#0C1D4D] border border-[#336699] rounded-lg text-sm text-white font-black outline-none" value={angleInput} onChange={(e) => setAngleInput(e.target.value)} />
              {resultados.avisoSeguranca && <p className="text-[10px] text-yellow-500 font-bold mt-1 leading-tight">{resultados.avisoSeguranca}</p>}
            </div>
          </div>

          <div className="h-px bg-[#284B8C]/30 w-full my-4"></div>

          {/* Dimensionamento */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider block">Definir Tamanho (Largura) Por:</label>
            <div className="flex gap-2 bg-black/40 p-1 rounded-lg border border-[#284B8C]/30">
              <button onClick={() => setSizeMode('qty')} className={`flex-1 py-2 rounded-md text-[10px] font-bold uppercase transition-all ${sizeMode === 'qty' ? 'bg-[#336699] text-white' : 'text-[#666666]'}`}>Módulos</button>
              <button onClick={() => setSizeMode('corda')} className={`flex-1 py-2 rounded-md text-[10px] font-bold uppercase transition-all ${sizeMode === 'corda' ? 'bg-[#336699] text-white' : 'text-[#666666]'}`}>Corda (m)</button>
              <button onClick={() => setSizeMode('linear')} className={`flex-1 py-2 rounded-md text-[10px] font-bold uppercase transition-all ${sizeMode === 'linear' ? 'bg-[#336699] text-white' : 'text-[#666666]'}`}>Linear (m)</button>
            </div>

            {sizeMode === 'qty' && (
              <div><input type="number" min="1" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white font-bold" value={qty} onChange={(e) => setQty(parseInt(e.target.value) || 1)} /></div>
            )}
            {sizeMode === 'corda' && (
              <div><input type="number" step="0.5" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white font-bold" value={inputCorda} onChange={(e) => setInputCorda(parseFloat(e.target.value) || 1)} /></div>
            )}
            {sizeMode === 'linear' && (
              <div><input type="number" step="0.5" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white font-bold" value={inputLinear} onChange={(e) => setInputLinear(parseFloat(e.target.value) || 1)} /></div>
            )}
          </div>
        </div>

        <div className="mt-8 space-y-3">
          <button onClick={() => window.print()} className="w-full bg-[#336699] text-white p-3.5 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors shadow-[0_0_15px_rgba(51,102,153,0.3)]">
            🖨️ Imprimir Projeto Técnico
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL / CANVAS */}
      <main className="flex-grow flex flex-col gap-6 relative print:p-8">
        
        {/* Cards de Resultados */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-shrink-0 print:gap-2">
          <div className="bg-[#0C1D4D]/50 border border-[#284B8C]/30 border-t-4 border-t-[#336699] p-4 rounded-xl shadow-lg print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Qtd de Gabinetes</span>
            <strong className="block text-2xl text-white font-black print:text-black">{resultados.n} un.</strong>
          </div>
          <div className="bg-[#0C1D4D]/50 border border-[#284B8C]/30 border-t-4 border-t-[#336699] p-4 rounded-xl shadow-lg print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Metragem Linear Total</span>
            <strong className="block text-2xl text-white font-black print:text-black">{resultados.linear.toFixed(2)} m</strong>
          </div>
          <div className="bg-[#0C1D4D]/50 border border-[#284B8C]/30 border-t-4 border-t-green-500 p-4 rounded-xl shadow-lg print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Ocupação / Corda Real</span>
            <strong className="block text-2xl text-green-400 font-black print:text-green-700">{resultados.corda.toFixed(2)} m</strong>
          </div>
          <div className="bg-[#0C1D4D]/50 border border-[#284B8C]/30 border-t-4 border-t-[#336699] p-4 rounded-xl shadow-lg print:bg-white print:border-gray-400 print:text-black">
            <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1 print:text-gray-600">Ângulo Total Gerado</span>
            <strong className="block text-2xl text-white font-black print:text-black">{resultados.totalAngle.toFixed(1)}°</strong>
          </div>
        </div>

        {/* Workspace Canvas (Onde a mágica acontece) */}
        <div className="flex-grow bg-[#050B14] border border-[#284B8C]/30 rounded-2xl relative overflow-hidden shadow-inner print:bg-transparent print:border-none print:shadow-none flex items-center justify-center">
          <canvas 
            ref={canvasRef} 
            width={1600} 
            height={1000} 
            className="w-full h-auto max-h-[75vh] object-contain print:max-h-[85vh]"
          />
        </div>

      </main>
    </div>
  );
}