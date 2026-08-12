"use client";

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import { supabase } from '../../../../lib/supabase';
import {
  obterRescisaoAction, atualizarItemCalculoAction, recalcularRescisaoAction, atualizarFgtsAction,
  uploadTrctRescisaoAction, urlTrctRescisaoAction, homologarRescisaoAction, cancelarRescisaoAction,
  enviarRescisaoParaAssinaturaAction, obterAssinaturaRescisaoAction, atualizarAssinaturaRescisaoAction,
  baixarAssinadoRescisaoAction, gerarPdfRescisaoAction
} from '../../actions/actions-rescisao';
import type { ItemRescisao, MotivoRescisao } from '../../../../lib/calculoRescisao';

// Rota fixa usada para checar permissão — a permissão é registrada para o
// módulo (/admin/rh/rescisao), não para cada id individual do segmento
// dinâmico (que seria algo como /admin/rh/rescisao/42).
const ROTA_PERMISSAO = '/admin/rh/rescisao';

const normalizarPermissao = (permissaoBruta: string): string => {
  const p = (permissaoBruta || '').toUpperCase().trim();
  if (p.includes('ADMINISTRATIVO') || p === 'ADM') return 'ADMINISTRATIVO';
  if (p.includes('ADMIN') || p.includes('DIR') || p.includes('GEREN')) return 'ADMINISTRADOR';
  if (p.includes('FINAN')) return 'FINANCEIRO';
  if (p.includes('OPER')) return 'OPERACIONAL';
  if (p.includes('ESTOQ')) return 'ESTOQUE';
  if (p.includes('EDIT')) return 'EDITOR';
  if (p.includes('GESTOR')) return 'GESTORES';
  return 'USUARIO';
};

