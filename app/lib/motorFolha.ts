// app/lib/motorFolha.ts
// MOTOR DA FOLHA — fonte única do cálculo do demonstrativo (créditos, débitos e
// líquido). Antes existia uma cópia em /admin/rh/holerite e outra em
// /admin/rh/relatorios, "idênticas" no comentário mas que já tinham divergido
// (Relatórios não fazia salário proporcional de admissão/desligamento no mês,
// usava o mes_fim gravado do desconto parcelado e descontava VR/VT por falta
// mesmo em contrato sem desconto de faltas). Tour de melhorias 2026-11-11,
// item 7. Regra nova de folha: mexer SÓ aqui.
//
// Funções puras, sem 'use client'/'use server' — servem pra tela e pro servidor.

// ============================================================================
// TIPOS
// ============================================================================
export interface RegraContrato {
  nome_regra: string;
  paga_salario_base: boolean;
  calcula_extras_padrao: boolean;
  percentual_extra_semana: number;
  percentual_extra_sabado: number;
  tipo_pagamento_fds: 'HORA_PERCENTUAL' | 'VALOR_DIARIA';
  percentual_extra_dom_fer: number;
  valor_diaria_fds: number;
  desconta_faltas: boolean;
  direito_vr: boolean;
  direito_vt: boolean;
  modalidade_beneficio: 'POR_DIA' | 'VALOR_FECHADO';
  so_documental: boolean;
  // Contrato com paga_salario_base=false pode ainda assim ter o salário pago
  // por fora, pela contabilidade (ex.: CLT + BV) — essa flag é o sinal de
  // verdade disso, usada por actions-assinatura.ts para somar o valor do
  // holerite (lido por OCR) ao recibo. Não confundir com salario_folha, que é
  // só um valor de referência para cálculo de hora, não um "recebe ou não".
  recebe_holerite_contabilidade: boolean;
  // Diária por dia excedente: cada dia com ponto além de dias_base_mes paga uma
  // diária (valor vem de folha_funcionarios.diaria_extra). Soma ao que já é
  // pago de hora extra / diária de fim de semana, não substitui.
  paga_dias_excedentes: boolean;
  dias_base_mes: number | null;
  // Redução sazonal: contrato permite meio salário (base + complemento) nos dois
  // meses escolhidos na ficha (reducao_sazonal_* em folha_funcionarios).
  permite_reducao_sazonal: boolean;
}

// Só os campos da ficha que o motor usa (as telas passam a ficha inteira).
export interface FuncionarioMotor {
  nome_completo: string; cargo: string; tipo_contrato: string; ativo: boolean;
  salario_folha: number; salario_contrato: number; valor_adiantamento: number;
  // Valor pago por dia trabalhado acima da base do contrato (regra
  // paga_dias_excedentes). Não confundir com valor_premio_diaria_viagem nem
  // com o valor_diaria antigo da ficha.
  diaria_extra?: number | null;
  // Redução sazonal (só vale se o contrato permite): metade do salário de
  // contrato nos meses 1–12 escolhidos, todo ano.
  reducao_sazonal_ativa?: boolean | null;
  reducao_sazonal_mes1?: number | null;
  reducao_sazonal_mes2?: number | null;
  data_admissao?: string | null; data_desligamento?: string | null;
}

export interface Desconto { id?: string; funcionario_nome?: string; descricao: string; tipo: 'FIXO' | 'PARCELADO'; parcelas: number; mes_inicio: string; mes_fim: string; valor_parcela: number; }
export interface Bonus { id?: string; funcionario_nome?: string; descricao: string; recorrencia: 'MENSAL' | 'UNICO'; mes_referencia: string; valor: number; mes_fim?: string | null; }

export interface ApuracaoPonto {
  mins60: number; mins100: number; diasFds: number; faltas: number;
  qtdVr: number; qtdVt: number; diasTrabalhados: number;
  // Minutos trabalhados + abonados em dia útil (indicador do Relatórios RH)
  minsTrabalhadosTotal: number;
}

