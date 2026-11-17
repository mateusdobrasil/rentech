// Tipos e helpers de tela do módulo Suporte (sem 'use server').
import type { Anexo, Prioridade, StatusChamado } from '../../lib/suporte/constantes';
import { STATUS_EM_ABERTO } from '../../lib/suporte/constantes';

export interface AreaSuporte {
  id: number; nome: string; descricao: string | null; icone: string; cor: string;
  categorias: string[]; sla_horas: Record<Prioridade, number>; ativo: boolean; ordem: number; atendentes: number;
}

export interface ChamadoLista {
  id: number; titulo: string; area_id: number; categoria: string | null; prioridade: Prioridade; status: StatusChamado;
  empresa_id: number | null; solicitante_id: string; solicitante_nome: string; responsavel_id: string | null; responsavel_nome: string | null;
  prazo_em: string | null; primeira_resposta_em: string | null; resolvido_em: string | null; fechado_em: string | null;
  avaliacao: number | null; created_at: string; ultima_interacao_em: string;
  sou_solicitante: boolean; sou_atendente: boolean; nao_lido: boolean;
}

export interface Mensagem {
  id: string; tipo: 'MENSAGEM' | 'NOTA_INTERNA' | 'EVENTO'; autor_id: string | null; autor_nome: string; texto: string; anexos: Anexo[]; created_at: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dataHora = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const duracao = (ms: number) => {
  const min = Math.round(Math.abs(ms) / 60000);
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)} dias`;
};

export const horasLegiveis = (h: number | null) => (h === null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1).replace('.', ',')}h` : `${(h / 24).toFixed(1).replace('.', ',')} dias`);

/** Situação do prazo para a lista/detalhe. */
export function situacaoPrazo(c: Pick<ChamadoLista, 'status' | 'prazo_em' | 'resolvido_em'>): { texto: string; cor: string; atrasado: boolean } | null {
  if (!c.prazo_em) return null;
  const prazo = new Date(c.prazo_em).getTime();
  if (!STATUS_EM_ABERTO.includes(c.status)) {
    if (!c.resolvido_em) return null;
    const noPrazo = new Date(c.resolvido_em).getTime() <= prazo;
    return { texto: noPrazo ? 'No prazo' : 'Fora do prazo', cor: noPrazo ? 'text-emerald-600' : 'text-red-500', atrasado: false };
  }
  const resta = prazo - Date.now();
  if (resta < 0) return { texto: `Atrasado ${duracao(resta)}`, cor: 'text-red-600 font-black', atrasado: true };
  if (resta < 2 * 3600_000) return { texto: `Vence em ${duracao(resta)}`, cor: 'text-orange-600 font-black', atrasado: false };
  return { texto: `Vence em ${duracao(resta)}`, cor: 'text-[#64748B]', atrasado: false };
}
