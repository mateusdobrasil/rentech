// app/lib/temaTela.ts
// Tema da tela do painel (/admin): Claro ou Escuro, escolhido em /admin/conta.
//
// A escolha fica no navegador (localStorage), vale pra todas as telas do
// /admin e é aplicada antes da primeira pintura pelo script de app/layout.tsx
// (sem "piscar" claro ao abrir uma página). O escuro é a classe tema-escuro no
// <html> — ver app/globals.css: inverte a tela inteira e devolve fotos, logos,
// QR codes e a barra do topo às cores originais. Fora do /admin (site, portal
// do funcionário, login) o tema não se aplica.
export type TemaTela = 'claro' | 'escuro';

export const CHAVE_TEMA_TELA = 'rentech_tema';

export function lerTemaTela(): TemaTela {
  try {
    return localStorage.getItem(CHAVE_TEMA_TELA) === 'escuro' ? 'escuro' : 'claro';
  } catch {
    return 'claro';
  }
}

export function aplicarTemaTela(tema: TemaTela) {
  document.documentElement.classList.toggle('tema-escuro', tema === 'escuro');
}

export function salvarTemaTela(tema: TemaTela) {
  try {
    localStorage.setItem(CHAVE_TEMA_TELA, tema);
  } catch {
    // navegador sem storage (aba anônima bloqueada): vale só até recarregar
  }
  aplicarTemaTela(tema);
}
