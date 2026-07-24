"use client";

import { useEffect, useState, useRef, use } from 'react'; // <-- Adicionado o hook 'use'
import Image from 'next/image';
import { supabase } from '../../lib/supabase';
import { salvarAssinaturaRecibo } from '../../admin/op/actions';
import logoColorido from '../../imgs/logo.png';

// ATUALIZAÇÃO NEXT.JS 15: params agora é uma Promise
export default function AssinaturaReciboPage({ params }: { params: Promise<{ id: string }> }) {
  // Desempacotando a Promise com o React.use()
  const { id } = use(params);

  const [op, setOp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  
  // Referência para a área de desenho (Canvas)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    async function carregarOP() {
      const { data, error } = await supabase
        .from('ordens_pagamento')
        .select('*')
        .eq('id', id) // <-- Utiliza o 'id' desempacotado
        .single();
        
      if (!error && data) setOp(data);
      setLoading(false);
    }
    carregarOP();
  }, [id]); // <-- O hook agora depende do 'id' desempacotado

  // ==========================================
  // LÓGICA DO CANVAS (DESENHO DA ASSINATURA)
  // ==========================================
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Impede o ecrã de fazer "scroll" enquanto desenha no telemóvel
    if (e.cancelable) e.preventDefault(); 

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.closePath();
    setIsDrawing(false);
  };

  const limparAssinatura = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  // ==========================================
  // GUARDAR ASSINATURA
  // ==========================================
  const handleSalvarAssinatura = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Verifica se o canvas está em branco
    const ctx = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(ctx!.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    const hasDrawn = pixelBuffer.some(color => color !== 0);
    
    if (!hasDrawn) {
      alert("Por favor, desenhe a sua assinatura antes de guardar.");
      return;
    }

    setIsSaving(true);
    // Converte o desenho para uma imagem Base64
    const base64Image = canvas.toDataURL('image/png');
    
    // Chama a ação do servidor — o registro em logs_auditoria já acontece
    // dentro dela, então não precisa duplicar a chamada aqui.
    const res = await salvarAssinaturaRecibo(op.id, base64Image);

    if (res.success) {
      setSucesso(true);
    } else {
      alert("Erro ao guardar: " + res.message);
    }
    setIsSaving(false);
  };

  // Inicializa o canvas com traço azul escuro e grosso
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#0C1D4D';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
      }
    }
  }, [loading, op]);

  // ==========================================
  // RENDERIZAÇÃO DA PÁGINA
  // ==========================================
  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4"><p className="font-bold text-gray-500">A carregar recibo...</p></div>;
  if (!op) return <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4"><p className="font-bold text-red-500">Recibo não encontrado ou inválido.</p></div>;

  const valorFormatado = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(op.total_geral || 0);

  if (sucesso || op.recibo_url) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center border-t-8 border-green-600">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-black text-gray-800 uppercase tracking-wider mb-2">Recibo Assinado!</h2>
          <p className="text-gray-500 text-sm mb-6">Agradecemos a sua colaboração. A equipa financeira já foi notificada do seu aceite.</p>
          {op.recibo_url && (
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">A sua assinatura guardada:</p>
              <img src={op.recibo_url} alt="Assinatura" className="max-h-32 mx-auto" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex justify-center items-start font-sans pb-12">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden mt-4">
        
        <div className="bg-[#0C1D4D] p-6 text-center">
          <div className="bg-white inline-block p-3 rounded-xl mb-4 shadow-sm">
            <Image src={logoColorido} alt="Rentech" width={140} height={40} />
          </div>
          <h1 className="text-white font-black text-xl uppercase tracking-widest">Assinatura de Recibo</h1>
          <p className="text-blue-200 text-sm">OS: {op.os_numero || 'S/N'}</p>
        </div>

        <div className="p-6">
          <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl text-center mb-6">
            <span className="block text-xs font-bold uppercase text-blue-800 mb-1">Valor do Pagamento</span>
            <strong className="text-3xl text-[#0C1D4D] font-black">{valorFormatado}</strong>
          </div>

          <p className="text-sm text-gray-600 text-justify mb-6 leading-relaxed">
            Confirmo o recebimento da importância de <strong>{valorFormatado}</strong>, 
            referente à prestação de serviços como freelancer (<strong>{op.empresa_recebedora}</strong>) 
            no evento <strong>{op.os_cliente}</strong>.
          </p>

          <h3 className="font-black text-sm uppercase text-gray-800 mb-2">Assine no quadro abaixo:</h3>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">Utilize o seu dedo para assinar no ecrã</p>
          
          {/* O CANVAS ONDE A MÁGICA ACONTECE */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 overflow-hidden relative">
            <canvas
              ref={canvasRef}
              width={400}
              height={200}
              className="w-full bg-transparent cursor-crosshair touch-none"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>

          <div className="flex justify-end mt-2 mb-8">
            <button onClick={limparAssinatura} className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
              🗑️ Limpar Desenho
            </button>
          </div>

          <button 
            onClick={handleSalvarAssinatura}
            disabled={isSaving}
            className="w-full bg-green-600 hover:bg-green-500 text-white font-black uppercase tracking-widest py-4 rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {isSaving ? 'A Guardar e a Enviar...' : '✅ Confirmar e Assinar Recibo'}
          </button>
        </div>
      </div>
    </div>
  );
}