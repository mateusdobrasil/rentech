// ============================================================================
// CALL TIME — motor do grid de luz (Fase 4)
//
// Mesmo formato do motor do LED: funções puras sobre um estado, sem React,
// para dar pra simular partida por partida antes de desenhar tela nenhuma.
//
// O inimigo aqui não é o peso — é o endereço. Um universo DMX tem 512 canais
// e aguenta 32 aparelhos na linha; um moving come 16 canais e um par LED, 10.
// Quem não faz essa conta antes de subir o grid descobre na passagem, com o
// grid a 6 m do chão e o cliente na plateia.
// ============================================================================

import {
  ENERGIA, TOMADAS_A, wUtil, wNominal, fmtKw, type Tomada,
} from '../eletrica';
import {
  PONTOS_ICAMENTO, TRUSS_Q30_KG_POR_M, CUSTO_TALHA_FOLGADA,
} from '../rigging';

export { ENERGIA, TOMADAS_A, wUtil, fmtKw } from '../eletrica';
export type { Tomada } from '../eletrica';
export { TALHAS_KG, talhaRecomendada, CUSTO_TALHA_FOLGADA } from '../rigging';

// ---------------------------------------------------------------------------
// As peças
// ---------------------------------------------------------------------------

export type TipoPeca = 'moving' | 'par';

export const PECAS: Record<TipoPeca, {
  rotulo: string;
  curto: string;
  /** Canais DMX que a peça ocupa no modo de trabalho. */
  canais: number;
  watts: number;
  pesoKg: number;
  /** Minutos de garra, posicionamento e cabo, com o truss ainda no chão. */
  minutos: number;
  nota: string;
}> = {
  moving: {
    rotulo: 'Moving beam',
    curto: 'Moving',
    canais: 16,
    watts: 400,
    pesoKg: 20,
    minutos: 4,
    nota: 'Cabeça móvel, no modo estendido de 16 canais.',
  },
  par: {
    rotulo: 'Par LED',
    curto: 'Par',
    canais: 10,
    watts: 200,
    pesoKg: 4,
    minutos: 2,
    nota: 'Wash de rosto, RGBW em 10 canais.',
  },
};

/** Um universo DMX tem 512 canais. Não tem 513. */
export const CANAIS_POR_UNIVERSO = 512;

/**
 * Limite de aparelhos numa linha DMX. É elétrico, não é regra de jogo: o
 * RS-485 aguenta 32 cargas antes do sinal começar a falhar, e é por isso que
 * grid grande pede splitter e mais uma linha mesmo sobrando canal.
 */
export const PECAS_POR_LINHA = 32;

// ---------------------------------------------------------------------------
// O grid: duas varas, cada uma com a sua função
// ---------------------------------------------------------------------------

export type Vara = 'frontal' | 'contra';

export const VARAS: { id: Vara; rotulo: string; peca: TipoPeca; descricao: string }[] = [
  {
    id: 'frontal',
    rotulo: 'Vara frontal',
    peca: 'par',
    descricao: 'Luz de rosto, à frente do palco. É ela que entrega a plateia para a câmera.',
  },
  {
    id: 'contra',
    rotulo: 'Vara de contra',
    peca: 'moving',
    descricao: 'Efeito e contraluz, atrás de quem está no palco. É onde o moving trabalha.',
  },
];

export const POSICOES_MAX = 24;
/** Espaço entre garras. */
export const ESPACO_GARRA_M = 0.5;
export const VARA_M = POSICOES_MAX * ESPACO_GARRA_M;
export const TOTAL_POSICOES = VARAS.length * POSICOES_MAX;

export const varaDe = (i: number) => Math.floor(i / POSICOES_MAX);
export const posicaoDe = (i: number) => i % POSICOES_MAX;
export const indice = (vara: number, posicao: number) => vara * POSICOES_MAX + posicao;
export const pecaDaVara = (vara: number) => VARAS[vara].peca;

// ---------------------------------------------------------------------------
// Custos e penalidades, em minutos
// ---------------------------------------------------------------------------

export const CUSTO = {
  /** Cabo de aço de segurança, peça por peça. */
  caboAco: 1,
  remover: 1,
  /** Puxar mais uma linha DMX do rack até o grid, com splitter. */
  puxarUniverso: 4,
  icar: 15,
  /** Focar o grid e gravar as cenas na mesa. */
  focoBase: 12,
  focoPorMoving: 1,
  gravarCenas: 10,
} as const;

/** Pendurar peça com o grid já no ar: escada, plataforma e paciência. */
export const MULT_NO_AR = 3;

export const custoPendurar = (t: TipoPeca, icado: boolean) =>
  PECAS[t].minutos * (icado ? MULT_NO_AR : 1);

export const PENALIDADE = {
  /** Peças que a mesa não alcança: ninguém acende no show. */
  universoEstourado: 10,
  circuitoSobrecarregado: 15,
} as const;

/** Minutos de atraso que o evento ainda absorve. */
export const ATRASO_TOLERADO = 30;

export const HORA_INICIAL = 14 * 60;

