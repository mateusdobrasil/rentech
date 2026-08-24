// mobile/lib/frota.ts
// Estado do veículo pra tag da tela Frota — porta simplificada de
// getStatusVencimento em app/admin/operacional/frota/controle/page.tsx (web/):
// mesmo cálculo de dias até vencer, resumido numa tag só (o admin mostra CRLV/
// IPVA/seguro/locação separados; aqui cabe só uma tag por veículo).
export interface EstadoVeiculo {
  texto: string;
  variante: 'acento' | 'contorno' | 'neutra';
}

function diasParaVencer(dataStr: string | null): number | null {
  if (!dataStr) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(`${dataStr}T00:00:00`);
  return Math.ceil((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

export function estadoVeiculo(v: { status: string; crlv_vencimento: string | null; seguro_vigencia_fim: string | null }): EstadoVeiculo {
  if (v.status !== 'ATIVO') {
    return { texto: v.status === 'EM MANUTENÇÃO' ? 'Em manutenção' : 'Inativo', variante: 'contorno' };
  }

  const dias = [diasParaVencer(v.crlv_vencimento), diasParaVencer(v.seguro_vigencia_fim)].filter((d): d is number => d !== null);
  if (dias.some(d => d < 0)) return { texto: 'Documento vencido', variante: 'acento' };
  if (dias.some(d => d <= 30)) return { texto: 'Vence em breve', variante: 'acento' };
  return { texto: 'Em dia', variante: 'neutra' };
}
