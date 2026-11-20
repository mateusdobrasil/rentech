"use client";

// Assinatura desenhada na tela (dedo no celular/tablet ou mouse) — devolve um
// PNG (data URL) com fundo transparente e traço azul-escuro, recortado ao
// desenho. Usado no comprovante da Ficha de Locação (2026-11-20).
import { useEffect, useRef, useState } from 'react';

export default function AssinaturaTela({ onChange, altura = 180 }: { onChange: (png: string | null) => void; altura?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const limites = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [vazio, setVazio] = useState(true);

  // canvas na resolução real da tela (traço nítido no celular)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ajustar = () => {
      const dpr = window.devicePixelRatio || 1;
      const larg = c.clientWidth;
      c.width = Math.round(larg * dpr);
      c.height = Math.round(altura * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 2.4; ctx.strokeStyle = '#0C1D4D';
      limites.current = null; setVazio(true); onChange(null);
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [altura]);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const marcar = (p: { x: number; y: number }) => {
    const l = limites.current;
    limites.current = l ? { x0: Math.min(l.x0, p.x), y0: Math.min(l.y0, p.y), x1: Math.max(l.x1, p.x), y1: Math.max(l.y1, p.y) } : { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  };

  const exportar = () => {
    const c = canvasRef.current, l = limites.current;
    if (!c || !l) { onChange(null); return; }
    const dpr = window.devicePixelRatio || 1, m = 6;
    const x = Math.max(0, (l.x0 - m) * dpr), y = Math.max(0, (l.y0 - m) * dpr);
    const w = Math.min(c.width - x, (l.x1 - l.x0 + 2 * m) * dpr), h = Math.min(c.height - y, (l.y1 - l.y0 + 2 * m) * dpr);
    if (w < 4 || h < 4) { onChange(null); return; }
    const out = document.createElement('canvas');
    // reduz para no máximo 600 px de largura (o PDF não precisa de mais)
    const esc = Math.min(1, 600 / w);
    out.width = Math.round(w * esc); out.height = Math.round(h * esc);
    out.getContext('2d')!.drawImage(c, x, y, w, h, 0, 0, out.width, out.height);
    onChange(out.toDataURL('image/png'));
  };

  const limpar = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    limites.current = null; setVazio(true); onChange(null);
  };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-[#CBD5E1] bg-white">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: altura, touchAction: 'none', display: 'block' }}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); desenhando.current = true; const p = ponto(e); ultimo.current = p; marcar(p); }}
          onPointerMove={e => {
            if (!desenhando.current || !ultimo.current) return;
            const ctx = e.currentTarget.getContext('2d')!;
            const p = ponto(e);
            ctx.beginPath(); ctx.moveTo(ultimo.current.x, ultimo.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
            ultimo.current = p; marcar(p);
            if (vazio) setVazio(false);
          }}
          onPointerUp={() => { if (desenhando.current) { desenhando.current = false; ultimo.current = null; exportar(); } }}
          onPointerCancel={() => { desenhando.current = false; ultimo.current = null; }}
        />
        {vazio && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-300 uppercase tracking-wider">Assine aqui com o dedo</span>}
        <div className="pointer-events-none absolute left-6 right-6 bottom-8 border-b border-[#CBD5E1]" />
      </div>
      <button type="button" onClick={limpar} className="mt-2 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:text-red-600">↺ Limpar assinatura</button>
    </div>
  );
}
