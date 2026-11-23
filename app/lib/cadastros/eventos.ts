// app/lib/cadastros/eventos.ts
// Cadastro PRÓPRIO de eventos e feiras (2026-11-23). Só servidor, SEM
// checagem de acesso. Mesma transição dos parceiros e produtos: o evento que
// veio do P2S é só leitura enquanto o P2S for oficial (a sync sobrescreve);
// quando todas as empresas congelarem, o cadastro é do sistema. O evento feito
// aqui é adotado quando o mesmo (nome + data inicial) chega do P2S
// (app/lib/locacao/eventosP2s.ts → gravarEventos).
// O status (Futuro / Em Execução / Finalizado) segue a data: a rotina diária
// recalcula com atualizarStatusEventos — antes só a sync do P2S fazia isso.
import type { supabaseAdmin } from '../supabase';
import { cadastrosNoSistema } from './parceiros';
import { hojeISO } from '../locacao/datas';

type Db = ReturnType<typeof supabaseAdmin>;

export function statusDoEvento(dataInicial: string, dataFinal: string | null, hoje = hojeISO()): string {
  const fim = dataFinal || dataInicial;
  if (fim < hoje) return 'Finalizado';
  if (dataInicial <= hoje) return 'Em Execução';
  return 'Futuro';
}

/** Recalcula o status de todos os eventos pela data (rotina diária, sem P2S). */
export async function atualizarStatusEventos(db: Db): Promise<{ ok: true; info: { atualizados: number } }> {
  const hoje = hojeISO();
  let atualizados = 0;
  const upd = (status: string) => db.from('eventos_feiras').update({ status, updated_at: new Date().toISOString() });
  const rodadas = await Promise.all([
    upd('Finalizado').lt('data_final', hoje).neq('status', 'Finalizado').select('id'),
    upd('Em Execução').lte('data_inicial', hoje).gte('data_final', hoje).neq('status', 'Em Execução').select('id'),
    upd('Futuro').gt('data_inicial', hoje).neq('status', 'Futuro').select('id'),
  ]);
  for (const { data, error } of rodadas) {
    if (error) throw new Error(error.message);
    atualizados += (data || []).length;
  }
  return { ok: true, info: { atualizados } };
}

export async function eventoEditavel(db: Db, ev: { p2s_oid?: string | null }): Promise<{ editavel: boolean; motivo: string | null }> {
  if (!ev.p2s_oid) return { editavel: true, motivo: null };
  if (await cadastrosNoSistema(db)) return { editavel: true, motivo: null };
  return { editavel: false, motivo: 'Evento do P2S: enquanto o P2S for oficial, altere lá; a mudança chega aqui na sincronização (11h e 17h).' };
}

export interface DadosEvento {
  id?: string | null;
  nome: string;
  data_inicial: string;
  data_final?: string | null;
  local?: string | null;
  montadora?: string | null;
  promotor?: string | null;
  tipo_evento?: string | null;
  colaborador_responsavel?: string | null;
  observacoes?: string | null;
}

const txt = (v: unknown, max = 300) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, max) : null; };
const dataOk = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

export async function salvarEvento(db: Db, d: DadosEvento): Promise<{ id: string; novo: boolean }> {
  const nome = txt(d.nome, 200)?.toUpperCase();
  if (!nome) throw new Error('Informe o nome do evento.');
  if (!dataOk(d.data_inicial)) throw new Error('Informe a data inicial.');
  const fim = dataOk(d.data_final) ? String(d.data_final) : d.data_inicial;
  if (fim < d.data_inicial) throw new Error('A data final é anterior à inicial.');
  if (d.id) {
    const { data: atual, error } = await db.from('eventos_feiras').select('id, p2s_oid').eq('id', d.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!atual) throw new Error('Evento não encontrado.');
    const e = await eventoEditavel(db, atual);
    if (!e.editavel) throw new Error(e.motivo || 'Evento só para leitura.');
  }
  let qDup = db.from('eventos_feiras').select('id').eq('nome', nome).eq('data_inicial', d.data_inicial).limit(1);
  if (d.id) qDup = qDup.neq('id', d.id);
  const { data: dup } = await qDup;
  if (dup?.length) throw new Error('Já existe um evento com este nome e esta data inicial.');
  const linha = {
    nome, data_inicial: d.data_inicial, data_final: fim, status: statusDoEvento(d.data_inicial, fim),
    local: txt(d.local, 200)?.toUpperCase() || null, montadora: txt(d.montadora, 120)?.toUpperCase() || null,
    promotor: txt(d.promotor, 120)?.toUpperCase() || null, tipo_evento: txt(d.tipo_evento, 60),
    colaborador_responsavel: txt(d.colaborador_responsavel, 120), observacoes: txt(d.observacoes, 2000),
    updated_at: new Date().toISOString(),
  };
  if (d.id) {
    const { error } = await db.from('eventos_feiras').update(linha).eq('id', d.id);
    if (error) throw new Error(error.message);
    return { id: d.id, novo: false };
  }
  const { data, error } = await db.from('eventos_feiras').insert({ id: crypto.randomUUID(), ...linha }).select('id').single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, novo: true };
}
