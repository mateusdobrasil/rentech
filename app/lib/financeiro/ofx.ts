// app/lib/financeiro/ofx.ts
// Leitura de extrato OFX (1.x SGML e 2.x XML) — Itaú e demais bancos
// (2026-11-20). Função pura, servidor ou navegador. Tolerante: tags sem
// fechamento, CHARSET 1252, valores com vírgula, datas com fuso "[-3:BRT]".
import { createHash } from 'crypto';

export interface LancamentoOfx { data: string; valor: number; tipo: string; fitid: string; descricao: string; documento: string | null }
export interface ExtratoOfx {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  inicio: string | null;
  fim: string | null;
  saldo: number | null;
  saldoData: string | null;
  lancamentos: LancamentoOfx[];
}

/** Conteúdo do arquivo (bytes) → texto: UTF-8, ou Windows-1252 quando o cabeçalho pede/UTF-8 falha. */
export function decodificarOfx(bytes: Uint8Array): string {
  const inicio = new TextDecoder('latin1').decode(bytes.slice(0, 600));
  const pede1252 = /CHARSET:\s*(1252|ISO-8859-1|WINDOWS-1252)/i.test(inicio) || /encoding="(windows-1252|iso-8859-1)"/i.test(inicio);
  if (!pede1252) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* cai no 1252 */ }
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

const tag = (bloco: string, nome: string): string | null => {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() || null : null;
};
const dataOfx = (s: string | null): string | null => {
  const m = (s || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const valorOfx = (s: string | null): number => {
  if (!s) return 0;
  let t = s.trim().replace(/\s/g, '');
  // "1.234,56" → 1234.56 ; "1234,56" → 1234.56 ; "1234.56" fica
  if (t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
  const x = Number(t);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
};

export function lerOfx(texto: string): ExtratoOfx {
  const corpo = texto.slice(Math.max(0, texto.search(/<OFX>/i)));
  const contaBloco = (corpo.match(/<BANKACCTFROM>([\s\S]*?)(<\/BANKACCTFROM>|<BANKTRANLIST>)/i) || [])[1] || corpo;
  const lista = (corpo.match(/<BANKTRANLIST>([\s\S]*?)(<\/BANKTRANLIST>|<LEDGERBAL>)/i) || [])[1] || corpo;
  const saldoBloco = (corpo.match(/<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i) || [])[1] || '';

  const blocos = lista.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0]);
  const vistos = new Map<string, number>();
  const lancamentos: LancamentoOfx[] = [];
  for (const b of blocos) {
    const data = dataOfx(tag(b, 'DTPOSTED'));
    const valor = valorOfx(tag(b, 'TRNAMT'));
    if (!data || !valor) continue;
    const descricao = [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' — ') || '(sem descrição)';
    const documento = tag(b, 'CHECKNUM') || tag(b, 'REFNUM');
    let fitid = tag(b, 'FITID');
    if (!fitid) {
      // sem FITID: identificador estável pelo conteúdo (+ ordem entre iguais)
      const base = `${data}|${valor}|${descricao}|${documento || ''}`;
      const k = (vistos.get(base) || 0) + 1;
      vistos.set(base, k);
      fitid = 'H' + createHash('sha1').update(`${base}|${k}`).digest('hex').slice(0, 24);
    }
    lancamentos.push({ data, valor, tipo: (tag(b, 'TRNTYPE') || '').toUpperCase(), fitid, descricao, documento });
  }
  const datas = lancamentos.map(l => l.data).sort();
  return {
    banco: tag(contaBloco, 'BANKID'), agencia: tag(contaBloco, 'BRANCHID'), conta: tag(contaBloco, 'ACCTID'),
    inicio: dataOfx(tag(corpo, 'DTSTART')) || datas[0] || null, fim: dataOfx(tag(corpo, 'DTEND')) || datas[datas.length - 1] || null,
    saldo: saldoBloco ? valorOfx(tag(saldoBloco, 'BALAMT')) : null, saldoData: saldoBloco ? dataOfx(tag(saldoBloco, 'DTASOF')) : null,
    lancamentos,
  };
}
