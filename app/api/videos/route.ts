import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const videosDir = path.join(process.cwd(), 'public', 'videos');

  // Se a pasta não existir, retorna array vazio
  if (!fs.existsSync(videosDir)) {
    return NextResponse.json([]);
  }

  const files = fs.readdirSync(videosDir).filter((f) =>
    ['.mp4', '.webm', '.mov'].includes(path.extname(f).toLowerCase())
  );

  // Monta os objetos com src e title gerado pelo nome do arquivo
  const videos = files.map((file) => ({
    src: `/videos/${file}`,
    // Remove extensão e troca hífens/underscores por espaço para o título
    title: path.basename(file, path.extname(file)).replace(/[-_]/g, ' '),
  }));

  return NextResponse.json(videos);
}