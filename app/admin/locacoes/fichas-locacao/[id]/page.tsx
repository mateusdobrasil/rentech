"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../../components/hooks/usePageAccess';
import { HubErro } from '../../../../components/ui/HubStates';
import { useToast, useConfirm, usePrompt } from '../../../../components/ui/NotificationProvider';
import Modal from '../../../../components/ui/Modal';
import LeitorQR, { bipLeitura } from '../../../../components/ui/LeitorQR';
import AssinaturaTela from '../../../../components/ui/AssinaturaTela';
import { formatarDataBR, formatarMoeda } from '../../../../lib/formatadores';
import { hojeISO } from '../../../../lib/locacao/datas';
import {
  carregarFichaLocacaoAction, registrarMovimentoAction, registrarTrocaAction, encerrarFichaLocacaoAction, encerrarRetornoAction,
  pecasDoItemAction, lerPatrimonioAction, assinarComprovanteAction, pdfOsAction,
} from '../actions';

// Ficha de Locação (2026-11-20): saídas, devoluções, trocas e a OS assinada
// na tela. Extravio é automático (devolução final / retorno encerrado sem
// entrada) e gera cobrança de reposição no Financeiro. Prorrogação e
// complemento são do Comercial — ficam na OS (ficha de reserva).
const ROTA = '/admin/locacoes/fichas-locacao';

interface Saldo {
  id: number; ficha_item_id: number | null; produto_id: number; descricao: string; codigo: string | null; controle: 'INDIVIDUAL' | 'QUANTIDADE';
  valor_indenizacao: number | null; prevista: number; extra: boolean; saiu: number; devolvido: number; extraviado: number; fora: number; pendenteSaida: number;
  pecasFora: { id: number; numero: string }[];
}
type Gravidade = 'LEVE' | 'MEDIA' | 'GRAVE' | 'PERDA_TOTAL';
interface AvariaForm { ativo: boolean; qtd: string; patrimonio_id: number | null; gravidade: Gravidade; descricao: string; cobranca: 'A_DEFINIR' | 'COBRAR' | 'NAO_COBRAR'; valor: string; abrir_os: boolean }
const AVARIA_VAZIA: AvariaForm = { ativo: false, qtd: '1', patrimonio_id: null, gravidade: 'MEDIA', descricao: '', cobranca: 'A_DEFINIR', valor: '', abrir_os: true };

