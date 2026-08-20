"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { Analytics } from "@vercel/analytics/next";
import { usePageAccess } from '../../../components/hooks/usePageAccess';
import { HubErro } from '../../../components/ui/HubStates';
import { ehAdministradorGlobal } from '../../../lib/permissoes';

// ============================================================================
// PALETA (ordem fixa — identidade nunca depende de rank/valor)
// ============================================================================
const PALETA_CATEGORICA = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];
const COR_SEQUENCIAL = '#2a78d6';
const COR_STATUS_VEICULO: Record<string, string> = { 'ATIVO': '#16A34A', 'EM MANUTENÇÃO': '#D97706', 'INATIVO': '#64748B' };
const ICONE_TIPO: Record<string, string> = {
  'CAMINHÃO': '🚛', 'VAN': '🚐', 'CARRO': '🚗', 'UTILITÁRIO': '🚚',
  'CARRETA': '⛟', 'MOTO': '🏍️', 'ÔNIBUS': '🚌', 'OUTRO': '🚙'
};

// Atribui cor por índice em uma lista ordenada de forma estável (nunca por valor/rank).
// Acima de 8 categorias, o excedente cai em cinza — nunca gera um novo tom.
function corPorCategoria(nome: string, listaOrdenada: string[]): string {
  const i = listaOrdenada.indexOf(nome);
  return i >= 0 && i < PALETA_CATEGORICA.length ? PALETA_CATEGORICA[i] : '#94A3B8';
}

// ============================================================================
// INTERFACES DO BANCO DE DADOS
// ============================================================================
interface Veiculo {
  id: string; apelido: string; tipo: string; placa: string; status: string; propriedade: string;
  km_atual?: number | null; exibir_na_frota: boolean; empresa_id: number | null;
  seguro_vigencia_fim?: string | null; crlv_vencimento?: string | null; ipva_vencimento?: string | null;
  locacao_vigencia_fim?: string | null;
}

interface Manutencao {
  id: string; veiculo_id: string; tipo: string; data: string; custo?: number | null;
}

interface Categoria { id: string; nome: string; }

interface Equipamento {
  id: string; categoria_id: string; empresa_id: number | null; nome: string; peso: number; consumo_watts: number; ativo: boolean;
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================
const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const formatNumero = (v: number) => new Intl.NumberFormat('pt-BR').format(v || 0);

// ============================================================================
// CALENDÁRIO OPERACIONAL DE LOGÍSTICA
// ============================================================================
interface FichaCalendario {
  id: string;
  numero: string;
  cliente: string;
  evento_feira: string | null;
  status: string;
  empresa_id: number | null;
  data_inicial: string | null;
  data_final: string | null;
  data_entrega_agenda: string | null;
}

type TipoOperacao = 'montagem' | 'inicio' | 'desmontagem' | 'andamento';

interface OperacaoDia { tipo: TipoOperacao; texto: string; local: string | null; }

interface AgendaCategoria { id: string; nome: string; cor: string; }

interface AgendaManual { id: string; data: string; categoria_id: string; texto: string; local: string | null; }

const COR_OPERACAO: Record<TipoOperacao, { bg: string; text: string; border: string; label: string }> = {
  montagem: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', label: 'Montagem / Entrega' },
  inicio: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300', label: 'Início Evento' },
  desmontagem: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', label: 'Desmontagem' },
  andamento: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-300', label: 'Evento em Andamento' },
};

const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const toISO = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const domingoDaSemana = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
};

// Soma/subtrai dias a uma data ISO (YYYY-MM-DD) sem cair em armadilha de fuso horário.
const somarDiasISO = (iso: string, dias: number): string => {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  d.setDate(d.getDate() + dias);
  return toISO(d);
};

// Dias de antecedência usados quando a planilha não trouxe uma data de entrega capturável.
const DIAS_ANTECEDENCIA_MONTAGEM_PADRAO = 2;

// Deriva as operações do dia a partir de data_inicial/data_final/data_entrega_agenda.
// Sem dados de Pré-Montagem/Retirada no CSV de origem — só dá pra derivar estas 4 categorias.
const PREFIXO_OPERACAO: Record<TipoOperacao, string> = { montagem: 'MONT/ENT', inicio: 'INÍCIO', desmontagem: 'DESM', andamento: 'EM ANDAMENTO' };

// Casa o nome do evento/feira (texto livre) com o cadastro eventos_feiras, ignorando
// acentuação/maiúsculas — a mesma variação de digitação que já existe entre as duas planilhas.
const normalizarNomeEvento = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

// Várias fichas (clientes diferentes) costumam compartilhar o mesmo evento/feira e as
// mesmas datas — sem agrupar, o nome do evento apareceria repetido uma vez por ficha.
function operacoesDoDia(fichas: FichaCalendario[], iso: string, mapaLocais: Record<string, string>): OperacaoDia[] {
  const agrupado = new Map<string, { tipo: TipoOperacao; nome: string; qtd: number }>();

  const registrar = (tipo: TipoOperacao, nome: string) => {
    const chave = `${tipo}:${nome}`;
    const atual = agrupado.get(chave);
    if (atual) atual.qtd += 1;
    else agrupado.set(chave, { tipo, nome, qtd: 1 });
  };

  fichas.forEach(f => {
    const nome = f.evento_feira || f.cliente;
    // Data de Montagem/Entrega: usa a data capturada do campo "Data de Entrega"; se não houver,
    // considera 2 dias antes da Data Inicial (praxe operacional de antecedência de montagem).
    const diaMontagem = f.data_entrega_agenda || (f.data_inicial ? somarDiasISO(f.data_inicial, -DIAS_ANTECEDENCIA_MONTAGEM_PADRAO) : null);

    if (diaMontagem === iso) registrar('montagem', nome);
    if (f.data_inicial === iso) registrar('inicio', nome);
    if (f.data_final === iso) registrar('desmontagem', nome);
    if (f.data_inicial && f.data_final && iso > f.data_inicial && iso < f.data_final) {
      registrar('andamento', nome);
    }
  });

  return Array.from(agrupado.values()).map(({ tipo, nome, qtd }) => ({
    tipo,
    texto: `${PREFIXO_OPERACAO[tipo]}: ${nome}${qtd > 1 ? ` (${qtd})` : ''}`,
    local: mapaLocais[normalizarNomeEvento(nome)] || null,
  }));
}

