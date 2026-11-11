// app/lib/consultaDebitosVeiculares.ts
// Camada de provedor da consulta automática de multas/débitos de veículo,
// usada por /admin/operacional/multas (actions-multas.ts).
//
// Hoje o único provedor é a Infosimples (API "DETRAN / SP / Débitos e
// Restrições" — https://api.infosimples.com/consultas/docs/detran/sp/debitos).
// Ela devolve um JSON próprio; aqui a resposta é normalizada para
// DebitoConsultado, então trocar para a API oficial da Prodesp (Portal de
// APIs do Detran-SP) no futuro é só escrever outro adaptador com a mesma
// assinatura de consultarDebitosVeiculo — a tela e o banco não mudam.
//
// Variáveis de ambiente:
//   INFOSIMPLES_TOKEN              (obrigatória) token da conta Infosimples
//   Login GOV.BR — OBRIGATÓRIO para detran/sp/debitos (a API responde 606 e
//   COBRA a consulta se faltar; confirmado em 2026-11-10). Os veículos estão
//   no CNPJ da Rentech, então o caminho principal é o certificado A1 da empresa:
//   INFOSIMPLES_ENCRYPTION_KEY   chave de criptografia da conta (painel Infosimples)
//   INFOSIMPLES_PFX_BASE64       .pfx em base64 — se vazio, usa GOVBR_CONSIGNADO_CERT_PFX_BASE64
//   INFOSIMPLES_PFX_SENHA        senha do .pfx — se vazio, usa GOVBR_CONSIGNADO_CERT_SENHA
//   Alternativa (pessoa física): INFOSIMPLES_DETRAN_SP_CPF + INFOSIMPLES_DETRAN_SP_SENHA.
//   Com certificado configurado, ele tem preferência sobre o CPF.
// Só roda no servidor — nunca importar em componente "use client".

import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { createServer as criarServidorTls, connect as conectarTls } from 'node:tls';

export type TipoDebito = 'MULTA' | 'IPVA' | 'LICENCIAMENTO' | 'OUTRO';

export interface DebitoConsultado {
  tipo: TipoDebito;
  chave: string;              // chave de deduplicação dentro do veículo
  fonte: string;              // DETRAN_SP | RENAINF
  descricao: string | null;
  auto_infracao: string | null;
  orgao_autuador: string | null;
  data_infracao: string | null;   // YYYY-MM-DD
  hora_infracao: string | null;   // HH:MM[:SS]
  local_infracao: string | null;
  municipio: string | null;
  exercicio: string | null;
  cota: string | null;
  valor: number;
  data_vencimento: string | null; // YYYY-MM-DD
  bruto: unknown;
}

export interface ResultadoConsultaDebitos {
  ok: boolean;
  provedor: string;
  servico: string;
  codigo: number | null;
  mensagem: string;
  debitos: DebitoConsultado[];
  // Por tipo: a resposta veio completa a ponto de dar baixa automática no
  // que sumiu? Se o Detran devolver um aviso na seção (ex.: falha parcial),
  // NÃO se pode concluir que o débito foi pago só porque não veio na lista.
  secaoConfiavel: Record<'MULTA' | 'IPVA' | 'LICENCIAMENTO', boolean>;
  avisos: string[];
  preco: number | null;
  siteReceipt: string | null;
  resposta: unknown;
}

const URL_INFOSIMPLES_DETRAN_SP = 'https://api.infosimples.com/api/v2/consultas/detran/sp/debitos';
const SERVICO_DETRAN_SP = 'detran/sp/debitos';

