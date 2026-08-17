// app/lib/p2s.ts
// Cliente da API REST do PrimeStart (ERP da P2S Tecnologia) — servidor de
// objetos acessado por HTTP com Basic Auth. Baseado no "PrimeStart API -
// Manual de Uso (v. 0.1)" e num segundo texto de apoio colados pelo usuário
// em 2026-08-07.
//
// Pontos importantes:
// - Autenticação é Basic Auth (usuário:senha da API, distintos dos logins de
//   usuário do PrimeStart) — não é OAuth nem token.
// - Um objeto é identificado por um oid ("P,123" = persistente, "N,123" =
//   não-persistente/utilitário), e sempre pertence a uma classname (ex:
//   TCustomParceiro, TCustomPagamento).
// - DIVERGÊNCIA ENTRE AS DUAS FONTES: o manual PDF mostra "propvalue" como
//   valor escalar (string/número solto) num criterialist; o segundo texto
//   (mais detalhado, já cita subclasses/proxy/order que o PDF nem menciona)
//   mostra "propvalue" como ARRAY, com semântica explícita de OR entre os
//   valores do mesmo critério. Adotamos o formato array aqui (por ser a
//   fonte mais completa) — criterio() abaixo aceita valor único ou array e
//   normaliza para array antes de montar o JSON.
// - Datas/horários do PrimeStart são um double: parte inteira = dias desde
//   30/12/1899 (0 = data nula/em branco), parte fracionária = fração do dia.
// - PUT /objects/{oid} exige classname, oid, name ("" sempre) e
//   lastupdatetimestamp (0 sempre) no corpo, além dos campos alterados — a
//   API não valida nada disso, quem monta o JSON é responsável pela
//   integridade dos dados.
// - Criação de objeto (POST /classes/{classname}) deixa o objeto "primitivo"
//   (invisível para outras consultas) até o primeiro Update — só aí ele fica
//   "persistido" de verdade.
// - Erros de Update (PUT) voltam como STRING PURA no corpo (não é JSON).
//
// Sandbox vs Produção (2026-08-07): a instância "rentech.cloud.primestart.net"
// configurada em P2S_API_HOST/PORTA/USUARIO/SENHA deu timeout em TODAS as
// portas testadas (55000/443/80) e nem respondeu ping — host errado ou
// instância fora do ar, a confirmar com a P2S. Enquanto isso, o ambiente
// SANDBOX usa por padrão a instância Demo pública e sempre-disponível da P2S
// (demo.cloud.primestart.net:55000, admin/admin, documentada no manual), sem
// depender de nenhuma env var — testada e funcionando de ponta a ponta nesse
// mesmo dia. As env vars sem sufixo (P2S_API_HOST etc.) são tratadas como as
// credenciais de PRODUCAO (o host real do cliente).
import { Buffer } from 'node:buffer';

export type AmbienteP2s = 'SANDBOX' | 'PRODUCAO';

export type OperadorP2s = 'eq' | 'ne' | 'lk' | 'gt' | 'ge' | 'lt' | 'le';
export type TipoValorP2s = 'str' | 'int' | 'dbl' | 'bool';

export interface CriterioP2s {
  propname: string;
  operator: OperadorP2s;
  propvaluetype: TipoValorP2s;
  propvalue: (string | number | boolean)[];
}

export interface ObjetoP2s {
  classname: string;
  oid: string;
  name: string;
  lastupdatetimestamp: number;
  [campo: string]: unknown;
}

export interface ConsultaP2sResultado {
  count: number;
  oidlist: string[];
  objectlist: ObjetoP2s[];
}

// Monta um critério de busca aceitando um valor único ou vários (OR entre
// eles) — ver nota sobre a divergência de formato no topo do arquivo.
export function criterio(
  propname: string, operator: OperadorP2s, propvaluetype: TipoValorP2s,
  propvalue: string | number | boolean | (string | number | boolean)[]
): CriterioP2s {
  return { propname, operator, propvaluetype, propvalue: Array.isArray(propvalue) ? propvalue : [propvalue] };
}

