// app/lib/locacao/preco.ts
// Motor de preço da locação (regras combinadas com o usuário em 2026-11-16).
// Funções puras — usadas na tela de Tabelas de Preço (simulador) e no
// orçamento da Ficha de Reserva. Sem import de servidor: roda nos dois lados.
//
// REGRA DAS FAIXAS
// - Cada faixa tem "dias" e "valor_diaria" (o valor cadastrado é a DIÁRIA).
// - Para N dias, vale a MAIOR faixa com dias <= N:
//     total = faixa.dias × faixa.valor_diaria + (N − faixa.dias) × diária extra
// - Diária extra = a cadastrada no produto da tabela; sem cadastro, a diária
//   da própria faixa usada.
// - Sem nenhuma faixa <= N (ex.: só existe a faixa de 3 dias e a locação é de
//   1 dia), não há preço de tabela → o vendedor informa manualmente.
//
// Ex.: 1d=500, 3d=400, 5d=300, extra=250
//   2d = 1×500 + 1×250 = 750 · 4d = 3×400 + 1×250 = 1.450 · 10d = 5×300 + 5×250 = 2.750

export interface FaixaPreco {
  dias: number;
  valor_diaria: number;
}

export interface CalculoPreco {
  total: number;
  faixaDias: number;
  valorDiariaFaixa: number;
  diasExtra: number;
  valorDiariaExtra: number;
  /** true quando a diária extra não estava cadastrada e usou a da faixa */
  extraPelaFaixa: boolean;
}

const arred = (v: number) => Math.round(v * 100) / 100;

export function calcularPrecoPorFaixas(
  faixas: FaixaPreco[],
  valorDiariaExtra: number | null | undefined,
  dias: number
): CalculoPreco | null {
  if (!Number.isFinite(dias) || dias < 1) return null;
  const n = Math.floor(dias);
  const faixa = faixas
    .filter(f => f.dias >= 1 && f.dias <= n && Number.isFinite(f.valor_diaria))
    .sort((a, b) => b.dias - a.dias)[0];
  if (!faixa) return null;

  const diasExtra = n - faixa.dias;
  const extraCadastrado = valorDiariaExtra !== null && valorDiariaExtra !== undefined && Number.isFinite(valorDiariaExtra);
  const valorExtra = extraCadastrado ? Number(valorDiariaExtra) : faixa.valor_diaria;

  return {
    total: arred(faixa.dias * faixa.valor_diaria + diasExtra * valorExtra),
    faixaDias: faixa.dias,
    valorDiariaFaixa: faixa.valor_diaria,
    diasExtra,
    valorDiariaExtra: valorExtra,
    extraPelaFaixa: diasExtra > 0 && !extraCadastrado,
  };
}

// Coerência das faixas: alugar mais dias nunca deveria sair mais barato.
// Devolve os pares em que o total da faixa maior fica abaixo do da anterior
// (ex.: 3d × 100 = 300 e 4d × 50 = 200 → "4 dias sai mais barato que 3").
// Achado na importação do P2S em 2026-11-16: 43 produtos assim.
export function faixasIncoerentes(faixas: FaixaPreco[]): { menor: number; maior: number }[] {
  const ord = faixas.filter(f => Number.isFinite(f.valor_diaria)).sort((a, b) => a.dias - b.dias);
  const problemas: { menor: number; maior: number }[] = [];
  for (let i = 1; i < ord.length; i++) {
    if (ord[i].dias * ord[i].valor_diaria < ord[i - 1].dias * ord[i - 1].valor_diaria - 0.005) {
      problemas.push({ menor: ord[i - 1].dias, maior: ord[i].dias });
    }
  }
  return problemas;
}

// ESCOLHA DA TABELA
// Prioridade: EVENTO (do evento da ficha) > CLIENTE (do cliente da ficha) >
// PADRAO (da empresa). Só entram tabelas ativas, da empresa e vigentes na
// data de referência (normalmente a data de início do evento). Empate no
// mesmo tipo: vence a de vigência mais recente (sem início = mais antiga).
// O orçamento tenta a tabela escolhida e, se o produto não estiver nela, cai
// na próxima da lista (por isso a função devolve a ordem toda).

export type TipoTabelaPreco = 'PADRAO' | 'CLIENTE' | 'EVENTO';

export interface TabelaPrecoResumo {
  id: number;
  tipo: TipoTabelaPreco;
  empresa_id: number;
  parceiro_id: number | null;
  evento_id: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativa: boolean;
}

export function tabelaVigente(t: Pick<TabelaPrecoResumo, 'ativa' | 'vigencia_inicio' | 'vigencia_fim'>, dataISO: string): boolean {
  if (!t.ativa) return false;
  if (t.vigencia_inicio && dataISO < t.vigencia_inicio) return false;
  if (t.vigencia_fim && dataISO > t.vigencia_fim) return false;
  return true;
}

export function ordenarTabelasAplicaveis<T extends TabelaPrecoResumo>(
  tabelas: T[],
  ctx: { empresaId: number; parceiroId?: number | null; eventoId?: string | null; dataISO: string }
): T[] {
  const peso: Record<TipoTabelaPreco, number> = { EVENTO: 0, CLIENTE: 1, PADRAO: 2 };
  return tabelas
    .filter(t => t.empresa_id === ctx.empresaId && tabelaVigente(t, ctx.dataISO))
    .filter(t =>
      t.tipo === 'PADRAO' ||
      (t.tipo === 'CLIENTE' && !!ctx.parceiroId && t.parceiro_id === ctx.parceiroId) ||
      (t.tipo === 'EVENTO' && !!ctx.eventoId && t.evento_id === ctx.eventoId))
    .sort((a, b) => peso[a.tipo] - peso[b.tipo] || (b.vigencia_inicio || '').localeCompare(a.vigencia_inicio || ''));
}
