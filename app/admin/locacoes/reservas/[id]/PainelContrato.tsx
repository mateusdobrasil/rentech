"use client";

// Painel "Contrato" do editor da Ficha de Reserva (2026-11-17): prévia do PDF
// no modelo padrão da empresa, envio para assinatura na Autentique e
// acompanhamento de cada assinatura. Assinam: vendedor(a) e cliente sempre;
// testemunhas, representante da empresa (só se incluído) e outras pessoas.
import { useState, useEffect, useCallback } from 'react';
import {
  listarContratosAction, previaContratoAction, enviarContratoAction, atualizarStatusContratoAction,
  baixarContratoAction, cancelarContratoAction,
} from '../actions-contrato';
import Modal from '../../../../components/ui/Modal';
import { useToast, usePrompt } from '../../../../components/ui/NotificationProvider';
import { formatarMoeda } from '../../../../lib/formatadores';
import type { StatusFicha } from '../actions';
import { ROTULO_PAPEL, MAX_ASSINANTES, type PapelAssinante, type AssinanteContrato } from '../../../../lib/locacao/assinantesContrato';

type Status = 'ENVIADO' | 'VISUALIZADO' | 'PARCIAL' | 'ASSINADO' | 'REJEITADO' | 'CANCELADO';
type Signatario = AssinanteContrato;
interface Contrato {
  id: number; versao: number; status: Status; sandbox: boolean; signatarios: Signatario[]; valor_total: number | null; conteudo_versao: string | null;
  pdf_original_path: string | null; pdf_assinado_path: string | null; enviado_por: string | null; enviado_em: string; assinado_em: string | null; motivo_cancelamento: string | null;
}

