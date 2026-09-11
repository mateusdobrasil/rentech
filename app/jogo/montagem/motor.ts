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
  /**
   * 'envio': recebe o sinal de um notebook ou mesa e só distribui.
   * 'player': linha Taurus — guarda os arquivos e roda o conteúdo sozinha.
   */
  linha: 'envio' | 'player';
  /** Escondido do jogador: saber isso de cabeça é parte do ofício. */
  portas: number;
  /** Carga total. Na maioria é portas x 640 mil; o TB60 carrega menos que a soma. */
  pxMax: number;
  /** Minutos de rack e mapeamento. No player, inclui subir os arquivos. */
  setupMin: number;
  nota: string;
};

// Capacidades conforme as fichas da Novastar. Os números da linha Taurus
// (650 mil / 1,3 M / 2,3 M) valem conferir no datasheet antes de treinar gente.
export const PROCESSADORAS: Processadora[] = [
  { id: 'mctrl300', nome: 'MCTRL300', linha: 'envio', portas: 1, pxMax: PX_POR_PORTA, setupMin: 4, nota: 'Só envio, sem escalonamento' },
  { id: 'mctrl660', nome: 'MCTRL660 PRO', linha: 'envio', portas: 2, pxMax: 2 * PX_POR_PORTA, setupMin: 6, nota: 'Envio com entrada HDMI/DVI' },
  { id: 'vx400', nome: 'VX400', linha: 'envio', portas: 4, pxMax: 4 * PX_POR_PORTA, setupMin: 9, nota: 'All-in-one com escalonamento' },
  { id: 'vx600', nome: 'VX600', linha: 'envio', portas: 6, pxMax: 6 * PX_POR_PORTA, setupMin: 12, nota: 'All-in-one, porte médio' },
  { id: 'vx1000', nome: 'VX1000', linha: 'envio', portas: 10, pxMax: 10 * PX_POR_PORTA, setupMin: 16, nota: 'All-in-one, grande porte' },
  { id: 'mctrl4k', nome: 'MCTRL4K', linha: 'envio', portas: 16, pxMax: 8_800_000, setupMin: 22, nota: 'Envio 4K, painéis grandes' },
  { id: 'tb30', nome: 'Taurus TB30', linha: 'player', portas: 1, pxMax: 650_000, setupMin: 8, nota: 'Player compacto, guarda o conteúdo' },
  { id: 'tb40', nome: 'Taurus TB40', linha: 'player', portas: 2, pxMax: 1_300_000, setupMin: 11, nota: 'Player com Wi-Fi, guarda o conteúdo' },
  { id: 'tb60', nome: 'Taurus TB60', linha: 'player', portas: 4, pxMax: 2_300_000, setupMin: 15, nota: 'Player com entrada HDMI, guarda o conteúdo' },
];

export const acharProcessadora = (id: string | null) =>
  PROCESSADORAS.find((p) => p.id === id) ?? null;

// ---------------------------------------------------------------------------
// Conteúdo — quem manda a imagem para o painel durante o evento
// ---------------------------------------------------------------------------

export type Conteudo = 'operador' | 'autonomo';

export const CONTEUDOS: Record<Conteudo, { rotulo: string; descricao: string }> = {
  operador: {
    rotulo: 'Operador na régie',
    descricao: 'Tem técnico com notebook mandando o conteúdo durante o evento.',
  },
  autonomo: {
    rotulo: 'Roda sozinho',
    descricao: 'Vídeo em loop o dia inteiro, sem operador e sem notebook no local.',
  },
};

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

// ---------------------------------------------------------------------------
// Energia — números da operação da Rentech
// ---------------------------------------------------------------------------

/** Consumo do painel por metro quadrado. */
export const CONSUMO_W_M2 = 400;

/** Tomadas do local: 220 V, disjuntor de 20 A. */
export const TENSAO_V = 220;
export const DISJUNTOR_A = 20;

/**
 * Disjuntor não trabalha no limite: carga contínua fica em 80% do nominal.
 * Os 20% de folga cobrem o calor no quadro, a queda de tensão no fim do cabo
 * e o pico das fontes quando o painel liga ou o conteúdo vai para o branco.
 */
export const MARGEM_DISJUNTOR = 0.8;

