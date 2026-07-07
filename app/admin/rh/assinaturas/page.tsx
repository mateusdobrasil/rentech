"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { 
    listarAssinaturasAction, consultarAssinaturaAction, enviarDocumentoAvulsoAction, listarFuncionariosAtivosAction 
  } from '../actions/actions-assinatura';

interface Assinatura {
  id: number;
  funcionario_nome: string;
  mes_referencia: string;
  cpf: string | null;
  autentique_doc_id: string | null;
  link_assinatura: string | null;
  status: string;
  sandbox: boolean;
  arquivo_assinado: string | null;
  enviado_por: string | null;
  enviado_em: string | null;
  visualizado_em: string | null;
  assinado_em: string | null;
  titulo_avulso?: string | null;
}

const formatarMesAnoBR = (iso: string) => { if (!iso) return ''; const [a, m] = iso.split('-'); return `${m}/${a}`; };
const dataHora = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR') : '—';

const STATUS_INFO: Record<string, { label: string; cor: string; bg: string; icone: string }> = {
  ENVIADO:     { label: 'Enviado',     cor: '#4F46E5', bg: '#EEF2FF', icone: '📤' },
  VISUALIZADO: { label: 'Visualizado', cor: '#2563EB', bg: '#EFF6FF', icone: '👁' },
  ASSINADO:    { label: 'Assinado',    cor: '#16A34A', bg: '#F0FDF4', icone: '✅' },
  REJEITADO:   { label: 'Rejeitado',   cor: '#DC2626', bg: '#FEF2F2', icone: '✖' },
  PENDENTE:    { label: 'Pendente',    cor: '#64748B', bg: '#F8FAFC', icone: '⏳' },
};

