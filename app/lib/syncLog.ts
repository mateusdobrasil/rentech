// app/lib/syncLog.ts
// Helper compartilhado pelas Server Actions de sincronização com o
// PrimeStart (produtos, parceiros, colaboradores, fichas de reserva,
// eventos/feiras) — grava uma linha por execução em `integracoes_sync_log`
// (ver sql/integracoes_sync_log.sql) e resolve o cursor de sincronização
// incremental (buscar só o que mudou desde a última vez bem-sucedida, em
// vez da base inteira de novo).
import { supabaseAdmin } from './supabase';
import { dataParaP2s, type AmbienteP2s } from './p2s';

export type IntegracaoSync = 'produtos' | 'parceiros' | 'colaboradores' | 'fichas_reserva' | 'eventos_feiras' | 'contas_pagar';
export type TipoSync = 'completa' | 'incremental';

// Última execução BEM-SUCEDIDA — o cursor_ate dela vira o cursor_desde da
// próxima. null = nunca sincronizou com sucesso (a ação deve fazer a carga
// completa, sem filtro de data).
export async function obterCursorIncremental(integracao: IntegracaoSync, ambiente: AmbienteP2s): Promise<Date | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('integracoes_sync_log')
    .select('cursor_ate')
    .eq('integracao', integracao)
    .eq('ambiente', ambiente)
    .eq('status', 'sucesso')
    .not('cursor_ate', 'is', null)
    .order('finalizado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.cursor_ate ? new Date(`${data.cursor_ate}T00:00:00Z`) : null;
}

// Serial do PrimeStart pra usar num criterio('DataUltimaAlteracaoCadastro',
// 'ge', 'dbl', ...) — já aplica a margem de segurança (a chamada calcula
// cursorAte como "agora menos 1 dia" antes de gravar, então aqui é só
// converter pro formato que a API espera).
export function cursorParaSerialP2s(cursor: Date): number {
  return dataParaP2s(cursor);
}

// "High-water mark": horário de início desta execução, menos 1 dia de
// margem (os campos DataUltimaAlteracaoCadastro do PrimeStart são só data,
// sem hora — a margem cobre a granularidade e evita perder algo alterado no
// mesmo dia da sincronização anterior). Vira o cursor_desde da PRÓXIMA vez.
export function calcularProximoCursor(iniciadoEm: Date): Date {
  return new Date(iniciadoEm.getTime() - 24 * 60 * 60 * 1000);
}

export interface RegistrarSincronizacaoParams {
  integracao: IntegracaoSync;
  ambiente: AmbienteP2s;
  tipo: TipoSync;
  cursorDesde: Date | null;
  cursorAte: Date | null;
  encontrados: number;
  processados: number;
  status: 'sucesso' | 'erro';
  erro?: string;
  iniciadoEm: Date;
}

export async function registrarSincronizacao(params: RegistrarSincronizacaoParams): Promise<void> {
  const db = supabaseAdmin();
  await db.from('integracoes_sync_log').insert({
    integracao: params.integracao,
    ambiente: params.ambiente,
    tipo: params.tipo,
    cursor_desde: params.cursorDesde ? params.cursorDesde.toISOString().slice(0, 10) : null,
    cursor_ate: params.cursorAte ? params.cursorAte.toISOString().slice(0, 10) : null,
    registros_encontrados: params.encontrados,
    registros_processados: params.processados,
    status: params.status,
    erro: params.erro || null,
    iniciado_em: params.iniciadoEm.toISOString(),
    finalizado_em: new Date().toISOString(),
  });
  // Falha ao gravar o log não deve derrubar a sincronização em si — só
  // perderíamos o registro dessa execução específica. Por isso sem throw
  // aqui; erro de insert (se houver) fica silencioso de propósito.
}

export interface UltimaSincronizacao {
  tipo: TipoSync;
  status: 'sucesso' | 'erro';
  registros_processados: number | null;
  finalizado_em: string | null;
  erro: string | null;
}

// Pra exibir na tela ("Última sincronização: ...") — traz a execução mais
// recente independente do status, pra falhas também ficarem visíveis.
export async function obterUltimaSincronizacao(integracao: IntegracaoSync, ambiente: AmbienteP2s): Promise<UltimaSincronizacao | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('integracoes_sync_log')
    .select('tipo, status, registros_processados, finalizado_em, erro')
    .eq('integracao', integracao)
    .eq('ambiente', ambiente)
    .order('finalizado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as UltimaSincronizacao | null;
}
