//app\admin\rh\holerite\page.tsx

"use client";
 
import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { fecharFolhaLoteAction, reabrirFolhaAction } from '../actions/actions-folha';
import { enviarHoleriteAssinaturaAction, enviarHoleritesLoteAction, previaDocumentoAssinaturaAction } from '../actions/actions-assinatura';
import logoColorido from '../../../../app/imgs/logo.png';

// ============================================================================
// MOTOR DE NORMALIZAÇÃO DE PERMISSÕES
// ============================================================================
const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  return 'USUARIO'; 
};
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

const competenciaParaPagamento = (mesAnoIso: string) => {
  if (!mesAnoIso) return '';
  const [ano, mes] = mesAnoIso.split('-').map(Number);
  const d = new Date(ano, mes, 1);
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
  direito_vr: boolean;
  direito_vt: boolean;
  modalidade_beneficio: 'POR_DIA' | 'VALOR_FECHADO';
  so_documental: boolean;
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
  statusAssinatura: string | null;
  soDocumental: boolean;
}

const REGRA_PADRAO: RegraContrato = {
  nome_regra: 'PADRÃO',
  paga_salario_base: true, calcula_extras_padrao: true, percentual_extra_semana: 60,
  percentual_extra_sabado: 60, tipo_pagamento_fds: 'HORA_PERCENTUAL', percentual_extra_dom_fer: 100,
  valor_diaria_fds: 0, desconta_faltas: true,
  direito_vr: false, direito_vt: false, modalidade_beneficio: 'POR_DIA', so_documental: false
};

