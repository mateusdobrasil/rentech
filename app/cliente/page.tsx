"use client";

// Portal do Cliente (2026-11-17): e-mail + código → propostas, reservas,
// histórico e pedido de orçamento. Regras/escopo em ./actions.ts.
import { useState, useEffect, useCallback } from 'react';
import {
  solicitarCodigoAction, confirmarCodigoAction, sairAction, painelClienteAction, fichaClienteAction,
  baixarPropostaClienteAction, solicitarOrcamentoAction,
} from './actions';

type Aba = 'propostas' | 'reservas' | 'historico' | 'titulos' | 'solicitar';
const BRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const STATUS: Record<string, { r: string; cls: string }> = {
  ENVIADO: { r: 'Aguardando seu aceite', cls: 'bg-amber-100 text-amber-800' },
  APROVADO: { r: 'Aprovada', cls: 'bg-cyan-100 text-cyan-700' },
  RESERVADA: { r: 'Reservada', cls: 'bg-emerald-100 text-emerald-700' },
  EM_LOCACAO: { r: 'Em andamento', cls: 'bg-violet-100 text-violet-700' },
  FINALIZADA: { r: 'Concluída', cls: 'bg-gray-100 text-gray-600' },
};

export default function PortalClientePage() {
  const [carregando, setCarregando] = useState(true);
  const [painel, setPainel] = useState<any>(null);
  // login
  const [etapa, setEtapa] = useState<'email' | 'codigo'>('email');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  // painel
  const [aba, setAba] = useState<Aba>('reservas');
  const [ficha, setFicha] = useState<any>(null);
  const [form, setForm] = useState({ parceiro_id: 0, contato_nome: '', contato_telefone: '', evento: '', local: '', data_inicio: '', data_fim: '', itens: '', observacoes: '' });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await painelClienteAction();
    if (r.ok) {
      setPainel(r.info);
      setForm(f => ({ ...f, parceiro_id: f.parceiro_id || r.info.clientes[0]?.id || 0 }));
      if (r.info.fichas.some((x: any) => x.status === 'ENVIADO')) setAba(a => (a === 'reservas' ? 'propostas' : a));
    } else setPainel(null);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const pedirCodigo = async () => {
    setEnviando(true); setMsg(null);
    const r = await solicitarCodigoAction(email);
    setEnviando(false);
    if (!r.ok) return setMsg({ tipo: 'erro', texto: r.erro || 'Erro.' });
    setMsg({ tipo: 'ok', texto: r.info.mensagem }); setEtapa('codigo'); setCodigo('');
  };
  const entrar = async () => {
    setEnviando(true); setMsg(null);
    const r = await confirmarCodigoAction(email, codigo);
    setEnviando(false);
    if (!r.ok) return setMsg({ tipo: 'erro', texto: r.erro || 'Erro.' });
    setEtapa('email'); setCodigo(''); carregar();
  };
  const sair = async () => { await sairAction(); setPainel(null); setFicha(null); };
  const abrirFicha = async (id: number) => {
    const r = await fichaClienteAction(id);
    if (r.ok) setFicha(r.info); else if (r.erro === 'SESSAO') setPainel(null);
  };
  const baixar = async (id: number, qual: 'ORIGINAL' | 'ASSINADO') => {
    const r = await baixarPropostaClienteAction(id, qual);
    if (r.ok) window.open(r.info.url, '_blank'); else alert(r.erro);
  };
  const enviarSolicitacao = async () => {
    setEnviando(true); setMsg(null);
    const r = await solicitarOrcamentoAction(form);
    setEnviando(false);
    if (!r.ok) return setMsg({ tipo: 'erro', texto: r.erro === 'SESSAO' ? 'Sua sessão expirou — entre de novo.' : (r.erro || 'Erro.') });
    setMsg({ tipo: 'ok', texto: 'Pedido enviado! Nossa equipe comercial vai preparar o orçamento e falar com você.' });
    setForm(f => ({ ...f, evento: '', local: '', data_inicio: '', data_fim: '', itens: '', observacoes: '' }));
    carregar();
  };

  const inputCls = 'w-full border border-[#CBD5E1] rounded-xl px-4 py-3 text-base text-[#0C1D4D] bg-white focus:outline-none focus:border-[#336699]';
  const labelCls = 'block text-[11px] font-black text-gray-500 uppercase tracking-wider mb-1';

  if (carregando) {
    return <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16"><div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin" /></div>;
  }

  // ===================== LOGIN =====================
  if (!painel) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4 pt-20 text-[#0C1D4D]">
        <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-[#E2E8F0] p-6 md:p-8 space-y-5">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Portal do Cliente</h1>
            <p className="text-sm text-gray-500 mt-1">Acompanhe propostas, reservas e eventos. Entre com o e-mail cadastrado na sua empresa — enviamos um código de acesso, sem senha.</p>
          </div>
          {etapa === 'email' ? (
            <form onSubmit={e => { e.preventDefault(); pedirCodigo(); }} className="space-y-3">
              <div><label className={labelCls}>Seu e-mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="email" placeholder="voce@empresa.com.br" className={inputCls} /></div>
              <button disabled={enviando || !email} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white py-3 rounded-xl font-black uppercase text-sm tracking-wider">{enviando ? 'Enviando...' : 'Receber código'}</button>
            </form>
          ) : (
            <form onSubmit={e => { e.preventDefault(); entrar(); }} className="space-y-3">
              <p className="text-sm">Código enviado para <strong>{email}</strong>.</p>
              <div><label className={labelCls}>Código de 6 dígitos</label>
                <input value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="000000"
                  className={`${inputCls} text-center text-3xl font-black tracking-[0.5em]`} /></div>
              <button disabled={enviando || codigo.length !== 6} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white py-3 rounded-xl font-black uppercase text-sm tracking-wider">{enviando ? 'Entrando...' : 'Entrar'}</button>
              <button type="button" onClick={() => { setEtapa('email'); setMsg(null); }} className="w-full text-xs font-bold text-gray-500">Usar outro e-mail / reenviar código</button>
            </form>
          )}
          {msg && <p className={`text-sm rounded-xl p-3 border ${msg.tipo === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.texto}</p>}
          <p className="text-[11px] text-gray-400">Não recebeu? Seu e-mail precisa estar no cadastro da sua empresa conosco — fale com o seu vendedor.</p>
        </div>
      </div>
    );
  }

  // ===================== PAINEL =====================
  const fichas: any[] = painel.fichas;
  const grupos: Record<Exclude<Aba, 'titulos' | 'solicitar'>, any[]> = {
    propostas: fichas.filter(f => f.status === 'ENVIADO'),
    reservas: fichas.filter(f => ['APROVADO', 'RESERVADA', 'EM_LOCACAO'].includes(f.status)).sort((a, b) => a.data_inicio.localeCompare(b.data_inicio)),
    historico: fichas.filter(f => f.status === 'FINALIZADA'),
  };
  const abas: [Aba, string, number | null][] = [
    ['propostas', 'Propostas', grupos.propostas.length], ['reservas', 'Reservas', grupos.reservas.length], ['historico', 'Histórico', grupos.historico.length],
    ...(painel.mostrarTitulos ? [['titulos', 'Financeiro', painel.titulos.filter((t: any) => t.status === 'ABERTO').length] as [Aba, string, number]] : []),
    ['solicitar', '+ Pedir orçamento', null],
  ];

  return (
    <div className="min-h-screen bg-[#F0F4F8] text-[#0C1D4D] pt-16">
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-5">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">Portal do Cliente</h1>
            <p className="text-sm text-gray-500">{painel.clientes.map((c: any) => c.nome).join(' · ')} — {painel.email}</p>
          </div>
          <button onClick={sair} className="text-xs font-black uppercase border border-[#CBD5E1] bg-white px-4 py-2 rounded-lg">Sair</button>
        </div>

        <div className="flex flex-wrap gap-2">
          {abas.map(([a, r, n]) => (
            <button key={a} onClick={() => { setAba(a); setMsg(null); }}
              className={`px-4 py-2.5 rounded-xl text-sm font-black ${aba === a ? 'bg-[#0C1D4D] text-white' : a === 'solicitar' ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 border border-[#E2E8F0]'}`}>
              {r}{n !== null && n > 0 ? ` (${n})` : ''}
            </button>
          ))}
        </div>

        {aba !== 'titulos' && aba !== 'solicitar' && (
          grupos[aba].length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-8 text-center text-gray-500 text-sm">
              {aba === 'propostas' ? 'Nenhuma proposta aguardando seu aceite.' : aba === 'reservas' ? 'Nenhuma reserva em aberto.' : 'Nada no histórico ainda.'}
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {grupos[aba].map(f => (
                <div key={f.id} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="font-black">{f.evento || 'Locação'} <span className="text-xs text-gray-400 font-bold">{f.numero}</span></p>
                      <p className="text-xs text-gray-500">{dataBR(f.data_inicio)} a {dataBR(f.data_fim)}{f.local ? ` · ${f.local}` : ''}</p>
                      <p className="text-[11px] text-gray-400">{f.empresa}</p>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full uppercase whitespace-nowrap ${STATUS[f.status]?.cls}`}>{STATUS[f.status]?.r}</span>
                  </div>
                  <p className="text-lg font-black">{BRL(f.valor_total)}</p>
                  {f.status === 'ENVIADO' && f.validade && <p className="text-[11px] text-amber-700">Proposta válida até {dataBR(f.validade)}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {f.proposta_para_assinar && <a href={f.proposta_para_assinar} target="_blank" rel="noreferrer" className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-black uppercase">✍ Ver e assinar proposta</a>}
                    <button onClick={() => abrirFicha(f.id)} className="border border-[#CBD5E1] px-4 py-2 rounded-lg text-xs font-black uppercase">Detalhes</button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {aba === 'titulos' && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] font-black text-gray-500 uppercase border-b"><th className="p-2">Vencimento</th><th className="p-2">Descrição</th><th className="p-2 text-right">Valor</th><th className="p-2">Situação</th></tr></thead>
              <tbody>{painel.titulos.map((t: any) => (
                <tr key={t.id} className="border-b border-[#F1F5F9]">
                  <td className="p-2">{dataBR(t.vencimento)}</td><td className="p-2">{t.descricao}</td><td className="p-2 text-right font-bold">{BRL(Number(t.valor))}</td>
                  <td className="p-2">{t.status === 'PAGO' ? `Pago em ${dataBR(t.data_pagamento)}` : 'Em aberto'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {aba === 'solicitar' && (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6 space-y-3">
            <p className="text-sm text-gray-600">Conte o que você precisa — nossa equipe monta o orçamento e envia por aqui e por e-mail.</p>
            {painel.clientes.length > 1 && (
              <div><label className={labelCls}>Empresa</label>
                <select value={form.parceiro_id} onChange={e => setForm({ ...form, parceiro_id: Number(e.target.value) })} className={inputCls}>{painel.clientes.map((c: any) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
            )}
            <div className="grid md:grid-cols-2 gap-3">
              <div><label className={labelCls}>Seu nome</label><input value={form.contato_nome} onChange={e => setForm({ ...form, contato_nome: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Telefone / WhatsApp</label><input value={form.contato_telefone} onChange={e => setForm({ ...form, contato_telefone: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Evento</label><input value={form.evento} onChange={e => setForm({ ...form, evento: e.target.value })} placeholder="Nome do evento ou feira" className={inputCls} /></div>
              <div><label className={labelCls}>Local</label><input value={form.local} onChange={e => setForm({ ...form, local: e.target.value })} placeholder="Endereço / pavilhão / estande" className={inputCls} /></div>
              <div><label className={labelCls}>Início</label><input type="date" value={form.data_inicio} onChange={e => setForm({ ...form, data_inicio: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Fim</label><input type="date" value={form.data_fim} onChange={e => setForm({ ...form, data_fim: e.target.value })} className={inputCls} /></div>
            </div>
            <div><label className={labelCls}>O que você precisa</label><textarea value={form.itens} onChange={e => setForm({ ...form, itens: e.target.value })} rows={5} placeholder="Ex.: painel de LED 4x2,5m, 6 TVs 55&quot; com pedestal, som para 200 pessoas, operador técnico..." className={inputCls} /></div>
            <div><label className={labelCls}>Observações</label><textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} className={inputCls} /></div>
            <button onClick={enviarSolicitacao} disabled={enviando} className="w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black uppercase text-sm">{enviando ? 'Enviando...' : 'Enviar pedido de orçamento'}</button>
            {msg && <p className={`text-sm rounded-xl p-3 border ${msg.tipo === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.texto}</p>}
            {painel.solicitacoes.length > 0 && (
              <div className="pt-2">
                <p className={labelCls}>Seus pedidos</p>
                <ul className="text-sm divide-y divide-[#F1F5F9]">{painel.solicitacoes.map((s: any) => (
                  <li key={s.id} className="py-2 flex justify-between gap-2">
                    <span>{s.evento || 'Pedido'} · {dataBR(s.data_inicio)}{s.data_fim ? ` a ${dataBR(s.data_fim)}` : ''}</span>
                    <span className="text-xs font-bold text-gray-500">{s.status === 'NOVA' ? 'Recebido' : s.status === 'EM_ATENDIMENTO' ? 'Em atendimento' : s.status === 'ORCADA' ? 'Orçamento preparado' : 'Encerrado'} · {dataBR(s.criado_em)}</span>
                  </li>
                ))}</ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- detalhe da ficha ---------- */}
      {ficha && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3" onClick={() => setFicha(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 md:p-6 space-y-4 text-[#0C1D4D]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-3">
              <div>
                <h2 className="text-xl font-black">{ficha.evento || 'Locação'} <span className="text-sm text-gray-400">{ficha.numero}</span></h2>
                <p className="text-sm text-gray-500">{ficha.cliente} · {ficha.empresa.nome}</p>
              </div>
              <button onClick={() => setFicha(null)} className="text-2xl leading-none text-gray-400">&times;</button>
            </div>
            <span className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-full uppercase ${STATUS[ficha.status]?.cls}`}>{STATUS[ficha.status]?.r}</span>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[['Montagem', ficha.datas.montagem], ['Início', ficha.datas.inicio], ['Fim', ficha.datas.fim], ['Desmontagem', ficha.datas.desmontagem]].filter(([, v]) => v).map(([r, v]) => (
                <div key={r as string}><p className={labelCls}>{r}</p><p className="font-bold">{dataBR(v as string)}</p></div>
              ))}
              {ficha.local && <div className="col-span-2"><p className={labelCls}>Local</p><p className="font-bold">{ficha.local}{ficha.estande ? ` · ${ficha.estande}` : ''}</p></div>}
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] font-black text-gray-500 uppercase border-b"><th className="p-2">Item</th><th className="p-2 text-right">Qtd</th><th className="p-2 text-right">Dias</th><th className="p-2 text-right">Total</th></tr></thead>
              <tbody>{ficha.itens.map((i: any, k: number) => (
                <tr key={k} className="border-b border-[#F1F5F9]"><td className="p-2">{i.descricao}</td><td className="p-2 text-right">{i.quantidade.toLocaleString('pt-BR')}</td><td className="p-2 text-right">{i.dias || '—'}</td><td className="p-2 text-right font-bold">{BRL(i.valor_total)}</td></tr>
              ))}</tbody>
            </table>
            <div className="text-right text-sm space-y-0.5">
              {ficha.valores.desconto > 0 && <p className="text-gray-500">Desconto: − {BRL(ficha.valores.desconto)}</p>}
              <p className="text-xl font-black">Total {BRL(ficha.valores.total)}</p>
              {ficha.condicao_pagamento && <p className="text-xs text-gray-500">Pagamento: {ficha.condicao_pagamento}</p>}
            </div>
            {ficha.observacoes && <p className="text-sm bg-[#F8FAFC] rounded-xl p-3 whitespace-pre-line">{ficha.observacoes}</p>}
            {ficha.propostas.length > 0 && (
              <div>
                <p className={labelCls}>Propostas</p>
                <ul className="text-sm divide-y divide-[#F1F5F9]">{ficha.propostas.map((p: any) => (
                  <li key={p.id} className="py-2 flex flex-wrap justify-between items-center gap-2">
                    <span>Versão {p.versao} · {p.status === 'ASSINADO' ? `assinada em ${dataBR(p.assinado_em)}` : p.status === 'REJEITADO' ? 'recusada' : 'aguardando assinatura'}</span>
                    <span className="flex gap-2">
                      {p.link_assinatura && <a href={p.link_assinatura} target="_blank" rel="noreferrer" className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase">✍ Assinar</a>}
                      {p.tem_assinado && <button onClick={() => baixar(p.id, 'ASSINADO')} className="border border-[#CBD5E1] px-3 py-1.5 rounded-lg text-xs font-black uppercase">PDF assinado</button>}
                      {!p.tem_assinado && p.tem_original && <button onClick={() => baixar(p.id, 'ORIGINAL')} className="border border-[#CBD5E1] px-3 py-1.5 rounded-lg text-xs font-black uppercase">PDF</button>}
                    </span>
                  </li>
                ))}</ul>
              </div>
            )}
            <p className="text-xs text-gray-500">Dúvidas? Fale com {ficha.vendedor || 'seu vendedor'}{ficha.empresa.telefone ? ` · ${ficha.empresa.telefone}` : ''}{ficha.empresa.email ? ` · ${ficha.empresa.email}` : ''}.</p>
          </div>
        </div>
      )}
    </div>
  );
}
