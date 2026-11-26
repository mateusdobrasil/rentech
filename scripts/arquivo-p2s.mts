// scripts/arquivo-p2s.mts — `npm run arquivo-p2s` (2026-11-25)
// Roda a cópia completa do banco do P2S (app/lib/arquivoP2s.ts) direto deste
// computador, sem o limite de 5 min da Vercel: vai até acabar (ou Ctrl+C —
// retoma de onde parou, igual ao cron). Usa o .env.local (Supabase service
// role + P2S de produção; o cofre de credenciais vence, como no servidor).
//
//   npm run arquivo-p2s            → continua a passada atual até acabar
//   npm run arquivo-p2s -- --nova  → começa uma passada nova (relê tudo, grava por cima)
//
// Só LÊ do P2S. Rode fora do horário de pico do P2S, se der.
import fs from 'node:fs';
import path from 'node:path';

const arquivoEnv = path.join(process.cwd(), '.env.local');
if (fs.existsSync(arquivoEnv)) {
  for (const linha of fs.readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { supabaseAdmin } = await import('../app/lib/supabase');
const { avancarArquivoP2s, novaPassadaArquivo, resumoArquivo } = await import('../app/lib/arquivoP2s');

const db = supabaseAdmin();
if (process.argv.includes('--nova')) console.log(`Passada nova: ${await novaPassadaArquivo(db)}`);

const inicio = Date.now();
let lidos = 0;
let rodadasSemAvanco = 0;
for (;;) {
  const r = await avancarArquivoP2s(db, 10 * 60_000, p => {
    lidos += p.lidos;
    const min = ((Date.now() - inicio) / 60_000).toFixed(1);
    console.log(`${min.padStart(6)} min  ${p.grupo.padEnd(42)} ${p.faixa.padEnd(24)} ${p.erro ? 'ERRO ' + p.erro.slice(0, 120) : `${p.lidos} lido(s)`}  · total ${lidos.toLocaleString('pt-BR')}`);
  });
  if (!r.pendentes) break;
  // Classes com erro ficam de fora da rodada; tenta de novo (faixa menor) até 5 rodadas sem avanço.
  rodadasSemAvanco = r.passos.some(p => !p.erro) ? 0 : rodadasSemAvanco + 1;
  if (rodadasSemAvanco >= 5) { console.log('Parei: só sobraram classes com erro. Veja a tela ou rode de novo mais tarde.'); break; }
}

const s = await resumoArquivo(db);
console.log(`\nPassada ${s.passada}: ${s.concluidas}/${s.classes} classes concluídas · ${s.objetos.toLocaleString('pt-BR')} objetos guardados em p2s_arquivo.`);
if (s.comErro.length) console.log('Com erro:', s.comErro.map(e => `${e.grupo} (${e.erro})`).join('; '));