export interface DadosHolerite {
  minutosExtras60: number; minutosExtras100: number; diasTrabalhadosFds: number;
  totalExtra60: number; totalExtra100: number; totalDiariasFdsFechada: number;
  diasTrabalhados: number; diasExcedentes: number; valorDiariaExcedente: number; totalDiariasExcedentes: number;
  diasFaltas: number; valorDescontoFaltas: number;
  salarioBaseExibido: number; complementoContratoExibido: number; avosSalario: number;
  // true = mês de redução sazonal: base e complemento acima já estão pela metade
  reducaoSazonal?: boolean;
  bonusAtivos: Bonus[]; descontosAtivos: Desconto[];
  valorAdiantamento: number;
  qtdVr: number; qtdVt: number; diariaVr: number; diariaVt: number;
  totalVr: number; totalVt: number; modalidade: 'POR_DIA' | 'VALOR_FECHADO';
  descontoVrFaltas: number; descontoVtFaltas: number; totalDescontoBeneficios: number;
  regra: RegraContrato;
  cargo: string; tipoContrato: string; ativo: boolean;
  totalCreditos: number; totalDebitos: number; valorLiquidoReceber: number;
}

export const REGRA_PADRAO: RegraContrato = {
  nome_regra: 'PADRÃO',
  paga_salario_base: true, calcula_extras_padrao: true, percentual_extra_semana: 60,
  percentual_extra_sabado: 60, tipo_pagamento_fds: 'HORA_PERCENTUAL', percentual_extra_dom_fer: 100,
  valor_diaria_fds: 0, desconta_faltas: true,
  direito_vr: false, direito_vt: false, modalidade_beneficio: 'POR_DIA', so_documental: false,
  recebe_holerite_contabilidade: true,
  paga_dias_excedentes: false, dias_base_mes: null,
  permite_reducao_sazonal: false
};

// Linha de folha_parametros → RegraContrato (defaults dos campos novos/nulos).
export function mapearRegraContrato(r: any): RegraContrato {
  return {
    nome_regra: r.nome_regra, paga_salario_base: r.paga_salario_base,
    calcula_extras_padrao: r.calcula_extras_padrao,
    percentual_extra_semana: r.percentual_extra_semana ?? 60,
    percentual_extra_sabado: r.percentual_extra_sabado ?? 60,
    tipo_pagamento_fds: r.tipo_pagamento_fds === 'HORA_100' ? 'HORA_PERCENTUAL' : (r.tipo_pagamento_fds || 'HORA_PERCENTUAL'),
    percentual_extra_dom_fer: r.percentual_extra_dom_fer ?? 100,
    valor_diaria_fds: r.valor_diaria_fds ?? 0, desconta_faltas: r.desconta_faltas,
    direito_vr: r.direito_vr ?? false, direito_vt: r.direito_vt ?? false,
    modalidade_beneficio: r.modalidade_beneficio || 'POR_DIA',
    so_documental: r.so_documental ?? false,
    recebe_holerite_contabilidade: r.recebe_holerite_contabilidade ?? true,
    paga_dias_excedentes: r.paga_dias_excedentes ?? false,
    dias_base_mes: r.dias_base_mes ?? null,
    permite_reducao_sazonal: r.permite_reducao_sazonal ?? false
  };
}

export function mapearRegrasContrato(linhas: any[] | null | undefined): Record<string, RegraContrato> {
  const mapa: Record<string, RegraContrato> = {};
  (linhas || []).forEach(r => { mapa[r.nome_regra] = mapearRegraContrato(r); });
  return mapa;
}

// ============================================================================
// UTILITÁRIOS DE DATA
// ============================================================================
// Último mês (AAAA-MM) de um desconto parcelado que começa em mesInicio.
export const calcularMesFim = (mesInicio: string, parcelas: number) => {
  if (!mesInicio || parcelas < 1) return mesInicio;
  const [ano, mes] = mesInicio.split('-').map(Number);
  const dataFim = new Date(ano, (mes - 1) + (parcelas - 1), 1);
  return `${dataFim.getFullYear()}-${String(dataFim.getMonth() + 1).padStart(2, '0')}`;
};

