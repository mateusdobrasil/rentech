// ============================================================================
// CALL TIME — motor do PA (Fase 4: som)
//
// O sistema mais curto de montar e o mais fácil de estragar nos últimos trinta
// segundos. Três contas e uma regra de ouro:
//
//   1. Impedância. Caixa de 8 Ω em paralelo com outra dá 4 Ω, que é o mínimo
//      do canal. A terceira caixa no mesmo canal derruba para 2,7 Ω e o
//      amplificador entra em proteção no meio do show.
//   2. Cobertura. A soma dos ângulos entre as caixas fecha o ângulo que a
//      plateia pede, e os ângulos abrem de cima para baixo — caixa de cima
//      joga longe, caixa de baixo cobre quem está perto.
//   3. Delay. Som anda 343 m/s, ou 2,92 ms por metro. Torre sem delay é eco.
//
// E a regra de ouro: liga mesa, depois processador, depois amplificador. Ao
// contrário é estouro no PA com o cliente na sala.
// ============================================================================

import {
  PONTOS_ICAMENTO, CUSTO_TALHA_FOLGADA,
} from '../rigging';

export { TALHAS_KG, talhaRecomendada, CUSTO_TALHA_FOLGADA } from '../rigging';

// ---------------------------------------------------------------------------
// As caixas
// ---------------------------------------------------------------------------

export type TipoCaixa = 'caixa' | 'sub';

export const CAIXAS: Record<TipoCaixa, {
  rotulo: string;
  curto: string;
  /** Impedância nominal. Em paralelo, divide. */
  ohms: number;
  watts: number;
  pesoKg: number;
  minutos: number;
  nota: string;
}> = {
  caixa: {
    rotulo: 'Caixa de line array',
    curto: 'Caixa',
    ohms: 8,
    watts: 500,
    pesoKg: 40,
    minutos: 5,
    nota: '8 Ω, 500 W. Duas em paralelo fecham os 4 Ω do canal.',
  },
  sub: {
    rotulo: 'Subgrave',
    curto: 'Sub',
    ohms: 4,
    watts: 1000,
    pesoKg: 65,
    minutos: 4,
    nota: '4 Ω, 1.000 W. Já chega no mínimo do canal sozinho.',
  },
};

/** Canal de amplificador: o mínimo é 4 Ω, e ele entrega 2.000 W aí. */
export const AMPLIFICADOR = {
  ohmsMin: 4,
  wattsPorCanal: 2000,
  /** Rack, cabo de força e speakon até o PA. */
  minutos: 6,
} as const;

/** Impedância de n caixas iguais em paralelo. */
export const impedancia = (ohms: number, n: number) => (n > 0 ? ohms / n : Infinity);

export const VELOCIDADE_SOM = 343;
/** 2,92 ms por metro: é essa a conta do delay da torre. */
export const MS_POR_METRO = 1000 / VELOCIDADE_SOM;

export const delayPara = (metros: number) => Math.round(metros * MS_POR_METRO);

// ---------------------------------------------------------------------------
// O PA: dois lados de line array e uma fila de subs
// ---------------------------------------------------------------------------

export type Fila = 'esquerdo' | 'direito' | 'subs';

export const FILAS: { id: Fila; rotulo: string; tipo: TipoCaixa; descricao: string }[] = [
  { id: 'esquerdo', rotulo: 'PA esquerdo', tipo: 'caixa', descricao: 'Line array voado à esquerda do palco, de cima para baixo.' },
  { id: 'direito', rotulo: 'PA direito', tipo: 'caixa', descricao: 'O espelho do esquerdo: mesma quantidade, mesmos ângulos.' },
  { id: 'subs', rotulo: 'Subs', tipo: 'sub', descricao: 'No chão, à frente do palco.' },
];

export const POSICOES_MAX = 8;
export const TOTAL_POSICOES = FILAS.length * POSICOES_MAX;

export const filaDe = (i: number) => Math.floor(i / POSICOES_MAX);
export const posicaoDe = (i: number) => i % POSICOES_MAX;
export const indice = (fila: number, posicao: number) => fila * POSICOES_MAX + posicao;
export const tipoDaFila = (fila: number) => FILAS[fila].tipo;
export const ehLado = (fila: number) => FILAS[fila].id !== 'subs';

/** Ângulos que a ferragem do line array aceita entre uma caixa e a seguinte. */
export const ANGULOS = [0, 1, 2, 3, 4, 5, 6] as const;

/** A cobertura fecha se a soma dos ângulos do lado bater com o pedido. */
export const TOLERANCIA_GRAUS = 2;

// ---------------------------------------------------------------------------
// Subs: arco ou cardioide
// ---------------------------------------------------------------------------

export type Arranjo = 'arco' | 'cardioide';

export const ARRANJOS: Record<Arranjo, { rotulo: string; descricao: string }> = {
  arco: {
    rotulo: 'Arco',
    descricao: 'Subs em arco na frente do palco: grave espalhado na pista inteira.',
  },
  cardioide: {
    rotulo: 'Cardioide',
    descricao: 'Uma caixa virada para trás e atrasada: tira o grave do palco e do microfone.',
  },
};

