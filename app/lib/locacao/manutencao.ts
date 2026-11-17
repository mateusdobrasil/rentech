// app/lib/locacao/manutencao.ts
// Regras de OS de manutenção e de avaria (2026-11-17). Só servidor, SEM
// checagem de acesso — quem chama (server action) valida a rota.
// Efeitos no estoque (a disponibilidade/agenda/inventário já respeitam):
//   patrimônio  → situacao MANUTENCAO enquanto a OS está aberta
//   quantidade  → locacao_saldos.quantidade_manutencao (local PRINCIPAL)
import type { supabaseAdmin } from '../supabase';

type Db = ReturnType<typeof supabaseAdmin>;
export type StatusOS = 'ABERTA' | 'EM_EXECUCAO' | 'AGUARDANDO_PECA' | 'CONCLUIDA' | 'SEM_CONSERTO' | 'CANCELADA';
export const STATUS_OS_ABERTOS: StatusOS[] = ['ABERTA', 'EM_EXECUCAO', 'AGUARDANDO_PECA'];
const LOCAL_PADRAO = 'PRINCIPAL';
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function ajustarSaldo(db: Db, empresaId: number, produtoId: number, deltaManut: number, deltaTotal: number, obs: string) {
  const { data: s } = await db.from('locacao_saldos').select('id, quantidade_total, quantidade_manutencao')
    .eq('empresa_id', empresaId).eq('produto_id', produtoId).eq('local', LOCAL_PADRAO).maybeSingle();
  const total = Math.max(0, n(s?.quantidade_total) + deltaTotal);
  const manut = Math.min(total, Math.max(0, n(s?.quantidade_manutencao) + deltaManut));
  const { error } = await db.from('locacao_saldos').upsert({
    produto_id: produtoId, empresa_id: empresaId, local: LOCAL_PADRAO, quantidade_total: total, quantidade_manutencao: manut,
    observacoes: obs, updated_at: new Date().toISOString(),
  }, { onConflict: 'produto_id,empresa_id,local' });
  if (error) throw error;
}

export interface DadosAbrirOS {
  empresa_id: number;
  produto_id: number;
  patrimonio_id?: number | null;
  quantidade?: number;
  origem: 'AVARIA' | 'CORRETIVA' | 'PREVENTIVA' | 'OUTRA';
  tipo: 'INTERNA' | 'TERCEIRO';
  fornecedor_id?: number | null;
  problema: string;
  responsavel?: string | null;
  previsao?: string | null;
  fotos?: string[];
  observacoes?: string | null;
}