// Filtrar por um campo de REFERÊNCIA (ex: "Evento eq P,573460") exige
// propvaluetype "int" com só a parte numérica do oid — testado empiricamente
// em 2026-08-10: propvaluetype "str" com o oid completo ("P,573460") não dá
// erro nenhum, só IGNORA o critério silenciosamente e devolve tudo (só
// percebido comparando contra um oid propositalmente inexistente, que
// devolveu a mesma contagem). Usar esta função pra montar esse tipo de
// critério em vez de criterio() direto evita reproduzir esse bug.
export function criterioRef(propname: string, oid: string): CriterioP2s {
  const numero = Number(oid.split(',')[1]);
  return criterio(propname, 'eq', 'int', numero);
}

// PrimeStart guarda datas como dias desde 30/12/1899 (double; 0 = nula) e
// horários como fração do dia na parte decimal.
const EPOCA_P2S = Date.UTC(1899, 11, 30);

export function p2sParaData(valor: number): Date | null {
  if (!valor) return null;
  return new Date(EPOCA_P2S + valor * 86_400_000);
}

export function dataParaP2s(data: Date): number {
  return (data.getTime() - EPOCA_P2S) / 86_400_000;
}

// Instância Demo pública da P2S (ver "Ambiente de Testes" no manual) — uso
// livre, dados voláteis, mas sempre no ar. Serve de fallback do ambiente
// SANDBOX quando não há override por env var.
const SANDBOX_PADRAO = { protocolo: 'http', host: 'demo.cloud.primestart.net', porta: '55000', usuario: 'admin', senha: 'admin' };

interface CredenciaisP2s { protocolo: string; host?: string; porta?: string; usuario?: string; senha?: string; }

// Env vars com sufixo por ambiente (P2S_API_HOST_SANDBOX / _PRODUCAO) têm
// prioridade. Na ausência delas: SANDBOX cai pro Demo público (sempre
// funciona, sem configuração nenhuma); PRODUCAO cai pras env vars legadas
// sem sufixo (P2S_API_HOST etc.), que é o que já está configurado hoje no
// servidor para o host real do cliente.
function credenciaisAmbiente(ambiente: AmbienteP2s): CredenciaisP2s {
  const sufixo = `_${ambiente}`;
  const host = process.env[`P2S_API_HOST${sufixo}`] || (ambiente === 'PRODUCAO' ? process.env.P2S_API_HOST : undefined) || (ambiente === 'SANDBOX' ? SANDBOX_PADRAO.host : undefined);
  const porta = process.env[`P2S_API_PORTA${sufixo}`] || (ambiente === 'PRODUCAO' ? process.env.P2S_API_PORTA : undefined) || (ambiente === 'SANDBOX' ? SANDBOX_PADRAO.porta : undefined);
  const usuario = process.env[`P2S_API_USUARIO${sufixo}`] || (ambiente === 'PRODUCAO' ? process.env.P2S_API_USUARIO : undefined) || (ambiente === 'SANDBOX' ? SANDBOX_PADRAO.usuario : undefined);
  const senha = process.env[`P2S_API_SENHA${sufixo}`] || (ambiente === 'PRODUCAO' ? process.env.P2S_API_SENHA : undefined) || (ambiente === 'SANDBOX' ? SANDBOX_PADRAO.senha : undefined);
  const protocolo = process.env[`P2S_API_PROTOCOLO${sufixo}`] || process.env.P2S_API_PROTOCOLO || SANDBOX_PADRAO.protocolo;
  return { protocolo, host, porta, usuario, senha };
}

export function credenciaisP2sConfiguradas(ambiente: AmbienteP2s): boolean {
  const c = credenciaisAmbiente(ambiente);
  return !!(c.host && c.porta && c.usuario && c.senha);
}

export interface StatusCredenciaisP2sAmbiente {
  hostConfigurado: boolean;
  portaConfigurada: boolean;
  usuarioConfigurado: boolean;
  senhaConfigurada: boolean;
  host?: string;
}

