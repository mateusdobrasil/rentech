"use client";

// Escala de Trabalho: o coordenador escolhe empresa + departamento + data,
// vê os colaboradores daquele departamento e arrasta cada um até o local de
// trabalho do dia, definindo o horário de chegada. Funciona no celular
// (dnd-kit com PointerSensor unifica mouse e toque — ver nota no sensor
// abaixo). Escala é por dia (não é modelo semanal fixo); "Copiar de ontem"
// cobre a rotina que se repete sem precisar remontar tudo.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Analytics } from "@vercel/analytics/next";
import {
  DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { supabase } from '../../../lib/supabase';
import {
  listarLocaisAction, criarLocalAction, listarEscalaDiaAction, salvarAlocacaoAction,
  removerAlocacaoAction, copiarEscalaAction, notificarColaboradoresAction,
  listarContextoLocaisDiaAction, salvarContextoLocalAction, removerLocalDiaAction,
  listarDiasComEscalaAction, listarTiposAction, criarTipoAction,
} from '../actions/actions-escala';
import { gerarImagemEscala } from './gerarImagemEscala';
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { ehAdministradorGlobal } from '../../../lib/permissoes';
import { HubErro } from '../../../components/ui/HubStates';
import { useToast, usePrompt } from '../../../components/ui/NotificationProvider';
import logoColorido from '../../../imgs/logo.png';

interface Empresa { id: number; nome: string; }
interface Funcionario { nome_completo: string; cargo: string | null; departamento: string | null; empresa_id: number | null; ativo: boolean; }
interface Local { id: string; nome: string; }
interface TipoEscala { id: string; nome: string; }
interface Alocacao {
  id: string; empresa_id: number; data: string; funcionario_nome: string; departamento: string | null;
  local_id: string | null; local_nome: string; horario: string; observacao: string | null; criado_por: string | null;
  confirmado_em: string | null; notificado_em: string | null;
}
interface ContextoLocalDia {
  id: string; empresa_id: number; data: string; local_id: string;
  horario_padrao: string | null; tipo_id: string | null; tipo_nome: string | null;
  evento: string | null; responsavel: string | null;
}
type CampoContexto = 'horario_padrao' | 'evento' | 'responsavel';

const hojeStr = () => new Date().toISOString().slice(0, 10);
const diaAnterior = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() - 1);
  return dt.toISOString().slice(0, 10);
};
const fmtDataExtenso = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const maisComum = (valores: (string | undefined)[]): string | null => {
  const contagem = new Map<string, number>();
  valores.forEach(v => { if (v) contagem.set(v, (contagem.get(v) || 0) + 1); });
  let melhor: string | null = null, max = 0;
  contagem.forEach((n, v) => { if (n > max) { max = n; melhor = v; } });
  return melhor;
};