// ---------------------------------------------------------------------------
// Energização: a regra de ouro
// ---------------------------------------------------------------------------

export type Equipamento = 'mesa' | 'processador' | 'amplificador';

/** Liga nessa ordem. Para desligar, o inverso. */
export const ORDEM_LIGA: Equipamento[] = ['mesa', 'processador', 'amplificador'];

export const EQUIPAMENTOS: Record<Equipamento, { rotulo: string; nota: string }> = {
  mesa: { rotulo: 'Mesa', nota: 'Primeira a ligar, última a desligar.' },
  processador: { rotulo: 'Processador', nota: 'Entre a mesa e o amplificador.' },
  amplificador: { rotulo: 'Amplificador', nota: 'Último a ligar, primeiro a desligar.' },
};

// ---------------------------------------------------------------------------
// Custos e penalidades, em minutos
// ---------------------------------------------------------------------------

export const CUSTO = {
  caboAco: 1,
  remover: 1,
  icar: 15,
  /** Multicabo, palco e retornos. */
  palco: 12,
  /** Passagem de som e ring out. */
  passagem: 15,
} as const;

/** Mexer em ângulo com o PA já no ar: é subir de novo. */
export const CUSTO_ANGULO_NO_AR = 4;
export const MULT_NO_AR = 3;

export const custoPendurar = (t: TipoCaixa, icado: boolean) =>
  CAIXAS[t].minutos * (icado && t === 'caixa' ? MULT_NO_AR : 1);

export const PENALIDADE = {
  /** Amplificador em proteção: o lado cala no meio do show. */
  protecao: 15,
  /** Estouro no PA na frente do cliente. */
  ordemErrada: 10,
} as const;

/**
 * Fração do sistema que pode ficar muda antes de a entrega deixar de existir.
 * Sem essa régua, puxar menos canal compensava: o técnico economizava 6 min
 * por canal e pagava 15 de penalidade uma vez só.
 */
export const FRACAO_MUDA_REPROVA = 0.25;

export const ATRASO_TOLERADO = 30;
export const HORA_INICIAL = 14 * 60;

// ---------------------------------------------------------------------------
// A obra
// ---------------------------------------------------------------------------

export type AplicacaoSom = 'show' | 'congresso' | 'igreja';

export const APLICACOES: Record<AplicacaoSom, {
  rotulo: string;
  descricao: string;
  caixas: [number, number];
  subs: [number, number];
  /** Arranjo de sub que o evento pede. */
  arranjo: Arranjo;
  porqueArranjo: string;
}> = {
  show: {
    rotulo: 'Show',
    descricao: 'Banda e pista cheia. Grave é parte do show.',
    caixas: [6, 8],
    subs: [4, 6],
    arranjo: 'arco',
    porqueArranjo: 'Na pista, o grave tem que chegar igual da grade ao fundo — e não há microfone aberto no palco para o grave atrapalhar.',
  },
  congresso: {
    rotulo: 'Congresso',
    descricao: 'Palestra com microfone de lapela e câmera gravando.',
    caixas: [4, 6],
    subs: [2, 4],
    arranjo: 'cardioide',
    porqueArranjo: 'Lapela aberta no palco com grave batendo atrás vira microfonia e som embolado na gravação. Cardioide tira o grave de cima do palestrante.',
  },
  igreja: {
    rotulo: 'Culto',
    descricao: 'Banda e púlpito no mesmo palco, com microfones abertos o tempo todo.',
    caixas: [5, 7],
    subs: [3, 5],
    arranjo: 'cardioide',
    porqueArranjo: 'Palco cheio de microfone aberto: grave em cima do palco volta pelo microfone e embola tudo.',
  },
};

const EVENTOS: Record<AplicacaoSom, string[]> = {
  show: ['Festival de Inverno', 'Show de Aniversário da Cidade', 'Baile da Cidade'],
  congresso: ['Congresso de Cardiologia', 'Convenção de Vendas', 'Fórum de Infraestrutura'],
  igreja: ['Conferência de Jovens', 'Celebração de Natal', 'Culto de Aniversário'],
};

export type BriefingSom = {
  aplicacao: AplicacaoSom;
  evento: string;
  caixasPorLado: number;
  subs: number;
  /** Ângulo vertical que a plateia pede, somando os ângulos entre as caixas. */
  coberturaGraus: number;
  /** Distância da torre de delay até o PA, em metros. */
  torreM: number;
  janelaMin: number;
  os: number;
};

const sortear = <T,>(lista: readonly T[]) => lista[Math.floor(Math.random() * lista.length)];
const entre = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

export function sortearBriefing(): BriefingSom {
  const aplicacao = sortear(['show', 'congresso', 'igreja'] as const);
  const meta = APLICACOES[aplicacao];
  const caixasPorLado = entre(meta.caixas[0], meta.caixas[1]);
  const subs = entre(meta.subs[0], meta.subs[1]);
  // A cobertura sempre cabe nas caixas contratadas, senão a obra é impossível.
  const coberturaGraus = entre(caixasPorLado * 2, Math.min(caixasPorLado * 5, 34));
  const torreM = entre(16, 40);

  return {
    aplicacao,
    evento: sortear(EVENTOS[aplicacao]),
    caixasPorLado,
    subs,
    coberturaGraus,
    torreM,
    janelaMin: janelaPara(caixasPorLado, subs),
    os: entre(4100, 9899),
  };
}

