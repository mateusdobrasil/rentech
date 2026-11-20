"use client";

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../../components/hooks/usePageAccess';
import { HubErro } from '../../../../components/ui/HubStates';
import { useToast, usePrompt } from '../../../../components/ui/NotificationProvider';
import Modal from '../../../../components/ui/Modal';
import { formatarDataBR, formatarMoeda } from '../../../../lib/formatadores';
import { carregarSublocacaoAction, confirmarSublocacaoAction, cancelarSublocacaoAction, registrarAvariaSublocacaoAction } from '../actions';
import FormSublocacao from '../FormSublocacao';
import ModalMovimentoSublocacao from '../ModalMovimentoSublocacao';

// Sublocação (2026-11-20): pedido ao parceiro, equipamento dele (entrada e
// devolução por quantidade), avaria, pagamento por OP e custo × OS.
const ROTA = '/admin/locacoes/sublocacoes';
const STATUS: Record<string, { rotulo: string; cls: string }> = {
  SOLICITADO: { rotulo: 'Solicitada ao parceiro', cls: 'bg-amber-100 text-amber-700' },
  CONFIRMADO: { rotulo: 'Confirmada', cls: 'bg-blue-100 text-blue-700' },
  ENCERRADO: { rotulo: 'Encerrada', cls: 'bg-gray-200 text-gray-600' },
  CANCELADO: { rotulo: 'Cancelada', cls: 'bg-red-50 text-red-400' },
};
const STATUS_OP: Record<string, string> = { PENDENTE: 'bg-amber-100 text-amber-700', PAGO: 'bg-emerald-100 text-emerald-700', REPROVADA: 'bg-red-50 text-red-400' };
const q3 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const num = (s: string) => { const x = Number(String(s || '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const btn = 'text-[10px] md:text-xs font-black uppercase tracking-wider px-4 py-2.5 rounded-lg shadow-sm disabled:opacity-40 transition-colors';

export default function SublocacaoPage() {
  const router = useRouter();
  const id = Number(useParams()?.id);
  const toast = useToast();
  const pedir = usePrompt();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ rota: ROTA });
  const [info, setInfo] = useState<any>(null);
  const [recarregar, setRecarregar] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [mov, setMov] = useState<null | 'ENTRADA' | 'DEVOLUCAO'>(null);
  const [editar, setEditar] = useState(false);
  const [avaria, setAvaria] = useState(false);
  const [av, setAv] = useState({ item_id: 0, quantidade: '1', gravidade: 'MEDIA', descricao: '', valor_parceiro: '', repassar: true, valor_cliente: '' });

  useEffect(() => {
    if (authLoading || acessoNegado || erro || !accessToken || !id) return;
    let vivo = true;
    carregarSublocacaoAction(id, accessToken).then(r => { if (!vivo) return; if (r.ok) setInfo(r.info); else toast(r.erro || 'Erro ao carregar.', 'error'); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado, erro, accessToken, id, recarregar]);

  if (authLoading || (!info && !acessoNegado && !erro)) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;
  if (acessoNegado) return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4"><div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200"><div className="text-5xl mb-4">⛔</div><h2 className="text-xl font-black text-red-600 uppercase mb-4">Acesso Restrito</h2><button onClick={() => router.push('/admin/locacoes')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full">Voltar ao Hub</button></div></div>;

  const s = info.sublocacao;
  const v = info.valores;
  const tok = accessToken as string;
  const ativa = ['SOLICITADO', 'CONFIRMADO'].includes(s.status);
  const podeEditar = !!info.podeEditar;
  const recarregarTela = () => setRecarregar(x => x + 1);

  const confirmar = async () => {
    setOcupado(true);
    const r = await confirmarSublocacaoAction(id, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(r.info?.aviso || 'Sublocação confirmada — a quantidade deixou de pesar no nosso estoque para a OS.', r.info?.aviso ? 'info' : 'success');
    recarregarTela();
  };
  const cancelar = async () => {
    const motivo = await pedir({ title: `Cancelar ${info.numero}`, message: 'Motivo do cancelamento:', confirmLabel: 'Cancelar sublocação' });
    if (!motivo) return;
    setOcupado(true);
    const r = await cancelarSublocacaoAction(id, motivo, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(r.info?.aviso || 'Sublocação cancelada.', r.info?.aviso ? 'info' : 'success');
    recarregarTela();
  };
  const salvarAvaria = async () => {
    if (!av.item_id) { toast('Escolha o equipamento.', 'error'); return; }
    setOcupado(true);
    const r = await registrarAvariaSublocacaoAction(id, {
      item_id: av.item_id, quantidade: num(av.quantidade), gravidade: av.gravidade as any, descricao: av.descricao,
      valor_parceiro: av.valor_parceiro ? num(av.valor_parceiro) : null, repassar: av.repassar, valor_cliente: av.valor_cliente ? num(av.valor_cliente) : null,
    }, tok);
    setOcupado(false);
    if (!r.ok) { toast(r.erro || 'Falha.', 'error'); return; }
    toast(av.repassar ? 'Avaria registrada — o repasse ao cliente aparece em Avarias para gerar a cobrança.' : 'Avaria registrada.', 'success');
    setAvaria(false); recarregarTela();
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-tight">{info.numero}</h1>
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase ${STATUS[s.status]?.cls}`}>{STATUS[s.status]?.rotulo}</span>
          <span className="text-sm font-bold text-[#0C1D4D]">{info.fornecedor?.nome}</span>
        </div>
        <div className="flex gap-2">
          {info.os && <button onClick={() => router.push(`/admin/locacoes/reservas/${info.os.id}`)} className="text-[10px] md:text-xs font-black bg-white border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg uppercase">📝 OS {info.os.numero}</button>}
          <button onClick={() => router.push(ROTA)} className="text-[10px] md:text-xs font-black bg-white border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg uppercase">⬅ Sublocações</button>
        </div>
      </div>

      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-5">
          {s.status === 'CANCELADO' && s.motivo_cancelamento && <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">Cancelada: {s.motivo_cancelamento}</div>}
          {s.status === 'SOLICITADO' && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm font-bold">Aguardando o parceiro confirmar. Enquanto não confirmar, a OS continua contando só com o nosso estoque.</div>}

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 grid md:grid-cols-2 gap-4 text-sm">
              <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Parceiro</p><p className="font-bold">{info.fornecedor?.nome}</p><p className="text-xs text-gray-500">{[info.fornecedor?.documento, info.fornecedor?.telefone, s.contato].filter(Boolean).join(' · ')}</p></div>
              <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">OS do cliente</p>{info.os ? <><p className="font-bold">{info.os.numero} — {info.os.cliente}</p><p className="text-xs text-gray-500">{[info.os.evento, `${formatarDataBR(info.os.inicio)} a ${formatarDataBR(info.os.fim)}`].filter(Boolean).join(' · ')}</p></> : <p className="text-gray-400">avulsa</p>}</div>
              <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Período com o parceiro</p><p className="font-bold">{formatarDataBR(s.data_retirada)} a {formatarDataBR(s.data_devolucao)}</p></div>
              <div><p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Pagamento</p><p className="font-bold">{s.vencimento ? `vence ${formatarDataBR(s.vencimento)}` : 'sem vencimento'}</p><p className="text-xs text-gray-500">{s.condicoes || ''}</p></div>
              {s.observacoes && <p className="md:col-span-2 text-xs text-gray-600">{s.observacoes}</p>}
              <p className="md:col-span-2 text-[10px] text-gray-400">Criada por {s.criado_por} em {new Date(s.criado_em).toLocaleString('pt-BR')}{s.confirmado_em ? ` · confirmada por ${s.confirmado_por} em ${new Date(s.confirmado_em).toLocaleString('pt-BR')}` : ''}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 text-sm space-y-1.5">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">Custo</p>
              <p className="flex justify-between"><span>Equipamentos</span><strong>{formatarMoeda(v.custoItens)}</strong></p>
              <p className="flex justify-between"><span>Frete</span><strong>{formatarMoeda(v.frete)}</strong></p>
              <p className="flex justify-between"><span>Avarias (cobradas pelo parceiro)</span><strong>{formatarMoeda(v.custoAvarias)}</strong></p>
              <p className="flex justify-between border-t border-[#E2E8F0] pt-1.5 text-[#0C1D4D]"><span className="font-black">Total</span><strong>{formatarMoeda(v.custoTotal)}</strong></p>
              <p className="flex justify-between text-xs text-gray-500"><span>Em OP</span><span>{formatarMoeda(v.emOp)}</span></p>
              <p className="flex justify-between text-xs text-emerald-700"><span>Pago</span><span>{formatarMoeda(v.pago)}</span></p>
              {v.aGerarOp > 0.009 && <p className="flex justify-between text-xs text-red-600 font-bold"><span>Falta gerar OP</span><span>{formatarMoeda(v.aGerarOp)}</span></p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {s.status === 'SOLICITADO' && podeEditar && <button disabled={ocupado} onClick={confirmar} className={`${btn} bg-emerald-600 text-white`}>✔ Parceiro confirmou</button>}
            {s.status === 'CONFIRMADO' && <button disabled={ocupado || info.fisico.aReceber <= 0} onClick={() => setMov('ENTRADA')} className={`${btn} bg-[#0C1D4D] text-white`}>📥 Entrada do parceiro</button>}
            {s.status === 'CONFIRMADO' && <button disabled={ocupado || info.fisico.comAgente <= 0} onClick={() => setMov('DEVOLUCAO')} className={`${btn} bg-orange-600 text-white`}>📤 Devolver ao parceiro</button>}
            {['CONFIRMADO', 'ENCERRADO'].includes(s.status) && (
              <button disabled={ocupado || v.aGerarOp <= 0.009} onClick={() => router.push(`/admin/op/nova?sublocacaoId=${id}`)} title={v.aGerarOp <= 0.009 ? 'Todo o custo já está em OP' : ''} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>💳 Gerar OP {v.aGerarOp > 0.009 ? `(${formatarMoeda(v.aGerarOp)})` : ''}</button>
            )}
            {s.status !== 'CANCELADO' && <button disabled={ocupado} onClick={() => { setAv({ item_id: info.itens[0]?.id || 0, quantidade: '1', gravidade: 'MEDIA', descricao: '', valor_parceiro: '', repassar: !!info.os, valor_cliente: '' }); setAvaria(true); }} className={`${btn} bg-white border border-red-200 text-red-600`}>⚠ Avaria</button>}
            {ativa && podeEditar && <button disabled={ocupado} onClick={() => setEditar(true)} className={`${btn} bg-white border border-[#E2E8F0] text-[#0C1D4D]`}>✏️ Editar</button>}
            {ativa && podeEditar && <button disabled={ocupado} onClick={cancelar} className={`${btn} bg-white border border-[#E2E8F0] text-gray-500`}>Cancelar</button>}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-x-auto">
            <h2 className="px-5 py-3 border-b border-[#E2E8F0] text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Equipamentos do parceiro</h2>
            <table className="w-full text-xs">
              <thead className="bg-[#F0F4F8]"><tr className="text-left text-[#64748B] uppercase tracking-wider font-black text-[10px]">
                <th className="p-3">Equipamento</th><th className="p-3 text-right">Qtd</th><th className="p-3 text-right">Custo unit.</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Recebido</th><th className="p-3 text-right">Com a gente</th><th className="p-3 text-right">Devolvido</th>
              </tr></thead>
              <tbody>
                {info.itens.map((i: any) => (
                  <tr key={i.id} className="border-t border-[#E2E8F0]">
                    <td className="p-3"><p className="font-bold">{i.descricao}</p><p className="text-[10px] text-gray-500">{[i.codigo, i.categoria].filter(Boolean).join(' · ')}</p></td>
                    <td className="p-3 text-right font-bold">{q3(i.quantidade)}</td><td className="p-3 text-right">{formatarMoeda(i.valor_unitario)}</td><td className="p-3 text-right font-bold">{formatarMoeda(i.valor_total)}</td>
                    <td className="p-3 text-right">{q3(i.recebido)}</td><td className={`p-3 text-right font-black ${i.comAgente > 0 ? 'text-violet-700' : ''}`}>{q3(i.comAgente)}</td><td className="p-3 text-right">{q3(i.devolvido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5">
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Ordens de pagamento</h2>
              {!info.ops.length && <p className="text-xs text-gray-400">Nenhuma OP ainda. {['CONFIRMADO', 'ENCERRADO'].includes(s.status) ? 'Use “Gerar OP”: ela abre preenchida com o parceiro, os itens e a OS.' : ''}</p>}
              <ul className="space-y-2 text-xs">
                {info.ops.map((o: any) => (
                  <li key={o.id} className="flex justify-between items-center">
                    <span><strong>OP #{o.numero_op}</strong> · {new Date(o.data_criacao).toLocaleDateString('pt-BR')}{o.data_vencimento ? ` · vence ${formatarDataBR(o.data_vencimento)}` : ''}{o.pago_em ? ` · paga em ${new Date(o.pago_em).toLocaleDateString('pt-BR')}` : ''}</span>
                    <span className="flex items-center gap-2"><strong>{formatarMoeda(Number(o.total_geral))}</strong><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_OP[o.status] || 'bg-gray-100'}`}>{o.status}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5">
              <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Avarias</h2>
              {!info.avarias.length && <p className="text-xs text-gray-400">Nenhuma avaria.</p>}
              <ul className="space-y-2 text-xs">
                {info.avarias.map((a: any) => (
                  <li key={a.id}>⚠ <strong>{a.gravidade}</strong> · {q3(Number(a.quantidade))} un. · {a.descricao}
                    <span className="block text-gray-500">parceiro cobra {a.valor_parceiro != null ? formatarMoeda(Number(a.valor_parceiro)) : '—'} · cliente: {a.status_cobranca === 'NAO_COBRAR' ? 'não repassar' : `${a.status_cobranca.toLowerCase().replace('_', ' ')}${a.valor_cobranca != null ? ` ${formatarMoeda(Number(a.valor_cobranca))}` : ''}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5">
            <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Movimentações</h2>
            {!info.movimentos.length && <p className="text-xs text-gray-400">Nenhuma entrada ou devolução registrada.</p>}
            <ul className="space-y-1.5 text-xs">
              {info.movimentos.map((m: any) => {
                const it = info.itens.find((i: any) => i.id === m.item_id);
                return <li key={m.id}><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${m.tipo === 'ENTRADA' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{m.tipo === 'ENTRADA' ? 'Entrada' : 'Devolução'}</span> {formatarDataBR(m.data)} · {q3(Number(m.quantidade))}× {it?.descricao || 'item'} · {m.usuario}{m.observacoes ? ` · ${m.observacoes}` : ''}</li>;
              })}
            </ul>
          </div>
        </div>
      </div>

      <ModalMovimentoSublocacao sublocacaoId={id} numero={info.numero} fornecedor={info.fornecedor?.nome || ''} tipo={mov} itens={info.itens} accessToken={tok}
        onClose={() => setMov(null)} onFeito={() => { setMov(null); recarregarTela(); }} />

      <FormSublocacao aberto={editar} onClose={() => setEditar(false)} accessToken={tok} sublocacaoId={id}
        inicial={{
          empresa_id: s.empresa_id, ficha_reserva_id: s.ficha_reserva_id, osRotulo: info.os ? `${info.os.numero} — ${info.os.cliente}` : null,
          fornecedor: info.fornecedor ? { id: info.fornecedor.id, nome: info.fornecedor.nome } : null, data_retirada: s.data_retirada, data_devolucao: s.data_devolucao,
          valor_frete: Number(s.valor_frete) || null, vencimento: s.vencimento, contato: s.contato, condicoes: s.condicoes, observacoes: s.observacoes,
          itens: info.itens.map((i: any) => ({ produto_id: i.produto_id, nome: i.descricao, codigo: i.codigo, quantidade: String(i.quantidade).replace('.', ','), valor_unitario: String(i.valor_unitario).replace('.', ',') })),
        }}
        onSalvo={(_, aviso) => { setEditar(false); toast(aviso || 'Sublocação atualizada.', aviso ? 'info' : 'success'); recarregarTela(); }} />

      <Modal open={avaria} onClose={() => setAvaria(false)} title="⚠ Avaria em equipamento do parceiro" headerColor="#B91C1C"
        footer={<div className="flex justify-end gap-2"><button onClick={() => setAvaria(false)} className={`${btn} bg-white border border-[#E2E8F0]`}>Cancelar</button><button disabled={ocupado} onClick={salvarAvaria} className={`${btn} bg-red-600 text-white`}>Registrar avaria</button></div>}>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-xs font-bold">Equipamento<select value={av.item_id} onChange={e => setAv({ ...av, item_id: Number(e.target.value) })} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm">{info.itens.map((i: any) => <option key={i.id} value={i.id}>{i.descricao}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold">Qtd<input value={av.quantidade} onChange={e => setAv({ ...av, quantidade: e.target.value })} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold">Gravidade<select value={av.gravidade} onChange={e => setAv({ ...av, gravidade: e.target.value })} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm"><option value="LEVE">Leve</option><option value="MEDIA">Média</option><option value="GRAVE">Grave</option><option value="PERDA_TOTAL">Perda total</option></select></label>
          </div>
        </div>
        <label className="block text-xs font-bold">O que aconteceu<input value={av.descricao} onChange={e => setAv({ ...av, descricao: e.target.value })} className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        <label className="block text-xs font-bold">Quanto o parceiro nos cobra (R$)<input value={av.valor_parceiro} onChange={e => setAv({ ...av, valor_parceiro: e.target.value })} placeholder="0,00 — entra no custo da sublocação (OP)" className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>
        <label className={`flex items-start gap-2 text-xs rounded-xl border p-3 ${av.repassar ? 'bg-red-50 border-red-200' : 'border-[#E2E8F0]'} ${info.os ? '' : 'opacity-50'}`}>
          <input type="checkbox" disabled={!info.os} checked={av.repassar} onChange={e => setAv({ ...av, repassar: e.target.checked })} className="mt-0.5" />
          <span><strong>Repassar ao cliente</strong>{info.os ? ` (${info.os.cliente})` : ' — sublocação sem OS'}: entra em Avarias como “a cobrar”, onde gera o título.</span>
        </label>
        {av.repassar && <label className="block text-xs font-bold">Valor a cobrar do cliente (R$)<input value={av.valor_cliente} onChange={e => setAv({ ...av, valor_cliente: e.target.value })} placeholder="em branco = o Financeiro define" className="mt-1 w-full border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm" /></label>}
      </Modal>
    </div>
  );
}