export async function abrirManutencao(db: Db, d: DadosAbrirOS, usuario: string): Promise<number> {
  if (!d.problema?.trim()) throw new Error('Descreva o problema.');
  let situacaoAnterior: string | null = null;
  const qtd = d.patrimonio_id ? 1 : Math.max(0, n(d.quantidade) || 1);
  if (!(qtd > 0)) throw new Error('Quantidade inválida.');

  if (d.patrimonio_id) {
    const { data: p } = await db.from('locacao_patrimonios').select('id, empresa_id, produto_id, situacao, numero_patrimonio').eq('id', d.patrimonio_id).maybeSingle();
    if (!p) throw new Error('Patrimônio não encontrado.');
    if (p.empresa_id !== d.empresa_id || p.produto_id !== d.produto_id) throw new Error('Patrimônio não confere com a empresa/produto.');
    if (p.situacao === 'BAIXADO') throw new Error(`${p.numero_patrimonio} está baixado.`);
    const { count } = await db.from('locacao_manutencoes').select('id', { count: 'exact', head: true })
      .eq('patrimonio_id', p.id).in('status', STATUS_OS_ABERTOS);
    if ((count || 0) > 0) throw new Error(`${p.numero_patrimonio} já tem OS de manutenção aberta.`);
    situacaoAnterior = p.situacao;
  } else {
    // Quantidade: só cabe o que está fora de manutenção no saldo. Sem isso o
    // ajuste "capava" a manutenção no total e, ao fechar a OS, subtraía a
    // quantidade cheia — a contagem de manutenção ficava menor que a real.
    const { data: s } = await db.from('locacao_saldos').select('quantidade_total, quantidade_manutencao')
      .eq('empresa_id', d.empresa_id).eq('produto_id', d.produto_id).eq('local', LOCAL_PADRAO).maybeSingle();
    const livre = n(s?.quantidade_total) - n(s?.quantidade_manutencao);
    if (qtd > livre) throw new Error(`Só ${livre.toLocaleString('pt-BR')} unidade(s) fora de manutenção no saldo deste produto — ajuste a quantidade (ou o saldo em Equipamentos de Locação).`);
  }

  const { data: os, error } = await db.from('locacao_manutencoes').insert({
    empresa_id: d.empresa_id, produto_id: d.produto_id, patrimonio_id: d.patrimonio_id || null, quantidade: qtd,
    origem: d.origem, tipo: d.tipo, fornecedor_id: d.tipo === 'TERCEIRO' ? d.fornecedor_id || null : null,
    problema: d.problema.trim(), responsavel: d.responsavel?.trim() || null, previsao: d.previsao || null,
    fotos: d.fotos || [], observacoes: d.observacoes?.trim() || null, situacao_anterior: situacaoAnterior, aberta_por: usuario,
  }).select('id').single();
  if (error) throw error;

  if (d.patrimonio_id) {
    await db.from('locacao_patrimonios').update({ situacao: 'MANUTENCAO', updated_at: new Date().toISOString() }).eq('id', d.patrimonio_id);
  } else {
    await ajustarSaldo(db, d.empresa_id, d.produto_id, +qtd, 0, `OS de manutenção #${os.id} aberta`);
  }
  return os.id;
}

export async function mudarStatusManutencao(
  db: Db, id: number, novo: StatusOS,
  dados: { servico_executado?: string | null; custo_pecas?: number | null; custo_mao_obra?: number | null; nota_fiscal?: string | null; previsao?: string | null; responsavel?: string | null; observacoes?: string | null; fotos?: string[] },
  usuario: string
): Promise<void> {
  const { data: os } = await db.from('locacao_manutencoes').select('*').eq('id', id).maybeSingle();
  if (!os) throw new Error('OS não encontrada.');
  const agora = new Date().toISOString();
  const campos: Record<string, unknown> = { atualizado_em: agora };
  for (const k of ['servico_executado', 'nota_fiscal', 'previsao', 'responsavel', 'observacoes'] as const) {
    if (dados[k] !== undefined) campos[k] = (typeof dados[k] === 'string' ? (dados[k] as string).trim() : dados[k]) || null;
  }
  if (dados.custo_pecas !== undefined && dados.custo_pecas !== null) campos.custo_pecas = Math.max(0, n(dados.custo_pecas));
  if (dados.custo_mao_obra !== undefined && dados.custo_mao_obra !== null) campos.custo_mao_obra = Math.max(0, n(dados.custo_mao_obra));
  if (dados.fotos) campos.fotos = dados.fotos;

  const aberta = STATUS_OS_ABERTOS.includes(os.status);
  if (novo !== os.status) {
    if (!aberta) throw new Error('OS já encerrada — não muda mais de status.');
    campos.status = novo;
    if (!STATUS_OS_ABERTOS.includes(novo)) {
      campos.concluida_por = usuario;
      campos.concluida_em = agora;
      const q = n(os.quantidade);
      if (os.patrimonio_id) {
        const situacao = novo === 'CONCLUIDA' ? 'ATIVO' : novo === 'SEM_CONSERTO' ? 'BAIXADO' : (os.situacao_anterior && os.situacao_anterior !== 'MANUTENCAO' ? os.situacao_anterior : 'ATIVO');
        await db.from('locacao_patrimonios').update({
          situacao, updated_at: agora,
          ...(novo === 'SEM_CONSERTO' ? { observacoes: `Baixado: sem conserto (OS #${id})` } : {}),
        }).eq('id', os.patrimonio_id);
      } else {
        await ajustarSaldo(db, os.empresa_id, os.produto_id, -q, novo === 'SEM_CONSERTO' ? -q : 0,
          `OS de manutenção #${id} ${novo === 'CONCLUIDA' ? 'concluída' : novo === 'SEM_CONSERTO' ? 'sem conserto (baixa)' : 'cancelada'}`);
      }
    }
  }
  // OS encerrada ainda aceita completar custo/NF/serviço (lançados depois).
  const { error } = await db.from('locacao_manutencoes').update(campos).eq('id', id);
  if (error) throw error;
}

