"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Analytics } from "@vercel/analytics/next";
import
  {
    listarAssinaturasAction, consultarAssinaturaAction, enviarDocumentoAvulsoAction,
    listarFuncionariosAtivosAction, baixarAssinadoAction, atualizarTodasAssinaturasAction
  } from '../actions/actions-assinatura';
import { listarAssinaturasRescisaoAction } from '../actions/actions-rescisao';
import logoColorido from '../../../../app/imgs/logo.png';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';

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
  const toast = useToast();
  const { usuarioAtual, emailUsuario, authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ nomeFallback: 'Equipe RH' });
  const [aba, setAba] = useState<'HOLERITES' | 'RESCISAO'>('HOLERITES');

  const [loading, setLoading] = useState(true);
  const [assinaturas, setAssinaturas] = useState<Assinatura[]>([]);
  const [atualizando, setAtualizando] = useState<string | null>(null);
  const [baixandoAssinado, setBaixandoAssinado] = useState<string | null>(null);
  const [atualizandoTodas, setAtualizandoTodas] = useState(false);
  const [filtro, setFiltro] = useState<'TODOS' | 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'REJEITADO'>('TODOS');

  // ==========================================================================
  // ABA RESCISÃO — mesmo mecanismo de assinatura (folha_holerite_assinaturas),
  // só que sem recorte de mês: cada rescisão tem seu próprio marcador
  // (RESCISAO-{id}), então lista tudo de uma vez e linka de volta pra tela
  // de detalhe da rescisão.
  // ==========================================================================
  const [assinaturasRescisao, setAssinaturasRescisao] = useState<(Assinatura & { rescisaoId: number | null })[]>([]);
  const [loadingRescisao, setLoadingRescisao] = useState(true);
  const [atualizandoRescisao, setAtualizandoRescisao] = useState<string | null>(null);
  const [baixandoRescisao, setBaixandoRescisao] = useState<string | null>(null);
  const [filtroRescisao, setFiltroRescisao] = useState<'TODOS' | 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'REJEITADO'>('TODOS');

  const carregarRescisoes = async () => {
    setLoadingRescisao(true);
    try {
      const res = await listarAssinaturasRescisaoAction(accessToken);
      if (!res.ok) throw new Error(res.erro);
      setAssinaturasRescisao(res.info.assinaturas);
    } catch (e: any) {
      toast('Erro ao carregar assinaturas de rescisão: ' + e.message, 'error');
    } finally {
      setLoadingRescisao(false);
    }
  };

  useEffect(() => { if (accessToken) carregarRescisoes(); }, [accessToken]);

  const atualizarStatusRescisao = async (a: Assinatura) => {
    setAtualizandoRescisao(a.funcionario_nome);
    try {
      const res = await consultarAssinaturaAction({ funcionarioNome: a.funcionario_nome, mesReferencia: a.mes_referencia }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      carregarRescisoes();
    } catch (e: any) {
      toast('Erro ao atualizar status: ' + e.message, 'error');
    } finally {
      setAtualizandoRescisao(null);
    }
  };

  const abrirAssinadoRescisao = async (a: Assinatura) => {
    setBaixandoRescisao(a.funcionario_nome);
    try {
      const res = await baixarAssinadoAction({ funcionarioNome: a.funcionario_nome, mesReferencia: a.mes_referencia }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast('Erro ao abrir o documento assinado: ' + e.message, 'error');
    } finally {
      setBaixandoRescisao(null);
    }
  };

  const filtradasRescisao = useMemo(() =>
    filtroRescisao === 'TODOS' ? assinaturasRescisao : assinaturasRescisao.filter(a => a.status === filtroRescisao),
    [assinaturasRescisao, filtroRescisao]);

  const contagemRescisao = useMemo(() => {
    const c = { total: assinaturasRescisao.length, ENVIADO: 0, VISUALIZADO: 0, ASSINADO: 0, REJEITADO: 0 };
    assinaturasRescisao.forEach(a => { if (a.status in c) (c as any)[a.status]++; });
    return c;
  }, [assinaturasRescisao]);

  // Upload avulso
  const [mostrarUpload, setMostrarUpload] = useState(false);
  const [funcionarios, setFuncionarios] = useState<{ nome_completo: string; cpf: string | null }[]>([]);
  const [avulsoFunc, setAvulsoFunc] = useState('');
  const [avulsoTitulo, setAvulsoTitulo] = useState('');
  const [avulsoArquivo, setAvulsoArquivo] = useState<File | null>(null);
  const [avulsoSandbox, setAvulsoSandbox] = useState(true);
  const [enviandoAvulso, setEnviandoAvulso] = useState(false);
  const avulsoFileRef = useRef<HTMLInputElement>(null);


  const [mesReferencia, setMesReferencia] = useState(() => {
    const h = new Date();
    const comp = new Date(h.getFullYear(), h.getMonth() - 1, 1);
    return `${comp.getFullYear()}-${String(comp.getMonth() + 1).padStart(2, '0')}`;
  });

  useEffect(() => { if (accessToken) carregar(mesReferencia); }, [mesReferencia, accessToken]);

  const carregar = async (mes: string) => {
    setLoading(true);
    try {
      const res = await listarAssinaturasAction({ mesReferencia: mes }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      setAssinaturas(res.info.assinaturas);
    } catch (e: any) {
      toast('Erro ao carregar assinaturas: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const atualizarStatus = async (a: Assinatura) => {
    setAtualizando(a.funcionario_nome);
    try {
      const res = await consultarAssinaturaAction({ funcionarioNome: a.funcionario_nome, mesReferencia: a.mes_referencia }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      carregar(mesReferencia);
    } catch (e: any) {
      toast('Erro ao atualizar status: ' + e.message, 'error');
    } finally {
      setAtualizando(null);
    }
  };

  const atualizarTodas = async () => {
    const pendentes = assinaturas.filter(a => a.status !== 'ASSINADO' && a.status !== 'REJEITADO').length;
    if (pendentes === 0) { toast('Não há assinaturas pendentes para atualizar.', 'info'); return; }

    setAtualizandoTodas(true);
    try {
      const res = await atualizarTodasAssinaturasAction({ mesReferencia }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const mudancasMsg = res.info?.mudancas?.length
        ? `\n\nMudanças:\n${res.info.mudancas.join('\n')}`
        : '\n\nNenhuma mudança de status desde a última consulta.';
      toast(`${res.info?.atualizados || 0} de ${res.info?.total || 0} assinatura(s) consultada(s).${mudancasMsg}`, 'success');
      carregar(mesReferencia);
    } catch (e: any) {
      toast('Erro ao atualizar as assinaturas: ' + e.message, 'error');
    } finally {
      setAtualizandoTodas(false);
    }
  };

  const abrirAssinado = async (a: Assinatura) => {
    setBaixandoAssinado(a.funcionario_nome);
    try {
      const res = await baixarAssinadoAction({ funcionarioNome: a.funcionario_nome, mesReferencia: a.mes_referencia }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast('Erro ao abrir o documento assinado: ' + e.message, 'error');
    } finally {
      setBaixandoAssinado(null);
    }
  };

  const abrirUpload = async () => {
    setMostrarUpload(true);
    if (funcionarios.length === 0) {
      const res = await listarFuncionariosAtivosAction(accessToken);
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
    if (!avulsoFunc) { toast('Selecione o funcionário.', 'error'); return; }
    if (!avulsoTitulo.trim()) { toast('Informe o título do documento (ex: Advertência).', 'error'); return; }
    if (!avulsoArquivo) { toast('Selecione o arquivo PDF.', 'error'); return; }
    if (avulsoArquivo.type !== 'application/pdf') { toast('O arquivo deve ser PDF.', 'error'); return; }

    if (!confirm(
      `Enviar "${avulsoTitulo}" para ${avulsoFunc} assinar?\n\n` +
      (avulsoSandbox ? '🧪 MODO TESTE (sandbox): não gasta créditos.' : '⚠ MODO REAL: consome um documento do plano Autentique.')
    )) return;

    setEnviandoAvulso(true);
    try {
      const pdfBase64 = await fileParaBase64(avulsoArquivo);
      const res = await enviarDocumentoAvulsoAction({
        funcionarioNome: avulsoFunc, tituloDocumento: avulsoTitulo, pdfBase64,
        mesReferencia, enviadoPor: '', sandbox: avulsoSandbox
      }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const anexosMsg = res.info?.anexados?.length ? `\n\nAnexado: resumo + ${res.info.anexados.join(' + ')}` : '';
      toast(`Documento enviado para assinatura!${anexosMsg}${res.info?.link ? `\n\nLink: ${res.info.link}` : ''}`, 'success');
      setAvulsoFunc(''); setAvulsoTitulo(''); setAvulsoArquivo(null);
      if (avulsoFileRef.current) avulsoFileRef.current.value = '';
      setMostrarUpload(false);
      carregar(mesReferencia);
    } catch (e: any) {
      toast('Erro ao enviar: ' + e.message, 'error');
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="w-10 h-10 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin shadow-sm"></div>
      </div>
    );
  }

  if (erro) return <HubErro mensagem={erro} onTentarNovamente={tentarNovamente} />;

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar esta página.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-3 shadow-sm print:hidden">
        <p className="text-[#0369A1] font-medium text-sm">
          ✍️ <strong>Assinaturas de Holerites</strong>. Acompanhe o status de envio e assinatura via Autentique.
        </p>
        <button onClick={() => router.push('/admin/rh')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO RH
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full space-y-6">

        {/* ABAS */}
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm gap-1">
          <button onClick={() => setAba('HOLERITES')} className={`px-5 py-2.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${aba === 'HOLERITES' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:bg-gray-50'}`}>
            💰 Holerites
          </button>
          <button onClick={() => setAba('RESCISAO')} className={`px-5 py-2.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${aba === 'RESCISAO' ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:bg-gray-50'}`}>
            📤 Rescisão {contagemRescisao.total > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[9px]">{contagemRescisao.total}</span>}
          </button>
        </div>

        {aba === 'HOLERITES' && (<>

        {/* Painel Superior de Ações */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider">Assinaturas — {formatarMesAnoBR(mesReferencia)}</h1>
            <p className="text-sm text-[#64748B] font-medium mt-1">{contagem.total} holerite(s) enviado(s) • {pctAssinado}% assinado(s)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <input type="month" value={mesReferencia} onChange={e => setMesReferencia(e.target.value)} className="p-2.5 border border-[#CBD5E1] rounded-xl text-sm font-bold bg-[#F8FAFC] outline-none focus:border-[#336699]" />
            <button onClick={atualizarTodas} disabled={atualizandoTodas} className="flex-grow sm:flex-initial bg-[#336699] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#284B8C] transition-all disabled:opacity-50 text-center">
              {atualizandoTodas ? '⏳ Atualizando...' : '↻ Atualizar Todas'}
            </button>
            <button onClick={abrirUpload} className="flex-grow sm:flex-initial bg-indigo-600 text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-indigo-700 transition-all text-center">
              📎 Enviar Documento
            </button>
            <button onClick={() => router.push('/admin/rh/holerite')} className="flex-grow sm:flex-initial bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#284B8C] transition-all text-center">
              Ir para Holerites
            </button>
          </div>
        </div>

        {/* Componente Modular de Upload Avulso */}
        {mostrarUpload && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border-2 border-indigo-200 transition-all">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-4">
              <h2 className="text-base font-black text-[#0C1D4D] uppercase tracking-wider flex items-center gap-2">📎 Enviar Documento Avulso para Assinatura</h2>
              <button onClick={() => setMostrarUpload(false)} className="text-[10px] font-black bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg uppercase tracking-wider">Fechar</button>
            </div>
            <p className="text-xs text-gray-500 font-medium mb-4">Utilize para advertências, comunicados ou contratos avulsos. A validação por CPF e o envio via canais digitais seguem o mesmo ecossistema integrado dos holerites.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Funcionário</label>
                <select value={avulsoFunc} onChange={e => setAvulsoFunc(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-xl text-sm font-bold bg-white outline-none cursor-pointer">
                  <option value="">— Selecione —</option>
                  {funcionarios.map(f => (
                    <option key={f.nome_completo} value={f.nome_completo}>{f.nome_completo}{!f.cpf ? ' (sem CPF ⚠)' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Título do documento</label>
                <input type="text" value={avulsoTitulo} onChange={e => setAvulsoTitulo(e.target.value)} placeholder="Ex: Advertência por atraso" className="w-full p-2.5 border border-gray-300 rounded-xl text-sm font-medium outline-none focus:border-indigo-500 bg-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Arquivo PDF</label>
                <input ref={avulsoFileRef} type="file" accept="application/pdf" onChange={e => setAvulsoArquivo(e.target.files?.[0] || null)} className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-[#0C1D4D] file:text-white file:font-bold file:text-[10px] file:uppercase cursor-pointer border border-gray-300 rounded-xl p-1 bg-gray-50" />
              </div>
              <div className="flex gap-2 w-full">
                <label className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider cursor-pointer bg-gray-50 px-3 h-[42px] rounded-xl border border-gray-200 select-none min-w-[90px]">
                  <input type="checkbox" checked={avulsoSandbox} onChange={e => setAvulsoSandbox(e.target.checked)} className="accent-amber-600" />
                  <span className={avulsoSandbox ? 'text-amber-600' : 'text-red-600'}>{avulsoSandbox ? '🧪 Teste' : '⚠ Real'}</span>
                </label>
                <button onClick={enviarAvulso} disabled={enviandoAvulso} className="flex-grow bg-indigo-600 text-white font-black uppercase tracking-widest text-xs py-3 rounded-xl shadow-md hover:bg-indigo-700 transition-all disabled:opacity-50 h-[42px]">
                  {enviandoAvulso ? '⏳ ...' : '📤 Enviar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grelha de Indicadores Operacionais */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { k: 'total', lbl: 'Total Enviados', val: contagem.total, cor: '#0C1D4D', bg: 'border-t-[#0C1D4D]' },
            { k: 'ENVIADO', lbl: 'Aguardando', val: contagem.ENVIADO, cor: '#4F46E5', bg: 'border-t-[#4F46E5]' },
            { k: 'VISUALIZADO', lbl: 'Visualizados', val: contagem.VISUALIZADO, cor: '#2563EB', bg: 'border-t-[#2563EB]' },
            { k: 'ASSINADO', lbl: 'Assinados', val: contagem.ASSINADO, cor: '#16A34A', bg: 'border-t-[#16A34A]' },
            { k: 'REJEITADO', lbl: 'Rejeitados', val: contagem.REJEITADO, cor: '#DC2626', bg: 'border-t-[#DC2626]' },
          ].map(c => (
            <div key={c.k} className={`bg-white rounded-2xl shadow-sm border border-[#E2E8F0] border-t-4 ${c.bg} p-4 text-center`}>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{c.lbl}</p>
              <p className="text-3xl font-black" style={{ color: c.cor }}>{c.val}</p>
            </div>
          ))}
        </div>

        {/* Progresso de Assinatura */}
        {contagem.total > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">Progresso de Assinaturas</span>
              <span className="text-xs font-black text-[#16A34A] bg-[#F0FDF4] px-2 py-0.5 rounded-md">{pctAssinado}% concluído</span>
            </div>
            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden shadow-inner">
              <div className="h-full bg-[#16A34A] rounded-full transition-all duration-500 ease-out" style={{ width: `${pctAssinado}%` }} />
            </div>
          </div>
        )}

        {/* Barra de Seleção de Filtros */}
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm gap-1 flex-wrap">
          {(['TODOS', 'ENVIADO', 'VISUALIZADO', 'ASSINADO', 'REJEITADO'] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f)} className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtro === f ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D] hover:bg-gray-50'}`}>
              {f === 'TODOS' ? 'Todos' : STATUS_INFO[f].label}
            </button>
          ))}
        </div>

        {/* Tabela de Dados Concretos */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#0C1D4D] border-t-transparent rounded-full animate-spin"></div>
              Buscando registros técnicos...
            </div>
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
                  <tr className="text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                    <th className="p-4">Colaborador / Tipo</th>
                    <th className="p-4 text-center w-36">Status</th>
                    <th className="p-4">Enviado em</th>
                    <th className="p-4">Visualizado em</th>
                    <th className="p-4">Assinado em</th>
                    <th className="p-4 text-center w-40">Ações Mecânicas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] font-medium">
                  {filtradas.map(a => {
                    const info = STATUS_INFO[a.status] || STATUS_INFO.PENDENTE;
                    return (
                      <tr key={a.id} className="hover:bg-[#F8FAFC] transition-colors">
                        <td className="p-4">
                          <span className="font-black text-[#0C1D4D] text-sm block">{a.funcionario_nome}</span>
                          {a.titulo_avulso
                            ? <span className="text-[10px] text-indigo-600 font-black block mt-0.5">📎 {a.titulo_avulso}</span>
                            : <span className="text-[10px] text-gray-400 font-bold block uppercase mt-0.5">Holerite Consolidado</span>}
                          <span className="text-[10px] text-gray-500 font-medium block mt-0.5">
                            CPF {a.cpf || '—'}{a.sandbox && <span className="ml-1.5 text-amber-600 font-black bg-amber-50 px-1.5 py-0.5 rounded text-[8px]">AMB. TESTE</span>}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <span className="text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider inline-flex items-center gap-1" style={{ color: info.cor, background: info.bg }}>
                            {info.icone} {info.label}
                          </span>
                        </td>
                        <td className="p-4 text-[11px] text-gray-600">{dataHora(a.enviado_em)}</td>
                        <td className="p-4 text-[11px] text-gray-600">{dataHora(a.visualizado_em)}</td>
                        <td className="p-4 text-[11px] text-gray-600">{dataHora(a.assinado_em)}</td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {a.status !== 'ASSINADO' && a.status !== 'REJEITADO' && (
                              <button onClick={() => atualizarStatus(a)} disabled={atualizando !== null} className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:bg-blue-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50 border border-blue-200 bg-white transition-colors">
                                {atualizando === a.funcionario_nome ? '...' : '↻ Consultar'}
                              </button>
                            )}
                            {a.link_assinatura && a.status !== 'ASSINADO' && (
                              <a href={a.link_assinatura} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white transition-colors inline-block">
                                🔗 Link
                              </a>
                            )}
                            {a.status === 'ASSINADO' && (
                              <button onClick={() => abrirAssinado(a)} disabled={baixandoAssinado !== null} className="text-[10px] font-black text-green-700 uppercase tracking-wider hover:bg-green-50 px-2.5 py-1.5 rounded-lg border border-green-200 disabled:opacity-50 bg-white transition-colors">
                                {baixandoAssinado === a.funcionario_nome ? '...' : '⬇ Obter PDF'}
                              </button>
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

        <p className="text-[10px] text-gray-400 font-bold tracking-wide mt-2 text-center uppercase">
          A atualização sincroniza nativamente através dos webhooks da infraestrutura da Autentique. Use "↻ Consultar" se precisar forçar uma varredura manual.
        </p>
        </>)}

        {/* ============================================================================ */}
        {/* ABA: RESCISÃO — mesmo mecanismo, sem recorte de mês */}
        {/* ============================================================================ */}
        {aba === 'RESCISAO' && (<>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <h1 className="text-xl font-black text-[#0C1D4D] uppercase tracking-wider">Assinaturas de Rescisão</h1>
              <p className="text-sm text-[#64748B] font-medium mt-1">{contagemRescisao.total} TRCT(s) enviado(s) para assinatura</p>
            </div>
            <button onClick={() => router.push('/admin/rh/rescisao')} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-5 py-3.5 rounded-xl shadow-sm hover:bg-[#284B8C] transition-all text-center">
              Ir para Rescisões
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { k: 'total', lbl: 'Total Enviados', val: contagemRescisao.total, cor: '#0C1D4D', bg: 'border-t-[#0C1D4D]' },
              { k: 'ENVIADO', lbl: 'Aguardando', val: contagemRescisao.ENVIADO, cor: '#4F46E5', bg: 'border-t-[#4F46E5]' },
              { k: 'VISUALIZADO', lbl: 'Visualizados', val: contagemRescisao.VISUALIZADO, cor: '#2563EB', bg: 'border-t-[#2563EB]' },
              { k: 'ASSINADO', lbl: 'Assinados', val: contagemRescisao.ASSINADO, cor: '#16A34A', bg: 'border-t-[#16A34A]' },
              { k: 'REJEITADO', lbl: 'Rejeitados', val: contagemRescisao.REJEITADO, cor: '#DC2626', bg: 'border-t-[#DC2626]' },
            ].map(c => (
              <div key={c.k} className={`bg-white rounded-2xl shadow-sm border border-[#E2E8F0] border-t-4 ${c.bg} p-4 text-center`}>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{c.lbl}</p>
                <p className="text-3xl font-black" style={{ color: c.cor }}>{c.val}</p>
              </div>
            ))}
          </div>

          <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm gap-1 flex-wrap">
            {(['TODOS', 'ENVIADO', 'VISUALIZADO', 'ASSINADO', 'REJEITADO'] as const).map(f => (
              <button key={f} onClick={() => setFiltroRescisao(f)} className={`px-4 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${filtroRescisao === f ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D] hover:bg-gray-50'}`}>
                {f === 'TODOS' ? 'Todos' : STATUS_INFO[f].label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            {loadingRescisao ? (
              <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider flex flex-col items-center justify-center gap-3">
                <div className="w-8 h-8 border-4 border-[#0C1D4D] border-t-transparent rounded-full animate-spin"></div>
                Buscando registros técnicos...
              </div>
            ) : filtradasRescisao.length === 0 ? (
              <div className="p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
                {assinaturasRescisao.length === 0
                  ? 'Nenhum TRCT enviado para assinatura ainda. Envie pela tela de Rescisão (depois de homologada).'
                  : 'Nenhuma assinatura com este status.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-[#F8FAFC] border-b-2 border-[#E2E8F0]">
                    <tr className="text-[10px] uppercase font-black tracking-widest text-[#64748B]">
                      <th className="p-4">Colaborador</th>
                      <th className="p-4 text-center w-36">Status</th>
                      <th className="p-4">Enviado em</th>
                      <th className="p-4">Visualizado em</th>
                      <th className="p-4">Assinado em</th>
                      <th className="p-4 text-center w-56">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0] font-medium">
                    {filtradasRescisao.map(a => {
                      const info = STATUS_INFO[a.status] || STATUS_INFO.PENDENTE;
                      return (
                        <tr key={a.id} className="hover:bg-[#F8FAFC] transition-colors">
                          <td className="p-4">
                            <span className="font-black text-[#0C1D4D] text-sm block">{a.funcionario_nome}</span>
                            <span className="text-[10px] text-gray-400 font-bold block uppercase mt-0.5">TRCT — Rescisão</span>
                            <span className="text-[10px] text-gray-500 font-medium block mt-0.5">
                              CPF {a.cpf || '—'}{a.sandbox && <span className="ml-1.5 text-amber-600 font-black bg-amber-50 px-1.5 py-0.5 rounded text-[8px]">AMB. TESTE</span>}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <span className="text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider inline-flex items-center gap-1" style={{ color: info.cor, background: info.bg }}>
                              {info.icone} {info.label}
                            </span>
                          </td>
                          <td className="p-4 text-[11px] text-gray-600">{dataHora(a.enviado_em)}</td>
                          <td className="p-4 text-[11px] text-gray-600">{dataHora(a.visualizado_em)}</td>
                          <td className="p-4 text-[11px] text-gray-600">{dataHora(a.assinado_em)}</td>
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              {a.rescisaoId && (
                                <button onClick={() => router.push(`/admin/rh/rescisao/${a.rescisaoId}`)} className="text-[10px] font-black text-gray-600 uppercase tracking-wider hover:bg-gray-100 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white transition-colors">
                                  ↗ Rescisão
                                </button>
                              )}
                              {a.status !== 'ASSINADO' && a.status !== 'REJEITADO' && (
                                <button onClick={() => atualizarStatusRescisao(a)} disabled={atualizandoRescisao !== null} className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:bg-blue-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50 border border-blue-200 bg-white transition-colors">
                                  {atualizandoRescisao === a.funcionario_nome ? '...' : '↻ Consultar'}
                                </button>
                              )}
                              {a.link_assinatura && a.status !== 'ASSINADO' && (
                                <a href={a.link_assinatura} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black text-indigo-600 uppercase tracking-wider hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white transition-colors inline-block">
                                  🔗 Link
                                </a>
                              )}
                              {a.status === 'ASSINADO' && (
                                <button onClick={() => abrirAssinadoRescisao(a)} disabled={baixandoRescisao !== null} className="text-[10px] font-black text-green-700 uppercase tracking-wider hover:bg-green-50 px-2.5 py-1.5 rounded-lg border border-green-200 disabled:opacity-50 bg-white transition-colors">
                                  {baixandoRescisao === a.funcionario_nome ? '...' : '⬇ Obter PDF'}
                                </button>
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
        </>)}
      </div>
    </div>
  );
}