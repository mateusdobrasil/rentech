"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarEquipamentosAction, carregarEquipamentoAction, salvarConfigEquipamentoAction, definirControleEmMassaAction,
  salvarSaldoAction, excluirSaldoAction, salvarPatrimonioAction, gerarPatrimoniosLoteAction, excluirPatrimonioAction,
  importarPatrimoniosP2sAction, salvarKitAction, buscarProdutosAction, cargaSaldosP2sAction,
  type ControleLocacao, type SituacaoPatrimonio, type DadosPatrimonio,
} from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { gerarEtiquetasPatrimonioPdf } from '../../../lib/locacao/etiquetasPatrimonio';

// Equipamentos de Locação (2026-11-16): como cada produto locável é
// controlado (INDIVIDUAL × QUANTIDADE), saldos, patrimônios, kit e etiquetas.

interface EmpresaOpcao { id: number; nome: string }
interface LinhaEquip {
  produto_id: number; nome: string; codigo: string | null; unidade: string | null; categoria: string | null;
  controle_locacao: ControleLocacao; dias_preparo: number; dias_retorno: number;
  valor_indenizacao: number | null; custo_reposicao: number | null;
  saldos: Record<number, { total: number; manutencao: number }>;
  patrimonios: Record<number, { ativos: number; manutencao: number }>;
  eh_kit: boolean;
}
interface Saldo { id: number; produto_id: number; empresa_id: number; local: string; quantidade_total: number; quantidade_manutencao: number; observacoes: string | null; updated_at: string }
interface Patrimonio {
  id: number; produto_id: number; empresa_id: number; numero_patrimonio: string; numero_serie: string | null; qr_code: string | null;
  situacao: SituacaoPatrimonio; local: string | null; custo_aquisicao: number | null; data_aquisicao: string | null;
  nota_fiscal_compra: string | null; observacoes: string | null; tag_identificacao: string | null; p2s_oid: string | null;
}
interface ItemKit { componente_produto_id: number; quantidade: number; opcional: boolean; nome: string; codigo: string | null; unidade: string | null }
interface Detalhe {
  empresas: EmpresaOpcao[];
  produto: any;
  saldos: Saldo[];
  patrimonios: Patrimonio[];
  kit: ItemKit[];
  usadoEmKits: { id: number; nome: string; codigo: string | null; quantidade: number }[];
}
type Aba = 'config' | 'saldos' | 'patrimonios' | 'kit';

const SITUACOES: { v: SituacaoPatrimonio; rot: string; cls: string }[] = [
  { v: 'ATIVO', rot: 'Ativo', cls: 'bg-green-100 text-green-700' },
  { v: 'MANUTENCAO', rot: 'Manutenção', cls: 'bg-amber-100 text-amber-700' },
  { v: 'BAIXADO', rot: 'Baixado', cls: 'bg-gray-100 text-gray-500' },
  { v: 'EXTRAVIADO', rot: 'Extraviado', cls: 'bg-red-100 text-red-600' },
];
const corSituacao = (s: SituacaoPatrimonio) => SITUACOES.find(x => x.v === s)?.cls || '';
const rotSituacao = (s: SituacaoPatrimonio) => SITUACOES.find(x => x.v === s)?.rot || s;

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
function lerNumero(s: string): number | null {
  const t = (s || '').replace(/\s|R\$/g, '');
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : NaN;
}

