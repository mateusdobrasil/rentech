"use client";

// Aba "Colaboradores" de /admin/rh/relatorios: lista cadastral, contato,
// salário, benefícios e bônus fixos de cada colaborador, com filtros e
// exportação (Excel e impressão/PDF). Dados montados no servidor por
// relatorioColaboradoresAction (já restritos às empresas do usuário).
import { useEffect, useMemo, useState } from 'react';
import { relatorioColaboradoresAction, type LinhaColaborador, type SituacaoColaborador } from '../actions/actions-relatorio-colaboradores';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { useToast } from '../../../components/ui/NotificationProvider';

type FiltroSituacao = 'EM_QUADRO' | SituacaoColaborador | 'TODOS';

const LABEL_SITUACAO: Record<SituacaoColaborador, string> = { ATIVO: 'Ativo', FERIAS: 'Em férias', AFASTADO: 'Afastado', DESLIGADO: 'Desligado' };
const COR_SITUACAO: Record<SituacaoColaborador, string> = {
  ATIVO: 'bg-green-100 text-green-800 border-green-300',
  FERIAS: 'bg-sky-100 text-sky-800 border-sky-300',
  AFASTADO: 'bg-amber-100 text-amber-800 border-amber-300',
  DESLIGADO: 'bg-gray-100 text-gray-600 border-gray-300',
};

