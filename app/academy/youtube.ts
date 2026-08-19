// Aceita os formatos comuns de link do YouTube (watch, youtu.be, shorts, embed)
// e devolve a URL de embed — ou null se não for um link do YouTube reconhecível.
export function getYoutubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (u.pathname.startsWith('/embed/')) return `https://www.youtube.com${u.pathname}`;
      if (u.pathname.startsWith('/shorts/')) return `https://www.youtube.com/embed/${u.pathname.replace('/shorts/', '')}`;
    }

    return null;
  } catch {
    return null;
  }
}
