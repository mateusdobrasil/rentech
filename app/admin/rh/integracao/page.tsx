"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarIntegracoesAction, salvarIntegracaoAction,
  montarLoteSalariosAction, salvarLoteAction, listarLotesAction, enviarLoteAoBancoAction
} from '../actions/actions-integracao';

const BRL = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDataHora = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtMesBR = (m: string) => { const [a, mm] = m.split('-'); return `${mm}/${a}`; };

interface Integracao {
  id: number; parceiro: string; nome_exibicao: string; tipo: string;
  ativo: boolean; ambiente: string; config: any;
}
interface ItemLote {
  funcionario_nome: string; cpf: string; valor: number; metodo: string;
  pix_tipo: string | null; pix_chave: string | null;
  banco_codigo: string | null; banco_agencia: string | null; banco_conta: string | null; banco_tipo: string | null;
  pronto: boolean;
}
interface Lote {
  id: number; parceiro: string; mes_referencia: string; tipo_lote: string;
  qtd_pagamentos: number; valor_total: number; status: string; criado_por: string | null; criado_em: string;
}

const ICONE_TIPO: Record<string, string> = { BANCO: '🏦', BENEFICIO: '🎁', ASSINATURA: '✍️' };

export default function IntegracaoPage() {
  const router = useRouter();
  const [aba, setAba] = useState<'PARCEIROS' | 'PAGAMENTOS'>('PARCEIROS');
  const [usuarioAtual, setUsuarioAtual] = useState('');

  const [integracoes, setIntegracoes] = useState<Integracao[]>([]);
  const [loading, setLoading] = useState(true);

  // Config de parceiro
  const [editParceiro, setEditParceiro] = useState<Integracao | null>(null);
  const [edAtivo, setEdAtivo] = useState(false);
  const [edAmbiente, setEdAmbiente] = useState<'SANDBOX' | 'PRODUCAO'>('SANDBOX');
  const [edAgencia, setEdAgencia] = useState('');
  const [edConta, setEdConta] = useState('');

  // Pagamentos
  const [mesReferencia, setMesReferencia] = useState(() => {
    const h = new Date(); const c = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}`;
  });
  const [itens, setItens] = useState<ItemLote[]>([]);
  const [resumoLote, setResumoLote] = useState({ semDados: 0, valorTotal: 0, totalItens: 0 });
  const [montando, setMontando] = useState(false);
  const [salvandoLote, setSalvandoLote] = useState(false);
  const [lotes, setLotes] = useState<Lote[]>([]);

  useEffect(() => {
    try { const raw = localStorage.getItem('rh_usuario'); if (raw) setUsuarioAtual(JSON.parse(raw)?.nome || ''); } catch {}
    carregar();
  }, []);

  const carregar = async () => {
    setLoading(true);
    try {
      const [integ, lotesRes] = await Promise.all([listarIntegracoesAction(), listarLotesAction({})]);
      if (integ.ok) setIntegracoes(integ.info.integracoes);
      if (lotesRes.ok) setLotes(lotesRes.info.lotes);
    } finally { setLoading(false); }
  };

  const abrirConfig = (i: Integracao) => {
    setEditParceiro(i); setEdAtivo(i.ativo); setEdAmbiente(i.ambiente as any);
    setEdAgencia(i.config?.agencia_debito || ''); setEdConta(i.config?.conta_debito || '');
  };

  const salvarConfig = async () => {
    if (!editParceiro) return;
    const res = await salvarIntegracaoAction({
      parceiro: editParceiro.parceiro, ativo: edAtivo, ambiente: edAmbiente,
      config: { ...editParceiro.config, agencia_debito: edAgencia, conta_debito: edConta }
    });
    if (!res.ok) { alert(res.erro); return; }
    setEditParceiro(null);
    carregar();
  };

  const montarLote = async () => {
    setMontando(true); setItens([]);
    try {
      const res = await montarLoteSalariosAction({ mesReferencia });
      if (!res.ok) throw new Error(res.erro);
      setItens(res.info.itens);
      setResumoLote({ semDados: res.info.semDados, valorTotal: res.info.valorTotal, totalItens: res.info.totalItens });
    } catch (e: any) { alert(e.message); }
    finally { setMontando(false); }
  };

  const alternarItem = (nome: string) => {
    setItens(prev => prev.map(i => i.funcionario_nome === nome ? { ...i, pronto: i.metodo !== 'SEM_DADOS' ? !i.pronto : false } : i));
  };
  const ajustarValor = (nome: string, valor: number) => {
    setItens(prev => prev.map(i => i.funcionario_nome === nome ? { ...i, valor } : i));
  };

  const prontos = itens.filter(i => i.pronto);
  const totalSelecionado = prontos.reduce((s, i) => s + Number(i.valor || 0), 0);

  const gerarLote = async () => {
    if (prontos.length === 0) { alert('Nenhum pagamento pronto para gerar o lote.'); return; }
    if (!confirm(`Gerar lote com ${prontos.length} pagamento(s), total ${BRL(totalSelecionado)}?`)) return;
    setSalvandoLote(true);
    try {
      const res = await salvarLoteAction({
        parceiro: 'ITAU', mesReferencia, tipoLote: 'SALARIOS', itens, criadoPor: usuarioAtual
      });
      if (!res.ok) throw new Error(res.erro);
      alert(`Lote gerado: ${res.info.qtd} pagamentos, ${BRL(res.info.valorTotal)}.`);
      setItens([]); carregar();
    } catch (e: any) { alert(e.message); }
    finally { setSalvandoLote(false); }
  };

  const exportarLoteCSV = () => {
    if (prontos.length === 0) { alert('Nenhum pagamento pronto para exportar.'); return; }
    const cab = 'Funcionário;CPF;Método;Chave PIX / Conta;Valor';
    const linhas = prontos.map(i => {
      const destino = i.metodo === 'PIX' ? `${i.pix_tipo}: ${i.pix_chave}` : `Ag ${i.banco_agencia} C/C ${i.banco_conta} (${i.banco_codigo})`;
      return `"${i.funcionario_nome}";${i.cpf};${i.metodo};"${destino}";${i.valor.toFixed(2).replace('.', ',')}`;
    });
    const csv = '\uFEFF' + [cab, ...linhas, `"TOTAL";;;;${totalSelecionado.toFixed(2).replace('.', ',')}`].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lote-pagamento-${mesReferencia}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const enviarLote = async (loteId: number) => {
    const res = await enviarLoteAoBancoAction({ loteId });
    // Nesta versão o envio direto ainda não está ativo — mostra a orientação
    alert(res.erro || (res.ok ? 'Enviado.' : 'Não foi possível enviar.'));
  };

  const badgeStatus = (s: string) => {
    const mapa: Record<string, string> = {
      RASCUNHO: 'bg-gray-100 text-gray-500', GERADO: 'bg-blue-100 text-blue-700',
      ENVIADO: 'bg-amber-100 text-amber-700', PROCESSADO: 'bg-emerald-100 text-emerald-700', ERRO: 'bg-red-100 text-red-700'
    };
    return <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${mapa[s] || 'bg-gray-100 text-gray-500'}`}>{s}</span>;
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          🔗 <strong>Integrações</strong>. Bancos e parceiros para pagamentos e envio de informações.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* Abas */}
        <div className="flex gap-2 mb-6">
          {(['PARCEIROS', 'PAGAMENTOS'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)} className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${aba === a ? 'bg-[#0C1D4D] text-white shadow-md' : 'bg-white text-gray-500 border border-[#E2E8F0]'}`}>
              {a === 'PARCEIROS' ? '🔌 Parceiros' : '💸 Pagamentos'}
            </button>
          ))}
        </div>

        {/* ===== ABA PARCEIROS ===== */}
        {aba === 'PARCEIROS' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {loading ? <p className="text-gray-400 font-bold uppercase p-8">Carregando...</p> : integracoes.map(i => (
                <div key={i.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{ICONE_TIPO[i.tipo] || '🔗'}</span>
                      <div>
                        <h3 className="font-black text-[#0C1D4D] uppercase text-sm">{i.nome_exibicao}</h3>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">{i.tipo}</p>
                      </div>
                    </div>
                    <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase ${i.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                      {i.ativo ? '● Ativo' : '○ Inativo'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-black uppercase ${i.ambiente === 'PRODUCAO' ? 'text-red-600' : 'text-amber-600'}`}>
                      {i.ambiente === 'PRODUCAO' ? '🔴 Produção' : '🟡 Sandbox'}
                    </span>
                    <button onClick={() => abrirConfig(i)} className="text-[10px] font-black text-[#0C1D4D] bg-white border border-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">⚙ Configurar</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <p className="text-sm text-amber-800 font-medium">
                🔒 <strong>Segurança das credenciais.</strong> Chaves de API, certificados digitais e segredos dos bancos
                <strong> nunca</strong> devem ser digitados aqui nem guardados no banco de dados. Eles vivem em variáveis de
                ambiente no servidor. Esta tela guarda apenas metadados (agência/conta de débito, ambiente e status).
                A integração direta com a API do Itaú será ativada quando as credenciais homologadas estiverem configuradas.
              </p>
            </div>
          </>
        )}

        {/* ===== ABA PAGAMENTOS ===== */}
        {aba === 'PAGAMENTOS' && (
          <>
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-wrap items-center gap-3 mb-4">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Competência</label>
                <input type="month" value={mesReferencia} onChange={e => setMesReferencia(e.target.value)} className="p-2 border border-gray-300 rounded-lg text-sm font-bold bg-[#F8FAFC]" />
              </div>
              <button onClick={montarLote} disabled={montando} className="text-xs font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50 self-end">
                {montando ? '⏳ Montando...' : '📥 Sugerir da folha'}
              </button>
              {itens.length > 0 && (
                <div className="flex gap-2 self-end ml-auto">
                  <button onClick={exportarLoteCSV} className="text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider">⬇ Exportar CSV</button>
                  <button onClick={gerarLote} disabled={salvandoLote} className="text-xs font-black bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
                    {salvandoLote ? '⏳' : '✓ Gerar Lote'}
                  </button>
                </div>
              )}
            </div>

            {/* Resumo do lote em montagem */}
            {itens.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Selecionados</p>
                    <p className="text-2xl font-black text-[#0C1D4D]">{prontos.length}<span className="text-sm text-gray-300">/{itens.length}</span></p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Sem dados bancários</p>
                    <p className={`text-2xl font-black ${resumoLote.semDados > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{resumoLote.semDados}</p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total do lote</p>
                    <p className="text-2xl font-black text-indigo-700">{BRL(totalSelecionado)}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden mb-6">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                          <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px] w-12">✓</th>
                          <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Funcionário</th>
                          <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Método</th>
                          <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Destino</th>
                          <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens.map((it, idx) => (
                          <tr key={it.funcionario_nome} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0] ${it.metodo === 'SEM_DADOS' ? 'opacity-60' : ''}`}>
                            <td className="p-3 text-center">
                              <input type="checkbox" checked={it.pronto} disabled={it.metodo === 'SEM_DADOS'} onChange={() => alternarItem(it.funcionario_nome)} className="w-4 h-4" />
                            </td>
                            <td className="p-3">
                              <span className="font-black text-[#0C1D4D] block">{it.funcionario_nome}</span>
                              <span className="text-[10px] text-gray-400">{it.cpf || 'sem CPF'}</span>
                            </td>
                            <td className="p-3">
                              {it.metodo === 'SEM_DADOS'
                                ? <span className="text-[10px] font-black text-amber-600 uppercase">⚠ Sem dados</span>
                                : <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase ${it.metodo === 'PIX' ? 'bg-teal-100 text-teal-700' : 'bg-blue-100 text-blue-700'}`}>{it.metodo}</span>}
                            </td>
                            <td className="p-3 text-[11px] text-gray-500">
                              {it.metodo === 'PIX' ? `${it.pix_tipo}: ${it.pix_chave}`
                                : it.metodo === 'TED' ? `Ag ${it.banco_agencia} · C/C ${it.banco_conta}`
                                : <span className="text-amber-600">Cadastre PIX ou conta na ficha</span>}
                            </td>
                            <td className="p-3 text-right">
                              <input type="number" step="0.01" value={it.valor} onChange={e => ajustarValor(it.funcionario_nome, Number(e.target.value))} disabled={it.metodo === 'SEM_DADOS'} className="w-28 p-1.5 border border-gray-300 rounded text-right font-black text-[#0C1D4D] tabular-nums disabled:bg-gray-100" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Histórico de lotes */}
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Histórico de lotes</h3>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              {lotes.length === 0 ? (
                <div className="p-12 text-center text-gray-400 font-bold uppercase tracking-wider">Nenhum lote gerado ainda.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Data</th>
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Competência</th>
                        <th className="p-3 text-left font-black text-[#0C1D4D] uppercase text-[10px]">Parceiro</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Pagtos</th>
                        <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Total</th>
                        <th className="p-3 text-center font-black text-[#0C1D4D] uppercase text-[10px]">Status</th>
                        <th className="p-3 text-right font-black text-[#0C1D4D] uppercase text-[10px]">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lotes.map((l, idx) => (
                        <tr key={l.id} className={`${idx % 2 === 1 ? 'bg-[#F8FAFC]' : 'bg-white'} border-b border-[#E2E8F0]`}>
                          <td className="p-3 text-[11px] text-gray-500">{fmtDataHora(l.criado_em)}</td>
                          <td className="p-3 font-bold">{fmtMesBR(l.mes_referencia)}</td>
                          <td className="p-3 text-[11px] font-black uppercase">{l.parceiro}</td>
                          <td className="p-3 text-center font-black text-[#336699]">{l.qtd_pagamentos}</td>
                          <td className="p-3 text-right font-black text-indigo-700 tabular-nums">{BRL(l.valor_total)}</td>
                          <td className="p-3 text-center">{badgeStatus(l.status)}</td>
                          <td className="p-3 text-right">
                            <button onClick={() => enviarLote(l.id)} className="text-[10px] font-black text-[#0C1D4D] bg-white border border-[#0C1D4D] hover:bg-[#0C1D4D] hover:text-white px-3 py-1.5 rounded-lg uppercase transition-colors">↗ Enviar ao banco</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal de configuração de parceiro */}
      {editParceiro && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditParceiro(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{editParceiro.nome_exibicao}</h2>
            <p className="text-[11px] text-gray-400 font-bold uppercase mb-4">{editParceiro.tipo}</p>

            <div className="space-y-4">
              <label className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-xl cursor-pointer">
                <span className="text-xs font-black text-[#0C1D4D] uppercase">Integração ativa</span>
                <input type="checkbox" checked={edAtivo} onChange={e => setEdAtivo(e.target.checked)} className="w-5 h-5" />
              </label>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Ambiente</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['SANDBOX', 'PRODUCAO'] as const).map(amb => (
                    <button key={amb} onClick={() => setEdAmbiente(amb)} className={`p-2.5 rounded-lg text-[11px] font-black uppercase border-2 ${edAmbiente === amb ? (amb === 'PRODUCAO' ? 'border-red-400 bg-red-50 text-red-600' : 'border-amber-400 bg-amber-50 text-amber-600') : 'border-gray-200 text-gray-400'}`}>
                      {amb === 'SANDBOX' ? '🟡 Sandbox' : '🔴 Produção'}
                    </button>
                  ))}
                </div>
              </div>

              {editParceiro.tipo === 'BANCO' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Agência débito</label>
                    <input type="text" value={edAgencia} onChange={e => setEdAgencia(e.target.value)} placeholder="0000" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Conta débito</label>
                    <input type="text" value={edConta} onChange={e => setEdConta(e.target.value)} placeholder="00000-0" className="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
                  </div>
                </div>
              )}

              <p className="text-[10px] text-gray-400 font-medium bg-gray-50 rounded-lg p-3">
                🔒 Certificado e chaves de API não são inseridos aqui — ficam no servidor. Esta config guarda só dados não sensíveis.
              </p>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditParceiro(null)} className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black uppercase tracking-wider text-xs py-3 rounded-xl">Cancelar</button>
              <button onClick={salvarConfig} className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black uppercase tracking-wider text-xs py-3 rounded-xl">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}