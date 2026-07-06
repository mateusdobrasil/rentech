"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";

// ============================================================================
// UTILITÁRIOS (mesmas fórmulas do holerite, para os números baterem)
// ============================================================================
const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
const formatTimeStr = (totalMins: number) => {
  const neg = totalMins < 0; const abs = Math.abs(totalMins);
  return `${neg ? '-' : ''}${Math.floor(abs / 60).toString().padStart(2, '0')}:${(abs % 60).toString().padStart(2, '0')}`;
};
const formatarMesAnoBR = (mesAnoIso: string) => {
  if (!mesAnoIso) return '';
  const [ano, mes] = mesAnoIso.split('-');
  return `${mes}/${ano}`;
};
const getDiaSemana = (dataIso: string) => {
  const p = dataIso.split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getDay();
};

// ============================================================================
// INTERFACES
// ============================================================================
interface RegraContrato {
  nome_regra: string; paga_salario_base: boolean; calcula_extras_padrao: boolean;
  percentual_extra_semana: number; percentual_extra_sabado: number;
  tipo_pagamento_fds: 'HORA_PERCENTUAL' | 'VALOR_DIARIA';
  percentual_extra_dom_fer: number; valor_diaria_fds: number; desconta_faltas: boolean;
}
interface FuncionarioFin {
  nome_completo: string; cargo: string; tipo_contrato: string; ativo: boolean;
  recebe_transporte: boolean; valor_transporte: number;
  recebe_refeicao: boolean; valor_refeicao: number;
  salario_folha: number; salario_contrato: number; valor_diaria: number; valor_adiantamento: number;
}
interface Desconto { funcionario_nome?: string; descricao: string; tipo: 'FIXO' | 'PARCELADO'; parcelas: number; mes_inicio: string; mes_fim: string; valor_parcela: number; }
interface Bonus { funcionario_nome?: string; descricao: string; recorrencia: 'MENSAL' | 'UNICO'; mes_referencia: string; valor: number; }

interface LinhaRelatorio {
  nome: string; cargo: string; tipoContrato: string;
  minsTrabalhados: number; minsExtras60: number; minsExtras100: number;
  faltas: number; totalCreditos: number; totalDebitos: number; liquido: number;
  fechado: boolean;
}

const REGRA_PADRAO: RegraContrato = {
  nome_regra: 'PADRÃO', paga_salario_base: true, calcula_extras_padrao: true,
  percentual_extra_semana: 60, percentual_extra_sabado: 60, tipo_pagamento_fds: 'HORA_PERCENTUAL',
  percentual_extra_dom_fer: 100, valor_diaria_fds: 0, desconta_faltas: true
};

// ============================================================================
// APURAÇÃO DO PONTO — idêntica ao holerite
// ============================================================================
const apurarPonto = (
  dias: Record<string, { trabalhados: number; abonados: number }>,
  feriados: string[], mesAno: string,
  dataAdmissao?: string | null, dataDesligamento?: string | null
) => {
  let mins60 = 0, mins100 = 0, diasFds = 0, minsTrabalhadosTotal = 0;

  Object.entries(dias).forEach(([dataIso, v]) => {
    const diaSemana = getDiaSemana(dataIso);
    const isFeriado = feriados.includes(dataIso);
    const abonEfetivo = (isFeriado || diaSemana === 0 || diaSemana === 6) ? 0 : v.abonados;
    minsTrabalhadosTotal += v.trabalhados + abonEfetivo;

    if (isFeriado || diaSemana === 0) {
      if (v.trabalhados > 0) { mins100 += v.trabalhados; diasFds++; }
    } else if (diaSemana === 6) {
      if (v.trabalhados > 0) { mins60 += v.trabalhados; diasFds++; }
    } else {
      const extraDia = (v.trabalhados + v.abonados) - 480;
      if (extraDia > 0) mins60 += extraDia;
    }
  });

  let faltas = 0;
  const temRegistro = Object.values(dias).some(v => v.trabalhados > 0 || v.abonados > 0);
  if (temRegistro) {
    const [ano, mes] = mesAno.split('-').map(Number);
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);
    for (let d = 1; d <= diasNoMes; d++) {
      const data = new Date(ano, mes - 1, d);
      if (data > hoje) break;
      const dataIso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dataAdmissao && dataIso < dataAdmissao) continue;
      if (dataDesligamento && dataIso > dataDesligamento) continue;
      const ds = data.getDay();
      if (ds === 0 || ds === 6 || feriados.includes(dataIso)) continue;
      const reg = dias[dataIso];
      if (!(reg && (reg.trabalhados > 0 || reg.abonados > 0))) faltas++;
    }
  }

  return { mins60, mins100, diasFds, faltas, minsTrabalhadosTotal };
};

