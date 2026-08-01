import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb'
    }
  },
  async headers() {
    return [
      {
        // Isola a página (cross-origin isolation), exigido pelo navegador para
        // habilitar o núcleo multi-thread do ffmpeg.wasm (via SharedArrayBuffer).
        source: '/rotacionar-video',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  }
};

export default nextConfig;