// ---------------------------------------------------------------------------
// A obra
// ---------------------------------------------------------------------------

export type AplicacaoLuz = 'show' | 'congresso' | 'baile';

export const APLICACOES: Record<AplicacaoLuz, {
  rotulo: string;
  descricao: string;
  movings: [number, number];
  pars: [number, number];
  /** Peças que o cliente ainda pode pedir a mais no meio da montagem. */
  cresce: TipoPeca;
  /** Peças faltando que a plateia daquele evento ainda não percebe. */
  tolerancia: number;
}> = {
  show: {
    rotulo: 'Show',
    descricao: 'Banda no palco, plateia em pé. É a luz que faz o show.',
    movings: [12, 18],
    pars: [10, 16],
    cresce: 'moving',
    tolerancia: 0,
  },
  congresso: {
    rotulo: 'Congresso',
    descricao: 'Palestra com câmera gravando. Rosto bem iluminado vale mais que efeito.',
    movings: [6, 10],
    pars: [14, 20],
    cresce: 'par',
    tolerancia: 1,
  },
  baile: {
    rotulo: 'Baile',
    descricao: 'Formatura ou casamento: pista a noite inteira, com cena para cada momento.',
    movings: [10, 16],
    pars: [8, 14],
    cresce: 'moving',
    tolerancia: 1,
  },
};

const EVENTOS: Record<AplicacaoLuz, string[]> = {
  show: ['Festival de Inverno', 'Show de Aniversário da Cidade', 'Turnê Regional'],
  congresso: ['Congresso de Cardiologia', 'Convenção de Vendas', 'Fórum de Infraestrutura'],
  baile: ['Formatura de Medicina', 'Baile de Debutante', 'Casamento no Salão Nobre'],
};

export type BriefingLuz = {
  aplicacao: AplicacaoLuz;
  evento: string;
  movings: number;
  pars: number;
  /** Disjuntor das tomadas do local. Quantos circuitos puxar é conta do técnico. */
  tomadaA: Tomada;
  janelaMin: number;
  os: number;
};

const sortear = <T,>(lista: readonly T[]) => lista[Math.floor(Math.random() * lista.length)];
const entre = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

export function sortearBriefing(): BriefingLuz {
  const aplicacao = sortear(['show', 'congresso', 'baile'] as const);
  const meta = APLICACOES[aplicacao];
  const movings = entre(meta.movings[0], meta.movings[1]);
  const pars = entre(meta.pars[0], meta.pars[1]);
  const tomadaA = sortear(TOMADAS_A);

  return {
    aplicacao,
    evento: sortear(EVENTOS[aplicacao]),
    movings,
    pars,
    tomadaA,
    janelaMin: janelaPara(movings, pars, tomadaA),
    os: entre(4100, 9899),
  };
}

// ---------------------------------------------------------------------------
// As contas da obra
// ---------------------------------------------------------------------------

export const canaisDe = (movings: number, pars: number) =>
  movings * PECAS.moving.canais + pars * PECAS.par.canais;

export const wattsDe = (movings: number, pars: number) =>
  movings * PECAS.moving.watts + pars * PECAS.par.watts;

/** As peças da obra, do maior bloco para o menor — é assim que se enche linha. */
const listaDePecas = <T,>(movings: number, pars: number, valor: (t: TipoPeca) => T): T[] => [
  ...Array<T>(movings).fill(valor('moving')),
  ...Array<T>(pars).fill(valor('par')),
];

/**
 * Quantas linhas DMX a obra pede. Dois limites na mesma linha: os 512 canais
 * do universo e os 32 aparelhos que o RS-485 aguenta. A conta é de encher
 * linha, não de dividir total por teto — peça não se parte no meio.
 */
export function universosPara(movings: number, pars: number): number {
  const linhas: { canais: number; pecas: number }[] = [];
  for (const canais of listaDePecas(movings, pars, (t) => PECAS[t].canais)) {
    const cabe = linhas.find((l) => l.canais + canais <= CANAIS_POR_UNIVERSO && l.pecas < PECAS_POR_LINHA);
    if (cabe) { cabe.canais += canais; cabe.pecas += 1; }
    else linhas.push({ canais, pecas: 1 });
  }
  return linhas.length;
}

/**
 * Quantos circuitos a obra pede. Mesma lógica: um moving de 400 W não se
 * divide entre dois circuitos, então `carga total ÷ teto` mente. Numa tomada
 * de 10 A cabem 4 movings por circuito (1.600 W), e os 160 W que sobram não
 * servem para nada.
 */
export function circuitosPara(movings: number, pars: number, a: Tomada): number {
  const teto = wUtil(a);
  const linhas: number[] = [];
  for (const watts of listaDePecas(movings, pars, (t) => PECAS[t].watts)) {
    const k = linhas.findIndex((carga) => carga + watts <= teto);
    if (k >= 0) linhas[k] += watts;
    else linhas.push(watts);
  }
  return linhas.length;
}

export function pesoDoGrid(movings: number, pars: number): number {
  const truss = VARAS.length * VARA_M * TRUSS_Q30_KG_POR_M;
  return movings * PECAS.moving.pesoKg + pars * PECAS.par.pesoKg + truss;
}

