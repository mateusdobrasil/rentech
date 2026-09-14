// ============================================================================
// CALL TIME — ranking do dia (modo Rápido / feira)
//
// Fica só no localStorage do aparelho do estande, e só guarda apelido. Nome
// completo digitado por visitante numa touchscreen é dado pessoal de terceiro,
// e nada no jogo precisa disso: o ranking existe para a pessoa se ver no topo
// da TV durante a feira, não para virar cadastro.
//
// Toda leitura descarta o que não é de hoje, então a lista se limpa sozinha na
// virada do dia sem ninguém precisar lembrar de apagar.
// ============================================================================

export type Marca = {
  apelido: string;
  pontos: number;
  /** AAAA-MM-DD local, para a lista expirar sozinha. */
  dia: string;
  quando: number;
};

/** Cada posto tem o seu quadro: pontos de LED e de luz não se comparam. */
export type Jogo = 'video' | 'luz' | 'som';
const chaveDe = (jogo: Jogo) => `calltime.ranking.${jogo}.v1`;
const LIMITE = 8;

export const APELIDO_MAX = 12;

export function diaDeHoje(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Higieniza o que veio da touchscreen: sem espaço duplo, sem tag, curto. */
export function limparApelido(bruto: string): string {
  return bruto
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, APELIDO_MAX);
}

export function lerRanking(jogo: Jogo = 'video'): Marca[] {
  if (typeof window === 'undefined') return [];
  try {
    const cru = window.localStorage.getItem(chaveDe(jogo));
    if (!cru) return [];
    const lista: unknown = JSON.parse(cru);
    if (!Array.isArray(lista)) return [];
    const hoje = diaDeHoje();
    return lista
      .filter((m): m is Marca =>
        !!m && typeof m === 'object' &&
        typeof (m as Marca).apelido === 'string' &&
        typeof (m as Marca).pontos === 'number' &&
        (m as Marca).dia === hoje,
      )
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, LIMITE);
  } catch {
    // Modo privativo, cota estourada, JSON corrompido: o jogo segue sem ranking.
    return [];
  }
}

export function gravarMarca(apelido: string, pontos: number, jogo: Jogo = 'video'): Marca[] {
  const limpo = limparApelido(apelido);
  if (!limpo) return lerRanking(jogo);

  const atualizada = [...lerRanking(jogo), { apelido: limpo, pontos, dia: diaDeHoje(), quando: Date.now() }]
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, LIMITE);

  try {
    window.localStorage.setItem(chaveDe(jogo), JSON.stringify(atualizada));
  } catch {
    // sem persistência, mas a lista da sessão ainda aparece na tela
  }
  return atualizada;
}

/** Posição (1-based) que essa pontuação ocuparia hoje. */
export function posicaoDe(pontos: number, jogo: Jogo = 'video'): number {
  return lerRanking(jogo).filter((m) => m.pontos > pontos).length + 1;
}

/** Entra no quadro se bate alguém ou se ainda sobra vaga. */
export function entraNoRanking(pontos: number, jogo: Jogo = 'video'): boolean {
  if (pontos <= 0) return false;
  const atual = lerRanking(jogo);
  return atual.length < LIMITE || pontos > atual[atual.length - 1].pontos;
}