const getDiaSemana = (dataIso: string) => {
  const partes = dataIso.split('-');
  return new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10)).getDay();
};

// ============================================================================
// APURAÇÃO DO PONTO (batidas + abonos) EM DOIS GRUPOS
// ============================================================================
export const apurarPonto = (
  dias: Record<string, { trabalhados: number; abonados: number }>,
  feriados: string[],
  mesAno: string,
  dataAdmissao?: string | null,
  dataDesligamento?: string | null
): ApuracaoPonto => {
  let mins60 = 0; let mins100 = 0; let diasFds = 0;
  let qtdVr = 0; let qtdVt = 0;
  let minsTrabalhadosTotal = 0;
  // Dias em que houve trabalho de fato, em qualquer dia da semana — base da
  // regra de diária por dia excedente. Abono não conta: o funcionário não
  // esteve lá.
  let diasTrabalhados = 0;

  Object.entries(dias).forEach(([dataIso, v]) => {
    const diaSemana = getDiaSemana(dataIso);
    const isFeriado = feriados.includes(dataIso);
    if (v.trabalhados > 0) diasTrabalhados++;
    // Abono só conta em dia útil (sábado/domingo/feriado não tem jornada a abonar)
    minsTrabalhadosTotal += v.trabalhados + ((isFeriado || diaSemana === 0 || diaSemana === 6) ? 0 : v.abonados);

    if (isFeriado || diaSemana === 0) {
      if (v.trabalhados > 0) {
        mins100 += v.trabalhados; diasFds++;
        qtdVt += 1;
        qtdVr += v.trabalhados > 480 ? 2 : 1;
      }
    } else if (diaSemana === 6) {
      if (v.trabalhados > 0) {
        mins60 += v.trabalhados; diasFds++;
        qtdVt += 1;
        qtdVr += v.trabalhados > 480 ? 2 : 1;
      }
    } else {
      const extraDia = (v.trabalhados + v.abonados) - 480;
      if (extraDia > 0) mins60 += extraDia;
      if (extraDia > 180) qtdVr += 1;
    }
  });

  let faltas = 0;
  const temRegistroNoMes = Object.values(dias).some(v => v.trabalhados > 0 || v.abonados > 0);

  if (temRegistroNoMes) {
    const [ano, mes] = mesAno.split('-').map(Number);
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);

    for (let d = 1; d <= diasNoMes; d++) {
      const data = new Date(ano, mes - 1, d);
      if (data > hoje) break;
      const dataIso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      if (dataAdmissao && dataIso < dataAdmissao) continue;
      if (dataDesligamento && dataIso > dataDesligamento) continue;

      const diaSemana = data.getDay();
      if (diaSemana === 0 || diaSemana === 6 || feriados.includes(dataIso)) continue;

      const reg = dias[dataIso];
      const presente = reg && (reg.trabalhados > 0 || reg.abonados > 0);
      if (!presente) faltas++;
    }
  }

  return { mins60, mins100, diasFds, faltas, qtdVr, qtdVt, diasTrabalhados, minsTrabalhadosTotal };
};

