// app/lib/ponto/afd.ts
// Arquivo Fonte de Dados (AFD) do REP-P — Portaria MTP 671/2021, Anexo V,
// leiaute versão "004" (PDF oficial do gov.br, lido em 2026-11-23). Só
// funções puras: montar cada linha, o CRC-16 e o hash encadeado do tipo 7.
// Quem lê o banco e congela as linhas é app/admin/rh/actions/actions-afd.ts.
//
// Regras do anexo aplicadas aqui:
//  * texto ISO 8859-1, uma linha por registro terminando em CR LF, sem linha em branco;
//  * D = "AAAA-MM-dd"; DH = "AAAA-MM-ddThh:mm:00ZZZZZ" (segundos SEMPRE "00");
//  * tipos "1" a "5" levam CRC-16 CCITT-TRUE (CRC-16/KERMIT) — "123456789" → "2189";
//  * tipo "7" leva SHA-256 de NSR + tipo + DH marcação + CPF + DH gravação +
//    coletor + on/off-line + hash do registro anterior (quando existe);
//  * nome: "AFD" + nº de registro no INPI + CNPJ/CPF do empregador + "REP_P";
//  * última linha: "ASSINATURA_DIGITAL_EM_ARQUIVO_P7S" (assinatura vai no .p7s).
// Interpretações nossas (a validar com a contabilidade/jurídico): campo N é
// alinhado à direita com zeros (A à esquerda com espaços); o hash é o texto
// exato dos campos 1–7 da linha + o hash anterior em hexadecimal minúsculo.
import { createHash } from 'node:crypto';

export const VERSAO_LEIAUTE_AFD = '004';
export const TEXTO_ASSINATURA_P7S = 'ASSINATURA_DIGITAL_EM_ARQUIVO_P7S';

export type ColetorAfd = '01' | '02' | '03' | '04' | '05';
export const COLETORES_AFD: Record<ColetorAfd, string> = {
  '01': 'Aplicativo mobile',
  '02': 'Browser (navegador internet)',
  '03': 'Aplicativo desktop',
  '04': 'Dispositivo eletrônico',
  '05': 'Outro dispositivo eletrônico',
};

const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Campo N: só dígitos, alinhado à direita com zeros. Estoura = erro (nunca corta número). */
export function campoN(valor: string | number, tamanho: number): string {
  const d = so(valor);
  if (d.length > tamanho) throw new Error(`Valor numérico "${d}" maior que ${tamanho} posições.`);
  return d.padStart(tamanho, '0');
}

/** Campo A: texto em ISO 8859-1, alinhado à esquerda com espaços, cortado no tamanho. */
export function campoA(valor: unknown, tamanho: number): string {
  // fora do ISO 8859-1 (emoji, aspas curvas…) vira "?" — o arquivo é latin1
  const t = String(valor ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  return t.slice(0, tamanho).padEnd(tamanho, ' ');
}

/** Partes de data/hora no fuso de São Paulo, com o deslocamento real (ex.: "-0300"). */
function partesSaoPaulo(data: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  });
  const p = Object.fromEntries(f.formatToParts(data).map(x => [x.type, x.value]));
  // "GMT-03:00" → "-0300" ("GMT" puro = UTC)
  const m = /GMT([+-])(\d{2}):?(\d{2})/.exec(p.timeZoneName || '');
  const fuso = m ? `${m[1]}${m[2]}${m[3]}` : '+0000';
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, fuso };
}

/** Tipo D: "AAAA-MM-dd". Aceita "AAAA-MM-DD" (já local) ou Date/ISO (convertido p/ São Paulo). */
export function campoD(valor: string | Date): string {
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const p = partesSaoPaulo(new Date(valor));
  return `${p.ano}-${p.mes}-${p.dia}`;
}

/** Tipo DH: "AAAA-MM-ddThh:mm:00ZZZZZ" no fuso de São Paulo (segundos fixos em "00"). */
export function campoDH(valor: string | Date): string {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw new Error(`Data/hora inválida: ${String(valor)}`);
  const p = partesSaoPaulo(data);
  return `${p.ano}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}:00${p.fuso}`;
}

