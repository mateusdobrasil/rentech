"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import * as XLSX from 'xlsx';
import {
  listarTitulosAction, buscarClientesTituloAction, criarTituloAvulsoAction, baixarTituloAction, estornarBaixaAction, cancelarTituloAction,
} from './actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import Modal from '../../../components/ui/Modal';
import CampoBusca, { type OpcaoBusca } from '../../../components/ui/CampoBusca';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda, formatarDataBR } from '../../../lib/formatadores';
import { somarDias, hojeISO } from '../../../lib/locacao/datas';

// Títulos a Receber de locação (2026-11-17, Fase 3a). Regras em ./actions.ts.

interface Titulo {
  id: number; empresa_id: number; parceiro_id: number; origem: 'FICHA' | 'AVARIA' | 'AVULSO'; ficha_id: number | null; avaria_id: number | null;
  descricao: string; parcela: number; total_parcelas: number; valor: number; data_emissao: string; vencimento: string;
  status: 'ABERTO' | 'PAGO' | 'CANCELADO'; forma_pagamento: string | null; data_pagamento: string | null; valor_pago: number | null;
  juros_multa: number; desconto: number; observacoes: string | null; motivo_cancelamento: string | null; boleto_status: string;
  cliente_nome: string; ficha_numero: string | null; criado_por: string; baixado_por: string | null;
}
type Situacao = 'abertos' | 'vencidos' | 'a_vencer' | 'pagos' | 'cancelados' | 'todos';
const FORMAS = ['PIX', 'BOLETO', 'TRANSFERÊNCIA', 'CARTÃO', 'DINHEIRO', 'OUTRO'];
function lerValor(s: string): number | null {
  const t = (s || '').replace(/\s|R\$/g, '');
  if (!t) return null;
  const v = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(v) ? v : NaN;
}

