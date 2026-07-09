"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { registrarLogAuditoria } from '../../../actions';
import { salvarColaboradorAction, fecharFolhaLoteAction, reabrirFolhaAction } from '../actions/actions-folha';
import { enviarHoleriteAssinaturaAction, enviarHoleritesLoteAction, previaDocumentoAssinaturaAction } from '../actions/actions-assinatura';
import logoColorido from '../../../../app/imgs/logo.png';

// Utilitários
const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
const formatTimeStr = (totalMins: number) => `${Math.floor(totalMins / 60).toString().padStart(2, '0')}:${(totalMins % 60).toString().padStart(2, '0')}:00`;

// ============================================================================
// VALOR POR EXTENSO (pt-BR) — protege o valor numérico contra adulteração
// ============================================================================
const UNIDADES = ['', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE'];
const DEZ_A_DEZENOVE = ['DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
const DEZENAS = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
const CENTENAS = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];

const trioParaExtenso = (n: number): string => {
  if (n === 0) return '';
  if (n === 100) return 'CEM';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const d = Math.floor(resto / 10);
  const u = resto % 10;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto >= 10 && resto <= 19) {
    partes.push(DEZ_A_DEZENOVE[resto - 10]);
  } else {
    if (d > 0) partes.push(DEZENAS[d]);
    if (u > 0) partes.push(UNIDADES[u]);
  }
  return partes.join(' E ');
};

const numeroParaExtenso = (valor: number): string => {
  const negativo = valor < 0;
  const absoluto = Math.abs(valor || 0);
  let reais = Math.floor(absoluto);
  let centavos = Math.round((absoluto - reais) * 100);
  if (centavos === 100) { reais += 1; centavos = 0; }

  const milhoes = Math.floor(reais / 1_000_000);
  const milhares = Math.floor((reais % 1_000_000) / 1000);
  const resto = reais % 1000;

  const partes: string[] = [];
  if (milhoes > 0) partes.push(`${trioParaExtenso(milhoes)} ${milhoes === 1 ? 'MILHÃO' : 'MILHÕES'}`);
  if (milhares > 0) partes.push(milhares === 1 ? 'MIL' : `${trioParaExtenso(milhares)} MIL`);
  if (resto > 0) partes.push(trioParaExtenso(resto));

  let texto = partes.length > 0 ? partes.join(' E ') : 'ZERO';
  if (reais === 1) texto += ' REAL';
  else if (milhoes > 0 && reais % 1_000_000 === 0) texto += ' DE REAIS';
  else texto += ' REAIS';
  if (centavos > 0) texto += ` E ${trioParaExtenso(centavos)} ${centavos === 1 ? 'CENTAVO' : 'CENTAVOS'}`;
  return `${negativo ? 'MENOS ' : ''}${texto}`;
};

const formatarMesAnoBR = (mesAnoIso: string) => {
  if (!mesAnoIso) return '';
  const [ano, mes] = mesAnoIso.split('-');
  return `${mes}/${ano}`;
};

// A RenTech paga a competência no MÊS SEGUINTE. Esta função traduz a
// competência (mês trabalhado) para o mês em que o dinheiro efetivamente sai.
const competenciaParaPagamento = (mesAnoIso: string) => {
  if (!mesAnoIso) return '';
  const [ano, mes] = mesAnoIso.split('-').map(Number);
  const d = new Date(ano, mes, 1); // mes (0-based) + 1 = mês seguinte
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const calcularMesFim = (mesInicio: string, parcelas: number) => {
  if (!mesInicio || parcelas < 1) return mesInicio;
  const [ano, mes] = mesInicio.split('-').map(Number);
  const dataFim = new Date(ano, (mes - 1) + (parcelas - 1), 1);
  return `${dataFim.getFullYear()}-${String(dataFim.getMonth() + 1).padStart(2, '0')}`;
};

const getParcelaAtual = (mesInicio: string, mesRef: string) => {
  if (!mesInicio || !mesRef) return 1;
  const [anoI, mesI] = mesInicio.split('-').map(Number);
  const [anoR, mesR] = mesRef.split('-').map(Number);
  return (anoR - anoI) * 12 + (mesR - mesI) + 1;
};

const getDiaSemana = (dataIso: string) => {
  const partes = dataIso.split('-');
  return new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10)).getDay();
};

// Interfaces
interface RegraContrato {
  nome_regra: string;
  paga_salario_base: boolean;
  calcula_extras_padrao: boolean;
  percentual_extra_semana: number;
  percentual_extra_sabado: number;
  tipo_pagamento_fds: 'HORA_PERCENTUAL' | 'VALOR_DIARIA';
  percentual_extra_dom_fer: number;
  valor_diaria_fds: number;
  desconta_faltas: boolean;
  // Benefícios VR/VT por evento (regra 4)
  direito_vr: boolean;
  direito_vt: boolean;
  modalidade_beneficio: 'POR_DIA' | 'VALOR_FECHADO'; // vale para VR e VT juntos
  so_documental: boolean; // não gera cálculo/folha; só armazena e envia holerites da contabilidade
}

interface FuncionarioFin {
  nome_completo: string; cargo: string; tipo_contrato: string; ativo: boolean;
  recebe_transporte: boolean; valor_transporte: number;
  recebe_refeicao: boolean; valor_refeicao: number;
  salario_folha: number; salario_contrato: number;
  valor_diaria: number; valor_adiantamento: number;
  data_admissao: string | null; data_desligamento: string | null;
  data_nascimento: string | null; cpf: string | null; celular: string | null; email: string | null;
  banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null;
  pix_tipo: string | null; pix_chave: string | null;
  recebe_fechamento: boolean | null; recebe_holerite: boolean | null;
}

interface Desconto { id?: string; funcionario_nome?: string; descricao: string; tipo: 'FIXO' | 'PARCELADO'; parcelas: number; mes_inicio: string; mes_fim: string; valor_parcela: number; }
interface Bonus { id?: string; funcionario_nome?: string; descricao: string; recorrencia: 'MENSAL' | 'UNICO'; mes_referencia: string; valor: number; }

// Snapshot do holerite: espelha exatamente o que foi calculado
interface DadosHolerite {
  minutosExtras60: number; minutosExtras100: number; diasTrabalhadosFds: number;
  totalExtra60: number; totalExtra100: number; totalDiariasFdsFechada: number;
  diasFaltas: number; valorDescontoFaltas: number;
  salarioBaseExibido: number; complementoContratoExibido: number; avosSalario: number;
  bonusAtivos: Bonus[]; descontosAtivos: Desconto[];
  valorAdiantamento: number;
  qtdVr: number; qtdVt: number; diariaVr: number; diariaVt: number;
  totalVr: number; totalVt: number; modalidade: 'POR_DIA' | 'VALOR_FECHADO';
  descontoVrFaltas: number; descontoVtFaltas: number; totalDescontoBeneficios: number;
  regra: RegraContrato;
  cargo: string; tipoContrato: string; ativo: boolean;
  totalCreditos: number; totalDebitos: number; valorLiquidoReceber: number;
}

interface Fechamento {
  id: number;
  funcionario_nome: string;
  mes_referencia: string;
  dados: DadosHolerite;
  fechado_por: string | null;
  fechado_em: string;
}

interface ItemLote {
  func: FuncionarioFin;
  dados: DadosHolerite;
  fechamento: Fechamento | null;
  statusAssinatura: string | null; // null = nunca enviado; ENVIADO | VISUALIZADO | ASSINADO | REJEITADO
  soDocumental: boolean; // contrato que não gera cálculo (só recebe holerites da contabilidade)
}

const REGRA_PADRAO: RegraContrato = {
  nome_regra: 'PADRÃO',
  paga_salario_base: true, calcula_extras_padrao: true, percentual_extra_semana: 60,
  percentual_extra_sabado: 60, tipo_pagamento_fds: 'HORA_PERCENTUAL', percentual_extra_dom_fer: 100,
  valor_diaria_fds: 0, desconta_faltas: true,
  direito_vr: false, direito_vt: false, modalidade_beneficio: 'POR_DIA', so_documental: false
};

// ============================================================================
// APURAÇÃO DO PONTO (batidas + abonos) EM DOIS GRUPOS:
// Grupo 60%  → excedente de seg-sex + todas as horas de sábado
// Grupo 100% → todas as horas de domingo e feriado
// ============================================================================
const apurarPonto = (
  dias: Record<string, { trabalhados: number; abonados: number }>,
  feriados: string[],
  mesAno: string,
  dataAdmissao?: string | null,
  dataDesligamento?: string | null
) => {
  let mins60 = 0; let mins100 = 0; let diasFds = 0;
  // Eventos de benefício (regra 4): quantidade de VR e VT gerados no mês
  let qtdVr = 0; let qtdVt = 0;

  Object.entries(dias).forEach(([dataIso, v]) => {
    const diaSemana = getDiaSemana(dataIso);
    const isFeriado = feriados.includes(dataIso);

    if (isFeriado || diaSemana === 0) {
      // Dia não útil: abono não gera crédito; conta só o efetivamente trabalhado
      if (v.trabalhados > 0) {
        mins100 += v.trabalhados; diasFds++;
        // FDS/feriado: até 8h = 1 VT + 1 VR (almoço); mais de 8h = +1 VR (janta)
        qtdVt += 1;
        qtdVr += v.trabalhados > 480 ? 2 : 1;
      }
    } else if (diaSemana === 6) {
      if (v.trabalhados > 0) {
        mins60 += v.trabalhados; diasFds++;
        // Sábado segue a mesma regra de FDS
        qtdVt += 1;
        qtdVr += v.trabalhados > 480 ? 2 : 1;
      }
    } else {
      // Dia útil: abono soma à jornada antes de apurar o excedente
      const extraDia = (v.trabalhados + v.abonados) - 480;
      if (extraDia > 0) mins60 += extraDia;
      // Dia útil só gera VR (janta) quando o EXTRA registrado passa de 3h.
      // Dia útil normal não gera VR nem VT.
      if (extraDia > 180) qtdVr += 1;
    }
  });

  // ==========================================================================
  // FALTAS: dias úteis (seg-sex, não feriado) sem batida E sem abono.
  // Não conta: dias futuros; dias anteriores à admissão; dias após o
  // desligamento. Sem NENHUM registro no mês, não apura falta (ponto não
  // importado) — evita descontar o mês inteiro por engano.
  // ==========================================================================
  let faltas = 0;
  const temRegistroNoMes = Object.values(dias).some(v => v.trabalhados > 0 || v.abonados > 0);

  if (temRegistroNoMes) {
    const [ano, mes] = mesAno.split('-').map(Number);
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);

    for (let d = 1; d <= diasNoMes; d++) {
      const data = new Date(ano, mes - 1, d);
      if (data > hoje) break; // não conta dias que ainda não aconteceram
      const dataIso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      // Fora do vínculo empregatício: não é falta
      if (dataAdmissao && dataIso < dataAdmissao) continue;
      if (dataDesligamento && dataIso > dataDesligamento) continue;

      const diaSemana = data.getDay();
      if (diaSemana === 0 || diaSemana === 6 || feriados.includes(dataIso)) continue;

      const reg = dias[dataIso];
      const presente = reg && (reg.trabalhados > 0 || reg.abonados > 0);
      if (!presente) faltas++;
    }
  }

  return { mins60, mins100, diasFds, faltas, qtdVr, qtdVt };
};

