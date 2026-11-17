// app/lib/locacao/datas.ts
// Datas da locação (funções puras, servidor e navegador). Tudo em ISO
// AAAA-MM-DD, dias inteiros, sem fuso (meio-dia UTC evita virar o dia).

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Dias corridos inclusivos: 10/11 a 12/11 = 3. */
export function diasInclusivos(inicio: string, fim: string): number {
  const a = Date.parse(`${inicio}T12:00:00Z`), b = Date.parse(`${fim}T12:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

export function dataValida(s?: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

export interface DatasFicha {
  data_saida?: string | null;
  data_montagem?: string | null;
  data_inicio: string;
  data_fim: string;
  data_desmontagem?: string | null;
  data_retorno?: string | null;
}

/**
 * Período em que o equipamento fica preso na agenda:
 * [saída (ou montagem, ou início) − dias de preparo, retorno (ou desmontagem,
 * ou fim) + dias de retorno], dias inclusivos.
 */
export function periodoAlocacao(f: DatasFicha, diasPreparo = 0, diasRetorno = 0): { inicio: string; fim: string } {
  const saida = f.data_saida || f.data_montagem || f.data_inicio;
  const volta = f.data_retorno || f.data_desmontagem || f.data_fim;
  return { inicio: somarDias(saida, -Math.max(0, diasPreparo)), fim: somarDias(volta, Math.max(0, diasRetorno)) };
}

/** daterange do Postgres ("[2026-11-01,2026-11-06)") → dias inclusivos. */
export function lerDaterange(r: string): { inicio: string; fim: string } | null {
  const m = String(r || '').match(/^([[(])\s*(\d{4}-\d{2}-\d{2})?\s*,\s*(\d{4}-\d{2}-\d{2})?\s*([\])])$/);
  if (!m || !m[2] || !m[3]) return null;
  const inicio = m[1] === '[' ? m[2] : somarDias(m[2], 1);
  const fim = m[4] === ']' ? m[3] : somarDias(m[3], -1);
  return { inicio, fim };
}

export const daterangeInclusivo = (inicio: string, fim: string) => `[${inicio},${fim}]`;

/** Meses cobrados na modalidade mensal: cada 30 dias (ou fração) = 1 mês. */
export const mesesCobrados = (dias: number) => Math.max(1, Math.ceil(dias / 30));