function FuncionarioCard({ nome, cargo, arrastando, confirmado, notificado }: {
  nome: string; cargo?: string | null; arrastando?: boolean; confirmado?: boolean; notificado?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `func:${nome}` });
  return (
    <div
      ref={setNodeRef} {...listeners} {...attributes}
      className={`touch-none select-none cursor-grab active:cursor-grabbing bg-white rounded-xl border px-3 py-2 shadow-sm transition-opacity ${
        isDragging || arrastando ? 'opacity-30 border-[#336699]' : 'border-[#E2E8F0]'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-sm font-bold text-[#0C1D4D] truncate">{nome}</p>
        {/* Sem notificação ainda: sem ícone (evita poluir antes do 1º envio).
            Notificado mas sem confirmar: 📨. Confirmou: ✅. */}
        {confirmado ? (
          <span title="Confirmou ciência da escala" className="text-xs shrink-0 text-emerald-500">✅</span>
        ) : notificado ? (
          <span title="Notificado por WhatsApp — ainda não confirmou" className="text-xs shrink-0 text-sky-500">📨</span>
        ) : null}
      </div>
      {cargo && <p className="text-[10px] text-gray-400 font-medium truncate">{cargo}</p>}
    </div>
  );
}

function Pool({ funcionarios }: { funcionarios: Funcionario[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border-2 p-3 mb-6 transition-colors ${isOver ? 'border-[#336699] bg-blue-50' : 'border-dashed border-[#CBD5E1] bg-white'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wide">Sem local definido hoje</h3>
        <span className="text-[10px] font-bold text-gray-400">{funcionarios.length}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {funcionarios.map(f => <FuncionarioCard key={f.nome_completo} nome={f.nome_completo} cargo={f.cargo} />)}
        {funcionarios.length === 0 && <p className="text-[10px] text-gray-400 py-2">Todo mundo do departamento já está alocado hoje.</p>}
      </div>
    </div>
  );
}

function LocalColuna({
  local, contexto, itens, tipos, onHorarioChange, onRemover, onContextoChange, onTipoChange, onCriarTipo, onRemoverLocalDia, salvandoId,
}: {
  local: Local; contexto: ContextoLocalDia | undefined; itens: Alocacao[]; tipos: TipoEscala[];
  onHorarioChange: (a: Alocacao, horario: string) => void; onRemover: (a: Alocacao) => void;
  onContextoChange: (localId: string, campo: CampoContexto, valor: string) => void;
  onTipoChange: (localId: string, tipoId: string | null, tipoNome: string | null) => void;
  onCriarTipo: (localId: string) => void;
  onRemoverLocalDia: (localId: string) => void;
  salvandoId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `local:${local.id}` });
  const responsavelForaDaLista = contexto?.responsavel && !itens.some(a => a.funcionario_nome === contexto.responsavel);
  return (
    <div
      ref={setNodeRef}
      className={`rounded-2xl border-2 p-3 min-h-[140px] transition-colors ${isOver ? 'border-[#336699] bg-blue-50' : 'border-dashed border-[#CBD5E1] bg-[#F8FAFC]'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-black text-[#0C1D4D] uppercase tracking-wide truncate">📍 {local.nome}</h3>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {itens.length > 0 && (
            <span className="text-[10px] font-bold text-emerald-600" title="Confirmaram ciência da escala">
              ✅ {itens.filter(a => a.confirmado_em).length}/{itens.length}
            </span>
          )}
          {itens.length === 0 && (
            <button
              onClick={() => onRemoverLocalDia(local.id)} title="Tirar esse local da escala de hoje"
              className="text-gray-300 hover:text-red-500 text-xs font-black"
            >✕</button>
          )}
        </div>
      </div>

      {/* Contexto do local NAQUELE DIA — horário padrão se propaga pra todo
          mundo já alocado ali (exceção pontual: editar o horário direto no
          card do colaborador, mais abaixo); tipo/evento/responsável não têm
          exceção por colaborador. */}
      <div className="grid grid-cols-2 gap-1.5 mb-3 bg-white rounded-lg border border-[#E2E8F0] p-2">
        <div>
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Horário padrão</label>
          <input
            type="time" defaultValue={contexto?.horario_padrao?.slice(0, 5) || ''}
            onBlur={e => onContextoChange(local.id, 'horario_padrao', e.target.value)}
            className="w-full text-xs border border-[#E2E8F0] rounded p-1 mt-0.5"
          />
        </div>
        <div>
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Tipo</label>
          <select
            value={contexto?.tipo_id || ''}
            onChange={e => {
              if (e.target.value === '__novo__') { onCriarTipo(local.id); return; }
              const tipo = tipos.find(t => t.id === e.target.value);
              onTipoChange(local.id, tipo?.id || null, tipo?.nome || null);
            }}
            className="w-full text-xs border border-[#E2E8F0] rounded p-1 mt-0.5"
          >
            <option value="">—</option>
            {tipos.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            <option value="__novo__">+ Novo tipo...</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Evento</label>
          <input
            type="text" defaultValue={contexto?.evento || ''} placeholder="Ex: Rock in Rio"
            onBlur={e => onContextoChange(local.id, 'evento', e.target.value)}
            className="w-full text-xs border border-[#E2E8F0] rounded p-1 mt-0.5"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Responsável</label>
          <select
            value={contexto?.responsavel || ''}
            onChange={e => onContextoChange(local.id, 'responsavel', e.target.value)}
            className="w-full text-xs border border-[#E2E8F0] rounded p-1 mt-0.5"
          >
            <option value="">{itens.length === 0 ? 'Aloque alguém primeiro' : '—'}</option>
            {itens.map(a => <option key={a.funcionario_nome} value={a.funcionario_nome}>{a.funcionario_nome}</option>)}
            {responsavelForaDaLista && (
              <option value={contexto!.responsavel!}>⚠️ {contexto!.responsavel} (não está mais aqui)</option>
            )}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {itens.map(a => (
          <div key={a.id} className="bg-white rounded-lg border border-[#E2E8F0] p-2">
            <FuncionarioCard nome={a.funcionario_nome} cargo={a.departamento} confirmado={!!a.confirmado_em} notificado={!!a.notificado_em} />
            <div className="flex items-center gap-2 mt-2">
              <input
                type="time" value={a.horario?.slice(0, 5) || ''} disabled={salvandoId === a.id}
                onChange={e => onHorarioChange(a, e.target.value)}
                className="flex-1 text-xs border border-[#E2E8F0] rounded-lg p-1.5 disabled:opacity-50"
              />
              <button
                onClick={() => onRemover(a)} title="Remover da escala"
                className="text-red-400 hover:text-red-600 text-sm font-black px-2 shrink-0"
              >✕</button>
            </div>
          </div>
        ))}
        {itens.length === 0 && <p className="text-[10px] text-gray-400 text-center py-4">Arraste um colaborador aqui</p>}
      </div>
    </div>
  );
}

const NOMES_DIA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Aba "Escalas Montadas": calendário do mês (empresa selecionada), com o
// total de colaboradores alocados em cada dia. Substituiu um popover
// pequeno de calendário que o usuário achou pouco prático — isso aqui é uma
// tela própria, cabe mais informação e dá pra tocar num dia direto pra abrir
// a escala dele.
function CalendarioEscalasMontadas({
  data, mesAno, diasComEscala, onSelecionarDia, onMudarMes,
}: {
  data: string; mesAno: { ano: number; mes: number }; diasComEscala: Map<string, number>;
  onSelecionarDia: (dia: string) => void; onMudarMes: (ano: number, mes: number) => void;
}) {
  const { ano, mes } = mesAno; // mes: 1-12
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const celulas: (number | null)[] = [...Array(primeiroDiaSemana).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)];
  const fmtDia = (dia: number) => `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const hoje = hojeStr();

  const mudarMes = (delta: number) => {
    const novo = new Date(ano, mes - 1 + delta, 1);
    onMudarMes(novo.getFullYear(), novo.getMonth() + 1);
  };

  const totalDias = diasComEscala.size;
  const totalAlocacoes = Array.from(diasComEscala.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={() => mudarMes(-1)} className="w-9 h-9 rounded-lg border border-[#E2E8F0] text-gray-500 hover:bg-[#F8FAFC] font-black shrink-0">‹</button>
        <div className="text-center">
          <h2 className="text-base md:text-lg font-black text-[#0C1D4D] uppercase tracking-wide">
            {new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </h2>
          <p className="text-[10px] text-gray-400 font-bold uppercase">
            {totalDias} dia(s) com escala · {totalAlocacoes} alocação(ões) no mês
          </p>
        </div>
        <button type="button" onClick={() => mudarMes(1)} className="w-9 h-9 rounded-lg border border-[#E2E8F0] text-gray-500 hover:bg-[#F8FAFC] font-black shrink-0">›</button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center mb-1.5">
        {NOMES_DIA_SEMANA.map((d, i) => <span key={i} className="text-[9px] font-black text-gray-400 uppercase">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {celulas.map((dia, i) => {
          if (dia === null) return <span key={i} />;
          const diaStr = fmtDia(dia);
          const quantidade = diasComEscala.get(diaStr) || 0;
          const temEscala = quantidade > 0;
          const selecionado = diaStr === data;
          const ehHoje = diaStr === hoje;
          return (
            <button
              type="button" key={i} onClick={() => onSelecionarDia(diaStr)}
              className={`relative min-h-[52px] md:min-h-[64px] rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                selecionado
                  ? 'bg-[#336699] border-[#336699] text-white'
                  : temEscala
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:border-emerald-400'
                    : 'border-transparent text-gray-500 hover:bg-gray-50'
              } ${ehHoje && !selecionado ? 'ring-2 ring-[#336699]/40' : ''}`}
            >
              <span className="text-sm font-black">{dia}</span>
              {temEscala && (
                <span className={`text-[9px] font-black px-1.5 rounded-full ${selecionado ? 'bg-white/20' : 'bg-emerald-500 text-white'}`}>
                  {quantidade}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-gray-400 font-medium mt-4">
        O número no dia é quantas alocações existem nele. Toque num dia pra abrir e montar/editar a escala dele.
      </p>
    </div>
  );
}

export default function EscalaPage() {
  const router = useRouter();
  const toast = useToast();
  const prompt = usePrompt();
  const { usuarioAtual, permissaoBruta, authLoading, acessoNegado, erro, tentarNovamente, accessToken } =
    usePageAccess({ nomeFallback: 'Coordenador' });

  const [empresasCatalogo, setEmpresasCatalogo] = useState<Empresa[]>([]);
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [departamentosCatalogo, setDepartamentosCatalogo] = useState<string[]>([]);
  const [tiposCatalogo, setTiposCatalogo] = useState<TipoEscala[]>([]);
  const [departamento, setDepartamento] = useState('');
  const [data, setData] = useState(hojeStr());
  const [aba, setAba] = useState<'montar' | 'calendario'>('montar');
  const [mesCalendario, setMesCalendario] = useState(() => {
    const hoje = new Date();
    return { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
  });
  const [diasComEscala, setDiasComEscala] = useState<Map<string, number>>(new Map());

  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [locais, setLocais] = useState<Local[]>([]);
  const [alocacoes, setAlocacoes] = useState<Alocacao[]>([]);
  const [contextos, setContextos] = useState<Map<string, ContextoLocalDia>>(new Map());
  const [carregandoEscala, setCarregandoEscala] = useState(false);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [novoLocalAberto, setNovoLocalAberto] = useState(false);
  const [novoLocalNome, setNovoLocalNome] = useState('');
  const [criandoLocal, setCriandoLocal] = useState(false);
  const [copiando, setCopiando] = useState(false);
  const [compartilhando, setCompartilhando] = useState(false);
  const [notificando, setNotificando] = useState(false);
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);

  // Pré-carrega o logo uma vez — usado só na hora de desenhar a imagem
  // exportável (gerarImagemEscala.ts). Se falhar, a imagem sai sem logo.
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setLogoImg(img);
    img.onerror = () => setLogoImg(null);
    img.src = logoColorido.src;
  }, []);

  const sensors = useSensors(
    // PointerSensor sozinho cobre mouse e toque (Pointer Events) — dnd-kit
    // recomenda não misturar com TouchSensor pra não disparar drag em
    // duplicidade. touch-none nos cards (FuncionarioCard) impede o navegador
    // de competir com o gesto de arrastar no celular.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Catálogos base: empresas permitidas, departamentos e funcionários — uma vez, após liberado o acesso.
  useEffect(() => {
    if (authLoading || acessoNegado) return;
    (async () => {
      if (ehAdministradorGlobal(permissaoBruta)) {
        setEmpresasPermitidas(null);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: vinculos } = await supabase
            .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
          setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
        }
      }
      const [{ data: empresasData }, { data: departamentosData }, { data: funcData }, resTipos] = await Promise.all([
        supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome'),
        supabase.from('folha_departamento').select('nome').order('nome'),
        supabase.from('folha_funcionarios').select('nome_completo, cargo, departamento, empresa_id, ativo').eq('ativo', true).order('nome_completo'),
        listarTiposAction(accessToken),
      ]);
      setEmpresasCatalogo(empresasData || []);
      setDepartamentosCatalogo((departamentosData || []).map(d => d.nome));
      setFuncionarios((funcData || []) as Funcionario[]);
      if (resTipos.ok) setTiposCatalogo(resTipos.info.tipos);
    })();
  }, [authLoading, acessoNegado, permissaoBruta, accessToken]);

  const empresasVisiveis = useMemo(
    () => empresasPermitidas === null ? empresasCatalogo : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id)),
    [empresasCatalogo, empresasPermitidas]
  );

  const carregarLocais = useCallback(async () => {
    if (!empresaId) return;
    const res = await listarLocaisAction({ empresaId }, accessToken);
    if (res.ok) setLocais(res.info.locais);
  }, [empresaId, accessToken]);

  const carregarEscala = useCallback(async () => {
    if (!empresaId) return;
    setCarregandoEscala(true);
    try {
      const [resAlocacoes, resContextos] = await Promise.all([
        listarEscalaDiaAction({ empresaId, data }, accessToken),
        listarContextoLocaisDiaAction({ empresaId, data }, accessToken),
      ]);
      if (resAlocacoes.ok) setAlocacoes(resAlocacoes.info.alocacoes);
      else toast('Erro ao carregar escala: ' + resAlocacoes.erro, 'error');

      if (resContextos.ok) {
        const mapa = new Map<string, ContextoLocalDia>();
        (resContextos.info.contextos as ContextoLocalDia[]).forEach(c => mapa.set(c.local_id, c));
        setContextos(mapa);
      }
    } finally {
      setCarregandoEscala(false);
    }
  }, [empresaId, data, accessToken, toast]);

  useEffect(() => { carregarLocais(); }, [carregarLocais]);
  useEffect(() => { carregarEscala(); }, [carregarEscala]);

  // Dias com escala do mês em exibição na aba "Escalas Montadas" — recarrega
  // ao trocar de empresa ou navegar de mês dentro do calendário.
  const carregarDiasComEscala = useCallback(async () => {
    if (!empresaId) return;
    const res = await listarDiasComEscalaAction({ empresaId, ano: mesCalendario.ano, mes: mesCalendario.mes }, accessToken);
    if (res.ok) {
      const mapa = new Map<string, number>();
      (res.info.dias as { dia: string; quantidade: number }[]).forEach(d => mapa.set(d.dia, d.quantidade));
      setDiasComEscala(mapa);
    }
  }, [empresaId, mesCalendario, accessToken]);

  useEffect(() => { carregarDiasComEscala(); }, [carregarDiasComEscala]);

  const abrirAbaCalendario = () => {
    const dt = new Date(data + 'T00:00:00');
    setMesCalendario({ ano: dt.getFullYear(), mes: dt.getMonth() + 1 });
    setAba('calendario');
  };

  const selecionarDiaCalendario = (dia: string) => {
    setData(dia);
    setAba('montar');
  };

  const funcionariosDoDepartamento = useMemo(
    () => funcionarios.filter(f => f.empresa_id === empresaId && f.departamento === departamento && f.ativo),
    [funcionarios, empresaId, departamento]
  );
  const alocadosPorNome = useMemo(() => new Set(alocacoes.map(a => a.funcionario_nome)), [alocacoes]);
  const poolFuncionarios = useMemo(
    () => funcionariosDoDepartamento.filter(f => !alocadosPorNome.has(f.nome_completo)),
    [funcionariosDoDepartamento, alocadosPorNome]
  );
  const alocacoesPorLocal = useMemo(() => {
    const mapa = new Map<string, Alocacao[]>();
    alocacoes.forEach(a => {
      if (!a.local_id) return;
      mapa.set(a.local_id, [...(mapa.get(a.local_id) || []), a]);
    });
    return mapa;
  }, [alocacoes]);

  // Só mostra como coluna o local que já tem alocação ou contexto salvo
  // nesse dia — o catálogo (locais) pode acumular dezenas de locais ao
  // longo do tempo, mas a tela de um dia só precisa mostrar os que estão
  // em uso. "+ Adicionar Local" deixa escolher entre os que faltam.
  const locaisAtivosHoje = useMemo(
    () => locais.filter(l => alocacoesPorLocal.has(l.id) || contextos.has(l.id)),
    [locais, alocacoesPorLocal, contextos]
  );
  const locaisDisponiveis = useMemo(() => {
    const ativosIds = new Set(locaisAtivosHoje.map(l => l.id));
    return locais.filter(l => !ativosIds.has(l.id));
  }, [locais, locaisAtivosHoje]);

  const handleHorarioChange = async (a: Alocacao, horario: string) => {
    if (!empresaId || !horario) return;
    setSalvandoId(a.id);
    setAlocacoes(prev => prev.map(x => x.id === a.id ? { ...x, horario } : x));
    const res = await salvarAlocacaoAction({
      empresaId, data, funcionarioNome: a.funcionario_nome, departamento: a.departamento,
      localId: a.local_id!, localNome: a.local_nome, horario, criadoPor: usuarioAtual,
    }, accessToken);
    setSalvandoId(null);
    if (!res.ok) { toast('Erro ao salvar horário: ' + res.erro, 'error'); carregarEscala(); }
  };

  const handleContextoChange = async (localId: string, campo: CampoContexto, valor: string) => {
    if (!empresaId) return;
    const valorFinal = valor.trim() ? valor.trim() : null;

    setContextos(prev => {
      const atual = prev.get(localId);
      const novo: ContextoLocalDia = {
        id: atual?.id || '', empresa_id: empresaId, data, local_id: localId,
        horario_padrao: atual?.horario_padrao ?? null, tipo_id: atual?.tipo_id ?? null, tipo_nome: atual?.tipo_nome ?? null,
        evento: atual?.evento ?? null, responsavel: atual?.responsavel ?? null,
        [campo]: valorFinal,
      };
      const mapa = new Map(prev);
      mapa.set(localId, novo);
      return mapa;
    });

    // Horário padrão se propaga na hora pra todo mundo já alocado nesse
    // local — cards individuais (controlados) refletem isso imediatamente.
    if (campo === 'horario_padrao' && valorFinal) {
      setAlocacoes(prev => prev.map(a => a.local_id === localId ? { ...a, horario: valorFinal } : a));
    }

    const res = await salvarContextoLocalAction({
      empresaId, data, localId,
      horarioPadrao: campo === 'horario_padrao' ? valorFinal : undefined,
      evento: campo === 'evento' ? valorFinal : undefined,
      responsavel: campo === 'responsavel' ? valorFinal : undefined,
    }, accessToken);
    if (!res.ok) { toast('Erro ao salvar: ' + res.erro, 'error'); carregarEscala(); }
  };

  const handleTipoChange = async (localId: string, tipoId: string | null, tipoNome: string | null) => {
    if (!empresaId) return;

    setContextos(prev => {
      const atual = prev.get(localId);
      const novo: ContextoLocalDia = {
        id: atual?.id || '', empresa_id: empresaId, data, local_id: localId,
        horario_padrao: atual?.horario_padrao ?? null, tipo_id: tipoId, tipo_nome: tipoNome,
        evento: atual?.evento ?? null, responsavel: atual?.responsavel ?? null,
      };
      const mapa = new Map(prev);
      mapa.set(localId, novo);
      return mapa;
    });

    const res = await salvarContextoLocalAction({ empresaId, data, localId, tipoId, tipoNome }, accessToken);
    if (!res.ok) { toast('Erro ao salvar tipo: ' + res.erro, 'error'); carregarEscala(); }
  };

  // "+ Novo tipo..." no select — cadastra no catálogo (escala_tipo) e já
  // aplica no local em questão, sem precisar de tela própria pra isso.
  const criarTipoInline = async (localId: string) => {
    const nome = await prompt({ title: 'Novo tipo de escala', message: 'Nome do tipo (ex: Manutenção)', placeholder: 'Ex: Manutenção' });
    if (!nome || !nome.trim()) return;
    const res = await criarTipoAction({ nome: nome.trim() }, accessToken);
    if (!res.ok) { toast('Erro ao criar tipo: ' + res.erro, 'error'); return; }
    const novoTipo = res.info.tipo as TipoEscala;
    setTiposCatalogo(prev => [...prev, novoTipo].sort((a, b) => a.nome.localeCompare(b.nome)));
    await handleTipoChange(localId, novoTipo.id, novoTipo.nome);
  };

  const handleRemover = async (a: Alocacao) => {
    if (!empresaId) return;
    setAlocacoes(prev => prev.filter(x => x.id !== a.id));
    const res = await removerAlocacaoAction({ id: a.id, empresaId }, accessToken);
    if (!res.ok) { toast('Erro ao remover: ' + res.erro, 'error'); carregarEscala(); }
  };

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !empresaId) return;
    const nome = String(active.id).replace(/^func:/, '');
    const overId = String(over.id);
    const existente = alocacoes.find(a => a.funcionario_nome === nome);

    if (overId === 'pool') {
      if (!existente) return;
      setAlocacoes(prev => prev.filter(a => a.id !== existente.id));
      const res = await removerAlocacaoAction({ id: existente.id, empresaId }, accessToken);
      if (!res.ok) { toast('Erro ao remover: ' + res.erro, 'error'); carregarEscala(); }
      return;
    }

    if (!overId.startsWith('local:')) return;
    const localId = overId.slice('local:'.length);
    if (existente?.local_id === localId) return;
    const local = locais.find(l => l.id === localId);
    if (!local) return;

    const funcionario = funcionarios.find(f => f.nome_completo === nome);
    const horario = existente?.horario?.slice(0, 5)
      || contextos.get(localId)?.horario_padrao?.slice(0, 5)
      || maisComum((alocacoesPorLocal.get(localId) || []).map(a => a.horario?.slice(0, 5)))
      || '07:00';

    const res = await salvarAlocacaoAction({
      empresaId, data, funcionarioNome: nome, departamento: departamento || funcionario?.departamento || null,
      localId, localNome: local.nome, horario, criadoPor: usuarioAtual,
    }, accessToken);
    if (!res.ok) { toast('Erro ao alocar: ' + res.erro, 'error'); return; }
    setAlocacoes(prev => [...prev.filter(a => a.funcionario_nome !== nome), res.info.alocacao]);
  };

  // Deixa um local do catálogo (já cadastrado, mas ainda não usado hoje)
  // aparecer como coluna nesse dia — cria uma linha "em branco" em
  // escala_locais_dia (reaproveita salvarContextoLocalAction sem nenhum
  // campo, que já faz upsert com os defaults).
  const ativarLocalHoje = async (local: Local) => {
    if (!empresaId) return;
    setContextos(prev => {
      if (prev.has(local.id)) return prev;
      const mapa = new Map(prev);
      mapa.set(local.id, { id: '', empresa_id: empresaId, data, local_id: local.id, horario_padrao: null, tipo_id: null, tipo_nome: null, evento: null, responsavel: null });
      return mapa;
    });
    setNovoLocalAberto(false);
    const res = await salvarContextoLocalAction({ empresaId, data, localId: local.id }, accessToken);
    if (!res.ok) { toast('Erro ao adicionar local: ' + res.erro, 'error'); carregarEscala(); }
  };

  const removerLocalDoDia = async (localId: string) => {
    if (!empresaId) return;
    setContextos(prev => { const mapa = new Map(prev); mapa.delete(localId); return mapa; });
    const res = await removerLocalDiaAction({ empresaId, data, localId }, accessToken);
    if (!res.ok) { toast('Erro ao remover local: ' + res.erro, 'error'); carregarEscala(); }
  };

  const criarLocal = async () => {
    if (!empresaId || !novoLocalNome.trim()) return;
    setCriandoLocal(true);
    try {
      const res = await criarLocalAction({ empresaId, nome: novoLocalNome.trim() }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const novoLocal = res.info.local as Local;
      setNovoLocalNome('');
      await carregarLocais();
      await ativarLocalHoje(novoLocal);
    } catch (e: any) {
      toast('Erro ao criar local: ' + e.message, 'error');
    } finally {
      setCriandoLocal(false);
    }
  };

  const copiarDeOntem = async () => {
    if (!empresaId) return;
    const origem = diaAnterior(data);
    if (!confirm(`Copiar a escala de ${fmtDataExtenso(origem)} para ${fmtDataExtenso(data)}?\n\nQuem já tem local definido hoje não será alterado.`)) return;
    setCopiando(true);
    try {
      const res = await copiarEscalaAction({ empresaId, dataOrigem: origem, dataDestino: data, criadoPor: usuarioAtual }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      toast(`${res.info.copiados} colaborador(es) copiado(s) de ontem.`, 'success');
      carregarEscala();
    } catch (e: any) {
      toast('Erro ao copiar: ' + e.message, 'error');
    } finally {
      setCopiando(false);
    }
  };

  const compartilharEscala = async () => {
    if (!empresaId) return;
    const empresaNome = empresasVisiveis.find(e => e.id === empresaId)?.nome || '';
    const contextosImg = locaisAtivosHoje
      .filter(l => contextos.has(l.id))
      .map(l => {
        const c = contextos.get(l.id)!;
        return { local_nome: l.nome, tipo_nome: c.tipo_nome, evento: c.evento, responsavel: c.responsavel };
      });
    setCompartilhando(true);
    try {
      const blob = await gerarImagemEscala({ empresaNome, data, alocacoes, contextos: contextosImg, logo: logoImg });
      if (!blob) throw new Error('Não foi possível gerar a imagem.');

      const arquivoNome = `escala-${data}.png`;
      const file = new File([blob], arquivoNome, { type: 'image/png' });

      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Escala de Trabalho', text: `Escala de ${fmtDataExtenso(data)}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = arquivoNome;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('Imagem baixada — é só anexar no grupo do WhatsApp.', 'success');
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') toast('Erro ao gerar imagem: ' + e.message, 'error');
    } finally {
      setCompartilhando(false);
    }
  };

  const notificarColaboradores = async () => {
    if (!empresaId) return;
    if (alocacoes.length === 0) { toast('Ninguém foi alocado hoje ainda.', 'error'); return; }
    const pendentes = alocacoes.filter(a => !a.notificado_em).length;
    if (pendentes === 0) { toast('Todo mundo já foi notificado dessa escala.', 'info'); return; }
    if (!confirm(`Enviar WhatsApp pra ${pendentes} colaborador(es) que ainda não foram notificados da escala de ${fmtDataExtenso(data)}?\n\nQuem já foi notificado antes não recebe de novo.`)) return;
    setNotificando(true);
    try {
      const res = await notificarColaboradoresAction({ empresaId, data }, accessToken);
      if (!res.ok) throw new Error(res.erro);
      const { enviados, semCelular, falhas, jaNotificados } = res.info as { enviados: number; semCelular: string[]; falhas: string[]; jaNotificados: number };
      let msg = `${enviados} colaborador(es) notificado(s) agora.`;
      if (jaNotificados > 0) msg += ` ${jaNotificados} já tinham sido notificados antes (pulado).`;
      if (semCelular.length > 0) msg += ` ${semCelular.length} sem celular cadastrado.`;
      if (falhas.length > 0) msg += ` ${falhas.length} falha(s) no envio.`;
      toast(msg, falhas.length > 0 || semCelular.length > 0 ? 'error' : 'success');
      carregarEscala();
    } catch (e: any) {
      toast('Erro ao notificar: ' + e.message, 'error');
    } finally {
      setNotificando(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F8] flex items-center justify-center pt-16">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#0C1D4D] border-t-[#336699] rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-[#0C1D4D] font-black uppercase tracking-widest text-sm">Verificando acesso...</h2>
        </div>
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
          <button onClick={() => router.push('/admin/operacional')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  const activeNome = activeId?.replace(/^func:/, '') || null;

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] pt-4 pb-16">
      <Analytics />

      <div className="bg-emerald-50 border-b border-emerald-200 px-4 md:px-8 py-4 flex justify-between items-center shadow-sm">
        <p className="text-emerald-800 font-medium text-sm">
          🗓️ <strong>Escala de Trabalho</strong>. Arraste o colaborador até o local do dia.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="text-[10px] md:text-xs font-black bg-white hover:bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR
        </button>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-8 mt-6">
        {/* EMPRESA — compartilhada pelas duas abas */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 mb-4">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1 block">Empresa</label>
          <select
            value={empresaId ?? ''} onChange={e => setEmpresaId(e.target.value ? Number(e.target.value) : null)}
            className="w-full p-2.5 border border-[#E2E8F0] rounded-lg text-sm"
          >
            <option value="">Selecione...</option>
            {empresasVisiveis.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>

        {/* ABAS */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setAba('montar')}
            className={`px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-colors ${aba === 'montar' ? 'bg-[#0C1D4D] text-white' : 'bg-white text-gray-500 border border-[#E2E8F0] hover:bg-[#F8FAFC]'}`}
          >
            📋 Montar Escala
          </button>
          <button
            onClick={abrirAbaCalendario} disabled={!empresaId}
            className={`px-4 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-colors disabled:opacity-40 ${aba === 'calendario' ? 'bg-[#0C1D4D] text-white' : 'bg-white text-gray-500 border border-[#E2E8F0] hover:bg-[#F8FAFC]'}`}
          >
            📅 Escalas Montadas
          </button>
        </div>

        {aba === 'calendario' ? (
          !empresaId ? (
            <div className="text-center py-16 text-gray-400 font-bold uppercase text-sm">Selecione uma empresa para ver o calendário.</div>
          ) : (
            <CalendarioEscalasMontadas
              data={data} mesAno={mesCalendario} diasComEscala={diasComEscala}
              onSelecionarDia={selecionarDiaCalendario} onMudarMes={(ano, mes) => setMesCalendario({ ano, mes })}
            />
          )
        ) : (
          <>
            {/* FILTROS da aba Montar Escala */}
            <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1 block">Departamento</label>
                  <select
                    value={departamento} onChange={e => setDepartamento(e.target.value)}
                    className="w-full p-2.5 border border-[#E2E8F0] rounded-lg text-sm"
                  >
                    <option value="">Selecione...</option>
                    {departamentosCatalogo.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1 block">Data</label>
                  <input
                    type="date" value={data} onChange={e => setData(e.target.value)}
                    className="w-full p-2.5 border border-[#E2E8F0] rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={copiarDeOntem} disabled={!empresaId || copiando}
                  className="flex-1 min-w-[160px] p-2.5 rounded-lg text-xs font-black uppercase tracking-wider bg-[#0C1D4D] text-white hover:bg-[#284B8C] disabled:opacity-40 transition-colors"
                >
                  {copiando ? 'Copiando...' : '↺ Copiar de Ontem'}
                </button>
                <button
                  onClick={compartilharEscala} disabled={!empresaId || compartilhando}
                  className="flex-1 min-w-[160px] p-2.5 rounded-lg text-xs font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
                >
                  {compartilhando ? 'Gerando...' : '🖼️ Exportar / Compartilhar'}
                </button>
                <button
                  onClick={notificarColaboradores} disabled={!empresaId || notificando}
                  className="flex-1 min-w-[160px] p-2.5 rounded-lg text-xs font-black uppercase tracking-wider bg-[#25D366] text-white hover:bg-[#1ebe5a] disabled:opacity-40 transition-colors"
                >
                  {notificando ? 'Enviando...' : '📣 Notificar Colaboradores'}
                </button>
              </div>
            </div>

            {!empresaId ? (
              <div className="text-center py-16 text-gray-400 font-bold uppercase text-sm">Selecione uma empresa para começar.</div>
            ) : carregandoEscala ? (
              <div className="text-center py-16 text-gray-400 font-bold uppercase text-sm">Carregando escala...</div>
            ) : (
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                {/* A escala já montada (locais + colaboradores) aparece
                    independente do departamento — ele só é necessário pra
                    saber quem oferecer no "pool" pra colocar gente nova. */}
                {departamento ? (
                  <Pool funcionarios={poolFuncionarios} />
                ) : (
                  <div className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white p-3 mb-6 text-center text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                    Selecione um departamento pra adicionar novos colaboradores à escala
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {locaisAtivosHoje.map(local => (
                    <LocalColuna
                      // key inclui `data`: força remontar ao trocar de dia, senão os
                      // inputs de contexto (não-controlados, defaultValue) ficariam
                      // mostrando o valor do dia anterior.
                      key={`${local.id}::${data}`} local={local} contexto={contextos.get(local.id)}
                      itens={alocacoesPorLocal.get(local.id) || []} tipos={tiposCatalogo}
                      onHorarioChange={handleHorarioChange} onRemover={handleRemover}
                      onContextoChange={handleContextoChange} onTipoChange={handleTipoChange} onCriarTipo={criarTipoInline}
                      onRemoverLocalDia={removerLocalDoDia}
                      salvandoId={salvandoId}
                    />
                  ))}

                  {novoLocalAberto ? (
                    <div className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white p-3 flex flex-col gap-2">
                      {locaisDisponiveis.length > 0 && (
                        <div className="mb-1">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Já cadastrados</p>
                          <div className="max-h-32 overflow-y-auto space-y-1">
                            {locaisDisponiveis.map(l => (
                              <button
                                key={l.id} onClick={() => ativarLocalHoje(l)}
                                className="w-full text-left text-xs font-bold text-[#0C1D4D] bg-[#F8FAFC] hover:bg-blue-50 border border-[#E2E8F0] rounded-lg px-2 py-1.5 transition-colors"
                              >📍 {l.nome}</button>
                            ))}
                          </div>
                        </div>
                      )}
                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Ou crie um novo</p>
                      <input
                        autoFocus value={novoLocalNome} onChange={e => setNovoLocalNome(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && criarLocal()}
                        placeholder="Nome do local (ex: Obra Centro)"
                        className="w-full p-2 border border-[#E2E8F0] rounded-lg text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={criarLocal} disabled={criandoLocal || !novoLocalNome.trim()}
                          className="flex-1 bg-[#0C1D4D] text-white text-xs font-black uppercase py-2 rounded-lg disabled:opacity-40"
                        >Criar</button>
                        <button
                          onClick={() => { setNovoLocalAberto(false); setNovoLocalNome(''); }}
                          className="px-3 text-xs font-black uppercase text-gray-400 hover:text-gray-600"
                        >Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setNovoLocalAberto(true)}
                      className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white p-3 min-h-[140px] flex items-center justify-center text-gray-400 hover:text-[#336699] hover:border-[#336699] transition-colors text-sm font-black uppercase tracking-wide"
                    >
                      + Adicionar Local
                    </button>
                  )}
                </div>

                <DragOverlay>
                  {activeNome ? <FuncionarioCard nome={activeNome} arrastando /> : null}
                </DragOverlay>
              </DndContext>
            )}
          </>
        )}
      </div>
    </div>
  );
}