// ============================================================================
// APURAÇÃO DO PONTO (batidas + abonos) EM DOIS GRUPOS
// ============================================================================
const apurarPonto = (
  dias: Record<string, { trabalhados: number; abonados: number }>,
  feriados: string[],
  mesAno: string,
  dataAdmissao?: string | null,
  dataDesligamento?: string | null
) => {
  let mins60 = 0; let mins100 = 0; let diasFds = 0;
  let qtdVr = 0; let qtdVt = 0;

  Object.entries(dias).forEach(([dataIso, v]) => {
    const diaSemana = getDiaSemana(dataIso);
    const isFeriado = feriados.includes(dataIso);

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

  return { mins60, mins100, diasFds, faltas, qtdVr, qtdVt };
};

// ============================================================================
// MOTOR DE CÁLCULO DO HOLERITE — função pura
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

  const salarioBaseExibido = regra.paga_salario_base ? func.salario_folha * fatorProporcional : 0;
  const complementoContratoExibido = regra.paga_salario_base ? Math.max(0, func.salario_contrato - func.salario_folha) * fatorProporcional : 0;

  const descontosAtivos = descontosFunc.filter(d => {
    if (mesRef < d.mes_inicio) return false;
    if (d.tipo === 'FIXO') return true;
    const fimReal = (d.mes_inicio && d.parcelas > 0) ? calcularMesFim(d.mes_inicio, d.parcelas) : d.mes_fim;
    return mesRef <= fimReal;
  });
  const bonusAtivos = bonusFunc.filter(b => b.recorrencia === 'MENSAL' || b.mes_referencia === mesRef);

  const totalBonusGrid = bonusAtivos.reduce((acc, curr) => acc + curr.valor, 0);
  const totalDescontosGrid = descontosAtivos.reduce((acc, curr) => acc + curr.valor_parcela, 0);

  const modalidade = regra.modalidade_beneficio;
  const diariaVr = modalidade === 'VALOR_FECHADO' ? (func.valor_refeicao / 30) : func.valor_refeicao;
  const diariaVt = modalidade === 'VALOR_FECHADO' ? (func.valor_transporte / 30) : func.valor_transporte;

  const qtdVr = regra.direito_vr ? apuracao.qtdVr : 0;
  const qtdVt = regra.direito_vt ? apuracao.qtdVt : 0;

  const totalVr = qtdVr * diariaVr;
  const totalVt = qtdVt * diariaVt;
  const totalAdicionais = totalVr + totalVt;

  const baseFaltas = func.salario_contrato > 0 ? func.salario_contrato : func.salario_folha;
  const diasFaltas = regra.desconta_faltas ? apuracao.faltas : 0;
  const valorDescontoFaltas = diasFaltas > 0 ? (baseFaltas / 30) * diasFaltas : 0;

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
  const pathname = usePathname();
  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [emailUsuario, setEmailUsuario] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingLote, setLoadingLote] = useState(false);

  const [regrasContrato, setRegrasContrato] = useState<Record<string, RegraContrato>>({});
  const [funcionarioSelecionado, setFuncionarioSelecionado] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'impressao'>('impressao');

  const [lote, setLote] = useState<ItemLote[]>([]);
  const [enviandoAssinatura, setEnviandoAssinatura] = useState<string | null>(null);
  const [gerandoPrevia, setGerandoPrevia] = useState<string | null>(null);
  const [sandboxAssinatura, setSandboxAssinatura] = useState(true);

  const [fechamentoSelecionado, setFechamentoSelecionado] = useState<Fechamento | null>(null);
  const [apuracaoSelecionado, setApuracaoSelecionado] = useState({ mins60: 0, mins100: 0, diasFds: 0, faltas: 0, qtdVr: 0, qtdVt: 0 });
  const [formSelecionado, setFormSelecionado] = useState<FuncionarioFin | null>(null);
  const [descontosSelecionado, setDescontosSelecionado] = useState<Desconto[]>([]);
  const [bonusSelecionado, setBonusSelecionado] = useState<Bonus[]>([]);

  const [mesReferencia, setMesReferencia] = useState(() => {
    const hoje = new Date();
    const comp = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    return `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
  });

  // Valida a sessão e a permissão antes de liberar a página
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase
        .from('perfis_usuarios').select('*').eq('id', session.user.id).single();

      if (perfilError || !perfil) {
        console.error("Erro crítico ao buscar perfil do usuário:", perfilError);
        router.push('/login');
        return;
      }

      // Consulta no banco de dados quem pode aceder a esta rota
      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes')
        .select('permissoes_permitidas')
        .eq('endereco_route', pathname)
        .single();

      if (rotaError && rotaError.code !== 'PGRST116') {
        console.error("Erro ao buscar permissão da rota:", rotaError);
      }

      // Normaliza o perfil logado e verifica contra o banco
      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];

      if (!permissoesLiberadas.includes(permissaoNormalizada)) {
        setAcessoNegado(true);
        setAuthLoading(false);
        return;
      }
      setUsuarioAtual(perfil.nome || 'Equipe RH');
      setEmailUsuario(perfil.email || session.user.email || '');
      setAuthLoading(false);
      carregarRegras();
    }
    checkAuth();
  }, [router, pathname]);

  useEffect(() => {
    if (!authLoading) carregarLote(mesReferencia);
  }, [mesReferencia, authLoading]);

  const carregarRegras = async () => {
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

  const carregarDetalhes = async (nome: string, mesAno: string) => {
    setLoading(true);

    const { data: funcData, error: funcError } = await supabase
      .from('folha_funcionarios').select('*').eq('nome_completo', nome).single();
    if (funcError || !funcData) {
      alert(`Não foi possível carregar a ficha de ${nome}: ${funcError?.message || 'registro não encontrado'}`);
      setLoading(false);
      return;
    }
    setFormSelecionado(funcData);

    const { data: descData } = await supabase.from('folha_descontos').select('*').eq('funcionario_nome', nome);
    setDescontosSelecionado(descData ? descData.map(d => ({ ...d, tipo: d.tipo || 'PARCELADO' })) : []);

    const { data: bonusData } = await supabase.from('folha_bonus').select('*').eq('funcionario_nome', nome);
    setBonusSelecionado(bonusData || []);

    const { data: fechData } = await supabase
      .from('folha_holerites').select('*')
      .eq('funcionario_nome', nome).eq('mes_referencia', mesAno).maybeSingle();
    setFechamentoSelecionado(fechData || null);

    const { porFuncionario, feriados } = await buscarPontoDoMes(mesAno, nome);
    setApuracaoSelecionado(apurarPonto(porFuncionario[nome] || {}, feriados, mesAno, funcData.data_admissao, funcData.data_desligamento));

    setLoading(false);
  };

  useEffect(() => {
    if (funcionarioSelecionado && !authLoading) {
      carregarDetalhes(funcionarioSelecionado, mesReferencia);
    }
  }, [funcionarioSelecionado, mesReferencia, authLoading]);

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

      const admitidoAteOMes = (dataAdmissao: string | null) => {
        if (!dataAdmissao) return true;
        return dataAdmissao.slice(0, 7) <= mesAno;
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

  const previaPdf = async (item: ItemLote) => {
    setGerandoPrevia(item.func.nome_completo);
    try {
      const res = await previaDocumentoAssinaturaAction({
        funcionarioNome: item.func.nome_completo,
        mesReferencia,
        soDocumental: item.soDocumental,
        dadosAoVivo: item.fechamento ? undefined : item.dados
      });
      if (!res.ok) throw new Error(res.erro);
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

  const enviarAssinatura = async (item: ItemLote) => {
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

  const dadosSelecionado = formSelecionado
    ? montarDadosHolerite(formSelecionado, regrasContrato, descontosSelecionado, bonusSelecionado, apuracaoSelecionado, mesReferencia)
    : null;
  const regraAtiva = dadosSelecionado?.regra || null;
  const salarioBaseCalculo = formSelecionado ? (formSelecionado.salario_folha > 0 ? formSelecionado.salario_folha : formSelecionado.salario_contrato) : 0;
  const valorHoraBase = salarioBaseCalculo / 220;

  const totalFechados = lote.filter(l => l.fechamento).length;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <p className="text-[#64748B] font-bold text-sm uppercase tracking-wider">Validando acesso...</p>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar esta página.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

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

      <div className="p-4 md:px-8 pt-6 flex-grow flex flex-col max-w-[1500px] mx-auto w-full">
        <div className="flex flex-col items-center pb-10">
          <div className="w-full max-w-5xl bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-6 print:hidden">
            <div className="mb-4">
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Folha do Mês — Todos os Funcionários</h2>
              <p className="text-sm text-[#64748B]">
                Competência: {formatarMesAnoBR(mesReferencia)} • {lote.length} funcionário(s) ativo(s) • {totalFechados} fechado(s)
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Competência</label>
                <input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)} className="w-full p-2.5 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC]" />
              </div>

              <div className="flex flex-col gap-2">
                <button onClick={fecharFolhaTodos} disabled={loadingLote || lote.length === 0} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl shadow-md hover:bg-[#15803D] transition-all disabled:opacity-50">
                  🔒 Fechar Folha do Mês (Todos)
                </button>
                {totalFechados > 0 && (
                  <button onClick={reabrirFolhaTodos} disabled={loadingLote} className="bg-white border-2 border-red-300 text-red-600 font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl hover:bg-red-50 transition-all disabled:opacity-50">
                    🔓 Reabrir Todos ({totalFechados})
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button onClick={() => window.print()} disabled={lote.length === 0} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl shadow-md hover:bg-[#284B8C] transition-all disabled:opacity-50">
                  🖨️ Imprimir Todos ({lote.length} páginas)
                </button>
              </div>
            </div>
          </div>

          {totalFechados > 0 && (
            <div className="w-full max-w-5xl bg-indigo-50 border border-indigo-200 p-4 rounded-2xl mb-6 print:hidden">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-lg">✍️</span>
                <div>
                  <h3 className="text-sm font-black text-indigo-900 uppercase tracking-wider">Assinatura Digital (Autentique)</h3>
                  <p className="text-[11px] text-indigo-700 font-bold">Envia os holerites fechados para assinatura com validação por CPF.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-indigo-100">
                <div>
                  <label className="block text-[10px] font-black text-indigo-400 uppercase mb-1">Ambiente</label>
                  <label className="w-full flex items-center gap-2 text-[11px] font-black uppercase tracking-wider cursor-pointer bg-white px-3 py-2.5 rounded-lg border border-indigo-200">
                    <input type="checkbox" checked={sandboxAssinatura} onChange={e => setSandboxAssinatura(e.target.checked)} />
                    <span className={sandboxAssinatura ? 'text-amber-600' : 'text-red-600'}>{sandboxAssinatura ? '🧪 Modo Teste' : '⚠ Modo Real'}</span>
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={enviarAssinaturaTodos} disabled={enviandoAssinatura !== null} className="bg-indigo-600 text-white font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl shadow-md hover:bg-indigo-700 transition-all disabled:opacity-50">
                    {enviandoAssinatura === 'LOTE' ? '⏳ Enviando...' : '📤 Enviar Todos p/ Assinatura'}
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  <button onClick={() => router.push('/admin/rh/assinaturas')} className="bg-white border-2 border-indigo-300 text-indigo-700 font-black uppercase tracking-widest text-xs px-5 py-2.5 rounded-xl hover:bg-indigo-50 transition-all">
                    📋 Acompanhar
                  </button>
                </div>
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
                <div key={item.func.nome_completo} className="w-full max-w-5xl print:hidden">
                  <div className="bg-white border-2 border-dashed border-indigo-200 rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-center gap-3 mb-6">
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
      </div>
    </div>
  );
}