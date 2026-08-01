// Copia os arquivos do núcleo do ffmpeg.wasm de node_modules para public/, para
// que sejam servidos como assets estáticos same-origin em vez de buscados de um
// CDN externo a cada uso (reduz latência do primeiro carregamento e remove uma
// dependência externa). Roda antes do build (ver "prebuild" em package.json).
const fs = require('fs');
const path = require('path');

// Usa a build UMD (não a ESM): o worker interno do @ffmpeg/ffmpeg carrega o core
// via `importScripts()` (funciona com UMD); se isso falhar ele cai num `import()`
// dinâmico que o bundler do Next.js não consegue resolver (trava em runtime).
const srcDir = path.join(__dirname, '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');
const destDir = path.join(__dirname, '..', 'public', 'ffmpeg-core');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

fs.mkdirSync(destDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  console.log(`[copy-ffmpeg-core] ${file} copiado para public/ffmpeg-core/`);
}
