// Verificação de documentação vencida da frota (CRLV e seguro), usada pelo
// motor de Cron para alimentar a automação 'frota-vencimentos' (tela
// Agendamentos e Disparos) com a lista de veículos irregulares do dia.
import { supabaseAdmin } from './supabase';

interface ContextoFrotaVencida {
  quantidade: number;
  lista: string;
}

// Mesma regra de "vencido" já usada visualmente em app/admin/operacional/frota/page.tsx
// (getStatusVencimento): data menor que hoje (BRT, sem hora).
function estaVencido(dataStr: string | null | undefined, hoje: Date): boolean {
  if (!dataStr) return false;
  const alvo = new Date(`${dataStr}T00:00:00`);
  return alvo.getTime() < hoje.getTime();
}

const fmtData = (dataStr: string) => new Date(`${dataStr}T00:00:00`).toLocaleDateString('pt-BR');

// Retorna null se nenhum veículo ativo estiver com CRLV ou seguro vencido —
// nesse caso o motor não deve disparar mensagem nenhuma.
export async function montarContextoFrotaVencida(): Promise<ContextoFrotaVencida | null> {
  const db = supabaseAdmin();
  const { data: veiculos } = await db
    .from('frota_veiculos')
    .select('apelido, placa, status, crlv_vencimento, seguro_vigencia_fim')
    .neq('status', 'INATIVO');

  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  agora.setHours(0, 0, 0, 0);

  const linhas: string[] = [];
  for (const v of veiculos || []) {
    const pendencias: string[] = [];
    if (estaVencido(v.crlv_vencimento, agora)) pendencias.push(`CRLV vencido em ${fmtData(v.crlv_vencimento!)}`);
    if (estaVencido(v.seguro_vigencia_fim, agora)) pendencias.push(`Seguro vencido em ${fmtData(v.seguro_vigencia_fim!)}`);
    if (pendencias.length > 0) {
      linhas.push(`🚗 *${v.apelido}* (${v.placa || 'sem placa'}) — ${pendencias.join(' | ')}`);
    }
  }

  if (linhas.length === 0) return null;
  return { quantidade: linhas.length, lista: linhas.join('\n') };
}
