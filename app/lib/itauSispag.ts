// app/lib/itauSispag.ts
// Cliente da API "Cash Management" (SISPAG) do Itaú — usado para enviar PIX
// da folha direto por API, sem passar pelo arquivo CNAB manual. Baseado na
// Especificação Técnica oficial do Portal do Desenvolvedor Itaú
// (devportal.itau.com.br/nossas-apis/itau-ep9-gtw-sispag-ext, colada pelo
// usuário em 2026-08-04) — fonte mais confiável que o spec OpenAPI e as
// coleções Postman usados nas primeiras versões deste arquivo, que tinham
// URLs e formatos desatualizados/imprecisos em vários pontos.
//
// Pontos importantes:
// - A inclusão de pagamento via API é EXCLUSIVA para Pix (chave, dados
//   bancários ou QR Code). TED/boleto/tributos continuam só pelo SISPAG
//   manual (RH → Financeiro) — a API não aceita esses tipos no POST.
// - Autenticação das chamadas de negócio (/transferencias, /pagamentos_sispag)
//   é OAuth2 + header x-itau-apikey + mTLS (certificado cliente). O
//   certificado é obtido via um fluxo de credenciamento próprio (ver
//   solicitarCertificadoItau) — gerar um par CSR/chave localmente, enviar o
//   CSR ao Itaú (autenticado com um token TEMPORÁRIO DE ATIVAÇÃO fornecido
//   pelo agente comercial — não com o token OAuth normal) e receber de volta
//   um certificado (CRT) assinado.
// - x-itau-apikey = o próprio client_id (documentado explicitamente na
//   Especificação Técnica) — não é um segredo à parte.
// - PENDENTE DE CONFIRMAÇÃO COM O USUÁRIO: a Especificação Técnica descreve
//   o método de autenticação como "Private Key JWT + Mutual-TLS Client
//   Authentication" (RFC 7523 private_key_jwt — sem client_secret, usando um
//   client_assertion JWT assinado + uma jwks_uri pública hospedada pelo
//   cliente), o que conflita com a coleção Postman oficial (que usa
//   grant_type=client_credentials + client_secret em form param, sem JWT).
//   Até isso ser esclarecido, obterToken() abaixo mantém o fluxo
//   client_secret simples da coleção Postman — se o Itaú exigir
//   private_key_jwt de fato, essa função precisa ser reescrita para assinar
//   um client_assertion e este app precisa expor uma jwks_uri pública.
// - valor_pagamento vai como STRING ("123.45"), formato decimal (17,2).
// - data_pagamento no POST /transferencias é DATA PURA "yyyy-MM-dd" (não
//   datetime) — confirmado pela Especificação Técnica (tamanho 10, exemplos
//   "2020-07-13"), corrigindo uma suposição anterior baseada num exemplo
//   isolado da coleção Postman que usava datetime completo.
// - pagador.modulo_sispag: a Especificação Técnica só lista "Fornecedores"
//   como domínio válido de ENTRADA para o POST /transferencias ("Diversos"
//   só aparece no domínio de SAÍDA/resposta) — por isso "Fornecedores" é o
//   padrão aqui, revertendo a suposição anterior de "Diversos".
// - pagador.conta = conta + dígito verificador CONCATENADOS numa string só
//   (ex.: conta "0080055" + DV "0" → "00800550"), não em campos separados.
import { randomUUID } from 'crypto';
import https from 'node:https';
import fs from 'node:fs';

export type AmbienteItau = 'SANDBOX' | 'PRODUCAO';

// SANDBOX confirmado empiricamente (2026-08-05, curl real): esse host —
// não "api.itau.com.br/sandbox/sispag/v1" da Especificação Técnica, que
// exige mTLS e é na prática uma réplica do gateway de produção — devolve
// 200 de verdade em GET /pagamentos_sispag e POST /transferencias, SEM
// certificado algum. É o mesmo host onde vive o endpoint de token
// (sandbox.devportal.itau.com.br) — o ambiente de teste "de verdade" fica
// todo hospedado ali, mais simples que produção.
const BASE_URL: Record<AmbienteItau, string> = {
  SANDBOX: 'https://sandbox.devportal.itau.com.br/itau-ep9-gtw-sispag-ext/v1',
  PRODUCAO: 'https://api.itau.com.br/sispag/v1',
};

