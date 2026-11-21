"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  listarRelatoriosDiretoriaAction, obterRelatorioDiretoriaAction, gerarRelatorioDiretoriaAgoraAction,
  listarAlertasDiretoriaAction, verificarAlertasAgoraAction, listarParametrosDiretoriaAction, salvarParametroDiretoriaAction,
} from './actions';
import { usePageAccess } from '../../components/hooks/usePageAccess';
import { HubErro } from '../../components/ui/HubStates';
import HubBackButton from '../../components/ui/HubBackButton';
import { useToast } from '../../components/ui/NotificationProvider';
import { corSeloEmpresa } from '../../lib/coresEmpresa';
import { formatarMoeda } from '../../lib/formatadores';
import Perguntar from './Perguntar';
import Caixa from './Caixa';
import Metas from './Metas';

// Diretor (IA) — relatórios diários e semanais por empresa, alertas de
// exceção e parâmetros dos alertas. Os NÚMEROS dos cartões vêm direto de
// `indicadores` (calculados por código em app/lib/diretoria/); só o texto é da IA.

type Area = 'FINANCEIRO' | 'COMERCIAL' | 'EXPEDICAO' | 'FROTA' | 'RH' | 'DADOS';
type Situacao = 'NORMAL' | 'ATENCAO' | 'CRITICO';
type TipoRel = 'DIARIO' | 'SEMANAL' | 'MENSAL' | 'ANUAL';
type Aba = TipoRel | 'ALERTAS' | 'CAIXA' | 'PERGUNTAR' | 'PARAMETROS';
const TIPOS_REL: TipoRel[] = ['DIARIO', 'SEMANAL', 'MENSAL', 'ANUAL'];
const ehTipoRel = (a: string): a is TipoRel => (TIPOS_REL as string[]).includes(a);

interface ItemLista {
  id: number; empresa_id: number; tipo: TipoRel; data_referencia: string; status: 'GERADO' | 'ERRO'; erro: string | null;
  situacao: Situacao | null; manchete: string | null; gerado_em: string; gerado_por: string | null; whatsapp_resultado: string | null;
}

interface Pendencia { id: string; area: Area; descricao: string; desde: string; situacao: 'ABERTA' | 'RESOLVIDA' }
interface Relatorio {
  id: number; empresa_id: number; tipo: TipoRel; data_referencia: string; status: 'GERADO' | 'ERRO'; erro: string | null;
  indicadores: any;
  conteudo: null | {
    situacao: Situacao; manchete: string; 
    pontos_de_atencao: { area: Area; gravidade: 'ALTA' | 'MEDIA' | 'BAIXA'; titulo: string; detalhe: string; acao_sugerida: string | null }[];
    secoes: { area: Area; resumo: string; itens: string[] }[];
    pendencias: Pendencia[];
    observacoes_dados: string | null;
    // só no semanal
    resumo_semana?: string; tendencias?: string[]; prioridades?: string[];
    agenda_proxima_semana?: { data: string; descricao: string }[];
    // só no mensal/anual
    resumo?: string; metas?: { meta: string; avaliacao: string }[]; caixa?: string; recomendacoes?: string[];
  };
  modelo: string | null; custo_usd: number | null; gerado_por: string | null; gerado_em: string; whatsapp_resultado: string | null;
}

interface Alerta { id: number; tipo: string; titulo: string; detalhe: string | null; valor: number | null; link: string | null; detectado_em: string; enviado_em: string | null; envio_resultado: string | null }
interface Parametro { chave: string; valor: number; rotulo: string; descricao: string | null; atualizado_em: string; atualizado_por: string | null }

