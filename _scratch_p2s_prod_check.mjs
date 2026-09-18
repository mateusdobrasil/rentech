// Teste SÓ DE LEITURA em produção (rentech.cloud.primestart.net): confirma o
// formato da resposta de PodeMarcarComoQuitado numa conta JÁ quitada há
// tempos. NÃO chama MarcarComoQuitado aqui.
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : null;
};
const host = get('P2S_API_HOST');
const porta = get('P2S_API_PORTA');
const usuario = get('P2S_API_USUARIO');
const senha = get('P2S_API_SENHA');
const protocolo = get('P2S_API_PROTOCOLO') || 'http';

const BASE = `${protocolo}://${host}:${porta}`;
const AUTH = 'Basic ' + Buffer.from(`${usuario}:${senha}`).toString('base64');
console.log('Base:', BASE);

async function chamar(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: AUTH },
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch {}
  return { status: res.status, ok: res.ok, json, texto };
}

// Acha uma conta JÁ quitada e ANTIGA (vencimento bem no passado, pra reduzir
// ainda mais qualquer chance de ser algo em fluxo ativo).
const consulta = await chamar('/qpo?classname=TCustomContaPagar', {
  method: 'POST',
  body: JSON.stringify({
    criterialist: [
      { propname: 'FlagQuitado', operator: 'eq', propvaluetype: 'bool', propvalue: [true] },
    ],
    order: 'DataVencimento',
  }),
});
console.log('Contas quitadas encontradas:', consulta.json?.count);
const oid = consulta.json?.oidlist?.[0];
console.log('OID escolhido (vencimento mais antigo):', oid);
if (!oid) { console.log('Nenhuma conta quitada encontrada — abortando.'); process.exit(0); }

const objeto = await chamar(`/objects/${encodeURIComponent(oid)}`, { method: 'GET' });
console.log('Descricao:', objeto.json?.Descricao, '| DataVencimento(serial):', objeto.json?.DataVencimento, '| FlagQuitado:', objeto.json?.FlagQuitado);

// SÓ LEITURA — checagem, sem alterar nada.
const pode = await chamar(`/methods/TCustomContaPagar.PodeMarcarComoQuitado?oid=${encodeURIComponent(oid)}`, {
  method: 'POST',
  body: JSON.stringify({ paramlist: [] }),
});
console.log('\nPodeMarcarComoQuitado -> HTTP', pode.status);
console.log('json:', JSON.stringify(pode.json, null, 2));
console.log('texto (se não for JSON):', pode.texto);
