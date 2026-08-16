"use client";

import BackButton from '../BackButton';

// Ajuste este caminho para trocar o vídeo de teste horizontal (arquivos em /public/videos)
const VIDEO_SRC = '/videos/Rio Open - Claro.mp4';

export default function VideoHorizontal() {
  return (
    <>
      <BackButton />

      <div className="relative w-full h-[calc(100vh-5rem)] bg-black flex items-center justify-center">
        <video
          src={encodeURI(VIDEO_SRC)}
          className="w-full h-full object-contain"
          autoPlay
          loop
          muted
          playsInline
          controls
        />
      </div>
    </>
  );
}
