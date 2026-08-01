// Copia os arquivos do núcleo multi-thread do ffmpeg.wasm de node_modules para
// public/, para que sejam servidos como assets estáticos same-origin (necessário
// para o site funcionar como "cross-origin isolated" e habilitar o processamento
// em múltiplas threads). Roda antes do build (ver "prebuild" em package.json).
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'node_modules', '@ffmpeg', 'core-mt', 'dist', 'esm');
const destDir = path.join(__dirname, '..', 'public', 'ffmpeg-core-mt');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'];

fs.mkdirSync(destDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  console.log(`[copy-ffmpeg-core] ${file} copiado para public/ffmpeg-core-mt/`);
}