// mTLS só é exigido em produção — testado empiricamente que o sandbox acima
// aceita chamadas de negócio sem certificado nenhum.
const AMBIENTES_QUE_EXIGEM_CERTIFICADO: AmbienteItau[] = ['PRODUCAO'];

// URLs de token CONFIRMADAS EMPIRICAMENTE (a Especificação Técnica errava a
// de sandbox — "api.itau.com.br/sandbox/api/oauth/token" devolve 404 puro).
// A de sandbox foi capturada direto do Network tab do navegador enquanto o
// usuário gerava um token pelo botão do portal, e testada com curl: devolve
// um access_token JWT real e válido (200, expires_in 300). A de produção
// (sts.itau.com.br) vem da coleção Postman oficial + de um artigo de suporte
// do Itaú sobre rotação de certificados — ainda não testada com credenciais
// de produção reais (só temos client_secret de sandbox preenchido por ora).
const TOKEN_URL_PADRAO: Record<AmbienteItau, string> = {
  SANDBOX: 'https://sandbox.devportal.itau.com.br/api/oauth/jwt',
  PRODUCAO: 'https://sts.itau.com.br/api/oauth/token',
};

const CERTIFICADO_SOLICITACAO_URL_PADRAO = 'https://sts.itau.com.br/seguranca/v1/certificado/solicitacao';

interface CertificadoCliente { cert: Buffer; key: Buffer; }

// Certificado (CRT, emitido pelo Itaú) + chave privada (gerada localmente
// junto com o CSR) usados para mTLS nas chamadas de negócio. Aceita base64
// (produção/Vercel) ou caminho de arquivo local (dev).
//
// TESTADO EMPIRICAMENTE (2026-08-05): o certificado precisa ser do MESMO app
// que emitiu o token — um certificado de produção com um token de sandbox
// (ou vice-versa) falha com "Falha ao validar token HMAC" mesmo com o mTLS
// em si funcionando (confirmado via curl: o gateway aceita a conexão TLS e
// ecoa o certificado de volta no header x-itau-client-cert, mas rejeita a
// combinação). Por isso o certificado também é por ambiente, como
// credenciaisAmbiente.
function carregarCertificadoCliente(ambiente: AmbienteItau): CertificadoCliente | null {
  const sufixo = ambiente === 'SANDBOX' ? 'SANDBOX' : 'PRODUCAO';
  const certBase64 = process.env[`ITAU_API_CERT_PEM_BASE64_${sufixo}`];
  const certPath = process.env[`ITAU_API_CERT_PEM_PATH_${sufixo}`];
  const keyBase64 = process.env[`ITAU_API_CERT_KEY_BASE64_${sufixo}`];
  const keyPath = process.env[`ITAU_API_CERT_KEY_PATH_${sufixo}`];
  if (!(certBase64 || certPath) || !(keyBase64 || keyPath)) return null;
  try {
    const cert = certBase64 ? Buffer.from(certBase64, 'base64') : fs.readFileSync(certPath!);
    const key = keyBase64 ? Buffer.from(keyBase64, 'base64') : fs.readFileSync(keyPath!);
    return { cert, key };
  } catch {
    return null;
  }
}

// Sandbox e produção são apps DIFERENTES no portal do Itaú, cada uma com seu
// próprio client_id/client_secret (confirmado: as credenciais de sandbox
// vieram com um client_id diferente do de produção) — por isso essas duas
// variáveis têm sufixo por ambiente, diferente de "client_id" sozinho.
function credenciaisAmbiente(ambiente: AmbienteItau): { clientId?: string; clientSecret?: string } {
  const sufixo = ambiente === 'SANDBOX' ? 'SANDBOX' : 'PRODUCAO';
  return {
    clientId: process.env[`ITAU_API_CLIENT_ID_${sufixo}`],
    clientSecret: process.env[`ITAU_API_CLIENT_SECRET_${sufixo}`],
  };
}

export function credenciaisItauConfiguradas(ambiente: AmbienteItau): boolean {
  const { clientId, clientSecret } = credenciaisAmbiente(ambiente);
  const precisaCertificado = AMBIENTES_QUE_EXIGEM_CERTIFICADO.includes(ambiente);
  return !!(clientId && clientSecret && (!precisaCertificado || carregarCertificadoCliente(ambiente)));
}

