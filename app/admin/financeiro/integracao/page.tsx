"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  consultarPagamentosItauAction, consultarPagamentoItauAction, conciliarP2sComItauAction, darBaixaContaPagarConciliacaoAction,
  type FiltrosConsultaItau, type CandidatoConciliacaoP2sItau, type CandidatoJaQuitadoP2s,
} from './actions';
import { listarIntegracoesAction, statusItauApiAction } from '../../parametros/integracao/actions';
import { conciliarOpsComContasPagarAction, conciliarOpsComItauAction } from '../ops/actions';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast } from '../../../components/ui/NotificationProvider';
import { supabase } from '../../../lib/supabase';

const BRL = (v: string | number | null | undefined) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (d: string | null | undefined) => {
  if (!d) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  if (!iso) return d;
  const [a, m, dd] = iso.split('-');
  return `${dd}/${m}/${a}`;
};

// Formata a chave bruta de um campo do retorno do Itaú (snake_case) como
// rótulo legível — sem dicionário de tradução, então acentos não entram.
const humanizarLabel = (chave: string) => chave.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const formatarValorCampo = (chave: string, valor: unknown): string => {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  const chaveLower = chave.toLowerCase();
  if (chaveLower.includes('valor') && !Number.isNaN(Number(valor))) return BRL(valor as string);
  if (chaveLower.includes('data') && typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return fmtData(valor);
  return String(valor);
};

// Renderiza qualquer objeto do retorno da API do Itaú como campo -> valor,
// sem depender de conhecer os nomes de antemão — a Especificação Técnica
// varia por tipo de pagamento (PIX/TED/boleto/DOC), então em vez de mapear
// campo a campo (e deixar coisa de fora sempre que a API retornar algo a
// mais), qualquer chave presente no objeto aparece automaticamente.
function CamposGenericos({ objeto, omitir = [] }: { objeto: any; omitir?: string[] }) {
  if (!objeto || typeof objeto !== 'object') return null;
  const entradas = Object.entries(objeto).filter(([k, v]) => !omitir.includes(k) && v !== null && v !== undefined && v !== '');
  if (entradas.length === 0) return null;

  return (
    <div className="space-y-2">
      {entradas.map(([chave, valor]) => {
        if (Array.isArray(valor)) {
          if (valor.length === 0) return null;
          if (typeof valor[0] === 'object') {
            return (
              <div key={chave}>
                <p className="text-[9px] font-black text-gray-400 uppercase mb-1">{humanizarLabel(chave)}</p>
                <div className="space-y-2 pl-2 border-l-2 border-gray-100">
                  {(valor as any[]).map((item, i) => (
                    <div key={i} className="bg-white rounded-lg p-2 border border-gray-100">
                      <CamposGenericos objeto={item} />
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={chave} className="text-xs flex justify-between gap-3 border-b border-gray-50 pb-1">
              <span className="text-gray-400">{humanizarLabel(chave)}</span>
              <strong className="text-right">{(valor as unknown[]).join(', ')}</strong>
            </div>
          );
        }
        if (typeof valor === 'object') {
          return (
            <div key={chave}>
              <p className="text-[9px] font-black text-gray-400 uppercase mb-1">{humanizarLabel(chave)}</p>
              <div className="bg-white rounded-lg p-2 pl-3 border-l-2 border-gray-100">
                <CamposGenericos objeto={valor} />
              </div>
            </div>
          );
        }
        return (
          <div key={chave} className="text-xs flex justify-between gap-3 border-b border-gray-50 pb-1">
            <span className="text-gray-400">{humanizarLabel(chave)}</span>
            <strong className="text-right">{formatarValorCampo(chave, valor)}</strong>
          </div>
        );
      })}
    </div>
  );
}

// Domínio documentado pela Especificação Técnica do Itaú (GET /pagamentos_sispag)
const STATUS_LABEL: Record<string, string> = { AE: 'A Efetuar', EF: 'Efetuado', NE: 'Não Efetuado', TD: 'Todos' };
const STATUS_COR: Record<string, string> = {
  AE: 'bg-amber-100 text-amber-700',
  EF: 'bg-emerald-100 text-emerald-700',
  NE: 'bg-red-100 text-red-600',
};

// O filtro vai pra API como código (AE/EF/NE), mas a API devolve o status por
// EXTENSO ("Efetuado", "Pendente de autorização", "Não Efetuado"). Nunca
// conseguimos confirmar se ela realmente honra o filtro (o sandbox ignora:
// devolve a mesma lista pra qualquer valor). Este mapa faz a conferência do
// lado do cliente pra tela nunca mostrar linha que contradiz o filtro
// escolhido — se a API filtrar certo, não muda nada; se ignorar, a tela
// continua coerente e avisa quantas linhas escondeu.
const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const codigoDoStatusTexto = (statusTexto: string): 'AE' | 'EF' | 'NE' | null => {
  const s = semAcento(statusTexto);
  if (!s) return null;
  if (s.startsWith('nao efetuado') || s.includes('rejeitad') || s.includes('cancelad') || s.includes('estornad')) return 'NE';
  if (s.startsWith('efetuad')) return 'EF';
  if (s.includes('pendente') || s.includes('a efetuar') || s.includes('agendad') || s.includes('autorizac')) return 'AE';
  return null;
};

interface ItemPagamentoItau {
  id_pagamento?: string;
  numero_lote?: string;
  numero_lancamento?: string;
  nome_favorecido?: string;
  nome_beneficiario?: string;
  cpf_cnpj?: string;
  codigo_banco?: string;
  numero_agencia?: string;
  numero_conta?: string;
  referencia_empresa?: string;
  data_pagamento?: string;
  valor_pagamento?: string;
  tipo_pagamento?: string;
  status?: string;
  motivo?: string;
}

interface Integracao {
  id: number; parceiro: string; nome_exibicao: string; tipo: string;
  ativo: boolean; ambiente: string; config: any;
  empresa_id: number | null;
}
interface StatusItauApiAmbiente {
  clientIdConfigurado: boolean; clientSecretConfigurado: boolean;
  certificadoConfigurado: boolean; chaveConfigurada: boolean;
}

export default function IntegracaoFinanceiraPage() {
  const router = useRouter();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess({ nomeFallback: 'Usuário' });
  const toast = useToast();

  // Abas por instituição bancária — hoje só o Itaú está integrado via API;
  // se outro banco entrar no futuro, basta somar um item aqui e um painel
  // próprio, sem mexer no resto da tela.
  const INSTITUICOES = [{ chave: 'ITAU', rotulo: '🏦 Itaú' }] as const;
  const [instituicaoAtiva, setInstituicaoAtiva] = useState<typeof INSTITUICOES[number]['chave']>('ITAU');

  const [integracaoItau, setIntegracaoItau] = useState<Integracao | null>(null);
  const [statusItauApi, setStatusItauApi] = useState<{ sandbox: StatusItauApiAmbiente; producao: StatusItauApiAmbiente } | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);
  useEffect(() => {
    supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setEmpresasCatalogo(data || []));
  }, []);

  const hoje = () => new Date().toISOString().slice(0, 10);
  const trintaDiasAtras = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [filtros, setFiltros] = useState<FiltrosConsultaItau>({
    tipoLista: 'Detalhada', dataInicial: trintaDiasAtras(), dataFinal: hoje(), status: undefined,
  });
  const [consultando, setConsultando] = useState(false);
  const [resultados, setResultados] = useState<ItemPagamentoItau[]>([]);
  const [totalResultado, setTotalResultado] = useState<string | null>(null);
  const [jaConsultou, setJaConsultou] = useState(false);
  const [paginacao, setPaginacao] = useState({ paginaAtual: 0, totalPaginas: 1, totalItens: 0, tamanhoPagina: 20 });
  // true = a action já trouxe TODAS as páginas e ordenou o conjunto inteiro
  // (mais recentes primeiro), então quem pagina daqui pra frente é a tela.
  // false = resultado grande demais pra agregar; a paginação continua sendo a
  // da API e a ordenação vale só dentro de cada página (a tela avisa).
  const [ordemCompleta, setOrdemCompleta] = useState(true);
  // Filtro escolhido no momento da última consulta — usado só pra conferir a
  // resposta (ver codigoDoStatusTexto), não pra refazer a busca.
  const [statusConsultado, setStatusConsultado] = useState<FiltrosConsultaItau['status']>(undefined);

  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<any | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregar(accessToken);
  }, [authLoading, acessoNegado, accessToken]);

  const carregar = async (token: string) => {
    const [integRes, statusRes] = await Promise.all([listarIntegracoesAction(token), statusItauApiAction(token)]);
    if (integRes.ok) setIntegracaoItau(integRes.info.integracoes.find((i: Integracao) => i.parceiro === 'ITAU') || null);
    if (statusRes.ok) setStatusItauApi(statusRes.info);
  };

  // "🔗 Conciliar Contas" — mesma conciliação de duas pontas já usada em
  // /admin/financeiro/ops (botão "Conciliar Contas Pagas"), exposta aqui
  // também (pedido do usuário 2026-09-18) pra quem cuida da integração
  // bancária não precisar ir noutra tela: 1) PrimeStart — contas já quitadas
  // lá citando "OP: número" na descrição; 2) Itaú — reconsulta pagamentos já
  // enviados (aceitos pela API) mas ainda não confirmados como efetivados de
  // fato, e já dá baixa na Conta a Pagar correspondente no PrimeStart quando
  // confirma (ver conciliarOpsComItauAction).
  const [conciliando, setConciliando] = useState(false);
  const conciliarContas = async () => {
    setConciliando(true);
    try {
      const [resP2s, resItau] = await Promise.all([
        conciliarOpsComContasPagarAction(accessToken),
        conciliarOpsComItauAction(accessToken),
      ]);

      if (!resP2s.ok && !resItau.ok) {
        toast(`Erro na conciliação — PrimeStart: ${resP2s.erro} — Itaú: ${resItau.erro}`, 'error');
        return;
      }

      const partes: string[] = [];
      let houveProblema = false;

      if (resP2s.ok) {
        const { baixadas, semCorrespondencia, jaEstavamPagas } = resP2s.info;
        if (baixadas.length > 0) partes.push(`PrimeStart: ${baixadas.length} OP(s) baixada(s): ${baixadas.map((b: any) => `#${b.numero_op}`).join(', ')}.`);
        if (jaEstavamPagas > 0) partes.push(`PrimeStart: ${jaEstavamPagas} já estava(m) paga(s).`);
        if (semCorrespondencia.length > 0) { partes.push(`⚠ PrimeStart: ${semCorrespondencia.length} conta(s) citam OP inexistente: ${semCorrespondencia.map((s: any) => `#${s.numero_op}`).join(', ')}.`); houveProblema = true; }
      } else {
        partes.push(`⚠ PrimeStart: ${resP2s.erro}`); houveProblema = true;
      }

      if (resItau.ok) {
        const { baixadas, aindaPendentes, falhasConsulta } = resItau.info;
        if (baixadas.length > 0) partes.push(`Itaú: ${baixadas.length} OP(s) confirmada(s) e baixada(s) (PAGO + quitada no PrimeStart): ${baixadas.map(b => `#${b.numero_op} (${b.status_itau})`).join(', ')}.`);
        const avisosP2s = baixadas.filter(b => b.avisoP2s);
        if (avisosP2s.length > 0) { partes.push(`⚠ PrimeStart não quitou automaticamente: ${avisosP2s.map(b => `#${b.numero_op} (${b.avisoP2s})`).join('; ')}.`); houveProblema = true; }
        if (aindaPendentes.length > 0) partes.push(`Itaú: ${aindaPendentes.length} OP(s) ainda não efetivada(s): ${aindaPendentes.map(p => `#${p.numero_op} (${p.status_itau})`).join(', ')}.`);
        if (falhasConsulta.length > 0) { partes.push(`⚠ Itaú: falha ao consultar ${falhasConsulta.length} OP(s): ${falhasConsulta.map(f => `#${f.numero_op}`).join(', ')}.`); houveProblema = true; }
      } else {
        partes.push(`⚠ Itaú: ${resItau.erro}`); houveProblema = true;
      }

      if (partes.length === 0) {
        toast('Nada a conciliar — nenhuma conta paga no PrimeStart citando uma OP, e nenhuma OP pendente de confirmação no Itaú.', 'info');
        return;
      }

      toast(partes.join(' '), houveProblema ? 'error' : 'success');
    } finally {
      setConciliando(false);
    }
  };

  // "🔍 Conciliar P2S x Itaú" — cobre o caso de contas lançadas direto no
  // PrimeStart e pagas direto no banco, sem passar pela OP do Rentech (por
  // isso não têm o "OP: número" que a conciliação acima procura). Casa por
  // valor + nome do favorecido/fornecedor; nenhuma baixa é automática aqui —
  // o usuário revisa o grid e confirma.
  const CONFIANCA_LABEL: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  const CONFIANCA_COR: Record<string, string> = {
    alta: 'bg-emerald-100 text-emerald-700', media: 'bg-amber-100 text-amber-700', baixa: 'bg-gray-100 text-gray-500',
  };
  const centoOitentaDiasAtras = () => new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [filtrosP2sItau, setFiltrosP2sItau] = useState({
    dataInicial: trintaDiasAtras(), dataFinal: hoje(),
    vencimentoInicial: centoOitentaDiasAtras(), vencimentoFinal: hoje(),
  });
  const [conciliandoP2s, setConciliandoP2s] = useState(false);
  const [jaConciliouP2s, setJaConciliouP2s] = useState(false);
  const [candidatosP2s, setCandidatosP2s] = useState<CandidatoConciliacaoP2sItau[]>([]);
  const [jaQuitadasP2s, setJaQuitadasP2s] = useState<CandidatoJaQuitadoP2s[]>([]);
  const [resumoP2s, setResumoP2s] = useState<{ totalPagamentosItau: number; totalContasEncontradas: number; valoresTruncados: boolean; pagamentosTruncados: boolean } | null>(null);
  const [selecionadosP2s, setSelecionadosP2s] = useState<Set<string>>(new Set());
  const [baixandoP2s, setBaixandoP2s] = useState<Set<string>>(new Set());
  const [confirmacaoP2s, setConfirmacaoP2s] = useState<CandidatoConciliacaoP2sItau[] | null>(null);

  const conciliarP2sItau = async () => {
    setConciliandoP2s(true);
    setSelecionadosP2s(new Set());
    try {
      const res = await conciliarP2sComItauAction(filtrosP2sItau, accessToken);
      if (!res.ok) { toast(res.erro || 'Não foi possível conciliar.', 'error'); return; }
      const candidatos: CandidatoConciliacaoP2sItau[] = res.info.candidatos || [];
      setCandidatosP2s(candidatos);
      setJaQuitadasP2s(res.info.jaQuitadas || []);
      setResumoP2s(res.info);
      setJaConciliouP2s(true);
      if (candidatos.length === 0) {
        toast('Nenhuma correspondência encontrada no período — confira se há pagamentos "Efetuado" no Itaú com valor igual ao de alguma conta em aberto no PrimeStart.', 'info');
      }
    } finally {
      setConciliandoP2s(false);
    }
  };

  const alternarSelecaoP2s = (oid: string) => {
    setSelecionadosP2s(prev => {
      const next = new Set(prev);
      if (next.has(oid)) next.delete(oid); else next.add(oid);
      return next;
    });
  };

  const executarBaixasP2s = async (candidatos: CandidatoConciliacaoP2sItau[]) => {
    setConfirmacaoP2s(null);
    const oids = candidatos.map(c => c.p2sOid);
    setBaixandoP2s(prev => new Set([...prev, ...oids]));
    const sucesso: string[] = [];
    let jaEstavamQuitadas = 0;
    const falhas: { fornecedor: string | null; erro: string }[] = [];
    for (const cand of candidatos) {
      try {
        const res = await darBaixaContaPagarConciliacaoAction({
          p2sOid: cand.p2sOid, valor: cand.valor, fornecedor: cand.fornecedor, descricao: cand.descricao,
          dataQuitacao: cand.pagamentoItau.dataPagamento || undefined,
        }, accessToken);
        if (res.ok) {
          sucesso.push(cand.p2sOid);
          if (res.info?.jaEstavaQuitada) jaEstavamQuitadas++;
        } else {
          falhas.push({ fornecedor: cand.fornecedor, erro: res.erro || 'erro desconhecido' });
        }
      } catch (e: any) {
        falhas.push({ fornecedor: cand.fornecedor, erro: e.message });
      }
    }
    setBaixandoP2s(prev => { const next = new Set(prev); oids.forEach(o => next.delete(o)); return next; });
    if (sucesso.length > 0) {
      setCandidatosP2s(prev => prev.filter(c => !sucesso.includes(c.p2sOid)));
      setSelecionadosP2s(prev => { const next = new Set(prev); sucesso.forEach(o => next.delete(o)); return next; });
    }
    const baixadasDeVerdade = sucesso.length - jaEstavamQuitadas;
    const partes: string[] = [];
    if (baixadasDeVerdade > 0) partes.push(`${baixadasDeVerdade} conta(s) baixada(s) no PrimeStart.`);
    if (jaEstavamQuitadas > 0) partes.push(`${jaEstavamQuitadas} já estava(m) quitada(s) no PrimeStart (nenhuma ação necessária).`);
    if (falhas.length > 0) partes.push(`Falha(s): ${falhas.map(f => `${f.fornecedor || 's/nome'} (${f.erro})`).join('; ')}`);
    if (partes.length > 0) toast(partes.join(' '), falhas.length > 0 ? 'error' : 'success');
  };

  // `pagina` é 0-based, igual ao que a API do Itaú devolve em pagination.page.
  const consultar = async (pagina = 0) => {
    setConsultando(true);
    try {
      const res = await consultarPagamentosItauAction({ ...filtros, page: pagina }, accessToken);
      if (!res.ok) { toast(res.erro || 'Não foi possível consultar.', 'error'); setResultados([]); setTotalResultado(null); return; }
      setResultados(res.info.itens || []);
      setTotalResultado(res.info.total ?? null);
      setStatusConsultado(filtros.status);
      setOrdemCompleta(res.info.ordemCompleta !== false);
      setPaginacao({
        paginaAtual: res.info.paginaAtual ?? pagina,
        totalPaginas: res.info.totalPaginas ?? 1,
        totalItens: res.info.totalItens ?? (res.info.itens || []).length,
        tamanhoPagina: res.info.tamanhoPagina ?? 20,
      });
      setJaConsultou(true);
    } finally {
      setConsultando(false);
    }
  };

  // Com o conjunto inteiro já em mãos, virar página é só recortar o array —
  // sem ida ao Itaú. Só o modo não-agregado precisa reconsultar.
  const irParaPagina = (pagina: number) => {
    if (ordemCompleta) setPaginacao(p => ({ ...p, paginaAtual: pagina }));
    else consultar(pagina);
  };

  const verDetalhe = async (idPagamento: string) => {
    setDetalheId(idPagamento);
    setDetalhe(null);
    setCarregandoDetalhe(true);
    try {
      const res = await consultarPagamentoItauAction(idPagamento, accessToken);
      if (!res.ok) { toast(res.erro || 'Não foi possível abrir o detalhe.', 'error'); setDetalheId(null); return; }
      setDetalhe(res.info.pagamento);
    } finally {
      setCarregandoDetalhe(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center">
        <p className="text-[#64748B] font-bold text-sm uppercase tracking-wider">Validando acesso...</p>
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

  const ambienteAtual = integracaoItau?.ambiente === 'PRODUCAO' ? 'PRODUCAO' : 'SANDBOX';
  const credenciaisAmbiente = statusItauApi ? (ambienteAtual === 'PRODUCAO' ? statusItauApi.producao : statusItauApi.sandbox) : null;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-4">
      <Analytics />

      <div className="bg-[#DBEAFE] border-b border-[#BFDBFE] px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-[#1E40AF] font-medium text-sm">
          🔌 <strong>Integração Bancária</strong>. Consultas diretas às APIs dos bancos integrados.
        </p>
        <button onClick={() => router.push('/admin/financeiro')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BFDBFE] text-[#1E40AF] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO FINANCEIRO
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 max-w-[1400px] mx-auto w-full">
        <div className="flex bg-white p-1 rounded-xl border border-[#E2E8F0] w-fit shadow-sm mb-4">
          {INSTITUICOES.map(inst => (
            <button key={inst.chave} onClick={() => setInstituicaoAtiva(inst.chave)}
              className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${instituicaoAtiva === inst.chave ? 'bg-[#0C1D4D] text-white shadow-sm' : 'text-[#64748B] hover:text-[#0C1D4D]'}`}>
              {inst.rotulo}
            </button>
          ))}
        </div>

        {instituicaoAtiva === 'ITAU' && (<>
          {/* Status da integração — espelha o que está configurado em Integrações, sem duplicar o cadastro */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4 flex flex-wrap items-center gap-4">
            <div>
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">🏦 API SISPAG (Cash Management)</h3>
              <p className="text-[11px] text-gray-500">Consulta de pagamentos já lançados no SISPAG — via API ou arquivo CNAB manual.</p>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[9px] font-black px-2.5 py-1 rounded-full uppercase bg-gray-100 text-gray-600">
                🏭 {integracaoItau?.empresa_id ? (empresasCatalogo.find(e => e.id === integracaoItau.empresa_id)?.nome || 'Empresa removida') : 'Todas as empresas'}
              </span>
              <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase ${ambienteAtual === 'PRODUCAO' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'}`}>
                Ambiente: {ambienteAtual === 'PRODUCAO' ? 'Produção' : 'Sandbox'}
              </span>
              <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase ${integracaoItau?.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {integracaoItau?.ativo ? '✓ Ativa' : '✕ Inativa'}
              </span>
              <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase ${credenciaisAmbiente?.clientIdConfigurado && credenciaisAmbiente?.clientSecretConfigurado ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {!statusItauApi ? '…' : credenciaisAmbiente?.clientIdConfigurado && credenciaisAmbiente?.clientSecretConfigurado ? '✓ Credenciais OK' : '✕ Credenciais incompletas'}
              </span>
              <button onClick={() => router.push('/admin/parametros/integracao')} className="text-[10px] font-black bg-[#F8FAFC] border border-gray-300 text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg uppercase tracking-wider transition-colors">
                ⚙ Configurar
              </button>
            </div>
          </div>

          {/* Conciliação de duas pontas — PrimeStart (contas já quitadas lá
              citando "OP: número") e Itaú (pagamentos aceitos pela API, mas
              ainda não confirmados como efetivados) */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4 flex flex-wrap items-center gap-4">
            <div>
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">🔗 Conciliação de Pagamentos</h3>
              <p className="text-[11px] text-gray-500">Confere OPs pagas no PrimeStart (contas com "OP: número" na descrição) e no Itaú (reconsulta pagamentos aceitos pela API) — baixa pra PAGO e quita a Conta a Pagar no PrimeStart automaticamente.</p>
            </div>
            <button onClick={conciliarContas} disabled={conciliando} className="text-xs font-black bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg uppercase tracking-wider ml-auto">
              {conciliando ? '⏳ Conciliando...' : '🔗 Conciliar Contas'}
            </button>
          </div>

          {/* Conciliação P2S x Itaú — contas lançadas direto no PrimeStart e
              pagas direto no banco, fora do fluxo de OP (por isso não têm
              "OP: número" e não entram na conciliação acima). Casa por valor
              + nome do favorecido; baixa sempre manual, mediante confirmação. */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4">
            <div className="mb-3">
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">🔍 Conciliar P2S x Itaú</h3>
              <p className="text-[11px] text-gray-500 max-w-lg">Para contas lançadas direto no PrimeStart e pagas direto no banco (sem passar por uma OP). Casa contas em aberto por valor e nome do favorecido com pagamentos já Efetuados no Itaú — você confere e confirma a baixa.</p>
            </div>

            <div className="bg-[#F8FAFC] rounded-xl p-3 mb-2 border border-gray-100">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-2">🏦 Pagamento no Itaú (data efetiva do pagamento)</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">De</label>
                  <input type="date" value={filtrosP2sItau.dataInicial} onChange={e => setFiltrosP2sItau(f => ({ ...f, dataInicial: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Até</label>
                  <input type="date" value={filtrosP2sItau.dataFinal} onChange={e => setFiltrosP2sItau(f => ({ ...f, dataFinal: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-white" />
                </div>
              </div>
            </div>

            <div className="bg-[#F8FAFC] rounded-xl p-3 mb-3 border border-gray-100">
              <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-2">🏢 Vencimento no PrimeStart (data de vencimento da conta, não a de lançamento)</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">De</label>
                  <input type="date" value={filtrosP2sItau.vencimentoInicial} onChange={e => setFiltrosP2sItau(f => ({ ...f, vencimentoInicial: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Até</label>
                  <input type="date" value={filtrosP2sItau.vencimentoFinal} onChange={e => setFiltrosP2sItau(f => ({ ...f, vencimentoFinal: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-white" />
                </div>
              </div>
            </div>

            <button onClick={conciliarP2sItau} disabled={conciliandoP2s} className="w-full md:w-auto text-xs font-black bg-[#0C1D4D] hover:bg-[#284B8C] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg uppercase tracking-wider">
              {conciliandoP2s ? '⏳ Buscando...' : '🔍 Conciliar P2S x Itaú'}
            </button>

            {jaConciliouP2s && (
              <div className="pt-3 border-t border-gray-100 mt-2">
                <p className="text-[11px] text-gray-500 font-bold mb-2">
                  {candidatosP2s.length} correspondência(s) encontrada(s)
                  {resumoP2s ? ` · ${resumoP2s.totalPagamentosItau} pagamento(s) Efetuado(s) no Itaú no período` : ''}
                </p>
                {resumoP2s?.pagamentosTruncados && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2 font-bold">
                    ⚠ Muitos pagamentos no período — nem todos foram considerados. Estreite o intervalo de datas para um resultado completo.
                  </p>
                )}
                {resumoP2s?.valoresTruncados && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2 font-bold">
                    ⚠ Muitos valores distintos no período — nem todos foram consultados no PrimeStart. Estreite o intervalo de datas.
                  </p>
                )}

                {candidatosP2s.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-4 text-center">Nenhuma correspondência para o período informado.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="flex items-center justify-between mb-2">
                      <button onClick={() => setSelecionadosP2s(new Set(candidatosP2s.filter(c => c.confianca === 'alta').map(c => c.p2sOid)))} className="text-[10px] font-black text-[#1E40AF] hover:underline uppercase">
                        Selecionar todas de alta confiança
                      </button>
                      <button
                        onClick={() => setConfirmacaoP2s(candidatosP2s.filter(c => selecionadosP2s.has(c.p2sOid)))}
                        disabled={selecionadosP2s.size === 0}
                        className="text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg uppercase tracking-wider"
                      >
                        Dar baixa nos selecionados ({selecionadosP2s.size})
                      </button>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[9px] font-black text-gray-400 uppercase border-b border-gray-200">
                          <th className="py-2 pr-2"></th>
                          <th className="py-2 pr-3">Conta a Pagar (PrimeStart)</th>
                          <th className="py-2 pr-3">Pagamento (Itaú)</th>
                          <th className="py-2 pr-3">Confiança</th>
                          <th className="py-2 pr-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidatosP2s.map(cand => (
                          <tr key={cand.p2sOid} className="border-b border-gray-100 hover:bg-[#F8FAFC] align-top">
                            <td className="py-2 pr-2 pt-3">
                              <input type="checkbox" checked={selecionadosP2s.has(cand.p2sOid)} onChange={() => alternarSelecaoP2s(cand.p2sOid)} />
                            </td>
                            <td className="py-2 pr-3">
                              <p className="font-bold">{cand.fornecedor || '— sem fornecedor —'}</p>
                              <p className="text-gray-400">{cand.descricao || '—'} {cand.dataVencimento ? `· venc. ${fmtData(cand.dataVencimento)}` : ''}</p>
                              <p className="font-bold">{BRL(cand.valor)}</p>
                            </td>
                            <td className="py-2 pr-3">
                              <p className="font-bold">{cand.pagamentoItau.nomeFavorecido || '—'}</p>
                              <p className="text-gray-400">{fmtData(cand.pagamentoItau.dataPagamento)}{cand.pagamentoItau.numeroLote ? ` · lote ${cand.pagamentoItau.numeroLote}` : ''}</p>
                              <p className="font-bold">{BRL(cand.pagamentoItau.valor)}</p>
                            </td>
                            <td className="py-2 pr-3 pt-3">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${CONFIANCA_COR[cand.confianca]}`}>
                                {CONFIANCA_LABEL[cand.confianca]}
                              </span>
                            </td>
                            <td className="py-2 pr-3 pt-3">
                              <button
                                onClick={() => setConfirmacaoP2s([cand])}
                                disabled={baixandoP2s.has(cand.p2sOid)}
                                className="text-[10px] font-black bg-[#F8FAFC] border border-gray-300 hover:bg-gray-100 disabled:opacity-40 text-gray-700 px-3 py-1.5 rounded-lg uppercase tracking-wider"
                              >
                                {baixandoP2s.has(cand.p2sOid) ? '⏳' : 'Dar baixa'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Contas que o /qpo trouxe como candidatas (valor + vencimento
                    batendo) mas que, na reconferência direta do objeto, já
                    estão quitadas no PrimeStart de verdade — só informativo,
                    nenhuma ação necessária. */}
                {jaQuitadasP2s.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                      ✓ {jaQuitadasP2s.length} conta(s) já quitada(s) no PrimeStart (nenhuma ação necessária)
                    </p>
                    <div className="space-y-1.5">
                      {jaQuitadasP2s.map(c => (
                        <div key={c.p2sOid} className="flex justify-between gap-3 text-xs bg-gray-50 rounded-lg px-3 py-2">
                          <div>
                            <span className="font-bold">{c.fornecedor || '— sem fornecedor —'}</span>
                            <span className="text-gray-400"> {c.descricao ? `· ${c.descricao}` : ''}</span>
                          </div>
                          <div className="text-gray-400 whitespace-nowrap">
                            {BRL(c.valor)}{c.dataQuitacao ? ` · quitada em ${fmtData(c.dataQuitacao)}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Consulta de pagamentos — GET /pagamentos_sispag */}
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] mb-4">
            <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-3">🔎 Consulta de Pagamentos</h3>
            <div className="flex flex-wrap items-end gap-3 mb-2">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data inicial</label>
                <input type="date" value={filtros.dataInicial || ''} onChange={e => setFiltros(f => ({ ...f, dataInicial: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Data final</label>
                <input type="date" value={filtros.dataFinal || ''} onChange={e => setFiltros(f => ({ ...f, dataFinal: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Status</label>
                <select value={filtros.status || ''} onChange={e => setFiltros(f => ({ ...f, status: (e.target.value || undefined) as FiltrosConsultaItau['status'] }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]">
                  <option value="">Todos</option>
                  <option value="AE">A Efetuar</option>
                  <option value="EF">Efetuado</option>
                  <option value="NE">Não Efetuado</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Nº do lote</label>
                <input type="text" placeholder="opcional" value={filtros.numeroLote || ''} onChange={e => setFiltros(f => ({ ...f, numeroLote: e.target.value }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC] w-32" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase mb-1">Lista</label>
                <select value={filtros.tipoLista || 'Detalhada'} onChange={e => setFiltros(f => ({ ...f, tipoLista: e.target.value as FiltrosConsultaItau['tipoLista'] }))} className="p-2 border border-gray-300 rounded-lg text-xs font-bold bg-[#F8FAFC]">
                  <option value="Detalhada">Detalhada</option>
                  <option value="Lote">Por lote</option>
                </select>
              </div>
              <button onClick={() => consultar(0)} disabled={consultando} className="text-xs font-black bg-[#0C1D4D] hover:bg-[#284B8C] text-white px-5 py-2.5 rounded-lg uppercase tracking-wider disabled:opacity-50">
                {consultando ? '⏳ Consultando...' : '🔎 Consultar'}
              </button>
            </div>

            {jaConsultou && (() => {
              // Confere a resposta contra o filtro pedido — ver
              // codigoDoStatusTexto. Sem filtro (Todos), mostra tudo.
              const filtrados = !statusConsultado || statusConsultado === 'TD'
                ? resultados
                : resultados.filter(p => codigoDoStatusTexto(p.status || '') === statusConsultado);
              const ocultos = resultados.length - filtrados.length;
              // No modo agregado a fatia da página sai daqui, do conjunto
              // inteiro já ordenado; no outro, o recorte veio pronto da API.
              const totalPaginas = ordemCompleta
                ? Math.max(1, Math.ceil(filtrados.length / paginacao.tamanhoPagina))
                : paginacao.totalPaginas;
              const paginaAtual = Math.max(0, Math.min(paginacao.paginaAtual, totalPaginas - 1));
              const visiveis = ordemCompleta
                ? filtrados.slice(paginaAtual * paginacao.tamanhoPagina, (paginaAtual + 1) * paginacao.tamanhoPagina)
                : filtrados;
              return (
              <div className="pt-3 border-t border-gray-100 mt-2">
                {/* Mostra o total REAL (pagination.totalElements) e não só o
                    tamanho da página — antes a tela exibia 20 de 68 sem avisar
                    que havia mais, e dava a impressão de "pagamento sumiu". */}
                <p className="text-[11px] text-gray-500 font-bold mb-2">
                  {paginacao.totalItens} pagamento(s) encontrado(s){totalResultado ? ` · Total: ${BRL(totalResultado)}` : ''}
                  {totalPaginas > 1 && (
                    <span className="text-gray-400"> · mostrando {visiveis.length} (página {paginaAtual + 1} de {totalPaginas})</span>
                  )}
                  <span className="text-gray-400"> · mais recentes primeiro</span>
                </p>
                {ocultos > 0 && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2 font-bold">
                    ⚠ {ocultos} pagamento(s) {ordemCompleta ? '' : 'desta página '}foram ocultados por não corresponderem ao status filtrado — a API do Itaú devolveu itens fora do filtro pedido.
                  </p>
                )}
                {!ordemCompleta && paginacao.totalPaginas > 1 && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2 font-bold">
                    ⚠ Resultado grande demais ({paginacao.totalPaginas} páginas) para ordenar por completo — aqui a ordem de mais recentes primeiro vale só dentro de cada página. Estreite o período para ver os pagamentos realmente mais recentes no topo.
                  </p>
                )}
                {visiveis.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-4 text-center">Nenhum pagamento encontrado para os filtros informados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-[9px] font-black text-gray-400 uppercase border-b border-gray-200">
                          <th className="py-2 pr-3">Favorecido</th>
                          <th className="py-2 pr-3">Valor</th>
                          <th className="py-2 pr-3">Data pagto.</th>
                          <th className="py-2 pr-3">Tipo</th>
                          <th className="py-2 pr-3">Lote / Lanç.</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Motivo</th>
                          <th className="py-2 pr-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiveis.map((p, idx) => (
                          <tr key={p.id_pagamento || idx} className="border-b border-gray-100 hover:bg-[#F8FAFC]">
                            <td className="py-2 pr-3 font-bold">{p.nome_favorecido || p.nome_beneficiario || '—'}</td>
                            <td className="py-2 pr-3 font-bold">{BRL(p.valor_pagamento)}</td>
                            <td className="py-2 pr-3">{fmtData(p.data_pagamento)}</td>
                            <td className="py-2 pr-3">{p.tipo_pagamento || '—'}</td>
                            <td className="py-2 pr-3 text-gray-400">{p.numero_lote || '—'} / {p.numero_lancamento || '—'}</td>
                            <td className="py-2 pr-3">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${STATUS_COR[p.status || ''] || 'bg-gray-100 text-gray-500'}`}>
                                {STATUS_LABEL[p.status || ''] || p.status || '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-gray-400">{p.motivo || '—'}</td>
                            <td className="py-2 pr-3">
                              {p.id_pagamento && (
                                <button onClick={() => verDetalhe(p.id_pagamento!)} className="text-[10px] font-black text-[#1E40AF] hover:underline uppercase">
                                  Detalhes
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {totalPaginas > 1 && (
                      <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t border-gray-100">
                        <button
                          onClick={() => irParaPagina(paginaAtual - 1)}
                          disabled={consultando || paginaAtual <= 0}
                          className="text-[10px] font-black bg-[#F8FAFC] border border-gray-300 text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg uppercase tracking-wider disabled:opacity-40"
                        >
                          ← Anterior
                        </button>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          Página {paginaAtual + 1} de {totalPaginas}
                        </span>
                        <button
                          onClick={() => irParaPagina(paginaAtual + 1)}
                          disabled={consultando || paginaAtual + 1 >= totalPaginas}
                          className="text-[10px] font-black bg-[#F8FAFC] border border-gray-300 text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg uppercase tracking-wider disabled:opacity-40"
                        >
                          Próxima →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        </>)}
      </div>

      {/* Confirmação de baixa — ação real no PrimeStart (marcarContaPagarQuitada),
          sem desfazer fácil, por isso sempre passa por esta revisão antes de disparar,
          seja baixa única ou em lote. */}
      {confirmacaoP2s && confirmacaoP2s.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setConfirmacaoP2s(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">Confirmar Baixa no PrimeStart</h3>
              <button onClick={() => setConfirmacaoP2s(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              {confirmacaoP2s.length === 1 ? 'Esta conta será marcada como quitada no PrimeStart.' : `Estas ${confirmacaoP2s.length} contas serão marcadas como quitadas no PrimeStart.`} Esta ação altera o ERP e não tem desfazer automático.
            </p>
            <div className="space-y-2 mb-4">
              {confirmacaoP2s.map(cand => (
                <div key={cand.p2sOid} className="bg-[#F8FAFC] rounded-lg p-2.5 text-xs flex justify-between gap-3">
                  <div>
                    <p className="font-bold">{cand.fornecedor || '— sem fornecedor —'}</p>
                    <p className="text-gray-400">{cand.descricao || '—'}</p>
                  </div>
                  <p className="font-bold whitespace-nowrap">{BRL(cand.valor)}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmacaoP2s(null)} className="text-xs font-black bg-[#F8FAFC] border border-gray-300 text-gray-600 hover:bg-gray-100 px-4 py-2 rounded-lg uppercase tracking-wider">
                Cancelar
              </button>
              <button onClick={() => executarBaixasP2s(confirmacaoP2s)} className="text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg uppercase tracking-wider">
                Confirmar Baixa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de detalhe — GET /pagamentos_sispag/{id}, inclui histórico de etapas */}
      {detalheId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetalheId(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider">Detalhe do Pagamento</h3>
              <button onClick={() => setDetalheId(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            {carregandoDetalhe && <p className="text-xs text-gray-400 py-6 text-center">Carregando...</p>}

            {!carregandoDetalhe && detalhe && (
              <div className="space-y-4">
                {detalhe.dados_pagamento && (
                  <div className="bg-[#F8FAFC] rounded-lg p-3">
                    <p className="text-[9px] font-black text-gray-400 uppercase mb-2">Dados do Pagamento</p>
                    <CamposGenericos objeto={detalhe.dados_pagamento} />
                  </div>
                )}
                {detalhe.dados_debito && (
                  <div className="bg-[#F8FAFC] rounded-lg p-3">
                    <p className="text-[9px] font-black text-gray-400 uppercase mb-2">Dados do Débito</p>
                    <CamposGenericos objeto={detalhe.dados_debito} />
                  </div>
                )}
                {Array.isArray(detalhe.historico_pagamento) && detalhe.historico_pagamento.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase mb-2">Histórico</p>
                    <div className="space-y-2">
                      {detalhe.historico_pagamento.map((h: any, i: number) => (
                        <div key={i} className="bg-[#F8FAFC] rounded-lg p-2.5 text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold">{h.status}</span>
                            <span className="text-gray-400">{h.data} {h.nome_operador ? `· ${h.nome_operador}` : ''}</span>
                          </div>
                          <CamposGenericos objeto={h} omitir={['status', 'data', 'nome_operador']} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Qualquer outro campo devolvido pelo Itaú que não caiu nas seções
                    acima — garante que nada do retorno da API fica escondido, mesmo
                    que a Especificação Técnica mude ou varie por tipo de pagamento. */}
                {Object.keys(detalhe).some(k => !['dados_pagamento', 'dados_debito', 'historico_pagamento'].includes(k) && detalhe[k] !== null && detalhe[k] !== undefined && detalhe[k] !== '') && (
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase mb-2">Outras Informações</p>
                    <CamposGenericos objeto={detalhe} omitir={['dados_pagamento', 'dados_debito', 'historico_pagamento']} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
