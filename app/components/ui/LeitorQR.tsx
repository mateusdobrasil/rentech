"use client";

// Campo de leitura de código (QR/código de barras): leitor USB/Bluetooth
// funciona como teclado (digita e dá Enter); no celular com Chrome/Android,
// o botão Câmera usa o BarcodeDetector. Ignora a mesma leitura repetida em
// menos de 2,5 s (a câmera lê várias vezes por segundo). Bipa ok/erro.
import { useState, useEffect, useRef } from 'react';

export function bipLeitura(ok: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator(); o.frequency.value = ok ? 1200 : 300; o.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
  } catch { /* sem áudio */ }
}

export default function LeitorQR({ onLer, desabilitado, placeholder }: {
  onLer: (codigo: string) => Promise<void> | void;
  desabilitado?: boolean;
  placeholder?: string;
}) {
  const [codigo, setCodigo] = useState('');
  const [camera, setCamera] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ultimo = useRef({ codigo: '', em: 0 });
  const onLerRef = useRef(onLer);
  useEffect(() => { onLerRef.current = onLer; }, [onLer]);
  const temCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  const ler = async (v: string) => {
    const c = v.trim();
    if (!c) return;
    if (ultimo.current.codigo === c && Date.now() - ultimo.current.em < 2500) return;
    ultimo.current = { codigo: c, em: Date.now() };
    setOcupado(true);
    try { await onLerRef.current(c); } finally { setOcupado(false); setCodigo(''); inputRef.current?.focus(); }
  };
  const lerRef = useRef(ler);
  useEffect(() => { lerRef.current = ler; });

  useEffect(() => {
    if (!camera) return;
    let parar = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13'] });
        const loop = async () => {
          if (parar || !videoRef.current) return;
          try { const r = await detector.detect(videoRef.current); if (r?.[0]?.rawValue) await lerRef.current(r[0].rawValue); } catch { /* frame sem leitura */ }
          setTimeout(loop, 350);
        };
        loop();
      } catch (e: any) { setErroCamera(e.message); setCamera(false); }
    })();
    return () => { parar = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [camera]);

  return (
    <div className="space-y-2">
      <form onSubmit={e => { e.preventDefault(); ler(codigo); }} className="flex gap-2">
        <input ref={inputRef} value={codigo} onChange={e => setCodigo(e.target.value)} autoFocus disabled={desabilitado || ocupado}
          placeholder={placeholder || 'Aponte o leitor para a etiqueta (ou digite o nº e Enter)'}
          className="flex-1 min-w-0 border-2 border-[#336699] rounded-xl px-4 py-3 text-base font-bold uppercase focus:outline-none disabled:opacity-50" />
        {temCamera && (
          <button type="button" onClick={() => setCamera(c => !c)} disabled={desabilitado}
            className={`px-4 rounded-xl font-black text-xs uppercase border-2 ${camera ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-[#CBD5E1] text-[#0C1D4D]'}`}>
            {camera ? 'Fechar' : '📷 Câmera'}
          </button>
        )}
      </form>
      {camera && <video ref={videoRef} playsInline muted className="w-full max-h-64 object-cover rounded-xl bg-black" />}
      {erroCamera && <p className="text-xs text-red-600">Câmera: {erroCamera}</p>}
    </div>
  );
}
