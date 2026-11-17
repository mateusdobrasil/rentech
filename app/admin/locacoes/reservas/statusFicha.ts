// Rótulos e cores dos status da Ficha de Reserva própria (lista e editor).
import type { StatusFicha } from './actions';

export const STATUS_FICHA: Record<StatusFicha, { rotulo: string; cls: string }> = {
  ORCAMENTO: { rotulo: 'Orçamento', cls: 'bg-slate-100 text-slate-700' },
  ENVIADO: { rotulo: 'Enviado', cls: 'bg-blue-100 text-blue-700' },
  APROVADO: { rotulo: 'Aprovado', cls: 'bg-cyan-100 text-cyan-700' },
  RESERVADA: { rotulo: 'Reservada', cls: 'bg-emerald-100 text-emerald-700' },
  EM_LOCACAO: { rotulo: 'Em locação', cls: 'bg-violet-100 text-violet-700' },
  FINALIZADA: { rotulo: 'Finalizada', cls: 'bg-gray-200 text-gray-600' },
  PERDIDO: { rotulo: 'Perdido', cls: 'bg-red-100 text-red-600' },
  CANCELADA: { rotulo: 'Cancelada', cls: 'bg-red-50 text-red-400' },
};

export const MODALIDADES = [
  { v: 'DIARIA', rotulo: 'Por diária', desc: 'Preço pelas faixas de dias da tabela.' },
  { v: 'PERIODO', rotulo: 'Período fechado', desc: 'Valor fechado para o evento — a tabela sugere, o vendedor ajusta.' },
  { v: 'MENSAL', rotulo: 'Mensal', desc: 'Valor mensal da tabela × meses (cada 30 dias ou fração).' },
] as const;

export const numeroFicha = (id: number) => `FR-${String(id).padStart(5, '0')}`;
