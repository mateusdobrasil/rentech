"use client";

// Painel "Proposta" do editor da Ficha de Reserva (2026-11-16): prévia do
// PDF, envio para assinatura do cliente na Autentique (WhatsApp ou e-mail),
// acompanhamento das versões, download do original e do assinado.
import { useState, useEffect, useCallback } from 'react';
import {
  listarPropostasAction, previaPropostaAction, enviarPropostaAction, atualizarStatusPropostaAction,
  baixarPropostaAction, cancelarPropostaAction,
} from '../actions-proposta';
import Modal from '../../../../components/ui/Modal';
import { useToast, useConfirm, usePrompt } from '../../../../components/ui/NotificationProvider';
import { formatarMoeda } from '../../../../lib/formatadores';
import type { StatusFicha } from '../actions';

interface Proposta {
  id: number; versao: number; status: 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'REJEITADO' | 'CANCELADO';
  link_assinatura: string | null; sandbox: boolean; signatario_nome: string | null; signatario_celular: string | null; signatario_email: string | null;
  mostrar_valores_itens: boolean; valor_total: number | null; conteudo_versao: string | null; pdf_original_path: string | null; pdf_assinado_path: string | null;
  enviado_por: string | null; enviado_em: string; visualizado_em: string | null; assinado_em: string | null; rejeitado_em: string | null; motivo_cancelamento: string | null;
}