const ROTULO_AREA: Record<Area, string> = { FINANCEIRO: 'Financeiro', COMERCIAL: 'Comercial', EXPEDICAO: 'Expedição', FROTA: 'Frota', RH: 'RH', DADOS: 'Dados' };
const ICONE_AREA: Record<Area, string> = { FINANCEIRO: '💰', COMERCIAL: '🤝', EXPEDICAO: '📦', FROTA: '🚚', RH: '👥', DADOS: '🗄️' };
const LINK_AREA: Partial<Record<Area, string>> = {
  FINANCEIRO: '/admin/financeiro', COMERCIAL: '/admin/comercial', EXPEDICAO: '/admin/estoque/expedicao', FROTA: '/admin/operacional/frota', RH: '/admin/rh',
};
const COR_SITUACAO: Record<Situacao, { selo: string; ponto: string; rotulo: string }> = {
  NORMAL: { selo: 'bg-emerald-100 text-emerald-700 border-emerald-200', ponto: 'bg-emerald-500', rotulo: 'Normal' },
  ATENCAO: { selo: 'bg-amber-100 text-amber-700 border-amber-200', ponto: 'bg-amber-500', rotulo: 'Atenção' },
  CRITICO: { selo: 'bg-red-100 text-red-700 border-red-200', ponto: 'bg-red-500', rotulo: 'Crítico' },
};
const COR_GRAVIDADE = { ALTA: 'border-l-red-500', MEDIA: 'border-l-amber-500', BAIXA: 'border-l-slate-300' } as const;
const TIPO_ALERTA: Record<string, { icone: string; rotulo: string }> = {
  OP_FAVORECIDO_NOVO: { icone: '🆕', rotulo: 'Favorecido novo' },
  OP_CONTA_COMPARTILHADA: { icone: '🔁', rotulo: 'Conta compartilhada' },
  OP_VALOR_ALTO: { icone: '💸', rotulo: 'OP de valor alto' },
  RECEBER_ATRASO: { icone: '⏰', rotulo: 'Cliente atrasou' },
  EXPEDICAO_SEM_RETORNO: { icone: '📦', rotulo: 'Material não voltou' },
  FROTA_FORA: { icone: '🚚', rotulo: 'Veículo fora' },
  CAIXA_SEMANA: { icone: '📉', rotulo: 'Caixa apertado' },
  MDFE_ABERTO: { icone: '🧾', rotulo: 'MDF-e aberto' },
};
// Abas de cima; "Relatórios" agrupa Diário/Semanal/Mensal/Anual (escolhidos logo abaixo).
const ABAS: { valor: 'RELATORIOS' | Exclude<Aba, TipoRel>; rotulo: string }[] = [
  { valor: 'RELATORIOS', rotulo: 'Relatórios' }, { valor: 'ALERTAS', rotulo: 'Alertas' }, { valor: 'CAIXA', rotulo: 'Caixa' }, { valor: 'PERGUNTAR', rotulo: 'Perguntar' }, { valor: 'PARAMETROS', rotulo: 'Parâmetros' },
];
const ROTULO_TIPO: Record<TipoRel, string> = { DIARIO: 'Diário', SEMANAL: 'Semanal', MENSAL: 'Mensal', ANUAL: 'Anual' };
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const BRL = formatarMoeda;
const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
const dataHora = (ts: string) => new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const somarDiasISO = (iso: string, d: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const rotuloPeriodo = (tipo: TipoRel, iso: string) => tipo === 'SEMANAL' ? `${dataCurta(iso)} a ${dataCurta(somarDiasISO(iso, 6))}`
  : tipo === 'MENSAL' ? `${MESES_CURTOS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`
  : tipo === 'ANUAL' ? iso.slice(0, 4) : dataCurta(iso);
const pct = (v: number | null | undefined) => (v == null ? 'sem base de comparação' : `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}% vs. média de 4 semanas`);

export default function DiretoriaPage() {
  const router = useRouter();
  const toast = useToast();
  const { authLoading, acessoNegado, erro, tentarNovamente, accessToken } = usePageAccess();

  const [carregando, setCarregando] = useState(true);
  const [empresas, setEmpresas] = useState<{ id: number; nome: string }[]>([]);
  const [lista, setLista] = useState<ItemLista[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [aba, setAba] = useState<Aba>('DIARIO');
  const [ultimoTipo, setUltimoTipo] = useState<TipoRel>('DIARIO');
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [parametros, setParametros] = useState<Parametro[] | null>(null);
  const [edicao, setEdicao] = useState<Record<string, string>>({});

  const abrir = async (id: number | null) => {
    setSelecionadoId(id);
    if (!id) { setRelatorio(null); return; }
    setAbrindo(true);
    const res = await obterRelatorioDiretoriaAction(id, accessToken);
    setAbrindo(false);
    if (res.ok) setRelatorio(res.info); else toast(res.erro || 'Erro ao abrir relatório.', 'error');
  };

  const carregarAlertas = async (emp: number) => {
    setAlertas(null);
    const res = await listarAlertasDiretoriaAction(emp, accessToken);
    if (res.ok) setAlertas(res.info); else { setAlertas([]); toast(res.erro || 'Erro ao carregar alertas.', 'error'); }
  };

  const carregarParametros = async () => {
    const res = await listarParametrosDiretoriaAction(accessToken);
    if (res.ok) { setParametros(res.info); setEdicao({}); } else { setParametros([]); toast(res.erro || 'Erro ao carregar parâmetros.', 'error'); }
  };

  // Abre a aba certa para a empresa, carregando o que ela precisa.
  const mostrar = (novaAba: Aba, emp: number | null, rels: ItemLista[], preferir?: { id?: number; data?: string }) => {
    setAba(novaAba);
    if (ehTipoRel(novaAba)) setUltimoTipo(novaAba);
    if (!emp) return;
    if (novaAba === 'ALERTAS') { carregarAlertas(emp); return; }
    if (novaAba === 'PARAMETROS') { if (!parametros) carregarParametros(); return; }
    if (novaAba === 'PERGUNTAR' || novaAba === 'CAIXA') return;
    const daAba = rels.filter(r => r.empresa_id === emp && r.tipo === novaAba);
    const alvo = daAba.find(r => r.id === preferir?.id) || daAba.find(r => r.data_referencia === preferir?.data) || daAba[0];
    abrir(alvo?.id ?? null);
  };

  // `carregando` nasce true e só cai depois da 1ª carga; recargas (após
  // "Gerar agora") trocam a lista no lugar, sem piscar a tela.
  const carregarLista = async (preferir?: { empresa?: number; aba?: Aba; data?: string; id?: number }) => {
    const res = await listarRelatoriosDiretoriaAction(accessToken);
    setCarregando(false);
    if (!res.ok) { toast(res.erro || 'Erro ao carregar relatórios.', 'error'); return; }
    const emp = res.info.empresas as { id: number; nome: string }[];
    const rels = res.info.relatorios as ItemLista[];
    setEmpresas(emp); setLista(rels);
    const alvoEmpresa = emp.find(e => e.id === preferir?.empresa)?.id ?? empresaId ?? emp[0]?.id ?? null;
    setEmpresaId(alvoEmpresa);
    mostrar(preferir?.aba || aba, alvoEmpresa, rels, preferir);
  };

  // ?empresa=12&tipo=SEMANAL&data=2026-11-09 — links dos e-mails. Lido do
  // location (sem useSearchParams, que exigiria Suspense na página inteira).
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    const p = new URLSearchParams(window.location.search);
    const tipo = p.get('tipo');
    carregarLista({
      empresa: Number(p.get('empresa')) || undefined,
      aba: tipo && (ehTipoRel(tipo) || ['ALERTAS', 'CAIXA', 'PERGUNTAR'].includes(tipo)) ? (tipo as Aba) : 'DIARIO',
      data: p.get('data') || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, acessoNegado]);

  const listaAba = useMemo(() => lista.filter(r => r.empresa_id === empresaId && r.tipo === aba), [lista, empresaId, aba]);
  const empresaAtual = empresas.find(e => e.id === empresaId);
  const ehRelatorio = ehTipoRel(aba);
  const ROTULO_GERAR: Record<TipoRel, string> = { DIARIO: 'o de ontem', SEMANAL: 'o da última semana', MENSAL: 'o do último mês', ANUAL: 'o do último ano' };

  const gerarAgora = async () => {
    if (!empresaId || !ehTipoRel(aba)) return;
    setGerando(true);
    const res = await gerarRelatorioDiretoriaAgoraAction(empresaId, aba, accessToken);
    setGerando(false);
    if (res.ok) toast(`Relatório gerado: ${ROTULO_GERAR[aba].replace(/^o /, '')}.`, 'success');
    else toast(res.erro || 'Falha ao gerar o relatório.', 'error');
    if (res.info?.id) await carregarLista({ empresa: empresaId, aba, id: res.info.id });
  };

  const verificarAgora = async () => {
    if (!empresaId) return;
    setVerificando(true);
    const res = await verificarAlertasAgoraAction(empresaId, accessToken);
    setVerificando(false);
    if (res.info) toast(`${res.info.novos} alerta(s) novo(s). Saem no próximo envio (12h ou 18h).`, res.ok ? 'success' : 'error');
    if (!res.ok && res.erro) toast(res.erro, 'error');
    carregarAlertas(empresaId);
  };

  const salvarParametro = async (p: Parametro) => {
    const valor = Number(String(edicao[p.chave] ?? p.valor).replace(/\./g, '').replace(',', '.'));
    const res = await salvarParametroDiretoriaAction(p.chave, valor, accessToken);
    if (res.ok) { toast('Parâmetro salvo.', 'success'); carregarParametros(); } else toast(res.erro || 'Erro ao salvar.', 'error');
  };

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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar o Diretor (IA).</p>
          <button onClick={() => router.push('/admin')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Início
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans pt-12 px-4 pb-16">
      <Analytics />
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-[#0C1D4D] uppercase tracking-tight">Diretor (IA)</h1>
            <p className="text-[#64748B] font-medium">Diário às 10h, semanal na segunda às 8h, mensal no dia 1 e anual em 1º de janeiro, alertas às 12h e 18h — de cada empresa.</p>
          </div>
          {ehRelatorio && (
            <button
              onClick={gerarAgora}
              disabled={gerando || !empresaId}
              className="bg-[#0C1D4D] text-white px-5 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors disabled:opacity-50 disabled:cursor-wait shrink-0"
              title="Calcula os números e pede à IA um relatório novo (sem enviar e-mail). Leva 1 a 2 minutos."
            >
              {gerando ? 'Gerando… (1–2 min)' : ehTipoRel(aba) ? `⟳ Gerar ${ROTULO_GERAR[aba]} agora` : ''}
            </button>
          )}
          {aba === 'ALERTAS' && (
            <button onClick={verificarAgora} disabled={verificando || !empresaId}
              className="bg-[#0C1D4D] text-white px-5 py-3 rounded-lg font-bold uppercase text-xs tracking-wider hover:bg-[#284B8C] transition-colors disabled:opacity-50 disabled:cursor-wait shrink-0"
              title="Procura alertas novos agora. O envio por e-mail continua sendo às 12h e às 18h.">
              {verificando ? 'Verificando…' : '🔎 Verificar agora'}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          {empresas.length > 1 && empresas.map(e => (
            <button
              key={e.id}
              onClick={() => { setEmpresaId(e.id); mostrar(aba, e.id, lista); }}
              className={`px-4 py-2 rounded-full text-xs font-black uppercase tracking-wider border-2 transition-all ${e.id === empresaId ? `${corSeloEmpresa(e.id)} border-current` : 'bg-white text-gray-500 border-[#E2E8F0] hover:border-[#336699]'}`}
            >
              {e.nome}
            </button>
          ))}
          <div className="flex bg-white rounded-full border border-[#E2E8F0] p-1 md:ml-auto overflow-x-auto max-w-full">
            {ABAS.map(a => {
              const ativa = a.valor === 'RELATORIOS' ? ehRelatorio : aba === a.valor;
              return (
                <button key={a.valor} onClick={() => mostrar(a.valor === 'RELATORIOS' ? ultimoTipo : a.valor, empresaId, lista)}
                  className={`px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-colors ${ativa ? 'bg-[#0C1D4D] text-white' : 'text-gray-500 hover:text-[#0C1D4D]'}`}>
                  {a.rotulo}
                </button>
              );
            })}
          </div>
        </div>

        {ehRelatorio && (
          <div className="flex gap-1 mb-4 overflow-x-auto">
            {TIPOS_REL.map(t => (
              <button key={t} onClick={() => mostrar(t, empresaId, lista)}
                className={`px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider whitespace-nowrap border transition-colors ${aba === t ? 'bg-white border-[#336699] text-[#0C1D4D]' : 'border-transparent text-gray-500 hover:text-[#0C1D4D]'}`}>
                {ROTULO_TIPO[t]}
              </button>
            ))}
          </div>
        )}

        {carregando ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-400">Carregando…</div>
        ) : empresas.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-500">Seu usuário não está vinculado a nenhuma empresa.</div>
        ) : ehRelatorio ? (
          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
            <aside className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden lg:max-h-[80vh] lg:overflow-y-auto">
              <p className="px-4 pt-4 pb-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ DIARIO: 'Dias', SEMANAL: 'Semanas', MENSAL: 'Meses', ANUAL: 'Anos' }[aba as TipoRel]} — {empresaAtual?.nome}</p>
              {listaAba.length === 0 && (
                <p className="px-4 pb-4 text-xs text-gray-500">
                  {{
                    DIARIO: 'Nenhum relatório ainda. O primeiro sai às 10h, ou clique no botão de gerar.',
                    SEMANAL: 'Nenhum relatório semanal ainda. O primeiro sai na segunda às 8h, ou clique no botão de gerar.',
                    MENSAL: 'Nenhum relatório mensal ainda. O primeiro sai no dia 1 às 8h, ou clique no botão de gerar.',
                    ANUAL: 'Nenhum relatório anual ainda. O primeiro sai em 1º de janeiro às 8h, ou clique no botão de gerar.',
                  }[aba as TipoRel]}
                </p>
              )}
              <ul className="flex lg:flex-col overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
                {listaAba.map(r => {
                  const cor = r.status === 'ERRO' ? 'bg-gray-400' : COR_SITUACAO[r.situacao || 'NORMAL'].ponto;
                  return (
                    <li key={r.id} className="shrink-0 lg:shrink">
                      <button
                        onClick={() => abrir(r.id)}
                        className={`w-56 lg:w-full text-left px-4 py-3 border-l-4 transition-colors ${r.id === selecionadoId ? 'bg-[#F0F4F8] border-[#336699]' : 'border-transparent hover:bg-slate-50'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${cor}`} />
                          <span className="text-xs font-black text-[#0C1D4D]">
                            {rotuloPeriodo(r.tipo, r.data_referencia)}
                          </span>
                          {r.tipo === 'DIARIO' && <span className="text-[10px] text-gray-400 uppercase">{diaSemana(r.data_referencia)}</span>}
                          {r.status === 'ERRO' && <span className="text-[9px] font-black text-red-600 uppercase ml-auto">erro</span>}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{r.manchete || r.erro || '—'}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
            <main className="min-w-0">
              {abrindo && !relatorio && <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-400">Abrindo…</div>}
              {relatorio && relatorio.tipo === aba && <DetalheRelatorio r={relatorio} empresaNome={empresaAtual?.nome || ''} />}
            </main>
          </div>
        ) : aba === 'ALERTAS' ? (
          <ListaAlertas alertas={alertas} />
        ) : aba === 'PERGUNTAR' ? (
          <Perguntar accessToken={accessToken} empresaTelaId={empresaId} />
        ) : aba === 'CAIXA' ? (
          empresaId ? <Caixa key={empresaId} accessToken={accessToken} empresaId={empresaId} /> : null
        ) : (
          <div className="space-y-6">
          {empresaId && <Metas key={empresaId} accessToken={accessToken} empresaId={empresaId} empresaNome={empresaAtual?.nome || ''} />}
          <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 space-y-4">
            <div>
              <p className="text-sm font-black text-[#0C1D4D]">Valores de corte dos alertas</p>
              <p className="text-xs text-gray-500">Valem para todas as empresas. Mudanças entram na próxima verificação.</p>
            </div>
            {parametros === null ? <p className="text-xs text-gray-400">Carregando…</p> : parametros.length === 0 ? (
              <p className="text-xs text-gray-500">Nenhum parâmetro cadastrado — rode o SQL .sql/Pendentes/diretoria_fase2.sql.</p>
            ) : parametros.map(p => (
              <div key={p.chave} className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-[#0C1D4D]">{p.rotulo}</p>
                  {p.descricao && <p className="text-[11px] text-gray-500">{p.descricao}</p>}
                  {p.atualizado_por && <p className="text-[10px] text-gray-400 mt-0.5">Alterado por {p.atualizado_por} em {dataHora(p.atualizado_em)}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <input type="text" inputMode="decimal" value={edicao[p.chave] ?? String(p.valor).replace('.', ',')}
                    onChange={e => setEdicao({ ...edicao, [p.chave]: e.target.value })}
                    className="w-32 p-2 border border-gray-300 rounded-lg text-xs font-bold text-right bg-gray-50 text-[#0C1D4D] outline-none focus:border-[#336699]" />
                  <button onClick={() => salvarParametro(p)} disabled={edicao[p.chave] === undefined}
                    className="bg-[#0C1D4D] text-white px-3 py-2 rounded-lg font-black uppercase text-[10px] tracking-wider hover:bg-[#284B8C] disabled:opacity-30">Salvar</button>
                </div>
              </div>
            ))}
          </section>
          </div>
        )}

        <HubBackButton />
      </div>
    </div>
  );
}

function ListaAlertas({ alertas }: { alertas: Alerta[] | null }) {
  const router = useRouter();
  if (alertas === null) return <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-gray-400">Carregando alertas…</div>;
  if (alertas.length === 0) return <div className="bg-white rounded-2xl border border-[#E2E8F0] p-10 text-center text-sm text-emerald-700 font-bold">✓ Nenhum alerta registrado para esta empresa.</div>;
  return (
    <div className="space-y-3">
      {alertas.map(a => {
        const t = TIPO_ALERTA[a.tipo] || { icone: '⚠️', rotulo: a.tipo };
        return (
          <div key={a.id} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 flex items-start gap-3">
            <span className="text-lg leading-none mt-0.5">{t.icone}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-black text-[#0C1D4D]">{a.titulo}</p>
                <span className="text-[9px] font-black text-gray-400 uppercase">{t.rotulo}</span>
              </div>
              {a.detalhe && <p className="text-sm text-gray-600 mt-1">{a.detalhe}</p>}
              <p className="text-[10px] text-gray-400 mt-2">
                Detectado {dataHora(a.detectado_em)} · {a.enviado_em ? `enviado ${dataHora(a.enviado_em)}` : a.envio_resultado || 'aguardando o próximo envio (12h ou 18h)'}
              </p>
            </div>
            {a.link && (
              <button onClick={() => { try { router.push(new URL(a.link!).pathname); } catch { router.push(a.link!); } }}
                className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:underline shrink-0">Abrir</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function numerosDiario(ind: any) {
  const f = ind.financeiro || {};
  const faixas = ['ate_30_dias', 'de_31_a_90', 'de_91_a_365'];
  const recebimentosNoP2s = f.fonte_recebimentos !== 'EXTERNA';
  return [
    ...(recebimentosNoP2s ? [
      { titulo: 'Recebido ontem', valor: BRL(f.recebido_ontem?.valor ?? 0), sub: `${f.recebido_ontem?.qtd ?? 0} título(s)` },
      { titulo: 'Recebido no mês', valor: BRL(f.recebido_mes_ate_ontem?.valor ?? 0), sub: f.variacao_pct_recebido_mes == null ? 'sem base no mês anterior' : `${f.variacao_pct_recebido_mes > 0 ? '+' : ''}${String(f.variacao_pct_recebido_mes).replace('.', ',')}% vs. mês anterior` },
      { titulo: 'A receber vencido (até 1 ano)', valor: BRL(faixas.reduce((s, k) => s + (f.receber_vencidos?.faixas_atraso?.[k]?.valor ?? 0), 0)), sub: `${faixas.reduce((s, k) => s + (f.receber_vencidos?.faixas_atraso?.[k]?.qtd ?? 0), 0)} título(s)`, alerta: (f.receber_vencidos?.faixas_atraso?.ate_30_dias?.qtd ?? 0) > 0 },
      { titulo: 'A receber 7 dias', valor: BRL(f.receber_vencendo_7d?.valor ?? 0), sub: `${f.receber_vencendo_7d?.qtd ?? 0} título(s)` },
    ] : [
      { titulo: 'Recebimentos', valor: 'Fonte externa', sub: 'não integrada ao sistema' },
    ]),
    { titulo: 'Pago ontem (P2S)', valor: BRL(f.pago_ontem_p2s?.valor ?? 0), sub: `${f.pago_ontem_p2s?.qtd ?? 0} conta(s)` },
    { titulo: 'A pagar 7 dias (P2S)', valor: BRL(f.pagar_vencendo_7d_p2s?.valor ?? 0), sub: `${f.pagar_vencendo_7d_p2s?.qtd ?? 0} conta(s)` },
    { titulo: 'OPs pendentes', valor: BRL(f.ops?.pendentes_aprovacao?.valor ?? 0), sub: `${f.ops?.pendentes_aprovacao?.qtd ?? 0} OP(s) · ${f.ops?.pendentes_aprovacao?.vencidas?.qtd ?? 0} vencida(s)`, alerta: (f.ops?.pendentes_aprovacao?.vencidas?.qtd ?? 0) > 0 },
    { titulo: 'Fichas emitidas ontem', valor: BRL(ind.comercial?.fichas_emitidas_ontem?.valor ?? 0), sub: `${ind.comercial?.fichas_emitidas_ontem?.qtd ?? 0} ficha(s)` },
    { titulo: 'Material com retorno atrasado', valor: String(ind.expedicao?.material_fora?.retorno_atrasado?.length ?? 0), sub: `${ind.expedicao?.material_fora?.qtd ?? 0} checklist(s) fora`, alerta: (ind.expedicao?.material_fora?.retorno_atrasado?.length ?? 0) > 0 },
    { titulo: 'Multas em aberto', valor: BRL(ind.frota?.multas_abertas?.valor ?? 0), sub: `${ind.frota?.multas_abertas?.qtd ?? 0} multa(s) · ${ind.frota?.multas_abertas?.prazo_indicacao_condutor_7d?.length ?? 0} com prazo ≤ 7d`, alerta: (ind.frota?.multas_abertas?.prazo_indicacao_condutor_7d?.length ?? 0) > 0 },
  ];
}

function numerosSemanal(ind: any) {
  const f = ind.financeiro || {};
  const c = ind.comercial || {};
  const recebimentosNoP2s = f.fonte_recebimentos !== 'EXTERNA';
  return [
    ...(recebimentosNoP2s ? [
      { titulo: 'Recebido na semana', valor: BRL(f.recebido_por_semana?.[0]?.valor ?? 0), sub: pct(f.variacao_pct_recebido_vs_media) },
      { titulo: 'A receber vencido (até 1 ano)', valor: BRL(f.receber_vencido_ate_1_ano_hoje?.valor ?? 0), sub: `${f.receber_vencido_ate_1_ano_hoje?.qtd ?? 0} título(s)` },
      { titulo: 'A receber na próxima semana', valor: BRL(f.proxima_semana?.a_receber?.valor ?? 0), sub: `${f.proxima_semana?.a_receber?.qtd ?? 0} título(s)` },
    ] : [
      { titulo: 'Recebimentos', valor: 'Fonte externa', sub: 'não integrada ao sistema' },
    ]),
    { titulo: 'Pago na semana (P2S)', valor: BRL(f.pago_p2s_por_semana?.[0]?.valor ?? 0), sub: `${f.pago_p2s_por_semana?.[0]?.qtd ?? 0} conta(s)` },
    { titulo: 'A pagar na próxima semana', valor: BRL(f.proxima_semana?.a_pagar_p2s?.valor ?? 0), sub: `${f.proxima_semana?.a_pagar_p2s?.qtd ?? 0} conta(s) no P2S` },
    { titulo: 'OPs criadas na semana', valor: BRL(f.ops_criadas_por_semana?.[0]?.valor ?? 0), sub: `${f.ops_criadas_por_semana?.[0]?.qtd ?? 0} OP(s)` },
    { titulo: 'Fichas emitidas na semana', valor: BRL(c.fichas_emitidas_por_semana?.[0]?.valor ?? 0), sub: pct(c.variacao_pct_fichas_valor_vs_media) },
    { titulo: 'Locações começando', valor: BRL(c.locacoes_iniciando_proxima_semana?.valor ?? 0), sub: `${c.locacoes_iniciando_proxima_semana?.qtd ?? 0} ficha(s) na próxima semana` },
    { titulo: 'Divergências de expedição', valor: String(ind.expedicao?.divergencias_semana?.qtd ?? 0), sub: `${ind.expedicao?.material_fora_agora?.com_retorno_atrasado ?? 0} checklist(s) com retorno atrasado`, alerta: (ind.expedicao?.material_fora_agora?.com_retorno_atrasado ?? 0) > 0 },
    { titulo: 'Ponto incompleto', valor: String(ind.rh?.ponto_semana?.incompletos ?? 0), sub: `de ${ind.rh?.ponto_semana?.registros ?? 0} registro(s)` },
  ];
}

function numerosPeriodo(ind: any) {
  const f = ind.financeiro || {};
  const c = ind.comercial || {};
  const mensal = ind.tipo === 'MENSAL';
  const varTxt = (v: number | null | undefined, base: string) => (v == null ? 'sem base de comparação' : `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}% vs. ${base}`);
  const anterior = mensal ? 'mês anterior' : 'ano anterior';
  return [
    ...(f.fonte_recebimentos !== 'EXTERNA' ? [
      { titulo: 'Recebido', valor: BRL(f.recebido_por_periodo?.[0]?.valor ?? 0), sub: varTxt(f.variacao_pct_recebido_vs_anterior, anterior) },
      ...(mensal ? [{ titulo: 'Recebido · mesmo mês ano anterior', valor: BRL(f.recebido_por_periodo?.[6]?.valor ?? 0), sub: varTxt(f.variacao_pct_recebido_vs_ano_anterior, 'ano anterior') }] : []),
    ] : [{ titulo: 'Recebimentos', valor: 'Fonte externa', sub: 'não integrada ao sistema' }]),
    { titulo: 'Pago (P2S)', valor: BRL(f.pago_p2s_por_periodo?.[0]?.valor ?? 0), sub: `${f.pago_p2s_por_periodo?.[0]?.qtd ?? 0} conta(s)` },
    { titulo: 'OPs criadas', valor: BRL(f.ops_por_periodo?.[0]?.valor ?? 0), sub: `${f.ops_por_periodo?.[0]?.qtd ?? 0} OP(s)` },
    { titulo: 'Fichas emitidas', valor: BRL(c.fichas_emitidas_por_periodo?.[0]?.valor ?? 0), sub: varTxt(c.variacao_pct_fichas_vs_anterior, anterior) },
    { titulo: 'Divergências de expedição', valor: String(ind.expedicao?.divergencias_no_periodo ?? 0), sub: `${ind.expedicao?.checklists_por_periodo?.[0]?.qtd ?? 0} checklist(s) criados` },
    { titulo: 'Km rodados', valor: String(Math.round(ind.frota?.km_rodados_no_periodo ?? 0)), sub: `manutenção ${BRL(ind.frota?.custo_manutencao_no_periodo ?? 0)}` },
    { titulo: 'Ponto incompleto', valor: String(ind.rh?.ponto?.incompletos ?? 0), sub: `de ${ind.rh?.ponto?.registros ?? 0} registro(s)` },
  ];
}

const COR_META: Record<string, string> = {
  ATINGIDA: 'text-emerald-700', NO_RITMO: 'text-emerald-700', DENTRO_DO_TETO: 'text-emerald-700',
  ABAIXO_DO_RITMO: 'text-amber-700', PERTO_DO_TETO: 'text-amber-700', ESTOUROU: 'text-red-600',
};
const ROTULO_SITUACAO_META: Record<string, string> = {
  ATINGIDA: 'Atingida', NO_RITMO: 'No ritmo', ABAIXO_DO_RITMO: 'Abaixo do ritmo', DENTRO_DO_TETO: 'Dentro do teto', PERTO_DO_TETO: 'Perto do teto', ESTOUROU: 'Estourou', SEM_DADO: 'Sem dado',
};

// Metas do relatório: barras calculadas por código (indicadores.metas) + a avaliação escrita pela IA (mensal/anual).
function MetasProgresso({ metas, avaliacoes }: { metas: any; avaliacoes?: { meta: string; avaliacao: string }[] }) {
  if (!metas) return null;
  if (Array.isArray(metas.meses)) {
    const comMeta = (metas.meses as any[]).filter(m => (m.metas as any[]).some(x => x.meta));
    if (!comMeta.length) return null;
    const tipos = (comMeta[0].metas as any[]).map(x => ({ tipo: x.tipo, rotulo: x.rotulo }));
    return (
      <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 overflow-x-auto">
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Metas mês a mês — realizado / meta</p>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-[10px] text-gray-400 uppercase"><th className="pb-2 pr-3">Mês</th>{tipos.map(t => <th key={t.tipo} className="pb-2 pr-3">{t.rotulo}</th>)}</tr></thead>
          <tbody>
            {comMeta.map(m => (
              <tr key={m.mes} className="border-t border-gray-100">
                <td className="py-1.5 pr-3 font-bold text-[#0C1D4D]">{MESES_CURTOS[Number(m.mes.slice(5)) - 1]}</td>
                {(m.metas as any[]).map(x => (
                  <td key={x.tipo} className={`py-1.5 pr-3 ${COR_META[x.situacao] || 'text-gray-400'}`}>
                    {x.meta ? `${BRL(x.realizado ?? 0)} / ${BRL(x.meta)} (${String(x.pct_da_meta ?? 0).replace('.', ',')}%)` : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {avaliacoes && avaliacoes.length > 0 && <ul className="mt-3 space-y-1">{avaliacoes.map((a, i) => <li key={i} className="text-xs text-gray-600"><b>{a.meta}:</b> {a.avaliacao}</li>)}</ul>}
      </section>
    );
  }
  const lista = ((metas.metas || []) as any[]).filter(m => m.meta);
  if (!lista.length) return null;
  return (
    <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Metas de {MESES_CURTOS[Number(String(metas.mes).slice(5)) - 1]}/{String(metas.mes).slice(0, 4)}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {lista.map(m => {
          const pctBarra = Math.max(0, Math.min(100, m.pct_da_meta ?? 0));
          const esperado = m.esperado_ate_agora && m.meta ? Math.min(100, (m.esperado_ate_agora / m.meta) * 100) : null;
          const cor = m.situacao === 'ESTOUROU' ? 'bg-red-500' : m.situacao === 'ABAIXO_DO_RITMO' || m.situacao === 'PERTO_DO_TETO' ? 'bg-amber-500' : 'bg-[#2a78d6]';
          return (
            <div key={m.tipo}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-black text-[#0C1D4D]">{m.rotulo}</p>
                <p className={`text-[10px] font-black uppercase ${COR_META[m.situacao] || 'text-gray-400'}`}>{ROTULO_SITUACAO_META[m.situacao] || ''}</p>
              </div>
              <div className="relative h-2 bg-[#F0F4F8] rounded-full mt-1.5" title={esperado != null ? `Ritmo esperado até agora: ${BRL(m.esperado_ate_agora)}` : undefined}>
                <div className={`h-2 rounded-full ${cor}`} style={{ width: `${pctBarra}%` }} />
                {esperado != null && !m.eh_teto && <div className="absolute top-[-3px] w-0.5 h-3.5 bg-[#0C1D4D]" style={{ left: `${esperado}%` }} />}
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {m.realizado == null ? 'Sem dado no sistema' : `${BRL(m.realizado)} de ${BRL(m.meta)} (${String(m.pct_da_meta).replace('.', ',')}%)`}
                {m.realizado != null && m.faltam != null && (m.eh_teto
                  ? (m.faltam >= 0 ? ` · cabem ${BRL(m.faltam)}` : ` · ${BRL(-m.faltam)} acima`)
                  : (m.faltam > 0 ? ` · faltam ${BRL(m.faltam)}` : ''))}
              </p>
            </div>
          );
        })}
      </div>
      {avaliacoes && avaliacoes.length > 0 && <ul className="mt-3 space-y-1">{avaliacoes.map((a, i) => <li key={i} className="text-xs text-gray-600"><b>{a.meta}:</b> {a.avaliacao}</li>)}</ul>}
    </section>
  );
}

function DetalheRelatorio({ r, empresaNome }: { r: Relatorio; empresaNome: string }) {
  const router = useRouter();
  const c = r.conteudo;
  const ind = r.indicadores || {};
  const semanal = r.tipo === 'SEMANAL';
  const fechamento = r.tipo === 'MENSAL' || r.tipo === 'ANUAL';
  const situacao = c ? COR_SITUACAO[c.situacao] : null;
  const pendAbertas = (c?.pendencias || []).filter(p => p.situacao === 'ABERTA');
  const pendResolvidas = (c?.pendencias || []).filter(p => p.situacao === 'RESOLVIDA');
  const periodo = semanal ? `Semana de ${dataCurta(r.data_referencia)} a ${dataCurta(somarDiasISO(r.data_referencia, 6))}`
    : r.tipo === 'MENSAL' ? new Date(`${r.data_referencia}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : r.tipo === 'ANUAL' ? `Ano de ${r.data_referencia.slice(0, 4)}`
    : new Date(`${r.data_referencia}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });
  const numeros: { titulo: string; valor: string; sub: string; alerta?: boolean }[] = fechamento ? numerosPeriodo(ind) : semanal ? numerosSemanal(ind) : numerosDiario(ind);
  const prioridades = c?.prioridades ?? c?.recomendacoes ?? [];
  const tituloPrioridades = semanal ? 'Prioridades da semana' : r.tipo === 'ANUAL' ? 'Recomendações para o ano que começa' : 'Para o mês que começa';

  return (
    <div className="space-y-5">
      <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase ${corSeloEmpresa(r.empresa_id)}`}>{empresaNome}</span>
          <span className="text-xs font-bold text-gray-500 capitalize">{periodo}</span>
          {situacao && <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase border ${situacao.selo}`}>{situacao.rotulo}</span>}
        </div>
        {c ? (
          <>
            <h2 className="text-xl md:text-2xl font-black text-[#0C1D4D] leading-snug">{c.manchete}</h2>
            {(c.resumo_semana || c.resumo) && <p className="text-sm text-gray-600 mt-3">{c.resumo_semana || c.resumo}</p>}
          </>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm font-black text-red-700">A IA não conseguiu escrever este relatório.</p>
            <p className="text-xs text-red-600 mt-1">{r.erro}</p>
            <p className="text-xs text-gray-500 mt-2">Os números abaixo foram calculados normalmente. Use o botão de gerar para tentar de novo.</p>
          </div>
        )}
      </section>

      <section>
        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">{{ DIARIO: 'Números do dia', SEMANAL: 'Números da semana', MENSAL: 'Números do mês', ANUAL: 'Números do ano' }[r.tipo]}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {numeros.map(n => (
            <div key={n.titulo} className={`bg-white p-4 rounded-2xl border shadow-sm min-w-0 ${n.alerta ? 'border-red-200' : 'border-[#E2E8F0]'}`}>
              <p className={`text-base font-black leading-tight truncate ${n.alerta ? 'text-red-600' : 'text-[#0C1D4D]'}`} title={n.valor}>{n.valor}</p>
              <p className="text-[9px] font-black text-gray-500 uppercase tracking-wider leading-tight mt-1">{n.titulo}</p>
              <p className="text-[10px] text-gray-400 font-medium mt-1 truncate" title={n.sub}>{n.sub}</p>
            </div>
          ))}
        </div>
      </section>

      <MetasProgresso metas={ind.metas} avaliacoes={c?.metas} />

      {c && fechamento && c.caixa && (
        <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Caixa — próximos 30/60/90 dias</p>
          <p className="text-sm text-gray-600">{c.caixa}</p>
        </section>
      )}

      {c && (semanal || fechamento) && (prioridades.length > 0 || (c.tendencias || []).length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {prioridades.length > 0 && (
            <div className="bg-[#0C1D4D] text-white rounded-2xl shadow-sm p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-2">{tituloPrioridades}</p>
              <ol className="space-y-1.5">
                {prioridades.map((p, i) => <li key={i} className="text-sm flex gap-2"><span className="font-black text-white/60">{i + 1}.</span><span>{p}</span></li>)}
              </ol>
            </div>
          )}
          {(c.tendencias || []).length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Tendências</p>
              <ul className="space-y-1">
                {(c.tendencias || []).map((t, i) => <li key={i} className="text-xs text-gray-600 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-gray-400">{t}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {c && (
        <section>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Pontos de atenção</p>
          {c.pontos_de_atencao.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 text-sm text-emerald-700 font-bold">✓ Nada fora do normal {semanal ? 'nesta semana' : 'neste dia'}.</div>
          ) : (
            <div className="space-y-3">
              {c.pontos_de_atencao.map((p, i) => (
                <div key={i} className={`bg-white rounded-2xl border border-[#E2E8F0] border-l-4 ${COR_GRAVIDADE[p.gravidade]} shadow-sm p-4`}>
                  <div className="flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">{ICONE_AREA[p.area]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-black text-[#0C1D4D]">{p.titulo}</p>
                        <span className="text-[9px] font-black text-gray-400 uppercase">{ROTULO_AREA[p.area]} · {p.gravidade.toLowerCase()}</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{p.detalhe}</p>
                      {p.acao_sugerida && <p className="text-xs text-[#284B8C] font-bold mt-2">→ {p.acao_sugerida}</p>}
                    </div>
                    {LINK_AREA[p.area] && (
                      <button onClick={() => router.push(LINK_AREA[p.area]!)} className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:underline shrink-0">Abrir</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {c && semanal && (c.agenda_proxima_semana || []).length > 0 && (
        <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Agenda da semana que começa</p>
          <ul className="space-y-2">
            {(c.agenda_proxima_semana || []).map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="text-xs font-black text-[#0C1D4D] w-16 shrink-0">{/^\d{4}-\d{2}-\d{2}$/.test(a.data) ? `${dataCurta(a.data)} ${diaSemana(a.data)}` : a.data}</span>
                <span className="text-gray-600">{a.descricao}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {c && c.secoes.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {c.secoes.map((s, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
              <p className="text-xs font-black text-[#0C1D4D] uppercase tracking-wider mb-1">{ICONE_AREA[s.area]} {ROTULO_AREA[s.area]}</p>
              <p className="text-sm text-gray-600">{s.resumo}</p>
              {s.itens.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {s.itens.map((item, j) => <li key={j} className="text-xs text-gray-600 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-gray-400">{item}</li>)}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {c && (pendAbertas.length > 0 || pendResolvidas.length > 0) && (
        <section className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Pendências que o diretor está acompanhando</p>
          <ul className="space-y-2">
            {pendAbertas.map(p => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                <span className="text-amber-500 mt-0.5">●</span>
                <span className="flex-1 text-gray-700">{p.descricao}</span>
                <span className="text-[10px] text-gray-400 font-bold shrink-0">desde {dataCurta(p.desde)}</span>
              </li>
            ))}
            {pendResolvidas.map(p => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                <span className="text-emerald-500 mt-0.5">✓</span>
                <span className="flex-1 text-gray-400 line-through">{p.descricao}</span>
                <span className="text-[10px] text-emerald-600 font-bold shrink-0">resolvida</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(c?.observacoes_dados || (ind.avisos || []).length > 0) && (
        <section className="bg-slate-50 rounded-2xl border border-[#E2E8F0] p-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Sobre os dados</p>
          {c?.observacoes_dados && <p className="text-xs text-gray-600 mb-2">{c.observacoes_dados}</p>}
          <ul className="space-y-1">
            {(ind.avisos || []).map((a: string, i: number) => <li key={i} className="text-[11px] text-gray-500">• {a}</li>)}
          </ul>
        </section>
      )}

      <p className="text-[10px] text-gray-400">
        Gerado {r.gerado_por === 'CRON' ? 'automaticamente' : `por ${r.gerado_por}`} em {new Date(r.gerado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
        {r.modelo && ` · ${r.modelo}`}
        {r.custo_usd != null && ` · US$ ${Number(r.custo_usd).toFixed(4)}`}
        {r.whatsapp_resultado && ` · Envio: ${r.whatsapp_resultado}`}
      </p>
    </div>
  );
}
