// app/lib/ajuda/indiceManuais.ts
// Texto dos manuais do Hub, dividido por seção (h2/h3), para o assistente
// buscar e ler. Só servidor. Montado na primeira pergunta e guardado na
// instância (os manuais só mudam com deploy). Imagens (base64) e tags saem;
// fica o texto, com o "alt" das imagens (legenda da tela).
import { MANUAIS, podeVerManual, type ManualCatalogo } from '../../admin/manuais/catalogo';
import { CONTEUDO } from '../../admin/manuais/conteudo';

export interface SecaoManual {
  slug: string;
  manual: string;
  secaoId: string;     // id do título (âncora: /admin/manuais/<slug>#<id>)
  titulo: string;
  texto: string;
}

const ENTIDADES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

function paraTexto(html: string): string {
  return html
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' [Tela: $1] ')
    .replace(/<img[^>]*>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(p|li|tr|h[1-6]|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, e => ENTIDADES[e] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

let cache: Promise<SecaoManual[]> | null = null;

async function montar(): Promise<SecaoManual[]> {
  const secoes: SecaoManual[] = [];
  // versões antigas ficam de fora: descrevem telas que já mudaram
  for (const m of MANUAIS.filter(x => x.grupo !== 'ANTIGO')) {
    const carregar = CONTEUDO[m.slug];
    if (!carregar) continue;
    const { html } = await carregar();
    if (!html) continue;
    // corta nos títulos h2/h3; o trecho antes do 1º título vira "Introdução"
    const partes = html.split(/(?=<h[23][^>]*>)/i);
    for (const p of partes) {
      const t = /<h([23])[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/i.exec(p);
      const titulo = t ? paraTexto(t[3]) : 'Introdução';
      const texto = paraTexto(t ? p.slice(t.index + t[0].length) : p);
      if (!texto && !t) continue;
      secoes.push({ slug: m.slug, manual: m.titulo, secaoId: t ? t[2] : '', titulo, texto });
    }
  }
  return secoes;
}

export function secoesManuais(): Promise<SecaoManual[]> {
  if (!cache) cache = montar().catch(e => { cache = null; throw e; });
  return cache;
}

export const manuaisVisiveis = (permissaoNormalizada: string): ManualCatalogo[] =>
  MANUAIS.filter(m => m.grupo !== 'ANTIGO' && podeVerManual(m, permissaoNormalizada));

// ---------------------------------------------------------------------------
// Busca por palavras (sem acento, sem palavras vazias). Título pesa mais.
// ---------------------------------------------------------------------------
const VAZIAS = new Set('a o as os de da do das dos e em no na nos nas um uma uns umas para por com sem que como onde qual quais quando eu meu minha se ser ter tem fica ficam faco faz fazer the to of no ao aos pelo pela pelos pelas mais menos ja nao sim isso este esta esse essa la aqui ou'.split(' '));
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const termos = (s: string) => [...new Set(normalizar(s).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !VAZIAS.has(t)))];

/** Raiz simples: "relatorios" acha "relatorio", "lancar" acha "lancamento". */
const raiz = (t: string) => (t.length > 5 ? t.slice(0, Math.max(5, t.length - 3)) : t);

export function pontuar(alvoTitulo: string, alvoTexto: string, consulta: string[]): number {
  const tit = normalizar(alvoTitulo), txt = normalizar(alvoTexto);
  let p = 0;
  for (const t of consulta) {
    const r = raiz(t);
    if (tit.includes(r)) p += 4;
    const n = txt.split(r).length - 1;
    if (n) p += Math.min(3, 1 + Math.log2(n));
  }
  return p;
}

export function trecho(texto: string, consulta: string[], tam = 320): string {
  const n = normalizar(texto);
  const pos = consulta.map(t => n.indexOf(raiz(t))).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const ini = Math.max(0, pos - 80);
  return (ini > 0 ? '…' : '') + texto.slice(ini, ini + tam).replace(/\s+/g, ' ').trim() + (ini + tam < texto.length ? '…' : '');
}
