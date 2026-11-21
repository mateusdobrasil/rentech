"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, useConfirm, usePrompt } from '../../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../../lib/coresEmpresa';
import { formatarMoeda } from '../../../lib/formatadores';
import { hojeISO } from '../../../lib/locacao/datas';
import {
  painelFiscalAction, buscarClientesAction, dadosClienteAction, buscarProdutosAction, itemProdutoAction, buscarFichasLocacaoAction,
  prepararRemessaAction, prepararRetornoAction, prepararNfseFaturaAction, emitirNfseAction, emitirNfeAction, consultarNotaAction,
  cancelarNotaAction, cartaCorrecaoAction, arquivoNotaAction, salvarParametrosFiscaisAction, salvarOperacaoFiscalAction,
} from './actions';
import MdfeAba from './MdfeAba';

// Fiscal — NF-e / NFS-e pela Focus NFe (2026-11-21). Só a Rentech emite.
// Enquanto o P2S for oficial, o ambiente fica em HOMOLOGAÇÃO (sem valor fiscal).
const STATUS: Record<string, { rot: string; cls: string }> = {
  PROCESSANDO: { rot: 'processando', cls: 'bg-blue-100 text-blue-700' }, AUTORIZADA: { rot: 'autorizada', cls: 'bg-emerald-100 text-emerald-700' },
  ERRO: { rot: 'erro', cls: 'bg-red-100 text-red-700' }, CANCELADA: { rot: 'cancelada', cls: 'bg-gray-200 text-gray-500' }, RASCUNHO: { rot: 'rascunho', cls: 'bg-gray-100 text-gray-500' },
};
const OPERACAO: Record<string, string> = {
  SERVICO: 'NFS-e · serviço', LOCACAO: 'NFS-e · locação', REMESSA_LOCACAO: 'NF-e · remessa', RETORNO_LOCACAO: 'NF-e · retorno', VENDA_ATIVO: 'NF-e · venda de ativo', VENDA_MERCADORIA: 'NF-e · venda',
};
type Modo = 'SERVICO' | 'LOCACAO' | 'REMESSA_LOCACAO' | 'RETORNO_LOCACAO' | 'VENDA_ATIVO' | 'VENDA_MERCADORIA';
const MODOS: { m: Modo; rot: string; dica: string }[] = [
  { m: 'SERVICO', rot: 'NFS-e de serviço', dica: 'Técnico, montagem, operação (ISS)' },
  { m: 'LOCACAO', rot: 'NFS-e de locação', dica: 'Quando o cliente exige nota da locação' },
  { m: 'REMESSA_LOCACAO', rot: 'NF-e de remessa', dica: 'Acompanha o equipamento (a partir da Ficha de Locação)' },
  { m: 'RETORNO_LOCACAO', rot: 'NF-e de retorno', dica: 'Entrada própria, referenciando a remessa' },
  { m: 'VENDA_ATIVO', rot: 'NF-e venda de ativo', dica: 'Equipamento do imobilizado' },
  { m: 'VENDA_MERCADORIA', rot: 'NF-e venda de mercadoria', dica: 'Item comprado para revenda' },
];
const FORMAS: [string, string][] = [['15', 'Boleto'], ['17', 'PIX'], ['18', 'Transferência'], ['16', 'Depósito'], ['03', 'Cartão de crédito'], ['01', 'Dinheiro'], ['99', 'Outros']];
const FRETES: [number, string][] = [[0, 'Por conta do emitente'], [1, 'Por conta do destinatário'], [2, 'Terceiros'], [9, 'Sem frete']];
const num = (s: string | number) => { const x = Number(String(s ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const numBR = (v: number, c = 2) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
const mini = 'text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md border border-[#E2E8F0] hover:bg-[#F1F5F9] disabled:opacity-40';
// Cor e fundo explícitos: sem eles o campo herdava a cor clara do tema escuro do
// sistema (globals.css) e o texto ficava branco sobre branco.
const inp = 'mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm bg-white text-[#0A2A4A] placeholder:text-gray-400';
const lbl = 'text-[11px] font-black uppercase tracking-wider text-gray-500';

function baixar(base64: string, nome: string, tipo: string) {
  const bin = atob(base64); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([b], { type: tipo })); const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

interface Item { produto_id?: number | null; codigo: string; descricao: string; ncm: string; unidade: string; quantidade: string; valor_unitario: string; origem?: string | null }
const paraItem = (i: any): Item => ({ produto_id: i.produto_id ?? null, codigo: String(i.codigo || ''), descricao: String(i.descricao || ''), ncm: String(i.ncm || ''), unidade: String(i.unidade || 'UN'), quantidade: numBR(Number(i.quantidade), 4), valor_unitario: numBR(Number(i.valor_unitario), 2), origem: i.origem ?? '0' });

function Conteudo() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();
  const [aba, setAba] = useState<'notas' | 'emitir' | 'mdfe' | 'parametros'>('notas');
  const [notaMdfe, setNotaMdfe] = useState<number | null>(null);
  const [de, setDe] = useState(`${hojeISO().slice(0, 8)}01`);
  const [ate, setAte] = useState(hojeISO());
  const [busca, setBusca] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  // formulário de emissão
  const [modo, setModo] = useState<Modo>('SERVICO');
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [buscaCli, setBuscaCli] = useState('');
  const [achadosCli, setAchadosCli] = useState<any[]>([]);
  const [valor, setValor] = useState('');
  const [disc, setDisc] = useState('');
  const [issRetido, setIssRetido] = useState(false);
  const [vinculo, setVinculo] = useState<{ faturaId?: number | null; fichaReservaId?: number | null; fichaLocacaoId?: number | null; notaReferenciadaId?: number | null; rotulo?: string }>({});
  const [itens, setItens] = useState<Item[]>([]);
  const [buscaProd, setBuscaProd] = useState('');
  const [achadosProd, setAchadosProd] = useState<any[]>([]);
  const [buscaFl, setBuscaFl] = useState('');
  const [achadosFl, setAchadosFl] = useState<any[]>([]);
  const [aviso, setAviso] = useState('');
  const [vol, setVol] = useState({ quantidade: '', especie: 'VOLUMES', peso_bruto: '', peso_liquido: '' });
  const [frete, setFrete] = useState(0);
  const [forma, setForma] = useState('15');
  const [infoAd, setInfoAd] = useState('');
  const [prefaturas, setPrefaturas] = useState<any>(null);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await painelFiscalAction({ de, ate }, accessToken);
      if (!vivo) return;
      if (r.ok) { setInfo(r.info); if (!empresaId && r.info.emissoras[0]) setEmpresaId(r.info.emissoras[0].id); } else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, de, ate, recarregar]);

  // atalhos vindos de outras telas: ?fatura=ID (NFS-e da Nota de Débito) · ?remessa=FL_ID
  const pFatura = params.get('fatura');
  const pRemessa = params.get('remessa');
  useEffect(() => {
    if (!accessToken || authLoading || acessoNegado) return;
    if (pFatura) abrirDeFatura(Number(pFatura));
    else if (pRemessa) abrirRemessa(Number(pRemessa));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pFatura, pRemessa, accessToken, authLoading, acessoNegado]);

  if (authLoading) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200"><div className="text-5xl mb-4">⛔</div><h2 className="text-xl font-black text-red-600 uppercase mb-4">Acesso Restrito</h2><button onClick={() => router.push('/admin/financeiro')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Financeiro</button></div></div>;

  const tok = accessToken as string;
  const limparNotaMdfe = () => setNotaMdfe(null);
  const atualizar = () => setRecarregar(v => v + 1);
  const emissoras: any[] = info?.emissoras || [];
  const emissora = emissoras.find(e => e.id === empresaId) || emissoras[0];
  const homolog = emissora?.ambiente !== 'PRODUCAO';
  const t = busca.trim().toLowerCase();
  const notas: any[] = (info?.notas || []).filter((x: any) => !t || [x.numero, x.cliente, x.os, x.fl, x.fatura, x.chave].some((y: string | null) => String(y || '').toLowerCase().includes(t)));
  const ehNfe = !['SERVICO', 'LOCACAO'].includes(modo);
  const totalItens = itens.reduce((a, i) => a + Math.round(num(i.quantidade) * num(i.valor_unitario) * 100) / 100, 0);

  function limparForm() {
    setCliente(null); setBuscaCli(''); setAchadosCli([]); setValor(''); setDisc(''); setIssRetido(false); setVinculo({}); setItens([]);
    setBuscaProd(''); setAchadosProd([]); setBuscaFl(''); setAchadosFl([]); setAviso(''); setVol({ quantidade: '', especie: 'VOLUMES', peso_bruto: '', peso_liquido: '' });
    setFrete(0); setForma('15'); setInfoAd(''); setPrefaturas(null);
  }
  function trocarModo(m: Modo) { setModo(m); limparForm(); if (m === 'RETORNO_LOCACAO') setFrete(1); }
  async function escolherCliente(id: number) {
    const r = await dadosClienteAction(id, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    setCliente(r.info); setAchadosCli([]); setBuscaCli('');
  }
  async function procurarCliente(v: string) {
    setBuscaCli(v);
    if (v.trim().length < 2) { setAchadosCli([]); return; }
    const r = await buscarClientesAction(v, tok); if (r.ok) setAchadosCli(r.info);
  }
  async function procurarProduto(v: string) {
    setBuscaProd(v);
    if (v.trim().length < 2) { setAchadosProd([]); return; }
    const r = await buscarProdutosAction(v, tok); if (r.ok) setAchadosProd(r.info);
  }
  async function addProduto(id: number) {
    const r = await itemProdutoAction(id, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    setItens(p => [...p, paraItem(r.info)]); setAchadosProd([]); setBuscaProd('');
  }
  async function procurarFl(v: string) {
    setBuscaFl(v);
    if (v.trim().length < 2) { setAchadosFl([]); return; }
    const r = await buscarFichasLocacaoAction(v, tok); if (r.ok) setAchadosFl(r.info);
  }
  async function carregarRemessa(flId: number) {
    setOcupado(true);
    const r = await prepararRemessaAction(flId, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    const x = r.info;
    setAchadosFl([]); setBuscaFl('');
    setEmpresaId(x.ficha.empresa_id);
    setVinculo({ fichaLocacaoId: x.ficha.id, fichaReservaId: x.ficha.ficha_reserva_id, rotulo: `Ficha de Locação ${x.ficha.numero}` });
    setItens(x.itens.map(paraItem));
    const peso = x.itens.reduce((a: number, i: any) => a + (Number(i.peso) || 0), 0);
    if (peso > 0) setVol(v => ({ ...v, peso_bruto: numBR(peso, 3), peso_liquido: numBR(peso, 3) }));
    const avisos = [x.base === 'PREVISTO' ? 'Nada saiu ainda nesta ficha — itens pelo PREVISTO.' : 'Itens que estão com o cliente agora.'];
    const semV = x.itens.filter((i: any) => !(Number(i.valor_unitario) > 0)).length; if (semV) avisos.push(`${semV} item(ns) sem valor do bem (indenização/custo de reposição) — preencha.`);
    const semN = x.itens.filter((i: any) => String(i.ncm || '').length !== 8).length; if (semN) avisos.push(`${semN} item(ns) sem NCM — preencha.`);
    if (x.remessasExistentes.length) avisos.push(`Já existe remessa ${x.remessasExistentes.map((n: any) => n.numero || 'em processamento').join(', ')} para esta ficha.`);
    setAviso(avisos.join(' '));
    if (x.ficha.parceiro_id) await escolherCliente(x.ficha.parceiro_id);
  }
  async function abrirRemessa(flId: number) {
    setAba('emitir'); trocarModo('REMESSA_LOCACAO');
    await carregarRemessa(flId);
  }
  async function abrirRetorno(nota: any) {
    setAba('emitir'); trocarModo('RETORNO_LOCACAO');
    setOcupado(true);
    const r = await prepararRetornoAction(nota.id, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    const x = r.info;
    setEmpresaId(x.remessa.empresa_id);
    setVinculo({ notaReferenciadaId: x.remessa.id, fichaLocacaoId: x.remessa.ficha_locacao_id, fichaReservaId: x.remessa.ficha_reserva_id, rotulo: `Retorno da remessa nº ${x.remessa.numero}` });
    setItens(x.itens.map(paraItem));
    if (!x.itens.length) setAviso('Tudo desta remessa já retornou.');
    await escolherCliente(x.remessa.parceiro_id);
  }
  async function abrirDeFatura(faturaId: number) {
    setAba('emitir'); trocarModo('SERVICO');
    const r = await prepararNfseFaturaAction(faturaId, tok);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    const x = r.info;
    setPrefaturas(x); setEmpresaId(x.empresaId);
    setVinculo({ faturaId: x.faturaId, fichaReservaId: x.fichaReservaId, rotulo: `Nota de Débito ${x.numero}` });
    setValor(numBR(x.valorServicos || x.total)); setDisc(x.discServicos);
    await escolherCliente(x.parceiroId);
  }

  async function emitir() {
    if (!emissora) return;
    if (!cliente) { toast('Escolha o cliente.', 'error'); return; }
    const amb = homolog ? 'HOMOLOGAÇÃO (sem valor fiscal)' : 'PRODUÇÃO — nota com valor fiscal';
    const resumo = ehNfe ? `${itens.length} item(ns) · ${formatarMoeda(totalItens)}` : formatarMoeda(num(valor));
    if (!(await confirmar({ title: `Emitir ${MODOS.find(m => m.m === modo)?.rot}`, message: `${cliente.nome} · ${resumo}\nAmbiente: ${amb}.`, confirmLabel: 'Emitir' }))) return;
    setOcupado(true);
    const r = ehNfe
      ? await emitirNfeAction({
          empresaId: emissora.id, operacao: modo, parceiroId: cliente.id, informacoes: infoAd || null, modalidadeFrete: frete, formaPagamento: forma,
          volumes: { quantidade: num(vol.quantidade), especie: vol.especie, peso_bruto: num(vol.peso_bruto), peso_liquido: num(vol.peso_liquido) },
          itens: itens.map(i => ({ produto_id: i.produto_id, codigo: i.codigo, descricao: i.descricao, ncm: i.ncm.replace(/\D/g, ''), unidade: i.unidade, quantidade: num(i.quantidade), valor_unitario: num(i.valor_unitario), origem: i.origem })),
          fichaReservaId: vinculo.fichaReservaId || null, fichaLocacaoId: vinculo.fichaLocacaoId || null, notaReferenciadaId: vinculo.notaReferenciadaId || null,
        }, tok)
      : await emitirNfseAction({ empresaId: emissora.id, operacao: modo as 'SERVICO' | 'LOCACAO', parceiroId: cliente.id, valor: num(valor), discriminacao: disc, issRetido, faturaId: vinculo.faturaId || null, fichaReservaId: vinculo.fichaReservaId || null }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha ao emitir.', 'error'); return; }
    const st = r.info.status;
    toast(st === 'AUTORIZADA' ? 'Nota autorizada.' : st === 'ERRO' ? `Recusada: ${r.info.mensagem}` : 'Enviada — aguardando autorização (atualize em instantes).', st === 'ERRO' ? 'error' : st === 'AUTORIZADA' ? 'success' : 'info');
    if (st !== 'ERRO') { limparForm(); setAba('notas'); if (pFatura || pRemessa) router.replace('/admin/financeiro/fiscal'); }
    atualizar();
  }

  const consultar = async (n: any) => { setOcupado(true); const r = await consultarNotaAction(n.id, tok); setOcupado(false); if (!r.ok) toast(r.erro || 'Falha.', 'error'); else if (r.info.mensagem) toast(r.info.mensagem, r.info.status === 'ERRO' ? 'error' : 'info'); atualizar(); };
  const arquivo = async (n: any, qual: 'pdf' | 'xml' | 'cce') => { setOcupado(true); const r = await arquivoNotaAction(n.id, qual, tok); setOcupado(false); if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; } baixar(r.info.base64, r.info.nome, r.info.tipo); };
  const cancelar = async (n: any) => {
    const j = await pedir({ title: `Cancelar ${n.tipo === 'NFE' ? 'NF-e' : 'NFS-e'} nº ${n.numero || ''}`, message: 'Justificativa (15 a 255 caracteres). A NF-e só pode ser cancelada em até 24h da autorização.', defaultValue: '', confirmLabel: 'Cancelar nota' });
    if (!j) return;
    setOcupado(true); const r = await cancelarNotaAction(n.id, j, tok); setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Nota cancelada.', 'success'); atualizar();
  };
  const cce = async (n: any) => {
    const c = await pedir({ title: `Carta de correção — NF-e nº ${n.numero}`, message: 'Texto da correção (15 a 1000 caracteres). Não corrige valores, impostos, emitente/destinatário nem datas; a última carta substitui as anteriores.', defaultValue: '', confirmLabel: 'Enviar' });
    if (!c) return;
    setOcupado(true); const r = await cartaCorrecaoAction(n.id, c, tok); setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Carta de correção registrada.', 'success'); atualizar();
  };

  const setItem = (k: number, campo: keyof Item, v: string) => setItens(p => p.map((x, i) => (i === k ? { ...x, [campo]: v } : x)));

  return (
    <div className="min-h-screen bg-[#F0F4F8] text-[#0A2A4A] pt-20 pb-16 px-3 md:px-8">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button onClick={() => router.push('/admin/financeiro')} className="text-xs font-bold text-[#336699] hover:underline">← Financeiro</button>
            <h1 className="text-2xl font-black text-[#0C1D4D] uppercase tracking-tight">Fiscal · NF-e, NFS-e e MDF-e</h1>
            <p className="text-xs text-gray-500">Emissão pela Focus NFe. A locação segue na Nota de Débito; aqui saem as notas fiscais.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {emissoras.map(e => (
              <span key={e.id} className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${corSeloEmpresa(e.id)}`}>{e.nome} · {e.ambiente === 'PRODUCAO' ? 'produção' : 'homologação'}</span>
            ))}
          </div>
        </div>

        {homolog && emissora && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-4 py-3">
            <strong>Homologação:</strong> as notas emitidas aqui não têm valor fiscal (o P2S continua oficial). A troca para produção fica em Parâmetros, só para o Administrador.
          </div>
        )}
        {!carregando && !emissoras.length && <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 text-sm text-gray-600">Nenhuma empresa sua emite nota fiscal pelo sistema (rode o SQL <code>fiscal_notas.sql</code>; só a Rentech emite).</div>}

        <div className="flex gap-1 border-b border-[#E2E8F0]">
          {([['notas', 'Notas emitidas'], ['emitir', 'Emitir'], ['mdfe', 'MDF-e (viagem)'], ...(info?.admin ? [['parametros', 'Parâmetros']] : [])] as [typeof aba, string][]).map(([k, r]) => (
            <button key={k} onClick={() => setAba(k)} className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-t-lg ${aba === k ? 'bg-white border border-b-white border-[#E2E8F0] text-[#0C1D4D] -mb-px' : 'text-gray-500 hover:text-[#0C1D4D]'}`}>{r}</button>
          ))}
        </div>

        {/* ============================== NOTAS ============================== */}
        {aba === 'notas' && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs"><span className={lbl}>De</span><input type="date" value={de} onChange={e => setDe(e.target.value)} className={inp} /></label>
              <label className="text-xs"><span className={lbl}>Até</span><input type="date" value={ate} onChange={e => setAte(e.target.value)} className={inp} /></label>
              <label className="text-xs flex-1 min-w-[200px]"><span className={lbl}>Buscar</span><input value={busca} onChange={e => setBusca(e.target.value)} placeholder="nº, cliente, OS, ficha, chave…" className={inp} /></label>
              <button onClick={atualizar} disabled={carregando} className={`${btn} bg-[#0C1D4D] text-white`}>Atualizar</button>
            </div>
            {carregando ? <p className="text-sm text-gray-500 p-4">Carregando…</p> : !notas.length ? <p className="text-sm text-gray-500 p-4">Nenhuma nota no período.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] font-black text-gray-500 uppercase border-b"><th className="p-2">Nº</th><th className="p-2">Tipo</th><th className="p-2">Cliente</th><th className="p-2">Vínculo</th><th className="p-2 text-right">Valor</th><th className="p-2">Situação</th><th className="p-2"></th></tr></thead>
                  <tbody>
                    {notas.map(x => (
                      <tr key={x.id} className="border-b border-[#F1F5F9] align-top">
                        <td className="p-2 font-bold whitespace-nowrap">{x.numero || '—'}{x.serie ? <span className="text-gray-400 font-normal"> s{x.serie}</span> : null}<div className="text-[10px] text-gray-400 font-normal">{new Date(x.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</div></td>
                        <td className="p-2 whitespace-nowrap">{OPERACAO[x.operacao] || x.operacao}{x.ambiente !== 'PRODUCAO' && <div className="text-[10px] font-black text-amber-700 uppercase">homologação</div>}</td>
                        <td className="p-2">{x.cliente}</td>
                        <td className="p-2 text-xs text-gray-600">{[x.os, x.fl && `FL ${x.fl}`, x.fatura && `ND ${x.fatura}`].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="p-2 text-right font-bold whitespace-nowrap">{formatarMoeda(Number(x.valor_total))}</td>
                        <td className="p-2 max-w-[280px]">
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${STATUS[x.status]?.cls || ''}`}>{STATUS[x.status]?.rot || x.status}</span>
                          {x.cce > 0 && <span className="ml-1 text-[10px] font-black uppercase text-violet-700">CC-e</span>}
                          {x.mensagem && x.status !== 'AUTORIZADA' && <div className={`text-[11px] mt-1 ${x.status === 'ERRO' ? 'text-red-700' : 'text-gray-500'}`}>{x.mensagem}</div>}
                          {x.motivo_cancelamento && <div className="text-[11px] mt-1 text-gray-500">{x.motivo_cancelamento}</div>}
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1 justify-end">
                            {x.status === 'PROCESSANDO' && <button disabled={ocupado} onClick={() => consultar(x)} className={mini}>Consultar</button>}
                            {x.tem_pdf && <button disabled={ocupado} onClick={() => arquivo(x, 'pdf')} className={mini}>{x.tipo === 'NFE' ? 'DANFE' : 'PDF'}</button>}
                            {x.tem_xml && <button disabled={ocupado} onClick={() => arquivo(x, 'xml')} className={mini}>XML</button>}
                            {x.cce > 0 && <button disabled={ocupado} onClick={() => arquivo(x, 'cce')} className={mini}>CC-e</button>}
                            {x.status === 'AUTORIZADA' && x.operacao === 'REMESSA_LOCACAO' && <button disabled={ocupado} onClick={() => abrirRetorno(x)} className={`${mini} text-[#336699]`}>Retorno</button>}
                            {x.status === 'AUTORIZADA' && ['REMESSA_LOCACAO', 'RETORNO_LOCACAO', 'VENDA_ATIVO', 'VENDA_MERCADORIA'].includes(x.operacao) && <button disabled={ocupado} onClick={() => { setNotaMdfe(x.id); setAba('mdfe'); }} className={mini} title="Manifesto da viagem com esta NF-e">MDF-e</button>}
                            {x.status === 'AUTORIZADA' && x.tipo === 'NFE' && <button disabled={ocupado} onClick={() => cce(x)} className={mini}>Corrigir</button>}
                            {x.status === 'AUTORIZADA' && <button disabled={ocupado} onClick={() => cancelar(x)} className={`${mini} text-red-700`}>Cancelar</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ============================== EMITIR ============================== */}
        {aba === 'emitir' && emissora && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {MODOS.map(m => (
                <button key={m.m} onClick={() => trocarModo(m.m)} className={`text-left rounded-xl border p-3 transition-colors ${modo === m.m ? 'border-[#336699] bg-[#EFF6FF]' : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'}`}>
                  <div className="text-xs font-black text-[#0C1D4D] uppercase">{m.rot}</div>
                  <div className="text-[11px] text-gray-500">{m.dica}</div>
                </button>
              ))}
            </div>

            {vinculo.rotulo && <div className="text-xs bg-[#F1F5F9] rounded-lg px-3 py-2">Vinculada a <strong>{vinculo.rotulo}</strong> <button onClick={limparForm} className="ml-2 text-[#336699] font-bold hover:underline">limpar</button></div>}
            {aviso && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">{aviso}</div>}

            {modo === 'REMESSA_LOCACAO' && !vinculo.fichaLocacaoId && (
              <div className="relative max-w-lg">
                <label className="text-xs"><span className={lbl}>Ficha de Locação</span><input value={buscaFl} onChange={e => procurarFl(e.target.value)} placeholder="nº da ficha (ex.: 07050/A)" className={inp} /></label>
                {achadosFl.length > 0 && <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2E8F0] rounded-lg shadow-lg max-h-64 overflow-y-auto">{achadosFl.map(f => <button key={f.id} onClick={() => carregarRemessa(f.id)} className="block w-full text-left px-3 py-2 text-sm hover:bg-[#F1F5F9]"><strong>{f.numero}</strong> · {f.cliente}{f.origem === 'P2S' ? <span className="text-[10px] text-gray-400"> (P2S)</span> : null}</button>)}</div>}
              </div>
            )}
            {modo === 'RETORNO_LOCACAO' && !vinculo.notaReferenciadaId && <p className="text-sm text-gray-600">O retorno sai a partir de uma remessa autorizada: em <strong>Notas emitidas</strong>, use o botão <strong>Retorno</strong> na remessa.</p>}

            {(modo !== 'RETORNO_LOCACAO' || vinculo.notaReferenciadaId) && (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="relative">
                    <span className={lbl}>Cliente{modo === 'RETORNO_LOCACAO' ? ' (quem devolve)' : ''}</span>
                    {cliente ? (
                      <div className="mt-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm">
                        <div className="flex justify-between gap-2"><strong>{cliente.nome}</strong>{!['REMESSA_LOCACAO', 'RETORNO_LOCACAO'].includes(modo) || !vinculo.rotulo ? <button onClick={() => setCliente(null)} className="text-xs text-[#336699] font-bold">trocar</button> : null}</div>
                        <div className="text-xs text-gray-500">{cliente.doc || 'sem documento'}{cliente.ie ? ` · IE ${cliente.ie}` : ''} · {[cliente.cidade, cliente.uf].filter(Boolean).join('/') || 'sem cidade'}</div>
                        {cliente.faltas?.length > 0 && <div className="text-xs text-red-700 mt-1">Cadastro incompleto{ehNfe ? ' (a NF-e exige)' : ''}: falta {cliente.faltas.join(', ')} — corrija em Comercial › Parceiros.</div>}
                      </div>
                    ) : (
                      <>
                        <input value={buscaCli} onChange={e => procurarCliente(e.target.value)} placeholder="nome ou CNPJ/CPF" className={inp} />
                        {achadosCli.length > 0 && <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2E8F0] rounded-lg shadow-lg max-h-64 overflow-y-auto">{achadosCli.map(c => <button key={c.id} onClick={() => escolherCliente(c.id)} className="block w-full text-left px-3 py-2 text-sm hover:bg-[#F1F5F9]"><strong>{c.nome}</strong> <span className="text-xs text-gray-500">{c.doc} {c.cidade}</span></button>)}</div>}
                      </>
                    )}
                  </div>
                  {!ehNfe && (
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs"><span className={lbl}>Valor (R$)</span><input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal" className={inp} /></label>
                      {modo === 'SERVICO' && <label className="text-xs flex items-end gap-2 pb-2"><input type="checkbox" checked={issRetido} onChange={e => setIssRetido(e.target.checked)} /> ISS retido pelo tomador</label>}
                      {prefaturas && (
                        <div className="col-span-2 flex flex-wrap gap-2 text-xs">
                          <button onClick={() => { setModo('SERVICO'); setValor(numBR(prefaturas.valorServicos)); setDisc(prefaturas.discServicos); }} className={mini}>Só os serviços ({formatarMoeda(prefaturas.valorServicos)})</button>
                          <button onClick={() => { setModo('LOCACAO'); setValor(numBR(prefaturas.total - prefaturas.valorServicos)); setDisc(prefaturas.discLocacao); }} className={mini}>Locação ({formatarMoeda(prefaturas.total - prefaturas.valorServicos)})</button>
                          <button onClick={() => { setValor(numBR(prefaturas.total)); }} className={mini}>Nota inteira ({formatarMoeda(prefaturas.total)})</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!ehNfe && (
                  <label className="text-xs block"><span className={lbl}>Discriminação</span>
                    <textarea value={disc} onChange={e => setDisc(e.target.value)} rows={4} className={inp} placeholder={modo === 'LOCACAO' ? (info?.parametros?.[0]?.nfse_locacao_discriminacao_padrao || '') : 'Descreva o serviço prestado'} />
                  </label>
                )}

                {ehNfe && (
                  <>
                    {['VENDA_ATIVO', 'VENDA_MERCADORIA'].includes(modo) && (
                      <div className="relative max-w-lg">
                        <label className="text-xs"><span className={lbl}>Adicionar produto</span><input value={buscaProd} onChange={e => procurarProduto(e.target.value)} placeholder="nome ou código" className={inp} /></label>
                        {achadosProd.length > 0 && <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2E8F0] rounded-lg shadow-lg max-h-64 overflow-y-auto">{achadosProd.map(p => <button key={p.id} onClick={() => addProduto(p.id)} className="block w-full text-left px-3 py-2 text-sm hover:bg-[#F1F5F9]">{p.nome} <span className="text-xs text-gray-400">{p.codigo}</span></button>)}</div>}
                      </div>
                    )}
                    <div className="overflow-x-auto border border-[#E2E8F0] rounded-xl">
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-[10px] font-black text-gray-500 uppercase border-b bg-[#F8FAFC]"><th className="p-2">Item</th><th className="p-2 w-28">NCM</th><th className="p-2 w-16">Un</th><th className="p-2 w-24 text-right">Qtd</th><th className="p-2 w-28 text-right">{modo.startsWith('VENDA') ? 'Valor unit.' : 'Valor do bem'}</th><th className="p-2 w-28 text-right">Total</th><th className="p-2 w-8"></th></tr></thead>
                        <tbody>
                          {itens.map((i, k) => (
                            <tr key={k} className="border-b border-[#F1F5F9]">
                              <td className="p-2">{i.descricao}<div className="text-[10px] text-gray-400">{i.codigo}</div></td>
                              <td className="p-1"><input value={i.ncm} onChange={e => setItem(k, 'ncm', e.target.value)} className={`w-full border rounded px-2 py-1 ${i.ncm.replace(/\D/g, '').length === 8 ? 'border-[#E2E8F0]' : 'border-red-400 bg-red-50'}`} /></td>
                              <td className="p-1"><input value={i.unidade} onChange={e => setItem(k, 'unidade', e.target.value)} className="w-full border border-[#E2E8F0] rounded px-2 py-1" /></td>
                              <td className="p-1"><input value={i.quantidade} onChange={e => setItem(k, 'quantidade', e.target.value)} inputMode="decimal" className="w-full border border-[#E2E8F0] rounded px-2 py-1 text-right" /></td>
                              <td className="p-1"><input value={i.valor_unitario} onChange={e => setItem(k, 'valor_unitario', e.target.value)} inputMode="decimal" className={`w-full border rounded px-2 py-1 text-right ${num(i.valor_unitario) > 0 ? 'border-[#E2E8F0]' : 'border-red-400 bg-red-50'}`} /></td>
                              <td className="p-2 text-right font-bold">{formatarMoeda(Math.round(num(i.quantidade) * num(i.valor_unitario) * 100) / 100)}</td>
                              <td className="p-1 text-center"><button onClick={() => setItens(p => p.filter((_, j) => j !== k))} className="text-red-600 font-black" title="Remover">×</button></td>
                            </tr>
                          ))}
                          {!itens.length && <tr><td colSpan={7} className="p-3 text-gray-400">Sem itens.</td></tr>}
                          {itens.length > 0 && <tr className="font-black"><td colSpan={5} className="p-2 text-right">Total da nota</td><td className="p-2 text-right">{formatarMoeda(totalItens)}</td><td /></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                      <label className="text-xs"><span className={lbl}>Volumes</span><input value={vol.quantidade} onChange={e => setVol(v => ({ ...v, quantidade: e.target.value }))} inputMode="numeric" className={inp} /></label>
                      <label className="text-xs"><span className={lbl}>Espécie</span><input value={vol.especie} onChange={e => setVol(v => ({ ...v, especie: e.target.value }))} className={inp} /></label>
                      <label className="text-xs"><span className={lbl}>Peso bruto (kg)</span><input value={vol.peso_bruto} onChange={e => setVol(v => ({ ...v, peso_bruto: e.target.value }))} inputMode="decimal" className={inp} /></label>
                      <label className="text-xs"><span className={lbl}>Peso líquido (kg)</span><input value={vol.peso_liquido} onChange={e => setVol(v => ({ ...v, peso_liquido: e.target.value }))} inputMode="decimal" className={inp} /></label>
                      <label className="text-xs"><span className={lbl}>Frete</span><select value={frete} onChange={e => setFrete(Number(e.target.value))} className={inp}>{FRETES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>
                      {modo.startsWith('VENDA') && <label className="text-xs"><span className={lbl}>Pagamento</span><select value={forma} onChange={e => setForma(e.target.value)} className={inp}>{FORMAS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></label>}
                    </div>
                    <label className="text-xs block"><span className={lbl}>Informações complementares</span>
                      <textarea value={infoAd} onChange={e => setInfoAd(e.target.value)} rows={2} className={inp} placeholder="Ex.: evento, local de montagem, nº da OS. O texto padrão da operação é acrescentado automaticamente." />
                    </label>
                  </>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-xs text-gray-500">{homolog ? 'Homologação — sem valor fiscal' : 'PRODUÇÃO — nota com valor fiscal'}</span>
                  <button onClick={emitir} disabled={ocupado || !cliente || (ehNfe ? !itens.length : num(valor) <= 0)} className={`${btn} ${homolog ? 'bg-[#0C1D4D]' : 'bg-red-700'} text-white`}>{ocupado ? 'Enviando…' : 'Emitir nota'}</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ============================== MDF-e ============================== */}
        {aba === 'mdfe' && emissora && <MdfeAba tok={tok} empresaId={emissora.id} homolog={homolog} notaInicial={notaMdfe} onNotaUsada={limparNotaMdfe} />}

        {/* ============================== PARÂMETROS ============================== */}
        {aba === 'parametros' && info?.admin && <Parametros info={info} tok={tok} onSalvo={atualizar} />}
      </div>
    </div>
  );
}

function Parametros({ info, tok, onSalvo }: { info: any; tok: string; onSalvo: () => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [p, setP] = useState<any>(() => ({ ...(info.parametros?.[0] || {}) }));
  const [ops, setOps] = useState<any[]>(() => info.operacoes.map((o: any) => ({ ...o })));
  const [salvando, setSalvando] = useState(false);
  if (!info.parametros?.length) return null;
  const empresa = info.emissoras.find((e: any) => e.id === p.empresa_id);
  const campo = (k: string, rot: string, dica?: string) => (
    <label className="text-xs"><span className={lbl}>{rot}</span><input value={p[k] ?? ''} onChange={e => setP((x: any) => ({ ...x, [k]: e.target.value }))} className={inp} />{dica && <span className="text-[10px] text-gray-400">{dica}</span>}</label>
  );
  const salvar = async () => {
    const original = info.parametros[0];
    if (p.ambiente === 'PRODUCAO' && original.ambiente !== 'PRODUCAO' && !(await confirmar({ title: 'Ir para PRODUÇÃO', message: 'A partir daqui as notas têm valor fiscal. Confirme que o contador validou códigos, alíquotas e CFOPs, e que o P2S deixou de emitir notas para esta empresa.', confirmLabel: 'Ir para produção' }))) return;
    setSalvando(true);
    const r = await salvarParametrosFiscaisAction(p.empresa_id, p, tok);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast('Parâmetros salvos.', 'success'); onSalvo();
  };
  const salvarOp = async (o: any) => {
    setSalvando(true);
    const r = await salvarOperacaoFiscalAction(o.codigo, o, tok);
    setSalvando(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(`${o.nome} salva.`, 'success'); onSalvo();
  };
  const setOp = (k: number, c: string, v: string) => setOps(l => l.map((o, i) => (i === k ? { ...o, [c]: v } : o)));
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase text-[#0C1D4D]">{empresa?.nome} — emissão</h2>
          <div className="flex flex-wrap gap-3">
          <label className="text-xs flex items-center gap-2"><span className={lbl}>Regime</span>
            <select value={p.regime || 'SIMPLES_NACIONAL'} onChange={e => setP((x: any) => ({ ...x, regime: e.target.value }))} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm font-bold">
              <option value="SIMPLES_NACIONAL">Simples Nacional</option><option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
            </select>
          </label>
          <label className="text-xs flex items-center gap-2"><span className={lbl}>Lucro Presumido a partir de</span>
            <input type="date" value={p.lucro_presumido_desde || ''} onChange={e => setP((x: any) => ({ ...x, lucro_presumido_desde: e.target.value }))} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs flex items-center gap-2"><span className={lbl}>Ambiente</span>
            <select value={p.ambiente} onChange={e => setP((x: any) => ({ ...x, ambiente: e.target.value }))} className="border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm font-bold">
              <option value="HOMOLOGACAO">Homologação (teste)</option><option value="PRODUCAO">Produção (valor fiscal)</option>
            </select>
          </label>
          </div>
        </div>
        <p className="text-[11px] text-gray-500">O regime tem de bater com a Prefeitura, a SEFAZ e o cadastro na Focus. Com a data preenchida, o sistema passa sozinho a emitir como Lucro Presumido nesse dia (antes dela a SEFAZ recusa CST e exige CSOSN) — lembre de mudar o regime também no painel da Focus.</p>
        <p className="text-xs font-black uppercase text-gray-500">NFS-e de serviço (técnico, montagem, operação)</p>
        <div className="grid md:grid-cols-4 gap-3">
          {campo('nfse_item_lista_servico', 'Código de serviço (Prefeitura)', 'SP: 5 dígitos — o mesmo das NFS-e nº 68/70')}
          {campo('nfse_aliquota', 'Alíquota ISS (%)', 'ex.: 5')}
          {campo('nfse_codigo_cnae', 'CNAE (opcional)')}
          {campo('nfse_codigo_tributario_municipio', 'Cód. tributário municipal (opcional)')}
        </div>
        <p className="text-xs font-black uppercase text-gray-500">NFS-e de locação (sob pedido do cliente)</p>
        <div className="grid md:grid-cols-4 gap-3">
          {campo('nfse_locacao_item_lista_servico', 'Código de serviço (Prefeitura)')}
          {campo('nfse_locacao_aliquota', 'Alíquota ISS (%)', 'vazio = não informa')}
          <div className="md:col-span-2">{campo('nfse_locacao_discriminacao_padrao', 'Texto padrão')}</div>
        </div>
        <p className="text-xs font-black uppercase text-gray-500">NFS-e no Lucro Presumido com IBS/CBS (leiaute 2 de SP)</p>
        <div className="grid md:grid-cols-4 gap-3">
          {campo('nfse_codigo_nbs', 'Código NBS')}
          {campo('nfse_codigo_indicador_operacao', 'Indicador de operação (cIndOp)')}
          {campo('nfse_ibs_cbs_situacao_tributaria', 'CST IBS/CBS')}
          {campo('nfse_ibs_cbs_classificacao_tributaria', 'cClassTrib')}
        </div>
        <p className="text-xs font-black uppercase text-gray-500">MDF-e (manifesto da viagem)</p>
        <div className="grid md:grid-cols-4 gap-3">
          {campo('mdfe_cep_carregamento', 'CEP de saída da carga', 'endereço da Rentech — exigido quando a viagem leva 1 NF-e')}
          <label className="text-xs"><span className={lbl}>Tipo de carga</span><select value={p.mdfe_tipo_carga || '05'} onChange={e => setP((x: any) => ({ ...x, mdfe_tipo_carga: e.target.value }))} className={inp}><option value="05">Carga geral</option><option value="04">Conteinerizada</option><option value="11">Perigosa (carga geral)</option></select></label>
          <div className="md:col-span-2">{campo('mdfe_produto_predominante', 'Produto predominante')}</div>
          {campo('mdfe_ncm', 'NCM predominante (opcional)')}
          {campo('mdfe_seguradora_nome', 'Seguradora da carga (opcional)')}
          {campo('mdfe_seguradora_cnpj', 'CNPJ da seguradora')}
          {campo('mdfe_apolice', 'Nº da apólice')}
          {campo('mdfe_averbacao', 'Nº de averbação (opcional)')}
        </div>
        <p className="text-[11px] text-gray-500">Seguro da carga é opcional para carga própria; preenchido (apólice + CNPJ da seguradora), vai em todo MDF-e.</p>
        <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={!!p.enviar_ibs_cbs} onChange={e => setP((x: any) => ({ ...x, enviar_ibs_cbs: e.target.checked }))} /> Enviar campos IBS/CBS (reforma tributária) — só no Lucro Presumido</label>
        <div className="flex justify-end"><button onClick={salvar} disabled={salvando} className={`${btn} bg-[#0C1D4D] text-white`}>Salvar parâmetros</button></div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-black uppercase text-[#0C1D4D]">Operações da NF-e</h2>
        <p className="text-xs text-gray-500">CST/alíquotas valem no Lucro Presumido; CSOSN e PIS/COFINS (Simples) valem enquanto a empresa for do Simples. Ponto de partida — o contador confere antes de ir para produção.</p>
        {ops.map((o, k) => (
          <div key={o.codigo} className="border border-[#E2E8F0] rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{o.nome}</strong><span className="text-[10px] font-black uppercase text-gray-400">{o.tipo_documento === 0 ? 'entrada' : 'saída'} · valor {o.valor_base === 'BEM' ? 'do bem' : 'informado'}</span></div>
            <div className="grid grid-cols-2 md:grid-cols-8 gap-2">
              {([['natureza_operacao', 'Natureza', 'md:col-span-2'], ['cfop_interno', 'CFOP SP'], ['cfop_interestadual', 'CFOP fora'], ['icms_situacao_tributaria', 'CST ICMS'], ['pis_situacao_tributaria', 'CST PIS'], ['cofins_situacao_tributaria', 'CST COFINS'], ['icms_aliquota_interna', 'ICMS % SP'],
                 ['icms_aliquota_interestadual', 'ICMS % fora'], ['pis_aliquota', 'PIS %'], ['cofins_aliquota', 'COFINS %'], ['ibs_cbs_situacao_tributaria', 'CST IBS/CBS'], ['ibs_cbs_classificacao_tributaria', 'cClassTrib'], ['icms_csosn', 'CSOSN (Simples)'], ['pis_cst_simples', 'PIS (Simples)'], ['cofins_cst_simples', 'COFINS (Simples)']] as [string, string, string?][]).map(([c, r, cls]) => (
                <label key={c} className={`text-xs ${cls || ''}`}><span className="text-[10px] font-black uppercase text-gray-500">{r}</span><input value={o[c] ?? ''} onChange={e => setOp(k, c, e.target.value)} className="mt-0.5 w-full border border-[#E2E8F0] rounded px-2 py-1 text-xs" /></label>
              ))}
              <label className="text-xs col-span-2 md:col-span-5"><span className="text-[10px] font-black uppercase text-gray-500">Informações padrão</span><input value={o.informacoes_padrao ?? ''} onChange={e => setOp(k, 'informacoes_padrao', e.target.value)} className="mt-0.5 w-full border border-[#E2E8F0] rounded px-2 py-1 text-xs" /></label>
            </div>
            <div className="flex justify-end"><button onClick={() => salvarOp(o)} disabled={salvando} className={mini}>Salvar</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FiscalPage() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
      <Analytics />
    </Suspense>
  );
}