export default function EquipamentosLocacaoPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [empresas, setEmpresas] = useState<EmpresaOpcao[]>([]);
  const [linhas, setLinhas] = useState<LinhaEquip[]>([]);
  const [ultimaCarga, setUltimaCarga] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroControle, setFiltroControle] = useState<'' | ControleLocacao>('');
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  const [soComSaldo, setSoComSaldo] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [carregandoP2s, setCarregandoP2s] = useState(false);
  const [resultadoCarga, setResultadoCarga] = useState<any>(null);

  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = async () => {
    setCarregando(true);
    const r = await listarEquipamentosAction(accessToken);
    if (r.ok) {
      setEmpresas(r.info.empresas); setLinhas(r.info.linhas); setUltimaCarga(r.info.ultimaAtualizacaoSaldo);
    } else toast(r.erro || 'Erro ao carregar.', 'error');
    setCarregando(false);
  };

  useEffect(() => {
    if (!authLoading && !acessoNegado && !erro && accessToken) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken]);

  const categorias = useMemo(() => [...new Set(linhas.map(l => l.categoria).filter(Boolean) as string[])].sort(), [linhas]);
  const empresasMostradas = filtroEmpresa ? empresas.filter(e => e.id === filtroEmpresa) : empresas;

  const qtdDisponivel = (l: LinhaEquip, empresaId: number) => {
    if (l.controle_locacao === 'INDIVIDUAL') return l.patrimonios[empresaId]?.ativos || 0;
    const s = l.saldos[empresaId];
    return s ? s.total - s.manutencao : 0;
  };
  const qtdManutencao = (l: LinhaEquip, empresaId: number) =>
    l.controle_locacao === 'INDIVIDUAL' ? (l.patrimonios[empresaId]?.manutencao || 0) : (l.saldos[empresaId]?.manutencao || 0);

  const visiveis = linhas.filter(l => {
    if (filtroCategoria && l.categoria !== filtroCategoria) return false;
    if (filtroControle && l.controle_locacao !== filtroControle) return false;
    if (soComSaldo && !empresasMostradas.some(e => qtdDisponivel(l, e.id) + qtdManutencao(l, e.id) > 0)) return false;
    const t = busca.trim().toLowerCase();
    if (t && ![l.nome, l.codigo, l.categoria].some(x => (x || '').toLowerCase().includes(t))) return false;
    return true;
  });

  const cargaP2s = async () => {
    const ok = await confirmar({
      title: 'Carregar saldos do P2S',
      confirmLabel: 'Carregar',
      message: 'Lê no PrimeStart o saldo de cada produto locável nos estoques "LOCAÇÃO" e "MANUTENÇÃO" de cada empresa e grava no local PRINCIPAL. Isso SOBRESCREVE os saldos do local PRINCIPAL que vierem do P2S (ajustes manuais nesse local se perdem). Leva cerca de 10 segundos.',
    });
    if (!ok) return;
    setCarregandoP2s(true);
    const r = await cargaSaldosP2sAction(accessToken);
    setCarregandoP2s(false);
    if (!r.ok) return toast(r.erro || 'Erro na carga.', 'error');
    setResultadoCarga(r.info);
    toast('Saldos carregados do P2S.', 'success');
    carregar();
  };

  const definirEmMassa = async (controle: ControleLocacao) => {
    const ids = [...selecionados];
    const ok = await confirmar({
      title: controle === 'INDIVIDUAL' ? 'Controlar por patrimônio' : 'Controlar por quantidade',
      confirmLabel: 'Confirmar',
      message: controle === 'INDIVIDUAL'
        ? `${ids.length} produto(s) passam a ser controlados peça a peça. A disponibilidade deles vai contar os PATRIMÔNIOS cadastrados (não mais o saldo). Cadastre ou importe as peças de cada um.`
        : `${ids.length} produto(s) passam a ser controlados por quantidade (saldo). Os patrimônios cadastrados continuam guardados, mas não contam na disponibilidade.`,
    });
    if (!ok) return;
    const r = await definirControleEmMassaAction(ids, controle, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast('Controle atualizado.', 'success');
    setSelecionados(new Set());
    carregar();
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Equipamentos de Locação.</p>
          <button onClick={() => router.push('/admin/estoque')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Hub
          </button>
        </div>
      </div>
    );
  }

  const totalIndividual = linhas.filter(l => l.controle_locacao === 'INDIVIDUAL').length;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          🎛️ <strong>Olá, {usuarioAtual}</strong>. Equipamentos de locação: controle, saldos, patrimônios e kits.
        </p>
        <button onClick={() => router.push('/admin/estoque')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-6">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
              <p className="text-2xl font-black text-[#0C1D4D]">{carregando ? '—' : linhas.length}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Produtos locáveis</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
              <p className="text-2xl font-black text-[#0C1D4D]">{carregando ? '—' : totalIndividual}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Por patrimônio (individual)</p>
            </div>
            {empresas.map(e => {
              const un = linhas.reduce((s, l) => s + qtdDisponivel(l, e.id), 0);
              return (
                <div key={e.id} className="bg-white p-4 rounded-2xl border border-[#E2E8F0] shadow-sm">
                  <p className="text-2xl font-black text-[#0C1D4D]">{carregando ? '—' : fmtQtd(un)}</p>
                  <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">Unidades disponíveis · {e.nome}</p>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div>
                <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Carga de saldos do P2S</h2>
                <p className="text-xs text-[#64748B] max-w-3xl">
                  Traz do PrimeStart o saldo atual de cada produto nos estoques <strong>LOCAÇÃO</strong> e <strong>MANUTENÇÃO</strong> de cada empresa.
                  Use para a carga inicial e, durante a transição, sempre que quiser realinhar com o P2S.
                  {ultimaCarga && <> Último saldo gravado em {new Date(ultimaCarga).toLocaleString('pt-BR')}.</>}
                </p>
              </div>
              <button onClick={cargaP2s} disabled={carregandoP2s}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-bold uppercase text-xs tracking-wider flex-shrink-0">
                {carregandoP2s ? 'Carregando...' : '⬇ Carregar saldos do P2S'}
              </button>
            </div>
            {resultadoCarga && (
              <div className="mt-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 text-xs space-y-1">
                {(resultadoCarga.porEmpresa as any[]).map(x => (
                  <p key={x.empresa}><strong>{x.empresa}:</strong> {x.produtos} produtos com saldo · {fmtQtd(x.unidades)} unidades ({fmtQtd(x.manutencao)} em manutenção)</p>
                ))}
                <p className="text-gray-500">{resultadoCarga.totalProdutos} produtos lidos · {resultadoCarga.semMovimento} sem nenhum movimento no P2S</p>
                {Object.keys(resultadoCarga.ignoradosPorEstoque).length > 0 && (
                  <p className="text-gray-500">Estoques ignorados: {Object.entries(resultadoCarga.ignoradosPorEstoque).map(([k, v]) => `${k} (${fmtQtd(v as number)} un.)`).join(' · ')}</p>
                )}
                {resultadoCarga.negativos.length > 0 && <p className="text-amber-700 font-bold">⚠ Saldo negativo no P2S (gravado como 0): {resultadoCarga.negativos.join(' · ')}</p>}
                {resultadoCarga.falhas.length > 0 && <p className="text-red-600 font-bold">✖ {resultadoCarga.falhas.length} falha(s): {resultadoCarga.falhas.slice(0, 3).join(' · ')}</p>}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto, código ou categoria..."
                className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs w-64 focus:outline-none focus:border-[#336699]" />
              <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs font-bold text-[#0C1D4D] max-w-[200px]">
                <option value="">Todas as categorias</option>
                {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filtroControle} onChange={e => setFiltroControle(e.target.value as any)} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs font-bold text-[#0C1D4D]">
                <option value="">Todo controle</option>
                <option value="INDIVIDUAL">Por patrimônio</option>
                <option value="QUANTIDADE">Por quantidade</option>
              </select>
              {empresas.length > 1 && (
                <>
                  <button onClick={() => setFiltroEmpresa(null)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === null ? `${corSeloEmpresa(null)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>Todas</button>
                  {empresas.map(e => (
                    <button key={e.id} onClick={() => setFiltroEmpresa(e.id)}
                      className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border-2 ${filtroEmpresa === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>
                  ))}
                </>
              )}
              <label className="flex items-center gap-2 text-xs font-bold text-gray-500 ml-1">
                <input type="checkbox" checked={soComSaldo} onChange={e => setSoComSaldo(e.target.checked)} />
                Só com estoque
              </label>
            </div>

            {selecionados.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                <span className="text-xs font-bold text-[#0C1D4D]">{selecionados.size} selecionado(s):</span>
                <button onClick={() => definirEmMassa('INDIVIDUAL')} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg bg-white border border-[#336699] text-[#336699]">Controlar por patrimônio</button>
                <button onClick={() => definirEmMassa('QUANTIDADE')} className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg bg-white border border-[#CBD5E1] text-gray-600">Controlar por quantidade</button>
                <button onClick={() => setSelecionados(new Set())} className="text-[10px] font-bold text-gray-500 ml-auto">Limpar</button>
              </div>
            )}

            {carregando ? (
              <p className="text-sm text-gray-400 py-6 text-center">Carregando...</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                      <th className="p-2 w-6">
                        <input type="checkbox" checked={visiveis.length > 0 && visiveis.every(l => selecionados.has(l.produto_id))}
                          onChange={e => setSelecionados(e.target.checked ? new Set(visiveis.map(l => l.produto_id)) : new Set())} />
                      </th>
                      <th className="p-2">Produto</th>
                      <th className="p-2">Controle</th>
                      {empresasMostradas.map(e => (
                        <th key={e.id} className="p-2 text-right whitespace-nowrap">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${corSeloEmpresa(e.id)}`}>{e.nome}</span>
                          <span className="block text-[8px] text-gray-400 normal-case font-bold mt-0.5">disp. / manut.</span>
                        </th>
                      ))}
                      <th className="p-2 text-center whitespace-nowrap">Preparo / Retorno</th>
                      <th className="p-2 text-right">Indenização</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map(l => (
                      <tr key={l.produto_id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer" onClick={() => setAberto(l.produto_id)}>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={selecionados.has(l.produto_id)}
                            onChange={e => setSelecionados(prev => { const s = new Set(prev); if (e.target.checked) s.add(l.produto_id); else s.delete(l.produto_id); return s; })} />
                        </td>
                        <td className="p-2 min-w-[240px]">
                          <p className="font-bold text-[#0C1D4D]">
                            {l.nome}
                            {l.eh_kit && <span className="ml-2 text-[9px] font-black px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 uppercase">Kit</span>}
                          </p>
                          <p className="text-[10px] text-gray-400">{[l.codigo, l.unidade, l.categoria].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className="p-2">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${l.controle_locacao === 'INDIVIDUAL' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                            {l.controle_locacao === 'INDIVIDUAL' ? 'Patrimônio' : 'Quantidade'}
                          </span>
                        </td>
                        {empresasMostradas.map(e => {
                          const d = qtdDisponivel(l, e.id), m = qtdManutencao(l, e.id);
                          return (
                            <td key={e.id} className="p-2 text-right whitespace-nowrap">
                              <span className={`font-black ${d > 0 ? 'text-[#0C1D4D]' : 'text-gray-300'}`}>{fmtQtd(d)}</span>
                              {m > 0 && <span className="text-amber-600 font-bold"> / {fmtQtd(m)}</span>}
                            </td>
                          );
                        })}
                        <td className="p-2 text-center text-gray-500">{l.dias_preparo || l.dias_retorno ? `${l.dias_preparo}d / ${l.dias_retorno}d` : '—'}</td>
                        <td className="p-2 text-right text-gray-500 whitespace-nowrap">{l.valor_indenizacao ? formatarMoeda(l.valor_indenizacao) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-3">{visiveis.length} de {linhas.length} produto(s). Clique na linha para abrir saldos, patrimônios e kit.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {aberto !== null && (
        <DetalheEquipamento
          produtoId={aberto}
          accessToken={accessToken}
          onFechar={(mudou) => { setAberto(null); if (mudou) carregar(); }}
          toast={toast} confirmar={confirmar} pedir={pedir}
        />
      )}
    </div>
  );
}

// ============================================================================
// DETALHE (modal com abas)
// ============================================================================
function DetalheEquipamento({ produtoId, accessToken, onFechar, toast, confirmar, pedir }: {
  produtoId: number; accessToken: string; onFechar: (mudou: boolean) => void;
  toast: ReturnType<typeof useToast>; confirmar: ReturnType<typeof useConfirm>; pedir: ReturnType<typeof usePrompt>;
}) {
  const [det, setDet] = useState<Detalhe | null>(null);
  const [aba, setAba] = useState<Aba>('config');
  const [mudou, setMudou] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // config
  const [controle, setControle] = useState<ControleLocacao>('QUANTIDADE');
  const [preparo, setPreparo] = useState('0');
  const [retorno, setRetorno] = useState('0');

  // saldo novo
  const [novoSaldo, setNovoSaldo] = useState({ empresa_id: 0, local: 'PRINCIPAL', total: '', manut: '0' });
  const [edicaoSaldo, setEdicaoSaldo] = useState<Record<number, { total: string; manut: string; obs: string }>>({});

  // patrimônio
  const [formPat, setFormPat] = useState<(DadosPatrimonio & { custoTxt: string }) | null>(null);
  const [lote, setLote] = useState<{ empresa_id: number; prefixo: string; inicio: string; quantidade: string; digitos: string; local: string; custo: string; data: string; nf: string } | null>(null);
  const [selPat, setSelPat] = useState<Set<number>>(new Set());
  const [filtroSituacao, setFiltroSituacao] = useState<'' | SituacaoPatrimonio>('');

  // kit
  const [kit, setKit] = useState<ItemKit[]>([]);
  const [kitAlterado, setKitAlterado] = useState(false);

  const carregar = async () => {
    const r = await carregarEquipamentoAction(produtoId, accessToken);
    if (!r.ok) { toast(r.erro || 'Erro ao carregar.', 'error'); onFechar(mudou); return; }
    const d: Detalhe = r.info;
    setDet(d);
    setControle(d.produto.controle_locacao || 'QUANTIDADE');
    setPreparo(String(d.produto.dias_preparo ?? 0));
    setRetorno(String(d.produto.dias_retorno ?? 0));
    setNovoSaldo(s => ({ ...s, empresa_id: s.empresa_id || d.empresas[0]?.id || 0 }));
    setEdicaoSaldo(Object.fromEntries(d.saldos.map(s => [s.id, { total: fmtQtd(Number(s.quantidade_total)), manut: fmtQtd(Number(s.quantidade_manutencao)), obs: s.observacoes || '' }])));
    setKit(d.kit); setKitAlterado(false);
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [produtoId]);

  const nomeEmpresa = (id: number) => det?.empresas.find(e => e.id === id)?.nome || `Empresa ${id}`;

  const salvarConfig = async () => {
    setSalvando(true);
    const r = await salvarConfigEquipamentoAction(produtoId, { controle_locacao: controle, dias_preparo: Number(preparo) || 0, dias_retorno: Number(retorno) || 0 }, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao salvar.', 'error');
    toast('Configuração salva.', 'success'); setMudou(true); carregar();
  };

  const salvarSaldoExistente = async (s: Saldo) => {
    const e = edicaoSaldo[s.id];
    const total = lerNumero(e.total), manut = lerNumero(e.manut);
    if (total === null || Number.isNaN(total) || manut === null || Number.isNaN(manut)) return toast('Quantidade inválida.', 'error');
    const r = await salvarSaldoAction({ id: s.id, produto_id: produtoId, empresa_id: s.empresa_id, local: s.local, quantidade_total: total, quantidade_manutencao: manut, observacoes: e.obs }, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro ao salvar.', 'error');
    toast('Saldo salvo.', 'success'); setMudou(true); carregar();
  };

  const adicionarSaldo = async () => {
    const total = lerNumero(novoSaldo.total), manut = lerNumero(novoSaldo.manut) ?? 0;
    if (total === null || Number.isNaN(total) || Number.isNaN(manut)) return toast('Informe a quantidade total.', 'error');
    const r = await salvarSaldoAction({ produto_id: produtoId, empresa_id: novoSaldo.empresa_id, local: novoSaldo.local, quantidade_total: total, quantidade_manutencao: manut }, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro ao salvar.', 'error');
    toast('Saldo adicionado.', 'success'); setMudou(true);
    setNovoSaldo(s => ({ ...s, local: 'PRINCIPAL', total: '', manut: '0' }));
    carregar();
  };

  const removerSaldo = async (s: Saldo) => {
    if (!(await confirmar({ title: 'Excluir saldo', danger: true, confirmLabel: 'Excluir', message: `Excluir o saldo de ${nomeEmpresa(s.empresa_id)} / ${s.local}?` }))) return;
    const r = await excluirSaldoAction(s.id, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro ao excluir.', 'error');
    setMudou(true); carregar();
  };

  const novoPatrimonio = () => {
    if (!det) return;
    setFormPat({ produto_id: produtoId, empresa_id: det.empresas[0]?.id || 0, numero_patrimonio: '', numero_serie: '', situacao: 'ATIVO', local: '', custo_aquisicao: null, custoTxt: '', data_aquisicao: '', nota_fiscal_compra: '', observacoes: '' });
  };
  const editarPatrimonio = (p: Patrimonio) => {
    setFormPat({
      id: p.id, produto_id: produtoId, empresa_id: p.empresa_id, numero_patrimonio: p.numero_patrimonio, numero_serie: p.numero_serie || '',
      situacao: p.situacao, local: p.local || '', custo_aquisicao: p.custo_aquisicao, custoTxt: p.custo_aquisicao ? String(p.custo_aquisicao).replace('.', ',') : '',
      data_aquisicao: p.data_aquisicao || '', nota_fiscal_compra: p.nota_fiscal_compra || '', observacoes: p.observacoes || '',
    });
  };
  const salvarPatrimonio = async () => {
    if (!formPat) return;
    const custo = lerNumero(formPat.custoTxt);
    if (Number.isNaN(custo)) return toast('Custo inválido.', 'error');
    setSalvando(true);
    const { custoTxt: _ignorado, ...dados } = formPat;
    void _ignorado;
    const r = await salvarPatrimonioAction({ ...dados, custo_aquisicao: custo }, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao salvar.', 'error');
    toast('Patrimônio salvo.', 'success'); setFormPat(null); setMudou(true); carregar();
  };
  const removerPatrimonio = async (p: Patrimonio) => {
    if (!(await confirmar({ title: 'Excluir patrimônio', danger: true, confirmLabel: 'Excluir', message: `Excluir o patrimônio ${p.numero_patrimonio}? Se a peça saiu de uso, prefira mudar a situação para Baixado.` }))) return;
    const r = await excluirPatrimonioAction(p.id, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro ao excluir.', 'error');
    setMudou(true); carregar();
  };

  const abrirLote = () => {
    if (!det) return;
    const prefixo = det.produto.codigo_formatado ? `${det.produto.codigo_formatado}-` : '';
    const usados = det.patrimonios.map(p => p.numero_patrimonio).filter(n => n.startsWith(prefixo)).map(n => Number(n.slice(prefixo.length))).filter(Number.isFinite);
    setLote({ empresa_id: det.empresas[0]?.id || 0, prefixo, inicio: String((usados.length ? Math.max(...usados) : 0) + 1), quantidade: '1', digitos: '3', local: '', custo: '', data: '', nf: '' });
  };
  const confirmarLote = async () => {
    if (!lote) return;
    const custo = lerNumero(lote.custo);
    if (Number.isNaN(custo)) return toast('Custo inválido.', 'error');
    setSalvando(true);
    const r = await gerarPatrimoniosLoteAction({
      produto_id: produtoId, empresa_id: lote.empresa_id, prefixo: lote.prefixo, inicio: Number(lote.inicio), quantidade: Number(lote.quantidade),
      digitos: Number(lote.digitos), local: lote.local, custo_aquisicao: custo, data_aquisicao: lote.data || null, nota_fiscal_compra: lote.nf,
    }, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao gerar.', 'error');
    toast(`${r.info.gerados} patrimônio(s) gerados.`, 'success'); setLote(null); setMudou(true); carregar();
  };

  const importarP2s = async () => {
    if (!(await confirmar({ title: 'Importar peças do P2S', confirmLabel: 'Importar', message: 'Traz as peças individuais ATIVAS deste produto cadastradas no PrimeStart (identificador, série e tag). Peças já importadas antes são atualizadas, não duplicadas.' }))) return;
    setSalvando(true);
    const r = await importarPatrimoniosP2sAction(produtoId, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao importar.', 'error');
    toast(`${r.info.importados} peça(s) importadas do P2S${r.info.historico ? ` (${r.info.historico} antigas/histórico ignoradas)` : ''}.`, r.info.importados ? 'success' : 'info');
    if (r.info.ignorados.length) toast(`Sem empresa correspondente: ${r.info.ignorados.slice(0, 5).join(', ')}`, 'info');
    setMudou(true); carregar();
  };

  const imprimirEtiquetas = async () => {
    if (!det) return;
    const alvo = det.patrimonios.filter(p => (selPat.size ? selPat.has(p.id) : p.situacao === 'ATIVO' || p.situacao === 'MANUTENCAO'));
    if (!alvo.length) return toast('Nenhum patrimônio para imprimir.', 'info');
    const resp = await pedir({ title: 'Etiquetas (A4 3×8)', message: `Imprimir ${alvo.length} etiqueta(s). Em qual posição da folha começar? (1 a 24 — útil para aproveitar folha já usada)`, defaultValue: '1' });
    if (resp === null) return;
    const inicio = Math.min(24, Math.max(1, Number(resp) || 1)) - 1;
    try {
      const bytes = await gerarEtiquetasPatrimonioPdf(alvo.map(p => ({
        qr: p.qr_code || `PAT-${p.empresa_id}-${p.numero_patrimonio}`, numero: p.numero_patrimonio,
        produto: det.produto.nome_item || '', empresa: nomeEmpresa(p.empresa_id), serie: p.numero_serie,
      })), inicio);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) {
      toast(`Erro ao gerar etiquetas: ${e.message}`, 'error');
    }
  };

  const salvarKit = async () => {
    setSalvando(true);
    const r = await salvarKitAction(produtoId, kit.map(k => ({ componente_produto_id: k.componente_produto_id, quantidade: k.quantidade, opcional: k.opcional })), accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao salvar o kit.', 'error');
    toast('Kit salvo.', 'success'); setMudou(true); carregar();
  };

  const fechar = async () => {
    if (kitAlterado && !(await confirmar({ title: 'Kit não salvo', message: 'A composição do kit foi alterada e não foi salva. Fechar mesmo assim?', confirmLabel: 'Fechar', danger: true }))) return;
    onFechar(mudou);
  };

  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]';
  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';
  const p = det?.produto;
  const patsVisiveis = (det?.patrimonios || []).filter(x => !filtroSituacao || x.situacao === filtroSituacao);

  return (
    <Modal open onClose={fechar} maxWidthClassName="max-w-5xl" title={p ? `${p.codigo_formatado ? p.codigo_formatado + ' · ' : ''}${p.nome_item}` : 'Carregando...'}>
      {!det ? (
        <p className="text-sm text-gray-400 py-6 text-center">Carregando...</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b border-[#E2E8F0] -mt-2">
            {([['config', 'Configuração'], ['saldos', `Saldos${controle === 'QUANTIDADE' ? '' : ' (não usado)'}`], ['patrimonios', `Patrimônios (${det.patrimonios.length})`], ['kit', `Kit${det.kit.length ? ` (${det.kit.length})` : ''}`]] as [Aba, string][]).map(([k, rot]) => (
              <button key={k} onClick={() => setAba(k)}
                className={`px-4 py-2 text-[11px] font-black uppercase tracking-wider border-b-2 -mb-px ${aba === k ? 'border-[#336699] text-[#0C1D4D]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>{rot}</button>
            ))}
          </div>

          {/* ---------------- CONFIGURAÇÃO ---------------- */}
          {aba === 'config' && (
            <div className="space-y-5">
              <p className="text-xs text-gray-500">{[p.categoria_nome, p.sub_categoria_nome, p.marca_nome, p.unidade].filter(Boolean).join(' · ')}
                {p.valor_indenizacao ? ` · Indenização ${formatarMoeda(p.valor_indenizacao)}` : ''}{p.custo_reposicao ? ` · Custo de reposição ${formatarMoeda(p.custo_reposicao)}` : ''}</p>
              <div>
                <label className={labelCls}>Como controlar este equipamento</label>
                <div className="grid md:grid-cols-2 gap-3">
                  {([
                    ['INDIVIDUAL', 'Por patrimônio (peça a peça)', 'Cada unidade tem número de patrimônio, série e etiqueta QR. A reserva escolhe peças específicas e o sistema impede a mesma peça em dois eventos ao mesmo tempo. Indicado para itens caros: processadoras, mesas, moving heads, notebooks, TVs.'],
                    ['QUANTIDADE', 'Por quantidade (saldo)', 'Só importa quantas unidades existem por empresa/local. Indicado para itens de volume: cabos, gabinetes de LED, estrutura, acessórios.'],
                  ] as [ControleLocacao, string, string][]).map(([v, t, d]) => (
                    <button key={v} type="button" onClick={() => setControle(v)}
                      className={`text-left p-4 rounded-xl border-2 ${controle === v ? 'border-[#336699] bg-blue-50' : 'border-[#E2E8F0]'}`}>
                      <p className="text-sm font-black text-[#0C1D4D]">{t}</p>
                      <p className="text-[11px] text-gray-500 mt-1">{d}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-md">
                <div>
                  <label className={labelCls}>Dias de preparo</label>
                  <input value={preparo} onChange={e => setPreparo(e.target.value.replace(/\D/g, ''))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Dias de retorno</label>
                  <input value={retorno} onChange={e => setRetorno(e.target.value.replace(/\D/g, ''))} className={inputCls} />
                </div>
              </div>
              <p className="text-[10px] text-gray-400 -mt-3">Dias que o item fica preso na agenda antes da saída (teste, configuração) e depois do retorno (conferência, limpeza). Não entram no preço.</p>
              <div className="flex justify-end">
                <button onClick={salvarConfig} disabled={salvando} className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">
                  {salvando ? 'Salvando...' : 'Salvar configuração'}
                </button>
              </div>
            </div>
          )}

          {/* ---------------- SALDOS ---------------- */}
          {aba === 'saldos' && (
            <div className="space-y-4">
              {controle === 'INDIVIDUAL' && (
                <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">Este produto é controlado por patrimônio — a disponibilidade conta as peças da aba Patrimônios, não estes saldos.</p>
              )}
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                    <th className="p-2">Empresa</th><th className="p-2">Local</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Em manutenção</th><th className="p-2">Observação</th><th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {det.saldos.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-gray-400">Sem saldo cadastrado.</td></tr>}
                  {det.saldos.map(s => {
                    const e = edicaoSaldo[s.id] || { total: '', manut: '', obs: '' };
                    return (
                      <tr key={s.id} className="border-b border-[#F1F5F9]">
                        <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${corSeloEmpresa(s.empresa_id)}`}>{nomeEmpresa(s.empresa_id)}</span></td>
                        <td className="p-2 font-bold">{s.local}</td>
                        <td className="p-1"><input value={e.total} onChange={ev => setEdicaoSaldo(m => ({ ...m, [s.id]: { ...e, total: ev.target.value } }))} className="w-24 border border-[#E2E8F0] rounded px-2 py-1 text-right" /></td>
                        <td className="p-1"><input value={e.manut} onChange={ev => setEdicaoSaldo(m => ({ ...m, [s.id]: { ...e, manut: ev.target.value } }))} className="w-24 border border-[#E2E8F0] rounded px-2 py-1 text-right" /></td>
                        <td className="p-1"><input value={e.obs} onChange={ev => setEdicaoSaldo(m => ({ ...m, [s.id]: { ...e, obs: ev.target.value } }))} className="w-full border border-[#E2E8F0] rounded px-2 py-1" /></td>
                        <td className="p-2 text-right whitespace-nowrap">
                          <button onClick={() => salvarSaldoExistente(s)} className="text-[10px] font-black uppercase text-[#336699] hover:underline mr-3">Salvar</button>
                          <button onClick={() => removerSaldo(s)} className="text-[10px] font-black uppercase text-red-500 hover:underline">Excluir</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Adicionar saldo em outro local</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                  {det.empresas.length > 1 ? (
                    <select value={novoSaldo.empresa_id} onChange={e => setNovoSaldo({ ...novoSaldo, empresa_id: Number(e.target.value) })} className={inputCls}>
                      {det.empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  ) : <div className="text-xs font-bold text-[#0C1D4D] py-2">{det.empresas[0]?.nome}</div>}
                  <input value={novoSaldo.local} onChange={e => setNovoSaldo({ ...novoSaldo, local: e.target.value })} placeholder="Local" className={inputCls} />
                  <input value={novoSaldo.total} onChange={e => setNovoSaldo({ ...novoSaldo, total: e.target.value })} placeholder="Total" className={inputCls} />
                  <input value={novoSaldo.manut} onChange={e => setNovoSaldo({ ...novoSaldo, manut: e.target.value })} placeholder="Manutenção" className={inputCls} />
                  <button onClick={adicionarSaldo} className="bg-[#0C1D4D] text-white px-4 py-2 rounded-lg text-xs font-bold uppercase">Adicionar</button>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- PATRIMÔNIOS ---------------- */}
          {aba === 'patrimonios' && (
            <div className="space-y-4">
              {controle === 'QUANTIDADE' && (
                <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">Este produto é controlado por quantidade — os patrimônios ficam registrados, mas a disponibilidade usa o saldo. Mude na aba Configuração para controlar peça a peça.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={novoPatrimonio} className="bg-[#0C1D4D] text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider">+ Patrimônio</button>
                <button onClick={abrirLote} className="bg-white border border-[#CBD5E1] text-[#0C1D4D] px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider">Gerar em lote</button>
                <button onClick={importarP2s} disabled={salvando || !p.p2s_oid} className="bg-white border border-[#CBD5E1] text-[#0C1D4D] disabled:opacity-40 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider">⬇ Importar do P2S</button>
                <button onClick={imprimirEtiquetas} className="bg-white border border-[#CBD5E1] text-[#0C1D4D] px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider">🏷 Etiquetas{selPat.size ? ` (${selPat.size})` : ''}</button>
                <select value={filtroSituacao} onChange={e => setFiltroSituacao(e.target.value as any)} className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs font-bold text-[#0C1D4D] ml-auto">
                  <option value="">Todas as situações</option>
                  {SITUACOES.map(s => <option key={s.v} value={s.v}>{s.rot}</option>)}
                </select>
              </div>

              {formPat && (
                <div className="bg-[#F8FAFC] border border-[#336699]/30 rounded-xl p-4 space-y-3">
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">{formPat.id ? 'Editar patrimônio' : 'Novo patrimônio'}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {det.empresas.length > 1 && (
                      <div>
                        <label className={labelCls}>Empresa</label>
                        <select value={formPat.empresa_id} onChange={e => setFormPat({ ...formPat, empresa_id: Number(e.target.value) })} className={inputCls}>
                          {det.empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                        </select>
                      </div>
                    )}
                    <div><label className={labelCls}>Nº patrimônio</label><input value={formPat.numero_patrimonio} onChange={e => setFormPat({ ...formPat, numero_patrimonio: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Nº de série</label><input value={formPat.numero_serie || ''} onChange={e => setFormPat({ ...formPat, numero_serie: e.target.value })} className={inputCls} /></div>
                    <div>
                      <label className={labelCls}>Situação</label>
                      <select value={formPat.situacao} onChange={e => setFormPat({ ...formPat, situacao: e.target.value as SituacaoPatrimonio })} className={inputCls}>
                        {SITUACOES.map(s => <option key={s.v} value={s.v}>{s.rot}</option>)}
                      </select>
                    </div>
                    <div><label className={labelCls}>Local</label><input value={formPat.local || ''} onChange={e => setFormPat({ ...formPat, local: e.target.value })} placeholder="PRINCIPAL" className={inputCls} /></div>
                    <div><label className={labelCls}>Custo de aquisição</label><input value={formPat.custoTxt} onChange={e => setFormPat({ ...formPat, custoTxt: e.target.value })} inputMode="decimal" className={inputCls} /></div>
                    <div><label className={labelCls}>Data de aquisição</label><input type="date" value={formPat.data_aquisicao || ''} onChange={e => setFormPat({ ...formPat, data_aquisicao: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>NF de compra</label><input value={formPat.nota_fiscal_compra || ''} onChange={e => setFormPat({ ...formPat, nota_fiscal_compra: e.target.value })} className={inputCls} /></div>
                  </div>
                  <div><label className={labelCls}>Observações</label><input value={formPat.observacoes || ''} onChange={e => setFormPat({ ...formPat, observacoes: e.target.value })} className={inputCls} /></div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setFormPat(null)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
                    <button onClick={salvarPatrimonio} disabled={salvando} className="bg-[#0C1D4D] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Salvando...' : 'Salvar'}</button>
                  </div>
                </div>
              )}

              {lote && (
                <div className="bg-[#F8FAFC] border border-[#336699]/30 rounded-xl p-4 space-y-3">
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Gerar patrimônios em sequência</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {det.empresas.length > 1 && (
                      <div>
                        <label className={labelCls}>Empresa</label>
                        <select value={lote.empresa_id} onChange={e => setLote({ ...lote, empresa_id: Number(e.target.value) })} className={inputCls}>
                          {det.empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                        </select>
                      </div>
                    )}
                    <div><label className={labelCls}>Prefixo</label><input value={lote.prefixo} onChange={e => setLote({ ...lote, prefixo: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>Nº inicial</label><input value={lote.inicio} onChange={e => setLote({ ...lote, inicio: e.target.value.replace(/\D/g, '') })} className={inputCls} /></div>
                    <div><label className={labelCls}>Quantidade</label><input value={lote.quantidade} onChange={e => setLote({ ...lote, quantidade: e.target.value.replace(/\D/g, '') })} className={inputCls} /></div>
                    <div><label className={labelCls}>Dígitos</label><input value={lote.digitos} onChange={e => setLote({ ...lote, digitos: e.target.value.replace(/\D/g, '') })} className={inputCls} /></div>
                    <div><label className={labelCls}>Local</label><input value={lote.local} onChange={e => setLote({ ...lote, local: e.target.value })} placeholder="PRINCIPAL" className={inputCls} /></div>
                    <div><label className={labelCls}>Custo unitário</label><input value={lote.custo} onChange={e => setLote({ ...lote, custo: e.target.value })} inputMode="decimal" className={inputCls} /></div>
                    <div><label className={labelCls}>Data de aquisição</label><input type="date" value={lote.data} onChange={e => setLote({ ...lote, data: e.target.value })} className={inputCls} /></div>
                    <div><label className={labelCls}>NF de compra</label><input value={lote.nf} onChange={e => setLote({ ...lote, nf: e.target.value })} className={inputCls} /></div>
                  </div>
                  {(() => {
                    const q = Number(lote.quantidade) || 0, i = Number(lote.inicio) || 0, d = Math.min(8, Math.max(1, Number(lote.digitos) || 3));
                    const n = (k: number) => `${lote.prefixo.toUpperCase()}${String(k).padStart(d, '0')}`;
                    return q > 0 ? <p className="text-xs text-gray-500">Vai gerar <strong>{n(i)}</strong>{q > 1 && <> até <strong>{n(i + q - 1)}</strong></>} ({q} peça{q > 1 ? 's' : ''}).</p> : null;
                  })()}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setLote(null)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
                    <button onClick={confirmarLote} disabled={salvando} className="bg-[#0C1D4D] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Gerando...' : 'Gerar'}</button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                      <th className="p-2 w-6">
                        <input type="checkbox" checked={patsVisiveis.length > 0 && patsVisiveis.every(x => selPat.has(x.id))}
                          onChange={e => setSelPat(e.target.checked ? new Set(patsVisiveis.map(x => x.id)) : new Set())} />
                      </th>
                      <th className="p-2">Patrimônio</th><th className="p-2">Série</th><th className="p-2">Empresa</th><th className="p-2">Situação</th>
                      <th className="p-2">Local</th><th className="p-2 text-right">Custo</th><th className="p-2">Aquisição</th><th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {patsVisiveis.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-gray-400">Nenhum patrimônio{filtroSituacao ? ' nesta situação' : ''}.</td></tr>}
                    {patsVisiveis.map(x => (
                      <tr key={x.id} className="border-b border-[#F1F5F9]">
                        <td className="p-2"><input type="checkbox" checked={selPat.has(x.id)} onChange={e => setSelPat(prev => { const s = new Set(prev); if (e.target.checked) s.add(x.id); else s.delete(x.id); return s; })} /></td>
                        <td className="p-2 font-black text-[#0C1D4D]">{x.numero_patrimonio}{x.p2s_oid && <span className="block text-[9px] text-gray-400 font-bold uppercase">do P2S</span>}</td>
                        <td className="p-2">{x.numero_serie || '—'}</td>
                        <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${corSeloEmpresa(x.empresa_id)}`}>{nomeEmpresa(x.empresa_id)}</span></td>
                        <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${corSituacao(x.situacao)}`}>{rotSituacao(x.situacao)}</span></td>
                        <td className="p-2">{x.local || '—'}</td>
                        <td className="p-2 text-right">{x.custo_aquisicao ? formatarMoeda(x.custo_aquisicao) : '—'}</td>
                        <td className="p-2">{x.data_aquisicao ? formatarDataBR(x.data_aquisicao) : '—'}</td>
                        <td className="p-2 text-right whitespace-nowrap">
                          <button onClick={() => editarPatrimonio(x)} className="text-[10px] font-black uppercase text-[#336699] hover:underline mr-3">Editar</button>
                          <button onClick={() => removerPatrimonio(x)} className="text-[10px] font-black uppercase text-red-500 hover:underline">Excluir</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-400">Etiquetas: sem seleção, imprime todas as peças ativas e em manutenção. O QR leva o código da peça (ex.: PAT-12-0001) para a expedição dar saída e retorno peça a peça.</p>
            </div>
          )}

          {/* ---------------- KIT ---------------- */}
          {aba === 'kit' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">Se este produto é um <strong>kit</strong>, liste os componentes. Reservar 1 kit reserva a quantidade de cada componente — a disponibilidade do kit é limitada pelo componente mais escasso.</p>
              {det.usadoEmKits.length > 0 && (
                <p className="text-xs bg-violet-50 border border-violet-200 text-violet-800 rounded-lg p-3">
                  Componente de: {det.usadoEmKits.map(k => `${k.nome} (${fmtQtd(k.quantidade)}×)`).join(' · ')}
                </p>
              )}
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                    <th className="p-2">Componente</th><th className="p-2 text-right">Qtd por kit</th><th className="p-2 text-center">Opcional</th><th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {kit.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-gray-400">Sem componentes — este produto não é kit.</td></tr>}
                  {kit.map((k, idx) => (
                    <tr key={k.componente_produto_id} className="border-b border-[#F1F5F9]">
                      <td className="p-2"><p className="font-bold text-[#0C1D4D]">{k.nome}</p><p className="text-[10px] text-gray-400">{[k.codigo, k.unidade].filter(Boolean).join(' · ')}</p></td>
                      <td className="p-1 text-right">
                        <input value={String(k.quantidade).replace('.', ',')} onChange={e => { const v = lerNumero(e.target.value); setKit(prev => prev.map((x, i) => i === idx ? { ...x, quantidade: v && !Number.isNaN(v) ? v : 0 } : x)); setKitAlterado(true); }}
                          className="w-20 border border-[#E2E8F0] rounded px-2 py-1 text-right" />
                      </td>
                      <td className="p-2 text-center"><input type="checkbox" checked={k.opcional} onChange={e => { setKit(prev => prev.map((x, i) => i === idx ? { ...x, opcional: e.target.checked } : x)); setKitAlterado(true); }} /></td>
                      <td className="p-2 text-right"><button onClick={() => { setKit(prev => prev.filter((_, i) => i !== idx)); setKitAlterado(true); }} className="text-[10px] font-black uppercase text-red-500 hover:underline">Remover</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <BuscaProdutoKit accessToken={accessToken} excluir={new Set([produtoId, ...kit.map(k => k.componente_produto_id)])}
                onEscolher={pr => { setKit(prev => [...prev, { componente_produto_id: pr.id, quantidade: 1, opcional: false, nome: pr.nome_item, codigo: pr.codigo_formatado, unidade: pr.unidade }]); setKitAlterado(true); }} />
              <div className="flex justify-end">
                <button onClick={salvarKit} disabled={!kitAlterado || salvando} className="bg-[#0C1D4D] disabled:opacity-40 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">
                  {salvando ? 'Salvando...' : 'Salvar kit'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function BuscaProdutoKit({ accessToken, excluir, onEscolher }: { accessToken: string; excluir: Set<number>; onEscolher: (p: any) => void }) {
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState<any[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (texto.trim().length < 2) { setRes([]); return; }
    const meu = ++seq.current;
    const t = setTimeout(async () => {
      const r = await buscarProdutosAction(texto.trim(), accessToken);
      if (meu === seq.current) setRes(r.ok ? r.info : []);
    }, 300);
    return () => clearTimeout(t);
  }, [texto, accessToken]);
  return (
    <div className="relative">
      <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="+ Adicionar componente: buscar produto..."
        className="w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]" />
      {res.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E2E8F0] rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {res.filter(p => !excluir.has(p.id)).map(p => (
            <button key={p.id} type="button" onClick={() => { onEscolher(p); setTexto(''); setRes([]); }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-[#F1F5F9] last:border-0">
              <p className="text-sm font-bold text-[#0C1D4D]">{p.nome_item}</p>
              <p className="text-[10px] text-gray-500">{[p.codigo_formatado, p.unidade, p.categoria_nome].filter(Boolean).join(' · ')}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
