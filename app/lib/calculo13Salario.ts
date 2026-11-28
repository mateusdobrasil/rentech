// app/lib/calculo13Salario.ts
// Motor do 13º Salário "Via Empresa" (contratos com
// folha_parametros.decimo_terceiro_integral = true). Quem recebe pela
// contabilidade não passa por aqui (OCR dos holerites importados).
//
// SEM descontos (pedido do usuário, 2026-11-28): nem o valor sugerido nem o
// digitado têm INSS/IRRF — o que aparece é o que se paga.
// - Sugerido: bruto = salário ÷ 12 × avos do ano; 1ª = 50% do bruto (prazo
//   legal 30/11); 2ª = bruto − 1ª (prazo legal 20/12).
// - Digitado: a 1ª e a 2ª são as que o RH digitou; bruto = 1ª + 2ª.
// As colunas inss_valor/irrf_valor de folha_decimo_terceiro ficam em zero
// (fechamentos antigos, de antes desta regra, podem ter valores).
import { contarMesesProporcionais } from './calculoRescisao';

export interface EntradaCalculo13 {
  salarioBase: number;
  dataAdmissao: string;              // ISO yyyy-mm-dd
  dataDesligamento: string | null;   // ISO yyyy-mm-dd, ou null se ainda ativo
  ano: number;                       // ano-base do 13º (ex.: 2026)
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
  manual?: boolean; // parcelas digitadas pelo usuário
}

const arredonda = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const moeda = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function calcularMesesAvos(dataAdmissao: string, dataDesligamento: string | null, ano: number): number {
  const inicioAno = `${ano}-01-01`;
  const fimAno = `${ano}-12-31`;
  // Avos contados só dentro do ano-base: admissão/desligamento fora dele não
  // reduzem nem aumentam o período (ex.: admitido em 2024 conta o ano
  // inteiro de 2026; desligado em 2027 também conta 2026 inteiro — a
  // rescisão de 2027 é que paga o proporcional daquele ano, calculoRescisao.ts).
  const inicioEfetivo = dataAdmissao > inicioAno ? dataAdmissao : inicioAno;
  const fimEfetivo = (dataDesligamento && dataDesligamento < fimAno) ? dataDesligamento : fimAno;
  return Math.min(12, Math.max(0, contarMesesProporcionais(inicioEfetivo, fimEfetivo)));
}

export function calcular13Integral(entrada: EntradaCalculo13): ResultadoCalculo13 {
  const { salarioBase, dataAdmissao, dataDesligamento, ano } = entrada;
  const mesesAvos = calcularMesesAvos(dataAdmissao, dataDesligamento, ano);
  const valorBruto = arredonda((salarioBase / 12) * mesesAvos);
  const parcela1Valor = arredonda(valorBruto * 0.5);
  return {
    ano, mesesAvos, salarioBase, valorBruto,
    parcela1Valor, inssValor: 0, irrfValor: 0, parcela2Valor: arredonda(valorBruto - parcela1Valor),
    calculadoEm: new Date().toISOString()
  };
}

export interface EntradaCalculo13ParcelasDigitadas {
  parcela1Valor: number;
  parcela2Valor: number;
  salarioBase: number;
  dataAdmissao: string;
  dataDesligamento: string | null;
  ano: number;
}

export function calcular13ComParcelasDigitadas(entrada: EntradaCalculo13ParcelasDigitadas): ResultadoCalculo13 {
  const { salarioBase, dataAdmissao, dataDesligamento, ano } = entrada;
  const parcela1Valor = arredonda(entrada.parcela1Valor);
  const parcela2Valor = arredonda(entrada.parcela2Valor);
  return {
    ano, mesesAvos: calcularMesesAvos(dataAdmissao, dataDesligamento, ano), salarioBase,
    valorBruto: arredonda(parcela1Valor + parcela2Valor),
    parcela1Valor, inssValor: 0, irrfValor: 0, parcela2Valor,
    calculadoEm: new Date().toISOString(), manual: true
  };
}

// Itens "tipo recibo" — auditoria (coluna `dados` de folha_decimo_terceiro).
export function itensCalculo13(r: ResultadoCalculo13) {
  if (r.manual) {
    return [
      { codigo: 'DECIMO_TERCEIRO_BRUTO', descricao: '13º salário (valores definidos pela empresa)', tipo: 'PROVENTO' as const, valor: r.valorBruto, formula: `${moeda(r.parcela1Valor)} + ${moeda(r.parcela2Valor)}` },
      { codigo: 'DECIMO_TERCEIRO_PARCELA1', descricao: '1ª parcela (digitada)', tipo: 'INFORMATIVO' as const, valor: r.parcela1Valor, formula: 'Valor digitado' },
      { codigo: 'DECIMO_TERCEIRO_PARCELA2', descricao: '2ª parcela (digitada)', tipo: 'INFORMATIVO' as const, valor: r.parcela2Valor, formula: 'Valor digitado' },
    ];
  }
  return [
    { codigo: 'DECIMO_TERCEIRO_BRUTO', descricao: '13º salário', tipo: 'PROVENTO' as const, valor: r.valorBruto, formula: `(${moeda(r.salarioBase)} / 12) × ${r.mesesAvos} avo(s)` },
    { codigo: 'DECIMO_TERCEIRO_PARCELA1', descricao: '1ª parcela (50% do bruto)', tipo: 'INFORMATIVO' as const, valor: r.parcela1Valor, formula: `${moeda(r.valorBruto)} × 50%` },
    { codigo: 'DECIMO_TERCEIRO_PARCELA2', descricao: '2ª parcela (bruto − 1ª parcela)', tipo: 'INFORMATIVO' as const, valor: r.parcela2Valor, formula: `${moeda(r.valorBruto)} − ${moeda(r.parcela1Valor)}` },
  ];
}
