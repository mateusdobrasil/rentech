//app\admin\rh\holerite\page.tsx

"use client";
 
import { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { fecharFolhaLoteAction, reabrirFolhaAction, salvarBonusDescontosAction, salvarDadosSalariaisAction } from '../actions/actions-folha';
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
// INPUT COM MÁSCARA DE MOEDA (R$) — digita os centavos da direita pra esquerda
// ============================================================================
function InputMoeda({ value, onChange, className, disabled, placeholder }: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitos = e.target.value.replace(/\D/g, '');
    const centavos = digitos ? parseInt(digitos, 10) : 0;
    onChange(centavos / 100);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={formatCurrency(value)}
      onChange={handleChange}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
    />
  );
}

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

interface RegistroDiaPonto {
  trabalhados: number; abonados: number;
  entrada_1: string | null; saida_1: string | null; entrada_2: string | null; saida_2: string | null;
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
// VALIDAÇÃO DAS BATIDAS DE PONTO — usada antes de fechar a folha do mês
// Um dia só é considerado OK se tiver: nenhuma batida (dia sem registro, a
// falta é tratada à parte), ENTRADA+SAÍDA, ou ENTRADA+SAÍDA ALMOÇO+RETORNO
// ALMOÇO+SAÍDA. Qualquer combinação parcial (ex: só entrada, ou só a volta
// do almoço sem saída) é uma batida incompleta e bloqueia o fechamento.
// ============================================================================
const diaComBatidasOk = (r?: RegistroDiaPonto): boolean => {
  if (!r) return true;
  const { entrada_1: e1, saida_1: s1, entrada_2: e2, saida_2: s2 } = r;
  if (!e1 && !s1 && !e2 && !s2) return true;
  if (e1 && s1 && !e2 && !s2) return true;
  if (e1 && s1 && e2 && s2) return true;
  return false;
};

const encontrarBatidasIncompletas = (
  dias: Record<string, RegistroDiaPonto>,
  mesAno: string,
  dataAdmissao?: string | null,
  dataDesligamento?: string | null
): string[] => {
  const [ano, mes] = mesAno.split('-').map(Number);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
  const problemas: string[] = [];

  for (let d = 1; d <= diasNoMes; d++) {
    const data = new Date(ano, mes - 1, d);
    if (data > hoje) break;
    const dataIso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (dataAdmissao && dataIso < dataAdmissao) continue;
    if (dataDesligamento && dataIso > dataDesligamento) continue;

    if (!diaComBatidasOk(dias[dataIso])) {
      problemas.push(dataIso.split('-').reverse().join('/'));
    }
  }
  return problemas;
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

const extrairDadosSalariais = (f: FuncionarioFin | null) => f ? {
  salario_folha: f.salario_folha, salario_contrato: f.salario_contrato,
  valor_refeicao: f.valor_refeicao, valor_transporte: f.valor_transporte,
  valor_adiantamento: f.valor_adiantamento
} : null;

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
  const [activeTab, setActiveTab] = useState<'BONUS_DESCONTOS' | 'HOLERITES'>('HOLERITES');

  const [listaFuncionarios, setListaFuncionarios] = useState<FuncionarioFin[]>([]);
  const [buscaGrid, setBuscaGrid] = useState('');
  const [filtroContrato, setFiltroContrato] = useState('TODOS');

  const [lote, setLote] = useState<ItemLote[]>([]);
  const [enviandoAssinatura, setEnviandoAssinatura] = useState<string | null>(null);
  const [gerandoPrevia, setGerandoPrevia] = useState<string | null>(null);
  const [sandboxAssinatura, setSandboxAssinatura] = useState(true);

  const [fechamentoSelecionado, setFechamentoSelecionado] = useState<Fechamento | null>(null);
  const [apuracaoSelecionado, setApuracaoSelecionado] = useState({ mins60: 0, mins100: 0, diasFds: 0, faltas: 0, qtdVr: 0, qtdVt: 0 });
  const [formSelecionado, setFormSelecionado] = useState<FuncionarioFin | null>(null);
  const [descontosSelecionado, setDescontosSelecionado] = useState<Desconto[]>([]);
  const [bonusSelecionado, setBonusSelecionado] = useState<Bonus[]>([]);
  const [snapshotBonusDesc, setSnapshotBonusDesc] = useState('');
  const [mostrarQuitados, setMostrarQuitados] = useState(false);
  const [mostrarBonusEncerrados, setMostrarBonusEncerrados] = useState(false);

  const fichaAtualSerializada = useMemo(
    () => JSON.stringify({ descontosSelecionado, bonusSelecionado, dadosSalariais: extrairDadosSalariais(formSelecionado) }),
    [descontosSelecionado, bonusSelecionado, formSelecionado]
  );
  const temAlteracoesNaoSalvas = snapshotBonusDesc !== '' && fichaAtualSerializada !== snapshotBonusDesc;

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
      carregarListaFuncionarios();
    }
    checkAuth();
  }, [router, pathname]);

  useEffect(() => {
    if (!authLoading) carregarLote(mesReferencia);
  }, [mesReferencia, authLoading]);

  const carregarListaFuncionarios = async () => {
    const { data } = await supabase.from('folha_funcionarios').select('*').order('nome_completo');
    if (data) setListaFuncionarios(data);
  };

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
      .select('funcionario_nome, data_registro, minutos_trabalhados, entrada_1, saida_1, entrada_2, saida_2')
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

    const porFuncionario: Record<string, Record<string, RegistroDiaPonto>> = {};
    (pontoData || []).forEach(p => {
      if (!porFuncionario[p.funcionario_nome]) porFuncionario[p.funcionario_nome] = {};
      if (!porFuncionario[p.funcionario_nome][p.data_registro]) porFuncionario[p.funcionario_nome][p.data_registro] = { trabalhados: 0, abonados: 0, entrada_1: null, saida_1: null, entrada_2: null, saida_2: null };
      porFuncionario[p.funcionario_nome][p.data_registro].trabalhados = p.minutos_trabalhados;
      porFuncionario[p.funcionario_nome][p.data_registro].entrada_1 = p.entrada_1;
      porFuncionario[p.funcionario_nome][p.data_registro].saida_1 = p.saida_1;
      porFuncionario[p.funcionario_nome][p.data_registro].entrada_2 = p.entrada_2;
      porFuncionario[p.funcionario_nome][p.data_registro].saida_2 = p.saida_2;
    });
    (abonoData || []).forEach(a => {
      if (!porFuncionario[a.funcionario_nome]) porFuncionario[a.funcionario_nome] = {};
      if (!porFuncionario[a.funcionario_nome][a.data_abono]) porFuncionario[a.funcionario_nome][a.data_abono] = { trabalhados: 0, abonados: 0, entrada_1: null, saida_1: null, entrada_2: null, saida_2: null };
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
    const descontosCarregados = descData ? descData.map(d => ({ ...d, tipo: d.tipo || 'PARCELADO' })) : [];
    setDescontosSelecionado(descontosCarregados);

    const { data: bonusData } = await supabase.from('folha_bonus').select('*').eq('funcionario_nome', nome);
    const bonusCarregados = bonusData || [];
    setBonusSelecionado(bonusCarregados);

    setSnapshotBonusDesc(JSON.stringify({ descontosSelecionado: descontosCarregados, bonusSelecionado: bonusCarregados, dadosSalariais: extrairDadosSalariais(funcData) }));

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

  const salvarBonusDescontos = async (): Promise<boolean> => {
    if (!funcionarioSelecionado || !formSelecionado) return false;
    setLoading(true);
    try {
      const res = await salvarBonusDescontosAction({
        funcionarioNome: funcionarioSelecionado,
        descontos: descontosSelecionado,
        bonus: bonusSelecionado,
        usuarioNome: usuarioAtual
      });
      if (!res.ok) throw new Error(res.erro);

      const resSalarial = await salvarDadosSalariaisAction({
        funcionarioNome: funcionarioSelecionado,
        salario_folha: formSelecionado.salario_folha,
        salario_contrato: formSelecionado.salario_contrato,
        valor_refeicao: formSelecionado.valor_refeicao,
        valor_transporte: formSelecionado.valor_transporte,
        valor_adiantamento: formSelecionado.valor_adiantamento,
        usuarioNome: usuarioAtual
      });
      if (!resSalarial.ok) throw new Error(resSalarial.erro);

      alert("Bônus, descontos e dados salariais guardados com sucesso!");
      setSnapshotBonusDesc(JSON.stringify({ descontosSelecionado, bonusSelecionado, dadosSalariais: extrairDadosSalariais(formSelecionado) }));
      carregarListaFuncionarios();
      carregarLote(mesReferencia);
      return true;
    } catch (e: any) { alert("Erro ao salvar: " + e.message); return false; }
    finally { setLoading(false); }
  };

  const trocarFuncionario = async (nome: string) => {
    if (nome === funcionarioSelecionado) return;

    if (temAlteracoesNaoSalvas) {
      const salvar = confirm(
        `Os bônus/descontos de ${formSelecionado?.nome_completo || 'este colaborador'} têm alterações não salvas.\n\n` +
        `OK = Salvar antes de trocar\nCancelar = Descartar as alterações`
      );
      if (salvar) {
        const ok = await salvarBonusDescontos();
        if (!ok) return;
      }
    }

    setFuncionarioSelecionado(nome);
  };

  const addDesconto = () => setDescontosSelecionado([...descontosSelecionado, { descricao: '', tipo: 'PARCELADO', parcelas: 1, mes_inicio: mesReferencia, mes_fim: mesReferencia, valor_parcela: 0 }]);
  const addBonus = () => setBonusSelecionado([...bonusSelecionado, { descricao: '', recorrencia: 'UNICO', mes_referencia: mesReferencia, valor: 0 }]);
  const removeDesconto = (idx: number) => setDescontosSelecionado(descontosSelecionado.filter((_, i) => i !== idx));
  const removeBonus = (idx: number) => setBonusSelecionado(bonusSelecionado.filter((_, i) => i !== idx));

  const handleDescontoChange = <K extends keyof Desconto>(idx: number, campo: K, valor: Desconto[K]) => {
    const novosDescontos = [...descontosSelecionado];
    novosDescontos[idx] = { ...novosDescontos[idx], [campo]: valor };
    if (campo === 'tipo') {
      novosDescontos[idx].mes_fim = valor === 'FIXO' ? '2099-12' : calcularMesFim(novosDescontos[idx].mes_inicio, novosDescontos[idx].parcelas);
    } else if (campo === 'mes_inicio' || campo === 'parcelas') {
      if (novosDescontos[idx].tipo === 'PARCELADO') {
        novosDescontos[idx].mes_fim = calcularMesFim(novosDescontos[idx].mes_inicio, novosDescontos[idx].parcelas || 1);
      }
    }
    setDescontosSelecionado(novosDescontos);
  };

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
        if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
        return a.nome_completo.localeCompare(b.nome_completo);
      }),
    [listaFuncionarios, buscaGrid, filtroContrato]);

  const descontosComIndice = useMemo(() => descontosSelecionado.map((d, idx) => {
    let quitado = false;
    if (d.tipo === 'PARCELADO' && d.mes_inicio && d.parcelas > 0) {
      const fimReal = calcularMesFim(d.mes_inicio, d.parcelas);
      quitado = mesReferencia > fimReal;
    }
    return { d, idx, quitado };
  }), [descontosSelecionado, mesReferencia]);
  const qtdQuitados = useMemo(() => descontosComIndice.filter(x => x.quitado).length, [descontosComIndice]);

  const bonusComIndice = useMemo(() => bonusSelecionado.map((b, idx) => ({
    b, idx,
    encerrado: b.recorrencia === 'UNICO' && !!b.mes_referencia && mesReferencia > b.mes_referencia
  })), [bonusSelecionado, mesReferencia]);
  const qtdBonusEncerrados = useMemo(() => bonusComIndice.filter(x => x.encerrado).length, [bonusComIndice]);

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

    setLoadingLote(true);
    try {
      // Antes de fechar, revalida as batidas de ponto ao vivo (podem ter
      // mudado desde que o lote foi carregado). Cada dia trabalhado precisa
      // ter ENTRADA+SAÍDA ou ENTRADA+SAÍDA ALMOÇO+RETORNO ALMOÇO+SAÍDA.
      const { porFuncionario } = await buscarPontoDoMes(mesReferencia);
      const relatorioProblemas = abertos
        .map(item => ({
          nome: item.func.nome_completo,
          dias: encontrarBatidasIncompletas(
            porFuncionario[item.func.nome_completo] || {},
            mesReferencia, item.func.data_admissao, item.func.data_desligamento
          )
        }))
        .filter(r => r.dias.length > 0);

      if (relatorioProblemas.length > 0) {
        alert(
          `Não é possível fechar a folha: há batidas de ponto incompletas.\n\n` +
          `Cada dia trabalhado precisa ter ENTRADA e SAÍDA, ou ENTRADA, SAÍDA ALMOÇO, RETORNO ALMOÇO e SAÍDA.\n\n` +
          relatorioProblemas.map(r => `• ${r.nome}: ${r.dias.join(', ')}`).join('\n') +
          `\n\nCorrija essas batidas na tela de Ponto e tente fechar a folha novamente.`
        );
        return;
      }
    } catch (e: any) {
      alert('Erro ao validar as batidas de ponto: ' + e.message);
      return;
    } finally {
      setLoadingLote(false);
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

      <div className="p-4 md:px-8 pt-6 print:hidden">
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row items-center gap-2 max-w-[1500px] mx-auto w-full">
          <div className="flex bg-[#F1F5F9] p-1 rounded-xl border border-[#E2E8F0] w-full sm:w-auto">
            <button
              onClick={() => setActiveTab('BONUS_DESCONTOS')}
              className={`flex-1 sm:flex-initial px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-colors shadow-sm ${activeTab === 'BONUS_DESCONTOS' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:text-[#0C1D4D]'}`}
            >
              💵 Bônus e Descontos
            </button>
            <button
              onClick={() => setActiveTab('HOLERITES')}
              className={`flex-1 sm:flex-initial px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-colors shadow-sm ${activeTab === 'HOLERITES' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:text-[#0C1D4D]'}`}
            >
              📄 Holerites
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'BONUS_DESCONTOS' && (
        <div className="p-4 md:px-8 pb-10 flex-grow flex flex-col lg:flex-row gap-6 max-w-[1500px] mx-auto w-full print:hidden">

          {/* LISTAGEM LATERAL */}
          <aside className="w-full lg:w-80 flex-shrink-0 space-y-4">
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
            {!funcionarioSelecionado || !formSelecionado ? (
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl h-full flex items-center justify-center text-gray-400 font-bold uppercase tracking-wider p-20">
                Selecione um colaborador no menu lateral
              </div>
            ) : (
              <div className="flex flex-col gap-4 pb-20">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4">
                  <div>
                    <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider">{formSelecionado.nome_completo}</h3>
                    <span className="text-[10px] text-gray-400 font-bold uppercase">{formSelecionado.cargo || 'sem cargo'} • {formSelecionado.tipo_contrato}</span>
                  </div>
                  <button onClick={salvarBonusDescontos} disabled={loading} className={`font-black uppercase tracking-widest text-xs px-6 py-2.5 rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-50 ${temAlteracoesNaoSalvas ? 'bg-[#16A34A] hover:bg-[#15803D] text-white animate-pulse' : 'bg-[#0C1D4D] hover:bg-[#284B8C] text-white'}`}>
                    {loading ? '⏳ Gravando...' : '💾 Gravar'}
                  </button>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#E2E8F0]">
                  <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider border-b border-[#E2E8F0] pb-2 mb-4">Dados Salariais</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Salário Folha</label><InputMoeda value={formSelecionado.salario_folha} onChange={v => setFormSelecionado({...formSelecionado, salario_folha: v})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-[#0C1D4D]" /></div>
                    <div><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Salário Contrato Total</label><InputMoeda value={formSelecionado.salario_contrato} onChange={v => setFormSelecionado({...formSelecionado, salario_contrato: v})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-[#16A34A]" /></div>

                    {regraAtiva && (regraAtiva.direito_vr || regraAtiva.direito_vt) ? (
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
                              <InputMoeda value={formSelecionado.valor_refeicao} onChange={v => setFormSelecionado({...formSelecionado, valor_refeicao: v})} className="w-full p-2 border border-blue-200 rounded text-sm" />
                              {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' && formSelecionado.valor_refeicao > 0 && (
                                <p className="text-[9px] font-bold text-blue-600 mt-0.5 uppercase">Diária: {formatCurrency(formSelecionado.valor_refeicao / 30)}</p>
                              )}
                            </div>
                          )}
                          {regraAtiva.direito_vt && (
                            <div>
                              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                                {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' ? 'VT — Valor do Mês' : 'VT — Diária'}
                              </label>
                              <InputMoeda value={formSelecionado.valor_transporte} onChange={v => setFormSelecionado({...formSelecionado, valor_transporte: v})} className="w-full p-2 border border-blue-200 rounded text-sm" />
                              {regraAtiva.modalidade_beneficio === 'VALOR_FECHADO' && formSelecionado.valor_transporte > 0 && (
                                <p className="text-[9px] font-bold text-blue-600 mt-0.5 uppercase">Diária: {formatCurrency(formSelecionado.valor_transporte / 30)}</p>
                              )}
                            </div>
                          )}
                        </div>
                        <p className="text-[9px] text-blue-500 font-medium mt-2 uppercase">Os valores são gerados por dia trabalhado conforme a jornada. Configure o direito e a modalidade no Motor de Regras.</p>
                      </div>
                    ) : (
                      <div className="col-span-2 bg-gray-50 p-3 rounded-lg border border-gray-200 text-[10px] font-bold text-gray-400 uppercase text-center">
                        Este contrato ({formSelecionado.tipo_contrato}) não dá direito a VR/VT. Ajuste no Motor de Regras se necessário.
                      </div>
                    )}
                    <div className="col-span-2"><label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Adiantamento (Dia 20)</label><InputMoeda value={formSelecionado.valor_adiantamento} onChange={v => setFormSelecionado({...formSelecionado, valor_adiantamento: v})} className="w-full p-2 border border-gray-300 rounded text-sm font-bold text-red-600" /></div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
                            <input type="text" placeholder="Descrição" value={b.descricao} disabled={encerrado} onChange={e => { const n = [...bonusSelecionado]; n[idx].descricao = e.target.value; setBonusSelecionado(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs uppercase disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />
                            {encerrado && <span className="text-[9px] bg-gray-300 text-gray-600 px-2 py-0.5 rounded font-black uppercase whitespace-nowrap">🔒 Pago</span>}
                          </div>
                          <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Valor R$</label><InputMoeda value={b.valor} disabled={encerrado} onChange={v => { const n = [...bonusSelecionado]; n[idx].valor = v; setBonusSelecionado(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs text-[#16A34A] font-bold disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
                          <div><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Recorrência</label><select value={b.recorrencia} disabled={encerrado} onChange={e => { const n = [...bonusSelecionado]; n[idx].recorrencia = e.target.value as 'MENSAL'|'UNICO'; setBonusSelecionado(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs bg-white disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"><option value="UNICO">Única Vez</option><option value="MENSAL">Fixo (Mensal)</option></select></div>
                          {b.recorrencia === 'UNICO' && <div className="col-span-2"><label className="text-[9px] font-bold uppercase text-gray-500 block mb-0.5">Competência do Bônus</label><input type="month" value={b.mes_referencia} disabled={encerrado} onChange={e => { const n = [...bonusSelecionado]; n[idx].mes_referencia = e.target.value; setBonusSelecionado(n); }} className="w-full p-1.5 border border-gray-200 rounded text-xs disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" />{b.mes_referencia && <p className="text-[9px] font-bold text-emerald-600 mt-0.5 uppercase">💵 Sai no pagamento de {competenciaParaPagamento(b.mes_referencia)}</p>}</div>}
                        </div>
                      ))}

                      {bonusSelecionado.length === 0 && (
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
                          <div><InputMoeda placeholder="Valor R$" value={d.valor_parcela} disabled={quitado} onChange={v => handleDescontoChange(idx, 'valor_parcela', v)} className="w-full p-1.5 border border-gray-200 rounded text-xs text-red-600 font-bold disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed" /></div>
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

                      {descontosSelecionado.length === 0 && (
                        <p className="text-[11px] text-gray-400 font-medium text-center py-2 uppercase">Nenhum desconto lançado</p>
                      )}
                      {descontosSelecionado.length > 0 && qtdQuitados === descontosSelecionado.length && !mostrarQuitados && (
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
            )}
          </main>
        </div>
      )}

      {activeTab === 'HOLERITES' && (
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
      )}
    </div>
  );
}