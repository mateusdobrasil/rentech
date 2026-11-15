// app/lib/diretoria/parametros.ts
// Valores de corte dos alertas do Diretor — editáveis em /admin/diretoria →
// Parâmetros (tabela diretoria_parametros, .sql/Pendentes/diretoria_fase2.sql).
// Os padrões abaixo valem se a tabela ainda não existir ou faltar uma linha.
import { supabaseAdmin } from '../supabase';

type DB = ReturnType<typeof supabaseAdmin>;

export const PARAMETROS_PADRAO = {
  alerta_op_valor_alto: 10000,
  alerta_receber_valor_minimo: 20000,
  alerta_receber_janela_dias: 30,
  alerta_expedicao_dias_tolerancia: 3,
  alerta_frota_dias_fora: 3,
  alerta_caixa_margem: 0,
};
export type ParametrosDiretoria = typeof PARAMETROS_PADRAO;
export type ChaveParametro = keyof ParametrosDiretoria;

export async function carregarParametrosDiretoria(db: DB): Promise<ParametrosDiretoria> {
  const p = { ...PARAMETROS_PADRAO };
  const { data } = await db.from('diretoria_parametros').select('chave, valor');
  for (const linha of (data || []) as { chave: string; valor: number }[]) {
    if (linha.chave in p && Number.isFinite(Number(linha.valor))) p[linha.chave as ChaveParametro] = Number(linha.valor);
  }
  return p;
}