/** CRC-16 CCITT-TRUE (CRC-16/KERMIT): poly 0x1021 refletido (0x8408), init 0, sem xor final. */
export function crc16Kermit(texto: string): string {
  let crc = 0x0000;
  for (const byte of Buffer.from(texto, 'latin1')) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const comCrc = (corpo: string) => corpo + crc16Kermit(corpo);

export interface EmpregadorAfd {
  documento: string;        // CNPJ (14) ou CPF (11), só dígitos
  razaoSocial: string;
  cnoCaepf?: string | null; // quando existir
}
export interface RepPAfd {
  inpiRegistro: string;          // nº de registro do programa no INPI ("" enquanto não houver)
  desenvolvedorDocumento: string; // CNPJ/CPF de quem desenvolveu o REP-P
}

const tipoDocumento = (doc: string) => (so(doc).length === 11 ? '2' : '1');
/** CNPJ/CPF num campo A de 14: CNPJ inteiro; CPF com zeros à esquerda (mesmo critério dos campos N). */
const documento14 = (doc: string) => {
  const d = so(doc);
  if (d.length !== 11 && d.length !== 14) throw new Error(`CNPJ/CPF inválido: "${doc}".`);
  return d.padStart(14, '0');
};

/** Registro tipo "1" — cabeçalho (302 posições). */
export function linhaCabecalho(e: EmpregadorAfd, rep: RepPAfd, periodo: { inicio: string; fim: string }, geradoEm: Date): string {
  const corpo =
    '000000000' +
    '1' +
    tipoDocumento(e.documento) +
    campoA(documento14(e.documento), 14) +
    (so(e.cnoCaepf) ? campoN(e.cnoCaepf!, 14) : campoA('', 14)) +
    campoA(e.razaoSocial, 150) +
    campoN(rep.inpiRegistro || '0', 17) +
    campoD(periodo.inicio) +
    campoD(periodo.fim) +
    campoDH(geradoEm) +
    VERSAO_LEIAUTE_AFD +
    tipoDocumento(rep.desenvolvedorDocumento) +
    campoA(documento14(rep.desenvolvedorDocumento), 14) +
    campoA('', 30); // modelo: só REP-C
  const linha = comCrc(corpo);
  if (linha.length !== 302) throw new Error(`Cabeçalho com ${linha.length} posições (esperado 302).`);
  return linha;
}

export interface MarcacaoAfd {
  nsr: number;
  marcacao: string | Date;  // data/hora da marcação de ponto
  gravacao: string | Date;  // data/hora de gravação do registro
  cpf: string;
  coletor: ColetorAfd;
  offline?: boolean;
}

/** Registro tipo "7" — marcação do REP-P (137 posições), encadeado pelo hash anterior. */
export function linhaMarcacao(m: MarcacaoAfd, hashAnterior: string | null): { linha: string; hash: string } {
  const cpf = so(m.cpf);
  if (cpf.length !== 11) throw new Error(`CPF inválido no NSR ${m.nsr}.`);
  const campos =
    campoN(m.nsr, 9) +
    '7' +
    campoDH(m.marcacao) +
    campoN(cpf, 12) +
    campoDH(m.gravacao) +
    campoN(m.coletor, 2) +
    (m.offline ? '1' : '0');
  const hash = createHash('sha256').update(campos + (hashAnterior || ''), 'latin1').digest('hex');
  const linha = campos + hash;
  if (linha.length !== 137) throw new Error(`Marcação NSR ${m.nsr} com ${linha.length} posições (esperado 137).`);
  return { linha, hash };
}

/** Registro tipo "9" — trailer (64 posições). Só há tipo 7 no nosso REP-P. */
export function linhaTrailer(qtd: { t2?: number; t3?: number; t4?: number; t5?: number; t6?: number; t7?: number }): string {
  return '999999999' + campoN(qtd.t2 || 0, 9) + campoN(qtd.t3 || 0, 9) + campoN(qtd.t4 || 0, 9)
    + campoN(qtd.t5 || 0, 9) + campoN(qtd.t6 || 0, 9) + campoN(qtd.t7 || 0, 9) + '9';
}

/** Última linha (100 posições): REP-P assina em arquivo .p7s à parte. */
export const linhaAssinatura = () => campoA(TEXTO_ASSINATURA_P7S, 100);

/** Nome do arquivo (sem extensão): "AFD" + INPI + CNPJ/CPF do empregador + "REP_P". */
export function nomeArquivoAfd(rep: RepPAfd, empregadorDocumento: string): string {
  return `AFD${campoN(rep.inpiRegistro || '0', 17)}${so(empregadorDocumento)}REP_P`;
}

/** Junta as linhas: CR LF no fim de cada uma (inclusive a última), em ISO 8859-1. */
export function montarArquivoAfd(linhas: string[]): Buffer {
  return Buffer.from(linhas.map(l => l + '\r\n').join(''), 'latin1');
}