const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtMoeda = (v: number | null | undefined) => (v == null ? 'R$ 0,00' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

// ============================================================================
// INPUT COM MÁSCARA DE MOEDA (R$) — mesmo componente usado em holerite/page.tsx
// ============================================================================
function InputMoeda({ value, onChange, className, disabled }: {
  value: number; onChange: (v: number) => void; className?: string; disabled?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitos = e.target.value.replace(/\D/g, '');
    const centavos = digitos ? parseInt(digitos, 10) : 0;
    onChange(centavos / 100);
  };
  return (
    <input type="text" inputMode="numeric" value={fmtMoeda(value)} onChange={handleChange} disabled={disabled} className={className} />
  );
}

const ASSINATURA_STATUS_INFO: Record<string, { label: string; cor: string }> = {
  ENVIADO: { label: 'Enviado — aguardando', cor: 'bg-amber-100 text-amber-700' },
  VISUALIZADO: { label: 'Visualizado pelo funcionário', cor: 'bg-indigo-100 text-indigo-700' },
  ASSINADO: { label: 'Assinado', cor: 'bg-emerald-100 text-emerald-700' },
  REJEITADO: { label: 'Rejeitado', cor: 'bg-red-100 text-red-700' }
};

const MOTIVO_LABEL: Record<string, string> = {
  SEM_JUSTA_CAUSA: 'Sem justa causa (dispensa)', PEDIDO_DEMISSAO: 'Pedido de demissão', JUSTA_CAUSA: 'Justa causa',
  ACORDO_MUTUO: 'Acordo mútuo (CLT 484-A)', TERMINO_CONTRATO_EXPERIENCIA: 'Término de contrato de experiência',
  APOSENTADORIA: 'Aposentadoria'
};
const AVISO_LABEL: Record<string, string> = { INDENIZADO: 'Indenizado', TRABALHADO: 'Trabalhado', ISENTO: 'Não se aplica' };

const STATUS_INFO: Record<string, { label: string; cor: string }> = {
  RASCUNHO: { label: 'Rascunho', cor: 'bg-gray-100 text-gray-500' },
  EM_CALCULO: { label: 'Em cálculo', cor: 'bg-indigo-100 text-indigo-700' },
  AGUARDANDO_DOCUMENTO: { label: 'Aguardando documento', cor: 'bg-amber-100 text-amber-700' },
  AGUARDANDO_HOMOLOGACAO: { label: 'Aguardando homologação', cor: 'bg-amber-100 text-amber-700' },
  HOMOLOGADA: { label: 'Homologada', cor: 'bg-emerald-100 text-emerald-700' },
  CANCELADA: { label: 'Cancelada', cor: 'bg-gray-100 text-gray-400' }
};

const TIPO_LABEL: Record<ItemRescisao['tipo'], { label: string; cor: string }> = {
  PROVENTO: { label: 'Proventos', cor: 'text-emerald-700' },
  DESCONTO: { label: 'Descontos', cor: 'text-red-700' },
  INFORMATIVO: { label: 'Informativo', cor: 'text-gray-500' }
};

interface DadosCalculo {
  itens: ItemRescisao[]; totalProventos: number; totalDescontos: number; valorLiquido: number;
  diasAvisoPrevio: number; dataProjecaoAvisoPrevio: string | null; calculadoEm: string;
}

interface RescisaoRow {
  id: number; funcionario_nome: string; cargo: string | null; departamento: string | null;
  data_admissao: string | null; data_desligamento: string; motivo: MotivoRescisao; tipo_aviso_previo: string | null;
  dias_aviso_previo: number | null; tipo_folha: 'PROPRIO' | 'CONTABILIDADE'; status: string;
  saldo_fgts_informado: number | null; fgts_percentual_multa: number | null; fgts_valor_multa: number | null;
  dados_calculo: DadosCalculo | null; valor_total_liquido: number | null;
  storage_path: string | null; nome_arquivo: string | null;
  homologado_em: string | null; homologado_por: string | null;
}

export default function DetalheRescisaoPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [usuarioAtual, setUsuarioAtual] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: perfil, error: perfilError } = await supabase.from('perfis_usuarios').select('*').eq('id', session.user.id).single();
      if (perfilError || !perfil) { router.push('/login'); return; }

      const { data: rotaPermissao, error: rotaError } = await supabase
        .from('folha_paginas_permissoes').select('permissoes_permitidas').eq('endereco_route', ROTA_PERMISSAO).single();
      if (rotaError && rotaError.code !== 'PGRST116') console.error('Erro ao buscar permissão da rota:', rotaError);

      const permissaoNormalizada = normalizarPermissao(perfil.permissao || perfil.nivel || '');
      const permissoesLiberadas = rotaPermissao?.permissoes_permitidas || [];
      if (!permissoesLiberadas.includes(permissaoNormalizada)) { setAcessoNegado(true); setAuthLoading(false); return; }

      setUsuarioAtual(perfil.nome || 'Equipe RH');
      setAuthLoading(false);
    }
    checkAuth();
  }, [router]);

  const [loading, setLoading] = useState(true);
  const [rescisao, setRescisao] = useState<RescisaoRow | null>(null);
  const [itens, setItens] = useState<ItemRescisao[]>([]);
  const [saldoFgts, setSaldoFgts] = useState(0);
  const [percentualFgts, setPercentualFgts] = useState('0');

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await obterRescisaoAction({ id });
      if (!res.ok) { alert('Erro ao carregar rescisão: ' + res.erro); return; }
      const r: RescisaoRow = res.info.rescisao;
      setRescisao(r);
      setItens(r.dados_calculo?.itens || []);
      setSaldoFgts(Number(r.saldo_fgts_informado ?? 0));
      setPercentualFgts(String(r.fgts_percentual_multa ?? 0));
    } catch (e: any) { alert('Erro ao carregar rescisão: ' + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!authLoading && !acessoNegado && id) carregar(); }, [authLoading, acessoNegado, id]);

  const totaisLocais = useMemo(() => {
    const totalProventos = Math.round(itens.filter(i => i.tipo === 'PROVENTO').reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
    const totalDescontos = Math.round(itens.filter(i => i.tipo === 'DESCONTO').reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
    return { totalProventos, totalDescontos, valorLiquido: Math.round((totalProventos - totalDescontos) * 100) / 100 };
  }, [itens]);

  const valorMultaFgts = useMemo(() => {
    const pct = Number(percentualFgts) || 0;
    return Math.round(saldoFgts * (pct / 100) * 100) / 100;
  }, [saldoFgts, percentualFgts]);

  const editarValorItem = (codigo: string, novoValor: number) => {
    setItens(prev => prev.map(i => i.codigo === codigo ? { ...i, valor: novoValor } : i));
  };

  // "Outros descontos" não vem de nenhuma fórmula — o RH descreve do que se
  // trata (ex.: uniforme não devolvido, dano a equipamento).
  const editarDescricaoItem = (codigo: string, novaDescricao: string) => {
    setItens(prev => prev.map(i => i.codigo === codigo ? { ...i, descricao: novaDescricao || 'Outros descontos' } : i));
  };

  const [salvandoItens, setSalvandoItens] = useState(false);
  const salvarItens = async () => {
    setSalvandoItens(true);
    try {
      const res = await atualizarItemCalculoAction({ id, itens });
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { alert('Erro ao salvar alterações: ' + e.message); }
    finally { setSalvandoItens(false); }
  };

  const [recalculando, setRecalculando] = useState(false);
  const recalcular = async () => {
    if (!confirm('Recalcular vai sobrescrever qualquer edição manual feita nas linhas do cálculo e atualizar a estimativa do saldo do FGTS (mantendo o percentual da multa já salvo). Continuar?')) return;
    setRecalculando(true);
    try {
      const res = await recalcularRescisaoAction({ id });
      if (!res.ok) throw new Error(res.erro);
      // Atualiza os itens/totais do cálculo e o saldo estimado do FGTS — não
      // usa carregar() aqui pra não sobrescrever o percentual da multa caso
      // o usuário tenha uma edição própria ainda não salva nesse campo.
      setItens(res.info.dadosCalculo.itens);
      setRescisao(prev => prev ? { ...prev, dados_calculo: res.info.dadosCalculo, valor_total_liquido: res.info.dadosCalculo.valorLiquido } : prev);
      setSaldoFgts(res.info.saldoFgtsInformado);
    } catch (e: any) { alert('Erro ao recalcular: ' + e.message); }
    finally { setRecalculando(false); }
  };

  const [salvandoFgts, setSalvandoFgts] = useState(false);
  const salvarFgts = async () => {
    setSalvandoFgts(true);
    try {
      const res = await atualizarFgtsAction({ id, saldoFgtsInformado: saldoFgts, percentualOverride: Number(percentualFgts) || 0 });
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { alert('Erro ao salvar FGTS: ' + e.message); }
    finally { setSalvandoFgts(false); }
  };

  const arquivoRef = useRef<HTMLInputElement>(null);
  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const fileParaBase64 = (file: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res((r.result as string).split(',')[1]);
    r.onerror = rej; r.readAsDataURL(file);
  });
  const enviarArquivo = async (file: File) => {
    setEnviandoArquivo(true);
    try {
      const arquivoBase64 = await fileParaBase64(file);
      const res = await uploadTrctRescisaoAction({ id, arquivoBase64, nomeArquivo: file.name, tipoMime: file.type });
      if (!res.ok) throw new Error(res.erro);
      if (arquivoRef.current) arquivoRef.current.value = '';
      await carregar();
    } catch (e: any) { alert('Erro ao enviar arquivo: ' + e.message); }
    finally { setEnviandoArquivo(false); }
  };

  const abrirAnexo = async () => {
    try {
      const res = await urlTrctRescisaoAction({ id });
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { alert('Erro ao abrir anexo: ' + e.message); }
  };

  // Gera o termo de rescisão em PDF a partir do que foi calculado (mesmo
  // padrão da prévia de holerite: base64 → Blob → abre numa aba nova).
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const visualizarTermoCalculado = async () => {
    setGerandoPdf(true);
    try {
      const res = await gerarPdfRescisaoAction({ id });
      if (!res.ok) throw new Error(res.erro);
      const bin = atob(res.info.pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) { alert('Erro ao gerar o termo: ' + e.message); }
    finally { setGerandoPdf(false); }
  };

  const [homologando, setHomologando] = useState(false);
  const homologar = async () => {
    if (!confirm('Homologar esta rescisão vai marcar o funcionário como inativo, gravar a data de desligamento na ficha e lançar a movimentação de demissão. Esta ação não é facilmente reversível. Continuar?')) return;
    setHomologando(true);
    try {
      const res = await homologarRescisaoAction({ id, usuarioNome: usuarioAtual });
      if (!res.ok) throw new Error(res.erro);
      await carregar();
    } catch (e: any) { alert('Erro ao homologar: ' + e.message); }
    finally { setHomologando(false); }
  };

  const [cancelando, setCancelando] = useState(false);
  const cancelar = async () => {
    if (!confirm('Cancelar esta rescisão?')) return;
    setCancelando(true);
    try {
      const res = await cancelarRescisaoAction({ id });
      if (!res.ok) throw new Error(res.erro);
      if (res.info?.avisoManual) alert('Rescisão cancelada. Como já estava homologada, ajuste manualmente a ficha do funcionário (ativo/data de desligamento) se necessário.');
      await carregar();
    } catch (e: any) { alert('Erro ao cancelar: ' + e.message); }
    finally { setCancelando(false); }
  };

  // ==========================================================================
  // ASSINATURA (Autentique) — só depois de homologada.
  // ==========================================================================
  interface AssinaturaInfo { status: string; link_assinatura: string | null; sandbox: boolean; enviado_em: string | null; assinado_em: string | null; }
  const [assinatura, setAssinatura] = useState<AssinaturaInfo | null>(null);
  const [sandboxAssinatura, setSandboxAssinatura] = useState(true);
  const [enviandoAssinatura, setEnviandoAssinatura] = useState(false);
  const [atualizandoAssinatura, setAtualizandoAssinatura] = useState(false);
  const [baixandoAssinado, setBaixandoAssinado] = useState(false);

  const carregarAssinatura = async () => {
    const res = await obterAssinaturaRescisaoAction({ id });
    if (res.ok) setAssinatura(res.info.assinatura);
  };

  useEffect(() => { if (rescisao?.status === 'HOMOLOGADA') carregarAssinatura(); }, [rescisao?.status]);

  const enviarParaAssinatura = async () => {
    if (!confirm(
      'Enviar o TRCT para assinatura do funcionário via Autentique?\n\n' +
      (sandboxAssinatura ? '🧪 MODO TESTE (sandbox): não gasta créditos.' : '⚠ MODO REAL: consome um documento do plano Autentique.')
    )) return;
    setEnviandoAssinatura(true);
    try {
      const res = await enviarRescisaoParaAssinaturaAction({ id, usuarioNome: usuarioAtual, sandbox: sandboxAssinatura });
      if (!res.ok) throw new Error(res.erro);
      await carregarAssinatura();
    } catch (e: any) { alert('Erro ao enviar para assinatura: ' + e.message); }
    finally { setEnviandoAssinatura(false); }
  };

  const atualizarStatusAssinatura = async () => {
    setAtualizandoAssinatura(true);
    try {
      const res = await atualizarAssinaturaRescisaoAction({ id });
      if (!res.ok) throw new Error(res.erro);
      await carregarAssinatura();
    } catch (e: any) { alert('Erro ao atualizar status: ' + e.message); }
    finally { setAtualizandoAssinatura(false); }
  };

  const baixarAssinado = async () => {
    setBaixandoAssinado(true);
    try {
      const res = await baixarAssinadoRescisaoAction({ id });
      if (!res.ok) throw new Error(res.erro);
      window.open(res.info.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) { alert('Erro ao baixar assinado: ' + e.message); }
    finally { setBaixandoAssinado(false); }
  };

  if (authLoading || (loading && !rescisao)) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Carregando...</h2>
        </div>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-red-200">
          <div className="text-5xl mb-4">⛔</div>
          <h2 className="text-xl font-black text-red-600 uppercase tracking-wider mb-2">Acesso Restrito</h2>
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar a Rescisão de Funcionário.</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  if (!rescisao) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full">
          <p className="text-sm text-gray-500 mb-6">Rescisão não encontrada.</p>
          <button onClick={() => router.push('/admin/rh/rescisao')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider">Voltar</button>
        </div>
      </div>
    );
  }

  const ehFinal = rescisao.status === 'HOMOLOGADA' || rescisao.status === 'CANCELADA';
  const podeHomologar = !ehFinal && (rescisao.tipo_folha === 'PROPRIO' ? !!rescisao.dados_calculo : !!rescisao.storage_path);
  // Sem vínculo com a contabilidade (folha própria) o termo é gerado na hora
  // a partir do cálculo — não depende de anexo pra poder enviar.
  const podeEnviarAssinatura = !!rescisao.storage_path || (rescisao.tipo_folha === 'PROPRIO' && !!rescisao.dados_calculo);

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-red-50 border-b border-red-200 px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-red-700 font-medium text-sm">📤 <strong>Rescisão de Funcionário</strong></p>
        <button onClick={() => router.push('/admin/rh/rescisao')} className="text-[10px] md:text-xs font-black bg-white hover:bg-red-100 border border-red-200 text-red-700 px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1000px] mx-auto w-full space-y-4">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div>
              <h1 className="text-xl font-black text-[#0C1D4D]">{rescisao.funcionario_nome}</h1>
              <p className="text-[11px] text-gray-500 font-bold uppercase mt-1">{rescisao.cargo || '—'} · {rescisao.departamento || '—'}</p>
            </div>
            <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase ${STATUS_INFO[rescisao.status]?.cor}`}>
              {STATUS_INFO[rescisao.status]?.label || rescisao.status}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Admissão</p>
              <p className="text-sm font-bold text-gray-700">{fmtData(rescisao.data_admissao)}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Desligamento</p>
              <p className="text-sm font-bold text-gray-700">{fmtData(rescisao.data_desligamento)}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Motivo</p>
              <p className="text-sm font-bold text-gray-700">{MOTIVO_LABEL[rescisao.motivo] || rescisao.motivo}</p>
            </div>
            <div>
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Aviso prévio</p>
              <p className="text-sm font-bold text-gray-700">{AVISO_LABEL[rescisao.tipo_aviso_previo || ''] || '—'} {rescisao.dias_aviso_previo ? `(${rescisao.dias_aviso_previo}d)` : ''}</p>
            </div>
          </div>
          {rescisao.status === 'HOMOLOGADA' && (
            <p className="text-[10px] text-emerald-700 font-bold mt-3">✓ Homologada em {rescisao.homologado_em ? new Date(rescisao.homologado_em).toLocaleString('pt-BR') : '—'} por {rescisao.homologado_por || '—'}.</p>
          )}
        </div>

        {/* Ações pós-homologação: visualizar TRCT e enviar para assinatura (Autentique) */}
        {rescisao.status === 'HOMOLOGADA' && (
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
            <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">Ações</h3>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={rescisao.storage_path ? abrirAnexo : visualizarTermoCalculado}
                disabled={!rescisao.storage_path && (rescisao.tipo_folha !== 'PROPRIO' || gerandoPdf)}
                className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2.5 rounded-lg uppercase disabled:opacity-50"
              >
                {rescisao.storage_path ? '👁 Visualizar TRCT anexado' : gerandoPdf ? 'Gerando...' : '👁 Visualizar Termo Calculado'}
              </button>

              {!assinatura ? (
                <>
                  <label className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-wider cursor-pointer bg-gray-50 px-3 h-[38px] rounded-lg border border-gray-200 select-none">
                    <input type="checkbox" checked={sandboxAssinatura} onChange={e => setSandboxAssinatura(e.target.checked)} className="accent-amber-600" />
                    <span className={sandboxAssinatura ? 'text-amber-600' : 'text-red-600'}>{sandboxAssinatura ? '🧪 Teste' : '⚠ Real'}</span>
                  </label>
                  <button
                    onClick={enviarParaAssinatura} disabled={enviandoAssinatura || !podeEnviarAssinatura}
                    className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 rounded-lg uppercase disabled:opacity-50"
                  >
                    {enviandoAssinatura ? 'Enviando...' : '📤 Enviar para assinatura'}
                  </button>
                  {!podeEnviarAssinatura && <span className="text-[10px] text-gray-400 font-bold uppercase">Anexe o TRCT antes de enviar.</span>}
                </>
              ) : (
                <>
                  <span className={`text-[9px] font-black px-3 py-1.5 rounded-full uppercase ${ASSINATURA_STATUS_INFO[assinatura.status]?.cor || 'bg-gray-100 text-gray-500'}`}>
                    {ASSINATURA_STATUS_INFO[assinatura.status]?.label || assinatura.status}
                    {assinatura.sandbox && ' · teste'}
                  </span>
                  <button onClick={atualizarStatusAssinatura} disabled={atualizandoAssinatura} className="text-[10px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                    {atualizandoAssinatura ? 'Atualizando...' : '↻ Atualizar status'}
                  </button>
                  {assinatura.status !== 'ASSINADO' && assinatura.link_assinatura && (
                    <button onClick={() => window.open(assinatura.link_assinatura!, '_blank', 'noopener,noreferrer')} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-3 py-1.5 rounded-lg uppercase">
                      🔗 Link de assinatura
                    </button>
                  )}
                  {assinatura.status === 'ASSINADO' && (
                    <button onClick={baixarAssinado} disabled={baixandoAssinado} className="text-[10px] font-black text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                      {baixandoAssinado ? 'Baixando...' : '⬇ Baixar assinado'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {rescisao.tipo_folha === 'CONTABILIDADE' ? (
          <>
            {/* CASO CONTABILIDADE */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <p className="text-sm font-bold text-gray-600">📎 Folha administrada pela contabilidade — nenhum valor é calculado aqui. Anexe o TRCT enviado pela contabilidade para poder homologar.</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">TRCT</h3>
              {rescisao.storage_path ? (
                <div className="flex items-center gap-3">
                  <button onClick={abrirAnexo} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg uppercase">📎 Ver anexo</button>
                  <span className="text-xs text-gray-500">{rescisao.nome_arquivo}</span>
                </div>
              ) : (
                <p className="text-xs text-gray-400 font-bold uppercase mb-2">Nenhum anexo enviado ainda.</p>
              )}
              {!ehFinal && (
                <div className="mt-3">
                  <input ref={arquivoRef} type="file" accept="application/pdf,image/*" disabled={enviandoArquivo}
                    onChange={e => { const f = e.target.files?.[0]; if (f) enviarArquivo(f); }} className="text-xs" />
                  {enviandoArquivo && <p className="text-[10px] text-gray-400 mt-1">Enviando...</p>}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* CASO PRÓPRIO */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="text-xs font-bold text-amber-800">⚠️ Valores calculados automaticamente com base em regras gerais da CLT. Confira e ajuste com a contabilidade antes de homologar — não é fonte legal autoritativa.</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              <div className="flex justify-between items-center p-4 border-b border-[#E2E8F0]">
                <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">Cálculo da rescisão</h3>
                <div className="flex gap-2">
                  <button onClick={visualizarTermoCalculado} disabled={gerandoPdf} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                    {gerandoPdf ? 'Gerando...' : '👁 Visualizar Termo Calculado'}
                  </button>
                  {!ehFinal && (
                    <button onClick={recalcular} disabled={recalculando} className="text-[10px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg uppercase disabled:opacity-50">
                      {recalculando ? 'Recalculando...' : '↻ Recalcular automaticamente'}
                    </button>
                  )}
                </div>
              </div>

              {(['PROVENTO', 'DESCONTO', 'INFORMATIVO'] as const).map(tipo => {
                const linhas = itens.filter(i => i.tipo === tipo);
                if (linhas.length === 0) return null;
                return (
                  <div key={tipo} className="border-b border-[#E2E8F0] last:border-b-0">
                    <p className={`text-[10px] font-black uppercase tracking-widest px-4 pt-3 pb-1 ${TIPO_LABEL[tipo].cor}`}>{TIPO_LABEL[tipo].label}</p>
                    {linhas.map(item => (
                      <div key={item.codigo} className="flex items-center gap-3 px-4 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-700 truncate">{item.codigo === 'OUTROS_DESCONTOS' ? 'Outros descontos' : item.descricao}</p>
                          {item.codigo === 'OUTROS_DESCONTOS' ? (
                            <input
                              type="text" disabled={ehFinal}
                              placeholder="Descreva do que se trata (ex.: uniforme não devolvido, dano a equipamento)"
                              value={item.descricao.replace(/^Outros descontos:\s*/, '').replace(/^Outros descontos$/, '')}
                              onChange={e => editarDescricaoItem(item.codigo, e.target.value ? `Outros descontos: ${e.target.value}` : 'Outros descontos')}
                              className="text-[10px] text-gray-500 w-full border-b border-dashed border-gray-300 focus:border-indigo-400 outline-none bg-transparent py-0.5 disabled:text-gray-400"
                            />
                          ) : (
                            <p className="text-[10px] text-gray-400 truncate">{item.formula}</p>
                          )}
                        </div>
                        <InputMoeda
                          value={item.valor} disabled={ehFinal}
                          onChange={v => editarValorItem(item.codigo, v)}
                          className="w-36 p-2 border border-gray-300 rounded-lg text-sm font-black text-right tabular-nums disabled:bg-gray-100"
                        />
                      </div>
                    ))}
                  </div>
                );
              })}

              {!ehFinal && (
                <div className="p-4 flex justify-end">
                  <button onClick={salvarItens} disabled={salvandoItens} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-4 py-2.5 rounded-lg uppercase disabled:opacity-50">
                    {salvandoItens ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                </div>
              )}

              <div className="bg-[#F8FAFC] p-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Proventos</p>
                  <p className="text-lg font-black text-emerald-700">{fmtMoeda(totaisLocais.totalProventos)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Descontos</p>
                  <p className="text-lg font-black text-red-700">{fmtMoeda(totaisLocais.totalDescontos)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Valor líquido</p>
                  <p className="text-lg font-black text-[#0C1D4D]">{fmtMoeda(totaisLocais.valorLiquido)}</p>
                </div>
              </div>
            </div>

            {/* FGTS */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-1">Multa do FGTS</h3>
              <p className="text-[10px] text-gray-400 font-medium mb-3">O saldo abaixo já vem com um cálculo prévio (estimativa de 8% do salário × meses de casa) — corrija com o valor real do extrato do FGTS/contabilidade antes de homologar. Valor depositado na conta do FGTS, não soma ao valor líquido pago no TRCT.</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Saldo FGTS informado</label>
                  <InputMoeda value={saldoFgts} disabled={ehFinal} onChange={setSaldoFgts} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Percentual da multa</label>
                  <input type="number" step="0.01" value={percentualFgts} disabled={ehFinal} onChange={e => setPercentualFgts(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-bold disabled:bg-gray-100" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Valor da multa</label>
                  <p className="p-2.5 text-sm font-black text-[#0C1D4D]">{fmtMoeda(valorMultaFgts)}</p>
                </div>
              </div>
              {!ehFinal && (
                <div className="flex justify-end mt-3">
                  <button onClick={salvarFgts} disabled={salvandoFgts} className="text-[10px] font-black text-white bg-[#336699] hover:bg-[#284B8C] px-4 py-2.5 rounded-lg uppercase disabled:opacity-50">
                    {salvandoFgts ? 'Salvando...' : 'Salvar FGTS'}
                  </button>
                </div>
              )}
            </div>

            {/* TRCT opcional */}
            <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
              <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider mb-3">TRCT (opcional)</h3>
              {rescisao.storage_path ? (
                <div className="flex items-center gap-3">
                  <button onClick={abrirAnexo} className="text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg uppercase">📎 Ver anexo</button>
                  <span className="text-xs text-gray-500">{rescisao.nome_arquivo}</span>
                </div>
              ) : (
                <p className="text-xs text-gray-400 font-bold uppercase mb-2">Nenhum anexo enviado ainda.</p>
              )}
              {!ehFinal && (
                <div className="mt-3">
                  <input ref={arquivoRef} type="file" accept="application/pdf,image/*" disabled={enviandoArquivo}
                    onChange={e => { const f = e.target.files?.[0]; if (f) enviarArquivo(f); }} className="text-xs" />
                  {enviandoArquivo && <p className="text-[10px] text-gray-400 mt-1">Enviando...</p>}
                </div>
              )}
            </div>
          </>
        )}

        {/* Ações finais */}
        {!ehFinal && (
          <div className="flex justify-end gap-3 pb-8">
            <button onClick={cancelar} disabled={cancelando} className="text-xs font-black text-gray-500 bg-gray-100 hover:bg-gray-200 px-5 py-3 rounded-xl uppercase tracking-wider disabled:opacity-50">
              {cancelando ? 'Cancelando...' : 'Cancelar rescisão'}
            </button>
            <button onClick={homologar} disabled={!podeHomologar || homologando} className="text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 px-6 py-3 rounded-xl uppercase tracking-wider disabled:opacity-50">
              {homologando ? 'Homologando...' : '✓ Homologar Rescisão'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
