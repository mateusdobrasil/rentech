"use client";

import BackButton from '../BackButton';

// Ajuste este caminho para trocar o vídeo de teste vertical (arquivos em /public/videos)
const VIDEO_SRC = '/videos/VIDEO-2025-09-14-23-14-16.mp4';

export default function VideoVertical() {
  return (
    <>
      <BackButton />

      <div className="relative w-full h-[calc(100vh-5rem)] bg-black flex items-center justify-center">
        <video
          src={encodeURI(VIDEO_SRC)}
          className="h-full w-full object-contain"
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