// ---------------------------------------------------------------------------
// As contas da obra
// ---------------------------------------------------------------------------

/**
 * Canais de amplificador que a obra pede. Duas caixas por canal fecham os
 * 4 Ω; sub de 4 Ω ocupa um canal sozinho. Misturar caixa com sub no mesmo
 * canal dá 2,7 Ω, que é proteção na certa.
 */
export const canaisPara = (caixasPorLado: number, subs: number) =>
  Math.ceil(caixasPorLado / 2) * 2 + subs;

export const pesoDoPA = (caixasPorLado: number, subs: number) =>
  caixasPorLado * 2 * CAIXAS.caixa.pesoKg + subs * CAIXAS.sub.pesoKg;

export function janelaPara(caixasPorLado: number, subs: number): number {
  const trabalho =
    caixasPorLado * 2 * CAIXAS.caixa.minutos
    + subs * CAIXAS.sub.minutos
    + caixasPorLado * 2 * CUSTO.caboAco
    + CUSTO.icar
    + canaisPara(caixasPorLado, subs) * AMPLIFICADOR.minutos
    + CUSTO.palco + CUSTO.passagem;
  return Math.round((trabalho * 1.3) / 5) * 5;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export type CelulaSom = {
  caixa: TipoCaixa | null;
  noAr: boolean;
  caboAco: boolean;
  /** Ângulo para a caixa seguinte, em graus. */
  angulo: number | null;
  canal: number | null;
};

export type LeituraOS = {
  tentativas: number;
  resolvida: boolean;
  dePrimeira: boolean;
};

export type EstadoSom = {
  briefing: BriefingSom;
  gastos: number;
  celulas: CelulaSom[];
  icado: boolean;
  talhaKg: number | null;
  canaisPuxados: number;
  arranjo: Arranjo | null;
  /** Ordem em que o técnico ligou o sistema. */
  ligacao: Equipamento[];
  /** Delay da torre, em ms, como o técnico programou. */
  delayMs: number | null;
  retrabalho: number;
  finalizado: boolean;
  leitura: LeituraOS;
};

export function criarPartida(briefing: BriefingSom = sortearBriefing()): EstadoSom {
  return {
    briefing,
    gastos: 0,
    celulas: Array.from({ length: TOTAL_POSICOES }, () => ({
      caixa: null,
      noAr: false,
      caboAco: false,
      angulo: null,
      canal: null,
    })),
    icado: false,
    talhaKg: null,
    canaisPuxados: 0,
    arranjo: null,
    ligacao: [],
    delayMs: null,
    retrabalho: 0,
    finalizado: false,
    leitura: { tentativas: 0, resolvida: false, dePrimeira: false },
  };
}

// ---------------------------------------------------------------------------
// Leitura do estado
// ---------------------------------------------------------------------------

export const janelaDe = (e: EstadoSom) => e.briefing.janelaMin;
export const folga = (e: EstadoSom) => Math.max(0, janelaDe(e) - e.gastos);

export function relogio(gastos: number, janelaMin: number): string {
  const t = HORA_INICIAL + Math.min(gastos, janelaMin);
  const h = Math.floor(t / 60) % 24;
  const m = Math.round(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const celulasOnde = (e: EstadoSom, teste: (c: CelulaSom, i: number) => boolean) =>
  e.celulas.map((c, i) => (teste(c, i) ? i : -1)).filter((i) => i >= 0);

export const penduradas = (e: EstadoSom) => e.celulas.reduce((n, c) => n + (c.caixa ? 1 : 0), 0);

/** Caixa certa na fila certa: line array nos lados, sub no chão. */
export const noLugarCerto = (c: CelulaSom, i: number) =>
  c.caixa !== null && c.caixa === tipoDaFila(filaDe(i));

export const contarNaFila = (e: EstadoSom, fila: number) =>
  e.celulas.reduce((n, c, i) => n + (filaDe(i) === fila && noLugarCerto(c, i) ? 1 : 0), 0);

export const contarCaixa = (e: EstadoSom, tipo: TipoCaixa) =>
  e.celulas.reduce((n, c) => n + (c.caixa === tipo ? 1 : 0), 0);

export const celulasNaFilaErrada = (e: EstadoSom) =>
  celulasOnde(e, (c, i) => c.caixa !== null && !noLugarCerto(c, i));

/** As caixas de um lado, de cima para baixo. */
export const caixasDoLado = (e: EstadoSom, fila: number) =>
  Array.from({ length: POSICOES_MAX }, (_, p) => indice(fila, p))
    .filter((i) => e.celulas[i].caixa === 'caixa');

export type Cobertura = {
  fila: number;
  caixas: number;
  soma: number;
  fecha: boolean;
  /** Ângulo que abre para cima em vez de para baixo: buraco na plateia. */
  invertidos: number[];
  semAngulo: number[];
};

/**
 * Como ficou a cobertura de um lado. Duas regras: a soma dos ângulos fecha o
 * que a plateia pede, e os ângulos abrem de cima para baixo — caixa de cima
 * joga longe e quase não inclina; caixa de baixo cobre as primeiras filas e
 * abre muito.
 */
export function coberturaDoLado(e: EstadoSom, fila: number): Cobertura {
  const caixas = caixasDoLado(e, fila);
  const angulos = caixas.map((i) => e.celulas[i].angulo);
  const soma = angulos.reduce((n: number, a) => n + (a ?? 0), 0);
  const invertidos: number[] = [];

  for (let k = 1; k < caixas.length; k++) {
    const anterior = angulos[k - 1];
    const atual = angulos[k];
    if (anterior === null || atual === null) continue;
    if (atual < anterior) invertidos.push(caixas[k]);
  }

  return {
    fila,
    caixas: caixas.length,
    soma,
    fecha: caixas.length > 0 && Math.abs(soma - e.briefing.coberturaGraus) <= TOLERANCIA_GRAUS,
    invertidos,
    semAngulo: caixas.filter((i) => e.celulas[i].angulo === null),
  };
}

export function cargaPorPonto(e: EstadoSom): number {
  // Só o que voa pesa no ponto: o sub fica no chão.
  const peso = contarCaixa(e, 'caixa') * CAIXAS.caixa.pesoKg;
  return Math.round(peso / PONTOS_ICAMENTO);
}

// ---------------------------------------------------------------------------
// Canais de amplificador
// ---------------------------------------------------------------------------

export function contarPorCanal(e: EstadoSom): Map<number, number[]> {
  const m = new Map<number, number[]>();
  e.celulas.forEach((c, i) => {
    if (!c.caixa || c.canal === null) return;
    const lista = m.get(c.canal) ?? [];
    lista.push(i);
    m.set(c.canal, lista);
  });
  return m;
}

export type SituacaoCanal = 'ideal' | 'sobra' | 'protecao';

/**
 * Impedância de um canal com caixas diferentes: 1/R = soma de 1/Ri. É assim
 * que caixa de 8 Ω com sub de 4 Ω vira 2,7 Ω e o amplificador desarma.
 */
export function impedanciaDo(e: EstadoSom, celulas: number[]): number {
  if (celulas.length === 0) return Infinity;
  const inverso = celulas.reduce((n, i) => n + 1 / CAIXAS[e.celulas[i].caixa as TipoCaixa].ohms, 0);
  return 1 / inverso;
}

export function situacaoCanais(e: EstadoSom): {
  canal: number; caixas: number; ohms: number; watts: number; situacao: SituacaoCanal;
}[] {
  const porCanal = contarPorCanal(e);
  const total = Math.max(e.canaisPuxados, ...porCanal.keys());
  const linhas = Array.from({ length: Math.max(0, total) }, (_, k) => {
    const canal = k + 1;
    const celulas = porCanal.get(canal) ?? [];
    return {
      canal,
      caixas: celulas.length,
      ohms: impedanciaDo(e, celulas),
      watts: celulas.reduce((n, i) => n + CAIXAS[e.celulas[i].caixa as TipoCaixa].watts, 0),
    };
  });

  const precisa = canaisPara(
    Math.max(contarNaFila(e, 0), contarNaFila(e, 1)),
    contarNaFila(e, 2),
  );
  const aMais = Math.max(0, linhas.length - precisa);
  const deSobra = new Set(
    linhas
      .filter((l) => l.ohms >= AMPLIFICADOR.ohmsMin)
      .sort((a, b) => a.caixas - b.caixas || b.canal - a.canal)
      .slice(0, aMais)
      .map((l) => l.canal),
  );

  return linhas.map((l) => ({
    ...l,
    situacao: l.ohms < AMPLIFICADOR.ohmsMin ? 'protecao'
      : deSobra.has(l.canal) ? 'sobra'
      : 'ideal',
  }));
}

export const canaisNecessarios = (e: EstadoSom) =>
  canaisPara(e.briefing.caixasPorLado, e.briefing.subs);

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export const puxarCanal = (e: EstadoSom): EstadoSom => ({ ...e, canaisPuxados: e.canaisPuxados + 1 });

export function podeRecolherCanal(e: EstadoSom): boolean {
  const n = e.canaisPuxados;
  return n > 0 && !e.celulas.some((c) => c.caixa && c.canal === n);
}

export const recolherCanal = (e: EstadoSom): EstadoSom =>
  podeRecolherCanal(e) ? { ...e, canaisPuxados: e.canaisPuxados - 1 } : e;

export function pendurarEm(e: EstadoSom, alvos: number[], tipo: TipoCaixa): EstadoSom {
  let celulas = e.celulas;
  let gastos = e.gastos;
  let retrabalho = e.retrabalho;

  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.caixa !== null) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    const noAr = e.icado && tipo === 'caixa';
    celulas[i] = { ...c, caixa: tipo, noAr };
    gastos += custoPendurar(tipo, e.icado);
    if (noAr) retrabalho += custoPendurar(tipo, true) - CAIXAS[tipo].minutos;
  }

  return celulas === e.celulas ? e : { ...e, celulas, gastos, retrabalho };
}

export function removerEm(e: EstadoSom, alvos: number[]): EstadoSom {
  let celulas = e.celulas;
  let gastos = e.gastos;
  let retrabalho = e.retrabalho;

  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.caixa === null) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { caixa: null, noAr: false, caboAco: false, angulo: null, canal: null };
    gastos += CUSTO.remover;
    retrabalho += CUSTO.remover;
  }

  return celulas === e.celulas ? e : { ...e, celulas, gastos, retrabalho };
}