export default function TitulosReceberPage() {
  const router = useRouter();
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [titulos, setTitulos] = useState<Titulo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [situacao, setSituacao] = useState<Situacao>('abertos');
  const [filtroEmpresa, setFiltroEmpresa] = useState<number | null>(null);
  const [origem, setOrigem] = useState('');
  const [busca, setBusca] = useState('');
  const [baixa, setBaixa] = useState<Titulo | null>(null);
  const [formBaixa, setFormBaixa] = useState({ data: '', valor: '', forma: 'PIX', juros: '', desconto: '', obs: '' });
  const [modalNovo, setModalNovo] = useState(false);
  const [novo, setNovo] = useState({ empresa_id: 0, descricao: '', valor: '', vencimento: '', obs: '' });
  const [clienteNovo, setClienteNovo] = useState<OpcaoBusca | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await listarTitulosAction(accessToken);
    if (r.ok) { setEmpresas(r.info.empresas); setTitulos(r.info.titulos); }
    else toast(r.erro || 'Erro.', 'error');
    setCarregando(false);
  }, [accessToken, toast]);
  useEffect(() => { if (!authLoading && !acessoNegado && !erro && accessToken) carregar(); }, [authLoading, acessoNegado, erro, accessToken, carregar]);
  const buscarCli = useCallback(async (t: string) => { const r = await buscarClientesTituloAction(t, accessToken); return r.ok ? r.info : []; }, [accessToken]);

  const hoje = hojeISO();
  const em7 = somarDias(hoje, 7);
  const daEmp = titulos.filter(t => filtroEmpresa === null || t.empresa_id === filtroEmpresa);
  const abertos = daEmp.filter(t => t.status === 'ABERTO');
  const vencidos = abertos.filter(t => t.vencimento < hoje);
  const aVencer = abertos.filter(t => t.vencimento >= hoje);
  const prox7 = aVencer.filter(t => t.vencimento <= em7);
  const recebidoMes = daEmp.filter(t => t.status === 'PAGO' && (t.data_pagamento || '').slice(0, 7) === hoje.slice(0, 7));
  const soma = (l: Titulo[], campo: 'valor' | 'valor_pago' = 'valor') => l.reduce((s, t) => s + Number(t[campo] || 0), 0);

  const visiveis = daEmp.filter(t => {
    if (situacao === 'abertos' && t.status !== 'ABERTO') return false;
    if (situacao === 'vencidos' && !(t.status === 'ABERTO' && t.vencimento < hoje)) return false;
    if (situacao === 'a_vencer' && !(t.status === 'ABERTO' && t.vencimento >= hoje)) return false;
    if (situacao === 'pagos' && t.status !== 'PAGO') return false;
    if (situacao === 'cancelados' && t.status !== 'CANCELADO') return false;
    if (origem && t.origem !== origem) return false;
    const b = busca.trim().toLowerCase();
    if (b && ![t.cliente_nome, t.descricao, t.ficha_numero, String(t.id)].some(x => (x || '').toLowerCase().includes(b))) return false;
    return true;
  });

  const abrirBaixa = (t: Titulo) => {
    setFormBaixa({ data: hoje, valor: String(t.valor).replace('.', ','), forma: 'PIX', juros: '', desconto: '', obs: '' });
    setBaixa(t);
  };
  const confirmarBaixa = async () => {
    if (!baixa) return;
    const v = lerValor(formBaixa.valor), j = lerValor(formBaixa.juros), d = lerValor(formBaixa.desconto);
    if (!v || Number.isNaN(v) || Number.isNaN(j) || Number.isNaN(d)) return toast('Valores inválidos.', 'error');
    setSalvando(true);
    const r = await baixarTituloAction(baixa.id, { data_pagamento: formBaixa.data, valor_pago: v, forma_pagamento: formBaixa.forma, juros_multa: j || 0, desconto: d || 0, observacoes: formBaixa.obs }, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast('Recebimento registrado.', 'success'); setBaixa(null); carregar();
  };
  const estornar = async (t: Titulo) => {
    if (!(await confirmar({ title: 'Estornar baixa', danger: true, confirmLabel: 'Estornar', message: `Voltar o título #${t.id} para "em aberto"?` }))) return;
    const r = await estornarBaixaAction(t.id, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    carregar();
  };
  const cancelar = async (t: Titulo) => {
    const m = await pedir({ title: `Cancelar título #${t.id}`, message: 'Motivo do cancelamento:', placeholder: 'Ex.: renegociado, cliente desistiu' });
    if (m === null) return;
    const r = await cancelarTituloAction(t.id, m, accessToken);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    carregar();
  };
  const criarAvulso = async () => {
    const v = lerValor(novo.valor);
    if (!clienteNovo) return toast('Escolha o cliente.', 'error');
    if (!v || Number.isNaN(v)) return toast('Valor inválido.', 'error');
    setSalvando(true);
    const r = await criarTituloAvulsoAction({ empresa_id: novo.empresa_id, parceiro_id: Number(clienteNovo.id), descricao: novo.descricao, valor: v, vencimento: novo.vencimento, observacoes: novo.obs }, accessToken);
    setSalvando(false);
    if (!r.ok) return toast(r.erro || 'Erro.', 'error');
    toast('Título criado.', 'success'); setModalNovo(false); carregar();
  };
  const exportar = () => {
    const ws = XLSX.utils.json_to_sheet(visiveis.map(t => ({
      Título: t.id, Empresa: empresas.find(e => e.id === t.empresa_id)?.nome, Cliente: t.cliente_nome, Descrição: t.descricao, Origem: t.origem, Ficha: t.ficha_numero,
      Parcela: `${t.parcela}/${t.total_parcelas}`, Valor: Number(t.valor), Emissão: t.data_emissao, Vencimento: t.vencimento, Situação: t.status,
      'Pago em': t.data_pagamento, 'Valor pago': t.valor_pago, Forma: t.forma_pagamento,
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Títulos'); XLSX.writeFile(wb, `titulos-receber-${hoje}.xlsx`);
  };

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Títulos a Receber.</p>
          <button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Hub</button>
        </div>
      </div>
    );
  }

  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';
  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]';
  const cartao = (titulo: string, lista: Titulo[], sit: Situacao, cor?: string, campo: 'valor' | 'valor_pago' = 'valor', sub?: string) => (
    <button onClick={() => setSituacao(sit)} className={`text-left bg-white p-4 rounded-2xl border shadow-sm hover:shadow-md min-w-0 ${situacao === sit ? 'border-[#336699]' : 'border-[#E2E8F0]'}`}>
      <p className={`text-lg font-black truncate ${cor || 'text-[#0C1D4D]'}`}>{carregando ? '—' : formatarMoeda(soma(lista, campo))}</p>
      <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider mt-1">{titulo}</p>
      <p className="text-[10px] text-gray-400 mt-1">{carregando ? '' : sub || `${lista.length} título(s)`}</p>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">💵 <strong>Olá, {usuarioAtual}</strong>. Títulos a receber de locação.</p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg shadow-sm uppercase">⬅ VOLTAR AO HUB</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-4">
          <p className="text-xs bg-orange-50 border border-orange-200 text-orange-900 rounded-xl p-3">
            <strong>Fase paralela:</strong> enquanto o P2S for oficial, a cobrança real é feita lá — estes títulos são o ensaio do faturamento do sistema. Boleto/PIX pela API de Cobrança do Itaú entra quando a credencial e a especificação estiverem disponíveis.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cartao('A vencer', aVencer, 'a_vencer', undefined, 'valor', `${aVencer.length} título(s) · ${formatarMoeda(soma(prox7))} em 7 dias`)}
            {cartao('Vencidos', vencidos, 'vencidos', vencidos.length ? 'text-red-600' : undefined)}
            {cartao('Em aberto (total)', abertos, 'abertos')}
            {cartao('Recebido no mês', recebidoMes, 'pagos', 'text-emerald-700', 'valor_pago')}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <select value={situacao} onChange={e => setSituacao(e.target.value as Situacao)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold">
                <option value="abertos">Em aberto</option><option value="vencidos">Vencidos</option><option value="a_vencer">A vencer</option>
                <option value="pagos">Pagos</option><option value="cancelados">Cancelados</option><option value="todos">Todos</option>
              </select>
              <select value={origem} onChange={e => setOrigem(e.target.value)} className="border border-[#CBD5E1] rounded-lg px-2 py-2 text-xs font-bold">
                <option value="">Todas as origens</option><option value="FICHA">Fichas</option><option value="AVARIA">Avarias</option><option value="AVULSO">Avulsos</option>
              </select>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Cliente, descrição, ficha, nº..." className="border border-[#CBD5E1] rounded-lg px-3 py-2 text-xs w-60" />
              {empresas.length > 1 && (
                <>
                  <button onClick={() => setFiltroEmpresa(null)} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase border-2 ${filtroEmpresa === null ? `${corSeloEmpresa(null)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>Todas</button>
                  {empresas.map(e => <button key={e.id} onClick={() => setFiltroEmpresa(e.id)} className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase border-2 ${filtroEmpresa === e.id ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0]'}`}>{e.nome}</button>)}
                </>
              )}
              <div className="ml-auto flex gap-2">
                <button onClick={exportar} disabled={!visiveis.length} className="bg-white border border-[#CBD5E1] text-[#0C1D4D] px-3 py-2 rounded-lg text-[10px] font-black uppercase disabled:opacity-40">⬇ Excel</button>
                <button onClick={() => { setNovo({ empresa_id: filtroEmpresa || empresas[0]?.id || 0, descricao: '', valor: '', vencimento: somarDias(hoje, 7), obs: '' }); setClienteNovo(null); setModalNovo(true); }}
                  className="bg-[#0C1D4D] text-white px-4 py-2 rounded-lg text-[10px] font-black uppercase">+ Título avulso</button>
              </div>
            </div>

            {carregando ? <p className="text-sm text-gray-400 py-8 text-center">Carregando...</p> : visiveis.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">Nenhum título. Gere a partir de uma ficha de reserva aprovada (Locações → Orçamentos e Reservas) ou de uma avaria a cobrar.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[10px] font-black text-gray-500 uppercase border-b border-[#E2E8F0]">
                    <th className="p-2">Vencimento</th><th className="p-2">Cliente</th><th className="p-2">Descrição</th><th className="p-2 text-right">Valor</th><th className="p-2">Situação</th><th className="p-2"></th>
                  </tr></thead>
                  <tbody>
                    {visiveis.map(t => {
                      const vencido = t.status === 'ABERTO' && t.vencimento < hoje;
                      return (
                        <tr key={t.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] align-top">
                          <td className={`p-2 whitespace-nowrap font-bold ${vencido ? 'text-red-600' : ''}`}>{formatarDataBR(t.vencimento)}<span className="block text-[9px] text-gray-400 font-normal">#{t.id}</span></td>
                          <td className="p-2 min-w-[160px]"><p className="font-bold text-[#0C1D4D]">{t.cliente_nome}</p><span className={`text-[9px] font-black px-1.5 rounded ${corSeloEmpresa(t.empresa_id)}`}>{empresas.find(e => e.id === t.empresa_id)?.nome}</span></td>
                          <td className="p-2 min-w-[220px]">
                            <p>{t.descricao}</p>
                            <p className="text-[10px] text-gray-400">
                              {t.origem === 'FICHA' && t.ficha_id ? <button onClick={() => router.push(`/admin/locacoes/reservas/${t.ficha_id}`)} className="text-[#336699] font-bold hover:underline">{t.ficha_numero}</button> : t.origem.toLowerCase()}
                              {t.status === 'CANCELADO' && t.motivo_cancelamento ? ` · cancelado: ${t.motivo_cancelamento}` : ''}
                            </p>
                          </td>
                          <td className="p-2 text-right whitespace-nowrap font-black">{formatarMoeda(Number(t.valor))}
                            {t.status === 'PAGO' && Number(t.valor_pago) !== Number(t.valor) && <span className="block text-[10px] text-emerald-700 font-bold">pago {formatarMoeda(Number(t.valor_pago))}</span>}</td>
                          <td className="p-2 whitespace-nowrap">
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${t.status === 'PAGO' ? 'bg-emerald-100 text-emerald-700' : t.status === 'CANCELADO' ? 'bg-gray-100 text-gray-500' : vencido ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>
                              {t.status === 'PAGO' ? 'Pago' : t.status === 'CANCELADO' ? 'Cancelado' : vencido ? 'Vencido' : 'Em aberto'}
                            </span>
                            {t.status === 'PAGO' && <span className="block text-[10px] text-gray-400">{formatarDataBR(t.data_pagamento)} · {t.forma_pagamento}</span>}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap space-x-2">
                            {t.status === 'ABERTO' && <button onClick={() => abrirBaixa(t)} className="text-[10px] font-black uppercase text-emerald-700 hover:underline">Receber</button>}
                            {t.status === 'ABERTO' && <button onClick={() => cancelar(t)} className="text-[10px] font-black uppercase text-red-500 hover:underline">Cancelar</button>}
                            {t.status === 'PAGO' && <button onClick={() => estornar(t)} className="text-[10px] font-black uppercase text-gray-500 hover:underline">Estornar</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-3">{visiveis.length} título(s) · {formatarMoeda(soma(visiveis))}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={!!baixa} onClose={() => setBaixa(null)} title={`Registrar recebimento — título #${baixa?.id}`}
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setBaixa(null)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
          <button onClick={confirmarBaixa} disabled={salvando} className="bg-emerald-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Salvando...' : 'Confirmar recebimento'}</button>
        </div>}>
        {baixa && <p className="text-sm"><strong>{baixa.cliente_nome}</strong> — {baixa.descricao} · {formatarMoeda(Number(baixa.valor))} venc. {formatarDataBR(baixa.vencimento)}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Data do pagamento</label><input type="date" value={formBaixa.data} onChange={e => setFormBaixa({ ...formBaixa, data: e.target.value })} className={inputCls} /></div>
          <div><label className={labelCls}>Valor recebido</label><input value={formBaixa.valor} onChange={e => setFormBaixa({ ...formBaixa, valor: e.target.value })} inputMode="decimal" className={inputCls} /></div>
          <div><label className={labelCls}>Forma</label><select value={formBaixa.forma} onChange={e => setFormBaixa({ ...formBaixa, forma: e.target.value })} className={inputCls}>{FORMAS.map(f => <option key={f}>{f}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls}>Juros/multa</label><input value={formBaixa.juros} onChange={e => setFormBaixa({ ...formBaixa, juros: e.target.value })} inputMode="decimal" className={inputCls} /></div>
            <div><label className={labelCls}>Desconto</label><input value={formBaixa.desconto} onChange={e => setFormBaixa({ ...formBaixa, desconto: e.target.value })} inputMode="decimal" className={inputCls} /></div>
          </div>
        </div>
        <div><label className={labelCls}>Observação</label><input value={formBaixa.obs} onChange={e => setFormBaixa({ ...formBaixa, obs: e.target.value })} className={inputCls} /></div>
      </Modal>

      <Modal open={modalNovo} onClose={() => setModalNovo(false)} title="Título a receber avulso"
        footer={<div className="flex justify-end gap-2">
          <button onClick={() => setModalNovo(false)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
          <button onClick={criarAvulso} disabled={salvando} className="bg-[#0C1D4D] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase">{salvando ? 'Salvando...' : 'Criar'}</button>
        </div>}>
        {empresas.length > 1 && <div><label className={labelCls}>Empresa</label><select value={novo.empresa_id} onChange={e => setNovo({ ...novo, empresa_id: Number(e.target.value) })} className={inputCls}>{empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></div>}
        <div><label className={labelCls}>Cliente</label><CampoBusca placeholder="Buscar cliente..." buscar={buscarCli} valor={clienteNovo} onEscolher={setClienteNovo} onLimpar={() => setClienteNovo(null)} /></div>
        <div><label className={labelCls}>Descrição</label><input value={novo.descricao} onChange={e => setNovo({ ...novo, descricao: e.target.value })} className={inputCls} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Valor</label><input value={novo.valor} onChange={e => setNovo({ ...novo, valor: e.target.value })} inputMode="decimal" className={inputCls} /></div>
          <div><label className={labelCls}>Vencimento</label><input type="date" value={novo.vencimento} onChange={e => setNovo({ ...novo, vencimento: e.target.value })} className={inputCls} /></div>
        </div>
        <div><label className={labelCls}>Observação</label><input value={novo.obs} onChange={e => setNovo({ ...novo, obs: e.target.value })} className={inputCls} /></div>
      </Modal>
    </div>
  );
}
