"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  painelManutencaoAction, abrirOSAction, atualizarOSAction, atualizarCobrancaAvariaAction,
  buscarItemEstoqueAction, buscarFornecedoresAction, urlsFotosAction,
} from './actions';
import { gerarTituloAvariaAction } from '../../financeiro/titulos-receber/actions';
import FormAvaria, { enviarFotos, lerValorBR, type ItemAvaria } from './FormAvaria';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import CampoBusca, { type OpcaoBusca } from '../../../components/ui/CampoBusca';
import { useToast } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { hojeISO } from '../../../lib/locacao/datas';

// Avarias e Manutenção (2026-11-17). Regras em app/lib/locacao/manutencao.ts.

type StatusOS = 'ABERTA' | 'EM_EXECUCAO' | 'AGUARDANDO_PECA' | 'CONCLUIDA' | 'SEM_CONSERTO' | 'CANCELADA';
const STATUS_OS: Record<StatusOS, { r: string; cls: string }> = {
  ABERTA: { r: 'Aberta', cls: 'bg-blue-100 text-blue-700' },
  EM_EXECUCAO: { r: 'Em execução', cls: 'bg-cyan-100 text-cyan-700' },
  AGUARDANDO_PECA: { r: 'Aguardando peça', cls: 'bg-amber-100 text-amber-700' },
  CONCLUIDA: { r: 'Concluída', cls: 'bg-emerald-100 text-emerald-700' },
  SEM_CONSERTO: { r: 'Sem conserto', cls: 'bg-red-100 text-red-600' },
  CANCELADA: { r: 'Cancelada', cls: 'bg-gray-100 text-gray-500' },
};
const ABERTOS: StatusOS[] = ['ABERTA', 'EM_EXECUCAO', 'AGUARDANDO_PECA'];
const COBRANCA: Record<string, { r: string; cls: string }> = {
  A_DEFINIR: { r: 'A definir', cls: 'bg-amber-100 text-amber-700' },
  COBRAR: { r: 'Cobrar', cls: 'bg-red-100 text-red-600' },
  NAO_COBRAR: { r: 'Não cobrar', cls: 'bg-gray-100 text-gray-500' },
  COBRADO: { r: 'Cobrado', cls: 'bg-blue-100 text-blue-700' },
  PAGO: { r: 'Pago', cls: 'bg-emerald-100 text-emerald-700' },
};
const GRAV: Record<string, string> = { LEVE: 'Leve', MEDIA: 'Média', GRAVE: 'Grave', PERDA_TOTAL: 'Perda total' };
const qtd = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function Fotos({ caminhos, accessToken }: { caminhos: string[]; accessToken: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!caminhos?.length) return;
    urlsFotosAction(caminhos, accessToken).then(r => { if (r.ok) setUrls(r.info); });
  }, [caminhos, accessToken]);
  if (!caminhos?.length) return <p className="text-xs text-gray-400">Sem fotos.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {caminhos.map(c => urls[c]
        ? <a key={c} href={urls[c]} target="_blank" rel="noreferrer"><img src={urls[c]} alt="foto" className="w-24 h-24 object-cover rounded-lg border border-[#E2E8F0]" /></a>
        : <div key={c} className="w-24 h-24 rounded-lg bg-gray-100 animate-pulse" />)}
    </div>
  );
}

