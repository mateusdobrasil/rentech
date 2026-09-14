// ============================================================================
// CALL TIME — onde o turno fica guardado enquanto o técnico está num posto
//
// O salão manda a pessoa para /calltime/video, /luz ou /som, e ela volta de lá
// com um resultado. No meio disso a página troca, então o turno precisa morar
// fora do React.
//
// sessionStorage, e não localStorage, de propósito: turno é coisa de uma
// sessão. Fechou a aba na feira, o próximo visitante começa do zero.
// ============================================================================

import type { Turno } from './motor';

const CHAVE = 'calltime.turno.v1';

export function lerTurno(): Turno | null {
  if (typeof window === 'undefined') return null;
  try {
    const cru = window.sessionStorage.getItem(CHAVE);
    if (!cru) return null;
    const t: unknown = JSON.parse(cru);
    // conferência rasa, só para não explodir com lixo de versão antiga
    if (!t || typeof t !== 'object') return null;
    const turno = t as Turno;
    if (!turno.obras || !turno.equipe || !turno.resultados) return null;
    return turno;
  } catch {
    // modo privativo, cota estourada, JSON corrompido: sem turno
    return null;
  }
}

export function salvarTurno(t: Turno): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify(t));
  } catch {
    // sem persistência o turno não atravessa a troca de página, mas a
    // partida em si continua jogável
  }
}

export function limparTurno(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHAVE);
  } catch {
    // nada a fazer
  }
}

/** A tela do posto está sendo jogada dentro de um turno? */
export function noTurno(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('turno') === '1';
}

export const ROTA_SALAO = '/testes/calltime/turno';
