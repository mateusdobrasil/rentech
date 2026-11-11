// app/lib/boletoMulta.ts
// Utilitários de boleto para as multas (/admin/operacional/multas): converte
// código de barras (44 dígitos) em linha digitável e valida os dígitos
// verificadores, nos dois padrões Febraban:
//   - Arrecadação (começa com "8" — guias de órgãos públicos, como as multas):
//     4 blocos de 11 dígitos + DV por bloco = 48 dígitos. O módulo do DV
//     depende do 3º dígito: 6/7 = módulo 10, 8/9 = módulo 11.
//   - Bancário (qualquer outro início): 5 campos = 47 dígitos.
// Sem dependências — pode rodar no servidor ou no navegador.

export const soDigitos = (s: string | null | undefined) => (s || '').replace(/\D/g, '');

export function modulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

// Módulo 11 de arrecadação: pesos 2..9 da direita pra esquerda; resto 0 ou 1 → DV 0.
export function modulo11Arrecadacao(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

// Módulo 11 bancário (DV geral do código de barras): resto 0, 1 ou 10 → DV 1.
function modulo11Bancario(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

const dvArrecadacao = (codigo: string, bloco: string) =>
  (codigo[2] === '6' || codigo[2] === '7') ? modulo10(bloco) : modulo11Arrecadacao(bloco);

// DV geral do código de barras confere?
export function codigoBarrasValido(codigo: string): boolean {
  const c = soDigitos(codigo);
  if (c.length !== 44) return false;
  if (c[0] === '8') {
    if (!'6789'.includes(c[2])) return false;
    return dvArrecadacao(c, c.slice(0, 3) + c.slice(4)) === Number(c[3]);
  }
  return modulo11Bancario(c.slice(0, 4) + c.slice(5)) === Number(c[4]);
}

export function codigoBarrasParaLinhaDigitavel(codigo: string): string | null {
  const c = soDigitos(codigo);
  if (c.length !== 44) return null;
  if (c[0] === '8') {
    if (!'6789'.includes(c[2])) return null;
    let linha = '';
    for (let i = 0; i < 4; i++) {
      const bloco = c.slice(i * 11, i * 11 + 11);
      linha += bloco + dvArrecadacao(c, bloco);
    }
    return linha;
  }
  const campo1 = c.slice(0, 4) + c.slice(19, 24);
  const campo2 = c.slice(24, 34);
  const campo3 = c.slice(34, 44);
  return `${campo1}${modulo10(campo1)}${campo2}${modulo10(campo2)}${campo3}${modulo10(campo3)}${c[4]}${c.slice(5, 19)}`;
}

export function linhaDigitavelParaCodigoBarras(linha: string): string | null {
  const l = soDigitos(linha);
  if (l.length === 48 && l[0] === '8') {
    return [0, 1, 2, 3].map(i => l.slice(i * 12, i * 12 + 11)).join('');
  }
  if (l.length === 47) {
    return l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
  }
  return null;
}

// Confere os DVs de cada bloco/campo da linha digitável.
export function linhaDigitavelValida(linha: string): boolean {
  const l = soDigitos(linha);
  const codigo = linhaDigitavelParaCodigoBarras(l);
  if (!codigo) return false;
  return codigoBarrasParaLinhaDigitavel(codigo) === l && codigoBarrasValido(codigo);
}

// Aceita linha digitável OU código de barras e devolve os dois normalizados.
export function normalizarBoleto(valor: string | null | undefined): { linha: string; codigo: string; valido: boolean } | null {
  const d = soDigitos(valor);
  if (d.length === 44) {
    const linha = codigoBarrasParaLinhaDigitavel(d);
    return linha ? { linha, codigo: d, valido: codigoBarrasValido(d) } : null;
  }
  if (d.length === 47 || d.length === 48) {
    const codigo = linhaDigitavelParaCodigoBarras(d);
    return codigo ? { linha: d, codigo, valido: linhaDigitavelValida(d) } : null;
  }
  return null;
}

// Formata para exibição: arrecadação em 4 blocos "xxxxxxxxxxx-x"; bancário no padrão de 5 campos.
export function formatarLinhaDigitavel(linha: string | null | undefined): string {
  const l = soDigitos(linha);
  if (l.length === 48) return [0, 1, 2, 3].map(i => `${l.slice(i * 12, i * 12 + 11)}-${l[i * 12 + 11]}`).join(' ');
  if (l.length === 47) return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
  return l;
}