export default function ManutencaoPage() {
  const router = useRouter();
  const toast = useToast();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [empresaNovo, setEmpresaNovo] = useState<number>(0);
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  const [oss, setOss] = useState<any[]>([]);
  const [avarias, setAvarias] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<'os' | 'avarias'>('os');
  const [filtroOS, setFiltroOS] = useState<'abertas' | 'encerradas' | 'todas'>('abertas');
  const [filtroCob, setFiltroCob] = useState<'pendentes' | 'todas'>('pendentes');
  const [busca, setBusca] = useState('');

  const [novaAvaria, setNovaAvaria] = useState(false);
  const [novaOS, setNovaOS] = useState(false);
  const [osEdit, setOsEdit] = useState<any | null>(null);
  const [avEdit, setAvEdit] = useState<any | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await painelManutencaoAction(accessToken);
    if (r.ok) {
      setEmpresas(r.info.empresas); setOss(r.info.manutencoes); setAvarias(r.info.avarias);
      setEmpresaNovo(e => e || r.info.empresas[0]?.id || 0);
    } else toast(r.erro || 'Erro.', 'error');
    setCarregando(false);
  }, [accessToken, toast]);

  useEffect(() => { if (!authLoading && !acessoNegado && !erro && accessToken) carregar(); }, [authLoading, acessoNegado, erro, accessToken, carregar]);

  const nomeEmpresa = (id: number) => empresas.find(e => e.id === id)?.nome || '';
  const hoje = hojeISO();
  const mesAtual = hoje.slice(0, 7);
  const daEmpresa = <T extends { empresa_id: number }>(l: T[]) => l.filter(x => filtroEmpresa === null || x.empresa_id === filtroEmpresa);
  const osE = daEmpresa(oss), avE = daEmpresa(avarias);
  const abertas = osE.filter(o => ABERTOS.includes(o.status));
  const emFornecedor = abertas.filter(o => o.tipo === 'TERCEIRO');
  const atrasadas = abertas.filter(o => o.previsao && o.previsao < hoje);
  const custoMes = osE.filter(o => (o.concluida_em || '').slice(0, 7) === mesAtual).reduce((s, o) => s + Number(o.custo_pecas || 0) + Number(o.custo_mao_obra || 0), 0);
  const aCobrar = avE.filter(a => a.status_cobranca === 'COBRAR' || a.status_cobranca === 'COBRADO');
  const aDefinir = avE.filter(a => a.status_cobranca === 'A_DEFINIR');

  const t = busca.trim().toLowerCase();
  const casa = (...xs: (string | null | undefined)[]) => !t || xs.some(x => (x || '').toLowerCase().includes(t));
  const osVis = osE.filter(o => (filtroOS === 'todas' || (filtroOS === 'abertas') === ABERTOS.includes(o.status)) && casa(o.produto_nome, o.patrimonio_numero, o.problema, o.fornecedor_nome, String(o.id)));
  const avVis = avE.filter(a => (filtroCob === 'todas' || ['A_DEFINIR', 'COBRAR', 'COBRADO'].includes(a.status_cobranca)) && casa(a.produto_nome, a.patrimonio_numero, a.descricao, a.cliente_nome, a.ficha_numero));

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar Avarias e Manutenção.</p>
          <button onClick={() => router.push('/admin/estoque')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const cartao = (titulo: string, valor: string, sub: string, cor?: string, onClick?: () => void) => (
    <button onClick={onClick} className={`text-left bg-white p-4 rounded-2xl border shadow-sm min-w-0 ${onClick ? 'hover:shadow-md' : 'cursor-default'} border-[#E2E8F0]`}>
      <p className={`text-xl font-black truncate ${cor || 'text-[#0C1D4D]'}`}>{carregando ? '—' : valor}</p>
      <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">{titulo}</p>
      <p className="text-[10px] text-gray-400 mt-1 truncate">{carregando ? '' : sub}</p>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">🔧 <strong>Olá, {usuarioAtual}</strong>. Avarias e manutenção dos equipamentos.</p>
        <button onClick={() => router.push('/admin/estoque')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg shadow-sm tracking-wider uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 md:p-8">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {cartao('OS abertas', String(abertas.length), `${emFornecedor.length} em fornecedor`, undefined, () => { setAba('os'); setFiltroOS('abertas'); })}
            {cartao('Atrasadas', String(atrasadas.length), 'previsão vencida', atrasadas.length ? 'text-red-600' : undefined, () => { setAba('os'); setFiltroOS('abertas'); })}
            {cartao('Custo no mês', formatarMoeda(custoMes), 'OS concluídas este mês')}
            {cartao('A cobrar de clientes', formatarMoeda(aCobrar.reduce((s, a) => s + Number(a.valor_cobranca || 0), 0)), `${aCobrar.length} avaria(s) cobrar/cobrado`, aCobrar.length ? 'text-red-600' : undefined, () => { setAba('avarias'); setFiltroCob('pendentes'); })}
            {cartao('Cobrança a definir', String(aDefinir.length), 'avarias sem decisão', aDefinir.length ? 'text-amber-600' : undefined, () => { setAba('avarias'); setFiltroCob('pendentes'); })}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-3 md:p-5">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 mb-4">
              <div className="flex rounded-xl border border-[#CBD5E1] overflow-hidden">
                <button onClick={() => setAba('os')} className={`px-4 py-2 text-xs font-black uppercase ${aba === 'os' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>🔧 OS de manutenção</button>
                <button onClick={() => setAba('avarias')} className={`px-4 py-2 text-xs font-black uppercase ${aba === 'avarias' ? 'bg-[#0C1D4D] text-white' : 'text-gray-500'}`}>⚠ Avarias</button>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {empresas.length > 1 && (
                  <select value={empresaNovo} onChange={e => setEmpresaNovo(Number(e.target.value))} title="Empresa dos novos registros" className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold">
                    {empresas.map(e => <option key={e.id} value={e.id}>Novo em: {e.nome}</option>)}
                  </select>
                )}
                <button onClick={() => setNovaAvaria(true)} disabled={!empresaNovo} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase">⚠ Registrar avaria</button>
                <button onClick={() => setNovaOS(true)} disabled={!empresaNovo} className="bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase">+ Abrir OS</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 items-center mb-3">
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar equipamento, patrimônio, cliente, nº..." className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs w-72" />
              {aba === 'os' ? (
                <select value={filtroOS} onChange={e => setFiltroOS(e.target.value as any)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold">
                  <option value="abertas">Abertas</option><option value="encerradas">Encerradas</option><option value="todas">Todas</option>
                </select>
              ) : (
                <select value={filtroCob} onChange={e => setFiltroCob(e.target.value as any)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold">
                  <option value="pendentes">Cobrança pendente (a definir / cobrar / cobrado)</option><option value="todas">Todas</option>
                </select>
              )}
              {empresas.length > 1 && (
                <>
                  <button onClick={() => setFiltroEmpresa(null)} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase border-2 ${filtroEmpresa === null ? `${corSeloEmpresa(null)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>Todas</button>
                  {empresas.map(e => <button key={e.id} onClick={() => setFiltroEmpresa(e.id)} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase border-2 ${filtroEmpresa === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>)}
                </>
              )}
            </div>

            {carregando ? <p className="text-sm text-gray-400 py-8 text-center">Carregando...</p> : aba === 'os' ? (
              osVis.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">Nenhuma OS.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[10px] font-black text-gray-500 uppercase border-b border-[#E2E8F0]">
                      <th className="p-2">OS</th><th className="p-2">Equipamento</th><th className="p-2">Problema</th><th className="p-2">Onde</th><th className="p-2">Previsão</th><th className="p-2">Status</th><th className="p-2 text-right">Custo</th>
                    </tr></thead>
                    <tbody>
                      {osVis.map(o => (
                        <tr key={o.id} onClick={() => setOsEdit(o)} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer align-top">
                          <td className="p-2 font-black text-[#0C1D4D] whitespace-nowrap">#{o.id}<span className="block text-[9px] text-gray-400 font-bold">{formatarDataBR(o.aberta_em?.slice(0, 10))}</span></td>
                          <td className="p-2 min-w-[200px]"><p className="font-bold">{o.patrimonio_numero ? `${o.patrimonio_numero} · ` : `${qtd(o.quantidade)}× `}{o.produto_nome}</p>
                            <p className="text-[10px] text-gray-400">{o.origem === 'AVARIA' ? 'avaria' : o.origem.toLowerCase()} · <span className={`px-1 rounded ${corSeloEmpresa(o.empresa_id)}`}>{nomeEmpresa(o.empresa_id)}</span></p></td>
                          <td className="p-2 max-w-[260px]"><p className="line-clamp-2">{o.problema}</p></td>
                          <td className="p-2 whitespace-nowrap">{o.tipo === 'TERCEIRO' ? (o.fornecedor_nome || 'Fornecedor') : 'Interna'}{o.responsavel && <span className="block text-[10px] text-gray-400">{o.responsavel}</span>}</td>
                          <td className={`p-2 whitespace-nowrap ${ABERTOS.includes(o.status) && o.previsao && o.previsao < hoje ? 'text-red-600 font-black' : ''}`}>{o.previsao ? formatarDataBR(o.previsao) : '—'}</td>
                          <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${STATUS_OS[o.status as StatusOS]?.cls}`}>{STATUS_OS[o.status as StatusOS]?.r}</span></td>
                          <td className="p-2 text-right whitespace-nowrap">{Number(o.custo_pecas) + Number(o.custo_mao_obra) > 0 ? formatarMoeda(Number(o.custo_pecas) + Number(o.custo_mao_obra)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              avVis.length === 0 ? <p className="text-sm text-gray-400 py-8 text-center">Nenhuma avaria.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[10px] font-black text-gray-500 uppercase border-b border-[#E2E8F0]">
                      <th className="p-2">Data</th><th className="p-2">Equipamento</th><th className="p-2">Avaria</th><th className="p-2">Cliente / ficha</th><th className="p-2">OS</th><th className="p-2">Cobrança</th><th className="p-2 text-right">Valor</th>
                    </tr></thead>
                    <tbody>
                      {avVis.map(a => (
                        <tr key={a.id} onClick={() => setAvEdit(a)} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] cursor-pointer align-top">
                          <td className="p-2 whitespace-nowrap">{formatarDataBR(a.registrada_em?.slice(0, 10))}<span className="block text-[9px] text-gray-400">{a.registrada_por}</span></td>
                          <td className="p-2 min-w-[200px] font-bold">{a.patrimonio_numero ? `${a.patrimonio_numero} · ` : `${qtd(a.quantidade)}× `}{a.produto_nome}</td>
                          <td className="p-2 max-w-[260px]"><span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase mr-1 ${a.gravidade === 'PERDA_TOTAL' || a.gravidade === 'GRAVE' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>{GRAV[a.gravidade]}</span><span className="line-clamp-2">{a.descricao}</span></td>
                          <td className="p-2">{a.cliente_nome || '—'}{a.ficha_numero && <span className="block text-[10px] text-gray-400">{a.ficha_numero}</span>}</td>
                          <td className="p-2">{a.manutencao_id ? <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_OS[a.manutencao_status as StatusOS]?.cls}`}>#{a.manutencao_id} {STATUS_OS[a.manutencao_status as StatusOS]?.r}</span> : '—'}</td>
                          <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase whitespace-nowrap ${COBRANCA[a.status_cobranca]?.cls}`}>{COBRANCA[a.status_cobranca]?.r}</span></td>
                          <td className="p-2 text-right whitespace-nowrap font-bold">{a.valor_cobranca ? formatarMoeda(Number(a.valor_cobranca)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {novaAvaria && (
        <FormAvaria empresaId={empresaNovo} accessToken={accessToken} onFechar={() => setNovaAvaria(false)}
          onSalvo={r => { setNovaAvaria(false); toast(`Avaria #${r.avariaId} registrada${r.manutencaoId ? ` — OS #${r.manutencaoId} aberta` : ''}.`, 'success'); carregar(); }} />
      )}
      {novaOS && <ModalNovaOS empresaId={empresaNovo} accessToken={accessToken} onFechar={() => setNovaOS(false)} onSalvo={id => { setNovaOS(false); toast(`OS #${id} aberta.`, 'success'); carregar(); }} />}
      {osEdit && <ModalOS os={osEdit} accessToken={accessToken} onFechar={() => setOsEdit(null)} onSalvo={() => { setOsEdit(null); carregar(); }} />}
      {avEdit && <ModalCobranca av={avEdit} accessToken={accessToken} onFechar={() => setAvEdit(null)} onSalvo={() => { setAvEdit(null); carregar(); }} />}
    </div>
  );
}

// ============================================================================
const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';
const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699] disabled:bg-[#F8FAFC]';

function ModalNovaOS({ empresaId, accessToken, onFechar, onSalvo }: { empresaId: number; accessToken: string; onFechar: () => void; onSalvo: (id: number) => void }) {
  const toast = useToast();
  const [item, setItem] = useState<ItemAvaria | null>(null);
  const [quantidade, setQuantidade] = useState('1');
  const [origem, setOrigem] = useState<'CORRETIVA' | 'PREVENTIVA' | 'OUTRA'>('CORRETIVA');
  const [tipo, setTipo] = useState<'INTERNA' | 'TERCEIRO'>('INTERNA');
  const [fornecedor, setFornecedor] = useState<OpcaoBusca | null>(null);
  const [problema, setProblema] = useState('');
  const [previsao, setPrevisao] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);
  const buscarItem = useCallback(async (t: string) => { const r = await buscarItemEstoqueAction(t, empresaId, accessToken); return r.ok ? r.info : []; }, [empresaId, accessToken]);
  const buscarFornec = useCallback(async (t: string) => { const r = await buscarFornecedoresAction(t, accessToken); return r.ok ? r.info : []; }, [accessToken]);

  const salvar = async () => {
    if (!item) return toast('Escolha o equipamento.', 'error');
    if (item.controle === 'INDIVIDUAL' && !item.patrimonio_id) return toast('Produto por patrimônio — escolha a peça (busque pelo nº).', 'error');
    const q = item.patrimonio_id ? 1 : lerValorBR(quantidade);
    if (q === null || Number.isNaN(q) || q <= 0) return toast('Quantidade inválida.', 'error');
    setSalvando(true);
    try {
      const caminhos = fotos.length ? await enviarFotos(fotos, accessToken) : [];
      const r = await abrirOSAction({
        empresa_id: empresaId, produto_id: item.produto_id, patrimonio_id: item.patrimonio_id, quantidade: q, origem, tipo,
        fornecedor_id: fornecedor ? Number(fornecedor.id) : null, problema, previsao: previsao || null, responsavel, fotos: caminhos,
      }, accessToken);
      if (!r.ok) throw new Error(r.erro);
      onSalvo(r.info.id);
    } catch (e: any) { toast(e.message || 'Erro.', 'error'); } finally { setSalvando(false); }
  };

  return (
    <Modal open onClose={onFechar} title="Abrir OS de manutenção" maxWidthClassName="max-w-2xl"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onFechar} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
        <button onClick={salvar} disabled={salvando} className="bg-[#0C1D4D] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Abrindo...' : 'Abrir OS'}</button>
      </div>}>
      <div><label className={labelCls}>Equipamento</label>
        <CampoBusca placeholder="Buscar produto, ou nº do patrimônio..." buscar={buscarItem} valor={item ? { id: item.produto_id, nome: item.nome } : null} onLimpar={() => setItem(null)}
          onEscolher={o => { const x = o.extra as any; setItem({ patrimonio_id: x.patrimonio_id, produto_id: x.produto_id, nome: o.nome, controle: x.controle, valor_indenizacao: x.valor_indenizacao }); }} />
      </div>
      {item && !item.patrimonio_id && <div className="w-40"><label className={labelCls}>Quantidade</label><input value={quantidade} onChange={e => setQuantidade(e.target.value)} inputMode="decimal" className={inputCls} /></div>}
      <div className="grid md:grid-cols-2 gap-3">
        <div><label className={labelCls}>Tipo</label>
          <select value={origem} onChange={e => setOrigem(e.target.value as any)} className={inputCls}><option value="CORRETIVA">Corretiva (defeito)</option><option value="PREVENTIVA">Preventiva</option><option value="OUTRA">Outra</option></select>
        </div>
        <div><label className={labelCls}>Onde</label>
          <select value={tipo} onChange={e => setTipo(e.target.value as any)} className={inputCls}><option value="INTERNA">Manutenção interna</option><option value="TERCEIRO">Fornecedor / assistência</option></select>
        </div>
      </div>
      {tipo === 'TERCEIRO' && <div><label className={labelCls}>Fornecedor</label><CampoBusca placeholder="Buscar fornecedor..." buscar={buscarFornec} valor={fornecedor} onEscolher={setFornecedor} onLimpar={() => setFornecedor(null)} /></div>}
      <div><label className={labelCls}>Problema</label><textarea value={problema} onChange={e => setProblema(e.target.value)} rows={3} className={inputCls} /></div>
      <div className="grid md:grid-cols-2 gap-3">
        <div><label className={labelCls}>Previsão de retorno</label><input type="date" value={previsao} onChange={e => setPrevisao(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Responsável</label><input value={responsavel} onChange={e => setResponsavel(e.target.value)} className={inputCls} /></div>
      </div>
      <div><label className={labelCls}>Fotos</label><input type="file" accept="image/*" capture="environment" multiple onChange={e => setFotos(Array.from(e.target.files || []).slice(0, 8))} className="text-xs" /></div>
      <p className="text-[10px] text-gray-500">Ao abrir, a peça (ou a quantidade) sai da disponibilidade até a OS ser concluída.</p>
    </Modal>
  );
}

function ModalOS({ os, accessToken, onFechar, onSalvo }: { os: any; accessToken: string; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const aberta = ABERTOS.includes(os.status);
  const [status, setStatus] = useState<StatusOS>(os.status);
  const [servico, setServico] = useState(os.servico_executado || '');
  const [pecas, setPecas] = useState(os.custo_pecas ? String(os.custo_pecas).replace('.', ',') : '');
  const [mao, setMao] = useState(os.custo_mao_obra ? String(os.custo_mao_obra).replace('.', ',') : '');
  const [nf, setNf] = useState(os.nota_fiscal || '');
  const [previsao, setPrevisao] = useState(os.previsao || '');
  const [responsavel, setResponsavel] = useState(os.responsavel || '');
  const [obs, setObs] = useState(os.observacoes || '');
  const [novasFotos, setNovasFotos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    const cp = lerValorBR(pecas), cm = lerValorBR(mao);
    if (Number.isNaN(cp) || Number.isNaN(cm)) return toast('Custo inválido.', 'error');
    setSalvando(true);
    try {
      const caminhos = novasFotos.length ? await enviarFotos(novasFotos, accessToken) : [];
      const r = await atualizarOSAction(os.id, status, {
        servico_executado: servico, custo_pecas: cp ?? 0, custo_mao_obra: cm ?? 0, nota_fiscal: nf, previsao: previsao || null,
        responsavel, observacoes: obs, ...(caminhos.length ? { fotos: [...(os.fotos || []), ...caminhos] } : {}),
      }, accessToken);
      if (!r.ok) throw new Error(r.erro);
      toast('OS atualizada.', 'success');
      onSalvo();
    } catch (e: any) { toast(e.message || 'Erro.', 'error'); } finally { setSalvando(false); }
  };

  return (
    <Modal open onClose={onFechar} title={`OS de manutenção #${os.id}`} maxWidthClassName="max-w-2xl"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onFechar} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Fechar</button>
        <button onClick={salvar} disabled={salvando} className="bg-[#0C1D4D] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Salvando...' : 'Salvar'}</button>
      </div>}>
      <div className="text-sm">
        <p className="font-black text-[#0C1D4D]">{os.patrimonio_numero ? `${os.patrimonio_numero} · ` : `${qtd(os.quantidade)}× `}{os.produto_nome}</p>
        <p className="text-xs text-gray-500">Aberta em {new Date(os.aberta_em).toLocaleString('pt-BR')} por {os.aberta_por} · {os.tipo === 'TERCEIRO' ? `em ${os.fornecedor_nome || 'fornecedor'}` : 'interna'} · origem {os.origem.toLowerCase()}</p>
        <p className="mt-2"><strong>Problema:</strong> {os.problema}</p>
        {!aberta && <p className="text-xs text-gray-500 mt-1">Encerrada em {new Date(os.concluida_em).toLocaleString('pt-BR')} por {os.concluida_por} — ainda dá para completar serviço, custos e NF.</p>}
      </div>
      <div><label className={labelCls}>Status</label>
        <select value={status} onChange={e => setStatus(e.target.value as StatusOS)} disabled={!aberta} className={inputCls}>
          {(aberta ? Object.keys(STATUS_OS) : [os.status]).map(s => <option key={s} value={s}>{STATUS_OS[s as StatusOS].r}</option>)}
        </select>
        {aberta && status === 'CONCLUIDA' && <p className="text-[10px] text-emerald-700 mt-1">Ao salvar, volta para a disponibilidade.</p>}
        {aberta && status === 'SEM_CONSERTO' && <p className="text-[10px] text-red-600 mt-1">Ao salvar, {os.patrimonio_id ? 'o patrimônio é BAIXADO' : 'a quantidade sai do saldo'}.</p>}
      </div>
      <div><label className={labelCls}>Serviço executado</label><textarea value={servico} onChange={e => setServico(e.target.value)} rows={3} className={inputCls} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label className={labelCls}>Peças (R$)</label><input value={pecas} onChange={e => setPecas(e.target.value)} inputMode="decimal" className={inputCls} /></div>
        <div><label className={labelCls}>Mão de obra (R$)</label><input value={mao} onChange={e => setMao(e.target.value)} inputMode="decimal" className={inputCls} /></div>
        <div><label className={labelCls}>Nota fiscal</label><input value={nf} onChange={e => setNf(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Previsão</label><input type="date" value={previsao} onChange={e => setPrevisao(e.target.value)} className={inputCls} /></div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div><label className={labelCls}>Responsável</label><input value={responsavel} onChange={e => setResponsavel(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Observações</label><input value={obs} onChange={e => setObs(e.target.value)} className={inputCls} /></div>
      </div>
      <div><label className={labelCls}>Fotos</label><Fotos caminhos={os.fotos || []} accessToken={accessToken} />
        <input type="file" accept="image/*" multiple onChange={e => setNovasFotos(Array.from(e.target.files || []).slice(0, 8))} className="text-xs mt-2" /></div>
    </Modal>
  );
}

function ModalCobranca({ av, accessToken, onFechar, onSalvo }: { av: any; accessToken: string; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState(av.status_cobranca);
  const [valor, setValor] = useState(av.valor_cobranca ? String(av.valor_cobranca).replace('.', ',') : '');
  const [obs, setObs] = useState(av.observacao_cobranca || '');
  const [salvando, setSalvando] = useState(false);
  const [vencTitulo, setVencTitulo] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); });
  const gerarTitulo = async () => {
    setSalvando(true);
    const r = await gerarTituloAvariaAction(av.id, vencTitulo, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast('Título a receber gerado — avaria marcada como cobrada.', 'success');
    onSalvo();
  };
  const salvar = async () => {
    const v = lerValorBR(valor);
    if (Number.isNaN(v)) return toast('Valor inválido.', 'error');
    setSalvando(true);
    const r = await atualizarCobrancaAvariaAction(av.id, { status_cobranca: status, valor_cobranca: v, observacao_cobranca: obs }, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast('Cobrança atualizada.', 'success');
    onSalvo();
  };
  return (
    <Modal open onClose={onFechar} title={`Avaria #${av.id}`} maxWidthClassName="max-w-2xl"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onFechar} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Fechar</button>
        <button onClick={salvar} disabled={salvando} className="bg-[#0C1D4D] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Salvando...' : 'Salvar'}</button>
      </div>}>
      <div className="text-sm space-y-1">
        <p className="font-black text-[#0C1D4D]">{av.patrimonio_numero ? `${av.patrimonio_numero} · ` : `${qtd(av.quantidade)}× `}{av.produto_nome} <span className="text-xs font-bold text-red-600">· {GRAV[av.gravidade]}</span></p>
        <p>{av.descricao}</p>
        <p className="text-xs text-gray-500">Registrada em {new Date(av.registrada_em).toLocaleString('pt-BR')} por {av.registrada_por}{av.cliente_nome ? ` · cliente ${av.cliente_nome}` : ''}{av.ficha_numero ? ` (${av.ficha_numero})` : ''}{av.manutencao_id ? ` · OS #${av.manutencao_id}` : ''}</p>
      </div>
      <Fotos caminhos={av.fotos || []} accessToken={accessToken} />
      <div className="grid md:grid-cols-2 gap-3">
        <div><label className={labelCls}>Cobrança</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>{Object.entries(COBRANCA).map(([k, v]) => <option key={k} value={k}>{v.r}</option>)}</select>
        </div>
        <div><label className={labelCls}>Valor</label><input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" className={inputCls} />
          {av.valor_indenizacao ? <p className="text-[10px] text-gray-500 mt-1">Indenização (reposição): {formatarMoeda(Number(av.valor_indenizacao) * Number(av.quantidade || 1))}</p> : null}</div>
      </div>
      <div><label className={labelCls}>Observação da cobrança</label><input value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex.: incluída na fatura da ficha 027866 no P2S" className={inputCls} /></div>
      {av.status_cobranca === 'COBRAR' && Number(av.valor_cobranca) > 0 && (
        <div className="flex flex-wrap items-end gap-2 border border-emerald-200 bg-emerald-50 rounded-xl p-3">
          <div><label className={labelCls}>Vencimento do título</label><input type="date" value={vencTitulo} onChange={e => setVencTitulo(e.target.value)} className={inputCls} /></div>
          <button onClick={gerarTitulo} disabled={salvando || !av.parceiro_id} className="bg-emerald-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase">💵 Gerar título a receber</button>
          {!av.parceiro_id && <p className="text-[10px] text-red-600">Avaria sem cliente — não dá para gerar título.</p>}
        </div>
      )}
      <p className="text-[10px] text-gray-500">Enquanto o P2S for oficial, a cobrança é lançada lá — o título gerado aqui é o ensaio (Financeiro → Títulos a Receber).</p>
    </Modal>
  );
}
