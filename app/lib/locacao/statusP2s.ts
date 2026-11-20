// app/lib/locacao/statusP2s.ts
// Códigos de status da TCustomFichaReservaLocacao — lista oficial enviada
// pelo suporte da P2S em 2026-11-19. O banco guarda o CÓDIGO cru
// (fichas_reserva.status, locacao_fichas_reserva.p2s_status,
// *.status_faturamento / status_ultimo_faturamento); a tradução é só na tela
// e no que vai para o Diretor (IA). Os rótulos são os mesmos da planilha
// exportada pelo P2S, então o import por Excel converte rótulo → código.
// Sem "use server" e sem dependências: usado em telas e no servidor.

export const STATUS_RESERVA_P2S: Record<string, string> = {
  EP: 'Em Preparação',
  DR: 'Disponível para Revisão',
  PR: 'Pronto para Envio ao Cliente',
  EN: 'Enviado - Aguardando Retorno',
  SB: 'Stand By',
  CA: 'Cancelado',
  A: 'Aprovado - Aguardando Saída',
  RE: 'Reprovado',
  E: 'Finalizado / Devolvido',
  X: 'Em Locação',
};

export const STATUS_FATURAMENTO_P2S: Record<string, string> = {
  N: 'Não Faturado',
  D: 'Dentro do Vencimento',
  Q: 'Quitado',
  V: 'Algum Faturamento Vencido',
};

// Encerradas: não ocupam nada e podem sair da base operacional.
export const STATUS_P2S_ENCERRADOS = ['RE', 'E', 'CA'];

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function codigoDe(mapa: Record<string, string>, valor: unknown): string | null {
  const s = String(valor ?? '').trim();
  if (!s) return null;
  if (mapa[s.toUpperCase()]) return s.toUpperCase();
  const alvo = semAcento(s);
  for (const [cod, rotulo] of Object.entries(mapa)) if (semAcento(rotulo) === alvo) return cod;
  return s; // desconhecido: guarda como veio (a tela mostra cru)
}

/** Aceita código ("EN") ou rótulo da planilha ("Enviado - Aguardando Retorno") e devolve o código. */
export const codigoStatusP2s = (v: unknown) => codigoDe(STATUS_RESERVA_P2S, v);
export const codigoFaturamentoP2s = (v: unknown) => codigoDe(STATUS_FATURAMENTO_P2S, v);

/** Rótulo para exibir; código desconhecido aparece como veio. */
export function rotuloStatusP2s(v: unknown): string {
  const c = codigoStatusP2s(v);
  return c ? STATUS_RESERVA_P2S[c] || c : '—';
}
export function rotuloFaturamentoP2s(v: unknown): string {
  const c = codigoFaturamentoP2s(v);
  return c ? STATUS_FATURAMENTO_P2S[c] || c : '—';
}
