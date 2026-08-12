"use client";

// app/portal/EspelhoPonto.tsx
// Aba "Espelho de Ponto" do Portal do Funcionário: mostra as batidas dia a
// dia do mês selecionado (mesma leitura usada no PDF anexado ao holerite,
// ver app/lib/gerarEspelhoPontoPdf.ts) e permite baixar o PDF equivalente.
import { useEffect, useMemo, useState } from 'react';
import { buscarMeuEspelhoPontoAction, baixarMeuEspelhoPontoPdfAction } from './actions/actions-ponto';

interface RegistroDia {
  data: string;
  entrada_1: string | null;
  saida_1: string | null;
  entrada_2: string | null;
  saida_2: string | null;
  minutosTrabalhados: number;
  minutosAbonados: number;
  motivoAbono: string | null;
}

const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const hhmm = (min: number) => `${Math.floor((min || 0) / 60).toString().padStart(2, '0')}:${((min || 0) % 60).toString().padStart(2, '0')}`;
const hhmmBatida = (t: string | null) => (t ? t.slice(0, 5) : '--:--');

function mesAtualSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

export default function EspelhoPonto({ accessToken }: { accessToken: string }) {
  const [mesReferencia, setMesReferencia] = useState(mesAtualSaoPaulo);
  const [registros, setRegistros] = useState<RegistroDia[]>([]);
  const [feriados, setFeriados] = useState<string[]>([]);
  const [dataAdmissao, setDataAdmissao] = useState<string | null>(null);
  const [dataDesligamento, setDataDesligamento] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro('');
    buscarMeuEspelhoPontoAction(accessToken, mesReferencia).then(res => {
      if (cancelado) return;
      if (res.ok) {
        setRegistros(res.info.registros);
        setFeriados(res.info.feriados);
        setDataAdmissao(res.info.dataAdmissao);
        setDataDesligamento(res.info.dataDesligamento);
      } else {
        setErro(res.erro || 'Erro ao carregar o espelho de ponto.');
      }
      setCarregando(false);
    });
    return () => { cancelado = true; };
  }, [accessToken, mesReferencia]);

  const linhas = useMemo(() => {
    const porDia: Record<string, RegistroDia> = {};
    registros.forEach(r => { porDia[r.data] = r; });

    const [ano, mesNum] = mesReferencia.split('-').map(Number);
    const diasNoMes = new Date(ano, mesNum, 0).getDate();
    const hoje = new Date(); hoje.setHours(23, 59, 59, 999);

    const dias: { dataIso: string; diaSemana: number; reg: RegistroDia | undefined; observacao: string; alerta: boolean }[] = [];
    for (let d = 1; d <= diasNoMes; d++) {
      const data = new Date(ano, mesNum - 1, d);
      if (data > hoje) break;
      const dataIso = `${ano}-${String(mesNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dataAdmissao && dataIso < dataAdmissao) continue;
      if (dataDesligamento && dataIso > dataDesligamento) continue;

      const diaSemana = data.getDay();
      const isFeriado = feriados.includes(dataIso);
      const reg = porDia[dataIso];
      const trabalhados = reg?.minutosTrabalhados || 0;
      const abonados = reg?.minutosAbonados || 0;
      const temRegistro = trabalhados > 0 || abonados > 0;

      let observacao = '';
      let alerta = false;
      if (isFeriado) observacao = temRegistro ? 'Trabalhado (feriado)' : 'Feriado';
      else if (diaSemana === 0) observacao = temRegistro ? 'Trabalhado (DSR)' : 'DSR';
      else if (!temRegistro && diaSemana !== 6) { observacao = 'Falta'; alerta = true; }
      if (abonados > 0) observacao = `Abono ${hhmm(abonados)}${reg?.motivoAbono ? ` — ${reg.motivoAbono}` : ''}`;

      dias.push({ dataIso, diaSemana, reg, observacao, alerta });
    }
    return dias;
  }, [registros, feriados, dataAdmissao, dataDesligamento, mesReferencia]);

  const totais = useMemo(() => {
    let trabalhado = 0, abonado = 0, faltas = 0;
    linhas.forEach(l => {
      trabalhado += l.reg?.minutosTrabalhados || 0;
      abonado += l.reg?.minutosAbonados || 0;
      if (l.alerta) faltas++;
    });
    return { trabalhado, abonado, faltas };
  }, [linhas]);

  const baixarPdf = async () => {
    setBaixando(true);
    setErro('');
    try {
      const res = await baixarMeuEspelhoPontoPdfAction(accessToken, mesReferencia);
      if (!res.ok) { setErro(res.erro || 'Erro ao gerar o PDF.'); return; }
      const bin = atob(res.info.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      setErro('Erro ao gerar o PDF: ' + e.message);
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-3 md:p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Mês</label>
          <input
            type="month"
            value={mesReferencia}
            max={mesAtualSaoPaulo()}
            onChange={e => setMesReferencia(e.target.value)}
            className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold outline-none focus:border-[#336699] bg-[#F8FAFC]"
          />
        </div>
        <button
          onClick={baixarPdf}
          disabled={baixando || carregando}
          className="text-[10px] md:text-xs font-black bg-[#336699] hover:bg-[#284B8C] disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase"
        >
          {baixando ? 'Gerando...' : '⬇ Baixar PDF'}
        </button>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold px-4 py-3 rounded-lg">{erro}</div>}

      {carregando ? (
        <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Carregando...</p>
      ) : linhas.length === 0 ? (
        <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Nenhum dia neste mês.</p>
      ) : (
        <>
          {/* Mobile: cartões empilhados */}
          <div className="md:hidden space-y-2">
            {linhas.map(l => (
              <div key={l.dataIso} className="bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-black text-[#0C1D4D] text-[13px]">
                    {l.dataIso.split('-').reverse().slice(0, 2).join('/')} · {DIAS_SEMANA[l.diaSemana]}
                  </span>
                  <span className="text-xs font-bold text-[#0C1D4D]">{l.reg?.minutosTrabalhados ? hhmm(l.reg.minutosTrabalhados) : '-'}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-center mb-2">
                  {[l.reg?.entrada_1, l.reg?.saida_1, l.reg?.entrada_2, l.reg?.saida_2].map((v, i) => (
                    <div key={i} className="bg-white rounded-lg py-1.5 text-[11px] font-bold text-[#0C1D4D] border border-[#E2E8F0]">{hhmmBatida(v || null)}</div>
                  ))}
                </div>
                {l.observacao && (
                  <p className={`text-[10px] font-bold uppercase break-words ${l.alerta ? 'text-red-600' : 'text-gray-500'}`}>{l.observacao}</p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: tabela completa */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-center border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0] text-[10px] uppercase font-black tracking-wider text-[#0C1D4D]">
                  <th className="p-2 text-left">Data</th>
                  <th className="p-2">Entrada</th>
                  <th className="p-2">Saída Alm.</th>
                  <th className="p-2">Ret. Alm.</th>
                  <th className="p-2">Saída</th>
                  <th className="p-2">Total</th>
                  <th className="p-2 text-left">Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {linhas.map(l => {
                  const temIntervalo = !!(l.reg?.entrada_2 && l.reg?.saida_2);
                  const colSaidaAlmoco = temIntervalo ? l.reg?.saida_1 ?? null : null;
                  const colRetAlmoco = temIntervalo ? l.reg?.entrada_2 ?? null : null;
                  const colSaida = temIntervalo ? l.reg?.saida_2 ?? null : l.reg?.saida_1 ?? null;
                  return (
                    <tr key={l.dataIso} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="p-2 text-left font-bold text-[#0C1D4D]">
                        {l.dataIso.split('-').reverse().slice(0, 2).join('/')} <span className="text-gray-400 font-medium">{DIAS_SEMANA[l.diaSemana]}</span>
                      </td>
                      <td className="p-2 font-medium">{hhmmBatida(l.reg?.entrada_1 || null)}</td>
                      <td className="p-2 font-medium">{hhmmBatida(colSaidaAlmoco)}</td>
                      <td className="p-2 font-medium">{hhmmBatida(colRetAlmoco)}</td>
                      <td className="p-2 font-medium">{hhmmBatida(colSaida)}</td>
                      <td className="p-2 font-bold">{l.reg?.minutosTrabalhados ? hhmm(l.reg.minutosTrabalhados) : '-'}</td>
                      <td className={`p-2 text-left text-[11px] font-bold ${l.alerta ? 'text-red-600' : 'text-gray-500'}`}>{l.observacao}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-3 pt-2 border-t border-[#E2E8F0]">
            <span className="text-xs font-black text-[#0C1D4D]">Total trabalhado: <span className="text-[#336699]">{hhmm(totais.trabalhado)}</span></span>
            <span className="text-xs font-black text-[#0C1D4D]">Total abonado: <span className="text-[#336699]">{hhmm(totais.abonado)}</span></span>
            <span className={`text-xs font-black ${totais.faltas > 0 ? 'text-red-600' : 'text-[#0C1D4D]'}`}>Faltas: {totais.faltas}</span>
          </div>
        </>
      )}
    </div>
  );
}