/**
 * Quanto tempo a produção dá. Igual ao LED: o trabalho mínimo da obra, com
 * 30% de margem — que é o que o pedido do cliente no meio da montagem come.
 */
export function janelaPara(movings: number, pars: number, tomadaA: Tomada): number {
  const trabalho =
    movings * PECAS.moving.minutos + pars * PECAS.par.minutos
    + (movings + pars) * CUSTO.caboAco
    + CUSTO.icar
    + ENERGIA.base + circuitosPara(movings, pars, tomadaA) * ENERGIA.porCircuito
    + universosPara(movings, pars) * CUSTO.puxarUniverso
    + CUSTO.focoBase + movings * CUSTO.focoPorMoving + CUSTO.gravarCenas;
  return Math.round((trabalho * 1.3) / 5) * 5;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export type CelulaLuz = {
  peca: TipoPeca | null;
  /** Pendurada depois do içamento: é retrabalho, e o jogo cobra. */
  noAr: boolean;
  caboAco: boolean;
  universo: number | null;
  circuito: number | null;
};

export type LeituraOS = {
  tentativas: number;
  resolvida: boolean;
  dePrimeira: boolean;
};

export type EstadoLuz = {
  briefing: BriefingLuz;
  gastos: number;
  /** O pedido da vez — pode crescer no meio da montagem. */
  movings: number;
  pars: number;
  celulas: CelulaLuz[];
  icado: boolean;
  talhaKg: number | null;
  universosPuxados: number;
  circuitosPuxados: number;
  retrabalho: number;
  imprevistoDisparado: boolean;
  finalizado: boolean;
  leitura: LeituraOS;
};

export function criarPartida(briefing: BriefingLuz = sortearBriefing()): EstadoLuz {
  return {
    briefing,
    gastos: 0,
    movings: briefing.movings,
    pars: briefing.pars,
    celulas: Array.from({ length: TOTAL_POSICOES }, () => ({
      peca: null,
      noAr: false,
      caboAco: false,
      universo: null,
      circuito: null,
    })),
    icado: false,
    talhaKg: null,
    universosPuxados: 0,
    circuitosPuxados: 0,
    retrabalho: 0,
    imprevistoDisparado: false,
    finalizado: false,
    leitura: { tentativas: 0, resolvida: false, dePrimeira: false },
  };
}

// ---------------------------------------------------------------------------
// O pedido do cliente no meio da montagem
// ---------------------------------------------------------------------------

/** Fração do grid montada a partir da qual o cliente liga pedindo mais. */
export const FRACAO_IMPREVISTO = 0.6;

export const minutoImprevisto = (e: EstadoLuz) => Math.round(e.briefing.janelaMin * 0.4);

export const pecasPedidas = (e: EstadoLuz) => e.movings + e.pars;

export const pecasPenduradas = (e: EstadoLuz) =>
  e.celulas.reduce((n, c) => n + (c.peca ? 1 : 0), 0);

/** Com 40% da janela gasta OU 60% do grid pendurado — e nunca com a partida fechada. */
export function deveDispararImprevisto(e: EstadoLuz): boolean {
  if (e.imprevistoDisparado || e.finalizado) return false;
  return e.gastos >= minutoImprevisto(e)
    || pecasPenduradas(e) >= Math.ceil(pecasPedidas(e) * FRACAO_IMPREVISTO);
}

/** Quantas peças o cliente pede a mais. */
export const PECAS_DO_IMPREVISTO = 4;

export function aplicarImprevisto(e: EstadoLuz): EstadoLuz {
  const cresce = APLICACOES[e.briefing.aplicacao].cresce;
  const cabe = (n: number) => Math.min(POSICOES_MAX, n + PECAS_DO_IMPREVISTO);
  return cresce === 'moving'
    ? { ...e, movings: cabe(e.movings), imprevistoDisparado: true }
    : { ...e, pars: cabe(e.pars), imprevistoDisparado: true };
}

/** Quantas peças o imprevisto acrescentou, para o aviso na tela. */
export function pecasDoImprevisto(e: EstadoLuz): { tipo: TipoPeca; quantas: number } {
  const tipo = APLICACOES[e.briefing.aplicacao].cresce;
  const antes = tipo === 'moving' ? e.briefing.movings : e.briefing.pars;
  const agora = tipo === 'moving' ? e.movings : e.pars;
  return { tipo, quantas: agora - antes };
}

// ---------------------------------------------------------------------------
// Leitura da grade
// ---------------------------------------------------------------------------

export const janelaDe = (e: EstadoLuz) => e.briefing.janelaMin;
export const folga = (e: EstadoLuz) => Math.max(0, janelaDe(e) - e.gastos);

export function relogio(gastos: number, janelaMin: number): string {
  const t = HORA_INICIAL + Math.min(gastos, janelaMin);
  const h = Math.floor(t / 60) % 24;
  const m = Math.round(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const celulasOnde = (e: EstadoLuz, teste: (c: CelulaLuz, i: number) => boolean) =>
  e.celulas.map((c, i) => (teste(c, i) ? i : -1)).filter((i) => i >= 0);

export const contarPeca = (e: EstadoLuz, tipo: TipoPeca) =>
  e.celulas.reduce((n, c) => n + (c.peca === tipo ? 1 : 0), 0);

/** Peça certa na vara certa: par na frontal, moving no contra. */
export const noLugarCerto = (c: CelulaLuz, i: number) =>
  c.peca !== null && c.peca === pecaDaVara(varaDe(i));

export const contarNoLugarCerto = (e: EstadoLuz, tipo: TipoPeca) =>
  e.celulas.reduce((n, c, i) => n + (noLugarCerto(c, i) && c.peca === tipo ? 1 : 0), 0);

export const pedidoDe = (e: EstadoLuz, tipo: TipoPeca) => (tipo === 'moving' ? e.movings : e.pars);

export function faltando(e: EstadoLuz, tipo: TipoPeca): number {
  return Math.max(0, pedidoDe(e, tipo) - contarNoLugarCerto(e, tipo));
}

export function sobrando(e: EstadoLuz, tipo: TipoPeca): number {
  return Math.max(0, contarNoLugarCerto(e, tipo) - pedidoDe(e, tipo));
}

/** Peça pendurada na vara errada — moving na frontal, par no contra. */
export const celulasNaVaraErrada = (e: EstadoLuz) =>
  celulasOnde(e, (c, i) => c.peca !== null && !noLugarCerto(c, i));

export const canaisMontados = (e: EstadoLuz) =>
  e.celulas.reduce((n, c) => n + (c.peca ? PECAS[c.peca].canais : 0), 0);

export const wattsMontados = (e: EstadoLuz) =>
  e.celulas.reduce((n, c) => n + (c.peca ? PECAS[c.peca].watts : 0), 0);

export function cargaPorPonto(e: EstadoLuz): number {
  const peso = pesoDoGrid(contarPeca(e, 'moving'), contarPeca(e, 'par'));
  return Math.round(peso / PONTOS_ICAMENTO);
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export const puxarUniverso = (e: EstadoLuz): EstadoLuz => ({ ...e, universosPuxados: e.universosPuxados + 1 });

export function podeRecolherUniverso(e: EstadoLuz): boolean {
  const n = e.universosPuxados;
  return n > 0 && !e.celulas.some((c) => c.peca && c.universo === n);
}

export const recolherUniverso = (e: EstadoLuz): EstadoLuz =>
  podeRecolherUniverso(e) ? { ...e, universosPuxados: e.universosPuxados - 1 } : e;

export const puxarCircuito = (e: EstadoLuz): EstadoLuz => ({ ...e, circuitosPuxados: e.circuitosPuxados + 1 });

export function podeRecolherCircuito(e: EstadoLuz): boolean {
  const n = e.circuitosPuxados;
  return n > 0 && !e.celulas.some((c) => c.peca && c.circuito === n);
}

export const recolherCircuito = (e: EstadoLuz): EstadoLuz =>
  podeRecolherCircuito(e) ? { ...e, circuitosPuxados: e.circuitosPuxados - 1 } : e;

// ---------------------------------------------------------------------------
// Endereçamento e energia: como ficou cada linha
// ---------------------------------------------------------------------------

export function contarPorUniverso(e: EstadoLuz): Map<number, number[]> {
  const m = new Map<number, number[]>();
  e.celulas.forEach((c, i) => {
    if (!c.peca || c.universo === null) return;
    const lista = m.get(c.universo) ?? [];
    lista.push(i);
    m.set(c.universo, lista);
  });
  return m;
}

export function contarPorCircuito(e: EstadoLuz): Map<number, number[]> {
  const m = new Map<number, number[]>();
  e.celulas.forEach((c, i) => {
    if (!c.peca || c.circuito === null) return;
    const lista = m.get(c.circuito) ?? [];
    lista.push(i);
    m.set(c.circuito, lista);
  });
  return m;
}

export type SituacaoLinha = 'ideal' | 'sobra' | 'estourada';

/**
 * O endereço de cada peça sai da ordem em que ela está na linha: a primeira
 * começa no canal 1, a seguinte no canal seguinte ao bloco da anterior. O que
 * passar de 512 — ou da 32ª peça — não tem endereço e fica mudo.
 */
export function enderecos(e: EstadoLuz, universo: number): {
  celula: number; canalInicial: number; canalFinal: number; muda: boolean;
}[] {
  const lista = contarPorUniverso(e).get(universo) ?? [];
  let canal = 1;
  return lista.map((celula, ordem) => {
    const peca = e.celulas[celula].peca as TipoPeca;
    const canalInicial = canal;
    const canalFinal = canal + PECAS[peca].canais - 1;
    canal = canalFinal + 1;
    return {
      celula,
      canalInicial,
      canalFinal,
      muda: canalFinal > CANAIS_POR_UNIVERSO || ordem + 1 > PECAS_POR_LINHA,
    };
  });
}

export function situacaoUniversos(e: EstadoLuz): {
  universo: number; pecas: number; canais: number; mudas: number; situacao: SituacaoLinha;
}[] {
  const porUniverso = contarPorUniverso(e);
  const total = Math.max(e.universosPuxados, ...porUniverso.keys());
  const linhas = Array.from({ length: Math.max(0, total) }, (_, k) => {
    const universo = k + 1;
    const celulas = porUniverso.get(universo) ?? [];
    const canais = celulas.reduce((n, i) => n + PECAS[e.celulas[i].peca as TipoPeca].canais, 0);
    const mudas = enderecos(e, universo).filter((d) => d.muda).length;
    return { universo, pecas: celulas.length, canais, mudas };
  });

  const precisa = universosPara(contarPeca(e, 'moving'), contarPeca(e, 'par'));
  const aMais = Math.max(0, linhas.length - precisa);
  const deSobra = new Set(
    linhas
      .filter((l) => l.mudas === 0)
      .sort((a, b) => a.canais - b.canais || b.universo - a.universo)
      .slice(0, aMais)
      .map((l) => l.universo),
  );

  return linhas.map((l) => ({
    ...l,
    situacao: l.mudas > 0 ? 'estourada' : deSobra.has(l.universo) ? 'sobra' : 'ideal',
  }));
}

export function situacaoCircuitos(e: EstadoLuz): {
  circuito: number; pecas: number; watts: number; situacao: SituacaoLinha;
}[] {
  const porCircuito = contarPorCircuito(e);
  const teto = wUtil(e.briefing.tomadaA);
  const total = Math.max(e.circuitosPuxados, ...porCircuito.keys());
  const linhas = Array.from({ length: Math.max(0, total) }, (_, k) => {
    const circuito = k + 1;
    const celulas = porCircuito.get(circuito) ?? [];
    const watts = celulas.reduce((n, i) => n + PECAS[e.celulas[i].peca as TipoPeca].watts, 0);
    return { circuito, pecas: celulas.length, watts };
  });

  const precisa = circuitosPara(contarPeca(e, 'moving'), contarPeca(e, 'par'), e.briefing.tomadaA);
  const aMais = Math.max(0, linhas.length - precisa);
  const deSobra = new Set(
    linhas
      .filter((l) => l.watts <= teto)
      .sort((a, b) => a.watts - b.watts || b.circuito - a.circuito)
      .slice(0, aMais)
      .map((l) => l.circuito),
  );

  return linhas.map((l) => ({
    ...l,
    situacao: l.watts > teto ? 'estourada' : deSobra.has(l.circuito) ? 'sobra' : 'ideal',
  }));
}

// ---------------------------------------------------------------------------
// Custos do fechamento
// ---------------------------------------------------------------------------

export const custoDmx = (e: EstadoLuz) => e.universosPuxados * CUSTO.puxarUniverso;

export const custoEnergia = (e: EstadoLuz) => ENERGIA.base + e.circuitosPuxados * ENERGIA.porCircuito;

export const custoFoco = (e: EstadoLuz) =>
  CUSTO.focoBase + contarPeca(e, 'moving') * CUSTO.focoPorMoving + CUSTO.gravarCenas;

/** O que o botão "Fechar o grid" cobra de uma vez. */
export const custoFechamento = (e: EstadoLuz) => custoDmx(e) + custoEnergia(e) + custoFoco(e);

export const custoDmxIdeal = (e: EstadoLuz) =>
  universosPara(contarPeca(e, 'moving'), contarPeca(e, 'par')) * CUSTO.puxarUniverso;

export const custoEnergiaIdeal = (e: EstadoLuz) =>
  ENERGIA.base + circuitosPara(contarPeca(e, 'moving'), contarPeca(e, 'par'), e.briefing.tomadaA) * ENERGIA.porCircuito;

// ---------------------------------------------------------------------------
// Vistoria
// ---------------------------------------------------------------------------

export type Problema = {
  tipo: 'reprovacao' | 'tempo' | 'qualidade';
  texto: string;
  curto: string;
  /** Posições afetadas. Vazio = problema do grid inteiro. */
  celulas: number[];
  minutos?: number;
  qualidade?: number;
};

export type Vistoria = {
  problemas: Problema[];
  reprovado: boolean;
  qualidade: number;
  atraso: number;
  /** Minutos que os problemas custaram: saem da folga no placar. */
  minutosExtras: number;
};

export function vistoriar(e: EstadoLuz): Vistoria {
  const problemas: Problema[] = [];
  const penduradas = pecasPenduradas(e);
  const atraso = Math.max(0, e.gastos - janelaDe(e));

  // --- o que encerra a partida ---
  const semCaboAco = celulasOnde(e, (c) => c.peca !== null && !c.caboAco);
  if (semCaboAco.length > 0) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `${semCaboAco.length} ${semCaboAco.length === 1 ? 'peça pendurada sem cabo de aço' : 'peças penduradas sem cabo de aço'}. Uma garra que solta com o grid no ar é acidente, não apontamento.`,
      curto: 'Sem cabo de aço',
      celulas: semCaboAco,
    });
  }

  if (penduradas === 0) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'Nenhuma peça foi pendurada. O grid subiu vazio.',
      curto: 'Grid vazio',
      celulas: [],
    });
  } else if (!e.icado) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'O grid ficou no chão. A porta abriu com o truss deitado no palco.',
      curto: 'Grid não subiu',
      celulas: [],
    });
  }

  const carga = cargaPorPonto(e);
  if (e.icado && (e.talhaKg === null || e.talhaKg < carga)) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `Talha de ${e.talhaKg ?? 0} kg para ${carga} kg por ponto. Içar assim é acidente esperando acontecer.`,
      curto: 'Talha abaixo da carga',
      celulas: [],
    });
  }

  if (penduradas > 0 && !e.celulas.some((c) => c.peca && c.universo !== null)) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'Nenhuma linha DMX chegou ao grid. A mesa não fala com peça nenhuma.',
      curto: 'Sem DMX',
      celulas: [],
    });
  }

  if (penduradas > 0 && !e.celulas.some((c) => c.peca && c.circuito !== null)) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'Nenhum circuito foi ligado ao grid. Ele subiu apagado.',
      curto: 'Sem energia',
      celulas: [],
    });
  }

  const tolerancia = APLICACOES[e.briefing.aplicacao].tolerancia;
  for (const tipo of ['moving', 'par'] as TipoPeca[]) {
    const falta = faltando(e, tipo);
    if (falta === 0) continue;
    const rotulo = falta === 1 ? PECAS[tipo].curto.toLowerCase() : `${PECAS[tipo].curto.toLowerCase()}s`;
    problemas.push({
      tipo: falta > tolerancia ? 'reprovacao' : 'qualidade',
      texto: `Faltaram ${falta} ${rotulo} na ${VARAS.find((v) => v.peca === tipo)?.rotulo.toLowerCase()}. A OS pedia ${pedidoDe(e, tipo)}.`,
      curto: `Faltam ${falta} ${rotulo}`,
      celulas: [],
      qualidade: falta > tolerancia ? undefined : falta * 8,
    });
  }

  if (atraso > ATRASO_TOLERADO) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `${atraso} min de atraso. A porta abriu com o grid ainda em foco.`,
      curto: `${atraso} min de atraso`,
      celulas: [],
    });
  }

  // --- o que custa tempo ---
  for (const linha of situacaoUniversos(e)) {
    if (linha.mudas === 0) continue;
    const porCanal = linha.canais > CANAIS_POR_UNIVERSO;
    problemas.push({
      tipo: 'tempo',
      texto: porCanal
        ? `Universo ${linha.universo} com ${linha.canais} canais: o universo tem ${CANAIS_POR_UNIVERSO}. ${linha.mudas} ${linha.mudas === 1 ? 'peça ficou sem endereço' : 'peças ficaram sem endereço'} e não acenderam.`
        : `Universo ${linha.universo} com ${linha.pecas} aparelhos na mesma linha: o RS-485 aguenta ${PECAS_POR_LINHA}. ${linha.mudas} ${linha.mudas === 1 ? 'peça ficou sem resposta' : 'peças ficaram sem resposta'} na passagem.`,
      curto: `Universo ${linha.universo} estourado`,
      celulas: enderecos(e, linha.universo).filter((d) => d.muda).map((d) => d.celula),
      minutos: PENALIDADE.universoEstourado,
      qualidade: Math.min(45, linha.mudas * 6),
    });
  }

  const teto = wUtil(e.briefing.tomadaA);
  for (const linha of situacaoCircuitos(e)) {
    if (linha.situacao !== 'estourada') continue;
    problemas.push({
      tipo: 'tempo',
      texto: `Circuito ${linha.circuito} com ${linha.pecas} peças: ${fmtKw(linha.watts)}. O disjuntor de ${e.briefing.tomadaA} A aguenta ${fmtKw(wNominal(e.briefing.tomadaA))} no limite, e a régua de trabalho é ${fmtKw(teto)} — caiu no primeiro blackout da cena.`,
      curto: `Circuito ${linha.circuito} sobrecarregado`,
      celulas: contarPorCircuito(e).get(linha.circuito) ?? [],
      minutos: PENALIDADE.circuitoSobrecarregado,
      qualidade: 15,
    });
  }

  for (const tipo of ['moving', 'par'] as TipoPeca[]) {
    const sobra = sobrando(e, tipo);
    if (sobra === 0) continue;
    const rotulo = sobra === 1 ? PECAS[tipo].curto.toLowerCase() : `${PECAS[tipo].curto.toLowerCase()}s`;
    problemas.push({
      tipo: 'tempo',
      texto: `${sobra} ${rotulo} a mais que a OS pediu. Peça pendurada à toa é peso no truss e tempo de foco.`,
      curto: `${sobra} ${rotulo} a mais`,
      celulas: [],
      minutos: Math.min(16, 4 + sobra * 2),
      qualidade: Math.min(20, sobra * 4),
    });
  }

  // --- o que custa nota ---
  const varaErrada = celulasNaVaraErrada(e);
  if (varaErrada.length > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${varaErrada.length} ${varaErrada.length === 1 ? 'peça pendurada na vara errada' : 'peças penduradas na vara errada'}: par é luz de rosto e vai na frontal; moving é efeito e vai no contra.`,
      curto: 'Peça na vara errada',
      celulas: varaErrada,
      qualidade: Math.min(40, varaErrada.length * 6),
    });
  }

  const semUniverso = celulasOnde(e, (c) => c.peca !== null && c.universo === null);
  if (semUniverso.length > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${semUniverso.length} ${semUniverso.length === 1 ? 'peça ficou' : 'peças ficaram'} sem linha DMX — a mesa não acha o endereço.`,
      curto: 'Peças sem DMX',
      celulas: semUniverso,
      qualidade: Math.min(50, semUniverso.length * 5),
    });
  }

  const semCircuito = celulasOnde(e, (c) => c.peca !== null && c.circuito === null);
  if (semCircuito.length > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${semCircuito.length} ${semCircuito.length === 1 ? 'peça ficou' : 'peças ficaram'} sem energia — apagadas no grid.`,
      curto: 'Peças sem energia',
      celulas: semCircuito,
      qualidade: Math.min(50, semCircuito.length * 5),
    });
  }

  const noAr = celulasOnde(e, (c) => c.peca !== null && c.noAr);
  if (noAr.length > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${noAr.length} ${noAr.length === 1 ? 'peça foi pendurada' : 'peças foram penduradas'} com o grid já no ar. Dá para fazer, mas é escada, é lento e é onde acontece acidente.`,
      curto: 'Montagem no ar',
      celulas: noAr,
      qualidade: Math.min(20, noAr.length * 3),
    });
  }

  const qualidade = Math.max(0, 100 - problemas.reduce((n, p) => n + (p.qualidade ?? 0), 0));
  return {
    problemas,
    reprovado: problemas.some((p) => p.tipo === 'reprovacao'),
    qualidade,
    atraso,
    minutosExtras: problemas.reduce((n, p) => n + (p.minutos ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Placar
// ---------------------------------------------------------------------------

export const BONUS_SEM_RETRABALHO = 150;
export const BONUS_LEITURA = 100;

export function pontuar(e: EstadoLuz, v: Vistoria) {
  const folgaMin = Math.max(0, janelaDe(e) - e.gastos - v.minutosExtras);
  const daFolga = folgaMin * 10;
  const daQualidade = v.qualidade * 5;
  const semRetrabalho = e.retrabalho === 0 && !v.reprovado ? BONUS_SEM_RETRABALHO : 0;
  const daLeitura = e.leitura.dePrimeira && !v.reprovado ? BONUS_LEITURA : 0;
  const total = v.reprovado ? 0 : daFolga + daQualidade + semRetrabalho + daLeitura;
  return { folgaMin, daFolga, daQualidade, semRetrabalho, daLeitura, total, reprovado: v.reprovado };
}

// ---------------------------------------------------------------------------
// Leitura da OS: a conta que o técnico faz antes de encostar no truss
// ---------------------------------------------------------------------------

export const CUSTO_CONSULTA_OS = [5, 10];

export const respostaOS = (b: BriefingLuz) => ({
  canais: canaisDe(b.movings, b.pars),
  universos: universosPara(b.movings, b.pars),
});

export function lerNumero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\s/g, '').replace(/[.,](?=\d{3}$)/, '');
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

export type ConferenciaOS = { canaisOk: boolean; universosOk: boolean };

export function conferirLeitura(b: BriefingLuz, canais: string, universos: string): ConferenciaOS {
  const certo = respostaOS(b);
  return {
    canaisOk: lerNumero(canais) === certo.canais,
    universosOk: lerNumero(universos) === certo.universos,
  };
}

/** A conta escrita por extenso, para quem errou aprender de onde ela sai. */
export function contaOS(b: BriefingLuz): string[] {
  const canais = canaisDe(b.movings, b.pars);
  const pecas = b.movings + b.pars;
  return [
    `${b.movings} movings × ${PECAS.moving.canais} canais = ${b.movings * PECAS.moving.canais}`,
    `${b.pars} pars × ${PECAS.par.canais} canais = ${b.pars * PECAS.par.canais}`,
    `Total: ${canais} canais em ${pecas} aparelhos`,
    `${canais} ÷ ${CANAIS_POR_UNIVERSO} = ${Math.ceil(canais / CANAIS_POR_UNIVERSO)} · ${pecas} ÷ ${PECAS_POR_LINHA} aparelhos por linha = ${Math.ceil(pecas / PECAS_POR_LINHA)} → ${universosPara(b.movings, b.pars)} ${universosPara(b.movings, b.pars) === 1 ? 'universo' : 'universos'}`,
  ];
}

/** O que a lição do placar mostra sobre DMX. */
export function licaoDmx(e: EstadoLuz) {
  const linhas = situacaoUniversos(e);
  const movings = contarPeca(e, 'moving');
  const pars = contarPeca(e, 'par');
  const canais = canaisMontados(e);
  const pecas = movings + pars;
  return {
    linhas,
    puxados: linhas.length,
    minimo: universosPara(movings, pars),
    canais,
    pecas,
    mudas: linhas.reduce((n, l) => n + l.mudas, 0),
    minutos: custoDmx(e),
    minutosIdeal: custoDmxIdeal(e),
    conta: `${movings} movings × ${PECAS.moving.canais} + ${pars} pars × ${PECAS.par.canais} = ${canais} canais em ${pecas} aparelhos. `
      + `Um universo tem ${CANAIS_POR_UNIVERSO} canais e a linha aguenta ${PECAS_POR_LINHA} aparelhos`,
  };
}

/** O que a lição do placar mostra sobre energia. */
export function licaoEnergia(e: EstadoLuz) {
  const linhas = situacaoCircuitos(e);
  const a = e.briefing.tomadaA;
  return {
    linhas,
    puxados: linhas.length,
    minimo: circuitosPara(contarPeca(e, 'moving'), contarPeca(e, 'par'), a),
    watts: wattsMontados(e),
    wattsUtil: wUtil(a),
    minutos: custoEnergia(e),
    minutosIdeal: custoEnergiaIdeal(e),
    conta: `${contarPeca(e, 'moving')} movings × ${PECAS.moving.watts} W + ${contarPeca(e, 'par')} pars × ${PECAS.par.watts} W = ${fmtKw(wattsMontados(e))}. `
      + `Tomada de ${a} A: ${fmtKw(wNominal(a))} no limite do disjuntor, ${fmtKw(wUtil(a))} de régua de trabalho por circuito`,
  };
}

// ---------------------------------------------------------------------------
// O que o pincel faz na grade
//
// Fica aqui, e não na tela, para a simulação jogar a partida pelo mesmo
// caminho que o técnico joga — inclusive nos custos e no retrabalho.
// ---------------------------------------------------------------------------

/** Pendura peças nas posições alvo. No ar custa o triplo, e a diferença é retrabalho. */
export function pendurarEm(e: EstadoLuz, alvos: number[], tipo: TipoPeca): EstadoLuz {
  let celulas = e.celulas;
  let gastos = e.gastos;
  let retrabalho = e.retrabalho;

  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.peca !== null) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, peca: tipo, noAr: e.icado };
    gastos += custoPendurar(tipo, e.icado);
    if (e.icado) retrabalho += custoPendurar(tipo, true) - PECAS[tipo].minutos;
  }

  return celulas === e.celulas ? e : { ...e, celulas, gastos, retrabalho };
}