// ============================================================================
// MOTOR DE CÁLCULO DO HOLERITE — função pura, usada tanto no individual
// quanto no lote, garantindo que os dois caminhos deem o mesmo resultado
// ============================================================================
const montarDadosHolerite = (
  func: FuncionarioFin,
  regras: Record<string, RegraContrato>,
  descontosFunc: Desconto[],
  bonusFunc: Bonus[],
  apuracao: { mins60: number; mins100: number; diasFds: number; faltas: number; qtdVr: number; qtdVt: number },
  mesRef: string
): DadosHolerite => {
  const regra = regras[func.tipo_contrato] || { ...REGRA_PADRAO, nome_regra: func.tipo_contrato || 'PADRÃO' };

  // Base de cálculo da hora: usa o Salário Folha; se for zero (comum em PJ,
  // onde só o Salário Contrato é preenchido), usa o Salário Contrato.
  const salarioBaseCalculo = func.salario_folha > 0 ? func.salario_folha : func.salario_contrato;
  const valorHoraBase = salarioBaseCalculo / 220;

  let totalExtra60 = 0;
  let totalExtra100 = 0;
  let totalDiariasFdsFechada = 0;

  // Contrato fechado (calcula_extras_padrao = false): nenhuma extra ou diária é paga
  if (regra.calcula_extras_padrao) {
    if (regra.tipo_pagamento_fds === 'HORA_PERCENTUAL') {
      totalExtra60 = (apuracao.mins60 / 60) * valorHoraBase * (1 + (regra.percentual_extra_semana / 100));
      totalExtra100 = (apuracao.mins100 / 60) * valorHoraBase * (1 + (regra.percentual_extra_dom_fer / 100));
    } else {
      // Modelo por diária: não paga hora extra de nenhum tipo
      totalDiariasFdsFechada = apuracao.diasFds * regra.valor_diaria_fds;
    }
  }

  // ── Proporcionalidade por admissão/desligamento no mês ──────────────────
  // Dias corridos trabalhados dentro do mês, limitado a 30 avos (padrão CLT).
  // Admitido 10/07 → dias 10 a 31 = 22 dias; salário = base ÷ 30 × 22.
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
  // Trabalhou o mês inteiro → 30 avos; parcial → dias corridos (teto 30)
  const trabalhouMesInteiro = primeiroDiaTrab === 1 && ultimoDiaTrab === ultimoDiaMes;
  const avosSalario = trabalhouMesInteiro ? 30 : Math.min(30, diasCorridosTrab);
  const fatorProporcional = avosSalario / 30;

  const salarioBaseExibido = regra.paga_salario_base ? func.salario_folha * fatorProporcional : 0;
  const complementoContratoExibido = regra.paga_salario_base ? Math.max(0, func.salario_contrato - func.salario_folha) * fatorProporcional : 0;

  const descontosAtivos = descontosFunc.filter(d => {
    if (mesRef < d.mes_inicio) return false;
    if (d.tipo === 'FIXO') return true;
    // Parcelado: vigente até o mês da última parcela (recalculado, não confia no mes_fim gravado)
    const fimReal = (d.mes_inicio && d.parcelas > 0) ? calcularMesFim(d.mes_inicio, d.parcelas) : d.mes_fim;
    return mesRef <= fimReal;
  });
  const bonusAtivos = bonusFunc.filter(b => b.recorrencia === 'MENSAL' || b.mes_referencia === mesRef);

  const totalBonusGrid = bonusAtivos.reduce((acc, curr) => acc + curr.valor, 0);
  const totalDescontosGrid = descontosAtivos.reduce((acc, curr) => acc + curr.valor_parcela, 0);

  // ==========================================================================
  // BENEFÍCIOS VR/VT POR EVENTO (regra 4):
  // - Direito e modalidade vêm da REGRA; os valores vêm da FICHA.
  // - Modalidade POR_DIA: valor lançado é a diária, usada direto por evento.
  // - Modalidade VALOR_FECHADO: valor lançado é o mês cheio; a diária
  //   equivalente é o valor ÷ 30 (dias corridos), usada por evento.
  // - qtdVr / qtdVt são os eventos contados no ponto (regra 4).
  // ==========================================================================
  const modalidade = regra.modalidade_beneficio;
  const diariaVr = modalidade === 'VALOR_FECHADO' ? (func.valor_refeicao / 30) : func.valor_refeicao;
  const diariaVt = modalidade === 'VALOR_FECHADO' ? (func.valor_transporte / 30) : func.valor_transporte;

  const qtdVr = regra.direito_vr ? apuracao.qtdVr : 0;
  const qtdVt = regra.direito_vt ? apuracao.qtdVt : 0;

  const totalVr = qtdVr * diariaVr;
  const totalVt = qtdVt * diariaVt;
  const totalAdicionais = totalVr + totalVt;

  // ==========================================================================
  // DESCONTO DE FALTAS: (valor do contrato ÷ 30) × dias de falta.
  // Usa o Salário Contrato; se zerado, cai para o Salário Folha.
  // Só se aplica quando a regra tem desconta_faltas habilitado.
  // ==========================================================================
  const baseFaltas = func.salario_contrato > 0 ? func.salario_contrato : func.salario_folha;
  const diasFaltas = regra.desconta_faltas ? apuracao.faltas : 0;
  const valorDescontoFaltas = diasFaltas > 0 ? (baseFaltas / 30) * diasFaltas : 0;

  // ==========================================================================
  // ACERTO DE VR/VT POR FALTA: o benefício base é pago por fora; aqui apenas
  // descontamos 1 diária de VR e/ou VT por dia de falta (conforme o direito do
  // contrato), já que naquele dia o funcionário recebeu por fora sem trabalhar.
  // ==========================================================================
  const descontoVrFaltas = (regra.direito_vr ? apuracao.faltas : 0) * diariaVr;
  const descontoVtFaltas = (regra.direito_vt ? apuracao.faltas : 0) * diariaVt;
  const totalDescontoBeneficios = descontoVrFaltas + descontoVtFaltas;

  const totalCreditos = salarioBaseExibido + complementoContratoExibido + totalBonusGrid + totalExtra60 + totalExtra100 + totalDiariasFdsFechada + totalAdicionais;
  const totalDebitos = func.valor_adiantamento + totalDescontosGrid + valorDescontoFaltas + totalDescontoBeneficios;
  const valorLiquidoReceber = totalCreditos - totalDebitos;

  return {
    minutosExtras60: apuracao.mins60, minutosExtras100: apuracao.mins100, diasTrabalhadosFds: apuracao.diasFds,
    totalExtra60, totalExtra100, totalDiariasFdsFechada,
    diasFaltas, valorDescontoFaltas,
    salarioBaseExibido, complementoContratoExibido, avosSalario,
    bonusAtivos, descontosAtivos,
    valorAdiantamento: func.valor_adiantamento,
    // Benefícios por evento (crédito) e acerto por falta (débito)
    qtdVr, qtdVt, diariaVr, diariaVt, totalVr, totalVt, modalidade,
    descontoVrFaltas, descontoVtFaltas, totalDescontoBeneficios,
    regra,
    cargo: func.cargo, tipoContrato: func.tipo_contrato, ativo: func.ativo,
    totalCreditos, totalDebitos, valorLiquidoReceber
  };
};