export interface StatusCredenciaisP2s {
  sandbox: StatusCredenciaisP2sAmbiente;
  producao: StatusCredenciaisP2sAmbiente;
}

function statusAmbiente(ambiente: AmbienteP2s): StatusCredenciaisP2sAmbiente {
  const c = credenciaisAmbiente(ambiente);
  return {
    hostConfigurado: !!c.host, portaConfigurada: !!c.porta,
    usuarioConfigurado: !!c.usuario, senhaConfigurada: !!c.senha,
    host: c.host,
  };
}

export function statusCredenciaisP2s(): StatusCredenciaisP2s {
  return { sandbox: statusAmbiente('SANDBOX'), producao: statusAmbiente('PRODUCAO') };
}

function baseUrl(ambiente: AmbienteP2s): string {
  const c = credenciaisAmbiente(ambiente);
  if (!c.host || !c.porta) {
    throw new Error(`Servidor da API do PrimeStart não configurado para o ambiente ${ambiente} (host/porta ausentes no ambiente do servidor).`);
  }
  return `${c.protocolo}://${c.host}:${c.porta}`;
}

function authHeader(ambiente: AmbienteP2s): string {
  const c = credenciaisAmbiente(ambiente);
  if (!c.usuario || !c.senha) {
    throw new Error(`Credenciais da API do PrimeStart não configuradas para o ambiente ${ambiente} (usuário/senha ausentes).`);
  }
  return `Basic ${Buffer.from(`${c.usuario}:${c.senha}`).toString('base64')}`;
}

interface RespostaP2s<T> { status: number; ok: boolean; data: T | null; textoErro?: string; }

async function chamar<T>(ambiente: AmbienteP2s, path: string, init: { method: string; body?: unknown; query?: Record<string, string | undefined> }): Promise<RespostaP2s<T>> {
  const url = new URL(baseUrl(ambiente) + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(ambiente) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch (e: any) {
    // O fetch nativo só diz "fetch failed" — a causa de verdade (DNS,
    // conexão recusada, timeout) vem em e.cause. Sem isso, "fetch failed"
    // sozinho não dá pra diferenciar host errado de firewall/allowlist
    // bloqueando a conexão (ver nota de diagnóstico no topo do arquivo).
    const causa = e?.cause?.code || e?.cause?.message || e?.cause || e?.message;
    throw new Error(`Não foi possível conectar ao servidor do PrimeStart (${ambiente}) em ${url.hostname}:${url.port} (${causa}). Se o host/porta estiverem certos, provavelmente é bloqueio de firewall/allowlist de IP no servidor — confirme com a P2S se é preciso liberar o IP de saída deste servidor.`);
  }

  // 204 (no content, sucesso de Update/Delete) não tem corpo JSON.
  if (res.status === 204) return { status: res.status, ok: true, data: null };

  const bruto = await res.text();
  if (!bruto) return { status: res.status, ok: res.ok, data: null };

  // Respostas de erro (400) vêm como string simples, não JSON — ver nota no
  // topo do arquivo.
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(bruto) as T };
  } catch {
    return { status: res.status, ok: res.ok, data: null, textoErro: bruto };
  }
}

export interface OpcoesConsultaP2s {
  subclasses?: boolean;
  proxy?: boolean;
  order?: string;
}