export function caboAcoEm(e: EstadoSom, alvos: number[]): EstadoSom {
  let celulas = e.celulas;
  let gastos = e.gastos;

  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.caixa !== 'caixa' || c.caboAco) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, caboAco: true };
    gastos += CUSTO.caboAco;
  }

  return celulas === e.celulas ? e : { ...e, celulas, gastos };
}

/** Ângulo com o PA no chão é de graça; com o PA no ar, é descer e subir de novo. */
export function angularEm(e: EstadoSom, alvos: number[], graus: number): EstadoSom {
  let celulas = e.celulas;
  let gastos = e.gastos;
  let retrabalho = e.retrabalho;

  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.caixa !== 'caixa' || c.angulo === graus) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, angulo: graus };
    if (e.icado) { gastos += CUSTO_ANGULO_NO_AR; retrabalho += CUSTO_ANGULO_NO_AR; }
  }

  return celulas === e.celulas ? e : { ...e, celulas, gastos, retrabalho };
}

export function atribuirEm(e: EstadoSom, alvos: number[], canal: number): EstadoSom {
  if (!(canal >= 1 && canal <= e.canaisPuxados)) return e;
  let celulas = e.celulas;
  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.caixa === null || c.canal === canal) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, canal };
  }
  return celulas === e.celulas ? e : { ...e, celulas };
}

