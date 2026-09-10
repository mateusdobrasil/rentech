// ============================================================================
// CALL TIME — motor da montagem (Fase 1: painel de LED)
//
// Regras, custos e avaliação da partida. Sem React de propósito: tudo aqui é
// função pura sobre um objeto de estado, pra poder ser testado e reaproveitado
// pelas duas rotas (feira em /testes/montagem, treinamento no portal).
//
// As constantes técnicas NÃO foram inventadas — saem dos simuladores que já
// existem no sistema, e as origens estão anotadas em cada uma.
// ============================================================================

// ---------------------------------------------------------------------------
// Constantes de engenharia
// ---------------------------------------------------------------------------

/** Módulo LED padrão, em metros — app/simulador/videowall/page.tsx */
export const MODULO_M = 0.5;

/** Pixels por porta do processador Novastar — videowall/page.tsx:325 */
export const PX_POR_PORTA = 640_000;

/**
 * Pitches de gabinete 500 x 500 mm. Os pixels por lado são os valores padrão
 * de mercado (128 / 168 / 192), e é deles que sai a diferença que mais pesa no
 * jogo: o MESMO painel em P2.6 come mais que o dobro de portas que em P3.9.
 *
 * A distância mínima confortável de visão, em metros, é mais ou menos o pitch
 * em milímetros — é isso que amarra o pitch à aplicação.
 */
export type PitchId = 'P3.9' | 'P2.9' | 'P2.6';

export const PITCHES: Record<PitchId, { rotulo: string; mm: number; pxLado: number }> = {
  'P3.9': { rotulo: 'P3.9', mm: 3.91, pxLado: 128 },
  'P2.9': { rotulo: 'P2.9', mm: 2.976, pxLado: 168 },
  'P2.6': { rotulo: 'P2.6', mm: 2.604, pxLado: 192 },
};

export const pxPorGabinete = (p: PitchId) => PITCHES[p].pxLado * PITCHES[p].pxLado;

/** Quantos gabinetes cabem numa porta antes de estourar: 39 / 22 / 17. */
export const gabinetesPorPorta = (p: PitchId) =>
  Math.floor(PX_POR_PORTA / pxPorGabinete(p));

// ---------------------------------------------------------------------------
// Processadoras — a escolha técnica que o jogo pede ao montador
// ---------------------------------------------------------------------------

export type Processadora = {
  id: string;
  nome: string;
  portas: number;
  /** Minutos de mapeamento e rack. Máquina maior dá mais trabalho. */
  setupMin: number;
  nota: string;
};

export const PROCESSADORAS: Processadora[] = [
  { id: 'mctrl300', nome: 'MCTRL300', portas: 1, setupMin: 4, nota: 'Só envio, sem escalonamento' },
  { id: 'mctrl660', nome: 'MCTRL660 PRO', portas: 2, setupMin: 6, nota: 'Envio com entrada HDMI/DVI' },
  { id: 'vx400', nome: 'VX400', portas: 4, setupMin: 9, nota: 'All-in-one com escalonamento' },
  { id: 'vx600', nome: 'VX600', portas: 6, setupMin: 12, nota: 'All-in-one, porte médio' },
  { id: 'vx1000', nome: 'VX1000', portas: 10, setupMin: 16, nota: 'All-in-one, grande porte' },
  { id: 'mctrl4k', nome: 'MCTRL4K', portas: 16, setupMin: 22, nota: 'Envio 4K, painéis grandes' },
];

export const acharProcessadora = (id: string | null) =>
  PROCESSADORAS.find((p) => p.id === id) ?? null;

/** A menor que dá conta das portas necessárias. */
export function processadoraRecomendada(portasNecessarias: number): Processadora {
  return PROCESSADORAS.find((p) => p.portas >= portasNecessarias)
    ?? PROCESSADORAS[PROCESSADORAS.length - 1];
}

