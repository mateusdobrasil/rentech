// app/lib/locacao/ledTecnico.ts
// Ficha técnica de painel de LED (2026-11-17). Função pura — usada no editor
// da ficha (estimativa ao digitar largura × altura) e no PDF da proposta.
// Cadastro por produto em locacao_produto_led (Estoque → Equipamentos).
// Painel vendido por m²: a quantidade do item = m² real (gabinetes inteiros).

export interface EspecLed {
  pitch_mm?: number | null;
  gabinete_largura_cm: number;
  gabinete_altura_cm: number;
  resolucao_largura_px: number;
  resolucao_altura_px: number;
  peso_kg_gabinete?: number | null;
  consumo_w_gabinete?: number | null;
  descricao_tecnica?: string | null;
}

export interface MontagemLed {
  colunas: number;
  linhas: number;
  gabinetes: number;
  larguraM: number;
  alturaM: number;
  m2: number;
  pixelLargura: number;
  pixelAltura: number;
  pesoKg: number | null;
  consumoKw: number | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Monta o painel com gabinetes inteiros mais próximos da largura × altura pedidas (em metros). */
export function calcularLed(e: EspecLed, larguraM: number, alturaM: number): MontagemLed | null {
  const gl = Number(e.gabinete_largura_cm), ga = Number(e.gabinete_altura_cm);
  if (!(gl > 0) || !(ga > 0) || !(larguraM > 0) || !(alturaM > 0)) return null;
  const colunas = Math.max(1, Math.round((larguraM * 100) / gl));
  const linhas = Math.max(1, Math.round((alturaM * 100) / ga));
  const gabinetes = colunas * linhas;
  const lm = r2((colunas * gl) / 100), am = r2((linhas * ga) / 100);
  return {
    colunas, linhas, gabinetes, larguraM: lm, alturaM: am, m2: r2(lm * am),
    pixelLargura: colunas * Number(e.resolucao_largura_px), pixelAltura: linhas * Number(e.resolucao_altura_px),
    pesoKg: e.peso_kg_gabinete ? r2(gabinetes * Number(e.peso_kg_gabinete)) : null,
    consumoKw: e.consumo_w_gabinete ? r2((gabinetes * Number(e.consumo_w_gabinete)) / 1000) : null,
  };
}

const n = (v: number, c = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });

/** Resumo de uma linha: "27,00 m² · 9,00 m × 3,00 m · 108 gabinetes (18 × 6) · 3.456 × 1.152 px · ~972 kg · ~16,2 kW" */
export function resumoLed(m: MontagemLed): string {
  return [
    `${n(m.m2)} m²`, `${n(m.larguraM)} m (L) × ${n(m.alturaM)} m (A)`, `${m.gabinetes} gabinetes (${m.colunas} × ${m.linhas})`,
    `pixel map ${m.pixelLargura.toLocaleString('pt-BR')} × ${m.pixelAltura.toLocaleString('pt-BR')} px`,
    m.pesoKg !== null ? `peso ~${n(m.pesoKg, 0)} kg` : null, m.consumoKw !== null ? `consumo ~${n(m.consumoKw, 1)} kW` : null,
  ].filter(Boolean).join(' · ');
}
