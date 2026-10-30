// Histórico das folhas de benefícios geradas por competência
// (.sql/folha_beneficios_geracoes.sql). Desde 2026-10-30 a geração é o botão
// "Gerar Benefício" do Grid (origem BENEFICIO): todos os benefícios de quem
// ficou marcado, com a parte Flash ligada ao pedido Flash (referencia_id). O
// lote do Financeiro RH (fonte Benefícios) lê o que NÃO é Flash daqui
// (beneficiosGeradosParaLote) e grava a sua própria (origem LOTE). GRID_CSV e
// FLASH são de antes do botão e só continuam sendo lidos. Tudo isso alimenta
// o Resumo de Recebimentos do holerite (actions-assinatura.ts), que mostra o
// que foi gerado no mês e não o cadastro atual.
import { supabaseAdmin } from './supabase';

export type OrigemGeracaoBeneficios = 'GRID_CSV' | 'FLASH' | 'LOTE' | 'BENEFICIO';

export type ItemGeracaoBeneficios = {
  funcionario_nome: string;
  tipo: string;
  meio: string;
  modalidade: string;
  valorBase: number;
  valorMes: number;
  detalhe: string;
};

// Benefício é pago adiantado: o cadastro que vale pra competência é o da
// virada do mês (00:00 de Brasília do dia 1º) — o que muda depois disso já é
// do mês seguinte. Usado como dataCorte de calcularBeneficiosMes.
export const inicioDaCompetencia = (mesReferencia: string) =>
  new Date(`${mesReferencia}-01T00:00:00-03:00`).toISOString();

// Base de valores do Grid / Gerar Benefício: cadastro na virada do mês
// (reconstituído pelo histórico) ou cadastro atual.
export type BaseBeneficios = 'INICIO_MES' | 'ATUAL';

const semAcentoMaiusc =(s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Agrupa meios do jeito que o pagamento é rastreado: Flash, transferência, ou
// o próprio nome do meio pros demais.
export function categoriaMeio(meio: string): string {
  const m = semAcentoMaiusc(meio);
  if (m.includes('FLASH')) return 'FLASH';
  if (m.includes('TRANSFER')) return 'TRANSFER';
  return m;
}

// Pedido Flash cancelado invalida só a parte Flash da geração BENEFICIO — o
// restante (transferência) continua valendo.
export async function pedidosFlashCancelados(db: ReturnType<typeof supabaseAdmin>, geracoes: { referencia_id?: number | null }[]): Promise<Set<number>> {
  const ids = [...new Set(geracoes.map(g => g.referencia_id).filter((v): v is number => v != null))];
  if (ids.length === 0) return new Set();
  const { data } = await db.from('folha_beneficios_flash_pedidos').select('id, status').in('id', ids);
  return new Set((data || []).filter(p => p.status === 'CANCELADO').map(p => p.id));
}

// O que vai pro lote do Financeiro RH (fonte Benefícios) na competência: por
// funcionário, a geração BENEFICIO mais recente que o inclui, só os itens que
// NÃO são Cartão Flash. Quem saiu sem nenhum item fora do Flash não entra.
export async function beneficiosGeradosParaLote(
  db: ReturnType<typeof supabaseAdmin>,
  mesReferencia: string
): Promise<Record<string, { total: number; itens: ItemGeracaoBeneficios[]; geracaoId: number }>> {
  const { data, error } = await db.from('folha_beneficios_geracoes')
    .select('id, funcionarios, itens, gerado_em, pago_em')
    .eq('mes_referencia', mesReferencia).eq('origem', 'BENEFICIO')
    .order('gerado_em', { ascending: false });
  if (error) throw new Error(`Histórico de benefícios gerados: ${error.message}`);

  const porNome: Record<string, { total: number; itens: ItemGeracaoBeneficios[]; geracaoId: number }> = {};
  const vistos = new Set<string>();
  (data || []).forEach(g => {
    (Array.isArray(g.funcionarios) ? g.funcionarios : []).forEach((nome: string) => {
      if (vistos.has(nome)) return; // já pegou a geração mais recente dele
      vistos.add(nome);
      if (g.pago_em) return; // registrada como já paga ("só registrar") — nada a pagar
      const itens = (g.itens || []).filter((it: any) => it.funcionario_nome === nome && categoriaMeio(it.meio) !== 'FLASH');
      const total = Math.round(itens.reduce((s: number, it: any) => s + (Number(it.valorMes) || 0), 0) * 100) / 100;
      if (total > 0) porNome[nome] = { total, itens, geracaoId: g.id };
    });
  });
  return porNome;
}

// Nunca derruba quem chamou (download do CSV, pedido Flash, lote): sem a
// tabela ou com erro, só devolve a mensagem.
export async function gravarGeracaoBeneficios(
  db: ReturnType<typeof supabaseAdmin>,
  p: {
    mesReferencia: string;
    origem: OrigemGeracaoBeneficios;
    referenciaId?: number | null;
    escopoMeio?: string | null;
    funcionarios: string[];
    itens: ItemGeracaoBeneficios[];
    geradoPor?: string | null;
    pagoEm?: string | null; // 'AAAA-MM-DD' — competência já paga por fora, só registrando
  }
): Promise<{ ok: boolean; erro?: string; id?: number }> {
  try {
    const itens = p.itens.map(it => ({
      funcionario_nome: it.funcionario_nome, tipo: it.tipo, meio: it.meio, modalidade: it.modalidade,
      valorBase: Number(it.valorBase) || 0, valorMes: Math.round((Number(it.valorMes) || 0) * 100) / 100, detalhe: it.detalhe
    }));
    const valorTotal = itens.reduce((s, it) => s + it.valorMes, 0);
    const { data, error } = await db.from('folha_beneficios_geracoes').insert({
      mes_referencia: p.mesReferencia,
      origem: p.origem,
      referencia_id: p.referenciaId ?? null,
      escopo_meio: p.escopoMeio || null,
      funcionarios: [...new Set(p.funcionarios)],
      itens,
      valor_total: Math.round(valorTotal * 100) / 100,
      gerado_por: p.geradoPor || null,
      ...(p.pagoEm ? { pago_em: p.pagoEm, pago_por: p.geradoPor || null } : {})
    }).select('id').single();
    if (error) return { ok: false, erro: error.message };
    return { ok: true, id: data.id };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