interface TokenCache { token: string; expiraEm: number; }
const tokenCachePorAmbiente: Partial<Record<AmbienteItau, TokenCache>> = {};

// Token OAuth2 — em SANDBOX não precisa de mTLS (testado empiricamente).
// Em PRODUÇÃO, mTLS é OBRIGATÓRIO até nesta chamada de token, não só nas
// chamadas de negócio — confirmado empiricamente 2026-08-10: sem o
// certificado anexado, o endpoint de token devolve 403 "Ausência do
// certificado na chamada" (código C100), mesmo com client_id/client_secret
// corretos. Por isso usa httpsRequestJson (que suporta cert+key) em vez do
// fetch global aqui, igual chamarApi. URL de token é a mesma pros dois
// ambientes — só as credenciais (e a exigência de certificado) mudam.
async function obterToken(ambiente: AmbienteItau): Promise<string> {
  const cache = tokenCachePorAmbiente[ambiente];
  if (cache && cache.expiraEm > Date.now() + 30_000) return cache.token;

  const tokenUrl = process.env.ITAU_API_TOKEN_URL || TOKEN_URL_PADRAO[ambiente];
  const { clientId, clientSecret } = credenciaisAmbiente(ambiente);
  if (!clientId || !clientSecret) {
    throw new Error(`Credenciais da API do Itaú não configuradas no servidor para o ambiente ${ambiente} (ITAU_API_CLIENT_ID_${ambiente} / ITAU_API_CLIENT_SECRET_${ambiente}).`);
  }
  if (AMBIENTES_QUE_EXIGEM_CERTIFICADO.includes(ambiente) && !carregarCertificadoCliente(ambiente)) {
    throw new Error(`Certificado cliente (mTLS) não configurado no servidor para o ambiente ${ambiente} — obrigatório até para gerar token nesse ambiente.`);
  }

  const { status, data } = await httpsRequestJson(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
    cliente: carregarCertificadoCliente(ambiente),
  });
  if (status < 200 || status >= 300 || !data?.access_token) {
    throw new Error(`Falha ao autenticar na API do Itaú (HTTP ${status}): ${data?.error_description || data?.error || data?.mensagem || 'resposta inválida'}`);
  }

  const novoCache = { token: data.access_token, expiraEm: Date.now() + (Number(data.expires_in || 300) * 1000) };
  tokenCachePorAmbiente[ambiente] = novoCache;
  return novoCache.token;
}

// x-itau-apikey = o próprio client_id (do ambiente em uso), conforme a
// Especificação Técnica ("A informação que deve ser usada nesse campo é o
// client_id") — não existe
// um apikey separado.
function apiKey(ambiente: AmbienteItau): string {
  const { clientId } = credenciaisAmbiente(ambiente);
  if (!clientId) throw new Error(`ITAU_API_CLIENT_ID_${ambiente} (usado também como x-itau-apikey) não configurado no servidor.`);
  return clientId;
}