export const W_POR_GABINETE = CONSUMO_W_M2 * MODULO_M * MODULO_M; // 100 W
export const W_NOMINAL_CIRCUITO = TENSAO_V * DISJUNTOR_A; // 4.400 W
export const W_UTIL_CIRCUITO = W_NOMINAL_CIRCUITO * MARGEM_DISJUNTOR; // 3.520 W

/** Quantos gabinetes um circuito aguenta dentro da margem: 35. */
export const GABINETES_POR_CIRCUITO = Math.floor(W_UTIL_CIRCUITO / W_POR_GABINETE);

/**
 * Energia se paga por circuito: cada um é um lance de cabo do quadro até o
 * painel, um disjuntor e um teste de tensão. O ideal é o menor número de
 * circuitos que carrega o painel sem passar da margem — dividindo a carga por
 * igual entre eles, como se faz na obra. Cada circuito além do necessário é
 * cabo puxado à toa. Sobrecarregado derruba o disjuntor no meio do evento
 * (isso é cobrado na vistoria, não aqui).
 */
export const ENERGIA = {
  /** Montar o hub, aterramento e conferência de fase e neutro. */
  base: 6,
  porCircuito: 5,
} as const;

export const circuitosPara = (gabinetes: number) => Math.ceil(gabinetes / GABINETES_POR_CIRCUITO);

/** O melhor que dá para fazer com N gabinetes: só os circuitos necessários. */
export function custoEnergiaIdeal(gabinetes: number): number {
  return ENERGIA.base + circuitosPara(gabinetes) * ENERGIA.porCircuito;
}

/** "3,5 kW" */
export const fmtKw = (w: number) => `${(w / 1000).toFixed(1).replace('.', ',')} kW`;

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
  /** Circuitos de 220 V / 20 A que o local disponibiliza. */
  circuitos: number;
  /** Minutos de carga até a porta abrir. Acompanha o tamanho da obra. */
  janelaMin: number;
  /** Número da ordem de serviço, só para a OS parecer uma OS. */
  os: number;
  /** O que a OS esconde e o técnico precisa calcular. */
  pergunta: PerguntaOS;
  /** Com operador, qualquer processadora serve; rodando sozinho, só player. */
  conteudo: Conteudo;
};

/**
 * A OS nunca traz tudo: ou informa o tamanho e pede a resolução, ou informa a
 * resolução e pede o tamanho. Nos dois casos a ponte é a mesma conta — quantos
 * gabinetes de 0,5 m cabem, vezes os pixels por lado do pitch — e é essa conta
 * que o montador precisa saber fazer de cabeça na obra.
 */
export type PerguntaOS = 'resolucao' | 'tamanho';

const CHANCE_AUTONOMO: Record<Aplicacao, number> = { estande: 0.7, testeira: 0.6, plenaria: 0 };

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
  const circuitos = circuitosPara(colunas * linhas) + 1;

  return {
    aplicacao, pitch, colunas, linhas,
    evento: sortear(EVENTOS[aplicacao]),
    circuitos,
    janelaMin: janelaPara(colunas, linhas),
    os: entre(4100, 9899),
    pergunta: sortear(['resolucao', 'tamanho'] as const),
    // Plenária sempre tem régie. Estande e testeira de feira costumam passar o
    // dia rodando um loop sem ninguém — é aí que o player Taurus entra.
    conteudo: Math.random() < CHANCE_AUTONOMO[aplicacao] ? 'autonomo' : 'operador',
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
    + custoEnergiaIdeal(colunas * linhas) + CUSTO.fecharSinal + CUSTO.testar + CUSTO.acabamento
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
  leitura: LeituraOS;
};

