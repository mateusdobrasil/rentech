"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Image from 'next/image';
import { Analytics } from "@vercel/analytics/next";
import logoColorido from '../../../../imgs/logo.png';
import {
  obterRescisaoAction, atualizarItemCalculoAction, recalcularRescisaoAction, atualizarFgtsAction,
  adicionarAnexoRescisaoAction, urlAnexoRescisaoAction, removerAnexoRescisaoAction, homologarRescisaoAction, cancelarRescisaoAction,
  enviarRescisaoParaAssinaturaAction, obterAssinaturaRescisaoAction, atualizarAssinaturaRescisaoAction,
  baixarAssinadoRescisaoAction, gerarPdfRescisaoAction, gerarPdfCompletoRescisaoAction, marcarRescisaoPagaAction,
  type BaseSalarialRescisao
} from '../../actions/actions-rescisao';
import type { ItemRescisao, MotivoRescisao } from '../../../../lib/calculoRescisao';
import { usePageAccess } from '../../../../components/hooks/usePageAccess';
import { HubErro } from '../../../../components/ui/HubStates';
import { useToast } from '../../../../components/ui/NotificationProvider';

const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtMoeda = (v: number | null | undefined) => (v == null ? 'R$ 0,00' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// ============================================================================
// VALOR POR EXTENSO (pt-BR) — mesmo texto usado na prévia do Holerite
// (app/admin/rh/holerite/page.tsx), duplicado aqui porque é uma função local
// não exportada por lá.
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

// ============================================================================
// INPUT COM MÁSCARA DE MOEDA (R$) — mesmo componente usado em holerite/page.tsx
// ============================================================================
function InputMoeda({ value, onChange, className, disabled }: {
  value: number; onChange: (v: number) => void; className?: string; disabled?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitos = e.target.value.replace(/\D/g, '');
    const centavos = digitos ? parseInt(digitos, 10) : 0;
    onChange(centavos / 100);
  };
  return (
    <input type="text" inputMode="numeric" value={fmtMoeda(value)} onChange={handleChange} disabled={disabled} className={className} />
  );
}

// ============================================================================
// LISTA DE ANEXOS — usada tanto pro TRCT (caso CONTABILIDADE) quanto pro
// anexo opcional da contabilidade (caso PRÓPRIO). O "Escolher Arquivo" nativo
// do <input type="file"> some/fica sem aparência de botão em alguns
// navegadores — envolvido num <label> estilizado ele sempre parece clicável.
// ============================================================================
function ListaAnexos({ anexos, podeEditar, enviando, removendoId, onAdd, onRemove, onView }: {
  anexos: { id: number; nome_arquivo: string; criado_em: string }[]; podeEditar: boolean; enviando: boolean;
  removendoId: number | null; onAdd: (file: File) => void; onRemove: (id: number) => void; onView: (id: number) => void;
}) {
  return (
    <div>
      {anexos.length > 0 ? (
        <ul className="space-y-2 mb-3">
          {anexos.map(a => (
            <li key={a.id} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-600 font-medium flex-1 truncate">{a.nome_arquivo}</span>
              <button onClick={() => onView(a.id)} className="text-[10px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg uppercase shrink-0">📎 Ver</button>
              {podeEditar && (
                <button onClick={() => onRemove(a.id)} disabled={removendoId === a.id} className="text-[10px] font-black text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg uppercase shrink-0 disabled:opacity-50">
                  {removendoId === a.id ? '...' : '🗑 Remover'}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-400 font-bold uppercase mb-3">Nenhum anexo enviado ainda.</p>
      )}
      {podeEditar && (
        <div>
          <label className={`inline-flex items-center gap-2 text-[10px] font-black text-white px-4 py-2.5 rounded-lg uppercase cursor-pointer ${enviando ? 'bg-gray-400 pointer-events-none' : 'bg-[#336699] hover:bg-[#284B8C]'}`}>
            📎 {enviando ? 'Enviando...' : 'Escolher Arquivo'}
            <input type="file" accept="application/pdf,image/*" disabled={enviando} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onAdd(f); e.target.value = ''; }} />
          </label>
        </div>
      )}
    </div>
  );
}

const ASSINATURA_STATUS_INFO: Record<string, { label: string; cor: string }> = {
  ENVIADO: { label: 'Enviado — aguardando', cor: 'bg-amber-100 text-amber-700' },
  VISUALIZADO: { label: 'Visualizado pelo funcionário', cor: 'bg-indigo-100 text-indigo-700' },
  ASSINADO: { label: 'Assinado', cor: 'bg-emerald-100 text-emerald-700' },
  REJEITADO: { label: 'Rejeitado', cor: 'bg-red-100 text-red-700' }
};

const MOTIVO_LABEL: Record<string, string> = {
  SEM_JUSTA_CAUSA: 'Sem justa causa (dispensa)', PEDIDO_DEMISSAO: 'Pedido de demissão', JUSTA_CAUSA: 'Justa causa',
  ACORDO_MUTUO: 'Acordo mútuo (CLT 484-A)', TERMINO_CONTRATO_EXPERIENCIA: 'Término de contrato de experiência',
  APOSENTADORIA: 'Aposentadoria'
};
const AVISO_LABEL: Record<string, string> = { INDENIZADO: 'Indenizado', TRABALHADO: 'Trabalhado', ISENTO: 'Não se aplica' };

const STATUS_INFO: Record<string, { label: string; cor: string }> = {
  RASCUNHO: { label: 'Rascunho', cor: 'bg-gray-100 text-gray-500' },
  EM_CALCULO: { label: 'Em cálculo', cor: 'bg-indigo-100 text-indigo-700' },
  AGUARDANDO_DOCUMENTO: { label: 'Aguardando documento', cor: 'bg-amber-100 text-amber-700' },
  AGUARDANDO_HOMOLOGACAO: { label: 'Aguardando homologação', cor: 'bg-amber-100 text-amber-700' },
  HOMOLOGADA: { label: 'Homologada', cor: 'bg-emerald-100 text-emerald-700' },
  CANCELADA: { label: 'Cancelada', cor: 'bg-gray-100 text-gray-400' }
};

const TIPO_LABEL: Record<ItemRescisao['tipo'], { label: string; cor: string }> = {
  PROVENTO: { label: 'Proventos', cor: 'text-emerald-700' },
  DESCONTO: { label: 'Descontos', cor: 'text-red-700' },
  INFORMATIVO: { label: 'Informativo', cor: 'text-gray-500' }
};

interface DadosCalculo {
  itens: ItemRescisao[]; totalProventos: number; totalDescontos: number; valorLiquido: number;
  diasAvisoPrevio: number; dataProjecaoAvisoPrevio: string | null; calculadoEm: string;
}

interface RescisaoRow {
  id: number; funcionario_nome: string; cargo: string | null; departamento: string | null;
  data_admissao: string | null; data_desligamento: string; motivo: MotivoRescisao; tipo_aviso_previo: string | null;
  dias_aviso_previo: number | null; tipo_folha: 'PROPRIO' | 'CONTABILIDADE'; status: string;
  saldo_fgts_informado: number | null; fgts_percentual_multa: number | null; fgts_valor_multa: number | null;
  dados_calculo: DadosCalculo | null; valor_total_liquido: number | null;
  base_salarial_calculo: BaseSalarialRescisao; base_salarial_valor: number | null;
  homologado_em: string | null; homologado_por: string | null;
  pago_em: string | null; pago_lote_id: number | null;
}

interface AnexoRescisao {
  id: number; nome_arquivo: string; tipo_mime: string | null; enviado_por: string | null; criado_em: string;
}

const BASES_SALARIAIS: { value: BaseSalarialRescisao; label: string }[] = [
  { value: 'FOLHA', label: 'Salário Folha' },
  { value: 'CONTRATO', label: 'Salário Contrato Total' },
  { value: 'DIFERENCA', label: 'Diferença (Contrato − Folha)' }
];

// ============================================================================
// DOCUMENTO DO TERMO DE RESCISÃO — mesmo estilo visual da prévia do Holerite
// (HoleriteDoc em app/admin/rh/holerite/page.tsx): logo, cabeçalho de dados,
// duas colunas CRÉDITOS/DÉBITOS e valor líquido por extenso. Pedido do
// usuário 2026-09-18: visualizar a rescisão "igual a previsualização do
// Holerite" em vez de só abrir o PDF gerado numa aba nova.
// ============================================================================
const TermoRescisaoDoc = ({ rescisao, itens, totais, saldoFgts, valorMultaFgts, percentualFgts }: {
  rescisao: RescisaoRow; itens: ItemRescisao[];
  totais: { totalProventos: number; totalDescontos: number; valorLiquido: number };
  saldoFgts: number; valorMultaFgts: number; percentualFgts: string;
}) => {
  const creditos = itens.filter(i => i.tipo === 'PROVENTO');
  const debitos = itens.filter(i => i.tipo === 'DESCONTO');
  const informativos = itens.filter(i => i.tipo === 'INFORMATIVO' && i.valor !== 0);
  const linhasMax = Math.max(creditos.length, debitos.length, 1);

  return (
    <div className="termo-rescisao-doc w-full max-w-5xl bg-white p-2 md:p-8 border border-gray-200 shadow-lg print:border-none print:shadow-none print:p-0 print:max-w-none mx-auto">
      <div className="flex justify-between items-start border-b-2 border-black pb-3 mb-3">
        <Image src={logoColorido} alt="Rentech Logo" width={140} height={44} />
        <div className="text-right">
          <h1 className="text-lg font-black uppercase text-[#0C1D4D] print:text-black">Termo de Rescisão do Contrato de Trabalho</h1>
          <p className="text-sm font-bold text-gray-700">Desligamento: {fmtData(rescisao.data_desligamento)}</p>
          {rescisao.status !== 'HOMOLOGADA' && <p className="text-[10px] font-black text-amber-600 uppercase print:hidden">Prévia — ainda não homologada</p>}
        </div>
      </div>

      <table className="w-full text-xs border-2 border-black mb-3 uppercase font-bold">
        <tbody>
          <tr className="border-b border-black">
            <td className="p-1.5 w-32 border-r border-black bg-gray-100">NOME:</td>
            <td className="p-1.5" colSpan={3}>{rescisao.funcionario_nome}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="p-1.5 w-32 border-r border-black bg-gray-100">FUNÇÃO:</td>
            <td className="p-1.5 border-r border-black">{rescisao.cargo || '—'}</td>
            <td className="p-1.5 w-28 border-r border-black bg-gray-100">DEPARTAMENTO:</td>
            <td className="p-1.5">{rescisao.departamento || '—'}</td>
          </tr>
          <tr className="border-b border-black">
            <td className="p-1.5 w-32 border-r border-black bg-gray-100">ADMISSÃO:</td>
            <td className="p-1.5 border-r border-black">{fmtData(rescisao.data_admissao)}</td>
            <td className="p-1.5 w-28 border-r border-black bg-gray-100">DESLIGAMENTO:</td>
            <td className="p-1.5">{fmtData(rescisao.data_desligamento)}</td>
          </tr>
          <tr>
            <td className="p-1.5 w-32 border-r border-black bg-gray-100">MOTIVO:</td>
            <td className="p-1.5 border-r border-black">{MOTIVO_LABEL[rescisao.motivo] || rescisao.motivo}</td>
            <td className="p-1.5 w-28 border-r border-black bg-gray-100">AVISO PRÉVIO:</td>
            <td className="p-1.5">{AVISO_LABEL[rescisao.tipo_aviso_previo || ''] || '—'} {rescisao.dias_aviso_previo ? `(${rescisao.dias_aviso_previo}d)` : ''}</td>
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
                <th className="p-1 text-left uppercase tracking-wider">Descrição</th>
                <th className="p-1 text-right uppercase tracking-wider">Valores</th>
              </tr>
            </thead>
            <tbody className="font-semibold text-gray-800">
              {creditos.map(item => (
                <tr key={item.codigo}><td className="p-1">{item.descricao}</td><td className="p-1 text-right">{fmtMoeda(item.valor)}</td></tr>
              ))}
              {Array.from({ length: Math.max(0, linhasMax - creditos.length) }).map((_, i) => <tr key={`esp-cred-${i}`}><td className="p-1 text-transparent">_</td><td></td></tr>)}
            </tbody>
          </table>
          <div className="mt-auto border-t-2 border-black bg-gray-100 flex justify-between p-1.5 font-black text-xs"><span>TOTAL CRÉDITO</span><span>{fmtMoeda(totais.totalProventos)}</span></div>
        </div>

        <div className="flex flex-col">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b-2 border-black bg-[#E2E8F0] text-[#0C1D4D] print:text-black">
                <th className="p-1 text-left uppercase tracking-wider">Descrição</th>
                <th className="p-1 text-right uppercase tracking-wider">Valores</th>
              </tr>
            </thead>
            <tbody className="font-semibold text-gray-800">
              {debitos.map(item => (
                <tr key={item.codigo}><td className="p-1">{item.descricao}</td><td className="p-1 text-right">{fmtMoeda(item.valor)}</td></tr>
              ))}
              {Array.from({ length: Math.max(0, linhasMax - debitos.length) }).map((_, i) => <tr key={`esp-deb-${i}`}><td className="p-1 text-transparent">_</td><td></td></tr>)}
            </tbody>
          </table>
          <div className="mt-auto border-t-2 border-black bg-gray-100 flex justify-between p-1.5 font-black text-xs"><span>TOTAL DÉBITO</span><span>{fmtMoeda(totais.totalDescontos)}</span></div>
        </div>
      </div>

      {informativos.length > 0 && (
        <div className="border-x-2 border-b-2 border-black text-[10px] text-gray-500 p-1.5">
          {informativos.map(i => <p key={i.codigo}>ℹ {i.descricao}: {fmtMoeda(i.valor)}</p>)}
        </div>
      )}

      <table className="w-full border-x-2 border-b-2 border-black text-xs">
        <tbody>
          <tr className="border-b border-gray-300"><td className="p-1.5 font-bold bg-gray-100 w-2/3">Valor Líquido a Receber</td><td className="p-1.5 font-black text-right text-base text-emerald-700 print:text-black">{fmtMoeda(totais.valorLiquido)}</td></tr>
          <tr><td className="p-1.5 font-bold bg-gray-100">Valor por Extenso</td><td className="p-1.5 font-bold text-[10px] uppercase">{numeroParaExtenso(totais.valorLiquido)}</td></tr>
        </tbody>
      </table>

      <table className="w-full border-x-2 border-b-2 border-black text-xs mt-3">
        <tbody>
          <tr className="border-b border-gray-300 bg-gray-50">
            <td className="p-1.5 font-black uppercase text-[10px] text-gray-500" colSpan={2}>FGTS (depositado à parte — não soma ao valor líquido acima)</td>
          </tr>
          <tr>
            <td className="p-1.5 font-bold w-2/3">Saldo FGTS informado × multa ({percentualFgts || 0}%)</td>
            <td className="p-1.5 font-black text-right">{fmtMoeda(saldoFgts)} × {percentualFgts || 0}% = {fmtMoeda(valorMultaFgts)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-10 print:mt-8 flex-col items-center justify-center w-2/3 mx-auto flex">
        <div className="border-t-2 border-black w-full mb-1"></div>
        <strong className="text-sm uppercase tracking-wider">{rescisao.funcionario_nome}</strong>
        <p className="text-[10px] mt-0.5 text-gray-600">Assinatura de Quitação de Contrato</p>
        <div className="mt-3 text-[10px] text-gray-500">São Paulo, ____ de ____________________ de 20____.</div>
      </div>
    </div>
  );
};

export default function DetalheRescisaoPage() {
  const router = useRouter();
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  // A permissão é registrada para o módulo (/admin/rh/rescisao), não para
  // cada id individual do segmento dinâmico (que seria algo como
  // /admin/rh/rescisao/42).
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({
    nomeFallback: 'Equipe RH',
    rota: '/admin/rh/rescisao'
  });

  const [loading, setLoading] = useState(true);
  const [rescisao, setRescisao] = useState<RescisaoRow | null>(null);
  const [itens, setItens] = useState<ItemRescisao[]>([]);
  const [saldoFgts, setSaldoFgts] = useState(0);
  const [percentualFgts, setPercentualFgts] = useState('0');
  const [salarioFolha, setSalarioFolha] = useState(0);
  const [salarioContrato, setSalarioContrato] = useState(0);
  const [baseEscolhida, setBaseEscolhida] = useState<BaseSalarialRescisao>('FOLHA');
  const [anexos, setAnexos] = useState<AnexoRescisao[]>([]);
  const [mostrarPrevia, setMostrarPrevia] = useState(false);
  const [opVinculada, setOpVinculada] = useState<{ id: string; numero_op: number; status: string } | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await obterRescisaoAction({ id }, accessToken);
      if (!res.ok) { toast('Erro ao carregar rescisão: ' + res.erro, 'error'); return; }
      const r: RescisaoRow = res.info.rescisao;
      setRescisao(r);
      setItens(r.dados_calculo?.itens || []);
      setSaldoFgts(Number(r.saldo_fgts_informado ?? 0));
      setPercentualFgts(String(r.fgts_percentual_multa ?? 0));
      setSalarioFolha(Number(res.info.salarioFolha) || 0);
      setSalarioContrato(Number(res.info.salarioContrato) || 0);
      setBaseEscolhida(r.base_salarial_calculo || 'FOLHA');
      setAnexos(res.info.anexos || []);
      setOpVinculada(res.info.opVinculada || null);
    } catch (e: any) { toast('Erro ao carregar rescisão: ' + e.message, 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!authLoading && !acessoNegado && id) carregar(); }, [authLoading, acessoNegado, id]);

  const totaisLocais = useMemo(() => {
    const totalProventos = Math.round(itens.filter(i => i.tipo === 'PROVENTO').reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
    const totalDescontos = Math.round(itens.filter(i => i.tipo === 'DESCONTO').reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
    return { totalProventos, totalDescontos, valorLiquido: Math.round((totalProventos - totalDescontos) * 100) / 100 };
  }, [itens]);

  const valorMultaFgts = useMemo(() => {
    const pct = Number(percentualFgts) || 0;
    return Math.round(saldoFgts * (pct / 100) * 100) / 100;
  }, [saldoFgts, percentualFgts]);

  const editarValorItem = (codigo: string, novoValor: number) => {
    setItens(prev => prev.map(i => i.codigo === codigo ? { ...i, valor: novoValor } : i));
  };

  // "Outros descontos" não vem de nenhuma fórmula — o RH descreve do que se
  // trata (ex.: uniforme não devolvido, dano a equipamento).
  const editarDescricaoItem = (codigo: string, novaDescricao: string) => {
    setItens(prev => prev.map(i => i.codigo === codigo ? { ...i, descricao: novaDescricao || 'Outros descontos' } : i));
  };

  const [salvandoItens, setSalvandoItens] = useState(false);
  const salvarItens = async () => {
    setSalvandoItens(true);
    try {
      const res = await atualizarItemCalculoAction({ id, itens }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { toast('Erro ao salvar alterações: ' + e.message, 'error'); }
    finally { setSalvandoItens(false); }
  };

  const [recalculando, setRecalculando] = useState(false);
  const recalcular = async () => {
    if (!confirm('Recalcular vai sobrescrever qualquer edição manual feita nas linhas do cálculo e atualizar a estimativa do saldo do FGTS (mantendo o percentual da multa já salvo). Continuar?')) return;
    setRecalculando(true);
    try {
      const res = await recalcularRescisaoAction({ id, baseSalarialCalculo: baseEscolhida }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      // Atualiza os itens/totais do cálculo e o saldo estimado do FGTS — não
      // usa carregar() aqui pra não sobrescrever o percentual da multa caso
      // o usuário tenha uma edição própria ainda não salva nesse campo.
      setItens(res.info.dadosCalculo.itens);
      setRescisao(prev => prev ? {
        ...prev, dados_calculo: res.info.dadosCalculo, valor_total_liquido: res.info.dadosCalculo.valorLiquido,
        base_salarial_calculo: res.info.baseSalarialCalculo, base_salarial_valor: res.info.baseSalarialValor
      } : prev);
      setSaldoFgts(res.info.saldoFgtsInformado);
    } catch (e: any) { toast('Erro ao recalcular: ' + e.message, 'error'); }
    finally { setRecalculando(false); }
  };

  const [salvandoFgts, setSalvandoFgts] = useState(false);
  const salvarFgts = async () => {
    setSalvandoFgts(true);
    try {
      const res = await atualizarFgtsAction({ id, saldoFgtsInformado: saldoFgts, percentualOverride: Number(percentualFgts) || 0 }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { toast('Erro ao salvar FGTS: ' + e.message, 'error'); }
    finally { setSalvandoFgts(false); }
  };

  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [removendoAnexoId, setRemovendoAnexoId] = useState<number | null>(null);
  const fileParaBase64 = (file: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej; r.readAsDataURL(file);
  });
  const adicionarAnexo = async (file: File) => {
    setEnviandoArquivo(true);
    try {
      const arquivoBase64 = await fileParaBase64(file);
      const res = await adicionarAnexoRescisaoAction({ id, arquivoBase64, nomeArquivo: file.name, tipoMime: file.type, usuarioNome: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { toast('Erro ao enviar arquivo: ' + e.message, 'error'); }
    finally { setEnviandoArquivo(false); }
  };

  const removerAnexo = async (anexoId: number) => {
    if (!confirm('Remover este anexo?')) return;
    setRemovendoAnexoId(anexoId);
    try {
      const res = await removerAnexoRescisaoAction({ anexoId }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { toast('Erro ao remover anexo: ' + e.message, 'error'); }
    finally { setRemovendoAnexoId(null); }
  };

  const abrirAnexo = async (anexoId: number) => {
    try {
      const res = await urlAnexoRescisaoAction({ anexoId }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { toast('Erro ao abrir anexo: ' + e.message, 'error'); }
  };

  // Gera o termo de rescisão em PDF a partir do que foi calculado (mesmo
  // padrão da prévia de holerite: base64 → Blob → abre numa aba nova).
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const visualizarTermoCalculado = async () => {
    setGerandoPdf(true);
    try {
      const res = await gerarPdfRescisaoAction({ id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const bin = atob(res.info.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { toast('Erro ao gerar o termo: ' + e.message, 'error'); }
    finally { setGerandoPdf(false); }
  };

  // Mesmo termo calculado ACIMA + TODOS os anexos (extrato FGTS, exame
  // demissional etc.), juntos num PDF só, na mesma ordem em que vão pra
  // assinatura (ver gerarPdfCompletoRescisaoAction) — pedido do usuário
  // 2026-09-18 pra não precisar abrir anexo por anexo pra conferir tudo.
  const [gerandoPdfCompleto, setGerandoPdfCompleto] = useState(false);
  const visualizarTermoCompleto = async () => {
    setGerandoPdfCompleto(true);
    try {
      const res = await gerarPdfCompletoRescisaoAction({ id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const bin = atob(res.info.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { toast('Erro ao gerar o termo completo: ' + e.message, 'error'); }
    finally { setGerandoPdfCompleto(false); }
  };

  const [homologando, setHomologando] = useState(false);
  const homologar = async () => {
    if (!confirm('Homologar esta rescisão vai marcar o funcionário como inativo, gravar a data de desligamento na ficha e lançar a movimentação de demissão. Esta ação não é facilmente reversível. Continuar?')) return;
    setHomologando(true);
    try {
      const res = await homologarRescisaoAction({ id, usuarioNome: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { toast('Erro ao homologar: ' + e.message, 'error'); }
    finally { setHomologando(false); }
  };

  const [marcandoPago, setMarcandoPago] = useState(false);
  const marcarPago = async (pago: boolean) => {
    const msg = pago
      ? 'Marcar esta rescisão como paga? Ela deixará de aparecer no filtro "Rescisão" do lote de pagamento em /admin/financeiro/rh.'
      : 'Desfazer a marcação de paga? A rescisão volta a aparecer no filtro "Rescisão" do lote de pagamento.';
    if (!confirm(msg)) return;
    setMarcandoPago(true);
    try {
      const res = await marcarRescisaoPagaAction({ id, pago, usuarioNome: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { toast('Erro ao atualizar status de pagamento: ' + e.message, 'error'); }
    finally { setMarcandoPago(false); }
  };

  const [cancelando, setCancelando] = useState(false);
  const cancelar = async () => {
    if (!confirm('Cancelar esta rescisão?')) return;
    setCancelando(true);
    try {
      const res = await cancelarRescisaoAction({ id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      if (res.info?.avisoManual) toast('Rescisão cancelada. Como já estava homologada, ajuste manualmente a ficha do funcionário (ativo/data de desligamento) se necessário.', 'info');
      await carregar();
    } catch (e: any) { toast('Erro ao cancelar: ' + e.message, 'error'); }
    finally { setCancelando(false); }
  };

  // ==========================================================================
  // ASSINATURA (Autentique) — só depois de homologada.
  // ==========================================================================
  interface AssinaturaInfo { status: string; link_assinatura: string | null; sandbox: boolean; enviado_em: string | null; assinado_em: string | null; }
  const [assinatura, setAssinatura] = useState<AssinaturaInfo | null>(null);
  const [sandboxAssinatura, setSandboxAssinatura] = useState(true);
  const [enviandoAssinatura, setEnviandoAssinatura] = useState(false);
  const [atualizandoAssinatura, setAtualizandoAssinatura] = useState(false);
  const [baixandoAssinado, setBaixandoAssinado] = useState(false);

  const carregarAssinatura = async () => {
    const res = await obterAssinaturaRescisaoAction({ id }, accessToken);
    if (res.ok) setAssinatura(res.info.assinatura);
  };

  useEffect(() => { if (rescisao?.status === 'HOMOLOGADA') carregarAssinatura(); }, [rescisao?.status]);

  const enviarParaAssinatura = async () => {
    if (!confirm(
      'Enviar o TRCT para assinatura do funcionário via Autentique?\n\n' +
      (sandboxAssinatura ? '🧪 MODO TESTE (sandbox): não gasta créditos.' : '⚠ MODO REAL: consome um documento do plano Autentique.')
    )) return;
    setEnviandoAssinatura(true);
    try {
      const res = await enviarRescisaoParaAssinaturaAction({ id, usuarioNome: usuarioAtual, sandbox: sandboxAssinatura }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregarAssinatura();
    } catch (e: any) { toast('Erro ao enviar para assinatura: ' + e.message, 'error'); }
    finally { setEnviandoAssinatura(false); }
  };

  const atualizarStatusAssinatura = async () => {
    setAtualizandoAssinatura(true);
    try {
      const res = await atualizarAssinaturaRescisaoAction({ id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      await carregarAssinatura();
    } catch (e: any) { toast('Erro ao atualizar status: ' + e.message, 'error'); }
    finally { setAtualizandoAssinatura(false); }
  };

  const baixarAssinado = async () => {
    setBaixandoAssinado(true);
    try {
      const res = await baixarAssinadoRescisaoAction({ id }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { toast('Erro ao baixar assinado: ' + e.message, 'error'); }
    finally { setBaixandoAssinado(false); }
  };

  if (authLoading || (loading && !rescisao)) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Carregando...</h2>
        </div>
      </div>
    );
  }

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Rescisão de Funcionário.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  if (!rescisao) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full">
          <p className="text-sm text-gray-500 mb-6">Rescisão não encontrada.</p>
          <button onClick={() => router.push('/admin/rh/rescisao')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar</button>
        </div>
      </div>
    );
  }

  const ehFinal = rescisao.status === 'HOMOLOGADA' || rescisao.status === 'CANCELADA';
  const podeHomologar = !ehFinal && (rescisao.tipo_folha === 'PROPRIO' ? !!rescisao.dados_calculo : anexos.length > 0);
  // Sem vínculo com a contabilidade (folha própria) o termo é gerado na hora
  // a partir do cálculo — não depende de anexo pra poder enviar.
  const podeEnviarAssinatura = anexos.length > 0 || (rescisao.tipo_folha === 'PROPRIO' && !!rescisao.dados_calculo);

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-red-50 border-b border-red-200 px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-red-700 font-medium text-sm">📤 <strong>Rescisão de Funcionário</strong></p>
        <button onClick={() => router.push('/admin/rh/rescisao')} className="text-[10px] md:text-xs font-black bg-white hover:bg-red-100 border border-red-200 text-red-700 px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1000px] mx-auto w-full space-y-4">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div>
              <h1 className="text-xl font-black text-[#0C1D4D]">{rescisao.funcionario_nome}</h1>
              <p className="text-[11px] text-gray-500 font-bold uppercase mt-1">{rescisao.cargo || '—'} · {rescisao.departamento || '—'}</p>
            </div>
            <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase ${STATUS_INFO[rescisao.status]?.cor}`}>
              {STATUS_INFO[rescisao.status]?.label || rescisao.status}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Admissão</p>
              <p className="text-sm font-bold text-gray-700">{fmtData(rescisao.data_admissao)}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Desligamento</p>
              <p className="text-sm font-bold text-gray-700">{fmtData(rescisao.data_desligamento)}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Motivo</p>
              <p className="text-sm font-bold text-gray-700">{MOTIVO_LABEL[rescisao.motivo] || rescisao.motivo}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Aviso prévio</p>
              <p className="text-sm font-bold text-gray-700">{AVISO_LABEL[rescisao.tipo_aviso_previo || ''] || '—'} {rescisao.dias_aviso_previo ? `(${rescisao.dias_aviso_previo}d)` : ''}</p>
            </div>
          </div>
          {rescisao.status === 'HOMOLOGADA' && (
            <p className="text-[10px] text-emerald-700 font-bold mt-3">✓ Homologada em {rescisao.homologado_em ? new Date(rescisao.homologado_em).toLocaleString('pt-BR') : '—'} por {rescisao.homologado_por || '—'}.</p>
          )}
          {rescisao.pago_em && (
            <p className="text-[10px] text-emerald-700 font-bold mt-1">
              💰 {rescisao.pago_lote_id
                ? `Pago via PIX em ${new Date(rescisao.pago_em).toLocaleString('pt-BR')} (Financeiro RH, lote #${rescisao.pago_lote_id}).`
                : `Marcado como paga em ${new Date(rescisao.pago_em).toLocaleString('pt-BR')}.`}
            </p>
          )}
        </div>

        {/* Ações pós-homologação: visualizar TRCT e enviar para assinatura (Autentique) */}
        {rescisao.status === 'HOMOLOGADA' && (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
            <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Ações</h3>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={visualizarTermoCompleto}
                disabled={gerandoPdfCompleto || (rescisao.tipo_folha !== 'PROPRIO' && anexos.length === 0)}
                title="Junta o termo calculado (se houver) com todos os anexos, num único PDF"
                className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-lg uppercase disabled:opacity-50"
              >
                {gerandoPdfCompleto ? 'Gerando...' : '👁 Visualizar Termo Calculado'}
              </button>

              {!assinatura ? (
                <>
                  <label className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider cursor-pointer bg-gray-50 px-3 h-[38px] rounded-lg border border-gray-200 select-none">
                    <input type="checkbox" checked={sandboxAssinatura} onChange={e => setSandboxAssinatura(e.target.checked)} className="accent-amber-600" />
                    <span className={sandboxAssinatura ? 'text-amber-600' : 'text-red-600'}>{sandboxAssinatura ? '🧪 Teste' : '⚠ Real'}</span>
                  </label>
                  <button
                    onClick={enviarParaAssinatura} disabled={enviandoAssinatura || !podeEnviarAssinatura}
                    className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 rounded-lg uppercase disabled:opacity-50"
                  >
                    {enviandoAssinatura ? 'Enviando...' : '📤 Enviar para assinatura'}
                  </button>
                  {!podeEnviarAssinatura && <span className="text-[10px] text-gray-400 font-bold uppercase">Anexe o TRCT antes de enviar.</span>}
                </>
              ) : (
                <>
                  <span className={`text-[9px] font-black px-3 py-1.5 rounded-full uppercase ${ASSINATURA_STATUS_INFO[assinatura.status]?.cor || 'bg-gray-100 text-gray-500'}`}>
                    {ASSINATURA_STATUS_INFO[assinatura.status]?.label || assinatura.status}
                    {assinatura.sandbox && ' · teste'}
                  </span>
                  {assinatura.status !== 'ASSINADO' && (
                    <button onClick={atualizarStatusAssinatura} disabled={atualizandoAssinatura} className="text-[10px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                      {atualizandoAssinatura ? 'Atualizando...' : '↻ Atualizar status'}
                    </button>
                  )}
                  {assinatura.status !== 'ASSINADO' && assinatura.link_assinatura && (
                    <button onClick={() => window.open(assinatura.link_assinatura!, '_blank', 'noopener,noreferrer')} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-3 py-1.5 rounded-lg uppercase">
                      🔗 Link de assinatura
                    </button>
                  )}
                  {assinatura.status === 'ASSINADO' && (
                    <button onClick={baixarAssinado} disabled={baixandoAssinado} className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                      {baixandoAssinado ? 'Baixando...' : '⬇ Baixar assinado'}
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#E2E8F0]">
              {rescisao.tipo_folha === 'PROPRIO' && !rescisao.pago_em && (rescisao.valor_total_liquido || 0) > 0 && (
                opVinculada ? (
                  <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-lg uppercase" title="Reprove a OP existente (em /admin/financeiro/ops) para poder criar uma nova.">
                    🔒 Já existe a OP #{opVinculada.numero_op} ({opVinculada.status}) para esta rescisão
                  </span>
                ) : (
                  <button
                    onClick={() => router.push(`/admin/op/nova?rescisaoId=${id}`)}
                    className="text-[10px] font-black text-white bg-[#0C1D4D] hover:bg-[#284B8C] px-4 py-2.5 rounded-lg uppercase"
                    title="Abre a Nova OP já preenchida com os dados desta rescisão — confira e envie por lá."
                  >
                    💳 Criar OP de Pagamento
                  </button>
                )
              )}
              {!rescisao.pago_em ? (
                <button onClick={() => marcarPago(true)} disabled={marcandoPago} className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 rounded-lg uppercase disabled:opacity-50">
                  {marcandoPago ? 'Salvando...' : '💰 Marcar como paga'}
                </button>
              ) : !rescisao.pago_lote_id ? (
                <button onClick={() => marcarPago(false)} disabled={marcandoPago} className="text-[10px] font-black text-gray-500 bg-gray-100 hover:bg-gray-200 px-4 py-2.5 rounded-lg uppercase disabled:opacity-50">
                  {marcandoPago ? 'Salvando...' : '↺ Desfazer marcação de paga'}
                </button>
              ) : (
                <span className="text-[10px] font-black text-gray-400 uppercase">Paga via lote bancário — não pode ser desmarcada por aqui.</span>
              )}
            </div>
          </div>
        )}

        {rescisao.tipo_folha === 'CONTABILIDADE' ? (
          <>
            {/* CASO CONTABILIDADE */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <p className="text-sm font-bold text-gray-600">📎 Folha administrada pela contabilidade — nenhum valor é calculado aqui. Anexe o TRCT enviado pela contabilidade para poder homologar.</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">TRCT</h3>
              <p className="text-[10px] text-gray-400 font-medium mb-3">Pode anexar mais de um arquivo (ex.: TRCT + extrato do FGTS + exame demissional) — todos vão juntos, num documento só, pra assinatura.</p>
              <ListaAnexos
                anexos={anexos} podeEditar={!ehFinal} enviando={enviandoArquivo} removendoId={removendoAnexoId}
                onAdd={adicionarAnexo} onRemove={removerAnexo} onView={abrirAnexo}
              />
            </div>
          </>
        ) : (
          <>
            {/* CASO PRÓPRIO */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-xs font-bold text-amber-800">⚠️ Valores calculados automaticamente com base em regras gerais da CLT. Confira e ajuste com a contabilidade antes de homologar — não é fonte legal autoritativa.</p>
            </div>

            <div id="calculo-rescisao-card" className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              <div className="flex justify-between items-center p-4 border-b border-[#E2E8F0]">
                <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Cálculo da rescisão</h3>
                <div className="flex gap-2">
                  <button onClick={() => setMostrarPrevia(m => !m)} className={`text-[10px] font-black px-3 py-1.5 rounded-lg uppercase ${mostrarPrevia ? 'text-white bg-indigo-700' : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100'}`}>
                    {mostrarPrevia ? '✕ Fechar prévia' : '👁 Prévia'}
                  </button>
                  <button onClick={visualizarTermoCalculado} disabled={gerandoPdf} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                    {gerandoPdf ? 'Gerando...' : '⬇ Baixar PDF do Termo'}
                  </button>
                  {!ehFinal && (
                    <button onClick={recalcular} disabled={recalculando} className="text-[10px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                      {recalculando ? 'Recalculando...' : '↻ Recalcular automaticamente'}
                    </button>
                  )}
                </div>
              </div>

              {mostrarPrevia && (
                <div className="p-4 bg-[#F0F4F8] border-b border-[#E2E8F0]">
                  <TermoRescisaoDoc rescisao={rescisao} itens={itens} totais={totaisLocais} saldoFgts={saldoFgts} valorMultaFgts={valorMultaFgts} percentualFgts={percentualFgts} />
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 border-b border-[#E2E8F0] bg-gray-50">
                <label className="text-[10px] font-black text-gray-500 uppercase whitespace-nowrap">Base salarial do cálculo</label>
                {ehFinal ? (
                  <span className="text-xs font-bold text-[#0C1D4D]">{BASES_SALARIAIS.find(b => b.value === rescisao.base_salarial_calculo)?.label || rescisao.base_salarial_calculo}</span>
                ) : (
                  <select value={baseEscolhida} onChange={e => setBaseEscolhida(e.target.value as BaseSalarialRescisao)} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-white w-full sm:w-auto">
                    {BASES_SALARIAIS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                )}
                <span className="text-[10px] font-bold text-gray-400">
                  Folha: {fmtMoeda(salarioFolha)} • Contrato: {fmtMoeda(salarioContrato)} • Usado no último cálculo: <strong className="text-gray-600">{fmtMoeda(rescisao.base_salarial_valor)}</strong>
                  {!ehFinal && baseEscolhida !== rescisao.base_salarial_calculo && ' — clique em "Recalcular" para aplicar'}
                </span>
              </div>

              {(['PROVENTO', 'DESCONTO', 'INFORMATIVO'] as const).map(tipo => {
                const linhas = itens.filter(i => i.tipo === tipo);
                if (linhas.length === 0) return null;
                return (
                  <div key={tipo} className="border-b border-[#E2E8F0] last:border-b-0">
                    <p className={`text-[10px] font-black uppercase tracking-widest px-4 pt-3 pb-1 ${TIPO_LABEL[tipo].cor}`}>{TIPO_LABEL[tipo].label}</p>
                    {linhas.map(item => (
                      <div key={item.codigo} className="flex items-center gap-3 px-4 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-700 truncate">{item.codigo === 'OUTROS_DESCONTOS' ? 'Outros descontos' : item.descricao}</p>
                          {item.codigo === 'OUTROS_DESCONTOS' ? (
                            <input
                              type="text" disabled={ehFinal}
                              placeholder="Descreva do que se trata (ex.: uniforme não devolvido, dano a equipamento)"
                              value={item.descricao.replace(/^Outros descontos:\s*/, '').replace(/^Outros descontos$/, '')}
                              onChange={e => editarDescricaoItem(item.codigo, e.target.value ? `Outros descontos: ${e.target.value}` : 'Outros descontos')}
                              className="text-[10px] text-gray-500 w-full border-b border-dashed border-gray-300 focus:border-indigo-400 outline-none bg-transparent py-0.5 disabled:text-gray-400"
                            />
                          ) : (
                            <p className="text-[10px] text-gray-400 truncate">{item.formula}</p>
                          )}
                        </div>
                        <InputMoeda
                          value={item.valor} disabled={ehFinal}
                          onChange={v => editarValorItem(item.codigo, v)}
                          className="w-36 p-2 border border-gray-300 rounded-lg text-sm font-black text-right tabular-nums disabled:bg-gray-100"
                        />
                      </div>
                    ))}
                  </div>
                );
              })}

              {!ehFinal && (
                <div className="p-4 flex justify-end">
                  <button onClick={salvarItens} disabled={salvandoItens} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-4 py-2.5 rounded-lg uppercase disabled:opacity-50">
                    {salvandoItens ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                </div>
              )}

              <div className="bg-[#F8FAFC] p-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Proventos</p>
                  <p className="text-lg font-black text-emerald-700">{fmtMoeda(totaisLocais.totalProventos)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Descontos</p>
                  <p className="text-lg font-black text-red-700">{fmtMoeda(totaisLocais.totalDescontos)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Valor líquido</p>
                  <p className="text-lg font-black text-[#0C1D4D]">{fmtMoeda(totaisLocais.valorLiquido)}</p>
                </div>
              </div>
            </div>

            {/* FGTS */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Multa do FGTS</h3>
              <p className="text-[10px] text-gray-400 font-medium mb-3">O saldo abaixo já vem com um cálculo prévio (estimativa de 8% do salário × meses de casa) — corrija com o valor real do extrato do FGTS/contabilidade antes de homologar. Valor depositado na conta do FGTS, não soma ao valor líquido pago no TRCT.</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Saldo FGTS informado</label>
                  <InputMoeda value={saldoFgts} disabled={ehFinal} onChange={setSaldoFgts} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Percentual da multa</label>
                  <input type="number" step="0.01" value={percentualFgts} disabled={ehFinal} onChange={e => setPercentualFgts(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Valor da multa</label>
                  <p className="p-2.5 text-sm font-black text-[#0C1D4D]">{fmtMoeda(valorMultaFgts)}</p>
                </div>
              </div>
              {!ehFinal && (
                <div className="flex justify-end mt-3">
                  <button onClick={salvarFgts} disabled={salvandoFgts} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-4 py-2.5 rounded-lg uppercase disabled:opacity-50">
                    {salvandoFgts ? 'Salvando...' : 'Salvar FGTS'}
                  </button>
                </div>
              )}
            </div>

            {/* Anexo(s) opcional(is) da contabilidade — somam ao nosso termo
                calculado (mergePdfs) na hora de enviar pra assinatura, não o
                substituem. */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Anexos da Contabilidade (opcional)</h3>
              <p className="text-[10px] text-gray-400 font-medium mb-3">Ex.: extrato do FGTS, exame demissional. Pode anexar mais de um — todos são enviados JUNTO com o nosso termo de rescisão calculado acima, num documento só, mesma assinatura. Não substitui o cálculo.</p>
              {/* Diferente do resto do painel (travado em !ehFinal): estes
                  anexos continuam editáveis mesmo já HOMOLOGADA, porque o
                  envio pra assinatura só é permitido DEPOIS de homologar — o
                  documento da contabilidade (ex.: extrato do FGTS) muitas
                  vezes só chega nessa altura. Só CANCELADA trava de vez. */}
              <ListaAnexos
                anexos={anexos} podeEditar={rescisao.status !== 'CANCELADA'} enviando={enviandoArquivo} removendoId={removendoAnexoId}
                onAdd={adicionarAnexo} onRemove={removerAnexo} onView={abrirAnexo}
              />
            </div>
          </>
        )}

        {/* Ações finais */}
        {!ehFinal && (
          <div className="flex justify-end gap-3 pb-8">
            <button onClick={cancelar} disabled={cancelando} className="text-xs font-black text-gray-500 bg-gray-100 hover:bg-gray-200 px-5 py-3 rounded-xl uppercase tracking-wider disabled:opacity-50">
              {cancelando ? 'Cancelando...' : 'Cancelar rescisão'}
            </button>
            <button onClick={homologar} disabled={!podeHomologar || homologando} className="text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 px-6 py-3 rounded-xl uppercase tracking-wider disabled:opacity-50">
              {homologando ? 'Homologando...' : '✓ Homologar Rescisão'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