// POST /qpo — Query Persistent Objects: busca por critérios (AND entre
// critérios, OR entre valores dentro do mesmo critério).
export async function consultarObjetos(ambiente: AmbienteP2s, classname: string, criterialist: CriterioP2s[] = [], opcoes: OpcoesConsultaP2s = {}): Promise<ConsultaP2sResultado> {
  const resp = await chamar<ConsultaP2sResultado>(ambiente, '/qpo', {
    method: 'POST',
    query: {
      classname,
      subclasses: opcoes.subclasses !== undefined ? String(opcoes.subclasses) : undefined,
      proxy: opcoes.proxy !== undefined ? String(opcoes.proxy) : undefined,
      order: opcoes.order,
    },
    body: { criterialist },
  });
  if (!resp.ok || !resp.data) {
    throw new Error(`Falha ao consultar ${classname} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
  return resp.data;
}

// GET /objects/{oid} — Retrieve: busca um único objeto já conhecido pelo oid.
export async function buscarObjeto(ambiente: AmbienteP2s, oid: string): Promise<ObjetoP2s | null> {
  const resp = await chamar<ObjetoP2s>(ambiente, `/objects/${encodeURIComponent(oid)}`, { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok || !resp.data) {
    throw new Error(`Falha ao buscar objeto ${oid} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
  return resp.data;
}

// GET /canupdate/{oid} — checa se ninguém mais editou o objeto desde a
// última carga (referencetimestamp = lastupdatetimestamp obtido antes).
export async function podeAtualizar(ambiente: AmbienteP2s, oid: string, referenceTimestamp: number): Promise<boolean> {
  const resp = await chamar<{ canupdate: string }>(ambiente, `/canupdate/${encodeURIComponent(oid)}`, {
    method: 'GET',
    query: { referencetimestamp: String(referenceTimestamp) },
  });
  if (!resp.ok || !resp.data) {
    throw new Error(`Falha ao checar canupdate de ${oid} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
  return resp.data.canupdate === 'true';
}

// PUT /objects/{oid}?saveparts=false — Update. `campos` são só as
// propriedades alteradas; classname/oid/name/lastupdatetimestamp são
// preenchidos automaticamente conforme exigido pela API (name sempre "",
// lastupdatetimestamp sempre 0 no corpo do PUT).
export async function atualizarObjeto(ambiente: AmbienteP2s, classname: string, oid: string, campos: Record<string, unknown>): Promise<void> {
  const resp = await chamar<never>(ambiente, `/objects/${encodeURIComponent(oid)}`, {
    method: 'PUT',
    query: { saveparts: 'false' },
    body: { classname, oid, name: '', lastupdatetimestamp: 0, ...campos },
  });
  if (!resp.ok) {
    throw new Error(`Falha ao atualizar ${oid} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
}

// POST /classes/{classname} — Create: reserva um oid e devolve o objeto
// "primitivo" com os valores default do construtor. Fica invisível para
// outras consultas até o primeiro Update (ver atualizarObjeto).
export async function criarObjeto(ambiente: AmbienteP2s, classname: string): Promise<ObjetoP2s> {
  const resp = await chamar<ObjetoP2s>(ambiente, `/classes/${encodeURIComponent(classname)}`, { method: 'POST' });
  if (!resp.ok || !resp.data) {
    throw new Error(`Falha ao criar objeto ${classname} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
  return resp.data;
}

// DELETE /objects/{oid} — remove um objeto primitivo (desiste da criação) ou
// persistido (falha com 409 se houver vínculo de integridade referencial).
export async function excluirObjeto(ambiente: AmbienteP2s, oid: string): Promise<void> {
  const resp = await chamar<never>(ambiente, `/objects/${encodeURIComponent(oid)}`, { method: 'DELETE' });
  if (!resp.ok) {
    if (resp.status === 409) throw new Error(`Objeto ${oid} não pode ser excluído no PrimeStart: está vinculado a outro objeto (conflito de integridade referencial).`);
    if (resp.status === 404) throw new Error(`Objeto ${oid} não encontrado no PrimeStart.`);
    throw new Error(`Falha ao excluir ${oid} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
}

// Teste de conectividade/autenticação leve — consulta TCustomParceiro com um
// critério que nunca bate (CodigoParceiro = -1), então count vem sempre 0
// independente do tamanho da base, mas o round-trip completo (rede + Basic
// Auth + parse do JSON) é exercitado de verdade.
export async function testarConexao(ambiente: AmbienteP2s): Promise<{ ok: true; count: 0 } | { ok: false; erro: string }> {
  try {
    const resultado = await consultarObjetos(ambiente, 'TCustomParceiro', [criterio('CodigoParceiro', 'eq', 'int', -1)]);
    return { ok: true, count: resultado.count as 0 };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