export type LeituraOS = {
  tentativas: number;
  resolvida: boolean;
  /** Acertou sem consultar ninguém: é isso que vale o bônus. */
  dePrimeira: boolean;
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
    leitura: { tentativas: 0, resolvida: false, dePrimeira: false },
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
/** Fração do painel montada a partir da qual o cliente liga pedindo mais. */
export const FRACAO_IMPREVISTO = 0.6;

/**
 * Quando o cliente muda o pedido: com 40% da janela gasta OU com 60% do painel
 * montado, o que vier primeiro — e nunca com a montagem já fechada.
 *
 * Só pelo relógio não bastava: em obra pequena, montar tudo e içar não chega
 * aos 40%, e quem cruzava a marca era o próprio "Fechar montagem". O painel
 * crescia depois de fechado, sem chance de montar o que foi pedido.
 */
export function deveDispararImprevisto(e: Estado): boolean {
  if (e.imprevistoDisparado || e.finalizado) return false;
  return e.gastos >= minutoImprevisto(e)
    || gabinetesInstalados(e) >= Math.ceil(gabinetesPedidos(e) * FRACAO_IMPREVISTO);
}

export function gabinetesDoImprevisto(e: Estado): number {
  // O aviso aparece com o painel já crescido. Aplicar de novo em cima dele
  // dava zero (ou crescia duas vezes na conta): a comparação certa é com a
  // obra como foi contratada.
  if (e.imprevistoDisparado) return e.colunas * e.linhas - e.briefing.colunas * e.briefing.linhas;
  const depois = aplicarImprevisto(e);
  return depois.colunas * depois.linhas - e.colunas * e.linhas;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const indice = (linha: number, coluna: number) => linha * COLUNAS_MAX + coluna;
export const linhaDe = (i: number) => Math.floor(i / COLUNAS_MAX);
export const colunaDe = (i: number) => i % COLUNAS_MAX;

/**
 * Toda célula da grade é um encaixe válido. A grade é maior que qualquer obra
 * de propósito: quem decide quais gabinetes habilitar para chegar na medida da
 * OS é o técnico — a planta não entrega o formato pronto.
 */
export const celulaAtiva = (_e: Estado, i: number) => i >= 0 && i < TOTAL_CELULAS;

export type Encaixe = {
  coluna0: number;
  linha0: number;
  colunas: number;
  linhas: number;
  /** Encaixes dentro da medida da OS que ficaram sem gabinete. */
  faltando: number[];
  /** Gabinetes habilitados fora da medida da OS. */
  sobrando: number[];
};

/**
 * Onde o painel da OS está no que foi montado: testa todas as posições do
 * retângulo pedido e fica com a que cobre mais gabinetes. Assim um painel
 * certo com um gabinete perdido do lado conta como "1 a mais", e não como um
 * painel gigante cheio de buraco.
 */
export function encaixeDaOS(e: Estado): Encaixe {
  const w = e.colunas, h = e.linhas;
  let melhor = { c0: 0, l0: 0, dentro: -1 };
  for (let l0 = 0; l0 + h <= LINHAS_MAX; l0++) {
    for (let c0 = 0; c0 + w <= COLUNAS_MAX; c0++) {
      let dentro = 0;
      for (let l = l0; l < l0 + h; l++) {
        for (let c = c0; c < c0 + w; c++) if (e.celulas[indice(l, c)].instalado) dentro++;
      }
      if (dentro > melhor.dentro) melhor = { c0, l0, dentro };
    }
  }
  const faltando: number[] = [];
  const sobrando: number[] = [];
  e.celulas.forEach((c, i) => {
    const l = linhaDe(i), col = colunaDe(i);
    const naMedida = l >= melhor.l0 && l < melhor.l0 + h && col >= melhor.c0 && col < melhor.c0 + w;
    if (naMedida && !c.instalado) faltando.push(i);
    if (!naMedida && c.instalado) sobrando.push(i);
  });
  return { coluna0: melhor.c0, linha0: melhor.l0, colunas: w, linhas: h, faltando, sobrando };
}

/** Retângulo que envolve o que foi montado, para pendurar e iluminar. */
export function extensaoMontada(e: Estado): { coluna0: number; linha0: number; colunas: number; linhas: number } | null {
  let c0 = Infinity, c1 = -1, l0 = Infinity, l1 = -1;
  e.celulas.forEach((c, i) => {
    if (!c.instalado) return;
    c0 = Math.min(c0, colunaDe(i)); c1 = Math.max(c1, colunaDe(i));
    l0 = Math.min(l0, linhaDe(i)); l1 = Math.max(l1, linhaDe(i));
  });
  if (c1 < 0) return null;
  return { coluna0: c0, linha0: l0, colunas: c1 - c0 + 1, linhas: l1 - l0 + 1 };
}

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

export const circuitosNecessarios = (e: Estado) => circuitosPara(gabinetesPedidos(e));

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

export type SituacaoCircuito = 'ideal' | 'sobra' | 'sobrecarregado';

/**
 * Como ficou cada circuito que o técnico usou. Acima da margem, sobrecarregado.
 * Se usou mais circuitos que o painel pedia, os mais leves são os de sobra —
 * eram eles que dava para ter juntado nos outros.
 */
export function situacaoCircuitos(e: Estado): { circuito: number; gabinetes: number; watts: number; situacao: SituacaoCircuito }[] {
  const usados = [...contarPorCircuito(e).entries()];
  const aMais = Math.max(0, usados.length - circuitosPara(gabinetesInstalados(e)));
  const deSobra = new Set(
    usados
      .filter(([, g]) => g <= GABINETES_POR_CIRCUITO)
      .sort((a, b) => a[1] - b[1] || b[0] - a[0])
      .slice(0, aMais)
      .map(([c]) => c),
  );
  return usados
    .sort((a, b) => a[0] - b[0])
    .map(([circuito, gabinetes]) => ({
      circuito,
      gabinetes,
      watts: gabinetes * W_POR_GABINETE,
      situacao: gabinetes > GABINETES_POR_CIRCUITO ? 'sobrecarregado'
        : deSobra.has(circuito) ? 'sobra'
        : 'ideal',
    }));
}

/** Minutos de energia: um lance de cabo por circuito usado. */
export function custoEnergia(e: Estado): number {
  return ENERGIA.base + contarPorCircuito(e).size * ENERGIA.porCircuito;
}

/**
 * Tudo que o botão "Fechar montagem" cobra: energia pelos circuitos usados,
 * sinal, teste, acabamento e o setup da processadora escolhida.
 */
export function custoFechamento(e: Estado): number {
  const setup = acharProcessadora(e.processadoraId)?.setupMin ?? 0;
  return custoEnergia(e) + CUSTO.fecharSinal + CUSTO.testar + CUSTO.acabamento + setup;
}

/** O que o placar mostra sobre energia, já que durante o jogo não há contagem. */
export function licaoEnergia(e: Estado) {
  const circuitos = situacaoCircuitos(e);
  const montados = gabinetesInstalados(e);
  return {
    circuitos,
    usados: circuitos.length,
    minimo: circuitosPara(montados),
    wattsTotal: montados * W_POR_GABINETE,
    conta: `Gabinete de 0,5 × 0,5 m = 0,25 m² × ${CONSUMO_W_M2} W = ${W_POR_GABINETE} W. `
      + `Circuito ${TENSAO_V} V × ${DISJUNTOR_A} A = ${W_NOMINAL_CIRCUITO.toLocaleString('pt-BR')} W; `
      + `a ${Math.round(MARGEM_DISJUNTOR * 100)}%, ${W_UTIL_CIRCUITO.toLocaleString('pt-BR')} W `
      + `→ ${GABINETES_POR_CIRCUITO} gabinetes por circuito`,
    ideais: circuitos.filter((c) => c.situacao === 'ideal').length,
    comSobra: circuitos.filter((c) => c.situacao === 'sobra').length,
    sobrecarregados: circuitos.filter((c) => c.situacao === 'sobrecarregado').length,
    minutos: custoEnergia(e),
    minutosIdeal: custoEnergiaIdeal(montados),
  };
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
 * Existe porque as contas não encaixam de propósito: uma fiada raramente
 * fecha com o teto do circuito ou da porta. Sem o derrame, pintar por fiada seria só
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

  const proc = acharProcessadora(e.processadoraId);
  if (proc) {
    const pxMontado = gabinetesInstalados(e) * pxPorGabinete(e.briefing.pitch);
    if (pxMontado > proc.pxMax) {
      problemas.push({
        tipo: 'tempo',
        texto: `A ${proc.nome} carrega ${fmtMilhoes(proc.pxMax)} de pixels no total, e o painel montado tem ${fmtMilhoes(pxMontado)}. Mesmo com porta sobrando, a imagem chegou cortada.`,
        curto: 'Processadora sobrecarregada',
        celulas: celulasOnde(e, (c) => c.instalado),
        minutos: 12,
        qualidade: 20,
      });
    }
    if (e.briefing.conteudo === 'autonomo' && proc.linha !== 'player') {
      problemas.push({
        tipo: 'tempo',
        texto: `A OS pedia conteúdo rodando sozinho, sem operador. A ${proc.nome} não guarda arquivo: sem notebook ligado nela, o painel ficou preto até alguém buscar um notebook de playback.`,
        curto: 'Sem player para o loop',
        celulas: [],
        minutos: 20,
        qualidade: 20,
      });
    }
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
        texto: `Circuito ${circuito} com ${qtd} gabinetes: ${fmtKw(qtd * W_POR_GABINETE)} num disjuntor de ${DISJUNTOR_A} A, que trabalha até ${fmtKw(W_UTIL_CIRCUITO)}. No pico do conteúdo ele desarmou durante o evento.`,
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
  const encaixe = encaixeDaOS(e);
  const faltando = encaixe.faltando.length;
  const medidaOS = `${e.colunas} × ${e.linhas} gabinetes (${fmtMetros(e.colunas)} × ${fmtMetros(e.linhas)} m)`;
  if (faltando > furosTolerados) {
    problemas.push({
      tipo: 'reprovacao',
      texto: `Painel menor que a OS: faltaram ${faltando} gabinetes para fechar ${medidaOS}.`,
      curto: `${faltando} gabinetes faltando`,
      celulas: encaixe.faltando,
    });
  } else if (faltando > 0) {
    problemas.push({
      tipo: 'qualidade',
      texto: `${faltando} ${faltando === 1 ? 'buraco' : 'buracos'} no painel, à vista do público.`,
      curto: faltando === 1 ? 'Buraco no painel' : `${faltando} buracos no painel`,
      celulas: encaixe.faltando,
      qualidade: faltando * 20,
    });
  }

  // Gabinete a mais não é bônus: o painel sai maior que o contratado, a
  // resolução não bate com o conteúdo e alguém tem que desligar a sobra.
  const sobrando = encaixe.sobrando.length;
  if (sobrando > 0) {
    problemas.push({
      tipo: 'tempo',
      texto: `${sobrando} ${sobrando === 1 ? 'gabinete habilitado' : 'gabinetes habilitados'} fora da medida da OS, que era ${medidaOS}. A imagem não fechava na resolução pedida e a sobra teve que ser desligada e remapeada.`,
      curto: `${sobrando} a mais que a OS`,
      celulas: encaixe.sobrando,
      minutos: Math.min(20, 6 + sobrando),
      qualidade: Math.min(40, sobrando * 5),
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

const fmtMetros = (gabinetes: number) => (gabinetes * MODULO_M).toFixed(1).replace('.', ',');
const fmtMilhoes = (px: number) => `${(px / 1_000_000).toFixed(2).replace('.', ',')} milhões`;

/** Uma processadora dá conta da obra? Portas, carga total e tipo de conteúdo. */
export function processadoraServe(e: Estado, p: Processadora): boolean {
  const px = gabinetesPedidos(e) * pxPorGabinete(e.briefing.pitch);
  return p.portas >= portasNecessarias(e)
    && p.pxMax >= px
    && (e.briefing.conteudo === 'operador' || p.linha === 'player');
}

/** A que serve e monta mais rápido. É a resposta que o placar revela. */
export function processadoraIdeal(e: Estado): Processadora {
  const candidatas = PROCESSADORAS.filter((p) => processadoraServe(e, p));
  return [...candidatas].sort((a, b) => a.setupMin - b.setupMin)[0]
    ?? PROCESSADORAS[PROCESSADORAS.length - 1];
}

/**
 * As portas ficam escondidas durante o jogo, então o placar é onde a pessoa
 * aprende: qual usou, quantas portas ela tem, o que a obra pedia e qual era
 * a certa.
 */
export function licaoProcessadora(e: Estado) {
  const usada = acharProcessadora(e.processadoraId);
  const ideal = processadoraIdeal(e);
  const px = gabinetesPedidos(e) * pxPorGabinete(e.briefing.pitch);
  const serviu = usada ? processadoraServe(e, usada) : false;
  return {
    serviu,
    usada,
    ideal,
    portasNecessarias: portasNecessarias(e),
    pxObra: px,
    // Só acerta quem escolheu uma que serve: se nenhuma do catálogo dava
    // conta, a "ideal" é só a menos pior, e escolhê-la não é acerto.
    acertou: serviu && usada?.id === ideal.id,
    pxTexto: fmtMilhoes(px),
  };
}

/**
 * O porquê, em frases. "Serviu mas não era a melhor" sem motivo não ensina
 * nada — ainda mais quando as duas têm as mesmas portas. Cada frase diz uma
 * coisa verificável: portas, carga total, tipo de conteúdo, tempo de setup.
 */
export function motivosProcessadora(e: Estado): string[] {
  const l = licaoProcessadora(e);
  const u = l.usada;
  const ideal = l.ideal;
  const precisa = l.portasNecessarias;
  const autonomo = e.briefing.conteudo === 'autonomo';
  const portas = (n: number) => `${n} ${n === 1 ? 'porta' : 'portas'}`;

  if (!u) return [`Nenhuma foi escolhida. A certa era a ${ideal.nome}.`];

  if (l.acertou) {
    return [`A ${u.nome} tem ${portas(u.portas)} para as ${precisa} que a obra pedia${
      autonomo ? ', guarda o conteúdo' : ''
    }, e é a de menor setup entre as que serviam: ${u.setupMin} min.`];
  }

  if (!l.serviu) {
    const fora: string[] = [];
    if (u.portas < precisa) fora.push(`A ${u.nome} tem ${portas(u.portas)} e a obra pedia ${precisa}: parte do painel ficou sem sinal.`);
    else if (u.pxMax < l.pxObra) fora.push(`A ${u.nome} tem portas suficientes, mas carrega só ${fmtMilhoes(u.pxMax)} de px no total — o painel tinha ${l.pxTexto}.`);
    if (autonomo && u.linha !== 'player') fora.push(`O conteúdo tinha que rodar sozinho, e a ${u.nome} não guarda arquivo: sem notebook, o painel fica preto.`);
    if (ideal.id === u.id || !processadoraServe(e, ideal)) fora.push('Nenhuma processadora do catálogo dava conta dessa obra sozinha.');
    else fora.push(`A certa era a ${ideal.nome}: ${portas(ideal.portas)}${ideal.linha === 'player' ? ', guarda o conteúdo' : ''}, setup de ${ideal.setupMin} min.`);
    return fora;
  }

  // Serviu, mas havia uma mais rápida de montar. O motivo é sempre setup;
  // o que muda é de onde vem o setup a mais.
  const frases: string[] = [];
  if (u.linha === 'player' && !autonomo) {
    frases.push('Com operador na régie o conteúdo vem do notebook, então não precisa de player — e o setup da Taurus inclui subir os arquivos.');
  }
  if (u.portas > ideal.portas) {
    frases.push(`A ${u.nome} tem ${portas(u.portas)}; ${precisa} bastavam. Máquina maior, mais mapeamento.`);
  } else if (u.portas === ideal.portas) {
    frases.push(`As duas têm ${portas(u.portas)} e davam conta da obra.`);
  }
  frases.push(`A ${ideal.nome} monta em ${ideal.setupMin} min, contra ${u.setupMin} da ${u.nome}: ${u.setupMin - ideal.setupMin} min a mais no relógio.`);
  return frases;
}

/** Sinal: o teto por porta é conta do técnico durante o jogo; o placar mostra. */
export function licaoSinal(e: Estado) {
  const teto = tetoPorPorta(e);
  const px = pxPorGabinete(e.briefing.pitch);
  const portas = [...contarPorPorta(e).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([porta, gabinetes]) => ({ porta, gabinetes, estourada: gabinetes > teto }));
  const semSinal = e.celulas.filter((c) => c.instalado && c.porta === null).length;
  return {
    teto,
    pxGabinete: px,
    portas,
    semSinal,
    estouradas: portas.filter((q) => q.estourada).length,
    conta: `${PX_POR_PORTA.toLocaleString('pt-BR')} px ÷ ${px.toLocaleString('pt-BR')} px por gabinete = ${teto} gabinetes por porta em ${e.briefing.pitch}`,
  };
}

// ---------------------------------------------------------------------------
// Leitura da OS
// ---------------------------------------------------------------------------

/**
 * Errar a leitura custa uma ligação para o escritório — primeiro pedindo uma
 * dica, depois pedindo a conta pronta. É relógio perdido, não game over:
 * o objetivo é que a pessoa saia sabendo fazer a conta.
 */
export const CUSTO_CONSULTA_OS = [5, 10] as const;
export const BONUS_LEITURA = 100;

/**
 * O que a OS pede: o painel (pitch) e a altura na unidade que ela não
 * informou. Sempre do painel como contratado, antes do imprevisto.
 */
export function respostaOS(b: Briefing): { pitch: PitchId; altura: number; unidade: 'px' | 'm' } {
  const px = PITCHES[b.pitch].pxLado;
  return b.pergunta === 'resolucao'
    ? { pitch: b.pitch, altura: b.linhas * px, unidade: 'px' }
    : { pitch: b.pitch, altura: b.linhas * MODULO_M, unidade: 'm' };
}

/** O que a OS informa, para a tela montar os campos. */
export function dadosOS(b: Briefing) {
  const px = PITCHES[b.pitch].pxLado;
  return {
    larguraM: b.colunas * MODULO_M,
    larguraPx: b.colunas * px,
    /** A altura vem numa unidade só: a outra é a pergunta. */
    alturaInformada: b.pergunta === 'resolucao'
      ? { valor: b.linhas * MODULO_M, unidade: 'm' as const }
      : { valor: b.linhas * px, unidade: 'px' as const },
  };
}

/** Aceita "6", "6,5", "6.5", "2016", "2.016" — como a pessoa digitaria. */
export function lerNumero(bruto: string, unidade: 'px' | 'm'): number | null {
  const limpo = bruto.trim().replace(/\s/g, '');
  if (!limpo) return null;
  const normalizado = unidade === 'px'
    ? limpo.replace(/[.,](?=\d{3}$)/, '')   // 2.016 ou 2,016 = milhar
    : limpo.replace(',', '.');
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

export type ConferenciaOS = { pitchOk: boolean; alturaOk: boolean };

export function conferirLeitura(b: Briefing, pitch: string, altura: string): ConferenciaOS {
  const certo = respostaOS(b);
  const a = lerNumero(altura, certo.unidade);
  const tol = certo.unidade === 'm' ? 0.01 : 0.5;
  return {
    pitchOk: pitch === certo.pitch,
    alturaOk: a !== null && Math.abs(a - certo.altura) < tol,
  };
}

/**
 * A conta por extenso, que a tela mostra quando a pessoa erra (ou acerta).
 * A segunda linha é a que mais ensina: pitch é a distância entre LEDs, então
 * 500 mm divididos pelos pixels do gabinete dão o pitch.
 */
export function contaOS(b: Briefing): string[] {
  const px = PITCHES[b.pitch].pxLado;
  const m = (n: number) => (n * MODULO_M).toFixed(1).replace('.', ',');
  const milhar = (n: number) => n.toLocaleString('pt-BR');
  const mm = (500 / px).toFixed(2).replace('.', ',');
  return [
    `Largura: ${m(b.colunas)} m ÷ 0,5 m = ${b.colunas} gabinetes`,
    `${milhar(b.colunas * px)} px ÷ ${b.colunas} gabinetes = ${px} px por gabinete → 500 mm ÷ ${px} = ${mm} mm → ${b.pitch}`,
    b.pergunta === 'resolucao'
      ? `Altura: ${m(b.linhas)} m ÷ 0,5 m = ${b.linhas} gabinetes × ${px} px = ${milhar(b.linhas * px)} px`
      : `Altura: ${milhar(b.linhas * px)} px ÷ ${px} px = ${b.linhas} gabinetes × 0,5 m = ${m(b.linhas)} m`,
  ];
}

// ---------------------------------------------------------------------------
// Pontuação
// ---------------------------------------------------------------------------

export type Placar = {
  folgaMin: number;
  qualidade: number;
  bonusSemRetrabalho: number;
  bonusLeitura: number;
  total: number;
  reprovado: boolean;
};

export const BONUS_SEM_RETRABALHO = 150;

export function pontuar(e: Estado, v: Vistoria): Placar {
  const folgaMin = Math.max(0, janelaDe(e) - e.gastos - v.minutosExtras);
  const bonus = e.retrabalho === 0 && !v.reprovado ? BONUS_SEM_RETRABALHO : 0;
  const bonusLeitura = e.leitura.dePrimeira && !v.reprovado ? BONUS_LEITURA : 0;
  const total = v.reprovado ? 0 : folgaMin * 10 + v.qualidade * 5 + bonus + bonusLeitura;
  return {
    folgaMin,
    qualidade: v.qualidade,
    bonusSemRetrabalho: bonus,
    bonusLeitura,
    total,
    reprovado: v.reprovado,
  };
}