const COR: Record<Status, string> = {
  ENVIADO: 'bg-blue-100 text-blue-700', VISUALIZADO: 'bg-cyan-100 text-cyan-700', PARCIAL: 'bg-amber-100 text-amber-700',
  ASSINADO: 'bg-emerald-100 text-emerald-700', REJEITADO: 'bg-red-100 text-red-600', CANCELADO: 'bg-gray-100 text-gray-500',
};
const ROTULO: Record<Status, string> = { ENVIADO: 'Enviado', VISUALIZADO: 'Visualizado', PARCIAL: 'Assinado em parte', ASSINADO: 'Assinado', REJEITADO: 'Recusado', CANCELADO: 'Cancelado' };
const ABERTOS: Status[] = ['ENVIADO', 'VISUALIZADO', 'PARCIAL'];
const CONTRATAVEIS: StatusFicha[] = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const dataHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function abrirBase64(base64: string, nome: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new File([bytes], nome, { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

type Pessoa = { chave: number; papel: PapelAssinante; nome: string; canal: 'WHATSAPP' | 'EMAIL'; celular: string; email: string };
type Contato = { nome: string; email: string; celular: string };
let seqPessoa = 0;
const novaPessoa = (papel: PapelAssinante, c?: Partial<Contato>): Pessoa => ({
  chave: ++seqPessoa, papel, nome: c?.nome || '', celular: c?.celular || '', email: c?.email || '',
  canal: c?.celular && !c?.email ? 'WHATSAPP' : c?.email ? 'EMAIL' : 'WHATSAPP',
});
const COR_PAPEL: Record<PapelAssinante, string> = {
  VENDEDOR: 'text-[#336699]', LOCATARIA: 'text-emerald-700', REPRESENTANTE: 'text-violet-700', TESTEMUNHA: 'text-amber-700', OUTRO: 'text-gray-600',
};

export default function PainelContrato({ fichaId, accessToken, status, alterado, podeEditar, contatoNome, contatoTelefone, contatoEmail, clienteNome, onMudou }: {
  fichaId: number; accessToken: string; status: StatusFicha; alterado: boolean; podeEditar: boolean;
  contatoNome: string; contatoTelefone: string; contatoEmail: string; clienteNome: string;
  onMudou: () => void;
}) {
  const toast = useToast();
  const pedir = usePrompt();
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [conteudoAtual, setConteudoAtual] = useState<string | null>(null);
  const [padroes, setPadroes] = useState<{ vendedor: Contato; representante: Contato }>({ vendedor: { nome: '', email: '', celular: '' }, representante: { nome: '', email: '', celular: '' } });
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [modal, setModal] = useState(false);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [sandbox, setSandbox] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const r = await listarContratosAction(fichaId, accessToken);
    if (r.ok) {
      setContratos(r.info.contratos); setConteudoAtual(r.info.conteudoAtual); setPadroes({ vendedor: r.info.vendedor, representante: r.info.representante }); setPendencias(r.info.pendenciasEmpresa || []);
      setIndisponivel(null);
    } else setIndisponivel(r.erro || 'Não foi possível carregar os contratos.');
    setCarregando(false);
  }, [fichaId, accessToken]);

  useEffect(() => { carregar(); }, [carregar, status]);

  const contratavel = CONTRATAVEIS.includes(status);
  const ultimoValido = contratos.find(c => c.status !== 'CANCELADO');
  const desatualizado = !!ultimoValido && ultimoValido.status !== 'REJEITADO' && (ultimoValido.conteudo_versao || '') !== (conteudoAtual || '');

  const previa = async () => {
    if (alterado) return toast('Salve a ficha antes de gerar o contrato.', 'info');
    setGerando(true);
    const r = await previaContratoAction(fichaId, accessToken);
    setGerando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao gerar o contrato.', 'error');
    abrirBase64(r.info.base64, r.info.nome);
  };

  const abrirEnvio = () => {
    if (alterado) return toast('Salve a ficha antes de enviar o contrato.', 'info');
    // padrão: vendedor(a) da ficha + cliente (contato da ficha)
    setPessoas([
      novaPessoa('VENDEDOR', padroes.vendedor),
      { ...novaPessoa('LOCATARIA', { nome: contatoNome || clienteNome, celular: contatoTelefone, email: contatoEmail }), canal: contatoTelefone ? 'WHATSAPP' : 'EMAIL' },
    ]);
    setSandbox(false);
    setModal(true);
  };

  const enviar = async () => {
    const assinantes = pessoas.map(p => ({ papel: p.papel, nome: p.nome, celular: p.canal === 'WHATSAPP' ? p.celular : null, email: p.canal === 'EMAIL' ? p.email : null }));
    setEnviando(true);
    const r = await enviarContratoAction(fichaId, { assinantes, sandbox }, accessToken);
    setEnviando(false);
    if (!r.ok) return toast(r.erro || 'Erro ao enviar.', 'error');
    toast(`Contrato v${r.info.versao} enviado para assinatura.`, 'success');
    setModal(false);
    await carregar();
    onMudou();
  };

  const atualizar = async (c: Contrato) => {
    setOcupado(c.id);
    const r = await atualizarStatusContratoAction(c.id, accessToken);
    setOcupado(null);
    if (!r.ok) return toast(r.erro || 'Erro ao consultar a Autentique.', 'error');
    toast(`Contrato: ${ROTULO[r.info.status as Status] || r.info.status}.`, 'info');
    await carregar();
    onMudou();
  };

  const baixar = async (c: Contrato, qual: 'ORIGINAL' | 'ASSINADO') => {
    setOcupado(c.id);
    const r = await baixarContratoAction(c.id, qual, accessToken);
    setOcupado(null);
    if (!r.ok) return toast(r.erro || 'Erro ao baixar.', 'error');
    window.open(r.info.url, '_blank');
  };

  const cancelar = async (c: Contrato) => {
    const motivo = await pedir({ title: `Cancelar contrato v${c.versao}`, message: 'Os links de assinatura param de funcionar. Motivo (opcional):', placeholder: 'Ex.: cliente pediu alteração' });
    if (motivo === null) return;
    setOcupado(c.id);
    const r = await cancelarContratoAction(c.id, motivo, accessToken);
    setOcupado(null);
    if (!r.ok) return toast(r.erro || 'Erro ao cancelar.', 'error');
    toast('Contrato cancelado.', 'success');
    await carregar();
    onMudou();
  };

  const copiar = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast('Link copiado.', 'success'); } catch { toast(link, 'info'); }
  };

  const btn = 'px-3 py-2 rounded-lg font-bold uppercase text-[10px] tracking-wider disabled:opacity-40';
  const inputCls = 'w-full border border-[#CBD5E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#336699]';
  const labelCls = 'block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1';

  const mudarPessoa = (chave: number, parcial: Partial<Pessoa>) => setPessoas(l => l.map(p => (p.chave === chave ? { ...p, ...parcial } : p)));
  const removerPessoa = (chave: number) => setPessoas(l => l.filter(p => p.chave !== chave));
  const incluir = (papel: PapelAssinante) => {
    if (pessoas.length >= MAX_ASSINANTES) return toast(`No máximo ${MAX_ASSINANTES} pessoas por contrato.`, 'info');
    setPessoas(l => [...l, novaPessoa(papel, papel === 'REPRESENTANTE' ? padroes.representante : papel === 'VENDEDOR' ? padroes.vendedor : undefined)]);
  };
  const temRepresentante = pessoas.some(p => p.papel === 'REPRESENTANTE');

  const linhaPessoa = (p: Pessoa) => (
    <div key={p.chave} className="border border-[#E2E8F0] rounded-xl p-3 space-y-2">
      <div className="flex justify-between items-center">
        <p className={`text-[10px] font-black uppercase ${COR_PAPEL[p.papel]}`}>{ROTULO_PAPEL[p.papel]}{p.papel === 'REPRESENTANTE' ? ' (assina pela empresa)' : ''}</p>
        <button type="button" onClick={() => removerPessoa(p.chave)} className="text-gray-300 hover:text-red-500 text-lg leading-none" title="Tirar desta assinatura">×</button>
      </div>
      <input value={p.nome} onChange={e => mudarPessoa(p.chave, { nome: e.target.value })} placeholder="Nome completo" className={inputCls} />
      <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
        <div className="flex gap-1">
          {(['WHATSAPP', 'EMAIL'] as const).map(c => (
            <button key={c} type="button" onClick={() => mudarPessoa(p.chave, { canal: c })}
              className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase border-2 ${p.canal === c ? 'border-[#336699] bg-blue-50 text-[#0C1D4D]' : 'border-[#E2E8F0] text-gray-500'}`}>{c === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'}</button>
          ))}
        </div>
        {p.canal === 'WHATSAPP'
          ? <input value={p.celular} onChange={e => mudarPessoa(p.chave, { celular: e.target.value })} placeholder="(11) 99999-0000" className={inputCls} />
          : <input value={p.email} onChange={e => mudarPessoa(p.chave, { email: e.target.value })} placeholder="email@empresa.com.br" className={inputCls} />}
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
        <div>
          <h2 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Contrato de locação</h2>
          <p className="text-[10px] text-gray-500 mt-0.5">Modelo padrão da empresa (cláusulas 1ª a 41ª) com os dados da ficha. Assinam o cliente e o representante da locadora, pela Autentique.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={previa} disabled={gerando} className={`${btn} bg-white border border-[#CBD5E1] text-[#0C1D4D]`}>{gerando ? 'Gerando...' : '📄 Baixar contrato'}</button>
          {contratavel && podeEditar && <button onClick={abrirEnvio} disabled={!!indisponivel} className={`${btn} bg-[#0C1D4D] hover:bg-[#284B8C] text-white`}>✍ Enviar contrato para assinatura</button>}
        </div>
      </div>

      {!contratavel && <p className="text-xs text-gray-500 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 mb-3">O contrato vai para assinatura depois que a ficha é aprovada/reservada. Dá para baixar a prévia agora.</p>}
      {pendencias.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">⚠ Falta no cadastro da empresa ({pendencias.join(', ')}) — preencha em Parâmetros → Empresas para o contrato sair completo.</p>}
      {indisponivel && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{indisponivel} (rode .sql/Pendentes/locacao_contrato_proposta.sql se ainda não rodou).</p>}
      {desatualizado && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
          ⚠ A ficha mudou depois do envio do contrato v{ultimoValido!.versao}{ultimoValido!.status === 'ASSINADO' ? ' (já assinado)' : ''}. Reenvie se a mudança precisa constar no contrato.
        </p>
      )}

      {!carregando && !indisponivel && contratos.length === 0 && <p className="text-xs text-gray-400">Nenhum contrato enviado ainda.</p>}
      {contratos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-black text-gray-500 uppercase tracking-wider border-b border-[#E2E8F0]">
                <th className="p-2">Versão</th><th className="p-2">Situação</th><th className="p-2">Assinaturas</th><th className="p-2 text-right">Valor</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {contratos.map(c => (
                <tr key={c.id} className={`border-b border-[#F1F5F9] align-top ${c.status === 'CANCELADO' ? 'opacity-60' : ''}`}>
                  <td className="p-2 font-black text-[#0C1D4D]">v{c.versao}{c.sandbox && <span className="block text-[9px] text-amber-600 font-bold">TESTE</span>}
                    <span className="block text-[9px] text-gray-400 font-normal">{dataHora(c.enviado_em)}{c.enviado_por ? ` · ${c.enviado_por}` : ''}</span></td>
                  <td className="p-2"><span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${COR[c.status]}`}>{ROTULO[c.status]}</span>
                    {c.motivo_cancelamento && <span className="block text-[10px] text-gray-400 mt-0.5">{c.motivo_cancelamento}</span>}</td>
                  <td className="p-2 space-y-1">
                    {(c.signatarios || []).map((s, i) => (
                      <div key={i} className="text-[10px]">
                        <span className={`font-black uppercase ${COR_PAPEL[s.papel] || 'text-gray-500'}`}>{ROTULO_PAPEL[s.papel] || s.papel}:</span> <strong className="text-[#0C1D4D]">{s.nome}</strong>
                        {' · '}
                        {s.assinado_em ? <span className="text-emerald-700 font-bold">assinou {dataHora(s.assinado_em)}</span>
                          : s.rejeitado_em ? <span className="text-red-600 font-bold">recusou</span>
                          : s.visualizado_em ? <span className="text-cyan-700">viu {dataHora(s.visualizado_em)}</span>
                          : <span className="text-gray-400">aguardando</span>}
                        {!s.assinado_em && ABERTOS.includes(c.status) && s.link && <button onClick={() => copiar(s.link!)} className="ml-2 font-black uppercase text-gray-500 hover:underline">link</button>}
                      </div>
                    ))}
                  </td>
                  <td className="p-2 text-right font-bold whitespace-nowrap">{c.valor_total !== null ? formatarMoeda(Number(c.valor_total)) : '—'}</td>
                  <td className="p-2 text-right whitespace-nowrap space-x-2">
                    {(ABERTOS.includes(c.status) || (c.status === 'ASSINADO' && !c.pdf_assinado_path)) && <button onClick={() => atualizar(c)} disabled={ocupado === c.id} className="text-[10px] font-black uppercase text-[#336699] hover:underline">Atualizar</button>}
                    {c.status === 'ASSINADO' && c.pdf_assinado_path && <button onClick={() => baixar(c, 'ASSINADO')} disabled={ocupado === c.id} className="text-[10px] font-black uppercase text-emerald-700 hover:underline">PDF assinado</button>}
                    <button onClick={() => baixar(c, 'ORIGINAL')} disabled={ocupado === c.id} className="text-[10px] font-black uppercase text-gray-500 hover:underline">Original</button>
                    {ABERTOS.includes(c.status) && podeEditar && <button onClick={() => cancelar(c)} disabled={ocupado === c.id} className="text-[10px] font-black uppercase text-red-500 hover:underline">Cancelar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Enviar contrato para assinatura"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setModal(false)} className="px-4 py-2 rounded-lg text-xs font-bold uppercase text-gray-500 border border-[#E2E8F0]">Cancelar</button>
            <button onClick={enviar} disabled={enviando} className="bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider">{enviando ? 'Enviando...' : 'Enviar'}</button>
          </div>
        }>
        <p className="text-xs text-[#64748B]">A Autentique manda o link para cada pessoa. O contrato só conta como assinado quando todas assinarem. {contratos.some(c => ABERTOS.includes(c.status)) && <strong>O contrato anterior ainda aberto será cancelado.</strong>}</p>
        <div className="space-y-2">{pessoas.map(linhaPessoa)}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => incluir('TESTEMUNHA')} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border border-amber-300 text-amber-700 bg-amber-50">+ Testemunha</button>
          <button type="button" onClick={() => incluir('LOCATARIA')} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border border-emerald-300 text-emerald-700 bg-emerald-50">+ Cliente</button>
          {!temRepresentante && <button type="button" onClick={() => incluir('REPRESENTANTE')} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border border-violet-300 text-violet-700 bg-violet-50">+ Representante</button>}
          <button type="button" onClick={() => incluir('OUTRO')} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border border-[#CBD5E1] text-gray-600">+ Outra pessoa</button>
        </div>
        {temRepresentante && !padroes.representante.nome && <p className="text-[10px] text-gray-400">Dica: cadastre o representante padrão em Parâmetros → Empresas para ele vir preenchido.</p>}
        <label className="flex items-center gap-2 text-xs font-bold text-amber-700">
          <input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)} />
          Envio de teste (sandbox da Autentique — sem validade jurídica)
        </label>
      </Modal>
    </div>
  );
}
