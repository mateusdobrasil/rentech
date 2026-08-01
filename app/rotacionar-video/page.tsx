"use client";

import { useEffect, useRef, useState } from 'react';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { Analytics } from "@vercel/analytics/next";

type Rotacao = 0 | 90 | 180 | 270;

const CORE_BASE_URL = '/ffmpeg-core-mt';

function girar(atual: Rotacao, delta: 90 | -90): Rotacao {
  return (((atual + delta) % 360) + 360) % 360 as Rotacao;
}

function nomeSaida(nomeOriginal: string): string {
  const semExtensao = nomeOriginal.replace(/\.[^/.]+$/, '');
  return `${semExtensao}-rotacionado.mp4`;
}

export default function RotacionarVideo() {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [rotacao, setRotacao] = useState<Rotacao>(0);

  const [carregandoFerramenta, setCarregandoFerramenta] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState('');

  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultNome, setResultNome] = useState('');

  const ffmpegRef = useRef<FFmpeg | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelecionarArquivo = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setErro('Selecione um arquivo de vídeo válido.');
      return;
    }

    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);

    setErro('');
    setResultUrl(null);
    setResultNome('');
    setRotacao(0);
    setProgresso(0);
    setArquivo(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  const trocarVideo = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setArquivo(null);
    setVideoUrl(null);
    setResultUrl(null);
    setResultNome('');
    setRotacao(0);
    setErro('');
    setProgresso(0);
  };

  const getFFmpeg = async (): Promise<FFmpeg> => {
    if (ffmpegRef.current) return ffmpegRef.current;

    setCarregandoFerramenta(true);
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');

    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      setProgresso(Math.min(99, Math.max(0, Math.round(progress * 100))));
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.worker.js`, 'text/javascript'),
    });

    ffmpegRef.current = ffmpeg;
    setCarregandoFerramenta(false);
    return ffmpeg;
  };

  const handleProcessar = async () => {
    if (!arquivo || rotacao === 0) return;

    setProcessando(true);
    setErro('');
    setProgresso(0);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);

    const inputName = 'input' + (arquivo.name.match(/\.[^/.]+$/)?.[0] || '.mp4');
    const outputName = 'output.mp4';

    try {
      const ffmpeg = await getFFmpeg();
      const { fetchFile } = await import('@ffmpeg/util');

      await ffmpeg.writeFile(inputName, await fetchFile(arquivo));

      const filtroTranspose =
        rotacao === 90 ? 'transpose=1' :
        rotacao === 270 ? 'transpose=2' :
        'transpose=1,transpose=1'; // 180°

      await ffmpeg.exec(['-i', inputName, '-vf', filtroTranspose, '-c:a', 'copy', outputName]);

      const data = await ffmpeg.readFile(outputName);
      const bytes = new Uint8Array(data as Uint8Array);
      const blob = new Blob([bytes], { type: 'video/mp4' });
      setResultUrl(URL.createObjectURL(blob));
      setResultNome(nomeSaida(arquivo.name));
      setProgresso(100);

      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch (e) {
      console.error(e);
      setErro('Não foi possível processar este vídeo. Tente novamente ou use outro arquivo.');
    } finally {
      setProcessando(false);
    }
  };

  const girado = rotacao === 90 || rotacao === 270;
  const tamanhoMb = arquivo ? (arquivo.size / (1024 * 1024)).toFixed(1) : null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-[#0F172A] py-12">
      <Analytics />

      <main className="container mx-auto px-6 max-w-3xl">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight mb-2">Rotacionar Vídeo</h2>
          <p className="text-[#64748B] text-sm">Gire um vídeo horizontal para vertical (ou vice-versa) e baixe o resultado. Todo o processamento acontece no seu navegador — nada é enviado para nossos servidores.</p>
        </div>

        {!arquivo ? (
          <label className="flex flex-col items-center justify-center gap-3 bg-white rounded-2xl border-2 border-dashed border-[#CBD5E1] hover:border-[#336699] transition-colors cursor-pointer py-16 px-6 text-center">
            <div className="w-14 h-14 bg-blue-50 text-[#336699] rounded-2xl flex items-center justify-center text-2xl shadow-sm">
              🎬
            </div>
            <span className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Selecionar vídeo</span>
            <span className="text-xs text-[#64748B]">Clique aqui ou arraste um arquivo de vídeo</span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleSelecionarArquivo(e.target.files?.[0] || null)}
            />
          </label>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-6 md:p-8">
            <div className="flex items-center justify-between mb-6 gap-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-[#0C1D4D] truncate">{arquivo.name}</p>
                <p className="text-xs text-[#94A3B8] font-medium">{tamanhoMb} MB</p>
              </div>
              <button
                onClick={trocarVideo}
                className="shrink-0 text-[10px] font-black uppercase tracking-widest text-[#336699] hover:text-[#0C1D4D] transition-colors"
              >
                Trocar vídeo
              </button>
            </div>

            <div className="flex items-center justify-center bg-black rounded-xl overflow-hidden mb-6" style={{ height: 380 }}>
              <video
                src={videoUrl || undefined}
                controls
                className="transition-transform duration-300"
                style={{
                  maxHeight: girado ? 320 : 380,
                  maxWidth: girado ? 220 : '100%',
                  transform: `rotate(${rotacao}deg)`,
                }}
              />
            </div>

            <div className="flex items-center justify-center gap-4 mb-2">
              <button
                onClick={() => setRotacao((r) => girar(r, -90))}
                disabled={processando}
                className="w-14 h-14 rounded-xl bg-[#F0F4F8] hover:bg-[#E2E8F0] border border-[#CBD5E1] text-2xl flex items-center justify-center transition-colors disabled:opacity-40"
                title="Girar 90° à esquerda (anti-horário)"
              >
                ⟲
              </button>
              <span className="text-sm font-black text-[#0C1D4D] w-14 text-center tabular-nums">{rotacao}°</span>
              <button
                onClick={() => setRotacao((r) => girar(r, 90))}
                disabled={processando}
                className="w-14 h-14 rounded-xl bg-[#F0F4F8] hover:bg-[#E2E8F0] border border-[#CBD5E1] text-2xl flex items-center justify-center transition-colors disabled:opacity-40"
                title="Girar 90° à direita (horário)"
              >
                ⟳
              </button>
            </div>
            <p className="text-center text-xs text-[#64748B] mb-8">Use as setas para girar até o vídeo ficar na orientação desejada.</p>

            {erro && (
              <p className="text-center text-xs text-red-500 font-bold bg-red-50 py-2 rounded-lg border border-red-100 mb-6">{erro}</p>
            )}

            {processando && (
              <div className="mb-6">
                <div className="w-full h-2 bg-[#F0F4F8] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#336699] transition-all duration-200"
                    style={{ width: `${progresso}%` }}
                  />
                </div>
                <p className="text-center text-[10px] font-black uppercase tracking-widest text-[#64748B] mt-2">
                  {carregandoFerramenta ? 'Carregando ferramenta de vídeo...' : `Processando... ${progresso}%`}
                </p>
              </div>
            )}

            <button
              onClick={handleProcessar}
              disabled={rotacao === 0 || processando}
              className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-40"
            >
              {processando ? 'Processando vídeo...' : rotacao === 0 ? 'Gire o vídeo para continuar' : 'Processar e gerar vídeo rotacionado'}
            </button>

            {resultUrl && (
              <div className="mt-8 pt-8 border-t border-[#F1F5F9]">
                <p className="text-center text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-4">Vídeo pronto 🎉</p>
                <div className="flex items-center justify-center bg-black rounded-xl overflow-hidden mb-6" style={{ height: 380 }}>
                  <video src={resultUrl} controls className="max-h-full max-w-full" />
                </div>
                <a
                  href={resultUrl}
                  download={resultNome}
                  className="block w-full text-center bg-[#336699] hover:bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs py-4 rounded-xl shadow-md transition-all active:scale-[0.98]"
                >
                  Baixar vídeo rotacionado
                </a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
