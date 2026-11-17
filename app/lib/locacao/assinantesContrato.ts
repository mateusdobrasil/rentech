// app/lib/locacao/assinantesContrato.ts
// Quem assina o contrato de locação na Autentique (2026-11-17, regra do usuário):
//   sempre: o(a) VENDEDOR(A) da ficha e o CLIENTE (locatária);
//   opcionais: TESTEMUNHA(s), o REPRESENTANTE da empresa (só quando marcado)
//   e OUTRAS pessoas (mais de um responsável do cliente, por exemplo).
// Arquivo puro (tela e servidor).

export type PapelAssinante = 'VENDEDOR' | 'LOCATARIA' | 'REPRESENTANTE' | 'TESTEMUNHA' | 'OUTRO';

export const ROTULO_PAPEL: Record<PapelAssinante, string> = {
  VENDEDOR: 'Vendedor(a)', LOCATARIA: 'Cliente', REPRESENTANTE: 'Representante da empresa', TESTEMUNHA: 'Testemunha', OUTRO: 'Outra pessoa',
};

/** Lado da LOCADORA no contrato (assinam pela empresa). */
export const PELA_LOCADORA: PapelAssinante[] = ['VENDEDOR', 'REPRESENTANTE'];

export const MAX_ASSINANTES = 10;

export interface AssinanteContrato {
  papel: PapelAssinante;
  nome: string;
  email?: string | null;
  celular?: string | null;
  link?: string | null;
  public_id?: string | null;
  visualizado_em?: string | null;
  assinado_em?: string | null;
  rejeitado_em?: string | null;
}
