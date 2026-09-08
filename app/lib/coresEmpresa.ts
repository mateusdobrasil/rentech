// Cor do selo de empresa nas telas que mostram a qual empresa um registro
// pertence. Convenção visual do sistema:
//   • "Todas as empresas" (null) → verde
//   • Rentech                    → azul
//   • Alfa Light                 → rosa choque
//
// O mapa é por id porque a cor é uma escolha visual por empresa, não algo
// derivável do nome. Empresa nova que entrar sem cor definida cai no cinza
// neutro — nunca "empresta" a cor de outra. Se um dia isso virar configurável
// pelo usuário, o caminho natural é uma coluna `cor` em `empresas` e este
// arquivo passa a ser só o fallback.
const CORES_POR_EMPRESA: Record<number, string> = {
  12: 'bg-blue-100 text-blue-700',       // RENTECH LOCADORA
  19: 'bg-fuchsia-100 text-fuchsia-700', // ALFA LIGHT LOCADORA
};

const COR_TODAS = 'bg-emerald-100 text-emerald-700';
const COR_SEM_DEFINICAO = 'bg-slate-100 text-slate-600';

export function corSeloEmpresa(empresaId: number | null | undefined): string {
  if (empresaId === null || empresaId === undefined) return COR_TODAS;
  return CORES_POR_EMPRESA[empresaId] || COR_SEM_DEFINICAO;
}