// ---------------------------------------------------------------------------
// Aplicação — o que o cliente contratou muda a forma e o rigor da entrega
// ---------------------------------------------------------------------------

export type Aplicacao = 'testeira' | 'plenaria' | 'estande';

export const APLICACOES: Record<Aplicacao, {
  rotulo: string;
  descricao: string;
  /** Buracos que a plateia daquela distância ainda não enxerga. */
  furosTolerados: number;
  colunas: [number, number];
  linhas: [number, number];
  /** No imprevisto, o cliente pede mais largura ou mais altura. */
  cresce: 'largura' | 'altura';
}> = {
  testeira: {
    rotulo: 'Testeira',
    descricao: 'Faixa longa e baixa sobre o palco, lida de uns 5 m.',
    furosTolerados: 2,
    colunas: [10, 16],
    linhas: [2, 3],
    cresce: 'largura',
  },
  plenaria: {
    rotulo: 'Plenária',
    descricao: 'Telão de auditório, plateia a partir de 8 m.',
    furosTolerados: 3,
    colunas: [10, 14],
    linhas: [5, 7],
    cresce: 'altura',
  },
  estande: {
    rotulo: 'Estande',
    descricao: 'Painel de feira, com gente a 2 m de distância.',
    furosTolerados: 0,
    colunas: [5, 8],
    linhas: [3, 5],
    cresce: 'altura',
  },
};

/** Teto de gabinetes em série num circuito de 16 A. */
export const GABINETES_POR_CIRCUITO = 8;

export const PESO_GABINETE_KG = 11;
export const PONTOS_ICAMENTO = 2;

/** Peso do portal Q30 por metro de vão, com as duas torres rateadas. */
export const PESO_PORTAL_KG_POR_M = 68;

/** Catálogo de talhas — app/simulador/boxtruss/page.tsx (TALHA_OPTIONS) */
export const TALHAS_KG = [500, 1000, 2000, 3000] as const;

// ---------------------------------------------------------------------------
// Geometria: a grade tem um teto fixo, e cada obra ocupa um pedaço dela.
// O painel contratado varia a cada partida — é o que tira o jogo do decoreba.
// ---------------------------------------------------------------------------

export const COLUNAS_MAX = 18;
export const LINHAS_MAX = 8;
export const TOTAL_CELULAS = COLUNAS_MAX * LINHAS_MAX;

// ---------------------------------------------------------------------------
// Briefing: o que chega pelo rádio antes do caminhão
// ---------------------------------------------------------------------------

export type Briefing = {
  aplicacao: Aplicacao;
  pitch: PitchId;
  colunas: number;
  linhas: number;
  evento: string;
  /** Circuitos de 16 A que o local disponibiliza. */
  circuitos: number;
  /** Minutos de carga até a porta abrir. Acompanha o tamanho da obra. */
  janelaMin: number;
};

const EVENTOS: Record<Aplicacao, string[]> = {
  testeira: ['Congresso de Cardiologia', 'Feira do Agronegócio', 'Prêmio Municipal de Cultura'],
  plenaria: ['Convenção de Vendas', 'Assembleia do Sindicato', 'Fórum de Infraestrutura'],
  estande: ['Expo Construção', 'Salão do Automóvel', 'Feira de Tecnologia'],
};

const sortear = <T,>(lista: readonly T[]) => lista[Math.floor(Math.random() * lista.length)];
const entre = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/**
 * Sorteia a obra da vez. O pitch acompanha a distância de visão da aplicação —
 * estande com gente a 2 m não leva P3.9, e plenária a 10 m não precisa de P2.6.
 */
