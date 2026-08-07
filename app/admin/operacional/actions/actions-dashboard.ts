'use server';

// app/admin/operacional/actions/actions-dashboard.ts
// Painel de pendências do hub Operacional (/admin/operacional) — mesmo
// espírito do painelRhAction em app/admin/rh/actions/actions-dashboard.ts:
// agrega, num só round-trip, números que hoje só apareciam depois de entrar
// em cada módulo.
import { supabaseAdmin } from '../../../lib/supabase';

type Resultado = { ok: boolean; erro?: string; info?: any };

// Dias até vencer (negativo = já venceu) — mesma janela de 30 dias usada em
// getStatusVencimento/getUrgenciaVeiculo (app/admin/operacional/frota/page.tsx)
// e em painelDocumentosAction (app/admin/rh/actions/actions-documentos-func.ts).
function diasAteVencer(dataStr: string | null | undefined, hoje: Date): number | null {
  if (!dataStr) return null;
  const alvo = new Date(`${dataStr}T00:00:00`);
  return Math.ceil((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

export async function painelOperacionalAction(): Promise<Resultado> {
  const db = supabaseAdmin();
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const [veiculosRes, checklistsRes, folgasRes] = await Promise.all([
      db.from('frota_veiculos')
        .select('crlv_vencimento, ipva_vencimento, seguro_vigencia_fim, locacao_vigencia_fim, propriedade')
        .eq('exibir_na_frota', true),
      db.from('checklists').select('id', { count: 'exact', head: true }).neq('status', 'FINALIZADO'),
      db.from('folha_ponto_whatsapp_solicitacoes').select('id', { count: 'exact', head: true }).eq('tipo', 'FOLGA_DIA').eq('status', 'PENDENTE'),
    ]);

    // Pior situação por veículo — CRLV, IPVA, e Seguro ou Locação conforme a
    // propriedade — mesma regra de getUrgenciaVeiculo (frota/page.tsx), só
    // reimplementada aqui porque aquele arquivo é "use client" e não exporta a função.
    let documentosVencidos = 0;
    let documentosVencendo = 0;
    (veiculosRes.data || []).forEach(v => {
      const datas = [v.crlv_vencimento, v.ipva_vencimento, v.propriedade === 'ALUGADO' ? v.locacao_vigencia_fim : v.seguro_vigencia_fim];
      const dias = datas.map(d => diasAteVencer(d, hoje)).filter((d): d is number => d !== null);
      if (dias.length === 0) return;
      const pior = Math.min(...dias);
      if (pior < 0) documentosVencidos++;
      else if (pior <= 30) documentosVencendo++;
    });

    return {
      ok: true,
      info: {
        documentosVencidos,
        documentosVencendo,
        checklistsAbertos: checklistsRes.count || 0,
        folgasPendentes: folgasRes.count || 0,
      }
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
