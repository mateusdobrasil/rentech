// Utilitários de CPF para o Portal do Funcionário: normalização, validação de
// dígito verificador e o e-mail sintético usado para autenticar no Supabase
// (Supabase Auth exige e-mail único; nem todo funcionário tem e-mail cadastrado).

export const somenteDigitos = (v: string): string => (v || '').replace(/\D/g, '');

export function cpfValido(cpfBruto: string): boolean {
  const cpf = somenteDigitos(cpfBruto);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const calcularDigito = (base: string): number => {
    let soma = 0;
    let peso = base.length + 1;
    for (const c of base) soma += parseInt(c, 10) * peso--;
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = calcularDigito(cpf.slice(0, 9));
  const d2 = calcularDigito(cpf.slice(0, 9) + d1);
  return cpf === cpf.slice(0, 9) + String(d1) + String(d2);
}

export const formatarCpf = (cpfBruto: string): string => {
  const cpf = somenteDigitos(cpfBruto);
  if (cpf.length !== 11) return cpfBruto;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
};

// E-mail sintético e determinístico usado só como identidade interna do
// Supabase Auth — nunca exibido nem enviado ao funcionário.
export const emailSinteticoPortal = (cpfBruto: string): string => {
  const cpf = somenteDigitos(cpfBruto);
  return `portal.${cpf}@funcionarios.rentech.internal`;
};