function getStatusVencimento(dataStr?: string | null): { texto: string; cor: string; urgencia: 'vencido' | 'proximo' | 'ok' | null } {
  if (!dataStr) return { texto: 'Sem data cadastrada', cor: 'bg-gray-100 text-gray-500 border-gray-300', urgencia: null };
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${dataStr}T00:00:00`);
  const diffDias = Math.ceil((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDias < 0) return { texto: `Vencido há ${Math.abs(diffDias)}d`, cor: 'bg-red-100 text-red-700 border-red-300', urgencia: 'vencido' };
  if (diffDias <= 30) return { texto: `Vence em ${diffDias}d`, cor: 'bg-amber-100 text-amber-700 border-amber-300', urgencia: 'proximo' };
  return { texto: `Válido até ${alvo.toLocaleDateString('pt-BR')}`, cor: 'bg-green-100 text-green-700 border-green-300', urgencia: 'ok' };
}

// Pior urgência entre os vencimentos do veículo (CRLV + IPVA + Seguro ou Locação)
function getUrgenciaVeiculo(v: Veiculo): { texto: string; cor: string; urgencia: 'vencido' | 'proximo' | 'ok' | null } {
  const candidatos = [
    getStatusVencimento(v.crlv_vencimento),
    getStatusVencimento(v.ipva_vencimento),
    getStatusVencimento(v.propriedade === 'ALUGADO' ? v.locacao_vigencia_fim : v.seguro_vigencia_fim),
  ];
  const vencido = candidatos.find(c => c.urgencia === 'vencido');
  if (vencido) return vencido;
  const proximo = candidatos.find(c => c.urgencia === 'proximo');
  if (proximo) return proximo;
  const ok = candidatos.find(c => c.urgencia === 'ok');
  return ok || { texto: 'Sem dados', cor: 'bg-gray-100 text-gray-500 border-gray-300', urgencia: null };
}

// ============================================================================
// CARTÃO DE INDICADOR
// ============================================================================
const CardKPI = ({ titulo, valor, cor, sub }: { titulo: string; valor: string; cor: string; sub?: string }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5">
    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{titulo}</p>
    <p className="text-2xl font-black" style={{ color: cor }}>{valor}</p>
    {sub && <p className="text-[11px] font-bold text-gray-500 mt-1">{sub}</p>}
  </div>
);

// ============================================================================
// GRÁFICO DE BARRAS HORIZONTAIS — SVG puro, sem dependências.
// Cada barra recebe sua própria cor (identidade fixa por categoria), com
// rótulo direto — dispensa legenda para série única.
// ============================================================================
const BarrasHorizontais = ({ dados, formato }: {
  dados: { label: string; valor: number; cor: string }[]; formato: (n: number) => string;
}) => {
  const max = Math.max(...dados.map(d => d.valor), 1);
  const alturaLinha = 28;
  const altura = dados.length * alturaLinha + 10;
  const larguraLabel = 150;
  const larguraBarra = 420;

  if (dados.length === 0) {
    return <p className="text-xs text-center text-[#94A3B8] font-bold py-8">Sem dados suficientes para este gráfico.</p>;
  }

  return (
    <svg viewBox={`0 0 ${larguraLabel + larguraBarra + 100} ${altura}`} className="w-full" style={{ maxHeight: `${altura}px` }}>
      {dados.map((d, i) => {
        const y = i * alturaLinha + 5;
        const w = (d.valor / max) * larguraBarra;
        return (
          <g key={i}>
            <text x={larguraLabel - 8} y={y + 15} textAnchor="end" fontSize="11" fontWeight="700" fill="#334155">
              {d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label}
            </text>
            <rect x={larguraLabel} y={y + 4} width={larguraBarra} height={16} rx="4" fill="#F1F5F9" />
            <rect x={larguraLabel} y={y + 4} width={Math.max(w, d.valor > 0 ? 2 : 0)} height={16} rx="4" fill={d.cor} />
            <text x={larguraLabel + Math.max(w, 2) + 6} y={y + 16} fontSize="10" fontWeight="700" fill="#64748B">
              {formato(d.valor)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

// ============================================================================
// AUTENTICAÇÃO
// ============================================================================
export default function RelatoriosOperacional() {
  const router = useRouter();
  const { usuarioAtual, authLoading, acessoNegado, erro, tentarNovamente, permissaoBruta } = usePageAccess({ nomeFallback: 'Usuário' });

  const [aba, setAba] = useState<'frota' | 'estoque' | 'calendario'>('frota');
  const [loading, setLoading] = useState(true);

  // Empresa(s) que o usuário pode enxergar (Rentech × AlfaLight) — só afeta a
  // aba Frota (Estoque e Calendário não têm essa dimensão ainda). A proteção
  // de verdade é a RLS no banco (esta tela lê direto pelo cliente anon).
  const [empresasPermitidas, setEmpresasPermitidas] = useState<number[] | null>(null);
  const [empresasCatalogo, setEmpresasCatalogo] = useState<{ id: number; nome: string }[]>([]);
  const [filtroEmpresaId, setFiltroEmpresaId] = useState<number | null>(null);

  useEffect(() => {
    if (authLoading || acessoNegado) return;
    async function carregarEmpresas() {
      const { data: empresasData } = await supabase.from('empresas').select('id, nome').eq('ativo', true).order('nome');
      setEmpresasCatalogo(empresasData || []);

      if (ehAdministradorGlobal(permissaoBruta)) {
        setEmpresasPermitidas(null);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: vinculos } = await supabase
        .from('perfis_usuarios_empresas').select('empresa_id').eq('perfil_id', session.user.id);
      setEmpresasPermitidas((vinculos || []).map(v => v.empresa_id));
    }
    carregarEmpresas();
  }, [authLoading, acessoNegado, permissaoBruta]);

  const empresasCatalogoVisivel = empresasPermitidas === null
    ? empresasCatalogo
    : empresasCatalogo.filter(e => empresasPermitidas.includes(e.id));

  useEffect(() => {
    if (empresasCatalogoVisivel.length === 1) setFiltroEmpresaId(empresasCatalogoVisivel[0].id);
  }, [empresasCatalogoVisivel]);

  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [manutencoes, setManutencoes] = useState<Manutencao[]>([]);
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  const [calSemanaInicio, setCalSemanaInicio] = useState<Date>(() => domingoDaSemana(new Date()));
  const [calNumSemanas, setCalNumSemanas] = useState(3);
  // Visualização "dia" mostra um único dia (calSemanaInicio deixa de estar
  // preso ao domingo da semana e passa a ser o próprio dia selecionado) em
  // vez da grade de semanas — útil pra conferir a agenda de uma data específica.
  const [calVisualizacao, setCalVisualizacao] = useState<'semanas' | 'dia'>('semanas');
  const [fichasCalendario, setFichasCalendario] = useState<FichaCalendario[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [mapaLocaisEventos, setMapaLocaisEventos] = useState<Record<string, string>>({});
  const [filtroOperacoes, setFiltroOperacoes] = useState<Record<TipoOperacao, boolean>>({
    montagem: true, inicio: true, desmontagem: true, andamento: true,
  });
  const [filtroCategoriasManual, setFiltroCategoriasManual] = useState<Record<string, boolean>>({});
  const [agendaManual, setAgendaManual] = useState<AgendaManual[]>([]);
  const [agendaCategorias, setAgendaCategorias] = useState<AgendaCategoria[]>([]);
  const [modalAgenda, setModalAgenda] = useState<{ open: boolean; data: string; categoriaId: string; texto: string; local: string; salvando: boolean; erro: string | null }>({
    open: false, data: '', categoriaId: '', texto: '', local: '', salvando: false, erro: null,
  });
  const [novaCategoria, setNovaCategoria] = useState<{ open: boolean; nome: string; cor: string; salvando: boolean; erro: string | null }>({
    open: false, nome: '', cor: '#336699', salvando: false, erro: null,
  });

  useEffect(() => {
    if (!authLoading && !acessoNegado) carregarDados();
  }, [authLoading, acessoNegado]);

  // Frota: somente veículos liberados para exibição (mesma regra da página de Frota).
  // Estoque: catálogo completo de equipamentos, agregado por categoria.
  const carregarDados = async () => {
    setLoading(true);
    const [{ data: veiculosData }, { data: equipamentosData }, { data: categoriasData }] = await Promise.all([
      supabase.from('frota_veiculos').select('*').eq('exibir_na_frota', true).order('apelido', { ascending: true }),
      supabase.from('equipamentos').select('*').order('nome', { ascending: true }),
      supabase.from('categorias').select('*').order('nome', { ascending: true }),
    ]);

    setVeiculos(veiculosData || []);
    setEquipamentos(equipamentosData || []);
    setCategorias(categoriasData || []);

    const ids = (veiculosData || []).map(v => v.id);
    if (ids.length > 0) {
      const { data: manutencoesData } = await supabase.from('frota_manutencoes').select('id, veiculo_id, tipo, data, custo').in('veiculo_id', ids);
      setManutencoes(manutencoesData || []);
    } else {
      setManutencoes([]);
    }
    setLoading(false);
  };

  // Busca as fichas de reserva que se sobrepõem à janela visível no calendário
  // (um único dia, ou a grade de semanas).
  const calDataFim = useMemo(() => {
    if (calVisualizacao === 'dia') return new Date(calSemanaInicio);
    const fim = new Date(calSemanaInicio);
    fim.setDate(fim.getDate() + calNumSemanas * 7 - 1);
    return fim;
  }, [calSemanaInicio, calNumSemanas, calVisualizacao]);

  // Recarrega os eventos manuais da janela de semanas visível — reutilizada após criar/excluir um evento.
  const carregarAgendaManual = async () => {
    const { data, error } = await supabase
      .from('agenda_manual')
      .select('id, data, categoria_id, texto, local')
      .gte('data', toISO(calSemanaInicio))
      .lte('data', toISO(calDataFim))
      .order('data', { ascending: true });

    if (!error) setAgendaManual(data || []);
  };

  // Recarrega as categorias cadastradas — reutilizada após criar uma categoria nova.
  const carregarCategorias = async () => {
    const { data, error } = await supabase.from('agenda_categorias').select('id, nome, cor').order('nome', { ascending: true });
    if (!error) setAgendaCategorias(data || []);
  };

  useEffect(() => {
    if (aba !== 'calendario') return;
    (async () => {
      setCalLoading(true);
      // A montagem pode cair até DIAS_ANTECEDENCIA_MONTAGEM_PADRAO dias antes da data_inicial,
      // então busca um pouco além do fim visível pra não perder fichas nessa faixa de antecedência.
      const limiteBuscaFim = somarDiasISO(toISO(calDataFim), DIAS_ANTECEDENCIA_MONTAGEM_PADRAO);
      const { data, error } = await supabase
        .from('fichas_reserva')
        .select('id, numero, cliente, evento_feira, status, empresa_id, data_inicial, data_final, data_entrega_agenda')
        .lte('data_inicial', limiteBuscaFim)
        .gte('data_final', toISO(calSemanaInicio))
        .order('data_inicial', { ascending: true });

      if (!error) {
        setFichasCalendario((data || []).filter(f => f.status !== 'Cancelado' && f.status !== 'Reprovado'));
      }
      await Promise.all([carregarAgendaManual(), carregarCategorias()]);
      setCalLoading(false);
    })();
  }, [aba, calSemanaInicio, calDataFim]);

  // Cada empresa tem as próprias fichas de reserva — mesmo filtro de empresa
  // usado nas abas Frota/Estoque (filtroEmpresaId), pra manter uma única
  // escolha de empresa em toda a página.
  const fichasCalendarioEscopo = useMemo(() =>
    !filtroEmpresaId ? fichasCalendario : fichasCalendario.filter(f => f.empresa_id == null || f.empresa_id === filtroEmpresaId),
    [fichasCalendario, filtroEmpresaId]);

  // Busca o local cadastrado em eventos_feiras para os eventos/feiras que aparecem no calendário.
  useEffect(() => {
    const nomes = Array.from(new Set(
      fichasCalendarioEscopo.map(f => f.evento_feira).filter((v): v is string => !!v)
    ));

    (async () => {
      if (nomes.length === 0) { setMapaLocaisEventos({}); return; }

      const { data, error } = await supabase
        .from('eventos_feiras')
        .select('nome, local')
        .in('nome', nomes)
        .not('local', 'is', null);

      if (!error) {
        const mapa: Record<string, string> = {};
        (data || []).forEach(r => {
          const chave = normalizarNomeEvento(r.nome);
          if (r.local && !mapa[chave]) mapa[chave] = r.local;
        });
        setMapaLocaisEventos(mapa);
      }
    })();
  }, [fichasCalendarioEscopo]);

  // Categorias de eventos manuais efetivamente em uso na janela visível — só aparecem
  // na legenda quando existe pelo menos um evento manual daquela categoria no período.
  const categoriasManuaisEmUso = useMemo(() => {
    const idsEmUso = new Set(agendaManual.map(e => e.categoria_id));
    return agendaCategorias
      .filter(cat => idsEmUso.has(cat.id))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [agendaManual, agendaCategorias]);

  const semanasCalendario = useMemo(() => {
    const linhas: Date[][] = [];
    for (let w = 0; w < calNumSemanas; w++) {
      const linha: Date[] = [];
      for (let d = 0; d < 7; d++) {
        const dia = new Date(calSemanaInicio);
        dia.setDate(dia.getDate() + w * 7 + d);
        linha.push(dia);
      }
      linhas.push(linha);
    }
    return linhas;
  }, [calSemanaInicio, calNumSemanas]);

  const hojeISO = toISO(new Date());

  const abrirModalAgenda = (dataPreenchida?: string) => {
    setModalAgenda({ open: true, data: dataPreenchida || hojeISO, categoriaId: agendaCategorias[0]?.id || '', texto: '', local: '', salvando: false, erro: null });
    setNovaCategoria({ open: false, nome: '', cor: '#336699', salvando: false, erro: null });
  };

  const salvarAgendaManual = async () => {
    if (!modalAgenda.data || !modalAgenda.categoriaId || !modalAgenda.texto.trim()) {
      setModalAgenda(prev => ({ ...prev, erro: 'Preencha a data, a categoria e a descrição do evento.' }));
      return;
    }
    setModalAgenda(prev => ({ ...prev, salvando: true, erro: null }));
    const { data, error } = await supabase
      .from('agenda_manual')
      .insert([{ data: modalAgenda.data, categoria_id: modalAgenda.categoriaId, texto: modalAgenda.texto.trim(), local: modalAgenda.local.trim() || null, criado_por: usuarioAtual }])
      .select()
      .single();

    if (error) {
      setModalAgenda(prev => ({ ...prev, salvando: false, erro: error.message }));
      return;
    }
    setAgendaManual(prev => [...prev, data]);
    setModalAgenda({ open: false, data: '', categoriaId: '', texto: '', local: '', salvando: false, erro: null });
  };

  const excluirAgendaManual = async (id: string) => {
    setAgendaManual(prev => prev.filter(e => e.id !== id));
    await supabase.from('agenda_manual').delete().eq('id', id);
  };

  const salvarNovaCategoria = async () => {
    if (!novaCategoria.nome.trim()) {
      setNovaCategoria(prev => ({ ...prev, erro: 'Dê um nome para a categoria.' }));
      return;
    }
    setNovaCategoria(prev => ({ ...prev, salvando: true, erro: null }));
    const { data, error } = await supabase
      .from('agenda_categorias')
      .insert([{ nome: novaCategoria.nome.trim(), cor: novaCategoria.cor }])
      .select()
      .single();

    if (error) {
      setNovaCategoria(prev => ({ ...prev, salvando: false, erro: error.message }));
      return;
    }
    setAgendaCategorias(prev => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)));
    setModalAgenda(prev => ({ ...prev, categoriaId: data.id }));
    setNovaCategoria({ open: false, nome: '', cor: '#336699', salvando: false, erro: null });
  };

  // ==========================================================================
  // AGREGAÇÕES — FROTA
  // ==========================================================================
  // Base de tudo abaixo: veículos (e manutenções deles) dentro do escopo de
  // empresa do usuário — nenhum gráfico/KPI pode "vazar" outra empresa.
  const veiculosEscopo = useMemo(() =>
    !filtroEmpresaId ? veiculos : veiculos.filter(v => v.empresa_id == null || v.empresa_id === filtroEmpresaId),
    [veiculos, filtroEmpresaId]);

  const manutencoesEscopo = useMemo(() => {
    const idsPermitidos = new Set(veiculosEscopo.map(v => v.id));
    return manutencoes.filter(m => idsPermitidos.has(m.veiculo_id));
  }, [manutencoes, veiculosEscopo]);

  const tiposOrdenados = useMemo(() => Array.from(new Set(veiculosEscopo.map(v => v.tipo))).sort(), [veiculosEscopo]);

  const veiculosPorTipo = useMemo(() => {
    const contagem: Record<string, number> = {};
    veiculosEscopo.forEach(v => { contagem[v.tipo] = (contagem[v.tipo] || 0) + 1; });
    return tiposOrdenados.map(tipo => ({ label: `${ICONE_TIPO[tipo] || '🚙'} ${tipo}`, valor: contagem[tipo], cor: corPorCategoria(tipo, tiposOrdenados) }));
  }, [veiculosEscopo, tiposOrdenados]);

  const veiculosPorStatus = useMemo(() => {
    const contagem: Record<string, number> = { 'ATIVO': 0, 'EM MANUTENÇÃO': 0, 'INATIVO': 0 };
    veiculosEscopo.forEach(v => { contagem[v.status] = (contagem[v.status] || 0) + 1; });
    return Object.entries(contagem).filter(([, v]) => v > 0).map(([status, valor]) => ({ label: status, valor, cor: COR_STATUS_VEICULO[status] || '#94A3B8' }));
  }, [veiculosEscopo]);

  const custoPorVeiculo = useMemo(() => {
    const custos: Record<string, number> = {};
    manutencoesEscopo.forEach(m => { custos[m.veiculo_id] = (custos[m.veiculo_id] || 0) + (m.custo || 0); });
    return veiculosEscopo
      .map(v => ({ label: v.apelido, valor: custos[v.id] || 0, cor: COR_SEQUENCIAL }))
      .filter(d => d.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);
  }, [veiculosEscopo, manutencoesEscopo]);

  // Custo de manutenção nos últimos 6 meses (competência mês/ano)
  const custoPorMes = useMemo(() => {
    const hoje = new Date();
    const meses: { chave: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      meses.push({ chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) });
    }
    const somaPorMes: Record<string, number> = {};
    manutencoesEscopo.forEach(m => {
      const chave = (m.data || '').slice(0, 7);
      somaPorMes[chave] = (somaPorMes[chave] || 0) + (m.custo || 0);
    });
    return meses.map(m => ({ label: m.label, valor: somaPorMes[m.chave] || 0, cor: COR_SEQUENCIAL }));
  }, [manutencoesEscopo]);

  const veiculosComAlerta = useMemo(() => veiculosEscopo.filter(v => {
    const u = getUrgenciaVeiculo(v).urgencia;
    return u === 'vencido' || u === 'proximo';
  }), [veiculosEscopo]);

  const kpisFrota = useMemo(() => {
    const ativos = veiculosEscopo.filter(v => v.status === 'ATIVO').length;
    const emManutencao = veiculosEscopo.filter(v => v.status === 'EM MANUTENÇÃO').length;
    const inativos = veiculosEscopo.filter(v => v.status === 'INATIVO').length;
    const proprios = veiculosEscopo.filter(v => v.propriedade === 'PRÓPRIO').length;
    const alugados = veiculosEscopo.filter(v => v.propriedade === 'ALUGADO').length;
    const custoTotal = manutencoesEscopo.reduce((s, m) => s + (m.custo || 0), 0);
    return { total: veiculosEscopo.length, ativos, emManutencao, inativos, proprios, alugados, custoTotal, custoMedio: custoTotal / (veiculosEscopo.length || 1) };
  }, [veiculosEscopo, manutencoesEscopo]);

  const veiculosDetalhados = useMemo(() => {
    const numManutencoes: Record<string, number> = {};
    const custos: Record<string, number> = {};
    manutencoesEscopo.forEach(m => {
      numManutencoes[m.veiculo_id] = (numManutencoes[m.veiculo_id] || 0) + 1;
      custos[m.veiculo_id] = (custos[m.veiculo_id] || 0) + (m.custo || 0);
    });
    return [...veiculosEscopo].sort((a, b) => a.apelido.localeCompare(b.apelido)).map(v => ({
      ...v, numManutencoes: numManutencoes[v.id] || 0, custoManutencao: custos[v.id] || 0, situacao: getUrgenciaVeiculo(v),
    }));
  }, [veiculosEscopo, manutencoesEscopo]);

  // ==========================================================================
  // AGREGAÇÕES — ESTOQUE
  // ==========================================================================
  // Cada empresa tem o próprio patrimônio de equipamentos — mesmo filtro de
  // empresa usado na aba Frota (filtroEmpresaId), pra manter uma única
  // escolha de empresa em toda a página.
  const equipamentosEscopo = useMemo(() =>
    !filtroEmpresaId ? equipamentos : equipamentos.filter(eq => eq.empresa_id == null || eq.empresa_id === filtroEmpresaId),
    [equipamentos, filtroEmpresaId]);

  const categoriasOrdenadas = useMemo(() => [...categorias].sort((a, b) => a.nome.localeCompare(b.nome)).map(c => c.id), [categorias]);
  const getNomeCategoria = (catId: string) => categorias.find(c => c.id === catId)?.nome || catId.toUpperCase();

  const equipamentosPorCategoria = useMemo(() => {
    const contagem: Record<string, number> = {};
    equipamentosEscopo.forEach(eq => { contagem[eq.categoria_id] = (contagem[eq.categoria_id] || 0) + 1; });
    return categoriasOrdenadas
      .filter(catId => contagem[catId] > 0)
      .map(catId => ({ label: getNomeCategoria(catId), valor: contagem[catId], cor: corPorCategoria(catId, categoriasOrdenadas) }));
  }, [equipamentosEscopo, categoriasOrdenadas, categorias]);

  const consumoPorCategoria = useMemo(() => {
    const soma: Record<string, number> = {};
    equipamentosEscopo.forEach(eq => { soma[eq.categoria_id] = (soma[eq.categoria_id] || 0) + (eq.consumo_watts || 0); });
    return categoriasOrdenadas
      .filter(catId => soma[catId] > 0)
      .map(catId => ({ label: getNomeCategoria(catId), valor: soma[catId], cor: corPorCategoria(catId, categoriasOrdenadas) }));
  }, [equipamentosEscopo, categoriasOrdenadas, categorias]);

  const kpisEstoque = useMemo(() => {
    const ativos = equipamentosEscopo.filter(e => e.ativo).length;
    const pesoTotal = equipamentosEscopo.reduce((s, e) => s + (e.peso || 0), 0);
    const consumoTotal = equipamentosEscopo.reduce((s, e) => s + (e.consumo_watts || 0), 0);
    return { total: equipamentosEscopo.length, ativos, inativos: equipamentosEscopo.length - ativos, categorias: categorias.length, pesoTotal, consumoTotal };
  }, [equipamentosEscopo, categorias]);

  const estoqueDetalhado = useMemo(() => {
    const porCategoria: Record<string, { itens: number; ativos: number; peso: number; consumo: number }> = {};
    equipamentosEscopo.forEach(eq => {
      const c = (porCategoria[eq.categoria_id] ||= { itens: 0, ativos: 0, peso: 0, consumo: 0 });
      c.itens += 1;
      if (eq.ativo) c.ativos += 1;
      c.peso += eq.peso || 0;
      c.consumo += eq.consumo_watts || 0;
    });
    return categoriasOrdenadas
      .filter(catId => porCategoria[catId])
      .map(catId => ({ catId, nome: getNomeCategoria(catId), ...porCategoria[catId] }));
  }, [equipamentosEscopo, categoriasOrdenadas, categorias]);

  // ==========================================================================
  // RENDERIZAÇÃO
  // ==========================================================================
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
          <p className="text-sm text-gray-500 mb-6">Você não possui permissão para acessar os Relatórios Operacionais.</p>
          <button onClick={() => router.push('/admin/operacional')} className="bg-[#0C1D4D] text-white px-6 py-3 rounded-lg font-bold uppercase text-xs w-full tracking-wider hover:bg-[#284B8C] transition-colors">
            Voltar ao Menu Principal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] font-sans text-[#0A2A4A] flex flex-col pt-16">
      <Analytics />

      <style jsx global>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          .no-print { display: none !important; }
          .print-break { page-break-inside: avoid; }
          /* Calendário: o container pode quebrar entre páginas, mas o cabeçalho dos dias
             da semana nunca fica sozinho (break-after: avoid) e cada semana não é cortada
             ao meio (break-inside: avoid). */
          .calendario-grid-print { break-inside: auto; }
          .calendario-cabecalho-print { break-inside: avoid; break-after: avoid; }
          .calendario-semana-print { break-inside: avoid; }
        }
      `}</style>

      {/* IDENTIFICAÇÃO E NAVEGAÇÃO */}
      <div className="bg-[#E0F2FE] border-b border-[#BAE6FD] px-4 md:px-8 py-4 flex-shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 shadow-sm no-print">
        <p className="text-[#0369A1] font-medium text-sm">
          📊 <strong>Olá, {usuarioAtual}</strong>. Relatórios consolidados de Frota e Controle de Estoque.
        </p>
        <button onClick={() => router.push('/admin/operacional')} className="text-[10px] md:text-xs font-black bg-white hover:bg-blue-50 border border-[#BAE6FD] text-[#0369A1] px-4 py-2 rounded-lg transition-colors shadow-sm tracking-wider uppercase">
          ⬅ VOLTAR AO HUB
        </button>
      </div>

      {/* ABAS */}
      <div className="px-4 md:px-8 pt-4 flex-shrink-0 flex flex-wrap gap-2 border-b border-[#E2E8F0] bg-white no-print">
        <button onClick={() => setAba('frota')} className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'frota' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}>
          🚚 Relatório de Frota
        </button>
        <button onClick={() => setAba('estoque')} className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'estoque' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}>
          📦 Controle de Estoque
        </button>
        <button onClick={() => setAba('calendario')} className={`px-5 py-3 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors ${aba === 'calendario' ? 'bg-[#336699] text-white' : 'text-[#64748B] hover:bg-[#F0F4F8]'}`}>
          📅 Calendário Operacional
        </button>
      </div>

      <div className="p-4 md:px-8 pt-6 flex-grow max-w-[1500px] mx-auto w-full">

        {loading ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
            Montando o relatório...
          </div>
        ) : (
          <>
            {/* ==================== RELATÓRIO DE FROTA ==================== */}
            {aba === 'frota' && (
              <>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 no-print">
                  <div>
                    <h1 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Relatório de Frota</h1>
                    <p className="text-sm text-[#64748B]">{kpisFrota.total} veículo(s) liberado(s) para exibição • {veiculosComAlerta.length} com alerta de vencimento</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={filtroEmpresaId ?? ''}
                      onChange={(e) => setFiltroEmpresaId(e.target.value ? Number(e.target.value) : null)}
                      disabled={empresasCatalogoVisivel.length <= 1}
                      className="p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 TODAS AS EMPRESAS</option>}
                      {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                    <button onClick={() => window.print()} disabled={veiculosEscopo.length === 0} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#284B8C] transition-all disabled:opacity-50">
                      🖨️ Imprimir / PDF
                    </button>
                  </div>
                </div>

                <div className="hidden print:block mb-4 border-b-2 border-black pb-2">
                  <h1 className="text-xl font-black uppercase">Relatório de Frota</h1>
                  <p className="text-sm">Emitido em {new Date().toLocaleDateString('pt-BR')} • {kpisFrota.total} veículo(s)</p>
                </div>

                {veiculosEscopo.length === 0 ? (
                  <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
                    Nenhum veículo liberado para exibição no momento.
                  </div>
                ) : (
                  <>
                    {veiculosComAlerta.length > 0 && (
                      <div className="mb-4 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-bold px-4 py-3 rounded-lg no-print">
                        ⚠️ {veiculosComAlerta.length} veículo(s) com Seguro, Licenciamento, IPVA ou Contrato de Locação vencido ou vencendo nos próximos 30 dias.
                      </div>
                    )}

                    {/* KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 print-break">
                      <CardKPI titulo="Total de Veículos" valor={String(kpisFrota.total)} cor="#0C1D4D" sub={`${kpisFrota.proprios} próprios • ${kpisFrota.alugados} alugados`} />
                      <CardKPI titulo="Ativos" valor={String(kpisFrota.ativos)} cor="#16A34A" />
                      <CardKPI titulo="Em Manutenção" valor={String(kpisFrota.emManutencao)} cor="#D97706" />
                      <CardKPI titulo="Inativos" valor={String(kpisFrota.inativos)} cor="#64748B" />
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 print-break">
                      <CardKPI titulo="Custo Total de Manutenção" valor={formatCurrency(kpisFrota.custoTotal)} cor="#DC2626" sub={`${manutencoesEscopo.length} manutenção(ões) registrada(s)`} />
                      <CardKPI titulo="Custo Médio por Veículo" valor={formatCurrency(kpisFrota.custoMedio)} cor="#336699" />
                      <CardKPI titulo="Com Alerta de Vencimento" valor={String(veiculosComAlerta.length)} cor="#D97706" sub="Seguro, CRLV, IPVA ou Locação" />
                      <CardKPI titulo="Documentação em Dia" valor={String(kpisFrota.total - veiculosComAlerta.length)} cor="#16A34A" />
                    </div>

                    {/* GRÁFICOS */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Veículos por Tipo</h3>
                        <BarrasHorizontais dados={veiculosPorTipo} formato={formatNumero} />
                      </div>
                      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Veículos por Status</h3>
                        <BarrasHorizontais dados={veiculosPorStatus} formato={formatNumero} />
                      </div>
                      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Custo de Manutenção por Veículo (Top 8)</h3>
                        <BarrasHorizontais dados={custoPorVeiculo} formato={formatCurrency} />
                      </div>
                      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Custo de Manutenção — Últimos 6 Meses</h3>
                        <BarrasHorizontais dados={custoPorMes} formato={formatCurrency} />
                      </div>
                    </div>

                    {/* TABELA DETALHADA */}
                    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden print-break">
                      <div className="p-5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm">Detalhamento por Veículo</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left border-collapse">
                          <thead className="bg-white border-b-2 border-[#E2E8F0]">
                            <tr className="text-[9px] uppercase font-black tracking-widest text-[#64748B]">
                              <th className="p-3">Veículo</th>
                              <th className="p-3">Tipo</th>
                              <th className="p-3 text-center">Status</th>
                              <th className="p-3 text-center">Propriedade</th>
                              <th className="p-3 text-center">KM Atual</th>
                              <th className="p-3 text-center">Nº Manutenções</th>
                              <th className="p-3 text-right">Custo Manutenção</th>
                              <th className="p-3 text-center">Situação Documental</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2E8F0]">
                            {veiculosDetalhados.map(v => (
                              <tr key={v.id} className="hover:bg-[#F8FAFC] transition-colors">
                                <td className="p-3">
                                  <span className="font-black text-[#0C1D4D] block">{ICONE_TIPO[v.tipo] || '🚙'} {v.apelido}</span>
                                  <span className="text-[10px] text-gray-500 font-medium">{v.placa}</span>
                                </td>
                                <td className="p-3 text-[#475569] font-bold text-xs uppercase">{v.tipo}</td>
                                <td className="p-3 text-center">
                                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border" style={{ color: COR_STATUS_VEICULO[v.status], borderColor: COR_STATUS_VEICULO[v.status] }}>{v.status}</span>
                                </td>
                                <td className="p-3 text-center text-[#475569] font-bold text-xs uppercase">{v.propriedade}</td>
                                <td className="p-3 text-center font-medium">{v.km_atual ? `${formatNumero(v.km_atual)} km` : '-'}</td>
                                <td className="p-3 text-center font-bold">{v.numManutencoes || '-'}</td>
                                <td className="p-3 text-right font-bold text-[#0A2A4A]">{v.custoManutencao > 0 ? formatCurrency(v.custoManutencao) : '-'}</td>
                                <td className="p-3 text-center">
                                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${v.situacao.cor}`}>{v.situacao.texto}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-[#0C1D4D] bg-[#F8FAFC] font-black text-[#0C1D4D]">
                              <td className="p-3 uppercase text-xs tracking-wider" colSpan={5}>Total Geral ({kpisFrota.total} veículos)</td>
                              <td className="p-3 text-center">{manutencoesEscopo.length}</td>
                              <td className="p-3 text-right">{formatCurrency(kpisFrota.custoTotal)}</td>
                              <td className="p-3"></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ==================== CONTROLE DE ESTOQUE ==================== */}
            {aba === 'estoque' && (
              <>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 no-print">
                  <div>
                    <h1 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Controle de Estoque</h1>
                    <p className="text-sm text-[#64748B]">{kpisEstoque.total} equipamento(s) cadastrado(s) em {kpisEstoque.categorias} categoria(s)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={filtroEmpresaId ?? ''}
                      onChange={(e) => setFiltroEmpresaId(e.target.value ? Number(e.target.value) : null)}
                      disabled={empresasCatalogoVisivel.length <= 1}
                      className="p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-bold text-[#64748B] focus:border-[#336699] outline-none cursor-pointer bg-white disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 TODAS AS EMPRESAS</option>}
                      {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                    <button onClick={() => window.print()} disabled={equipamentosEscopo.length === 0} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#284B8C] transition-all disabled:opacity-50">
                      🖨️ Imprimir / PDF
                    </button>
                  </div>
                </div>

                <div className="hidden print:block mb-4 border-b-2 border-black pb-2">
                  <h1 className="text-xl font-black uppercase">Controle de Estoque</h1>
                  <p className="text-sm">Emitido em {new Date().toLocaleDateString('pt-BR')} • {kpisEstoque.total} equipamento(s)</p>
                </div>

                {equipamentosEscopo.length === 0 ? (
                  <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center text-gray-400 font-bold uppercase tracking-wider">
                    Nenhum equipamento cadastrado no estoque.
                  </div>
                ) : (
                  <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 print-break">
                      <CardKPI titulo="Total de Equipamentos" valor={String(kpisEstoque.total)} cor="#0C1D4D" sub={`${kpisEstoque.categorias} categoria(s)`} />
                      <CardKPI titulo="Ativos" valor={String(kpisEstoque.ativos)} cor="#16A34A" />
                      <CardKPI titulo="Inativos" valor={String(kpisEstoque.inativos)} cor="#64748B" />
                      <CardKPI titulo="Peso Total do Estoque" valor={`${formatNumero(kpisEstoque.pesoTotal)} kg`} cor="#336699" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 print-break">
                      <CardKPI titulo="Consumo Total Instalado" valor={`${formatNumero(kpisEstoque.consumoTotal)} W`} cor="#D97706" sub={kpisEstoque.consumoTotal >= 1000 ? `≈ ${(kpisEstoque.consumoTotal / 1000).toFixed(1)} kW` : undefined} />
                      <CardKPI titulo="Peso Médio por Item" valor={`${formatNumero(kpisEstoque.pesoTotal / (kpisEstoque.total || 1))} kg`} cor="#336699" />
                    </div>

                    {/* GRÁFICOS */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
                      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Equipamentos por Categoria</h3>
                        <BarrasHorizontais dados={equipamentosPorCategoria} formato={formatNumero} />
                      </div>
                      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 print-break">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm mb-4 border-b border-[#E2E8F0] pb-2">Consumo (W) por Categoria</h3>
                        <BarrasHorizontais dados={consumoPorCategoria} formato={(n) => `${formatNumero(n)} W`} />
                      </div>
                    </div>

                    {/* TABELA DETALHADA */}
                    <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden print-break">
                      <div className="p-5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
                        <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm">Detalhamento por Categoria</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left border-collapse">
                          <thead className="bg-white border-b-2 border-[#E2E8F0]">
                            <tr className="text-[9px] uppercase font-black tracking-widest text-[#64748B]">
                              <th className="p-3">Categoria</th>
                              <th className="p-3 text-center">Itens Cadastrados</th>
                              <th className="p-3 text-center">Ativos</th>
                              <th className="p-3 text-center">Inativos</th>
                              <th className="p-3 text-right">Peso Total</th>
                              <th className="p-3 text-right">Consumo Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2E8F0]">
                            {estoqueDetalhado.map(c => (
                              <tr key={c.catId} className="hover:bg-[#F8FAFC] transition-colors">
                                <td className="p-3">
                                  <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: corPorCategoria(c.catId, categoriasOrdenadas) }}></span>
                                  <span className="font-black text-[#0C1D4D]">{c.nome}</span>
                                </td>
                                <td className="p-3 text-center font-bold">{c.itens}</td>
                                <td className="p-3 text-center font-bold text-green-700">{c.ativos}</td>
                                <td className="p-3 text-center font-bold text-gray-400">{c.itens - c.ativos}</td>
                                <td className="p-3 text-right font-medium">{formatNumero(c.peso)} kg</td>
                                <td className="p-3 text-right font-medium text-[#D97706]">{formatNumero(c.consumo)} W</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-[#0C1D4D] bg-[#F8FAFC] font-black text-[#0C1D4D]">
                              <td className="p-3 uppercase text-xs tracking-wider">Total Geral</td>
                              <td className="p-3 text-center">{kpisEstoque.total}</td>
                              <td className="p-3 text-center text-green-700">{kpisEstoque.ativos}</td>
                              <td className="p-3 text-center text-gray-400">{kpisEstoque.inativos}</td>
                              <td className="p-3 text-right">{formatNumero(kpisEstoque.pesoTotal)} kg</td>
                              <td className="p-3 text-right text-[#D97706]">{formatNumero(kpisEstoque.consumoTotal)} W</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ==================== CALENDÁRIO OPERACIONAL DE LOGÍSTICA ==================== */}
            {aba === 'calendario' && (
              <>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#E2E8F0] flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 no-print">
                  <div>
                    <h1 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Calendário Operacional de Logística</h1>
                    <p className="text-sm text-[#64748B]">
                      {calVisualizacao === 'dia'
                        ? <>Dia: {toISO(calSemanaInicio).split('-').reverse().join('/')}</>
                        : <>Período: {toISO(calSemanaInicio).split('-').reverse().join('/')} a {toISO(calDataFim).split('-').reverse().join('/')}</>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <select
                      value={filtroEmpresaId ?? ''}
                      onChange={(e) => setFiltroEmpresaId(e.target.value ? Number(e.target.value) : null)}
                      disabled={empresasCatalogoVisivel.length <= 1}
                      className="border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-xs font-bold text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699] bg-white disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {empresasCatalogoVisivel.length !== 1 && <option value="">🏭 TODAS AS EMPRESAS</option>}
                      {empresasCatalogoVisivel.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                    <select
                      value={calVisualizacao === 'dia' ? 'dia' : String(calNumSemanas)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'dia') {
                          setCalVisualizacao('dia');
                        } else {
                          setCalVisualizacao('semanas');
                          setCalNumSemanas(Number(v));
                        }
                      }}
                      className="border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-xs font-bold text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699]"
                    >
                      <option value="dia">1 dia</option>
                      <option value="2">2 semanas</option>
                      <option value="3">3 semanas</option>
                      <option value="4">4 semanas</option>
                      <option value="6">6 semanas</option>
                    </select>
                    <button onClick={() => setCalSemanaInicio(d => { const x = new Date(d); x.setDate(x.getDate() - (calVisualizacao === 'dia' ? 1 : 7)); return x; })} className="bg-[#F0F4F8] hover:bg-[#E2E8F0] text-[#0C1D4D] font-black text-xs uppercase px-4 py-2.5 rounded-lg transition-colors">
                      ⬅
                    </button>
                    <button onClick={() => setCalSemanaInicio(calVisualizacao === 'dia' ? new Date() : domingoDaSemana(new Date()))} className="bg-[#F0F4F8] hover:bg-[#E2E8F0] text-[#0C1D4D] font-black text-xs uppercase px-4 py-2.5 rounded-lg transition-colors">
                      Hoje
                    </button>
                    <button onClick={() => setCalSemanaInicio(d => { const x = new Date(d); x.setDate(x.getDate() + (calVisualizacao === 'dia' ? 1 : 7)); return x; })} className="bg-[#F0F4F8] hover:bg-[#E2E8F0] text-[#0C1D4D] font-black text-xs uppercase px-4 py-2.5 rounded-lg transition-colors">
                      ➡
                    </button>
                    {calVisualizacao === 'dia' && (
                      <input
                        type="date"
                        value={toISO(calSemanaInicio)}
                        onChange={(e) => { if (e.target.value) setCalSemanaInicio(new Date(`${e.target.value}T00:00:00`)); }}
                        className="border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-xs font-bold text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699]"
                      />
                    )}
                    <button onClick={() => abrirModalAgenda()} className="bg-[#336699] text-white font-black uppercase tracking-widest text-xs px-4 py-2.5 rounded-lg shadow-md hover:bg-[#284B8C] transition-all">
                      ➕ Nova Agenda
                    </button>
                    <button onClick={() => window.print()} className="bg-[#0C1D4D] text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl shadow-md hover:bg-[#284B8C] transition-all">
                      🖨️ Imprimir / PDF
                    </button>
                  </div>
                </div>

                <div className="hidden print:block mb-1 border-b-2 border-black pb-1">
                  <h1 className="text-base font-black uppercase">Calendário Operacional de Logística</h1>
                  <p className="text-xs">
                    {calVisualizacao === 'dia'
                      ? <>Dia: {toISO(calSemanaInicio).split('-').reverse().join('/')}</>
                      : <>Período: {toISO(calSemanaInicio).split('-').reverse().join('/')} a {toISO(calDataFim).split('-').reverse().join('/')}</>}
                  </p>
                </div>

                <div className="mb-4 print:mb-1 bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 print:p-1.5 print-break flex flex-wrap items-center gap-4 print:gap-2">
                  <span className="text-[10px] print:text-[8px] font-black text-[#64748B] uppercase tracking-wider">Filtrar por legenda:</span>
                  {(Object.keys(COR_OPERACAO) as TipoOperacao[]).map(tipo => (
                    <button
                      key={tipo}
                      onClick={() => setFiltroOperacoes(prev => ({ ...prev, [tipo]: !prev[tipo] }))}
                      className={`text-[10px] print:text-[8px] font-black uppercase px-2.5 py-1 print:px-1.5 print:py-0.5 rounded border transition-opacity ${COR_OPERACAO[tipo].bg} ${COR_OPERACAO[tipo].text} ${COR_OPERACAO[tipo].border} ${filtroOperacoes[tipo] ? 'opacity-100' : 'opacity-30'}`}
                    >
                      {filtroOperacoes[tipo] ? '✓ ' : ''}{COR_OPERACAO[tipo].label}
                    </button>
                  ))}
                  {categoriasManuaisEmUso.map(cat => {
                    const ativo = filtroCategoriasManual[cat.id] ?? true;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setFiltroCategoriasManual(prev => ({ ...prev, [cat.id]: !ativo }))}
                        className="text-[10px] print:text-[8px] font-black uppercase px-2.5 py-1 print:px-1.5 print:py-0.5 rounded border transition-opacity"
                        style={{ backgroundColor: `${cat.cor}1A`, color: cat.cor, borderColor: `${cat.cor}4D`, opacity: ativo ? 1 : 0.3 }}
                      >
                        {ativo ? '✓ ' : ''}📌 {cat.nome}
                      </button>
                    );
                  })}
                </div>

                {calVisualizacao === 'dia' ? (() => {
                  const iso = toISO(calSemanaInicio);
                  const ops = operacoesDoDia(fichasCalendarioEscopo, iso, mapaLocaisEventos).filter(op => filtroOperacoes[op.tipo]);
                  const eventosManuais = agendaManual.filter(e => e.data === iso && (filtroCategoriasManual[e.categoria_id] ?? true));
                  const ehHoje = iso === hojeISO;
                  return (
                    <div className="calendario-grid-print bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden relative">
                      {calLoading && (
                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10 no-print">
                          <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                        </div>
                      )}
                      <div className={`p-5 print:p-1.5 ${ehHoje ? 'bg-blue-50/50' : ''}`}>
                        <div className={`text-sm print:text-xs font-black mb-4 print:mb-1 uppercase tracking-wide ${ehHoje ? 'text-[#336699]' : 'text-[#0C1D4D]'}`}>
                          {DIAS_SEMANA[calSemanaInicio.getDay()]}, {String(calSemanaInicio.getDate()).padStart(2, '0')}/{String(calSemanaInicio.getMonth() + 1).padStart(2, '0')}/{calSemanaInicio.getFullYear()}
                          {ehHoje && <span className="ml-2 text-xs print:text-[8px] font-black text-[#336699]">(HOJE)</span>}
                        </div>
                        <div className="space-y-2 print:space-y-1 max-w-xl">
                          {ops.length === 0 && eventosManuais.length === 0 && (
                            <p className="text-xs text-[#94A3B8] font-bold uppercase py-8 text-center">Nenhuma operação ou evento agendado para este dia.</p>
                          )}
                          {ops.map((op, oi) => {
                            const cor = COR_OPERACAO[op.tipo];
                            return (
                              <div key={oi} className={`text-xs print:text-[8px] leading-snug font-bold px-3 py-2.5 print:px-1.5 print:py-1 rounded-lg border ${cor.bg} ${cor.text} ${cor.border}`}>
                                {op.texto}
                                {op.local && <div className="font-normal opacity-75 mt-0.5">📍 {op.local}</div>}
                              </div>
                            );
                          })}
                          {eventosManuais.map(e => {
                            const catCor = agendaCategorias.find(c => c.id === e.categoria_id)?.cor || '#64748B';
                            return (
                              <div
                                key={e.id}
                                className="group relative text-xs print:text-[8px] leading-snug font-bold px-3 py-2.5 print:px-1.5 print:py-1 rounded-lg border"
                                style={{ backgroundColor: `${catCor}1A`, borderColor: `${catCor}4D`, color: catCor }}
                              >
                                <button
                                  onClick={() => excluirAgendaManual(e.id)}
                                  className="no-print absolute top-1.5 right-2 opacity-0 group-hover:opacity-100 text-xs leading-none px-1 hover:text-red-600 transition-opacity"
                                  title="Excluir evento manual"
                                >
                                  &times;
                                </button>
                                📌 {e.texto}
                                {e.local && <div className="font-normal opacity-75 mt-0.5">📍 {e.local}</div>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                <div className="calendario-grid-print bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden relative">
                  {calLoading && (
                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10 no-print">
                      <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin"></div>
                    </div>
                  )}

                  <div className="calendario-cabecalho-print grid grid-cols-7 bg-[#0C1D4D] text-white">
                    {DIAS_SEMANA.map(dia => (
                      <div key={dia} className="p-2 print:p-1 text-center text-[10px] print:text-[8px] font-black uppercase tracking-wider">
                        {dia}
                      </div>
                    ))}
                  </div>

                  {semanasCalendario.map((semana, wi) => (
                    <div key={wi} className="calendario-semana-print grid grid-cols-7 border-t border-[#E2E8F0]">
                      {semana.map((dia) => {
                        const iso = toISO(dia);
                        const ops = operacoesDoDia(fichasCalendarioEscopo, iso, mapaLocaisEventos).filter(op => filtroOperacoes[op.tipo]);
                        const eventosManuais = agendaManual.filter(e => e.data === iso && (filtroCategoriasManual[e.categoria_id] ?? true));
                        const ehHoje = iso === hojeISO;
                        return (
                          <div key={iso} className={`min-h-[110px] print:min-h-0 p-2 print:p-1 border-r border-[#E2E8F0] last:border-r-0 ${ehHoje ? 'bg-blue-50/50' : ''}`}>
                            <div className={`text-[11px] print:text-[8px] font-black mb-1 print:mb-0.5 ${ehHoje ? 'text-[#336699]' : 'text-[#94A3B8]'}`}>
                              {String(dia.getDate()).padStart(2, '0')}/{String(dia.getMonth() + 1).padStart(2, '0')}
                              {ehHoje && <span className="ml-1 text-[9px] print:text-[7px] font-black text-[#336699]">(HOJE)</span>}
                            </div>
                            <div className="space-y-1 print:space-y-0.5">
                              {ops.map((op, oi) => {
                                const cor = COR_OPERACAO[op.tipo];
                                return (
                                  <div key={oi} className={`text-[9px] print:text-[6.5px] leading-tight font-bold px-1.5 py-1 print:px-1 print:py-0.5 rounded border ${cor.bg} ${cor.text} ${cor.border}`}>
                                    {op.texto}
                                    {op.local && (
                                      <div className="font-normal opacity-75 truncate">📍 {op.local}</div>
                                    )}
                                  </div>
                                );
                              })}
                              {eventosManuais.map(e => {
                                const catCor = agendaCategorias.find(c => c.id === e.categoria_id)?.cor || '#64748B';
                                return (
                                  <div
                                    key={e.id}
                                    className="group relative text-[9px] print:text-[6.5px] leading-tight font-bold px-1.5 py-1 print:px-1 print:py-0.5 rounded border"
                                    style={{ backgroundColor: `${catCor}1A`, borderColor: `${catCor}4D`, color: catCor }}
                                  >
                                    <button
                                      onClick={() => excluirAgendaManual(e.id)}
                                      className="no-print absolute top-0 right-0.5 opacity-0 group-hover:opacity-100 text-[10px] leading-none px-1 hover:text-red-600 transition-opacity"
                                      title="Excluir evento manual"
                                    >
                                      &times;
                                    </button>
                                    📌 {e.texto}
                                    {e.local && (
                                      <div className="font-normal opacity-75 truncate">📍 {e.local}</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                )}
              </>
            )}

          </>
        )}
      </div>

      {modalAgenda.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#336699] p-5 flex justify-between items-center text-white">
              <h3 className="font-black uppercase tracking-wider text-sm">📌 Nova Agenda Manual</h3>
              <button
                onClick={() => setModalAgenda({ open: false, data: '', categoriaId: '', texto: '', local: '', salvando: false, erro: null })}
                disabled={modalAgenda.salvando}
                className="text-white hover:text-blue-200 text-2xl leading-none disabled:opacity-50"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black text-[#64748B] uppercase tracking-wider mb-1">Data</label>
                <input
                  type="date"
                  value={modalAgenda.data}
                  onChange={(e) => setModalAgenda(prev => ({ ...prev, data: e.target.value }))}
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm font-bold text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-black text-[#64748B] uppercase tracking-wider">Categoria</label>
                  <button
                    type="button"
                    onClick={() => setNovaCategoria(prev => ({ ...prev, open: !prev.open }))}
                    className="text-[10px] font-black text-[#336699] uppercase tracking-wider hover:text-[#284B8C]"
                  >
                    {novaCategoria.open ? '✕ Cancelar' : '➕ Nova categoria'}
                  </button>
                </div>

                {novaCategoria.open ? (
                  <div className="border border-[#E2E8F0] rounded-lg p-3 space-y-2 bg-[#F8FAFC]">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={novaCategoria.nome}
                        onChange={(e) => setNovaCategoria(prev => ({ ...prev, nome: e.target.value }))}
                        placeholder="Nome da categoria"
                        className="flex-1 border border-[#E2E8F0] rounded-lg px-3 py-2 text-sm font-medium text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699]"
                      />
                      <input
                        type="color"
                        value={novaCategoria.cor}
                        onChange={(e) => setNovaCategoria(prev => ({ ...prev, cor: e.target.value }))}
                        className="w-11 h-10 border border-[#E2E8F0] rounded-lg cursor-pointer"
                        title="Cor da categoria"
                      />
                    </div>
                    {novaCategoria.erro && <p className="text-xs font-bold text-red-600">{novaCategoria.erro}</p>}
                    <button
                      type="button"
                      onClick={salvarNovaCategoria}
                      disabled={novaCategoria.salvando}
                      className="w-full px-3 py-2 rounded-lg font-bold text-xs uppercase tracking-wider bg-[#336699] text-white hover:bg-[#284B8C] transition-colors disabled:opacity-50"
                    >
                      {novaCategoria.salvando ? 'Salvando...' : 'Salvar categoria'}
                    </button>
                  </div>
                ) : (
                  <select
                    value={modalAgenda.categoriaId}
                    onChange={(e) => setModalAgenda(prev => ({ ...prev, categoriaId: e.target.value }))}
                    className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm font-bold text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699]"
                  >
                    {agendaCategorias.length === 0 && <option value="">Nenhuma categoria cadastrada</option>}
                    {agendaCategorias.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.nome}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-black text-[#64748B] uppercase tracking-wider mb-1">Descrição</label>
                <input
                  type="text"
                  value={modalAgenda.texto}
                  onChange={(e) => setModalAgenda(prev => ({ ...prev, texto: e.target.value }))}
                  placeholder="Ex: Manutenção preventiva - Galpão"
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm font-medium text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-[#64748B] uppercase tracking-wider mb-1">Local (opcional)</label>
                <input
                  type="text"
                  value={modalAgenda.local}
                  onChange={(e) => setModalAgenda(prev => ({ ...prev, local: e.target.value }))}
                  placeholder="Ex: Galpão Central"
                  className="w-full border border-[#E2E8F0] rounded-lg px-3 py-2.5 text-sm font-medium text-[#0C1D4D] focus:outline-none focus:ring-2 focus:ring-[#336699]"
                />
              </div>

              {modalAgenda.erro && (
                <p className="text-xs font-bold text-red-600">{modalAgenda.erro}</p>
              )}
            </div>

            <div className="p-5 border-t border-[#E2E8F0] flex justify-end gap-3">
              <button
                onClick={() => setModalAgenda({ open: false, data: '', categoriaId: '', texto: '', local: '', salvando: false, erro: null })}
                disabled={modalAgenda.salvando}
                className="px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider bg-[#F0F4F8] text-[#0C1D4D] hover:bg-[#E2E8F0] transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={salvarAgendaManual}
                disabled={modalAgenda.salvando}
                className="px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider bg-[#336699] text-white hover:bg-[#284B8C] transition-colors disabled:opacity-50"
              >
                {modalAgenda.salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