const formatarCpf = (cpf: string | null) => {
  const d = (cpf || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (cpf || '');
};
const formatarCelular = (c: string | null) => {
  const d = (c || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return c || '';
};
const tempoDeCasa = (admissao: string | null, fim: string | null) => {
  if (!admissao) return '';
  const a = new Date(admissao + 'T12:00:00');
  const b = fim ? new Date(fim + 'T12:00:00') : new Date();
  let meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) meses--;
  if (meses < 1) return 'menos de 1 mês';
  const anos = Math.floor(meses / 12), m = meses % 12;
  return [anos ? `${anos} ano${anos > 1 ? 's' : ''}` : '', m ? `${m} ${m > 1 ? 'meses' : 'mês'}` : ''].filter(Boolean).join(' e ');
};
const textoBeneficio = (b: LinhaColaborador['beneficios'][number]) =>
  b.modalidade === 'POR_DIARIA' ? `${formatarMoeda(b.valor)}/dia`
    : b.modalidade === 'DIAS_FIXOS' ? `${formatarMoeda(b.valor)} × ${b.qtdDias || 0} dias = ${formatarMoeda(b.mensal || 0)}`
      : `${formatarMoeda(b.valor)}/mês`;
const salarioReferencia = (l: LinhaColaborador) => l.salarioContrato || l.salarioFolha;

export default function RelatorioColaboradores({ accessToken, filtroEmpresa, nomeEmpresa, onVoltar }: {
  accessToken: string;
  filtroEmpresa: string;                       // 'TODAS' ou id — o mesmo filtro do topo da página
  nomeEmpresa: (id: number | null | undefined) => string;
  onVoltar: () => void;
}) {
  const toast = useToast();
  const [carregando, setCarregando] = useState(true);
  const [linhas, setLinhas] = useState<LinhaColaborador[]>([]);
  // salário e benefícios só para quem acessa o Financeiro (decidido no servidor)
  const [podeVerValores, setPodeVerValores] = useState(false);

  const [situacao, setSituacao] = useState<FiltroSituacao>('EM_QUADRO');
  const [departamento, setDepartamento] = useState('TODOS');
  const [contrato, setContrato] = useState('TODOS');
  const [busca, setBusca] = useState('');
  const [verContato, setVerContato] = useState(true);
  const [marcouRemuneracao, setVerRemuneracao] = useState(true);
  const verRemuneracao = podeVerValores && marcouRemuneracao;
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let vivo = true;
    setCarregando(true);
    relatorioColaboradoresAction(accessToken)
      .then(r => {
        if (!vivo) return;
        if (r.ok) { setLinhas(r.info.linhas || []); setPodeVerValores(!!r.info.verRemuneracao); }
        else toast('Colaboradores: ' + (r.erro || 'não foi possível carregar.'), 'error');
      })
      .catch(e => vivo && toast('Colaboradores: ' + e.message, 'error'))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const daEmpresa = useMemo(() => linhas.filter(l => filtroEmpresa === 'TODAS' || String(l.empresaId) === filtroEmpresa), [linhas, filtroEmpresa]);
  const departamentos = useMemo(() => [...new Set(daEmpresa.map(l => l.departamento).filter(Boolean) as string[])].sort(), [daEmpresa]);
  const contratos = useMemo(() => [...new Set(daEmpresa.map(l => l.tipoContrato).filter(Boolean) as string[])].sort(), [daEmpresa]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const termoDigitos = termo.replace(/\D/g, '');
    return daEmpresa.filter(l => {
      if (situacao === 'EM_QUADRO' && l.situacao === 'DESLIGADO') return false;
      if (situacao !== 'EM_QUADRO' && situacao !== 'TODOS' && l.situacao !== situacao) return false;
      if (departamento !== 'TODOS' && (l.departamento || '') !== departamento) return false;
      if (contrato !== 'TODOS' && (l.tipoContrato || '') !== contrato) return false;
      if (termo) {
        const texto = [l.nome, l.cargo, l.departamento, l.email].join(' ').toLowerCase();
        const achouDigitos = termoDigitos.length >= 3 && ((l.cpf || '').replace(/\D/g, '').includes(termoDigitos) || (l.celular || '').replace(/\D/g, '').includes(termoDigitos));
        if (!texto.includes(termo) && !achouDigitos) return false;
      }
      return true;
    });
  }, [daEmpresa, situacao, departamento, contrato, busca]);

  const kpis = useMemo(() => {
    const emQuadro = daEmpresa.filter(l => l.situacao !== 'DESLIGADO');
    return {
      emQuadro: emQuadro.length,
      ferias: daEmpresa.filter(l => l.situacao === 'FERIAS').length,
      afastados: daEmpresa.filter(l => l.situacao === 'AFASTADO').length,
      salarios: filtradas.filter(l => l.situacao !== 'DESLIGADO').reduce((s, l) => s + salarioReferencia(l), 0),
      beneficios: filtradas.filter(l => l.situacao !== 'DESLIGADO').reduce((s, l) => s + l.totalBeneficiosMes + l.totalBonusMes, 0),
    };
  }, [daEmpresa, filtradas]);

  const descricaoFiltros = [
    filtroEmpresa === 'TODAS' ? 'Todas as empresas' : nomeEmpresa(Number(filtroEmpresa)),
    situacao === 'EM_QUADRO' ? 'Em quadro (sem desligados)' : situacao === 'TODOS' ? 'Todas as situações' : LABEL_SITUACAO[situacao],
    departamento !== 'TODOS' ? departamento : null,
    contrato !== 'TODOS' ? contrato : null,
    busca.trim() ? `Busca: "${busca.trim()}"` : null,
  ].filter(Boolean).join(' • ');

  const exportarExcel = async () => {
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const linhasPlanilha = filtradas.map(l => {
        const base: Record<string, any> = {
          'Nome': l.nome,
          'CPF': formatarCpf(l.cpf),
          'Empresa': nomeEmpresa(l.empresaId),
          'Cargo': l.cargo || '',
          'Departamento': l.departamento || '',
          'Tipo de contrato': l.tipoContrato || '',
          'Admissão': l.dataAdmissao ? formatarDataBR(l.dataAdmissao, '') : '',
          'Tempo de casa': tempoDeCasa(l.dataAdmissao, l.situacao === 'DESLIGADO' ? l.dataDesligamento : null),
          'Situação': LABEL_SITUACAO[l.situacao],
          'Detalhe da situação': l.situacaoDetalhe || '',
          'Desligamento': l.dataDesligamento ? formatarDataBR(l.dataDesligamento, '') : '',
          'Nascimento': l.dataNascimento ? formatarDataBR(l.dataNascimento, '') : '',
        };
        if (verContato) Object.assign(base, {
          'Celular': formatarCelular(l.celular),
          'E-mail': l.email || '',
          'Endereço': l.endereco || '',
        });
        if (verRemuneracao) Object.assign(base, {
          'Salário folha': l.salarioFolha,
          'Salário contrato': l.salarioContrato,
          'Valor diária': l.valorDiaria,
          'Benefícios': l.beneficios.map(b => `${b.tipo}: ${textoBeneficio(b)}`).join('; '),
          'Benefícios no mês (fixos)': l.totalBeneficiosMes,
          'Bônus fixos': l.bonusFixos.map(b => `${b.descricao}: ${formatarMoeda(b.valor)}`).join('; '),
          'Bônus no mês': l.totalBonusMes,
        });
        return base;
      });
      const ws = XLSX.utils.json_to_sheet(linhasPlanilha);
      ws['!cols'] = Object.keys(linhasPlanilha[0] || {}).map(k => ({ wch: Math.min(60, Math.max(k.length + 2, ...linhasPlanilha.map(r => String(r[k] ?? '').length + 1))) }));
      // valores em reais com formato de moeda
      const colunasMoeda = ['Salário folha', 'Salário contrato', 'Valor diária', 'Benefícios no mês (fixos)', 'Bônus no mês'];
      const cabecalho = Object.keys(linhasPlanilha[0] || {});
      cabecalho.forEach((k, c) => {
        if (!colunasMoeda.includes(k)) return;
        for (let r = 1; r <= linhasPlanilha.length; r++) {
          const cel = ws[XLSX.utils.encode_cell({ r, c })];
          if (cel && typeof cel.v === 'number') cel.z = '"R$" #,##0.00';
        }
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Colaboradores');
      const hoje = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no horário local
      XLSX.writeFile(wb, `colaboradores-${hoje}.xlsx`);
    } catch (e: any) {
      toast('Não foi possível gerar o Excel: ' + e.message, 'error');
    } finally {
      setExportando(false);
    }
  };

  const sel = 'p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] text-[#0A2A4A] cursor-pointer';

  return (
    <div>
      {/* tabela larga: imprime em paisagem */}
      <style jsx global>{`
        @media print { @page { size: A4 landscape; margin: 8mm; } }
      `}</style>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4 mb-4 no-print print:hidden">
        <div>
          <h2 className="text-lg font-black text-[#7C3AED] uppercase tracking-wider">👥 Relatório de Colaboradores</h2>
          <p className="text-sm text-[#64748B]">Ficha cadastral, contato{podeVerValores ? ' e remuneração' : ''} de cada colaborador — situação de hoje, não depende do mês selecionado acima.{!carregando && !podeVerValores && ' Salário e benefícios aparecem só para quem tem acesso ao Financeiro.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onVoltar} className="text-[#64748B] font-bold text-sm hover:text-[#0C1D4D] transition-colors flex items-center gap-2">⬅ Relatório Completo</button>
          <button onClick={exportarExcel} disabled={carregando || exportando || filtradas.length === 0} className="bg-[#16A34A] text-white font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl shadow-md hover:bg-[#15803D] transition-all disabled:opacity-50">
            {exportando ? 'Gerando...' : '📗 Excel'}
          </button>
          <button onClick={() => window.print()} disabled={carregando || filtradas.length === 0} className="bg-[#7C3AED] text-white font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl shadow-md hover:bg-[#6D28D9] transition-all disabled:opacity-50">
            🖨️ Imprimir / PDF
          </button>
        </div>
      </div>

      {/* filtros */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-wrap items-center gap-3 mb-4 no-print print:hidden">
        <select value={situacao} onChange={e => setSituacao(e.target.value as FiltroSituacao)} className={sel}>
          <option value="EM_QUADRO">Em quadro (sem desligados)</option>
          <option value="ATIVO">Só ativos trabalhando</option>
          <option value="FERIAS">Em férias</option>
          <option value="AFASTADO">Afastados</option>
          <option value="DESLIGADO">Desligados</option>
          <option value="TODOS">Todas as situações</option>
        </select>
        <select value={departamento} onChange={e => setDepartamento(e.target.value)} className={sel}>
          <option value="TODOS">Todos os departamentos</option>
          {departamentos.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={contrato} onChange={e => setContrato(e.target.value)} className={sel}>
          <option value="TODOS">Todos os contratos</option>
          {contratos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar nome, cargo, CPF ou celular"
          className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC] text-[#0A2A4A] placeholder:text-gray-400 flex-grow min-w-[220px]"
        />
        <div className="flex items-center gap-4 text-xs font-black uppercase tracking-wider text-[#334155]">
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={verContato} onChange={e => setVerContato(e.target.checked)} /> Contato</label>
          {podeVerValores && (
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={marcouRemuneracao} onChange={e => setVerRemuneracao(e.target.checked)} /> Salário e benefícios</label>
          )}
        </div>
      </div>

      {/* cabeçalho de impressão */}
      <div className="hidden print:block mb-3 border-b-2 border-black pb-2">
        <h1 className="text-xl font-black uppercase">Relatório de Colaboradores</h1>
        <p className="text-xs">Emitido em {new Date().toLocaleDateString('pt-BR')} • {filtradas.length} colaborador(es) • {descricaoFiltros}</p>
      </div>

      {carregando ? (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
          Montando a lista de colaboradores...
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-2 ${verRemuneracao ? 'lg:grid-cols-5' : 'lg:grid-cols-3'} gap-4 mb-4 print-break`}>
            <Kpi titulo="Em quadro" valor={String(kpis.emQuadro)} cor="#0C1D4D" sub="Ativos, em férias e afastados" />
            <Kpi titulo="Em férias hoje" valor={String(kpis.ferias)} cor="#0284C7" />
            <Kpi titulo="Afastados hoje" valor={String(kpis.afastados)} cor="#D97706" />
            {verRemuneracao && <Kpi titulo="Salários / mês" valor={formatarMoeda(kpis.salarios)} cor="#16A34A" sub="Da lista filtrada (salário de contrato)" />}
            {verRemuneracao && <Kpi titulo="Benefícios + bônus / mês" valor={formatarMoeda(kpis.beneficios)} cor="#7C3AED" sub="Valores fixos; diárias à parte" />}
          </div>

          <p className="text-xs font-bold text-[#64748B] mb-2 no-print print:hidden">{filtradas.length} colaborador(es) • {descricaoFiltros}</p>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-x-auto print:overflow-visible print:border-none print:shadow-none">
            <table className="w-full text-left text-xs print:text-[9px]">
              <thead className="bg-[#F8FAFC] print:bg-transparent border-b-2 border-[#CBD5E1] print:border-black">
                <tr className="text-[10px] print:text-[8px] uppercase font-black tracking-wider text-[#0C1D4D]">
                  <th className="p-3 print:p-1">Colaborador</th>
                  <th className="p-3 print:p-1">Cargo / Depto.</th>
                  <th className="p-3 print:p-1">Contrato</th>
                  <th className="p-3 print:p-1">Admissão</th>
                  <th className="p-3 print:p-1">Situação</th>
                  {verContato && <th className="p-3 print:p-1">Contato</th>}
                  {verRemuneracao && <th className="p-3 print:p-1 text-right">Salário</th>}
                  {verRemuneracao && <th className="p-3 print:p-1">Benefícios e bônus fixos</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {filtradas.length === 0 && (
                  <tr><td colSpan={8} className="p-10 text-center text-gray-400 font-bold uppercase">Nenhum colaborador com esses filtros.</td></tr>
                )}
                {filtradas.map(l => (
                  <tr key={l.id} className="align-top hover:bg-[#F8FAFC] print:hover:bg-transparent print-break">
                    <td className="p-3 print:p-1">
                      <span className="font-black text-[#0C1D4D] block">{l.nome}</span>
                      {l.cpf && <span className="text-[10px] text-gray-500 font-bold block">CPF {formatarCpf(l.cpf)}</span>}
                      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase inline-block mt-0.5 ${corSeloEmpresa(l.empresaId)}`}>{nomeEmpresa(l.empresaId)}</span>
                    </td>
                    <td className="p-3 print:p-1">
                      <span className="font-bold text-[#334155] block">{l.cargo || '—'}</span>
                      <span className="text-[10px] text-gray-500 font-bold uppercase">{l.departamento || ''}</span>
                    </td>
                    <td className="p-3 print:p-1 font-bold text-[#334155]">{l.tipoContrato || '—'}</td>
                    <td className="p-3 print:p-1">
                      <span className="font-bold text-[#334155] block">{formatarDataBR(l.dataAdmissao)}</span>
                      <span className="text-[10px] text-gray-500 font-bold">{tempoDeCasa(l.dataAdmissao, l.situacao === 'DESLIGADO' ? l.dataDesligamento : null)}</span>
                    </td>
                    <td className="p-3 print:p-1">
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border uppercase inline-block ${COR_SITUACAO[l.situacao]}`}>{LABEL_SITUACAO[l.situacao]}</span>
                      {l.situacaoDetalhe && <span className="text-[10px] text-gray-500 font-bold block mt-0.5">{l.situacaoDetalhe}</span>}
                    </td>
                    {verContato && (
                      <td className="p-3 print:p-1 min-w-[230px] max-w-[300px]">
                        {l.celular && <span className="font-bold text-[#334155] block whitespace-nowrap">📱 {formatarCelular(l.celular)}</span>}
                        {l.email && <span className="text-[#334155] block break-words">✉️ {l.email}</span>}
                        {l.endereco && <span className="text-[10px] text-gray-500 block">📍 {l.endereco}</span>}
                        {!l.celular && !l.email && !l.endereco && <span className="text-gray-400">—</span>}
                      </td>
                    )}
                    {verRemuneracao && (
                      <td className="p-3 print:p-1 text-right whitespace-nowrap">
                        <span className="font-black text-[#0C1D4D] block">{salarioReferencia(l) > 0 ? formatarMoeda(salarioReferencia(l)) : <span className="text-gray-400">—</span>}</span>
                        {l.salarioContrato > 0 && l.salarioFolha > 0 && l.salarioContrato !== l.salarioFolha && (
                          <span className="text-[10px] text-gray-500 font-bold block">Folha {formatarMoeda(l.salarioFolha)}</span>
                        )}
                        {l.valorDiaria > 0 && <span className="text-[10px] text-gray-500 font-bold block">Diária {formatarMoeda(l.valorDiaria)}</span>}
                      </td>
                    )}
                    {verRemuneracao && (
                      <td className="p-3 print:p-1 min-w-[220px]">
                        {l.beneficios.length === 0 && l.bonusFixos.length === 0 && <span className="text-gray-400">—</span>}
                        {l.beneficios.map((b, i) => (
                          <span key={'b' + i} className="block text-[#334155]"><strong className="font-black text-[10px] uppercase">{b.tipo}</strong> {textoBeneficio(b)}</span>
                        ))}
                        {l.bonusFixos.map((b, i) => (
                          <span key={'x' + i} className="block text-[#7C3AED]"><strong className="font-black text-[10px] uppercase">Bônus</strong> {b.descricao}: {formatarMoeda(b.valor)}{b.ate ? ` (até ${b.ate.split('-').reverse().join('/')})` : ''}</span>
                        ))}
                        {(l.totalBeneficiosMes + l.totalBonusMes) > 0 && (
                          <span className="block mt-1 pt-1 border-t border-[#F1F5F9] font-black text-[#0C1D4D]">
                            Total fixo/mês {formatarMoeda(l.totalBeneficiosMes + l.totalBonusMes)}{l.temBeneficioPorDiaria ? ' + diárias' : ''}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const Kpi = ({ titulo, valor, cor, sub }: { titulo: string; valor: string; cor: string; sub?: string }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 print:p-2">
    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{titulo}</p>
    <p className="text-xl font-black" style={{ color: cor }}>{valor}</p>
    {sub && <p className="text-[10px] font-bold text-gray-500 mt-0.5">{sub}</p>}
  </div>
);