/** Tira a peça: some com cabo de aço, endereço e circuito junto. */
export function removerEm(e: EstadoLuz, alvos: number[]): EstadoLuz {
  let celulas = e.celulas;
  let gastos = e.gastos;
  let retrabalho = e.retrabalho;

  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.peca === null) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { peca: null, noAr: false, caboAco: false, universo: null, circuito: null };
    gastos += CUSTO.remover;
    retrabalho += CUSTO.remover;
  }

  return celulas === e.celulas ? e : { ...e, celulas, gastos, retrabalho };
}

/** Cabo de aço nas peças alvo. Sem cabo de aço a partida acaba na vistoria. */
export function caboAcoEm(e: EstadoLuz, alvos: number[]): EstadoLuz {
  let celulas = e.celulas;
  let gastos = e.gastos;

  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.peca === null || c.caboAco) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, caboAco: true };
    gastos += CUSTO.caboAco;
  }

  return celulas === e.celulas ? e : { ...e, celulas, gastos };
}

export type Atribuicao = 'universo' | 'circuito';

/**
 * Joga a linha escolhida em todas as peças alvo, caiba ou não: quem passar do
 * teto descobre na vistoria. Sem ajuda, igual ao motor do LED.
 */
export function atribuirEm(e: EstadoLuz, alvos: number[], campo: Atribuicao, n: number): EstadoLuz {
  const limite = campo === 'universo' ? e.universosPuxados : e.circuitosPuxados;
  if (!(n >= 1 && n <= limite)) return e;

  let celulas = e.celulas;
  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.peca === null || c[campo] === n) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, [campo]: n };
  }
  return celulas === e.celulas ? e : { ...e, celulas };
}

export function limparAtribuicaoEm(e: EstadoLuz, alvos: number[], campo: Atribuicao): EstadoLuz {
  let celulas = e.celulas;
  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.peca === null || c[campo] === null) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, [campo]: null };
  }
  return celulas === e.celulas ? e : { ...e, celulas };
}

/** Içar o grid: daqui para a frente, peça nova custa o triplo. */
export function icar(e: EstadoLuz): EstadoLuz {
  if (e.icado || e.talhaKg === null) return e;
  const extra = CUSTO_TALHA_FOLGADA[e.talhaKg] ?? 0;
  return {
    ...e,
    icado: true,
    gastos: e.gastos + CUSTO.icar + extra,
    retrabalho: e.retrabalho + extra,
  };
}

/** Fecha a partida: DMX, energia, foco e cenas gravadas, tudo de uma vez. */
export function finalizar(e: EstadoLuz): EstadoLuz {
  if (e.finalizado) return e;
  return { ...e, gastos: e.gastos + custoFechamento(e), finalizado: true };
}