const COR: Record<Proposta['status'], string> = {
  ENVIADO: 'bg-blue-100 text-blue-700', VISUALIZADO: 'bg-cyan-100 text-cyan-700', ASSINADO: 'bg-emerald-100 text-emerald-700',
  REJEITADO: 'bg-red-100 text-red-600', CANCELADO: 'bg-gray-100 text-gray-500',
};
const ROTULO: Record<Proposta['status'], string> = { ENVIADO: 'Enviada', VISUALIZADO: 'Visualizada', ASSINADO: 'Assinada', REJEITADO: 'Recusada', CANCELADO: 'Cancelada' };
const dataHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function abrirBase64(base64: string, nome: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new File([bytes], nome, { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function PainelProposta({ fichaId, accessToken, status, alterado, contatoNome, contatoTelefone, contatoEmail, clienteNome, onMudou }: {
  fichaId: number; accessToken: string; status: StatusFicha; alterado: boolean;
  contatoNome: string; contatoTelefone: string; contatoEmail: string; clienteNome: string;
  onMudou: () => void;
}) {
  const toast = useToast();
  const confirmar = useConfirm();
  const pedir = usePrompt();
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [conteudoAtual, setConteudoAtual] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);
  const [mostrarValores, setMostrarValores] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ nome: '', celular: '', email: '', canal: 'WHATSAPP' as 'WHATSAPP' | 'EMAIL', sandbox: false });
  const [enviando, setEnviando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const r = await listarPropostasAction(fichaId, accessToken);
    if (r.ok) { setPropostas(r.info.propostas); setConteudoAtual(r.info.conteudoAtual); setIndisponivel(null); }
    else setIndisponivel(r.erro || 'Não foi possível carregar as propostas.');
    setCarregando(false);
  }, [fichaId, accessToken]);

  useEffect(() => { carregar(); }, [carregar, status]);

  const podeEnviar = ['ORCAMENTO', 'ENVIADO', 'APROVADO', 'RESERVADA'].includes(status);
  const ultimaValida = propostas.find(p => p.status !== 'CANCELADO');
  const desatualizada = !!ultimaValida && ultimaValida.status !== 'REJEITADO' && (ultimaValida.conteudo_versao || '') !== (conteudoAtual || '');

  const previa = async () => {
    if (alterado) return toast('Salve a ficha antes de gerar o PDF.', 'info');
    setGerando(true);
    const r = await previaPropostaAction(fichaId, mostrarValores, accessToken);
    setGerando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao gerar o PDF.', 'error');
    abrirBase64(r.info.base64, r.info.nome);
  };

  const abrirEnvio = () => {
    if (alterado) return toast('Salve a ficha antes de enviar a proposta.', 'info');
    setForm({ nome: contatoNome || clienteNome, celular: contatoTelefone, email: contatoEmail, canal: contatoTelefone ? 'WHATSAPP' : 'EMAIL', sandbox: false });
    setModal(true);
  };

  const enviar = async () => {
    setEnviando(true);
    const r = await enviarPropostaAction(fichaId, {
      signatario_nome: form.nome, celular: form.canal === 'WHATSAPP' ? form.celular : null, email: form.canal === 'EMAIL' ? form.email : null,
      mostrar_valores_itens: mostrarValores, sandbox: form.sandbox,
    }, accessToken);
    setEnviando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao enviar.', 'error');
    toast(`Proposta v${r.info.versao} enviada por ${r.info.destino}.`, 'success');
    setModal(false);
    await carregar();
    onMudou();
  };

  const atualizar = async (p: Proposta) => {
    setOcupado(p.id);
    const r = await atualizarStatusPropostaAction(p.id, accessToken);
    setOcupado(null);
    if (!r.ok) return toast(r.erro || 'Erro ao consultar a Autentique.', 'error');
    toast(`Status na Autentique: ${ROTULO[r.info.status as Proposta['status']] || r.info.status}.`, 'info');
    await carregar();
    onMudou();
  };

  const baixar = async (p: Proposta, qual: 'ORIGINAL' | 'ASSINADO') => {
    setOcupado(p.id);
    const r = await baixarPropostaAction(p.id, qual, accessToken);
    setOcupado(null);
    if (!r.ok) return toast(r.erro || 'Erro ao baixar.', 'error');
    window.open(r.info.url, '_blank');
  };

  const cancelar = async (p: Proposta) => {
    const motivo = await pedir({ title: `Cancelar proposta v${p.versao}`, message: 'O link de assinatura para de funcionar. Motivo (opcional):', placeholder: 'Ex.: cliente pediu alteração' });
    if (motivo === null) return;
    setOcupado(p.id);
    const r = await cancelarPropostaAction(p.id, motivo, accessToken);
    setOcupado(null);
    if (!r.ok) return toast(r.erro || 'Erro ao cancelar.', 'error');
    toast('Proposta cancelada.', 'success');
    await carregar();
    onMudou();
  };

  const copiarLink = async (p: Proposta) => {
    if (!p.link_assinatura) return;
    try { await navigator.clipboard.writeText(p.link_assinatura); toast('Link de assinatura copiado.', 'success'); }
    catch { await confirmar({ title: 'Link de assinatura', message: p.link_assinatura, confirmLabel: 'OK' }); }
  };

  const btn = 'px-3 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider disabled:opacity-40';
  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]';
  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
        <div>
          <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Proposta ao cliente</h2>
          <p className="text-[10px] text-gray-500 mt-0.5">PDF com os itens, valores e condições. O cliente assina pela Autentique; ao assinar, a ficha é aprovada e os equipamentos são reservados automaticamente.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[10px] font-black uppercase text-gray-500">
            <input type="checkbox" checked={mostrarValores} onChange={e => setMostrarValores(e.target.checked)} />
            Valor por item
          </label>
          <button onClick={previa} disabled={gerando} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>{gerando ? 'Gerando...' : '📄 Baixar PDF'}</button>
          {podeEnviar && <button onClick={abrirEnvio} disabled={!!indisponivel} className={`${btn} bg-[#0C1D4D] hover:bg-[#284B8C] text-white`}>✍ Enviar para assinatura</button>}
        </div>
      </div>

      {indisponivel && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{indisponivel} (rode .sql/Pendentes/locacao_propostas.sql se ainda não rodou).</p>}
      {desatualizada && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
          ⚠ A ficha foi alterada depois do envio da proposta v{ultimaValida!.versao}{ultimaValida!.status === 'ASSINADO' ? ' (já assinada)' : ''} — o cliente {ultimaValida!.status === 'ASSINADO' ? 'assinou' : 'vai assinar'} a versão antiga. Reenvie se a mudança precisa de aceite.
        </p>
      )}

      {!carregando && !indisponivel && propostas.length === 0 && <p className="text-xs text-gray-400">Nenhuma proposta enviada ainda.</p>}
      {propostas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                <th className="p-2">Versão</th><th className="p-2">Situação</th><th className="p-2">Para</th><th className="p-2">Andamento</th><th className="p-2 text-right">Valor</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {propostas.map(p => (
                <tr key={p.id} className={`border-b border-[#F1F5F9] align-top ${p.status === 'CANCELADO' ? 'opacity-60' : ''}`}>
                  <td className="p-2 font-black text-[#0C1D4D]">v{p.versao}{p.sandbox && <span className="block text-[9px] text-amber-600 font-bold">TESTE</span>}</td>
                  <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${COR[p.status]}`}>{ROTULO[p.status]}</span>
                    {p.motivo_cancelamento && <span className="block text-[10px] text-gray-400 mt-0.5">{p.motivo_cancelamento}</span>}</td>
                  <td className="p-2"><p className="font-bold">{p.signatario_nome}</p><p className="text-[10px] text-gray-400">{p.signatario_celular || p.signatario_email}</p></td>
                  <td className="p-2 text-[10px] text-gray-500 whitespace-nowrap">
                    <p>Enviada {dataHora(p.enviado_em)}{p.enviado_por ? ` · ${p.enviado_por}` : ''}</p>
                    {p.visualizado_em && <p>Vista {dataHora(p.visualizado_em)}</p>}
                    {p.assinado_em && <p className="text-emerald-700 font-bold">Assinada {dataHora(p.assinado_em)}</p>}
                    {p.rejeitado_em && <p className="text-red-600 font-bold">Recusada {dataHora(p.rejeitado_em)}</p>}
                  </td>
                  <td className="p-2 text-right font-bold whitespace-nowrap">{p.valor_total !== null ? formatarMoeda(Number(p.valor_total)) : '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap space-x-2">
                    {['ENVIADO', 'VISUALIZADO'].includes(p.status) && <button onClick={() => atualizar(p)} disabled={ocupado === p.id} className="text-[10px] font-black uppercase text-[#336699] hover:underline">Atualizar</button>}
                    {p.status === 'ASSINADO' && <button onClick={() => baixar(p, 'ASSINADO')} disabled={ocupado === p.id} className="text-[10px] font-black uppercase text-emerald-700 hover:underline">PDF assinado</button>}
                    {p.status === 'ASSINADO' && !p.pdf_assinado_path && <button onClick={() => atualizar(p)} disabled={ocupado === p.id} className="text-[10px] font-black uppercase text-[#336699] hover:underline">Buscar assinado</button>}
                    <button onClick={() => baixar(p, 'ORIGINAL')} disabled={ocupado === p.id} className="text-[10px] font-black uppercase text-gray-500 hover:underline">Original</button>
                    {['ENVIADO', 'VISUALIZADO'].includes(p.status) && p.link_assinatura && <button onClick={() => copiarLink(p)} className="text-[10px] font-black uppercase text-gray-500 hover:underline">Link</button>}
                    {['ENVIADO', 'VISUALIZADO'].includes(p.status) && <button onClick={() => cancelar(p)} disabled={ocupado === p.id} className="text-[10px] font-black uppercase text-red-500 hover:underline">Cancelar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Enviar proposta para assinatura"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setModal(false)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
            <button onClick={enviar} disabled={enviando} className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">{enviando ? 'Enviando...' : 'Enviar'}</button>
          </div>
        }>
        <p className="text-xs text-[#64748B]">A Autentique envia o link de assinatura para a pessoa abaixo. {propostas.some(p => ['ENVIADO', 'VISUALIZADO'].includes(p.status)) && <strong>A proposta anterior ainda aberta será cancelada.</strong>}</p>
        <div><label className={labelCls}>Quem vai assinar</label><input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} className={inputCls} /></div>
        <div>
          <label className={labelCls}>Enviar por</label>
          <div className="grid grid-cols-2 gap-2">
            {(['WHATSAPP', 'EMAIL'] as const).map(c => (
              <button key={c} type="button" onClick={() => setForm({ ...form, canal: c })}
                className={`py-2 rounded-lg text-xs font-black uppercase border-2 ${form.canal === c ? 'border-[#336699] bg-blue-50 text-[#0C1D4D]' : 'border-[#E2E8F0] text-gray-500'}`}>{c === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}</button>
            ))}
          </div>
        </div>
        {form.canal === 'WHATSAPP'
          ? <div><label className={labelCls}>Celular (WhatsApp)</label><input value={form.celular} onChange={e => setForm({ ...form, celular: e.target.value })} placeholder="(11) 99999-0000" className={inputCls} /></div>
          : <div><label className={labelCls}>E-mail</label><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="cliente@empresa.com.br" className={inputCls} /></div>}
        <p className="text-[10px] text-gray-400 -mt-2">PDF {mostrarValores ? 'com' : 'sem'} valor por item (altere em “Valor por item” no painel). O total sempre aparece.</p>
        <label className="flex items-center gap-2 text-xs font-bold text-amber-700">
          <input type="checkbox" checked={form.sandbox} onChange={e => setForm({ ...form, sandbox: e.target.checked })} />
          Envio de teste (sandbox da Autentique — não gasta crédito, sem validade jurídica)
        </label>
      </Modal>
    </div>
  );
}
