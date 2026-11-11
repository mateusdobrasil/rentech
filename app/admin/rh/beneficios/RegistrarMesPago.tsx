"use client";

// "Registrar mês pago por fora" (aba Benefícios por Mês) — competência paga
// fora do sistema (ex.: outubro/2026, pago adiantado no fim de setembro).
// Calcula os benefícios do mês como o Grid (gridBeneficiosAction), deixa
// desmarcar quem não recebeu e grava o histórico JÁ COMO PAGO na data
// informada (gerarBeneficioAction com jaPagoEm): pedido Flash nasce PAGO, nada
// vai pro lote, nenhum arquivo é baixado. Saiu do Grid em 2026-11-09 (lá
// confundia com o Gerar Benefício normal).
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../../../components/ui/NotificationProvider';
import { gridBeneficiosAction, gerarBeneficioAction } from '../actions/actions-beneficios';

const BRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mesAtualIso = () => { const h = new Date(); return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`; };
// Pagamento adiantado: sugere o último dia do mês anterior à competência
const ultimoDiaMesAnterior = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
type Base = 'INICIO_MES' | 'ATUAL';

export default function RegistrarMesPago({ mesInicial, accessToken, usuarioAtual, onFechar, onRegistrado }: {
  mesInicial: string; accessToken: string; usuarioAtual: string;
  onFechar: () => void; onRegistrado: (mes: string) => void;
}) {
  const [mes, setMes] = useState(mesInicial);
  const confirmar = useConfirm();
  const [base, setBase] = useState<Base>(mesInicial <= mesAtualIso() ? 'INICIO_MES' : 'ATUAL');
  const [dataPago, setDataPago] = useState(ultimoDiaMesAnterior(mesInicial));
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [jaGerados, setJaGerados] = useState<Record<string, { em: string; pagoEm: string | null }>>({});
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setCarregando(true); setErro(null);
    gridBeneficiosAction({ mesReferencia: mes, base }, accessToken).then(res => {
      if (!res.ok) { setErro(res.erro || 'Não foi possível calcular o mês.'); setFuncionarios([]); setCarregando(false); return; }
      setFuncionarios(res.info.funcionarios);
      const jg = res.info.jaGerados || {};
      setJaGerados(jg);
      // Quem já tem benefício gerado/registrado no mês nasce desmarcado
      setMarcados(new Set(res.info.funcionarios.map((f: any) => f.funcionario_nome).filter((n: string) => !jg[n])));
      setCarregando(false);
    });
  }, [mes, base, accessToken]);

  const trocarMes = (m: string) => { if (!m) return; setMes(m); setBase(m <= mesAtualIso() ? 'INICIO_MES' : 'ATUAL'); setDataPago(ultimoDiaMesAnterior(m)); };
  const alternar = (n: string) => setMarcados(prev => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });

  const totais = useMemo(() => funcionarios.filter(f => marcados.has(f.funcionario_nome))
    .reduce((acc, f) => ({ flash: acc.flash + (f.totalFlash || 0), lote: acc.lote + (f.totalLote || 0) }), { flash: 0, lote: 0 }), [funcionarios, marcados]);

  const registrar = async () => {
    const nomes = funcionarios.filter(f => marcados.has(f.funcionario_nome)).map(f => f.funcionario_nome);
    if (nomes.length === 0 || !dataPago) return;
    const mesBR = mes.split('-').reverse().join('/');
    const dataBR = dataPago.split('-').reverse().join('/');
    const repetidos = nomes.filter(n => jaGerados[n]);
    if (!(await confirmar(`REGISTRAR como já pagos em ${dataBR} os benefícios de ${mesBR} de ${nomes.length} funcionário(s)?\n\n` +
      `Nenhum arquivo Flash será baixado e nada vai para o lote — só fica o histórico, marcado como pago.\n\n` +
      `⚡ Cartão Flash: ${BRL(totais.flash)}\n🏦 Transferência: ${BRL(totais.lote)}` +
      (repetidos.length ? `\n\n⚠ ${repetidos.length} já tinham benefício gerado neste mês: ${repetidos.join(', ')}` : '')))) return;

    setGravando(true); setErro(null);
    const res = await gerarBeneficioAction({ mesReferencia: mes, nomes, base, jaPagoEm: dataPago, usuarioNome: usuarioAtual }, accessToken);
    setGravando(false);
    if (!res.ok) { setErro(res.erro || 'Não foi possível registrar.'); return; }
    onRegistrado(mes);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onFechar}>
      <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200">
          <div className="flex justify-between items-start gap-3">
            <div>
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">📝 Registrar mês pago por fora</h2>
              <p className="text-xs text-gray-500 mt-1">Para uma competência que já foi paga fora do sistema. Grava só o histórico, já como pago — <strong>não baixa arquivo Flash e não vai para o lote</strong>.</p>
            </div>
            <button onClick={onFechar} className="text-[10px] font-black bg-gray-100 px-3 py-1.5 rounded-lg uppercase shrink-0">Fechar</button>
          </div>
          <div className="flex flex-wrap items-end gap-3 mt-4">
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Competência</label>
              <input type="month" value={mes} onChange={e => trocarMes(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Valores</label>
              <select value={base} onChange={e => setBase(e.target.value as Base)} className="p-2 border border-gray-300 rounded-lg text-[11px] font-black uppercase text-gray-600 bg-[#F8FAFC]">
                <option value="INICIO_MES">Cadastro em 01/{mes.slice(5)}</option>
                <option value="ATUAL">Cadastro atual</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Pago em</label>
              <input type="date" value={dataPago} onChange={e => setDataPago(e.target.value)} className="p-2 border border-amber-300 rounded-lg text-sm font-bold bg-amber-50" />
            </div>
          </div>
        </div>

        <div className="overflow-auto p-5 flex-1">
          {carregando ? (
            <p className="text-center py-10 text-gray-400 font-bold uppercase">Calculando...</p>
          ) : erro && funcionarios.length === 0 ? (
            <p className="text-center py-10 text-red-600 font-bold">{erro}</p>
          ) : funcionarios.length === 0 ? (
            <p className="text-center py-10 text-gray-400 font-bold uppercase">Nenhum benefício cadastrado para este mês.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                  <th className="p-2 text-left w-8">
                    <input type="checkbox" checked={marcados.size === funcionarios.length}
                      onChange={e => setMarcados(e.target.checked ? new Set(funcionarios.map(f => f.funcionario_nome)) : new Set())} className="w-4 h-4" />
                  </th>
                  <th className="p-2 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Funcionário</th>
                  <th className="p-2 text-right font-black text-[#E85A28] uppercase text-[10px]">⚡ Flash</th>
                  <th className="p-2 text-right font-black text-emerald-700 uppercase text-[10px]">🏦 Lote</th>
                  <th className="p-2 text-right font-black text-indigo-700 uppercase text-[10px]">Total</th>
                </tr>
              </thead>
              <tbody>
                {funcionarios.map((f, idx) => {
                  const marcado = marcados.has(f.funcionario_nome);
                  const jg = jaGerados[f.funcionario_nome];
                  return (
                    <tr key={f.funcionario_nome} onClick={() => alternar(f.funcionario_nome)}
                      className={`cursor-pointer border-b border-[#E2E8F0] ${idx % 2 ? 'bg-[#F8FAFC]' : 'bg-white'} ${marcado ? '' : 'opacity-40'}`}>
                      <td className="p-2" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={marcado} onChange={() => alternar(f.funcionario_nome)} className="w-4 h-4" />
                      </td>
                      <td className="p-2 font-black text-[#0C1D4D]">
                        {f.funcionario_nome}
                        {jg && (
                          <span className="ml-2 text-[9px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase">
                            {jg.pagoEm ? `já registrado pago ${jg.pagoEm.split('-').reverse().join('/')}` : `já gerado ${new Date(jg.em).toLocaleDateString('pt-BR')}`}
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right tabular-nums text-[#E85A28] font-bold">{f.totalFlash ? BRL(f.totalFlash) : '—'}</td>
                      <td className="p-2 text-right tabular-nums text-emerald-700 font-bold">{f.totalLote ? BRL(f.totalLote) : '—'}</td>
                      <td className="p-2 text-right tabular-nums text-indigo-700 font-black">{BRL(f.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap justify-between items-center gap-3 p-5 border-t border-gray-200">
          <p className="text-[11px] font-bold text-gray-500">
            {marcados.size} selecionado(s) · ⚡ {BRL(totais.flash)} · 🏦 {BRL(totais.lote)} · <span className="text-indigo-700 font-black">{BRL(totais.flash + totais.lote)}</span>
          </p>
          {erro && funcionarios.length > 0 && <p className="text-xs text-red-600 font-bold w-full">{erro}</p>}
          <button onClick={registrar} disabled={gravando || carregando || marcados.size === 0 || !dataPago}
            className="bg-amber-600 hover:bg-amber-700 text-white font-black uppercase tracking-wider text-xs py-3 px-6 rounded-xl disabled:opacity-50">
            {gravando ? '⏳ Registrando...' : `📝 Registrar como pago (${marcados.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