// POST/GET genérico via node:https (em vez do fetch global) porque as
// chamadas de negócio do SISPAG em produção exigem mTLS — apresentar
// cert+key na conexão TLS, algo que o fetch nativo do Node não expõe de
// forma simples. Em sandbox o certificado é opcional (testado empiricamente
// que as chamadas funcionam sem ele), então `cliente` pode vir undefined.
function httpsRequestJson(
  urlStr: string,
  opts: { method: string; headers: Record<string, string>; body?: string; cliente?: CertificadoCliente | null }
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    // Duas pegadinhas do gateway (CloudFront na frente do sandbox), achadas
    // testando com curl (que funcionava) vs. https.request puro (que não):
    // 1) sem Content-Length explícito o Node manda Transfer-Encoding:
    //    chunked, que o gateway rejeita com 403;
    // 2) o CloudFront bloqueia (403 "Request blocked") requisições sem
    //    User-Agent — o https.request do Node não manda um por padrão,
    //    diferente do curl. Replicamos os dois.
    const headers: Record<string, string> = { 'User-Agent': 'curl/8.21.0', Accept: '*/*', ...opts.headers };
    if (opts.body) headers['Content-Length'] = String(Buffer.byteLength(opts.body));
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: opts.method,
      minVersion: 'TLSv1.2',
      headers,
      ...(opts.cliente ? { cert: opts.cliente.cert, key: opts.cliente.key } : {}),
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed: any = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: res.statusCode || 0, data: parsed });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function chamarApi(
  ambiente: AmbienteItau, path: string,
  init: { method?: string; body?: string; query?: Record<string, string | undefined> } = {}
): Promise<{ status: number; ok: boolean; data: any }> {
  const cliente = carregarCertificadoCliente(ambiente);
  if (!cliente && AMBIENTES_QUE_EXIGEM_CERTIFICADO.includes(ambiente)) {
    throw new Error(`Certificado cliente (mTLS) não configurado no servidor para o ambiente ${ambiente} — faltam ITAU_API_CERT_PEM_BASE64_${ambiente} e/ou ITAU_API_CERT_KEY_BASE64_${ambiente}. Veja solicitarCertificadoItau().`);
  }
  const token = await obterToken(ambiente);
  const url = new URL(BASE_URL[ambiente] + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  const { status, data } = await httpsRequestJson(url.toString(), {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-itau-apikey': apiKey(ambiente),
      'x-itau-flowID': 'FOLHA_PIX',
      'x-itau-correlationID': randomUUID(),
    },
    body: init.body,
    cliente,
  });
  return { status, ok: status >= 200 && status < 300, data };
}

export interface ResultadoSolicitacaoCertificado {
  ok: boolean;
  clientSecret?: string; // 1ª linha da resposta — só é emitido neste momento, não há como recuperar depois
  crt?: string;          // linhas seguintes da resposta — o certificado PEM assinado
  respostaBruta?: string; // fallback — usado se o formato não bater com o esperado (1ª linha = secret, resto = PEM)
  erro?: string;
}

// Passo de CREDENCIAMENTO, não de runtime: envia o CSR (gerado localmente,
// junto com a chave privada) para o Itaú assinar e devolver o certificado
// (CRT) que passa a ser usado via ITAU_API_CERT_PEM_BASE64 em toda chamada
// de negócio (ver chamarApi). Só precisa rodar uma vez por certificado
// emitido — e é o ÚNICO momento em que o client_secret é revelado (confirmado
// por escrito pelo suporte do Itaú em 2026-08-05: o secret "é disponibilizado
// no momento da geração do certificado", sem endpoint separado pra consultar
// depois — se perder, só regerando o certificado pra receber outro).
//
// Autenticada com um TOKEN TEMPORÁRIO DE ATIVAÇÃO (validade de 7 dias)
// enviado por e-mail pelo time de implantação do Itaú — NÃO o access_token
// OAuth normal (que nem faria sentido aqui, já que o certificado ainda não
// existe). Por isso recebe o token de ativação como parâmetro em vez de
// chamar obterToken().
//
// Formato de resposta CONFIRMADO por escrito pelo suporte do Itaú
// (2026-08-05): texto puro, 1ª linha = client_secret, linhas 2 em diante =
// o certificado assinado (PEM, ~21 linhas). Fazemos o parse por posição
// (split por linha) em vez de procurar "BEGIN CERTIFICATE" no meio do texto,
// porque a 1ª linha (o secret) viria junto e quebraria uma busca ingênua.
export async function solicitarCertificadoItau(csrPem: string, tokenAtivacao: string): Promise<ResultadoSolicitacaoCertificado> {
  try {
    const url = process.env.ITAU_API_CERT_SOLICITACAO_URL || CERTIFICADO_SOLICITACAO_URL_PADRAO;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Authorization': `Bearer ${tokenAtivacao}` },
      body: csrPem,
      cache: 'no-store',
    });
    const texto = await res.text();
    if (!res.ok) return { ok: false, erro: `HTTP ${res.status}: ${texto.slice(0, 500)}` };

    const linhas = texto.split(/\r?\n/).filter(l => l.trim() !== '');
    const clientSecret = linhas[0]?.trim();
    const crt = linhas.slice(1).join('\n').trim();
    if (clientSecret && crt.includes('BEGIN CERTIFICATE')) {
      return { ok: true, clientSecret, crt };
    }
    // Formato inesperado — devolve bruto pra inspeção manual em vez de
    // arriscar salvar um secret/certificado errado nas env vars.
    return { ok: true, respostaBruta: texto.slice(0, 3000) };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export interface PagadorSispag {
  tipo_conta: 'CC' | 'CP' | 'PP';
  agencia: string;
  conta: string;
  tipo_pessoa: 'F' | 'J';
  documento: string;
  modulo_sispag: 'Fornecedores' | 'Diversos';
}

