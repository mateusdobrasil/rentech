// app/lib/calculo13Salario.ts
// Motor de cálculo do 13º Salário INTEGRAL (contratos com
// folha_parametros.decimo_terceiro_integral = true) — quem não tem essa
// flag recebe o 13º só pela contabilidade (fluxo de OCR já existente em
// actions-financeiro.ts / SepararHolerites.tsx, sem nenhum cálculo nosso).
//
// Regras gerais da CLT para o caso comum (mesmo aviso de calculoRescisao.ts):
// toda linha aqui é conferível antes do pagamento, não é fonte legal
// autoritativa. Tabelas fiscais (INSS/IRRF) são as MESMAS de
// calculoRescisao.ts — reaproveitadas daqui pra não ter duas tabelas
// desatualizando em ritmos diferentes.
//
// 1ª parcela: 50% do bruto, SEM desconto (INSS/IRRF incidem só na 2ª,
// "tributação exclusiva" sobre o valor total do 13º). Prazo legal: até 30/11.
// 2ª parcela: bruto − parcela1 − INSS − IRRF. Prazo legal: até 20/12.
import { calcularINSS, calcularIRRF, contarMesesProporcionais } from './calculoRescisao';

export interface EntradaCalculo13 {
  salarioBase: number;
  dataAdmissao: string;              // ISO yyyy-mm-dd
  dataDesligamento: string | null;   // ISO yyyy-mm-dd, ou null se ainda ativo
  ano: number;                       // ano-base do 13º (ex.: 2026)
  numeroDependentesIrrf: number;
}

export interface ResultadoCalculo13 {
  ano: number;
  mesesAvos: number;
  salarioBase: number;
  valorBruto: number;
  parcela1Valor: number;
  inssValor: number;
  irrfValor: number;
  parcela2Valor: number;
  calculadoEm: string;
}

const arredonda = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const moeda = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function calcular13Integral(entrada: EntradaCalculo13): ResultadoCalculo13 {
  const { salarioBase, dataAdmissao, dataDesligamento, ano, numeroDependentesIrrf } = entrada;

  const inicioAno = `${ano}-01-01`;
  const fimAno = `${ano}-12-31`;
  // Avos contados só dentro do ano-base: admissão/desligamento fora dele não
  // reduzem nem aumentam o período (ex.: admitido em 2024 conta o ano
  // inteiro de 2026; desligado em 2027 também conta 2026 inteiro — a
  // rescisão de 2027 é que paga o proporcional daquele ano, calculoRescisao.ts).
  const inicioEfetivo = dataAdmissao > inicioAno ? dataAdmissao : inicioAno;
  const fimEfetivo = (dataDesligamento && dataDesligamento < fimAno) ? dataDesligamento : fimAno;
  const mesesAvos = Math.min(12, Math.max(0, contarMesesProporcionais(inicioEfetivo, fimEfetivo)));

  const valorBruto = arredonda((salarioBase / 12) * mesesAvos);
  const parcela1Valor = arredonda(valorBruto * 0.5);

  // INSS e IRRF incidem sobre o BRUTO TOTAL do 13º (tributação exclusiva,
  // igual ao proporcional da rescisão) — não sobre a 2ª parcela isolada.
  const inss = calcularINSS(valorBruto);
  const irrf = calcularIRRF(valorBruto - inss.valor, numeroDependentesIrrf);
  const parcela2Valor = arredonda(valorBruto - parcela1Valor - inss.valor - irrf.valor);

  return {
    ano, mesesAvos, salarioBase, valorBruto,
    parcela1Valor, inssValor: inss.valor, irrfValor: irrf.valor, parcela2Valor,
    calculadoEm: new Date().toISOString()
  };
}

// Itens "tipo recibo" (mesmo formato usado pelo PDF) — útil pra tela e pra
// auditoria (coluna `dados` de folha_decimo_terceiro).
export function itensCalculo13(r: ResultadoCalculo13) {
  return [
    { codigo: 'DECIMO_TERCEIRO_BRUTO', descricao: '13º salário integral', tipo: 'PROVENTO' as const, valor: r.valorBruto, formula: `(${moeda(r.salarioBase)} / 12) × ${r.mesesAvos} avo(s)` },
    { codigo: 'DECIMO_TERCEIRO_PARCELA1', descricao: '1ª parcela (50% do bruto, sem desconto)', tipo: 'INFORMATIVO' as const, valor: r.parcela1Valor, formula: `${moeda(r.valorBruto)} × 50%` },
    { codigo: 'INSS_DECIMO_TERCEIRO', descricao: 'INSS sobre o 13º (tributação exclusiva)', tipo: 'DESCONTO' as const, valor: r.inssValor, formula: `Tabela INSS sobre ${moeda(r.valorBruto)}` },
    { codigo: 'IRRF_DECIMO_TERCEIRO', descricao: 'IRRF sobre o 13º (tributação exclusiva)', tipo: 'DESCONTO' as const, valor: r.irrfValor, formula: `Tabela IRRF sobre ${moeda(r.valorBruto - r.inssValor)} (após INSS e dependentes)` },
    { codigo: 'DECIMO_TERCEIRO_PARCELA2', descricao: '2ª parcela líquida (bruto − 1ª parcela − INSS − IRRF)', tipo: 'INFORMATIVO' as const, valor: r.parcela2Valor, formula: `${moeda(r.valorBruto)} − ${moeda(r.parcela1Valor)} − ${moeda(r.inssValor)} − ${moeda(r.irrfValor)}` },
  ];
}
