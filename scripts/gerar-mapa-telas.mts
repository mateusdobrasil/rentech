// scripts/gerar-mapa-telas.mts — roda junto com `npm run manuais`.
// Lê os cards do Painel (app/admin/page.tsx) e de cada hub
// (app/admin/<hub>/page.tsx) e gera app/lib/ajuda/mapaTelas.ts: o caminho de
// menu que a pessoa vê ("Painel → RH → Gestão de Ponto"), a descrição do card
// e a rota. O assistente dos Manuais usa isso para dizer ONDE fica cada tela;
// quem pode abrir cada rota vem, na hora, de parametros_paginas_permissoes.
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');
const ADMIN = path.join(RAIZ, 'app', 'admin');
const SAIDA = path.join(RAIZ, 'app', 'lib', 'ajuda', 'mapaTelas.ts');

const STR = String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`[^\`]*\`)`;
const literal = (s: string) => s.slice(1, -1).replace(/\\(['"\\`])/g, '$1').replace(/\\n/g, ' ').trim();

interface Card { titulo: string; descricao: string; rota: string }

function cardsDe(arquivo: string): Card[] {
  if (!fs.existsSync(arquivo)) return [];
  const src = fs.readFileSync(arquivo, 'utf8');
  const cards: Card[] = [];
  const reTitulo = new RegExp(`titulo:\\s*${STR}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = reTitulo.exec(src))) {
    // o resto do mesmo objeto: até o próximo "titulo:" ou 900 caracteres
    const prox = src.indexOf('titulo:', m.index + 7);
    const trecho = src.slice(m.index, prox > 0 ? Math.min(prox, m.index + 900) : m.index + 900);
    const d = new RegExp(`descricao:\\s*${STR}`).exec(trecho);
    const l = new RegExp(`link:\\s*${STR}`).exec(trecho);
    if (!l) continue;
    const rota = literal(l[1]);
    if (!rota.startsWith('/')) continue;
    cards.push({ titulo: literal(m[1]), descricao: d ? literal(d[1]) : '', rota });
  }
  return cards;
}

const raiz = cardsDe(path.join(ADMIN, 'page.tsx'));
const telas: { rota: string; caminho: string; descricao: string }[] = [];
const visto = new Set<string>();
const add = (rota: string, caminho: string, descricao: string) => {
  if (visto.has(rota)) return;
  visto.add(rota);
  telas.push({ rota, caminho, descricao });
};

for (const c of raiz) {
  add(c.rota, `Painel → ${c.titulo}`, c.descricao);
  // hub: /admin/<pasta> com page.tsx que tem cards próprios
  const pasta = c.rota.replace(/^\/admin\/?/, '');
  if (!pasta || pasta.includes('/')) continue;
  for (const s of cardsDe(path.join(ADMIN, pasta, 'page.tsx'))) {
    if (s.rota === c.rota) continue;
    add(s.rota, `Painel → ${c.titulo} → ${s.titulo}`, s.descricao);
  }
}

telas.sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'));
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, [
  '// GERADO por scripts/gerar-mapa-telas.mts (npm run manuais) — não editar à mão.',
  '// Caminho de menu de cada tela, tirado dos cards do Painel e dos hubs.',
  'export interface TelaMapa { rota: string; caminho: string; descricao: string }',
  `export const MAPA_TELAS: TelaMapa[] = ${JSON.stringify(telas, null, 2)};`,
  '',
].join('\n'));
console.log(`mapa de telas: ${telas.length} telas (${raiz.length} no Painel)`);