export function limparCanalEm(e: EstadoSom, alvos: number[]): EstadoSom {
  let celulas = e.celulas;
  for (const i of alvos) {
    const c = celulas[i];
    if (!c || c.caixa === null || c.canal === null) continue;
    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[i] = { ...c, canal: null };
  }
  return celulas === e.celulas ? e : { ...e, celulas };
}

export const escolherArranjo = (e: EstadoSom, arranjo: Arranjo): EstadoSom => ({ ...e, arranjo });

export const programarDelay = (e: EstadoSom, ms: number | null): EstadoSom => ({ ...e, delayMs: ms });

export function icar(e: EstadoSom): EstadoSom {
  if (e.icado || e.talhaKg === null) return e;
  const extra = CUSTO_TALHA_FOLGADA[e.talhaKg] ?? 0;
  return {
    ...e,
    icado: true,
    gastos: e.gastos + CUSTO.icar + extra,
    retrabalho: e.retrabalho + extra,
  };
}

/** Liga um equipamento. A ordem em que isso acontece é o que a vistoria cobra. */
export function ligar(e: EstadoSom, equipamento: Equipamento): EstadoSom {
  if (e.ligacao.includes(equipamento)) return e;
  return { ...e, ligacao: [...e.ligacao, equipamento] };
}

export const ordemDeLigacaoCerta = (e: EstadoSom) =>
  e.ligacao.length === ORDEM_LIGA.length && e.ligacao.every((q, k) => q === ORDEM_LIGA[k]);

export const custoCanais = (e: EstadoSom) => e.canaisPuxados * AMPLIFICADOR.minutos;

export const custoFechamento = (e: EstadoSom) => custoCanais(e) + CUSTO.palco + CUSTO.passagem;

export const custoCanaisIdeal = (e: EstadoSom) =>
  canaisPara(Math.max(contarNaFila(e, 0), contarNaFila(e, 1)), contarNaFila(e, 2)) * AMPLIFICADOR.minutos;

export function finalizar(e: EstadoSom): EstadoSom {
  if (e.finalizado) return e;
  return { ...e, gastos: e.gastos + custoFechamento(e), finalizado: true };
}

// ---------------------------------------------------------------------------
// Vistoria
// ---------------------------------------------------------------------------

export type Problema = {
  tipo: 'reprovacao' | 'tempo' | 'qualidade';
  texto: string;
  curto: string;
  celulas: number[];
  minutos?: number;
  qualidade?: number;
};

export type Vistoria = {
  problemas: Problema[];
  reprovado: boolean;
  qualidade: number;
  atraso: number;
  minutosExtras: number;
};