// Criptografia exigida pela Infosimples para pkcs12_cert/pkcs12_pass: o
// exemplo oficial usa `aes_bridge.encrypt(valor, ENCRYPTION_KEY)` (pacote
// aes-bridge, onde encrypt = AES-256-GCM) e depois deixa o base64 URL-safe.
// Formato aes-bridge GCM: PBKDF2-SHA256 (100.000 iterações, chave de 32 bytes)
// sobre um salt de 16 bytes; saída = salt(16) + nonce(12) + cifrado + tag(16).
export function criptografarInfosimples(valor: string, chave: string): string {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = pbkdf2Sync(Buffer.from(chave, 'utf8'), salt, 100_000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const cifrado = Buffer.concat([cipher.update(Buffer.from(valor, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, nonce, cifrado, tag]).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function certificadoA1(): { pfxBase64: string; senha: string; chave: string } | null {
  const e = process.env;
  const chave = e.INFOSIMPLES_ENCRYPTION_KEY;
  const pfxBase64 = e.INFOSIMPLES_PFX_BASE64 || e.GOVBR_CONSIGNADO_CERT_PFX_BASE64;
  const senha = e.INFOSIMPLES_PFX_SENHA || e.GOVBR_CONSIGNADO_CERT_SENHA;
  if (!chave || !pfxBase64 || !senha) return null;
  return { pfxBase64: pfxBase64.replace(/\s/g, ''), senha, chave };
}

function loginGovBr(): { par: 'CERT'; cert: string; pass: string } | { par: 'CPF'; cpf: string; senha: string } | null {
  const a1 = certificadoA1();
  if (a1) return { par: 'CERT', cert: criptografarInfosimples(a1.pfxBase64, a1.chave), pass: criptografarInfosimples(a1.senha, a1.chave) };
  const e = process.env;
  if (e.INFOSIMPLES_DETRAN_SP_CPF && e.INFOSIMPLES_DETRAN_SP_SENHA) return { par: 'CPF', cpf: e.INFOSIMPLES_DETRAN_SP_CPF.replace(/\D/g, ''), senha: e.INFOSIMPLES_DETRAN_SP_SENHA };
  return null;
}

// Validade do certificado A1 usado na consulta. Node não tem parser de
// PKCS#12 público, então sobe um servidor TLS efêmero em 127.0.0.1 com o
// .pfx e lê o certificado do lado do cliente (getPeerCertificate) — sem
// dependência nova. Cache de 1h por instância (o .pfx só muda com deploy).
export interface ValidadeCertificado { titular: string; validoAte: string; diasRestantes: number }
let cacheValidade: { em: number; chave: string; valor: ValidadeCertificado | null } | null = null;

export async function validadeCertificadoA1(): Promise<ValidadeCertificado | null> {
  const a1 = certificadoA1();
  if (!a1) return null;
  const chaveCache = a1.pfxBase64.slice(-32);
  if (cacheValidade && cacheValidade.chave === chaveCache && Date.now() - cacheValidade.em < 3_600_000) return cacheValidade.valor;

  const valor = await new Promise<ValidadeCertificado | null>(resolve => {
    let servidor: ReturnType<typeof criarServidorTls> | null = null;
    const encerrar = (v: ValidadeCertificado | null) => { try { servidor?.close(); } catch { /* já fechado */ } resolve(v); };
    const timer = setTimeout(() => encerrar(null), 5000);
    try {
      servidor = criarServidorTls({ pfx: Buffer.from(a1.pfxBase64, 'base64'), passphrase: a1.senha });
      servidor.on('error', () => { clearTimeout(timer); encerrar(null); });
      servidor.listen(0, '127.0.0.1', () => {
        const endereco = servidor!.address();
        const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
        const socket = conectarTls({ host: '127.0.0.1', port: porta, rejectUnauthorized: false }, () => {
          const cert = socket.getPeerCertificate();
          socket.end();
          clearTimeout(timer);
          if (!cert?.valid_to) return encerrar(null);
          const fim = new Date(cert.valid_to);
          const cn = (Array.isArray(cert.subject?.CN) ? cert.subject.CN[0] : cert.subject?.CN) || '';
          encerrar({ titular: String(cn).split(':')[0], validoAte: fim.toISOString(), diasRestantes: Math.floor((fim.getTime() - Date.now()) / 86400000) });
        });
        socket.on('error', () => { clearTimeout(timer); encerrar(null); });
      });
    } catch {
      clearTimeout(timer);
      encerrar(null);
    }
  });
  cacheValidade = { em: Date.now(), chave: chaveCache, valor };
  return valor;
}

function temLoginGovBr(): boolean {
  const e = process.env;
  return !!certificadoA1() || !!(e.INFOSIMPLES_DETRAN_SP_CPF && e.INFOSIMPLES_DETRAN_SP_SENHA);
}

export function provedorConfigurado(): boolean {
  return !!process.env.INFOSIMPLES_TOKEN && temLoginGovBr();
}

// ---------------------------------------------------------------------------
// Helpers de normalização
// ---------------------------------------------------------------------------
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

// "dd/mm/aaaa" → "aaaa-mm-dd". O exemplo da documentação usa "11/11/1111"
// como placeholder — ano < 1900 é tratado como data ausente.
export function dataBrParaIso(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) {
    if (Number(m[3]) < 1900) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// Aceita número ou texto ("1.160,07", "1160.07", "R$ 203,62").
export function valorNumerico(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  const s = texto(v);
  if (!s) return 0;
  const limpo = s.replace(/[^\d,.-]/g, '');
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// Mensagem de seção vazia ou do tipo "nada consta" = seção confiável.
function mensagemSecaoOk(msg: unknown): boolean {
  const s = texto(msg);
  if (!s) return true;
  return /nada consta|n[aã]o (h[aá]|existem?|possui|constam?)|nenhum|sem d[eé]bito/i.test(s);
}

function nomeOrgao(v: unknown): string | null {
  if (v && typeof v === 'object') {
    const o = v as { nome?: unknown; codigo?: unknown };
    return texto(o.nome) || texto(o.codigo);
  }
  return texto(v);
}

// ---------------------------------------------------------------------------
// Adaptador Infosimples — DETRAN/SP Débitos e Restrições
// ---------------------------------------------------------------------------
type Registro = Record<string, unknown>;

function normalizarDetranSp(d: Registro): { debitos: DebitoConsultado[]; secaoConfiavel: ResultadoConsultaDebitos['secaoConfiavel']; avisos: string[] } {
  const debitos: DebitoConsultado[] = [];
  const avisos: string[] = [];

  const multas = Array.isArray(d.debitos_multas) ? (d.debitos_multas as Registro[]) : null;
  (multas || []).forEach((m, i) => {
    const auto = texto(m.auto_infracao);
    const dataInf = dataBrParaIso(m.data_infracao);
    const valor = valorNumerico(m.valor);
    debitos.push({
      tipo: 'MULTA',
      chave: auto ? `MULTA:${auto}` : `MULTA:${dataInf || 'sem-data'}|${texto(m.hora_infracao) || ''}|${valor}|${i}`,
      fonte: 'DETRAN_SP',
      descricao: texto(m.descricao),
      auto_infracao: auto,
      orgao_autuador: nomeOrgao(m.orgao_autuador),
      data_infracao: dataInf,
      hora_infracao: texto(m.hora_infracao),
      local_infracao: texto(m.local),
      municipio: texto(m.municipio),
      exercicio: null,
      cota: null,
      valor,
      data_vencimento: dataBrParaIso(m.data_vencimento),
      bruto: m,
    });
  });

  // RENAINF = multas de outros estados. A documentação não detalha o
  // formato dos itens, então o mapeamento aqui é tolerante (vários nomes
  // possíveis de campo) e o item bruto fica guardado para conferência.
  const renainf = Array.isArray(d.debitos_renainf) ? (d.debitos_renainf as Registro[]) : [];
  renainf.forEach((m, i) => {
    const auto = texto(m.auto_infracao) || texto(m.numero_auto_infracao) || texto(m.numero_auto) || texto(m.ait);
    const dataInf = dataBrParaIso(m.data_infracao || m.data);
    const valor = valorNumerico(m.valor || m.valor_multa);
    debitos.push({
      tipo: 'MULTA',
      chave: auto ? `MULTA:${auto}` : `MULTA:RENAINF:${dataInf || 'sem-data'}|${valor}|${i}`,
      fonte: 'RENAINF',
      descricao: texto(m.descricao) || texto(m.infracao) || texto(m.descricao_infracao),
      auto_infracao: auto,
      orgao_autuador: nomeOrgao(m.orgao_autuador || m.orgao),
      data_infracao: dataInf,
      hora_infracao: texto(m.hora_infracao || m.hora),
      local_infracao: texto(m.local || m.local_infracao),
      municipio: texto(m.municipio) || texto(m.uf_infracao),
      exercicio: null,
      cota: null,
      valor,
      data_vencimento: dataBrParaIso(m.data_vencimento || m.vencimento),
      bruto: m,
    });
  });

  const ipva = Array.isArray(d.debitos_ipva) ? (d.debitos_ipva as Registro[]) : null;
  (ipva || []).forEach(m => {
    const exercicio = texto(m.exercicio);
    const cota = texto(m.cota);
    debitos.push({
      tipo: 'IPVA',
      chave: `IPVA:${exercicio || 'sem-exercicio'}:${cota || 'unica'}`,
      fonte: 'DETRAN_SP',
      descricao: `IPVA ${exercicio || ''}${texto(m.nome_cota) ? ` — ${texto(m.nome_cota)}` : ''}${cota ? ` (cota ${cota})` : ''}`.trim(),
      auto_infracao: null,
      orgao_autuador: 'SEFAZ-SP',
      data_infracao: null,
      hora_infracao: null,
      local_infracao: null,
      municipio: null,
      exercicio,
      cota,
      valor: valorNumerico(m.valor),
      data_vencimento: dataBrParaIso(m.data_vencimento),
      bruto: m,
    });
  });

  const lic = Array.isArray(d.debitos_licenciamento) ? (d.debitos_licenciamento as Registro[]) : null;
  (lic || []).forEach(m => {
    const exercicio = texto(m.exercicio);
    debitos.push({
      tipo: 'LICENCIAMENTO',
      chave: `LIC:${exercicio || 'sem-exercicio'}`,
      fonte: 'DETRAN_SP',
      descricao: `Licenciamento ${exercicio || ''}`.trim(),
      auto_infracao: null,
      orgao_autuador: 'DETRAN-SP',
      data_infracao: null,
      hora_infracao: null,
      local_infracao: null,
      municipio: null,
      exercicio,
      cota: null,
      valor: valorNumerico(m.valor),
      data_vencimento: dataBrParaIso(m.data_vencimento),
      bruto: m,
    });
  });

  const secaoConfiavel = {
    MULTA: multas !== null && mensagemSecaoOk(d.multas_mensagem) && mensagemSecaoOk(d.renainf_mensagem),
    IPVA: ipva !== null && mensagemSecaoOk(d.ipva_mensagem),
    LICENCIAMENTO: lic !== null && mensagemSecaoOk(d.licenciamento_mensagem),
  };
  if (texto(d.multas_mensagem) && !secaoConfiavel.MULTA) avisos.push(`Multas: ${texto(d.multas_mensagem)}`);
  if (texto(d.renainf_mensagem) && !mensagemSecaoOk(d.renainf_mensagem)) avisos.push(`RENAINF: ${texto(d.renainf_mensagem)}`);
  if (texto(d.ipva_mensagem) && !secaoConfiavel.IPVA) avisos.push(`IPVA: ${texto(d.ipva_mensagem)}`);
  if (texto(d.licenciamento_mensagem) && !secaoConfiavel.LICENCIAMENTO) avisos.push(`Licenciamento: ${texto(d.licenciamento_mensagem)}`);

  return { debitos, secaoConfiavel, avisos };
}

async function consultarInfosimplesDetranSp(placa: string, renavam: string): Promise<ResultadoConsultaDebitos> {
  const base: Omit<ResultadoConsultaDebitos, 'ok' | 'codigo' | 'mensagem'> = {
    provedor: 'INFOSIMPLES', servico: SERVICO_DETRAN_SP, debitos: [],
    secaoConfiavel: { MULTA: false, IPVA: false, LICENCIAMENTO: false },
    avisos: [], preco: null, siteReceipt: null, resposta: null,
  };

  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) return { ...base, ok: false, codigo: null, mensagem: 'Consulta automática não configurada: falta a variável INFOSIMPLES_TOKEN no servidor.' };

  // Sem login a Infosimples recusa (606) e cobra mesmo assim — barra antes.
  const login = loginGovBr();
  if (!login) return { ...base, ok: false, codigo: null, mensagem: 'Consulta não enviada: falta o login GOV.BR (certificado A1 + INFOSIMPLES_ENCRYPTION_KEY, ou INFOSIMPLES_DETRAN_SP_CPF/SENHA) no servidor — sem ele a Infosimples recusa e cobra a consulta.' };

  const params = new URLSearchParams({ token, placa, renavam, timeout: '300' });
  if (login.par === 'CPF') { params.set('login_cpf', login.cpf); params.set('login_senha', login.senha); }
  else { params.set('pkcs12_cert', login.cert); params.set('pkcs12_pass', login.pass); }

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 320_000);
  let json: Registro;
  try {
    const resp = await fetch(URL_INFOSIMPLES_DETRAN_SP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controle.signal,
      cache: 'no-store',
    });
    json = await resp.json() as Registro;
  } catch (e) {
    const abortou = e instanceof Error && e.name === 'AbortError';
    return { ...base, ok: false, codigo: null, mensagem: abortou ? 'A consulta demorou demais e foi interrompida. Tente de novo em alguns minutos.' : `Falha de conexão com a Infosimples: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  const header = (json.header || {}) as Registro;
  // A resposta nunca é gravada com o token — o header só ecoa os parâmetros
  // de busca, mas tira-se qualquer coisa sensível por garantia.
  const parametros = (header.parameters || {}) as Registro;
  delete parametros.token; delete parametros.login_senha; delete parametros.pkcs12_pass; delete parametros.pkcs12_cert;

  const codigo = typeof json.code === 'number' ? json.code : Number(json.code) || null;
  const receipts = Array.isArray(json.site_receipts) ? (json.site_receipts as unknown[]) : [];
  const comum = {
    ...base,
    codigo,
    preco: header.price !== undefined ? valorNumerico(header.price) : null,
    siteReceipt: texto(receipts[0]),
    resposta: json,
  };

  if (codigo !== 200) {
    const erros = Array.isArray(json.errors) ? (json.errors as unknown[]).map(e => String(e)).join(' · ') : '';
    return { ...comum, ok: false, mensagem: [texto(json.code_message), erros].filter(Boolean).join(' — ') || `Erro ${codigo ?? 'desconhecido'} na consulta.` };
  }

  const dados = Array.isArray(json.data) ? (json.data as Registro[]) : [];
  if (dados.length === 0) return { ...comum, ok: false, mensagem: 'A consulta não devolveu dados do veículo.' };

  const { debitos, secaoConfiavel, avisos } = normalizarDetranSp(dados[0]);
  return {
    ...comum,
    ok: true,
    mensagem: texto(json.code_message) || 'Consulta realizada.',
    debitos, secaoConfiavel, avisos,
    siteReceipt: texto(dados[0].site_receipt) || comum.siteReceipt,
  };
}

// ---------------------------------------------------------------------------
// Ponto de entrada (escolhe o adaptador pela UF)
// ---------------------------------------------------------------------------
export async function consultarDebitosVeiculo(params: { placa: string; renavam: string; uf?: string }): Promise<ResultadoConsultaDebitos> {
  const placa = params.placa.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const renavam = params.renavam.replace(/\D/g, '');
  const uf = (params.uf || 'SP').toUpperCase();

  if (uf !== 'SP') {
    return {
      ok: false, provedor: 'INFOSIMPLES', servico: '', codigo: null,
      mensagem: `Consulta automática ainda não disponível para veículos de ${uf} (só SP).`,
      debitos: [], secaoConfiavel: { MULTA: false, IPVA: false, LICENCIAMENTO: false },
      avisos: [], preco: null, siteReceipt: null, resposta: null,
    };
  }
  return consultarInfosimplesDetranSp(placa, renavam);
}

// ===========================================================================
// Boletos das multas (botão "Buscar boleto" em /admin/operacional/multas)
// ===========================================================================
// Duas consultas por órgão autuador, além da do Detran:
//   - Prefeitura SP – Multas (pref/sp/sao-paulo/multas-guias): código de
//     barras + URL do boleto. O portal da Prefeitura entra pelo GOV.BR e a
//     Infosimples só aceita CPF/CNPJ + senha aqui (sem certificado): usa
//     INFOSIMPLES_PREF_SP_LOGIN/_SENHA se definidos; senão reaproveita o CPF/senha
//     GOV.BR de INFOSIMPLES_DETRAN_SP_CPF/_SENHA.
//   - DER-SP – Penalidades (der/sp/penalidades): PDF da Notificação de
//     Penalidade (np_pdf_url). Mesmo login GOV.BR / certificado A1 do Detran.
// Cada chamada é cobrada pela Infosimples.

export interface ResultadoChamadaInfosimples {
  ok: boolean;
  servico: string;
  codigo: number | null;
  mensagem: string;
  preco: number | null;
  dados: Registro[];
  resposta: unknown;
}

async function chamarInfosimples(servico: string, campos: Record<string, string>): Promise<ResultadoChamadaInfosimples> {
  const vazio = { servico, dados: [] as Registro[], preco: null, resposta: null };
  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) return { ...vazio, ok: false, codigo: null, mensagem: 'Falta a variável INFOSIMPLES_TOKEN no servidor.' };

  const params = new URLSearchParams({ token, timeout: '300', ...campos });
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 320_000);
  let json: Registro;
  try {
    const resp = await fetch(`https://api.infosimples.com/api/v2/consultas/${servico}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controle.signal,
      cache: 'no-store',
    });
    json = await resp.json() as Registro;
  } catch (e) {
    const abortou = e instanceof Error && e.name === 'AbortError';
    return { ...vazio, ok: false, codigo: null, mensagem: abortou ? 'A consulta demorou demais e foi interrompida.' : `Falha de conexão com a Infosimples: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  // Nunca guardar credencial: o header ecoa os parâmetros enviados.
  const header = (json.header || {}) as Registro;
  const parametros = (header.parameters || {}) as Registro;
  for (const k of ['token', 'login_senha', 'pkcs12_pass', 'pkcs12_cert']) delete parametros[k];

  const codigo = typeof json.code === 'number' ? json.code : Number(json.code) || null;
  const preco = header.price !== undefined ? valorNumerico(header.price) : null;
  if (codigo !== 200) {
    const erros = Array.isArray(json.errors) ? (json.errors as unknown[]).map(e => String(e)).join(' · ') : '';
    return { ...vazio, ok: false, codigo, preco, resposta: json, mensagem: [texto(json.code_message), erros].filter(Boolean).join(' — ') || `Erro ${codigo ?? 'desconhecido'} na consulta.` };
  }
  return { ok: true, servico, codigo, preco, resposta: json, mensagem: texto(json.code_message) || 'OK', dados: Array.isArray(json.data) ? (json.data as Registro[]) : [] };
}

const normAit = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface BoletoPrefeitura {
  ait: string; codigo_barras: string | null; boleto_url: string | null;
  vencimento: string | null; valor: number; situacao_divida_ativa: string | null; mensagem: string | null;
}

function loginPrefeituraSP(): { login: string; senha: string } | null {
  const e = process.env;
  const login = soDigitosLocal(e.INFOSIMPLES_PREF_SP_LOGIN || e.INFOSIMPLES_DETRAN_SP_CPF || '');
  const senha = e.INFOSIMPLES_PREF_SP_LOGIN ? (e.INFOSIMPLES_PREF_SP_SENHA || '') : (e.INFOSIMPLES_DETRAN_SP_SENHA || '');
  return login && senha ? { login, senha } : null;
}

export function prefeituraSpConfigurada(): boolean {
  return !!process.env.INFOSIMPLES_TOKEN && !!loginPrefeituraSP();
}

export async function consultarBoletosPrefeituraSP(params: { placa: string; renavam: string; aits?: string[] }): Promise<ResultadoChamadaInfosimples & { boletos: BoletoPrefeitura[] }> {
  const servico = 'pref/sp/sao-paulo/multas-guias';
  const credencial = loginPrefeituraSP();
  if (!credencial) {
    return { ok: false, servico, codigo: null, mensagem: 'Busca de boleto da Prefeitura de SP não configurada: falta o CPF/senha GOV.BR (INFOSIMPLES_DETRAN_SP_CPF/_SENHA) no servidor.', preco: null, dados: [], resposta: null, boletos: [] };
  }
  const { login, senha } = credencial;
  const campos: Record<string, string> = {
    placa: params.placa.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
    renavam: soDigitosLocal(params.renavam),
    login_senha: senha,
    [login.length === 14 ? 'login_cnpj' : 'login_cpf']: login,
  };
  if (params.aits?.length) campos.ait_lista = params.aits.join(',');

  const r = await chamarInfosimples(servico, campos);
  const boletos: BoletoPrefeitura[] = [];
  r.dados.forEach(d => {
    (Array.isArray(d.multas) ? (d.multas as Registro[]) : []).forEach(m => {
      const ait = normAit(m.ait);
      if (!ait) return;
      boletos.push({
        ait,
        codigo_barras: soDigitosLocal(String(m.codigo_barras ?? '')) || null,
        boleto_url: texto(m.boleto_url),
        vencimento: dataBrParaIso(m.vencimento),
        valor: m.normalizado_valor !== undefined ? valorNumerico(m.normalizado_valor) : valorNumerico(m.valor),
        situacao_divida_ativa: texto(m.situacao_divida_ativa),
        mensagem: texto(m.mensagem),
      });
    });
  });
  return { ...r, boletos };
}

export interface PenalidadeDer { ait: string; np_pdf_url: string | null; situacao: string | null; valor: number; data_vencimento: string | null; multa_nic: string | null }

export async function consultarPenalidadesDerSP(params: { renavam: string }): Promise<ResultadoChamadaInfosimples & { penalidades: PenalidadeDer[] }> {
  const servico = 'der/sp/penalidades';
  const login = loginGovBr();
  if (!login) {
    return { ok: false, servico, codigo: null, mensagem: 'Falta o login GOV.BR (certificado A1 + INFOSIMPLES_ENCRYPTION_KEY) no servidor.', preco: null, dados: [], resposta: null, penalidades: [] };
  }
  const campos: Record<string, string> = { renavam: soDigitosLocal(params.renavam) };
  if (login.par === 'CPF') { campos.login_cpf = login.cpf; campos.login_senha = login.senha; }
  else { campos.pkcs12_cert = login.cert; campos.pkcs12_pass = login.pass; }

  const r = await chamarInfosimples(servico, campos);
  const penalidades: PenalidadeDer[] = [];
  const vistos = new Set<string>();
  const adicionar = (m: Registro) => {
    const ait = normAit(m.ait);
    if (!ait || vistos.has(ait)) return;
    vistos.add(ait);
    penalidades.push({
      ait, np_pdf_url: texto(m.np_pdf_url), situacao: texto(m.situacao),
      valor: m.normalizado_valor !== undefined ? valorNumerico(m.normalizado_valor) : valorNumerico(m.valor),
      data_vencimento: dataBrParaIso(m.data_vencimento), multa_nic: texto(m.multa_nic),
    });
  };
  r.dados.forEach(d => {
    // Cada item pode trazer a própria multa e um array "multas" com outras.
    (Array.isArray(d.multas) ? (d.multas as Registro[]) : []).forEach(adicionar);
    adicionar(d);
  });
  return { ...r, penalidades };
}

function soDigitosLocal(s: string): string { return (s || '').replace(/\D/g, ''); }

// ===========================================================================
// SENATRAN (portal de serviços / SNE) — prazos de indicação do condutor
// ===========================================================================
//   - senatran/infracoes: lista as infrações do veículo (placa + CNPJ da
//     empresa), com chave_infracao, situação, vencimento e valor.
//   - senatran/download-infracao: detalhe de UMA infração (chave) — traz
//     data_limite_indicacao_infrator, data_limite_defesa e o condutor.
// Login GOV.BR: mesmo certificado A1 / CPF do Detran. Cada chamada é cobrada.

export interface InfracaoSenatran {
  ait: string; chave: string; codigo_infracao: string | null; codigo_orgao: string | null;
  descricao: string | null; valor: number; data_vencimento: string | null; situacao: string | null;
}

export interface DetalheInfracaoSenatran {
  ait: string | null; orgao_autuador: string | null;
  data_notificacao: string | null; prazo_defesa: string | null; prazo_indicacao: string | null;
  condutor_nome: string | null; condutor_cnh: string | null;
  codigo_infracao: string | null; descricao: string | null; valor: number;
  data_infracao: string | null; hora_infracao: string | null; local_infracao: string | null; municipio: string | null;
  site_receipt: string | null;
}

function camposLoginGovBr(): Record<string, string> | null {
  const login = loginGovBr();
  if (!login) return null;
  return login.par === 'CPF'
    ? { login_cpf: login.cpf, login_senha: login.senha }
    : { pkcs12_cert: login.cert, pkcs12_pass: login.pass };
}

const semValor = (s: string | null) => (s && !/^(n[aã]o dispon[ií]vel|n[aã]o se aplica|-+)$/i.test(s.trim()) ? s.trim() : null);

export async function consultarInfracoesSenatran(params: { placa: string; cnpj?: string | null }): Promise<ResultadoChamadaInfosimples & { infracoes: InfracaoSenatran[] }> {
  const servico = 'senatran/infracoes';
  const login = camposLoginGovBr();
  if (!login) return { ok: false, servico, codigo: null, mensagem: 'Falta o login GOV.BR (certificado A1) no servidor.', preco: null, dados: [], resposta: null, infracoes: [] };
  const campos: Record<string, string> = { placa: params.placa.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), ...login };
  const cnpj = soDigitosLocal(params.cnpj || '');
  if (cnpj.length === 14) campos.cnpj = cnpj;

  const r = await chamarInfosimples(servico, campos);
  const infracoes: InfracaoSenatran[] = [];
  r.dados.forEach(d => {
    (Array.isArray(d.infracoes) ? (d.infracoes as Registro[]) : []).forEach(i => {
      const ait = normAit(i.auto_infracao);
      const chave = texto(i.chave_infracao);
      if (!ait || !chave) return;
      infracoes.push({
        ait, chave, codigo_infracao: texto(i.codigo_infracao), codigo_orgao: texto(i.codigo_orgao_autuador),
        descricao: texto(i.descricao), valor: valorNumerico(i.valor_total),
        data_vencimento: dataBrParaIso(i.data_vencimento), situacao: texto(i.situacao),
      });
    });
  });
  return { ...r, infracoes };
}

export async function baixarInfracaoSenatran(params: { chave: string; placa: string; cnpj?: string | null }): Promise<ResultadoChamadaInfosimples & { detalhe: DetalheInfracaoSenatran | null }> {
  const servico = 'senatran/download-infracao';
  const login = camposLoginGovBr();
  if (!login) return { ok: false, servico, codigo: null, mensagem: 'Falta o login GOV.BR (certificado A1) no servidor.', preco: null, dados: [], resposta: null, detalhe: null };
  const campos: Record<string, string> = { chave_infracao: params.chave, placa: params.placa.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), ...login };
  const cnpj = soDigitosLocal(params.cnpj || '');
  if (cnpj.length === 14) campos.cnpj = cnpj;

  const r = await chamarInfosimples(servico, campos);
  const d = r.dados[0];
  if (!r.ok || !d) return { ...r, detalhe: null };
  const aut = (d.autuacao || {}) as Registro;
  const cond = (d.condutor || {}) as Registro;
  const inf = (d.infracao || {}) as Registro;
  const ldh = (d.local_data_hora || {}) as Registro;
  const uf = texto(ldh.uf);
  return {
    ...r,
    detalhe: {
      ait: normAit(aut.numero_ait) || null,
      orgao_autuador: texto(aut.orgao_autuador),
      data_notificacao: dataBrParaIso(aut.data_notificacao),
      prazo_defesa: dataBrParaIso(aut.data_limite_defesa),
      prazo_indicacao: dataBrParaIso(aut.data_limite_indicacao_infrator),
      condutor_nome: semValor(texto(cond.nome)),
      condutor_cnh: semValor(texto(cond.cnh)),
      codigo_infracao: [texto(inf.codigo_infracao), texto(inf.desdobramento)].filter(Boolean).join('-') || null,
      descricao: texto(inf.descricao),
      valor: valorNumerico(inf.valor_multa),
      data_infracao: dataBrParaIso(ldh.data_infracao),
      hora_infracao: texto(ldh.hora_infracao),
      local_infracao: texto(ldh.local_infracao),
      municipio: [texto(ldh.municipio), uf].filter(Boolean).join(' / ') || null,
      site_receipt: texto(d.site_receipt),
    },
  };
}
