// scripts/gerar-manuais.mts — `npm run manuais` (2026-11-23)
// Gera app/admin/manuais/conteudo/<slug>.ts a partir das fontes do catálogo
// (app/admin/manuais/catalogo.ts): Markdown → HTML (marked) com as imagens
// embutidas em base64 e o sumário (títulos ##); PDF → base64. O conteúdo vai
// junto do código do servidor (sem ler arquivo em tempo de execução) e só é
// entregue pela action, depois de checar o acesso.
import fs from 'node:fs';
import path from 'node:path';
import { Marked, type Tokens } from 'marked';
import { MANUAIS } from '../app/admin/manuais/catalogo';

const RAIZ = process.cwd();
const SAIDA = path.join(RAIZ, 'app/admin/manuais/conteudo');
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const semTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
// Mesmo formato de âncora do GitHub, para os sumários escritos à mão (#1-visão-geral).
const ancora = (s: string) => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

function gerarHtml(arquivo: string) {
  const dir = path.dirname(arquivo);
  let md = fs.readFileSync(arquivo, 'utf8');
  // O título vem do catálogo: tira o "# Título" do topo, se houver.
  md = md.replace(/^(\s*!\[[^\]]*\]\([^)]*\)\s*\n)?\s*# [^\n]*\n/, (_, img) => img || '');
  const sumario: { id: string; texto: string }[] = [];
  const usados = new Map<string, number>();
  let imagens = 0;
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: any, t: Tokens.Heading) {
        const html = this.parser.parseInline(t.tokens);
        const texto = semTags(html);
        let id = ancora(texto) || `secao-${usados.size + 1}`;
        const n = usados.get(id) || 0; usados.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (t.depth === 2) sumario.push({ id, texto });
        return `<h${t.depth} id="${id}">${html}</h${t.depth}>\n`;
      },
      image(t: Tokens.Image) {
        const alvo = path.resolve(dir, decodeURI(t.href));
        const mime = MIME[path.extname(alvo).toLowerCase()];
        if (!mime || !fs.existsSync(alvo)) { console.warn(`  imagem não encontrada: ${t.href}`); return `<em>[${esc(t.text)}]</em>`; }
        imagens++;
        const src = `data:${mime};base64,${fs.readFileSync(alvo).toString('base64')}`;
        return `<span class="figura"><img src="${src}" alt="${esc(t.text)}" loading="lazy" />${t.text ? `<span class="legenda">${esc(t.text)}</span>` : ''}</span>`;
      },
      link(this: any, t: Tokens.Link) {
        const html = this.parser.parseInline(t.tokens);
        if (/\.pdf$/i.test(t.href)) return html; // o PDF tem botão próprio na página
        const externo = /^https?:\/\//i.test(t.href);
        return `<a href="${esc(t.href)}"${externo ? ' target="_blank" rel="noopener noreferrer"' : ''}>${html}</a>`;
      },
    },
  });
  const html = (marked.parse(md) as string)
    .replace(/<table>/g, '<div class="tabela"><table>').replace(/<\/table>/g, '</table></div>');
  return { html, sumario, imagens };
}

fs.mkdirSync(SAIDA, { recursive: true });
const gerados: string[] = [];
for (const m of MANUAIS) {
  const partes: string[] = [`// GERADO por scripts/gerar-manuais.mts — não editar à mão. Fonte: ${m.fonte || m.pdf}`];
  let resumo = '';
  if (m.fonte) {
    const r = gerarHtml(path.join(RAIZ, m.fonte));
    partes.push(`export const html: string = ${JSON.stringify(r.html)};`);
    partes.push(`export const sumario: { id: string; texto: string }[] = ${JSON.stringify(r.sumario)};`);
    resumo += `${r.sumario.length} seções, ${r.imagens} imagens`;
  } else {
    partes.push(`export const html: string | null = null;`, `export const sumario: { id: string; texto: string }[] = [];`);
  }
  if (m.pdf) {
    const b = fs.readFileSync(path.join(RAIZ, m.pdf));
    partes.push(`export const pdf: string | null = ${JSON.stringify(b.toString('base64'))};`);
    resumo += `${resumo ? ', ' : ''}PDF ${(b.length / 1024).toFixed(0)} KB`;
  } else {
    partes.push(`export const pdf: string | null = null;`);
  }
  fs.writeFileSync(path.join(SAIDA, `${m.slug}.ts`), partes.join('\n') + '\n');
  gerados.push(m.slug);
  console.log(`${m.slug}: ${resumo}`);
}

// Índice com import dinâmico: a action só carrega o manual pedido.
const indice = [
  '// GERADO por scripts/gerar-manuais.mts — não editar à mão.',
  'export type ConteudoManual = { html: string | null; sumario: { id: string; texto: string }[]; pdf: string | null };',
  'export const CONTEUDO: Record<string, () => Promise<ConteudoManual>> = {',
  ...gerados.map(s => `  ${JSON.stringify(s)}: () => import(${JSON.stringify(`./${s}`)}),`),
  '};',
  '',
].join('\n');
fs.writeFileSync(path.join(SAIDA, 'index.ts'), indice);
// apaga módulos de manuais que saíram do catálogo
for (const f of fs.readdirSync(SAIDA)) {
  const slug = f.replace(/\.ts$/, '');
  if (f !== 'index.ts' && f.endsWith('.ts') && !gerados.includes(slug)) { fs.unlinkSync(path.join(SAIDA, f)); console.log(`removido: ${f}`); }
}