export function sortearBriefing(): Briefing {
  const aplicacao = sortear(['testeira', 'plenaria', 'estande'] as const);
  const meta = APLICACOES[aplicacao];

  const pitch: PitchId =
    aplicacao === 'estande' ? sortear(['P2.6', 'P2.9'] as const)
    : aplicacao === 'plenaria' ? sortear(['P3.9', 'P2.9'] as const)
    : sortear(['P2.9', 'P3.9'] as const);

  const colunas = entre(meta.colunas[0], meta.colunas[1]);
  const linhas = entre(meta.linhas[0], meta.linhas[1]);

  // O local entrega um circuito de folga sobre o necessário. Depois do
  // imprevisto costuma faltar — que é exatamente a decisão do hub extra.
  const circuitos = Math.ceil((colunas * linhas) / GABINETES_POR_CIRCUITO) + 1;

  return {
    aplicacao, pitch, colunas, linhas,
    evento: sortear(EVENTOS[aplicacao]),
    circuitos,
    janelaMin: janelaPara(colunas, linhas),
  };
}

// ---------------------------------------------------------------------------
// Janela de montagem
// ---------------------------------------------------------------------------

export const HORA_INICIAL = 14 * 60;

/**
 * Quanto tempo a produção dá para a carga. Não é fixo: um telão de 90
 * gabinetes não se monta na mesma janela de uma testeira de 40, e fixar 5 h
 * para tudo tornava as obras grandes invencíveis mesmo jogadas na perfeição.
 * A margem de 30% sobre o trabalho mínimo é o que o imprevisto vai comer.
 */
export function janelaPara(colunas: number, linhas: number): number {
  const trabalho =
    colunas * linhas * CUSTO.instalarChao
    + CUSTO.conferirPrumo + CUSTO.icar
    + CUSTO.fecharEnergia + CUSTO.fecharSinal + CUSTO.testar + CUSTO.acabamento
    + 12; // setup típico de processadora
  return Math.round((trabalho * 1.3) / 5) * 5;
}

export const janelaDe = (e: Estado) => e.briefing.janelaMin;

/** O cliente muda o pedido com 40% da janela gasta. */
export const minutoImprevisto = (e: Estado) => Math.round(e.briefing.janelaMin * 0.4);

// ---------------------------------------------------------------------------
// Custos e penalidades, em minutos
// ---------------------------------------------------------------------------

export const CUSTO = {
  instalarChao: 2,
  instalarAr: 5,
  remover: 1,
  conferirPrumo: 5,
  icar: 15,
  hubExtra: 10,
  placaExtra: 8,
  fecharEnergia: 20,
  fecharSinal: 15,
  testar: 10,
  acabamento: 15,
} as const;

export const PENALIDADE = {
  /** Içou sem conferir prumo: o painel sobe torto e desce de volta. */
  semPrumo: 12,
  /** Disjuntor cai no meio do evento. */
  circuitoSobrecarregado: 15,
  /** Faixa do painel fica apagada. */
  portaEstourada: 10,
} as const;

/** Trocar de processadora depois de escolhida: re-rack e remapeamento. */
export const CUSTO_TROCA_PROCESSADORA = 8;

/**
 * Minutos de atraso que o evento ainda absorve. Acima disso a porta abriu sem
 * painel. Sem essa régua a folga trava em zero e atrasar 5 min ou 2 h dá na
 * mesma — o jogo perde o gradiente justamente onde ele mais importa.
 */
export const ATRASO_TOLERADO = 30;

/** Talha maior que o necessário: peso e gente a mais pra subir. */
export const CUSTO_TALHA_FOLGADA: Record<number, number> = {
  500: 0,
  1000: 0,
  2000: 5,
  3000: 10,
};

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export type Celula = {
  instalado: boolean;
  /** Instalado depois do içamento — conta como retrabalho. */
  instaladoNoAr: boolean;
  circuito: number | null;
  porta: number | null;
};