// ============================================================================
// DOCUMENTO DO HOLERITE — compacto para caber em UMA página impressa
// ============================================================================
const HoleriteDoc = ({ nome, dados, mesRef, fechamento }: {
  nome: string; dados: DadosHolerite; mesRef: string; fechamento: Fechamento | null;
}) => {
  const v = dados;
  return (
    <div className="holerite-doc w-full max-w-5xl bg-white p-2 md:p-8 border border-gray-200 shadow-lg print:border-none print:shadow-none print:p-0 print:max-w-none mb-8 print:mb-0">
      <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-3">
        <Image src={logoColorido} alt="Rentech Logo" width={140} height={44} />
        <div className="text-right">
          <h1 className="text-lg font-black uppercase text-[#0C1D4D] print:text-black">Demonstrativo de Pagamento</h1>
          <p className="text-sm font-bold text-gray-700">Competência: {formatarMesAnoBR(mesRef)}</p>
          <p className="text-sm font-black text-emerald-700 print:text-black">Pagamento: {competenciaParaPagamento(mesRef)}</p>
          {!fechamento && <p className="text-[10px] font-black text-amber-600 uppercase print:hidden">Prévia — folha em aberto</p>}
        </div>
      </div>

      <table className="w-full text-xs border-2 border-black mb-3 uppercase font-bold">
        <tbody>
          <tr className="border-b border-black">
            <td className="p-1.5 w-32 border-r border-black bg-gray-100">NOME:</td>
            <td className="p-1.5" colSpan={3}>{nome}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="p-1.5 w-32 border-r border-black bg-gray-100">REGRA CONTRATO:</td>
            <td className="p-1.5 border-r border-black">{v.tipoContrato}</td>
            <td className="p-1.5 w-28 border-r border-black bg-gray-100">SITUAÇÃO:</td>
            <td className="p-1.5">{v.ativo ? 'ATIVO' : 'INATIVO'}</td>
          </tr>
          <tr>
            <td className="p-1.5 w-32 border-r border-black bg-gray-100">FUNÇÃO:</td>
            <td className="p-1.5 border-r border-black">{v.cargo}</td>
            <td className="p-1.5 w-28 border-r border-black bg-gray-100">EMISSÃO:</td>
            <td className="p-1.5">{fechamento ? new Date(fechamento.fechado_em).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')}</td>
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-2 border-2 border-black border-b-0">
        <div className="text-center font-black uppercase py-0.5 border-r-2 border-black bg-gray-100 text-[#0C1D4D] print:text-black text-xs">CRÉDITOS</div>
        <div className="text-center font-black uppercase py-0.5 bg-gray-100 text-[#0C1D4D] print:text-black text-xs">DÉBITOS</div>
      </div>

      <div className="grid grid-cols-2 border-2 border-black">
        <div className="border-r-2 border-black flex flex-col">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-black bg-[#E2E8F0] text-[#0C1D4D] print:text-black">
                <th className="p-1 text-left w-1/2 uppercase tracking-wider">Descrição</th>
                <th className="p-1 text-center uppercase tracking-wider border-x border-black">Ref.</th>
                <th className="p-1 text-right uppercase tracking-wider">Valores</th>
              </tr>
            </thead>
            <tbody className="font-semibold text-gray-800">
              {v.salarioBaseExibido > 0 && <tr><td className="p-1">SALÁRIO BASE CONTRATUAL{v.avosSalario < 30 ? ' (PROPORCIONAL)' : ''}</td><td className="p-1 text-center border-x border-gray-300">{v.avosSalario}</td><td className="p-1 text-right">{formatCurrency(v.salarioBaseExibido)}</td></tr>}
              {v.complementoContratoExibido > 0 && <tr><td className="p-1">COMPLEMENTO DE ACORDO CLASSE</td><td className="p-1 text-center border-x border-gray-300">{v.avosSalario}</td><td className="p-1 text-right">{formatCurrency(v.complementoContratoExibido)}</td></tr>}

              {v.regra.tipo_pagamento_fds === 'HORA_PERCENTUAL' ? (
                <>
                  {v.totalExtra60 > 0 && (
                    <tr>
                      <td className="p-1">HORA EXTRA {v.regra.percentual_extra_semana}% (SEG A SÁB)</td>
                      <td className="p-1 border-x border-gray-300 text-center">{formatTimeStr(v.minutosExtras60)}</td>
                      <td className="p-1 text-right">{formatCurrency(v.totalExtra60)}</td>
                    </tr>
                  )}
                  {v.totalExtra100 > 0 && (
                    <tr>
                      <td className="p-1">HORA EXTRA {v.regra.percentual_extra_dom_fer}% (DOM/FERIADO)</td>
                      <td className="p-1 border-x border-gray-300 text-center">{formatTimeStr(v.minutosExtras100)}</td>
                      <td className="p-1 text-right">{formatCurrency(v.totalExtra100)}</td>
                    </tr>
                  )}
                </>
              ) : (
                v.totalDiariasFdsFechada > 0 && (
                  <tr>
                    <td className="p-1">DIÁRIAS DE FIM DE SEMANA / APOIO</td>
                    <td className="p-1 border-x border-gray-300 text-center">{v.diasTrabalhadosFds}D</td>
                    <td className="p-1 text-right">{formatCurrency(v.totalDiariasFdsFechada)}</td>
                  </tr>
                )
              )}

              {v.bonusAtivos.map((b, i) => (
                <tr key={`bonus-${i}`}>
                  <td className="p-1 truncate uppercase">{b.descricao}</td>
                  <td className="p-1 text-center border-x border-gray-300 text-[10px] font-black">{b.recorrencia === 'MENSAL' ? 'FIXO' : 'PRÊMIO'}</td>
                  <td className="p-1 text-right">{formatCurrency(b.valor)}</td>
                </tr>
              ))}

              {v.totalVr > 0 && <tr><td className="p-1">VALE REFEIÇÃO (VR)</td><td className="p-1 border-x border-gray-300 text-center text-[10px] font-black">{v.qtdVr} {v.qtdVr === 1 ? 'DIA' : 'DIAS'}</td><td className="p-1 text-right">{formatCurrency(v.totalVr)}</td></tr>}
              {v.totalVt > 0 && <tr><td className="p-1">VALE TRANSPORTE (VT)</td><td className="p-1 border-x border-gray-300 text-center text-[10px] font-black">{v.qtdVt} {v.qtdVt === 1 ? 'DIA' : 'DIAS'}</td><td className="p-1 text-right">{formatCurrency(v.totalVt)}</td></tr>}

              {Array.from({ length: Math.max(0, 3 - v.bonusAtivos.length) }).map((_, i) => <tr key={`esp-cred-${i}`}><td className="p-1 text-transparent">_</td><td className="border-x border-gray-300"></td><td></td></tr>)}
            </tbody>
          </table>
          <div className="mt-auto border-t-2 border-black bg-gray-100 flex justify-between p-1.5 font-black text-xs"><span>TOTAL CRÉDITO</span><span>{formatCurrency(v.totalCreditos)}</span></div>
        </div>

        <div className="flex flex-col">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-black bg-[#E2E8F0] text-[#0C1D4D] print:text-black">
                <th className="p-1 text-left w-1/2 uppercase tracking-wider">Descrição</th>
                <th className="p-1 text-center uppercase tracking-wider border-x border-black">Ref.</th>
                <th className="p-1 text-right uppercase tracking-wider">Valores</th>
              </tr>
            </thead>
            <tbody className="font-semibold text-gray-800">
              {v.valorAdiantamento > 0 && <tr><td className="p-1">ADIANTAMENTO QUINZENAL</td><td className="p-1 text-center border-x border-gray-300 text-[10px] font-black">DIA 20</td><td className="p-1 text-right">{formatCurrency(v.valorAdiantamento)}</td></tr>}

              {v.descontosAtivos.map((d, i) => {
                const parcelaAtual = getParcelaAtual(d.mes_inicio, mesRef);
                const refText = d.tipo === 'FIXO' ? 'FIXO' : `${parcelaAtual}/${d.parcelas}`;
                return (
                  <tr key={`desc-${i}`}>
                    <td className="p-1 truncate uppercase">{d.descricao}</td>
                    <td className="p-1 text-center border-x border-gray-300 text-[10px] font-black">{refText}</td>
                    <td className="p-1 text-right">{formatCurrency(d.valor_parcela)}</td>
                  </tr>
                )
              })}

              {v.regra.desconta_faltas && (
                v.valorDescontoFaltas > 0 ? (
                  <tr>
                    <td className="p-1">FALTAS (CONTRATO ÷ 30 POR DIA)</td>
                    <td className="p-1 border-x border-gray-300 text-center text-[10px] font-black">{v.diasFaltas}D</td>
                    <td className="p-1 text-right">{formatCurrency(v.valorDescontoFaltas)}</td>
                  </tr>
                ) : (
                  <tr><td className="p-1 text-gray-400">FALTAS</td><td className="p-1 border-x border-gray-300 text-center">-</td><td className="p-1 text-right text-gray-400">-</td></tr>
                )
              )}

              {v.descontoVrFaltas > 0 && <tr><td className="p-1">DESC. VR POR FALTA</td><td className="p-1 border-x border-gray-300 text-center text-[10px] font-black">{v.diasFaltas} {v.diasFaltas === 1 ? 'DIA' : 'DIAS'}</td><td className="p-1 text-right">{formatCurrency(v.descontoVrFaltas)}</td></tr>}
              {v.descontoVtFaltas > 0 && <tr><td className="p-1">DESC. VT POR FALTA</td><td className="p-1 border-x border-gray-300 text-center text-[10px] font-black">{v.diasFaltas} {v.diasFaltas === 1 ? 'DIA' : 'DIAS'}</td><td className="p-1 text-right">{formatCurrency(v.descontoVtFaltas)}</td></tr>}

              {Array.from({ length: Math.max(0, 4 - v.descontosAtivos.length) }).map((_, i) => <tr key={`esp-deb-${i}`}><td className="p-1 text-transparent">_</td><td className="border-x border-gray-300"></td><td></td></tr>)}
            </tbody>
          </table>
          <div className="mt-auto border-t-2 border-black bg-gray-100 flex justify-between p-1.5 font-black text-xs"><span>TOTAL DÉBITO</span><span>{formatCurrency(v.totalDebitos)}</span></div>
        </div>
      </div>

      <table className="w-full border-x-2 border-b-2 border-black text-xs">
        <tbody>
          <tr className="border-b border-gray-300"><td className="p-1.5 font-bold bg-gray-100 w-2/3">Valor Líquido a Receber</td><td className="p-1.5 font-black text-right text-base text-emerald-700 print:text-black">{formatCurrency(v.valorLiquidoReceber)}</td></tr>
          <tr><td className="p-1.5 font-bold bg-gray-100">Valor por Extenso</td><td className="p-1.5 font-bold text-[10px] uppercase">{numeroParaExtenso(v.valorLiquidoReceber)}</td></tr>
        </tbody>
      </table>

      <div className="mt-10 print:mt-8 flex-col items-center justify-center w-2/3 mx-auto hidden print:flex">
        <div className="border-t-2 border-black w-full mb-1"></div>
        <strong className="text-sm uppercase tracking-wider">{nome}</strong>
        <p className="text-[10px] mt-0.5 text-gray-600">Assinatura de Quitação de Contrato</p>
        <div className="mt-3 text-[10px] text-gray-500">São Paulo, ____ de ____________________ de 20____.</div>
      </div>
    </div>
  );
};

export default function HoleritePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [loadingLote, setLoadingLote] = useState(false);
  const [usuarioAtual, setUsuarioAtual] = useState('');
  
  const [listaFuncionarios, setListaFuncionarios] = useState<FuncionarioFin[]>([]);
  const [regrasContrato, setRegrasContrato] = useState<Record<string, RegraContrato>>({});
  const [cargosCatalogo, setCargosCatalogo] = useState<string[]>([]);
  
  const [buscaGrid, setBuscaGrid] = useState('');
  const [filtroContrato, setFiltroContrato] = useState('TODOS');
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'impressao'>('config');

  // Lote: holerites de TODOS os funcionários ativos do mês (aba Espelho)
  const [lote, setLote] = useState<ItemLote[]>([]);
  const [enviandoAssinatura, setEnviandoAssinatura] = useState<string | null>(null); // nome em envio, ou 'LOTE'
  const [gerandoPrevia, setGerandoPrevia] = useState<string | null>(null);

  // Prévia do PDF exatamente como seria enviado (mesmo código do servidor,
  // incluindo merge com anexos da contabilidade). Não cria nada na Autentique.
  const previaPdf = async (item: ItemLote) => {
    setGerandoPrevia(item.func.nome_completo);
    try {
      const res = await previaDocumentoAssinaturaAction({
        funcionarioNome: item.func.nome_completo,
        mesReferencia,
        soDocumental: item.soDocumental,
        // Folha aberta: manda o cálculo ao vivo para a prévia
        dadosAoVivo: item.fechamento ? undefined : item.dados
      });
      if (!res.ok) throw new Error(res.erro);
      // base64 → blob → nova aba
      const bin = atob(res.info.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      alert('Erro ao gerar a prévia: ' + e.message);
    } finally {
      setGerandoPrevia(null);
    }
  };
  const [sandboxAssinatura, setSandboxAssinatura] = useState(true); // começa em teste por segurança

  // Fechamento do funcionário selecionado (aviso na aba de parâmetros)
  const [fechamentoSelecionado, setFechamentoSelecionado] = useState<Fechamento | null>(null);

  const [mesReferencia, setMesReferencia] = useState(() => {
    // Competência = mês anterior ao corrente (o mês corrente é o de pagamento)
    const hoje = new Date();
    const comp = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    return `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
  });

  const defaultForm: FuncionarioFin = {
    nome_completo: '', cargo: '', tipo_contrato: 'CLT + Contrato', ativo: true,
    recebe_transporte: false, valor_transporte: 0, recebe_refeicao: false, valor_refeicao: 0,
    salario_folha: 0, salario_contrato: 0, valor_diaria: 0, valor_adiantamento: 0,
    data_admissao: null, data_desligamento: null,
    data_nascimento: null, cpf: null, celular: null, email: null,
    banco_codigo: null, banco_agencia: null, banco_conta: null, banco_tipo: null,
    pix_tipo: null, pix_chave: null,
    recebe_fechamento: null, recebe_holerite: null
  };
  
  const [form, setForm] = useState<FuncionarioFin>(defaultForm);
  const [descontos, setDescontos] = useState<Desconto[]>([]);
  const [bonus, setBonus] = useState<Bonus[]>([]);
  const [apuracaoSelecionado, setApuracaoSelecionado] = useState({ mins60: 0, mins100: 0, diasFds: 0, faltas: 0, qtdVr: 0, qtdVt: 0 });

  // Snapshot dos dados carregados, para detectar alterações não salvas na ficha
  const [snapshotFicha, setSnapshotFicha] = useState('');
  const [mostrarQuitados, setMostrarQuitados] = useState(false);
  const [mostrarBonusEncerrados, setMostrarBonusEncerrados] = useState(false);
  const [fichaExpandida, setFichaExpandida] = useState(false);

  const fichaAtualSerializada = useMemo(
    () => JSON.stringify({ form, descontos, bonus }),
    [form, descontos, bonus]
  );
  const temAlteracoesNaoSalvas = snapshotFicha !== '' && fichaAtualSerializada !== snapshotFicha;

  useEffect(() => { inicializarDados(); }, []);

  useEffect(() => {
    if (funcionarioSelecionado && funcionarioSelecionado !== 'NOVO') {
      carregarDetalhes(funcionarioSelecionado, mesReferencia);
    }
  }, [funcionarioSelecionado, mesReferencia]);

  useEffect(() => {
    if (activeTab === 'impressao') {
      carregarLote(mesReferencia);
    }
  }, [activeTab, mesReferencia]);

  const inicializarDados = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data: perfil } = await supabase.from('perfis_usuarios').select('nome').eq('id', session.user.id).single();
      if (perfil) setUsuarioAtual(perfil.nome);
    }

    // Carrega Motor de Regras
    const { data: regrasData } = await supabase.from('folha_parametros').select('*');
    if (regrasData) {
      const mapaRegras: Record<string, RegraContrato> = {};
      regrasData.forEach((r) => {
        mapaRegras[r.nome_regra] = {
          nome_regra: r.nome_regra, paga_salario_base: r.paga_salario_base,
          calcula_extras_padrao: r.calcula_extras_padrao,
          percentual_extra_semana: r.percentual_extra_semana ?? 60,
          percentual_extra_sabado: r.percentual_extra_sabado ?? 60,
          tipo_pagamento_fds: r.tipo_pagamento_fds === 'HORA_100' ? 'HORA_PERCENTUAL' : (r.tipo_pagamento_fds || 'HORA_PERCENTUAL'),
          percentual_extra_dom_fer: r.percentual_extra_dom_fer ?? 100,
          valor_diaria_fds: r.valor_diaria_fds ?? 0, desconta_faltas: r.desconta_faltas,
          direito_vr: r.direito_vr ?? false, direito_vt: r.direito_vt ?? false,
          modalidade_beneficio: r.modalidade_beneficio || 'POR_DIA',
          so_documental: r.so_documental ?? false
        };
      });
      setRegrasContrato(mapaRegras);
    }

    // Catálogo padronizado de cargos (gerenciado na tela de Parâmetros)
    const { data: cargosData } = await supabase.from('folha_cargo').select('nome').order('nome');
    if (cargosData) setCargosCatalogo(cargosData.map(c => c.nome));

    carregarListaFuncionarios();
  };

  const carregarListaFuncionarios = async () => {
    const { data } = await supabase.from('folha_funcionarios').select('*').order('nome_completo');
    if (data) setListaFuncionarios(data);
    setLoading(false);
  };

  const buscarPontoDoMes = async (mesAno: string, nome?: string) => {
    const [ano, mes] = mesAno.split('-');
    const dataInicio = `${ano}-${mes}-01`;
    const dataFim = `${ano}-${mes}-${new Date(Number(ano), Number(mes), 0).getDate()}`;

    let queryPonto = supabase.from('folha_ponto_diaria')
      .select('funcionario_nome, data_registro, minutos_trabalhados')
      .gte('data_registro', dataInicio).lte('data_registro', dataFim);
    let queryAbono = supabase.from('folha_ponto_abono')
      .select('funcionario_nome, data_abono, minutos_abonados')
      .gte('data_abono', dataInicio).lte('data_abono', dataFim);
    if (nome) {
      queryPonto = queryPonto.eq('funcionario_nome', nome);
      queryAbono = queryAbono.eq('funcionario_nome', nome);
    }

    const [{ data: pontoData }, { data: abonoData }, { data: fData }] = await Promise.all([
      queryPonto, queryAbono, supabase.from('folha_feriados').select('data_feriado')
    ]);

    const feriados = fData ? fData.map(f => f.data_feriado) : [];

    // Agrupa por funcionário e por dia
    const porFuncionario: Record<string, Record<string, { trabalhados: number; abonados: number }>> = {};
    (pontoData || []).forEach(p => {
      if (!porFuncionario[p.funcionario_nome]) porFuncionario[p.funcionario_nome] = {};
      if (!porFuncionario[p.funcionario_nome][p.data_registro]) porFuncionario[p.funcionario_nome][p.data_registro] = { trabalhados: 0, abonados: 0 };
      porFuncionario[p.funcionario_nome][p.data_registro].trabalhados = p.minutos_trabalhados;
    });
    (abonoData || []).forEach(a => {
      if (!porFuncionario[a.funcionario_nome]) porFuncionario[a.funcionario_nome] = {};
      if (!porFuncionario[a.funcionario_nome][a.data_abono]) porFuncionario[a.funcionario_nome][a.data_abono] = { trabalhados: 0, abonados: 0 };
      porFuncionario[a.funcionario_nome][a.data_abono].abonados = a.minutos_abonados;
    });

    return { porFuncionario, feriados };
  };

  // ============================================================================
  // DETALHES DO FUNCIONÁRIO SELECIONADO (aba Parâmetros)
  // ============================================================================
  const carregarDetalhes = async (nome: string, mesAno: string) => {
    setLoading(true);

    const { data: funcData, error: funcError } = await supabase
      .from('folha_funcionarios').select('*').eq('nome_completo', nome).single();
    if (funcError || !funcData) {
      alert(`Não foi possível carregar a ficha de ${nome}: ${funcError?.message || 'registro não encontrado'}`);
      setLoading(false);
      return;
    }
    setForm(funcData);

    const { data: descData } = await supabase.from('folha_descontos').select('*').eq('funcionario_nome', nome);
    setDescontos(descData ? descData.map(d => ({ ...d, tipo: d.tipo || 'PARCELADO' })) : []);

    const { data: bonusData } = await supabase.from('folha_bonus').select('*').eq('funcionario_nome', nome);
    setBonus(bonusData || []);

    const { data: fechData } = await supabase
      .from('folha_holerites')
      .select('*')
      .eq('funcionario_nome', nome)
      .eq('mes_referencia', mesAno)
      .maybeSingle();
    setFechamentoSelecionado(fechData || null);

    const { porFuncionario, feriados } = await buscarPontoDoMes(mesAno, nome);
    setApuracaoSelecionado(apurarPonto(porFuncionario[nome] || {}, feriados, mesAno, funcData.data_admissao, funcData.data_desligamento));

    // Snapshot dos dados recém-carregados (baseline para detectar edições)
    setSnapshotFicha(JSON.stringify({
      form: funcData,
      descontos: descData ? descData.map(d => ({ ...d, tipo: d.tipo || 'PARCELADO' })) : [],
      bonus: bonusData || []
    }));

    setLoading(false);
  };

  // ============================================================================
  // LOTE: monta o holerite de TODOS os funcionários ativos do mês
  // ============================================================================
  const carregarLote = async (mesAno: string) => {
    setLoadingLote(true);
    try {
      const [{ data: funcs }, { data: descs }, { data: bons }, { data: fechs }, { data: assins }, ponto] = await Promise.all([
        supabase.from('folha_funcionarios').select('*').eq('ativo', true).order('nome_completo'),
        supabase.from('folha_descontos').select('*'),
        supabase.from('folha_bonus').select('*'),
        supabase.from('folha_holerites').select('*').eq('mes_referencia', mesAno),
        supabase.from('folha_holerite_assinaturas').select('funcionario_nome, status').eq('mes_referencia', mesAno),
        buscarPontoDoMes(mesAno)
      ]);

      const assinPorFunc: Record<string, string> = {};
      (assins || []).forEach(a => { assinPorFunc[a.funcionario_nome] = a.status; });

      const descPorFunc: Record<string, Desconto[]> = {};
      (descs || []).forEach(d => {
        const key = d.funcionario_nome;
        if (!descPorFunc[key]) descPorFunc[key] = [];
        descPorFunc[key].push({ ...d, tipo: d.tipo || 'PARCELADO' });
      });

      const bonusPorFunc: Record<string, Bonus[]> = {};
      (bons || []).forEach(b => {
        const key = b.funcionario_nome;
        if (!bonusPorFunc[key]) bonusPorFunc[key] = [];
        bonusPorFunc[key].push(b);
      });

      const fechPorFunc: Record<string, Fechamento> = {};
      (fechs || []).forEach(f => { fechPorFunc[f.funcionario_nome] = f; });

      // Item 1: funcionário admitido DEPOIS do mês de referência não entra na
      // folha daquele mês. Compara o mês de admissão com o mês selecionado.
      const admitidoAteOMes = (dataAdmissao: string | null) => {
        if (!dataAdmissao) return true; // sem data = assume que já estava
        return dataAdmissao.slice(0, 7) <= mesAno; // 'AAAA-MM' <= 'AAAA-MM'
      };

      const lista: ItemLote[] = (funcs || [])
        .filter(f => admitidoAteOMes(f.data_admissao))
        .map(f => {
          const regra = regrasContrato[f.tipo_contrato];
          const soDocumental = regra?.so_documental === true;
          const apuracao = apurarPonto(ponto.porFuncionario[f.nome_completo] || {}, ponto.feriados, mesAno, f.data_admissao, f.data_desligamento);
          const dados = montarDadosHolerite(
            f, regrasContrato,
            descPorFunc[f.nome_completo] || [],
            bonusPorFunc[f.nome_completo] || [],
            apuracao, mesAno
          );
          return { func: f, dados, fechamento: fechPorFunc[f.nome_completo] || null, statusAssinatura: assinPorFunc[f.nome_completo] || null, soDocumental };
        });

      setLote(lista);
    } catch (e: any) {
      alert('Erro ao montar os holerites do mês: ' + e.message);
    } finally {
      setLoadingLote(false);
    }
  };

  // ============================================================================
  // FECHAMENTO EM LOTE: congela a folha do mês de TODOS os funcionários abertos
  // ============================================================================
  const fecharFolhaTodos = async () => {
    const abertos = lote.filter(l => !l.fechamento && !l.soDocumental);
    const jaFechados = lote.length - abertos.length;

    if (abertos.length === 0) {
      alert('Todos os funcionários deste mês já estão com a folha fechada.');
      return;
    }

    const totalLiquido = abertos.reduce((acc, l) => acc + l.dados.valorLiquidoReceber, 0);
    if (!confirm(
      `Fechar a folha de ${formatarMesAnoBR(mesReferencia)} para ${abertos.length} funcionário(s)?` +
      (jaFechados > 0 ? `\n(${jaFechados} já estava(m) fechado(s) e não será(ão) alterado(s).)` : '') +
      `\n\nTotal líquido a fechar: ${formatCurrency(totalLiquido)}\n\n` +
      `Após o fechamento, os holerites ficam congelados e não mudam mesmo que o ponto, os feriados ou as regras sejam alterados.`
    )) return;

    setLoadingLote(true);
    try {
      const linhas = abertos.map(l => ({ funcionario_nome: l.func.nome_completo, dados: l.dados }));
      const res = await fecharFolhaLoteAction({ mesReferencia, linhas, usuarioNome: usuarioAtual });
      if (!res.ok) throw new Error(res.erro);

      alert(`Folha de ${formatarMesAnoBR(mesReferencia)} fechada para ${abertos.length} funcionário(s)!`);
      carregarLote(mesReferencia);
    } catch (e: any) {
      alert('Erro ao fechar a folha: ' + e.message);
    } finally {
      setLoadingLote(false);
    }
  };

  const reabrirFolhaDe = async (fech: Fechamento) => {
    if (!confirm(
      `Reabrir a folha de ${fech.funcionario_nome} (${formatarMesAnoBR(fech.mes_referencia)})?\n\n` +
      `O holerite voltará a ser calculado ao vivo e poderá mudar.`
    )) return;

    setLoadingLote(true);
    try {
      const res = await reabrirFolhaAction({
        ids: [fech.id], mesReferencia: fech.mes_referencia, usuarioNome: usuarioAtual,
        descricao: fech.funcionario_nome
      });
      if (!res.ok) throw new Error(res.erro);

      carregarLote(mesReferencia);
    } catch (e: any) {
      alert('Erro ao reabrir a folha: ' + e.message);
      setLoadingLote(false);
    }
  };

  // ============================================================================
  // REABERTURA EM LOTE: reabre a folha de TODOS os funcionários fechados do mês
  // ============================================================================
  const reabrirFolhaTodos = async () => {
    const fechados = lote.filter(l => l.fechamento);
    if (fechados.length === 0) {
      alert('Nenhuma folha fechada neste mês para reabrir.');
      return;
    }

    if (!confirm(
      `Reabrir a folha de ${formatarMesAnoBR(mesReferencia)} para TODOS os ${fechados.length} funcionário(s) fechado(s)?\n\n` +
      `Os holerites voltarão a ser calculados ao vivo e poderão mudar conforme o ponto, os feriados e as regras.\n\n` +
      `Use apenas para corrigir um fechamento feito com dados errados.`
    )) return;

    setLoadingLote(true);
    try {
      const ids = fechados.map(l => l.fechamento!.id);
      const res = await reabrirFolhaAction({
        ids, mesReferencia, usuarioNome: usuarioAtual,
        descricao: `${fechados.length} funcionário(s) em lote`
      });
      if (!res.ok) throw new Error(res.erro);

      alert(`${fechados.length} folha(s) de ${formatarMesAnoBR(mesReferencia)} reaberta(s).`);
      carregarLote(mesReferencia);
    } catch (e: any) {
      alert('Erro ao reabrir as folhas: ' + e.message);
      setLoadingLote(false);
    }
  };

  // ============================================================================
  // ENVIO PARA ASSINATURA (Autentique) — somente holerite de folha FECHADA
  // ============================================================================
  const enviarAssinatura = async (item: ItemLote) => {
    // Documental não tem folha fechada — envia só os anexos da contabilidade.
    // Os demais exigem folha fechada.
    if (!item.soDocumental && !item.fechamento) {
      alert('Só é possível enviar para assinatura holerites com a folha FECHADA.');
      return;
    }
    if (item.statusAssinatura === 'ASSINADO') {
      alert('Este holerite já foi assinado.');
      return;
    }
    const jaEnviado = item.statusAssinatura === 'ENVIADO' || item.statusAssinatura === 'VISUALIZADO';
    if (!confirm(
      `${jaEnviado ? 'REENVIAR' : 'Enviar'} ${item.soDocumental ? 'os holerites da contabilidade' : 'o holerite'} de ${item.func.nome_completo} (${formatarMesAnoBR(mesReferencia)}) para assinatura?\n\n` +
      `Destino: ${item.func.celular ? 'WhatsApp ' + item.func.celular : item.func.email || 'sem contato'}\n` +
      `CPF exigido na assinatura: ${item.func.cpf || 'NÃO PREENCHIDO ⚠'}\n` +
      (item.soDocumental ? '\n📄 Contrato documental: envia apenas os documentos da contabilidade (sem resumo calculado).' : '') +
      (sandboxAssinatura ? '\n🧪 MODO TESTE (sandbox): não gasta créditos e o documento é temporário.' : '\n⚠ MODO REAL: consome um documento do seu plano Autentique.')
    )) return;

    setEnviandoAssinatura(item.func.nome_completo);
    try {
      const res = await enviarHoleriteAssinaturaAction({
        funcionarioNome: item.func.nome_completo,
        mesReferencia,
        enviadoPor: usuarioAtual,
        sandbox: sandboxAssinatura,
        soDocumental: item.soDocumental
      });
      if (!res.ok) throw new Error(res.erro);
      const anexosMsg = res.info?.anexados?.length ? `\n\nAnexado: ${item.soDocumental ? '' : 'resumo + '}${res.info.anexados.join(' + ')}` : (item.soDocumental ? '\n\n⚠ Nenhum documento da contabilidade encontrado para este funcionário.' : '\n\n(só o resumo — sem documentos da contabilidade neste mês)');
      alert(`Enviado para assinatura!${anexosMsg}${res.info?.link ? `\n\nLink: ${res.info.link}` : ''}`);
      carregarLote(mesReferencia);
    } catch (e: any) {
      alert('Erro ao enviar para assinatura: ' + e.message);
    } finally {
      setEnviandoAssinatura(null);
    }
  };

  const enviarAssinaturaTodos = async () => {
    const fechadosNaoAssinados = lote.filter(l => l.fechamento && l.statusAssinatura !== 'ASSINADO' && l.statusAssinatura !== 'ENVIADO' && l.statusAssinatura !== 'VISUALIZADO');
    if (fechadosNaoAssinados.length === 0) {
      alert('Não há holerites fechados pendentes de envio neste mês.');
      return;
    }
    if (!confirm(
      `Enviar ${fechadosNaoAssinados.length} holerite(s) fechado(s) para assinatura?\n\n` +
      (sandboxAssinatura ? '🧪 MODO TESTE (sandbox): não gasta créditos.' : `⚠ MODO REAL: consome ${fechadosNaoAssinados.length} documento(s) do seu plano Autentique.`)
    )) return;

    setEnviandoAssinatura('LOTE');
    try {
      const res = await enviarHoleritesLoteAction({ mesReferencia, enviadoPor: usuarioAtual, sandbox: sandboxAssinatura });
      const falhasMsg = res.info?.falhas?.length ? `\n\nFalhas:\n${res.info.falhas.join('\n')}` : '';
      const docMsg = res.info?.documentais ? `\n(inclui ${res.info.documentais} ficha(s) documental(is))` : '';
      alert(`${res.info?.enviados || 0} de ${res.info?.total || 0} documento(s) enviado(s).${docMsg}${falhasMsg}`);
      carregarLote(mesReferencia);
    } catch (e: any) {
      alert('Erro no envio em lote: ' + e.message);
    } finally {
      setEnviandoAssinatura(null);
    }
  };

  const prepararNovo = () => {
    setFuncionarioSelecionado('NOVO'); setForm(defaultForm);
    setDescontos([]); setBonus([]);
    setApuracaoSelecionado({ mins60: 0, mins100: 0, diasFds: 0, faltas: 0, qtdVr: 0, qtdVt: 0 });
    setFechamentoSelecionado(null);
    setActiveTab('config');
  };

  // ============================================================================
  // GRAVAÇÃO COM TRATAMENTO DE ERRO EM CADA ETAPA
  // ============================================================================
  const salvarColaborador = async (): Promise<boolean> => {
    if (!form.nome_completo) { alert("O Nome Completo é obrigatório."); return false; }
    setLoading(true);

    try {
      const res = await salvarColaboradorAction({ form, descontos, bonus, usuarioNome: usuarioAtual });
      if (!res.ok) throw new Error(res.erro);

      alert("Ficha guardada com sucesso!");
      // Atualiza o baseline: dados salvos passam a ser o novo "sem alterações"
      setSnapshotFicha(JSON.stringify({ form, descontos, bonus }));
      carregarListaFuncionarios();
      if (funcionarioSelecionado === 'NOVO') setFuncionarioSelecionado(form.nome_completo);
      return true;
    } catch (e: any) { alert("Erro ao salvar: " + e.message); return false; } 
    finally { setLoading(false); }
  };

  // ============================================================================
  // TROCA DE FUNCIONÁRIO COM PROTEÇÃO CONTRA PERDA DE ALTERAÇÕES
  // ============================================================================
  const trocarFuncionario = async (nome: string) => {
    if (nome === funcionarioSelecionado) return;

    if (temAlteracoesNaoSalvas) {
      const salvar = confirm(
        `A ficha de ${form.nome_completo || 'este colaborador'} tem alterações não salvas.\n\n` +
        `OK = Salvar antes de trocar\nCancelar = Descartar as alterações`
      );
      if (salvar) {
        const ok = await salvarColaborador();
        if (!ok) return; // falhou ao salvar: permanece na ficha atual
      }
      // Se descartou, apenas segue: o snapshot é redefinido no carregarDetalhes
    }

    setFuncionarioSelecionado(nome);
    setActiveTab('config');
  };

  const alternarStatusAtivo = async () => setForm({ ...form, ativo: !form.ativo });

  const addDesconto = () => setDescontos([...descontos, { descricao: '', tipo: 'PARCELADO', parcelas: 1, mes_inicio: mesReferencia, mes_fim: mesReferencia, valor_parcela: 0 }]);
  const addBonus = () => setBonus([...bonus, { descricao: '', recorrencia: 'UNICO', mes_referencia: mesReferencia, valor: 0 }]);
  const removeDesconto = (idx: number) => setDescontos(descontos.filter((_, i) => i !== idx));
  const removeBonus = (idx: number) => setBonus(bonus.filter((_, i) => i !== idx));

  const handleDescontoChange = <K extends keyof Desconto>(idx: number, campo: K, valor: Desconto[K]) => {
    const novosDescontos = [...descontos];
    novosDescontos[idx] = { ...novosDescontos[idx], [campo]: valor };
    if (campo === 'tipo') {
      novosDescontos[idx].mes_fim = valor === 'FIXO' ? '2099-12' : calcularMesFim(novosDescontos[idx].mes_inicio, novosDescontos[idx].parcelas);
    } else if (campo === 'mes_inicio' || campo === 'parcelas') {
      if (novosDescontos[idx].tipo === 'PARCELADO') {
        novosDescontos[idx].mes_fim = calcularMesFim(novosDescontos[idx].mes_inicio, novosDescontos[idx].parcelas || 1);
      }
    }
    setDescontos(novosDescontos);
  };

  // Cálculo ao vivo do funcionário selecionado (painel de diagnóstico)
  const dadosSelecionado = montarDadosHolerite(form, regrasContrato, descontos, bonus, apuracaoSelecionado, mesReferencia);
  const regraAtiva = dadosSelecionado.regra;
  const salarioBaseCalculo = form.salario_folha > 0 ? form.salario_folha : form.salario_contrato;
  const valorHoraBase = salarioBaseCalculo / 220;

  // Tipos de contrato presentes na equipe (para o filtro), em ordem alfabética
  const contratosDisponiveis = useMemo(() => {
    const set = new Set<string>();
    listaFuncionarios.forEach(f => { if (f.tipo_contrato) set.add(f.tipo_contrato); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [listaFuncionarios]);

  const funcFiltrados = useMemo(() =>
    listaFuncionarios
      .filter(f => f.nome_completo.toLowerCase().includes(buscaGrid.toLowerCase()))
      .filter(f => filtroContrato === 'TODOS' || f.tipo_contrato === filtroContrato)
      .sort((a, b) => {
        // Inativos vão para o fim; dentro de cada grupo, ordem alfabética
        if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
        return a.nome_completo.localeCompare(b.nome_completo);
      }),
    [listaFuncionarios, buscaGrid, filtroContrato]);

  // Separa descontos vigentes dos já quitados. O fim é RECALCULADO a partir de
  // mes_inicio + parcelas (não confia no mes_fim gravado, que pode estar defasado
  // em registros antigos). Quitado = mês atual passou do mês da última parcela.
  const descontosComIndice = useMemo(() => descontos.map((d, idx) => {
    let quitado = false;
    if (d.tipo === 'PARCELADO' && d.mes_inicio && d.parcelas > 0) {
      const fimReal = calcularMesFim(d.mes_inicio, d.parcelas);
      quitado = mesReferencia > fimReal;
    }
    return { d, idx, quitado };
  }), [descontos, mesReferencia]);
  const qtdQuitados = useMemo(() => descontosComIndice.filter(x => x.quitado).length, [descontosComIndice]);

  // Bônus de única vez cuja competência já passou (não incide mais neste mês)
  const bonusComIndice = useMemo(() => bonus.map((b, idx) => ({
    b, idx,
    encerrado: b.recorrencia === 'UNICO' && !!b.mes_referencia && mesReferencia > b.mes_referencia
  })), [bonus, mesReferencia]);
  const qtdBonusEncerrados = useMemo(() => bonusComIndice.filter(x => x.encerrado).length, [bonusComIndice]);

  const totalFechados = lote.filter(l => l.fechamento).length;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      {/* Impressão: A4, uma página por holerite */}
      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          .holerite-doc {
            page-break-after: always;
            break-inside: avoid;
            font-size: 10px;
          }
          .holerite-doc:last-child { page-break-after: auto; }
          .holerite-doc table td, .holerite-doc table th { padding: 2px 4px !important; }
        }
      `}</style>
      
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm print:hidden">
        <p className="text-[#0369A1] font-medium text-sm">
          💰 <strong>Holerites Dinâmicos</strong>. Feriados e Multiplicadores lidos automaticamente do Motor de Regras.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 flex-grow flex flex-col lg:flex-row gap-6 max-w-[1500px] mx-auto w-full">
        
        {/* LISTAGEM LATERAL */}
        <aside className="w-full lg:w-80 flex-shrink-0 space-y-4 print:hidden">
          <div className="bg-[#0C1D4D] p-5 rounded-2xl shadow-md text-white">
            <h2 className="font-black uppercase tracking-wider mb-4">Equipe Rentech</h2>
            <input 
              type="text" placeholder="Buscar nome..." value={buscaGrid} onChange={e => setBuscaGrid(e.target.value)}
              className="w-full p-2.5 rounded-lg text-sm text-white bg-[#1E3A6E] outline-none font-bold placeholder:text-blue-200"
            />
            <select
              value={filtroContrato} onChange={e => setFiltroContrato(e.target.value)}
              className="w-full mt-3 p-2.5 rounded-lg text-sm text-white bg-[#1E3A6E] outline-none font-bold cursor-pointer"
            >
              <option value="TODOS">Todos os contratos</option>
              {contratosDisponiveis.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {filtroContrato !== 'TODOS' && (
              <p className="text-[10px] text-blue-200 font-bold mt-2 uppercase tracking-wider">
                {funcFiltrados.length} de {listaFuncionarios.length} — filtrado por contrato
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden max-h-[65vh] overflow-y-auto">
            {funcFiltrados.map((f, i) => (
              <div 
                key={i} onClick={() => trocarFuncionario(f.nome_completo)}
                className={`p-4 border-b border-[#E2E8F0] cursor-pointer transition-colors flex justify-between items-center ${funcionarioSelecionado === f.nome_completo ? 'bg-blue-50 border-l-4 border-l-[#336699]' : 'hover:bg-gray-50'}`}
              >
                <div>
                  <strong className={`block text-xs uppercase tracking-wider ${f.ativo ? 'text-[#0C1D4D]' : 'text-gray-400 line-through'}`}>{f.nome_completo}</strong>
                  <span className="text-[10px] text-gray-500 font-medium">{f.cargo || 'Sem função'}</span>
                </div>
                {!f.ativo && <span className="bg-red-100 text-red-700 text-[9px] font-black px-2 py-0.5 rounded">INATIVO</span>}
              </div>
            ))}
          </div>
        </aside>

        {/* CORPO */}
        <main className="flex-grow flex flex-col gap-4">

          {/* BARRA DE AÇÕES PRINCIPAL — navegação entre os dois modos da tela */}
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row items-center gap-2 print:hidden">
            <div className="flex bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0] w-full sm:w-auto">
              <button
                onClick={() => { if (funcionarioSelecionado) setActiveTab('config'); }}
                className={`flex-1 sm:flex-initial px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${activeTab === 'config' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}
              >
                👤 Ficha Individual
              </button>
              <button
                onClick={() => setActiveTab('impressao')}
                className={`flex-1 sm:flex-initial px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${activeTab === 'impressao' ? 'bg-[#336699] text-white shadow-sm' : 'text-[#64748B] hover:text-[#336699]'}`}
              >
                📄 Folha do Mês (Todos)
              </button>
            </div>
            <button
              onClick={prepararNovo}
              className="w-full sm:w-auto sm:ml-auto bg-blue-500 hover:bg-blue-400 text-white font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl transition-all shadow-sm"
            >
              + Novo Colaborador
            </button>
          </div>

          {/* ================== ABA PARÂMETROS (INDIVIDUAL) ================== */}
          {activeTab === 'config' && (
            !funcionarioSelecionado ? (
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl h-full flex items-center justify-center text-gray-400 font-bold uppercase tracking-wider print:hidden">
                Selecione um colaborador no menu lateral
              </div>
            ) : (
              <>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col md:flex-row justify-between items-center gap-4 print:hidden">
                  <div className="flex gap-4 items-center">
                    <div className="w-12 h-12 bg-blue-100 text-[#336699] rounded-full flex items-center justify-center font-black text-xl">
                      {form.nome_completo ? form.nome_completo.charAt(0) : '?'}
                    </div>
                    <div>
                      <h2 className="font-black text-[#0C1D4D] uppercase text-lg">{form.nome_completo || 'NOVO CADASTRO'}</h2>
                      <span className="text-xs text-gray-500 font-bold">{form.cargo}</span>
                    </div>
                    {fechamentoSelecionado && (
                      <span className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
                        🔒 Folha Fechada
                      </span>
                    )}
                    {temAlteracoesNaoSalvas && (
                      <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider animate-pulse">
                        ● Alterações não salvas
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex flex-col">
                      <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-0.5">Competência (mês trabalhado)</label>
                      <div className="flex items-center gap-2">
                        <input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)} className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                        <div className="flex flex-col items-start bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1">
                          <span className="text-[8px] font-black text-emerald-600 uppercase tracking-wider leading-none">Pagamento</span>
                          <span className="text-sm font-black text-emerald-700 leading-tight">{competenciaParaPagamento(mesReferencia)}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={salvarColaborador} disabled={loading} className={`font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-50 self-end ${temAlteracoesNaoSalvas ? 'bg-[#16A34A] hover:bg-[#15803D] text-white animate-pulse' : 'bg-[#0C1D4D] hover:bg-[#284B8C] text-white'}`}>
                      {loading ? '⏳ Gravando...' : '💾 Gravar'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-6 print:hidden pb-20">
                  {/* PAINEL DE DIAGNÓSTICO: mostra o que o ponto apurou e a regra em vigor */}
                  {funcionarioSelecionado !== 'NOVO' && (
                    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 grid grid-cols-2 md:grid-cols-6 gap-4 text-center">
                      <div>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Extras Seg-Sáb ({regraAtiva.percentual_extra_semana}%)</p>
                        <p className="text-lg font-black text-[#336699]">{formatTimeStr(apuracaoSelecionado.mins60)}</p>
                        <p className="text-[10px] font-bold text-gray-500">{formatCurrency(dadosSelecionado.totalExtra60)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Extras Dom/Fer ({regraAtiva.percentual_extra_dom_fer}%)</p>
                        <p className="text-lg font-black text-red-600">{formatTimeStr(apuracaoSelecionado.mins100)}</p>
                        <p className="text-[10px] font-bold text-gray-500">{formatCurrency(dadosSelecionado.totalExtra100)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Faltas (Dias Úteis)</p>
                        <p className={`text-lg font-black ${apuracaoSelecionado.faltas > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{apuracaoSelecionado.faltas}</p>
                        <p className="text-[10px] font-bold text-gray-500">
                          {regraAtiva.desconta_faltas
                            ? `- ${formatCurrency(dadosSelecionado.valorDescontoFaltas)}`
                            : 'regra não desconta'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">VR / VT (eventos)</p>
                        {(regraAtiva.direito_vr || regraAtiva.direito_vt) ? (
                          <>
                            <p className="text-lg font-black text-teal-600">{dadosSelecionado.qtdVr}vr · {dadosSelecionado.qtdVt}vt</p>
                            <p className="text-[10px] font-bold text-gray-500">+{formatCurrency(dadosSelecionado.totalVr + dadosSelecionado.totalVt)}</p>
                            {dadosSelecionado.totalDescontoBeneficios > 0 && (
                              <p className="text-[10px] font-bold text-red-500">-{formatCurrency(dadosSelecionado.totalDescontoBeneficios)} ({dadosSelecionado.diasFaltas}f)</p>
                            )}
                          </>
                        ) : (
                          <p className="text-[10px] font-bold text-gray-400 mt-2">sem direito</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Hora Base</p>
                        <p className="text-lg font-black text-[#0C1D4D]">{formatCurrency(valorHoraBase)}</p>
                        <p className="text-[10px] font-bold text-gray-500">{salarioBaseCalculo > 0 ? `base ${formatCurrency(salarioBaseCalculo)} ÷ 220` : '⚠ salários zerados'}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Regra Aplicada</p>
                        <p className="text-xs font-black text-[#0C1D4D] uppercase mt-1">{regraAtiva.nome_regra}</p>
                        {!regraAtiva.calcula_extras_padrao && <p className="text-[9px] font-black text-red-600 uppercase">⚠ Sem extras (contrato fechado)</p>}
                        {regraAtiva.calcula_extras_padrao && regraAtiva.tipo_pagamento_fds === 'VALOR_DIARIA' && <p className="text-[9px] font-black text-amber-600 uppercase">⚠ Modelo por diária: sem hora extra</p>}
                        {regraAtiva.calcula_extras_padrao && regraAtiva.tipo_pagamento_fds === 'HORA_PERCENTUAL' && <p className="text-[9px] font-black text-emerald-600 uppercase">✔ Extras por percentual</p>}
                      </div>
                    </div>
                  )}

                  {fechamentoSelecionado && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800 font-bold">
                      🔒 A folha de {formatarMesAnoBR(mesReferencia)} deste colaborador está fechada
                      (por {fechamentoSelecionado.fechado_por || 'usuário não identificado'} em {new Date(fechamentoSelecionado.fechado_em).toLocaleString('pt-BR')}).
                      Alterações feitas aqui valerão apenas para meses em aberto — o holerite fechado não muda.
                    </div>
                  )}

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] space-y-4 h-fit">
                      <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-2">
                        <button onClick={() => setFichaExpandida(!fichaExpandida)} className="flex items-center gap-2 text-left group">
                          <span className="text-[#336699] font-black text-lg transition-transform" style={{ transform: fichaExpandida ? 'rotate(90deg)' : 'none' }}>▸</span>
                          <div>
                            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider group-hover:text-[#336699] transition-colors">{form.nome_completo || 'Novo Colaborador'}</h3>
                            {!fichaExpandida && <span className="text-[10px] text-gray-400 font-bold uppercase">{form.cargo || 'sem cargo'} • {form.tipo_contrato} • clique para editar dados</span>}
                          </div>
                        </button>
                        <button onClick={alternarStatusAtivo} className={`text-[10px] px-3 py-1 rounded font-black uppercase tracking-wider transition-colors flex-shrink-0 ${form.ativo ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                          {form.ativo ? 'SUSPENDER' : 'REATIVAR'}
                        </button>
                      </div>
                      
                      {fichaExpandida && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Nome Completo</label><input type="text" value={form.nome_completo} onChange={e => setForm({...form, nome_completo: e.target.value.toUpperCase()})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-gray-50 uppercase" /></div>

                        <div className="col-span-2 grid grid-cols-2 gap-4 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                          <div className="col-span-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider">Dados Pessoais (para assinatura digital)</div>
                          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">CPF</label><input type="text" value={form.cpf || ''} onChange={e => setForm({...form, cpf: e.target.value || null})} placeholder="000.000.000-00" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Data de Nascimento</label><input type="date" value={form.data_nascimento || ''} onChange={e => setForm({...form, data_nascimento: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Celular (WhatsApp)</label><input type="tel" value={form.celular || ''} onChange={e => setForm({...form, celular: e.target.value || null})} placeholder="(11) 90000-0000" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">E-mail</label><input type="email" value={form.email || ''} onChange={e => setForm({...form, email: e.target.value || null})} placeholder="nome@email.com" className="w-full p-2 border border-gray-300 rounded text-sm lowercase" /></div>

                          <div className="col-span-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider mt-2">Dados Bancários (para pagamento)</div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Chave PIX</label>
                            <div className="flex gap-1">
                              <select value={form.pix_tipo || ''} onChange={e => setForm({...form, pix_tipo: e.target.value || null})} className="p-2 border border-gray-300 rounded text-xs font-bold bg-white">
                                <option value="">Tipo</option>
                                <option value="CPF">CPF</option>
                                <option value="EMAIL">E-mail</option>
                                <option value="TELEFONE">Telefone</option>
                                <option value="ALEATORIA">Aleatória</option>
                              </select>
                              <input type="text" value={form.pix_chave || ''} onChange={e => setForm({...form, pix_chave: e.target.value || null})} placeholder="chave pix" className="flex-1 min-w-0 p-2 border border-gray-300 rounded text-sm" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tipo de conta</label>
                            <select value={form.banco_tipo || ''} onChange={e => setForm({...form, banco_tipo: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
                              <option value="">— Selecione —</option>
                              <option value="CORRENTE">Corrente</option>
                              <option value="POUPANCA">Poupança</option>
                            </select>
                          </div>
                          <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Banco (código)</label><input type="text" value={form.banco_codigo || ''} onChange={e => setForm({...form, banco_codigo: e.target.value || null})} placeholder="341" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Agência</label><input type="text" value={form.banco_agencia || ''} onChange={e => setForm({...form, banco_agencia: e.target.value || null})} placeholder="0000" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                            <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Conta</label><input type="text" value={form.banco_conta || ''} onChange={e => setForm({...form, banco_conta: e.target.value || null})} placeholder="00000-0" className="w-full p-2 border border-gray-300 rounded text-sm" /></div>
                          </div>
                          <div className="col-span-2 text-[10px] text-gray-400 font-medium">💡 PIX tem prioridade no pagamento. Se não houver PIX, usa a conta bancária.</div>

                          <div className="col-span-2 text-[10px] font-black text-indigo-600 uppercase tracking-wider mt-2">O que este funcionário recebe</div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Recebe fechamento (nossa folha)</label>
                            <select value={form.recebe_fechamento === null ? 'HERDA' : form.recebe_fechamento ? 'SIM' : 'NAO'}
                              onChange={e => setForm({...form, recebe_fechamento: e.target.value === 'HERDA' ? null : e.target.value === 'SIM'})}
                              className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
                              <option value="HERDA">↑ Herda (cargo/contrato)</option>
                              <option value="SIM">✓ Sim, recebe</option>
                              <option value="NAO">✕ Não recebe</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Recebe holerite (contabilidade)</label>
                            <select value={form.recebe_holerite === null ? 'HERDA' : form.recebe_holerite ? 'SIM' : 'NAO'}
                              onChange={e => setForm({...form, recebe_holerite: e.target.value === 'HERDA' ? null : e.target.value === 'SIM'})}
                              className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white">
                              <option value="HERDA">↑ Herda (cargo/contrato)</option>
                              <option value="SIM">✓ Sim, recebe</option>
                              <option value="NAO">✕ Não recebe</option>
                            </select>
                          </div>
                          <div className="col-span-2 text-[10px] text-gray-400 font-medium">💡 "Herda" segue a regra do cargo, e se o cargo não definir, a do contrato. Marque Sim/Não só para exceções deste funcionário.</div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Cargo</label>
                          <select value={form.cargo} onChange={e => setForm({...form, cargo: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white uppercase text-[#0C1D4D]">
                            <option value="">— Selecione —</option>
                            {/* Mantém o cargo atual visível mesmo se tiver sido removido do catálogo */}
                            {form.cargo && !cargosCatalogo.includes(form.cargo) && <option value={form.cargo}>{form.cargo} (fora do catálogo)</option>}
                            {cargosCatalogo.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Tipo de Regra de Contrato</label>
                          <select value={form.tipo_contrato} onChange={e => setForm({...form, tipo_contrato: e.target.value})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold bg-white uppercase text-[#0C1D4D]">
                            {Object.keys(regrasContrato).map(k => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </div>

                        <div className="col-span-2 grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Data de Admissão</label>
                            <input type="date" value={form.data_admissao || ''} onChange={e => setForm({...form, data_admissao: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Data de Desligamento</label>
                            <input type="date" value={form.data_desligamento || ''} onChange={e => setForm({...form, data_desligamento: e.target.value || null})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-red-600" />
                            {form.data_desligamento && <p className="text-[9px] font-bold text-red-500 mt-0.5 uppercase">Faltas não contam após esta data</p>}
                          </div>
                        </div>
                        
                        <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Salário Folha</label><input type="number" step="0.01" value={form.salario_folha} onChange={e => setForm({...form, salario_folha: Number(e.target.value)})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-[#0C1D4D]" /></div>
                        <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Salário Contrato Total</label><input type="number" step="0.01" value={form.salario_contrato} onChange={e => setForm({...form, salario_contrato: Number(e.target.value)})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-[#16A34A]" /></div>
                        
                        {(regraAtiva.direito_vr || regraAtiva.direito_vt) ? (
                          <div className="col-span-2 bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] font-black text-[#336699] uppercase tracking-wider">Benefícios (VR / VT)</span>
                              <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                                {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' ? 'Valor Fechado (÷30)' : 'Por Dia'}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              {regraAtiva.direito_vr && (
                                <div>
                                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                    {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' ? 'VR — Valor do Mês' : 'VR — Diária'}
                                  </label>
                                  <input type="number" step="0.01" value={form.valor_refeicao} onChange={e => setForm({...form, valor_refeicao: Number(e.target.value)})} className="w-full p-2 border border-blue-200 rounded text-sm" />
                                  {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' && form.valor_refeicao > 0 && (
                                    <p className="text-[9px] font-bold text-blue-600 mt-0.5 uppercase">Diária: {formatCurrency(form.valor_refeicao / 30)}</p>
                                  )}
                                </div>
                              )}
                              {regraAtiva.direito_vt && (
                                <div>
                                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                    {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' ? 'VT — Valor do Mês' : 'VT — Diária'}
                                  </label>
                                  <input type="number" step="0.01" value={form.valor_transporte} onChange={e => setForm({...form, valor_transporte: Number(e.target.value)})} className="w-full p-2 border border-blue-200 rounded text-sm" />
                                  {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' && form.valor_transporte > 0 && (
                                    <p className="text-[9px] font-bold text-blue-600 mt-0.5 uppercase">Diária: {formatCurrency(form.valor_transporte / 30)}</p>
                                  )}
                                </div>
                              )}
                            </div>
                            <p className="text-[9px] text-blue-500 font-medium mt-2 uppercase">Os valores são gerados por dia trabalhado conforme a jornada. Configure o direito e a modalidade no Motor de Regras.</p>
                          </div>
                        ) : (
                          <div className="col-span-2 bg-gray-50 p-3 rounded-lg border border-gray-200 text-[10px] font-bold text-gray-400 uppercase text-center">
                            Este contrato ({form.tipo_contrato}) não dá direito a VR/VT. Ajuste no Motor de Regras se necessário.
                          </div>
                        )}
                        <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Adiantamento (Dia 20)</label><input type="number" step="0.01" value={form.valor_adiantamento} onChange={e => setForm({...form, valor_adiantamento: Number(e.target.value)})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-red-600" /></div>
                      </div>
                      )}
                    </div>

                    <div className="space-y-6">
                      <div className="bg-white p-5 rounded-2xl shadow-sm border border-green-200">
                        <div className="flex justify-between items-center border-b border-green-100 pb-2 mb-4">
                          <h3 className="font-black text-[#16A34A] uppercase tracking-wider">Bônus e Prêmios</h3>
                          <button onClick={addBonus} className="text-[10px] bg-green-100 text-green-700 font-black px-3 py-1.5 rounded uppercase tracking-wider">+ ADICIONAR</button>
                        </div>
                        <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 uppercase">ℹ️ As datas são a COMPETÊNCIA (mês trabalhado). O pagamento sai sempre no mês seguinte.</p>
                        <div className="space-y-3">
                          {bonusComIndice
                            .filter(({ encerrado }) => mostrarBonusEncerrados || !encerrado)
                            .map(({ b, idx, encerrado }) => (
                            <div key={idx} className={`p-3 border rounded-lg grid grid-cols-2 gap-2 relative group ${encerrado ? 'bg-gray-100 border-gray-200' : 'bg-green-50/30 border-green-100'}`}>
                              {!encerrado && <button onClick={() => removeBonus(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 font-bold opacity-0 group-hover:opacity-100">X</button>}
                              <div className="col-span-2 flex items-center justify-between gap-2">
                                <input type="text" placeholder="Descrição" value={b.descricao} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].descricao = e.target.value; setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs uppercase disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />
                                {encerrado && <span className="text-[9px] bg-gray-300 text-gray-600 px-2 py-0.5 rounded font-black uppercase whitespace-nowrap">🔒 Pago</span>}
                              </div>
                              <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Valor R$</label><input type="number" step="0.01" value={b.valor} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].valor = Number(e.target.value); setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs text-[#16A34A] font-bold disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                              <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Recorrência</label><select value={b.recorrencia} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].recorrencia = e.target.value as 'MENSAL'|'UNICO'; setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"><option value="UNICO">Única Vez</option><option value="MENSAL">Fixo (Mensal)</option></select></div>
                              {b.recorrencia === 'UNICO' && <div className="col-span-2"><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Competência do Bônus</label><input type="month" value={b.mes_referencia} disabled={encerrado} onChange={e => { const n = [...bonus]; n[idx].mes_referencia = e.target.value; setBonus(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />{b.mes_referencia && <p className="text-[9px] font-bold text-emerald-600 mt-0.5 uppercase">💵 Sai no pagamento de {competenciaParaPagamento(b.mes_referencia)}</p>}</div>}
                            </div>
                          ))}

                          {bonus.length === 0 && (
                            <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Nenhum bônus lançado</p>
                          )}
                        </div>

                        {qtdBonusEncerrados > 0 && (
                          <button
                            onClick={() => setMostrarBonusEncerrados(!mostrarBonusEncerrados)}
                            className="w-full mt-3 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:text-[#0C1D4D] bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg py-2 transition-colors"
                          >
                            {mostrarBonusEncerrados
                              ? `▲ Ocultar ${qtdBonusEncerrados} bônus já pago(s)`
                              : `▼ Ver ${qtdBonusEncerrados} bônus já pago(s)`}
                          </button>
                        )}
                      </div>

                      <div className="bg-white p-5 rounded-2xl shadow-sm border border-red-200">
                        <div className="flex justify-between items-center border-b border-red-100 pb-2 mb-4">
                          <h3 className="font-black text-red-600 uppercase tracking-wider">Débitos e Descontos</h3>
                          <button onClick={addDesconto} className="text-[10px] bg-red-100 text-red-700 font-black px-3 py-1.5 rounded uppercase tracking-wider">+ ADICIONAR</button>
                        </div>
                        <p className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 uppercase">ℹ️ A "Competência 1ª Parcela" é o mês trabalhado. O desconto sai no pagamento do mês seguinte.</p>
                        <div className="space-y-3">
                          {descontosComIndice
                            .filter(({ quitado }) => mostrarQuitados || !quitado)
                            .map(({ d, idx, quitado }) => {
                            return (
                            <div key={idx} className={`p-3 border rounded-lg grid grid-cols-2 gap-2 relative group ${quitado ? 'bg-gray-100 border-gray-200' : 'bg-red-50/30 border-red-100'}`}>
                              {!quitado && <button onClick={() => removeDesconto(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 font-bold opacity-0 group-hover:opacity-100">X</button>}
                              <div className="col-span-2 flex items-center justify-between gap-2">
                                <input type="text" placeholder="Descrição do Desconto" value={d.descricao} disabled={quitado} onChange={e => handleDescontoChange(idx, 'descricao', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs uppercase disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />
                                {quitado && <span className="text-[9px] bg-gray-300 text-gray-600 px-2 py-0.5 rounded font-black uppercase whitespace-nowrap">🔒 Quitado</span>}
                              </div>
                              <div><input type="number" step="0.01" placeholder="Valor R$" value={d.valor_parcela} disabled={quitado} onChange={e => handleDescontoChange(idx, 'valor_parcela', Number(e.target.value))} className="w-full p-1.5 border border-gray-200 rounded text-xs text-red-600 font-bold disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                              <div>
                                <select value={d.tipo} disabled={quitado} onChange={e => handleDescontoChange(idx, 'tipo', e.target.value as Desconto['tipo'])} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed">
                                  <option value="PARCELADO">Parcelado</option>
                                  <option value="FIXO">Fixo (Mensal)</option>
                                </select>
                              </div>
                              <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Competência 1ª Parcela</label><input type="month" value={d.mes_inicio} disabled={quitado} onChange={e => handleDescontoChange(idx, 'mes_inicio', e.target.value)} className="w-full p-1.5 border border-gray-200 rounded text-xs disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                              
                              {d.tipo === 'PARCELADO' ? (
                                <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Qtd Parcelas</label><input type="number" placeholder="Qtd Parc." value={d.parcelas} disabled={quitado} onChange={e => handleDescontoChange(idx, 'parcelas', Number(e.target.value))} className="w-full p-1.5 border border-gray-200 rounded text-xs disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                              ) : (
                                <div className="flex items-end"><div className="w-full p-1.5 bg-gray-100 text-gray-500 rounded text-[10px] text-center font-bold">FIXO CONTÍNUO</div></div>
                              )}

                              {d.tipo === 'PARCELADO' && d.mes_inicio && (
                                <div className="col-span-2 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                                  <p className="text-[9px] font-black text-emerald-700 uppercase leading-tight">
                                    💵 1ª parcela paga em {competenciaParaPagamento(d.mes_inicio)}
                                    {d.mes_fim && ` • última em ${competenciaParaPagamento(d.mes_fim)}`}
                                  </p>
                                  {quitado && <p className="text-[9px] font-bold text-gray-500 uppercase mt-0.5">Encerrada, bloqueada para edição</p>}
                                </div>
                              )}
                            </div>
                            );
                          })}

                          {descontos.length === 0 && (
                            <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Nenhum desconto lançado</p>
                          )}
                          {descontos.length > 0 && qtdQuitados === descontos.length && !mostrarQuitados && (
                            <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Todos os descontos deste colaborador já estão quitados</p>
                          )}
                        </div>

                        {qtdQuitados > 0 && (
                          <button
                            onClick={() => setMostrarQuitados(!mostrarQuitados)}
                            className="w-full mt-3 text-[10px] font-black uppercase tracking-wider text-gray-500 hover:text-[#0C1D4D] bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg py-2 transition-colors"
                          >
                            {mostrarQuitados
                              ? `▲ Ocultar ${qtdQuitados} desconto(s) quitado(s)`
                              : `▼ Ver ${qtdQuitados} desconto(s) quitado(s)`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="w-full mt-4">
                    <button onClick={salvarColaborador} disabled={loading} className={`w-full font-black uppercase tracking-widest text-sm py-4 rounded-xl shadow-md transition-all active:scale-[0.99] disabled:opacity-50 ${temAlteracoesNaoSalvas ? 'bg-[#16A34A] hover:bg-[#15803D] text-white' : 'bg-[#0C1D4D] hover:bg-[#284B8C] text-white'}`}>
                      {loading ? '⏳ Gravando...' : temAlteracoesNaoSalvas ? '💾 Gravar Alterações' : '💾 Gravar Ficha'}
                    </button>
                  </div>
                </div>
              </>
            )
          )}

          {/* ================== ABA FOLHA DO MÊS (TODOS) ================== */}
          {activeTab === 'impressao' && (
            <div className="flex flex-col items-center pb-10">
              <div className="w-full max-w-5xl bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-3 mb-6 print:hidden">
                <div>
                  <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Folha do Mês — Todos os Funcionários</h2>
                  <p className="text-sm text-[#64748B]">
                    Competência: {formatarMesAnoBR(mesReferencia)} • {lote.length} funcionário(s) ativo(s) • {totalFechados} fechado(s)
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-center">
                  <input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)} className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC]" />
                  <button onClick={fecharFolhaTodos} disabled={loadingLote || lote.length === 0} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#15803D] transition-all disabled:opacity-50">
                    🔒 Fechar Folha do Mês (Todos)
                  </button>
                  {totalFechados > 0 && (
                    <button onClick={reabrirFolhaTodos} disabled={loadingLote} className="bg-white border-2 border-red-300 text-red-600 font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl hover:bg-red-50 transition-all disabled:opacity-50">
                      🔓 Reabrir Todos ({totalFechados})
                    </button>
                  )}
                  <button onClick={() => window.print()} disabled={lote.length === 0} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#284B8C] transition-all disabled:opacity-50">
                    🖨️ Imprimir Todos ({lote.length} páginas)
                  </button>
                </div>
              </div>

              {/* Barra de ASSINATURA DIGITAL */}
              {totalFechados > 0 && (
                <div className="w-full max-w-5xl bg-indigo-50 border border-indigo-200 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-3 mb-6 print:hidden">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">✍️</span>
                    <div>
                      <h3 className="text-sm font-black text-indigo-900 uppercase tracking-wider">Assinatura Digital (Autentique)</h3>
                      <p className="text-[11px] text-indigo-700 font-bold">Envia os holerites fechados para assinatura com validação por CPF.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider cursor-pointer bg-white px-3 py-2 rounded-lg border border-indigo-200">
                      <input type="checkbox" checked={sandboxAssinatura} onChange={e => setSandboxAssinatura(e.target.checked)} />
                      <span className={sandboxAssinatura ? 'text-amber-600' : 'text-red-600'}>{sandboxAssinatura ? '🧪 Modo Teste' : '⚠ Modo Real'}</span>
                    </label>
                    <button onClick={enviarAssinaturaTodos} disabled={enviandoAssinatura !== null} className="bg-indigo-600 text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-indigo-700 transition-all disabled:opacity-50">
                      {enviandoAssinatura === 'LOTE' ? '⏳ Enviando...' : '📤 Enviar Todos p/ Assinatura'}
                    </button>
                    <button onClick={() => router.push('/admin/rh/assinaturas')} className="bg-white border-2 border-indigo-300 text-indigo-700 font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl hover:bg-indigo-50 transition-all">
                      📋 Acompanhar
                    </button>
                  </div>
                </div>
              )}

              {loadingLote ? (
                <div className="w-full max-w-5xl bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider print:hidden">
                  Montando os holerites do mês...
                </div>
              ) : lote.length === 0 ? (
                <div className="w-full max-w-5xl bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider print:hidden">
                  Nenhum funcionário ativo encontrado.
                </div>
              ) : (
                lote.map(item => (
                  item.soDocumental ? (
                    // Contrato só documental: não tem holerite calculado.
                    // Card simplificado com botão de enviar (junta anexos da contabilidade).
                    <div key={item.func.nome_completo} className="w-full max-w-5xl print:hidden">
                      <div className="bg-white border-2 border-dashed border-indigo-200 rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-center gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">📄</span>
                          <div>
                            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider">{item.func.nome_completo}</h3>
                            <p className="text-[11px] text-gray-500 font-bold uppercase">{item.func.tipo_contrato} • só documental (sem cálculo) • envia holerites da contabilidade</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => previaPdf(item)} disabled={gerandoPrevia !== null} className="text-[10px] font-black text-gray-500 uppercase tracking-wider hover:bg-gray-100 px-3 py-2 rounded-lg disabled:opacity-50 border border-gray-200">
                            {gerandoPrevia === item.func.nome_completo ? '⏳' : '👁 Prévia'}
                          </button>
                          {item.statusAssinatura && (
                            <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider ${
                              item.statusAssinatura === 'ASSINADO' ? 'bg-green-100 text-green-700' :
                              item.statusAssinatura === 'VISUALIZADO' ? 'bg-blue-100 text-blue-700' :
                              item.statusAssinatura === 'REJEITADO' ? 'bg-red-100 text-red-700' :
                              'bg-indigo-100 text-indigo-700'
                            }`}>
                              {item.statusAssinatura === 'ASSINADO' ? '✅ Assinado' :
                               item.statusAssinatura === 'VISUALIZADO' ? '👁 Visualizado' :
                               item.statusAssinatura === 'REJEITADO' ? '✖ Rejeitado' : '📤 Enviado'}
                            </span>
                          )}
                          {item.statusAssinatura !== 'ASSINADO' && (
                            <button onClick={() => enviarAssinatura(item)} disabled={enviandoAssinatura !== null} className="bg-indigo-600 text-white font-black uppercase tracking-widest text-[10px] px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                              {enviandoAssinatura === item.func.nome_completo ? '⏳ Enviando...' : item.statusAssinatura ? '↻ Reenviar' : '📤 Enviar p/ Assinatura'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div key={item.func.nome_completo} className="w-full max-w-5xl flex flex-col items-center">
                    <div className="w-full flex justify-between items-center mb-2 print:hidden">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider ${item.fechamento ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {item.fechamento
                            ? `🔒 Fechada em ${new Date(item.fechamento.fechado_em).toLocaleDateString('pt-BR')} por ${item.fechamento.fechado_por || '—'}`
                            : '⚠ Em aberto — valores podem mudar com o ponto'}
                        </span>
                        {item.statusAssinatura && (
                          <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider ${
                            item.statusAssinatura === 'ASSINADO' ? 'bg-green-100 text-green-700' :
                            item.statusAssinatura === 'VISUALIZADO' ? 'bg-blue-100 text-blue-700' :
                            item.statusAssinatura === 'REJEITADO' ? 'bg-red-100 text-red-700' :
                            'bg-indigo-100 text-indigo-700'
                          }`}>
                            {item.statusAssinatura === 'ASSINADO' ? '✅ Assinado' :
                             item.statusAssinatura === 'VISUALIZADO' ? '👁 Visualizado' :
                             item.statusAssinatura === 'REJEITADO' ? '✖ Rejeitado' : '📤 Enviado'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => previaPdf(item)} disabled={gerandoPrevia !== null} className="text-[10px] font-black text-gray-500 uppercase tracking-wider hover:bg-gray-100 px-3 py-1 rounded disabled:opacity-50 border border-gray-200">
                          {gerandoPrevia === item.func.nome_completo ? '⏳' : '👁 Prévia PDF'}
                        </button>
                        {item.fechamento && item.statusAssinatura !== 'ASSINADO' && (
                          <button onClick={() => enviarAssinatura(item)} disabled={enviandoAssinatura !== null} className="text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:bg-indigo-50 px-3 py-1 rounded disabled:opacity-50 border border-indigo-200">
                            {enviandoAssinatura === item.func.nome_completo ? '⏳ Enviando...' : item.statusAssinatura ? '↻ Reenviar' : '📤 Assinatura'}
                          </button>
                        )}
                        {item.fechamento && (
                          <button onClick={() => reabrirFolhaDe(item.fechamento!)} disabled={loadingLote} className="text-[10px] font-black text-red-600 uppercase tracking-wider hover:bg-red-50 px-3 py-1 rounded disabled:opacity-50">
                            🔓 Reabrir
                          </button>
                        )}
                      </div>
                    </div>
                    <HoleriteDoc
                      nome={item.func.nome_completo}
                      dados={item.fechamento ? item.fechamento.dados : item.dados}
                      mesRef={mesReferencia}
                      fechamento={item.fechamento}
                    />
                  </div>
                  )
                ))
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}