export interface EnviarPixPorChaveParams {
  ambiente: AmbienteItau;
  valor_pagamento: number;
  data_pagamento: string; // "yyyy-MM-dd" — ver nota no topo do arquivo
  chave: string;
  referencia_empresa?: string;
  identificacao_comprovante?: string;
  informacoes_entre_usuarios?: string;
  pagador: PagadorSispag;
}

export interface ResultadoTransferenciaSispag {
  httpStatus: number;
  statusPagamento?: string;
  codPagamento?: string;
  numeroLote?: string;
  numeroLancamento?: string;
  motivoRecusa?: { codigo?: string; nome?: string }[];
  erro?: string;
}

// Inclui uma transferência Pix por chave (DICT) no SISPAG. Não cobre Pix por
// dados bancários nem QR Code — não são usados hoje pela folha da empresa.
export async function enviarPixPorChave(params: EnviarPixPorChaveParams): Promise<ResultadoTransferenciaSispag> {
  const { ambiente, valor_pagamento, ...resto } = params;
  try {
    const { status, data } = await chamarApi(ambiente, '/transferencias', {
      method: 'POST',
      // valor_pagamento como string "123.45" — ver nota no topo do arquivo.
      body: JSON.stringify({ ...resto, valor_pagamento: valor_pagamento.toFixed(2) }),
    });

    if (status === 400) {
      return { httpStatus: status, erro: data?.mensagem || 'Requisição inválida (dados do pagamento rejeitados pela API antes de tentar o pagamento).' };
    }
    if (status === 200 || status === 422) {
      return {
        httpStatus: status,
        statusPagamento: data?.status_pagamento,
        codPagamento: data?.cod_pagamento,
        numeroLote: data?.numero_lote,
        numeroLancamento: data?.numero_lancamento,
        motivoRecusa: data?.motivo_recusa,
      };
    }
    return { httpStatus: status, erro: `Resposta inesperada da API do Itaú (HTTP ${status}).` };
  } catch (e: any) {
    return { httpStatus: 0, erro: e.message };
  }
}

export interface ConsultaPagamentosSispagFiltros {
  ambiente: AmbienteItau;
  agenciaOperacao: string;
  contaOperacao: string;
  cnpjEmpresa: string;
  tipoLista: 'Detalhada' | 'Lote';
  numeroLote?: string;
  dataInicial?: string;
  dataFinal?: string;
  status?: 'AE' | 'EF' | 'NE' | 'TD';
  page?: number;
  pageSize?: number;
}

// Consulta pagamentos já lançados no SISPAG (por API ou por arquivo CNAB
// manual) — cobre todas as formas de pagamento, não só Pix.
export async function consultarPagamentosSispag(filtros: ConsultaPagamentosSispagFiltros) {
  const { ambiente, agenciaOperacao, contaOperacao, cnpjEmpresa, tipoLista, numeroLote, dataInicial, dataFinal, status, page, pageSize } = filtros;
  return chamarApi(ambiente, '/pagamentos_sispag', {
    query: {
      agencia_operacao: agenciaOperacao,
      conta_operacao: contaOperacao,
      cnpj_empresa: cnpjEmpresa,
      tipo_lista: tipoLista,
      numero_lote: numeroLote,
      data_inicial: dataInicial,
      data_final: dataFinal,
      status,
      page: page !== undefined ? String(page) : undefined,
      page_size: pageSize !== undefined ? String(pageSize) : undefined,
    },
  });
}

export async function consultarPagamentoSispag(ambiente: AmbienteItau, idPagamentoSispag: string) {
  return chamarApi(ambiente, `/pagamentos_sispag/${encodeURIComponent(idPagamentoSispag)}`);
}