export type Estado = {
  briefing: Briefing;
  gastos: number;
  colunas: number;
  linhas: number;
  celulas: Celula[];
  icado: boolean;
  prumoConferido: boolean;
  talhaKg: number | null;
  circuitosDisponiveis: number;
  /** null = ainda não escolheu. Sem processadora não há sinal nenhum. */
  processadoraId: string | null;
  /** A primeira escolha é de graça; trocar depois custa re-rack e remapeamento. */
  trocasProcessadora: number;
  /** Minutos perdidos que uma montagem correta não teria gasto. */
  retrabalho: number;
  imprevistoDisparado: boolean;
  finalizado: boolean;
};

export function criarPartida(briefing: Briefing = sortearBriefing()): Estado {
  return {
    briefing,
    gastos: 0,
    colunas: briefing.colunas,
    linhas: briefing.linhas,
    celulas: Array.from({ length: TOTAL_CELULAS }, () => ({
      instalado: false,
      instaladoNoAr: false,
      circuito: null,
      porta: null,
    })),
    icado: false,
    prumoConferido: false,
    talhaKg: null,
    circuitosDisponiveis: briefing.circuitos,
    processadoraId: null,
    trocasProcessadora: 0,
    retrabalho: 0,
    imprevistoDisparado: false,
    finalizado: false,
  };
}

/**
 * O cliente muda o pedido às 16:00. Testeira cresce para os lados, telão e
 * estande crescem para cima — cada forma cresce como cresceria na vida real.
 */
export function aplicarImprevisto(e: Estado): Estado {
  const cresce = APLICACOES[e.briefing.aplicacao].cresce;
  return cresce === 'largura'
    ? { ...e, colunas: Math.min(COLUNAS_MAX, e.colunas + 2), imprevistoDisparado: true }
    : { ...e, linhas: Math.min(LINHAS_MAX, e.linhas + 1), imprevistoDisparado: true };
}

