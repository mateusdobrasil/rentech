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
import { Buffer } from 'node:buffer';

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

function protocolo(): string {
  return process.env.P2S_API_PROTOCOLO || 'http';
}

function host(): string | undefined {
  return process.env.P2S_API_HOST;
}

function porta(): string | undefined {
  return process.env.P2S_API_PORTA;
}

function usuario(): string | undefined {
  return process.env.P2S_API_USUARIO;
}

function senha(): string | undefined {
  return process.env.P2S_API_SENHA;
}

export function credenciaisP2sConfiguradas(): boolean {
  return !!(host() && porta() && usuario() && senha());
}

export interface StatusCredenciaisP2s {
  hostConfigurado: boolean;
  portaConfigurada: boolean;
  usuarioConfigurado: boolean;
  senhaConfigurada: boolean;
}

export function statusCredenciaisP2s(): StatusCredenciaisP2s {
  return {
    hostConfigurado: !!host(),
    portaConfigurada: !!porta(),
    usuarioConfigurado: !!usuario(),
    senhaConfigurada: !!senha(),
  };
}

function baseUrl(): string {
  if (!host() || !porta()) {
    throw new Error('Servidor da API do PrimeStart não configurado (P2S_API_HOST / P2S_API_PORTA ausentes no ambiente do servidor).');
  }
  return `${protocolo()}://${host()}:${porta()}`;
}

function authHeader(): string {
  const u = usuario(), s = senha();
  if (!u || !s) {
    throw new Error('Credenciais da API do PrimeStart não configuradas no servidor (P2S_API_USUARIO / P2S_API_SENHA ausentes).');
  }
  return `Basic ${Buffer.from(`${u}:${s}`).toString('base64')}`;
}

interface RespostaP2s<T> { status: number; ok: boolean; data: T | null; textoErro?: string; }

async function chamar<T>(path: string, init: { method: string; body?: unknown; query?: Record<string, string | undefined> } ): Promise<RespostaP2s<T>> {
  const url = new URL(baseUrl() + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: init.method,
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });

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
export async function consultarObjetos(classname: string, criterialist: CriterioP2s[] = [], opcoes: OpcoesConsultaP2s = {}): Promise<ConsultaP2sResultado> {
  const resp = await chamar<ConsultaP2sResultado>('/qpo', {
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
export async function buscarObjeto(oid: string): Promise<ObjetoP2s | null> {
  const resp = await chamar<ObjetoP2s>(`/objects/${encodeURIComponent(oid)}`, { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok || !resp.data) {
    throw new Error(`Falha ao buscar objeto ${oid} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
  return resp.data;
}

// GET /canupdate/{oid} — checa se ninguém mais editou o objeto desde a
// última carga (referencetimestamp = lastupdatetimestamp obtido antes).
export async function podeAtualizar(oid: string, referenceTimestamp: number): Promise<boolean> {
  const resp = await chamar<{ canupdate: string }>(`/canupdate/${encodeURIComponent(oid)}`, {
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
export async function atualizarObjeto(classname: string, oid: string, campos: Record<string, unknown>): Promise<void> {
  const resp = await chamar<never>(`/objects/${encodeURIComponent(oid)}`, {
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
export async function criarObjeto(classname: string): Promise<ObjetoP2s> {
  const resp = await chamar<ObjetoP2s>(`/classes/${encodeURIComponent(classname)}`, { method: 'POST' });
  if (!resp.ok || !resp.data) {
    throw new Error(`Falha ao criar objeto ${classname} no PrimeStart (HTTP ${resp.status}): ${resp.textoErro || 'resposta inválida'}`);
  }
  return resp.data;
}

// DELETE /objects/{oid} — remove um objeto primitivo (desiste da criação) ou
// persistido (falha com 409 se houver vínculo de integridade referencial).
export async function excluirObjeto(oid: string): Promise<void> {
  const resp = await chamar<never>(`/objects/${encodeURIComponent(oid)}`, { method: 'DELETE' });
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
export async function testarConexao(): Promise<{ ok: true; count: 0 } | { ok: false; erro: string }> {
  try {
    const resultado = await consultarObjetos('TCustomParceiro', [criterio('CodigoParceiro', 'eq', 'int', -1)]);
    return { ok: true, count: resultado.count as 0 };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
