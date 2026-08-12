// app/lib/calculoRescisao.ts
// Motor de cálculo de verbas rescisórias CLT (rescisão de funcionário).
// ATENÇÃO: implementa regras gerais da CLT para o caso comum. Toda linha
// gerada aqui é editável na tela antes da homologação — não é fonte legal
// autoritativa e deve ser conferida pela contabilidade antes de qualquer
// pagamento real. Tabelas fiscais precisam ser atualizadas todo ano.

export type MotivoRescisao =
  | 'SEM_JUSTA_CAUSA' | 'PEDIDO_DEMISSAO' | 'JUSTA_CAUSA'
  | 'ACORDO_MUTUO' | 'TERMINO_CONTRATO_EXPERIENCIA' | 'APOSENTADORIA';

export type TipoAvisoPrevio = 'INDENIZADO' | 'TRABALHADO' | 'ISENTO';

// Um desconto ativo do funcionário (folha_descontos) já resolvido para o
// valor a liquidar na rescisão — a resolução (parcelas restantes etc.) é
// feita na action, que tem acesso ao banco; aqui só chega o valor pronto.
export interface DescontoAtivoResolvido {
  descricao: string;
  valor: number;
  parcelaInfo: string; // texto exibido na fórmula, ex.: "3 parcela(s) restante(s) de 6"
}

export interface EntradaCalculoRescisao {
  salarioBase: number;
  dataAdmissao: string;                       // ISO yyyy-mm-dd
  dataDesligamento: string;                   // ISO yyyy-mm-dd
  motivo: MotivoRescisao;
  tipoAvisoPrevio: TipoAvisoPrevio;
  numeroDependentesIrrf: number;              // count(folha_dependentes)
  feriasVencidasCount: number;                // qtd de períodos DISPONIVEL vencidos até dataDesligamento
  ultimoPeriodoAquisitivoFim: string | null;   // maior periodo_aquisitivo_fim em folha_ferias, ou null
  descontosAtivos: DescontoAtivoResolvido[];   // descontos de folha_descontos ainda em aberto, já liquidados
}

export interface ItemRescisao {
  codigo: string;
  descricao: string;
  tipo: 'PROVENTO' | 'DESCONTO' | 'INFORMATIVO';
  valor: number;
  formula: string; // exibido na UI para auditoria
}

export interface ResultadoCalculoRescisao {
  itens: ItemRescisao[];
  totalProventos: number;
  totalDescontos: number;
  valorLiquido: number;         // totalProventos - totalDescontos (NÃO inclui a multa FGTS, que é informativa)
  diasAvisoPrevio: number;
  dataProjecaoAvisoPrevio: string | null;
  calculadoEm: string;
}

// ============================================================================
// Tabelas fiscais 2026 — conferidas via fontes contábeis/Receita Federal em
// agosto/2026. ATUALIZAR ANUALMENTE.
// ============================================================================

// Contribuição previdenciária (INSS), faixas progressivas 2026.
const INSS_FAIXAS_2026 = [
  { ate: 1621.00, aliquota: 0.075 },
  { ate: 2902.84, aliquota: 0.09 },
  { ate: 4354.27, aliquota: 0.12 },
  { ate: 8475.55, aliquota: 0.14 }, // teto do salário-de-contribuição
];

