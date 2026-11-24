// app/lib/fiscal/focus.ts
// Cliente HTTP da Focus NFe (API v2) — 2026-11-21.
// Autenticação: HTTP Basic com o token da empresa como usuário e senha vazia.
// Homologação e produção têm host e token próprios (FOCUSNFE_TOKEN_HOMOLOGACAO /
// FOCUSNFE_TOKEN_PRODUCAO), do cofre da empresa (Parâmetros → Empresas →
// Credenciais) ou, sem ele, da Vercel. Os caminhos de arquivo (caminho_danfe, caminho_xml…)
// voltam relativos ao host; alguns (url_danfse) já vêm absolutos.

import { segredo } from '../cofre/segredos';

export type AmbienteFiscal = 'HOMOLOGACAO' | 'PRODUCAO';

const HOST: Record<AmbienteFiscal, string> = {
  HOMOLOGACAO: 'https://homologacao.focusnfe.com.br',
  PRODUCAO: 'https://api.focusnfe.com.br',
};

async function token(amb: AmbienteFiscal, empresaId?: number | null) {
  const t = await segredo(`FOCUSNFE_TOKEN_${amb}`, empresaId);
  if (!t) throw new Error(`Token da Focus NFe (${amb === 'PRODUCAO' ? 'produção' : 'homologação'}) não configurado: preencha em Parâmetros → Empresas → Credenciais.`);
  return t;
}
const cabecalho = async (amb: AmbienteFiscal, empresaId?: number | null) => ({ Authorization: 'Basic ' + Buffer.from(`${await token(amb, empresaId)}:`).toString('base64') });

export interface RespostaFocus { http: number; corpo: any }

export async function focus(amb: AmbienteFiscal, metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown, empresaId?: number | null): Promise<RespostaFocus> {
  const r = await fetch(`${HOST[amb]}${caminho}`, {
    method: metodo,
    headers: { ...(await cabecalho(amb, empresaId)), ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(45000),
    cache: 'no-store',
  });
  const texto = await r.text();
  let json: any;
  try { json = texto ? JSON.parse(texto) : {}; } catch { json = { mensagem: texto.slice(0, 500) }; }
  return { http: r.status, corpo: json };
}

export const urlArquivo = (amb: AmbienteFiscal, caminho: string | null | undefined) =>
  !caminho ? null : /^https?:\/\//i.test(caminho) ? caminho : `${HOST[amb]}${caminho.startsWith('/') ? '' : '/'}${caminho}`;

/** Baixa PDF/XML da nota (com o token, caso o arquivo exija). */
export async function baixarArquivo(amb: AmbienteFiscal, caminho: string, empresaId?: number | null): Promise<{ bytes: Buffer; tipo: string }> {
  const url = urlArquivo(amb, caminho)!;
  const mesmoHost = url.startsWith(HOST[amb]);
  const r = await fetch(url, { headers: mesmoHost ? await cabecalho(amb, empresaId) : {}, signal: AbortSignal.timeout(45000), cache: 'no-store' });
  if (!r.ok) throw new Error(`Arquivo indisponível na Focus (HTTP ${r.status}).`);
  return { bytes: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || 'application/octet-stream' };
}

/** Mensagem legível a partir de qualquer corpo de erro da Focus. */
export function mensagemFocus(c: any): string {
  if (!c) return 'Sem resposta da Focus.';
  const erros = Array.isArray(c.erros) ? c.erros.map((e: any) => [e.mensagem, e.campo ? `(${e.campo})` : '', e.correcao ? `— ${e.correcao}` : ''].filter(Boolean).join(' ')).join(' · ') : '';
  return [c.mensagem_sefaz, c.mensagem, erros].filter(Boolean).join(' · ') || c.codigo || 'Erro desconhecido na Focus.';
}