// ============================================================================
// MOTOR DE CÁLCULO — idêntico ao holerite
// ============================================================================
const calcularFinanceiro = (
  func: FuncionarioFin, regras: Record<string, RegraContrato>,
  descontosFunc: Desconto[], bonusFunc: Bonus[],
  ap: { mins60: number; mins100: number; diasFds: number; faltas: number }, mesRef: string
) => {
  const regra = regras[func.tipo_contrato] || { ...REGRA_PADRAO, nome_regra: func.tipo_contrato || 'PADRÃO' };
  const salarioBaseCalculo = func.salario_folha > 0 ? func.salario_folha : func.salario_contrato;
  const valorHoraBase = salarioBaseCalculo / 220;

  let totalExtra60 = 0, totalExtra100 = 0, totalDiarias = 0;
  if (regra.calcula_extras_padrao) {
    if (regra.tipo_pagamento_fds === 'HORA_PERCENTUAL') {
      totalExtra60 = (ap.mins60 / 60) * valorHoraBase * (1 + regra.percentual_extra_semana / 100);
      totalExtra100 = (ap.mins100 / 60) * valorHoraBase * (1 + regra.percentual_extra_dom_fer / 100);
    } else {
      totalDiarias = ap.diasFds * regra.valor_diaria_fds;
    }
  }

  const salarioBaseExibido = regra.paga_salario_base ? func.salario_folha : 0;
  const complemento = regra.paga_salario_base ? Math.max(0, func.salario_contrato - func.salario_folha) : 0;

  const descAtivos = descontosFunc.filter(d => d.tipo === 'FIXO' ? mesRef >= d.mes_inicio : (mesRef >= d.mes_inicio && mesRef <= d.mes_fim));
  const bonusAtivos = bonusFunc.filter(b => b.recorrencia === 'MENSAL' || b.mes_referencia === mesRef);
  const totalBonus = bonusAtivos.reduce((s, b) => s + b.valor, 0);
  const totalDesc = descAtivos.reduce((s, d) => s + d.valor_parcela, 0);
  const totalAdicionais = (func.recebe_transporte ? func.valor_transporte : 0) + (func.recebe_refeicao ? func.valor_refeicao : 0);

  const baseFaltas = func.salario_contrato > 0 ? func.salario_contrato : func.salario_folha;
  const diasFaltas = regra.desconta_faltas ? ap.faltas : 0;
  const valorDescontoFaltas = diasFaltas > 0 ? (baseFaltas / 30) * diasFaltas : 0;

  const totalCreditos = salarioBaseExibido + complemento + totalBonus + totalExtra60 + totalExtra100 + totalDiarias + totalAdicionais;
  const totalDebitos = func.valor_adiantamento + totalDesc + valorDescontoFaltas;
  const liquido = totalCreditos - totalDebitos;

  return { totalCreditos, totalDebitos, liquido };
};

// ============================================================================
// CARTÃO DE INDICADOR
// ============================================================================
const CardKPI = ({ titulo, valor, cor, sub }: { titulo: string; valor: string; cor: string; sub?: string }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{titulo}</p>
    <p className="text-2xl font-black" style={{ color: cor }}>{valor}</p>
    {sub && <p className="text-[11px] font-bold text-gray-500 mt-1">{sub}</p>}
  </div>
);