export interface DadosAvaria {
  empresa_id: number;
  produto_id: number;
  patrimonio_id?: number | null;
  quantidade?: number;
  gravidade: 'LEVE' | 'MEDIA' | 'GRAVE' | 'PERDA_TOTAL';
  descricao: string;
  fotos?: string[];
  ficha_id?: number | null;
  parceiro_id?: number | null;
  checklist_id?: string | null;
  status_cobranca?: 'A_DEFINIR' | 'COBRAR' | 'NAO_COBRAR';
  valor_cobranca?: number | null;
  abrir_os?: { tipo: 'INTERNA' | 'TERCEIRO'; fornecedor_id?: number | null } | null;
}

/** Registra a avaria e, se pedido, abre a OS de manutenção (origem AVARIA). */
export async function registrarAvaria(db: Db, d: DadosAvaria, usuario: string): Promise<{ avariaId: number; manutencaoId: number | null }> {
  if (!d.descricao?.trim()) throw new Error('Descreva a avaria.');
  const qtd = d.patrimonio_id ? 1 : Math.max(0, n(d.quantidade) || 1);
  // cliente: o da ficha, se não veio
  let parceiroId = d.parceiro_id || null;
  if (!parceiroId && d.ficha_id) {
    const { data: f } = await db.from('locacao_fichas_reserva').select('parceiro_id').eq('id', d.ficha_id).maybeSingle();
    parceiroId = f?.parceiro_id || null;
  }
  const { data: av, error } = await db.from('locacao_avarias').insert({
    empresa_id: d.empresa_id, produto_id: d.produto_id, patrimonio_id: d.patrimonio_id || null, quantidade: qtd,
    gravidade: d.gravidade, descricao: d.descricao.trim(), fotos: d.fotos || [], ficha_id: d.ficha_id || null, parceiro_id: parceiroId,
    checklist_id: d.checklist_id || null, status_cobranca: d.status_cobranca || 'A_DEFINIR',
    valor_cobranca: d.valor_cobranca ?? null, registrada_por: usuario,
  }).select('id').single();
  if (error) throw error;

  let manutencaoId: number | null = null;
  if (d.gravidade === 'PERDA_TOTAL' && d.patrimonio_id) {
    await db.from('locacao_patrimonios').update({ situacao: 'BAIXADO', observacoes: `Perda total — avaria #${av.id}`, updated_at: new Date().toISOString() }).eq('id', d.patrimonio_id);
  } else if (d.gravidade === 'PERDA_TOTAL') {
    await ajustarSaldo(db, d.empresa_id, d.produto_id, 0, -qtd, `Perda total — avaria #${av.id}`);
  } else if (d.abrir_os) {
    manutencaoId = await abrirManutencao(db, {
      empresa_id: d.empresa_id, produto_id: d.produto_id, patrimonio_id: d.patrimonio_id, quantidade: qtd, origem: 'AVARIA',
      tipo: d.abrir_os.tipo, fornecedor_id: d.abrir_os.fornecedor_id, problema: d.descricao, fotos: d.fotos,
    }, usuario);
    await db.from('locacao_avarias').update({ manutencao_id: manutencaoId }).eq('id', av.id);
  }
  return { avariaId: av.id, manutencaoId };
}