export default function AssinaturasPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([]);
  const [atualizando, setAtualizando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<'TODOS' | 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'REJEITADO'>('TODOS');

  // Upload avulso (advertências, avisos, etc.)
  const [mostrarUpload, setMostrarUpload] = useState(false);
  const [funcionarios, setFuncionarios] = useState<{ nome_completo: string; cpf: string | null }[]>([]);
  const [avulsoFunc, setAvulsoFunc] = useState('');
  const [avulsoTitulo, setAvulsoTitulo] = useState('');
  const [avulsoArquivo, setAvulsoArquivo] = useState<File | null>(null);
  const [avulsoSandbox, setAvulsoSandbox] = useState(true);
  const [enviandoAvulso, setEnviandoAvulso] = useState(false);
  const avulsoFileRef = useRef<HTMLInputElement>(null);

  const [mesReferencia, setMesReferencia] = useState(() => {
    // Competência = mês anterior ao corrente (o mês corrente é o de pagamento)
    const h = new Date();
    const comp = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { carregar(mesReferencia); }, [mesReferencia]);

  const carregar = async (mes: string) => {
    setLoading(true);
    try {
      const res = await listarAssinaturasAction({ mesReferencia: mes });
      if (!res.ok) throw new Error(res.erro);
      setAssinaturas(res.info.assinaturas);
    } catch (e: any) {
      alert('Erro ao carregar assinaturas: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // Atualiza o status de uma assinatura consultando a Autentique (fallback do webhook)
  const atualizarStatus = async (a: Assinatura) => {
    setAtualizando(a.funcionario_nome);
    try {
      const res = await consultarAssinaturaAction({ funcionarioNome: a.funcionario_nome, mesReferencia: a.mes_referencia });
      if (!res.ok) throw new Error(res.erro);
      // DEBUG TEMPORÁRIO: mostra o que a Autentique devolveu nos eventos
      if (res.info?.debug) {
        console.log('Autentique eventos:', res.info.debug);
        alert(`Status: ${res.info.status}\n\nEventos retornados pela Autentique:\n${JSON.stringify(res.info.debug, null, 2)}`);
      }
      carregar(mesReferencia);
    } catch (e: any) {
      alert('Erro ao atualizar status: ' + e.message);
    } finally {
      setAtualizando(null);
    }
  };

  // Carrega funcionários quando o painel de upload abre
  const abrirUpload = async () => {
    setMostrarUpload(true);
    if (funcionarios.length === 0) {
      const res = await listarFuncionariosAtivosAction();
      if (res.ok) setFuncionarios(res.info.funcionarios);
    }
  };

  const fileParaBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const enviarAvulso = async () => {
    if (!avulsoFunc) { alert('Selecione o funcionário.'); return; }
    if (!avulsoTitulo.trim()) { alert('Informe o título do documento (ex: Advertência).'); return; }
    if (!avulsoArquivo) { alert('Selecione o arquivo PDF.'); return; }
    if (avulsoArquivo.type !== 'application/pdf') { alert('O arquivo deve ser PDF.'); return; }

    if (!confirm(
      `Enviar "${avulsoTitulo}" para ${avulsoFunc} assinar?\n\n` +
      (avulsoSandbox ? '🧪 MODO TESTE (sandbox): não gasta créditos.' : '⚠ MODO REAL: consome um documento do plano Autentique.')
    )) return;

    setEnviandoAvulso(true);
    try {
      const pdfBase64 = await fileParaBase64(avulsoArquivo);
      const res = await enviarDocumentoAvulsoAction({
        funcionarioNome: avulsoFunc, tituloDocumento: avulsoTitulo, pdfBase64,
        enviadoPor: '', sandbox: avulsoSandbox
      });
      if (!res.ok) throw new Error(res.erro);
      alert(`Documento enviado para assinatura!${res.info?.link ? `\n\nLink: ${res.info.link}` : ''}`);
      setAvulsoFunc(''); setAvulsoTitulo(''); setAvulsoArquivo(null);
      if (avulsoFileRef.current) avulsoFileRef.current.value = '';
      setMostrarUpload(false);
      carregar(mesReferencia);
    } catch (e: any) {
      alert('Erro ao enviar: ' + e.message);
    } finally {
      setEnviandoAvulso(false);
    }
  };

  const filtradas = useMemo(() =>
    filtro === 'TODOS' ? assinaturas : assinaturas.filter(a => a.status === filtro),
    [assinaturas, filtro]);

  const contagem = useMemo(() => {
    const c = { total: assinaturas.length, ENVIADO: 0, VISUALIZADO: 0, ASSINADO: 0, REJEITADO: 0 };
    assinaturas.forEach(a => { if (a.status in c) (c as any)[a.status]++; });
    return c;
  }, [assinaturas]);

  const pctAssinado = contagem.total > 0 ? Math.round((contagem.ASSINADO / contagem.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#0369A1] font-medium text-sm">
          ✍️ <strong>Assinaturas de Holerites</strong>. Acompanhe o status de envio e assinatura via Autentique.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">

        {/* Cabeçalho + seletor de mês */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
          <div>
            <h1 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Assinaturas — {formatarMesAnoBR(mesReferencia)}</h1>
            <p className="text-sm text-[#64748B]">{contagem.total} holerite(s) enviado(s) • {pctAssinado}% assinado(s)</p>
          </div>
          <div className="flex items-center gap-3">
            <input type="month" value={mesReferencia} onChange={e => setMesReferencia(e.target.value)} className="p-2 border border-[#CBD5E1] rounded-lg text-sm font-bold bg-[#F8FAFC]" />
            <button onClick={abrirUpload} className="bg-indigo-600 text-white font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl shadow-md hover:bg-indigo-700 transition-all">
              📎 Enviar Documento
            </button>
            <button onClick={() => router.push('/admin/rh/holerites')} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl shadow-md hover:bg-[#284B8C] transition-all">
              Ir para Holerites
            </button>
          </div>
        </div>

        {/* Painel de upload avulso */}
        {mostrarUpload && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border-2 border-indigo-200 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider">📎 Enviar Documento Avulso para Assinatura</h2>
              <button onClick={() => setMostrarUpload(false)} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg uppercase">Fechar</button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Para advertências, avisos, comunicados — qualquer PDF que o funcionário precise assinar. A validação por CPF e o envio por WhatsApp seguem o mesmo padrão dos holerites.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Funcionário</label>
                <select value={avulsoFunc} onChange={e => setAvulsoFunc(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold bg-white">
                  <option value="">— Selecione —</option>
                  {funcionarios.map(f => (
                    <option key={f.nome_completo} value={f.nome_completo}>{f.nome_completo}{!f.cpf ? ' (sem CPF ⚠)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Título do documento</label>
                <input type="text" value={avulsoTitulo} onChange={e => setAvulsoTitulo(e.target.value)} placeholder="Ex: Advertência - atraso reincidente" className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Arquivo PDF</label>
                <input ref={avulsoFileRef} type="file" accept="application/pdf" onChange={e => setAvulsoArquivo(e.target.files?.[0] || null)} className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#0C1D4D] file:text-white file:font-bold file:text-xs file:uppercase" />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider cursor-pointer bg-gray-50 px-3 py-2.5 rounded-lg border border-gray-200">
                  <input type="checkbox" checked={avulsoSandbox} onChange={e => setAvulsoSandbox(e.target.checked)} />
                  <span className={avulsoSandbox ? 'text-amber-600' : 'text-red-600'}>{avulsoSandbox ? '🧪 Teste' : '⚠ Real'}</span>
                </label>
                <button onClick={enviarAvulso} disabled={enviandoAvulso} className="flex-1 bg-indigo-600 text-white font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl shadow-md hover:bg-indigo-700 transition-all disabled:opacity-50">
                  {enviandoAvulso ? '⏳ Enviando...' : '📤 Enviar para Assinatura'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* KPIs por status */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {[
            { k: 'total', lbl: 'Total Enviados', val: contagem.total, cor: '#0C1D4D' },
            { k: 'ENVIADO', lbl: 'Aguardando', val: contagem.ENVIADO, cor: '#4F46E5' },
            { k: 'VISUALIZADO', lbl: 'Visualizados', val: contagem.VISUALIZADO, cor: '#2563EB' },
            { k: 'ASSINADO', lbl: 'Assinados', val: contagem.ASSINADO, cor: '#16A34A' },
            { k: 'REJEITADO', lbl: 'Rejeitados', val: contagem.REJEITADO, cor: '#DC2626' },
          ].map(c => (
            <div key={c.k} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 text-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{c.lbl}</p>
              <p className="text-2xl font-black" style={{ color: c.cor }}>{c.val}</p>
            </div>
          ))}
        </div>

        {/* Barra de progresso de assinatura */}
        {contagem.total > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">Progresso de Assinaturas</span>
              <span className="text-xs font-black text-[#16A34A]">{pctAssinado}%</span>
            </div>
            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#16A34A] rounded-full transition-all" style={{ width: `${pctAssinado}%` }} />
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm mb-4 flex-wrap">
          {(['TODOS', 'ENVIADO', 'VISUALIZADO', 'ASSINADO', 'REJEITADO'] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f)} className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtro === f ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
              {f === 'TODOS' ? 'Todos' : STATUS_INFO[f].label}
            </button>
          ))}
        </div>

        {/* Tabela */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">Carregando assinaturas...</div>
          ) : filtradas.length === 0 ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
              {assinaturas.length === 0
                ? 'Nenhum holerite enviado para assinatura neste mês. Envie pela tela de Holerites.'
                : 'Nenhuma assinatura com este status.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                  <tr className="text-[9px] uppercase font-black tracking-widest text-[#64748B]">
                    <th className="p-3">Colaborador</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3">Enviado</th>
                    <th className="p-3">Visualizado</th>
                    <th className="p-3">Assinado</th>
                    <th className="p-3 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filtradas.map(a => {
                    const info = STATUS_INFO[a.status] || STATUS_INFO.PENDENTE;
                    return (
                      <tr key={a.id} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-3">
                          <span className="font-black text-[#0C1D4D] block">{a.funcionario_nome}</span>
                          {a.titulo_avulso
                            ? <span className="text-[10px] text-indigo-600 font-black block">📎 {a.titulo_avulso}</span>
                            : <span className="text-[10px] text-gray-400 font-bold block uppercase">Holerite</span>}
                          <span className="text-[10px] text-gray-500 font-medium">
                            CPF {a.cpf || '—'}{a.sandbox && <span className="ml-1 text-amber-600 font-black">🧪 TESTE</span>}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className="text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider" style={{ color: info.cor, background: info.bg }}>
                            {info.icone} {info.label}
                          </span>
                        </td>
                        <td className="p-3 text-[11px] text-gray-600 font-medium">{dataHora(a.enviado_em)}</td>
                        <td className="p-3 text-[11px] text-gray-600 font-medium">{dataHora(a.visualizado_em)}</td>
                        <td className="p-3 text-[11px] text-gray-600 font-medium">{dataHora(a.assinado_em)}</td>
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {a.status !== 'ASSINADO' && a.status !== 'REJEITADO' && (
                              <button onClick={() => atualizarStatus(a)} disabled={atualizando !== null} className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:bg-blue-50 px-2 py-1 rounded disabled:opacity-50 border border-blue-200">
                                {atualizando === a.funcionario_nome ? '⏳' : '↻ Atualizar'}
                              </button>
                            )}
                            {a.link_assinatura && a.status !== 'ASSINADO' && (
                              <a href={a.link_assinatura} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:bg-indigo-50 px-2 py-1 rounded border border-indigo-200">
                                🔗 Link
                              </a>
                            )}
                            {a.arquivo_assinado && (
                              <a href={a.arquivo_assinado} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-green-700 uppercase tracking-wider hover:bg-green-50 px-2 py-1 rounded border border-green-200">
                                ⬇ Assinado
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-[10px] text-gray-400 font-medium mt-4 text-center">
          O status atualiza automaticamente via webhook da Autentique. Use "↻ Atualizar" para forçar uma consulta manual.
        </p>
      </div>
    </div>
  );
}