// ============================================================================
// MOTOR DE CÁLCULO DO HOLERITE — função pura
// ============================================================================
export const montarDadosHolerite = (
  func: FuncionarioMotor,
  regras: Record<string, RegraContrato>,
  descontosFunc: Desconto[],
  bonusFunc: Bonus[],
  apuracao: Omit<ApuracaoPonto, 'minsTrabalhadosTotal'> & { minsTrabalhadosTotal?: number },
  mesRef: string,
  // Valor unitário do VR/VT vindo da Gestão de Benefícios (folha_beneficios) —
  // fonte única, para o RH não redigitar na ficha. O contrato ainda governa QUEM
  // tem direito ao extra (direito_vr/direito_vt) e a modalidade (÷30 ou não).
  beneficios: { vr: number; vt: number } = { vr: 0, vt: 0 }
): DadosHolerite => {
  const regra = regras[func.tipo_contrato] || { ...REGRA_PADRAO, nome_regra: func.tipo_contrato || 'PADRÃO' };

  const salarioBaseCalculo = func.salario_folha > 0 ? func.salario_folha : func.salario_contrato;
  const valorHoraBase = salarioBaseCalculo / 220;

  let totalExtra60 = 0;
  let totalExtra100 = 0;
  let totalDiariasFdsFechada = 0;

  if (regra.calcula_extras_padrao) {
    if (regra.tipo_pagamento_fds === 'HORA_PERCENTUAL') {
      totalExtra60 = (apuracao.mins60 / 60) * valorHoraBase * (1 + (regra.percentual_extra_semana / 100));
      totalExtra100 = (apuracao.mins100 / 60) * valorHoraBase * (1 + (regra.percentual_extra_dom_fer / 100));
    } else {
      totalDiariasFdsFechada = apuracao.diasFds * regra.valor_diaria_fds;
    }
  }

  const [anoRef, mesRefNum] = mesRef.split('-').map(Number);
  const ultimoDiaMes = new Date(anoRef, mesRefNum, 0).getDate();
  let primeiroDiaTrab = 1;
  let ultimoDiaTrab = ultimoDiaMes;
  if (func.data_admissao && func.data_admissao.slice(0, 7) === mesRef) {
    primeiroDiaTrab = Number(func.data_admissao.slice(8, 10));
  }
  if (func.data_desligamento && func.data_desligamento.slice(0, 7) === mesRef) {
    ultimoDiaTrab = Number(func.data_desligamento.slice(8, 10));
  }
  const diasCorridosTrab = Math.max(0, ultimoDiaTrab - primeiroDiaTrab + 1);
  const trabalhouMesInteiro = primeiroDiaTrab === 1 && ultimoDiaTrab === ultimoDiaMes;
  const avosSalario = trabalhouMesInteiro ? 30 : Math.min(30, diasCorridosTrab);
  const fatorProporcional = avosSalario / 30;

  // REDUÇÃO SAZONAL — meses sem serviço (acordo da Rentech): quem tem a opção
  // ligada na ficha, num contrato que permite, recebe metade do salário de
  // contrato nos dois meses escolhidos, todo ano. O salário base (o do holerite
  // da contabilidade) fica INTACTO e a diferença sai do complemento — ex.
  // Gilmasio: contrato 6.000 → base 2.236,60 + complemento 763,40 = 3.000. Se a
  // base sozinha já passar da metade, o complemento zera (base não é reduzida).
  // Hora extra, diárias, bônus e VR/VT seguem cheios; faltas e adiantamento não
  // mudam (decisão do RH, 2026-11-05).
  const reducaoSazonal = !!regra.permite_reducao_sazonal && !!func.reducao_sazonal_ativa &&
    [func.reducao_sazonal_mes1, func.reducao_sazonal_mes2].includes(mesRefNum);

  const salarioBaseExibido = regra.paga_salario_base ? func.salario_folha * fatorProporcional : 0;
  const complementoContratoExibido = !regra.paga_salario_base ? 0
    : reducaoSazonal
      ? Math.max(0, func.salario_contrato * fatorProporcional * 0.5 - salarioBaseExibido)
      : Math.max(0, func.salario_contrato - func.salario_folha) * fatorProporcional;

  const descontosAtivos = descontosFunc.filter(d => {
    if (mesRef < d.mes_inicio) return false;
    if (d.tipo === 'FIXO') return !d.mes_fim || d.mes_fim === '2099-12' || mesRef <= d.mes_fim;
    const fimReal = (d.mes_inicio && d.parcelas > 0) ? calcularMesFim(d.mes_inicio, d.parcelas) : d.mes_fim;
    return mesRef <= fimReal;
  });
  const bonusAtivos = bonusFunc.filter(b => b.recorrencia === 'MENSAL' ? (!b.mes_fim || mesRef <= b.mes_fim) : b.mes_referencia === mesRef);

  const totalBonusGrid = bonusAtivos.reduce((acc, curr) => acc + curr.valor, 0);
  const totalDescontosGrid = descontosAtivos.reduce((acc, curr) => acc + curr.valor_parcela, 0);

  const modalidade = regra.modalidade_beneficio;
  const diariaVr = modalidade === 'VALOR_FECHADO' ? (beneficios.vr / 30) : beneficios.vr;
  const diariaVt = modalidade === 'VALOR_FECHADO' ? (beneficios.vt / 30) : beneficios.vt;

  const qtdVr = regra.direito_vr ? apuracao.qtdVr : 0;
  const qtdVt = regra.direito_vt ? apuracao.qtdVt : 0;

  const totalVr = qtdVr * diariaVr;
  const totalVt = qtdVt * diariaVt;
  const totalAdicionais = totalVr + totalVt;

  // DIÁRIA POR DIA EXCEDENTE — cada dia trabalhado acima da base definida no
  // contrato paga uma diária, no valor da ficha do funcionário. Ex.: base 26,
  // trabalhou 29 → 3 diárias. Crédito à parte: soma ao que já é pago de hora
  // extra e de diária de fim de semana.
  const diasBase = regra.paga_dias_excedentes ? (regra.dias_base_mes ?? 0) : 0;
  const diasExcedentes = diasBase > 0 ? Math.max(0, apuracao.diasTrabalhados - diasBase) : 0;
  const valorDiariaExcedente = func.diaria_extra || 0;
  const totalDiariasExcedentes = diasExcedentes * valorDiariaExcedente;

  const baseFaltas = func.salario_contrato > 0 ? func.salario_contrato : func.salario_folha;
  const diasFaltas = regra.desconta_faltas ? apuracao.faltas : 0;
  const valorDescontoFaltas = diasFaltas > 0 ? (baseFaltas / 30) * diasFaltas : 0;

  const descontoVrFaltas = (regra.desconta_faltas && regra.direito_vr ? apuracao.faltas : 0) * diariaVr;
  const descontoVtFaltas = (regra.desconta_faltas && regra.direito_vt ? apuracao.faltas : 0) * diariaVt;
  const totalDescontoBeneficios = descontoVrFaltas + descontoVtFaltas;

  const totalCreditos = salarioBaseExibido + complementoContratoExibido + totalBonusGrid + totalExtra60 + totalExtra100 + totalDiariasFdsFechada + totalDiariasExcedentes + totalAdicionais;
  const totalDebitos = func.valor_adiantamento + totalDescontosGrid + valorDescontoFaltas + totalDescontoBeneficios;
  const valorLiquidoReceber = totalCreditos - totalDebitos;

  return {
    minutosExtras60: apuracao.mins60, minutosExtras100: apuracao.mins100, diasTrabalhadosFds: apuracao.diasFds,
    totalExtra60, totalExtra100, totalDiariasFdsFechada,
    diasTrabalhados: apuracao.diasTrabalhados, diasExcedentes, valorDiariaExcedente, totalDiariasExcedentes,
    diasFaltas, valorDescontoFaltas,
    salarioBaseExibido, complementoContratoExibido, avosSalario, reducaoSazonal,
    bonusAtivos, descontosAtivos,
    valorAdiantamento: func.valor_adiantamento,
    qtdVr, qtdVt, diariaVr, diariaVt, totalVr, totalVt, modalidade,
    descontoVrFaltas, descontoVtFaltas, totalDescontoBeneficios,
    regra,
    cargo: func.cargo, tipoContrato: func.tipo_contrato, ativo: func.ativo,
    totalCreditos, totalDebitos, valorLiquidoReceber
  };
};