/** Quantos gabinetes o imprevisto acrescenta, para o aviso na tela. */
export function gabinetesDoImprevisto(e: Estado): number {
  const depois = aplicarImprevisto(e);
  return depois.colunas * depois.linhas - e.colunas * e.linhas;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const indice = (linha: number, coluna: number) => linha * COLUNAS_MAX + coluna;
export const linhaDe = (i: number) => Math.floor(i / COLUNAS_MAX);
export const colunaDe = (i: number) => i % COLUNAS_MAX;

/** Célula faz parte do painel pedido (que muda de forma a cada obra). */
export const celulaAtiva = (e: Estado, i: number) =>
  linhaDe(i) < e.linhas && colunaDe(i) < e.colunas;

export const gabinetesInstalados = (e: Estado) =>
  e.celulas.filter((c, i) => celulaAtiva(e, i) && c.instalado).length;

export const gabinetesPedidos = (e: Estado) => e.linhas * e.colunas;

/** Portas que a processadora escolhida entrega. Sem escolha, nenhuma. */
export const portasDisponiveis = (e: Estado) =>
  acharProcessadora(e.processadoraId)?.portas ?? 0;

/** Teto de gabinetes por porta, que depende do pitch da obra. */
export const tetoPorPorta = (e: Estado) => gabinetesPorPorta(e.briefing.pitch);

export const portasNecessarias = (e: Estado) =>
  Math.ceil(gabinetesPedidos(e) / tetoPorPorta(e));

export const circuitosNecessarios = (e: Estado) =>
  Math.ceil(gabinetesPedidos(e) / GABINETES_POR_CIRCUITO);

export function relogio(gastos: number, janelaMin: number): string {
  const t = HORA_INICIAL + Math.min(gastos, janelaMin);
  const h = Math.floor(t / 60) % 24;
  const m = Math.round(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const folga = (e: Estado) => Math.max(0, janelaDe(e) - e.gastos);

/** Carga por ponto de içamento, que define a talha mínima. */
export function cargaPorPonto(e: Estado): number {
  const vaoM = e.colunas * MODULO_M + 1;
  const peso = gabinetesPedidos(e) * PESO_GABINETE_KG + vaoM * PESO_PORTAL_KG_POR_M;
  return Math.round(peso / PONTOS_ICAMENTO);
}

/** Mesma lógica do recomendarTalha() do simulador de boxtruss. */
export function talhaRecomendada(cargaKg: number): number {
  return TALHAS_KG.find((t) => t >= cargaKg) ?? TALHAS_KG[TALHAS_KG.length - 1];
}

export function contarPorCircuito(e: Estado): Map<number, number> {
  const m = new Map<number, number>();
  e.celulas.forEach((c, i) => {
    if (!celulaAtiva(e, i) || !c.instalado || c.circuito === null) return;
    m.set(c.circuito, (m.get(c.circuito) ?? 0) + 1);
  });
  return m;
}

export function contarPorPorta(e: Estado): Map<number, number> {
  const m = new Map<number, number>();
  e.celulas.forEach((c, i) => {
    if (!celulaAtiva(e, i) || !c.instalado || c.porta === null) return;
    m.set(c.porta, (m.get(c.porta) ?? 0) + 1);
  });
  return m;
}

export const resolucao = (e: Estado) => ({
  x: e.colunas * PITCHES[e.briefing.pitch].pxLado,
  y: e.linhas * PITCHES[e.briefing.pitch].pxLado,
});

/** Medidas físicas do painel contratado, em metros. */
export const medidasM = (e: Estado) => ({
  largura: e.colunas * MODULO_M,
  altura: e.linhas * MODULO_M,
});

// ---------------------------------------------------------------------------
// Distribuição de circuitos e portas
// ---------------------------------------------------------------------------

export type Atribuicao = 'circuito' | 'porta';

/**
 * Espalha as células alvo entre os circuitos (ou portas), começando em
 * `inicial` e derramando para o próximo com vaga assim que um enche.
 *
 * Existe porque as contas não encaixam de propósito: uma fiada tem 12
 * gabinetes e o circuito aguenta 8. Sem o derrame, pintar por fiada seria só
 * uma máquina de estourar disjuntor, e o jogador nunca chegaria à decisão que
 * interessa — comprar ou não o hub extra.
 *
 * Quando nenhum circuito tem vaga, segue atribuindo ao atual e sobrecarrega:
 * dá para plugar mais na série, quem barra é o disjuntor, e é essa a lição que
 * a vistoria cobra depois.
 */
export function distribuirAtribuicao(
  e: Estado,
  alvos: number[],
  campo: Atribuicao,
  inicial: number,
): { celulas: Celula[]; ultimo: number; mudou: boolean } {
  const teto = campo === 'circuito' ? GABINETES_POR_CIRCUITO : tetoPorPorta(e);
  const disponiveis = campo === 'circuito' ? e.circuitosDisponiveis : portasDisponiveis(e);
  const contagem = new Map(campo === 'circuito' ? contarPorCircuito(e) : contarPorPorta(e));

  let celulas = e.celulas;
  let atual = Math.min(Math.max(1, inicial), disponiveis);
  let mudou = false;

  for (const k of alvos) {
    if (!celulaAtiva(e, k)) continue;
    const celula = celulas[k];
    if (!celula.instalado) continue;

    if ((contagem.get(atual) ?? 0) >= teto) {
      for (let p = 1; p <= disponiveis; p++) {
        if ((contagem.get(p) ?? 0) < teto) { atual = p; break; }
      }
    }

    const antigo = campo === 'circuito' ? celula.circuito : celula.porta;
    if (antigo === atual) continue;

    if (antigo !== null) contagem.set(antigo, Math.max(0, (contagem.get(antigo) ?? 1) - 1));
    contagem.set(atual, (contagem.get(atual) ?? 0) + 1);

    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[k] = campo === 'circuito'
      ? { ...celula, circuito: atual }
      : { ...celula, porta: atual };
    mudou = true;
  }

  return { celulas, ultimo: atual, mudou };
}

/** Tira a atribuição das células alvo. */
export function limparAtribuicao(
  e: Estado,
  alvos: number[],
  campo: Atribuicao,
): { celulas: Celula[]; mudou: boolean } {
  let celulas = e.celulas;
  let mudou = false;

  for (const k of alvos) {
    if (!celulaAtiva(e, k)) continue;
    const celula = celulas[k];
    const antigo = campo === 'circuito' ? celula.circuito : celula.porta;
    if (!celula.instalado || antigo === null) continue;

    if (celulas === e.celulas) celulas = [...e.celulas];
    celulas[k] = campo === 'circuito'
      ? { ...celula, circuito: null }
      : { ...celula, porta: null };
    mudou = true;
  }

  return { celulas, mudou };
}

// ---------------------------------------------------------------------------
// Vistoria
// ---------------------------------------------------------------------------

export type Problema = {
  tipo: 'reprovacao' | 'tempo' | 'qualidade';
  /** Frase completa, para o painel de texto da vistoria. */
  texto: string;
  /** Etiqueta curta, para a plaqueta em que a câmera para no 3D. */
  curto: string;
  /** Células afetadas. Vazio = problema do salão, sem foco no painel. */
  celulas: number[];
  minutos?: number;
  qualidade?: number;
};

export type Vistoria = {
  problemas: Problema[];
  reprovado: boolean;
  qualidade: number;
  minutosExtras: number;
};

/** Índices das células ativas que satisfazem um teste. */
function celulasOnde(e: Estado, teste: (c: Celula, i: number) => boolean): number[] {
  const fora: number[] = [];
  e.celulas.forEach((c, i) => { if (celulaAtiva(e, i) && teste(c, i)) fora.push(i); });
  return fora;
}

export function vistoriar(e: Estado): Vistoria {
  const problemas: Problema[] = [];

  // --- reprovações de segurança: encerram a partida, não custam minutos ---
  const carga = cargaPorPonto(e);
  if (e.talhaKg !== null && e.talhaKg < carga) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `Talha de ${e.talhaKg} kg para uma carga de ${carga} kg por ponto. O mínimo era ${talhaRecomendada(carga)} kg.`,
      curto: `Talha de ${e.talhaKg} kg é pouco`,
      celulas: [],
    });
  }

  if (e.processadoraId === null) {
    problemas.push({
      tipo: 'reprovacao',
      texto: 'Nenhuma processadora foi escolhida. O painel subiu, acendeu e não recebeu imagem nenhuma.',
      curto: 'Sem processadora',
      celulas: [],
    });
  }

  const atraso = Math.max(0, e.gastos - janelaDe(e));
  if (atraso > ATRASO_TOLERADO) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `A porta abriu e a montagem ainda levou ${atraso} min. O evento começou sem painel.`,
      curto: `${atraso} min de atraso`,
      celulas: [],
    });
  } else if (atraso > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `Montagem terminou ${atraso} min depois de abrir a porta — o público entrou com a equipe ainda no palco.`,
      curto: `${atraso} min de atraso`,
      celulas: [],
      qualidade: 30,
    });
  }

  // --- problemas que custam minutos ---
  for (const [circuito, qtd] of contarPorCircuito(e)) {
    if (qtd > GABINETES_POR_CIRCUITO) {
      problemas.push({
        tipo: 'tempo',
        texto: `Circuito ${circuito} com ${qtd} gabinetes (teto é ${GABINETES_POR_CIRCUITO}). Disjuntor caiu durante o evento.`,
        curto: `Circuito ${circuito} sobrecarregado`,
        celulas: celulasOnde(e, (c) => c.instalado && c.circuito === circuito),
        minutos: PENALIDADE.circuitoSobrecarregado,
        qualidade: 15,
      });
    }
  }

  for (const [porta, qtd] of contarPorPorta(e)) {
    if (qtd > tetoPorPorta(e)) {
      const px = (qtd * pxPorGabinete(e.briefing.pitch)).toLocaleString('pt-BR');
      problemas.push({
        tipo: 'tempo',
        texto: `Porta ${porta} recebeu ${qtd} gabinetes — ${px} px, acima dos ${PX_POR_PORTA.toLocaleString('pt-BR')} px. Faixa do painel apagada.`,
        curto: `Porta ${porta} estourou os pixels`,
        celulas: celulasOnde(e, (c) => c.instalado && c.porta === porta),
        minutos: PENALIDADE.portaEstourada,
        qualidade: 20,
      });
    }
  }

  // --- problemas que só custam qualidade ---
  // Painel incompleto não é perda de qualidade, é entrega furada: o cliente
  // contratou 6 x 3 m e recebeu menos. Sem isso, largar o painel vazio e
  // fechar cedo pontuaria mais que montar direito.
  // Quanto mais perto a plateia, menos buraco passa: estande a 2 m não perdoa
  // nenhum, plenária a 10 m engole três.
  const furosTolerados = APLICACOES[e.briefing.aplicacao].furosTolerados;
  const faltando = gabinetesPedidos(e) - gabinetesInstalados(e);
  if (faltando > furosTolerados) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `Painel entregue incompleto: ${faltando} gabinetes que o cliente contratou não foram instalados.`,
      curto: `${faltando} gabinetes faltando`,
      celulas: celulasOnde(e, (c) => !c.instalado),
    });
  } else if (faltando > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${faltando} ${faltando === 1 ? 'buraco' : 'buracos'} no painel, à vista do público.`,
      curto: faltando === 1 ? 'Buraco no painel' : `${faltando} buracos no painel`,
      celulas: celulasOnde(e, (c) => !c.instalado),
      qualidade: faltando * 20,
    });
  }

  const celulasSemCircuito = celulasOnde(e, (c) => c.instalado && c.circuito === null);
  const semCircuito = celulasSemCircuito.length;
  if (semCircuito > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${semCircuito} ${semCircuito === 1 ? 'gabinete' : 'gabinetes'} sem energia — apagados no painel.`,
      curto: 'Gabinetes sem energia',
      celulas: celulasSemCircuito,
      qualidade: Math.min(60, semCircuito * 3),
    });
  }

  const celulasSemPorta = celulasOnde(e, (c) => c.instalado && c.porta === null);
  const semPorta = celulasSemPorta.length;
  if (semPorta > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${semPorta} ${semPorta === 1 ? 'gabinete' : 'gabinetes'} sem sinal — acesos, mas sem imagem.`,
      curto: 'Gabinetes sem sinal',
      celulas: celulasSemPorta,
      qualidade: Math.min(60, semPorta * 3),
    });
  }

  const deducao = problemas.reduce((s, p) => s + (p.qualidade ?? 0), 0);
  const minutosExtras = problemas.reduce((s, p) => s + (p.minutos ?? 0), 0);

  return {
    problemas,
    reprovado: problemas.some((p) => p.tipo === 'reprovacao'),
    qualidade: Math.max(0, Math.min(100, 100 - deducao)),
    minutosExtras,
  };
}

// ---------------------------------------------------------------------------
// Pontuação
// ---------------------------------------------------------------------------

export type Placar = {
  folgaMin: number;
  qualidade: number;
  bonusSemRetrabalho: number;
  total: number;
  reprovado: boolean;
};

export const BONUS_SEM_RETRABALHO = 150;

export function pontuar(e: Estado, v: Vistoria): Placar {
  const folgaMin = Math.max(0, janelaDe(e) - e.gastos - v.minutosExtras);
  const bonus = e.retrabalho === 0 && !v.reprovado ? BONUS_SEM_RETRABALHO : 0;
  const total = v.reprovado ? 0 : folgaMin * 10 + v.qualidade * 5 + bonus;
  return {
    folgaMin,
    qualidade: v.qualidade,
    bonusSemRetrabalho: bonus,
    total,
    reprovado: v.reprovado,
  };
}