const q3 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const num = (s: string) => { const x = Number(String(s || '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const ROTULO_TIPO: Record<string, string> = { SAIDA: 'Saída', DEVOLUCAO: 'Devolução', EXTRAVIO: 'Extravio' };

function baixarPdf(base64: string, nome: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function FichaLocacaoPage() {
  const router = useRouter();
  const params = useParams();
  const id = Number(params?.id);
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota: ROTA });
  const [info, setInfo] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  // modal de saída/devolução
  const [mov, setMov] = useState<null | 'SAIDA' | 'DEVOLUCAO'>(null);
  const [movData, setMovData] = useState(hojeISO());
  const [movQtd, setMovQtd] = useState<Record<number, string>>({});
  const [movPecas, setMovPecas] = useState<Record<number, { id: number; numero: string }[]>>({});
  const [movAvaria, setMovAvaria] = useState<Record<number, AvariaForm>>({});
  const [movObs, setMovObs] = useState('');
  const [movFinal, setMovFinal] = useState(false);
  // troca
  const [troca, setTroca] = useState(false);
  const [trocaItem, setTrocaItem] = useState<number>(0);
  const [trocaQtd, setTrocaQtd] = useState('1');
  const [trocaVolta, setTrocaVolta] = useState<number | null>(null);
  const [trocaSai, setTrocaSai] = useState<number | null>(null);
  const [trocaPecas, setTrocaPecas] = useState<{ id: number; numero: string; estado: string }[]>([]);
  const [trocaMotivo, setTrocaMotivo] = useState('');
  const [trocaGravidade, setTrocaGravidade] = useState<Gravidade>('MEDIA');
  // assinatura
  const [assinar, setAssinar] = useState<null | { id: number; tipo: string }>(null);
  const [assNome, setAssNome] = useState('');
  const [assDoc, setAssDoc] = useState('');
  const [assPng, setAssPng] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken || !id) return;
    let vivo = true;
    (async () => {
      setCarregando(true);
      const r = await carregarFichaLocacaoAction(id, accessToken);
      if (!vivo) return;
      if (r.ok) setInfo(r.info); else toast(r.erro || 'Erro ao carregar.', 'error');
      setCarregando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, id, recarregar]);

  const recarregarTela = useCallback(() => setRecarregar(x => x + 1), []);

  if (authLoading || (carregando && !info)) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  }
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar ao Hub</button>
        </div>
      </div>
    );
  }
  if (!info) return <div className="min-h-screen bg-[#F0F4F8] pt-24 text-center text-sm text-gray-500">Ficha não encontrada. <button className="underline" onClick={() => router.push(ROTA)}>Voltar</button></div>;

  const f = info.ficha, r = info.reserva;
  const saldos: Saldo[] = info.saldos || [];
  const propria = f.origem === 'SISTEMA';
  const aberta = propria && f.status === 'A';
  const temFora = saldos.some(s => s.fora > 0);
  const temPendente = saldos.some(s => s.pendenteSaida > 0);
  const podeEditar = !!info.podeEditar;
  const tokenOk = accessToken as string;

  const pdf = async (args: { comprovanteId?: number; flId?: number }) => {
    setOcupado(true);
    const x = await pdfOsAction(args, tokenOk);
    setOcupado(false);
    if (!x.ok) { toast(x.erro || 'Falha ao gerar o PDF.', 'error'); return; }
    baixarPdf(x.info.base64, x.info.nome);
  };

  // ---------------- saída / devolução ----------------
  const abrirMov = (tipo: 'SAIDA' | 'DEVOLUCAO') => {
    setMov(tipo); setMovData(hojeISO()); setMovObs(''); setMovPecas({}); setMovAvaria({}); setMovFinal(false);
    const q: Record<number, string> = {};
    for (const s of saldos) q[s.id] = '';
    setMovQtd(q);
  };
  const limiteMov = (s: Saldo) => (mov === 'SAIDA' ? s.pendenteSaida : s.fora);
  const lerNoMov = async (codigo: string) => {
    const x = await lerPatrimonioAction(id, codigo, tokenOk);
    if (!x.ok) { bipLeitura(false); toast(x.erro || 'Não encontrado.', 'error'); return; }
    const p = x.info;
    if (mov === 'DEVOLUCAO' && !p.comCliente) { bipLeitura(false); toast(`${p.numero} não está com o cliente nesta ficha.`, 'error'); return; }
    if (mov === 'SAIDA' && p.comCliente) { bipLeitura(false); toast(`${p.numero} já está com o cliente.`, 'error'); return; }
    // primeiro item do produto que ainda tem espaço
    const alvo = saldos.find(s => p.previstos.includes(s.id) && (movPecas[s.id]?.length || 0) < limiteMov(s)) || saldos.find(s => p.previstos.includes(s.id));
    if (!alvo) return;
    if (Object.values(movPecas).some(l => l.some(x2 => x2.id === p.patrimonio_id))) { bipLeitura(false); toast(`${p.numero} já foi lido.`, 'error'); return; }
    bipLeitura(true);
    setMovPecas(prev => ({ ...prev, [alvo.id]: [...(prev[alvo.id] || []), { id: p.patrimonio_id, numero: p.numero }] }));
    setMovQtd(prev => ({ ...prev, [alvo.id]: String(Math.max(num(prev[alvo.id] || '0'), (movPecas[alvo.id]?.length || 0) + 1)) }));
  };
  const enviarMov = async () => {
    if (!mov) return;
    const linhas: any[] = [];
    for (const s of saldos) {
      const q = num(movQtd[s.id] || '0');
      if (q <= 0) continue;
      const pecas = movPecas[s.id] || [];
      if (pecas.length > q) { toast(`"${s.descricao}": ${pecas.length} peça(s) lida(s) e quantidade ${q}.`, 'error'); return; }
      const av = movAvaria[s.id];
      const comAvaria = mov === 'DEVOLUCAO' && av?.ativo;
      if (comAvaria && !av.descricao.trim()) { toast(`Descreva a avaria de "${s.descricao}".`, 'error'); return; }
      const avariaPayload = comAvaria ? {
        gravidade: av.gravidade, descricao: av.descricao, status_cobranca: av.cobranca, valor_cobranca: av.valor ? num(av.valor) : null, abrir_os: av.abrir_os,
      } : null;
      let resto = q;
      let avariaUsada = false;
      for (const p of pecas) {
        const comEsta = comAvaria && av.patrimonio_id === p.id;
        if (comEsta) avariaUsada = true;
        linhas.push({ previsto_id: s.id, quantidade: 1, patrimonio_id: p.id, avaria: comEsta ? avariaPayload : null });
        resto -= 1;
      }
      if (comAvaria && !avariaUsada) {
        const qa = Math.min(num(av.qtd) || 1, resto);
        if (qa <= 0) { toast(`"${s.descricao}": escolha a peça avariada entre as lidas.`, 'error'); return; }
        linhas.push({ previsto_id: s.id, quantidade: qa, avaria: avariaPayload });
        resto -= qa;
      }
      if (resto > 1e-9) linhas.push({ previsto_id: s.id, quantidade: Math.round(resto * 1000) / 1000 });
    }
    const final = mov === 'DEVOLUCAO' && movFinal;
    if (final) {
      const faltando = saldos.map(s => ({ s, falta: Math.round((s.fora - num(movQtd[s.id] || '0')) * 1000) / 1000 })).filter(x2 => x2.falta > 0);
      if (faltando.length && !(await confirmar({
        title: 'Devolução final', danger: true, confirmLabel: 'Confirmar extravio',
        message: `Não voltaram:\n${faltando.map(x2 => `• ${q3(x2.falta)}× ${x2.s.descricao}`).join('\n')}\n\nViram EXTRAVIO (saem do estoque) e geram cobrança de REPOSIÇÃO no Financeiro, que decide cobrar ou cancelar.`,
      }))) return;
      if (!linhas.length) {
        setOcupado(true);
        const e = await encerrarRetornoAction(id, tokenOk);
        setOcupado(false);
        if (!e.ok) { toast(e.erro || 'Falha.', 'error'); return; }
        toast(e.info.avisos.join(' '), 'success');
        setMov(null); recarregarTela();
        return;
      }
    }
    if (!linhas.length) { toast('Informe as quantidades.', 'error'); return; }
    setOcupado(true);
    const x = await registrarMovimentoAction(id, { tipo: mov, data: movData, linhas, observacoes: movObs || null, devolucaoFinal: final }, tokenOk);
    setOcupado(false);
    if (!x.ok) { toast(x.erro || 'Falha ao registrar.', 'error'); return; }
    toast(`${ROTULO_TIPO[mov]} registrada (${x.info.movimentos} linha(s)).${x.info.avisos?.length ? ` ${x.info.avisos.join(' ')}` : ''}`, 'success');
    const tipo = mov;
    setMov(null);
    recarregarTela();
    if (x.info.comprovanteId) { setAssinar({ id: x.info.comprovanteId, tipo }); setAssNome(''); setAssDoc(''); setAssPng(null); }
  };

  // ---------------- troca ----------------
  const abrirTroca = async () => {
    const primeiro = saldos.find(s => s.fora > 0);
    if (!primeiro) return;
    setTroca(true); setTrocaQtd('1'); setTrocaVolta(null); setTrocaSai(null); setTrocaMotivo(''); setTrocaGravidade('MEDIA');
    await escolherItemTroca(primeiro.id);
  };
  const escolherItemTroca = async (previstoId: number) => {
    setTrocaItem(previstoId); setTrocaVolta(null); setTrocaSai(null); setTrocaPecas([]);
    const s = saldos.find(x => x.id === previstoId);
    if (s?.controle === 'INDIVIDUAL') {
      const x = await pecasDoItemAction(id, previstoId, tokenOk);
      if (x.ok) setTrocaPecas(x.info);
    }
  };
  const enviarTroca = async () => {
    const s = saldos.find(x => x.id === trocaItem);
    if (!s) return;
    if (!trocaMotivo.trim()) { toast('Informe o motivo da troca.', 'error'); return; }
    const individual = s.controle === 'INDIVIDUAL';
    if (individual && (!trocaVolta || !trocaSai)) { toast('Escolha a peça que volta e a que sai.', 'error'); return; }
    setOcupado(true);
    const x = await registrarTrocaAction(id, {
      previsto_id: s.id, quantidade: individual ? 1 : num(trocaQtd), volta_patrimonio_id: trocaVolta, sai_patrimonio_id: trocaSai, data: hojeISO(), motivo: trocaMotivo,
      avaria: { gravidade: trocaGravidade, descricao: trocaMotivo, abrir_os: trocaGravidade !== 'PERDA_TOTAL' },
    }, tokenOk);
    setOcupado(false);
    if (!x.ok) { toast(x.erro || 'Falha na troca.', 'error'); return; }
    toast('Troca registrada — a peça que voltou foi para manutenção.', 'success');
    setTroca(false); recarregarTela();
    if (x.info.comprovanteId) { setAssinar({ id: x.info.comprovanteId, tipo: 'SAIDA' }); setAssNome(''); setAssDoc(''); setAssPng(null); }
  };

  // ---------------- encerrar ----------------
  const encerrar = async () => {
    const motivo = await pedir({ title: 'Encerrar ficha de locação', message: 'Motivo do encerramento (o que ficou pendente de saída não vai mais sair):', confirmLabel: 'Encerrar' });
    if (!motivo) return;
    setOcupado(true);
    const x = await encerrarFichaLocacaoAction(id, motivo, tokenOk);
    setOcupado(false);
    if (!x.ok) { toast(x.erro || 'Falha.', 'error'); return; }
    toast('Ficha de locação encerrada.', 'success'); recarregarTela();
  };

  // ---------------- assinatura ----------------
  const enviarAssinatura = async () => {
    if (!assinar) return;
    if (!assNome.trim()) { toast('Informe o nome de quem assina.', 'error'); return; }
    if (!assPng) { toast('Faltou a assinatura.', 'error'); return; }
    setOcupado(true);
    const x = await assinarComprovanteAction(assinar.id, { nome: assNome, documento: assDoc, png: assPng }, tokenOk);
    setOcupado(false);
    if (!x.ok) { toast(x.erro || 'Falha ao salvar a assinatura.', 'error'); return; }
    toast('Assinatura registrada.', 'success');
    const cid = assinar.id;
    setAssinar(null); recarregarTela();
    await pdf({ comprovanteId: cid });
  };

  const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';
  const selo = f.status === 'F'
    ? <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-gray-200 text-gray-600">Finalizada</span>
    : r?.atrasada ? <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-red-100 text-red-700">Atrasada</span>
      : !f.data_saida && propria ? <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-cyan-100 text-cyan-700">Aguardando saída</span>
        : <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-violet-100 text-violet-700">Em locação</span>;
  const saldoTrocaItem = saldos.find(s => s.id === trocaItem);

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-tight">{f.numero}</h1>
          {selo}
          {!propria && <span className="text-[10px] font-black px-2.5 py-1 rounded-full uppercase bg-orange-100 text-orange-700">histórico do P2S · só leitura</span>}
          {f.empresa && <span className="text-[10px] font-bold text-gray-500">{f.empresa}</span>}
        </div>
        <div className="flex gap-2">
          {r && <button onClick={() => router.push(`/admin/locacoes/reservas/${r.id}`)} className="text-[10px] md:text-xs font-black bg-white border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg tracking-wider uppercase">📝 OS {r.os}</button>}
          <button onClick={() => router.push(ROTA)} className="text-[10px] md:text-xs font-black bg-white border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg tracking-wider uppercase">⬅ Fichas de locação</button>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          {r?.atrasada && f.status === 'A' && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm font-bold">
              ⚠ Período terminou em {formatarDataBR(r.data_fim)} e ainda há equipamento com o cliente. A agenda segue ocupando até a devolução — registre a devolução, prorrogue ou lance o extravio.
            </div>
          )}

          {/* dados */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 grid md:grid-cols-3 gap-4 text-sm">
            <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Cliente</p><p className="font-bold">{info.cliente?.nome || '—'}</p>{info.cliente?.documento && <p className="text-xs text-gray-500">{info.cliente.documento}</p>}</div>
            <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Evento / local</p><p className="font-bold">{info.evento?.nome || '—'}</p><p className="text-xs text-gray-500">{[r?.local || info.evento?.local, r?.estande].filter(Boolean).join(' · ') || '—'}</p></div>
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Período</p>
              <p className="font-bold">{r ? `${formatarDataBR(r.data_inicio)} a ${formatarDataBR(r.data_fim)}` : '—'}</p>
              <p className="text-xs text-gray-500">{[r?.data_montagem && `montagem ${formatarDataBR(r.data_montagem)}`, r?.data_desmontagem && `desmontagem ${formatarDataBR(r.data_desmontagem)}`].filter(Boolean).join(' · ')}</p>
            </div>
            <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Saída / devolução</p><p className="font-bold">{formatarDataBR(f.data_saida)} → {formatarDataBR(f.data_devolucao)}</p></div>
            <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Contato / vendedor(a)</p><p className="font-bold">{r?.contato || '—'}</p><p className="text-xs text-gray-500">{r?.vendedor || ''}</p></div>
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Fichas desta OS</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(info.irmas || []).map((i: any) => (
                  <button key={i.id} onClick={() => router.push(`${ROTA}/${i.id}`)} className={`text-[10px] font-black px-2 py-1 rounded-lg border ${i.id === f.id ? 'bg-[#0C1D4D] text-white border-[#0C1D4D]' : 'bg-white border-[#E2E8F0] text-[#0C1D4D]'}`}>
                    {i.numero}{i.status === 'F' ? ' ✓' : ''}
                  </button>
                ))}
                {!(info.irmas || []).length && <span className="text-xs text-gray-400">—</span>}
              </div>
            </div>
            {f.observacoes && <p className="md:col-span-3 text-xs text-gray-600 whitespace-pre-line">{f.observacoes}</p>}
          </div>

          {/* ações */}
          {aberta && (
            <div className="flex flex-wrap gap-2">
              <button disabled={ocupado || !temPendente} onClick={() => abrirMov('SAIDA')} className={`${btn} bg-[#0C1D4D] text-white hover:bg-[#284B8C]`}>📤 Registrar saída</button>
              <button disabled={ocupado || !temFora} onClick={() => abrirMov('DEVOLUCAO')} className={`${btn} bg-orange-600 text-white hover:bg-orange-700`}>📥 Registrar devolução</button>
              <button disabled={ocupado || !temFora} onClick={abrirTroca} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D] hover:bg-gray-50`}>🔁 Troca</button>
              <button disabled={ocupado || !temPendente} onClick={() => pdf({ flId: id })} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D] hover:bg-gray-50`}>🖨 OS para separação</button>
              {podeEditar && <button disabled={ocupado || temFora} onClick={encerrar} title={temFora ? 'Há equipamento com o cliente' : ''} className={`${btn} bg-white border border-[#E2E8F0] text-gray-500 hover:bg-gray-50`}>Encerrar ficha</button>}
            </div>
          )}
          {aberta && r && (
            <p className="text-[11px] text-gray-500">
              Prorrogação e complemento ficam com o <strong>Comercial</strong>, na OS <button onClick={() => router.push(`/admin/locacoes/reservas/${r.id}`)} className="text-[#336699] font-bold hover:underline">{r.os}</button> (envolvem custo).
              O que não voltar quando o retorno for encerrado vira <strong>extravio</strong> sozinho, com cobrança de reposição no Financeiro.
            </p>
          )}

          {/* itens */}
          {propria && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E2E8F0] flex justify-between items-center">
                <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Equipamentos</h2>
                <span className="text-[10px] text-gray-500">{q3(saldos.reduce((a, s) => a + s.fora, 0))} com o cliente · {q3(saldos.reduce((a, s) => a + s.pendenteSaida, 0))} pendente(s) de saída</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#F0F4F8]">
                    <tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                      <th className="p-3">Equipamento</th><th className="p-3 text-right">Previsto</th><th className="p-3 text-right">Saiu</th><th className="p-3 text-right">Voltou</th>
                      <th className="p-3 text-right">Extraviado</th><th className="p-3 text-right">Com o cliente</th><th className="p-3 text-right">A sair</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!saldos.length && <tr><td colSpan={7} className="p-6 text-center text-gray-400">Sem equipamentos.</td></tr>}
                    {saldos.map(s => (
                      <tr key={s.id} className="border-t border-[#E2E8F0]">
                        <td className="p-3">
                          <p className="font-bold">{s.descricao}{s.extra && <span className="ml-2 text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">EXTRA</span>}</p>
                          <p className="text-[10px] text-gray-500">{[s.codigo, s.controle === 'INDIVIDUAL' ? 'por patrimônio' : null].filter(Boolean).join(' · ')}</p>
                          {s.pecasFora.length > 0 && <p className="text-[10px] text-violet-700 mt-0.5">Com o cliente: {s.pecasFora.map(p => p.numero).join(', ')}</p>}
                        </td>
                        <td className="p-3 text-right">{q3(s.prevista)}</td>
                        <td className="p-3 text-right">{q3(s.saiu)}</td>
                        <td className="p-3 text-right">{q3(s.devolvido)}</td>
                        <td className={`p-3 text-right ${s.extraviado > 0 ? 'text-red-600 font-black' : ''}`}>{q3(s.extraviado)}</td>
                        <td className={`p-3 text-right font-black ${s.fora > 0 ? 'text-violet-700' : ''}`}>{q3(s.fora)}</td>
                        <td className={`p-3 text-right ${s.pendenteSaida > 0 ? 'text-cyan-700 font-black' : 'text-gray-400'}`}>{q3(s.pendenteSaida)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* comprovantes */}
          {propria && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-[#E2E8F0]"><h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">OS e comprovantes</h2></div>
              <div className="divide-y divide-[#E2E8F0]">
                {!(info.comprovantes || []).length && <p className="p-5 text-xs text-gray-400">Cada saída e devolução gera uma OS para o cliente assinar na tela.</p>}
                {(info.comprovantes || []).map((c: any) => (
                  <div key={c.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
                    <div>
                      <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${c.tipo === 'SAIDA' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{c.tipo === 'SAIDA' ? 'OS de saída' : 'Devolução'}</span>
                      <span className="ml-2 font-bold">{formatarDataBR(c.data)}</span>
                      <span className="ml-2 text-gray-500">por {c.registrado_por || '—'}</span>
                      {c.observacoes && <span className="ml-2 text-gray-500">· {c.observacoes}</span>}
                      <p className="mt-1">{c.assinado_em
                        ? <span className="text-emerald-700 font-bold">✔ Assinado por {c.recebedor_nome}{c.recebedor_documento ? ` (${c.recebedor_documento})` : ''} em {new Date(c.assinado_em).toLocaleString('pt-BR')}</span>
                        : <span className="text-amber-700 font-bold">⏳ Falta a assinatura do cliente</span>}</p>
                    </div>
                    <div className="flex gap-2">
                      {!c.assinado_em && <button disabled={ocupado} onClick={() => { setAssinar({ id: c.id, tipo: c.tipo }); setAssNome(''); setAssDoc(''); setAssPng(null); }} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>✍ Assinar</button>}
                      <button disabled={ocupado} onClick={() => pdf({ comprovanteId: c.id })} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D] hover:bg-gray-50`}>📄 PDF</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* prorrogações */}
          {(info.prorrogacoes || []).length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5">
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Prorrogações</h2>
              <ul className="space-y-1.5 text-xs">
                {info.prorrogacoes.map((p: any) => (
                  <li key={p.id}>📅 {formatarDataBR(p.fim_anterior)} → <strong>{formatarDataBR(p.fim_novo)}</strong> (+{p.dias_adicionais} dia(s)){p.valor_estimado != null && <> · estimado <strong>{formatarMoeda(Number(p.valor_estimado))}</strong></>} · {p.motivo} <span className="text-gray-400">— {p.registrado_por}, {new Date(p.criado_em).toLocaleString('pt-BR')}</span></li>
                ))}
              </ul>
              <p className="text-[10px] text-gray-400 mt-2">O valor estimado das diárias a mais é cobrado pelo Faturamento (próximo módulo).</p>
            </div>
          )}

          {/* movimentos */}
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-[#E2E8F0]"><h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Movimentações</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#F0F4F8]">
                  <tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                    <th className="p-3">Data</th><th className="p-3">Tipo</th><th className="p-3">Equipamento</th><th className="p-3 text-right">Qtd</th><th className="p-3">Patrimônio</th><th className="p-3">Por</th><th className="p-3">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {!(info.movimentos || []).length && <tr><td colSpan={7} className="p-6 text-center text-gray-400">Nenhuma movimentação.</td></tr>}
                  {(info.movimentos || []).map((m: any) => (
                    <tr key={m.id} className="border-t border-[#E2E8F0]">
                      <td className="p-3 whitespace-nowrap">{formatarDataBR(m.data)}</td>
                      <td className="p-3 whitespace-nowrap">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${m.tipo === 'SAIDA' ? 'bg-blue-100 text-blue-700' : m.tipo === 'EXTRAVIO' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{ROTULO_TIPO[m.tipo] || m.tipo}{m.troca ? ' · troca' : ''}</span>
                      </td>
                      <td className="p-3">{m.produto}{m.codigo && <span className="text-gray-400"> · {m.codigo}</span>}</td>
                      <td className="p-3 text-right font-bold">{q3(m.quantidade)}</td>
                      <td className="p-3">{m.patrimonio || '—'}</td>
                      <td className="p-3 whitespace-nowrap">{m.usuario || '—'}</td>
                      <td className="p-3 text-gray-500">{[m.observacoes, m.avaria_id ? `avaria #${m.avaria_id}` : null, m.valor_indenizacao != null ? `indenização ${formatarMoeda(Number(m.valor_indenizacao))}` : null].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {!propria && (info.extrasP2s || []).length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 text-xs">
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-2">Extras (P2S)</h2>
              {info.extrasP2s.map((e: any, i: number) => <p key={i}>{q3(Number(e.quantidade) || 0)}× {e.descricao} — {formatarMoeda(Number(e.valor_final) || 0)}</p>)}
            </div>
          )}
        </div>
      </div>

      {/* ============ MODAIS ============ */}
      <Modal open={!!mov} onClose={() => setMov(null)} title={mov === 'SAIDA' ? '📤 Registrar saída' : '📥 Registrar devolução'} headerColor={mov === 'SAIDA' ? '#0C1D4D' : '#EA580C'} maxWidthClassName="max-w-4xl"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setMov(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={enviarMov} className={`${btn} ${mov === 'SAIDA' ? 'bg-[#0C1D4D]' : 'bg-orange-600'} text-white`}>{ocupado ? 'Gravando…' : 'Registrar e colher assinatura'}</button></div>}>
        <div className="grid md:grid-cols-[180px_1fr] gap-4">
          <label className="text-xs font-bold">Data
            <input type="date" value={movData} max={hojeISO()} onChange={e => setMovData(e.target.value)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="text-xs font-bold">Ler QR do patrimônio (opcional)
            <div className="mt-1"><LeitorQR onLer={lerNoMov} placeholder="Leia a etiqueta ou digite o nº" /></div>
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={() => setMovQtd(Object.fromEntries(saldos.map(s => [s.id, limiteMov(s) > 0 ? String(limiteMov(s)) : ''])))} className="text-[10px] font-black uppercase tracking-wider text-[#336699] hover:underline">
            {mov === 'SAIDA' ? 'Preencher tudo que está pendente' : 'Preencher tudo que está com o cliente'}
          </button>
        </div>
        <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0]">
          {saldos.filter(s => limiteMov(s) > 0).map(s => {
            const av = movAvaria[s.id] || AVARIA_VAZIA;
            const pecas = movPecas[s.id] || [];
            return (
              <div key={s.id} className="p-3 space-y-2">
                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-bold">{s.descricao}</p>
                    <p className="text-[10px] text-gray-500">{mov === 'SAIDA' ? `${q3(s.pendenteSaida)} pendente(s)` : `${q3(s.fora)} com o cliente`}{s.codigo ? ` · ${s.codigo}` : ''}</p>
                    {pecas.length > 0 && <p className="text-[10px] text-emerald-700 font-bold">Lidas: {pecas.map(p => p.numero).join(', ')} <button className="ml-1 text-red-500" onClick={() => setMovPecas(prev => ({ ...prev, [s.id]: [] }))}>limpar</button></p>}
                  </div>
                  <input inputMode="decimal" value={movQtd[s.id] || ''} onChange={e => setMovQtd(prev => ({ ...prev, [s.id]: e.target.value }))} placeholder="0"
                    className="w-24 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm text-right font-bold" />
                  {mov === 'DEVOLUCAO' && (
                    <button onClick={() => setMovAvaria(prev => ({ ...prev, [s.id]: { ...av, ativo: !av.ativo } }))} className={`text-[10px] font-black uppercase px-3 py-2 rounded-lg border ${av.ativo ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-200'}`}>⚠ avaria</button>
                  )}
                </div>
                {mov === 'DEVOLUCAO' && av.ativo && (
                  <div className="grid md:grid-cols-6 gap-2 bg-red-50 rounded-lg p-3">
                    {pecas.length > 0 ? (
                      <select value={av.patrimonio_id ?? ''} onChange={e => setMovAvaria(prev => ({ ...prev, [s.id]: { ...av, patrimonio_id: e.target.value ? Number(e.target.value) : null } }))} className="border rounded-lg px-2 py-1.5 text-xs">
                        <option value="">Peça…</option>{pecas.map(p => <option key={p.id} value={p.id}>{p.numero}</option>)}
                      </select>
                    ) : (
                      <input value={av.qtd} onChange={e => setMovAvaria(prev => ({ ...prev, [s.id]: { ...av, qtd: e.target.value } }))} placeholder="Qtd" className="border rounded-lg px-2 py-1.5 text-xs" />
                    )}
                    <select value={av.gravidade} onChange={e => setMovAvaria(prev => ({ ...prev, [s.id]: { ...av, gravidade: e.target.value as Gravidade } }))} className="border rounded-lg px-2 py-1.5 text-xs">
                      <option value="LEVE">Leve</option><option value="MEDIA">Média</option><option value="GRAVE">Grave</option><option value="PERDA_TOTAL">Perda total</option>
                    </select>
                    <input value={av.descricao} onChange={e => setMovAvaria(prev => ({ ...prev, [s.id]: { ...av, descricao: e.target.value } }))} placeholder="O que aconteceu" className="md:col-span-2 border rounded-lg px-2 py-1.5 text-xs" />
                    <select value={av.cobranca} onChange={e => setMovAvaria(prev => ({ ...prev, [s.id]: { ...av, cobranca: e.target.value as AvariaForm['cobranca'] } }))} className="border rounded-lg px-2 py-1.5 text-xs">
                      <option value="A_DEFINIR">Cobrança a definir</option><option value="COBRAR">Cobrar do cliente</option><option value="NAO_COBRAR">Não cobrar</option>
                    </select>
                    <label className="flex items-center gap-1 text-[10px] font-bold"><input type="checkbox" checked={av.abrir_os} onChange={e => setMovAvaria(prev => ({ ...prev, [s.id]: { ...av, abrir_os: e.target.checked } }))} /> abrir OS de manutenção</label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <label className="block text-xs font-bold">Observações
          <input value={movObs} onChange={e => setMovObs(e.target.value)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" />
        </label>
        {mov === 'DEVOLUCAO' && (
          <label className={`flex items-start gap-2 text-xs rounded-xl border p-3 ${movFinal ? 'bg-red-50 border-red-300 text-red-800' : 'border-[#E2E8F0] text-gray-600'}`}>
            <input type="checkbox" checked={movFinal} onChange={e => setMovFinal(e.target.checked)} className="mt-0.5" />
            <span><strong>Devolução final — encerrar o retorno.</strong> O que não voltar agora vira extravio (sai do estoque) e gera cobrança de reposição no Financeiro, que decide cobrar ou cancelar.</span>
          </label>
        )}
      </Modal>

      <Modal open={troca} onClose={() => setTroca(false)} title="🔁 Troca de equipamento"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setTroca(false)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={enviarTroca} className={`${btn} bg-[#0C1D4D] text-white`}>Registrar troca</button></div>}>
        <label className="block text-xs font-bold">Equipamento
          <select value={trocaItem} onChange={e => escolherItemTroca(Number(e.target.value))} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm">
            {saldos.filter(s => s.fora > 0).map(s => <option key={s.id} value={s.id}>{s.descricao} — {q3(s.fora)} com o cliente</option>)}
          </select>
        </label>
        {saldoTrocaItem?.controle === 'INDIVIDUAL' ? (
          <div className="grid md:grid-cols-2 gap-3">
            <label className="block text-xs font-bold">Peça que VOLTA (com defeito)
              <select value={trocaVolta ?? ''} onChange={e => setTrocaVolta(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm">
                <option value="">Escolha…</option>
                {(saldoTrocaItem.pecasFora.length ? saldoTrocaItem.pecasFora : trocaPecas.filter(p => p.estado === 'COM_CLIENTE')).map(p => <option key={p.id} value={p.id}>{p.numero}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold">Peça que SAI (substituta)
              <select value={trocaSai ?? ''} onChange={e => setTrocaSai(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm">
                <option value="">Escolha…</option>
                {trocaPecas.filter(p => p.estado === 'LIVRE' || p.estado === 'RESERVADA_AQUI').map(p => <option key={p.id} value={p.id}>{p.numero}{p.estado === 'RESERVADA_AQUI' ? ' (reservada nesta OS)' : ''}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <label className="block text-xs font-bold">Quantidade trocada<input value={trocaQtd} onChange={e => setTrocaQtd(e.target.value)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        )}
        <label className="block text-xs font-bold">Motivo / defeito<input value={trocaMotivo} onChange={e => setTrocaMotivo(e.target.value)} placeholder="ex.: tela com listras" className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-bold">Gravidade da avaria
          <select value={trocaGravidade} onChange={e => setTrocaGravidade(e.target.value as Gravidade)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm">
            <option value="LEVE">Leve</option><option value="MEDIA">Média</option><option value="GRAVE">Grave</option><option value="PERDA_TOTAL">Perda total</option>
          </select>
        </label>
        <p className="text-[10px] text-gray-500">A peça que volta entra em Avarias e (salvo perda total) abre OS de manutenção. A que sai passa a constar com o cliente.</p>
      </Modal>

      <Modal open={!!assinar} onClose={() => setAssinar(null)} title={assinar?.tipo === 'DEVOLUCAO' ? '✍ Assinatura de quem entregou' : '✍ Assinatura de quem recebeu'} headerColor="#047857"
        footer={<div className="flex justify-between gap-2"><button onClick={() => setAssinar(null)} className={`${btn} bg-white border border-[#E2E8F0]`}>Assinar depois</button><button disabled={ocupado} onClick={enviarAssinatura} className={`${btn} bg-emerald-600 text-white`}>Salvar e baixar OS</button></div>}>
        <p className="text-xs text-gray-600">Entregue o celular/tablet para o responsável do cliente conferir a OS e assinar.</p>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block text-xs font-bold">Nome<input value={assNome} onChange={e => setAssNome(e.target.value)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
          <label className="block text-xs font-bold">Documento (RG/CPF, opcional)<input value={assDoc} onChange={e => setAssDoc(e.target.value)} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        </div>
        {assinar && <AssinaturaTela key={assinar.id} onChange={setAssPng} />}
        <button onClick={() => assinar && pdf({ comprovanteId: assinar.id })} className="text-[10px] font-black uppercase tracking-wider text-[#336699] hover:underline">Ver a OS antes de assinar (PDF)</button>
      </Modal>
    </div>
  );
}