export function vistoriar(e: EstadoSom): Vistoria {
  const problemas: Problema[] = [];
  const b = e.briefing;
  const atraso = Math.max(0, e.gastos - janelaDe(e));

  // --- o que encerra a partida ---
  const semCaboAco = celulasOnde(e, (c) => c.caixa === 'caixa' && !c.caboAco);
  if (semCaboAco.length > 0) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `${semCaboAco.length} ${semCaboAco.length === 1 ? 'caixa voada sem cabo de aço' : 'caixas voadas sem cabo de aço'}. Caixa de ${CAIXAS.caixa.pesoKg} kg sobre a plateia não sobe sem cabo de aço.`,
      curto: 'Sem cabo de aço',
      celulas: semCaboAco,
    });
  }

  if (penduradas(e) === 0) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'Nenhuma caixa foi montada. O palco abriu sem PA.',
      curto: 'Sem PA',
      celulas: [],
    });
  } else if (!e.icado && contarCaixa(e, 'caixa') > 0) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'O line array ficou no chão. Caixa empilhada no piso não cobre plateia nenhuma.',
      curto: 'PA não subiu',
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

  for (const fila of [0, 1]) {
    const falta = b.caixasPorLado - contarNaFila(e, fila);
    if (falta > 0) {
      problemas.push({
        tipo: 'reprovacao',
        texto: `Faltaram ${falta} ${falta === 1 ? 'caixa' : 'caixas'} no ${FILAS[fila].rotulo.toLowerCase()}. A OS pedia ${b.caixasPorLado} por lado, e lado torto é plateia sem som.`,
        curto: `Faltam ${falta} no ${FILAS[fila].id}`,
        celulas: [],
      });
    }
  }

  const faltamSubs = b.subs - contarNaFila(e, 2);
  if (faltamSubs > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `Faltaram ${faltamSubs} ${faltamSubs === 1 ? 'sub' : 'subs'}. A OS pedia ${b.subs}.`,
      curto: `Faltam ${faltamSubs} subs`,
      celulas: [],
      qualidade: Math.min(40, faltamSubs * 10),
    });
  }

  if (penduradas(e) > 0 && !e.celulas.some((c) => c.caixa && c.canal !== null)) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'Nenhuma caixa foi ligada a canal de amplificador. O sistema subiu mudo.',
      curto: 'PA mudo',
      celulas: [],
    });
  }

  if (atraso > ATRASO_TOLERADO) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `${atraso} min de atraso. A casa abriu com o PA ainda em passagem.`,
      curto: `${atraso} min de atraso`,
      celulas: [],
    });
  }

  // --- amplificador em proteção: caixa muda é caixa que não tocou ---
  const emProtecao = situacaoCanais(e).filter((c) => c.situacao === 'protecao');
  const mudas = emProtecao.reduce((n, c) => n + c.caixas, 0);

  for (const canal of emProtecao) {
    problemas.push({
      tipo: 'tempo',
      texto: `Canal ${canal.canal} com ${canal.caixas} caixas em paralelo: ${canal.ohms.toFixed(1).replace('.', ',')} Ω, abaixo dos ${AMPLIFICADOR.ohmsMin} Ω do amplificador. Ele entrou em proteção e essas caixas calaram no meio do show.`,
      curto: `Canal ${canal.canal} em proteção`,
      celulas: contarPorCanal(e).get(canal.canal) ?? [],
      minutos: PENALIDADE.protecao,
      qualidade: Math.min(45, canal.caixas * 8),
    });
  }

  // Economizar canal para ganhar relógio não pode compensar: um quarto do
  // sistema mudo é metade da plateia sem som, e isso é serviço não prestado.
  if (penduradas(e) > 0 && mudas > penduradas(e) * FRACAO_MUDA_REPROVA) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `${mudas} de ${penduradas(e)} caixas ficaram mudas por proteção do amplificador. Não é apontamento de minutos: é o evento sem som na metade da sala.`,
      curto: `${mudas} caixas mudas`,
      celulas: emProtecao.flatMap((c) => contarPorCanal(e).get(c.canal) ?? []),
    });
  }

  if (e.ligacao.length > 0 && !ordemDeLigacaoCerta(e)) {
    const ligouAmpAntes = e.ligacao.indexOf('amplificador') < e.ligacao.indexOf('mesa')
      || e.ligacao.indexOf('amplificador') < e.ligacao.indexOf('processador');
    problemas.push({
      tipo: 'tempo',
      texto: ligouAmpAntes
        ? 'O amplificador foi ligado antes da mesa. O estouro saiu no PA com o cliente na sala.'
        : `A ordem de energização saiu errada: ${e.ligacao.map((q) => EQUIPAMENTOS[q].rotulo).join(' › ')}. Liga mesa, processador e amplificador, nessa ordem.`,
      curto: 'Estouro no PA',
      celulas: [],
      minutos: PENALIDADE.ordemErrada,
      qualidade: 20,
    });
  }

  if (e.ligacao.length < ORDEM_LIGA.length) {
    const faltam = ORDEM_LIGA.filter((q) => !e.ligacao.includes(q));
    problemas.push({
      tipo: 'qualidade',
      texto: `${faltam.map((q) => EQUIPAMENTOS[q].rotulo).join(' e ')} ${faltam.length === 1 ? 'ficou' : 'ficaram'} sem ligar. Não sai som de sistema desligado.`,
      curto: 'Sistema não ligou',
      celulas: [],
      qualidade: 35,
    });
  }

  const sobrandoCaixas = Math.max(0, contarCaixa(e, 'caixa') - b.caixasPorLado * 2)
    + Math.max(0, contarNaFila(e, 2) - b.subs);
  if (sobrandoCaixas > 0) {
    problemas.push({
      tipo: 'tempo',
      texto: `${sobrandoCaixas} ${sobrandoCaixas === 1 ? 'caixa a mais' : 'caixas a mais'} que a OS pediu. Caixa pendurada à toa é peso, canal e tempo de passagem.`,
      curto: `${sobrandoCaixas} a mais`,
      celulas: [],
      minutos: Math.min(16, 4 + sobrandoCaixas * 2),
      qualidade: Math.min(20, sobrandoCaixas * 4),
    });
  }

  // --- o que custa nota ---
  for (const fila of [0, 1]) {
    const cobertura = coberturaDoLado(e, fila);
    if (cobertura.caixas === 0) continue;

    if (cobertura.semAngulo.length > 0) {
      problemas.push({
        tipo: 'qualidade',
        texto: `${cobertura.semAngulo.length} ${cobertura.semAngulo.length === 1 ? 'caixa ficou' : 'caixas ficaram'} sem ângulo no ${FILAS[fila].rotulo.toLowerCase()}: saíram retas, jogando som no fundo da sala e deixando buraco na frente.`,
        curto: 'Caixas sem ângulo',
        celulas: cobertura.semAngulo,
        qualidade: Math.min(30, cobertura.semAngulo.length * 5),
      });
    } else if (!cobertura.fecha) {
      const curto = cobertura.soma < b.coberturaGraus;
      problemas.push({
        tipo: 'qualidade',
        texto: curto
          ? `${FILAS[fila].rotulo}: ${cobertura.soma}° de abertura para uma plateia que pede ${b.coberturaGraus}°. As últimas filas ouviram, as primeiras ficaram no buraco.`
          : `${FILAS[fila].rotulo}: ${cobertura.soma}° de abertura para ${b.coberturaGraus}° de plateia. Som demais no chão perto do palco e de menos no fundo.`,
        curto: `Cobertura ${cobertura.soma}° de ${b.coberturaGraus}°`,
        celulas: caixasDoLado(e, fila),
        qualidade: Math.min(35, Math.abs(cobertura.soma - b.coberturaGraus) * 3),
      });
    }

    if (cobertura.invertidos.length > 0) {
      problemas.push({
        tipo: 'qualidade',
        texto: `${FILAS[fila].rotulo}: ângulo fechando de cima para baixo. Caixa de cima joga longe e quase não inclina; caixa de baixo é que abre para as primeiras filas.`,
        curto: 'Ângulos invertidos',
        celulas: cobertura.invertidos,
        qualidade: Math.min(25, cobertura.invertidos.length * 6),
      });
    }
  }

  const esquerdo = coberturaDoLado(e, 0);
  const direito = coberturaDoLado(e, 1);
  if (esquerdo.caixas > 0 && direito.caixas > 0 && esquerdo.soma !== direito.soma) {
    problemas.push({
      tipo: 'qualidade',
      texto: `Os dois lados saíram diferentes: ${esquerdo.soma}° de um lado e ${direito.soma}° do outro. Quem senta no meio ouve dois sistemas.`,
      curto: 'Lados assimétricos',
      celulas: [],
      qualidade: 15,
    });
  }

  const arranjoCerto = APLICACOES[b.aplicacao].arranjo;
  if (contarNaFila(e, 2) > 0 && e.arranjo !== arranjoCerto) {
    problemas.push({
      tipo: 'qualidade',
      texto: e.arranjo === null
        ? `Os subs ficaram sem arranjo definido. Neste evento o certo era ${ARRANJOS[arranjoCerto].rotulo.toLowerCase()}: ${APLICACOES[b.aplicacao].porqueArranjo}`
        : `Subs em ${ARRANJOS[e.arranjo].rotulo.toLowerCase()} neste evento. ${APLICACOES[b.aplicacao].porqueArranjo}`,
      curto: `Subs em ${e.arranjo ? ARRANJOS[e.arranjo].rotulo.toLowerCase() : 'nenhum arranjo'}`,
      celulas: [],
      qualidade: 20,
    });
  }

  const delayCerto = delayPara(b.torreM);
  if (e.delayMs === null) {
    problemas.push({
      tipo: 'qualidade',
      texto: `A torre de delay ficou sem atraso programado. A ${b.torreM} m do PA, ela chega ${delayCerto} ms antes do som do palco: a plateia do fundo ouve tudo duas vezes.`,
      curto: 'Torre sem delay',
      celulas: [],
      qualidade: 25,
    });
  } else if (Math.abs(e.delayMs - delayCerto) > 3) {
    problemas.push({
      tipo: 'qualidade',
      texto: `Delay da torre em ${e.delayMs} ms, e a conta dá ${delayCerto} ms (${b.torreM} m ÷ ${VELOCIDADE_SOM} m/s). A diferença aparece como eco no fundo da sala.`,
      curto: `Delay ${e.delayMs} ms, certo ${delayCerto}`,
      celulas: [],
      qualidade: Math.min(20, Math.abs(e.delayMs - delayCerto)),
    });
  }

  const filaErrada = celulasNaFilaErrada(e);
  if (filaErrada.length > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${filaErrada.length} ${filaErrada.length === 1 ? 'caixa no lugar errado' : 'caixas no lugar errado'}: line array voa nos lados, sub fica no chão à frente do palco.`,
      curto: 'Caixa no lugar errado',
      celulas: filaErrada,
      qualidade: Math.min(30, filaErrada.length * 8),
    });
  }

  const semCanal = celulasOnde(e, (c) => c.caixa !== null && c.canal === null);
  if (semCanal.length > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${semCanal.length} ${semCanal.length === 1 ? 'caixa ficou' : 'caixas ficaram'} sem canal de amplificador — mudas no meio do sistema.`,
      curto: 'Caixas sem canal',
      celulas: semCanal,
      qualidade: Math.min(50, semCanal.length * 6),
    });
  }

  const noAr = celulasOnde(e, (c) => c.caixa !== null && c.noAr);
  if (noAr.length > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${noAr.length} ${noAr.length === 1 ? 'caixa foi montada' : 'caixas foram montadas'} com o PA já no ar. Line array se arma no chão e sobe pronto.`,
      curto: 'Montagem no ar',
      celulas: noAr,
      qualidade: Math.min(20, noAr.length * 4),
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

export function pontuar(e: EstadoSom, v: Vistoria) {
  const folgaMin = Math.max(0, janelaDe(e) - e.gastos - v.minutosExtras);
  const daFolga = folgaMin * 10;
  const daQualidade = v.qualidade * 5;
  const semRetrabalho = e.retrabalho === 0 && !v.reprovado ? BONUS_SEM_RETRABALHO : 0;
  const daLeitura = e.leitura.dePrimeira && !v.reprovado ? BONUS_LEITURA : 0;
  const total = v.reprovado ? 0 : daFolga + daQualidade + semRetrabalho + daLeitura;
  return { folgaMin, daFolga, daQualidade, semRetrabalho, daLeitura, total, reprovado: v.reprovado };
}

// ---------------------------------------------------------------------------
// Leitura da OS
// ---------------------------------------------------------------------------

export const CUSTO_CONSULTA_OS = [5, 10];

export const respostaOS = (b: BriefingSom) => ({
  delayMs: delayPara(b.torreM),
  canais: canaisPara(b.caixasPorLado, b.subs),
});

export function lerNumero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\s/g, '').replace(/[.,](?=\d{3}$)/, '');
  if (!limpo) return null;
  const n = Number(limpo.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export type ConferenciaOS = { delayOk: boolean; canaisOk: boolean };

export function conferirLeitura(b: BriefingSom, delay: string, canais: string): ConferenciaOS {
  const certo = respostaOS(b);
  const ms = lerNumero(delay);
  return {
    // Arredondar para o ms mais próximo é o que se faz na mesa.
    delayOk: ms !== null && Math.abs(ms - certo.delayMs) <= 1,
    canaisOk: lerNumero(canais) === certo.canais,
  };
}

export function contaOS(b: BriefingSom): string[] {
  const canais = canaisPara(b.caixasPorLado, b.subs);
  return [
    `Delay: ${b.torreM} m ÷ ${VELOCIDADE_SOM} m/s = ${(b.torreM / VELOCIDADE_SOM * 1000).toFixed(1).replace('.', ',')} ms → ${delayPara(b.torreM)} ms`,
    `Caixas: ${b.caixasPorLado} por lado, 2 por canal (8 Ω + 8 Ω = 4 Ω) = ${Math.ceil(b.caixasPorLado / 2)} canais por lado`,
    `Subs: ${b.subs} × 4 Ω, um por canal = ${b.subs} canais`,
    `Total: ${Math.ceil(b.caixasPorLado / 2)} × 2 + ${b.subs} = ${canais} canais`,
  ];
}

/** O que o placar mostra sobre amplificação. */
export function licaoAmplificacao(e: EstadoSom) {
  const linhas = situacaoCanais(e);
  const caixas = contarCaixa(e, 'caixa');
  const subs = contarNaFila(e, 2);
  return {
    linhas,
    puxados: linhas.length,
    minimo: canaisPara(Math.max(contarNaFila(e, 0), contarNaFila(e, 1)), subs),
    emProtecao: linhas.filter((l) => l.situacao === 'protecao').length,
    minutos: custoCanais(e),
    minutosIdeal: custoCanaisIdeal(e),
    conta: `Caixa de ${CAIXAS.caixa.ohms} Ω: duas em paralelo dão ${CAIXAS.caixa.ohms / 2} Ω, que é o mínimo do canal; a terceira derruba para ${(CAIXAS.caixa.ohms / 3).toFixed(1).replace('.', ',')} Ω. `
      + `Sub de ${CAIXAS.sub.ohms} Ω já chega no mínimo sozinho. ${caixas} caixas e ${subs} subs`,
  };
}

/** O que o placar mostra sobre cobertura. */
export function licaoCobertura(e: EstadoSom) {
  return {
    pedido: e.briefing.coberturaGraus,
    tolerancia: TOLERANCIA_GRAUS,
    lados: [0, 1].map((fila) => coberturaDoLado(e, fila)),
    delayCerto: delayPara(e.briefing.torreM),
    delayMs: e.delayMs,
    torreM: e.briefing.torreM,
    arranjoCerto: APLICACOES[e.briefing.aplicacao].arranjo,
    arranjo: e.arranjo,
    porqueArranjo: APLICACOES[e.briefing.aplicacao].porqueArranjo,
  };
}