// ============================================================================
// GRÁFICO DE BARRAS HORIZONTAIS (SVG puro, sem dependências)
// ============================================================================
const BarrasHorizontais = ({ dados, cor, formato }: {
  dados: { label: string; valor: number }[]; cor: string; formato: (n: number) => string;
}) => {
  const max = Math.max(...dados.map(d => d.valor), 1);
  const alturaLinha = 26;
  const altura = dados.length * alturaLinha + 10;
  const larguraLabel = 150;
  const larguraBarra = 420;

  return (
    <svg viewBox={`0 0 ${larguraLabel + larguraBarra + 90} ${altura}`} className="w-full" style={{ maxHeight: `${altura}px` }}>
      {dados.map((d, i) => {
        const y = i * alturaLinha + 5;
        const w = (d.valor / max) * larguraBarra;
        return (
          <g key={i}>
            <text x={larguraLabel - 8} y={y + 15} textAnchor="end" fontSize="11" fontWeight="700" fill="#334155">
              {d.label.length > 20 ? d.label.slice(0, 19) + '…' : d.label}
            </text>
            <rect x={larguraLabel} y={y + 4} width={larguraBarra} height={16} rx="3" fill="#F1F5F9" />
            <rect x={larguraLabel} y={y + 4} width={Math.max(w, d.valor > 0 ? 2 : 0)} height={16} rx="3" fill={cor} />
            <text x={larguraLabel + Math.max(w, 2) + 6} y={y + 16} fontSize="10" fontWeight="700" fill="#64748B">
              {formato(d.valor)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

// ============================================================================
// GRÁFICO CRÉDITO x DÉBITO (barras agrupadas por funcionário)
// ============================================================================
const BarrasCreditoDebito = ({ dados }: { dados: LinhaRelatorio[] }) => {
  const max = Math.max(...dados.map(d => Math.max(d.totalCreditos, d.totalDebitos)), 1);
  const alturaLinha = 40;
  const altura = dados.length * alturaLinha + 10;
  const larguraLabel = 150;
  const larguraBarra = 420;

  return (
    <svg viewBox={`0 0 ${larguraLabel + larguraBarra + 100} ${altura}`} className="w-full" style={{ maxHeight: `${altura}px` }}>
      {dados.map((d, i) => {
        const y = i * alturaLinha + 5;
        const wC = (d.totalCreditos / max) * larguraBarra;
        const wD = (d.totalDebitos / max) * larguraBarra;
        return (
          <g key={i}>
            <text x={larguraLabel - 8} y={y + 20} textAnchor="end" fontSize="11" fontWeight="700" fill="#334155">
              {d.nome.length > 20 ? d.nome.slice(0, 19) + '…' : d.nome}
            </text>
            <rect x={larguraLabel} y={y + 2} width={Math.max(wC, 2)} height={13} rx="3" fill="#16A34A" />
            <text x={larguraLabel + Math.max(wC, 2) + 5} y={y + 12} fontSize="9" fontWeight="700" fill="#16A34A">{formatCurrency(d.totalCreditos)}</text>
            <rect x={larguraLabel} y={y + 18} width={Math.max(wD, 2)} height={13} rx="3" fill="#DC2626" />
            <text x={larguraLabel + Math.max(wD, 2) + 5} y={y + 28} fontSize="9" fontWeight="700" fill="#DC2626">{formatCurrency(d.totalDebitos)}</text>
          </g>
        );
      })}
    </svg>
  );
};

export default function RelatoriosRH() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [linhas, setLinhas] = useState<LinhaRelatorio[]>([]);
  const [ordenacao, setOrdenacao] = useState<'nome' | 'liquido' | 'extras' | 'faltas'>('nome');
  const [modoFinanceiro, setModoFinanceiro] = useState(false);

  const [mesReferencia, setMesReferencia] = useState(() => {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { carregarRelatorio(mesReferencia); }, [mesReferencia]);

  const carregarRelatorio = async (mesAno: string) => {
    setLoading(true);
    try {
      const [ano, mes] = mesAno.split('-');
      const dataInicio = `${ano}-${mes}-01`;
      const dataFim = `${ano}-${mes}-${new Date(Number(ano), Number(mes), 0).getDate()}`;

      const [
        { data: funcs }, { data: regrasData }, { data: descs }, { data: bons },
        { data: fechs }, { data: pontoData }, { data: abonoData }, { data: fData }
      ] = await Promise.all([
        supabase.from('folha_funcionarios').select('*').eq('ativo', true).order('nome_completo'),
        supabase.from('folha_parametros').select('*'),
        supabase.from('folha_descontos').select('*'),
        supabase.from('folha_bonus').select('*'),
        supabase.from('folha_holerites').select('funcionario_nome, dados').eq('mes_referencia', mesAno),
        supabase.from('folha_ponto_diaria').select('funcionario_nome, data_registro, minutos_trabalhados').gte('data_registro', dataInicio).lte('data_registro', dataFim),
        supabase.from('folha_ponto_abono').select('funcionario_nome, data_abono, minutos_abonados').gte('data_abono', dataInicio).lte('data_abono', dataFim),
        supabase.from('folha_feriados').select('data_feriado')
      ]);

      // Mapa de regras
      const regras: Record<string, RegraContrato> = {};
      (regrasData || []).forEach((r) => {
        regras[r.nome_regra] = {
          nome_regra: r.nome_regra, paga_salario_base: r.paga_salario_base, calcula_extras_padrao: r.calcula_extras_padrao,
          percentual_extra_semana: r.percentual_extra_semana ?? 60, percentual_extra_sabado: r.percentual_extra_sabado ?? 60,
          tipo_pagamento_fds: r.tipo_pagamento_fds === 'HORA_100' ? 'HORA_PERCENTUAL' : (r.tipo_pagamento_fds || 'HORA_PERCENTUAL'),
          percentual_extra_dom_fer: r.percentual_extra_dom_fer ?? 100, valor_diaria_fds: r.valor_diaria_fds ?? 0, desconta_faltas: r.desconta_faltas
        };
      });

      const feriados = (fData || []).map(f => f.data_feriado);

      // Agrupa ponto + abono por funcionário/dia
      const porFunc: Record<string, Record<string, { trabalhados: number; abonados: number }>> = {};
      (pontoData || []).forEach(p => {
        (porFunc[p.funcionario_nome] ||= {});
        (porFunc[p.funcionario_nome][p.data_registro] ||= { trabalhados: 0, abonados: 0 }).trabalhados = p.minutos_trabalhados;
      });
      (abonoData || []).forEach(a => {
        (porFunc[a.funcionario_nome] ||= {});
        (porFunc[a.funcionario_nome][a.data_abono] ||= { trabalhados: 0, abonados: 0 }).abonados = a.minutos_abonados;
      });

      const descPorFunc: Record<string, Desconto[]> = {};
      (descs || []).forEach(d => { (descPorFunc[d.funcionario_nome] ||= []).push({ ...d, tipo: d.tipo || 'PARCELADO' }); });
      const bonusPorFunc: Record<string, Bonus[]> = {};
      (bons || []).forEach(b => { (bonusPorFunc[b.funcionario_nome] ||= []).push(b); });
      const fechPorFunc: Record<string, any> = {};
      (fechs || []).forEach(f => { fechPorFunc[f.funcionario_nome] = f.dados; });

      const resultado: LinhaRelatorio[] = (funcs || []).map((f: FuncionarioFin) => {
        const ap = apurarPonto(porFunc[f.nome_completo] || {}, feriados, mesAno, (f as any).data_admissao, (f as any).data_desligamento);
        const fechado = !!fechPorFunc[f.nome_completo];

        // Se a folha está fechada, usa os totais congelados; senão calcula ao vivo
        let totalCreditos: number, totalDebitos: number, liquido: number;
        if (fechado) {
          const snap = fechPorFunc[f.nome_completo];
          totalCreditos = snap.totalCreditos; totalDebitos = snap.totalDebitos; liquido = snap.valorLiquidoReceber;
        } else {
          const fin = calcularFinanceiro(f, regras, descPorFunc[f.nome_completo] || [], bonusPorFunc[f.nome_completo] || [], ap, mesAno);
          totalCreditos = fin.totalCreditos; totalDebitos = fin.totalDebitos; liquido = fin.liquido;
        }

        return {
          nome: f.nome_completo, cargo: f.cargo || '—', tipoContrato: f.tipo_contrato || '—',
          minsTrabalhados: ap.minsTrabalhadosTotal, minsExtras60: ap.mins60, minsExtras100: ap.mins100,
          faltas: ap.faltas, totalCreditos, totalDebitos, liquido, fechado
        };
      });

      setLinhas(resultado);
    } catch (e: any) {
      alert('Erro ao montar o relatório: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // TOTAIS E ORDENAÇÃO
  // ============================================================================
  const totais = useMemo(() => linhas.reduce((acc, l) => ({
    creditos: acc.creditos + l.totalCreditos,
    debitos: acc.debitos + l.totalDebitos,
    liquido: acc.liquido + l.liquido,
    minsTrab: acc.minsTrab + l.minsTrabalhados,
    minsExtra: acc.minsExtra + l.minsExtras60 + l.minsExtras100,
    faltas: acc.faltas + l.faltas,
    fechados: acc.fechados + (l.fechado ? 1 : 0)
  }), { creditos: 0, debitos: 0, liquido: 0, minsTrab: 0, minsExtra: 0, faltas: 0, fechados: 0 }), [linhas]);

  const linhasOrdenadas = useMemo(() => {
    const arr = [...linhas];
    switch (ordenacao) {
      case 'liquido': return arr.sort((a, b) => b.liquido - a.liquido);
      case 'extras': return arr.sort((a, b) => (b.minsExtras60 + b.minsExtras100) - (a.minsExtras60 + a.minsExtras100));
      case 'faltas': return arr.sort((a, b) => b.faltas - a.faltas);
      default: return arr.sort((a, b) => a.nome.localeCompare(b.nome));
    }
  }, [linhas, ordenacao]);

  // Top 8 para os gráficos (senão fica ilegível com equipe grande)
  const topExtras = useMemo(() => [...linhas]
    .map(l => ({ label: l.nome, valor: l.minsExtras60 + l.minsExtras100 }))
    .filter(d => d.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 8), [linhas]);
  const topLiquido = useMemo(() => [...linhas]
    .sort((a, b) => b.liquido - a.liquido).slice(0, 8), [linhas]);
  const comFaltas = useMemo(() => linhas.filter(l => l.faltas > 0).length, [linhas]);

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .no-print { display: none !important; }
          .print-break { page-break-inside: avoid; }
        }
      `}</style>

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex justify-between items-center shadow-sm no-print">
        <p className="text-[#0369A1] font-medium text-sm">
          📊 <strong>Relatório Geral da Folha</strong>. Consolidado de créditos, débitos, horas e faltas do mês.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 flex-grow max-w-[1500px] mx-auto w-full">

        {/* BARRA DE CONTROLES */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 no-print">
          <div>
            <h1 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Relatório da Folha — {formatarMesAnoBR(mesReferencia)}</h1>
            <p className="text-sm text-[#64748B]">{linhas.length} funcionário(s) ativo(s) • {totais.fechados} folha(s) fechada(s)</p>
          </div>
          <div className="flex items-center gap-3">
            <input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)} className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <button onClick={() => setModoFinanceiro(true)} disabled={linhas.length === 0} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#15803D] transition-all disabled:opacity-50">
              💵 Relatório Financeiro
            </button>
            <button onClick={() => window.print()} disabled={linhas.length === 0} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#284B8C] transition-all disabled:opacity-50">
              🖨️ Imprimir / PDF
            </button>
          </div>
        </div>

        {/* Cabeçalho de impressão */}
        <div className="hidden print:block mb-4 border-b-2 border-black pb-2">
          <h1 className="text-xl font-black uppercase">{modoFinanceiro ? 'Relatório Financeiro' : 'Relatório da Folha'} — {formatarMesAnoBR(mesReferencia)}</h1>
          <p className="text-sm">Emitido em {new Date().toLocaleDateString('pt-BR')} • {linhas.length} funcionário(s)</p>
        </div>

        {/* ==================== RELATÓRIO FINANCEIRO ==================== */}
        {modoFinanceiro && !loading && linhas.length > 0 && (
          <div>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 no-print">
              <div>
                <h2 className="text-lg font-black text-[#16A34A] uppercase tracking-wider">💵 Relatório Financeiro — {formatarMesAnoBR(mesReferencia)}</h2>
                <p className="text-sm text-[#64748B]">Grid de pagamento: créditos, débitos e valor a receber por funcionário.</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setModoFinanceiro(false)} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors flex items-center gap-2">⬅ Relatório Completo</button>
                <button onClick={() => window.print()} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#15803D] transition-all">
                  🖨️ Imprimir Grid Financeiro
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden print:border-none print:shadow-none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-[#F8FAFC] print:bg-transparent border-b-2 border-black">
                    <tr className="text-[10px] uppercase font-black tracking-widest text-[#0C1D4D] print:text-black">
                      <th className="p-3 w-10 text-center">#</th>
                      <th className="p-3">Colaborador</th>
                      <th className="p-3">Cargo</th>
                      <th className="p-3 text-right text-green-700 print:text-black">Créditos</th>
                      <th className="p-3 text-right text-red-600 print:text-black">Débitos</th>
                      <th className="p-3 text-right">Valor a Receber</th>
                      <th className="p-3 text-center w-32 print:table-cell">Assinatura</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {[...linhas].sort((a, b) => a.nome.localeCompare(b.nome)).map((l, i) => (
                      <tr key={i} className="hover:bg-[#F8FAFC] print:hover:bg-transparent">
                        <td className="p-3 text-center text-gray-400 font-bold">{i + 1}</td>
                        <td className="p-3 font-black text-[#0C1D4D] print:text-black">{l.nome}</td>
                        <td className="p-3 text-xs text-gray-500 uppercase">{l.cargo}</td>
                        <td className="p-3 text-right font-bold text-green-700 print:text-black">{formatCurrency(l.totalCreditos)}</td>
                        <td className="p-3 text-right font-bold text-red-600 print:text-black">{formatCurrency(l.totalDebitos)}</td>
                        <td className="p-3 text-right font-black text-[#0C1D4D] print:text-black text-base">{formatCurrency(l.liquido)}</td>
                        <td className="p-3 border-l border-gray-200 print:border-black"></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-black bg-[#F8FAFC] print:bg-transparent font-black text-[#0C1D4D] print:text-black">
                      <td className="p-3"></td>
                      <td className="p-3 uppercase text-xs tracking-wider" colSpan={2}>Total Geral ({linhas.length} func.)</td>
                      <td className="p-3 text-right text-green-700 print:text-black">{formatCurrency(totais.creditos)}</td>
                      <td className="p-3 text-right text-red-600 print:text-black">{formatCurrency(totais.debitos)}</td>
                      <td className="p-3 text-right text-base">{formatCurrency(totais.liquido)}</td>
                      <td className="p-3 border-l border-gray-200 print:border-black"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="mt-8 hidden print:flex justify-between text-xs px-4">
              <div className="text-center">
                <div className="border-t-2 border-black w-56 pt-1">Responsável Financeiro</div>
              </div>
              <div className="text-center">
                <div className="border-t-2 border-black w-56 pt-1">Diretoria</div>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 font-medium mt-4 no-print">
              Valores de folhas fechadas são os congelados no fechamento; folhas em aberto são calculadas ao vivo.
            </p>
          </div>
        )}

        {/* ==================== RELATÓRIO COMPLETO ==================== */}
        {!modoFinanceiro && (
        <>
        {loading ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
            Montando o relatório...
          </div>
        ) : linhas.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
            Nenhum funcionário ativo encontrado para este mês.
          </div>
        ) : (
          <>
            {/* KPIs GERAIS */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 print-break">
              <CardKPI titulo="Total de Créditos" valor={formatCurrency(totais.creditos)} cor="#16A34A" />
              <CardKPI titulo="Total de Débitos" valor={formatCurrency(totais.debitos)} cor="#DC2626" />
              <CardKPI titulo="Líquido da Folha" valor={formatCurrency(totais.liquido)} cor="#0C1D4D" sub={`${linhas.length} colaboradores`} />
              <CardKPI titulo="Custo Médio / Func." valor={formatCurrency(totais.liquido / (linhas.length || 1))} cor="#336699" />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 print-break">
              <CardKPI titulo="Horas Trabalhadas" valor={formatTimeStr(totais.minsTrab)} cor="#0C1D4D" sub="Inclui abonos em dia útil" />
              <CardKPI titulo="Horas Extras (Total)" valor={formatTimeStr(totais.minsExtra)} cor="#336699" sub="60% + 100%" />
              <CardKPI titulo="Faltas (Dias)" valor={String(totais.faltas)} cor="#DC2626" sub={`${comFaltas} func. com faltas`} />
              <CardKPI titulo="Folhas Fechadas" valor={`${totais.fechados} / ${linhas.length}`} cor="#16A34A" sub={totais.fechados === linhas.length ? 'Mês fechado' : 'Em aberto'} />
            </div>

            {/* GRÁFICOS */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
              {topExtras.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                  <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Top Horas Extras</h3>
                  <BarrasHorizontais dados={topExtras} cor="#336699" formato={formatTimeStr} />
                </div>
              )}
              <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Maiores Líquidos</h3>
                <BarrasHorizontais dados={topLiquido.map(l => ({ label: l.nome, valor: l.liquido }))} cor="#16A34A" formato={formatCurrency} />
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 mb-6 print-break">
              <div className="flex items-center gap-4 mb-4 border-b border-[#E2E8F0] pb-2">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm">Créditos x Débitos por Funcionário</h3>
                <div className="flex items-center gap-3 text-[10px] font-black uppercase">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#16A34A] inline-block"></span> Créditos</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#DC2626] inline-block"></span> Débitos</span>
                </div>
              </div>
              <BarrasCreditoDebito dados={linhasOrdenadas} />
            </div>

            {/* TABELA DETALHADA */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden print-break">
              <div className="p-5 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-col sm:flex-row justify-between items-center gap-3">
                <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm">Detalhamento por Funcionário</h3>
                <div className="flex bg-white p-1 rounded-lg border border-[#E2E8F0] no-print">
                  {([['nome', 'Nome'], ['liquido', 'Líquido'], ['extras', 'Extras'], ['faltas', 'Faltas']] as const).map(([val, lbl]) => (
                    <button key={val} onClick={() => setOrdenacao(val)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded transition-all ${ordenacao === val ? 'bg-[#0C1D4D] text-white' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-white border-b-2 border-[#E2E8F0]">
                    <tr className="text-[9px] uppercase font-black tracking-widest text-[#64748B]">
                      <th className="p-3">Colaborador</th>
                      <th className="p-3 text-center">H. Trab.</th>
                      <th className="p-3 text-center text-[#336699]">Extra 60%</th>
                      <th className="p-3 text-center text-red-600">Extra 100%</th>
                      <th className="p-3 text-center">Faltas</th>
                      <th className="p-3 text-right text-green-700">Créditos</th>
                      <th className="p-3 text-right text-red-600">Débitos</th>
                      <th className="p-3 text-right">Líquido</th>
                      <th className="p-3 text-center no-print">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {linhasOrdenadas.map((l, i) => (
                      <tr key={i} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-3">
                          <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                          <span className="text-[10px] text-gray-500 font-medium">{l.cargo} • {l.tipoContrato}</span>
                        </td>
                        <td className="p-3 text-center font-bold">{formatTimeStr(l.minsTrabalhados)}</td>
                        <td className="p-3 text-center font-bold text-[#336699]">{l.minsExtras60 > 0 ? formatTimeStr(l.minsExtras60) : '—'}</td>
                        <td className="p-3 text-center font-bold text-red-600">{l.minsExtras100 > 0 ? formatTimeStr(l.minsExtras100) : '—'}</td>
                        <td className={`p-3 text-center font-black ${l.faltas > 0 ? 'text-red-600' : 'text-gray-300'}`}>{l.faltas || '—'}</td>
                        <td className="p-3 text-right font-bold text-green-700">{formatCurrency(l.totalCreditos)}</td>
                        <td className="p-3 text-right font-bold text-red-600">{formatCurrency(l.totalDebitos)}</td>
                        <td className="p-3 text-right font-black text-[#0C1D4D]">{formatCurrency(l.liquido)}</td>
                        <td className="p-3 text-center no-print">
                          {l.fechado
                            ? <span className="text-[9px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-black uppercase">🔒 Fechada</span>
                            : <span className="text-[9px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black uppercase">Aberta</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#0C1D4D] bg-[#F8FAFC] font-black text-[#0C1D4D]">
                      <td className="p-3 uppercase text-xs tracking-wider">Total Geral</td>
                      <td className="p-3 text-center">{formatTimeStr(totais.minsTrab)}</td>
                      <td className="p-3 text-center text-[#336699]" colSpan={2}>Extras: {formatTimeStr(totais.minsExtra)}</td>
                      <td className="p-3 text-center text-red-600">{totais.faltas}</td>
                      <td className="p-3 text-right text-green-700">{formatCurrency(totais.creditos)}</td>
                      <td className="p-3 text-right text-red-600">{formatCurrency(totais.debitos)}</td>
                      <td className="p-3 text-right">{formatCurrency(totais.liquido)}</td>
                      <td className="p-3 no-print"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 font-medium mt-4 text-center">
              Folhas fechadas usam os valores congelados no fechamento. Folhas em aberto são calculadas ao vivo e podem mudar conforme o ponto.
            </p>
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}