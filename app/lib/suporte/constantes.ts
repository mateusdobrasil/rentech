// app/lib/suporte/constantes.ts
// Módulo Suporte e Chamados (2026-11-17) — constantes compartilhadas entre a
// tela e o servidor. Sem 'use server' (só exporta valores).

export const ROTA_SUPORTE = '/admin/suporte';
export const ROTA_SUPORTE_AREAS = '/admin/suporte/areas';
export const BUCKET_SUPORTE = 'suporte-anexos';
export const CARD_AVISO_AREA = 'suporte-aviso-area';
export const CARD_AVISO_SOLICITANTE = 'suporte-aviso-solicitante';

export const LIMITE_ANEXO_MB = 20;
export const MAX_ANEXOS = 10;

export type Prioridade = 'URGENTE' | 'ALTA' | 'MEDIA' | 'BAIXA';
export type StatusChamado = 'ABERTO' | 'EM_ATENDIMENTO' | 'AGUARDANDO_SOLICITANTE' | 'RESOLVIDO' | 'FECHADO' | 'CANCELADO';

// cor = selo claro (listas); solido = fundo forte com texto branco (botão
// selecionado, cabeçalho dos prazos) — contraste alto em qualquer tema.
export const PRIORIDADES: { valor: Prioridade; rotulo: string; cor: string; solido: string; ponto: string }[] = [
  { valor: 'URGENTE', rotulo: 'Urgente', cor: 'bg-red-100 text-red-800 border-red-300', solido: 'bg-red-600 border-red-600 text-white', ponto: 'bg-red-600' },
  { valor: 'ALTA', rotulo: 'Alta', cor: 'bg-orange-100 text-orange-800 border-orange-300', solido: 'bg-orange-600 border-orange-600 text-white', ponto: 'bg-orange-500' },
  { valor: 'MEDIA', rotulo: 'Média', cor: 'bg-amber-100 text-amber-900 border-amber-300', solido: 'bg-amber-500 border-amber-500 text-white', ponto: 'bg-amber-500' },
  { valor: 'BAIXA', rotulo: 'Baixa', cor: 'bg-slate-200 text-slate-800 border-slate-300', solido: 'bg-slate-600 border-slate-600 text-white', ponto: 'bg-slate-500' },
];

export const STATUS: Record<StatusChamado, { rotulo: string; cor: string }> = {
  ABERTO: { rotulo: 'Aberto', cor: 'bg-blue-100 text-blue-700' },
  EM_ATENDIMENTO: { rotulo: 'Em atendimento', cor: 'bg-violet-100 text-violet-700' },
  AGUARDANDO_SOLICITANTE: { rotulo: 'Aguardando solicitante', cor: 'bg-amber-100 text-amber-700' },
  RESOLVIDO: { rotulo: 'Resolvido', cor: 'bg-emerald-100 text-emerald-700' },
  FECHADO: { rotulo: 'Fechado', cor: 'bg-slate-200 text-slate-600' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'bg-slate-100 text-slate-400' },
};

/** Status em que o chamado ainda está "na mesa" da área (conta prazo). */
export const STATUS_EM_ABERTO: StatusChamado[] = ['ABERTO', 'EM_ATENDIMENTO', 'AGUARDANDO_SOLICITANTE'];

export const SLA_PADRAO: Record<Prioridade, number> = { URGENTE: 4, ALTA: 8, MEDIA: 24, BAIXA: 72 };

export const rotuloPrioridade = (p: string) => PRIORIDADES.find(x => x.valor === p)?.rotulo || p;
export const rotuloStatus = (s: string) => STATUS[s as StatusChamado]?.rotulo || s;

export interface Anexo { path: string; nome: string; tamanho: number; tipo: string }