// IRRF — tabela progressiva mensal 2026 (faixa de isenção ampliada para
// R$2.428,80 pela Lei 15.270/2025; alíquotas nominais inalteradas desde
// maio/2025).
const IRRF_FAIXAS_2026 = [
  { ate: 2428.80, aliquota: 0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
];
const IRRF_DEDUCAO_POR_DEPENDENTE = 189.59;

// Redutor adicional 2026 (Lei 15.270/2025), aplicado DEPOIS do cálculo
// tradicional acima: zera o IR até base R$5.000; reduz linearmente até
// R$7.350; acima disso não há redutor.
function aplicarRedutorIrrf2026(baseMensal: number, impostoTradicional: number): number {
  if (baseMensal <= 5000) return 0;
  if (baseMensal <= 7350) {
    const reducao = 978.62 - 0.133145 * baseMensal;
    return Math.max(0, impostoTradicional - Math.max(0, reducao));
  }
  return impostoTradicional;
}

// Multa do FGTS por motivo de rescisão. A base (saldo do FGTS) é sempre
// digitada manualmente pelo RH — o sistema não guarda depósitos históricos.
const FGTS_MULTA_POR_MOTIVO: Record<MotivoRescisao, number> = {
  SEM_JUSTA_CAUSA: 0.40,
  ACORDO_MUTUO: 0.20,          // CLT art. 484-A
  JUSTA_CAUSA: 0,
  PEDIDO_DEMISSAO: 0,
  TERMINO_CONTRATO_EXPERIENCIA: 0,
  APOSENTADORIA: 0,
};

// ============================================================================
// Helpers de data (mesmo estilo usado em actions-ferias.ts/actions-afastamentos.ts:
// strings ISO manipuladas via Date local, sem depender de timezone do servidor).
// ============================================================================
function addDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function diaDoMes(iso: string): number {
  return Number(iso.slice(8, 10));
}

function anosCompletos(inicio: string, fim: string): number {
  const [ai, mi, di] = inicio.split('-').map(Number);
  const [af, mf, df] = fim.split('-').map(Number);
  let anos = af - ai;
  if (mf < mi || (mf === mi && df < di)) anos--;
  return Math.max(0, anos);
}

// Conta meses "cheios" (≥15 dias trabalhados no mês) entre duas datas ISO,
// regra padrão para 13º e férias proporcionais.
function contarMesesProporcionais(inicio: string, fim: string): number {
  if (fim < inicio) return 0;
  let meses = 0;
  let [ano, mes] = [Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7))];
  const [anoFim, mesFim] = [Number(fim.slice(0, 4)), Number(fim.slice(5, 7))];
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    const inicioMes = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDiaMes = new Date(ano, mes, 0).getDate();
    const fimMes = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDiaMes).padStart(2, '0')}`;
    const inicioEfetivo = inicioMes < inicio ? inicio : inicioMes;
    const fimEfetivo = fimMes > fim ? fim : fimMes;
    const diasTrabalhados = Number(fimEfetivo.slice(8, 10)) - Number(inicioEfetivo.slice(8, 10)) + 1;
    if (diasTrabalhados >= 15) meses++;
    mes++;
    if (mes > 12) { mes = 1; ano++; }
  }
  return meses;
}

const arredonda = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const moeda = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ============================================================================
// Funções exportadas
// ============================================================================

export function calcularDiasAvisoPrevio(dataAdmissao: string, dataDesligamento: string, motivo: MotivoRescisao): number {
  if (motivo === 'JUSTA_CAUSA' || motivo === 'TERMINO_CONTRATO_EXPERIENCIA') return 0;
  if (motivo === 'PEDIDO_DEMISSAO' || motivo === 'APOSENTADORIA') return 30;
  // Lei 12.506/2011: 30 dias + 3 dias por ano completo de serviço, teto 90 dias.
  const anos = anosCompletos(dataAdmissao, dataDesligamento);
  return Math.min(90, 30 + 3 * anos);
}

export function calcularPercentualMultaFgts(motivo: MotivoRescisao): number {
  return FGTS_MULTA_POR_MOTIVO[motivo];
}

// Estimativa GROSSEIRA do saldo de FGTS, só para dar um ponto de partida ao
// RH — 8% do salário atual multiplicado pelos meses de casa. Não considera
// aumentos salariais ao longo do tempo, 13º, verbas variáveis, nem
// rendimento da conta. Sempre editável: o valor real deve vir do extrato do
// FGTS (app do trabalhador/Caixa) ou da contabilidade.
export function calcularEstimativaFgts(salarioBase: number, dataAdmissao: string, dataDesligamento: string): number {
  const meses = contarMesesProporcionais(dataAdmissao, dataDesligamento);
  return arredonda(salarioBase * 0.08 * meses);
}

export function calcularINSS(baseMensal: number): { valor: number; aliquotaEfetiva: number } {
  if (baseMensal <= 0) return { valor: 0, aliquotaEfetiva: 0 };
  const teto = INSS_FAIXAS_2026[INSS_FAIXAS_2026.length - 1].ate;
  const baseTeto = Math.min(baseMensal, teto);
  let valor = 0;
  let anterior = 0;
  for (const faixa of INSS_FAIXAS_2026) {
    if (baseTeto <= anterior) break;
    const parcial = Math.min(baseTeto, faixa.ate) - anterior;
    valor += parcial * faixa.aliquota;
    anterior = faixa.ate;
  }
  valor = arredonda(valor);
  return { valor, aliquotaEfetiva: baseMensal > 0 ? valor / baseMensal : 0 };
}

export function calcularIRRF(baseMensal: number, numeroDependentes: number): { valor: number; aliquotaEfetiva: number } {
  const baseComDependentes = Math.max(0, baseMensal - IRRF_DEDUCAO_POR_DEPENDENTE * Math.max(0, numeroDependentes));
  if (baseComDependentes <= 0) return { valor: 0, aliquotaEfetiva: 0 };
  const faixa = IRRF_FAIXAS_2026.find(f => baseComDependentes <= f.ate)!;
  const impostoTradicional = Math.max(0, baseComDependentes * faixa.aliquota - faixa.deduzir);
  const valor = arredonda(aplicarRedutorIrrf2026(baseComDependentes, impostoTradicional));
  return { valor, aliquotaEfetiva: baseMensal > 0 ? valor / baseMensal : 0 };
}

export function calcularRescisao(entrada: EntradaCalculoRescisao): ResultadoCalculoRescisao {
  const {
    salarioBase, dataAdmissao, dataDesligamento, motivo, tipoAvisoPrevio,
    numeroDependentesIrrf, feriasVencidasCount, ultimoPeriodoAquisitivoFim, descontosAtivos
  } = entrada;

  const itens: ItemRescisao[] = [];

  const diasAvisoPrevio = calcularDiasAvisoPrevio(dataAdmissao, dataDesligamento, motivo);
  // Indenização de aviso prévio só é devida pelo empregador em dispensa sem
  // justa causa ou acordo mútuo (pela metade). Nos demais motivos não há
  // verba a pagar ao empregado por este item.
  const avisoIndenizadoDevido = tipoAvisoPrevio === 'INDENIZADO' && (motivo === 'SEM_JUSTA_CAUSA' || motivo === 'ACORDO_MUTUO');
  const dataProjecaoAvisoPrevio = avisoIndenizadoDevido ? addDiasIso(dataDesligamento, diasAvisoPrevio) : null;
  const dataBaseProjetada = dataProjecaoAvisoPrevio ?? dataDesligamento;

  // 1) Saldo de salário
  const diaMes = diaDoMes(dataDesligamento);
  const valorSaldoSalario = arredonda((salarioBase / 30) * diaMes);
  itens.push({
    codigo: 'SALDO_SALARIO', descricao: 'Saldo de salário', tipo: 'PROVENTO',
    valor: valorSaldoSalario, formula: `(${moeda(salarioBase)} / 30) × ${diaMes} dia(s)`
  });

  // 2) Aviso prévio indenizado
  if (avisoIndenizadoDevido) {
    let valorAviso = (salarioBase / 30) * diasAvisoPrevio;
    let formulaAviso = `(${moeda(salarioBase)} / 30) × ${diasAvisoPrevio} dias`;
    if (motivo === 'ACORDO_MUTUO') {
      valorAviso = valorAviso / 2;
      formulaAviso += ' ÷ 2 (acordo mútuo — CLT art. 484-A)';
    }
    itens.push({
      codigo: 'AVISO_PREVIO_INDENIZADO', descricao: 'Aviso prévio indenizado', tipo: 'PROVENTO',
      valor: arredonda(valorAviso), formula: formulaAviso
    });
  }

  // 3) 13º salário proporcional — sempre devido, inclusive em justa causa
  // (verba já incorporada mês a mês, não é penalidade).
  const anoBase = Number(dataBaseProjetada.slice(0, 4));
  const inicioAno13 = `${anoBase}-01-01`;
  const inicio13 = dataAdmissao > inicioAno13 ? dataAdmissao : inicioAno13;
  const meses13 = Math.min(12, contarMesesProporcionais(inicio13, dataBaseProjetada));
  const valor13 = arredonda((salarioBase / 12) * meses13);
  itens.push({
    codigo: 'DECIMO_TERCEIRO_PROPORCIONAL', descricao: '13º salário proporcional', tipo: 'PROVENTO',
    valor: valor13, formula: `(${moeda(salarioBase)} / 12) × ${meses13} avo(s)`
  });

  // 4) Férias vencidas — direito já adquirido, sempre devido.
  if (feriasVencidasCount > 0) {
    const valorFeriasVencidas = arredonda(feriasVencidasCount * (salarioBase + salarioBase / 3));
    itens.push({
      codigo: 'FERIAS_VENCIDAS', descricao: `Férias vencidas (${feriasVencidasCount} período(s)) + 1/3`, tipo: 'PROVENTO',
      valor: valorFeriasVencidas, formula: `${feriasVencidasCount} × (${moeda(salarioBase)} + 1/3)`
    });
  }

  // 5) Férias proporcionais — não devidas em justa causa (Súmula 171 TST).
  if (motivo !== 'JUSTA_CAUSA') {
    const inicioPeriodoFerias = ultimoPeriodoAquisitivoFim || dataAdmissao;
    const mesesFerias = Math.min(12, contarMesesProporcionais(inicioPeriodoFerias, dataBaseProjetada));
    if (mesesFerias > 0) {
      const valorFeriasProp = arredonda((salarioBase / 12) * mesesFerias * (4 / 3));
      itens.push({
        codigo: 'FERIAS_PROPORCIONAIS', descricao: 'Férias proporcionais + 1/3', tipo: 'PROVENTO',
        valor: valorFeriasProp, formula: `(${moeda(salarioBase)} / 12) × ${mesesFerias} avo(s) × 4/3`
      });
    }
  }

  // 6/7) INSS e IRRF — incidem só sobre saldo de salário e 13º (tributado
  // isoladamente), nunca sobre férias/aviso indenizados ou multa FGTS
  // (verbas indenizatórias, art. 214 §9º do Regulamento da Previdência Social).
  const inssSaldo = calcularINSS(valorSaldoSalario);
  itens.push({
    codigo: 'INSS_SALDO_SALARIO', descricao: 'INSS sobre saldo de salário', tipo: 'DESCONTO',
    valor: inssSaldo.valor, formula: `Tabela INSS 2026 sobre ${moeda(valorSaldoSalario)}`
  });
  const irrfSaldo = calcularIRRF(valorSaldoSalario - inssSaldo.valor, numeroDependentesIrrf);
  itens.push({
    codigo: 'IRRF_SALDO_SALARIO', descricao: 'IRRF sobre saldo de salário', tipo: 'DESCONTO',
    valor: irrfSaldo.valor, formula: `Tabela IRRF 2026 sobre ${moeda(valorSaldoSalario - inssSaldo.valor)} (após INSS e dependentes)`
  });

  const inss13 = calcularINSS(valor13);
  itens.push({
    codigo: 'INSS_DECIMO_TERCEIRO', descricao: 'INSS sobre 13º proporcional', tipo: 'DESCONTO',
    valor: inss13.valor, formula: `Tabela INSS 2026 sobre ${moeda(valor13)} (tributação exclusiva)`
  });
  const irrf13 = calcularIRRF(valor13 - inss13.valor, numeroDependentesIrrf);
  itens.push({
    codigo: 'IRRF_DECIMO_TERCEIRO', descricao: 'IRRF sobre 13º proporcional', tipo: 'DESCONTO',
    valor: irrf13.valor, formula: `Tabela IRRF 2026 sobre ${moeda(valor13 - inss13.valor)} (tributação exclusiva)`
  });

  // 9) Contrato de experiência: sistema não sabe a data original de término,
  // então nunca omite silenciosamente — força o RH a decidir.
  if (motivo === 'TERMINO_CONTRATO_EXPERIENCIA') {
    itens.push({
      codigo: 'INDENIZACAO_ART_479_480', descricao: 'Indenização por rescisão antecipada (se houver)', tipo: 'INFORMATIVO',
      valor: 0, formula: 'Calcular manualmente se houve rescisão antecipada do contrato de experiência — CLT arts. 479/480'
    });
  }

  // 10) Descontos ativos do funcionário (folha_descontos) ainda em aberto —
  // parcelado é liquidado de uma vez (não dá pra cobrar parcela futura de
  // quem não trabalha mais aqui); fixo entra só pelo valor do último mês.
  descontosAtivos.forEach((d, i) => {
    itens.push({
      codigo: `DESCONTO_ATIVO_${i}`, descricao: `Desconto: ${d.descricao}`, tipo: 'DESCONTO',
      valor: arredonda(d.valor), formula: d.parcelaInfo
    });
  });

  // 11) Campo livre — descontos avulsos não previstos automaticamente
  // (dano a equipamento, uniforme não devolvido, etc.), sempre em branco.
  itens.push({
    codigo: 'OUTROS_DESCONTOS', descricao: 'Outros descontos', tipo: 'DESCONTO',
    valor: 0, formula: 'Preencher manualmente se houver algum desconto não coberto automaticamente'
  });

  const totalProventos = arredonda(itens.filter(i => i.tipo === 'PROVENTO').reduce((s, i) => s + i.valor, 0));
  const totalDescontos = arredonda(itens.filter(i => i.tipo === 'DESCONTO').reduce((s, i) => s + i.valor, 0));

  return {
    itens,
    totalProventos,
    totalDescontos,
    valorLiquido: arredonda(totalProventos - totalDescontos),
    diasAvisoPrevio,
    dataProjecaoAvisoPrevio,
    calculadoEm: new Date().toISOString()
  };
}
