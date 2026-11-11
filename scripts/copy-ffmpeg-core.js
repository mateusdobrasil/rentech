// Copia o ffmpeg.wasm de node_modules para public/, para ser servido como asset
// estático same-origin (sem CDN externo). Roda antes do dev e do build (ver
// "dev"/"prebuild" em package.json).
//
// Duas partes:
// 1. public/ffmpeg/ — a biblioteca @ffmpeg/ffmpeg (ESM, com o worker.js). Desde o
//    Next 16.4 o Turbopack recusa empacotar o `new Worker(new URL(variável,
//    import.meta.url))` de dentro dela (build quebrava), então a página
//    /rotacionar-video importa estes arquivos em runtime com
//    `import(/* turbopackIgnore: true */ '/ffmpeg/index.js')` e o navegador
//    resolve os imports relativos e o worker sozinho.
// 2. public/ffmpeg-core/ — o núcleo (wasm). Build ESM: o worker acima roda como
//    "module", onde `importScripts()` não existe; ele cai no `import()` dinâmico,
//    que precisa do `export default` da build ESM (a UMD não tem).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');

function copiar(srcDir, destDir, arquivos, rotulo) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const arquivo of arquivos) {
    fs.copyFileSync(path.join(srcDir, arquivo), path.join(destDir, arquivo));
  }
  console.log(`[copy-ffmpeg-core] ${arquivos.length} arquivo(s) de ${rotulo} copiado(s) para ${path.relative(raiz, destDir)}/`);
}

// 1. Biblioteca (todos os .js da build ESM — index importa classes, que importa const/utils/errors; worker importa const/errors)
const libSrc = path.join(raiz, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');
const libArquivos = fs.readdirSync(libSrc).filter(f => f.endsWith('.js'));
copiar(libSrc, path.join(raiz, 'public', 'ffmpeg'), libArquivos, '@ffmpeg/ffmpeg');

// 2. Núcleo
copiar(
  path.join(raiz, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm'),
  path.join(raiz, 'public', 'ffmpeg-core'),
  ['ffmpeg-core.js', 'ffmpeg-core.wasm'],
  '@ffmpeg/core',
);
